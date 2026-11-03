# Gajim-derived browser port

Updated: 2026-11-03. Status: foundation build in progress; no usable browser chat application yet.

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
- Linux, Node and desktop-browser results are not physical iPad passes. Deployment follows usable, verified functionality.

## Milestones and acceptance criteria

Checked means the stated evidence exists, not that the whole milestone is complete.

### M0 — Source baseline: complete

- [x] Review pinned Monal, Gajim and nbxmpp source paths; verify 16 retrieved files against their Git blob hashes.
- [x] Verify the `omemo-dr 1.2.0` source archive SHA-256 and build it unchanged.
- [x] Pass all 8 upstream tests on native Python 3.12/Linux.
- [x] Identify C-extension, GTK/GI, GLib/Soup and SQLite platform dependencies.

M0 does not establish browser encryption, live interoperability or iPad support.

### M1 — Browser encryption feasibility: in progress

- [ ] Pin compatible Pyodide, Python, Emscripten and build tools; cross-compile the existing C extension without replacing its cryptography.
- [ ] Package a reproducible local harness with source hashes and licenses. No account login or contact messaging.
- [ ] Run upstream tests in WebAssembly and an actual browser.
- [ ] Verify encrypted round trips/replies, tamper rejection, wrong-device rejection and duplicate handling with synthetic identities.
- [ ] Record startup/memory observations and run the same harness in physical iPad Safari.

Exit: executable evidence for the chosen runtime. Record concrete blockers before changing architecture.

### M2 — Durable identity and sessions: pending

- [ ] Implement the upstream Store boundary with durable browser storage and explicit transactions.
- [ ] Verify identity, trust, prekeys and sessions survive reload and restart.
- [ ] Interrupt writes; simulate quota, denied-storage and corrupted-state failures; block unsafe continuation.
- [ ] Serialize cryptographic work across tabs; test closure, suspension and handoff.
- [ ] Distinguish sign-out, local-history removal and deliberate device reset.

Exit: persistence/concurrency tests pass, including physical Safari lifecycle tests.

### M3 — Gajim protocol integration and 5july: pending

- [ ] Adapt Gajim/nbxmpp client and OMEMO lifecycle at explicit platform boundaries; keep a source-reuse and patch ledger.
- [ ] Adapt Soup/GLib networking/scheduling to browser APIs. nbxmpp already supports XMPP WebSockets; assess BOSH/XEP-0206 if actual endpoint capabilities require it.
- [ ] Verify 5july transport, authentication, device publication, bundle retrieval, changed-key handling and fingerprints.
- [ ] Enforce required OMEMO for every user-content send path and test at the transmitted-stanza boundary.
- [ ] Exchange encrypted text both ways with native Monal/Gajim using authorized test identities.

Exit: real interoperability evidence, no plaintext fallback and understandable diagnostics. Shared namespaces alone are not proof.

### M4 — Reliable conversations: pending

- [ ] Durable outbox: clear composer after enqueue succeeds; compact pending/sent/read/failed states and deliberate retry.
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
