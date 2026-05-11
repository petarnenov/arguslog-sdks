from __future__ import annotations

import sys

from arguslog import ArguslogClient, ArguslogOptions
from arguslog.integrations.excepthook import install_excepthook

from .conftest import RecordingTransport


def _make_client(transport: RecordingTransport) -> ArguslogClient:
    return ArguslogClient(
        ArguslogOptions(dsn="arguslog://k@localhost:8080/api/1"), transport=transport
    )


def test_excepthook_captures_then_delegates(transport: RecordingTransport) -> None:
    client = _make_client(transport)
    previous_calls: list[str] = []
    sys.excepthook = lambda et, ev, tb: previous_calls.append(type(ev).__name__)

    uninstall = install_excepthook(client)
    try:
        try:
            raise RuntimeError("kaboom")
        except RuntimeError:
            sys.excepthook(*sys.exc_info())  # type: ignore[arg-type]
    finally:
        uninstall()
        client.close()

    assert previous_calls == ["RuntimeError"], "previous excepthook must still fire"
    assert transport.bodies, "exception was not forwarded to the client"
    payload = transport.parsed()[0]
    assert payload["exception"]["values"][0]["type"] == "RuntimeError"
    assert payload["tags"]["integration"] == "excepthook"


def test_keyboard_interrupt_passed_through(transport: RecordingTransport) -> None:
    client = _make_client(transport)
    previous_calls: list[str] = []
    sys.excepthook = lambda et, ev, tb: previous_calls.append(type(ev).__name__)

    uninstall = install_excepthook(client)
    try:
        try:
            raise KeyboardInterrupt()
        except KeyboardInterrupt:
            sys.excepthook(*sys.exc_info())  # type: ignore[arg-type]
    finally:
        uninstall()
        client.close()

    assert previous_calls == ["KeyboardInterrupt"]
    assert transport.bodies == [], "Ctrl-C must not be reported as an error"


def test_uninstall_restores_previous_hook(transport: RecordingTransport) -> None:
    client = _make_client(transport)
    sentinel = sys.excepthook
    uninstall = install_excepthook(client)
    assert sys.excepthook is not sentinel
    uninstall()
    assert sys.excepthook is sentinel
    client.close()
