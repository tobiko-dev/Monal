"""Synthetic compatibility checks. No accounts, sockets or persistent state.

The upstream InMemoryStore deliberately uses blind trust. It is a test fixture,
not the application's future storage or identity-verification policy.
"""

import unittest
from dataclasses import replace

from omemo_dr.const import NS_OMEMO_TMP
from omemo_dr.exceptions import DecryptionFailed, MessageNotForDevice
from omemo_dr.session_manager import OMEMOSessionManager
from omemo_dr.structs import OMEMOConfig
from tests.inmemorystore import InMemoryStore


class BrowserCryptoTests(unittest.TestCase):
    def setUp(self):
        config = OMEMOConfig(100, 80, 86400 * 15, 86400, 2000)
        self.alice = OMEMOSessionManager("alice", InMemoryStore(), config)
        self.bob = OMEMOSessionManager("bob", InMemoryStore(), config)
        bundle = self.alice.get_bundle(NS_OMEMO_TMP)
        self.bob.update_devicelist("alice", [bundle.device_id])
        self.bob.build_session("alice", bundle)
        self.message = self.bob.encrypt("alice", "Synthetic secret: 雪 🔒", groupchat=False)
        self.assertIsNotNone(self.message)

    def test_round_trip_and_reply(self):
        self.assertNotIn("Synthetic secret".encode(), self.message.payload)
        plain, fingerprint, _ = self.alice.decrypt_message(self.message, "bob")
        self.assertEqual(plain, "Synthetic secret: 雪 🔒")
        self.assertTrue(fingerprint)
        reply = self.alice.encrypt("bob", "Synthetic reply", groupchat=False)
        self.assertIsNotNone(reply)
        self.assertEqual(self.bob.decrypt_message(reply, "alice")[0], "Synthetic reply")

    @staticmethod
    def changed(value):
        return bytes([value[0] ^ 1]) + value[1:]

    def test_tampered_payload_rejected(self):
        changed = replace(self.message, payload=self.changed(self.message.payload))
        with self.assertRaises(DecryptionFailed):
            self.alice.decrypt_message(changed, "bob")

    def test_tampered_iv_rejected(self):
        changed = replace(self.message, iv=self.changed(self.message.iv))
        with self.assertRaises(DecryptionFailed):
            self.alice.decrypt_message(changed, "bob")

    def test_tampered_wrapped_key_rejected(self):
        keys = dict(self.message.keys)
        device = self.alice.get_our_device()
        key, prekey = keys[device]
        # Alter the end of the encoded key message, preserving its outer framing.
        keys[device] = (key[:-1] + bytes([key[-1] ^ 1]), prekey)
        with self.assertRaises(DecryptionFailed):
            self.alice.decrypt_message(replace(self.message, keys=keys), "bob")

    def test_message_not_addressed_to_this_device_rejected(self):
        keys = dict(self.message.keys)
        del keys[self.alice.get_our_device()]
        with self.assertRaises(MessageNotForDevice):
            self.alice.decrypt_message(replace(self.message, keys=keys), "bob")

    def test_missing_recipient_yields_no_ciphertext(self):
        # The app must treat None as blocked; this test does not claim a complete
        # app-wide no-plaintext-fallback policy exists yet.
        self.assertIsNone(self.bob.encrypt("unknown", "Do not send", groupchat=False))
