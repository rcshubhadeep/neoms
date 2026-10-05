# Future real-time calls in channels and DMs

Status: planned, not implemented. Recorded on 2026-10-05. Start with direct LLM
access and agent foundations before implementing calls.

## How Slack-style calling works

A call is a live audio room associated with a conversation. The application
authenticates participants and negotiates the session through signaling. WebRTC
carries audio between clients and, for group rooms, a media service. Chat messages
and call lifecycle events can use the application API; audio must not flow through
Postgres, the summary queue, or the message SSE stream.

[WebRTC signaling](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Signaling_and_video_calling)
exchanges connection descriptions and ICE candidates. STUN helps discover network
routes; TURN relays media when direct connectivity fails. A selective forwarding
unit (SFU) forwards streams to group participants so each client does not need a
separate upload to every other participant. This is the proposed Neoms design,
not a claim about Slack's private implementation.

Slack's published [huddle network requirements](https://slack.com/help/articles/36284146785427-Guide-to-network-and-system-configuration-for-Slack-huddles)
currently name Chime media endpoints, UDP ports, and TCP 443. Its
[security documentation](https://slack.com/help/articles/115003560786-Security-for-Slack-huddles)
describes encrypted media transport. Define Neoms' own media endpoints, network
paths, and encryption guarantees after selecting a media service.

In-app calls do not require phone numbers. Dialing telephone numbers would be a
separate SIP/PSTN integration with provider, cost, emergency-calling, and
jurisdiction-specific requirements; exclude it from the first release.

## Conditions before implementation

1. **Shared, secure deployment.** Devices need a reachable API/Auth service and
   media infrastructure. The current localhost-only setup cannot connect two
   different computers. Deployed browser pages and signaling use HTTPS/WSS.
   Microphone capture requires a secure context; localhost is a development
   exception. Update browser origins and native CSP for the selected endpoints.
2. **Media service decision.** Evaluate a mature WebRTC SDK/SFU and decide between
   managed and self-hosted operation through a small interoperability spike.
   Provide authenticated TURN with short-lived credentials and TCP/TLS fallback
   on 443 for restricted networks. Document UDP ranges, regions, bandwidth,
   concurrency limits, relay costs, and service health. Public STUN alone is
   insufficient for a dependable deployment.
3. **Conversation-bound authorization.** Each room belongs to one channel or DM.
   Only enabled, authorized members can discover/join it. Media tokens are
   short-lived and bound to room, participant, and capabilities. A call link is
   not an access grant. Never expose media-service signing credentials to clients.
   Enforce member removal and workspace disabling against live media sessions.
4. **Signaling and lifecycle.** Define start/join/leave/end, presence, mute state,
   expiry, reconnect, and duplicate-start behavior. Persist lifecycle metadata and
   clean up abandoned rooms. Five-second sidebar polling is unsuitable for
   negotiation; choose a transport with appropriate latency. Reconnects and
   restarts must not resurrect an ended room.
5. **Device permissions and platform proof.** Request microphone access after a
   deliberate join action. Handle denial, missing devices, device switching,
   output routing, echo cancellation, and mute. Prove capture/playback and WebRTC
   in browsers, Windows WebView2/Tauri, and Mac WKWebView/Tauri, including OS
   privacy permissions and app metadata. Phone support requires a separate gate.
6. **Privacy guarantees.** Distinguish encrypted transport from end-to-end
   encryption and document whether the media service can access audio.
   Recording/transcription is off by default. Adding either requires consent UX,
   retention/deletion rules, storage encryption, and access checks. Logs contain
   minimal operational metadata rather than raw audio or credentials.
7. **Usability and operations.** Provide join/leave, mute, participant identity,
   active-speaker status, accessible controls, errors, and reconnect feedback.
   Measure packet loss, jitter, latency, disconnects, and relay usage without
   capturing conversations. Set room limits and abuse protections.

## Delivery order and gates

1. **Two-person audio in a DM.** Validate browser-to-browser, browser-to-Windows,
   browser-to-Mac, and Windows-to-Mac on separate networks. Pass forced TURN,
   blocked UDP, microphone denial, network recovery, token expiry, permission
   revocation, and end-call cleanup tests. Localhost-only success is insufficient.
2. **Channel audio rooms.** Add SFU-backed rooms with a documented participant
   cap, admission rules, mute/speaking controls, and operational costs. Prove
   private-channel isolation and live removal of unauthorized participants.
3. **Video and screen sharing.** Add after audio is dependable. Verify camera and
   screen-recording permissions, codecs, bandwidth adaptation, multi-monitor
   capture, and separate Windows/Mac behavior.
4. **Optional voice agents.** Explicitly admit and visibly identify agents.
   Listening, transcription, speaking, and retaining audio are separate
   capabilities with consent and conversation-bound permissions. Budget
   STT/TTS/realtime-model costs and support cancellation/barge-in. Text-only
   OpenAI-compatible Chat Completions does not imply these capabilities.

Exclude recording, telephone dialing, and agents that join/listen automatically
from the first audio release. This plan installs no media infrastructure.
