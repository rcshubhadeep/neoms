import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { pool, startQueue, boss } from '../../packages/db/src/index.js';
import * as domain from '../../packages/domain/src/index.js';
import * as admin from '../../packages/domain/src/administration.js';
import { openKey } from '../../packages/domain/src/secrets.js';
import { app } from '../../apps/server/src/app.js';
import { summarize } from '../../apps/worker/src/provider.js';
const auth = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
});
const users: string[] = [];
const workspaces: string[] = [];
let alice: { id: string; token: string }, bob: typeof alice, eve: typeof alice;
let workspace: string, channel: string;
async function person(name: string) {
  const email = `workspace-${randomUUID()}@example.test`,
    password = 'test-password-482!';
  const { data, error } = await auth.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });
  if (error) throw error;
  users.push(data.user.id);
  const row = await domain.identify(data.user.id, name);
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  return { id: row.id as string, token: login.data.session!.access_token };
}
async function request(who: typeof alice, path: string, method = 'GET', body?: unknown) {
  return app.request(`/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${who.token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
beforeAll(async () => {
  if (!process.env.DATABASE_URL?.includes('127.0.0.1:54322'))
    throw new Error('Local database required');
  process.env.LLM_ENCRYPTION_KEY ||= randomBytes(32).toString('hex');
  await startQueue();
  alice = await person('Alice');
  bob = await person('Bob');
  eve = await person('Eve');
  workspace = (await domain.createWorkspace(alice.id, 'Workspace essentials')).id;
  workspaces.push(workspace);
  channel = (await pool.query('select id from conversations where workspace_id=$1', [workspace]))
    .rows[0].id;
  await domain.acceptInvite(bob.id, (await domain.invite(alice.id, workspace)).token);
  await domain.acceptInvite(eve.id, (await domain.invite(alice.id, workspace)).token);
});
afterAll(async () => {
  vi.unstubAllGlobals();
  for (const id of workspaces) await pool.query('delete from workspaces where id=$1', [id]);
  for (const id of users) await auth.auth.admin.deleteUser(id);
  await boss.stop();
  await pool.end();
});
describe('channels and private direct messages', () => {
  it('allows member-created channels without automatically inviting agents into private ones', async () => {
    const row = await domain.createChannel(bob.id, workspace, 'Member-created private', true);
    expect(row.created_by).toBe(bob.id);
    expect(
      (
        await pool.query(
          'select participant_id from conversation_members where conversation_id=$1',
          [row.id],
        )
      ).rows,
    ).toEqual([{ participant_id: bob.id }]);
    await expect(domain.snapshot(alice.id, row.id)).rejects.toMatchObject({ status: 403 });
    await domain.changeMembership(bob.id, row.id, eve.id, true);
    await domain.snapshot(eve.id, row.id);
    await expect(domain.changeMembership(eve.id, row.id, alice.id, true)).rejects.toMatchObject({
      status: 403,
    });
  });
  it('creates one DM under concurrent reverse requests and preserves isolation even from owners', async () => {
    const rows = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        i % 2
          ? admin.directMessage(bob.id, workspace, eve.id)
          : admin.directMessage(eve.id, workspace, bob.id),
      ),
    );
    expect(new Set(rows.map((r) => r.id)).size).toBe(1);
    const dm = rows[0];
    expect(
      (await admin.directMessage(bob.id, workspace.toUpperCase(), eve.id.toUpperCase())).id,
    ).toBe(dm.id);
    await domain.sendMessage(bob.id, dm.id, randomUUID(), 'Just between two people');
    await expect(domain.snapshot(alice.id, dm.id)).rejects.toMatchObject({ status: 403 });
    await expect(domain.changeMembership(bob.id, dm.id, alice.id, true)).rejects.toMatchObject({
      status: 403,
    });
    await expect(domain.startSummary(alice.id, dm.id, randomUUID())).rejects.toMatchObject({
      status: 403,
    });
    const requestId = randomUUID();
    const run = await domain.startSummary(bob.id, dm.id, requestId);
    expect((await domain.startSummary(bob.id, dm.id, requestId)).id).toBe(run.id);
    const context = (await domain.prepareRun(run.id))!;
    const summary = await summarize(context.messages, context.configuration);
    await domain.completeRun(run.id, context.messages, summary);
    const snapshot = await domain.snapshot(eve.id, dm.id);
    expect(
      snapshot.messages.find((m: { agent_run_id: string | null }) => m.agent_run_id === run.id),
    ).toMatchObject({ body: summary.body, citations: summary.citations });
    expect(
      (
        await pool.query('select count(*) from conversation_members where conversation_id=$1', [
          dm.id,
        ])
      ).rows[0].count,
    ).toBe('2');
    await expect(domain.snapshot(context.run.agent_id, dm.id)).rejects.toMatchObject({
      status: 403,
    });
    await expect(domain.changes(alice.id, dm.id, '0')).rejects.toMatchObject({ status: 403 });
    const directory = await (await request(alice, `/workspaces/${workspace}/conversations`)).json();
    expect(directory.map((c: { id: string }) => c.id)).not.toContain(dm.id);
    await expect(admin.directMessage(alice.id, workspace, alice.id)).rejects.toMatchObject({
      status: 400,
    });
    const agent = (
      await pool.query(
        "select p.id from participants p join workspace_members wm on wm.participant_id=p.id where wm.workspace_id=$1 and p.kind='agent'",
        [workspace],
      )
    ).rows[0].id;
    await expect(admin.directMessage(alice.id, workspace, agent)).rejects.toMatchObject({
      status: 400,
    });
  });
});
it('documents the new validated endpoints and correct response shapes', async () => {
  const response = await app.request('/openapi.json');
  expect(response.status).toBe(200);
  const spec = await response.json();
  expect(spec.paths['/v1/workspaces/{workspace}/dms'].post.responses['201']).toBeDefined();
  expect(
    spec.paths['/v1/workspaces/{workspace}/llm'].get.responses['200'].content['application/json']
      .schema.properties.apiKey,
  ).toBeUndefined();
  expect(
    spec.paths['/v1/conversations/{conversation}/messages/{message}'].delete.responses['200']
      .content['application/json'].schema.properties.body,
  ).toBeDefined();
});
describe('workspace administration', () => {
  it('enforces admin boundaries and protects owner/self', async () => {
    await expect(admin.llmSettings(bob.id, workspace)).rejects.toMatchObject({ status: 403 });
    await expect(
      admin.updateMember(bob.id, workspace, eve.id, { role: 'admin' }),
    ).rejects.toMatchObject({ status: 403 });
    await admin.updateMember(alice.id, workspace, bob.id, { role: 'admin' });
    await admin.llmSettings(bob.id, workspace);
    await domain.invite(bob.id, workspace);
    await expect(
      admin.updateMember(bob.id, workspace, eve.id, { role: 'admin' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      admin.updateMember(bob.id, workspace, alice.id, { enabled: false }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      admin.updateMember(alice.id, workspace, alice.id, { enabled: false }),
    ).rejects.toMatchObject({ status: 403 });
    await admin.updateMember(alice.id, workspace, bob.id, { role: 'member' });
    expect((await request(bob, `/workspaces/${workspace}/usage`)).status).toBe(403);
  });
  it('revokes invite tokens without returning token hashes', async () => {
    const invitation = await domain.invite(alice.id, workspace);
    const entries = await admin.invitations(alice.id, workspace);
    expect(JSON.stringify(entries)).not.toContain('token_hash');
    await admin.revokeInvitation(alice.id, workspace, entries[0].id);
    await expect(domain.acceptInvite(eve.id, invitation.token)).rejects.toMatchObject({
      status: 400,
    });
  });
  it('disables only one workspace, rejects fresh invites, cancels work, and restores access', async () => {
    const other = (await domain.createWorkspace(bob.id, 'Other workspace')).id;
    workspaces.push(other);
    await domain.sendMessage(alice.id, channel, randomUUID(), 'A decision to summarize');
    const run = await domain.startSummary(bob.id, channel, randomUUID());
    const context = (await domain.prepareRun(run.id))!;
    const before = await domain.snapshot(bob.id, channel);
    await admin.updateMember(alice.id, workspace, bob.id, { enabled: false });
    await expect(domain.changes(bob.id, channel, before.cursor)).rejects.toMatchObject({
      status: 403,
    });
    await expect(domain.sendMessage(bob.id, channel, randomUUID(), 'Denied')).rejects.toMatchObject(
      { status: 403 },
    );
    await expect(domain.createChannel(bob.id, workspace, 'Denied', false)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      domain.acceptInvite(bob.id, (await domain.invite(alice.id, workspace)).token),
    ).rejects.toMatchObject({ status: 403 });
    const visible = await (await request(bob, '/workspaces')).json();
    expect(visible.map((w: { id: string }) => w.id)).toContain(other);
    expect(visible.map((w: { id: string }) => w.id)).not.toContain(workspace);
    await domain.completeRun(run.id, context.messages, {
      body: 'Late reply',
      citations: [context.messages[0].id],
    });
    expect(
      (await pool.query('select status from agent_runs where id=$1', [run.id])).rows[0].status,
    ).toBe('cancelled');
    expect(
      (await pool.query('select id from messages where agent_run_id=$1', [run.id])).rowCount,
    ).toBe(0);
    await admin.updateMember(alice.id, workspace, bob.id, { enabled: true });
    await domain.snapshot(bob.id, channel);
  });
  it('orders disable after an already-authorized delivery and denies every subsequent delivery', async () => {
    let release!: () => void, ready!: () => void;
    const waiting = new Promise<void>((r) => (release = r)),
      acquired = new Promise<void>((r) => (ready = r));
    const delivery = domain.changes(bob.id, channel, '0', async () => {
      ready();
      await waiting;
    });
    await acquired;
    let finished = false;
    const disable = admin.updateMember(alice.id, workspace, bob.id, { enabled: false }).then(() => {
      finished = true;
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(finished).toBe(false);
    release();
    await delivery;
    await disable;
    await expect(domain.changes(bob.id, channel, '0')).rejects.toMatchObject({ status: 403 });
    await admin.updateMember(alice.id, workspace, bob.id, { enabled: true });
  });
});
it('cancels a DM summary when its requesting participant is disabled before publication', async () => {
  const dm = await admin.directMessage(bob.id, workspace, eve.id);
  const run = await domain.startSummary(eve.id, dm.id, randomUUID());
  const context = (await domain.prepareRun(run.id))!;
  try {
    await admin.updateMember(alice.id, workspace, eve.id, { enabled: false });
    await domain.completeRun(run.id, context.messages, {
      body: 'Must not be published',
      citations: [context.messages[0].id],
    });
    expect(
      (await pool.query('select status from agent_runs where id=$1', [run.id])).rows[0].status,
    ).toBe('cancelled');
    expect(
      (await pool.query('select count(*) from messages where agent_run_id=$1', [run.id])).rows[0]
        .count,
    ).toBe('0');
    await expect(domain.startSummary(eve.id, dm.id, randomUUID())).rejects.toMatchObject({
      status: 403,
    });
  } finally {
    await admin.updateMember(alice.id, workspace, eve.id, { enabled: true });
  }
});
describe('OpenAI-compatible connections and discovery', () => {
  let isolated: string;
  const input = {
    provider: 'openai-compatible' as const,
    baseUrl: 'https://models.example.test/v1',
    model: 'manual-model',
    apiKey: 'compatible-controlled-key',
    removeKey: false,
  };
  it('persists manual model IDs and encrypts endpoint-bound keys through the API', async () => {
    isolated = (await domain.createWorkspace(alice.id, 'Compatible models')).id;
    workspaces.push(isolated);
    const response = await request(alice, `/workspaces/${isolated}/llm`, 'PATCH', input);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      provider: input.provider,
      baseUrl: input.baseUrl,
      model: input.model,
      hasKey: true,
      tokenLimitParameter: 'max_completion_tokens',
    });
    const row = (await pool.query('select * from workspace_llm where workspace_id=$1', [isolated]))
      .rows[0];
    expect(openKey(row.key_ciphertext)).toBe(input.apiKey);
    const saved = await admin.setLlmSettings(alice.id, isolated, {
      ...input,
      baseUrl: `${input.baseUrl}/`,
      apiKey: undefined,
      model: 'unlisted-model',
    });
    expect(saved.hasKey).toBe(true);
    await expect(
      admin.setLlmSettings(alice.id, isolated, {
        ...input,
        baseUrl: 'https://other.example.test/v1',
        apiKey: undefined,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      admin.setLlmSettings(alice.id, isolated, {
        ...input,
        provider: 'anthropic',
        apiKey: undefined,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect((await admin.llmSettings(alice.id, isolated)).baseUrl).toBe(input.baseUrl);
  });
  it('discovers sorted model IDs using the saved key, without modifying settings or usage', async () => {
    const before = await admin.llmSettings(alice.id, isolated);
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ data: [{ id: 'z-model' }, { id: 'a-model' }, { id: 'z-model' }] }),
      );
    vi.stubGlobal('fetch', fetch);
    try {
      expect(
        await admin.discoverModels(alice.id, isolated, {
          provider: input.provider,
          baseUrl: input.baseUrl,
        }),
      ).toEqual({ models: ['a-model', 'z-model'], truncated: false });
      expect(fetch.mock.calls[0][0].toString()).toBe(`${input.baseUrl}/models`);
      expect(fetch.mock.calls[0][1]).toMatchObject({
        redirect: 'error',
        headers: { Authorization: `Bearer ${input.apiKey}` },
      });
      expect(await admin.llmSettings(alice.id, isolated)).toEqual(before);
      expect((await admin.usage(alice.id, isolated)).models).toEqual([]);
      await expect(
        admin.discoverModels(bob.id, isolated, {
          provider: input.provider,
          baseUrl: input.baseUrl,
          apiKey: 'preview-key',
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        admin.discoverModels(alice.id, isolated, {
          provider: input.provider,
          baseUrl: 'https://other.example.test/v1',
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(fetch).toHaveBeenCalledOnce();
      fetch.mockResolvedValueOnce(Response.json({ data: [{ id: 'preview-model' }] }));
      await admin.discoverModels(alice.id, isolated, {
        provider: input.provider,
        baseUrl: 'https://other.example.test/v1',
        apiKey: 'preview-key',
      });
      expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer preview-key');
      expect(await admin.llmSettings(alice.id, isolated)).toEqual(before);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('bounds listing, sanitizes provider failures, and follows Anthropic pagination', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ data: Array.from({ length: 1001 }, (_, i) => ({ id: `model-${i}` })) }),
      );
    vi.stubGlobal('fetch', fetch);
    try {
      const listed = await admin.discoverModels(alice.id, isolated, {
        provider: input.provider,
        baseUrl: input.baseUrl,
      });
      expect(listed.models).toHaveLength(1000);
      expect(listed.truncated).toBe(true);
      fetch.mockResolvedValueOnce(new Response('secret-provider-error', { status: 401 }));
      await expect(
        admin.discoverModels(alice.id, isolated, {
          provider: input.provider,
          baseUrl: input.baseUrl,
        }),
      ).rejects.toThrow('Model listing failed (401). Enter a model ID manually.');
      fetch.mockResolvedValueOnce(Response.json({ incorrect: 'secret-provider-error' }));
      await expect(
        admin.discoverModels(alice.id, isolated, {
          provider: input.provider,
          baseUrl: input.baseUrl,
        }),
      ).rejects.toThrow('Model listing is unavailable. Enter a model ID manually.');
      fetch.mockClear();
      fetch
        .mockResolvedValueOnce(
          Response.json({ data: [{ id: 'claude-a' }], has_more: true, last_id: 'claude-a' }),
        )
        .mockResolvedValueOnce(Response.json({ data: [{ id: 'claude-b' }], has_more: false }));
      expect(
        await admin.discoverModels(alice.id, isolated, {
          provider: 'anthropic',
          apiKey: 'preview-key',
        }),
      ).toEqual({ models: ['claude-a', 'claude-b'], truncated: false });
      expect(fetch.mock.calls[1][0].searchParams.get('after_id')).toBe('claude-a');
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('pins endpoint/token settings to runs and invalidates publication after an endpoint change', async () => {
    const conversation = (
      await pool.query('select id from conversations where workspace_id=$1', [isolated])
    ).rows[0].id;
    await domain.sendMessage(alice.id, conversation, randomUUID(), 'Summarize this decision.');
    await admin.setLlmSettings(alice.id, isolated, { ...input, tokenLimitParameter: 'max_tokens' });
    const run = await domain.startSummary(alice.id, conversation, randomUUID());
    const context = (await domain.prepareRun(run.id))!;
    expect(context.configuration).toMatchObject({
      provider: input.provider,
      baseUrl: input.baseUrl,
      tokenLimitParameter: 'max_tokens',
      apiKey: input.apiKey,
    });
    await admin.setLlmSettings(alice.id, isolated, {
      ...input,
      baseUrl: 'https://other.example.test/v1',
      apiKey: 'fresh-key',
    });
    await domain.completeRun(run.id, context.messages, {
      body: 'Old endpoint response',
      citations: [context.messages[0].id],
    });
    expect(
      (await pool.query('select status from agent_runs where id=$1', [run.id])).rows[0].status,
    ).toBe('cancelled');
    await admin.setLlmSettings(alice.id, isolated, {
      ...input,
      apiKey: undefined,
      removeKey: true,
    });
    expect((await admin.llmSettings(alice.id, isolated)).hasKey).toBe(false);
  });
});
describe('workspace BYOK and attributable usage', () => {
  it('encrypts keys, never returns them, and prevents cross-workspace configuration', async () => {
    const input = {
      provider: 'anthropic' as const,
      model: 'controlled-test-model',
      apiKey: 'not-a-real-key',
      removeKey: false,
    };
    const result = await admin.setLlmSettings(alice.id, workspace, input);
    expect(result.hasKey).toBe(true);
    expect(JSON.stringify(result)).not.toContain(input.apiKey);
    const stored = (
      await pool.query('select key_ciphertext from workspace_llm where workspace_id=$1', [
        workspace,
      ])
    ).rows[0].key_ciphertext;
    expect(stored).not.toContain(input.apiKey);
    expect(openKey(stored)).toBe(input.apiKey);
    expect((await request(bob, `/workspaces/${workspace}/llm`)).status).toBe(403);
    const other = (await domain.createWorkspace(eve.id, 'Isolated settings')).id;
    workspaces.push(other);
    await expect(admin.llmSettings(alice.id, other)).rejects.toMatchObject({ status: 403 });
    await expect(domain.startSummary(eve.id, channel, randomUUID())).resolves.toBeDefined();
  });
  it('uses workspace credentials/model and records reported usage even for invalid output', async () => {
    const run = await domain.startSummary(bob.id, channel, randomUUID());
    const context = (await domain.prepareRun(run.id))!;
    expect(context.configuration).toMatchObject({
      apiKey: 'not-a-real-key',
      model: 'controlled-test-model',
    });
    const attempt = await admin.beginUsage(run.id);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init: RequestInit) => {
        expect((init.headers as Record<string, string>)['x-api-key']).toBe('not-a-real-key');
        expect(JSON.parse(init.body as string).model).toBe('controlled-test-model');
        return new Response(
          JSON.stringify({
            content: [{ type: 'text', text: 'invalid JSON' }],
            usage: {
              input_tokens: 120,
              output_tokens: 30,
              cache_read_input_tokens: 8,
              cache_creation_input_tokens: 4,
            },
          }),
          { status: 200 },
        );
      }),
    );
    try {
      await expect(
        summarize(context.messages, context.configuration, (t) => admin.reportUsage(attempt, t)),
      ).rejects.toThrow();
    } finally {
      vi.unstubAllGlobals();
      await admin.reportUsage(attempt);
    }
    const row = (await pool.query('select * from llm_usage where id=$1', [attempt])).rows[0];
    expect(row.status).toBe('reported');
    expect(row.input_tokens).toBe('120');
    expect(row.participant_id).toBe(bob.id);
    const retry = await admin.beginUsage(run.id);
    await admin.reportUsage(retry);
    const report = await admin.usage(alice.id, workspace);
    const member = report.members.find((m) => m.id === bob.id)!;
    expect(member.attempts).toBe('2');
    expect(member.unknown_attempts).toBe('1');
    expect(member.input_tokens).toBe('120');
    expect(member.cache_read_tokens).toBe('8');
  });
  it('invalidates pending output on config changes and supports replacing/removing keys', async () => {
    const run = await domain.startSummary(bob.id, channel, randomUUID());
    const context = (await domain.prepareRun(run.id))!;
    await admin.setLlmSettings(alice.id, workspace, {
      provider: 'anthropic',
      model: 'another-model',
      apiKey: 'replacement-key',
      removeKey: false,
    });
    await domain.completeRun(run.id, context.messages, {
      body: 'Old configuration',
      citations: [context.messages[0].id],
    });
    expect(
      (await pool.query('select status from agent_runs where id=$1', [run.id])).rows[0].status,
    ).toBe('cancelled');
    await admin.setLlmSettings(alice.id, workspace, {
      provider: 'anthropic',
      model: 'another-model',
      removeKey: true,
    });
    await expect(domain.startSummary(bob.id, channel, randomUUID())).rejects.toMatchObject({
      status: 400,
    });
    await admin.setLlmSettings(alice.id, workspace, {
      provider: 'test',
      model: 'deterministic',
      removeKey: true,
    });
  });
  it('blocks secret writes when the installation encryption key is missing', async () => {
    const key = process.env.LLM_ENCRYPTION_KEY;
    delete process.env.LLM_ENCRYPTION_KEY;
    try {
      await expect(
        admin.setLlmSettings(alice.id, workspace, {
          provider: 'anthropic',
          model: 'controlled',
          apiKey: 'key',
          removeKey: false,
        }),
      ).rejects.toMatchObject({ status: 503 });
    } finally {
      process.env.LLM_ENCRYPTION_KEY = key;
    }
    expect((await admin.llmSettings(alice.id, workspace)).provider).toBe('test');
  });
});
