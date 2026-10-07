# UI/UX review: web client and desktop app

Status: review captured on 2026-10-07, before any fixes. Kept as written so later
work can be checked against it. Items fixed afterwards are tracked in commits, not
by editing this list.

Method: the web app was reviewed in the browser at desktop width, 700px (the desktop
app's minimum window width) and phone width, in light and dark mode, signed in as the
demo user from `scripts/demo.ts`. All client code and the desktop (Tauri) app setup
were read. No agent runs were started, because the workspace was connected to a paid
model.

## 1. Broken: fix first

1. **"Load earlier messages" jumps you to the bottom.** The auto-scroll runs whenever the message count changes, so loading older messages scrolls you away from them. It also pulls you down when someone posts while you're reading back. Only stick to the bottom if the user is already near it, and otherwise show a "↓ New messages" pill. [Chat.tsx:307](../apps/client/src/components/Chat.tsx)
2. **Narrow windows break.** At phone width, the header overlaps ("Bob" over "Members"), Catch me up is cut off and the agent picker shrinks to just its arrow. The sidebar stays on screen and takes about 40% of the width. At 700px, the desktop app's minimum, the scope bar wraps onto two rows. Below about 760px you need a sidebar that slides in and out, and a header that collapses into an overflow menu.
3. **Loading looks like an empty account.** Right after sign-in, a user who already has workspaces sees "A space for your next idea / Create a workspace" with "Loading…" in the profile. [WorkspaceApp.tsx:432](../apps/client/src/components/WorkspaceApp.tsx)
4. **API down looks like an empty account too.** The user sees a raw "Failed to fetch" and the same prompt to create a workspace. They need an offline/reconnecting state instead.
5. **A reload always opens the first channel.** Nothing is in the URL (channel, DM or settings tab), so the browser back button, refresh, deep links and links to a message all fail. [WorkspaceApp.tsx:80](../apps/client/src/components/WorkspaceApp.tsx)
6. **Delete has no confirmation or undo.** One click on the trash icon deletes the message. [Chat.tsx:700](../apps/client/src/components/Chat.tsx)
7. **The DM text contradicts the UI.** It says "Assistants are not added to direct messages", but the agent picker and Catch me up are shown in that DM. [Chat.tsx:572](../apps/client/src/components/Chat.tsx)
8. **Posted agent results contain raw ISO timestamps**, e.g. "(2026-10-05T13:28:46.948Z to …)". The attribution is also baked into the message text instead of shown in the message's header. [run-results.ts:179](../packages/domain/src/run-results.ts)
9. **The sign-up confirmation looks like an error.** "Check your email to confirm your account" appears in the red danger callout. [Login.tsx:22](../apps/client/src/components/Login.tsx)
10. **The desktop app can only reach a local server.** Its security policy (CSP) only allows connections to `127.0.0.1:3001/54321`, so a packaged build can't talk to any real deployment. [tauri.conf.json](../apps/client/src-tauri/tauri.conf.json)

## 2. Half-finished

- **Private agent results aren't placed in the timeline.** They always render after _all_ messages, so new messages appear above a result you just got. Every past result stays stacked at the bottom.
- **The run-history buttons pile up at the top** of the conversation ("Inspect Assistant run · completed" ×4, one showing just "agent" for a removed agent), above the channel intro, and never go away.
- **The scope bar is shown in every conversation** ("Agent scope / Recent messages / Results are private…"). It belongs inside the Catch me up action. "Unread when opened" is internal wording.
- **Run details is a modal wall of text.** It uses jargon (lease, execution authority, "charged or reserved"), headings have no spacing and the source buttons are cut off. The roadmap reserved a right-hand panel for this.
- **Citations read "Message 1…N".** There's no author, no snippet, no hover preview, and nothing highlights the target message after it scrolls into view.
- **Agent output is plain text.** Lists come out as "- …" and links aren't clickable. Human messages don't render links either.
- **"Post to conversation" posts immediately**, with no preview, no edit and no choice of where to share.
- **One button, two behaviours.** The header button's label switches between "Catch me up" and "Suggest actions" depending on which agent is picked in the dropdown. Users can't discover what each agent does.
- **People type `@assistant` and nothing happens.** Bob's message "@assistant" is in #general, so users already expect mentions to invoke agents. There's no mention autocomplete.
- **Failed runs:** the "Agent run failed…" callout has no Retry button and stays until the next run. Failed outgoing messages can be retried but not discarded.
- **Editing:** Esc doesn't cancel, and Enter doesn't save (the composer sends on Enter).
- **Copy buttons give no feedback** (invite token in [WorkspaceApp.tsx:474](../apps/client/src/components/WorkspaceApp.tsx)).
- **Edit/Delete screen-reader labels include the whole message body.** [Chat.tsx:687](../apps/client/src/components/Chat.tsx)

## 3. Upgrades by area

**Sidebar and navigation**

- Rare actions take prime space. "New workspace / Join" are always shown at the top, and "New channel" appears twice. Move workspace actions into a workspace-switcher menu, replacing the native `<select>`.
- Bob is listed under both Direct messages and People. Agents show as disabled rows under People. Replace People with "+ New message" plus an agent directory.
- Add: a quick switcher (Ctrl/Cmd+K), channel browsing and joining, unread _counts_ and a separate mention badge, starred items and muting.
- Workspace settings disappears off the bottom at 700px. Move it into the workspace menu.

**Conversation**

- Add a "New since you left" divider and a jump-to-unread control. The read position is already stored.
- Message hover actions only exist on your own messages. Add copy link, reply and react for everyone, and edit-last-message with ↑.
- Every human avatar is a grey initial, and every agent has the same sparkle icon. Use a colour per person and a distinct mark per agent, because Assistant and Planner currently look identical.
- Show "Live" in the header only when the connection is _not_ live, as an offline/reconnecting banner.
- The browser tab title is always "Neoms". Show the unread count and current channel.
- Later: threads, reactions, file uploads, search. Search matters most for catching up.

**Agent runs**

- Use one entry point: an "Ask an agent" menu or `/` commands listing each agent's actions, with scope as an inline option.
- Show progress and the result where the run was requested, with Post / Share / Discard and a preview before posting.
- In the coverage-confirmation dialog, offer the alternatives (last 7 days, only mentions) instead of a single "Run with this coverage".
- The cancel control is labelled "Cancel" in the status bar but "Stop run" in run details. Pick one label.

**Channel management**

- Members: the list mixes members and non-members, has no search, and Add/Remove applies immediately. Add a confirmation when removing an agent.
- Add channel settings: rename, topic, archive, leave, and who manages the channel.
- Channel creation: add a description field, preview how the name will be normalised, and explain what "Private" means.

**Workspace settings**

- The tabs are styled as buttons, aren't in the URL and are all disabled while saving.
- Invitations: show who accepted each one, allow invites by email or link, and make Join accept a link instead of a pasted token.
- Members: no ownership transfer and no removal, only disable.
- LLM configuration: add "Test connection". "Load available models" sits awkwardly between fields.
- Usage: numbers are unformatted ("1259"), it's all-time only and has no date range, estimated cost, per-agent or per-channel breakdown, or progress against the budgets.
- Agent limits: a flat list of nine number inputs with no grouping, units, help text or spacing above Save. Override targets don't show the effective inherited value. There's no overview of agents × channels × limits, which is the admin view you asked for earlier.

**Sign-in and account**

- Add forgot password, a show-password toggle, and magic link or SSO later. The footer says "Mac and browser" and omits Windows.
- Sign out has no confirmation. The profile has no menu for display name, avatar, theme or notification settings.
- There's no in-app theme toggle, although the tokens support `data-theme`.

## 4. Desktop app (Tauri)

The shell is a plain WebView. [lib.rs](../apps/client/src-tauri/src/lib.rs) registers no plugins, so it has none of what makes a desktop chat app worth installing:

- Native notifications for mentions and DMs, plus a dock or taskbar badge with the unread count.
- A system tray with minimize-to-tray, so closing the window keeps the app connected.
- Single instance, and remembering window size and position.
- Native menus with standard shortcuts: Cmd/Ctrl+, for settings, Cmd/Ctrl+K, Cmd/Ctrl+N.
- A `neoms://` deep-link handler so invitation links open the app.
- Auto-update and a configurable server URL (see item 10).
- Opening external links in the system browser.
- The composer's auto-resize relies on CSS `field-sizing`. Check it works in macOS's WebView.

## 5. Best practices for this kind of app

- **Sending, reading and unread state must feel instant and never lose data.** Apply changes optimistically, persist drafts and failed sends, and show offline states. You have the foundations; the UI doesn't show them yet.
- **Navigate from the keyboard first:** quick switcher, Alt+↑/↓ between channels, Esc to mark as read, ↑ to edit.
- **Everything has a URL:** channels, messages, settings tabs and runs.
- **Be honest about agents:** who requested a run, what it read (coverage), the cost before running when it's large, private by default, and an explicit share.
- **Keep agents visually distinct from people, and from each other.**
- **Cite sources with previews**, and highlight the cited message after jumping to it.
- **Make notifications controllable:** per channel, mentions only, and quiet hours.
- **Accessibility:** mark the message list as a log (`role="log"`) and announce new messages and finished runs to screen readers (there are currently no live regions). Keep a correct heading structure and focus handling, and check contrast of the small grey metadata text.
- **Prefer undo to confirmation** for reversible actions, and confirm only destructive ones.
- **Admin screens summarise first** (budgets, overrides, usage) and let you drill into details.

## Suggested order

1. Scroll behaviour, URL routing, loading/offline states, delete confirmation, DM contradiction, sign-up notice and raw timestamps.
2. Responsive sidebar and header.
3. Reworked agent-run flow: one entry point, results in the timeline, readable citations, Markdown, posting with preview, run details in a side panel.
4. Unread divider, quick switcher, mentions with autocomplete.
5. Desktop essentials: notifications, badge, tray, deep links, configurable server.
6. Settings polish: admin overview of limits and budgets, invite links, usage formatting.
