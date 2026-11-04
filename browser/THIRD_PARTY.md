# Upstream provenance

| Component | Version | Origin and treatment |
| --- | --- | --- |
| omemo-dr | 1.2.0 | https://gitlab.com/gajim/omemo-dr ; PyPI source SHA-256 pinned in `versions.json`; unmodified C/Python source and upstream tests |
| Gajim OMEMO SQLite store | `5a57abb2950886dd9cb8a73972ecc2dcc59f688a` | Original file in `vendor/gajim`; GPL-3.0-only; pinned SHA-256; three documented compatibility substitutions during packaging |
| python-nbxmpp | 7.5.0 / `999ce8859d6d799fe8ce00a877e85b2ae554e392` | Complete unchanged Git archive in `vendor/nbxmpp`, SHA-256 pinned in `versions.json`; GPL-3.0-or-later with retained per-file notices including GPL-2.0-or-later files; 37 explicit browser patch operations across nine runtime files, three desktop transport files excluded from the runtime, upstream tests unchanged |
| precis-i18n | 1.1.2 | Original pinned wheel from PyPI; MIT license retained in the wheel; used by upstream JID/PRECIS handling |
| idna | 3.11 | Original Pyodide wheel; hash from pinned runtime lock; BSD-3-Clause notices retained in the wheel |
| Pyodide | 314.0.7 | https://github.com/pyodide/pyodide/releases/tag/314.0.7 ; original runtime assets checked against pinned hashes; MPL-2.0 license included |
| cryptography | 47.0.0 | Original Pyodide wheel and notices; hash from the pinned runtime lock file |
| protobuf | 7.34.1 | Original Pyodide wheel and notices; hash from the pinned runtime lock file |
| cffi / pycparser / six | 2.0.0 / 3.0 / 1.17.0 | Original transitive runtime wheels and notices; hashes from the pinned runtime lock file |

The generated `manifest.json` records exact files, SHA-256 values and dependency versions. `source/omemo_dr-1.2.0.tar.gz` is the corresponding unchanged source for the compiled encryption wheel; the repository supplies its build scripts. Pyodide contains CPython and additional upstream components; retain its distribution notices and complete the release licensing/dependency review before publishing an application.

`tests/inmemorystore.py` comes from the unchanged omemo-dr source release. It uses temporary SQLite and deliberately blind trust for testing. It must not become the application's storage/trust policy by accident.

Gajim's actual storage module and the offline nbxmpp protocol core are adapted into the experiment. `source/python-nbxmpp-999ce885.tar.gz` preserves the complete pinned source, including its copyright/license notices, and `source/nbxmpp-browser.patch` records the generated adaptations. The package's COPYING is also distributed separately. Network transport and Gajim messaging/device orchestration remain pending. No full Gajim-port or live Monal-interoperability claim is made. The [storage document](docs/storage.md) and [protocol document](docs/nbxmpp-port.md) record patch boundaries and remaining work.

`fake-indexeddb 6.2.7` (Apache-2.0) is a pinned development-only dependency for Node tests. It is not included in the browser runtime. Browser tests use the browser's actual IndexedDB.
