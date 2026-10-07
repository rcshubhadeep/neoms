import { it, expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createClient } from '@supabase/supabase-js';
import { pool, boss, startQueue } from '../../packages/db/src/index.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(probe: () => Promise<T | undefined>, timeout = 12000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const result = await probe();
      if (result !== undefined) return result;
    } catch {
      /* Wait for the child service to become ready. */
    }
    await sleep(100);
  }
  throw new Error('Child service did not become ready');
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await Promise.race([
    exited,
    sleep(5000).then(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }),
  ]);
}
function launch(file: string, queue: string) {
  const child = spawn(process.execPath, ['--env-file=.env', '--import', 'tsx', file], {
    env: { ...process.env, PORT: '3002', SUMMARY_QUEUE: queue },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.resume();
  child.stderr?.resume();
  return child;
}
it('server restart preserves queued work and a killed worker recovers generation once', async () => {
  if (!process.env.DATABASE_URL?.includes('127.0.0.1:54322'))
    throw new Error('Local database required');
  await startQueue();
  process.env.LLM_ENCRYPTION_KEY ||= randomBytes(32).toString('hex');
  let providerCalls = 0;
  let holdNext = false,
    abortedRequests = 0;
  const provider = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    providerCalls++;
    if (providerCalls === 1 || holdNext) {
      holdNext = false;
      res.on('close', () => {
        if (!res.writableEnded) abortedRequests++;
      });
      return; // Hold generation until its worker is killed or cancelled.
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    const sources = JSON.parse(payload.messages[1].content);
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                body: 'Recovered after worker crash',
                citations: [sources[0].id],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 20 },
      }),
    );
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const endpoint = `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`;
  // Other integration tests enqueue runs that they complete directly. Isolate
  // restart work so their abandoned queue entries cannot delay this worker.
  const queue = `summary-restart-${randomUUID()}`;
  await boss.createQueue(queue);
  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });
  const email = `restart-${randomUUID()}@example.test`;
  const password = 'test-password-482!';
  const user = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: 'Restart tester' },
  });
  if (user.error) throw user.error;
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  const token = login.data.session!.access_token;
  let server: ChildProcess | undefined,
    worker: ChildProcess | undefined,
    workspace: string | undefined;
  const request = async (path: string, body?: unknown, method = body ? 'POST' : 'GET') => {
    const response = await fetch(`http://127.0.0.1:3002/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };
  const ready = () =>
    waitFor(async () => {
      const response = await fetch('http://127.0.0.1:3002/health');
      return response.ok ? true : undefined;
    });
  try {
    server = launch('apps/server/src/index.ts', queue);
    await ready();
    workspace = (await request('/workspaces', { name: 'Restart proof' })).id;
    const channel = (await request(`/workspaces/${workspace}/conversations`))[0].id;
    const requestId = randomUUID();
    const message = await request(`/conversations/${channel}/messages`, {
      requestId,
      body: 'This decision survives an API restart.',
    });
    const run = await request(`/conversations/${channel}/runs`, { requestId: randomUUID() });
    await stop(server);
    server = launch('apps/server/src/index.ts', queue);
    await ready();
    const snapshot = await request(`/conversations/${channel}/messages`);
    expect(snapshot.messages.map((m: { id: string }) => m.id)).toContain(message.id);
    expect(snapshot.runs[0].status).toBe('queued');
    expect(
      (
        await request(`/conversations/${channel}/messages`, {
          requestId,
          body: 'This decision survives an API restart.',
        })
      ).id,
    ).toBe(message.id);
    // All client requests stop before the independent worker is launched.
    worker = launch('apps/worker/src/index.ts', queue);
    await waitFor(async () => {
      const result = await pool.query('select status from app.agent_runs where id=$1', [run.id]);
      return result.rows[0]?.status === 'completed' ? true : undefined;
    });
    expect(
      (await pool.query('select count(*) from app.agent_results where run_id=$1', [run.id])).rows[0]
        .count,
    ).toBe('1');
    await stop(worker);
    worker = launch('apps/worker/src/index.ts', queue);
    await sleep(500);
    expect(
      (await pool.query('select count(*) from app.agent_results where run_id=$1', [run.id])).rows[0]
        .count,
    ).toBe('1');
    await request(
      `/workspaces/${workspace}/llm`,
      {
        provider: 'openai-compatible',
        model: 'crash-model',
        apiKey: 'local-test-key',
        baseUrl: endpoint,
      },
      'PATCH',
    );
    const crashedRun = await request(`/conversations/${channel}/runs`, { requestId: randomUUID() });
    await waitFor(async () => (providerCalls === 1 ? true : undefined));
    const killed = once(worker, 'exit');
    worker.kill('SIGKILL');
    await killed;
    await pool.query(
      "update app.run_attempts set lease_expires_at=now()-interval '1 second' where run_id=$1 and status='running'",
      [crashedRun.id],
    );
    worker = launch('apps/worker/src/index.ts', queue);
    await waitFor(async () =>
      (await pool.query('select status from app.agent_runs where id=$1', [crashedRun.id])).rows[0]
        ?.status === 'completed'
        ? true
        : undefined,
    );
    expect(providerCalls).toBe(2);
    const recovered = await request(`/conversations/${channel}/runs/${crashedRun.id}`);
    expect(recovered.inspection.attempts.map((a: { status: string }) => a.status)).toEqual([
      'interrupted',
      'completed',
    ]);
    expect(recovered.inspection.attempts[0].usage.status).toBe('unknown');
    expect(recovered.result.body).toBe('Recovered after worker crash');
    await request(`/conversations/${channel}/runs/${crashedRun.id}/share`, {});
    await request(`/conversations/${channel}/runs/${crashedRun.id}/share`, {});
    expect(
      (await pool.query('select count(*) from app.messages where agent_run_id=$1', [crashedRun.id]))
        .rows[0].count,
    ).toBe('1');
    holdNext = true;
    const cancelledRun = await request(`/conversations/${channel}/runs`, {
      requestId: randomUUID(),
    });
    await waitFor(async () => (providerCalls === 3 ? true : undefined));
    await request(`/conversations/${channel}/runs/${cancelledRun.id}/cancel`, {});
    await waitFor(async () =>
      (await pool.query('select status from app.agent_runs where id=$1', [cancelledRun.id])).rows[0]
        ?.status === 'cancelled'
        ? true
        : undefined,
    );
    expect(abortedRequests).toBe(2);
    const cancelled = await request(`/conversations/${channel}/runs/${cancelledRun.id}`);
    expect(cancelled.inspection.attempts[0].status).toBe('cancelled');
    expect(cancelled.inspection.attempts[0].usage.status).toBe('unknown');
    expect(cancelled.result).toBeNull();
    holdNext = true;
    const revokedRun = await request(`/conversations/${channel}/runs`, { requestId: randomUUID() });
    await waitFor(async () => (providerCalls === 4 ? true : undefined));
    await request(`/conversations/${channel}/members/${revokedRun.agent_id}`, undefined, 'DELETE');
    await waitFor(async () =>
      (await pool.query('select status from app.agent_runs where id=$1', [revokedRun.id])).rows[0]
        ?.status === 'cancelled'
        ? true
        : undefined,
    );
    expect(abortedRequests).toBe(3);
    expect(
      (await request(`/conversations/${channel}/runs/${revokedRun.id}`)).inspection,
    ).toBeUndefined();
    expect(
      (
        await pool.query('select count(*) from app.agent_results where run_id=any($1)', [
          [cancelledRun.id, revokedRun.id],
        ])
      ).rows[0].count,
    ).toBe('0');
  } finally {
    if (worker) await stop(worker);
    if (server) await stop(server);
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    if (workspace) await pool.query('delete from app.workspaces where id=$1', [workspace]);
    await admin.auth.admin.deleteUser(user.data.user.id);
    await boss.deleteQueue(queue);
    await boss.stop();
    await pool.end();
  }
}, 45000);
