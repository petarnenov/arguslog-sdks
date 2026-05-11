"""Cross-SDK parity test. The canonical fixture lives at scripts/dsn-test-fixtures.json (repo
root); the TS and Java SDKs run identical assertions against the same file. Adding an edge
case there means all three SDKs run it on next CI; whichever fails the parity check gets
fixed. Prevents the "fixed it in TS, forgot Java" drift that bit us 2026-05-09.

Path math: this file is at python-sdk/tests/test_dsn_fixtures.py; the fixture sits three levels
up plus into scripts.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from arguslog import InvalidDsnError, parse_dsn

_FIXTURES_PATH = (
    Path(__file__).resolve().parent.parent.parent / "scripts" / "dsn-test-fixtures.json"
)


def _load_fixtures() -> list[dict]:
    with _FIXTURES_PATH.open("r", encoding="utf-8") as fh:
        return json.load(fh)


@pytest.mark.parametrize("fixture", _load_fixtures(), ids=lambda fx: fx["name"])
def test_shared_fixture(fixture: dict) -> None:
    dsn = fixture["dsn"]
    if not fixture["valid"]:
        with pytest.raises(InvalidDsnError):
            parse_dsn(dsn)
        return

    parsed = parse_dsn(dsn)
    if "scheme" in fixture:
        assert parsed.scheme == fixture["scheme"]
    if "publicKey" in fixture:
        assert parsed.public_key == fixture["publicKey"]
    if "host" in fixture:
        assert parsed.host == fixture["host"]
    if "projectId" in fixture:
        assert parsed.project_id == fixture["projectId"]
    if "ingestUrl" in fixture:
        assert parsed.ingest_url == fixture["ingestUrl"]
