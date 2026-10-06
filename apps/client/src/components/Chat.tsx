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
  type Agent,
  type RunPreview,
  type RunRequest,
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
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Dialog,
  Dot,
  IconButton,
  Kbd,
  SourceChip,
  Spinner,
} from './ui';
export function Chat({
  me,
  channel,
  agentAccessRevision,
  onMembers,
  onRevoked,
  onRead,
}: {
  me: Participant;
  channel: Conversation;
  agentAccessRevision: number;
  onMembers: () => void;
  onRevoked: () => void;
  onRead: (conversation: string, sequence: string) => void;
}) {
  const key = `messages:${me.id}:${channel.id}`;
  const pendingKey = `pending:${me.id}:${channel.id}`;
  const [messages, setMessages] = useState<Message[]>(() => cacheRead(key, []));
  const [pending, setPending] = useState<Pending[]>(() => cacheRead(pendingKey, []));
  const [draft, setDraft] = useState(() => cacheRead(`draft:${me.id}:${channel.id}`, ''));
  const [status, setStatus] = useState('Connecting');
  const [readPosition, setReadPosition] = useState<string>();
  const [error, setError] = useState('');
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const resultCount = runs.filter((run) => run.result).length;
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [editing, setEditing] = useState<Message | null>(null);
  const [editBody, setEditBody] = useState('');
  const [summarizing, setSummarizing] = useState(false);
  const [scopeMode, setScopeMode] = useState<'recent' | 'unread' | 'since'>('recent');
  const [since, setSince] = useState('');
  const [preview, setPreview] = useState<RunPreview>();
  const initialRead = useRef<string | undefined>(undefined);
  const cursor = useRef('0');
  const revoked = useRef(false);
  const flushing = useRef(false);
  const pendingRef = useRef(pending);
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const bottom = useRef<HTMLDivElement>(null);
  const onRevokedRef = useRef(onRevoked);
  onRevokedRef.current = onRevoked;
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  useEffect(() => {
    const abort = new AbortController();
    async function refreshResults() {
      for (const run of runsRef.current) {
        if (!run.result || abort.signal.aborted) continue;
        try {
          const updated = await api<AgentRun>(`/conversations/${channel.id}/runs/${run.id}`, {
            signal: abort.signal,
          });
          if (!abort.signal.aborted)
            setRuns((old) => old.map((row) => (row.id === run.id ? updated : row)));
        } catch {
          /* SSE handles membership revocation and reconnection. */
        }
      }
    }
    const timer = setInterval(() => void refreshResults(), 15000);
    window.addEventListener('focus', refreshResults);
    void refreshResults();
    return () => {
      abort.abort();
      clearInterval(timer);
      window.removeEventListener('focus', refreshResults);
    };
  }, [channel.id, agentAccessRevision]);
  useEffect(() => {
    const abort = new AbortController();
    async function loadAgents() {
      try {
        const rows = await api<Agent[]>(`/conversations/${channel.id}/agents`, {
          signal: abort.signal,
        });
        if (abort.signal.aborted) return;
        setAgents(rows);
        setSelectedAgent((old) =>
          rows.some((agent) => agent.agent_id === old)
            ? old
            : ((rows.find((agent) => agent.key === 'scribe') ?? rows[0])?.agent_id ?? ''),
        );
      } catch (e) {
        if (!abort.signal.aborted) setError(explain(e));
      }
    }
    void loadAgents();
    window.addEventListener('focus', loadAgents);
    return () => {
      abort.abort();
      window.removeEventListener('focus', loadAgents);
    };
  }, [channel.id, agentAccessRevision]);
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
    setRuns([]);
    setPreview(undefined);
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
          initialRead.current ??= snap.readSequence ?? '0';
          cursor.current = snap.cursor;
          setReadPosition(snap.cursor);
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
          setReadPosition(next);
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
    if (readPosition === undefined) return;
    let timer: ReturnType<typeof setTimeout>;
    let disposed = false;
    async function acknowledge() {
      if (
        disposed ||
        revoked.current ||
        document.visibilityState !== 'visible' ||
        !document.hasFocus()
      )
        return;
      try {
        await api(`/conversations/${channel.id}/read`, {
          method: 'POST',
          body: JSON.stringify({ sequence: readPosition }),
        });
        if (!disposed) onReadRef.current(channel.id, readPosition!);
      } catch {
        if (!disposed) timer = setTimeout(acknowledge, 1200);
      }
    }
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(acknowledge, 150);
    };
    schedule();
    window.addEventListener('focus', schedule);
    document.addEventListener('visibilitychange', schedule);
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener('focus', schedule);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [channel.id, readPosition]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, pending.length, resultCount]);
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
      const scope: NonNullable<RunRequest['scope']> = {
        mode: scopeMode,
        ...(scopeMode === 'unread' ? { afterSequence: initialRead.current ?? '0' } : {}),
        ...(scopeMode === 'since' ? { since: new Date(since).toISOString() } : {}),
      };
      const selection = await api<RunPreview>(`/conversations/${channel.id}/runs/preview`, {
        method: 'POST',
        body: JSON.stringify({ requestId: crypto.randomUUID(), agentId: selectedAgent, scope }),
      });
      if (selection.coverage.omittedMessages) setPreview(selection);
      else await startRun(selection);
    } catch (e) {
      setError(explain(e));
    } finally {
      setSummarizing(false);
    }
  }
  async function startRun(selection: RunPreview) {
    setSummarizing(true);
    try {
      const run = await api<AgentRun>(`/conversations/${channel.id}/runs`, {
        method: 'POST',
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          agentId: selection.agentId,
          scope: selection.scope,
          selectionHash: selection.selectionHash,
          allowPartial: true,
        }),
      });
      setRuns((old) => [run, ...old.filter((r) => r.id !== run.id)]);
      setPreview(undefined);
    } catch (e) {
      setError(explain(e));
      setPreview(undefined);
    } finally {
      setSummarizing(false);
    }
  }
  async function share(run: AgentRun) {
    try {
      const message = await api<Message>(`/conversations/${channel.id}/runs/${run.id}/share`, {
        method: 'POST',
      });
      setMessages((old) => mergeMessages(old, [message]));
      const updated = await api<AgentRun>(`/conversations/${channel.id}/runs/${run.id}`);
      setRuns((old) => old.map((row) => (row.id === run.id ? updated : row)));
    } catch (e) {
      setError(explain(e));
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
  const choice = agents.find((agent) => agent.agent_id === selectedAgent);
  const activeAgentName =
    agents.find((agent) => agent.agent_id === activeRun?.agent_id)?.name ?? 'Agent';
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
          {agents.length > 0 && (
            <select
              className="input agent-picker"
              aria-label="Choose an agent"
              value={selectedAgent}
              disabled={summarizing || !!activeRun}
              onChange={(event) => setSelectedAgent(event.target.value)}
            >
              {agents.map((agent) => (
                <option key={agent.agent_id} value={agent.agent_id}>
                  {agent.name}
                </option>
              ))}
            </select>
          )}
          <Button
            variant="signal"
            size="sm"
            icon={activeRun ? <Spinner /> : <Sparkles />}
            disabled={summarizing || !!activeRun || !choice || (scopeMode === 'since' && !since)}
            title={!choice ? 'Add an agent through Members to run it here' : undefined}
            onClick={summarize}
          >
            {activeRun
              ? 'Working…'
              : choice?.operation === 'suggest_actions'
                ? 'Suggest actions'
                : 'Catch me up'}
          </Button>
        </div>
      </header>
      <div className="run-controls">
        <label>
          Agent scope{' '}
          <select
            className="input"
            aria-label="Agent scope"
            value={scopeMode}
            onChange={(e) => setScopeMode(e.target.value as typeof scopeMode)}
          >
            <option value="recent">Recent messages</option>
            <option value="unread">Unread when opened</option>
            <option value="since">Since a date</option>
          </select>
        </label>
        {scopeMode === 'since' && (
          <input
            className="input"
            type="datetime-local"
            aria-label="Scope start date"
            value={since}
            onChange={(e) => setSince(e.target.value)}
          />
        )}
        <span className="t-meta">Results are private until you post them.</span>
      </div>
      {preview && (
        <Dialog title="Confirm limited coverage" onClose={() => setPreview(undefined)}>
          <p>
            The agent can read {preview.coverage.selectedMessages} of{' '}
            {preview.coverage.totalMessages} messages in this scope.{' '}
            {preview.coverage.omittedMessages} are excluded by the history, message, or context
            limits.
          </p>
          <p>
            Covered: {preview.coverage.from && new Date(preview.coverage.from).toLocaleString()} –{' '}
            {preview.coverage.to && new Date(preview.coverage.to).toLocaleString()}.
          </p>
          <Button variant="primary" disabled={summarizing} onClick={() => startRun(preview)}>
            Run with this coverage
          </Button>
        </Dialog>
      )}
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
        {runs
          .filter((run) => run.result)
          .reverse()
          .map((run) => (
            <article key={run.id} className="message message--agent message--private">
              <Avatar
                name={agents.find((agent) => agent.agent_id === run.agent_id)?.name ?? 'Agent'}
                kind="agent"
              />
              <div>
                <div className="message__meta">
                  <strong>
                    {agents.find((agent) => agent.agent_id === run.agent_id)?.name ?? 'Agent'} ·
                    Private result
                  </strong>
                  <Badge>Only you</Badge>
                </div>
                <p className="message__body">{run.result!.body}</p>
                {run.coverage && (
                  <p className="t-meta">
                    Covered {run.coverage.selectedMessages} of {run.coverage.totalMessages} messages
                    {run.coverage.omittedMessages
                      ? ` · ${run.coverage.omittedMessages} omitted`
                      : ''}{' '}
                    · {run.coverage.from && new Date(run.coverage.from).toLocaleString()} –{' '}
                    {run.coverage.to && new Date(run.coverage.to).toLocaleString()}
                  </p>
                )}
                {run.result!.stale ? (
                  <Badge tone="warning">Result unavailable or sources changed</Badge>
                ) : (
                  <>
                    <div className="citations">
                      {run.result!.citations.map((id, i) => (
                        <SourceChip
                          key={id}
                          mark={<Quote />}
                          label={`Message ${i + 1}`}
                          onClick={() => source(id)}
                        />
                      ))}
                    </div>
                    <p className="t-meta">
                      Private copy expires {new Date(run.result!.expires_at).toLocaleString()}
                    </p>
                    <Button
                      size="sm"
                      disabled={!!run.result!.shared_message_id}
                      onClick={() => share(run)}
                    >
                      {run.result!.shared_message_id
                        ? 'Posted to conversation'
                        : 'Post to conversation'}
                    </Button>
                  </>
                )}
              </div>
            </article>
          ))}
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
            <Avatar name={activeAgentName} kind="agent" size="xs" />
            <span>
              <strong>{activeAgentName}</strong>{' '}
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
          <Callout tone="danger">Agent run failed: {failed.error}. You can try again.</Callout>
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
