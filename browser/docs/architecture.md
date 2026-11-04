# Browser port design

## Decision

Execute a Gajim-derived core in the browser. Evaluate Pyodide/WebAssembly for the existing Python/C code. Keep OMEMO keys and plaintext on the device. Server-hosted Gajim with remote display is outside this trust model.

The complete GTK application cannot run unchanged in Safari. Demonstrate compatibility incrementally and compare the later browser interface with the agreed native reference.

## Boundaries

| Component | Responsibility |
| --- | --- |
| Upstream cryptography | Existing key agreement, signatures, ratchets and authenticated encryption |
| Device/trust coordinator | Gajim device publication, changed keys, fingerprint decisions and required-encryption policy |
| Store/outbox | Durable identity, sessions, trust, outgoing work and explicit transaction completion |
| Browser adapters | WebSocket transport, scheduling, persistence and worker/tab lifecycle |
| Gajim/nbxmpp messaging | Stanzas, conversations, carbons, history and actual receipt semantics |
| Browser interface | Drafts, selection, images and sender/time/status presentation derived from real state |

Introduce components when the milestone needs them. The executable harness now covers the unchanged encryption library and an adaptation of Gajim's actual SQLite store. See [storage boundaries and patch ledger](storage.md).

The [application identity worker](identity-worker.md) now owns identity creation
and restoration behind a bounded, serialized request interface. The
[local outbox](outbox.md) persists intent and atomically commits preparation
with session changes. Messaging and device/trust decisions remain separate
increments. The [nbxmpp investigation](nbxmpp-port.md) identifies the next
platform boundaries and tests; it has not yet ported the networking client.

## Send sequence

1. Persist intent with account, conversation and stable message ID.
2. Clear the composer after that save succeeds.
3. Check device/trust state and encrypt with the upstream engine.
4. Commit changed session state and prepared ciphertext durably before transmission. Specify atomicity and crash recovery at this boundary.
5. Transmit; distinguish server acknowledgement, recipient delivery and read indications.
6. Retain failed work. Reconcile uncertain delivery using its existing ID before retry. Never send plaintext as fallback.

Incoming ciphertext must be bound to its actual sender/device/conversation. Persist state changes before acknowledging application-level processing. History, carbons and UI reuse must not change attribution.

## Pinned source baseline

| Upstream | Pin | Scope |
| --- | --- | --- |
| tobiko-dev/Monal | `44507c813412584c7f26d7a4fa5896bf1f786813` | Native OMEMO/storage/network/Swift crypto reference |
| gajim/gajim | `5a57abb2950886dd9cb8a73972ecc2dcc59f688a` | OMEMO orchestration/storage and client lifecycle |
| gajim/python-nbxmpp | `999ce8859d6d799fe8ce00a877e85b2ae554e392` | Client, WebSocket transport and OMEMO XML |
| omemo-dr | `1.2.0` source release | Python session logic and bundled C curve extension |

Archive SHA-256: `18b6542b3bb7ed6dce34dd02f32b16401982ba24f0146ddae091dcb92c79a484`.

- https://github.com/gajim/gajim/tree/5a57abb2950886dd9cb8a73972ecc2dcc59f688a
- https://github.com/gajim/python-nbxmpp/tree/999ce8859d6d799fe8ce00a877e85b2ae554e392
- https://gitlab.com/gajim/omemo-dr
- https://pypi.org/project/omemo-dr/1.2.0/

Preserve copyrights/licenses with redistributed source and built artifacts; record every compatibility patch. Runtime/build pins follow ABI verification.

## Existing evidence and limits

The unchanged library built with GCC on native Python 3.12/Linux and passed all 8 upstream tests. Sixteen reviewed repository files matched their Git blob hashes. No browser persistence, live interoperability or physical iPad result is implied by this baseline.

The reviewed paths, commits and blob hashes are in [the source manifest](evidence/source-review-manifest.json). Subsequent WebAssembly evidence is tracked in [validation](validation.md).
