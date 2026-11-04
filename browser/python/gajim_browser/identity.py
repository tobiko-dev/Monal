"""Identity-only worker bridge. No trust decisions, reset or messaging API."""

import base64
import json

from omemo_dr.session_manager import OMEMOSessionManager
from omemo_dr.structs import OMEMOConfig

from .storage import InvalidSnapshot, SnapshotStorage

# Gajim common/modules/omemo.py at the pinned 5a57abb2 commit.
CONFIG = OMEMOConfig(
    default_prekey_amount=100,
    min_prekey_amount=80,
    spk_archive_seconds=86400 * 15,
    spk_cycle_seconds=86400 * 30,
    unacknowledged_count=2000,
)


def create_identity(account):
    store = SnapshotStorage.create_new(account)
    try:
        OMEMOSessionManager(account, store, CONFIG)
        return {"snapshot": store.export_snapshot(), "identity": store.descriptor()}
    finally:
        store.close()


def inspect_identity(account, snapshot, expected_identity):
    store = SnapshotStorage.open_existing(account, snapshot)
    try:
        identity = store.descriptor()
        if identity != expected_identity:
            raise InvalidSnapshot("Snapshot identity does not match its record")
        return identity
    finally:
        store.close()


def step(request_json):
    """Called only inside the worker; private snapshot bytes never leave it."""
    request = json.loads(request_json)
    try:
        if request["action"] == "create":
            result = create_identity(request["account"])
            result["snapshot"] = base64.b64encode(result["snapshot"]).decode()
        elif request["action"] == "open":
            result = {"identity": inspect_identity(
                request["account"], base64.b64decode(request["snapshot"], validate=True),
                request["identity"],
            )}
        else:
            return json.dumps({"error": "INVALID_REQUEST"})
        return json.dumps(result)
    except InvalidSnapshot:
        return json.dumps({"error": "CORRUPT_STATE"})
    except Exception:
        # Never return database rows, private material or Python tracebacks.
        return json.dumps({"error": "CRYPTO_FAILED"})
