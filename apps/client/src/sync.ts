import type { ConversationEvent, Message } from '../../../packages/contracts/src/index.js';
export function mergeMessages(current: Message[], updates: Message[]) {
  const map = new Map(current.map((m) => [m.id, m]));
  for (const update of updates) {
    const old = map.get(update.id);
    if (!old || update.revision >= old.revision) map.set(update.id, update);
  }
  return [...map.values()].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
}
export function advance(cursor: string, event: ConversationEvent) {
  if (BigInt(event.sequence) <= BigInt(cursor)) return cursor;
  if (BigInt(event.sequence) !== BigInt(cursor) + 1n)
    throw new Error('Event gap; reconnect to replay');
  return event.sequence;
}
export async function readEvents(
  response: Response,
  onEvent: (name: string, data: string) => void,
) {
  if (!response.body) throw new Error('Streaming is unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const lines = chunk.split('\n');
        const name =
          lines
            .find((l) => l.startsWith('event:'))
            ?.slice(6)
            .trim() || 'message';
        const data = lines
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n');
        if (data) onEvent(name, data);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
