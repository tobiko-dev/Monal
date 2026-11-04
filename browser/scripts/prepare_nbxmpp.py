"""Prepare the pinned protocol core with explicit, reviewable browser patches.

Original source is distributed alongside the adapted package. No GI facade is
installed. Desktop connections are excluded; client.connect fails before state
changes until a real browser transport is integrated in the next increment.
"""

import ast
import difflib
import hashlib
import io
import json
from pathlib import Path
import tarfile
import textwrap

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED = {"nbxmpp/connection.py", "nbxmpp/tcp.py", "nbxmpp/websocket.py"}


def source_files():
    pin = json.loads((ROOT / "versions.json").read_text())["nbxmpp"]
    archive = (ROOT / "vendor/nbxmpp" / pin["archive"]).read_bytes()
    if hashlib.sha256(archive).hexdigest() != pin["sha256"]:
        raise RuntimeError("nbxmpp source archive hash mismatch")
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        return {m.name: tar.extractfile(m).read() for m in tar if m.isfile()}


def prepare():
    original = source_files()
    current = {p: data.decode() for p, data in original.items()
               if p.startswith("nbxmpp/") and p.endswith(".py") and p not in EXCLUDED}
    ledger = []

    def replace(path, before, after, reason, count=1):
        if current[path].count(before) != count:
            raise RuntimeError(f"nbxmpp patch no longer applies exactly: {path}: {reason}")
        current[path] = current[path].replace(before, after)
        ledger.append({"path": path, "change": reason})

    def function(path, qualified_name, replacement, reason):
        tree = ast.parse(current[path])
        nodes = tree.body
        names = qualified_name.split(".")
        for name in names:
            matches = [n for n in nodes if isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name == name]
            if len(matches) != 1:
                raise RuntimeError("Missing/ambiguous patch target: " + qualified_name)
            target = matches[0]
            nodes = target.body
        lines = current[path].splitlines(keepends=True)
        before = "".join(lines[target.lineno - 1:target.end_lineno])
        after = textwrap.indent(textwrap.dedent(replacement).strip() + "\n", " " * target.col_offset)
        replace(path, before, after, reason)

    replace("nbxmpp/__init__.py", 'import gi\n\ngi.require_version("Soup", "3.0")\n\n',
            "", "Remove desktop-only Soup initialization")
    p = "nbxmpp/const.py"
    replace(p, 'from gi.repository import Gio\nfrom gi.repository import GLib\nfrom packaging.version import Version\n\nGLIB_VERSION = Version(\n    f"{GLib.MAJOR_VERSION}.{GLib.MINOR_VERSION}.{GLib.MICRO_VERSION}"\n)\n',
            "", "Remove unavailable GLib version, without fabricating one")
    tree = ast.parse(current[p])
    node = next(n for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "GIO_TLS_ERRORS" for t in n.targets))
    before = "".join(current[p].splitlines(keepends=True)[node.lineno-1:node.end_lineno])
    replace(p, before, "", "Remove desktop certificate flag table")

    p = "nbxmpp/protocol.py"
    replace(p, 'from gi.repository import Gio\nfrom gi.repository import GLib',
            'from gajim_browser.nbxmpp_values import ChannelBindingType\nfrom gajim_browser.nbxmpp_values import hostname_is_ip_address\nfrom gajim_browser.nbxmpp_values import uri_unescape_string',
            "Use portable advertised channel-binding names and strict text helpers")
    replace(p, "GLib.hostname_is_ip_address(ip_address)", "hostname_is_ip_address(ip_address)", "Use stdlib IP-address recognition")
    for part in ("localpart", "resourcepart"):
        replace(p, f"            {part} = GLib.Uri.unescape_string({part})",
                f'            try:\n                {part} = uri_unescape_string({part})\n            except ValueError as error:\n                raise InvalidJid("Invalid escaped {part}") from error',
                f"Reject malformed escaped {part} without silently changing JID identity")
    replace(p, "Gio.TlsChannelBindingType", "ChannelBindingType", "Represent advertised channel binding as a portable enum", count=3)

    p = "nbxmpp/structs.py"
    replace(p, 'from gi.repository import Gio\nfrom gi.repository import GLib',
            'from gajim_browser.nbxmpp_values import ChannelBindingType\nfrom gajim_browser.nbxmpp_values import uri_escape_string\nfrom gajim_browser.nbxmpp_values import UnsupportedPlatformOperation',
            "Remove desktop imports from protocol value structs")
    replace(p, "GLib.uri_escape_string", "uri_escape_string", "Use strict URI encoding", count=2)
    replace(p, "Gio.TlsChannelBindingType", "ChannelBindingType", "Use portable channel-binding value type")
    function(p, "ProxyData.get_resolver", '''
        def get_resolver(self):
            raise UnsupportedPlatformOperation("Desktop proxy resolvers are unavailable")
    ''', "Reject desktop proxy resolver requests explicitly")

    p = "nbxmpp/util.py"
    replace(p, 'from gi.repository import Gio\nfrom gi.repository import Soup\nfrom packaging.version import Version',
            'from gajim_browser.nbxmpp_values import UnsupportedPlatformOperation', "Remove desktop TLS/version imports")
    replace(p, 'from nbxmpp.const import GIO_TLS_ERRORS\nfrom nbxmpp.const import GLIB_VERSION\n', "", "Remove unavailable desktop capability constants")
    for name in ("get_tls_error_phrase", "convert_tls_error_flags", "get_websocket_close_string"):
        function(p, name, f'''
            def {name}(*args, **kwargs):
                raise UnsupportedPlatformOperation("Desktop TLS/Soup details are unavailable")
        ''', "Reject unavailable desktop introspection: " + name)
    function(p, "min_version", '''
        def min_version(name: str, min_version: str) -> bool:
            if name == "GLib":
                return False  # The browser port has no GLib runtime.
            raise ValueError("Unknown library name")
    ''', "Do not claim any GLib capability/version")

    for p in ("nbxmpp/client.py", "nbxmpp/dispatcher.py", "nbxmpp/task.py"):
        replace(p, "from gi.repository import GLib", "from gajim_browser import nbxmpp_scheduler as scheduler", "Use cancellable browser-loop scheduling")
        count = current[p].count("GLib.")
        replace(p, "GLib.", "scheduler.", "Route timer operations to the explicit adapter", count=count)

    p = "nbxmpp/client.py"
    replace(p, "from gi.repository import Gio", "from gajim_browser.nbxmpp_values import UnsupportedPlatformOperation\nfrom gajim_browser.nbxmpp_values import ChannelBindingType", "Remove desktop client annotations/imports")
    for before, after in (("Gio.TlsCertificateFlags", "int"), ("Gio.TlsCertificate", "object"), ("Gio.TlsChannelBindingType", "ChannelBindingType"), ("Gio.SocketAddress", "object")):
        replace(p, before, after, "Use portable annotation: " + before, count=current[p].count(before))
    replace(p, "from nbxmpp.tcp import TCPConnection\n", "", "Exclude raw TCP connection import")
    replace(p, "from nbxmpp.websocket import WebsocketConnection\n", "", "Exclude desktop Soup connection import")
    function(p, "Client._get_connection", '''
        def _get_connection(self, *args: Any) -> Any:
            raise UnsupportedPlatformOperation("Browser network transport is not integrated")
    ''', "Keep connection creation disabled until an actual browser transport exists")
    replace(p, "    def connect(self) -> None:\n", '    def connect(self) -> None:\n        raise UnsupportedPlatformOperation("Browser network transport is not integrated")\n',
            "Reject connect before touching stream state or resolving addresses")

    p = "nbxmpp/sasl.py"
    replace(p, "from hashlib import pbkdf2_hmac", "from gajim_browser.nbxmpp_crypto import pbkdf2_hmac", "Use pinned cryptography PBKDF2 where the WASM hashlib build lacks it")
    replace(p, '        salted_password = pbkdf2_hmac(\n            self._hash_method, password.encode("utf8"), salt, iteration_count\n        )',
            '        try:\n            salted_password = pbkdf2_hmac(\n                self._hash_method, password.encode("utf8"), salt, iteration_count\n            )\n        except (ValueError, TypeError) as error:\n            raise AuthFail("Unsupported password-derivation parameters") from error',
            "Fail authentication cleanly when bounded KDF parameters are rejected")
    replace(p, "from gi.repository import Gio\n", "", "Remove unused desktop TLS enum import")
    function(p, "SASL._get_channel_binding_data", '''
        def _get_channel_binding_data(self, features: Features) -> ChannelBindingData | None:
            return None  # The browser WebSocket API does not expose TLS binding data.
    ''', "Report unavailable TLS binding honestly; retain upstream non-PLUS SASL logic")

    diffs = []
    for p, text in current.items():
        if text != original[p].decode():
            diffs.extend(difflib.unified_diff(original[p].decode().splitlines(keepends=True), text.splitlines(keepends=True), fromfile="a/"+p, tofile="b/"+p))
        compile(text, p, "exec")
    return {p: s.encode() for p, s in current.items()}, ledger, "".join(diffs), original


if __name__ == "__main__":
    files, ledger, diff, original = prepare()
    target = ROOT / ".build/nbxmpp"
    for name, data in {**files, **{p: b for p, b in original.items() if p.startswith("test/")}}.items():
        path = target / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    (ROOT / ".build/nbxmpp.patch").write_text(diff)
    print(json.dumps({"output": str(target), "runtime_modules": len(files), "patches": len(ledger)}))
