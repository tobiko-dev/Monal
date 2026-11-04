"""Adapt the pinned Gajim store without changing its database or ratchet logic."""

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATCHES = (
    ("from gajim.common import app\n", ""),
    ("from gajim.common.modules.util import LogAdapter", "from logging import LoggerAdapter as LogAdapter"),
    ('return app.settings.get_account_setting(self._account, "omemo_blind_trust")',
     "return False  # Browser port: verification is explicit; never blind trust."),
)


def files():
    pin = json.loads((ROOT / "versions.json").read_text())["gajim_storage"]
    raw = (ROOT / "vendor/gajim/omemo_storage.py").read_bytes()
    if hashlib.sha256(raw).hexdigest() != pin["sha256"]:
        raise RuntimeError("Gajim storage source does not match the pinned hash")
    source = raw.decode()
    for before, after in PATCHES:
        if source.count(before) != 1:
            raise RuntimeError("Gajim compatibility patch no longer applies uniquely")
        source = source.replace(before, after)
    yield "gajim_browser/_upstream_storage.py", source.encode()
    for path in sorted((ROOT / "python").rglob("*.py")):
        yield path.relative_to(ROOT / "python").as_posix(), path.read_bytes()


if __name__ == "__main__":
    target = ROOT / ".build/port"
    for name, data in files():
        output = target / name
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(data)
    print(target)
