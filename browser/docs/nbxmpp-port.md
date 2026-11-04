# nbxmpp browser integration boundary

## Implemented offline protocol core

The pinned nbxmpp client and protocol modules now run with explicit browser
adapters. Native Python, Node-hosted WebAssembly and actual Chrome each pass **128 unchanged
upstream tests, 20 adapter/security tests and eight asynchronous checks**.
The checks exercise real OMEMO bundle/message XML and the unchanged Gajim
encryption library, including a reply after session restoration, altered
ciphertext rejection and a message addressed to another device.

This increment has no network transport. `Client.connect()` fails before
changing stream state or resolving addresses. Actual-browser verification is
tracked separately in [validation](validation.md); no live interoperability
or physical Safari result is implied by the native/Node runs.

The build verifies the complete original Git archive, packages 96 of its 99
runtime modules and records **37 patch operations across nine files**.
`connection.py`, `tcp.py` and `websocket.py` are excluded from the runtime;
their originals remain in the source archive. The generated
[patch](evidence/nbxmpp-browser.patch) and
[adaptation manifest](evidence/nbxmpp-adaptation.json) make the boundary
reviewable. No `gi` facade is installed.

| Adapter | Implemented behavior and limits |
| --- | --- |
| Values and addresses | Preserve upstream JID/IDNA/PRECIS validation. Pin `idna 3.11` and `precis-i18n 1.1.2`. Strict percent/UTF-8 decoding rejects malformed or NUL-containing input instead of changing an address silently. Stdlib IP parsing intentionally rejects NUL suffixes and slash scope IDs accepted by a native GLib spot check. |
| Timers | Use asyncio/Pyodide WebLoop callbacks, repeat/remove results, cancellation and disposal. IDs are not reused; self-cancellation cannot revive a timer. Exceptions remove the timer with redacted diagnostics. This is not a GLib thread, I/O or priority implementation. Page suspension/reconnect still need integration tests. |
| SCRAM password derivation | Pyodide's OpenSSL-free `hashlib` lacks `pbkdf2_hmac`. Use the already pinned `cryptography 47.0.0` PBKDF2 implementation. RFC 7677 SCRAM-SHA-256 and independent SHA-1/256/512 derivation vectors pass. No new crypto primitive and no omemo-dr KDF change. |
| Desktop capabilities | Proxy resolution and desktop TLS/Soup introspection fail explicitly. No GLib version is invented. Browser channel-binding data is unavailable, so upstream non-PLUS SASL selection is retained. Desktop version comparisons no longer need `packaging` at runtime. |

SCRAM policy bounds the server-requested work to 1,000,000 iterations, salts
to 1,024 bytes, password input to 65,536 bytes and derived output to 64 bytes.
Only SHA-1/256/512 are supported. Upstream's minimum 4,096 iterations remains.
Rejected parameters become an authentication failure. These upper bounds need
review against the actual server before enabling authentication; no server was
contacted to establish compatibility.

The tests also verify actual client construction/destruction and IQ timeout/
cancellation using a synthetic IQ transport boundary. The upstream client,
tasks and XML code are real; this is not a simulated implementation of those
components. The outbox still uses its separate JSON fixture and is not yet
connected to OMEMO stanza preparation or production recipient policy.

## Historical import investigation

Use Gajim's actual nbxmpp client, stanza parser, authentication and OMEMO XML
code in a browser worker, then connect to 5july with the saved local identity.
This is the next integration stage after the iPad worker/outbox checks.

The source remains pinned to
[`999ce8859d6d799fe8ce00a877e85b2ae554e392`](https://github.com/gajim/python-nbxmpp/tree/999ce8859d6d799fe8ce00a877e85b2ae554e392)
(upstream declares version 7.5.0). A bounded investigation read committed Git
objects, scanned all 99 Python modules and attempted the unchanged
`nbxmpp.client` import in the existing Pyodide 314.0.7 / Python 3.14.2 runtime.
It stopped at `ModuleNotFoundError: gi`. Twelve modules import desktop GI APIs;
their source hashes and import locations are recorded in the
[probe report](evidence/nbxmpp-import-probe.json).

That probe reproduced a compatibility blocker, **not a passing protocol test**.
No compatibility shim, fake GI module, socket or account was used. Finding the
first missing import does not prove that all subsequent dependencies are known.
The report lists 27 upstream regression source files; this probe does not run
those tests. Existing crypto, identity and outbox implementation is unchanged.

Reproduce after building the existing runtime, using a local upstream Git
checkout containing the pin:

```sh
node browser/scripts/probe-nbxmpp.mjs /path/to/python-nbxmpp report.json
```

The probe reads the pinned Git objects rather than the checkout's working
files. Exit zero means it completed and reproduced this known import blocker;
the report's status remains `blocked_by_desktop_dependency`.

## Responsibilities to retain and adapt

| Boundary | Pinned source behavior | Browser treatment and verification |
| --- | --- | --- |
| Package and value helpers | `__init__.py` requires Soup at import; `protocol.py`, `const.py`, `structs.py` and `util.py` reference GI types, URI/IP helpers and versions | Explicit compatibility imports and a patch ledger. Preserve upstream JID/IDNA/PRECIS behavior; pin actual `idna` and `precis-i18n` dependencies. The removed desktop version comparison no longer needs `packaging`. Do not claim GI exists or fabricate TLS capabilities. |
| Scheduling | `client.py`, `dispatcher.py`, `task.py` use cancellable GLib timeouts | Worker event-loop adapter with correct repeat/remove behavior, asynchronous callbacks and disposal. Test cancellation, stale callbacks, reconnect and paused pages. |
| Transport | `client._get_connection()` selects `websocket.WebsocketConnection` or TCP; WebSocket uses Soup/Gio | Adapt this factory/connection interface to browser `WebSocket`, preserving upstream client events and state-machine ownership. Browser build must exclude raw TCP, plaintext `ws:` and STARTTLS paths. |
| Endpoint selection | `addresses.py` accepts a custom WebSocket endpoint or supplied host-meta; it also contains TCP defaults/fallbacks | Verify the 5july endpoint independently, restrict protocol/type and retain upstream XMPP-domain binding. A failed WebSocket must not fall back to an unsafe/unrelated endpoint. No endpoint was tested in this investigation. |
| TLS and authentication | `connection.py` exposes certificate/cipher/channel-binding data; `sasl.py` implements SASL and SCRAM | Browser validates WSS TLS. Report unavailable TLS details honestly; permit only authentication mechanisms supported by actual capabilities. Preserve and test upstream SASL validation. |
| XML and stanza processing | `simplexml.py`, `protocol.py`, `dispatcher.py` parse stanzas, namespace framing, errors and sender metadata | Reuse the parser/dispatcher. Run upstream malformed-XML/entity tests plus WebSocket-frame variants, bounded input, sender attribution and stream restart cases. |
| Device publication and OMEMO XML | `modules/omemo.py` requests/publishes device lists and bundles and constructs/parses OMEMO elements | Reuse these functions with Gajim's orchestration and the actual local session store. Replace the outbox fixture's test-only JSON with real OMEMO stanzas only after recipient-policy checks exist. |
| Send completion | Upstream WebSocket emits `data-sent` after handing bytes to Soup; client stream management maintains a separate queue | Browser `send()` only queues bytes. Preserve distinct local preparation, transport acceptance, server acknowledgement, recipient delivery and read states; never turn local transport acceptance into a delivery checkmark. |

The connection interface includes `connect`, `send`, `disconnect`, input/output
shutdown and disposal, with `connected`, `connection-failed`, `disconnected`,
`data-sent` and `data-received` notifications. The adapter must remove handlers
and pending timers on disposal; stale events must not reach a replacement
connection. Transport lifecycle must not generate or reset an OMEMO identity.

RFC 7395 requires the `xmpp` WebSocket subprotocol and text XML frames. The
pinned Soup transport has a TODO for checking the negotiated subprotocol; the
browser adapter must check it before announcing connection success. It must
bound application buffering and incoming text size, reject binary frames and
use XMPP ping/stream-management behavior where the browser exposes no WebSocket
control-frame API. Browser TLS certificate details are unavailable to this API.
References: [RFC 7395 §§3, 6](https://www.rfc-editor.org/rfc/rfc7395.html),
[WebSocket API and buffering](https://websockets.spec.whatwg.org/).

## Next increment and acceptance gates

1. **Port the protocol/runtime boundary without network access.** Package the
   pinned upstream code and dependencies with hashes/licenses. Adapt only the
   GI-dependent helpers and scheduling needed to import the client and execute
   its protocol tests. Keep a file-by-file patch ledger; fail unsupported
   operations explicitly. Run upstream JID, XML, OMEMO parsing and SCRAM vectors
   natively and in WASM, plus timer cancellation/ordering checks. Preserve the
   existing 28 WASM and 50 JS checks. **Implemented and passing natively, in
   Node WASM and actual Chrome.** Physical Safari verification is pending. A successful
   import alone is insufficient.
2. **Implement and verify the WebSocket connection adapter.** Exercise actual
   nbxmpp client event flow against a controlled synthetic peer, including bad
   subprotocol, malformed/binary/oversized frames, failed connect, interrupted
   authentication, reconnect, backpressure and late events. Disable stanza and
   SASL payload logging. Test the new path in actual browsers before requesting
   account credentials.
3. **Connect account and device orchestration.** Restore or explicitly create
   and commit the local identity before publishing its device/bundle. Retain
   Gajim's device-list merge and bundle/session behavior. Fingerprint changes,
   missing devices and unverified keys block user-content preparation; recheck
   recipient/trust coverage before transmitting previously prepared bytes.
   Expose real fingerprints before any live encrypted exchange.
4. **Verify live interoperability.** Only Notes to self or the designated npc
   account may be used. Verify both send and receive with native Monal/Gajim,
   then disconnected/reconnected continuation. Wire-level ciphertext, sender
   attribution and acknowledgement evidence must precede a usable chat claim.

Gajim's orchestrator is separately pinned at
[`5a57abb2950886dd9cb8a73972ecc2dcc59f688a`](https://github.com/gajim/gajim/blob/5a57abb2950886dd9cb8a73972ecc2dcc59f688a/src/gajim/common/modules/omemo.py).
Its native application/settings/event dependencies still need adaptation.
Native support for blind trust is not permission to enable it in this project;
the browser's explicit verification and required-OMEMO requirements remain.

The offline port does not resolve 5july transport capabilities, BOSH need,
live authentication, production trust policy or interoperability. The new
private protocol-check page can verify this increment in Safari. Historical
worker/outbox passes remain scoped to their original builds.
