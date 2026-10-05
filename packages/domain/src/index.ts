import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { pool, transaction, enqueueSummary, type Tx } from '../../db/src/index.js';
import { openKey } from './secrets.js';
import type { Message, AgentRun, Role } from '../../contracts/src/index.js';

export class DomainError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export async function identify(authId: string, name: string) {
  const { rows } = await pool.query(
    "insert into participants(auth_user_id,kind,name) values($1,'human',$2) on conflict(auth_user_id) do update set name=excluded.name returning id,name,kind",
    [authId, name.slice(0, 80)],
  );
  return rows[0];
}
export async function workspaceAccess(tx: Tx, user: string, workspace: string, owner = false) {
  const { rows } = await tx.query(
    'select role,enabled from workspace_members where workspace_id=$1 and participant_id=$2 for share',
    [workspace, user],
  );
  if (!rows[0]?.enabled || (owner && !['owner', 'admin'].includes(rows[0].role)))
    throw new DomainError(403, 'Workspace access denied');
  return rows[0] as { role: Role; enabled: boolean };
}
export async function channelAccess(tx: Tx, user: string, conversation: string) {
  // Every mutation and membership change takes this lock. Events commit in sequence order.
  const { rows } = await tx.query('select * from conversations where id=$1 for update', [
    conversation,
  ]);
  const channel = rows[0];
  if (!channel) throw new DomainError(404, 'Conversation not found');
  const allowed = await tx.query(
    'select 1 from conversation_members cm join workspace_members wm on wm.participant_id=cm.participant_id and wm.workspace_id=$3 where cm.conversation_id=$1 and cm.participant_id=$2 and wm.enabled for share of wm',
    [conversation, user, channel.workspace_id],
  );
  if (!allowed.rowCount) throw new DomainError(403, 'Conversation access denied');
  return channel;
}
export async function createWorkspace(user: string, name: string) {
  return transaction(async (tx) => {
    const workspace = (
      await tx.query('insert into workspaces(name) values($1) returning *', [name])
    ).rows[0];
    await tx.query(
      "insert into workspace_members(workspace_id,participant_id,role) values($1,$2,'owner')",
      [workspace.id, user],
    );
    await tx.query('insert into workspace_llm(workspace_id) values($1)', [workspace.id]);
    const agent = (
      await tx.query("insert into participants(kind,name) values('agent','Assistant') returning id")
    ).rows[0];
    await tx.query(
      "insert into workspace_members(workspace_id,participant_id,role) values($1,$2,'member')",
      [workspace.id, agent.id],
    );
    const conversation = (
      await tx.query(
        "insert into conversations(workspace_id,name,created_by) values($1,'general',$2) returning *",
        [workspace.id, user],
      )
    ).rows[0];
    await tx.query('insert into conversation_members values($1,$2),($1,$3)', [
      conversation.id,
      user,
      agent.id,
    ]);
    return { ...workspace, role: 'owner' };
  });
}
export async function markRead(user: string, conversation: string, sequence: string) {
  return transaction(async (tx) => {
    const channel = await channelAccess(tx, user, conversation);
    if (BigInt(sequence) > BigInt(channel.sequence))
      throw new DomainError(400, 'Read position is beyond the conversation');
    await tx.query(
      `insert into conversation_reads(conversation_id,participant_id,sequence)
       values($1,$2,$3) on conflict(conversation_id,participant_id)
       do update set sequence=greatest(conversation_reads.sequence,excluded.sequence)`,
      [conversation, user, sequence],
    );
    return { ok: true };
  });
}
export async function createChannel(
  user: string,
  workspace: string,
  name: string,
  privateChannel: boolean,
) {
  return transaction(async (tx) => {
    await workspaceAccess(tx, user, workspace);
    const channel = (
      await tx.query(
        'insert into conversations(workspace_id,name,private,created_by) values($1,$2,$3,$4) returning *',
        [workspace, name, privateChannel, user],
      )
    ).rows[0];
    if (privateChannel) {
      await tx.query(
        'insert into conversation_members select $1,wm.participant_id from workspace_members wm join participants p on p.id=wm.participant_id where wm.workspace_id=$2 and wm.enabled and wm.participant_id=$3',
        [channel.id, workspace, user],
      );
    } else
      await tx.query(
        'insert into conversation_members select $1,participant_id from workspace_members where workspace_id=$2 and enabled',
        [channel.id, workspace],
      );
    return channel;
  });
}
export async function invite(user: string, workspace: string) {
  return transaction(async (tx) => {
    await workspaceAccess(tx, user, workspace, true);
    const token = randomBytes(32).toString('hex');
    await tx.query(
      "insert into invitations(workspace_id,token_hash,expires_at) values($1,$2,now()+interval '7 days')",
      [workspace, hash(token)],
    );
    return { token, expiresInDays: 7 };
  });
}
export async function acceptInvite(user: string, token: string) {
  return transaction(async (tx) => {
    const invitation = (
      await tx.query('select * from invitations where token_hash=$1 for update', [hash(token)])
    ).rows[0];
    if (
      !invitation ||
      invitation.accepted_by ||
      invitation.revoked_at ||
      new Date(invitation.expires_at).getTime() <= Date.now()
    )
      throw new DomainError(400, 'Invitation is expired or already used');
    const existing = (
      await tx.query(
        'select enabled from workspace_members where workspace_id=$1 and participant_id=$2 for share',
        [invitation.workspace_id, user],
      )
    ).rows[0];
    if (existing && !existing.enabled)
      throw new DomainError(403, 'Your workspace membership is disabled');
    await tx.query(
      "insert into workspace_members(workspace_id,participant_id,role) values($1,$2,'member') on conflict do nothing",
      [invitation.workspace_id, user],
    );
    await tx.query(
      "insert into conversation_members select id,$2 from conversations where workspace_id=$1 and kind='channel' and not private on conflict do nothing",
      [invitation.workspace_id, user],
    );
    await tx.query('update invitations set accepted_by=$2 where id=$1', [invitation.id, user]);
    return { workspaceId: invitation.workspace_id };
  });
}
export async function changeMembership(
  user: string,
  conversation: string,
  participant: string,
  add: boolean,
) {
  return transaction(async (tx) => {
    const channel = await channelAccess(tx, user, conversation);
    if (channel.kind === 'dm')
      throw new DomainError(403, 'Direct message membership cannot be changed');
    const access = await workspaceAccess(tx, user, channel.workspace_id);
    if (access.role === 'member' && channel.created_by !== user)
      throw new DomainError(403, 'Channel management denied');
    await workspaceAccess(tx, participant, channel.workspace_id);
    const target = (
      await tx.query(
        'select role from workspace_members where workspace_id=$1 and participant_id=$2',
        [channel.workspace_id, participant],
      )
    ).rows[0];
    if (!add && target.role === 'owner')
      throw new DomainError(400, 'Workspace owner must retain channel access');
    if (add)
      await tx.query('insert into conversation_members values($1,$2) on conflict do nothing', [
        conversation,
        participant,
      ]);
    else
      await tx.query(
        'delete from conversation_members where conversation_id=$1 and participant_id=$2',
        [conversation, participant],
      );
    return { ok: true };
  });
}
export async function getMessage(tx: Tx, id: string): Promise<Message> {
  return (
    await tx.query(
      'select m.*,p.name author_name,p.kind author_kind from messages m join participants p on p.id=m.author_id where m.id=$1',
      [id],
    )
  ).rows[0];
}
export async function emit(tx: Tx, conversation: string, type: string, data: unknown) {
  const cursor = (
    await tx.query('update conversations set sequence=sequence+1 where id=$1 returning sequence', [
      conversation,
    ])
  ).rows[0].sequence;
  await tx.query('insert into events(conversation_id,sequence,type,data) values($1,$2,$3,$4)', [
    conversation,
    cursor,
    type,
    JSON.stringify(data),
  ]);
  // Durable event log doubles as the publication outbox. Stream delivery replays this log.
  return cursor;
}
export async function sendMessage(
  user: string,
  conversation: string,
  requestId: string,
  body: string,
) {
  return transaction(async (tx) => {
    await channelAccess(tx, user, conversation);
    const existing = (
      await tx.query(
        'select id,request_hash from messages where conversation_id=$1 and author_id=$2 and request_id=$3',
        [conversation, user, requestId],
      )
    ).rows[0];
    if (existing) {
      if (existing.request_hash !== hash(body))
        throw new DomainError(409, 'Request ID was already used for different content');
      return getMessage(tx, existing.id);
    }
    const row = (
      await tx.query(
        'insert into messages(conversation_id,author_id,request_id,request_hash,body) values($1,$2,$3,$4,$5) returning id',
        [conversation, user, requestId, hash(body), body],
      )
    ).rows[0];
    const message = await getMessage(tx, row.id);
    await emit(tx, conversation, 'message.upsert', message);
    return message;
  });
}
export async function mutateMessage(
  user: string,
  conversation: string,
  id: string,
  body: string | null,
  revision: number,
) {
  return transaction(async (tx) => {
    await channelAccess(tx, user, conversation);
    const message = await getMessage(tx, id);
    if (!message || message.conversation_id !== conversation)
      throw new DomainError(404, 'Message not found');
    if (message.author_id !== user)
      throw new DomainError(403, 'You may only change your own messages');
    if (message.revision !== revision || message.deleted_at)
      throw new DomainError(409, 'Message changed; refresh before editing');
    await tx.query(
      'update messages set body=$2,deleted_at=case when $3 then now() else null end,updated_at=now(),revision=revision+1 where id=$1',
      [id, body ?? '', body === null],
    );
    const changed = await getMessage(tx, id);
    await emit(tx, conversation, 'message.upsert', changed);
    const summaries = await tx.query(
      "update messages set stale=true,body=$3,citations='{}',revision=revision+1,updated_at=now() where conversation_id=$1 and $2=any(citations) and not stale returning id",
      [
        conversation,
        id,
        'Summary outdated because a source message changed. Generate a new summary.',
      ],
    );
    for (const summary of summaries.rows)
      await emit(tx, conversation, 'message.upsert', await getMessage(tx, summary.id));
    return changed;
  });
}
export async function snapshot(user: string, conversation: string, before?: string) {
  return transaction(async (tx) => {
    const channel = await channelAccess(tx, user, conversation);
    let boundary: Message | undefined;
    if (before) {
      boundary = await getMessage(tx, before);
      if (!boundary || boundary.conversation_id !== conversation)
        throw new DomainError(400, 'Invalid page boundary');
    }
    const messages = (
      await tx.query(
        'select m.*,p.name author_name,p.kind author_kind from messages m join participants p on p.id=m.author_id where m.conversation_id=$1 and ($2::timestamptz is null or (m.created_at,m.id)<($2::timestamptz,$3::uuid)) order by m.created_at desc,m.id desc limit 51',
        [conversation, boundary?.created_at ?? null, boundary?.id ?? null],
      )
    ).rows;
    const runs = (
      await tx.query(
        'select id,status,provider,error from agent_runs where conversation_id=$1 and requester_id=$2 order by created_at desc limit 10',
        [conversation, user],
      )
    ).rows;
    return {
      messages: messages.slice(0, 50).reverse(),
      hasMore: messages.length > 50,
      cursor: channel.sequence,
      runs,
    };
  });
}
export async function changes(
  user: string,
  conversation: string,
  after: string,
  deliver?: (result: {
    events: { sequence: string; type: string; data: unknown }[];
    cursor: string;
    hasMore: boolean;
  }) => Promise<void>,
) {
  return transaction(async (tx) => {
    const channel = await channelAccess(tx, user, conversation);
    if (BigInt(after) > BigInt(channel.sequence))
      throw new DomainError(409, 'Invalid cursor; fetch a fresh snapshot');
    // Logs are not pruned in milestone 1. Retention later will require an expired-cursor response.
    const events = (
      await tx.query(
        'select sequence,type,data from events where conversation_id=$1 and sequence>$2 order by sequence limit 100',
        [conversation, after],
      )
    ).rows;
    // Agent status is requester-specific. Preserve sequence continuity with redacted events.
    for (const event of events)
      if (event.type === 'run.updated') {
        const permitted = await tx.query(
          'select 1 from agent_runs where id=$1 and requester_id=$2',
          [event.data.id, user],
        );
        if (!permitted.rowCount) {
          event.type = 'noop';
          event.data = {};
        }
      }
    const result = {
      events,
      cursor: events.at(-1)?.sequence ?? after,
      hasMore: events.length === 100,
    };
    if (deliver) await deliver(result);
    return result;
  });
}
export async function startSummary(user: string, conversation: string, requestId: string) {
  return transaction(async (tx) => {
    const channel = await channelAccess(tx, user, conversation);
    if (channel.kind === 'dm')
      throw new DomainError(400, 'Assistants are not available in direct messages');
    const existing = (
      await tx.query(
        'select id,status,provider,error from agent_runs where conversation_id=$1 and requester_id=$2 and request_id=$3',
        [conversation, user, requestId],
      )
    ).rows[0];
    if (existing) return existing;
    const agent = (
      await tx.query(
        "select p.id from participants p join conversation_members cm on cm.participant_id=p.id where cm.conversation_id=$1 and p.kind='agent' order by p.id limit 1",
        [conversation],
      )
    ).rows[0];
    if (!agent) throw new DomainError(400, 'Assistant has no access to this channel');
    const config = (
      await tx.query('select * from workspace_llm where workspace_id=$1 for share', [
        channel.workspace_id,
      ])
    ).rows[0];
    if (!config || (config.provider !== 'test' && !config.key_ciphertext))
      throw new DomainError(400, 'Ask a workspace admin to configure the LLM key');
    const run = (
      await tx.query(
        'insert into agent_runs(conversation_id,requester_id,agent_id,request_id,provider,model,config_revision) values($1,$2,$3,$4,$5,$6,$7) returning id,status,provider,error',
        [conversation, user, agent.id, requestId, config.provider, config.model, config.revision],
      )
    ).rows[0];
    await enqueueSummary(tx, run.id);
    await emit(tx, conversation, 'run.updated', run);
    return run;
  });
}
export async function updateRun(
  tx: Tx,
  id: string,
  status: AgentRun['status'],
  error: string | null = null,
) {
  const run = (
    await tx.query('update agent_runs set status=$2,error=$3 where id=$1 returning *', [
      id,
      status,
      error,
    ])
  ).rows[0];
  await emit(tx, run.conversation_id, 'run.updated', { id, status, provider: run.provider, error });
  return run;
}
export async function prepareRun(id: string) {
  return transaction(async (tx) => {
    const run = (await tx.query('select * from agent_runs where id=$1', [id])).rows[0];
    if (!run || ['completed', 'cancelled'].includes(run.status)) return null;
    try {
      await channelAccess(tx, run.requester_id, run.conversation_id);
      await channelAccess(tx, run.agent_id, run.conversation_id);
    } catch (error) {
      if (!(error instanceof DomainError && error.status === 403)) throw error;
      await tx.query(
        "update agent_runs set status='cancelled',error='Channel access was revoked' where id=$1",
        [id],
      );
      return null;
    }
    if (
      ['completed', 'cancelled'].includes(
        (await tx.query('select status from agent_runs where id=$1', [id])).rows[0].status,
      )
    )
      return null;
    const config = (
      await tx.query(
        'select l.* from workspace_llm l join conversations c on c.workspace_id=l.workspace_id where c.id=$1 for share of l',
        [run.conversation_id],
      )
    ).rows[0];
    if (run.config_revision === null) {
      await tx.query('update agent_runs set config_revision=$2,provider=$3,model=$4 where id=$1', [
        id,
        config.revision,
        config.provider,
        config.model,
      ]);
      Object.assign(run, {
        config_revision: config.revision,
        provider: config.provider,
        model: config.model,
      });
    }
    if (config.revision !== run.config_revision) {
      await updateRun(tx, id, 'cancelled', 'Workspace model configuration changed');
      return null;
    }
    let apiKey: string | undefined;
    if (config.provider !== 'test') {
      if (!config.key_ciphertext) throw new Error('Workspace LLM key is missing');
      apiKey = openKey(config.key_ciphertext);
    }
    await updateRun(tx, id, 'running');
    const messages: Message[] = (
      await tx.query(
        "select m.*,p.name author_name,p.kind author_kind from messages m join participants p on p.id=m.author_id where m.conversation_id=$1 and m.deleted_at is null and p.kind='human' order by m.created_at desc,m.id desc limit 40",
        [run.conversation_id],
      )
    ).rows.reverse();
    const bounded: Message[] = [];
    let size = 0;
    for (const message of messages.reverse()) {
      if (size + message.body.length > 24000) break;
      bounded.unshift(message);
      size += message.body.length;
    }
    return {
      run,
      messages: bounded,
      configuration: { provider: config.provider as string, model: config.model as string, apiKey },
    };
  });
}
export async function completeRun(
  id: string,
  sources: Message[],
  output: { body: string; citations: string[] },
) {
  return transaction(async (tx) => {
    const run = (await tx.query('select * from agent_runs where id=$1', [id])).rows[0];
    if (!run || ['completed', 'cancelled'].includes(run.status)) return;
    try {
      await channelAccess(tx, run.requester_id, run.conversation_id);
      await channelAccess(tx, run.agent_id, run.conversation_id);
    } catch (error) {
      if (!(error instanceof DomainError && error.status === 403)) throw error;
      await tx.query(
        "update agent_runs set status='cancelled',error='Channel access was revoked' where id=$1",
        [id],
      );
      return;
    }
    if (
      ['completed', 'cancelled'].includes(
        (await tx.query('select status from agent_runs where id=$1', [id])).rows[0].status,
      )
    )
      return;
    const config = (
      await tx.query(
        'select l.revision from workspace_llm l join conversations c on c.workspace_id=l.workspace_id where c.id=$1 for share of l',
        [run.conversation_id],
      )
    ).rows[0];
    if (config.revision !== run.config_revision) {
      await updateRun(tx, id, 'cancelled', 'Workspace model configuration changed');
      return;
    }
    const sourceIds = new Set(sources.map((m) => m.id));
    if (output.citations.some((c) => !sourceIds.has(c)))
      throw new Error('Model cited an unknown source');
    for (const source of sources) {
      const current = await getMessage(tx, source.id);
      if (!current || current.deleted_at || current.revision !== source.revision)
        throw new Error('Source messages changed during generation');
    }
    const row = (
      await tx.query(
        'insert into messages(conversation_id,author_id,request_id,request_hash,body,citations,agent_run_id) values($1,$2,$3,$4,$5,$6,$7) on conflict(agent_run_id) do nothing returning id',
        [
          run.conversation_id,
          run.agent_id,
          randomUUID(),
          hash(output.body),
          output.body,
          [...new Set(output.citations)],
          id,
        ],
      )
    ).rows[0];
    if (row) await emit(tx, run.conversation_id, 'message.upsert', await getMessage(tx, row.id));
    await updateRun(tx, id, 'completed');
  });
}
