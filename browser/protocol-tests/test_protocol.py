import base64
import sys
import unittest
from unittest.mock import Mock

import test.unit.test_xml_vulnerability as upstream_xml
from nbxmpp.protocol import Features, InvalidJid, JID
from nbxmpp.sasl import AuthFail, SASL, SCRAM_SHA_256
from nbxmpp.structs import ProxyData
from nbxmpp.util import b64encode, min_version
from gajim_browser.nbxmpp_values import (
    ChannelBindingType, UnsupportedPlatformOperation, hostname_is_ip_address,
    uri_escape_string, uri_unescape_string,
)
from gajim_browser.nbxmpp_crypto import MAX_SCRAM_ITERATIONS, pbkdf2_hmac


class WebsocketXMLVulnerability(upstream_xml.XMLVulnerability):
    def setUp(self):
        super().setUp()
        self.stream.is_websocket = True


class BrowserProtocolTests(unittest.TestCase):
    def test_no_desktop_runtime_or_transport_imported(self):
        import nbxmpp.client
        self.assertNotIn("gi", sys.modules)
        for name in ("tcp", "websocket", "connection"):
            self.assertNotIn("nbxmpp." + name, sys.modules)
        self.assertFalse(min_version("GLib", "2.69.0"))

    def test_unicode_and_reserved_uri_round_trip(self):
        value = "유리 space/%?&+"
        encoded = uri_escape_string(value)
        self.assertEqual(uri_unescape_string(encoded), value)
        self.assertEqual(JID.from_iri("xmpp:%6Auliet@example.org/a%2Fb").resource, "a/b")
        self.assertEqual(JID.from_iri("xmpp:%6Auliet@example.org").localpart, "juliet")
        with self.assertRaises(InvalidJid):
            JID.from_iri("xmpp:juliet%20capulet@example.org")

    def test_malformed_uri_is_rejected_instead_of_changing_identity(self):
        for value in ("%", "%1", "%GG", "%00", "%ff", "%ed%a0%80", "a\0b"):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    uri_unescape_string(value)
                for address in (f"xmpp:{value}@example.org", f"xmpp:alice@example.org/{value}"):
                    with self.assertRaises(InvalidJid):
                        JID.from_iri(address)

    def test_ipv4_ipv6_and_scope_ids_without_ambiguous_input(self):
        for value in ("127.0.0.1", "::1", "fe80::1%eth0"):
            self.assertTrue(hostname_is_ip_address(value))
        for value in ("127.1", "127.0.0.01", "127.0.0.1\0.evil", "fe80::1%/", "example.org"):
            self.assertFalse(hostname_is_ip_address(value))

    def test_desktop_proxy_resolver_cannot_be_created(self):
        proxy = ProxyData("socks", "example.invalid", "a b", "x/y")
        self.assertEqual(proxy.get_uri(), "socks://a%20b:x%2Fy@example.invalid")
        with self.assertRaises(UnsupportedPlatformOperation):
            proxy.get_resolver()

    def test_advertised_channel_binding_does_not_create_local_capability(self):
        features = Features(node='<stream:features xmlns:stream="http://etherx.jabber.org/streams"><sasl-channel-binding xmlns="urn:xmpp:sasl-cb:0"><channel-binding type="tls-exporter"/></sasl-channel-binding></stream:features>')
        self.assertEqual(features.get_channel_binding_type(), ChannelBindingType.EXPORTER)
        client = Mock()
        self.assertIsNone(SASL(client)._get_channel_binding_data(features))
        client.get_channel_binding_data.assert_not_called()

    def test_scram_rejects_bad_nonce_and_weak_iteration_count(self):
        for nonce, count in (("bad", 4096), ("fixed-extra", 4095)):
            scram = SCRAM_SHA_256("user", "synthetic-password", None)
            scram._client_nonce = "fixed"
            scram.get_initiate_data()
            with self.assertRaises(AuthFail):
                scram.get_response_data(b64encode(f"r={nonce},s=c2FsdA==,i={count}"))

    def test_scram_rejects_wrong_server_signature(self):
        scram = SCRAM_SHA_256("user", "synthetic-password", None)
        scram._client_nonce = "fixed"
        scram.get_initiate_data()
        scram.get_response_data(b64encode("r=fixed-server,s=c2FsdA==,i=4096"))
        with self.assertRaises(AuthFail):
            scram.validate_success_data(b64encode("v=" + base64.b64encode(b"wrong").decode()))

    def test_scram_sha256_rfc7677_vector(self):
        # RFC 7677 section 3: https://www.rfc-editor.org/rfc/rfc7677#section-3
        scram = SCRAM_SHA_256("user", "pencil", None)
        scram._client_nonce = "rOprNGfwEbeRWgbNEkqO"
        self.assertEqual(scram.get_initiate_data(), b64encode("n,,n=user,r=rOprNGfwEbeRWgbNEkqO"))
        nonce = "rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0"
        response = scram.get_response_data(b64encode(f"r={nonce},s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096"))
        self.assertEqual(response, b64encode(f"c=biws,r={nonce},p=dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ="))
        scram.validate_success_data(b64encode("v=6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4="))

    def test_pbkdf2_matches_native_hashlib_reference_values(self):
        # Independent CPython/OpenSSL outputs for password/salt, c=4096.
        # The SHA-1 value is also RFC 6070's third test vector.
        expected = {
            "sha1": "4b007901b765489abead49d926f721d065a429c1",
            "sha256": "c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a",
            "sha512": "d197b1b33db0143e018b12f3d1d1479e6cdebdcc97c5c0f87f6902e072f457b5143f30602641b3d55cd335988cb36b84376060ecd532e039b742a239434af2d5",
        }
        for algorithm, result in expected.items():
            with self.subTest(algorithm=algorithm):
                self.assertEqual(pbkdf2_hmac(algorithm, b"password", b"salt", 4096).hex(), result)

    def test_kdf_rejects_unbounded_or_invalid_work(self):
        for count in (0, -1, True, 4096.0, MAX_SCRAM_ITERATIONS + 1):
            with self.subTest(count=count), self.assertRaises(ValueError):
                pbkdf2_hmac("sha256", b"password", b"salt", count)
        with self.assertRaises(ValueError):
            pbkdf2_hmac("sha256", b"password", b"s" * 1025, 4096)
        with self.assertRaises(ValueError):
            pbkdf2_hmac("md5", b"password", b"salt", 4096)

    def test_scram_fails_cleanly_for_excessive_work(self):
        scram = SCRAM_SHA_256("user", "synthetic-password", None)
        scram._client_nonce = "fixed"
        scram.get_initiate_data()
        with self.assertRaises(AuthFail):
            scram.get_response_data(b64encode(f"r=fixed-server,s=c2FsdA==,i={MAX_SCRAM_ITERATIONS + 1}"))
