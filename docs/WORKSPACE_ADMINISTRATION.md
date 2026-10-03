# Workspace administration and deployment

## One application, multiple workspaces

The React client and versioned API are shared by the browser and Mac app. Workspace administration is part of the product shell, not a separate application tied to a particular hostname. Authentication identifies a person globally; enabled membership determines that person's rights within each workspace.

Owner/admin/member permissions follow [Milestone 2](MILESTONE_2.md). Owner transfer and installation-wide operator administration are deferred. An installation operator controls deployment/database/secrets; a workspace admin controls that team's members, invitations, and model configuration. Neither role grants product access to other people's DMs.

Channel discovery is membership-based, including public channels: enabled members are added when a public channel is created or when they join through an invitation. Private channels begin with their creator only. A creator can add an agent explicitly through Members. DMs are identified by an unordered human pair within a workspace and have fixed membership; starting the same DM repeatedly or concurrently reuses it.

Disabling is not deletion. Historical authorship and channel grants are retained. All workspace access paths check enabled membership; streams serialize permission checks with membership changes. Queued/unpublished runs are cancelled. Re-enabling restores existing grants; admins can explicitly grant access to channels created while a member was disabled. Existing signed-in sessions remain usable in other workspaces. Offline clients learn about revocation only on reconnect; already delivered information cannot be recalled.

## Installation secrets and BYOK

Workspace LLM keys are encrypted with AES-256-GCM, random nonces, and authentication tags. The installation key is `LLM_ENCRYPTION_KEY`, exactly 32 bytes represented as 64 hexadecimal characters. Set the same value on API and worker. Local `npm run setup:env` creates it once and preserves it on subsequent runs.

For a non-local installation, generate the key using `openssl rand -hex 32` and store it in the deployment's secret manager. Do not put it in frontend variables, source control, logs, or database backups. Back it up separately. Restoring a database requires the corresponding installation key. If the key is lost, replace it and have workspace admins remove/re-enter their LLM keys; there is no recovery of existing ciphertext without the original key.

Installation master-key rotation is not an automated operation in this milestone. Do not replace it while continuing to use previously encrypted credentials. Either perform an offline audited re-encryption procedure with both keys, or stop workers, clear workspace credentials through administration, rotate the installation key on both services, and re-enter credentials. Workspace LLM-key replacement/removal is supported in the UI and increments the configuration revision.

The browser submits a workspace key once; subsequent settings responses contain only provider, model, key presence, revision, and update time. Member APIs cannot inspect model settings. Hosted calls have no fallback to another workspace's key or a global server key. Test mode does not make hosted calls and is always labeled.

A model configuration revision is pinned to a run. Changes prevent queued execution or eventual publication against an outdated configuration. Removing a key blocks new hosted requests. An external request already sent to a provider may still finish and incur charges; withholding its reply does not reverse provider charges.

## Usage semantics

Each worker provider attempt has a durable usage row linked to its run, workspace, initiating member, provider, and model. A row starts before the provider call. Input/output and prompt-cache token fields are recorded from the provider response before structured-answer validation, so malformed output still counts when usage was reported. Retries create separate attempts. A crash, timeout, or missing usage leaves an unknown/pending attempt rather than fabricated zero tokens.

[Anthropic's Messages API](https://platform.claude.com/docs/en/api/messages/create) reports input/output and cache token fields. These fields are shown separately; there is no price conversion, billing reconciliation, spend cap, or claim that the dashboard replaces the provider's invoice. All-time totals exclude test-mode attempts. Credentials, prompts, and response bodies are not stored in usage records.

## Deployment configuration

Use the same workspace APIs for self-hosting and future SaaS hosting, with origins and public URLs supplied by deployment configuration:

- API: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `LLM_ENCRYPTION_KEY`, `HOST`, `PORT`, and comma-separated `CLIENT_ORIGINS`.
- Browser build: `VITE_API_URL`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY`. These values are public and embedded at build time.
- Worker: `DATABASE_URL` and `LLM_ENCRYPTION_KEY`; it reads provider/model/keys from authorized workspace configuration.
- Auth installation: configure Supabase's site/redirect URLs for the actual application domain. Local sign-up currently uses local-development email-confirmation behavior; configure an email delivery/confirmation policy for a deployed installation.
- Serve the browser over HTTPS and expose API/Auth over HTTPS. Allow the actual browser origin in `CLIENT_ORIGINS`; retain the relevant Tauri origins if native clients connect.
- The shipped native CSP targets localhost for development. A native release for a hosted API must also update Tauri `connect-src` to the selected HTTPS API/Auth endpoints, alongside its frontend build variables. A browser URL change alone does not reconfigure a compiled Mac bundle.

Apply forward SQL migrations before starting updated API/worker processes. Do not reset a populated database. New and migrated workspaces use explicitly labeled test mode until admins configure BYOK. This milestone provides local verified functionality and configurable boundaries; production hosting, signing/notarization, backups, retention policy, rate/spend limits, and operational monitoring remain separate release work.
