"""Prove source preparation and WASM loaders reject altered artifacts."""

from pathlib import Path
import json
import subprocess
from prepare_nbxmpp import source_files

root = Path(__file__).resolve().parents[1]
pins = json.loads((root / "versions.json").read_text())
cases = [(name, "test-wasm.mjs") for name in ("checks.zip", "port.zip")]
cases += [(name, "test-protocol-wasm.mjs") for name in (
    "nbxmpp.zip", "protocol-checks.zip", pins["precis_i18n"]["filename"],
)]
for name, runner in cases:
    fixture = root / "dist" / name
    original = fixture.read_bytes()
    try:
        fixture.write_bytes(original + b"altered")
        result = subprocess.run(
            ["node", str(root / "scripts" / runner)],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode == 0 or f"Integrity check failed: {name}" not in result.stderr:
            raise AssertionError("The runner did not reject the altered artifact at its integrity boundary")
    finally:
        fixture.write_bytes(original)
    print(f"PASS: altered {name} rejected; original bytes restored")

fixture = root / "vendor/nbxmpp" / pins["nbxmpp"]["archive"]
original = fixture.read_bytes()
try:
    fixture.write_bytes(original + b"altered")
    try:
        source_files()
    except RuntimeError as error:
        if str(error) != "nbxmpp source archive hash mismatch":
            raise
    else:
        raise AssertionError("Altered nbxmpp source was accepted")
finally:
    fixture.write_bytes(original)
print("PASS: altered nbxmpp source rejected before adaptation; original bytes restored")
