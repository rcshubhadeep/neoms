import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowUp,
  Hash,
  Lock,
  Pencil,
  Quote,
  Sparkles,
  Trash2,
  Users,
  MessageSquare,
} from 'lucide-react';
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
import { Avatar, Badge, Button, Callout, Dot, IconButton, Kbd, SourceChip, Spinner } from './ui';
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
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = (iso: string) => {
    const date = new Date(iso);
    const today = new Date();
    const yesterday = new Date(today.getTime() - 864e5);
    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  };
  const direct = channel.kind === 'dm';
  const ChannelIcon = direct ? MessageSquare : channel.private ? Lock : Hash;
  return (
    <>
      <header className="chat-header">
        <h1>
          <ChannelIcon aria-hidden />
          {channel.name}
          {channel.private && !direct && <span className="sr-only"> (private)</span>}
        </h1>
        <div className="chat-header__actions">
          <span className="connection">
            <Dot state={status === 'Live' ? 'live' : 'waiting'} />
            {status}
          </span>
          <Button variant="ghost" size="sm" icon={<Users />} onClick={onMembers}>
            Members
          </Button>
          {!direct && (
            <Button
              variant="signal"
              size="sm"
              icon={activeRun ? <Spinner /> : <Sparkles />}
              disabled={summarizing || !!activeRun}
              onClick={summarize}
            >
              {activeRun ? 'Summarizing…' : 'Catch me up'}
            </Button>
          )}
        </div>
      </header>
      <div className="conversation">
        <div className="conversation-start">
          <span className="conversation-start__icon">
            <ChannelIcon aria-hidden />
          </span>
          <h2 className="t-title">
            {direct
              ? `Your conversation with ${channel.name}`
              : `This is the start of ${channel.name}`}
          </h2>
          <p>
            {direct
              ? 'Only the two participants can read and post here. Assistants are not added to direct messages.'
              : 'Messages here stay put, even when you’re away. Agents in this channel only see what is shared in it.'}
          </p>
        </div>
        {hasMore && (
          <div className="load-more">
            <Button variant="ghost" size="sm" onClick={older}>
              Load earlier messages
            </Button>
          </div>
        )}
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const newDay = !previous || day(previous.created_at) !== day(message.created_at);
          const continued =
            !newDay &&
            previous.author_id === message.author_id &&
            message.author_kind === 'human' &&
            !previous.deleted_at &&
            Date.parse(message.created_at) - Date.parse(previous.created_at) < 5 * 60e3;
          const agent = message.author_kind === 'agent';
          return (
            <div key={message.id}>
              {newDay && (
                <div className="divider" role="separator">
                  {day(message.created_at)}
                </div>
              )}
              <article
                className={[
                  'message',
                  agent && 'message--agent',
                  continued && 'message--continued',
                  message.deleted_at && 'message--deleted',
                ]
                  .filter(Boolean)
                  .join(' ')}
                id={`message-${message.id}`}
              >
                {continued ? (
                  <time className="message__gutter" dateTime={message.created_at}>
                    {time(message.created_at).replace(/\s?[AP]M$/i, '')}
                  </time>
                ) : (
                  <Avatar name={message.author_name} kind={message.author_kind} />
                )}
                <div>
                  {!continued && (
                    <div className="message__meta">
                      <strong>{message.author_name}</strong>
                      {agent && <Badge>Agent</Badge>}
                      <time dateTime={message.created_at}>{time(message.created_at)}</time>
                      {message.revision > 1 && !message.deleted_at && <small>edited</small>}
                    </div>
                  )}
                  {editing?.id === message.id ? (
                    <form
                      className="edit-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        mutate(message);
                      }}
                    >
                      <textarea
                        className="input"
                        aria-label="Edit message"
                        required
                        autoFocus
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                      />
                      <div>
                        <Button variant="primary" size="sm">
                          Save changes
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          type="button"
                          onClick={() => setEditing(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <p className="message__body">
                      {message.deleted_at ? 'Message deleted' : message.body}
                    </p>
                  )}
                  {message.citations.length > 0 &&
                    (message.stale ? (
                      <div className="citations">
                        <Badge tone="warning">Sources changed since this summary</Badge>
                      </div>
                    ) : (
                      <div className="citations">
                        <span className="t-meta">Sources</span>
                        {message.citations.map((id, i) => (
                          <SourceChip
                            key={id}
                            mark={<Quote />}
                            label={`Message ${i + 1}`}
                            onClick={() => source(id)}
                          />
                        ))}
                      </div>
                    ))}
                </div>
                {message.author_id === me.id &&
                  !message.deleted_at &&
                  editing?.id !== message.id && (
                    <div className="message__actions">
                      <IconButton
                        size="xs"
                        label={`Edit message ${message.body}`}
                        title="Edit"
                        onClick={() => {
                          setEditing(message);
                          setEditBody(message.body);
                        }}
                      >
                        <Pencil />
                      </IconButton>
                      <IconButton
                        size="xs"
                        label={`Delete message ${message.body}`}
                        title="Delete"
                        onClick={() => mutate(message, true)}
                      >
                        <Trash2 />
                      </IconButton>
                    </div>
                  )}
              </article>
            </div>
          );
        })}
        {pending.map((item) => (
          <article
            className={`message message--pending ${item.status === 'failed' ? 'message--failed' : ''}`}
            key={item.requestId}
          >
            <Avatar name={me.name} />
            <div>
              <div className="message__meta">
                <strong>{me.name}</strong>
                <small>
                  {item.status === 'failed' ? (
                    'Not saved'
                  ) : (
                    <>
                      <Spinner /> Sending
                    </>
                  )}
                </small>
              </div>
              <p className="message__body">{item.body}</p>
              {item.status === 'failed' && (
                <Button variant="secondary" size="sm" title={item.error} onClick={() => flush()}>
                  Retry send
                </Button>
              )}
            </div>
          </article>
        ))}
        <div ref={bottom} />
      </div>
      <footer className="composer-area">
        {error && <Callout tone="danger">{error}</Callout>}
        {activeRun && (
          <div className="run-status" role="status">
            <Avatar name="Assistant" kind="agent" size="xs" />
            <span>
              <strong>Assistant</strong>{' '}
              {activeRun.status === 'queued'
                ? 'is waiting to start'
                : 'is reading the conversation'}
            </span>
            <Spinner />
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                api(`/conversations/${channel.id}/runs/${activeRun.id}/cancel`, {
                  method: 'POST',
                }).catch((e) => setError(explain(e)))
              }
            >
              Cancel
            </Button>
          </div>
        )}
        {failed && !activeRun && (
          <Callout tone="danger">
            Summary failed: {failed.error}. You can try Catch me up again.
          </Callout>
        )}
        <form className="composer" onSubmit={send}>
          <textarea
            aria-label={`Message ${channel.name}`}
            placeholder={`Message ${channel.private ? '' : '#'}${channel.name}`}
            value={draft}
            maxLength={8000}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="composer__bar">
            <span className="composer__hint">
              <Kbd>⏎</Kbd> to send <Kbd>⇧</Kbd>
              <Kbd>⏎</Kbd> for a new line
            </span>
            <button className="send-btn" aria-label="Send message" disabled={!draft.trim()}>
              <ArrowUp aria-hidden />
            </button>
          </div>
        </form>
      </footer>
    </>
  );
}
