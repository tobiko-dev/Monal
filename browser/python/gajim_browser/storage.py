"""Gajim's SQLite store as a disposable working copy of a committed snapshot.

The caller must serialize access, commit the exported bytes atomically, and
discard this working copy on failure. This module never writes browser storage,
contacts the network, or decides that a missing identity may be replaced.
"""

import hmac
import logging
from pathlib import Path

from omemo_dr.curve import generate_public_key

from ._upstream_storage import OMEMOStorage


class InvalidSnapshot(ValueError):
    """Stored state cannot safely be opened; explicit recovery is required."""


class SnapshotStorage(OMEMOStorage):
    SCHEMA_VERSION = 12
    SNAPSHOT_LIMIT = 32 * 1024 * 1024

    def __init__(self, account: str):
        if not isinstance(account, str) or not account or len(account) > 3071:
            raise ValueError("Expected a nonempty canonical account identifier")
        super().__init__(account, Path(":memory:"), logging.LoggerAdapter(
            logging.getLogger("gajim_browser.storage"), {}
        ))

    @classmethod
    def create_new(cls, account: str):
        """Only call after explicit new-device provisioning, never on load failure."""
        store = cls(account)
        store._con.execute("CREATE TABLE browser_metadata (account TEXT NOT NULL)")
        store._con.execute("INSERT INTO browser_metadata VALUES (?)", (account,))
        store._con.commit()
        return store

    @classmethod
    def open_existing(cls, account: str, snapshot: bytes):
        if not isinstance(snapshot, bytes) or not 100 <= len(snapshot) <= cls.SNAPSHOT_LIMIT:
            raise InvalidSnapshot("Missing or invalid identity snapshot")
        store = cls(account)
        try:
            store._con.deserialize(snapshot)
            store._validate()
            return store
        except Exception as error:
            store.close()
            if isinstance(error, InvalidSnapshot):
                raise
            # Do not include database rows or key material in diagnostics.
            raise InvalidSnapshot("Identity snapshot could not be opened") from None

    def _validate(self):
        if self.user_version() != self.SCHEMA_VERSION:
            raise InvalidSnapshot("Unsupported identity database version")
        if self._con.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
            raise InvalidSnapshot("Identity database failed its integrity check")
        metadata = self._con.execute("SELECT account FROM browser_metadata").fetchall()
        if metadata != [(self._account,)]:
            raise InvalidSnapshot("Identity database belongs to a different account")
        rows = self._con.execute("SELECT device_id, public_key, private_key FROM secret").fetchall()
        if len(rows) != 1:
            raise InvalidSnapshot("Expected exactly one existing device identity")
        device, public, private = rows[0]
        if (type(device) is not int or not 1 <= device <= 2147483647
                or not isinstance(public, bytes) or len(public) != 33 or public[0] != 5
                or not isinstance(private, bytes) or len(private) != 32
                or not hmac.compare_digest(public[1:], generate_public_key(private))):
            raise InvalidSnapshot("Device identity keys are inconsistent")
        # Require the full Gajim schema, not just a valid secret table.
        for table in ("identities", "prekeys", "signed_prekeys", "sessions"):
            self._con.execute(f"SELECT * FROM {table} LIMIT 0")

    def export_snapshot(self) -> bytes:
        self._validate()
        if self._con.in_transaction:
            raise InvalidSnapshot("Uncommitted SQLite changes cannot be exported")
        snapshot = self._con.serialize()
        if len(snapshot) > self.SNAPSHOT_LIMIT:
            raise InvalidSnapshot("Identity database exceeds the snapshot size limit")
        return snapshot

    def descriptor(self) -> dict:
        self._validate()
        return {
            "device_id": self.get_our_device_id(),
            "fingerprint": self.get_identity_key_pair().get_public_key().get_fingerprint(),
        }

    def close(self):
        self._con.close()
