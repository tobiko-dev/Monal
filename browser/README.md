# Gajim browser foundation

This directory starts a **Gajim-derived browser port** inside the existing native Monal fork. It is currently an encryption feasibility experiment, not a usable chat client.

The first target is the actual `omemo-dr 1.2.0` Python/C encryption library used by Gajim. Browser compatibility code stays separate from unmodified upstream source. Later work adapts Gajim/nbxmpp messaging and device lifecycle code; a crypto library alone does not complete that port.

See the [roadmap](../ROADMAP.md), [architecture](docs/architecture.md) and [validation record](docs/validation.md).

The cancelled Converse companion is not used here. Native Monal source and build targets remain independent of this directory.

## Build and test

On Linux or macOS, use Python 3.14 and Node 24. The verified host used Python 3.14.8 and Node 24.22.1. Run from this directory:

```sh
python3.14 -m venv .venv
.venv/bin/python -m pip install -r requirements-build.txt
.venv/bin/python scripts/build.py
node scripts/test-wasm.mjs
.venv/bin/python scripts/test-integrity.py
```

The first build downloads the pinned Pyodide cross-build environment and Emscripten SDK. It verifies the source archive, compiles a fresh unmodified source tree, checks the extension's WebAssembly header, verifies runtime assets and packages, and produces `dist/`. Compiler output is in `.build/compiler.log`. To reuse a downloaded source archive, pass `--source-archive /path/to/omemo_dr-1.2.0.tar.gz`; the same hash check still applies.

The Node command must exit successfully with `platform: emscripten`, `tests: 14`, no failures/errors/skips, and `passed: true`. It executes the WebAssembly extension, not the host's native extension. This is not an iPad/Safari pass.

The integrity command temporarily alters the generated test archive, confirms the runner rejects it before execution, and restores the original bytes even if the check fails.

## Browser check

Serve `dist/` from an **HTTPS origin**, or localhost on the same computer as the browser, and press **Run encryption checks**. The browser must treat the origin as secure and provide Web Crypto. All assets are served from that origin; no runtime CDN, account login, XMPP connection or persistent key storage is used. The test runs in a worker and only shows synthetic test results.

An HTTP preview at a non-localhost hostname will intentionally stop with a secure-context error. Do not disable browser security to make the test run. Physical iPad Safari remains an explicit roadmap check.

## Source and licenses

No changes to upstream `omemo-dr` source or tests are applied. The build adds six separate compatibility checks and platform-loading code. The generated bundle includes the original source archive and its license. Runtime dependencies remain in their original wheels with their notices. See [third-party provenance](THIRD_PARTY.md).

New code in this directory is GPL-3.0-only; see [LICENSE](LICENSE). This does not change the native Monal fork's licensing.
