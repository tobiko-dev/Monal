# Durable outbox storage

Goal: accept queued text without waiting for encryption or the network, and
save each prepared payload together with the OMEMO session changes that made
it. A failed write must leave neither half committed.

This increment is the local repository/service boundary. It has no dispatcher,
XMPP stanza builder, composer or page-facing messaging worker command. The
application identity worker remains identity-only. The synthetic QA engine
uses unchanged omemo-dr and adapted Gajim storage; its explicit peer trust is
test-only. Wiring Gajim/nbxmpp device policy into a production preparation
engine is the next integration stage.

## Responsibilities

- `outbox-model.mjs`: bounded record validation, fixed blocked-state codes,
  prepared-byte encoding and UI result projection.
- `OutboxService`: stable message IDs, immutable submitted intent, conversation
  order, explicit retries and preparation through an injected worker-internal
  engine. That engine must use a fresh crypto working copy, return only
  encrypted bytes, and perform no network I/O. A host must serialize access to
  any shared Python runtime; a page cannot supply an engine callback.
- `SnapshotRepository`: one account lock around load/prepare/commit, snapshot
  and queue validation, compare-and-swap, and one IndexedDB transaction for
  both stores. It exposes success only after transaction completion.

## Operation sequence

1. The future composer generates a UUID once for the submitted intent.
2. `enqueue(account, {id, conversation, text})` captures that intent and saves
   it as queued. The composer may clear only after this promise succeeds.
   A failed/unknown enqueue keeps the draft and its ID for reconciliation.
3. `prepare(account, id)` loads the current committed snapshot and queue under
   the same account lock. Earlier unprepared work in that conversation blocks
   reordering; a blocked different conversation does not block this one.
4. The engine works on a disposable snapshot. A known key/encryption failure
   persists a blocked state without saving its crypto mutations. An unexpected
   exception saves nothing and is not copied into queue diagnostics.
5. Success saves the new session snapshot and prepared bytes atomically. A
   late abort rolls back both. The original text remains queued for display.
6. A repeated prepare of an already prepared ID returns its state without
   re-encryption. A lost reply is reconciled by reopening/listing or retrying
   with the same ID. Reusing an ID for different text or a different conversation
   is rejected. Same text with different IDs remains distinct user intent.

| State | Meaning |
| --- | --- |
| `queued` | Submitted text saved locally, encryption not yet committed |
| `blocked` | Preparation needs attention; text retained; explicit retry allowed |
| `prepared` | Engine output and session update saved together; no network send implied |

No state means sent, delivered or read. UI projections omit snapshots and
prepared payloads. The queue stores a format identifier and opaque prepared
bytes; the storage layer cannot prove those bytes are an OMEMO stanza. The
production engine/dispatcher must enforce required encryption, complete
recipient-device coverage and current fingerprint/trust policy at the wire
boundary. Previously prepared work needs that policy check before transmission.
Stable local IDs alone do not establish exactly-once network delivery.

## Storage compatibility and bounds

The database name is unchanged. IndexedDB version 2 adds an `outbox` store
without rewriting v1 identity snapshots. Each account has a queue revision
and checksum mirrored in its identity record. Missing, corrupt or stale queue
records fail closed instead of silently becoming an empty queue. Ordinary
crypto updates preserve this reference. The paired records commit in the same
transaction and use independent crypto/queue revisions.

Old code opening version 1 fails once the database upgrades; it must reload
the current code. Rolling back to a v1-only client is not supported. Do not
delete browser storage to work around the version check. A compatible rollback
must understand the newer store and preserve its state.

Limits are 256 retained entries/account, 64 KiB UTF-8 text/message, 1 MiB
prepared bytes/message and 24 MiB serialized entries/account. Full/invalid
queues reject new work, never evict earlier messages. Sent-message retirement,
deduplication tombstones, attachments and queue cancellation are later work.

Text, private snapshots and prepared data remain readable to this origin;
this increment adds no encryption at rest. Checksums detect accidental damage,
not malicious same-origin code or a rollback of the whole database. Browser
eviction, backups, storage quotas in physical Safari and process-crash recovery
during writes retain their roadmap gates. IDB strict durability is a hint,
not a power-loss guarantee.

## Verification

Twenty outbox tests extend the existing 30 JS checks to 50. They cover stable
IDs and conflicting reuse, account/conversation isolation, ordering, missing
identities, caller mutation, blocked retries, unexpected failures, late abort,
quota failure, concurrent preparation, stale writers, deleted/rolled-back
queues, invalid payloads, capacity and upgrade from a v1 database. These use
simulated IndexedDB and Node Web Locks.

The shared `outbox-checks.mjs` harness also runs with actual Gajim WASM crypto:
seven checks establish synthetic sessions, enqueue/reconstruct, force an abort
after the outbox write, retry/decrypt, reconcile a discarded successful reply
without re-encrypting, and continue in both directions. Four committed messages
decrypt, including the setup message and reply; one preparation is deliberately
discarded. This does not simulate a process crash. Results are recorded in
[validation](validation.md), distinguishing Node and actual-browser evidence.

All seven shared checks passed in actual Chrome 155 on 2026-11-04, along with
the eight identity-worker regressions and a saved-session upgrade from the
previous deployed schema. [Raw results](evidence/chrome-outbox.json).

The user also reported all seven checks passing on physical iPad Safari 26.6
in 3,314 ms, with 28 baseline tests and matching wheel/adapter hashes. Four
encrypted exchanges succeeded, one preparation was deliberately discarded,
identities were preserved and the page reported synthetic data deleted.
[Transcribed Safari report](evidence/safari-worker-outbox-user-reported.json).
This completes the same synthetic queue checks on that device. Actual process
interruption during writes, storage eviction and quota exhaustion remain open.
