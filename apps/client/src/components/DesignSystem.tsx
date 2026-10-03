import { useEffect, useState, type ReactNode } from 'react';
import {
  Activity,
  ArrowUp,
  CircleDashed,
  GitPullRequest,
  Hash,
  Lock,
  Monitor,
  Moon,
  Plus,
  Quote,
  Rocket,
  Sparkles,
  Sun,
  Users,
} from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Dot,
  Field,
  IconButton,
  Kbd,
  SourceChip,
  Spinner,
  Wordmark,
} from './ui';
import { AgentCard, ApprovalRequest, IntegrationRow, RunCard, ToolCall } from './patterns';

/* Living reference for docs/DESIGN.md. Open at #/design. */

const sections = [
  ['principles', 'Principles'],
  ['color', 'Color'],
  ['type', 'Typography'],
  ['space', 'Space & shape'],
  ['controls', 'Controls'],
  ['identity', 'Identity'],
  ['conversation', 'Conversation'],
  ['agents', 'Agents at work'],
  ['context', 'Connected context'],
] as const;

function Section({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="ds-section">
      <header>
        <h2 className="t-title">{title}</h2>
        <p>{lead}</p>
      </header>
      {children}
    </section>
  );
}

const Swatch = ({ token, note }: { token: string; note?: string }) => (
  <div className="ds-swatch">
    <span style={{ background: `var(${token})` }} />
    <code>{token}</code>
    {note && <small>{note}</small>}
  </div>
);

function useTheme() {
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system');
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    return () => document.documentElement.removeAttribute('data-theme');
  }, [theme]);
  return [theme, setTheme] as const;
}

export function DesignSystem() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="ds">
      <aside className="ds-nav">
        <a href="#/design" className="ds-nav__brand">
          <Wordmark />
        </a>
        <p className="t-label">Design foundation</p>
        <nav>
          {sections.map(([id, label]) => (
            <button
              key={id}
              className="nav-item"
              onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })}
            >
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="ds-theme" role="radiogroup" aria-label="Theme">
          {(
            [
              ['light', <Sun key="l" />],
              ['system', <Monitor key="s" />],
              ['dark', <Moon key="d" />],
            ] as const
          ).map(([value, icon]) => (
            <IconButton
              key={value}
              size="sm"
              label={`${value} theme`}
              role="radio"
              aria-checked={theme === value}
              onClick={() => setTheme(value)}
            >
              {icon}
            </IconButton>
          ))}
        </div>
        <a className="nav-item" href="#">
          <span>← Back to app</span>
        </a>
      </aside>
      <main className="ds-main">
        <header className="ds-hero">
          <p className="t-label">Neoms · Design language v0.1</p>
          <h1 className="t-display">Quiet by default. Clear when it matters.</h1>
          <p>
            A workspace where people and agents do work together. The interface stays out of the way
            so the conversation, the context, and the work in progress can be seen at a glance.
          </p>
        </header>

        <Section
          id="principles"
          title="Principles"
          lead="Five rules every screen is checked against."
        >
          <ol className="ds-principles">
            {[
              [
                'Paper and ink',
                'Neutral surfaces, near-black type. Colour is a signal, never a decoration.',
              ],
              [
                'Agents are teammates',
                'Agents speak in the same timeline, with the same weight, distinguished by shape — not by louder colour.',
              ],
              [
                'Work is visible',
                'Anything an agent does is legible: what it is doing, why, with what access, and how to stop it.',
              ],
              [
                'Context travels with the work',
                'Issues, PRs, incidents and messages appear as chips that point back to their source.',
              ],
              [
                'Calm density',
                'Small type, generous rhythm. Show more by removing chrome, not by shrinking space.',
              ],
            ].map(([title, body], i) => (
              <li key={title}>
                <span>{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <strong>{title}</strong>
                  <p>{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <Section
          id="color"
          title="Color"
          lead="Surfaces and text are neutral and tuned for long reading. Signal blue marks live and agent activity. Status colours are only used for state."
        >
          <h3 className="ds-sub">Surfaces</h3>
          <div className="ds-grid ds-grid--swatch">
            <Swatch token="--surface-app" note="Canvas" />
            <Swatch token="--surface-sidebar" note="Navigation" />
            <Swatch token="--surface-raised" note="Cards, composer" />
            <Swatch token="--surface-sunken" note="Wells, code" />
            <Swatch token="--surface-hover" note="Hover overlay" />
            <Swatch token="--surface-inverse" note="Primary action" />
          </div>
          <h3 className="ds-sub">Text & lines</h3>
          <div className="ds-grid ds-grid--swatch">
            <Swatch token="--text-strong" note="Titles, names" />
            <Swatch token="--text-primary" note="Body" />
            <Swatch token="--text-secondary" note="Supporting" />
            <Swatch token="--text-tertiary" note="Meta, placeholder" />
            <Swatch token="--border-default" note="Hairline" />
            <Swatch token="--border-strong" note="Hover, emphasis" />
          </div>
          <h3 className="ds-sub">Signal & status</h3>
          <div className="ds-grid ds-grid--swatch">
            <Swatch token="--signal" note="Live, agent working, focus" />
            <Swatch token="--success" note="Done, connected" />
            <Swatch token="--warning" note="Needs a person" />
            <Swatch token="--danger" note="Failed, destructive" />
          </div>
        </Section>

        <Section
          id="type"
          title="Typography"
          lead="Newsreader for moments, Geist for work, Geist Mono for machines. Serif never appears in dense UI."
        >
          <div className="ds-type">
            {[
              [
                'Display · Newsreader 48/52',
                <span className="t-display" style={{ fontSize: 48, lineHeight: '52px' }}>
                  Good work, together.
                </span>,
              ],
              [
                'Title · Newsreader 26/32',
                <span className="t-title">This is the start of launch</span>,
              ],
              [
                'Heading · Geist 14/22 semibold',
                <span style={{ fontWeight: 600, color: 'var(--text-strong)' }}>
                  launch-planning
                </span>,
              ],
              [
                'Body · Geist 14/22',
                <span>Reproduced the timeout in staging. The fix is up for review.</span>,
              ],
              [
                'UI · Geist 13/20',
                <span style={{ fontSize: 13 }}>Members · Catch me up · Invite a teammate</span>,
              ],
              ['Meta · Geist 12/16', <span className="t-meta">10:42 AM · edited</span>],
              ['Label · Geist 11 caps', <span className="t-label">Channels</span>],
              [
                'Mono · Geist Mono 12',
                <span className="t-mono">deploy --env=test --sha 9f3c2e1</span>,
              ],
            ].map(([label, sample]) => (
              <div key={label as string} className="ds-type__row">
                <small>{label}</small>
                {sample}
              </div>
            ))}
          </div>
        </Section>

        <Section
          id="space"
          title="Space & shape"
          lead="A 4px grid. Hairlines over shadows. Radius grows with the size of the object."
        >
          <div className="ds-grid ds-grid--three">
            <div className="card ds-panel">
              <h3 className="ds-sub">Spacing</h3>
              {[4, 8, 12, 16, 24, 32, 48].map((n) => (
                <div key={n} className="ds-space">
                  <code>{n}</code>
                  <span style={{ width: n * 2 }} />
                </div>
              ))}
            </div>
            <div className="card ds-panel">
              <h3 className="ds-sub">Radius</h3>
              <div className="ds-radii">
                {[
                  ['xs', 4],
                  ['sm', 6],
                  ['md', 8],
                  ['lg', 12],
                  ['xl', 16],
                  ['full', 999],
                ].map(([name, r]) => (
                  <div key={name}>
                    <span style={{ borderRadius: Math.min(Number(r), 28) }} />
                    <code>{name}</code>
                  </div>
                ))}
              </div>
            </div>
            <div className="card ds-panel">
              <h3 className="ds-sub">Elevation</h3>
              <div className="ds-elev">
                {['xs', 'sm', 'md', 'lg'].map((e) => (
                  <div key={e} style={{ boxShadow: `var(--shadow-${e})` }}>
                    <code>shadow-{e}</code>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>

        <Section
          id="controls"
          title="Controls"
          lead="One primary action per view, in ink. Everything else is secondary or ghost."
        >
          <div className="ds-row">
            <Button variant="primary">Create workspace</Button>
            <Button>Members</Button>
            <Button variant="ghost">Cancel</Button>
            <Button variant="signal" icon={<Sparkles />}>
              Catch me up
            </Button>
            <Button variant="danger">Remove</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="ds-row">
            <Button variant="primary" size="lg" pill>
              Get started
            </Button>
            <Button size="sm" icon={<Plus />}>
              Small
            </Button>
            <IconButton label="Add">
              <Plus />
            </IconButton>
            <IconButton label="Members" size="sm">
              <Users />
            </IconButton>
            <button className="send-btn" aria-label="Send">
              <ArrowUp />
            </button>
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </div>
          <div className="ds-grid ds-grid--two">
            <div>
              <Field label="Channel name" placeholder="e.g. launch-planning" />
              <Field
                label="Email"
                defaultValue="maya@studio.dev"
                hint="We’ll send an invitation here."
              />
            </div>
            <div className="ds-stack">
              <div className="ds-row">
                <Badge>Agent</Badge>
                <Badge tone="signal">Working</Badge>
                <Badge tone="success">Connected</Badge>
                <Badge tone="warning">Needs approval</Badge>
                <Badge tone="danger">Failed</Badge>
                <Badge outline>read:issues</Badge>
              </div>
              <div className="ds-row ds-dots">
                <span>
                  <Dot state="live" /> Live
                </span>
                <span>
                  <Dot state="working" pulse /> Working
                </span>
                <span>
                  <Dot state="waiting" /> Waiting
                </span>
                <span>
                  <Dot state="error" /> Error
                </span>
                <span>
                  <Spinner /> Loading
                </span>
              </div>
              <Callout>Agents only see channels they belong to.</Callout>
              <Callout tone="danger">The invitation has expired. Ask for a new one.</Callout>
            </div>
          </div>
        </Section>

        <Section
          id="identity"
          title="Identity"
          lead="People are circles. Agents are squircles in ink. Never rely on colour alone to tell them apart."
        >
          <div className="ds-row">
            <Avatar name="Maya" size="xl" />
            <Avatar name="Triage" kind="agent" size="xl" />
            <Avatar name="Jon" size="lg" />
            <Avatar name="Deploy" kind="agent" size="lg" />
            <Avatar name="Ava" />
            <Avatar name="Watch" kind="agent" />
            <Avatar name="Sam" size="sm" />
            <Avatar name="Bot" kind="agent" size="xs" />
            <span className="avatar-stack">
              <Avatar name="Maya" size="sm" />
              <Avatar name="Jon" size="sm" />
              <Avatar name="Triage" kind="agent" size="sm" />
            </span>
          </div>
          <div className="ds-row">
            <Wordmark />
            <nav className="ds-mini-nav">
              <span className="nav-item" aria-current="page">
                <Hash /> <span>general</span>
              </span>
              <span className="nav-item">
                <Lock /> <span>incident-review</span>
              </span>
            </nav>
          </div>
        </Section>

        <Section
          id="conversation"
          title="Conversation"
          lead="Messages sit on the canvas, not in bubbles. Agent replies get a quiet frame and always show their sources."
        >
          <div className="card ds-convo">
            <div className="divider">Today</div>
            <article className="message">
              <Avatar name="Maya" />
              <div>
                <div className="message__meta">
                  <strong>Maya</strong>
                  <time>10:41 AM</time>
                </div>
                <p className="message__body">
                  Checkout is timing out for some EU customers since this morning.
                </p>
              </div>
            </article>
            <article className="message message--continued">
              <time className="message__gutter">10:41</time>
              <div>
                <p className="message__body">@Triage can you take a look?</p>
              </div>
            </article>
            <article className="message message--agent">
              <Avatar name="Triage" kind="agent" />
              <div>
                <div className="message__meta">
                  <strong>Triage</strong>
                  <Badge>Agent</Badge>
                  <time>10:42 AM</time>
                </div>
                <p className="message__body">
                  On it. Error rate on <code>/checkout</code> rose from 0.2% to 4.1% after the 09:58
                  deploy. Likely the retry change in the payments client.
                </p>
                <div className="citations">
                  <span className="t-meta">Sources</span>
                  <SourceChip
                    mark={<Activity />}
                    id="INC-311"
                    label="Better Stack"
                    onClick={() => {}}
                  />
                  <SourceChip
                    mark={<GitPullRequest />}
                    id="#478"
                    label="payments: retry"
                    onClick={() => {}}
                  />
                  <SourceChip mark={<Quote />} label="Message 1" onClick={() => {}} />
                </div>
              </div>
            </article>
          </div>
        </Section>

        <Section
          id="agents"
          title="Agents at work"
          lead="Agent work is a timeline of steps a person can scan in two seconds: what happened, what is happening, and what needs them."
        >
          <div className="ds-grid ds-grid--two ds-grid--top">
            <RunCard
              agent="Triage"
              title="Fix checkout timeouts · ENG-142"
              state="waiting"
              sources={
                <>
                  <SourceChip mark={<CircleDashed />} id="ENG-142" label="Linear" />
                  <SourceChip mark={<Activity />} id="INC-311" label="Better Stack" />
                </>
              }
              steps={[
                { title: 'Acknowledged the issue', state: 'done', time: '10:42' },
                { title: 'Reproduced in staging', state: 'done', time: '10:47' },
                {
                  title: 'Opened a fix',
                  state: 'done',
                  time: '10:58',
                  detail: (
                    <SourceChip
                      mark={<GitPullRequest />}
                      id="#482"
                      label="Retry payment intent once"
                    />
                  ),
                },
                {
                  title: 'Deploy to test',
                  state: 'waiting',
                  detail: 'Waiting for approval from an owner',
                },
                { title: 'Monitor error rate for 30 min', state: 'pending' },
                { title: 'Report back in #incidents', state: 'pending' },
              ]}
              footer={
                <>
                  <span>Started by Maya · 18 min</span>
                  <Button variant="ghost" size="sm">
                    Stop run
                  </Button>
                </>
              }
            />
            <div className="ds-stack">
              <ApprovalRequest
                agent="Triage"
                action="deploy a branch to the test environment."
                scope={[
                  { label: 'Branch', value: 'fix/eng-142-retry-intent' },
                  { label: 'Environment', value: 'test (eu-west-1)' },
                  { label: 'Access', value: 'deploy:test · read:logs' },
                ]}
              />
              <ToolCall
                name="github.create_pull_request"
                summary="Opened #482 against main"
                input={'{ "branch": "fix/eng-142-retry-intent", "base": "main" }'}
                output={'{ "number": 482, "status": "open" }'}
              />
              <ToolCall
                name="betterstack.query"
                summary="Error rate on /checkout, last 2h"
                input={'{ "metric": "http_5xx_rate", "route": "/checkout" }'}
                state="running"
              />
              <ToolCall
                name="deploy.test"
                summary="Permission denied: deploy:test"
                input={'{ "sha": "9f3c2e1" }'}
                state="failed"
              />
            </div>
          </div>
          <div className="ds-grid ds-grid--three ds-grid--top">
            <AgentCard
              name="Triage"
              owner="Platform team"
              description="Picks up new incidents, reproduces them, and proposes a fix with evidence."
              capabilities={['read:issues', 'write:code', 'deploy:test']}
              status="working"
            />
            <AgentCard
              name="Scribe"
              owner="Maya"
              description="Summarises channels and writes weekly notes from decisions and shipped work."
              capabilities={['read:messages']}
              status="idle"
            />
            <AgentCard
              name="Release"
              owner="Infra"
              description="Watches deploys, compares error budgets, and reports regressions to owners."
              capabilities={['read:deploys', 'read:logs']}
              status="idle"
            />
          </div>
        </Section>

        <Section
          id="context"
          title="Connected context"
          lead="Sources are named in text and identified by object type. We do not paint third-party brand colours into the interface."
        >
          <div className="ds-grid ds-grid--two ds-grid--top">
            <div className="card">
              <IntegrationRow
                mark={<CircleDashed />}
                name="Linear"
                description="Issues, projects, and cycles"
                connected
                detail="Synced 2 min ago · 3 teams"
              />
              <IntegrationRow
                mark={<GitPullRequest />}
                name="GitHub"
                description="Repositories, pull requests, and checks"
                connected
                detail="Synced just now · 12 repositories"
              />
              <IntegrationRow
                mark={<Activity />}
                name="Better Stack"
                description="Incidents, uptime, and logs"
                connected={false}
              />
              <IntegrationRow
                mark={<Rocket />}
                name="Deploys"
                description="Environments and release history"
                connected={false}
              />
            </div>
            <div className="ds-stack">
              <div className="ds-row">
                <SourceChip mark={<CircleDashed />} id="ENG-142" label="Checkout timeouts in EU" />
                <SourceChip mark={<GitPullRequest />} id="#482" label="Retry payment intent once" />
                <SourceChip mark={<Activity />} id="INC-311" label="Elevated 5xx on /checkout" />
                <SourceChip mark={<Rocket />} id="test" label="9f3c2e1" />
                <SourceChip mark={<Quote />} label="Message 3" />
              </div>
              <Callout>
                Chips are the only way external objects appear inline. They carry the object type
                icon, a mono identifier, and a short title.
              </Callout>
            </div>
          </div>
        </Section>
      </main>
    </div>
  );
}
