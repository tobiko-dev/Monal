"""Explicit nbxmpp connection boundary; no discovery or automatic fallback.

The browser owns TLS/WebSocket I/O. nbxmpp owns XMPP parsing and negotiation.
Configure a client with one reviewed endpoint and an explicit socket factory.
No account/device policy or user-content dispatcher is provided here.
"""
import asyncio
from dataclasses import dataclass
import logging
import re
import sys
from urllib.parse import urlsplit

from nbxmpp.const import ConnectionProtocol, ConnectionType, StreamState, TCPState
from nbxmpp.util import Observable
from .nbxmpp_values import UnsupportedPlatformOperation


class TransportWriteError(RuntimeError):
    pass


@dataclass(frozen=True)
class Settings:
    domain: str
    endpoint: str
    factory: object
    negotiation_timeout: float


def configure_client(client, endpoint, socket_factory, negotiation_timeout=20):
    if client.state != StreamState.DISCONNECTED or hasattr(client, "_browser_transport"):
        raise ValueError("Configure a new disconnected client once")
    if not client.domain or not callable(socket_factory):
        raise ValueError("Domain and socket factory are required")
    if not isinstance(endpoint, str) or len(endpoint) > 2048 or re.search(r"[\s\x00-\x1f\x7f\\]", endpoint):
        raise ValueError("Invalid endpoint")
    url = urlsplit(endpoint)
    if url.scheme != "wss" or not url.hostname or url.username or url.password or url.fragment:
        raise ValueError("Only explicit WSS endpoints are supported")
    if isinstance(negotiation_timeout, bool) or not 0 < negotiation_timeout <= 30:
        raise ValueError("Invalid negotiation timeout")
    # Keep payloads, authentication material, server text and exception locals
    # out of the worker's logs. UI diagnostics use fixed transport/error codes.
    logging.disable(logging.CRITICAL)
    client.set_custom_host(endpoint, ConnectionProtocol.WEBSOCKET, ConnectionType.DIRECT_TLS)
    client.set_protocols([ConnectionProtocol.WEBSOCKET])
    client.set_connection_types([ConnectionType.DIRECT_TLS])
    client.set_mechs({"SCRAM-SHA-256", "SCRAM-SHA-512"})
    client._browser_transport = Settings(client.domain, endpoint, socket_factory, negotiation_timeout)
    client._browser_last_transport_error = None

    def active(_client, _signal):
        if client._con is not None:
            client._con.negotiation_complete()
    client.subscribe("connected", active)
    client.subscribe("resume-successful", active)
    ensure_configured(client)


def ensure_configured(client):
    settings = getattr(client, "_browser_transport", None)
    if settings is None:
        raise UnsupportedPlatformOperation("Browser transport requires explicit configuration")
    expected = (settings.endpoint, ConnectionProtocol.WEBSOCKET, ConnectionType.DIRECT_TLS)
    if (client.domain != settings.domain or client.custom_host != expected or client.proxy is not None
            or client.protocols != [ConnectionProtocol.WEBSOCKET]
            or client.connection_types != [ConnectionType.DIRECT_TLS]
            or client._allowed_protocols != [ConnectionProtocol.WEBSOCKET]
            or client._allowed_con_types != [ConnectionType.DIRECT_TLS]
            or client.ignore_tls_errors or client.ignored_tls_errors or client._accepted_certificates
            or client.client_cert != (None, None)
            or not client.mechs or not client.mechs <= {"SCRAM-SHA-256", "SCRAM-SHA-512"}):
        raise UnsupportedPlatformOperation("Browser connection configuration changed or is unsupported")
    return settings


def create_connection(client, _context, address, *_desktop_options):
    settings = ensure_configured(client)
    if (address.domain != settings.domain or address.uri != settings.endpoint or address.proxy is not None
            or address.protocol != ConnectionProtocol.WEBSOCKET or address.type != ConnectionType.DIRECT_TLS):
        raise UnsupportedPlatformOperation("Connection address is outside configured scope")
    client._browser_last_transport_error = None
    return BrowserConnection(client, settings)


class BrowserConnection(Observable):
    tls_version = ciphersuite = local_address = remote_address = None
    peer_certificate = (None, None)  # Unavailable; not evidence of a checked certificate.
    connection_type = ConnectionType.DIRECT_TLS

    def __init__(self, client, settings):
        super().__init__(logging.getLogger("gajim_browser.transport"))
        self._client = client
        self._settings = settings
        self._loop = asyncio.get_running_loop()
        self._socket = self._proxy = self._deadline = None
        self._pending = set()
        self._pending_bytes = 0
        self._overflow = False
        self._terminal = False
        self._input_closed = self._output_closed = False
        self.state = TCPState.DISCONNECTED

    def get_channel_binding_data(self, _kind):
        return None

    def start_tls_negotiation(self):
        raise UnsupportedPlatformOperation("STARTTLS is not available on browser WSS")

    def _schedule(self, event, data):
        if self._terminal:
            return
        size = 0
        if event == "data-received":
            if self._overflow:
                return
            size = len(data.encode("utf-8"))
            if len(self._pending) >= 128 or self._pending_bytes + size > 2 * 1024 * 1024:
                self._overflow = True
                event, data, size = "disconnected", "INPUT_OVERFLOW", 0
        self._pending_bytes += size
        # Do not reenter Python from a send inside an upstream state transition.
        def deliver():
            self._pending.discard(handle)
            self._pending_bytes -= size
            if self._terminal:
                return
            try:
                self._deliver(event, data)
            except Exception:
                self._finish("disconnected", "PROTOCOL_CALLBACK_FAILED")
        handle = self._loop.call_soon(deliver)
        self._pending.add(handle)

    def connect(self):
        if self._socket is not None or self._terminal:
            raise RuntimeError("Connection already used")
        self.state = TCPState.CONNECTING
        callback = self._schedule
        if sys.platform == "emscripten":
            from pyodide.ffi import create_proxy
            callback = self._proxy = create_proxy(callback)
        try:
            self._socket = self._settings.factory(self._settings.endpoint, callback)
            self._socket.connect()
        except Exception:
            self._schedule("connection-failed", "CONNECT_FAILED")

    def _deliver(self, event, data):
        if event == "connected":
            if self.state != TCPState.CONNECTING:
                return
            self.state = TCPState.CONNECTED
            self._deadline = self._loop.call_later(self._settings.negotiation_timeout,
                self._finish, "disconnected", "NEGOTIATION_TIMEOUT")
            self.notify("connected")
        elif event == "data-received":
            if not self._input_closed:
                self.notify("data-received", data)
        elif event in ("connection-failed", "disconnected"):
            self._finish(event, data)

    def negotiation_complete(self):
        if self._deadline is not None:
            self._deadline.cancel()
            self._deadline = None

    def send(self, stanza, now=False):
        if self._terminal or self._output_closed or self.state != TCPState.CONNECTED:
            raise TransportWriteError("NOT_OPEN")
        result = self._socket.send(str(stanza))
        if result != "ACCEPTED":
            raise TransportWriteError(result)
        self.notify("data-sent", stanza)  # Queued in browser, not acknowledged/delivered/read.

    def shutdown_input(self):
        self._input_closed = True
        if self._socket is not None:
            self._socket.shutdownInput()

    def shutdown_output(self):
        self._output_closed = True
        self.state = TCPState.DISCONNECTING
        if self._socket is not None:
            self._socket.shutdownOutput()

    def disconnect(self):
        self._schedule("disconnected", "LOCAL_CLOSE")

    def _release(self):
        self.negotiation_complete()
        for handle in self._pending:
            handle.cancel()
        self._pending.clear()
        self._pending_bytes = 0
        if self._socket is not None:
            self._socket.dispose()
            self._socket = None
        if self._proxy is not None:
            self._proxy.destroy()
            self._proxy = None

    def _finish(self, signal, code):
        if self._terminal:
            return
        self._terminal = True
        self.state = TCPState.DISCONNECTED
        self._client._browser_last_transport_error = code
        self._release()
        try:
            self.notify(signal)
        finally:
            self.remove_subscriptions()
            self._client = None

    def destroy(self):
        self._terminal = True
        self.state = TCPState.DISCONNECTED
        self._release()
        self.remove_subscriptions()
        self._client = None
