import { randomUUID } from 'node:crypto';
import { pool, transaction, type Tx } from '../../db/src/index.js';
import { DomainError, workspaceAccess, updateRun } from './index.js';
import { sealKey, openKey } from './secrets.js';
import { llmBaseUrl, llmHeaders } from './llm-connection.js';
import {
  LlmInput,
  ModelListInput,
  MemberInput,
  type Conversation,
  type ModelList,
} from '../../contracts/src/index.js';
import { z } from 'zod';

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
      'select provider,model,base_url as "baseUrl",token_limit_parameter as "tokenLimitParameter",(key_ciphertext is not null) as "hasKey",revision,updated_at from workspace_llm where workspace_id=$1',
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
  input = LlmInput.parse(input);
  const baseUrl = input.provider === 'openai-compatible' ? input.baseUrl! : null;
  return transaction(async (tx) => {
    await workspaceAccess(tx, user, workspace, true);
    if (input.provider !== 'test') allowedEndpoint(input.provider, baseUrl);
    const existing = (
      await tx.query('select * from workspace_llm where workspace_id=$1 for update', [workspace])
    ).rows[0];
    const changedConnection = existing.provider !== input.provider || existing.base_url !== baseUrl;
    let key = changedConnection ? null : existing.key_ciphertext;
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
    if (input.provider !== 'test' && !key && !input.removeKey)
      throw new DomainError(400, 'Set an API key for this provider and endpoint');
    await tx.query(
      'update workspace_llm set provider=$2,model=$3,key_ciphertext=$4,revision=revision+1,updated_at=now(),updated_by=$5,base_url=$6,token_limit_parameter=$7 where workspace_id=$1',
      [
        workspace,
        input.provider,
        input.model,
        key,
        user,
        baseUrl,
        input.tokenLimitParameter ?? existing.token_limit_parameter,
      ],
    );
    return llmMetadata(tx, workspace);
  });
}
export async function discoverModels(
  user: string,
  workspace: string,
  input: z.infer<typeof ModelListInput>,
): Promise<ModelList> {
  input = ModelListInput.parse(input);
  const connection = await transaction(async (tx) => {
    await workspaceAccess(tx, user, workspace, true);
    const existing = (
      await tx.query('select * from workspace_llm where workspace_id=$1', [workspace])
    ).rows[0];
    const baseUrl = input.provider === 'openai-compatible' ? input.baseUrl! : null;
    const sameConnection = existing.provider === input.provider && existing.base_url === baseUrl;
    const apiKey =
      input.apiKey ||
      (sameConnection && existing.key_ciphertext ? openKey(existing.key_ciphertext) : undefined);
    if (!apiKey)
      throw new DomainError(400, 'Enter an API key for this endpoint to load its models');
    return { baseUrl: allowedEndpoint(input.provider, baseUrl), apiKey };
  });
  const models = new Set<string>();
  const signal = AbortSignal.timeout(12000);
  let after: string | undefined;
  try {
    for (let page = 0; page < 10; page++) {
      const url = new URL(`${connection.baseUrl}/models`);
      if (input.provider === 'anthropic') {
        url.searchParams.set('limit', '100');
        if (after) url.searchParams.set('after_id', after);
      }
      const response = await fetch(url, {
        headers: llmHeaders(input.provider, connection.apiKey),
        signal,
        redirect: 'error',
      });
      if (!response.ok)
        throw new DomainError(
          502,
          `Model listing failed (${response.status}). Enter a model ID manually.`,
        );
      const result = z
        .object({
          data: z.array(z.object({ id: z.string().trim().min(1).max(160) })).max(10000),
          has_more: z.boolean().optional(),
          last_id: z.string().optional(),
        })
        .parse(await response.json());
      for (const row of result.data) {
        models.add(row.id);
        if (models.size >= 1000) return { models: [...models].sort(), truncated: true };
      }
      if (input.provider !== 'anthropic' || !result.has_more || !result.last_id)
        return { models: [...models].sort(), truncated: false };
      after = result.last_id;
    }
    return { models: [...models].sort(), truncated: true };
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError(502, 'Model listing is unavailable. Enter a model ID manually.');
  }
}
function allowedEndpoint(provider: string, baseUrl: string | null) {
  try {
    return llmBaseUrl(provider, baseUrl);
  } catch {
    throw new DomainError(400, 'This model endpoint is not allowed by the installation operator');
  }
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
