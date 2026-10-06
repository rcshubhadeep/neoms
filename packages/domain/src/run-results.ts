import { randomUUID, createHash } from 'node:crypto';
import { RunLimits, SummaryOutput, type AgentRun } from '../../contracts/src/index.js';
import { transaction, type Tx } from '../../db/src/index.js';
import { DomainError, channelAccess, summaryAccess, getMessage, emit, updateRun } from './index.js';
import { resolvedPolicy } from './run-policy.js';

export async function purgeExpiredResults(tx: Tx, conversation?: string) {
  await tx.query(
    "update agent_results ar set body='',citations='{}',stale=true from agent_runs r where r.id=ar.run_id and ($1::uuid is null or r.conversation_id=$1) and ar.expires_at<=now() and ar.body<>''",
    [conversation ?? null],
  );
}

export async function validSources(
  tx: Tx,
  run: { conversation_id: string; source_refs: { id: string; revision: number }[] },
) {
  if (!run.source_refs.length) return false;
  for (const source of run.source_refs) {
    const current = await getMessage(tx, source.id);
    if (
      !current ||
      current.conversation_id !== run.conversation_id ||
      current.deleted_at ||
      current.revision !== source.revision
    )
      return false;
  }
  return true;
}

export async function runView(tx: Tx, user: string, runId: string): Promise<AgentRun> {
  const run = (
    await tx.query('select * from agent_runs where id=$1 and requester_id=$2', [runId, user])
  ).rows[0];
  if (!run) throw new DomainError(404, 'Run not found');
  await channelAccess(tx, user, run.conversation_id);
  const view: AgentRun = {
    id: run.id,
    status: run.status,
    provider: run.provider,
    error: run.error,
    agent_id: run.agent_id,
    agent_version: run.agent_version,
    result: null,
  };
  try {
    await summaryAccess(tx, run);
  } catch (error) {
    if (!(error instanceof DomainError && error.status === 403)) throw error;
    return { ...view, error: 'Agent access was revoked' };
  }
  if (run.coverage) view.coverage = run.coverage;
  const result = (
    await tx.query('select *,expires_at<=now() expired from agent_results where run_id=$1', [runId])
  ).rows[0];
  if (!result) return view;
  const stale = result.stale || result.expired || !(await validSources(tx, run));
  view.result = {
    body: stale
      ? result.expired
        ? 'Private result expired. Run the agent again.'
        : 'Result outdated because a source changed. Run the agent again.'
      : result.body,
    citations: stale ? [] : result.citations,
    stale,
    expires_at: result.expires_at.toISOString(),
    shared_message_id: result.shared_message_id,
    shared_by: result.shared_by,
  };
  return view;
}

export async function readRun(user: string, conversation: string, runId: string) {
  return transaction(async (tx) => {
    await channelAccess(tx, user, conversation);
    const row = await tx.query(
      'select 1 from agent_runs where id=$1 and conversation_id=$2 and requester_id=$3',
      [runId, conversation, user],
    );
    if (!row.rowCount) throw new DomainError(404, 'Run not found');
    await purgeExpiredResults(tx, conversation);
    return runView(tx, user, runId);
  });
}

export async function shareRun(user: string, conversation: string, runId: string) {
  return transaction(async (tx) => {
    const channel = await channelAccess(tx, user, conversation);
    const run = (
      await tx.query(
        'select * from agent_runs where id=$1 and conversation_id=$2 and requester_id=$3',
        [runId, conversation, user],
      )
    ).rows[0];
    if (!run) throw new DomainError(404, 'Run not found');
    await summaryAccess(tx, run);
    const policy = await resolvedPolicy(
      tx,
      channel.workspace_id,
      run.agent_id,
      conversation,
      run.scope?.requestedLimits,
    );
    const result = (
      await tx.query(
        'select *,expires_at<=now() expired from agent_results where run_id=$1 for update',
        [runId],
      )
    ).rows[0];
    if (!result || run.status !== 'completed')
      throw new DomainError(409, 'No completed result to share');
    if (!policy.allowSharing || !run.resolved_policy.allowSharing)
      throw new DomainError(403, 'Sharing is disabled by agent policy');
    if (result.stale || result.expired || !(await validSources(tx, run)))
      throw new DomainError(409, 'Result expired or its sources changed. Run the agent again.');
    if (JSON.stringify(policy) !== JSON.stringify(RunLimits.parse(run.resolved_policy)))
      throw new DomainError(409, 'Agent policy changed. Run the agent again.');
    if (result.shared_message_id) return getMessage(tx, result.shared_message_id);
    const author = (await tx.query('select name from participants where id=$1', [user])).rows[0]
      .name;
    const output = SummaryOutput.parse(result);
    const coverage = run.coverage;
    const body = `${output.body}\n\nShared by ${author}. Covered ${coverage.selectedMessages} of ${coverage.totalMessages} messages (${coverage.from} to ${coverage.to}).`;
    const row = (
      await tx.query(
        'insert into messages(conversation_id,author_id,request_id,request_hash,body,citations,agent_run_id) values($1,$2,$3,$4,$5,$6,$7) returning id',
        [
          conversation,
          run.agent_id,
          randomUUID(),
          createHash('sha256').update(body).digest('hex'),
          body,
          output.citations,
          runId,
        ],
      )
    ).rows[0];
    await tx.query('update agent_results set shared_message_id=$2,shared_by=$3 where run_id=$1', [
      runId,
      row.id,
      user,
    ]);
    const message = await getMessage(tx, row.id);
    await emit(tx, conversation, 'message.upsert', message);
    await updateRun(tx, runId, 'completed');
    return message;
  });
}

export async function invalidateResults(tx: Tx, conversation: string, source: string) {
  const results = (
    await tx.query(
      `update agent_results ar set stale=true,body='Result outdated because a source changed. Run the agent again.',citations='{}'
     from agent_runs r where ar.run_id=r.id and r.conversation_id=$1 and not ar.stale
     and exists(select 1 from jsonb_array_elements(r.source_refs) s where s->>'id'=$2)
     returning ar.run_id,ar.shared_message_id`,
      [conversation, source],
    )
  ).rows;
  for (const result of results) {
    if (result.shared_message_id) {
      const updated = await tx.query(
        "update messages set stale=true,body='Result outdated because a source changed. Run the agent again.',citations='{}',revision=revision+1,updated_at=now() where id=$1 and not stale returning id",
        [result.shared_message_id],
      );
      if (updated.rowCount)
        await emit(
          tx,
          conversation,
          'message.upsert',
          await getMessage(tx, result.shared_message_id),
        );
    }
    await updateRun(tx, result.run_id, 'completed');
  }
}
