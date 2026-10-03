# Milestone 2: team workspace essentials and BYOK administration

## Outcome

Browser and Mac share a workspace API with channel creation, a channel/member sidebar, private one-to-one messages, owner/admin/member roles, member enable/disable controls, revocable invitations, workspace-level LLM configuration, and attributable token usage. The same UI/API serves self-hosted installations and future SaaS workspaces.

The later agent runtime proposal is now [AGENT_PLATFORM_ROADMAP.md](AGENT_PLATFORM_ROADMAP.md).

## Execution order

1. **Persistence and contracts:** forward SQL migration for roles/status, channel/DM identity, invitation revocation, encrypted workspace model configuration, and provider-attempt usage. Preserve existing data. Keep Supabase as the only migration owner.
2. **Authorization and messaging:** active workspace membership required everywhere, including SSE and worker retrieval/publication. Owner manages admins; admins manage regular members and invitations/configuration. Protect the owner and prohibit self-disable. Active members create channels and DMs. Channel creators and authorized admins manage channel membership only when they can access that channel. DMs have exactly two human participants and cannot be joined or administered as channels. Serialize DM creation for an unordered pair.
3. **BYOK and accounting:** workspace admin selects provider/model and sets/replaces/removes the key. Initially support the existing Anthropic adapter plus explicitly labeled deterministic test mode. Encrypt secrets with a separately supplied installation master key; never return keys, log payloads, or fall back to a global LLM key. Persist provider usage per attempt/run/requester/workspace/model, including usage from rejected model output; show unknown usage as unknown and test mode as zero billable tokens. Pin configuration revision to a run; configuration changes invalidate unpublished work.
4. **Shared interface:** clear channel creation, channel and people navigation, DM creation/opening, workspace settings tabs for members, invitations, model configuration, and usage. Regular members cannot open admin surfaces or call their APIs. Refresh directories and membership status; clear inaccessible conversation caches. Finish dialog focus containment/restoration.
5. **Verify and document:** migrations against the existing local database, permission/DM/disable/BYOK/accounting tests, existing messaging/restart regressions, browser admin and DM workflows, light/dark rendering, type/lint/format/build and Mac build. Document self-host secrets, key recovery/rotation boundaries, deployment origins, and remaining live-provider verification.

## Roles

| Action                                                     | Owner | Admin | Member       |
| ---------------------------------------------------------- | ----- | ----- | ------------ |
| Create channels/DMs, use authorized conversations          | Yes   | Yes   | Yes          |
| Manage a channel they created                              | Yes   | Yes   | Yes          |
| Manage accessible channel membership                       | Yes   | Yes   | Creator only |
| View admin member usage, configure LLM, manage invitations | Yes   | Yes   | No           |
| Disable/enable regular members                             | Yes   | Yes   | No           |
| Appoint/demote admins, disable admins                      | Yes   | No    | No           |
| Disable owner or self, inspect other people's DMs          | No    | No    | No           |

Disabling is workspace-specific, not deletion of the person's global account. Re-enabling restores existing grants. Redeeming a fresh invitation must not bypass disabled status. Disabling cancels unpublished runs and prevents further private delivery; it cannot retract information already delivered or stop a provider request that has already left the server.

## Acceptance gates

- Existing workspace messages and memberships survive forward migration.
- Concurrent Alice→Bob and Bob→Alice requests return one DM; Eve and admins outside that pair cannot discover, read, or join it. No assistant is added to DMs.
- Members create public/private channels, navigate people/channels, and exchange messages across independent sessions.
- Owner promotes an admin. Admin manages members/invitations/BYOK but cannot grant admin authority or alter the owner.
- Disabled members disappear from active discovery and cannot use history, sends, SSE, invitations, or pending runs; they retain access to other workspaces. Re-enable works.
- API and client never expose the stored LLM key. Missing installation encryption key blocks secret writes without blocking ordinary chat/test mode. All members' supported LLM work uses their workspace configuration.
- Usage totals count provider attempts, including retries, and attribute the initiating member; unknown usage is not fabricated. Disconnects or invalid structured answers do not erase known billed usage.
- Admin settings work in the shared client without a separate hosting-admin application. Deployment URLs are configuration, not hardcoded product identity.

## Boundaries

No arbitrary agent code, connectors, autonomous execution, deployment tools, billing, owner transfer, or installation-wide operator dashboard in this milestone. Workspace administration is distinct from hosting operations. Live model verification requires a real key; automated tests use controlled provider responses and require no paid calls.

## Progress

- [x] Execution plan saved; later agent plan renamed.
- [x] Persistence and API contracts.
- [x] Authorization, channels, and DMs.
- [x] Workspace BYOK and usage accounting.
- [x] Sidebar and administration UI.
- [x] Automated verification and handover documentation.

## Verified implementation

- Forward migration applied to the existing local database without reset.
- 31 integration/synchronization tests pass, including DM uniqueness/isolation, role boundaries, workspace-specific disabling and delivery serialization, ciphertext storage, configuration revision invalidation, reported/unknown usage, API schemas, and API/worker restart regression.
- Three browser workflows pass: existing messaging/recovery/revocation, account creation, and workspace administration/DMs. The new workflow covers roles, BYOK setup/removal, invitations, usage, disabling/re-enabling, and dialog keyboard behavior. Light/dark views inspected.
- Formatting, lint, TypeScript, production build, and the local Mac release bundle pass. Native packaging is verified; the new administration interaction suite runs in the browser against the shared API.
- Local installation encryption key generated in ignored `.env`; no credentials printed or placed in frontend variables. Model calls in verification use test/controlled responses; live Anthropic validation still requires a real workspace credential.
- Development test servers are stopped after verification; ports 1420 and 3001 are available for `npm run dev`.
