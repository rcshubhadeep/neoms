import { beforeAll, afterAll, afterEach, describe, it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { pool, transaction, startQueue, boss } from '../../packages/db/src/index.js';
import * as domain from '../../packages/domain/src/index.js';
import { app } from '../../apps/server/src/app.js';
import { executeAgent, summarize } from '../../apps/worker/src/provider.js';
import { readRun, shareRun } from '../../packages/domain/src/run-results.js';
import { setPolicy, policySettings } from '../../packages/domain/src/run-policy.js';
import {
  beginUsage,
  reportUsage,
  setLlmSettings,
} from '../../packages/domain/src/administration.js';
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
});
let alice: string, bob: string, eve: string, workspace: string, conversation: string, token: string;
const users: string[] = [];
const workspaces: string[] = [];
async function person(name: string) {
  const email = `test-${name}-${randomUUID()}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'test-password-482!',
    email_confirm: true,
    user_metadata: { name },
  });
  if (error) throw error;
  users.push(data.user.id);
  const participant = await domain.identify(data.user.id, name);
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
  const result = await client.auth.signInWithPassword({ email, password: 'test-password-482!' });
  if (result.error) throw result.error;
  return { id: participant.id, token: result.data.session!.access_token };
}
beforeAll(async () => {
  process.env.LLM_ENCRYPTION_KEY ||= randomBytes(32).toString('hex');
  if (!process.env.DATABASE_URL?.includes('127.0.0.1:54322'))
    throw new Error('Tests must run against the local Neoms database');
  await startQueue();
  const a = await person('Alice');
  alice = a.id;
  token = a.token;
  bob = (await person('Bob')).id;
  eve = (await person('Eve')).id;
  const ws = await domain.createWorkspace(alice, 'Integration team');
  workspace = ws.id;
  workspaces.push(workspace);
  conversation = (
    await pool.query('select id from conversations where workspace_id=$1', [workspace])
  ).rows[0].id;
  const invitation = await domain.invite(alice, workspace);
  await domain.acceptInvite(bob, invitation.token);
});
afterAll(async () => {
  for (const id of workspaces) await pool.query('delete from workspaces where id=$1', [id]);
  for (const id of users) await admin.auth.admin.deleteUser(id);
  await boss.stop();
  await pool.end();
});
afterEach(async () => {
  await transaction(async (tx) => {
    const runs = (
      await tx.query(
        "select r.id from agent_runs r join conversations c on c.id=r.conversation_id where c.workspace_id=any($1) and r.status in ('queued','running','failed')",
        [workspaces],
      )
    ).rows;
    for (const run of runs) await domain.updateRun(tx, run.id, 'cancelled');
  });
});
describe('private bounded agent runs', () => {
  async function fixture() {
    const ws = await domain.createWorkspace(alice, 'Private run checks');
    workspaces.push(ws.id);
    await domain.acceptInvite(bob, (await domain.invite(alice, ws.id)).token);
    const channel = (
      await pool.query('select id from conversations where workspace_id=$1', [ws.id])
    ).rows[0];
    const first = await domain.sendMessage(alice, channel.id, randomUUID(), 'First decision');
    const second = await domain.sendMessage(bob, channel.id, randomUUID(), 'Second decision');
    const agent = (await domain.conversationAgents(alice, channel.id))[0];
    return { workspace: ws.id, channel: channel.id, first, second, agent };
  }
  it('fails closed for personal agents until owner-access and consent gates exist', async () => {
    const f = await fixture();
    await pool.query(
      "update agent_definitions set origin='personal',owner_id=$2 where agent_id=$1",
      [f.agent.agent_id, bob],
    );
    expect(
      (await domain.conversationAgents(alice, f.channel)).some(
        (agent) => agent.agent_id === f.agent.agent_id,
      ),
    ).toBe(false);
    await expect(
      domain.startSummary(alice, f.channel, randomUUID(), f.agent.agent_id),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('keeps results, errors, source IDs, and replay private even from an admin', async () => {
    const f = await fixture();
    const boundary = (await domain.snapshot(alice, f.channel)).cursor;
    const run = await domain.startSummary(bob, f.channel, randomUUID());
    const context = (await domain.prepareRun(run.id))!;
    await domain.completeRun(run.id, context.messages, {
      body: 'Requester secret result',
      citations: [f.first.id],
    });
    expect((await readRun(bob, f.channel, run.id)).result?.body).toBe('Requester secret result');
    await expect(readRun(alice, f.channel, run.id)).rejects.toMatchObject({ status: 404 });
    const denied = await app.request(`/v1/conversations/${f.channel}/runs/${run.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(denied.status).toBe(404);
    expect((await domain.snapshot(alice, f.channel)).runs).toEqual([]);
    const replay = await domain.changes(alice, f.channel, boundary);
    expect(replay.events.length).toBeGreaterThan(0);
    expect(
      replay.events.every((event) => event.type === 'noop' && JSON.stringify(event.data) === '{}'),
    ).toBe(true);
    expect(replay.cursor).toBe((await domain.snapshot(alice, f.channel)).cursor);
    const list = async () =>
      (
        await (
          await app.request(`/v1/workspaces/${f.workspace}/conversations`, {
            headers: { Authorization: `Bearer ${token}` },
          })
        ).json()
      )[0];
    expect((await list()).unread).toBe(true);
    await domain.markRead(alice, f.channel, boundary);
    expect((await list()).unread).toBe(false);
    const persisted = (
      await pool.query("select data from events where conversation_id=$1 and type='run.updated'", [
        f.channel,
      ])
    ).rows;
    expect(JSON.stringify(persisted)).not.toContain('Requester secret result');
    const shared = await shareRun(bob, f.channel, run.id);
    expect(shared.body).toContain('Shared by Bob');
    expect((await domain.snapshot(alice, f.channel)).messages.some((m) => m.id === shared.id)).toBe(
      true,
    );
  });
  it('pins unread boundaries and rejects stale previews and changed idempotency scope', async () => {
    const f = await fixture();
    const boundary = (await domain.snapshot(alice, f.channel)).cursor;
    await domain.markRead(alice, f.channel, boundary);
    const later = await domain.sendMessage(bob, f.channel, randomUUID(), 'Unread decision');
    const preview = await domain.previewRun(alice, f.channel, {
      requestId: randomUUID(),
      allowPartial: false,
      scope: { mode: 'unread', afterSequence: boundary },
    });
    await domain.markRead(alice, f.channel, preview.scope.upperSequence!);
    await domain.sendMessage(bob, f.channel, randomUUID(), 'After preview, excluded');
    const requestId = randomUUID();
    const options = { scope: preview.scope, selectionHash: preview.selectionHash };
    const run = await domain.startSummary(alice, f.channel, requestId, undefined, options);
    expect((await domain.prepareRun(run.id))!.messages.map((m) => m.id)).toEqual([later.id]);
    await expect(
      domain.startSummary(alice, f.channel, requestId, undefined, { scope: { mode: 'recent' } }),
    ).rejects.toMatchObject({ status: 409 });
    await domain.mutateMessage(bob, f.channel, later.id, 'Changed after preview', 1);
    await expect(
      domain.startSummary(alice, f.channel, randomUUID(), undefined, options),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('only tightens layered policy and requires confirmation for omissions', async () => {
    const f = await fixture();
    await setPolicy(alice, f.workspace, {
      layer: 'workspace',
      limits: { maxOutputTokens: 600, maxMessages: 2 },
    });
    await setPolicy(alice, f.workspace, {
      layer: 'agent',
      targetId: f.agent.agent_id,
      limits: { maxOutputTokens: 1000, maxMessages: 1 },
    });
    await setPolicy(alice, f.workspace, {
      layer: 'conversation',
      targetId: f.channel,
      limits: { maxOutputTokens: 400 },
    });
    const preview = await domain.previewRun(alice, f.channel, {
      requestId: randomUUID(),
      agentId: f.agent.agent_id,
      allowPartial: false,
      limits: { maxOutputTokens: 300 },
    });
    expect(preview.policy.maxOutputTokens).toBe(300);
    expect(preview.coverage).toMatchObject({
      selectedMessages: 1,
      totalMessages: 2,
      omittedMessages: 1,
    });
    await expect(
      domain.startSummary(alice, f.channel, randomUUID(), f.agent.agent_id),
    ).rejects.toMatchObject({ status: 409 });
    const run = await domain.startSummary(alice, f.channel, randomUUID(), f.agent.agent_id, {
      allowPartial: true,
    });
    expect((await domain.prepareRun(run.id))!.configuration.maxOutputTokens).toBe(400);
    await expect(
      setPolicy(bob, f.workspace, { layer: 'workspace', limits: { maxMessages: 500 } }),
    ).rejects.toMatchObject({ status: 403 });
    expect((await policySettings(alice, f.workspace)).limits.maxMessages).toBe(2);
  });
  it('invalidates uncited source dependencies and never replays the old published body', async () => {
    const f = await fixture();
    const run = await domain.startSummary(alice, f.channel, randomUUID());
    const context = (await domain.prepareRun(run.id))!;
    await domain.completeRun(run.id, context.messages, {
      body: 'Derived secret answer',
      citations: [f.first.id],
    });
    await shareRun(alice, f.channel, run.id);
    await domain.mutateMessage(bob, f.channel, f.second.id, null, 1);
    expect((await readRun(alice, f.channel, run.id)).result).toMatchObject({
      stale: true,
      citations: [],
    });
    await expect(shareRun(alice, f.channel, run.id)).rejects.toMatchObject({ status: 409 });
    expect(JSON.stringify(await domain.changes(bob, f.channel, '0'))).not.toContain(
      'Derived secret answer',
    );
  });
  it('hides expired or revoked results and separately denies posting by policy', async () => {
    const f = await fixture();
    await setPolicy(alice, f.workspace, { layer: 'workspace', limits: { allowSharing: false } });
    const run = await domain.startSummary(alice, f.channel, randomUUID());
    const context = (await domain.prepareRun(run.id))!;
    await domain.completeRun(run.id, context.messages, {
      body: 'Cannot post',
      citations: [f.first.id],
    });
    expect((await readRun(alice, f.channel, run.id)).result?.body).toBe('Cannot post');
    await expect(shareRun(alice, f.channel, run.id)).rejects.toMatchObject({ status: 403 });
    await domain.changeMembership(alice, f.channel, context.run.agent_id, false);
    expect((await readRun(alice, f.channel, run.id)).result).toBeNull();
    await domain.changeMembership(alice, f.channel, context.run.agent_id, true);
    await pool.query(
      "update agent_results set expires_at=now()-interval '1 second' where run_id=$1",
      [run.id],
    );
    expect((await readRun(alice, f.channel, run.id)).result).toMatchObject({
      stale: true,
      citations: [],
    });
    expect(
      (await pool.query('select body from agent_results where run_id=$1', [run.id])).rows[0].body,
    ).toBe('');
  });
  it('atomically caps concurrency across conversations and releases cancelled slots', async () => {
    const f = await fixture();
    await setPolicy(alice, f.workspace, { layer: 'workspace', limits: { maxConcurrentRuns: 1 } });
    const other = await domain.createChannel(alice, f.workspace, 'Other scope', false);
    await domain.changeMembership(alice, other.id, f.agent.agent_id, true);
    await domain.sendMessage(alice, other.id, randomUUID(), 'Other channel context');
    const attempts = await Promise.allSettled([
      domain.startSummary(alice, f.channel, randomUUID(), f.agent.agent_id),
      domain.startSummary(alice, other.id, randomUUID(), f.agent.agent_id),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      attempts
        .filter((result) => result.status === 'rejected')
        .map((result) => result.reason.status),
    ).toEqual([429]);
    const succeeded = attempts.find((result) => result.status === 'fulfilled')!;
    await transaction((tx) => domain.updateRun(tx, succeeded.value.id, 'cancelled'));
    await expect(
      domain.startSummary(alice, f.channel, randomUUID(), f.agent.agent_id),
    ).resolves.toBeDefined();
  });
  it('reserves hosted retries, preserves unknown charges, and refines late usage', async () => {
    const f = await fixture();
    await setLlmSettings(alice, f.workspace, {
      provider: 'anthropic',
      model: 'controlled-test-model',
      apiKey: 'test-key',
      removeKey: false,
    });
    const preview = await domain.previewRun(alice, f.channel, {
      requestId: randomUUID(),
      allowPartial: false,
    });
    const perAttempt = preview.coverage.estimatedInputTokens + preview.policy.maxOutputTokens;
    await setPolicy(alice, f.workspace, {
      layer: 'workspace',
      limits: { userDailyTokens: perAttempt * 3, workspaceMonthlyTokens: perAttempt * 3 },
    });
    const results = await Promise.allSettled([
      domain.startSummary(alice, f.channel, randomUUID()),
      domain.startSummary(bob, f.channel, randomUUID()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected').map((r) => r.reason.status)).toEqual([
      429,
    ]);
    const run = results.find((r) => r.status === 'fulfilled')!.value;
    await domain.prepareRun(run.id);
    const attempt = await beginUsage(run.id);
    await reportUsage(attempt);
    await transaction((tx) => domain.updateRun(tx, run.id, 'cancelled'));
    expect(
      Number(
        (await pool.query('select budget_tokens from agent_runs where id=$1', [run.id])).rows[0]
          .budget_tokens,
      ),
    ).toBe(perAttempt);
    await reportUsage(attempt, {
      input_tokens: 50,
      output_tokens: 10,
      cache_read_tokens: 5,
      cache_write_tokens: 2,
    });
    expect(
      Number(
        (await pool.query('select budget_tokens from agent_runs where id=$1', [run.id])).rows[0]
          .budget_tokens,
      ),
    ).toBe(67);
    await expect(beginUsage(run.id)).rejects.toMatchObject({ status: 409 });
  });
});
describe('API identity and access', () => {
  it('requires a verified session and validates request bodies', async () => {
    expect((await app.request('/v1/workspaces')).status).toBe(401);
    expect(
      (await app.request('/v1/workspaces', { headers: { Authorization: 'Bearer invalid' } }))
        .status,
    ).toBe(401);
    expect(
      (
        await app.request('/v1/workspaces', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: '{"name":""}',
        })
      ).status,
    ).toBe(400);
  });
  it('discovers only permitted channels', async () => {
    const privateChannel = await domain.createChannel(alice, workspace, 'private', true);
    const result = await app.request(`/v1/workspaces/${workspace}/conversations`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect((await result.json()).map((c: { id: string }) => c.id)).toContain(privateChannel.id);
    await expect(domain.snapshot(bob, privateChannel.id)).rejects.toMatchObject({ status: 403 });
  });
  it('isolates workspace history, catch-up, and assistant context', async () => {
    await expect(domain.snapshot(eve, conversation)).rejects.toMatchObject({ status: 403 });
    await expect(domain.changes(eve, conversation, '0')).rejects.toMatchObject({ status: 403 });
    await expect(domain.startSummary(eve, conversation, randomUUID())).rejects.toMatchObject({
      status: 403,
    });
  });
  it('does not let a member invite or grant access', async () => {
    await expect(domain.invite(bob, workspace)).rejects.toMatchObject({ status: 403 });
    await expect(domain.changeMembership(bob, conversation, eve, true)).rejects.toMatchObject({
      status: 403,
    });
  });
  it('consumes invitations exactly once, including concurrent redemption', async () => {
    const invitation = await domain.invite(alice, workspace);
    const results = await Promise.allSettled([
      domain.acceptInvite(eve, invitation.token),
      domain.acceptInvite(eve, invitation.token),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await pool.query('delete from conversation_members where participant_id=$1', [eve]);
    await pool.query('delete from workspace_members where participant_id=$1', [eve]);
  });
});
describe('durable messages and replay', () => {
  it('stores one message for concurrent retries; rejects changed payloads', async () => {
    const requestId = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        domain.sendMessage(alice, conversation, requestId, 'A durable message'),
      ),
    );
    expect(new Set(results.map((m) => m.id)).size).toBe(1);
    expect(
      (await pool.query('select count(*) from messages where request_id=$1', [requestId])).rows[0]
        .count,
    ).toBe('1');
    await expect(
      domain.sendMessage(alice, conversation, requestId, 'Different content'),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('rolls back an uncommitted message and its event together', async () => {
    const before = await domain.snapshot(alice, conversation);
    await expect(
      transaction(async (tx) => {
        await domain.channelAccess(tx, alice, conversation);
        await tx.query(
          'insert into messages(conversation_id,author_id,request_id,request_hash,body) values($1,$2,$3,$4,$5)',
          [conversation, alice, randomUUID(), 'hash', 'Rolled back'],
        );
        await domain.emit(tx, conversation, 'test', {});
        throw new Error('crash');
      }),
    ).rejects.toThrow('crash');
    const after = await domain.snapshot(alice, conversation);
    expect(after.cursor).toBe(before.cursor);
    expect(after.messages).toEqual(before.messages);
  });
  it('serializes commit order so a cursor cannot skip a later commit', async () => {
    const before = await domain.snapshot(alice, conversation);
    let release!: () => void;
    let ready!: () => void;
    const wait = new Promise<void>((r) => {
      release = r;
    });
    const acquired = new Promise<void>((r) => {
      ready = r;
    });
    const first = transaction(async (tx) => {
      await domain.channelAccess(tx, alice, conversation);
      ready();
      await wait;
      return domain.emit(tx, conversation, 'noop', {});
    });
    await acquired;
    const second = domain.sendMessage(
      bob,
      conversation,
      randomUUID(),
      'After the held transaction',
    );
    release();
    await first;
    await second;
    const replay = await domain.changes(alice, conversation, before.cursor);
    expect(replay.events.map((e) => e.sequence)).toEqual([
      (BigInt(before.cursor) + 1n).toString(),
      (BigInt(before.cursor) + 2n).toString(),
    ]);
  });
  it('replays sends, edits, and deletes after a disconnection', async () => {
    const before = await domain.snapshot(bob, conversation);
    const original = await domain.sendMessage(alice, conversation, randomUUID(), 'Original');
    const edit = await domain.mutateMessage(alice, conversation, original.id, 'Edited', 1);
    const deleted = await domain.mutateMessage(
      alice,
      conversation,
      original.id,
      null,
      edit.revision,
    );
    const replay = await domain.changes(bob, conversation, before.cursor);
    expect(replay.events).toHaveLength(3);
    expect(replay.events.at(-1)!.data.body).toBe('');
    expect(deleted.deleted_at).not.toBeNull();
    await expect(
      domain.mutateMessage(bob, conversation, original.id, 'No', deleted.revision),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('rejects stale edits and invalid cursors', async () => {
    const message = await domain.sendMessage(alice, conversation, randomUUID(), 'Version one');
    await domain.mutateMessage(alice, conversation, message.id, 'Version two', 1);
    await expect(
      domain.mutateMessage(alice, conversation, message.id, 'Stale', 1),
    ).rejects.toMatchObject({ status: 409 });
    await expect(domain.changes(alice, conversation, '999999999')).rejects.toMatchObject({
      status: 409,
    });
  });
  it('paginates without losing or duplicating same-channel history', async () => {
    const channel = await domain.createChannel(alice, workspace, 'pagination', false);
    for (let i = 0; i < 55; i++)
      await domain.sendMessage(alice, channel.id, randomUUID(), `Message ${i}`);
    const first = await domain.snapshot(alice, channel.id);
    const older = await domain.snapshot(alice, channel.id, first.messages[0].id);
    expect(first.messages).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    expect(older.messages).toHaveLength(5);
    expect(new Set([...first.messages, ...older.messages].map((m) => m.id)).size).toBe(55);
  });
  it('revokes access before any subsequent change can be fetched', async () => {
    const before = await domain.snapshot(bob, conversation);
    await domain.changeMembership(alice, conversation, bob, false);
    await domain.sendMessage(alice, conversation, randomUUID(), 'Private after revocation');
    await expect(domain.changes(bob, conversation, before.cursor)).rejects.toMatchObject({
      status: 403,
    });
    await expect(domain.snapshot(bob, conversation)).rejects.toMatchObject({ status: 403 });
    await domain.changeMembership(alice, conversation, bob, true);
  });
});
describe('unread conversations', () => {
  it('persists bounded, monotonic read positions and ignores own messages, edits, and deletions', async () => {
    const channel = await domain.createChannel(alice, workspace, `unread-${randomUUID()}`, false);
    const list = async () => {
      const response = await app.request(`/v1/workspaces/${workspace}/conversations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      const rows = await response.json();
      return rows.find((row: { id: string }) => row.id === channel.id);
    };
    await domain.sendMessage(alice, channel.id, randomUUID(), 'My own message');
    expect((await list()).unread).toBe(false);
    const incoming = await domain.sendMessage(bob, channel.id, randomUUID(), 'An incoming message');
    expect((await list()).unread).toBe(true);
    const seen = (await domain.snapshot(alice, channel.id)).cursor;
    const read = await app.request(`/v1/conversations/${channel.id}/read`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sequence: seen }),
    });
    expect(read.status).toBe(200);
    await domain.markRead(alice, channel.id, '0');
    expect((await list()).unread).toBe(false);
    await domain.mutateMessage(bob, channel.id, incoming.id, 'An edited message', 1);
    expect((await list()).unread).toBe(false);
    await expect(domain.markRead(alice, channel.id, '999999999')).rejects.toMatchObject({
      status: 400,
    });
    await expect(domain.markRead(eve, channel.id, '0')).rejects.toMatchObject({ status: 403 });
    const later = await domain.sendMessage(bob, channel.id, randomUUID(), 'A later message');
    await domain.markRead(alice, channel.id, seen);
    expect((await list()).unread).toBe(true);
    await domain.mutateMessage(bob, channel.id, later.id, null, 1);
    expect((await list()).unread).toBe(false);
  });
});
describe('agent jobs and provenance', () => {
  it('selects two agents explicitly and rejects reuse of a request ID for another agent', async () => {
    const agents = await domain.conversationAgents(alice, conversation);
    expect(agents.map((agent) => agent.key).sort()).toEqual(['planner', 'scribe']);
    const planner = agents.find((agent) => agent.key === 'planner')!;
    const requestId = randomUUID();
    const run = await domain.startSummary(alice, conversation, requestId, planner.agent_id);
    const context = (await domain.prepareRun(run.id))!;
    expect(context.agent.operation).toBe('suggest_actions');
    const output = await executeAgent(context.messages, context.configuration, context.agent);
    expect(output.body).toContain('not an AI action plan');
    await domain.completeRun(run.id, context.messages, output);
    expect((await domain.startSummary(alice, conversation, requestId, planner.agent_id)).id).toBe(
      run.id,
    );
    await expect(domain.startSummary(alice, conversation, requestId)).rejects.toMatchObject({
      status: 409,
    });
    await shareRun(alice, conversation, run.id);
    const result = (
      await pool.query('select author_id from messages where agent_run_id=$1', [run.id])
    ).rows[0];
    expect(result.author_id).toBe(planner.agent_id);
    const response = await app.request(`/v1/conversations/${conversation}/agents`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    expect((await response.json()).map((agent: { key: string }) => agent.key).sort()).toEqual([
      'planner',
      'scribe',
    ]);
  });
  it('pins immutable versions even when a new definition is published before execution', async () => {
    const scribe = (await domain.conversationAgents(alice, conversation)).find(
      (agent) => agent.key === 'scribe',
    )!;
    const run = await domain.startSummary(alice, conversation, randomUUID(), scribe.agent_id);
    await pool.query(
      'insert into agent_versions(agent_id,version,operation,instructions) values($1,$2,$3,$4)',
      [scribe.agent_id, scribe.version + 1, 'summarize', 'New instructions for future runs.'],
    );
    const context = (await domain.prepareRun(run.id))!;
    expect(context.agent.version).toBe(scribe.version);
    expect(context.agent.instructions).toBe(scribe.instructions);
    const next = await domain.startSummary(alice, conversation, randomUUID(), scribe.agent_id);
    expect((await domain.prepareRun(next.id))!.agent.version).toBe(scribe.version + 1);
    await expect(
      pool.query('update agent_versions set instructions=$2 where agent_id=$1', [
        scribe.agent_id,
        'Rewrite history',
      ]),
    ).rejects.toThrow('immutable');
  });
  it('requires explicit grants for new public/private channels and rejects foreign agents', async () => {
    const planner = (await domain.conversationAgents(alice, conversation)).find(
      (agent) => agent.key === 'planner',
    )!;
    for (const privateChannel of [false, true]) {
      const channel = await domain.createChannel(
        alice,
        workspace,
        `agent-scope-${randomUUID()}`,
        privateChannel,
      );
      expect(await domain.conversationAgents(alice, channel.id)).toEqual([]);
      await expect(
        domain.startSummary(alice, channel.id, randomUUID(), planner.agent_id),
      ).rejects.toMatchObject({ status: 403 });
      await domain.changeMembership(alice, channel.id, planner.agent_id, true);
      expect(
        (await domain.conversationAgents(alice, channel.id)).map((agent) => agent.agent_id),
      ).toEqual([planner.agent_id]);
      await expect(domain.startSummary(alice, channel.id, randomUUID())).rejects.toMatchObject({
        status: 403,
      });
    }
    const foreign = await domain.createWorkspace(alice, 'Other agents');
    workspaces.push(foreign.id);
    const foreignChannel = (
      await pool.query('select id from conversations where workspace_id=$1', [foreign.id])
    ).rows[0].id;
    const foreignAgent = (await domain.conversationAgents(alice, foreignChannel))[0];
    await expect(
      domain.startSummary(alice, conversation, randomUUID(), foreignAgent.agent_id),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('blocks publication if the selected agent is disabled during generation', async () => {
    const planner = (await domain.conversationAgents(alice, conversation)).find(
      (agent) => agent.key === 'planner',
    )!;
    const run = await domain.startSummary(alice, conversation, randomUUID(), planner.agent_id);
    const context = (await domain.prepareRun(run.id))!;
    await pool.query('update agent_definitions set enabled=false where agent_id=$1', [
      planner.agent_id,
    ]);
    try {
      expect(
        (await domain.conversationAgents(alice, conversation)).some(
          (agent) => agent.agent_id === planner.agent_id,
        ),
      ).toBe(false);
      await expect(
        domain.startSummary(alice, conversation, randomUUID(), planner.agent_id),
      ).rejects.toMatchObject({ status: 403 });
      await domain.completeRun(run.id, context.messages, {
        body: 'No late result',
        citations: [context.messages[0].id],
      });
      expect(
        (await pool.query('select status from agent_runs where id=$1', [run.id])).rows[0].status,
      ).toBe('cancelled');
      expect(
        (await pool.query('select 1 from messages where agent_run_id=$1', [run.id])).rowCount,
      ).toBe(0);
    } finally {
      await pool.query('update agent_definitions set enabled=true where agent_id=$1', [
        planner.agent_id,
      ]);
    }
  });
  it('enqueues idempotently and publishes one reply across concurrent completion', async () => {
    const requestId = randomUUID();
    const run = await domain.startSummary(alice, conversation, requestId);
    expect((await domain.startSummary(alice, conversation, requestId)).id).toBe(run.id);
    const context = await domain.prepareRun(run.id);
    expect(context).not.toBeNull();
    const output = await summarize(context!.messages, 'test');
    await Promise.all([
      domain.completeRun(run.id, context!.messages, output),
      domain.completeRun(run.id, context!.messages, output),
    ]);
    expect(
      (await pool.query('select count(*) from agent_results where run_id=$1', [run.id])).rows[0]
        .count,
    ).toBe('1');
    expect(
      (await pool.query('select count(*) from messages where agent_run_id=$1', [run.id])).rows[0]
        .count,
    ).toBe('0');
    await Promise.all([
      shareRun(alice, conversation, run.id),
      shareRun(alice, conversation, run.id),
    ]);
    expect(
      (await pool.query('select count(*) from messages where agent_run_id=$1', [run.id])).rows[0]
        .count,
    ).toBe('1');
  });
  it('rejects invented citations and source changes during generation', async () => {
    const run = await domain.startSummary(alice, conversation, randomUUID());
    const context = (await domain.prepareRun(run.id))!;
    await expect(
      domain.completeRun(run.id, context.messages, {
        body: 'Unsupported',
        citations: [randomUUID()],
      }),
    ).rejects.toThrow('unknown source');
    const source = context.messages.find((m) => m.author_id === alice)!;
    await domain.mutateMessage(
      alice,
      conversation,
      source.id,
      'Changed during generation',
      source.revision,
    );
    await expect(
      domain.completeRun(run.id, context.messages, { body: 'Old summary', citations: [source.id] }),
    ).rejects.toThrow('Source messages changed');
  });
  it('invalidates a completed summary when its source is edited', async () => {
    const source = await domain.sendMessage(
      alice,
      conversation,
      randomUUID(),
      'Decision: ship Friday',
    );
    const run = await domain.startSummary(alice, conversation, randomUUID());
    const context = (await domain.prepareRun(run.id))!;
    await domain.completeRun(run.id, context.messages, {
      body: 'Ship Friday',
      citations: [source.id],
    });
    await shareRun(alice, conversation, run.id);
    await domain.mutateMessage(alice, conversation, source.id, 'Decision: ship Monday', 1);
    const result = (await pool.query('select * from messages where agent_run_id=$1', [run.id]))
      .rows[0];
    expect(result.stale).toBe(true);
    expect(result.body).not.toContain('Friday');
  });
  it('cancels a pending run after requester or agent access is revoked', async () => {
    const run = await domain.startSummary(bob, conversation, randomUUID());
    const context = (await domain.prepareRun(run.id))!;
    await domain.changeMembership(alice, conversation, bob, false);
    await domain.completeRun(run.id, context.messages, {
      body: 'Hidden',
      citations: [context.messages[0].id],
    });
    expect(
      (await pool.query('select status from agent_runs where id=$1', [run.id])).rows[0].status,
    ).toBe('cancelled');
    expect(
      (await pool.query('select 1 from messages where agent_run_id=$1', [run.id])).rowCount,
    ).toBe(0);
    await domain.changeMembership(alice, conversation, bob, true);
  });
});
