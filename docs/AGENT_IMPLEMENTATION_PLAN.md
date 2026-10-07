# Agent engine and natural-language builder implementation plan

Status: implementation started on 2026-10-06. Complete each acceptance gate before
starting the next slice. This plan supersedes the implementation ordering in
AGENT_PLATFORM_ROADMAP.md; that document retains the wider platform direction.

## Implementation progress

Slice 1 is implemented and locally verified:

- Pinned AI SDK 6.0.301, Anthropic adapter 3.0.127, and compatible adapter 2.0.81.
- Added immutable definition versions, enqueue-time version pinning, explicit
  agent selection, and a conversation agent picker for Scribe and Planner.
- Applied `20261006000100_agent_definitions.sql` to the verified local database.
  Existing Assistant identities/grants are preserved; existing-workspace Planner
  requires an explicit channel grant. New workspaces start with both agents in
  general; subsequent new channels require explicit grants through Members.
- Preserved endpoint restrictions, selectable token-limit parameters, usage
  accounting, sanitized errors, citation checks, and source invalidation.
- Passed 52 unit/integration tests and all 3 browser regressions, including
  Scribe/Planner selection and worker execution after API restart. Isolated the
  restart test's queue from jobs completed directly by other integration tests.
- Formatting, lint, type checks, and production build passed. Provider wire
  contracts were tested with mocked responses; live-model semantic validation
  remains outstanding. No remote migration or deployment was performed.

Slice 2 is implemented and locally verified:

- Applied `20261006000200_private_agent_runs.sql` to the local database. New results
  are requester-only, stored separately from messages, and excluded from persistent
  browser caches. Result reads and replay recheck current grants/source validity.
- Added Recent, Unread when opened, and Since a date scopes. Pin sequence boundaries,
  source revisions, policy, and coverage. Confirm omissions with a preview hash;
  edits or policy changes invalidate stale previews.
- Added admin Agent limits settings for workspace ceilings and agent/conversation
  overrides; request overrides use the same API. Lower layers only tighten them.
- Added atomic UTC member/day and workspace/month token reservations and workspace
  concurrency admission. Reserve every allowed model attempt, cap provider output,
  reconcile reported tokens, and conservatively account for unknown attempts.
- Added explicit, idempotent Post to conversation with sharing attribution, current
  authorization/policy checks, and validation of all selected dependencies.
  Edits/deletions invalidate private and published derived content, including
  uncited dependencies. Replay cannot restore an old published body.
- Added private expiry/purge maintenance and a ten-minute invocation deadline.
  Current execution fails closed for non-built-in or owned definitions until
  owner-access and DM consent gates are implemented.
- Passed 61 unit/integration tests for privacy, layering, scope, budget/concurrency races, expiry, invalidation,
  provider wire contracts, and independent-worker restart tests. Browser validation
  covers all three existing browser workflows, including requester-only channel/DM
  results, human posting, admin limit edits, and explicit coverage confirmation;
  the modified flow was rerun after its final changes. Formatting, lint, types, and production build
  passed; live-model semantic and native-device checks remain outstanding.

Slice 3 is implemented and locally verified:

- Applied `20261006000300_run_execution.sql` locally. Unfinished work from the old
  unfenced runner is cancelled on upgrade; completed private/public results remain.
- Added durable execution attempts with exclusive ownership and a 90-second lease.
  The worker checks authorization, configuration, policy, cancellation, and lease
  ownership every two seconds. Recovery runs at startup and every five seconds,
  respecting the original pinned sources, version, policy, budgets, and queue.
- A stale/expired/replaced worker cannot start another model call, validate/save a
  result, or overwrite the newer attempt with a failure. Each execution attempt
  starts at most one model call. Attempts are bounded by the pinned maximum.
- Persisted context confirmation, generation, validation, private result, and human
  publication steps, plus attempt timestamps/status/error and usage. Retrying and
  terminal failure are distinct. State transitions cannot reopen a terminal run.
- Running cancellation first becomes `cancelling`; the worker aborts the provider
  request and acknowledges `cancelled`. Queued cancellation is immediate. When a
  worker cannot acknowledge, lease expiry revokes authority and recovery confirms
  cancellation. This does not claim to undo provider processing or billing.
- Added private Run details with pinned version/model, scope, selected source
  revisions, limits, reserved/charged tokens, steps, attempts, usage, and Stop run.
  Snapshots preserve all active runs alongside the latest ten runs after reload.
  Inspection remains requester-only and is hidden when agent access is revoked.
- Passed 68 unit/integration tests and all three browser workflows, including an
  actual worker killed during a held local provider request, recovery to one result,
  stale-worker rejection, cancellation/revocation aborting held requests, private
  inspection after reload, and the browser Stop run control. The crash test forces
  lease expiry after killing the process to avoid a 90-second wait in the suite.
- Formatting, lint, TypeScript, production build, and whitespace checks passed.
  No live hosted-model or native-device validation is claimed; no deployment or
  remote migration was performed. Existing development services were reused for
  browser verification; no additional port-1420 server was left running.

Next: slice 4, owned agents and conversational configuration. The natural-language builder,
custom-agent editing, tool execution, and Rust local executor remain unimplemented.

Token estimates use full serialized prompts/instructions measured as UTF-8 bytes
plus framing allowance. This deliberately conservative admission estimate is not
an exact tokenizer or a dollar billing guarantee. Unknown started attempts keep
their estimate; unused retry reservations release on completion, cancellation,
terminal failure, or deadline. Budgets use run creation in UTC calendar windows. Legacy public replies
remain public; legacy unfinished runs must be invoked again with a pinned scope.

### Verify slice 2 now

Run `npm run dev` and open `http://localhost:1420`. Use the test provider to avoid
paid calls. Sign in with two accounts in separate browser profiles, join one
workspace/conversation, and exchange messages.

1. Run Scribe or Planner. Only the requester sees the private card and citations,
   including after reload; the other account sees no new message/unread badge.
2. Choose Post to conversation. The other account sees the published result,
   coverage, and sharing human. Repeated posting creates only one message.
3. Open Workspace settings -> Agent limits, reduce Maximum messages to one, and
   save. Run again in a conversation with multiple human messages. The coverage
   confirmation shows the omitted count before a run is queued.
4. Try Unread when opened or Since a date. The former uses the read boundary
   captured before the open conversation acknowledges incoming history.
5. Edit/delete any selected input, including an uncited one. Derived private and
   public content becomes unavailable, and posting the stale result is denied.
6. Disable sharing in workspace Agent limits. Private generation remains possible;
   posting is denied. New channels need an agent grant through Members.

Broader recipient sharing, @mention notification controls, full DM input consent,
and the NL builder are subsequent gates.

### Verify slice 3 now

1. Run Scribe/Planner and choose Inspect run on the private result, beside Post to
   conversation. Check the pinned version, scope, limits, selected sources,
   execution steps, and usage. Reload and reopen
   the details; the same completed record should be reconstructed.
2. Verify from a second account that the run details and private result are absent.
   Human posting exposes the conversation message, not the private inspection.
3. With a running hosted request, choose Stop run. Observe stopping/cancellation
   requested until the worker acknowledges. A cancelled run cannot save/post a
   late result. The deterministic provider can finish too quickly to stop manually.
4. Use `npm test` for the controlled crash/cancellation/revocation tests, including
   a held local HTTP request. No hosted credentials or paid model calls are needed.

### Slice 3 acceptance evidence

| Pre-planned gate                                            | Verification                                         |
| ----------------------------------------------------------- | ---------------------------------------------------- |
| API restart and execution without an open client            | `tests/integration/restart.test.ts`                  |
| Kill during generation, recover, one result and publication | `tests/integration/restart.test.ts`                  |
| Exclusive claim; reject stale completion/start/failure      | `tests/integration/messaging.test.ts`                |
| Cancel/expire/revoke; prevent late result                   | Messaging fault tests and held-request restart tests |
| Provider abort, sanitized errors, unknown usage             | Provider tests and held-request restart tests        |
| Bounded retries, budgets, sources, version/config pinning   | Existing messaging/workspace/provider regressions    |
| Inspect from a private result after reload; Stop run        | `tests/e2e/workflow.spec.ts`                         |
| Workspace/DM/admin/invite/BYOK/unread regressions           | All three existing browser workflows                 |
| Types, style, production bundle                             | `npm run check` and `git diff --check`               |

## Architecture and decisions

The [permission and visibility gates](AGENT_PERMISSIONS.md) are mandatory across
every slice. Enforce all applicable layers on the server; neither admin status,
agent ownership, natural-language instructions, nor desktop execution bypasses
private-conversation or private-result access.

Use Vercel AI SDK in the existing TypeScript worker for model execution. Keep
Hono, Postgres, Supabase Auth, pg-boss, React, and Tauri. Neoms owns authorization,
context selection, policy enforcement, usage accounting, run lifecycle, source
validation, and result publication. The SDK owns model integration and, when
introduced, the model/tool loop. A queue retry is not a resumed model/tool loop.

Use `ai`, `@ai-sdk/anthropic`, and `@ai-sdk/openai-compatible` for the initial
engine. Add `@ai-sdk/react` when the conversational builder is implemented. Pin
compatible package versions and verify the existing BYOK provider contract,
including selectable token-limit parameters, endpoint host restrictions,
redirect rejection, bounded output, sanitized errors, and unknown usage.

Keep agent definitions independent of SDK classes. Each run pins an immutable
definition version and workspace model configuration revision. Editing a
definition affects future runs. Agent identity, ownership, origin, conversation
grants, run scope, and result audience are separate concepts. Model output,
instructions, and natural-language requests never grant authority.

Run shared conversation agents on the server for browser and desktop parity and
execution without an open client. Later, add a permissioned Tauri Rust executor
for selected local files, repositories, and bounded native tools. Tauri is not an
execution sandbox. Desktop disconnection must produce an explicit unavailable or
interrupted state. Browser access to local tools requires a paired executor;
never silently substitute remote execution for a requested local operation.

## Slice 1: adopt the engine and prove multiple agents

- Add versioned, workspace-associated agent definitions tied to agent participants.
- Preserve existing Assistant identities and grants in a forward migration; seed
  Scribe and Planner definitions without expanding existing private access.
- Select an explicit agent; retain Catch me up as a Scribe shortcut.
- Pin the selected definition version at enqueue time. Reject cross-workspace,
  disabled, and ungranted agents, and idempotency keys reused for another agent.
- Execute Scribe (conversation summary) and Planner (suggested actions) through
  one SDK adapter, with distinct operation instructions and the same cited-output
  contract. No executed actions or model-accessible tools yet.
- Keep the deterministic provider, usage ledger, source-revision checks, and
  publication uniqueness. Update API schemas and the conversation agent picker.
- New channels do not automatically grant agents access. Existing membership
  controls supply explicit grants until the dedicated directory is implemented.

Gate: select and run two agents independently; pin a definition across an edit;
deny excluded/private and foreign agents; validate both provider wire contracts
and error redaction. Verify migrations and messaging regressions locally.

This is an engine-adoption slice. Existing results still publish as conversation
messages until slice 2. Do not expose arbitrary custom-agent instructions, tools,
or wider access before the private-result and policy gates below. Retain existing
bounded built-in DM summary behavior; adding personal agents or new DM agent
capabilities requires the consent policy in slice 5.

## Slice 2: bounded private runs and deliberate publication

- Store results independently from conversation messages. Default to requester
  visibility, including source references, errors, details, and events.
- Authorize every result read. Redact private events without breaking cursors;
  prevent leakage through snapshots, unread counts, subscriptions, and caches.
- Snapshot scope boundaries at invocation. Offer unread-range and explicit-date
  modes; do not depend on a read position that changes while generation runs.
- Resolve workspace -> agent -> conversation -> requested limits; lower layers
  may only tighten limits. Persist the resolved policy and selected source IDs
  and revisions, with coverage dates/counts and an explicit omission indicator.
- Budget full serialized model input, instructions, output, and retries. Keep a
  message/byte ceiling as defense in depth, not as a token-budget substitute.
- Add atomic budget reservations and concurrency limits. Reconcile actual usage;
  missing or interrupted usage remains conservatively accounted for.
- Add Post to this channel, authorized at publication time and idempotent. Recheck
  all source dependencies, not only cited sources. Record the sharing human.
- Invalidate private and published results when dependencies change or disappear.
  Set retention rules for results, model context, diagnostics, and audit metadata.

Gate: large history has predictable scope; another member cannot read a private
result through any API/event path; concurrent runs cannot bypass budgets; revoked
access and changed sources prevent publication. Broader recipient sharing waits
for destination/source permission checks and human-controlled notifications.

## Slice 3: durable execution and inspection

- Persist source selection, generation, validation, and publication steps,
  attempts, deadlines, and legal lifecycle transitions.
- Fence stale workers with attempt ownership tokens. Recover after restart,
  prevent duplicate results, and distinguish retrying from terminal failure.
- Persist cancellation requests, abort supported provider calls, and prevent late
  publication. Distinguish cancellation requested from confirmed termination.
- Reconstruct permissioned run details after reload; sanitize provider errors and
  avoid raw conversation payloads or secrets in tracing.

Gate: fault-injection proves recovery, stale completion rejection, cancellation,
revocation, and exactly one internal publication. Do not promise exactly-once
external effects. If future workflows need persisted pauses/tool-step recovery,
evaluate LangGraph or Temporal against a concrete workflow before adopting one.

## Slice 4: owned agents and conversational configuration

- Add agent creation, directory, editing, disabling, immutable versions, and
  separate draft saving and version activation. Owners see metadata only for
  runs whose content they are not authorized to inspect.
- Build a private builder chat beside an editable definition preview.
- Adapt Curvo's pattern: `streamText` emits schema-constrained edit calls;
  `useChat` applies validated changes to the visible draft; saving uses the same
  authorized, revision-checked API as manual edits.
- Expose a closed vocabulary of supported capabilities. The builder cannot
  invent tools, grant channel access, alter workspace ceilings, or execute code.
- Start with fields, operation/instructions, requested scope, and default result
  audience. Unsupported requests produce a clear explanation, not fake wiring.
- Validate the whole draft and show changes before activating a new version.
  Builder chat calls have their own usage, policy, and retention controls.
- Add authorized grant management and requests to channel managers/admins.

Gate: create two distinct agents using natural language and manual controls;
reject forged tool calls and stale saves; existing runs keep their pinned version;
editing an agent does not give its owner access to other people's sources/results.

## Slice 5: natural-language invocation, DM consent, and tools

- Interpret requests such as "Ask Planner for actions in #launch since Monday"
  into an authorized agent, conversation, scope, and result audience. Show the
  resolved scope, clarify ambiguity, and invoke the ordinary run API.
- Define input consent independently of private output for 1:1 and group DMs.
  Workspace admins cannot add agents to private DMs by administrative privilege.
- Add one bounded read tool through the shared authorization boundary. Recheck
  permissions and budget before every retrieval and model step. Scope any memory
  to source permissions; retained memory cannot bypass revoked access.
- Add controlled writes only with action-specific authorization, idempotency,
  uncertain-outcome reconciliation, and approvals where required.
- Add local Rust tools through the same capability contracts when there is a
  concrete desktop workflow. Restrict paths, commands, credentials, and execution.

Gate: NL and manual invocation enforce the same policy; injection cannot expand
access or notify recipients; DM consent and local-executor loss behave explicitly.

## Deferred work

No marketplace, payments, publisher onboarding, arbitrary uploaded executables,
visual workflow editor, autonomous triggers, or public external-agent hosting in
these slices. Stable identities, versions, capability grants, configuration
references, revocation, and an executor boundary preserve future integration.

## Validation and delivery

For every subsequent change, map the work to its pre-planned acceptance gates
before implementing. Verify those gates and the existing regression workflows
before declaring completion. Record actual evidence and unresolved limitations;
do not silently omit earlier privacy, scope, budget, messaging, or workspace gates.

Use focused unit tests for provider wire contracts, usage/error handling, and
typed edits; database-backed tests for authorization, version pinning, private
visibility, budgets, and publication; browser tests for selection and the builder.
Run formatting, lint, type checks, production build, and messaging regressions.
Apply forward migrations only to the verified local development database during
implementation. Live-model tests require configured credentials and are reported
separately from deterministic/mocked validation. Update this document with actual
completion and remaining gates; never mark later slices implemented by inference.
