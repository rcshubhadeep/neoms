# Milestone 1: persistent conversations across Mac and browser

## Outcome

Two people sign in, join the same workspace, exchange messages between a Mac app and a browser, recover missed changes after disconnecting, and ask a channel-scoped assistant to summarize the conversation. Messages and agent runs survive application and server restarts.

Follow `FIRST_PLAN.md`. Build an API-first product; the React interface is shared by the browser and Tauri 2 shell. Phone implementation and validation are deferred.

## Scope

- Sign in through Supabase Auth; verified identities on every API request.
- Create a workspace and redeem a single-use, expiring invitation.
- List workspace members and conversations the caller may access.
- Create a channel and manage its membership, including one private channel for permission testing.
- Send plain-text messages, paginate history, edit/delete one's own messages, and show pending/saved/failed states.
- Synchronize changes after reconnecting or reopening the application.
- One assistant, explicitly invoked to summarize a channel. Its reply links to source messages.
- Basic desktop sidebar, message list, composer, and assistant run status.

Defer DMs, threads, attachments, reactions, unread counts, presence, push notifications, external integrations, billing, autonomous actions, and production hosting. Keep the conversation model extensible for DMs and threads.

## Stack and layout

Use Node 24.7.0 and npm workspaces, with exact installed versions recorded in the lockfile. Verify dependency compatibility during scaffolding rather than guessing version numbers.

```text
apps/client/             React, TypeScript, Vite; Tauri shell in src-tauri/
apps/server/             Hono API and domain modules
apps/worker/             pg-boss publication and assistant workers
packages/contracts/     Request/event schemas, generated OpenAPI, typed API client
packages/db/            SQL migrations, queries, transactions
packages/domain/        Shared server-side authorization and message operations
tests/integration/      Real database and permission/reliability scenarios
tests/e2e/              Browser workflows
docs/                   Architecture, milestone, setup instructions
```

Use local Supabase for Postgres/Auth/Realtime during development, subject to a working Docker runtime. Storage is deferred. API and worker share domain code and deployable tooling; this is one product backend, not a microservice architecture. Native Rust code stays limited to the Tauri shell and necessary device integrations.

## Implementation order

### 1. Scaffold and prove the shells

- Initialize Git, npm workspaces, TypeScript, linting, formatting, and test commands.
- Pin Node with `.nvmrc`; document `nvm use alias default v24.7.0`.
- Start the client, API health endpoint, and local Supabase.
- Run the shared interface in a browser and Tauri on Mac.
- Add `.env.example`; keep secrets and model credentials on the server.

Gate: a documented local setup starts both clients and connects them to the same API.

### 2. Identity, discovery, and permissions

- Add migrations for workspaces, participants, workspace memberships, invitations, conversations, and conversation memberships.
- Separate human and agent participant types; authenticated user IDs map to human participants.
- Implement workspace creation, invitation acceptance, member directory, and permitted conversation listing.
- Authenticate API requests through verified Supabase tokens, never client-supplied user IDs.
- Apply authorization to all reads and writes; private channels are omitted from unauthorized discovery.

Gate: two users join one workspace; a third identity cannot inspect its data.

### 3. Durable messaging API

- Add messages, message revisions/deletion tombstones, conversation events, and durable publication jobs.
- Send/edit/delete through the server. Set authorship on the server.
- Persist each mutation, its event, and publication job in one Postgres transaction.
- Use a client-generated request ID with a database uniqueness constraint scoped to sender and conversation. Reusing it with different content returns a conflict.
- Use stable history pagination and a commit-safe per-conversation event sequence. Serialize sequence assignment through a conversation row lock; a bare database sequence does not guarantee commit order.
- Expose versioned endpoints and generated OpenAPI contracts.

Gate: retries create one message, acknowledgements follow commit, and messages survive restart.

### 4. Live delivery and recovery

- Publish persisted changes through authorized Supabase Realtime private channels.
- Treat events as at-least-once delivery; clients deduplicate and reconcile against server state.
- Persist client synchronization cursors and pending sends through a shared client storage interface. Choose and validate browser/Tauri storage in this step.
- Subscribe and buffer live events before fetching a snapshot/replaying changes, then merge by event sequence. Capture snapshot data and its cursor consistently.
- Reconcile on reconnect, app resume, and periodically while open; never advance the durable cursor past a gap.
- Define an expired-cursor response that triggers a fresh snapshot.
- Re-check permission at catch-up and subscription boundaries. Prove active membership revocation prevents further private event exposure, and clear inaccessible cached conversations.
- If managed Realtime cannot meet the active-revocation requirement, move live delivery behind an authenticated server event endpoint while keeping the public client contract unchanged.

Gate: disconnected clients recover creates/edits/deletes without duplicates or gaps; unauthorized or revoked identities receive no new private content.

### 5. Channel-scoped assistant

- Add assistant membership, agent runs, and an explicit invocation endpoint with an idempotency key.
- Enqueue work transactionally and persist queued/running/completed/failed status.
- Retrieve only context allowed for both the requester and assistant; revalidate access before fetching context and before publishing an answer.
- Use one hosted model through a provider interface. Include a deterministic test provider for local automated tests.
- Require structured source references; validate that cited message IDs belong to supplied context and render them as navigable links.
- Apply bounded context, timeout, retry, and output limits. Treat message content as untrusted input; give the assistant no external-action tools.
- Save replies through the normal message service with a run-scoped uniqueness key to avoid duplicate answers after retries.
- Invalidate affected summaries when their source messages change or are deleted. Avoid exposing agent results if the requester loses access while a run is pending.

Gate: a real model produces a cited summary when credentials are configured; jobs survive client closure and worker restart. Automated tests do not require paid model calls. Without credentials, mark live-model verification outstanding rather than calling a test response a working AI feature.

### 6. Verify and hand over

- Run database-backed tests for workspace isolation, channel membership, active revocation, idempotent sends, publication retry, cursor races, and duplicate-safe agent completion.
- Run Playwright with two independent authenticated browser contexts for invitation, messaging, edits/deletes, offline recovery, and assistant status.
- Smoke-test the same workflow in the Mac application against the browser.
- Confirm a release Mac build can connect to the API; signing/distribution is a later release task.
- Document configuration, migrations, development commands, limitations, and the repeatable acceptance demo.

## Acceptance demo

1. Alice creates a workspace in the Mac app and invites Bob.
2. Bob accepts in a browser and joins a shared channel.
3. Both exchange messages; refresh/reopen preserves history.
4. Bob disconnects; Alice sends, edits, and deletes messages.
5. Bob reconnects and sees the correct final state with no duplicates.
6. A timed-out send retried with the same ID creates exactly one message.
7. Alice asks the assistant to summarize, closes the app, and returns to its cited response.
8. A third user cannot read channel history, catch-up events, or assistant context.
9. Revoke Bob's channel access while connected; further private changes are inaccessible and cached content is cleared on reconciliation.
10. Restart the API/worker around queued work; messages persist and retries do not duplicate assistant replies.

## Dependencies and working approach

Docker must run for the proposed local Supabase setup. A hosted model credential is needed only for real-model validation. No iPhone is needed for this milestone.

Work in small, reviewable increments in the order above. Keep setup and contracts documented alongside implementation. Finish reliability and permission gates before expanding UI features. Estimate effort after the scaffold and first real cross-client message, rather than treating a calendar estimate as a delivery commitment.
