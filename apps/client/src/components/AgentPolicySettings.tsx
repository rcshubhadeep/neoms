import { useEffect, useState, type FormEvent } from 'react';
import type { PolicySettings, RunPolicy } from '../../../../packages/contracts/src/index';
import { api } from '../client';
import { explain } from './shared';
import { Button, Callout, Field } from './ui';

const fields: [Exclude<keyof RunPolicy, 'allowSharing'>, string, number, number][] = [
  ['maxContextTokens', 'Context token ceiling', 2048, 64000],
  ['maxOutputTokens', 'Output token ceiling', 128, 8000],
  ['maxMessages', 'Maximum messages', 1, 500],
  ['maxHistoryDays', 'History days', 1, 365],
  ['maxAttempts', 'Maximum model attempts', 1, 3],
  ['maxConcurrentRuns', 'Concurrent workspace runs', 1, 100],
  ['userDailyTokens', 'Tokens per member per UTC day', 1, 100000000],
  ['workspaceMonthlyTokens', 'Tokens per workspace per UTC month', 1, 1000000000],
  ['retentionDays', 'Private result retention days', 1, 30],
];
export function AgentPolicySettings({ root }: { root: string }) {
  const [settings, setSettings] = useState<PolicySettings>();
  const [target, setTarget] = useState('workspace');
  const [values, setValues] = useState<Record<string, string>>({});
  const [sharing, setSharing] = useState('inherit');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let disposed = false;
    api<PolicySettings>(`${root}/agent-policy`)
      .then((data) => {
        if (!disposed) setSettings(data);
      })
      .catch((e) => {
        if (!disposed) setError(explain(e));
      });
    return () => {
      disposed = true;
    };
  }, [root]);
  useEffect(() => {
    if (!settings) return;
    const [layer, id] = target.split(':');
    const limits =
      layer === 'workspace'
        ? settings.limits
        : ((layer === 'agent' ? settings.agents : settings.conversations).find(
            (row) => row.id === id,
          )?.limits ?? {});
    setValues(Object.fromEntries(fields.map(([key]) => [key, limits[key]?.toString() ?? ''])));
    setSharing(limits.allowSharing === undefined ? 'inherit' : String(limits.allowSharing));
  }, [settings, target]);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const [layer, targetId] = target.split(':');
      const limits = Object.fromEntries(
        fields.filter(([key]) => values[key] !== '').map(([key]) => [key, Number(values[key])]),
      );
      await api(`${root}/agent-policy`, {
        method: 'PATCH',
        body: JSON.stringify({
          layer,
          ...(targetId ? { targetId } : {}),
          limits: {
            ...limits,
            ...(sharing === 'inherit' ? {} : { allowSharing: sharing === 'true' }),
          },
        }),
      });
      setSettings(await api<PolicySettings>(`${root}/agent-policy`));
      setNotice('Agent limits saved. Pending runs with changed policy must be started again.');
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-section settings-section--narrow">
      <h2>Agent limits and sharing</h2>
      <p>
        Workspace limits are ceilings. Agent, conversation, and individual run limits can only
        tighten them. Blank overrides inherit the workspace limit.
      </p>
      <p className="t-meta">
        Hosted runs reserve tokens for all allowed attempts before they start. Unknown usage remains
        charged at the reserved estimate. These are token budgets; provider billing can differ.
      </p>
      {error && <Callout tone="danger">{error}</Callout>}
      {notice && <p role="status">{notice}</p>}
      {settings && (
        <form onSubmit={save}>
          <label className="field">
            <span className="field__label">Policy target</span>
            <select
              className="input"
              aria-label="Policy target"
              value={target}
              disabled={busy}
              onChange={(e) => {
                setTarget(e.target.value);
                setNotice('');
              }}
            >
              <option value="workspace">Workspace ceiling</option>
              {settings.agents.map((row) => (
                <option key={row.id} value={`agent:${row.id}`}>
                  Agent: {row.name}
                </option>
              ))}
              {settings.conversations.map((row) => (
                <option key={row.id} value={`conversation:${row.id}`}>
                  Conversation: {row.name}
                </option>
              ))}
            </select>
          </label>
          {fields.map(([key, label, min, max]) => (
            <Field
              key={key}
              label={label}
              type="number"
              min={min}
              max={max}
              step={1}
              required={target === 'workspace'}
              value={values[key] ?? ''}
              placeholder={String(settings.limits[key])}
              onChange={(e) => setValues((old) => ({ ...old, [key]: e.target.value }))}
            />
          ))}
          <label className="field">
            <span className="field__label">Allow posting results</span>
            <select
              className="input"
              aria-label="Allow posting results"
              value={sharing}
              onChange={(e) => setSharing(e.target.value)}
            >
              {target !== 'workspace' && <option value="inherit">Inherit</option>}
              <option value="true">Allow within workspace ceiling</option>
              <option value="false">Disable</option>
            </select>
          </label>
          <Button variant="primary" disabled={busy}>
            Save agent limits
          </Button>
        </form>
      )}
    </div>
  );
}
