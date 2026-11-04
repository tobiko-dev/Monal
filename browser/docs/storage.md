# Identity storage increment

This is M2 foundation code with the lifecycle evidence below. The application
identity worker is implemented; the messaging coordinator and sending API are
not complete. See [the worker contract](identity-worker.md).

## Actual source reuse

`vendor/gajim/omemo_storage.py` is the original Gajim file at commit
`5a57abb2950886dd9cb8a73972ecc2dcc59f688a`, path
`src/gajim/common/storage/omemo.py`. Its SHA-256 is checked before packaging:
`5f57337f29e1d3a889698a2f65aba4348754ac268aad49fe18f32f9e4d427260`.

`scripts/prepare_port.py` creates a separate adapted module. It applies exactly
three substitutions, requiring each original string to occur once:

| Original dependency | Browser adaptation |
| --- | --- |
| Desktop application import | Remove the import |
| Gajim logging adapter | Standard Python `LoggerAdapter` |
| Account blind-trust setting | Return false; new peer identities start undecided |

Gajim's schema, SQL, key serialization and session storage logic are retained.
The original file is packaged alongside the compiled crypto source and licenses.
The adaptation does not alter `omemo-dr` cryptography.

## Working copy and commit boundary

`SnapshotStorage` subclasses that adapted store. It opens SQLite in WebAssembly
memory. Creating a new device is a separate explicit operation; opening missing,
damaged or unsupported existing state raises an error. Snapshot validation checks
schema version, SQLite integrity, account binding, a single device identity and
the relationship between its private and public keys. Public fingerprints use
the upstream implementation.

`SnapshotRepository` holds a Web Lock for the account from load through commit.
It loads a copy of the snapshot into an operation, then commits the complete new
snapshot in one IndexedDB transaction with a revision comparison. It resolves
the operation's result only on transaction completion, not on an individual
write request's success. The caller must discard its crypto working copy after
failure and must not perform network I/O inside the operation.

The strict durability option is a browser hint, not an absolute power-loss
guarantee. There is no localStorage fallback, lock stealing or implicit retry.
The lock covers one operation, not the whole sign-in session. Waiting has a
bounded timeout; an acquired operation retains ownership until it finishes.

The application worker checks the JS record descriptor against the Python
snapshot on opening. A read callback validates the full SQLite state under
the account lock without incrementing its revision. Upstream-normalized account
identifiers and the messaging coordinator still belong to integration.

## What is and is not protected

Private identity and session bytes stay in the origin's IndexedDB. This increment
does not encrypt that database at rest. Its SHA-256 detects accidental damaged
bytes; it does not authenticate state against malicious same-origin JavaScript
or prevent someone restoring an older database. Delivered-code, local-access,
backup, eviction and upgrade policies remain release work.

Turning off blind trust does not complete the fingerprint-verification UI or
the whole sender policy. Gajim's low-level `is_trusted_identity()` remains
unchanged; outbound device selection consults stored trust. The application
must still enforce all required peer/device and changed-key conditions at the
stanza boundary. No user content is sent by this increment.

The [outbox increment](outbox.md) adds a separate queue store in the same
database, with atomic snapshot/queue commits and a version/checksum reference
in the identity record. Prepared work and stable intent survive reopening.
This remains a local API: a dispatcher must revalidate recipient policy and
reconcile uncertain delivery before transmitting or retrying network work.

## Evidence and remaining gates

- Nine storage tests pass in native Python and WebAssembly, including identity,
  prekeys, peer trust and ratchet continuation after reconstructing both stores
  and session managers. Empty, corrupt, wrong-account, future-schema, duplicate
  identity and inconsistent-key snapshots are rejected.
- Sixteen Node tests exercise the real JS repository against **simulated**
  IndexedDB and Node's Web Locks implementation. They include concurrent
  operations, late transaction abort, quota denial, unavailable storage,
  changed identity, damaged data, stale writer and lock timeout.
- A combined test performs three encrypted exchanges through WASM, Gajim's
  SQLite snapshots and the repository, reconstructing objects between calls.
  The same fixture also passes in actual Chrome 155 over HTTPS with real
  IndexedDB and Web Locks; see [the browser result](evidence/chrome-browser.json).
  That initial fixture covers reconstructed objects in one worker.
- The separate [lifecycle harness](lifecycle.md) now passes actual Chrome page
  reload, tab close/reopen, competing-tab lock timeout and queued handoff after
  both owner commit and uncommitted owner closure. Stopping the worker before
  commit retains the previous revision; a fresh worker resumes encrypted
  exchanges with unchanged identities. The raw reports record saved revisions
  and a one-held/one-pending queue before each explicitly verified handoff.

User-reported physical iPad Safari baseline, tab contention, close/reopen,
lock/unlock and app relaunch results are recorded in [validation](validation.md).
They do not prove process-crash recovery during active work, confirmed OS
suspension or actual-browser storage eviction. Explicit sign-out/reset behavior
remains pending. Tests use synthetic identities only. Their explicit synthetic
trust decisions are not a production trust UI, and their lifecycle results do
not complete the application messaging coordinator.

Platform references: [Web Locks](https://www.w3.org/TR/web-locks/),
[IndexedDB](https://www.w3.org/TR/IndexedDB/),
[Node Web Locks](https://nodejs.org/api/worker_threads.html#worker_threadslocks).
