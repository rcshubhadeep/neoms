import { createHash, randomBytes } from 'node:crypto';
import { pool, transaction, enqueueSummary, SUMMARY_QUEUE, type Tx } from '../../db/src/index.js';
import { openKey } from './secrets.js';
import {
  RunLimits,
  SummaryOutput,
  type Message,
  type AgentRun,
  type Role,
  type RunRequest,
} from '../../contracts/src/index.js';
import { availableAgents, createBuiltInAgents, pinnedAgentVersion } from './agents.js';
import { selectRunScope } from './run-scope.js';
import { reserveBudget, resolvedPolicy, settleBudget } from './run-policy.js';
import { invalidateResults, purgeExpiredResults, runView, validSources } from './run-results.js';
import {
  claimAttempt,
  ownedAttempt,
  step,
  finishAttempt,
  recoverExecutions,
} from './run-execution.js';

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
    await tx.query('insert into workspace_agent_policy(workspace_id) values($1)', [workspace.id]);
    const agents = await createBuiltInAgents(tx, workspace.id);
    const conversation = (
      await tx.query(
        "insert into conversations(workspace_id,name,created_by) values($1,'general',$2) returning *",
        [workspace.id, user],
      )
    ).rows[0];
    for (const participant of [user, ...agents])
      await tx.query('insert into conversation_members values($1,$2)', [
        conversation.id,
        participant,
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
        "insert into conversation_members select $1,wm.participant_id from workspace_members wm join participants p on p.id=wm.participant_id where wm.workspace_id=$2 and wm.enabled and p.kind='human'",
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
    const affected = (
      await tx.query(
        'select id,status,error from agent_runs where conversation_id=$1 and agent_id=$2',
        [conversation, participant],
      )
    ).rows;
    for (const run of affected) await updateRun(tx, run.id, run.status, run.error);
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
    await invalidateResults(tx, conversation, id);
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
    await purgeExpiredResults(tx, conversation);
    const runRows = (
      await tx.query(
        `select id,status,provider,error,agent_id,agent_version from agent_runs where conversation_id=$1 and requester_id=$2
         and (status in ('queued','running','retrying','cancelling') or id in
           (select id from agent_runs where conversation_id=$1 and requester_id=$2 order by created_at desc limit 10))
         order by created_at desc`,
        [conversation, user],
      )
    ).rows;
    const runs: AgentRun[] = [];
    for (const run of runRows) runs.push(await runView(tx, user, run.id));
    const readSequence =
      (
        await tx.query(
          'select sequence::text from conversation_reads where conversation_id=$1 and participant_id=$2',
          [conversation, user],
        )
      ).rows[0]?.sequence ?? '0';
    return {
      messages: messages.slice(0, 50).reverse(),
      hasMore: messages.length > 50,
      cursor: channel.sequence,
      runs,
      readSequence,
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
        } else event.data = await runView(tx, user, event.data.id);
      } else if (event.type === 'message.upsert' && event.data.author_kind === 'agent') {
        event.data = await getMessage(tx, event.data.id);
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
export async function conversationAgents(user: string, conversation: string) {
  return transaction(async (tx) => {
    const channel = await channelAccess(tx, user, conversation);
    return availableAgents(tx, channel.workspace_id, conversation, channel.kind === 'dm');
  });
}
export async function startSummary(
  user: string,
  conversation: string,
  requestId: string,
  agentId?: string,
  options: Partial<Pick<RunRequest, 'scope' | 'limits' | 'allowPartial' | 'selectionHash'>> = {},
) {
  return transaction(async (tx) => {
    const channel = await channelAccess(tx, user, conversation);
    const requestHash = hash(
      JSON.stringify({
        agentId: agentId ?? null,
        scope: options.scope ?? null,
        limits: options.limits ?? null,
        allowPartial: options.allowPartial ?? false,
        selectionHash: options.selectionHash ?? null,
      }),
    );
    const existing = (
      await tx.query(
        `select r.id,r.status,r.provider,r.error,r.agent_id,r.agent_version,r.request_hash,d.key
         from agent_runs r join agent_definitions d on d.agent_id=r.agent_id
         where r.conversation_id=$1 and r.requester_id=$2 and r.request_id=$3`,
        [conversation, user, requestId],
      )
    ).rows[0];
    if (existing) {
      if (agentId ? existing.agent_id !== agentId : existing.key !== 'scribe')
        throw new DomainError(409, 'Request ID was already used for another agent');
      if (existing.request_hash && existing.request_hash !== requestHash)
        throw new DomainError(409, 'Request ID was already used for another scope');
      return runView(tx, user, existing.id);
    }
    const agents = await availableAgents(
      tx,
      channel.workspace_id,
      conversation,
      channel.kind === 'dm',
    );
    const agent = agents.find((entry) =>
      agentId ? entry.agent_id === agentId : entry.key === 'scribe',
    );
    if (!agent) throw new DomainError(403, 'Agent has no access to this conversation');
    const config = (
      await tx.query('select * from workspace_llm where workspace_id=$1 for share', [
        channel.workspace_id,
      ])
    ).rows[0];
    if (!config || (config.provider !== 'test' && !config.key_ciphertext))
      throw new DomainError(400, 'Ask a workspace admin to configure the LLM key');
    const selection = await selectRunScope(tx, user, channel, agent, options);
    if (options.selectionHash && options.selectionHash !== selection.selectionHash)
      throw new DomainError(409, 'Scope or policy changed. Preview the run again.');
    if (selection.coverage.omittedMessages && !options.allowPartial)
      throw new DomainError(
        409,
        `${selection.coverage.selectedMessages} of ${selection.coverage.totalMessages} messages fit the policy. Preview and confirm the bounded run.`,
      );
    const reservation =
      config.provider === 'test'
        ? 0
        : (selection.coverage.estimatedInputTokens + selection.policy.maxOutputTokens) *
          selection.policy.maxAttempts;
    await reserveBudget(tx, channel.workspace_id, user, selection.policy, reservation);
    const run = (
      await tx.query(
        `insert into agent_runs(conversation_id,requester_id,agent_id,request_id,provider,model,config_revision,agent_version,request_hash,scope,resolved_policy,source_refs,coverage,budget_tokens,deadline_at)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now()+interval '10 minutes') returning id,status,provider,error,agent_id,agent_version`,
        [
          conversation,
          user,
          agent.agent_id,
          requestId,
          config.provider,
          config.model,
          config.revision,
          agent.version,
          requestHash,
          JSON.stringify({ ...selection.scope, requestedLimits: options.limits ?? {} }),
          JSON.stringify(selection.policy),
          JSON.stringify(selection.refs),
          JSON.stringify(selection.coverage),
          reservation,
        ],
      )
    ).rows[0];
    await enqueueSummary(tx, run.id);
    await tx.query('update agent_runs set queue_name=$2 where id=$1', [run.id, SUMMARY_QUEUE]);
    await emit(tx, conversation, 'run.updated', run);
    return runView(tx, user, run.id);
  });
}
export async function previewRun(user: string, conversation: string, input: RunRequest) {
  return transaction(async (tx) => {
    const channel = await channelAccess(tx, user, conversation);
    const agents = await availableAgents(
      tx,
      channel.workspace_id,
      conversation,
      channel.kind === 'dm',
    );
    const agent = agents.find((entry) =>
      input.agentId ? entry.agent_id === input.agentId : entry.key === 'scribe',
    );
    if (!agent) throw new DomainError(403, 'Agent has no access to this conversation');
    const preview = await selectRunScope(tx, user, channel, agent, input);
    return {
      agentId: preview.agentId,
      scope: preview.scope,
      policy: preview.policy,
      coverage: preview.coverage,
      selectionHash: preview.selectionHash,
    };
  });
}
export async function summaryAccess(
  tx: Tx,
  run: { requester_id: string; agent_id: string; conversation_id: string },
) {
  const conversation = await channelAccess(tx, run.requester_id, run.conversation_id);
  const definitions = await tx.query(
    "select 1 from agent_definitions where agent_id=$1 and workspace_id=$2 and enabled and origin='built_in' and owner_id is null",
    [run.agent_id, conversation.workspace_id],
  );
  if (!definitions.rowCount) throw new DomainError(403, 'Agent access denied');
  if (conversation.kind !== 'dm') {
    await channelAccess(tx, run.agent_id, run.conversation_id);
    return;
  }
  // A participant requests a bounded summary; the assistant does not become a DM member.
  await workspaceAccess(tx, run.agent_id, conversation.workspace_id);
  const agent = await tx.query(
    "select 1 from agent_definitions where agent_id=$1 and origin='built_in' and key='scribe'",
    [run.agent_id],
  );
  if (!agent.rowCount) throw new DomainError(403, 'Assistant access denied');
}
export async function updateRun(
  tx: Tx,
  id: string,
  status: AgentRun['status'],
  error: string | null = null,
) {
  const initial = (await tx.query('select conversation_id from agent_runs where id=$1', [id]))
    .rows[0];
  if (!initial) throw new DomainError(404, 'Run not found');
  await tx.query('select id from conversations where id=$1 for update', [initial.conversation_id]);
  const previous = (await tx.query('select * from agent_runs where id=$1 for update', [id]))
    .rows[0];
  const transitions: Record<string, string[]> = {
    queued: ['running', 'cancelled', 'failed'],
    running: ['retrying', 'cancelling', 'completed', 'failed', 'cancelled'],
    retrying: ['running', 'cancelling', 'cancelled', 'failed'],
    cancelling: ['cancelled'],
    completed: [],
    failed: [],
    cancelled: [],
  };
  if (previous.status !== status && !transitions[previous.status]?.includes(status))
    throw new DomainError(409, 'Illegal run transition');
  if (['completed', 'failed', 'cancelled'].includes(status) && previous.active_attempt_id)
    await finishAttempt(
      tx,
      id,
      previous.active_attempt_id,
      status === 'completed' ? 'completed' : status,
      error,
    );
  const run = (
    await tx.query(
      "update agent_runs set status=$2,error=$3,finished_at=case when $2 in ('completed','failed','cancelled') then coalesce(finished_at,now()) else null end where id=$1 returning *",
      [id, status, error],
    )
  ).rows[0];
  await emit(tx, run.conversation_id, 'run.updated', {
    id,
    status,
    provider: run.provider,
    error,
    agent_id: run.agent_id,
    agent_version: run.agent_version,
  });
  await settleBudget(tx, id);
  return run;
}
export async function prepareRun(id: string) {
  return transaction(async (tx) => {
    const run = (await tx.query('select * from agent_runs where id=$1', [id])).rows[0];
    if (!run) return null;
    await tx.query('select id from conversations where id=$1 for update', [run.conversation_id]);
    Object.assign(
      run,
      (await tx.query('select * from agent_runs where id=$1 for update', [id])).rows[0],
    );
    if (['completed', 'failed', 'cancelled', 'cancelling'].includes(run.status)) return null;
    if (!run.resolved_policy || !run.coverage) {
      await updateRun(tx, id, 'cancelled', 'Legacy run requires a new scoped invocation');
      return null;
    }
    if (new Date(run.deadline_at).getTime() <= Date.now()) {
      await updateRun(tx, id, 'cancelled', 'Run deadline expired');
      return null;
    }
    try {
      await summaryAccess(tx, run);
    } catch (error) {
      if (!(error instanceof DomainError && error.status === 403)) throw error;
      await updateRun(tx, id, 'cancelled', 'Conversation or agent access was revoked');
      return null;
    }
    Object.assign(
      run,
      (await tx.query('select * from agent_runs where id=$1 for update', [id])).rows[0],
    );
    if (run.active_attempt_id) return null;
    if (
      ['completed', 'failed', 'cancelled', 'cancelling'].includes(
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
    const policy = RunLimits.parse(run.resolved_policy);
    if (run.attempts_started >= policy.maxAttempts) return null;
    const currentPolicy = await resolvedPolicy(
      tx,
      config.workspace_id,
      run.agent_id,
      run.conversation_id,
      run.scope.requestedLimits,
    );
    if (JSON.stringify(policy) !== JSON.stringify(currentPolicy)) {
      await updateRun(tx, id, 'cancelled', 'Agent policy changed');
      return null;
    }
    if (!(await validSources(tx, run))) {
      await updateRun(
        tx,
        id,
        'failed',
        'Source messages changed before generation. Start a new run.',
      );
      return null;
    }
    let apiKey: string | undefined;
    if (config.provider !== 'test') {
      try {
        if (!config.key_ciphertext) throw new Error('Key missing');
        apiKey = openKey(config.key_ciphertext);
      } catch {
        await updateRun(tx, id, 'failed', 'Workspace model credentials are unavailable');
        return null;
      }
    }
    await updateRun(tx, id, 'running');
    const messages: Message[] = [];
    for (const ref of run.source_refs) messages.push(await getMessage(tx, ref.id));
    const attempt = await claimAttempt(tx, run);
    if (!attempt) return null;
    return {
      run,
      attempt,
      agent: await pinnedAgentVersion(tx, run.agent_id, run.agent_version),
      messages: messages as Message[],
      configuration: {
        provider: config.provider as string,
        model: config.model as string,
        baseUrl: config.base_url as string | null,
        tokenLimitParameter: config.token_limit_parameter as 'max_tokens' | 'max_completion_tokens',
        apiKey,
        maxContextTokens: policy.maxContextTokens,
        maxOutputTokens: policy.maxOutputTokens,
      },
    };
  });
}
export async function completeRun(
  id: string,
  token: string,
  sources: Message[],
  output: { body: string; citations: string[] },
) {
  return transaction(async (tx) => {
    const initial = (await tx.query('select * from agent_runs where id=$1', [id])).rows[0];
    if (!initial) return;
    await tx.query('select id from conversations where id=$1 for update', [
      initial.conversation_id,
    ]);
    const run = (await tx.query('select * from agent_runs where id=$1 for update', [id])).rows[0];
    if (['completed', 'failed', 'cancelled'].includes(run.status)) return;
    await ownedAttempt(tx, id, token);
    if (run.cancellation_requested_at || run.status === 'cancelling') {
      await updateRun(tx, id, 'cancelled', run.error);
      return;
    }
    if (new Date(run.deadline_at).getTime() <= Date.now()) {
      await updateRun(tx, id, 'cancelled', 'Run deadline expired');
      return;
    }
    try {
      await summaryAccess(tx, run);
    } catch (error) {
      if (!(error instanceof DomainError && error.status === 403)) throw error;
      await updateRun(tx, id, 'cancelled', 'Conversation or agent access was revoked');
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
    const sourceIds = new Set(run.source_refs.map((source: { id: string }) => source.id));
    if (sources.length !== sourceIds.size || sources.some((source) => !sourceIds.has(source.id)))
      throw new Error('Source set does not match the scoped run');
    if (!(await validSources(tx, run)))
      throw new Error('Source messages changed during generation');
    output = SummaryOutput.parse(output);
    if (output.citations.some((c) => !sourceIds.has(c)))
      throw new Error('Model cited an unknown source');
    for (const source of sources) {
      const current = await getMessage(tx, source.id);
      if (!current || current.deleted_at || current.revision !== source.revision)
        throw new Error('Source messages changed during generation');
    }
    const channel = await channelAccess(tx, run.requester_id, run.conversation_id);
    const policy = await resolvedPolicy(
      tx,
      channel.workspace_id,
      run.agent_id,
      run.conversation_id,
      run.scope.requestedLimits,
    );
    if (JSON.stringify(policy) !== JSON.stringify(RunLimits.parse(run.resolved_policy))) {
      await updateRun(tx, id, 'cancelled', 'Agent policy changed');
      return;
    }
    await tx.query(
      "insert into agent_results(run_id,body,citations,expires_at) values($1,$2,$3,now()+($4 * interval '1 day')) on conflict(run_id) do nothing",
      [id, output.body, [...new Set(output.citations)], policy.retentionDays],
    );
    await step(tx, id, token, 'generation', 'completed');
    await step(tx, id, token, 'validation', 'completed');
    await step(tx, id, token, 'result', 'completed');
    await updateRun(tx, id, 'completed');
  });
}
export async function maintainAgentRuns() {
  // Purging holds result rows only; release them before taking conversation locks.
  await transaction((tx) => purgeExpiredResults(tx));
  await recoverExecutions();
}
