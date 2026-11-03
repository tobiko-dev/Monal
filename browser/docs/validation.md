# Foundation validation — 2026-11-03

## Demonstrated

- Built the unchanged omemo-dr 1.2.0 C extension as `cp314-cp314-pyemscripten_2026_0_wasm32` and checked its actual WebAssembly magic bytes.
- Ran 8 unchanged upstream tests and 6 separate compatibility/security-negative checks in Pyodide 314.0.7, hosted by Node 24.22.1. **14 passed, 0 failed, 0 errors, 0 skipped.** [Raw result](evidence/node-wasm.json).
- The added checks also passed on the native baseline before running WebAssembly.
- Confirmed Python 3.14.2, cryptography 47.0.0, protobuf 7.34.1 and the loaded WASM curve-module path in the test result.
- Source archive, runtime files and runtime package hashes are checked before packaging. Upstream code patches: none.
- Two fresh builds with the pinned toolchain produced the identical wheel SHA-256: `e3df1e9853a938f1d62ba9e4fce4d27fc82b003be6bcbf4c6c20999b12ebe9df`. This demonstrates repeatability in this build environment; cross-environment reproduction is a CI check to observe separately.
- The actual runner rejected an altered `checks.zip` at its hash-check boundary; the test restored the original generated archive afterwards.
- The generated harness is about 16.5 MB before transfer compression; the runtime and dependencies account for about 16.2 MB. This is asset size, not memory usage.
- One Node observation: runtime startup 1.75 seconds; package loading plus checks 1.77 seconds; the 14 tests themselves 0.75 seconds. These are observations in this Linux environment, not iPad performance estimates.

## Browser and device limits

The actual Chrome preview opened the harness, and pressing Run reached its explicit secure-context check. The provided preview uses `http://terminal.local:4173/`, which does not provide the required secure Web Crypto context. The worker therefore stopped before running the tests. No browser encryption pass is claimed, and browser security was not disabled.

An HTTPS browser run, actual iPad Safari, startup/memory measurements on that device and its background/resume behavior remain pending. The Node WebAssembly result is useful evidence of runtime/ABI compatibility, not a substitute for those checks.

![Observed secure-context check in the HTTP browser preview](evidence/secure-context-check-1793703790137.jpg)

## Build issues resolved

1. The SDK's archive extraction initially tried to restore ownership IDs unsupported by the container. Build-time `TAR_OPTIONS=--no-same-owner` fixed this without changing compiler or crypto source.
2. A compiler wrapper selected the host's default Python 3.12 while using the Python 3.14 build environment. The build script now puts its own environment's binary directory first on PATH.
3. Command-line Git had read access but no push credentials. The branch is synchronized through the connected GitHub integration.

## Not implemented or proved

No persistent browser identity/session store, tab coordination, verified fingerprint policy, account authentication, 5july connection, Gajim/nbxmpp integration, durable outbox, history, attachments, conversation UI or production security review. The fixture's blind trust is test-only.

No account login or real contact message was used. A library returning no ciphertext for an unknown peer is tested; app-wide enforcement of required OMEMO belongs to M3 and is not claimed here.
