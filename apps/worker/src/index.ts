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
} from '../../../packages/domain/src/index.js';
import { summarize } from './provider.js';
await startQueue();
await boss.work<{ runId: string }>(SUMMARY_QUEUE, { pollingIntervalSeconds: 1 }, async (jobs) => {
  for (const job of jobs) {
    try {
      const context = await prepareRun(job.data.runId);
      if (!context) continue;
      const output = await summarize(context.messages, context.run.provider);
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
        } catch {
          await tx.query(
            "update agent_runs set status='cancelled',error='Channel access was revoked' where id=$1",
            [run.id],
          );
        }
      });
      throw error;
    }
  }
});
console.log('Neoms summary worker ready');
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await boss.stop();
    await pool.end();
    process.exit(0);
  });
