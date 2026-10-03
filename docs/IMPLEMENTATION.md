# Milestone 1 implementation

## Architecture decision: live events through the API

The API owns every product mutation and permission decision. Supabase provides local Postgres and authentication. Live delivery uses authenticated server-sent events rather than direct Supabase Broadcast subscriptions.

Reason: [Supabase caches channel permissions for the duration of a connection](https://supabase.com/docs/guides/realtime/authorization#updating-rls-policies). The milestone requires revocation to apply while a client is connected. This implements the server-stream fallback already specified in the plan.

Messages and conversation events commit together. The durable event log is also the delivery outbox: the server streams events after a client cursor, so a failed delivery does not require rewriting a message or maintaining a second publication queue. A snapshot and its cursor are read while holding the conversation lock. The stream replays the persisted log from that cursor, closing the snapshot/subscribe gap.

Every conversation mutation and membership change takes the same Postgres row lock. Sequence numbers are assigned inside that transaction and therefore follow commit order. Stream authorization and writes execute under that lock too, so a committed revocation precedes any subsequent delivery check. Production scaling will require replacing database polling while retaining this permission boundary and cursor protocol.

The stream lasts at most 55 seconds (or token expiry), reconnects with a fresh bearer token, and carries `change`, `heartbeat`, `revoked`, or `reset` events. Tokens never appear in URLs. Redacted requester-specific run events use `noop` to preserve cursor continuity for other channel members.

## Persistence and agents

Product tables live in a private `app` schema; browser identities receive no direct table grants. API calls verify Supabase sessions and apply domain authorization. SQL queries are parameterized. Channel membership and workspace membership are both required.

Pending sends keep their request IDs across retries and reopening. The server uniqueness constraint is scoped to conversation, sender, and request ID. Reusing an ID with different content returns a conflict. Edits/deletes use a revision check to prevent stale overwrites.

Summary requests insert the run and pg-boss job in the same transaction. Workers retrieve bounded context for both requester and agent, call the provider, revalidate memberships and source revisions, then save one reply per run. Completed or cancelled runs do not publish again. Source edits/deletions invalidate cited summaries and remove their obsolete body from current message state. Persisted event history retains historical changes; retention/redaction policy is future work.

## Remaining validation

- Real hosted-model output: awaiting server credentials and selected supported model.
- Phone packaging, native plugins, and physical-device behavior: deferred.
- Signing/notarization, deployment, operational limits, event retention, and multi-instance scaling: release/pilot hardening work.

This is a local development product, not a production deployment.

## Verified locally

- Formatting, ESLint, strict TypeScript, React production build, and Mac release bundle build pass.
- 20 integration/synchronization tests pass, including concurrent duplicate sends, commit-safe cursor ordering, source invalidation, and an actual API restart with queued worker completion.
- Two Playwright tests pass: the two-user invitation/messaging/offline recovery/summary/revocation workflow, and account creation through the interface.
- The built Mac app signs in to local Supabase, reads the same workspace as the browser, sends a message visible to Bob in the browser, and receives Bob's browser reply through the live stream.
- The local `.env` is ignored; hosted-model credentials are absent from the client source/bundle. The assistant remains in explicitly labeled test mode.

## Milestone 2: workspace essentials

[Execution plan](MILESTONE_2.md) completed; the later agent-runtime proposal is [AGENT_PLATFORM_ROADMAP.md](AGENT_PLATFORM_ROADMAP.md).

The shared client now provides channel creation, people/channel/DM navigation, private one-to-one messaging, and workspace settings. Owners appoint admins; owners/admins manage allowed member statuses, invitations, BYOK configuration, and usage. Active membership is checked by API discovery, messaging, SSE delivery, and worker context/publication. Disabling affects only the selected workspace and cancels unpublished runs. DMs are deduplicated for a normalized unordered pair and cannot gain additional participants or agents.

Workspace provider/model/key configuration replaces global LLM environment configuration. Keys are AES-256-GCM encrypted using the installation secret shared by API/worker; metadata endpoints never return plaintext or ciphertext. Runs pin a configuration revision. Usage records belong to provider attempts, with reported input/output/cache tokens captured before validating generated answers. Unknown usage remains explicit. See [administration/deployment notes](WORKSPACE_ADMINISTRATION.md).

Current verification: 31 integration/synchronization tests, three browser workflows, format/lint/type/build checks, and a Mac release bundle. Live hosted-model verification and production deployment/signing remain outstanding. New administration flows are browser-tested; native packaging uses the same client/API.
