"""Real crypto and nbxmpp XML, with explicit synthetic trust and no transport."""

import unittest
from nbxmpp.modules.omemo import _make_bundle, _parse_bundle, _parse_omemo_message, create_omemo_message
from nbxmpp.namespaces import Namespace
from nbxmpp.protocol import Message
from nbxmpp.simplexml import Node
from nbxmpp.util import b64decode, b64encode
from omemo_dr.const import NS_OMEMO_TMP, OMEMOTrust
from omemo_dr.exceptions import DecryptionFailed, MessageNotForDevice
from omemo_dr.session_manager import OMEMOSessionManager
from omemo_dr.structs import OMEMOConfig
from gajim_browser.storage import SnapshotStorage

ALICE = "alice@example.invalid"
BOB = "bob@example.invalid"
CONFIG = OMEMOConfig(20, 10, 86400 * 15, 86400, 2000)


class OMEMOWireTests(unittest.TestCase):
    def setUp(self):
        self.alice_store, self.alice = self.new(ALICE)
        self.bob_store, self.bob = self.new(BOB)
        bundle = self.bob.get_bundle(NS_OMEMO_TMP)
        # Exercise upstream bundle serialization/parsing before session creation.
        item = Node("item", payload=[_make_bundle(bundle)])
        restored_bundle = _parse_bundle(Node(node=str(item)), bundle.device_id)
        self.assertEqual(restored_bundle.ik, bundle.ik)
        self.alice.update_devicelist(BOB, [bundle.device_id])
        self.alice.build_session(BOB, restored_bundle)
        self.alice_store.set_trust(BOB, self.bob_store.get_identity_key_pair().get_public_key(), OMEMOTrust.VERIFIED)

    def new(self, account, snapshot=None):
        store = SnapshotStorage.create_new(account) if snapshot is None else SnapshotStorage.open_existing(account, snapshot)
        self.addCleanup(store.close)
        return store, OMEMOSessionManager(account, store, CONFIG)

    def wire(self, manager, sender, recipient, text):
        encrypted = manager.encrypt(recipient, text, groupchat=False)
        self.assertIsNotNone(encrypted)
        stanza = Message(to=recipient, frm=sender, typ="chat", body=text)
        stanza.setID("synthetic-wire-id")
        create_omemo_message(stanza, encrypted, node_whitelist=[])
        xml = str(stanza)
        self.assertNotIn(text, xml)
        parsed = Message(node=xml)
        self.assertEqual(str(parsed.getFrom()), sender)
        self.assertEqual(str(parsed.getTo()), recipient)
        self.assertEqual(parsed.getID(), "synthetic-wire-id")
        return parsed

    def test_real_xml_exchange_and_reply_after_snapshot_restoration(self):
        identities = self.alice_store.descriptor(), self.bob_store.descriptor()
        first = self.wire(self.alice, ALICE, BOB, "Synthetic secret through actual nbxmpp XML")
        self.assertEqual(self.bob.decrypt_message(_parse_omemo_message(first), ALICE)[0], "Synthetic secret through actual nbxmpp XML")
        self.bob_store.set_trust(ALICE, self.alice_store.get_identity_key_pair().get_public_key(), OMEMOTrust.VERIFIED)
        self.alice_store, self.alice = self.new(ALICE, self.alice_store.export_snapshot())
        self.bob_store, self.bob = self.new(BOB, self.bob_store.export_snapshot())
        self.assertEqual((self.alice_store.descriptor(), self.bob_store.descriptor()), identities)
        reply = self.wire(self.bob, BOB, ALICE, "Synthetic encrypted XML reply after restart")
        self.assertEqual(self.alice.decrypt_message(_parse_omemo_message(reply), BOB)[0], "Synthetic encrypted XML reply after restart")

    def test_xml_payload_tampering_fails_authenticated_decryption(self):
        stanza = self.wire(self.alice, ALICE, BOB, "Synthetic payload that must be authenticated")
        payload = stanza.getTag("encrypted", namespace=Namespace.OMEMO_TEMP).getTag("payload")
        data = b64decode(payload.getData())
        payload.setData(b64encode(bytes([data[0] ^ 1]) + data[1:]))
        with self.assertRaises(DecryptionFailed):
            self.bob.decrypt_message(_parse_omemo_message(Message(node=str(stanza))), ALICE)

    def test_xml_for_another_device_is_not_decryptable(self):
        stanza = self.wire(self.alice, ALICE, BOB, "Synthetic device-specific secret")
        header = stanza.getTag("encrypted", namespace=Namespace.OMEMO_TEMP).getTag("header")
        for key in header.getTags("key"):
            key.setAttr("rid", str(self.bob.get_our_device() + 1))
        with self.assertRaises(MessageNotForDevice):
            self.bob.decrypt_message(_parse_omemo_message(Message(node=str(stanza))), ALICE)
