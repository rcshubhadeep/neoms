import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import type {
  Participant,
  Workspace,
  Conversation,
} from '../../../../packages/contracts/src/index';
import { api, supabase, purgeConversation, purgeUser } from '../client';
import { explain, Mark } from './shared';
import { Chat } from './Chat';
export function WorkspaceApp({ session }: { session: Session }) {
  const [me, setMe] = useState<Participant>();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState('');
  const [channels, setChannels] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<
    'workspace' | 'join' | 'channel' | 'invite' | 'members' | null
  >(null);
  const [value, setValue] = useState('');
  const [privateChannel, setPrivate] = useState(false);
  const [members, setMembers] = useState<Participant[]>([]);
  const [channelMembers, setChannelMembers] = useState<Participant[]>([]);
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
      setSelected('');
      return;
    }
    try {
      const rows = await api<Conversation[]>(`/workspaces/${workspace}/conversations`);
      setChannels(rows);
      setSelected((old) => (rows.some((c) => c.id === old) ? old : rows[0]?.id || ''));
    } catch (e) {
      setError(explain(e));
    }
  }, [workspace]);
  useEffect(() => {
    api<Participant>('/me')
      .then(setMe)
      .catch((e) => setError(explain(e)));
    loadWorkspaces().catch((e) => setError(explain(e)));
  }, [loadWorkspaces]);
  useEffect(() => {
    loadChannels();
    const interval = setInterval(() => loadChannels(), 5000);
    return () => clearInterval(interval);
  }, [loadChannels]);
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
    } catch (e) {
      setError(explain(e));
    }
  }
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Mark />
          neoms<span className="preview">PREVIEW</span>
        </div>
        <div className="workspace-picker">
          <label className="sr-only" htmlFor="workspace">
            Workspace
          </label>
          <select
            id="workspace"
            value={workspace}
            onChange={(e) => {
              setSelected('');
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
          <div className="workspace-actions">
            <button onClick={() => open('workspace')}>New workspace</button>
            <button onClick={() => open('join')}>Join</button>
          </div>
        </div>
        <div className="sidebar-heading">
          CHANNELS
          {current?.role === 'owner' && (
            <button aria-label="Create channel" onClick={() => open('channel')}>
              +
            </button>
          )}
        </div>
        <nav aria-label="Channels">
          {channels.map((c) => (
            <button
              className={selected === c.id ? 'channel active' : 'channel'}
              key={c.id}
              onClick={() => setSelected(c.id)}
            >
              <span>{c.private ? '◇' : '#'}</span>
              {c.name}
            </button>
          ))}
        </nav>
        {current?.role === 'owner' && (
          <button className="invite-button" onClick={() => open('invite')}>
            ＋ Invite a teammate
          </button>
        )}
        <div className="sidebar-note">
          <span className="spark">✳</span>
          <strong>Context, kept together.</strong>
          <p>Your assistant only sees the channels it belongs to.</p>
        </div>
        <div className="profile">
          <span className="avatar">{(me?.name || session.user.email || '?')[0].toUpperCase()}</span>
          <div>
            <strong>{me?.name || 'Loading…'}</strong>
            <span>Personal account</span>
          </div>
          <button
            title="Sign out"
            aria-label="Sign out"
            onClick={async () => {
              if (me) purgeUser(me.id);
              await supabase.auth.signOut();
            }}
          >
            ↪
          </button>
        </div>
      </aside>
      <main className="main-panel">
        {error && !dialog && (
          <div role="alert" className="banner error">
            {error}
          </div>
        )}
        {channel && me ? (
          <Chat
            key={`${me.id}:${channel.id}`}
            me={me}
            channel={channel}
            onMembers={() => open('members')}
            onRevoked={() => {
              purgeConversation(me.id, channel.id);
              setSelected('');
              loadChannels();
            }}
          />
        ) : (
          <section className="empty-state">
            <span className="large-mark">✳</span>
            <p className="eyebrow">MAKE ROOM FOR GOOD WORK</p>
            <h1>{workspace ? 'Your conversations start here.' : 'A space for your next idea.'}</h1>
            <p>
              {workspace
                ? 'Choose a channel to get started.'
                : 'Create a workspace, or join your team with an invitation.'}
            </p>
            <button className="primary" onClick={() => open(workspace ? 'join' : 'workspace')}>
              {workspace ? 'Join another workspace' : 'Create a workspace'} ↗
            </button>
          </section>
        )}
      </main>
      {dialog && (
        <div className="modal-backdrop">
          <section role="dialog" aria-modal="true" aria-labelledby="dialog-title" className="modal">
            <button className="close" aria-label="Close dialog" onClick={() => setDialog(null)}>
              ×
            </button>
            <h2 id="dialog-title">
              {
                {
                  workspace: 'Create a workspace',
                  join: 'Join your team',
                  channel: 'Create a channel',
                  invite: 'Invite a teammate',
                  members: 'Channel members',
                }[dialog]
              }
            </h2>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            {dialog === 'invite' ? (
              <>
                <p>Share this single-use invitation token. It expires in seven days.</p>
                <textarea
                  aria-label="Invitation token"
                  readOnly
                  value={busy ? 'Creating invitation…' : value}
                />
                <p className="small muted">Your teammate can sign in and choose Join.</p>
              </>
            ) : dialog === 'members' ? (
              <div className="member-list">
                {members.map((m) => (
                  <div key={m.id}>
                    <span>
                      {m.name} {m.kind === 'agent' && <small>ASSISTANT</small>}
                    </span>
                    {current?.role === 'owner' ? (
                      <button disabled={m.id === me?.id} onClick={() => membership(m)}>
                        {channelMembers.some((cm) => cm.id === m.id) ? 'Remove' : 'Add'}
                      </button>
                    ) : (
                      <span>{channelMembers.some((cm) => cm.id === m.id) ? 'Member' : ''}</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <form onSubmit={submit}>
                <label>
                  {dialog === 'join' ? 'Invitation token' : 'Name'}
                  <input
                    autoFocus
                    required
                    maxLength={dialog === 'join' ? 128 : 80}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                </label>
                {dialog === 'channel' && (
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={privateChannel}
                      onChange={(e) => setPrivate(e.target.checked)}
                    />
                    Private channel
                  </label>
                )}
                <button className="primary" disabled={busy}>
                  {busy ? 'Saving…' : dialog === 'join' ? 'Join workspace' : 'Create'}
                </button>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
