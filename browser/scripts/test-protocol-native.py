"""Run the same protocol checks on a native Python with omemo-dr 1.2.0 installed."""

import asyncio
import json
from pathlib import Path
import sys
import tempfile
import zipfile
from importlib.metadata import version

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
manifest = json.loads((DIST / "manifest.json").read_text())
if version("omemo-dr") != "1.2.0":
    raise RuntimeError("Install the pinned native omemo-dr 1.2.0 first")
with tempfile.TemporaryDirectory(prefix="nbxmpp-native-") as temporary:
    for name in ("port.zip", "nbxmpp.zip", "protocol-checks.zip", manifest["precis_i18n"]["filename"]):
        with zipfile.ZipFile(DIST / name) as archive:
            archive.extractall(temporary)
    idna = json.loads((DIST / "runtime/pyodide-lock.json").read_text())["packages"]["idna"]["file_name"]
    with zipfile.ZipFile(DIST / "runtime" / idna) as archive:
        archive.extractall(temporary)
    sys.path.insert(0, temporary)
    from browser_protocol_tests.runner import run
    report = asyncio.run(run())
    report["nbxmpp_source"] = manifest["nbxmpp"]
    report["environment"] = "Native Python/Linux; not a browser pass"
    report["passed"] &= (report["upstream"]["tests"] == manifest["expected_protocol_upstream_tests"] and
                         report["browser_adaptation"]["tests"] == manifest["expected_protocol_adaptation_tests"] and
                         len(report["async_integration"]["checks"]) == manifest["expected_protocol_async_checks"])
    text = json.dumps(report, indent=2) + "\n"
    if len(sys.argv) > 1:
        Path(sys.argv[1]).write_text(text)
    print(text)
    if not report["passed"]:
        raise SystemExit(1)
