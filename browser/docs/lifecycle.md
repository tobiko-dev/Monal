# Browser lifecycle verification

The private harness exposes `lifecycle.html` for testing the actual browser
storage implementation across page/worker boundaries. It uses two synthetic
identities and has no XMPP transport, credentials or contact access.

Each run has a random UUID in its page URL. Only that run's two disposable
databases are touched. Private SQLite snapshots stay in the snapshot repository;
the companion fixture record holds public bundles and expected identity
fingerprints. No production outbox or account-reset behavior is implemented here.

## Checks

1. Start a new synthetic test. The initial exchange establishes sessions in both
   directions. Save the displayed revisions.
2. Reload the page. Opening an existing URL only inspects saved state; it never
   generates replacement identities. Resume and exchange. Both messages must
   decrypt with the original identities and continued sessions.
3. Close the page and reopen the same test link. Inspect and exchange again.
4. Open that test in another tab. Hold an uncommitted change in one tab. This
   advances a ratchet in a disposable working copy, then waits **before** the
   repository commits it. The competing-owner check in the other tab must
   report `STORAGE_BUSY` without stealing the lock.
5. Queue an exchange in the other tab. Inspect the lock queue in the owner tab;
   it should show one held and one pending lock for this run. Close the owner
   tab. The queued exchange must continue from the revision recorded before
   the interrupted change and decrypt successfully.
6. Repeat the held/queued test but commit the held change. The other tab must
   load the next committed revision, then exchange successfully. The held
   ciphertext is intentionally discarded in this synthetic test, so the peer
   must also cope with that missed synthetic message.
7. Stop a worker while it holds an uncommitted change, then resume it. Check
   saved revisions and successful decryption; worker termination alone is not
   reported as proof of safe recovery.
8. Close other test tabs and delete this synthetic test using its button.

The harness stops its worker on `pagehide`, including entry into the back/forward
cache, and starts a fresh worker on a persisted `pageshow`. This prevents an
inactive page from retaining its test worker's account lock. The production
worker/coordinator integration still needs to adopt and verify lifecycle policy.

The fixture uses a 30-second acquisition timeout for manual queued-handoff tests;
the repository's production default remains 10 seconds. One worker accepts one
operation at a time. Different pages use separate WASM runtimes and coordinate
through the actual repository's account locks.

## Evidence boundaries

Node tests validate fixture setup, reconstruction, contention and continued
ratchets against simulated IndexedDB. They do not prove tab closure or reload.
Browser evidence must record actual page actions and the resulting reports.
Full browser-process crash, OS suspension, storage eviction, private browsing,
and physical iPad Safari remain separate checks even when these Chrome tests
pass. This test UI is not the messaging application's interface.
