from __future__ import annotations

from arguslog import REDACTED, Scrubber


def test_disabled_scrubber_passes_through() -> None:
    s = Scrubber(enabled=False)
    assert s.scrub("alice@example.com") == "alice@example.com"


def test_email_redacted() -> None:
    s = Scrubber()
    assert REDACTED in s.scrub("contact alice@example.com please")


def test_jwt_redacted() -> None:
    # Synthetic JWT-shaped fixture so the scrubber regex has something to match.
    # Allowlisted by path in .gitleaks.toml.
    token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4f"
    out = Scrubber().scrub(f"Bearer {token}")
    assert REDACTED in out
    assert token not in out


def test_credit_card_redacted() -> None:
    out = Scrubber().scrub("card 4242 4242 4242 4242 was charged")
    assert REDACTED in out


def test_extra_pattern_redacted() -> None:
    s = Scrubber(extra_patterns=[r"INTERNAL-\d+"])
    assert REDACTED in s.scrub("see ticket INTERNAL-9182 for context")


def test_empty_string_short_circuits() -> None:
    assert Scrubber().scrub("") == ""
