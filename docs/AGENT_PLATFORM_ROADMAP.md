# Later agent platform roadmap: owned agents and durable, inspectable work

Status: deferred until workspace essentials are complete; proposal following the design-system review on 2026-10-03. This document does not start implementation.

## Outcome

A workspace member creates a configured agent, an authorized owner adds it to selected channels, and people explicitly invoke it. Every run identifies its agent, configuration version, requester, scope, steps, and sources. People can inspect and cancel work; worker failures recover without duplicate replies or stale workers publishing results.

Prove this with two agents: **Scribe**, which summarizes a conversation, and **Planner**, which extracts suggested next actions with citations. Suggested actions are text, not executed commands.

This is the foundation for an agent collaboration platform. Conversations remain the shared coordination surface; runs are persisted work; integrations supply scoped evidence; tools perform authorized actions.

## Review of the current foundation

Keep the existing React/TypeScript client, Tauri shell, Hono API, Postgres, Supabase Auth, pg-boss worker, and SQL migrations. Keep one backend with separate API and worker processes.

The new design system provides semantic tokens, self-hosted fonts, light/dark themes, reusable controls, agent identities, source chips, run timelines, approvals, and tool-call patterns. Reuse it for the next product surfaces.

The backend still implements one summary operation. Workspace creation inserts a built-in Assistant; channel creation automatically adds agents, including to private channels; invocation selects the first agent by ID. Provider configuration is global. Runs have no configuration version, persisted steps, or attempt history. Cancellation prevents later publication but does not abort the in-flight provider request. Broad authorization catch blocks can misclassify infrastructure failures as access revocation.

The agent directory, integration rows, tool calls, and approval requests in the design reference are examples, not implemented platform capabilities.

Small design fixes belong in the first slice:

- Trap dialog focus, restore it to the opener, and use unique accessible title IDs.
- Map backend states explicitly to visual states. Include queued, retrying, cancellation requested, and cancelled; do not display every terminal run as Done.
- Separate an agent's availability from each run's execution state. One agent can eventually have multiple runs.

## Scope and implementation order

### 1. Agent identity, ownership, and explicit access

- Add versioned agent definitions associated with an agent participant: workspace, creator/owner, name, description, bounded instructions, supported operation, model configuration reference, and enabled/disabled state.
- Allow workspace members to create and edit their own definitions. Channel access grants remain controlled by the existing workspace-owner policy in this milestone.
- Add a workspace agent directory and details view using `AgentCard`. Show owner, supported operation, and actual granted access.
- Explicitly add/remove agents from channels. Remove automatic inclusion of every agent in newly created private channels.
- Preserve the existing Assistant through a forward SQL migration. Audit existing private-channel grants; make any legacy grants visible rather than silently expanding access.
- Invoke a specific agent ID. Pin a configuration version when a run starts; edits affect new runs.
- Archive/disable agents without deleting authorship or historical runs.

Gate: Scribe and Planner can be created and selected independently. An agent excluded from a private channel cannot inspect its history or run there.

### 2. Shared authorization and context contracts

- Put agent operations behind the same domain authorization boundary used by the API and worker. Neither a model response nor a client-supplied author ID grants authority.
- Start with two bounded capabilities: read authorized conversation context and publish the run's validated reply. Check requester access, agent access, and capability grants at context retrieval and publication.
- Define a context-reference envelope: workspace, source type, stable source ID, version/revision, title, origin URL where applicable, and retrieval time. Implement it first for existing messages.
- Persist the selected source IDs and revisions for each run. Validate citations against this set and retain source-change invalidation. Avoid broad raw-data copies in audit logs; establish retention/redaction rules before retaining external payloads.
- Define the future connector boundary: connection identity, allowed resources, source permissions, freshness, updates, and tombstones. Connecting a source must not make all its content readable by every agent or channel.
- Use shared request/response/event schemas and update OpenAPI. Add typed database result rows while keeping parameterized SQL and Supabase-owned migrations; do not introduce a second migration system.

Gate: changing agent instructions cannot expand access. Cross-workspace IDs, removed memberships, unknown citations, and modified/deleted sources fail safely.

### 3. Durable run execution

- Generalize summary jobs into a run executor for the two supported operations. Retain transactional enqueue and run-scoped reply uniqueness.
- Persist run purpose, requester, agent/configuration version, scope, lifecycle timestamps, deadline, and sanitized errors. Persist attempts and steps: obtain context, generate response, validate, publish.
- Define legal state transitions and distinguish retryable attempts from terminal failure. Unexpected database/provider errors must not be reported as access revocation.
- Add an attempt/ownership token checked on every state transition and publication. A worker whose attempt expired or was replaced cannot publish, even if its model call eventually returns.
- Make cancellation cooperative: persist the request, signal the executing worker, abort supported provider calls, and prohibit subsequent publication. Keep cancellation requested distinct from confirmed termination; do not imply an external effect was undone.
- Apply configurable per-workspace concurrency, bounded context/output, deadlines, retry limits, and model-use accounting when available. Persist metadata sufficient to diagnose stuck runs without logging secrets.
- Keep the deterministic provider for fault-injection tests. Validate both operations with the existing hosted-provider adapter when credentials are available.

Gate: restart the worker during a running attempt, recover the run, reject stale completion, and produce one visible reply. Cancellation and access revocation during generation prevent publication.

### 4. Visible work in the existing design

- Add an agent picker for explicit invocation; preserve Catch me up as a convenient Scribe action.
- Connect `RunCard` to persisted steps. Use the reserved right panel for run details: requester, agent version, permissions, sources, attempts, result, and Stop run.
- Show real lifecycle changes through the existing event/cursor protocol. Keep run visibility permissioned; preserve sequence continuity when events are redacted.
- Show completed, failed, retrying, and cancelled runs after reload. Keep test-provider output labeled in the message itself.
- Use the same API in browser and Mac. No new native integration is required.

Gate: reopening either client reconstructs the same run history and permitted sources from server state.

## Acceptance demo

1. Alice creates Scribe and Planner and grants each access to a shared channel.
2. A private channel starts without automatically granting either agent access.
3. Bob explicitly invokes each agent; each produces a different supported result with navigable citations.
4. Alice edits Scribe while a run is executing. The running job retains its pinned version; the next run uses the new one.
5. Close the client and restart the worker mid-generation. Reopen the client and inspect recovery and attempts; only one reply is published.
6. Cancel a run while generating. Show cancellation accurately and publish no late reply.
7. Remove requester or agent access mid-run. Stop further retrieval/publication and restrict subsequent run inspection.
8. Edit/delete a source. Invalidate affected results; reject an answer generated from superseded context.
9. Attempt cross-workspace invocation, forged agent authorship, and capability escalation. Reject all three.
10. Inspect the same agent directory and run in the browser and Mac app, including keyboard operation and light/dark states.

Use database-backed tests for these failure boundaries and focused browser tests for creation, selection, inspection, and cancellation. Run formatting, lint, type checks, production build, and the existing messaging regression suite. Live-model validation remains an explicitly outstanding gate until credentials are supplied.

## Deliberate boundaries

Creating an agent initially means configuring a platform-managed agent, not uploading arbitrary executable code. Execute user code later in isolated environments with separate credentials and resource limits; never inside the API process.

Document the future externally hosted agent protocol around the same identity, capabilities, run, and context contracts. Scoped machine credentials, enrollment/revocation, run claims, heartbeats, and result reporting need a separate end-to-end proof before external agents execute work. Human invitations are not machine credentials. Do not build a second runtime or public agent marketplace in this milestone.

Defer connector implementations, repository execution, autonomous triggers, agent delegation, write tools, approvals, deployments, monitoring, semantic search, and phone work. Approval UI becomes functional when the first controlled write tool is implemented; a visual Approve button alone is not authorization.

## Following milestones

1. **Connected context:** one read-only GitHub connector for selected repositories, initially issues/PR metadata and content. Prove initial sync, duplicate/out-of-order webhook handling, reconciliation, scoped access, freshness, deletion, and citations. Add external-agent enrollment with a small reference client against the established API. Bring Linear and Better Stack through the proven connector contract incrementally.
2. **Collaborative coding:** a bounded issue-to-PR workflow in an isolated checkout/environment, with human review, test artifacts, scoped tool execution, and durable approvals for controlled writes. Persist tool attempts and reconcile uncertain outcomes; retries cannot promise exactly-once external effects.
3. **Approved test deployments:** deploy a specific reviewed revision to a selected test environment, then monitor and report with evidence. Bind approval to the exact action, arguments, revision, scope, and expiry; record the approver and execution outcome.

Start implementation with slice 1: migrations, explicit agent membership, and the directory. Finish each gate before widening the runtime or adding connectors.
