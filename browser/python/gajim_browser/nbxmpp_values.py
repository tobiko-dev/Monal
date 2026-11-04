"""Explicit portable values/helpers for nbxmpp; no GI emulation or networking."""

from enum import StrEnum
from ipaddress import ip_address
import re
from urllib.parse import quote, unquote_to_bytes


class UnsupportedPlatformOperation(RuntimeError):
    """The browser port does not provide this desktop capability."""


class ChannelBindingType(StrEnum):
    # Describes a server's advertised names, not locally available TLS material.
    EXPORTER = "tls-exporter"
    SERVER_END_POINT = "tls-server-end-point"


def hostname_is_ip_address(hostname: str) -> bool:
    try:
        ip_address(hostname)
    except ValueError:
        return False
    return True


def uri_unescape_string(value: str) -> str:
    # urllib's default unquote tolerates malformed escapes/UTF-8. A JID must
    # never silently change identity through replacement characters or None.
    if re.search(r"%(?![0-9a-fA-F]{2})", value):
        raise ValueError("Invalid URI escape")
    result = unquote_to_bytes(value).decode("utf-8", errors="strict")
    if "\0" in result:
        raise ValueError("NUL is not allowed in URI text")
    return result


def uri_escape_string(value: str, reserved_chars_allowed: str | None = None,
                      allow_utf8: bool = False) -> str:
    if allow_utf8:
        raise UnsupportedPlatformOperation("Only UTF-8 percent encoding is supported")
    if "\0" in value:
        raise ValueError("NUL is not allowed in URI text")
    return quote(value, safe=reserved_chars_allowed or "", encoding="utf-8", errors="strict")
