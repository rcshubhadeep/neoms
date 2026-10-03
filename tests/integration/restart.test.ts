import { it, expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
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
function launch(file: string) {
  const child = spawn(process.execPath, ['--env-file=.env', '--import', 'tsx', file], {
    env: { ...process.env, PORT: '3002', AI_PROVIDER: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.resume();
  child.stderr?.resume();
  return child;
}
it('server restart preserves messages and queued agent work without an open client', async () => {
  if (!process.env.DATABASE_URL?.includes('127.0.0.1:54322'))
    throw new Error('Local database required');
  await startQueue();
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
  const request = async (path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:3002/v1${path}`, {
      method: body ? 'POST' : 'GET',
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
    server = launch('apps/server/src/index.ts');
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
    server = launch('apps/server/src/index.ts');
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
    worker = launch('apps/worker/src/index.ts');
    await waitFor(async () => {
      const result = await pool.query('select status from app.agent_runs where id=$1', [run.id]);
      return result.rows[0]?.status === 'completed' ? true : undefined;
    });
    expect(
      (await pool.query('select count(*) from app.messages where agent_run_id=$1', [run.id]))
        .rows[0].count,
    ).toBe('1');
    await stop(worker);
    worker = launch('apps/worker/src/index.ts');
    await sleep(500);
    expect(
      (await pool.query('select count(*) from app.messages where agent_run_id=$1', [run.id]))
        .rows[0].count,
    ).toBe('1');
  } finally {
    if (worker) await stop(worker);
    if (server) await stop(server);
    if (workspace) await pool.query('delete from app.workspaces where id=$1', [workspace]);
    await admin.auth.admin.deleteUser(user.data.user.id);
    await boss.stop();
    await pool.end();
  }
}, 30000);
