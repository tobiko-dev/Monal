# Application identity worker

This increment owns identity creation and restoration behind a page-facing
worker API. The unchanged omemo-dr engine and adapted Gajim SQLite store remain
the cryptographic implementation. No messaging API is added.

## Contract and flow

`IdentityClient` is bound to one immutable account identifier. The eventual
Gajim/nbxmpp account layer supplies its canonical identifier; this layer does
not invent JID normalization. Calls return a public device ID, fingerprint and
saved revision. Private SQLite snapshots never appear in worker replies.

| Call | Behavior |
| --- | --- |
| `create()` | Explicit first-device provisioning; rejects any existing record, including damaged state |
| `open()` | Validate committed SQLite/account/identity; never create keys or advance the revision |
| `close()` | Terminate the worker, reject pending calls, preserve saved state and the client's public identity anchor |

The next explicit `open()` starts a fresh worker. Closing does not implement
XMPP sign-out, history erasure or device reset; those actions remain separate.

1. Validate a versioned request. Only `create` and `open` are accepted.
2. Initialize the same-origin pinned WASM runtime once per worker, without
   installing/running the synthetic test suite.
3. Serialize up to 32 pending operations. Per-account Web Locks additionally
   serialize separate workers/tabs from load through commit.
4. Create or validate a disposable Python store. Creation uses the prekey and
   signed-prekey configuration from the pinned Gajim OMEMO module.
5. Commit creation through IndexedDB before replying. Opening validates SQLite
   and its identity against the outer record without rewriting it.
6. Return a strictly projected public result. Errors use a fixed code allowlist;
   tracebacks, snapshots and private exception strings are not returned.

## Interruption and uncertainty

Stopping, crashing or timing out the worker rejects every pending page request.
A creation sent to that worker has an **unknown** outcome: it may have committed
before losing its reply. The API never retries automatically. Open saved state
to reconcile; a missing identity still requires an explicit create action.
Read failures have a `read_only` outcome; known write aborts are `not_committed`.

An acquired Web Lock remains owned until completion or worker termination. A
timer never steals it. The client watchdog is three minutes, including runtime
startup. It terminates the worker and reports uncertainty. Initialization failure
remains failed until explicit worker restart. Duplicate IDs, account switching,
unknown commands, queue overflow and invalid replies fail closed. A stopped
worker's late reply cannot settle a new request. The client retains its public
fingerprint anchor across worker restart and rejects an identity change.

## Verification and limits

Node tests cover serialization, creation/restoration, account binding, late IDB
abort, lost acknowledgement, timeout, worker stop, malformed replies, queue
limits and redaction. IndexedDB is simulated. Five Python tests exercise the
application bridge with actual Gajim storage and omemo-dr. The combined WASM
check creates through the application service, performs four synthetic encrypted
messages, and reopens the saved identity between exchanges.

`identity-worker.html` tests actual module workers through the same application
client/host/service and WASM loader. Its separate QA worker can pause before
commit or suppress a reply after commit; these hooks are absent from the
production worker entry point. Test databases are disposable. The validation
record distinguishes observed browser results from simulated tests.

On 2026-11-04, all eight worker checks passed in actual Chrome 155 over the
private HTTPS QA deployment. Both held/queued cases observed one held and one
pending Web Lock. The fixture recovered after termination before commit and
after a successful commit whose reply was suppressed. Test data was deleted.
[Raw browser result](evidence/chrome-identity-worker.json). A separate deployment
upgrade check restored the previous adapter's synthetic identities and resumed
encrypted exchange from revisions 3/3 to 5/5 without replacing either identity.
[Upgrade result](evidence/chrome-identity-upgrade.json).

The user subsequently reported all eight checks passing on physical iPad Safari
26.6 in 22,430 ms, including both one-held/one-pending lock cases. The report
states that synthetic data was deleted. This is evidence for the application
worker boundary, distinct from the earlier lifecycle harness.
[Transcribed Safari report](evidence/safari-worker-outbox-user-reported.json).

This is the identity portion of the coordinator. There is no send, receive,
trust-approval, key-export or reset command. Durable outbox and atomic
session/ciphertext storage now exist as a separate internal service; they are
not yet bound to a page-facing messaging API. Account login,
fingerprint comparison UI, transport, page lifecycle integration and suspended
pages remain later work. The fixture's peer trust is explicit and test-only.

Worker separation is an interface boundary, not protection against malicious
same-origin code. Snapshot bytes remain unencrypted at rest. Eviction, process
crash during a write, delivery uncertainty and hosting/code trust retain their
roadmap checks. The new physical iPad report covers worker termination, not an
OS/browser-process crash or storage eviction.

Platform contracts: [Web Workers](https://html.spec.whatwg.org/multipage/workers.html),
[Web Locks](https://www.w3.org/TR/web-locks/), [IndexedDB](https://www.w3.org/TR/IndexedDB/).
