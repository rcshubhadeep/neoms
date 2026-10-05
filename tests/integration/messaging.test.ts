import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { pool, transaction, startQueue, boss } from '../../packages/db/src/index.js';
import * as domain from '../../packages/domain/src/index.js';
import { app } from '../../apps/server/src/app.js';
import { summarize } from '../../apps/worker/src/provider.js';
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
