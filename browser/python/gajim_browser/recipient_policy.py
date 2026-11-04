"""Strict one-to-one recipient guards around Gajim's actual store/OMEMO engine.

This is a local, side-effect-free preparation boundary, not a network coordinator.
The caller must supply complete, current device lists from authenticated discovery
and commit the returned snapshot with the outbox before sending any ciphertext.
Never infer a successful empty device list from a failed request. Every operation
opens a disposable working copy; a failure returns no snapshot or ciphertext.
"""

from dataclasses import dataclass, field
import hmac

from nbxmpp.protocol import JID
from omemo_dr.const import OMEMOTrust
from omemo_dr.session_manager import OMEMOSessionManager
from omemo_dr.structs import OMEMOMessage

from .identity import CONFIG
from .storage import SnapshotStorage

MAX_DEVICES = 128
MAX_TEXT_BYTES = 65536


class RecipientPolicyError(ValueError):
    """Fixed local error code; no peer data, private state or plaintext."""


@dataclass(frozen=True)
class Recipient:
    address: str
    device_id: int
    fingerprint: str


@dataclass(frozen=True)
class RecipientPlan:
    account: str
    recipient: str
    local_device_id: int
    local_fingerprint: str
    devices: tuple[Recipient, ...]


@dataclass(frozen=True)
class PreparedMessage:
    snapshot: bytes = field(repr=False)
    message: OMEMOMessage = field(repr=False)
    plan: RecipientPlan


def _address(value):
    if not isinstance(value, str) or not value or len(value) > 3071:
        raise RecipientPolicyError("INVALID_ADDRESS")
    try:
        jid = JID.from_string(value)
        if not jid.localpart or jid.resource is not None or str(jid) != value:
            raise ValueError
    except Exception:
        raise RecipientPolicyError("INVALID_ADDRESS") from None
    return value


def _device_ids(value):
    if value is None:
        raise RecipientPolicyError("DEVICE_LIST_UNAVAILABLE")
    if not isinstance(value, (tuple, list)) or len(value) > MAX_DEVICES:
        raise RecipientPolicyError("INVALID_DEVICE_LIST")
    if any(type(device) is not int or not 1 <= device <= 2147483647 for device in value):
        raise RecipientPolicyError("INVALID_DEVICE_LIST")
    if len(set(value)) != len(value):
        raise RecipientPolicyError("INVALID_DEVICE_LIST")
    return set(value)


def _open(account, snapshot, expected_identity):
    _address(account)
    store = SnapshotStorage.open_existing(account, snapshot)
    if store.descriptor() != expected_identity:
        store.close()
        raise RecipientPolicyError("LOCAL_IDENTITY_CHANGED")
    return store


def _session_key(store, address, device):
    record = store.load_session(address, device)
    if record.is_fresh():
        raise RecipientPolicyError("SESSION_MISSING")
    key = record.get_session_state().get_remote_identity_key()
    if key is None or not store.contains_identity(address, key):
        raise RecipientPolicyError("SESSION_MISSING")
    return key


def _plan(store, account, recipient, own_devices, recipient_devices):
    _address(recipient)
    own = _device_ids(own_devices)
    peer = _device_ids(recipient_devices)
    identity = store.descriptor()
    local_id = identity["device_id"]
    if local_id not in own:
        raise RecipientPolicyError("LOCAL_DEVICE_NOT_PUBLISHED")
    if recipient == account and peer != own:
        raise RecipientPolicyError("CONFLICTING_DEVICE_LISTS")
    targets = {(account, device) for device in own if device != local_id}
    if recipient != account:
        if not peer:
            raise RecipientPolicyError("NO_RECIPIENT_DEVICES")
        targets.update((recipient, device) for device in peer)
    if not targets:
        raise RecipientPolicyError("NO_RECIPIENT_DEVICES")
    # The unchanged legacy OMEMO engine keys its output by numeric device ID.
    # Cross-account collisions could overwrite a wrapped key; never merge them.
    ids = [device for _, device in targets]
    if local_id in ids or len(set(ids)) != len(ids):
        raise RecipientPolicyError("DEVICE_ID_COLLISION")
    devices = []
    for address, device in sorted(targets):
        key = _session_key(store, address, device)
        if store.get_trust_for_identity(address, key) != OMEMOTrust.VERIFIED:
            raise RecipientPolicyError("DEVICE_NOT_VERIFIED")
        if store.get_unacknowledged_count(address, device) >= CONFIG.unacknowledged_count:
            raise RecipientPolicyError("SESSION_REFRESH_REQUIRED")
        devices.append(Recipient(address, device, key.get_fingerprint()))
    return RecipientPlan(account, recipient, local_id, identity["fingerprint"], tuple(devices))


def verify_device(*, account, snapshot, expected_identity, recipient, device_id,
                  expected_fingerprint):
    """Apply an explicit verification only to the currently displayed key.

    The future UI/coordinator must collect the actual out-of-band comparison.
    This function does not infer verification from receiving a bundle/message.
    """
    _address(recipient)
    _device_ids([device_id])
    store = _open(account, snapshot, expected_identity)
    try:
        key = _session_key(store, recipient, device_id)
        current = key.get_fingerprint()
        if (not isinstance(expected_fingerprint, str)
                or not expected_fingerprint.isascii()
                or not hmac.compare_digest(current, expected_fingerprint)):
            raise RecipientPolicyError("FINGERPRINT_CHANGED")
        store.set_trust(recipient, key, OMEMOTrust.VERIFIED)
        return store.export_snapshot()
    finally:
        store.close()


def prepare_message(*, account, snapshot, expected_identity, recipient,
                    own_devices, recipient_devices, text):
    """Return candidate state/real ciphertext only with complete verified coverage.

    The returned working snapshot is not committed and the message is not sent.
    Existing durable-outbox integration must persist both in one transaction.
    """
    if not isinstance(text, str) or not text:
        raise RecipientPolicyError("INVALID_TEXT")
    try:
        size = len(text.encode("utf-8"))
    except UnicodeError:
        raise RecipientPolicyError("INVALID_TEXT") from None
    if size > MAX_TEXT_BYTES:
        raise RecipientPolicyError("INVALID_TEXT")
    store = _open(account, snapshot, expected_identity)
    backend = None
    try:
        plan = _plan(store, account, recipient, own_devices, recipient_devices)
        backend = OMEMOSessionManager(account, store, CONFIG)
        # Gajim's actual device-list/session operations; do not rely on the
        # manager's restored active sessions to represent newly announced devices.
        backend.update_devicelist(account, list(own_devices))
        if recipient != account:
            backend.update_devicelist(recipient, list(recipient_devices))
        try:
            message = backend.encrypt(recipient, text, groupchat=False)
        except Exception:
            raise RecipientPolicyError("ENCRYPTION_FAILED") from None
        required = {device.device_id for device in plan.devices}
        if (message is None or message.sid != plan.local_device_id
                or message.payload is None or set(message.keys) != required):
            raise RecipientPolicyError("INCOMPLETE_RECIPIENT_COVERAGE")
        return PreparedMessage(store.export_snapshot(), message, plan)
    finally:
        if backend is not None:
            backend.destroy()
        store.close()


def revalidate_plan(*, account, snapshot, expected_identity, plan,
                    own_devices, recipient_devices):
    """Recheck prepared work against current lists, session keys and trust.

    Caller must serialize this with discovery/trust changes and dispatch. A
    stale plan cannot authorize a send, even if its ciphertext is still valid.
    """
    if not isinstance(plan, RecipientPlan) or plan.account != account:
        raise RecipientPolicyError("RECIPIENT_PLAN_CHANGED")
    store = _open(account, snapshot, expected_identity)
    try:
        current = _plan(store, account, plan.recipient, own_devices, recipient_devices)
        if current != plan:
            raise RecipientPolicyError("RECIPIENT_PLAN_CHANGED")
        return True
    finally:
        store.close()
