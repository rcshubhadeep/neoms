import { useState, type ReactNode } from 'react';
import { Check, ChevronRight, CircleDashed, Minus, ShieldCheck, X } from 'lucide-react';
import { Avatar, Badge, Button, Dot, Spinner } from './ui';

/*
 * Agent-era patterns. These describe work done by agents in a way people can
 * scan, trust, and interrupt. See docs/DESIGN.md → "Agents at work".
 */

export type StepState = 'done' | 'running' | 'waiting' | 'pending' | 'failed' | 'skipped';
export type RunStep = { title: string; state: StepState; detail?: ReactNode; time?: string };

const stepIcon: Record<StepState, ReactNode> = {
  done: <Check />,
  running: <Spinner />,
  waiting: <ShieldCheck />,
  pending: <CircleDashed />,
  failed: <X />,
  skipped: <Minus />,
};

const runTone = {
  working: { dot: 'working', label: 'Working' },
  waiting: { dot: 'waiting', label: 'Needs you' },
  done: { dot: 'live', label: 'Done' },
  failed: { dot: 'error', label: 'Failed' },
} as const;

export function RunCard({
  agent,
  title,
  state,
  steps,
  sources,
  footer,
}: {
  agent: string;
  title: string;
  state: keyof typeof runTone;
  steps: RunStep[];
  sources?: ReactNode;
  footer?: ReactNode;
}) {
  const tone = runTone[state];
  return (
    <section className="run-card card" aria-label={`${agent}: ${title}`}>
      <header className="run-card__header">
        <Avatar name={agent} kind="agent" size="sm" />
        <div>
          <strong>{agent}</strong>
          <span>{title}</span>
        </div>
        <span className="run-card__state">
          <Dot state={tone.dot} pulse={state === 'working'} />
          {tone.label}
        </span>
      </header>
      {sources && <div className="run-card__sources">{sources}</div>}
      <ol className="steps">
        {steps.map((step) => (
          <li key={step.title} className={`step step--${step.state}`}>
            <span className="step__icon" aria-hidden>
              {stepIcon[step.state]}
            </span>
            <div className="step__body">
              <span className="step__title">
                {step.title}
                <span className="sr-only"> ({step.state})</span>
              </span>
              {step.detail && <div className="step__detail">{step.detail}</div>}
            </div>
            {step.time && <time className="step__time">{step.time}</time>}
          </li>
        ))}
      </ol>
      {footer && <footer className="run-card__footer">{footer}</footer>}
    </section>
  );
}

export function ApprovalRequest({
  agent,
  action,
  scope,
  onApprove,
  onDecline,
}: {
  agent: string;
  action: string;
  scope: { label: string; value: string }[];
  onApprove?: () => void;
  onDecline?: () => void;
}) {
  return (
    <section className="approval" aria-label={`Approval requested by ${agent}`}>
      <div className="approval__head">
        <ShieldCheck aria-hidden />
        <p>
          <strong>{agent}</strong> wants to {action}
        </p>
      </div>
      <dl className="approval__scope">
        {scope.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="approval__actions">
        <Button variant="ghost" size="sm" onClick={onDecline}>
          Decline
        </Button>
        <Button variant="primary" size="sm" onClick={onApprove}>
          Approve
        </Button>
      </div>
    </section>
  );
}

export function ToolCall({
  name,
  summary,
  input,
  output,
  state = 'done',
}: {
  name: string;
  summary: string;
  input: string;
  output?: string;
  state?: 'done' | 'running' | 'failed';
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`toolcall toolcall--${state}`}>
      <button className="toolcall__row" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight aria-hidden className="toolcall__chevron" />
        <code>{name}</code>
        <span className="toolcall__summary">{summary}</span>
        {state === 'running' ? (
          <Spinner />
        ) : state === 'failed' ? (
          <Badge tone="danger">Failed</Badge>
        ) : null}
      </button>
      {open && (
        <pre className="toolcall__io">
          <span>input</span>
          {input}
          {output && (
            <>
              {'\n'}
              <span>output</span>
              {output}
            </>
          )}
        </pre>
      )}
    </div>
  );
}

export function IntegrationRow({
  mark,
  name,
  description,
  connected,
  detail,
}: {
  mark: ReactNode;
  name: string;
  description: string;
  connected: boolean;
  detail?: string;
}) {
  return (
    <div className="integration">
      <span className="integration__mark" aria-hidden>
        {mark}
      </span>
      <div className="integration__text">
        <strong>{name}</strong>
        <span>{connected && detail ? detail : description}</span>
      </div>
      {connected ? (
        <Badge tone="success">
          <Dot state="live" /> Connected
        </Badge>
      ) : (
        <Button size="sm">Connect</Button>
      )}
    </div>
  );
}

export function AgentCard({
  name,
  owner,
  description,
  capabilities,
  status,
}: {
  name: string;
  owner: string;
  description: string;
  capabilities: string[];
  status: 'idle' | 'working';
}) {
  return (
    <article className="agent-card card">
      <header>
        <Avatar name={name} kind="agent" size="lg" />
        <div>
          <strong>{name}</strong>
          <span>by {owner}</span>
        </div>
        <span className="agent-card__status">
          <Dot state={status === 'working' ? 'working' : undefined} pulse={status === 'working'} />
          {status === 'working' ? 'Working' : 'Idle'}
        </span>
      </header>
      <p>{description}</p>
      <div className="agent-card__caps">
        {capabilities.map((c) => (
          <Badge key={c} outline>
            {c}
          </Badge>
        ))}
      </div>
      <footer>
        <Button size="sm" variant="secondary">
          Add to channel
        </Button>
      </footer>
    </article>
  );
}
