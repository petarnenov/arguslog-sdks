"""Arguslog Python SDK — error tracking for server-side Python apps.

Public API mirrors the JS/Java SDKs: a module-level facade calling into a singleton
``ArguslogClient``. Most apps only need ``init`` + ``capture_exception`` + ``flush``.
"""

from __future__ import annotations

import threading
from typing import Any, Optional, Union

from ._client import SDK_NAME, SDK_VERSION, ArguslogClient
from ._dsn import InvalidDsnError, ParsedDsn, parse_dsn
from ._options import ArguslogOptions
from ._scrubber import REDACTED, Scrubber
from ._transport import HttpTransport, TransportProtocol

__all__ = [
    "REDACTED",
    "SDK_NAME",
    "SDK_VERSION",
    "ArguslogClient",
    "ArguslogOptions",
    "HttpTransport",
    "InvalidDsnError",
    "ParsedDsn",
    "Scrubber",
    "TransportProtocol",
    "add_breadcrumb",
    "capture_exception",
    "capture_message",
    "close",
    "flush",
    "get_client",
    "init",
    "parse_dsn",
    "set_context",
    "set_tag",
    "set_user",
]

_client: Optional[ArguslogClient] = None
_lock = threading.Lock()


def init(
    options_or_dsn: Union[ArguslogOptions, str],
    transport: Optional[TransportProtocol] = None,
    **kwargs: Any,
) -> ArguslogClient:
    """Initialize the singleton client.

    Convenience: ``init("arguslog://k@host/api/1")`` is equivalent to passing an
    ``ArguslogOptions(dsn=...)``. Extra kwargs map onto ``ArguslogOptions`` fields.
    """
    global _client
    if isinstance(options_or_dsn, ArguslogOptions):
        options = options_or_dsn
    else:
        options = ArguslogOptions(dsn=options_or_dsn, **kwargs)

    with _lock:
        if _client is not None:
            _client.close()
        _client = ArguslogClient(options, transport=transport)
        return _client


def get_client() -> Optional[ArguslogClient]:
    return _client


def capture_exception(
    error: BaseException,
    level: str = "error",
    tags: Optional[dict[str, str]] = None,
) -> Optional[str]:
    return _client.capture_exception(error, level=level, tags=tags) if _client else None


def capture_message(
    message: str, level: str = "info", tags: Optional[dict[str, str]] = None
) -> Optional[str]:
    return _client.capture_message(message, level=level, tags=tags) if _client else None


def set_user(user: Optional[dict[str, Any]]) -> None:
    if _client:
        _client.set_user(user)


def set_tag(key: str, value: str) -> None:
    if _client:
        _client.set_tag(key, value)


def set_context(name: str, ctx: dict[str, Any]) -> None:
    if _client:
        _client.set_context(name, ctx)


def add_breadcrumb(crumb: dict[str, Any]) -> None:
    if _client:
        _client.add_breadcrumb(crumb)


def flush(timeout: Optional[float] = None) -> None:
    if _client:
        _client.flush(timeout=timeout)


def close() -> None:
    global _client
    with _lock:
        if _client is not None:
            _client.close()
            _client = None


def _reset_for_tests() -> None:
    """Internal hook used by the test suite to reset the singleton between tests."""
    global _client
    with _lock:
        if _client is not None:
            _client.close()
            _client = None
