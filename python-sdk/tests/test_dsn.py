from __future__ import annotations

import pytest

from arguslog import InvalidDsnError, parse_dsn


def test_parses_basic_dsn() -> None:
    parsed = parse_dsn("arguslog://abc@example.com/api/42")
    assert parsed.public_key == "abc"
    assert parsed.host == "example.com"
    assert parsed.project_id == "42"
    assert parsed.scheme == "https"
    assert parsed.ingest_url == "https://example.com/api/42/events"


def test_loopback_host_uses_http() -> None:
    parsed = parse_dsn("arguslog://k@localhost:8080/api/1")
    assert parsed.scheme == "http"
    assert parsed.ingest_url == "http://localhost:8080/api/1/events"


def test_loopback_127_dotted_quad() -> None:
    parsed = parse_dsn("arguslog://k@127.0.0.1:8080/api/1")
    assert parsed.scheme == "http"


# RFC1918 + just-outside-the-range cases live in scripts/dsn-test-fixtures.json so all three
# SDKs run identical assertions; see test_dsn_fixtures.py.


@pytest.mark.parametrize(
    "raw",
    [
        "https://wrong-scheme/api/1",
        "arguslog://no-host",
        "arguslog://@host/api/1",
        "arguslog://k@host/api/",
        "arguslog://k@host/wrong/1",
        "",
    ],
)
def test_rejects_invalid_dsn(raw: str) -> None:
    with pytest.raises(InvalidDsnError):
        parse_dsn(raw)


def test_rejects_none() -> None:
    with pytest.raises(InvalidDsnError):
        parse_dsn(None)  # type: ignore[arg-type]
