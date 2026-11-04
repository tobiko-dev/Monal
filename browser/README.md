# Gajim browser foundation

This directory starts a **Gajim-derived browser port** inside the existing native Monal fork. It is currently an encryption feasibility experiment, not a usable chat client.

It compiles the actual `omemo-dr 1.2.0` Python/C encryption library used by Gajim and adapts Gajim's SQLite OMEMO store. Browser compatibility code stays separate from the original upstream files. Later work adapts Gajim/nbxmpp messaging and device lifecycle code; this foundation does not complete that port.

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
.venv/bin/python scripts/test-integrity.py
```

The first build downloads the pinned Pyodide cross-build environment and Emscripten SDK. It verifies the source archive, compiles a fresh unmodified source tree, checks the extension's WebAssembly header, verifies runtime assets and packages, and produces `dist/`. Compiler output is in `.build/compiler.log`. To reuse a downloaded source archive, pass `--source-archive /path/to/omemo_dr-1.2.0.tar.gz`; the same hash check still applies.

The Node WASM command must exit successfully with `platform: emscripten`, `tests: 28`, no failures/errors/skips, and `passed: true`. It also runs three synthetic encrypted exchanges through the storage adapter and a lifecycle-fixture integration check for reconstructed fixtures, lock contention and committed handoff. It executes the WebAssembly extension, not the host's native extension. `npm test` runs 30 storage/worker/failure/concurrency tests. IndexedDB is simulated in Node; neither result is an iPad/Safari pass.

The WASM runner also creates an identity through the application service, exchanges four synthetic encrypted messages, and reopens its saved state. An optional output path after `test-wasm.mjs` writes clean JSON separately from runtime progress. Incomplete execution must exit with failure.

The integrity command separately alters the generated test and adapter archives, confirms the runner rejects each before execution, and restores the original bytes even if the check fails.

## Browser check

Serve `dist/` from an **HTTPS origin**, or localhost on the same computer as the browser, and press **Run encryption checks**. The browser must provide Web Crypto, IndexedDB and Web Locks. All assets are served from that origin; no runtime CDN, XMPP account login or contact messaging is used. The worker uses a randomly named synthetic database and removes it after the storage check. It only displays test results, never snapshots or private keys. Hosting access control may have its own sign-in.

An HTTP preview at a non-localhost hostname will intentionally stop with a secure-context error. Do not disable browser security to make the test run. Physical iPad Safari remains an explicit roadmap check.

The linked **Test reloads and competing tabs** page keeps disposable synthetic
identities across page reloads. Follow [the lifecycle procedure](docs/lifecycle.md)
to check restoration, queued ownership, interrupted work and worker recovery.
Its test databases are removed with **Delete this synthetic test** after other
test tabs are closed. This page never connects to XMPP or real contacts.

**Test the application identity worker** runs an automated check of actual module workers, including interruption before commit and a lost reply after commit. The [worker API](docs/identity-worker.md) exposes public identity details only. Its disposable test data is separate from the existing lifecycle test.

## Source and licenses

No changes to upstream `omemo-dr` source or tests are applied. The build adds six crypto checks, nine storage checks, five identity bridge checks and platform adapters. Gajim's original store has three explicit compatibility substitutions, described in [storage design and limits](docs/storage.md). The generated bundle includes original source and licenses. Runtime dependencies remain in their original wheels with their notices. See [third-party provenance](THIRD_PARTY.md).

New code in this directory is GPL-3.0-only; see [LICENSE](LICENSE). This does not change the native Monal fork's licensing.
