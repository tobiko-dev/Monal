# Browser WebSocket boundary

The pinned nbxmpp client now uses a small, explicitly configured browser socket
adapter. Its upstream state machine still performs stream negotiation, SCRAM,
resource binding, parsing, IQ callbacks and graceful disconnect. No replacement
XMPP client was introduced. The actual Gajim encryption library is unchanged.

`nbxmpp_connection.configure_client` installs exactly one WSS endpoint and an
explicit socket factory. An unconfigured client cannot connect. Changed domain,
endpoint, protocol, authentication or desktop TLS/proxy settings fail before
connection. Only SCRAM-SHA-256/512 are allowed; PLAIN, STARTTLS, raw TCP and
automatic endpoint fallback are unavailable. The browser validates WSS TLS;
certificate/cipher details and channel-binding data are unavailable and are
reported as such. Endpoint discovery and the real 5july configuration remain work.

`platform/xmpp-websocket.mjs` transfers text only after the server negotiates
`xmpp`. It rejects binary frames and frames exceeding 1 MiB in UTF-8. Writes
that would exceed 2 MiB of browser buffering are refused without queuing an
implicit retry. Python's pending receive callbacks are capped at 128 events and
2 MiB; overflow terminates the connection. Browser networking may buffer data
internally before JavaScript receives it; these are application bounds, not a
claim about the browser process's total memory usage.

Socket opening has a 15-second deadline, followed by a configurable negotiation
deadline no longer than 30 seconds. Events enter the Python event loop
asynchronously. Disposal cancels timers, listeners, callbacks and the Python
proxy so an old connection cannot reach its replacement. Stanza and SASL logs
are disabled; diagnostic failures use fixed codes, not peer text or exception
locals. The configured worker is dedicated to this account/protocol work.

Transport acceptance means only that the browser queued bytes. It is never a
sent/delivered/read receipt. A refused IQ write removes its reply callback and
does not enter nbxmpp's stream-management queue. Integrating the durable outbox,
server acknowledgements and delivery reconciliation is still required.

## Source boundary

The build retains the pinned upstream source archive and unchanged protocol
tests. The full patch ledger now has 40 operations across nine files. The client
factory delegates to the browser adapter, connection entry validates explicit
configuration, the existing `is_stream_secure` property recognizes direct WSS
when retaining a successful endpoint, refused writes remove IQ callbacks, and
client destruction disposes the active connection. This extends the earlier
offline boundary; it does not modify upstream encryption primitives.

See [generated patch](evidence/nbxmpp-transport.patch) and
[adaptation manifest](evidence/nbxmpp-transport-adaptation.json).

## Verification

- 13 JS socket checks exercise negotiation, text/binary handling, byte bounds,
  backpressure, opening timeout, half-close, disposal and late callbacks.
- Four Python configuration/queue guards exercise unsafe or altered policy,
  refused-write cleanup and bounded receive callbacks with a synthetic socket.
- Fourteen integration checks run actual nbxmpp in WebAssembly over native
  WebSocket/TLS against the scripted peer: SCRAM proof/server signature,
  restart/binding, IQ reply, reconnect/disposal, wrong subprotocol/domain,
  malformed/entity/binary/oversized input, rejected/interrupted/stalled
  authentication and no protocol logging or leftover nbxmpp timers.

[Node TLS result](evidence/node-wasm-transport.json) reports all 18 Python checks.
The same 18 checks also pass in actual Chrome 155 over private HTTPS, with matching
artifact hashes: [browser result](evidence/chrome-transport.json). The user also
reports all 18 passing on physical iPad Safari with matching hashes and no
remaining timers: [Safari summary](evidence/safari-protocol-transport-user-reported.json).
These controlled-peer checks do not establish real 5july interoperability.

The fixture accepts only `synthetic@example.invalid` with a public fixed test
password. It recognizes only the scripted handshake, bind, ping and close
messages; it does not accept user messages, persist account data, connect to
5july or relay to contacts. Work, frames, connection duration and concurrent
hosted sessions are bounded. The hosted Worker requires a same-origin WebSocket
request and inherits the existing owner-private Site access policy. The local
runner creates a disposable TLS certificate and trusts that CA explicitly,
without turning certificate checks off.

## Remaining gates

The user has completed both `/transport` and `/protocol` on iPad Safari.
Their results are scoped to the hashes in the report; no repeat is requested
for the already tested build.

Next adapt Gajim's device/bundle/trust orchestration around the committed local
identity. Required-OMEMO enforcement must cover all user-content paths before
any dispatcher is enabled. Expose actual fingerprints, block changed/unverified
devices, and recheck prepared work before sending. Then verify a real 5july
connection and bidirectional native-client interoperability using only Notes to
self or the designated npc account. Stream-management network recovery,
suspension, durable send reconciliation and message attribution remain gates.

Protocol references: [RFC 7395](https://www.rfc-editor.org/rfc/rfc7395.html),
[WebSocket API](https://websockets.spec.whatwg.org/),
[Workers WebSockets](https://developers.cloudflare.com/workers/runtime-apis/websockets/).
