# Agent permission and visibility gates

These are release gates, not frontend conventions. No new agent capability may
ship until its retrieval, execution, result inspection, and publication paths
enforce these rules on the server. Apply them to built-in, workspace, personal,
and future installed agents, to manual and natural-language invocation, and to
both browser and desktop executors.

## Independent permission layers

1. Installation policy controls endpoints, native executors, and installation
   ceilings. A workspace setting cannot bypass it.
2. Workspace membership must be active. Admin powers manage policy; they do not
   confer membership in private conversations or access to private run content.
3. Conversation membership and history visibility bound the requester's sources.
   New channel grants are explicit. Membership in a DM does not resolve whether
   its other participant consents to model processing.
4. Agent identity must belong to the workspace, be enabled, and hold the required
   conversation/capability grants. Origin changes defaults, not authorization.
5. Personal-agent owner access intersects requester access and agent grants.
   Ownership permits configuration, not automatic inspection of other users'
   prompts, retrieved context, results, or raw traces. Personal agents cannot be
   exposed until this additional intersection is enforced.
6. Run policy resolves workspace -> agent -> conversation -> request. Lower
   layers only tighten context, output, history, attempt, concurrency, retention,
   budget, and permitted sharing limits. Pin resolved policy and source revisions.
7. Private result inspection requires the requester identity and current source
   access, validity, and retention checks. The agent's grant must remain valid.
8. Publication is a separate human action. Recheck all selected source
   dependencies, current grants, policy, and destination membership. A model
   instruction or @mention cannot publish or notify by itself.

## Visibility gate

New results default to requester-only, including content, sources, errors, and
run details. Persist private results separately from channel messages. Enforce
visibility in API reads, snapshots, pagination, replay, SSE, unread counts, and
client caches. Redacted events preserve cursor continuity. Private content must
not be copied into shared event payloads or diagnostics.

Post to this conversation records the sharing human and is idempotent. Only the
same source conversation is supported initially. Broader sharing requires every
recipient to be authorized for every selected source, or a permissioned link.
Previously public results cannot be made secret retrospectively.

Edits/deletions invalidate both private and published derived results, even when
the changed source was not cited. Expired private content is hidden and purged
on maintenance; retained audit data contains references/accounting only. Once
content is shared, it follows conversation-message retention. Offline devices
cannot discover revocation until they reconnect; private results are not cached
in persistent browser storage.

## Proof required before widening the platform

- Two participants: one invokes, the other cannot inspect any private content or
  source IDs through API, events, snapshots, or unread badges before human sharing.
- An admin or agent owner receives no private-result exception.
- Revoked requester/agent access blocks retrieval, completion, sharing, and
  subsequent private content inspection.
- Source changes, foreign IDs, invented citations, stale policy, and stale scope
  previews fail safely. Idempotency cannot substitute another agent/scope.
- Concurrent runs and retries cannot bypass budget reservations or concurrency
  limits; missing provider usage remains conservatively charged.
- Natural-language edits/invocations and local/native tools use the same domain
  checks. Tool credentials, memory, SDK sessions, and caches cannot expand access.

The current built-in Scribe DM compatibility path is a known transitional input
consent gap. Private output does not fix that gap. Do not add personal agents,
new DM capabilities, or group DMs until the consent gate is implemented.
Current discovery and execution accept only built-in definitions without an
owner; workspace-created and personal definitions fail closed until their gates
are implemented. All-history visibility follows current conversation membership;
there is no join-date history restriction in the current messaging model.
