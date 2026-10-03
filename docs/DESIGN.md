# Neoms design language

Version 0.1 · living reference at `#/design` in the running client (`npm run dev`, then open http://127.0.0.1:1420/#/design).

Neoms is a workspace where people and agents do work together: talk, pull in context from Linear, GitHub and Better Stack, and hand work to agents that acknowledge an issue, write code, deploy to test, monitor, and report back. The interface has one job: **make the conversation, the context, and the work in progress legible at a glance, and then get out of the way.**

This document is the source of truth for how Neoms looks, reads, and behaves. The tokens and components in `apps/client/src` implement it. When the two disagree, fix one of them in the same change.

---

## 1. North star

**Quiet by default. Clear when it matters.**

The reference point is the restraint of [ando.so](https://ando.so): near-white paper, near-black ink, hairline borders made of transparent black, a serif only for headline moments, a neutral sans for everything else, and colour used almost exclusively as a signal.

What we take from it:

- Paper-and-ink neutrals; borders and hover fills as alpha of the ink colour, so they work on any surface.
- An editorial serif for big, rare moments (sign-in, empty states, channel intros, dialog titles).
- One accent colour, used for signal, never decoration.
- Small, precise type in the product; generous whitespace around it.

What is ours:

- Agents are first-class participants, and their **work** (runs, steps, approvals, tool calls) has its own visual grammar (§9).
- External context is a first-class citizen through **source chips** (§10).
- A desktop-first density (Tauri on Mac) that still holds up in a browser and, later, on a phone.

## 2. Principles

Every screen is checked against these five rules.

1. **Paper and ink.** Neutral surfaces, near-black type. Colour means something: live, working, needs you, done, failed. If removing a colour loses no information, remove it.
2. **Agents are teammates.** Agents post in the same timeline with the same typographic weight as people. They are told apart by **shape** (squircle avatar in ink) and an `Agent` badge, not by louder colour or bigger bubbles.
3. **Work is visible.** Anything an agent does can be read in two seconds: what it is doing, why, with what access, and how to stop it. No silent background work, no hidden permissions.
4. **Context travels with the work.** Issues, pull requests, incidents, deploys and messages appear inline as chips that point back to their source. Agent answers always show their sources.
5. **Calm density.** Small type, generous rhythm. Show more by removing chrome, not by shrinking space. One primary action per view.

## 3. Voice and tone

- Plain, short, and specific. "Reproduced in staging" beats "The agent has successfully reproduced the issue".
- Sentence case everywhere, including buttons and headings. Uppercase is reserved for `.t-label` section labels.
- Name the actor: "Triage wants to deploy a branch to test", not "Approval required".
- Say what happened and what to do next in error messages: "The invitation has expired. Ask for a new one."
- Never pretend: test or placeholder output must say so (the test provider prints "not an AI summary").
- Use typographic punctuation: ’ “ ” … —.

## 4. Color

All colours are CSS custom properties in `apps/client/src/styles/tokens.css`. Components use **semantic** tokens only. Never hard-code a hex value in a component stylesheet.

### Surfaces

| Token                | Light               | Dark             | Use                             |
| -------------------- | ------------------- | ---------------- | ------------------------------- |
| `--surface-app`      | `#fbfbfa`           | `#151514`        | Main canvas                     |
| `--surface-sidebar`  | `#f6f6f4`           | `#111110`        | Navigation, auth side panel     |
| `--surface-raised`   | `#ffffff`           | `#1c1c1b`        | Cards, composer, dialogs, chips |
| `--surface-sunken`   | `#f1f1ef`           | `#0e0e0d`        | Wells, code, read-only inputs   |
| `--surface-inverse`  | `#1c1c1b`           | `#f4f4f1`        | Primary buttons, agent avatars  |
| `--surface-subtle`   | ink 2.5%            | ink 2.5%         | Row hover in content, footers   |
| `--surface-hover`    | ink 4.5%            | ink 4.5%         | Hover on controls               |
| `--surface-pressed`  | ink 7%              | ink 7%           | Pressed                         |
| `--surface-selected` | ink 6%              | ink 6%           | Current nav item                |
| `--surface-overlay`  | `rgb(20 20 18/.28)` | `rgb(0 0 0/.55)` | Dialog backdrop                 |

`--ink` is an RGB triplet (`24 24 22` light, `250 250 247` dark). Alpha tokens are written as `rgb(var(--ink) / 0.06)`, so a single change re-themes every hairline and hover.

### Text and lines

| Token                                 | Use                                         |
| ------------------------------------- | ------------------------------------------- |
| `--text-strong`                       | Titles, names, current item                 |
| `--text-primary`                      | Body copy, message text                     |
| `--text-secondary`                    | Supporting copy, descriptions, inactive nav |
| `--text-tertiary`                     | Timestamps, meta, placeholders, labels      |
| `--text-disabled`                     | Disabled text                               |
| `--border-subtle`                     | Dividers between regions (ink 6%)           |
| `--border-default`                    | Card and control hairlines (ink 10%)        |
| `--border-strong`                     | Hover and emphasis hairlines (ink 18%)      |
| `--icon-primary` / `--icon-secondary` | Active and resting icons                    |

### Signal and status

Colour is reserved for **state**. Each state has a solid, a `-subtle` fill and a `-text` value tuned for contrast on that fill.

| Token       | Meaning                                                        |
| ----------- | -------------------------------------------------------------- |
| `--signal`  | Live, an agent is working, focus rings, agent-invoking actions |
| `--success` | Done, connected, healthy                                       |
| `--warning` | Waiting on a person: approval, input, blocked                  |
| `--danger`  | Failed, destructive, error                                     |

Rules:

- Signal blue is not a brand colour to sprinkle on things. Links in body copy are underlined ink, not blue.
- Never use status colour for decoration, illustration, or category coding.
- Third-party brand colours (Linear purple, GitHub black, Better Stack green) do not appear in the UI chrome. See §10.
- Any state shown in colour is also shown in text or shape (a label, an icon, `sr-only` text).

### Dark mode

Dark follows the operating system by default (`prefers-color-scheme`). The app can pin a theme with `data-theme="light" | "dark"` on `<html>`. Both themes are a remapping of the same semantic tokens. If a component needs a dark-only override, the token set is incomplete; add a token instead.

## 5. Typography

Three families, all open source (SIL OFL) and self-hosted through `@fontsource-variable` so the Mac app works offline:

| Family                | Role                                                                               |
| --------------------- | ---------------------------------------------------------------------------------- |
| **Newsreader** (opsz) | Display moments only: sign-in, empty states, channel intro, dialog and page titles |
| **Geist**             | All product UI and reading text                                                    |
| **Geist Mono**        | Identifiers, commands, tool input/output, code, scopes                             |

### Scale

| Role    | Class / token    | Size / line height   | Notes                                    |
| ------- | ---------------- | -------------------- | ---------------------------------------- |
| Display | `.t-display`     | 34–64px, lh ≈1.05    | Newsreader, `opsz` 72, tracking −0.018em |
| Title   | `.t-title`       | 26/32                | Newsreader, channel intro, page titles   |
| Dialog  | `.dialog__title` | 20/26                | Newsreader                               |
| Heading | channel name     | 14/22 semibold       | Geist                                    |
| Body    | `.t-body`        | 14/22                | Messages, long text                      |
| UI      | `--text-sm`      | 13/20                | Nav, buttons, controls                   |
| Meta    | `.t-meta`        | 12/16 tertiary       | Timestamps, hints                        |
| Label   | `.t-label`       | 11/14 caps, +0.06em  | Section labels only                      |
| Mono    | `.t-mono`        | 12 (11 inside chips) | Never for prose                          |

Rules:

- **Serif never appears in dense UI**: not in lists, buttons, nav, messages or tables.
- Weights: 400 for reading, 500 for UI emphasis, 600 for names and headings. No bold (700) in the product.
- Body tracking is −0.011em; display tracking is −0.018em. Do not track uppercase body text.
- Keep reading text to `--measure` (72ch).
- Use tabular numerals (`font-variant-numeric: tabular-nums`) where numbers align (times in run steps, metrics).

## 6. Space, layout, shape, elevation

**Spacing** is a 4px grid: `--space-0-5` (2) · `1` (4) · `1-5` (6) · `2` (8) · `2-5` (10) · `3` (12) · `4` (16) · `5` (20) · `6` (24) · `8` (32) · `10` (40) · `12` (48) · `16` (64) · `24` (96). Do not invent in-between values.

**Layout**

```
┌──────────────┬──────────────────────────────────────────┬─────────────────┐
│ Sidebar 248  │ Header 52  (title · status · actions)    │ Panel 380       │
│ workspace    ├──────────────────────────────────────────┤ (future: thread,│
│ sections     │ Conversation (24px side padding)         │  run inspector, │
│ …            │                                          │  agent details) │
│ profile      │ Composer                                 │                 │
└──────────────┴──────────────────────────────────────────┴─────────────────┘
```

- Sidebar `--sidebar-width: 248px`, header `--header-height: 52px`, right panel `--panel-width: 380px`.
- Regions are separated by `--border-subtle` hairlines, not by shadows or contrasting backgrounds.
- Content padding is 24px on desktop, 16px under 760px, 12px for the composer on small screens.

**Control heights**: `--control-xs` 24 · `sm` 28 · `md` 32 (default in-app) · `lg` 40 (forms, auth, primary CTAs).

**Radius grows with the object**: `xs` 4 (badges, kbd) · `sm` 6 (chips, small buttons) · `md` 8 (buttons, inputs, nav rows) · `lg` 12 (cards, composer, agent replies) · `xl` 16 (dialogs) · `full` (avatars, pill CTAs, send button, run status).

**Elevation**: hairlines first, shadows second.

| Token         | Use                                       |
| ------------- | ----------------------------------------- |
| `--shadow-xs` | Resting cards, inputs, secondary buttons  |
| `--shadow-sm` | Composer, approval requests               |
| `--shadow-md` | Popovers, floating message toolbar, menus |
| `--shadow-lg` | Dialogs                                   |

Borders are drawn with inset `box-shadow` (`inset 0 0 0 1px var(--border-default)`), so they never change layout and stack cleanly with elevation.

## 7. Motion

Motion confirms cause and effect. It never decorates.

| Token                | Value                        | Use                          |
| -------------------- | ---------------------------- | ---------------------------- |
| `--duration-instant` | 80ms                         | Press feedback               |
| `--duration-fast`    | 140ms                        | Hover, colour, small reveals |
| `--duration-base`    | 200ms                        | Backdrop fade, panel slide   |
| `--duration-slow`    | 320ms                        | Dialog entrance              |
| `--ease-out`         | `cubic-bezier(0.2, 0, 0, 1)` | Default                      |
| `--ease-spring`      | `linear(…)` slight overshoot | Dialogs, popovers entering   |

- Buttons scale to 0.98 on press. Nothing bounces on hover.
- Only two things loop: the spinner, and the pulse on a `working` status dot. Nothing else animates indefinitely.
- `prefers-reduced-motion` reduces every animation and transition to near zero (`base.css`).

## 8. Iconography

- [Lucide](https://lucide.dev) icons, one stroke weight (1.75) set globally on `.lucide`.
- Sizes: 14px in small controls, 15px in buttons and nav, 16px in icon buttons and headers, 20px in feature tiles.
- Icons are `aria-hidden`. The control carries the label (`IconButton` requires `label`).
- Icons stand for **object types and actions**, not brands: `CircleDashed` issue, `GitPullRequest` pull request, `Activity` incident/metric, `Rocket` deploy, `Quote` message, `Hash` public channel, `Lock` private channel, `Sparkles` invoke an agent, `Sparkle` agent identity.

## 9. Agents at work

This is the part of the language that will grow the most. It is designed for a future where teams build their own agents, invite agents from elsewhere, and hand them real work: acknowledge an issue, code alongside people, deploy to test, monitor, and report.

### 9.1 Identity

| Participant | Avatar                                                           | Name row                    |
| ----------- | ---------------------------------------------------------------- | --------------------------- |
| Person      | Circle, initial on `--surface-sunken`                            | Name · time                 |
| Agent       | Squircle (30% radius), `--surface-inverse` with the sparkle mark | Name · `Agent` badge · time |

Shape and a text badge carry identity, so it survives greyscale, colour blindness, and dark mode. Later an agent can carry an owner ("by Platform team") and a provenance badge (internal, external, verified) using `Badge outline`.

### 9.2 State model

Every agent and every run is in exactly one of these states. The mapping is fixed across the product.

| State     | Dot / colour    | Label     | Meaning                                       |
| --------- | --------------- | --------- | --------------------------------------------- |
| `idle`    | neutral         | Idle      | Available, doing nothing                      |
| `working` | signal, pulsing | Working   | Actively executing; can be stopped            |
| `waiting` | warning         | Needs you | Blocked on a person (approval, input, access) |
| `done`    | success         | Done      | Finished; result posted with sources          |
| `failed`  | danger          | Failed    | Stopped with an error a person can read       |

### 9.3 Run card

A run is an agent's unit of work, shown as a short, scannable timeline (`RunCard` in `components/patterns.tsx`):

- **Header**: agent avatar, agent name, one-line goal with the source ID ("Fix checkout timeouts · ENG-142"), and the run state.
- **Sources**: chips for what triggered the run and what it is working from.
- **Steps**: past-tense for finished work ("Reproduced in staging"), imperative for upcoming work ("Monitor error rate for 30 min"). Each step has a state icon: done (ink check), running (signal spinner), waiting (warning shield), pending (dashed circle), failed (danger ×), skipped (dash). Steps can carry a detail line or a chip (the PR it opened).
- **Footer**: who started it, how long it has run, and **Stop run**. Every run can be stopped from where it is shown.

The in-channel `run-status` pill above the composer is the compact form of the same thing: agent avatar, a verb phrase, spinner, Cancel.

### 9.4 Approvals

When an agent needs a person (to deploy, merge, spend, or reach outside its scope), it posts an `ApprovalRequest`:

- A warning left rule and shield icon, and the sentence "**Agent** wants to _do a specific thing_."
- The exact scope in mono: branch, environment, permissions requested.
- Two buttons: **Decline** (ghost) and **Approve** (primary). Approval is never the default focus and is never auto-dismissed.
- The run card's step shows `waiting` until a person answers; the answer and the person who gave it are recorded in the timeline.

### 9.5 Tool calls

Tool calls are collapsed by default to one mono line: chevron, tool name (`github.create_pull_request`), plain-language summary, state. Expanding shows input and output in mono. Failures show a `Failed` badge and the reason in the summary ("Permission denied: deploy:test"). People should never need to expand a tool call to understand what happened; it is there for trust and debugging.

### 9.6 Agent directory

`AgentCard`: avatar, name, owner, status, a one-sentence description of what it does, its capabilities as `outline` badges in scope form (`read:issues`, `write:code`, `deploy:test`), and one action (**Add to channel**). Capabilities read like permissions because they are permissions.

### 9.7 Rules for agent UI

- Agents speak in first person, briefly, and lead with the outcome.
- Every claim an agent makes about external state carries a source chip.
- An agent's access is always inspectable from its message (avatar → agent details) and its run card.
- Agent output that is test, mock, or degraded output must say so in the message itself.
- Agents never use colour, motion, or notification weight beyond what a person's message gets, except the `working` pulse and `waiting` state.

## 10. Connected context

Integrations (Linear, GitHub, Better Stack, deploy targets) bring their objects into the workspace. They appear in exactly two forms.

**Source chip** (`SourceChip`): `[type icon] MONO-ID  Short title`. For example, `ENG-142 Checkout timeouts in EU`, `#482 Retry payment intent once`, `INC-311 Elevated 5xx on /checkout`. Chips are buttons when they open something. They are the only way an external object appears inline in a message, run, or approval.

**Integration row** (`IntegrationRow`): type icon tile, system name, a description or freshness line ("Synced 2 min ago · 3 teams"), and either a `Connected` badge or a **Connect** button.

Rules:

- Name the system in text ("Better Stack"). Use object-type icons, not logos, inside the product chrome. Official logos may appear on the integrations settings page only, following each vendor's brand guidelines.
- Show freshness wherever synced data drives a decision.
- When a source changes after an agent cited it, mark the reply (the current UI shows "Sources changed since this summary").

## 11. Components

Primitives live in `components/ui.tsx` with styles in `styles/components.css`. Agent-era patterns live in `components/patterns.tsx` with `styles/patterns.css`.

| Component                                                               | Variants / props                                                                                            | Rule of use                                                                                                   |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `Button`                                                                | `primary` · `secondary` · `ghost` · `signal` · `danger`; `sm`/`md`/`lg`; `pill`; `block`; `icon`/`trailing` | One `primary` per view. `signal` only for actions that invoke an agent. `pill` only for standalone hero CTAs. |
| `IconButton`                                                            | `xs`/`sm`/`md`; required `label`                                                                            | Toolbar and header actions                                                                                    |
| `Field`, `TextArea`                                                     | label, hint                                                                                                 | Labels sit above inputs; no placeholder-as-label                                                              |
| `Avatar`                                                                | `human`/`agent`; `xs`–`xl`                                                                                  | See §9.1                                                                                                      |
| `Badge`                                                                 | `neutral` · `signal` · `success` · `warning` · `danger`; `outline`                                          | State and short facts. Never as a button.                                                                     |
| `Dot`                                                                   | `live` · `working` · `waiting` · `error`; `pulse`                                                           | Always next to a text label                                                                                   |
| `Kbd`                                                                   |                                                                                                             | Keyboard hints                                                                                                |
| `Spinner`                                                               |                                                                                                             | Inline progress, inherits colour                                                                              |
| `Callout`                                                               | default, `danger` (role=alert)                                                                              | Inline notices; not for toasts                                                                                |
| `Dialog`                                                                | title (serif), description, Escape and backdrop close                                                       | One task per dialog                                                                                           |
| `SourceChip`                                                            | mark, mono id, label, optional `onClick`                                                                    | §10                                                                                                           |
| `Mark`, `Wordmark`                                                      |                                                                                                             | Brand; the dot in the mark is the only brand use of signal blue                                               |
| `RunCard`, `ApprovalRequest`, `ToolCall`, `IntegrationRow`, `AgentCard` |                                                                                                             | §9, §10                                                                                                       |

Product surfaces built from these (in `styles/app.css`): auth split screen, sidebar (`nav-item` with `aria-current="page"`), channel header, conversation (day dividers, grouped consecutive messages, floating message toolbar), agent reply frame with citations, run-status pill, composer with send button.

## 12. Accessibility

- Target WCAG 2.2 AA. `--text-tertiary` is for meta text only and is never the only carrier of meaning.
- Every interactive element is reachable by keyboard and shows the focus ring (`--focus-ring`: 2px app-coloured gap plus 2px signal).
- Icon-only controls have an `aria-label`. Decorative icons are `aria-hidden`.
- State is never conveyed by colour alone: dots come with labels, step states include `sr-only` text, private channels announce "(private)".
- Dialogs are `role="dialog"` with `aria-modal`, close on Escape and backdrop click, and take focus when opened.
- Respect `prefers-reduced-motion` and `prefers-color-scheme`.
- Hit targets are at least 24px (`--control-xs`), and 32px for primary navigation.

## 13. Working with the system

**Files**

```
apps/client/src/styles/
  tokens.css         primitives + semantic tokens, light and dark
  base.css           reset, typography roles, focus, reduced motion
  components.css     primitives (button, field, avatar, badge, chip, dialog…)
  patterns.css       agent-era patterns (run card, approval, tool call, integrations)
  app.css            product surfaces (auth, shell, sidebar, conversation, composer)
  design-system.css  the #/design reference page only
apps/client/src/components/
  ui.tsx             primitives
  patterns.tsx       agent-era patterns
  DesignSystem.tsx   living reference (lazy-loaded at #/design)
```

**Adding something**

1. Need a new colour? Add a semantic token in both themes in `tokens.css`. Do not reach for a raw value.
2. Need a new component? Build it from existing primitives first. If it is reusable, add it to `ui.tsx` or `patterns.tsx` and show it on `#/design`.
3. Update this document in the same change when you add a token, a component, or a rule.

**Review checklist**

- [ ] Only semantic tokens; no raw hex, px font sizes outside the scale, or off-grid spacing.
- [ ] Works in light and dark (toggle on `#/design`, or switch the OS theme).
- [ ] One primary action; colour only where it signals state.
- [ ] Serif only for display moments.
- [ ] Keyboard and screen reader path checked; no colour-only meaning.
- [ ] Agent-facing UI shows what the agent is doing, its sources, and how to stop it.

## 14. Open decisions

- **Signal hue.** Currently a calm blue (`#3a5ff0` light / `#6d8bff` dark). It is one token pair, so it can be retuned once the brand settles.
- **Display face.** Newsreader stands in for a commercial editorial serif. Revisit if we license one; only `--font-display` changes.
- **Right panel.** Reserved at 380px for threads, the run inspector, and agent details. Its first use will define the panel header pattern.
- **Command palette (⌘K)** and global search. Their design should reuse `Dialog` elevation and `nav-item` rows.
- **Density setting** (comfortable / compact) for heavy agent timelines, done by remapping `--control-*` and message padding.
- **Notifications.** Agents in `waiting` should be the only agent state that notifies by default.
