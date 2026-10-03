import { describe, it, expect } from 'vitest';
import { advance, mergeMessages, readEvents } from '../../apps/client/src/sync.js';
import type { Message, ConversationEvent } from '../../packages/contracts/src/index.js';
const message = (revision: number, body: string) =>
  ({ id: '1', revision, body, created_at: '2026-10-02T00:00:00Z' }) as Message;
const event = (sequence: string) => ({ sequence, type: 'noop', data: {} }) as ConversationEvent;
describe('client replay', () => {
  it('does not roll an edited message back when an older event arrives', () => {
    expect(mergeMessages([message(2, 'edited')], [message(1, 'original')])[0].body).toBe('edited');
  });
  it('deduplicates delivery and refuses to skip a missing event', () => {
    expect(advance('10', event('10'))).toBe('10');
    expect(advance('10', event('11'))).toBe('11');
    expect(() => advance('10', event('12'))).toThrow('Event gap');
  });
  it('parses an event split across network chunks', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(c) {
        for (const chunk of [
          'event: cha',
          'nge\ndata: {"sequence":"1"}\n',
          '\nevent: heartbeat\ndata: {}\n\n',
        ])
          c.enqueue(encoder.encode(chunk));
        c.close();
      },
    });
    const events: string[] = [];
    await readEvents(new Response(stream), (name, data) => events.push(`${name}:${data}`));
    expect(events).toEqual(['change:{"sequence":"1"}', 'heartbeat:{}']);
  });
});
