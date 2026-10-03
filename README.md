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

Supabase start applies migrations when creating its database. `db:migrate` applies any remaining local migrations. `setup:env` writes local settings to the ignored `.env` file without printing credentials. It preserves existing model settings. Never put server secrets in a `VITE_` variable.

- Browser: http://127.0.0.1:1420
- API health: http://127.0.0.1:3001/health
- OpenAPI: http://127.0.0.1:3001/openapi.json
- Local Supabase Studio: http://127.0.0.1:54323

`npm run dev` starts the API, summary worker, and browser client. To open the Mac application in a separate terminal while those services run:

```sh
npm run dev:mac
```

The Mac command reuses the running Vite server. Run `npm run dev` first.

## Try the workflow

Create an account in the app, create a workspace, and use **Invite a teammate** to generate a single-use token. A teammate creates an account and enters the token under **Join**. Both can send messages in `general`. Workspace owners can create channels and add/remove channel members through **Members**.

Alternatively, seed two local demo accounts and sample messages:

```sh
npm run demo
```

Sign in as `alice@neoms.test` or `bob@neoms.test`, password `local-demo-password`. This seed command is restricted to the local Supabase URL. Alice owns the `Neoms demo` workspace. These accounts are only for local development.

## Assistant configuration

The default `AI_PROVIDER=test` is a deterministic development provider. Its messages explicitly say **not an AI summary**. It exercises queueing, access checks, provenance, and delivery without model credentials or charges.

A hosted Anthropic adapter is implemented, but real-model verification requires configuring these **server-only** settings in `.env`:

```dotenv
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=your-key
ANTHROPIC_MODEL=your-supported-model-id
```

Restart the API and worker after changing model settings. Use **Catch me up** to summarize recent human messages in the selected channel. Replies include navigable source references. The assistant has no external-action tools. Editing/deleting cited sources invalidates affected summaries.

## Verification

With local Supabase running and `.env` configured:

```sh
npm run check
npm test
npx playwright install chromium
npm run test:e2e
```

`check` runs formatting, lint, TypeScript, and production build checks. Integration tests create and clean up their own users/workspaces, enforce the local database URL, and use an isolated job queue. Browser tests use independent accounts and exercise real API/Auth/database/worker behavior. Keep `AI_PROVIDER=test` for the browser workflow test.

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

See [milestone plan](docs/MILESTONE_1.md) and [implementation notes](docs/IMPLEMENTATION.md).

## Current limits

Phone builds and device behavior are unverified. DMs, threads, attachments, push, billing, and external agents are deferred. Live delivery uses a server-managed stream with database polling; this is intended for a small initial pilot. Event logs are retained indefinitely in this milestone. Client caches use local storage; access revocation clears cached conversation content after the client reconnects/reconciles. An offline device cannot learn about revocation until it reconnects.

Do not reset the database to apply migrations. `npm run db:reset` is a destructive local development command that erases product data and demo accounts.
