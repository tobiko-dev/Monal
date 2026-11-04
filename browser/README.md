# Gajim browser foundation

This directory implements the foundation of a **Gajim-derived browser port** inside the existing native Monal fork. It has encryption, durable identity/outbox storage and nbxmpp protocol/WebSocket adapters. It is not yet a usable chat client.

It compiles the actual `omemo-dr 1.2.0` Python/C encryption library used by Gajim, adapts Gajim's SQLite OMEMO store and packages hash-pinned nbxmpp source with explicit runtime patches. Browser compatibility code stays separate from the original upstream files. The WSS adapter is tested against a controlled synthetic peer; Gajim's device/trust orchestration and the live 5july connection remain pending.

See the [roadmap](../ROADMAP.md), [architecture](docs/architecture.md) and [validation record](docs/validation.md).

The cancelled Converse companion is not used here. Native Monal source and build targets remain independent of this directory.

## Build and test

On Linux or macOS, use Python 3.14 and Node 24. The verified host used Python 3.14.8 and Node 24.22.1. Run from this directory:

```sh
python3.14 -m venv .venv
.venv/bin/python -m pip install -r requirements-build.txt
.venv/bin/python scripts/build.py
npm ci --ignore-scripts --no-audit --no-fund
npm test
node scripts/test-wasm.mjs
node scripts/test-protocol-wasm.mjs
node scripts/test-transport-wasm.mjs
.venv/bin/python scripts/test-integrity.py
```

The first build downloads the pinned Pyodide cross-build environment and Emscripten SDK. It verifies the source archive, compiles a fresh unmodified source tree, checks the extension's WebAssembly header, verifies runtime assets and packages, and produces `dist/`. Compiler output is in `.build/compiler.log`. To reuse a downloaded source archive, pass `--source-archive /path/to/omemo_dr-1.2.0.tar.gz`; the same hash check still applies.

The Node WASM command must exit successfully with `platform: emscripten`, `tests: 28`, no failures/errors/skips, and `passed: true`. It also runs three synthetic encrypted exchanges through the storage adapter and a lifecycle-fixture integration check for reconstructed fixtures, lock contention and committed handoff. It executes the WebAssembly extension, not the host's native extension. `npm test` runs 63 storage/worker/outbox/socket tests. IndexedDB is simulated in Node; neither result is an iPad/Safari pass.

The WASM runner also creates an identity through the application service, exchanges four synthetic encrypted messages, and reopens its saved state. An optional output path after `test-wasm.mjs` writes clean JSON separately from runtime progress. Incomplete execution must exit with failure.

It also runs seven [durable outbox checks](docs/outbox.md) with actual Gajim WASM crypto, including a forced late write abort, successful retry/decryption and reuse of committed ciphertext after a discarded reply. No network dispatcher is enabled.

The protocol command must pass 128 unchanged upstream tests, 20 adapter/security tests and eight timer checks. It exercises actual nbxmpp XML and encrypted round trips, SCRAM vectors, XML attack rejection, strict address decoding, client disposal and IQ cancellation. These offline checks do not configure a network transport. An optional output path writes the JSON report. Native comparison can use `scripts/test-protocol-native.py` in an environment with `omemo-dr 1.2.0` installed.

The integrity command alters six generated test/adapter/dependency archives and the original nbxmpp source archive, confirms rejection at the corresponding loader/preparation boundary, and restores original bytes even if a check fails. Hash checks detect inconsistent artifacts; they do not protect against a compromised origin replacing both code and hashes.

## Browser check

Serve `dist/` from an **HTTPS origin**, or localhost on the same computer as the browser, and press **Run encryption checks**. The browser must provide Web Crypto, IndexedDB and Web Locks. All assets are served from that origin; no runtime CDN, XMPP account login or contact messaging is used. The worker uses a randomly named synthetic database and removes it after the storage check. It only displays test results, never snapshots or private keys. Hosting access control may have its own sign-in.

An HTTP preview at a non-localhost hostname will intentionally stop with a secure-context error. Do not disable browser security to make the test run. Physical iPad Safari remains an explicit roadmap check.

The linked **Test reloads and competing tabs** page keeps disposable synthetic
identities across page reloads. Follow [the lifecycle procedure](docs/lifecycle.md)
to check restoration, queued ownership, interrupted work and worker recovery.
Its test databases are removed with **Delete this synthetic test** after other
test tabs are closed. This page never connects to XMPP or real contacts.

**Test the application identity worker** runs an automated check of actual module workers, including interruption before commit and a lost reply after commit. The [worker API](docs/identity-worker.md) exposes public identity details only. Its disposable test data is separate from the existing lifecycle test.

**Test the durable send queue** runs the shared outbox checks with actual browser IndexedDB/Web Locks in a dedicated worker. It deletes its disposable database after completion. It reconstructs storage objects; a pass is not a process-crash or live-XMPP test.

**Test the Gajim protocol core** runs the 28-test encryption baseline, then the same 128 upstream, 20 adapter and eight asynchronous protocol checks in a real browser worker. Its temporary identities are discarded when the worker finishes. Physical Safari verification for this new boundary is separate from the earlier worker/outbox passes.

**WebSocket connection checks** uses the actual browser WebSocket and upstream nbxmpp against the private site’s scripted synthetic server. Expect 18 checks. It tests authentication, binding, IQ replies, close/reconnect, malformed inputs, rejected authentication, logging and bounds. It cannot sign into 5july or send contact messages. See [the transport boundary](docs/transport.md).

The Node transport runner starts a local HTTPS/WebSocket peer and trusts its disposable test certificate through `NODE_EXTRA_CA_CERTS`; it never disables TLS validation. OpenSSL is required. The peer and certificate files are removed after the run.

## Source and licenses

No changes to upstream `omemo-dr` source or tests are applied. The build adds six crypto checks, nine storage checks, five identity bridge checks and platform adapters. Gajim's original store has three explicit compatibility substitutions, described in [storage design and limits](docs/storage.md). The [nbxmpp port](docs/nbxmpp-port.md) retains upstream tests unchanged and records every runtime patch. The generated bundle includes original source, a protocol patch and licenses. Runtime dependencies remain in their original wheels with their notices. See [third-party provenance](THIRD_PARTY.md).

New code in this directory is GPL-3.0-only; see [LICENSE](LICENSE). This does not change the native Monal fork's licensing.
