"""Application worker identity bridge; separate from synthetic peer trust."""

import json
import unittest
from unittest.mock import patch

from gajim_browser.identity import create_identity, inspect_identity, step
from gajim_browser.storage import InvalidSnapshot, SnapshotStorage


class IdentityBridgeTests(unittest.TestCase):
    def test_provision_uses_gajim_prekey_configuration(self):
        value = create_identity("worker-alice")
        store = SnapshotStorage.open_existing("worker-alice", value["snapshot"])
        self.addCleanup(store.close)
        self.assertEqual(store.get_pre_key_count(), 100)
        self.assertEqual(store.descriptor(), value["identity"])

    def test_inspection_never_initializes_a_session_manager(self):
        value = create_identity("worker-alice")
        with patch("gajim_browser.identity.OMEMOSessionManager", side_effect=AssertionError("Unexpected initialization")):
            for _ in range(2):
                self.assertEqual(inspect_identity("worker-alice", value["snapshot"], value["identity"]), value["identity"])

    def test_outer_descriptor_mismatch_is_rejected(self):
        value = create_identity("worker-alice")
        wrong = {**value["identity"], "fingerprint": "00" * 32}
        with self.assertRaises(InvalidSnapshot):
            inspect_identity("worker-alice", value["snapshot"], wrong)

    def test_wrong_account_cannot_open_the_identity(self):
        value = create_identity("worker-alice")
        with self.assertRaises(InvalidSnapshot):
            inspect_identity("worker-bob", value["snapshot"], value["identity"])

    def test_bridge_errors_never_include_private_exception_text(self):
        with patch("gajim_browser.identity.create_identity", side_effect=RuntimeError("private sentinel")):
            result = step(json.dumps({"action": "create", "account": "worker-alice"}))
        self.assertEqual(json.loads(result), {"error": "CRYPTO_FAILED"})
        self.assertNotIn("sentinel", result)
