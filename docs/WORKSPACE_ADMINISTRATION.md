# Workspace administration and deployment

## One application, multiple workspaces

The React client and versioned API are shared by the browser and Mac app. Workspace administration is part of the product shell, not a separate application tied to a particular hostname. Authentication identifies a person globally; enabled membership determines that person's rights within each workspace.

Owner/admin/member permissions follow [Milestone 2](MILESTONE_2.md). Owner transfer and installation-wide operator administration are deferred. An installation operator controls deployment/database/secrets; a workspace admin controls that team's members, invitations, and model configuration. Neither role grants product access to other people's DMs.

Channel discovery is membership-based, including public channels: enabled members are added when a public channel is created or when they join through an invitation. Private channels begin with their creator only. A creator can add an agent explicitly through Members. DMs are identified by an unordered human pair within a workspace and have fixed membership; starting the same DM repeatedly or concurrently reuses it.

Either DM participant can use **Catch me up**. This grants the workspace assistant access to the bounded conversation context for that requested summary only; it does not add an assistant to DM membership or grant it access to messaging APIs. The cited reply is visible to both DM participants, subject to enabled membership checks. Non-participant owners/admins cannot request or read it. Workspace provider/key configuration and requesting-member usage apply to DMs as they do to channels. Removing the requesting member's access blocks execution/publication.

Disabling is not deletion. Historical authorship and channel grants are retained. All workspace access paths check enabled membership; streams serialize permission checks with membership changes. Queued/unpublished runs are cancelled. Re-enabling restores existing grants; admins can explicitly grant access to channels created while a member was disabled. Existing signed-in sessions remain usable in other workspaces. Offline clients learn about revocation only on reconnect; already delivered information cannot be recalled.

## Installation secrets and BYOK

Workspace LLM keys are encrypted with AES-256-GCM, random nonces, and authentication tags. The installation key is `LLM_ENCRYPTION_KEY`, exactly 32 bytes represented as 64 hexadecimal characters. Set the same value on API and worker. Local `npm run setup:env` creates it once and preserves it on subsequent runs.

For a non-local installation, generate the key using `openssl rand -hex 32` and store it in the deployment's secret manager. Do not put it in frontend variables, source control, logs, or database backups. Back it up separately. Restoring a database requires the corresponding installation key. If the key is lost, replace it and have workspace admins remove/re-enter their LLM keys; there is no recovery of existing ciphertext without the original key.

Installation master-key rotation is not an automated operation in this milestone. Do not replace it while continuing to use previously encrypted credentials. Either perform an offline audited re-encryption procedure with both keys, or stop workers, clear workspace credentials through administration, rotate the installation key on both services, and re-enter credentials. Workspace LLM-key replacement/removal is supported in the UI and increments the configuration revision.

The browser submits a workspace key once; subsequent settings responses contain only provider, model, key presence, revision, and update time. Member APIs cannot inspect model settings. Hosted calls have no fallback to another workspace's key or a global server key. Test mode does not make hosted calls and is always labeled.

A model configuration revision is pinned to a run. Changes prevent queued execution or eventual publication against an outdated configuration. Removing a key blocks new hosted requests. An external request already sent to a provider may still finish and incur charges; withholding its reply does not reverse provider charges.

## Provider connections and model discovery

Choose **Anthropic**, **OpenAI-compatible API**, or the test provider. For a
compatible API, enter a base URL, API key, and model ID. OpenAI's root is
`https://api.openai.com/v1`; a local service might use `http://127.0.0.1:1234/v1`.
Neoms appends `/chat/completions` or `/models`, so enter the API root rather than
either endpoint. Remote URLs require HTTPS; HTTP is allowed on localhost,
127.0.0.1, or ::1. URL credentials, queries, and fragments are rejected. Calls
originate on the API/worker host; localhost means that host, not a remote browser.

The adapter sends Bearer authentication, a model ID, system/user messages, and a
2,000-token output limit to non-streaming `POST /chat/completions`. Under
**Compatibility settings**, select `max_completion_tokens` for modern OpenAI or
`max_tokens` for implementations using that parameter. It does not require JSON
mode, tools, sampling parameters, or vendor-specific headers. The model must
return JSON with `body` and source message-ID `citations`; source validation is
unchanged. APIs requiring Azure-style deployment routing, API-version queries,
OAuth, or proprietary headers need a separate adapter. A listed model is not
necessarily a chat model; listing is not an inference compatibility test.

Saved settings with a key load suggestions automatically. **Load available
models** previews a supplied endpoint/key before saving. The server calls
`GET /models` and returns only IDs. Anthropic listing follows bounded pagination;
lists are sorted/deduplicated and capped at 1,000 suggestions. Model ID always
accepts manual text. Missing listing, empty lists, or discovery errors do not
block manual entry or saving. Discovery does not alter saved settings or usage.

Saved keys are reused only for the same provider and normalized base URL. Changing
either requires a fresh key or explicitly removing the existing one. Listing and
generation reject redirects. Provider error bodies are not surfaced as request
errors. Endpoint and token-limit changes increment the configuration revision,
invalidating pending runs. Existing Anthropic settings remain valid.

Installation operators can restrict destinations with comma-separated
`LLM_ALLOWED_HOSTS`, for example `api.openai.com,api.anthropic.com,localhost`.
Set it identically on API and worker. Hostnames match exactly without ports or
wildcards. Without it, admins can choose arbitrary HTTPS destinations and local
HTTP services. This enables self-hosted connections; it is not network isolation.
For multi-tenant hosting, restrict approved hosts and enforce egress controls for
private/metadata addresses and DNS rebinding at the network layer.

## Usage semantics

Each worker provider attempt has a durable usage row linked to its run, workspace, initiating member, provider, and model. A row starts before the provider call. Input/output and prompt-cache token fields are recorded from the provider response before structured-answer validation, so malformed output still counts when usage was reported. Retries create separate attempts. A crash, timeout, or missing usage leaves an unknown/pending attempt rather than fabricated zero tokens.

[Anthropic's Messages API](https://platform.claude.com/docs/en/api/messages/create) reports input/output and cache token fields. These fields are shown separately; there is no price conversion, billing reconciliation, spend cap, or claim that the dashboard replaces the provider's invoice. All-time totals exclude test-mode attempts. Credentials, prompts, and response bodies are not stored in usage records.

OpenAI-compatible usage maps `prompt_tokens` to input and `completion_tokens` to
output. `prompt_tokens_details.cached_tokens`, if present, appears as cache read
and is already included in prompt tokens; do not add it again. Cache writes are
not separately reported by this protocol. Missing/invalid usage remains unknown.
Malformed answers are validated after usage is recorded and may still incur charges.

## Deployment configuration

Agent policy now has a separate **Agent limits** settings section. Workspace
ceilings resolve with agent, conversation, and requested overrides by taking the
minimum; sharing can be disabled at any layer. Input/output, history/message,
attempt/concurrency, retention, and UTC token budget limits are saved on each run.
Hosted calls reserve full input/output estimates for every allowed attempt before
enqueue; reported usage reconciles the reservation and unknown calls remain
conservatively charged. This is a token admission budget, not a monetary spend
cap or invoice reconciliation. Test mode has no paid-token reservation.

New results are requester-only and never copied into shared events or persistent
client caches. Post to conversation requires the requester to explicitly share,
checks current grants/policy and every source dependency, and records the human.
Private results expire after seven days by default (configurable 1–30); the worker
purges expired content every five seconds and reads enforce expiry immediately. Published
messages use conversation retention. Source edits/deletions invalidate both copies.
See [all permission/visibility gates](AGENT_PERMISSIONS.md), including the existing
built-in DM input-consent limitation and deferred owned-agent capabilities.

Use the same workspace APIs for self-hosting and future SaaS hosting, with origins and public URLs supplied by deployment configuration:

- API: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `LLM_ENCRYPTION_KEY`, `HOST`, `PORT`, and comma-separated `CLIENT_ORIGINS`.
- Browser build: `VITE_API_URL`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY`. These values are public and embedded at build time.
- Worker: `DATABASE_URL`, `LLM_ENCRYPTION_KEY`, and optional `LLM_ALLOWED_HOSTS`; it reads provider/model/endpoint/keys from authorized workspace configuration. The API uses the same optional host policy for discovery.
- Auth installation: configure Supabase's site/redirect URLs for the actual application domain. Local sign-up currently uses local-development email-confirmation behavior; configure an email delivery/confirmation policy for a deployed installation.
- Serve the browser over HTTPS and expose API/Auth over HTTPS. Allow the actual browser origin in `CLIENT_ORIGINS`; retain the relevant Tauri origins if native clients connect.
- The shipped native CSP targets localhost for development. A native release for a hosted API must also update Tauri `connect-src` to the selected HTTPS API/Auth endpoints, alongside its frontend build variables. A browser URL change alone does not reconfigure a compiled Mac bundle.

Apply forward SQL migrations before starting updated API/worker processes. Do not reset a populated database. New and migrated workspaces use explicitly labeled test mode until admins configure BYOK. This milestone provides local verified functionality and configurable boundaries; production hosting, signing/notarization, backups, retention policy, rate/spend limits, and operational monitoring remain separate release work.
