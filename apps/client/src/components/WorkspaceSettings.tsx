import { useCallback, useEffect, useState, useRef, useId, type FormEvent } from 'react';
import { ArrowLeft, Copy, KeyRound, Mail, Settings, Users, ChartNoAxesColumn } from 'lucide-react';
import type {
  Invitation,
  LlmSettings,
  ModelList,
  Member,
  UsageReport,
  Workspace,
} from '../../../../packages/contracts/src/index';
import { api } from '../client';
import { explain } from './shared';
import { Avatar, Badge, Button, Callout, Field, Spinner } from './ui';
import { AgentPolicySettings } from './AgentPolicySettings';

type Tab = 'members' | 'invitations' | 'llm' | 'usage' | 'agent-policy';
export function WorkspaceSettings({
  workspace,
  me,
  onBack,
  onChanged,
}: {
  workspace: Workspace;
  me: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<Tab>('members');
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [config, setConfig] = useState<LlmSettings>();
  const [usage, setUsage] = useState<UsageReport>();
  const [provider, setProvider] = useState<LlmSettings['provider']>('test');
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [tokenLimitParameter, setTokenLimitParameter] =
    useState<LlmSettings['tokenLimitParameter']>('max_completion_tokens');
  const [models, setModels] = useState<string[]>([]);
  const [modelNotice, setModelNotice] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);
  const modelGeneration = useRef(0);
  const modelListId = useId();
  const [model, setModel] = useState('deterministic');
  const [key, setKey] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadedTab, setLoadedTab] = useState<Tab | null>(null);
  const loadGeneration = useRef(0);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const root = `/workspaces/${workspace.id}`;
  const load = useCallback(async () => {
    if (tab === 'agent-policy') {
      setLoadedTab(tab);
      return;
    }
    const generation = ++loadGeneration.current;
    const result = await api<Member[] | Invitation[] | UsageReport | LlmSettings>(
      `${root}/${tab === 'llm' ? 'llm' : tab === 'usage' ? 'usage' : tab === 'members' ? 'members' : 'invitations'}`,
    );
    if (generation !== loadGeneration.current || tabRef.current !== tab) return;
    if (tab === 'members') setMembers(result as Member[]);
    if (tab === 'invitations') setInvites(result as Invitation[]);
    if (tab === 'usage') setUsage(result as UsageReport);
    if (tab === 'llm') {
      const row = result as LlmSettings;
      setConfig(row);
      setProvider(row.provider);
      setModel(row.model);
      setBaseUrl(row.baseUrl || 'https://api.openai.com/v1');
      setTokenLimitParameter(row.tokenLimitParameter);
    }
    setLoadedTab(tab);
  }, [root, tab]);
  useEffect(() => {
    setError('');
    setNotice('');
    setKey('');
    setToken('');
    load().catch((e) => setError(explain(e)));
  }, [load]);
  const loadModels = useCallback(
    async (
      selectedProvider: 'anthropic' | 'openai-compatible',
      selectedBaseUrl: string | null,
      suppliedKey?: string,
    ) => {
      const generation = ++modelGeneration.current;
      setLoadingModels(true);
      setModelNotice('');
      try {
        const result = await api<ModelList>(`${root}/llm/models`, {
          method: 'POST',
          body: JSON.stringify({
            provider: selectedProvider,
            ...(selectedProvider === 'openai-compatible' ? { baseUrl: selectedBaseUrl } : {}),
            ...(suppliedKey ? { apiKey: suppliedKey } : {}),
          }),
        });
        if (generation !== modelGeneration.current) return;
        setModels(result.models);
        setModelNotice(
          result.models.length
            ? `${result.models.length} models available${result.truncated ? ' (partial list)' : ''}. Choose a suggestion or enter any model ID.`
            : 'No models were listed. Enter a model ID manually.',
        );
      } catch (e) {
        if (generation !== modelGeneration.current) return;
        setModels([]);
        setModelNotice(`${explain(e)} You can still enter a model ID and save.`);
      } finally {
        if (generation === modelGeneration.current) setLoadingModels(false);
      }
    },
    [root],
  );
  useEffect(() => {
    if (tab === 'llm' && loadedTab === tab && config?.hasKey && config.provider !== 'test')
      void loadModels(config.provider, config.baseUrl);
    else {
      setLoadingModels(false);
      setModels([]);
      setModelNotice('');
    }
    return () => {
      modelGeneration.current++;
    };
  }, [tab, loadedTab, config, loadModels]);
  function resetModels() {
    modelGeneration.current++;
    setModels([]);
    setModelNotice('');
    setLoadingModels(false);
  }
  const sameConnection =
    config?.provider === provider &&
    (provider !== 'openai-compatible' || config.baseUrl === baseUrl.trim().replace(/\/+$/, ''));
  const hasStoredKey = !!(sameConnection && config?.hasKey);
  async function action(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      await load();
      onChanged();
      setNotice(message);
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    await action(async () => {
      await api(`${root}/llm`, {
        method: 'PATCH',
        body: JSON.stringify({
          provider,
          model,
          tokenLimitParameter,
          ...(provider === 'openai-compatible' ? { baseUrl } : {}),
          ...(key ? { apiKey: key } : {}),
        }),
      });
      setKey('');
    }, 'Workspace model settings saved.');
  }
  const tabs = [
    ['members', 'Members', Users],
    ['invitations', 'Invitations', Mail],
    ['llm', 'LLM configuration', KeyRound],
    ['usage', 'Usage', ChartNoAxesColumn],
    ['agent-policy', 'Agent limits', Settings],
  ] as const;
  return (
    <section className="workspace-settings" aria-label="Workspace administration">
      <header className="settings-header">
        <Button variant="ghost" size="sm" icon={<ArrowLeft />} onClick={onBack}>
          Back to conversations
        </Button>
        <h1 className="t-title">
          <Settings aria-hidden /> Workspace settings
        </h1>
        <p>
          {workspace.name} <Badge>{workspace.role}</Badge>
        </p>
      </header>
      <nav className="settings-tabs" aria-label="Settings sections">
        {tabs.map(([id, label, Icon]) => (
          <Button
            key={id}
            variant={tab === id ? 'primary' : 'ghost'}
            icon={<Icon />}
            disabled={busy}
            onClick={() => {
              if (id !== tab) {
                setLoadedTab(null);
                setTab(id);
              }
            }}
            aria-current={tab === id ? 'page' : undefined}
          >
            {label}
          </Button>
        ))}
      </nav>
      {error && <Callout tone="danger">{error}</Callout>}
      {notice && (
        <p role="status" className="settings-notice">
          {notice}
        </p>
      )}
      {busy && (
        <span role="status">
          <Spinner /> Saving…
        </span>
      )}
      {loadedTab !== tab && !error && (
        <p role="status">
          <Spinner /> Loading settings…
        </p>
      )}
      {tab === 'members' && loadedTab === tab && (
        <div className="settings-section">
          <h2>Members and access</h2>
          <p className="t-meta">
            Disabling removes access to this workspace. Existing messages and membership grants are
            retained.
          </p>
          <div className="settings-members">
            {members
              .filter((m) => m.kind === 'human')
              .map((m) => {
                const protectedMember =
                  m.role === 'owner' ||
                  m.id === me ||
                  (workspace.role !== 'owner' && m.role === 'admin');
                return (
                  <div className="settings-member" key={m.id}>
                    <Avatar name={m.name} />
                    <div className="settings-member__identity">
                      <strong>{m.name}</strong>
                      <span>
                        {m.id === me ? 'You · ' : ''}
                        {m.role}
                      </span>
                    </div>
                    <Badge tone={m.enabled ? 'success' : 'neutral'}>
                      {m.enabled ? 'Active' : 'Disabled'}
                    </Badge>
                    {workspace.role === 'owner' && m.role !== 'owner' && m.id !== me && (
                      <label className="settings-role">
                        Role
                        <select
                          aria-label={`Role for ${m.name}`}
                          value={m.role}
                          disabled={busy}
                          onChange={(e) =>
                            action(
                              () =>
                                api(`${root}/members/${m.id}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ role: e.target.value }),
                                }),
                              'Member role updated.',
                            )
                          }
                        >
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
                        </select>
                      </label>
                    )}
                    <Button
                      size="sm"
                      variant={m.enabled ? 'ghost' : 'secondary'}
                      disabled={busy || protectedMember}
                      onClick={() =>
                        action(
                          () =>
                            api(`${root}/members/${m.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ enabled: !m.enabled }),
                            }),
                          'Member access updated.',
                        )
                      }
                    >
                      {m.enabled ? 'Disable' : 'Enable'}
                      <span className="sr-only"> {m.name}</span>
                    </Button>
                  </div>
                );
              })}
          </div>
        </div>
      )}
      {tab === 'invitations' && loadedTab === tab && (
        <div className="settings-section">
          <h2>Invite your team</h2>
          <p className="t-meta">
            Tokens are single-use and expire after seven days. Copy a new token before leaving this
            section.
          </p>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() =>
              action(async () => {
                setToken(
                  (await api<{ token: string }>(`${root}/invitations`, { method: 'POST' })).token,
                );
              }, 'Invitation created.')
            }
          >
            Create invite token
          </Button>
          {token && (
            <div className="settings-token">
              <Field label="New invitation token" readOnly value={token} />
              <Button
                icon={<Copy />}
                onClick={() =>
                  action(() => navigator.clipboard.writeText(token), 'Invitation copied.')
                }
              >
                Copy token
              </Button>
            </div>
          )}
          <div className="settings-table-wrap">
            <table className="settings-table">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((i) => {
                  const active =
                    !i.revoked_at && !i.accepted_by && Date.parse(i.expires_at) > Date.now();
                  return (
                    <tr key={i.id}>
                      <td>{new Date(i.created_at).toLocaleString()}</td>
                      <td>{new Date(i.expires_at).toLocaleString()}</td>
                      <td>
                        {i.revoked_at
                          ? 'Revoked'
                          : i.accepted_by
                            ? 'Accepted'
                            : active
                              ? 'Available'
                              : 'Expired'}
                      </td>
                      <td>
                        {active && (
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              action(
                                () => api(`${root}/invitations/${i.id}`, { method: 'DELETE' }),
                                'Invitation revoked.',
                              )
                            }
                          >
                            Revoke<span className="sr-only"> {i.id}</span>
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!invites.length && <p>No invitations yet.</p>}
        </div>
      )}
      {tab === 'llm' && loadedTab === tab && (
        <div className="settings-section settings-section--narrow">
          <h2>Shared workspace model</h2>
          <p className="t-meta">
            All members’ assistant runs use this provider and model. The key is stored encrypted on
            the server and is never displayed again.
          </p>
          {config && (
            <>
              <Badge tone={config.hasKey ? 'success' : 'neutral'}>
                {config.hasKey ? 'Key configured' : 'No key stored'}
              </Badge>
              <p className="t-meta">
                Configuration version {config.revision} · Updated{' '}
                {new Date(config.updated_at).toLocaleString()}
              </p>
            </>
          )}
          <form onSubmit={save}>
            <label className="field">
              <span className="field__label">Provider</span>
              <select
                className="input"
                aria-label="Provider"
                value={provider}
                onChange={(e) => {
                  const value = e.target.value as typeof provider;
                  setProvider(value);
                  resetModels();
                  setKey('');
                  setBaseUrl(
                    config?.provider === value
                      ? config.baseUrl || 'https://api.openai.com/v1'
                      : 'https://api.openai.com/v1',
                  );
                  setModel(
                    value === 'test'
                      ? 'deterministic'
                      : config?.provider === value
                        ? config.model
                        : '',
                  );
                }}
              >
                <option value="test">Test provider — no AI or charges</option>
                <option value="anthropic">Anthropic</option>
                <option value="openai-compatible">OpenAI-compatible API</option>
              </select>
            </label>
            {provider === 'openai-compatible' && (
              <Field
                label="API base URL"
                type="url"
                required
                value={baseUrl}
                maxLength={2048}
                onChange={(e) => {
                  setBaseUrl(e.target.value);
                  resetModels();
                }}
                placeholder="https://api.openai.com/v1"
                hint="Use the provider's API root, including /v1 when required. Calls are made by the server. HTTP is supported on localhost."
              />
            )}
            <Field
              label="Model ID"
              value={model}
              required
              maxLength={160}
              list={modelListId}
              onChange={(e) => setModel(e.target.value)}
              hint={
                provider === 'test'
                  ? 'Deterministic development output.'
                  : 'Choose an available model or type its exact ID. Model listing may include models that do not support chat.'
              }
            />
            <datalist id={modelListId}>
              {models.map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
            {provider !== 'test' && (
              <>
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    busy ||
                    loadingModels ||
                    (!key.trim() && !hasStoredKey) ||
                    (provider === 'openai-compatible' && !baseUrl.trim())
                  }
                  onClick={() => void loadModels(provider, baseUrl, key.trim() || undefined)}
                >
                  {loadingModels ? 'Loading models…' : 'Load available models'}
                </Button>
                {modelNotice && (
                  <p className="t-meta" role="status">
                    {modelNotice}
                  </p>
                )}
              </>
            )}
            {provider !== 'test' && (
              <Field
                label={hasStoredKey ? 'Replace API key (optional)' : 'API key'}
                type="password"
                autoComplete="new-password"
                value={key}
                maxLength={4096}
                onChange={(e) => {
                  setKey(e.target.value);
                  resetModels();
                }}
                hint={
                  hasStoredKey
                    ? 'Leave blank to keep the stored key for this endpoint.'
                    : 'Enter a key for this provider and endpoint. Changing endpoints requires a new key.'
                }
              />
            )}
            {provider === 'openai-compatible' && (
              <details className="settings-compatibility">
                <summary>Compatibility settings</summary>
                <label className="field">
                  <span className="field__label">Output token limit parameter</span>
                  <select
                    className="input"
                    aria-label="Output token limit parameter"
                    value={tokenLimitParameter}
                    onChange={(e) =>
                      setTokenLimitParameter(e.target.value as LlmSettings['tokenLimitParameter'])
                    }
                  >
                    <option value="max_completion_tokens">
                      max_completion_tokens — modern OpenAI
                    </option>
                    <option value="max_tokens">max_tokens — other compatible providers</option>
                  </select>
                </label>
                <p className="t-meta">
                  Select the parameter your endpoint accepts. Agent limits determine the output
                  token ceiling (2,000 by default).
                </p>
              </details>
            )}
            <div className="settings-actions">
              <Button variant="primary" disabled={busy}>
                Save model settings
              </Button>
              {config?.hasKey && (
                <Button
                  type="button"
                  variant="danger"
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      await api(`${root}/llm`, {
                        method: 'PATCH',
                        body: JSON.stringify({
                          provider: config.provider,
                          model: config.model,
                          ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
                          tokenLimitParameter: config.tokenLimitParameter,
                          removeKey: true,
                        }),
                      });
                      setKey('');
                    }, 'Stored key removed. Hosted model calls require a new key.')
                  }
                >
                  Remove key
                </Button>
              )}
            </div>
          </form>
          <Callout>
            Changing these settings prevents older unpublished runs from posting. Removing a key
            blocks new hosted model calls.
          </Callout>
        </div>
      )}
      {tab === 'agent-policy' && <AgentPolicySettings root={root} />}
      {tab === 'usage' && loadedTab === tab && (
        <div className="settings-section">
          <h2>Member token usage</h2>
          <p className="t-meta">
            All-time provider-reported usage for this workspace. Retries count as separate attempts.
            Test-provider runs are excluded. Unknown attempts may include charges the provider did
            not report to us.
          </p>
          <Button size="sm" disabled={busy} onClick={() => action(load, 'Usage refreshed.')}>
            Refresh usage
          </Button>
          <div className="settings-table-wrap">
            <table className="settings-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Attempts</th>
                  <th>Input tokens</th>
                  <th>Output tokens</th>
                  <th>Cache read</th>
                  <th>Cache write</th>
                  <th>Unknown / pending</th>
                </tr>
              </thead>
              <tbody>
                {usage?.members.map((m) => (
                  <tr key={m.id}>
                    <th scope="row">
                      {m.name}
                      {!m.enabled && ' (disabled)'}
                    </th>
                    <td>{m.attempts}</td>
                    <td>{m.input_tokens}</td>
                    <td>{m.output_tokens}</td>
                    <td>{m.cache_read_tokens}</td>
                    <td>{m.cache_write_tokens}</td>
                    <td>{m.unknown_attempts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>By provider and model</h3>
          {usage?.models.length ? (
            <div className="settings-table-wrap">
              <table className="settings-table">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Model</th>
                    <th>Attempts</th>
                    <th>Input</th>
                    <th>Output</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.models.map((m) => (
                    <tr key={`${m.provider}:${m.model}`}>
                      <td>{m.provider}</td>
                      <td>{m.model}</td>
                      <td>{m.attempts}</td>
                      <td>{m.input_tokens}</td>
                      <td>{m.output_tokens}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No hosted model usage yet.</p>
          )}
        </div>
      )}
    </section>
  );
}
