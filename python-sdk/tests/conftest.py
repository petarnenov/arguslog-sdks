"""Shared pytest fixtures.

The SDK is intentionally I/O-free in tests: every test that exercises ``ArguslogClient``
plugs in a ``RecordingTransport`` that captures send() bodies in memory instead of hitting
the network. This keeps the suite fast and deterministic.
"""

from __future__ import annotations

import json
import threading
from typing import Any

import pytest


class RecordingTransport:
    """Drop-in transport that records each send() body for inspection."""

    def __init__(self) -> None:
        self.bodies: list[str] = []
        self._cv = threading.Condition()

    def send(self, body: str) -> None:
        with self._cv:
            self.bodies.append(body)
            self._cv.notify_all()

    def wait_for(self, count: int, timeout: float = 1.0) -> bool:
        with self._cv:
            return self._cv.wait_for(lambda: len(self.bodies) >= count, timeout=timeout)

    def parsed(self) -> list[dict[str, Any]]:
        return [json.loads(b) for b in self.bodies]


@pytest.fixture()
def transport() -> RecordingTransport:
    return RecordingTransport()
