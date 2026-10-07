import { transaction, enqueueSummary, SUMMARY_QUEUE, type Tx } from '../../db/src/index.js';
import { DomainError, channelAccess, summaryAccess, updateRun } from './index.js';
import { resolvedPolicy } from './run-policy.js';
import { RunLimits } from '../../contracts/src/index.js';

export async function ownedAttempt(tx: Tx, runId: string, token: string) {
  const row = (
    await tx.query(
      `select a.* from run_attempts a join agent_runs r on r.active_attempt_id=a.id
    where r.id=$1 and a.id=$2 and a.status='running' and a.lease_expires_at>now()
    and r.status in ('running','cancelling') for update of a`,
      [runId, token],
    )
  ).rows[0];
  if (!row) throw new DomainError(409, 'Worker attempt is no longer active');
  return row;
}

export async function step(
  tx: Tx,
  runId: string,
  token: string | null,
  name: string,
  status: string,
  error: string | null = null,
) {
  await tx.query(
    `insert into run_steps(run_id,attempt_id,name,status,finished_at,error)
    values($1,$2,$3,$4,case when $4='running' then null else now() end,$5)
    on conflict(run_id,attempt_id,name) do update set status=excluded.status,finished_at=excluded.finished_at,error=excluded.error`,
    [runId, token, name, status, error],
  );
}

export async function finishAttempt(
  tx: Tx,
  runId: string,
  token: string,
  status: string,
  error: string | null = null,
) {
  await tx.query('update run_attempts set status=$2,error=$3,finished_at=now() where id=$1', [
    token,
    status,
    error,
  ]);
  await tx.query(
    `update run_steps set status=$3,error=$4,finished_at=now() where run_id=$1 and attempt_id=$2 and status='running'`,
    [runId, token, status === 'completed' ? 'completed' : status, error],
  );
  await tx.query('update agent_runs set active_attempt_id=null where id=$1', [runId]);
  await tx.query("update llm_usage set status='unknown' where attempt_id=$1 and status='started'", [
    token,
  ]);
}

export async function claimAttempt(
  tx: Tx,
  run: { id: string; execution_attempts: number; resolved_policy: { maxAttempts: number } },
) {
  if (run.execution_attempts >= run.resolved_policy.maxAttempts) {
    await updateRun(tx, run.id, 'failed', 'Maximum execution attempts reached');
    return null;
  }
  const attempt = (
    await tx.query(
      `insert into run_attempts(run_id,number,status,lease_expires_at)
    values($1,$2,'running',now()+interval '90 seconds') returning *`,
      [run.id, run.execution_attempts + 1],
    )
  ).rows[0];
  await tx.query(
    'update agent_runs set active_attempt_id=$2,execution_attempts=execution_attempts+1 where id=$1',
    [run.id, attempt.id],
  );
  await step(tx, run.id, attempt.id, 'context', 'completed');
  return attempt;
}

async function lockRun(tx: Tx, id: string) {
  const initial = (await tx.query('select * from agent_runs where id=$1', [id])).rows[0];
  if (!initial) throw new DomainError(404, 'Run not found');
  // Lock conversation first even when requester access has been revoked.
  await tx.query('select id from conversations where id=$1 for update', [initial.conversation_id]);
  return (await tx.query('select * from agent_runs where id=$1 for update', [id])).rows[0];
}

export async function requestCancellation(user: string, conversation: string, id: string) {
  return transaction(async (tx) => {
    await channelAccess(tx, user, conversation);
    const run = await lockRun(tx, id);
    if (run.conversation_id !== conversation || run.requester_id !== user)
      throw new DomainError(404, 'Run not found');
    if (['completed', 'cancelled', 'failed'].includes(run.status)) return { ok: true };
    await tx.query(
      'update agent_runs set cancellation_requested_at=coalesce(cancellation_requested_at,now()) where id=$1',
      [id],
    );
    await updateRun(tx, id, run.active_attempt_id ? 'cancelling' : 'cancelled');
    return { ok: true };
  });
}

export async function heartbeatAttempt(id: string, token: string) {
  return transaction(async (tx) => {
    const run = await lockRun(tx, id);
    await ownedAttempt(tx, id, token);
    let reason = run.cancellation_requested_at ? 'Cancellation requested' : null;
    if (new Date(run.deadline_at).getTime() <= Date.now()) reason = 'Run deadline expired';
    try {
      await summaryAccess(tx, run);
      const channel = await channelAccess(tx, run.requester_id, run.conversation_id);
      const policy = await resolvedPolicy(
        tx,
        channel.workspace_id,
        run.agent_id,
        run.conversation_id,
        run.scope.requestedLimits,
      );
      if (JSON.stringify(policy) !== JSON.stringify(RunLimits.parse(run.resolved_policy)))
        reason = 'Agent policy changed';
      const config = (
        await tx.query('select revision from workspace_llm where workspace_id=$1 for share', [
          channel.workspace_id,
        ])
      ).rows[0];
      if (config.revision !== run.config_revision) reason = 'Workspace model configuration changed';
    } catch (error) {
      if (!(error instanceof DomainError && error.status === 403)) throw error;
      reason = 'Conversation or agent access was revoked';
    }
    if (reason) {
      await tx.query(
        'update agent_runs set cancellation_requested_at=coalesce(cancellation_requested_at,now()) where id=$1',
        [id],
      );
      await updateRun(tx, id, 'cancelling', reason);
      return false;
    }
    await tx.query(
      "update run_attempts set lease_expires_at=least(now()+interval '90 seconds',$2::timestamptz) where id=$1",
      [token, run.deadline_at],
    );
    return true;
  });
}

export async function generatedAttempt(id: string, token: string) {
  await transaction(async (tx) => {
    const run = await lockRun(tx, id);
    await ownedAttempt(tx, id, token);
    if (run.cancellation_requested_at) throw new DomainError(409, 'Cancellation requested');
    await step(tx, id, token, 'generation', 'completed');
    await step(tx, id, token, 'validation', 'running');
    await updateRun(tx, id, 'running');
  });
}

export async function failAttempt(id: string, token: string | undefined, error: string) {
  await transaction(async (tx) => {
    const run = await lockRun(tx, id);
    if (['completed', 'failed', 'cancelled'].includes(run.status)) return;
    if (!token) {
      return; // An unowned callback cannot change a run, including a queued retry.
    }
    try {
      await ownedAttempt(tx, id, token);
    } catch (cause) {
      if (cause instanceof DomainError && cause.status === 409) return;
      throw cause;
    }
    const cancelled = !!run.cancellation_requested_at || run.status === 'cancelling';
    await finishAttempt(
      tx,
      id,
      token,
      cancelled ? 'cancelled' : 'failed',
      cancelled ? (run.error ?? 'Cancelled by requester') : error,
    );
    if (cancelled) await updateRun(tx, id, 'cancelled', run.error);
    else if (run.execution_attempts >= run.resolved_policy.maxAttempts)
      await updateRun(tx, id, 'failed', error);
    else {
      await updateRun(tx, id, 'retrying', error);
      await enqueueSummary(tx, id, `retry:${token}`, run.queue_name);
    }
  });
}

export async function recoverExecutions() {
  const ids = (
    await transaction((tx) =>
      tx.query(
        `select id from agent_runs where queue_name=$1 and
    (status in ('running','cancelling','retrying','queued')) order by created_at`,
        [SUMMARY_QUEUE],
      ),
    )
  ).rows;
  for (const { id } of ids)
    await transaction(async (tx) => {
      const run = await lockRun(tx, id);
      if (['completed', 'failed', 'cancelled'].includes(run.status)) return;
      const attempt = run.active_attempt_id
        ? (
            await tx.query(
              'select *,lease_expires_at<=now() expired from run_attempts where id=$1 for update',
              [run.active_attempt_id],
            )
          ).rows[0]
        : null;
      const deadline = new Date(run.deadline_at).getTime() <= Date.now();
      if (attempt && !attempt.expired && !deadline) return;
      if (attempt) await finishAttempt(tx, id, attempt.id, 'interrupted', 'Worker lease expired');
      if (run.cancellation_requested_at || deadline) {
        await updateRun(tx, id, 'cancelled', deadline ? 'Run deadline expired' : run.error);
        return;
      }
      if (!attempt) return; // Queued/retrying work already has a transactional job.
      if (run.execution_attempts >= run.resolved_policy.maxAttempts)
        await updateRun(tx, id, 'failed', 'Worker interrupted; maximum attempts reached');
      else {
        await updateRun(tx, id, 'retrying', 'Worker interrupted; retry queued');
        await enqueueSummary(tx, id, `recover:${attempt.id}`, run.queue_name);
      }
    });
}
