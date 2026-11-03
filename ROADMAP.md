# Web companion roadmap

## Goal
Make the iPad web companion reliably deliver mandatory-OMEMO messages, preserve its encryption identity, and make verification and failures understandable.

This roadmap tracks the **separate Converse-based web companion**. It is not a claim that native Monal contains these integration issues. Native Monal remains the interoperability reference.

## Current status — 2026-11-03
The first security increment and the follow-up attribution/tab-handoff repair are implemented and published to the existing owner-private web deployment. Checked items below mean implemented with automated or synthetic-browser evidence, **not physical iPad or live native-client certification**.

- 95 Node tests passed, including real shipped crypto for legacy OMEMO and OMEMO 2, message reuse, and cooperative handoff failure cases.
- This follow-up passed 17 actual-component interface assertions and 7 message-reuse assertions. The first security increment also passed 8 browser DOM/storage assertions.
- Browser storage tests use the pinned OMEMOStore and IndexedDB with provisioning stubbed because the HTTP preview lacks WebCrypto. Crypto itself is exercised in Node.
- No real account login, live image upload, or message to a contact was used in this build.
- Source, tests, a synthetic screenshot and technical details are committed in the private web companion repository. The native fork has only roadmap changes.
- GitHub Issues are disabled in this fork, so tracking remains in this file.

## Follow-up regressions — 2026-11-03
- [x] Fix custom message rows retaining a previous model's body while the parent renders a new sender/direction. A browser regression failed before the fix and passes after it; stale asynchronous render results are discarded.
- [x] Add **Use this tab instead** for tab conflicts. Pause new cryptographic work, drain existing incoming-message processing and queued preparation, save drafts, disconnect and flush identity state, then unload the old document before the new tab can acquire ownership.
- [x] Abort timed-out or failed handoff requests so they cannot acquire an orphan lock later. Never steal a lock from an unresponsive document.
- [x] Preserve the sign-in fields when a handoff cannot finish; provide a manual-close instruction for sleeping tabs or older builds.
- [ ] Verify the full handoff on physical Safari, including a message arriving during transfer. Automated tests use an explicit simulated lock manager; HTTP preview cannot exercise real Web Locks.
- The attribution evidence establishes a rendering defect, not that stored sender metadata was corrupted. No private conversation was inspected to infer a specific record's cause.
- Existing tabs from the previous version need closing once because they cannot answer the new handoff request. No crypto vendor files changed in this follow-up.

## P0 — Encryption and device continuity
- [x] Require usable recipient keys at preparation and final transmission for text, edits, and photo descriptors; never fall back to plaintext.
- [x] Preserve queued messages when sending is blocked; report omitted recipient devices.
- [x] Check storage before sign-in, retain the existing identity, and block silent identity replacement on a storage failure.
- [x] Persist session changes before transmission and surface storage failures.
- [x] Allow one active connection per browser storage context; prevent competing tabs from reusing stale sessions. The implemented lock is origin-wide, including different accounts.
- [x] Report device discovery and publication separately, including partial failures and protocol-specific results.
- [x] Confirm the server's published identity matches the local public key; show this browser's fingerprint from its local identity.
- [x] Bind the actual encryption session to the approved fingerprint. Rebuild approved replacement sessions with the upstream builder while archiving prior session state and retaining our own identity.
- [x] Filter inactive/blocked devices before protocol preference so an unusable OMEMO 2 entry cannot suppress an approved legacy device.

## P1 — Identity, diagnostics, and delivery
- [x] Record fingerprint decisions by account, peer, device, protocol, and exact identity key.
- [x] Provide approve/verify/block controls and pause delivery to changed or unapproved identities.
- [x] Distinguish local crypto readiness, recipient readiness, and verified identity.
- [x] Render dated, attributed unreadable-message placeholders through the real error-message component.
- [x] Distinguish missing recipient keys from decryption/authentication failures; do not assume every failure is old history.
- [x] Keep compact sent/read checkmarks with accurate server/client receipt meanings.
- [x] Preserve original history and edit state after an encrypted edit fails.
- [ ] Unify durable retry behavior across text, edits, and photos. Text has a durable queue; photo failures remain in the photo dialog and failed edits retain their editor.
- [ ] Add a redacted local diagnostic export limited to necessary public device/error metadata; exclude private keys and message content.

## P2 — Local security and usability
- [ ] Review local readable history/outbox retention and an optional protected local vault.
- [x] Explain that sign-out retains local data and keys, and that clearing website data can destroy needed keys.
- [ ] Add separate local-history removal controls without automatically erasing encryption keys.
- [ ] Verify selection, context-menu dismissal, photo zoom, keyboard layout, and autofill on physical iPad after the security foundation.

## Release checks
- [x] Negative send tests for missing/blocked/inactive recipient devices and both supported OMEMO versions.
- [x] Exact shipped crypto round trips, tamper rejection, ratchet replies, approved replacement sessions, and persistence failure tests.
- [x] Synthetic identity continuity and competing-tab rejection tests.
- [x] Actual message-component tests for unreadable messages, verification controls, and receipt semantics.
- [ ] Physical iPad identity continuity across reload, logout/login, backgrounding, reconnect, and two real tabs.
- [ ] Bidirectional text and photo exchange with native Monal, including offline catch-up, using only Notes to self or an explicitly authorized test account.
- [x] Document physical-device and live-account verification that has not been completed.

The original screenshot does not by itself establish which remote client omitted this browser or prove a particular newly arriving message is fixed. Old ciphertext that never included the browser's device key cannot be recovered by changing its display.

## First use after this increment
Close web tabs running the previous version once and reload normally. Updated tabs offer **Use this tab instead** when another tab owns the session. Open **Encryption details → Compare fingerprints**, compare the full key through a trusted channel or your own native client's device details, then choose **Verify fingerprint**. **Approve unverified** is a separate explicit choice and does not claim identity verification. Review other devices of your own account as well, then retry retained messages. Do not clear website data as a routine repair.

## Execution
Work in verified increments: recipient checks → identity/session persistence and tab ownership → verification/publication → error and delivery presentation → integration checks. Keep completed, implemented-but-unverified, and deferred work distinct.

Started: 2026-11-03. Automated testing uses synthetic identities. Any live tests must use Notes to self or an explicitly designated test account; never message contacts just to test.
