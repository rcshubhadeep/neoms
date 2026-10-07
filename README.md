# Neoms

A shared conversation space for people and agents. API-first, with one React client for the browser and Tauri 2 application shell. Mac is the first native target; phone work is deferred.

## Local setup

Requirements: Node **24.7.0**, npm, Docker Desktop running. The Mac app also requires Rust and Xcode command-line tools.

```sh
source "$HOME/.nvm/nvm.sh"
nvm use alias default v24.7.0
npm ci
npm run db:start
npm run setup:env
npm run db:migrate
npm run dev
```

Supabase start applies migrations when creating its database. `db:migrate` applies any remaining local migrations. `setup:env` writes local settings to the ignored `.env` file without printing credentials. It also generates an installation encryption key when missing and preserves an existing valid key. Never put server secrets in a `VITE_` variable.

- Browser: http://127.0.0.1:1420
- API health: http://127.0.0.1:3001/health
- OpenAPI: http://127.0.0.1:3001/openapi.json
- Local Supabase Studio: http://127.0.0.1:54323
- Design reference: http://127.0.0.1:1420/#/design (see [docs/DESIGN.md](docs/DESIGN.md))

`npm run dev` starts the API, agent worker, and browser client. To open the Mac application in a separate terminal while those services run:

```sh
npm run dev:mac
```

The Mac command reuses the running Vite server. Run `npm run dev` first.

## Windows setup

Windows supports the browser client and the Tauri desktop app. All commands below
run in **PowerShell** from the repository directory. Mac commands remain above.

### Prerequisites

- **Node 24.7.0 and npm:** the version is pinned in `.nvmrc` and `package.json`.
  The setup on this machine uses `.local/node-v24.7.0-win-x64`, leaving the existing
  system Node installation intact. This ignored folder is specific to this checkout;
  a fresh checkout needs Node installed separately. Download the pinned version from
  [Node.js](https://nodejs.org/dist/v24.7.0/).
- **Docker Desktop:** start it and wait for its Linux engine to be ready. Use its
  WSL 2 backend. See [Docker's Windows setup](https://docs.docker.com/desktop/setup/install/windows-install/).
- **Desktop builds only:** Rust/Cargo with the `stable-x86_64-pc-windows-msvc`
  toolchain, Visual Studio Build Tools with **Desktop development with C++**
  (including the Windows SDK), and Microsoft Edge WebView2. See
  [Tauri's Windows prerequisites](https://v2.tauri.app/start/prerequisites/).

Windows Package Manager can install the Docker and desktop prerequisites:

```powershell
winget install --id Docker.DockerDesktop --exact --source winget
winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --source winget --override "--wait --quiet --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install --id Rustlang.Rustup --exact --source winget
winget install --id Microsoft.EdgeWebView2Runtime --exact --source winget
```

Approve administrator prompts when Windows requests them. Finish one installer
before starting the next. If an installer requests a restart, save your work and
restart when convenient; the browser workflow can continue while it is running.
Open a new terminal after installation so it picks up PATH changes.

### First run

For this checkout, set PATH **before** running npm commands. PATH changes apply
only to the current terminal, so repeat them in each new development terminal:

```powershell
cd C:\Users\shubh\neoms
$env:Path = "$PWD\.local\node-v24.7.0-win-x64;$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin;$env:USERPROFILE\.cargo\bin;$env:Path"
node --version
npm --version
docker info
```

If Docker was installed system-wide, its CLI should already be on PATH; the
user-install path above covers this machine. With Docker Desktop running:

```powershell
npm ci
npm run db:start
npm run setup:env
npm run db:migrate
npm run dev
```

`setup:env` writes the ignored `.env` without printing secrets. The API, worker,
and browser client run together in the terminal. Keep it open. Open
[Neoms in the browser](http://127.0.0.1:1420) and create an account, or use
`npm run demo` in another configured terminal for the demo accounts below.

### Everyday development and restarting

After initial setup, start Docker Desktop and run:

```powershell
cd C:\Users\shubh\neoms
.\start-neoms.cmd
```

The launcher selects the local Node installation when present, starts Supabase,
refreshes local settings, applies pending migrations, and runs the API, worker,
and browser client. Keep its terminal open. Run only one copy of the development
services at a time. Use **Ctrl+C** in that terminal to stop them. Supabase keeps
running; `npm run db:stop` stops it without resetting the database.

The browser automatically updates when you save UI changes. The API and worker
restart when their source changes. **You do not need to rebuild or reinstall the
desktop app for each iteration.** After a reboot, start Docker Desktop and the
launcher again; Neoms does not automatically start its backend on Windows login.

To develop in a desktop window, leave the launcher running and open a **second**
PowerShell terminal. Set PATH there too, then run:

```powershell
cd C:\Users\shubh\neoms
$env:Path = "$PWD\.local\node-v24.7.0-win-x64;$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin;$env:USERPROFILE\.cargo\bin;$env:Path"
npm run dev:windows
```

This window uses the live Vite client. UI changes appear automatically; Rust
changes trigger a native rebuild. The desktop development command reuses the
already-running services. Closing that window leaves the backend running.

### Building and installing the desktop app

In a terminal with Node/npm and Cargo on PATH:

```powershell
npm run build:windows
```

The first native build downloads Rust dependencies and installer tools and can
take several minutes. Output:
`apps/client/src-tauri/target/release/bundle/nsis/Neoms_0.1.0_x64-setup.exe`.
Run the generated installer to install or update Neoms for your Windows account.
The installation on this machine creates a **Neoms** Start menu shortcut and
installs the executable at `%LOCALAPPDATA%\Neoms\neoms.exe`.

The Start menu app contains the UI built at packaging time. To update that
version, build again and rerun the new installer. Use it to check packaged
behavior; use the browser or `dev:windows` for daily development. These local
builds are unsigned and intended for local testing.

The installed app still needs Supabase, the API, and the worker running. It uses
the API and Supabase URLs embedded from `.env` at build time. Installing the
desktop app does not install or start the backend as Windows services.

### Verification and troubleshooting

With local Supabase and the configured `.env`, use the same checks as on Mac:

```powershell
npm run check
npm test
npx playwright install chromium
npm run test:e2e
```

- **npm is missing or PowerShell blocks `npm.ps1`:** set PATH as above and use
  `npm.cmd` (and `npx.cmd`) instead of changing the machine's execution policy.
- **Docker connection fails:** start Docker Desktop, wait for its engine, and
  confirm `docker info` works. Complete any pending WSL setup or restart request.
- **Cargo or a linker is missing:** reopen the terminal, check `rustc --version`
  and `cargo --version`, and confirm the C++ workload and Windows SDK are installed.
- **Port 1420 or 3001 is already in use:** check whether another Neoms development
  terminal is already running; reuse it or stop it before starting another.
- **The Start menu app does not show edits:** use `npm run dev:windows` for live
  changes, or rebuild and reinstall the packaged version.
- **A first build or Supabase start hits a download timeout/rate limit:** retry
  once network access recovers. Successful dependencies and Docker images are
  cached for later runs. Do not reset the database to resolve a download failure.
- **New database migrations:** run `npm run db:migrate`; avoid `db:reset`, which
  erases local data. The launcher applies pending migrations automatically.

## Try the workflow

Create an account in the app, create a workspace, and use **Invite a teammate** to generate a single-use token. A teammate creates an account and enters the token under **Join**. Both can send messages in `general`. Active members can create channels using **New channel**. Channel creators and authorized workspace admins can manage accessible channel membership through **Members**. Click a person under **People** to start a private one-to-one conversation. DMs contain exactly two people and have no assistant.

Alternatively, seed two local demo accounts and sample messages:

```sh
npm run demo
```

Sign in as `alice@neoms.test` or `bob@neoms.test`, password `local-demo-password`. This seed command is restricted to the local Supabase URL. Alice owns the `Neoms demo` workspace. These accounts are only for local development.

## Unread conversations

Channel and direct-message names become **bold** with a small dot when someone
else sends an unread message. The indicators update with the sidebar's five-second
refresh and survive reloads and sign-ins because read positions are saved per
person on the server. Viewing a conversation in the focused, visible app clears
its indicator after its messages load. Your own messages and edits do not create
new unread indicators; deleted messages do not keep a conversation unread.

## Workspace administration and BYOK

Owners and admins open **Workspace settings** from the sidebar:

- **Members:** view members, disable/re-enable workspace access; owners appoint/demote admins. The owner and your own membership cannot be disabled here.
- **Invitations:** create single-use, seven-day tokens and revoke unused tokens. Existing token values are never retrievable.
- **LLM configuration:** select Anthropic, an OpenAI-compatible API, or the test provider. For a compatible API, set its base URL and key. Model IDs stay editable; suggestions load automatically after saving when listing is supported. **Load available models** previews a connection before saving. All members use the workspace configuration; changes take effect without a process restart.
- **Usage:** view all-time provider-reported input/output/cache tokens and attempts per member and model. Retries count separately. Unknown/pending usage is explicitly shown; test runs are excluded from billable totals.

New and migrated workspaces start with the deterministic **test provider**. Its messages explicitly say **not an AI summary**. Select **Anthropic** or **OpenAI-compatible API**, enter a model ID available to your account, and save the key to enable model summaries. For compatible APIs, include the API root (for example `https://api.openai.com/v1`); use Compatibility settings if your endpoint expects `max_tokens` instead of `max_completion_tokens`. Manual model entry works without listing. Live-provider verification requires your real credential; automated tests use controlled responses and incur no model charges.

Secrets are encrypted with AES-256-GCM using `LLM_ENCRYPTION_KEY`, a 64-character hexadecimal installation secret shared by the API and worker. Local `setup:env` generates it. Self-host operators must supply it through their server secret configuration and back it up separately from the database. Never place it in a `VITE_` variable. Workspace APIs return only key-presence metadata, never plaintext or ciphertext. Legacy `AI_PROVIDER`/`ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL` environment settings are no longer used.

Use **Catch me up** in a channel or direct message you belong to. New results are visible only to the requester until they explicitly choose **Post to conversation**. In DMs, the assistant does not become a member; input consent is still the existing built-in compatibility behavior, with a separate consent gate required before expanding DM agents. Requests use the workspace's model/key and contribute to the requesting member's usage. Replies link to source messages; editing/deleting any selected source invalidates affected results. Configuration changes invalidate unfinished runs. The assistant has no external-action tools.

Channels now have an agent picker: **Scribe** provides Catch me up, and **Planner**
provides suggested actions with citations. Runs pin an immutable agent definition
version. New workspaces include both agents in `general`; subsequent new channels
require an explicit agent grant through **Members**. Existing Assistant identities
and grants are preserved; add Planner to an existing channel through **Members**.
Both agents use the same AI SDK adapter and workspace model connection. Choose
**Recent messages**, **Unread when opened**, or **Since a date**. Scope is pinned
before execution, and limited coverage requires confirmation. Private results
show coverage, citations, and expiry; they are not persisted in browser storage.
Posting stays in the source conversation and records the sharing human.

Workspace settings → **Agent limits** controls context/output, messages, history,
attempts, concurrency, UTC daily/member and monthly/workspace token budgets,
retention, and sharing. Agent/conversation/request limits only tighten workspace
ceilings. Full serialized input is conservatively estimated using UTF-8 bytes
plus framing allowance; hosted calls reserve input and output for all allowed
attempts. Unknown attempts remain charged at that estimate. These are token
admission budgets, not dollar billing guarantees or exact provider tokenization.
The deterministic test provider reserves no paid tokens. Private copies expire
after 7 days by default, with server maintenance every five seconds and enforcement on
read; intentionally published messages follow conversation retention.

Choose **Inspect run** beside **Post to conversation** on your private result
(or **Inspect … run** in the run history) to see private execution details, steps, attempts,
selected sources, limits, and usage, including after reload. **Stop run** requests
cancellation; running work shows stopping until the worker acknowledges or its
lease expires. Supported provider calls are aborted, but remote processing/billing
may already have occurred. Retry attempts are bounded and stale workers cannot
save a late result. Crash recovery preserves the pinned context; it restarts a
model attempt rather than resuming a model's internal state.

The [permission and visibility gates](docs/AGENT_PERMISSIONS.md) apply to every
future capability. The natural-language builder follows in the
[agent implementation plan](docs/AGENT_IMPLEMENTATION_PLAN.md).

See [workspace administration and deployment notes](docs/WORKSPACE_ADMINISTRATION.md) for roles, deployment configuration, secret recovery, and usage limits.

## Verification

With local Supabase running and `.env` configured:

```sh
npm run check
npm test
npx playwright install chromium
npm run test:e2e
```

`check` runs formatting, lint, TypeScript, and production build checks. Integration tests create and clean up their own users/workspaces, enforce the local database URL, and use an isolated job queue. Browser tests use independent accounts and exercise real API/Auth/database/worker behavior. Browser tests configure their own workspaces and use deterministic or controlled responses.

To produce a local Mac bundle:

```sh
npm run build:mac
```

Output: `apps/client/src-tauri/target/release/bundle/macos/Neoms.app`. The bundle currently points to your configured development API and is unsigned/unnotarized. It is for local testing, not distribution.

## Layout

- `apps/client`: shared React UI and Tauri shell.
- `apps/server`: Hono HTTP API and authenticated server-sent events.
- `apps/worker`: pg-boss worker and model adapter.
- `packages/contracts`: input/output schemas, TypeScript types, API client.
- `packages/db`: Postgres transactions and durable queue.
- `packages/domain`: access control, messages, invitations, agent runs.
- `supabase/migrations`: product schema, unavailable to client REST access.
- `tests`: database integration, synchronization, and browser workflow tests.

See [workspace execution plan](docs/MILESTONE_2.md), [later agent roadmap](docs/AGENT_PLATFORM_ROADMAP.md), and [implementation notes](docs/IMPLEMENTATION.md).

## Current limits

Phone builds and device behavior are unverified. Threads, attachments, push, billing, provider-specific APIs beyond Anthropic/OpenAI-compatible Chat Completions, and external agents are deferred. Future Slack-style audio/video calls are recorded with prerequisites in the [real-time calls roadmap](docs/REALTIME_CALLS_ROADMAP.md). Live delivery uses a server-managed stream with database polling; this is intended for a small initial pilot. Event logs are retained indefinitely in this milestone. Client caches use local storage; access revocation clears cached conversation content after the client reconnects/reconciles. An offline device cannot learn about revocation until it reconnects.

Do not reset the database to apply migrations. `npm run db:reset` is a destructive local development command that erases product data and demo accounts.
