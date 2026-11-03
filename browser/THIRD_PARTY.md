# Upstream provenance

| Component | Version | Origin and treatment |
| --- | --- | --- |
| omemo-dr | 1.2.0 | https://gitlab.com/gajim/omemo-dr ; PyPI source SHA-256 pinned in `versions.json`; unmodified C/Python source and upstream tests |
| Pyodide | 314.0.7 | https://github.com/pyodide/pyodide/releases/tag/314.0.7 ; original runtime assets checked against pinned hashes; MPL-2.0 license included |
| cryptography | 47.0.0 | Original Pyodide wheel and notices; hash from the pinned runtime lock file |
| protobuf | 7.34.1 | Original Pyodide wheel and notices; hash from the pinned runtime lock file |
| cffi / pycparser / six | 2.0.0 / 3.0 / 1.17.0 | Original transitive runtime wheels and notices; hashes from the pinned runtime lock file |

The generated `manifest.json` records exact files, SHA-256 values and dependency versions. `source/omemo_dr-1.2.0.tar.gz` is the corresponding unchanged source for the compiled encryption wheel; the repository supplies its build scripts. Pyodide contains CPython and additional upstream components; retain its distribution notices and complete the release licensing/dependency review before publishing an application.

`tests/inmemorystore.py` comes from the unchanged omemo-dr source release. It uses temporary SQLite and deliberately blind trust for testing. It must not become the application's storage/trust policy by accident.

Gajim and nbxmpp application modules have been reviewed at the pins in [architecture](docs/architecture.md), but are **not yet integrated** into this experiment. No full Gajim-port or live Monal-interoperability claim is made.
