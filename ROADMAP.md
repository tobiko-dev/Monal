# Gajim-derived browser port

Updated: 2026-11-04. Status: the local outbox passes seven actual Chrome checks; eight identity-worker checks also pass with the new database schema. A saved session survives the upgrade. Physical iPad checks for these increments, Gajim/nbxmpp integration and a usable chat application remain pending.

## Goal and scope

Run Gajim-derived messaging code on the user's iPad through a webpage, connecting to 5july with OMEMO encryption and decryption on the device.

This replaces the cancelled Converse companion roadmap. Its completed checkboxes do not carry over. Git history retains that plan. The native Monal fork remains intact; browser work lives in `browser/`. No client substitution or remote desktop is part of this plan.

Reusing `omemo-dr` alone is an encryption experiment, not a completed Gajim port. Later stages must retain and adapt Gajim/nbxmpp protocol and device-management behavior, with documented upstream provenance. The native GTK interface needs a browser implementation with explicit behavior and appearance comparisons.

## Requirements every increment must preserve

- User messages, edits and attachment descriptors require working OMEMO. Encryption failure blocks sending; never fall back to plaintext.
- Encryption/decryption and private state stay on the device. Hosting must not receive passwords, private keys or plaintext through application APIs or telemetry.
- Encrypted and identity-verified are different states. Indicators must reflect actual state, including missing, changed, blocked and unverified keys.
- Reload, reconnect and suspension preserve the same device identity. Storage failure must not silently create a replacement.
- One writer changes an account's cryptographic state at a time. Tab handoff preserves drafts without permanent sign-in lockouts.
- Persist outgoing work and session changes before transmission; preserve failed messages and prevent accidental duplicates.
- Correct sender, conversation, times and receipt state survive history loading, chat switching and reused UI components.
- Tests use synthetic identities first. Live tests are limited to Notes to self or the explicitly designated npc test account. Never message another contact for testing.
- Linux, Node and desktop-browser results are not physical iPad passes. Application deployment follows usable, verified functionality. A private synthetic QA harness may be hosted separately for HTTPS browser verification.

## Milestones and acceptance criteria

Checked means the stated evidence exists, not that the whole milestone is complete.

## Next usable milestone — one real encrypted conversation

Build in this order; source and security requirements above apply throughout:

1. **Durable send queue (local storage/service implemented):** persist queued text before the
   composer can clear; atomically save prepared ciphertext and its session
   update. Preserve pending/blocked work across reloads, reject conflicting
   reuse of a message ID, and retry preparation without duplicating committed
   ciphertext. First implement and test the local storage/service boundary;
   connect the composer and network dispatcher only after their own gates pass.
2. **Gajim/nbxmpp connection and device management (next development):** adapt the actual upstream
   code for 5july authentication, device publication, recipient bundles and
   reconnects, with a source/patch ledger.
3. **Fingerprint verification:** expose real fingerprints and distinct
   unverified/changed/blocked states. Missing usable keys block every content
   send; no plaintext fallback. Revalidate queued work against current device
   trust before transmission.
4. **Live interoperability:** exchange encrypted text in both directions with
   native Monal/Gajim using Notes to self or the designated npc account only.
5. **Conversation interface:** build the agreed bubbles, receipts, history,
   selection and image behavior around the verified messaging path.

Physical-device task: in iPad Safari, run the eight application identity-worker
checks and the seven durable outbox checks. Source integration can proceed
while these results are pending; a Chrome pass does not complete the iPad gate.

Queue acceptance for this increment: acknowledged enqueue survives reopening;
failed/aborted preparation changes neither the saved session nor prepared
payload; committed preparation survives a lost reply and is not repeated;
competing operations retain ordering and account isolation. Prepared means
locally encrypted and saved, not sent, delivered or read. Network delivery
reconciliation and wire-level required-OMEMO checks remain later gates.

### M0 — Source baseline: complete

- [x] Review pinned Monal, Gajim and nbxmpp source paths; verify 16 retrieved files against their Git blob hashes.
- [x] Verify the `omemo-dr 1.2.0` source archive SHA-256 and build it unchanged.
- [x] Pass all 8 upstream tests on native Python 3.12/Linux.
- [x] Identify C-extension, GTK/GI, GLib/Soup and SQLite platform dependencies.

M0 does not establish browser encryption, live interoperability or iPad support.

### M1 — Browser encryption feasibility: in progress

- [x] Pin Pyodide 314.0.7 / Python 3.14.2 / Emscripten 5.0.3 and build tools; compile the unchanged C extension to WebAssembly.
- [x] Package a local harness, pinned source/runtime hashes and licenses. No account login or contact messaging.
- [x] Pass all 8 upstream tests in WebAssembly under Node 24.22.1.
- [x] Pass 6 added WebAssembly checks: round trip/reply, altered payload/IV/wrapped key, missing device key and unavailable recipient. Upstream tests also cover reordered/missed/duplicate messages.
- [x] Complete the actual browser run: Chrome 155 on Linux over private HTTPS passed all 23 tests and three encrypted exchanges using real IndexedDB/Web Locks. Source and artifact hashes match the Node/CI baseline.
- [x] Run the same baseline in physical iPad Safari: user reports 23 tests and three storage-integrated encrypted exchanges passing twice, with matching artifact hashes.
- [x] Record iPad startup/check timings from both user-supplied reports.
- [ ] Measure iPad memory use and isolate startup loading costs from network/cache effects.

Exit: executable evidence for the chosen runtime. Record concrete blockers before changing architecture.

Evidence: [build and validation record](browser/docs/validation.md), [M1 WebAssembly result](browser/docs/evidence/node-wasm.json), [M2 WebAssembly/storage result](browser/docs/evidence/node-wasm-storage.json). The M1 blind-trust fixture is separate from the adapted Gajim store, which disables blind trust. Production device/trust orchestration remains M3.

Browser evidence: [initial Chrome result](browser/docs/evidence/chrome-browser.json), [lifecycle results](browser/docs/evidence/chrome-lifecycle.json), [lifecycle procedure and revision table](browser/docs/lifecycle.md). These establish the stated Chrome checks, not Safari or full browser-process crash correctness.

Physical iPad evidence: [user-reported Safari results](browser/docs/evidence/safari-user-reported.json). These cover the baseline, saved-session continuation, competing-tab blocking, reported owner-close recovery, close/reopen, lock/unlock and Safari relaunch continuation. Separate reload, confirmed OS suspension and commit-handoff scenarios stay open.

### M2 — Durable identity and sessions: in progress

- [x] Adapt Gajim's actual SQLite Store with hash-checked source, an explicit patch ledger, separate creation/restoration and snapshot validation.
- [x] Implement IndexedDB snapshot transactions, revision checks and per-operation Web Locks. Results are withheld until commit completes.
- [x] Verify identity, trust, prekeys and session continuation after reconstructing stores/managers in native Python and WASM; run three combined encrypted exchanges through the repository.
- [x] Pass 16 simulated IndexedDB/Node Web Locks tests, including interrupted writes, quota, denied storage, corruption, concurrent writers and lock timeout.
- [x] Run the combined storage/encryption fixture against actual Chrome IndexedDB and Web Locks; preserve identities through three exchanges and reconstructed stores/managers.
- [x] Reload the actual Chrome page and close/reopen its tab; retain identities and resume bidirectional encrypted exchanges from saved sessions.
- [x] Verify real Chrome tab contention without lock stealing. A queued operation recovers the prior revision after uncommitted owner closure, and the next revision after owner commit.
- [x] Terminate the test worker before commit, restart it and verify unchanged identity/revisions followed by successful encryption/decryption.
- [x] In user-reported iPad Safari results, load existing identities, continue encrypted exchanges and commit a held Alice change without losing either identity.
- [x] Confirm Safari competing-tab access is blocked without stealing the lock (user-reported).
- [x] Recover from the prior committed revision after the reported Safari owner-close sequence; continue encrypted exchanges with unchanged identities.
- [x] Restore saved identities and continue encrypted exchanges after the directed Safari close/reopen test (user-reported): inspect 12/11, then exchange to 14/13.
- [x] Continue encrypted exchanges after the directed app-switch and iPad lock/unlock test (user-reported), with unchanged identities.
- [x] Restore identities and continue encrypted exchanges after the directed Safari app-switcher dismissal and relaunch (user-reported).
- [ ] Verify Safari queued handoff after owner commit, a separate explicit reload and confirmed OS suspension. A lock/unlock pass alone does not establish OS suspension.
- [ ] Verify process crash during active work and actual-browser storage failure/eviction. The idle Safari relaunch pass does not cover a crash during a write or independently establish which WebKit processes terminated.
- [x] Add the application identity worker API: explicit creation, validated restoration, bounded serial work, public-only replies and interrupted-operation outcomes.
- [x] Verify the application identity worker in actual Chrome: eight checks cover creation/restoration, queued committed handoff, interruption before commit and recovery after a lost acknowledgement. [Raw result](browser/docs/evidence/chrome-identity-worker.json).
- [x] Reload a synthetic session from the previous deployed adapter with the new build; preserve identities and resume encrypted exchange from 3/3 to 5/5. [Upgrade result](browser/docs/evidence/chrome-identity-upgrade.json).
- [ ] Verify the new application identity worker on physical iPad Safari; earlier harness passes do not cover this changed boundary.
- [ ] Complete the messaging worker/coordinator lifecycle, including suspended pages, durable drafts and atomic outgoing work.
- [ ] Distinguish sign-out, local-history removal and deliberate device reset.

Exit: persistence/concurrency tests pass, including physical Safari lifecycle tests.

Implementation and limits: [storage design](browser/docs/storage.md), [actual lifecycle evidence](browser/docs/lifecycle.md), [outbox boundary](browser/docs/outbox.md). The test harness uses separate workers/runtimes and real browser locks. Atomic outbox storage is implemented; it does not authorize network transmission before recipient-policy and dispatcher integration.

### M3 — Gajim protocol integration and 5july: pending

- [ ] Adapt Gajim/nbxmpp client and OMEMO lifecycle at explicit platform boundaries; keep a source-reuse and patch ledger.
- [ ] Adapt Soup/GLib networking/scheduling to browser APIs. nbxmpp already supports XMPP WebSockets; assess BOSH/XEP-0206 if actual endpoint capabilities require it.
- [ ] Verify 5july transport, authentication, device publication, bundle retrieval, changed-key handling and fingerprints.
- [ ] Enforce required OMEMO for every user-content send path and test at the transmitted-stanza boundary.
- [ ] Exchange encrypted text both ways with native Monal/Gajim using authorized test identities.

Exit: real interoperability evidence, no plaintext fallback and understandable diagnostics. Shared namespaces alone are not proof.

### M4 — Reliable conversations: in progress

- [x] Persist queued intent with stable IDs, conversation order, account isolation and blocked preparation/retry states.
- [x] Commit prepared ciphertext and session changes together; verify rollback after a late abort and reuse after a lost reply using actual Gajim WASM crypto.
- [x] Preserve v1 identity data when adding the outbox store; reject corrupt, missing or stale initialized queue records.
- [x] Pass seven outbox checks and eight identity-worker regressions in actual Chrome; preserve identity and encrypted continuation across the database upgrade. [Evidence](browser/docs/evidence/chrome-outbox.json).
- [ ] Verify the outbox on physical iPad Safari, including interrupted active work and storage failures.
- [ ] Connect the production messaging worker, recipient-policy checks and dispatcher; reconcile uncertain network delivery without blind resend.
- [ ] Connect the composer: clear after enqueue succeeds; compact pending/sent/read/failed states and deliberate retry.
- [ ] Reconcile uncertain delivery by stable message ID. Tightly spaced double checks require an actual read indication.
- [ ] Archive history, carbons and reconnect preserve correct sender/direction through chat switches.
- [ ] Explain old ciphertext that omitted this device separately from new-message failures.
- [ ] Encrypt attachments locally; send encrypted descriptors and render images after authenticated decryption.

### M5 — Familiar iPad interface: pending

- [ ] Compare with agreed native reference: distinct incoming/outgoing bubbles, legible times and compact receipts.
- [ ] Native text selection/right-click; menus close after use; no persistent Copy/Select buttons per message.
- [ ] Keyboard-safe composer, image zoom and Escape dismissal of the new-message divider.
- [ ] One sign-in attempt after password-manager autofill; editable fields after failure and no retry loop.
- [ ] Aligned avatars; actual iPad touch, pointer, keyboard, accessibility and contrast checks.

### M6 — Release and maintenance: pending

- [ ] Reproducible pinned builds, dependency review, attribution and controlled same-origin runtime assets.
- [ ] Upgrade/rollback tests preserve keys, trust, queued messages and history.
- [ ] Review delivered code, hosting trust, content security policy and absence of plaintext/key telemetry.
- [ ] Publish after integration/iPad checks pass; document remaining limits accurately.

## Method

Use Asura's method: define goals/constraints, give each component one responsibility, implement the smallest useful increment, verify immediately and verify its interactions. Complete the foundation before visual polish. Update this roadmap with evidence and limits after each increment.

See [build entry point](browser/README.md) and [architecture](browser/docs/architecture.md).
