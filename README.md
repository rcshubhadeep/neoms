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

`npm run dev` starts the API, summary worker, and browser client. To open the Mac application in a separate terminal while those services run:

```sh
npm run dev:mac
```

The Mac command reuses the running Vite server. Run `npm run dev` first.

## Try the workflow

Create an account in the app, create a workspace, and use **Invite a teammate** to generate a single-use token. A teammate creates an account and enters the token under **Join**. Both can send messages in `general`. Active members can create channels using **New channel**. Channel creators and authorized workspace admins can manage accessible channel membership through **Members**. Click a person under **People** to start a private one-to-one conversation. DMs contain exactly two people and have no assistant.

Alternatively, seed two local demo accounts and sample messages:

```sh
npm run demo
```

Sign in as `alice@neoms.test` or `bob@neoms.test`, password `local-demo-password`. This seed command is restricted to the local Supabase URL. Alice owns the `Neoms demo` workspace. These accounts are only for local development.

## Workspace administration and BYOK

Owners and admins open **Workspace settings** from the sidebar:

- **Members:** view members, disable/re-enable workspace access; owners appoint/demote admins. The owner and your own membership cannot be disabled here.
- **Invitations:** create single-use, seven-day tokens and revoke unused tokens. Existing token values are never retrievable.
- **LLM configuration:** select the provider/model and set, replace, or remove the workspace API key. All members use that workspace configuration; model settings take effect without a process restart.
- **Usage:** view all-time provider-reported input/output/cache tokens and attempts per member and model. Retries count separately. Unknown/pending usage is explicitly shown; test runs are excluded from billable totals.

New and migrated workspaces start with the deterministic **test provider**. Its messages explicitly say **not an AI summary**. Select **Anthropic**, enter a model ID available to your account, and save the key to enable hosted summaries. Live-provider verification requires your real credential; automated tests use controlled responses and incur no model charges.

Secrets are encrypted with AES-256-GCM using `LLM_ENCRYPTION_KEY`, a 64-character hexadecimal installation secret shared by the API and worker. Local `setup:env` generates it. Self-host operators must supply it through their server secret configuration and back it up separately from the database. Never place it in a `VITE_` variable. Workspace APIs return only key-presence metadata, never plaintext or ciphertext. Legacy `AI_PROVIDER`/`ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL` environment settings are no longer used.

Use **Catch me up** in an authorized channel. Replies link to source messages; editing/deleting sources invalidates affected summaries. Configuration changes invalidate unpublished runs. The assistant has no external-action tools.

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

Phone builds and device behavior are unverified. Threads, attachments, push, billing, additional LLM providers, and external agents are deferred. Live delivery uses a server-managed stream with database polling; this is intended for a small initial pilot. Event logs are retained indefinitely in this milestone. Client caches use local storage; access revocation clears cached conversation content after the client reconnects/reconciles. An offline device cannot learn about revocation until it reconnects.

Do not reset the database to apply migrations. `npm run db:reset` is a destructive local development command that erases product data and demo accounts.
