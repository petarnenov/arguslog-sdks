from __future__ import annotations

import json

import pytest

import arguslog
from arguslog import ArguslogClient, ArguslogOptions

from .conftest import RecordingTransport


@pytest.fixture(autouse=True)
def _reset() -> None:
    arguslog._reset_for_tests()
    yield
    arguslog._reset_for_tests()


def _client(transport: RecordingTransport, **overrides) -> ArguslogClient:
    opts = ArguslogOptions(dsn="arguslog://k@localhost:8080/api/1", **overrides)
    return ArguslogClient(opts, transport=transport)


def test_capture_exception_emits_event(transport: RecordingTransport) -> None:
    c = _client(transport)
    err = ValueError("boom")
    event_id = c.capture_exception(err)
    assert event_id is not None
    c.flush()
    assert transport.wait_for(1)
    payload = transport.parsed()[0]
    assert payload["eventId"] == event_id
    assert payload["platform"] == "python"
    assert payload["level"] == "error"
    assert payload["exception"]["values"][0]["type"] == "ValueError"
    assert "boom" in payload["exception"]["values"][0]["value"]
    c.close()


def test_capture_message_emits_event(transport: RecordingTransport) -> None:
    c = _client(transport)
    c.capture_message("hello", level="warning")
    c.flush()
    assert transport.wait_for(1)
    payload = transport.parsed()[0]
    assert payload["message"] == "hello"
    assert payload["level"] == "warning"
    c.close()


def test_user_tags_context_attached(transport: RecordingTransport) -> None:
    c = _client(transport, environment="prod", release="1.2.3")
    c.set_user({"id": "u1"})
    c.set_tag("region", "eu")
    c.set_context("order", {"id": 42})
    c.add_breadcrumb({"category": "nav", "message": "/cart"})
    c.capture_message("checkout")
    c.flush()
    assert transport.wait_for(1)
    payload = transport.parsed()[0]
    assert payload["user"] == {"id": "u1"}
    assert payload["tags"]["region"] == "eu"
    assert payload["contexts"]["order"] == {"id": 42}
    assert payload["breadcrumbs"][0]["category"] == "nav"
    assert payload["environment"] == "prod"
    assert payload["release"] == "1.2.3"
    c.close()


def test_pii_scrubbed_in_message(transport: RecordingTransport) -> None:
    c = _client(transport)
    c.capture_message("contact alice@example.com")
    c.flush()
    assert transport.wait_for(1)
    payload = transport.parsed()[0]
    assert "alice@example.com" not in payload["message"]
    assert "[REDACTED]" in payload["message"]
    c.close()


def test_zero_sample_rate_drops(transport: RecordingTransport) -> None:
    c = _client(transport, sample_rate=0.0)
    assert c.capture_message("dropped") is None
    c.flush()
    assert transport.bodies == []
    c.close()


def test_breadcrumbs_capped_at_50(transport: RecordingTransport) -> None:
    c = _client(transport)
    for i in range(60):
        c.add_breadcrumb({"message": f"b{i}"})
    c.capture_message("evt")
    c.flush()
    assert transport.wait_for(1)
    crumbs = transport.parsed()[0]["breadcrumbs"]
    assert len(crumbs) == 50
    assert crumbs[0]["message"] == "b10"
    assert crumbs[-1]["message"] == "b59"
    c.close()


def test_module_facade_init_and_capture(transport: RecordingTransport) -> None:
    arguslog.init("arguslog://k@localhost:8080/api/9", transport=transport)
    arguslog.capture_message("via facade")
    arguslog.flush()
    assert transport.wait_for(1)
    payload = transport.parsed()[0]
    assert payload["message"] == "via facade"


def test_close_drains_pending(transport: RecordingTransport) -> None:
    c = _client(transport)
    for i in range(5):
        c.capture_message(f"m{i}")
    c.close()
    # close() drains; all five should have made it through
    assert len(transport.bodies) == 5
    seen = sorted(json.loads(b)["message"] for b in transport.bodies)
    assert seen == [f"m{i}" for i in range(5)]
