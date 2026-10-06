import { useCallback, useEffect, useState, useRef, type FormEvent } from 'react';
import {
  ChevronsUpDown,
  Copy,
  Hash,
  Lock,
  LogIn,
  LogOut,
  Plus,
  UserPlus,
  Settings,
  MessageSquare,
} from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import type {
  Participant,
  Workspace,
  Conversation,
  Member,
} from '../../../../packages/contracts/src/index';
import { api, supabase, purgeConversation, purgeUser } from '../client';
import { explain } from './shared';
import { Avatar, Badge, Button, Callout, Dialog, Field, IconButton, Mark, TextArea } from './ui';
import { Chat } from './Chat';
import { WorkspaceSettings } from './WorkspaceSettings';
export function WorkspaceApp({ session }: { session: Session }) {
  const [me, setMe] = useState<Participant>();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState('');
  const [channels, setChannels] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState('');
  const [settings, setSettings] = useState(false);
  const [people, setPeople] = useState<Member[]>([]);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const channelsRef = useRef(channels);
  const readThrough = useRef<Record<string, string>>({});
  channelsRef.current = channels;
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<
    'workspace' | 'join' | 'channel' | 'invite' | 'members' | null
  >(null);
  const [value, setValue] = useState('');
  const [privateChannel, setPrivate] = useState(false);
  const [members, setMembers] = useState<Participant[]>([]);
  const [channelMembers, setChannelMembers] = useState<Participant[]>([]);
  const [agentAccessRevision, setAgentAccessRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const current = workspaces.find((w) => w.id === workspace);
  const channel = channels.find((c) => c.id === selected);
  const loadWorkspaces = useCallback(async () => {
    const rows = await api<Workspace[]>('/workspaces');
    setWorkspaces(rows);
    setWorkspace((old) => (rows.some((w) => w.id === old) ? old : rows[0]?.id || ''));
  }, []);
  const loadChannels = useCallback(async () => {
    if (!workspace) {
      setChannels([]);
      setPeople([]);
      setSelected('');
      return;
    }
    try {
      const [rows, directory] = await Promise.all([
        api<Conversation[]>(`/workspaces/${workspace}/conversations`),
        api<Member[]>(`/workspaces/${workspace}/members`),
      ]);
      if (workspaceRef.current !== workspace) return;
      for (const old of channelsRef.current)
        if (old.workspace_id === workspace && !rows.some((c) => c.id === old.id) && me)
          purgeConversation(me.id, old.id);
      setPeople(directory.filter((m) => m.enabled));
      setChannels(
        rows.map((row) =>
          row.sequence && BigInt(readThrough.current[row.id] || '0') >= BigInt(row.sequence)
            ? { ...row, unread: false }
            : row,
        ),
      );
      setSelected((old) => (rows.some((c) => c.id === old) ? old : rows[0]?.id || ''));
    } catch (e) {
      if (workspaceRef.current !== workspace) return;
      if (e instanceof Error && 'status' in e && e.status === 403) {
        for (const old of channelsRef.current)
          if (old.workspace_id === workspace && me) purgeConversation(me.id, old.id);
        setChannels([]);
        setPeople([]);
        setSelected('');
        setSettings(false);
        await loadWorkspaces();
      } else setError(explain(e));
    }
  }, [workspace, me, loadWorkspaces]);
  const onRead = useCallback((conversation: string, sequence: string) => {
    const previous = readThrough.current[conversation] || '0';
    if (BigInt(sequence) > BigInt(previous)) readThrough.current[conversation] = sequence;
    setChannels((rows) =>
      rows.map((row) =>
        row.id === conversation && row.sequence && BigInt(row.sequence) <= BigInt(sequence)
          ? { ...row, unread: false }
          : row,
      ),
    );
  }, []);
  useEffect(() => {
    api<Participant>('/me')
      .then(setMe)
      .catch((e) => setError(explain(e)));
    loadWorkspaces().catch((e) => setError(explain(e)));
  }, [loadWorkspaces]);
  useEffect(() => {
    loadChannels();
    const interval = setInterval(() => {
      void loadChannels();
      void loadWorkspaces().catch((e) => setError(explain(e)));
    }, 5000);
    return () => clearInterval(interval);
  }, [loadChannels, loadWorkspaces]);
  async function messagePerson(person: Member) {
    setError('');
    try {
      const row = await api<Conversation>(`/workspaces/${workspace}/dms`, {
        method: 'POST',
        body: JSON.stringify({ participantId: person.id }),
      });
      await loadChannels();
      setSelected(row.id);
      setSettings(false);
    } catch (e) {
      setError(explain(e));
    }
  }
  async function open(which: typeof dialog) {
    setError('');
    setValue('');
    setPrivate(false);
    setDialog(which);
    if (which === 'invite') {
      try {
        setBusy(true);
        const result = await api<{ token: string }>(`/workspaces/${workspace}/invitations`, {
          method: 'POST',
        });
        setValue(result.token);
      } catch (e) {
        setError(explain(e));
      } finally {
        setBusy(false);
      }
    }
    if (which === 'members') {
      try {
        const [all, inChannel] = await Promise.all([
          api<Participant[]>(`/workspaces/${workspace}/members`),
          api<Participant[]>(`/conversations/${selected}/members`),
        ]);
        setMembers(all);
        setChannelMembers(inChannel);
      } catch (e) {
        setError(explain(e));
      }
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (dialog === 'workspace') {
        const row = await api<Workspace>('/workspaces', {
          method: 'POST',
          body: JSON.stringify({ name: value }),
        });
        await loadWorkspaces();
        setWorkspace(row.id);
      }
      if (dialog === 'join') {
        const row = await api<{ workspaceId: string }>('/invitations/accept', {
          method: 'POST',
          body: JSON.stringify({ token: value.trim() }),
        });
        await loadWorkspaces();
        setWorkspace(row.workspaceId);
      }
      if (dialog === 'channel') {
        const row = await api<Conversation>(`/workspaces/${workspace}/conversations`, {
          method: 'POST',
          body: JSON.stringify({ name: value, private: privateChannel }),
        });
        await loadChannels();
        setSelected(row.id);
      }
      setDialog(null);
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  }
  async function membership(participant: Participant) {
    const exists = channelMembers.some((m) => m.id === participant.id);
    try {
      await api(`/conversations/${selected}/members/${participant.id}`, {
        method: exists ? 'DELETE' : 'POST',
      });
      setChannelMembers(await api<Participant[]>(`/conversations/${selected}/members`));
      setAgentAccessRevision((revision) => revision + 1);
    } catch (e) {
      setError(explain(e));
    }
  }
  const titles = {
    workspace: 'Create a workspace',
    join: 'Join your team',
    channel: 'Create a channel',
    invite: 'Invite a teammate',
    members: 'Channel members',
  };
  const descriptions = {
    workspace: 'A home for your team’s channels, people, and agents.',
    join: 'Paste the invitation token a teammate shared with you.',
    channel: 'Channels keep a topic and its context in one place.',
    invite: 'Share this single-use token. It expires in seven days.',
    members: channel ? `Who can read and post in ${channel.name}.` : undefined,
  };
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar__workspace">
          <Mark />
          <label className="sr-only" htmlFor="workspace">
            Workspace
          </label>
          <div className="select">
            <select
              id="workspace"
              value={workspace}
              onChange={(e) => {
                setSelected('');
                setChannels([]);
                setPeople([]);
                setSettings(false);
                setWorkspace(e.target.value);
              }}
            >
              {!workspaces.length && <option value="">Your workspace</option>}
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <ChevronsUpDown aria-hidden />
          </div>
        </div>
        <div className="sidebar__actions">
          <Button variant="ghost" size="sm" icon={<Plus />} onClick={() => open('workspace')}>
            New workspace
          </Button>
          <Button variant="ghost" size="sm" icon={<LogIn />} onClick={() => open('join')}>
            Join
          </Button>
        </div>
        <div className="sidebar__scroll">
          <section className="sidebar__section">
            <div className="sidebar__heading">
              <span className="t-label">Channels</span>
              {current && (
                <IconButton label="Create channel" size="xs" onClick={() => open('channel')}>
                  <Plus />
                </IconButton>
              )}
            </div>
            <nav aria-label="Channels">
              {channels
                .filter((c) => c.kind === 'channel')
                .map((c) => (
                  <button
                    className={`nav-item${c.unread ? ' nav-item--unread' : ''}`}
                    data-unread={c.unread || undefined}
                    aria-description={c.unread ? 'Unread messages' : undefined}
                    aria-current={!settings && selected === c.id ? 'page' : undefined}
                    key={c.id}
                    onClick={() => {
                      setSelected(c.id);
                      setSettings(false);
                    }}
                  >
                    {c.private ? <Lock aria-hidden /> : <Hash aria-hidden />}
                    <span>
                      {c.name}
                      {c.private && <span className="sr-only"> (private)</span>}
                    </span>
                    {c.unread && <span className="nav-item__unread" aria-hidden />}
                  </button>
                ))}
              {current && (
                <button className="nav-item" onClick={() => open('channel')}>
                  <Plus aria-hidden />
                  <span>New channel</span>
                </button>
              )}
              {current && current.role !== 'member' && (
                <button className="nav-item" onClick={() => open('invite')}>
                  <UserPlus aria-hidden />
                  <span>Invite a teammate</span>
                </button>
              )}
            </nav>
          </section>
          {current && (
            <section className="sidebar__section">
              <div className="sidebar__heading">
                <span className="t-label">Direct messages</span>
              </div>
              <nav aria-label="Direct messages">
                {channels
                  .filter((c) => c.kind === 'dm')
                  .map((c) => (
                    <button
                      className={`nav-item${c.unread ? ' nav-item--unread' : ''}`}
                      data-unread={c.unread || undefined}
                      aria-description={c.unread ? 'Unread messages' : undefined}
                      key={c.id}
                      aria-current={!settings && selected === c.id ? 'page' : undefined}
                      onClick={() => {
                        setSelected(c.id);
                        setSettings(false);
                      }}
                    >
                      <MessageSquare aria-hidden />
                      <span>{c.name}</span>
                      {c.unread && <span className="nav-item__unread" aria-hidden />}
                    </button>
                  ))}
              </nav>
            </section>
          )}
          {current && (
            <section className="sidebar__section">
              <div className="sidebar__heading">
                <span className="t-label">People</span>
              </div>
              <nav aria-label="Workspace members">
                {people.map((p) => (
                  <button
                    className="nav-item"
                    key={p.id}
                    disabled={p.id === me?.id || p.kind === 'agent'}
                    aria-label={
                      p.id === me?.id
                        ? `${p.name} (you)`
                        : p.kind === 'agent'
                          ? `${p.name} (agent)`
                          : `Message ${p.name}`
                    }
                    onClick={() => messagePerson(p)}
                  >
                    <Avatar name={p.name} kind={p.kind} size="xs" />
                    <span>
                      {p.name}
                      {p.id === me?.id ? ' (you)' : ''}
                    </span>
                    {p.kind === 'agent' && <Badge>Agent</Badge>}
                  </button>
                ))}
              </nav>
            </section>
          )}
          {current && current.role !== 'member' && (
            <section className="sidebar__section">
              <button
                className="nav-item"
                aria-current={settings ? 'page' : undefined}
                onClick={() => {
                  setSettings(true);
                  setDialog(null);
                  setError('');
                }}
              >
                <Settings aria-hidden />
                <span>Workspace settings</span>
              </button>
            </section>
          )}
        </div>
        <div className="sidebar__profile">
          <Avatar name={me?.name || session.user.email || '?'} />
          <div>
            <strong>{me?.name || 'Loading…'}</strong>
            <span>{session.user.email}</span>
          </div>
          <IconButton
            label="Sign out"
            size="sm"
            onClick={async () => {
              if (me) purgeUser(me.id);
              await supabase.auth.signOut();
            }}
          >
            <LogOut />
          </IconButton>
        </div>
      </aside>
      <main className="main">
        {error && !dialog && <Callout tone="danger">{error}</Callout>}
        {settings && current && current.role !== 'member' && me ? (
          <WorkspaceSettings
            key={current.id}
            workspace={current}
            me={me.id}
            onBack={() => setSettings(false)}
            onChanged={() => {
              void loadWorkspaces();
              void loadChannels();
            }}
          />
        ) : channel && me ? (
          <Chat
            key={`${me.id}:${channel.id}`}
            me={me}
            channel={channel}
            agentAccessRevision={agentAccessRevision}
            onRead={onRead}
            onMembers={() => open('members')}
            onRevoked={() => {
              purgeConversation(me.id, channel.id);
              setSelected('');
              loadChannels();
            }}
          />
        ) : (
          <section className="empty">
            <Mark size={40} />
            <h1 className="t-display">
              {workspace ? 'Your conversations start here.' : 'A space for your next idea.'}
            </h1>
            <p>
              {workspace
                ? 'Choose a channel to get started.'
                : 'Create a workspace, or join your team with an invitation.'}
            </p>
            <Button
              variant="primary"
              size="lg"
              pill
              onClick={() => open(workspace ? 'join' : 'workspace')}
            >
              {workspace ? 'Join another workspace' : 'Create a workspace'}
            </Button>
          </section>
        )}
      </main>
      {dialog && (
        <Dialog
          title={titles[dialog]}
          description={descriptions[dialog]}
          onClose={() => setDialog(null)}
        >
          {error && <Callout tone="danger">{error}</Callout>}
          {dialog === 'invite' ? (
            <>
              <TextArea
                label="Invitation token"
                readOnly
                value={busy ? 'Creating invitation…' : value}
              />
              <div className="copy-row">
                <span>Your teammate signs in and chooses Join.</span>
                <Button
                  size="sm"
                  icon={<Copy />}
                  disabled={busy || !value}
                  onClick={() => navigator.clipboard?.writeText(value)}
                >
                  Copy
                </Button>
              </div>
            </>
          ) : dialog === 'members' ? (
            <div className="member-list">
              {(channel?.kind === 'dm' ? channelMembers : members).map((m) => {
                const inChannel = channelMembers.some((cm) => cm.id === m.id);
                return (
                  <div key={m.id}>
                    <Avatar name={m.name} kind={m.kind} size="sm" />
                    <span>
                      {m.name} {m.kind === 'agent' && <Badge>Agent</Badge>}
                    </span>
                    {channel?.kind !== 'dm' &&
                    (current?.role !== 'member' || channel?.created_by === me?.id) ? (
                      <Button
                        size="sm"
                        variant={inChannel ? 'ghost' : 'secondary'}
                        disabled={m.id === me?.id}
                        onClick={() => membership(m)}
                      >
                        {inChannel ? 'Remove' : 'Add'}
                      </Button>
                    ) : (
                      inChannel && <Badge outline>Member</Badge>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <form onSubmit={submit}>
              <Field
                label={dialog === 'join' ? 'Invitation token' : 'Name'}
                autoFocus
                required
                maxLength={dialog === 'join' ? 128 : 80}
                placeholder={dialog === 'channel' ? 'e.g. launch-planning' : undefined}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
              {dialog === 'channel' && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={privateChannel}
                    onChange={(e) => setPrivate(e.target.checked)}
                  />
                  Private channel
                </label>
              )}
              <Button variant="primary" block disabled={busy}>
                {busy ? 'Saving…' : dialog === 'join' ? 'Join workspace' : 'Create'}
              </Button>
            </form>
          )}
        </Dialog>
      )}
    </div>
  );
}
