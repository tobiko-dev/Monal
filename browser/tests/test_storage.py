"""Synthetic restart and failure checks against the adapted Gajim SQLite store."""

import unittest
from unittest.mock import patch

from omemo_dr.const import NS_OMEMO_TMP, OMEMOTrust
from omemo_dr.session_manager import OMEMOSessionManager
from omemo_dr.structs import OMEMOConfig

from gajim_browser.storage import InvalidSnapshot, SnapshotStorage

CONFIG = OMEMOConfig(20, 10, 86400 * 15, 86400, 2000)


class StorageTests(unittest.TestCase):
    def new(self, account):
        store = SnapshotStorage.create_new(account)
        self.addCleanup(store.close)
        return store, OMEMOSessionManager(account, store, CONFIG)

    def reopen(self, account, store):
        restored = SnapshotStorage.open_existing(account, store.export_snapshot())
        self.addCleanup(restored.close)
        return restored, OMEMOSessionManager(account, restored, CONFIG)

    def test_identity_and_prekeys_survive_restart_without_generation(self):
        store, manager = self.new("alice")
        identity = store.descriptor()
        count = store.get_pre_key_count()
        with patch.object(OMEMOSessionManager, "_generate_keys", side_effect=AssertionError("Rotated identity")):
            restored, resumed = self.reopen("alice", store)
        self.assertEqual(restored.descriptor(), identity)
        self.assertEqual(restored.get_pre_key_count(), count)
        self.assertEqual(resumed.get_bundle(NS_OMEMO_TMP).ik, manager.get_bundle(NS_OMEMO_TMP).ik)

    def test_unverified_peer_is_not_silently_trusted(self):
        alice_store, alice = self.new("alice")
        _, bob = self.new("bob")
        bundle = bob.get_bundle(NS_OMEMO_TMP)
        alice.update_devicelist("bob", [bundle.device_id])
        alice.build_session("bob", bundle)
        self.assertFalse(alice_store.is_trusted("bob", bundle.device_id))
        self.assertIsNone(alice.encrypt("bob", "Must stay blocked", groupchat=False))

    def test_trust_and_ratchets_survive_both_participants_restarting(self):
        alice_store, alice = self.new("alice")
        bob_store, bob = self.new("bob")
        bundle = bob.get_bundle(NS_OMEMO_TMP)
        alice.update_devicelist("bob", [bundle.device_id])
        alice.build_session("bob", bundle)
        bob_identity = bob_store.get_identity_key_pair().get_public_key()
        alice_store.set_trust("bob", bob_identity, OMEMOTrust.VERIFIED)
        first = alice.encrypt("bob", "before restart", groupchat=False)
        self.assertEqual(bob.decrypt_message(first, "alice")[0], "before restart")
        alice_identity = alice_store.get_identity_key_pair().get_public_key()
        bob_store.set_trust("alice", alice_identity, OMEMOTrust.VERIFIED)
        restored_a, alice = self.reopen("alice", alice_store)
        restored_b, bob = self.reopen("bob", bob_store)
        self.assertEqual(restored_a.get_trust_for_identity("bob", bob_identity), OMEMOTrust.VERIFIED)
        reply = bob.encrypt("alice", "after restart", groupchat=False)
        self.assertIsNotNone(reply)
        self.assertEqual(alice.decrypt_message(reply, "bob")[0], "after restart")
        restored_a, alice = self.reopen("alice", restored_a)
        restored_b, bob = self.reopen("bob", restored_b)
        second = alice.encrypt("bob", "next ratchet", groupchat=False)
        self.assertEqual(bob.decrypt_message(second, "alice")[0], "next ratchet")

    def test_missing_and_corrupt_snapshots_do_not_create_identity(self):
        for data in (None, b"", b"not a database" * 20):
            with self.subTest(data_type=type(data).__name__):
                with self.assertRaises(InvalidSnapshot):
                    SnapshotStorage.open_existing("alice", data)

    def test_empty_identity_rejected(self):
        store = SnapshotStorage.create_new("alice")
        self.addCleanup(store.close)
        with self.assertRaises(InvalidSnapshot):
            store.export_snapshot()
        with self.assertRaises(InvalidSnapshot):
            SnapshotStorage.open_existing("alice", store._con.serialize())

    def test_other_account_cannot_load_snapshot(self):
        store, _ = self.new("alice")
        with self.assertRaises(InvalidSnapshot):
            SnapshotStorage.open_existing("bob", store.export_snapshot())

    def test_unknown_schema_rejected(self):
        store, _ = self.new("alice")
        store._con.execute("PRAGMA user_version=999")
        with self.assertRaises(InvalidSnapshot):
            SnapshotStorage.open_existing("alice", store._con.serialize())

    def test_inconsistent_key_pair_rejected(self):
        store, _ = self.new("alice")
        store._con.execute("UPDATE secret SET public_key=?", (b"\x05" + b"\x01" * 32,))
        store._con.commit()
        with self.assertRaises(InvalidSnapshot):
            SnapshotStorage.open_existing("alice", store._con.serialize())

    def test_duplicate_identity_rejected(self):
        store, _ = self.new("alice")
        store._con.execute("INSERT INTO secret SELECT * FROM secret")
        store._con.commit()
        with self.assertRaises(InvalidSnapshot):
            SnapshotStorage.open_existing("alice", store._con.serialize())
