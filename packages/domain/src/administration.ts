import { randomUUID } from 'node:crypto';
import { pool, transaction, type Tx } from '../../db/src/index.js';
import { DomainError, workspaceAccess, updateRun } from './index.js';
import { sealKey } from './secrets.js';
import { LlmInput, MemberInput, type Conversation } from '../../contracts/src/index.js';
import type { z } from 'zod';

export async function directMessage(user: string, workspace: string, target: string) {
  user = user.toLowerCase();
  workspace = workspace.toLowerCase();
  target = target.toLowerCase();
  if (user === target) throw new DomainError(400, 'Choose another workspace member');
  return transaction(async (tx) => {
    await workspaceAccess(tx, user, workspace);
    await workspaceAccess(tx, target, workspace);
    const humans = await tx.query(
      "select id from participants where id=any($1::uuid[]) and kind='human'",
      [[user, target]],
    );
    if (humans.rowCount !== 2) throw new DomainError(400, 'Direct messages require two people');
    const pair = [user, target].sort().join(':');
    await tx.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
      `${workspace}:dm:${pair}`,
    ]);
    const existing = (
      await tx.query<Conversation>(
        'select * from conversations where workspace_id=$1 and dm_pair=$2',
        [workspace, pair],
      )
    ).rows[0];
    if (existing) return existing;
    const row = (
      await tx.query<Conversation>(
        "insert into conversations(workspace_id,name,private,kind,created_by,dm_pair) values($1,$2,true,'dm',$3,$4) returning *",
        [workspace, `dm-${randomUUID()}`, user, pair],
      )
    ).rows[0];
    await tx.query('insert into conversation_members values($1,$2),($1,$3)', [
      row.id,
      user,
      target,
    ]);
    return row;
  });
}
export async function updateMember(
  user: string,
  workspace: string,
  target: string,
  input: z.infer<typeof MemberInput>,
) {
  return transaction(async (tx) => {
    // Channel locks precede membership locks, matching messaging/SSE authorization.
    await tx.query('select id from conversations where workspace_id=$1 order by id for update', [
      workspace,
    ]);
    const actor = await workspaceAccess(tx, user, workspace, true);
    const member = (
      await tx.query(
        'select wm.*,p.kind from workspace_members wm join participants p on p.id=wm.participant_id where wm.workspace_id=$1 and wm.participant_id=$2 for update of wm',
        [workspace, target],
      )
    ).rows[0];
    if (!member || member.kind !== 'human') throw new DomainError(404, 'Member not found');
    if (member.role === 'owner' || user === target)
      throw new DomainError(403, 'The owner and your own membership cannot be changed here');
    if (actor.role !== 'owner' && (member.role === 'admin' || input.role !== undefined))
      throw new DomainError(403, 'Only the owner can manage admin roles');
    await tx.query(
      'update workspace_members set enabled=coalesce($3,enabled),role=coalesce($4,role) where workspace_id=$1 and participant_id=$2',
      [workspace, target, input.enabled ?? null, input.role ?? null],
    );
    if (input.enabled === false) {
      const runs = (
        await tx.query(
          "select r.id from agent_runs r join conversations c on c.id=r.conversation_id where c.workspace_id=$1 and r.requester_id=$2 and r.status in ('queued','running','failed')",
          [workspace, target],
        )
      ).rows;
      for (const run of runs)
        await updateRun(tx, run.id, 'cancelled', 'Workspace membership disabled');
    }
    return { ok: true };
  });
}
export async function invitations(user: string, workspace: string) {
  return transaction(async (tx) => {
    await workspaceAccess(tx, user, workspace, true);
    return (
      await tx.query(
        'select id,expires_at,accepted_by,revoked_at,created_at from invitations where workspace_id=$1 order by created_at desc',
        [workspace],
      )
    ).rows;
  });
}
export async function revokeInvitation(user: string, workspace: string, invitation: string) {
  return transaction(async (tx) => {
    await workspaceAccess(tx, user, workspace, true);
    const result = await tx.query(
      'update invitations set revoked_at=coalesce(revoked_at,now()) where id=$1 and workspace_id=$2 returning id',
      [invitation, workspace],
    );
    if (!result.rowCount) throw new DomainError(404, 'Invitation not found');
    return { ok: true };
  });
}
async function llmMetadata(tx: Tx, workspace: string) {
  const row = (
    await tx.query(
      'select provider,model,(key_ciphertext is not null) as "hasKey",revision,updated_at from workspace_llm where workspace_id=$1',
      [workspace],
    )
  ).rows[0];
  return row;
}
export async function llmSettings(user: string, workspace: string) {
  return transaction(async (tx) => {
    await workspaceAccess(tx, user, workspace, true);
    return llmMetadata(tx, workspace);
  });
}
export async function setLlmSettings(
  user: string,
  workspace: string,
  input: z.infer<typeof LlmInput>,
) {
  return transaction(async (tx) => {
    await workspaceAccess(tx, user, workspace, true);
    const existing = (
      await tx.query('select * from workspace_llm where workspace_id=$1 for update', [workspace])
    ).rows[0];
    let key = existing.key_ciphertext;
    if (input.removeKey) key = null;
    if (input.apiKey) {
      try {
        key = sealKey(input.apiKey);
      } catch {
        throw new DomainError(
          503,
          'The installation operator must configure LLM_ENCRYPTION_KEY on the API and worker',
        );
      }
    }
    if (input.provider === 'anthropic' && !key && !input.removeKey)
      throw new DomainError(400, 'Set an API key for Anthropic');
    await tx.query(
      'update workspace_llm set provider=$2,model=$3,key_ciphertext=$4,revision=revision+1,updated_at=now(),updated_by=$5 where workspace_id=$1',
      [workspace, input.provider, input.model, key, user],
    );
    return llmMetadata(tx, workspace);
  });
}
export async function usage(user: string, workspace: string) {
  return transaction(async (tx) => {
    await workspaceAccess(tx, user, workspace, true);
    const members = (
      await tx.query(
        `select p.id,p.name,wm.enabled,count(u.id)::text attempts,
      count(u.id) filter(where u.status<>'reported')::text unknown_attempts,
      coalesce(sum(u.input_tokens),0)::text input_tokens,coalesce(sum(u.output_tokens),0)::text output_tokens,
      coalesce(sum(u.cache_read_tokens),0)::text cache_read_tokens,coalesce(sum(u.cache_write_tokens),0)::text cache_write_tokens
      from workspace_members wm join participants p on p.id=wm.participant_id
      left join llm_usage u on u.participant_id=p.id and u.workspace_id=wm.workspace_id and u.provider<>'test'
      where wm.workspace_id=$1 and p.kind='human' group by p.id,wm.enabled order by p.name`,
        [workspace],
      )
    ).rows;
    const models = (
      await tx.query(
        `select provider,model,count(*)::text attempts,coalesce(sum(input_tokens),0)::text input_tokens,coalesce(sum(output_tokens),0)::text output_tokens from llm_usage where workspace_id=$1 and provider<>'test' group by provider,model order by provider,model`,
        [workspace],
      )
    ).rows;
    return { members, models };
  });
}
export async function beginUsage(runId: string) {
  return (
    await pool.query(
      `insert into llm_usage(run_id,workspace_id,participant_id,provider,model)
    select r.id,c.workspace_id,r.requester_id,r.provider,r.model from agent_runs r join conversations c on c.id=r.conversation_id where r.id=$1 returning id`,
      [runId],
    )
  ).rows[0].id as string;
}
export type Tokens = {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
};
export async function reportUsage(id: string, tokens?: Tokens) {
  await pool.query(
    "update llm_usage set status=$2,input_tokens=$3,output_tokens=$4,cache_read_tokens=$5,cache_write_tokens=$6 where id=$1 and status='started'",
    [
      id,
      tokens ? 'reported' : 'unknown',
      tokens?.input_tokens ?? null,
      tokens?.output_tokens ?? null,
      tokens?.cache_read_tokens ?? null,
      tokens?.cache_write_tokens ?? null,
    ],
  );
}
