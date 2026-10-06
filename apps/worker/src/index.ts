import {
  boss,
  pool,
  startQueue,
  transaction,
  SUMMARY_QUEUE,
} from '../../../packages/db/src/index.js';
import {
  prepareRun,
  completeRun,
  channelAccess,
  updateRun,
  DomainError,
  maintainAgentRuns,
} from '../../../packages/domain/src/index.js';
import { beginUsage, reportUsage } from '../../../packages/domain/src/administration.js';
import { executeAgent } from './provider.js';
await startQueue();
await maintainAgentRuns();
const maintenance = setInterval(
  () => void maintainAgentRuns().catch(() => console.error('Agent maintenance failed')),
  60000,
);
await boss.work<{ runId: string }>(SUMMARY_QUEUE, { pollingIntervalSeconds: 1 }, async (jobs) => {
  for (const job of jobs) {
    try {
      const context = await prepareRun(job.data.runId);
      if (!context) continue;
      if (!context.messages.length) throw new Error('Send a message before asking for a summary');
      const attempt = await beginUsage(job.data.runId);
      let output;
      try {
        output = await executeAgent(
          context.messages,
          context.configuration,
          context.agent,
          (tokens) => reportUsage(attempt, tokens),
        );
      } finally {
        await reportUsage(attempt);
      }
      await completeRun(job.data.runId, context.messages, output);
    } catch (error) {
      await transaction(async (tx) => {
        const run = (await tx.query('select * from agent_runs where id=$1', [job.data.runId]))
          .rows[0];
        if (!run || ['completed', 'cancelled'].includes(run.status)) return;
        try {
          await channelAccess(tx, run.requester_id, run.conversation_id);
          await updateRun(
            tx,
            run.id,
            'failed',
            error instanceof Error ? error.message : 'Summary failed',
          );
        } catch (accessError) {
          if (!(accessError instanceof DomainError && accessError.status === 403))
            throw accessError;
          await updateRun(tx, run.id, 'cancelled', 'Conversation access was revoked');
        }
      });
      throw error;
    }
  }
});
console.log('Neoms agent worker ready');
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    clearInterval(maintenance);
    await boss.stop();
    await pool.end();
    process.exit(0);
  });
