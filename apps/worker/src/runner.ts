import { boss, pool, startQueue, SUMMARY_QUEUE } from '../../../packages/db/src/index.js';
import { prepareRun, completeRun, maintainAgentRuns } from '../../../packages/domain/src/index.js';
import {
  failAttempt,
  heartbeatAttempt,
  generatedAttempt,
} from '../../../packages/domain/src/run-execution.js';
import { beginUsage, reportUsage } from '../../../packages/domain/src/administration.js';
import { executeAgent } from './provider.js';

await startQueue();
await maintainAgentRuns();
let maintaining = false;
const maintenance = setInterval(async () => {
  if (maintaining) return;
  maintaining = true;
  try {
    await maintainAgentRuns();
  } catch {
    console.error('Agent maintenance failed');
  } finally {
    maintaining = false;
  }
}, 5000);
const controllers = new Set<AbortController>();
await boss.work<{ runId: string }>(SUMMARY_QUEUE, { pollingIntervalSeconds: 1 }, async (jobs) => {
  for (const job of jobs) {
    let token: string | undefined;
    const abort = new AbortController();
    controllers.add(abort);
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let checking = false;
    try {
      const context = await prepareRun(job.data.runId);
      if (!context) continue;
      token = context.attempt.id;
      const check = async () => {
        if (checking || abort.signal.aborted) return;
        checking = true;
        try {
          if (!(await heartbeatAttempt(job.data.runId, token!))) abort.abort();
        } catch {
          abort.abort();
        } finally {
          checking = false;
        }
      };
      await check();
      if (abort.signal.aborted) throw new Error('Execution interrupted');
      heartbeat = setInterval(() => void check(), 2000);
      const usageId = await beginUsage(job.data.runId, token!);
      let output;
      try {
        output = await executeAgent(
          context.messages,
          { ...context.configuration, abortSignal: abort.signal },
          context.agent,
          (tokens) => reportUsage(usageId, tokens),
        );
      } finally {
        await reportUsage(usageId);
      }
      if (abort.signal.aborted) throw new Error('Execution interrupted');
      await generatedAttempt(job.data.runId, token!);
      await completeRun(job.data.runId, token!, context.messages, output);
    } catch (error) {
      if (!token) {
        // Queue diagnostics must not retain raw causes containing prompts or credentials.
        // eslint-disable-next-line preserve-caught-error
        throw new Error('Run context could not be prepared');
      }
      const message =
        error instanceof Error && /^(Model |Source |Execution interrupted)/.test(error.message)
          ? error.message
          : 'Agent execution failed';
      try {
        await failAttempt(job.data.runId, token, message);
      } catch {
        throw new Error('Run failure could not be persisted');
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      controllers.delete(abort);
    }
  }
});
console.log('Neoms agent worker ready');
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    clearInterval(maintenance);
    for (const controller of controllers) controller.abort();
    await boss.stop();
    await pool.end();
    process.exit(0);
  });
