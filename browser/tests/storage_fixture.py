"""Synthetic bridge for the storage harness. Never use as a messaging API.

All trust decisions here are explicit for locally generated test identities.
The fixture carries snapshots in memory; reports never contain those bytes.
"""

import base64
import json
from dataclasses import asdict

from omemo_dr.const import NS_OMEMO_TMP, OMEMOTrust
from omemo_dr.identitykey import IdentityKey
from omemo_dr.session_manager import OMEMOSessionManager
from omemo_dr.structs import OMEMOBundle, OMEMOConfig, OMEMOMessage
from gajim_browser.storage import SnapshotStorage

CONFIG = OMEMOConfig(20, 10, 86400 * 15, 86400, 2000)


def encode(value):
    if isinstance(value, bytes):
        return {"bytes": base64.b64encode(value).decode()}
    if isinstance(value, dict):
        return {str(key): encode(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [encode(item) for item in value]
    return value


def decode(value):
    if isinstance(value, dict):
        if set(value) == {"bytes"}:
            return base64.b64decode(value["bytes"], validate=True)
        return {key: decode(item) for key, item in value.items()}
    if isinstance(value, list):
        return [decode(item) for item in value]
    return value


def step(request_json):
    request = json.loads(request_json)
    account = request["account"]
    if account not in ("synthetic-alice", "synthetic-bob"):
        raise ValueError("Only synthetic fixture identities are allowed")
    action = request["action"]
    store = (SnapshotStorage.create_new(account) if action == "provision" else
             SnapshotStorage.open_existing(account, base64.b64decode(request["snapshot"], validate=True)))
    try:
        if action != "provision" and store.descriptor() != request["identity"]:
            raise ValueError("Snapshot identity does not match its record")
        manager = OMEMOSessionManager(account, store, CONFIG)
        if action == "provision":
            result = encode(asdict(manager.get_bundle(NS_OMEMO_TMP)))
        elif action == "send":
            peer = request["peer"]
            if "bundle" in request:
                bundle = OMEMOBundle(**decode(request["bundle"]))
                manager.update_devicelist(peer, [bundle.device_id])
                manager.build_session(peer, bundle)
                store.set_trust(peer, IdentityKey(bundle.ik), OMEMOTrust.VERIFIED)
            message = manager.encrypt(peer, request.get("text", "Synthetic persisted message"), groupchat=False)
            if message is None:
                raise ValueError("Fixture could not encrypt")
            result = encode(asdict(message))
        elif action == "receive":
            message = decode(request["message"])
            message["keys"] = {int(key): tuple(value) for key, value in message["keys"].items()}
            plaintext, _, _ = manager.decrypt_message(OMEMOMessage(**message), request["peer"])
            if plaintext != request.get("text", "Synthetic persisted message"):
                raise ValueError("Fixture plaintext mismatch")
            # The harness supplies the known test peer's public identity.
            peer_bundle = OMEMOBundle(**decode(request["bundle"]))
            store.set_trust(request["peer"], IdentityKey(peer_bundle.ik), OMEMOTrust.VERIFIED)
            result = {"decrypted": True}
        else:
            raise ValueError("Unknown fixture operation")
        return json.dumps({
            "snapshot": base64.b64encode(store.export_snapshot()).decode(),
            "identity": store.descriptor(), "result": result,
        })
    finally:
        store.close()
