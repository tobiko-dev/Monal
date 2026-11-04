import asyncio
import io
import logging
from nbxmpp.client import Client
from nbxmpp.const import StreamState
from nbxmpp.protocol import Iq, isResultNode
from gajim_browser.nbxmpp_connection import configure_client
from gajim_browser.nbxmpp_scheduler import pending_count
from .guards import run as run_guards


async def run(factory, endpoint):
    checks = []
    baseline = pending_count()
    logs = io.StringIO()
    handler = logging.StreamHandler(logs)
    logging.getLogger().addHandler(handler)
    prior_level = logging.root.manager.disable
    logging.disable(logging.NOTSET)

    def make(scenario, timeout=6):
        client = Client("synthetic-transport")
        client.set_domain("example.invalid")
        client.set_username("synthetic")
        client.set_resource("browser-qa")
        client.set_password("synthetic-only")
        configure_client(client, endpoint + "?scenario=" + scenario, factory, timeout)
        return client

    async def connect(client):
        outcome = asyncio.get_running_loop().create_future()
        def completed(_client, signal):
            if not outcome.done():
                outcome.set_result(signal)
        for signal in ("connected", "disconnected", "connection-failed"):
            client.subscribe(signal, completed)
        client.connect()
        return await asyncio.wait_for(outcome, 15)

    async def disconnect(client):
        done = asyncio.Event()
        client.subscribe("disconnected", lambda *_: done.set())
        client.disconnect()
        await asyncio.wait_for(done.wait(), 5)
        assert client.state == StreamState.DISCONNECTED

    async def ping(client):
        reply = asyncio.get_running_loop().create_future()
        request = Iq(typ="get", to="example.invalid")
        request.addChild("ping", namespace="urn:xmpp:ping")
        client.send_stanza(request, callback=lambda _client, stanza: reply.set_result(stanza), timeout=4)
        response = await asyncio.wait_for(reply, 6)
        assert response is not None and isResultNode(response) and response.getID() == request.getID()

    try:
        checks.extend(await run_guards())
        client = make("success")
        try:
            assert await connect(client) == "connected"
            assert client.state == StreamState.ACTIVE and client.is_stream_authenticated
            assert str(client.get_bound_jid()) == "synthetic@example.invalid/browser-qa"
            assert client._connect_successful
            await ping(client)
            checks.append({"name":"actual nbxmpp performs SCRAM authentication, stream restart, binding and IQ reply over WSS", "passed":True})
            old = client._con
            await disconnect(client)
            assert old._terminal and not old._pending and old._proxy is None
            assert await connect(client) == "connected"
            assert client._con is not old
            await ping(client)
            checks.append({"name":"graceful close and reconnect use a fresh socket and working upstream state machine", "passed":True})
            # Client destruction must close an active connection without callbacks.
            active = client._con
        finally:
            client.destroy()
        await asyncio.sleep(.02)
        assert active._terminal and active._socket is None and not active._pending
        checks.append({"name":"destroying an active client disposes socket, proxy and queued callbacks", "passed":True})

        scenarios = {
            "bad-subprotocol": "missing negotiated xmpp protocol never reaches authentication",
            "malformed": "malformed XML terminates the stream before authentication",
            "entity": "external entity XML is rejected by the real parser",
            "binary": "binary input is rejected at the socket boundary",
            "oversized": "oversized input is rejected before Python parsing",
            "wrong-domain": "stream header from another domain is rejected",
            "auth-failure": "authentication failure does not become a connected session",
            "bad-signature": "wrong SCRAM server signature fails authentication",
            "interrupt-auth": "interrupted authentication produces a terminal outcome",
            "stall-auth": "stalled authentication is terminated by the negotiation deadline",
        }
        for scenario, name in scenarios.items():
            client = make(scenario, 1 if scenario == "stall-auth" else 6)
            try:
                result = await connect(client)
                assert result in ("disconnected", "connection-failed"), scenario
                assert client.state == StreamState.DISCONNECTED and not client.is_stream_authenticated, scenario
                if scenario == "stall-auth":
                    assert client._browser_last_transport_error == "NEGOTIATION_TIMEOUT"
                if scenario in ("binary", "oversized"):
                    assert client._browser_last_transport_error == {"binary":"BINARY_FRAME", "oversized":"FRAME_TOO_LARGE"}[scenario]
                checks.append({"name":name,"passed":True})
            finally:
                client.destroy()
        assert not logs.getvalue(), "Protocol logging was not disabled"
        assert pending_count() == baseline
        checks.append({"name":"protocol/authentication logs stay empty and no nbxmpp timers remain", "passed":True})
        return {"passed":True,"checks":checks,"remaining_timers":pending_count()-baseline,
                "scope":"Real WebSocket plus upstream nbxmpp against a scripted synthetic peer; no 5july or contact messaging"}
    finally:
        logging.getLogger().removeHandler(handler)
        logging.disable(prior_level)
