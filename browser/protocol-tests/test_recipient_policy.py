"""Strict recipient policy with real Gajim snapshots, sessions and XML crypto.

Discovery lists and verification actions are explicit synthetic fixtures. These
tests do not supply a production discovery coordinator or contact anyone.
"""

from dataclasses import replace
import unittest
from unittest.mock import patch

from nbxmpp.modules.omemo import create_omemo_message, _parse_omemo_message
from nbxmpp.protocol import Message
from omemo_dr.const import NS_OMEMO_TMP, OMEMOTrust
from omemo_dr.session_manager import OMEMOSessionManager

from gajim_browser.identity import CONFIG
from gajim_browser.recipient_policy import (
    MAX_DEVICES, MAX_TEXT_BYTES, RecipientPolicyError, prepare_message,
    revalidate_plan, verify_device,
)
from gajim_browser.storage import InvalidSnapshot, SnapshotStorage

ALICE = "alice@example.invalid"
BOB = "bob@example.invalid"


class RecipientPolicyTests(unittest.TestCase):
    def setUp(self):
        self.store, self.alice = self.new(ALICE, 101)
        self.bob_store, self.bob = self.new(BOB, 202)
        self.add(BOB, self.bob)
        self.own = [101]
        self.peer = [202]

    def new(self, address, device):
        store = SnapshotStorage.create_new(address)
        self.addCleanup(store.close)
        # Deterministic IDs exercise real cross-account ID collisions as well.
        with patch("omemo_dr.util.keyhelper.KeyHelper.get_random_int", return_value=device):
            manager = OMEMOSessionManager(address, store, CONFIG)
        self.addCleanup(manager.destroy)
        return store, manager

    def add(self, address, manager, trust=OMEMOTrust.VERIFIED):
        self.alice.build_session(address, manager.get_bundle(NS_OMEMO_TMP))
        self.store.set_trust(address, manager.get_our_identity()[1], trust)

    def prepare(self, **changes):
        args = dict(account=ALICE, snapshot=self.store.export_snapshot(),
                    expected_identity=self.store.descriptor(), recipient=BOB,
                    own_devices=self.own, recipient_devices=self.peer,
                    text="Synthetic text requiring complete verified coverage")
        return prepare_message(**(args | changes))

    def revalidate(self, prepared, **changes):
        args = dict(account=ALICE, snapshot=self.store.export_snapshot(),
                    expected_identity=self.store.descriptor(), plan=prepared.plan,
                    own_devices=self.own, recipient_devices=self.peer)
        return revalidate_plan(**(args | changes))

    def blocked(self, code, callback):
        with self.assertRaises(RecipientPolicyError) as raised:
            callback()
        self.assertEqual(str(raised.exception), code)

    def test_all_peer_and_own_devices_decrypt_real_xml_after_restore(self):
        own_store, own = self.new(ALICE, 303)
        second_store, second = self.new(BOB, 404)
        self.add(ALICE, own)
        self.add(BOB, second)
        self.own += [303]
        self.peer += [404]
        before = self.store.export_snapshot()
        prepared = self.prepare()
        self.assertEqual(set(prepared.message.keys), {202, 303, 404})
        self.assertEqual(self.store.export_snapshot(), before)
        text = "Synthetic text requiring complete verified coverage"
        stanza = Message(to=BOB, frm=ALICE, typ="chat", body=text)
        create_omemo_message(stanza, prepared.message, node_whitelist=[])
        xml = str(stanza)
        self.assertNotIn(text, xml)
        for manager in (self.bob, own, second):
            self.assertEqual(manager.decrypt_message(_parse_omemo_message(Message(node=xml)), ALICE)[0], text)
        self.assertTrue(self.revalidate(prepared, snapshot=prepared.snapshot))
        self.bob_store.set_trust(ALICE, self.alice.get_our_identity()[1], OMEMOTrust.VERIFIED)
        self.bob.update_devicelist(ALICE, [101])
        reply = self.bob.encrypt(ALICE, "Synthetic reply after restoring prepared state", groupchat=False)
        restored = SnapshotStorage.open_existing(ALICE, prepared.snapshot)
        self.addCleanup(restored.close)
        backend = OMEMOSessionManager(ALICE, restored, CONFIG)
        self.addCleanup(backend.destroy)
        self.assertEqual(backend.decrypt_message(reply, BOB)[0], "Synthetic reply after restoring prepared state")
        self.assertEqual(restored.descriptor(), self.store.descriptor())

    def test_undecided_blind_and_blocked_keys_cannot_encrypt(self):
        for trust in (OMEMOTrust.UNDECIDED, OMEMOTrust.BLIND, OMEMOTrust.UNTRUSTED):
            with self.subTest(trust=trust):
                self.store.set_trust(BOB, self.bob.get_our_identity()[1], trust)
                with patch.object(OMEMOSessionManager, "encrypt") as encrypt:
                    self.blocked("DEVICE_NOT_VERIFIED", self.prepare)
                    encrypt.assert_not_called()

    def test_own_other_devices_also_require_verification(self):
        _, own = self.new(ALICE, 303)
        self.add(ALICE, own, OMEMOTrust.UNDECIDED)
        self.own += [303]
        self.blocked("DEVICE_NOT_VERIFIED", self.prepare)

    def test_unknown_announced_devices_still_block_after_snapshot_reopen(self):
        for own, peer in (([101], [202, 404]), ([101, 303], [202])):
            for _ in range(2):
                self.blocked("SESSION_MISSING", lambda: self.prepare(own_devices=own, recipient_devices=peer))

    def test_missing_lists_never_become_empty_successful_discovery(self):
        self.blocked("DEVICE_LIST_UNAVAILABLE", lambda: self.prepare(own_devices=None))
        self.blocked("DEVICE_LIST_UNAVAILABLE", lambda: self.prepare(recipient_devices=None))
        self.blocked("NO_RECIPIENT_DEVICES", lambda: self.prepare(recipient_devices=[]))
        self.blocked("LOCAL_DEVICE_NOT_PUBLISHED", lambda: self.prepare(own_devices=[]))

    def test_malformed_duplicate_and_excessive_device_ids_are_rejected(self):
        for value in ([True], [0], [-1], [2**31], [202.0], ["202"], [202, 202],
                      "202", {}, list(range(1, MAX_DEVICES + 2))):
            with self.subTest(value_type=type(value).__name__):
                self.blocked("INVALID_DEVICE_LIST", lambda: self.prepare(recipient_devices=value))

    def test_only_canonical_bare_account_addresses_are_accepted(self):
        for address in ("BOB@example.invalid", "bob@example.invalid/resource", "example.invalid", "", None):
            self.blocked("INVALID_ADDRESS", lambda: self.prepare(recipient=address))

    def test_account_or_local_identity_mismatch_cannot_prepare(self):
        with self.assertRaises(InvalidSnapshot):
            self.prepare(account=BOB)
        self.blocked("LOCAL_IDENTITY_CHANGED", lambda: self.prepare(expected_identity=self.bob_store.descriptor()))

    def test_stale_fingerprint_confirmation_cannot_verify_a_replacement_key(self):
        _, replacement = self.new(BOB, 202)
        old = self.bob.get_our_fingerprint()
        self.add(BOB, replacement, OMEMOTrust.UNDECIDED)
        args = dict(account=ALICE, snapshot=self.store.export_snapshot(),
                    expected_identity=self.store.descriptor(), recipient=BOB, device_id=202)
        self.blocked("FINGERPRINT_CHANGED", lambda: verify_device(**args, expected_fingerprint=old))
        self.blocked("DEVICE_NOT_VERIFIED", self.prepare)
        verified = verify_device(**args, expected_fingerprint=replacement.get_our_fingerprint())
        prepared = self.prepare(snapshot=verified)
        self.assertEqual(replacement.decrypt_message(prepared.message, ALICE)[0],
                         "Synthetic text requiring complete verified coverage")

    def test_unknown_device_cannot_be_verified_from_an_arbitrary_fingerprint(self):
        self.blocked("SESSION_MISSING", lambda: verify_device(
            account=ALICE, snapshot=self.store.export_snapshot(), expected_identity=self.store.descriptor(),
            recipient=BOB, device_id=404, expected_fingerprint=self.bob.get_our_fingerprint()))

    def test_numeric_device_collisions_do_not_overwrite_wrapped_keys(self):
        self.blocked("DEVICE_ID_COLLISION", lambda: self.prepare(recipient_devices=[101]))
        _, own = self.new(ALICE, 202)
        self.add(ALICE, own)
        self.blocked("DEVICE_ID_COLLISION", lambda: self.prepare(own_devices=[101, 202]))

    def test_partial_library_encryption_returns_no_candidate_state(self):
        _, second = self.new(BOB, 404)
        self.add(BOB, second)
        self.peer += [404]
        before = self.store.export_snapshot()
        original = OMEMOSessionManager._get_whisper_message
        successful = []

        def fail_one(manager, address, device, key):
            if device == 404:
                raise ValueError("Synthetic private failure detail")
            result = original(manager, address, device, key)
            successful.append(device)
            return result

        with patch.object(OMEMOSessionManager, "_get_whisper_message", fail_one):
            self.blocked("INCOMPLETE_RECIPIENT_COVERAGE", self.prepare)
        self.assertEqual(successful, [202])
        self.assertEqual(self.store.export_snapshot(), before)
        # Deliberate retry from unchanged committed state decrypts on BOTH peers.
        prepared = self.prepare()
        for manager in (self.bob, second):
            self.assertEqual(manager.decrypt_message(prepared.message, ALICE)[0],
                             "Synthetic text requiring complete verified coverage")

    def test_no_ciphertext_or_unexpected_keys_cannot_escape_the_guard(self):
        self.blocked_with_result(None)
        prepared = self.prepare()
        extra = replace(prepared.message, keys=prepared.message.keys | {909: (b"unexpected", True)})
        self.blocked_with_result(extra)
        self.blocked_with_result(replace(prepared.message, payload=None))
        self.blocked_with_result(replace(prepared.message, sid=999))

    def blocked_with_result(self, result):
        with patch.object(OMEMOSessionManager, "encrypt", return_value=result):
            self.blocked("INCOMPLETE_RECIPIENT_COVERAGE", self.prepare)

    def test_encryption_exception_is_redacted_and_original_state_unchanged(self):
        before = self.store.export_snapshot()
        with patch.object(OMEMOSessionManager, "encrypt", side_effect=ValueError("Private sentinel")):
            self.blocked("ENCRYPTION_FAILED", self.prepare)
        self.assertEqual(self.store.export_snapshot(), before)

    def test_revoked_trust_blocks_previously_prepared_work(self):
        prepared = self.prepare()
        self.store.set_trust(BOB, self.bob.get_our_identity()[1], OMEMOTrust.UNTRUSTED)
        self.blocked("DEVICE_NOT_VERIFIED", lambda: self.revalidate(prepared))

    def test_new_verified_device_invalidates_old_recipient_plan(self):
        prepared = self.prepare()
        _, second = self.new(BOB, 404)
        self.add(BOB, second)
        self.peer += [404]
        self.blocked("RECIPIENT_PLAN_CHANGED", lambda: self.revalidate(prepared))

    def test_removed_device_invalidates_old_recipient_plan(self):
        _, second = self.new(BOB, 404)
        self.add(BOB, second)
        self.peer += [404]
        prepared = self.prepare()
        self.peer = [202]
        self.blocked("RECIPIENT_PLAN_CHANGED", lambda: self.revalidate(prepared))

    def test_replaced_but_verified_key_invalidates_old_recipient_plan(self):
        prepared = self.prepare()
        _, replacement = self.new(BOB, 202)
        self.add(BOB, replacement)
        self.blocked("RECIPIENT_PLAN_CHANGED", lambda: self.revalidate(prepared))

    def test_verified_notes_to_self_targets_the_other_device(self):
        _, own = self.new(ALICE, 303)
        self.add(ALICE, own)
        prepared = self.prepare(recipient=ALICE, own_devices=[101, 303], recipient_devices=[101, 303])
        self.assertEqual(set(prepared.message.keys), {303})
        self.assertEqual(own.decrypt_message(prepared.message, ALICE)[0],
                         "Synthetic text requiring complete verified coverage")
        self.blocked("NO_RECIPIENT_DEVICES", lambda: self.prepare(recipient=ALICE, recipient_devices=[101]))

    def test_notes_to_self_rejects_conflicting_own_device_lists(self):
        self.blocked("CONFLICTING_DEVICE_LISTS", lambda: self.prepare(recipient=ALICE, recipient_devices=[101, 303]))

    def test_exhausted_session_blocks_before_any_encryption(self):
        with patch.object(SnapshotStorage, "get_unacknowledged_count", return_value=CONFIG.unacknowledged_count):
            with patch.object(OMEMOSessionManager, "encrypt") as encrypt:
                self.blocked("SESSION_REFRESH_REQUIRED", self.prepare)
                encrypt.assert_not_called()

    def test_invalid_or_unbounded_content_never_reaches_encryption(self):
        for text in (None, "", "\ud800", "x" * (MAX_TEXT_BYTES + 1)):
            with patch.object(OMEMOSessionManager, "encrypt") as encrypt:
                self.blocked("INVALID_TEXT", lambda: self.prepare(text=text))
                encrypt.assert_not_called()

    def test_saved_unannounced_sessions_are_not_added_to_recipient_coverage(self):
        _, second = self.new(BOB, 404)
        self.add(BOB, second)
        self.alice.update_devicelist(BOB, [202, 404])
        prepared = self.prepare()
        self.assertEqual(set(prepared.message.keys), {202})
        self.assertEqual([device.device_id for device in prepared.plan.devices], [202])

    def test_plan_is_bound_to_local_identity_and_account(self):
        prepared = self.prepare()
        self.blocked("RECIPIENT_PLAN_CHANGED", lambda: self.revalidate(prepared, account=BOB))
        self.blocked("RECIPIENT_PLAN_CHANGED", lambda: self.revalidate(
            prepared, plan=replace(prepared.plan, local_fingerprint="00" * 32)))
