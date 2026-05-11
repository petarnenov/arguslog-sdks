"""PII scrubber. Mirrors the patterns shipped in sdk-core/src/scrubber.ts and
java-sdk/.../Scrubber.java so an event scrubbed in any language looks the same on the wire."""

from __future__ import annotations

import re
from collections.abc import Iterable
from re import Pattern

# Default patterns: email, JWT-shaped tokens, credit-card-ish digit runs.
_DEFAULT_PATTERNS: list[Pattern[str]] = [
    re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    re.compile(r"\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\b"),
    re.compile(r"\b(?:\d[ -]?){13,19}\b"),
]

REDACTED = "[REDACTED]"


class Scrubber:
    def __init__(self, enabled: bool = True, extra_patterns: Iterable[str] = ()) -> None:
        self._enabled = enabled
        compiled = list(_DEFAULT_PATTERNS)
        for raw in extra_patterns:
            compiled.append(re.compile(raw))
        self._patterns = compiled

    def scrub(self, value: str) -> str:
        if not self._enabled or not value:
            return value
        out = value
        for pattern in self._patterns:
            out = pattern.sub(REDACTED, out)
        return out
