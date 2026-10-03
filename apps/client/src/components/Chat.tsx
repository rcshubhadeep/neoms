import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ApiError,
  type Participant,
  type Conversation,
  type Message,
  type Snapshot,
  type ConversationEvent,
  type AgentRun,
} from '../../../../packages/contracts/src/index';
import {
  api,
  base,
  accessToken,
  cacheRead,
  cacheWrite,
  purgeConversation,
  type Pending,
} from '../client';
import { mergeMessages, advance, readEvents } from '../sync';
import { explain } from './shared';
export function Chat({
  me,
  channel,
  onMembers,
  onRevoked,
}: {
  me: Participant;
  channel: Conversation;
  onMembers: () => void;
  onRevoked: () => void;
}) {
  const key = `messages:${me.id}:${channel.id}`;
  const pendingKey = `pending:${me.id}:${channel.id}`;
  const [messages, setMessages] = useState<Message[]>(() => cacheRead(key, []));
  const [pending, setPending] = useState<Pending[]>(() => cacheRead(pendingKey, []));
  const [draft, setDraft] = useState(() => cacheRead(`draft:${me.id}:${channel.id}`, ''));
  const [status, setStatus] = useState('Connecting');
  const [error, setError] = useState('');
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [editing, setEditing] = useState<Message | null>(null);
  const [editBody, setEditBody] = useState('');
  const [summarizing, setSummarizing] = useState(false);
  const cursor = useRef('0');
  const revoked = useRef(false);
  const flushing = useRef(false);
  const pendingRef = useRef(pending);
  const bottom = useRef<HTMLDivElement>(null);
  const onRevokedRef = useRef(onRevoked);
  onRevokedRef.current = onRevoked;
  const updatePending = useCallback(
    (next: Pending[]) => {
      pendingRef.current = next;
      cacheWrite(pendingKey, next);
      setPending(next);
    },
    [pendingKey],
  );
  const denied = useCallback(() => {
    revoked.current = true;
    purgeConversation(me.id, channel.id);
    setMessages([]);
    updatePending([]);
    onRevokedRef.current();
  }, [me.id, channel.id, updatePending]);
  useEffect(() => {
    cacheWrite(key, messages);
  }, [key, messages]);
  useEffect(() => {
    cacheWrite(`draft:${me.id}:${channel.id}`, draft);
  }, [me.id, channel.id, draft]);
  const flush = useCallback(async () => {
    if (flushing.current || revoked.current) return;
    flushing.current = true;
    try {
      for (const item of [...pendingRef.current]) {
        try {
          const saved = await api<Message>(`/conversations/${channel.id}/messages`, {
            method: 'POST',
            body: JSON.stringify({ requestId: item.requestId, body: item.body }),
          });
          if (revoked.current) return;
          setMessages((old) => mergeMessages(old, [saved]));
          updatePending(pendingRef.current.filter((p) => p.requestId !== item.requestId));
        } catch (e) {
          if (e instanceof ApiError && e.status === 403) {
            denied();
            return;
          }
          updatePending(
            pendingRef.current.map((p) =>
              p.requestId === item.requestId ? { ...p, status: 'failed', error: explain(e) } : p,
            ),
          );
        }
      }
    } finally {
      flushing.current = false;
    }
  }, [channel.id, denied, updatePending]);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let snapshotReady = false;
    async function connect() {
      if (abort.signal.aborted || revoked.current) return;
      try {
        if (!snapshotReady) {
          const snap = await api<Snapshot>(`/conversations/${channel.id}/messages`, {
            signal: abort.signal,
          });
          if (abort.signal.aborted) return;
          setMessages(snap.messages);
          setHasMore(snap.hasMore);
          setRuns(snap.runs);
          cursor.current = snap.cursor;
          snapshotReady = true;
        }
        setStatus('Live');
        void flush();
        const response = await fetch(
          `${base}/v1/conversations/${channel.id}/events?after=${cursor.current}`,
          { headers: { Authorization: `Bearer ${await accessToken()}` }, signal: abort.signal },
        );
        if (!response.ok) throw new ApiError(response.status, 'Connection interrupted');
        await readEvents(response, (name, data) => {
          if (abort.signal.aborted) return;
          if (name === 'revoked') {
            denied();
            abort.abort();
            return;
          }
          if (name === 'reset') {
            snapshotReady = false;
            throw new Error('Refreshing conversation');
          }
          if (name !== 'change') return;
          const event = JSON.parse(data) as ConversationEvent;
          const next = advance(cursor.current, event);
          if (next === cursor.current) return;
          cursor.current = next;
          if (event.type === 'message.upsert') {
            const message = event.data as Message;
            setMessages((old) => mergeMessages(old, [message]));
            if (message.author_id === me.id)
              updatePending(pendingRef.current.filter((p) => p.requestId !== message.request_id));
          }
          if (event.type === 'run.updated') {
            const run = event.data as AgentRun;
            setRuns((old) => [run, ...old.filter((r) => r.id !== run.id)]);
          }
        });
      } catch (e) {
        if (abort.signal.aborted) return;
        if (e instanceof ApiError && e.status === 403) {
          denied();
          return;
        }
        if (e instanceof ApiError && e.status === 409) snapshotReady = false;
        setStatus('Reconnecting');
      } finally {
        if (!abort.signal.aborted && !revoked.current) timer = setTimeout(connect, 1200);
      }
    }
    void connect();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [channel.id, me.id, denied, flush, updatePending]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, pending.length]);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || revoked.current) return;
    updatePending([
      ...pendingRef.current,
      { requestId: crypto.randomUUID(), body: draft.trim(), status: 'sending' },
    ]);
    setDraft('');
    void flush();
  }
  async function summarize() {
    setSummarizing(true);
    setError('');
    try {
      const run = await api<AgentRun>(`/conversations/${channel.id}/runs`, {
        method: 'POST',
        body: JSON.stringify({ requestId: crypto.randomUUID() }),
      });
      setRuns((old) => [run, ...old.filter((r) => r.id !== run.id)]);
    } catch (e) {
      setError(explain(e));
    } finally {
      setSummarizing(false);
    }
  }
  async function mutate(message: Message, remove = false) {
    setError('');
    try {
      const updated = await api<Message>(`/conversations/${channel.id}/messages/${message.id}`, {
        method: remove ? 'DELETE' : 'PATCH',
        body: JSON.stringify({
          revision: message.revision,
          ...(!remove ? { body: editBody } : {}),
        }),
      });
      setMessages((old) => mergeMessages(old, [updated]));
      setEditing(null);
    } catch (e) {
      setError(explain(e));
    }
  }
  async function older() {
    try {
      const snap = await api<Snapshot>(
        `/conversations/${channel.id}/messages?before=${messages[0].id}`,
      );
      setMessages((old) => mergeMessages(old, snap.messages));
      setHasMore(snap.hasMore);
    } catch (e) {
      setError(explain(e));
    }
  }
  async function source(id: string) {
    try {
      if (!messages.some((m) => m.id === id)) {
        const row = await api<Message>(`/conversations/${channel.id}/messages/${id}`);
        setMessages((old) => mergeMessages(old, [row]));
      }
      setTimeout(
        () =>
          document
            .getElementById(`message-${id}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
        50,
      );
    } catch (e) {
      setError(explain(e));
    }
  }
  const activeRun = runs.find((r) => r.status === 'queued' || r.status === 'running');
  const failed = runs[0]?.status === 'failed' ? runs[0] : undefined;
  return (
    <>
      <header className="chat-header">
        <div>
          <p className="eyebrow">YOUR SHARED SPACE</p>
          <h1>
            <span>{channel.private ? '◇' : '#'}</span> {channel.name}
          </h1>
        </div>
        <div className="header-actions">
          <span className={`connection ${status === 'Live' ? 'live' : ''}`}>{status}</span>
          <button onClick={onMembers}>Members</button>
          <button
            className="summary-button"
            disabled={summarizing || !!activeRun}
            onClick={summarize}
          >
            ✳ {activeRun ? 'Summarizing…' : 'Catch me up'}
          </button>
        </div>
      </header>
      <div className="conversation">
        <div className="conversation-start">
          <div className="channel-symbol">#</div>
          <h2>This is {channel.name}.</h2>
          <p>A place to share ideas, make decisions, and keep things moving.</p>
          <span className="start-rule" />
        </div>
        {hasMore && (
          <button className="load-more" onClick={older}>
            Load earlier messages
          </button>
        )}
        {messages.map((message) => (
          <article
            className={`message ${message.author_kind === 'agent' ? 'agent-message' : ''} ${message.deleted_at ? 'deleted' : ''}`}
            id={`message-${message.id}`}
            key={message.id}
          >
            <span className={`avatar ${message.author_kind === 'agent' ? 'agent-avatar' : ''}`}>
              {message.author_kind === 'agent' ? '✳' : message.author_name[0]?.toUpperCase()}
            </span>
            <div className="message-content">
              <div className="message-meta">
                <strong>{message.author_name}</strong>
                {message.author_kind === 'agent' && <span className="agent-badge">ASSISTANT</span>}
                <time dateTime={message.created_at}>
                  {new Date(message.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
                {message.revision > 1 && !message.deleted_at && <small>edited</small>}
              </div>
              {editing?.id === message.id ? (
                <form
                  className="edit-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    mutate(message);
                  }}
                >
                  <textarea
                    aria-label="Edit message"
                    required
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                  />
                  <button className="primary">Save changes</button>
                  <button type="button" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <p>{message.deleted_at ? 'Message deleted' : message.body}</p>
              )}
              {message.citations.length > 0 && !message.stale && (
                <div className="citations">
                  <span>Sources</span>
                  {message.citations.map((id, i) => (
                    <button key={id} onClick={() => source(id)}>
                      ↗ {i + 1}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {message.author_id === me.id && !message.deleted_at && (
              <div className="message-actions">
                <button
                  aria-label={`Edit message ${message.body}`}
                  onClick={() => {
                    setEditing(message);
                    setEditBody(message.body);
                  }}
                >
                  Edit
                </button>
                <button
                  aria-label={`Delete message ${message.body}`}
                  onClick={() => mutate(message, true)}
                >
                  Delete
                </button>
              </div>
            )}
          </article>
        ))}
        {pending.map((item) => (
          <article className="message pending" key={item.requestId}>
            <span className="avatar">{me.name[0]?.toUpperCase()}</span>
            <div className="message-content">
              <div className="message-meta">
                <strong>{me.name}</strong>
                <small>{item.status === 'failed' ? 'Not saved' : 'Sending…'}</small>
              </div>
              <p>{item.body}</p>
              {item.status === 'failed' && (
                <button title={item.error} onClick={() => flush()}>
                  Retry send
                </button>
              )}
            </div>
          </article>
        ))}
        <div ref={bottom} />
      </div>
      <footer className="composer-area">
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {activeRun && (
          <div className="run-status">
            <span>
              ✳ Assistant is{' '}
              {activeRun.status === 'queued' ? 'waiting to start' : 'reading the conversation'}…
            </span>
            <button
              onClick={() =>
                api(`/conversations/${channel.id}/runs/${activeRun.id}/cancel`, {
                  method: 'POST',
                }).catch((e) => setError(explain(e)))
              }
            >
              Cancel
            </button>
          </div>
        )}
        {failed && !activeRun && (
          <p className="small error">
            Summary failed: {failed.error}. You can try Catch me up again.
          </p>
        )}
        <form className="composer" onSubmit={send}>
          <textarea
            aria-label={`Message ${channel.name}`}
            placeholder={`Message #${channel.name}`}
            value={draft}
            maxLength={8000}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="composer-bottom">
            <span>Plain text · Shift + Enter for a new line</span>
            <button aria-label="Send message" disabled={!draft.trim()}>
              Send ↑
            </button>
          </div>
        </form>
        <p className="composer-hint">A saved message stays here, even when you leave.</p>
      </footer>
    </>
  );
}
