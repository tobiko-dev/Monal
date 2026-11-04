"""Configuration and write-failure checks using a synthetic socket boundary."""
import asyncio
from unittest.mock import Mock, patch
from nbxmpp.client import Client
from nbxmpp.const import StreamState, TCPState, ConnectionProtocol, ConnectionType
from nbxmpp.protocol import Iq
from gajim_browser.nbxmpp_connection import configure_client, BrowserConnection, TransportWriteError
from gajim_browser.nbxmpp_values import UnsupportedPlatformOperation


async def run():
    checks = []
    endpoint = "wss://example.invalid/qa"
    def fresh():
        client = Client("synthetic-guard")
        client.set_domain("example.invalid")
        return client
    for invalid in ("ws://example.invalid", "https://example.invalid", "wss://u:p@example.invalid", "wss://example.invalid/#fragment", "wss://example.invalid/ bad"):
        client = fresh()
        factory = Mock()
        try:
            try:
                configure_client(client, invalid, factory)
            except ValueError:
                pass
            else:
                raise AssertionError("Invalid endpoint accepted")
            assert client.state == StreamState.DISCONNECTED
            factory.assert_not_called()
        finally:
            client.destroy()
    checks.append({"name":"unsafe endpoints are rejected before a socket is created", "passed":True})

    changes = [lambda c: c.set_domain("other.invalid"), lambda c: c.set_mechs({"PLAIN"}),
               lambda c: c.set_mechs({"SCRAM-SHA-256-PLUS"}),
               lambda c: c.set_protocols([ConnectionProtocol.TCP]),
               lambda c: c.set_connection_types([ConnectionType.PLAIN]),
               lambda c: c.set_custom_host("wss://other.invalid/", ConnectionProtocol.WEBSOCKET, ConnectionType.DIRECT_TLS)]
    for change in changes:
        client, factory = fresh(), Mock()
        try:
            configure_client(client, endpoint, factory)
            change(client)
            try:
                client.connect()
            except UnsupportedPlatformOperation:
                pass
            else:
                raise AssertionError("Changed connection policy accepted at case " + str(changes.index(change)))
            assert client.state == StreamState.DISCONNECTED
            factory.assert_not_called()
        finally:
            client.destroy()
    checks.append({"name":"changed domain, endpoint, transport or SASL policy fails before connection", "passed":True})

    client = fresh()
    try:
        configure_client(client, endpoint, Mock())
        con = BrowserConnection(client, client._browser_transport)
        con.state = TCPState.CONNECTED
        con._socket = Mock()
        con._socket.send.return_value = "BACKPRESSURE"
        client._con = con
        request = Iq(typ="get", to="example.invalid")
        with patch.object(client._smacks, "save_in_queue") as save:
            try:
                client.send_stanza(request, callback=Mock(), timeout=2)
            except TransportWriteError as error:
                assert str(error) == "BACKPRESSURE"
            else:
                raise AssertionError("Refused write claimed acceptance")
            assert request.getID() not in client._dispatcher._id_callbacks
            save.assert_not_called()
    finally:
        client.destroy()
    checks.append({"name":"backpressure removes the IQ callback and never enters the sent-stanza queue", "passed":True})

    client = fresh()
    try:
        configure_client(client, endpoint, Mock())
        con = BrowserConnection(client, client._browser_transport)
        client._con = con
        observed = []
        con.subscribe("data-received", lambda _con, _signal, data: observed.append(data))
        for _ in range(300):
            con._schedule("data-received", "fixture")
        assert len(con._pending) == 129
        await asyncio.sleep(.01)
        assert con._terminal and client._browser_last_transport_error == "INPUT_OVERFLOW"
        assert len(observed) == 128 and not con._pending and con._pending_bytes == 0
        con._schedule("data-received", "late")
        assert not con._pending
    finally:
        client.destroy()
    checks.append({"name":"queued inbound events are bounded and overflow terminates without late callbacks", "passed":True})
    return checks
