# Foundation validation — 2026-11-04

## Demonstrated

- Built the unchanged omemo-dr 1.2.0 C extension as `cp314-cp314-pyemscripten_2026_0_wasm32` and checked its actual WebAssembly magic bytes.
- Ran 8 unchanged upstream tests, 6 crypto checks and 9 Gajim storage checks in Pyodide 314.0.7, hosted by Node 24.22.1. **23 passed, 0 failed, 0 errors, 0 skipped.** [Current raw result](evidence/node-wasm-storage.json); [earlier 14-test M1 result](evidence/node-wasm.json).
- The nine storage checks also passed on native Python. They retain the device identity, prekeys, peer trust and working ratchets after reconstructing the stores/session managers; corrupt, missing, mismatched and unsupported snapshots are rejected.
- Passed all **16** JS repository tests against simulated IndexedDB and Node Web Locks, including quota/denied storage, concurrent writers, stale revisions, identity replacement attempts, lock timeout and an abort after the write request succeeds.
- Completed **three encrypted exchanges** through WASM, the adapted Gajim store and the JS repository with reconstructed objects. These combined checks use synthetic identities and explicit synthetic trust; no XMPP transport exists yet.
- Repeated all **23 WASM tests and three encrypted exchanges in actual Chrome 155 on Linux**, served over private HTTPS. Real browser IndexedDB and Web Locks were used. Zero failures/errors/skips; the device identities remained consistent through reconstructed stores/managers. [Raw browser result](evidence/chrome-browser.json).
- Verified actual Chrome page reload, tab close/reopen, competing-tab handoff after owner commit or uncommitted closure, and worker termination/restart. The same identities and continued encrypted sessions survived every completed exchange; recorded revisions distinguish committed changes from discarded working copies. [Procedure and revision table](lifecycle.md), [raw captures](evidence/chrome-lifecycle.json).
- Confirmed Python 3.14.2, cryptography 47.0.0, protobuf 7.34.1 and the loaded WASM curve-module path in the test result.
- Source archive, runtime files and runtime package hashes are checked before packaging. The crypto source remains unchanged. Gajim's original SQLite file is hash-checked, then adapted with three explicit substitutions recorded in [the storage patch ledger](storage.md).
- Fresh local builds and [the M1 GitHub Actions run](https://github.com/tobiko-dev/Monal/actions/runs/41624574387) produced the identical wheel SHA-256: `e3df1e9853a938f1d62ba9e4fce4d27fc82b003be6bcbf4c6c20999b12ebe9df`. The M2 local build retains that hash; storage code is packaged separately.
- The actual runner rejects altered `checks.zip` and `port.zip` archives at their hash-check boundary, restoring the originals afterwards.
- The generated harness is about 16.5 MB before transfer compression; the runtime and dependencies account for about 16.2 MB. This is asset size, not memory usage.
- One Node observation: runtime startup 1.75 seconds; package loading plus checks 1.77 seconds; the 14 tests themselves 0.75 seconds. These are observations in this Linux environment, not iPad performance estimates.

## Actual browser verification and device limits

The authenticated HTTPS harness at `https://gajim-browser-qa.strongcaterpillar.chatgpt.site/` passed in the actual cloud Chrome browser. It served source commit `bc23461062b7f571a2da915154bfc5b5ed9b3656`, packaged as QA source commit `5ed48711654197b2b450318ceebcfeb911eff545`. Browser wheel, adapter-archive and source hashes match the Node/CI evidence. No browser security setting or application code was changed to obtain this pass.

One observation: 4.10 seconds runtime startup, 3.30 seconds package loading plus Python checks, and 1.09 seconds for those 23 tests themselves. The report's elapsed time excludes the subsequent storage integration fixture. These are cloud Chrome observations, not iPad estimates; memory usage was not measured.

![Actual Chrome browser reports 23 tests passed](evidence/chrome-browser-pass.jpg)

The earlier HTTP preview at `http://terminal.local:4173/` stopped at the secure-context check. Moving this synthetic harness to private HTTPS resolved that environment limitation. The [earlier screenshot](evidence/secure-context-check-1793703790137.jpg) remains historical evidence.

The separate lifecycle harness retains synthetic data across visits until its explicit cleanup. Its actual Chrome run used source `3551c4d304f5be2fd0ac690d2878bafe1dbac771`, packaged as QA source `1403adae7a5b88cd40cd28a458144863ffb5b858`. Reload and close/reopen preserved saved identities and session state. One held/one pending lock was observed before both committed handoff and a repeated uncommitted owner closure. Worker termination before commit also preserved the prior revision, and a fresh worker decrypted subsequent messages. [Full lifecycle evidence and limitations](lifecycle.md).

The physical iPad Safari reports below cover selected lifecycle scenarios, including user-reported lock/unlock and Safari relaunch continuation. A separate reload, queued handoff after owner commit, process crash during active work, storage eviction and confirmed OS suspension remain pending. The 16 fault-injection/concurrency tests still have Node evidence only. The [lifecycle source CI run](https://github.com/tobiko-dev/Monal/actions/runs/41777981708) passed its fresh build, all 16 JS and 23 WASM tests, both integration fixtures and altered-archive rejection.

## User-reported physical iPad Safari results

The user supplied two successful Safari 26.6 baseline reports and lifecycle
reports; [selected fields and transcribed events](evidence/safari-user-reported.json)
retain their provenance. Both baselines pass all 23 tests with zero failures,
errors or skips, plus three encrypted exchanges through actual browser storage.
The crypto wheel and adapter hashes match the tested Chrome/CI artifacts.

The lifecycle report loads an existing fixture at Alice/Bob revisions 3/3,
exchanges to 5/5 and 7/7, then commits a held Alice change to 8/7. A subsequent
bidirectional exchange succeeds at 10/9. Both identities remain unchanged.
The unequal revisions are expected: the held operation advances only Alice.
The two initial queue inspections show an idle queue. Subsequent reports show
the owner holding an uncommitted Alice change at revision 10 and a second tab
receiving `STORAGE_BUSY` during inspection, then passing the competing-owner
check without stealing the lock. In response to the directed owner-close test,
the user supplied a successful exchange from 10/9 to 12/11 with unchanged
identities. This matches recovery from the last committed state; the held
working-copy change was not persisted. This is user-reported owner-close
evidence, not an independently controlled Safari run. No owner queue snapshot
showing one held/one pending lock was supplied.

In response to instructions to save the full test URL, close the remaining tab,
reopen that URL and resume, the user supplied a fresh runtime report for the same
run. Its startup inspection restores 12/11 with unchanged identities, followed
by two successful encrypted exchanges reaching 14/13. This is recorded as
user-reported continuation after the directed close/reopen test; the report
does not independently instrument the navigation action.

In response to instructions to switch apps, lock the iPad for about a minute,
unlock it and resume in Safari, the user supplied the same run's event history
with one further successful bidirectional exchange from 14/13 to 16/15. Both
identities remain unchanged and the artifact hashes match. This is recorded as
user-reported continuation after app switching and lock/unlock. No new runtime
event or suspension instrumentation is present; the report does not establish
whether iPadOS suspended or terminated the browser or worker.

In response to instructions to dismiss Safari in the iPad app switcher, reopen
Safari and resume the same run, the user supplied a fresh runtime report. Its
startup inspection restores 16/15, followed by two successful encrypted
exchanges reaching 18/17. Identities and artifact hashes remain unchanged.
This is recorded as user-reported Safari app relaunch recovery while no
operation was deliberately held. The report does not independently establish
which WebKit processes terminated or exercise interruption during a write.

Queued handoff after an owner commit, a separate explicit reload, confirmed
OS suspension and process-crash recovery during active work remain open.

Reported startup values are 68,848 ms and 37,989 ms; the separate elapsed fields
are 184,792 ms and 2,900 ms. Python tests themselves take 0.365 and 0.366 seconds.
These phases must not be presented as a single complete launch measurement.
Network and cache effects were not isolated, and memory use was not measured.

## Build issues resolved

1. The SDK's archive extraction initially tried to restore ownership IDs unsupported by the container. Build-time `TAR_OPTIONS=--no-same-owner` fixed this without changing compiler or crypto source.
2. A compiler wrapper selected the host's default Python 3.12 while using the Python 3.14 build environment. The build script now puts its own environment's binary directory first on PATH.
3. Command-line Git had read access but no push credentials. The branch is synchronized through the connected GitHub integration.

## Not implemented or proved

The snapshot store and per-operation concurrency adapter are implemented and tested as described above. The demonstrated Chrome lifecycle checks do not complete the physical Safari gates or the production worker boundary. There is no fingerprint-verification UI, XMPP account authentication, 5july connection, Gajim/nbxmpp messaging integration, durable outbox, history, attachments, conversation UI or production security review. The M1 fixture's blind trust is test-only; the adapted Gajim store disables it.

No XMPP account login or real contact message was used. A library returning no ciphertext for an unknown or unverified peer is tested; app-wide enforcement of required OMEMO belongs to M3 and is not claimed here. Local identity bytes are not encrypted at rest by this increment. Prepared ciphertext and ratchet state still need a shared durable outbox transaction before a network send is implemented.
