import {
  RunLimits,
  RunLimitOverrides,
  type RunPolicy,
  type PolicyInput,
} from '../../contracts/src/index.js';
import { transaction, type Tx } from '../../db/src/index.js';
import { DomainError, workspaceAccess, channelAccess } from './index.js';
import type { z } from 'zod';

export function tightenPolicy(base: RunPolicy, ...layers: unknown[]): RunPolicy {
  const result = { ...base };
  for (const raw of layers) {
    const layer = RunLimitOverrides.parse(raw ?? {});
    for (const key of Object.keys(layer) as (keyof RunPolicy)[]) {
      if (key === 'allowSharing')
        result.allowSharing = result.allowSharing && layer.allowSharing !== false;
      else if (layer[key] !== undefined) result[key] = Math.min(result[key], layer[key]);
    }
  }
  return RunLimits.parse(result);
}

export async function resolvedPolicy(
  tx: Tx,
  workspace: string,
  agent: string,
  conversation: string,
  requested: unknown = {},
) {
  const { rows } = await tx.query(
    `select w.limits,a.limits agent_limits,c.agent_limits conversation_limits
     from workspace_agent_policy w join agent_definitions a on a.workspace_id=w.workspace_id
     join conversations c on c.workspace_id=w.workspace_id
     where w.workspace_id=$1 and a.agent_id=$2 and c.id=$3 for update of w`,
    [workspace, agent, conversation],
  );
  if (!rows[0]) throw new DomainError(403, 'Agent policy is unavailable');
  return tightenPolicy(
    RunLimits.parse(rows[0].limits),
    rows[0].agent_limits,
    rows[0].conversation_limits,
    requested,
  );
}

export async function policySettings(user: string, workspace: string) {
  return transaction(async (tx) => {
    await workspaceAccess(tx, user, workspace, true);
    const limits = (
      await tx.query('select limits from workspace_agent_policy where workspace_id=$1', [workspace])
    ).rows[0].limits;
    const agents = (
      await tx.query(
        'select d.agent_id id,p.name,d.limits from agent_definitions d join participants p on p.id=d.agent_id where d.workspace_id=$1 order by p.name',
        [workspace],
      )
    ).rows;
    // Admin status does not expose private conversation names or their policy.
    const conversations = (
      await tx.query(
        `select c.id,c.name,c.agent_limits limits from conversations c
       join conversation_members cm on cm.conversation_id=c.id and cm.participant_id=$2
       where c.workspace_id=$1 and c.kind='channel' order by c.name`,
        [workspace, user],
      )
    ).rows;
    return { limits, agents, conversations };
  });
}

export async function setPolicy(
  user: string,
  workspace: string,
  input: z.infer<typeof PolicyInput>,
) {
  return transaction(async (tx) => {
    // Match conversation-first lock order for channel-scoped updates.
    if (input.layer === 'conversation') {
      const channel = await channelAccess(tx, user, input.targetId!);
      if (channel.workspace_id !== workspace || channel.kind !== 'channel')
        throw new DomainError(403, 'Policy target denied');
    }
    await workspaceAccess(tx, user, workspace, true);
    const base = RunLimits.parse(
      (
        await tx.query(
          'select limits from workspace_agent_policy where workspace_id=$1 for update',
          [workspace],
        )
      ).rows[0].limits,
    );
    if (input.layer === 'workspace') {
      await tx.query('update workspace_agent_policy set limits=$2 where workspace_id=$1', [
        workspace,
        RunLimits.parse({ ...base, ...input.limits }),
      ]);
    } else if (input.layer === 'agent') {
      const updated = await tx.query(
        'update agent_definitions set limits=$3 where workspace_id=$1 and agent_id=$2 returning agent_id',
        [workspace, input.targetId, input.limits],
      );
      if (!updated.rowCount) throw new DomainError(404, 'Agent not found');
    } else {
      await tx.query('update conversations set agent_limits=$3 where workspace_id=$1 and id=$2', [
        workspace,
        input.targetId,
        input.limits,
      ]);
    }
    return { ok: true };
  });
}

export async function reserveBudget(
  tx: Tx,
  workspace: string,
  user: string,
  policy: RunPolicy,
  amount: number,
) {
  // resolvedPolicy holds the workspace policy row: competing conversations cannot
  // both pass these sums before either reservation commits.
  const usage = (
    await tx.query(
      `select coalesce(sum(r.budget_tokens) filter(where r.created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'),0)::text monthly,
     coalesce(sum(r.budget_tokens) filter(where r.requester_id=$2 and r.created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),0)::text daily,
     count(*) filter(where r.status in ('queued','running') or (r.status='failed' and r.attempts_started<coalesce((r.resolved_policy->>'maxAttempts')::int,0)))::int active
     from agent_runs r join conversations c on c.id=r.conversation_id where c.workspace_id=$1`,
      [workspace, user],
    )
  ).rows[0];
  if (usage.active >= policy.maxConcurrentRuns)
    throw new DomainError(429, 'Workspace agent concurrency limit reached');
  if (
    Number(usage.monthly) + amount > policy.workspaceMonthlyTokens ||
    Number(usage.daily) + amount > policy.userDailyTokens
  )
    throw new DomainError(
      429,
      'Agent token budget exhausted; ask an admin or wait for the budget window to reset',
    );
}

export async function settleBudget(tx: Tx, runId: string) {
  const run = (await tx.query('select * from agent_runs where id=$1 for update', [runId])).rows[0];
  if (!run?.resolved_policy || run.provider === 'test') return;
  if (
    !['completed', 'cancelled'].includes(run.status) &&
    run.attempts_started < run.resolved_policy.maxAttempts
  )
    return;
  const perAttempt = run.coverage.estimatedInputTokens + run.resolved_policy.maxOutputTokens;
  const used = (
    await tx.query(
      `select coalesce(sum(case when status='reported' then
       input_tokens+output_tokens+case when provider='anthropic' then cache_read_tokens+cache_write_tokens else 0 end
       else $2 end),0)::text tokens from llm_usage where run_id=$1`,
      [runId, perAttempt],
    )
  ).rows[0].tokens;
  await tx.query('update agent_runs set budget_tokens=$2 where id=$1', [runId, used]);
}
