"""Prove the actual WASM runner refuses altered test input before execution."""

from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
fixture = root / "dist" / "checks.zip"
original = fixture.read_bytes()
try:
    fixture.write_bytes(original + b"altered")
    result = subprocess.run(
        ["node", str(root / "scripts" / "test-wasm.mjs")],
        capture_output=True, text=True, timeout=60,
    )
    if result.returncode == 0 or "Integrity check failed: checks.zip" not in result.stderr:
        raise AssertionError("The runner did not reject the altered fixture at its integrity boundary")
finally:
    fixture.write_bytes(original)

print("PASS: altered test archive rejected; original bytes restored")
