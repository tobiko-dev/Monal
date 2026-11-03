# Web companion roadmap

## Goal
Make the iPad web companion reliably deliver mandatory-OMEMO messages, preserve its encryption identity, and make verification and failures understandable.

This roadmap tracks the **separate Converse-based web companion**. It is not a claim that native Monal contains these integration issues. Native Monal remains the interoperability reference.

## P0 — Encryption and device continuity
- [ ] Require usable recipient keys at preparation and final transmission for text, edits, and photo descriptors; never fall back to plaintext.
- [ ] Preserve queued messages when sending is blocked; report omitted recipient devices.
- [ ] Check storage before sign-in, retain the existing identity, and block silent identity replacement on a storage failure.
- [ ] Persist session changes before transmission and surface storage failures.
- [ ] Allow one active connection per account/browser storage context; prevent competing tabs from reusing stale sessions.
- [ ] Report device discovery and publication separately, including partial failures and protocol-specific results.

## P1 — Identity, diagnostics, and delivery
- [ ] Record fingerprint comparisons by account, device, protocol, and exact identity key.
- [ ] Provide approve/verify/block controls and pause delivery to changed or unapproved identities.
- [ ] Distinguish local crypto readiness, recipient readiness, and verified identity.
- [ ] Render dated, attributed unreadable-message placeholders through the real message component.
- [ ] Distinguish missing recipient keys from decryption/authentication failures; do not assume every failure is old history.
- [ ] Keep compact sent/read checkmarks with accurate meanings and consistent retry behavior across message types.
- [ ] Keep diagnostics local and limited to necessary public device/error metadata; exclude private keys and message content.

## P2 — Local security and usability
- [ ] Review local readable history/outbox retention and an optional protected local vault.
- [ ] Explain sign-out versus removing local data without automatically erasing encryption keys.
- [ ] Verify selection, context-menu dismissal, photo zoom, keyboard layout, and autofill on iPad after the security foundation.

## Release checks
- [ ] Negative send tests for missing/blocked/inactive recipient devices and both supported OMEMO versions.
- [ ] Exact shipped crypto round trips, tamper rejection, and persistence failure tests.
- [ ] Identity continuity across reload, logout/login, backgrounding, reconnect, and competing tabs.
- [ ] Actual message-component tests for unreadable messages, verification controls, and receipt semantics.
- [ ] Bidirectional text and photo exchange with native Monal, including offline catch-up, using only Notes to self or an explicitly authorized test account.
- [ ] Document physical-device and live-account verification that has not been completed.

## Execution
Work in verified increments: recipient checks → identity/session persistence and tab ownership → verification/publication → error and delivery presentation → integration checks. Keep completed, implemented-but-unverified, and deferred work distinct.

Started: 2026-11-03. No real contacts are authorized for test messages.
