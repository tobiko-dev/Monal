# Gajim browser foundation

This directory starts a **Gajim-derived browser port** inside the existing native Monal fork. It is currently an encryption feasibility experiment, not a usable chat client.

The first target is the actual `omemo-dr 1.2.0` Python/C encryption library used by Gajim. Browser compatibility code stays separate from unmodified upstream source. Later work adapts Gajim/nbxmpp messaging and device lifecycle code; a crypto library alone does not complete that port.

See the [roadmap](../ROADMAP.md) and [architecture](docs/architecture.md). Executable build and test instructions will accompany the harness.

The cancelled Converse companion is not used here. Native Monal source and build targets remain independent of this directory.
