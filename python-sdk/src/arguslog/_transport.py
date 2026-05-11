"""HTTP transport using stdlib urllib so the SDK has zero runtime dependencies.

In tests we substitute a fake transport via ArguslogClient(transport=...). Production callers
never instantiate this directly — it's owned by the client.
"""

from __future__ import annotations

import sys
import urllib.error
import urllib.request
from typing import Protocol

from ._dsn import ParsedDsn


class TransportProtocol(Protocol):
    def send(self, body: str) -> None: ...


class HttpTransport:
    def __init__(self, dsn: ParsedDsn, debug: bool = False, timeout: float = 5.0) -> None:
        self._dsn = dsn
        self._debug = debug
        self._timeout = timeout

    def send(self, body: str) -> None:
        request = urllib.request.Request(
            self._dsn.ingest_url,
            data=body.encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "X-Arguslog-Auth": f"Arguslog DSN {self._dsn.public_key}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                if self._debug and response.status >= 300:
                    print(
                        f"[arguslog] non-2xx response: {response.status}",
                        file=sys.stderr,
                    )
        except (urllib.error.URLError, OSError) as exc:
            # SDKs must never crash host apps.
            if self._debug:
                print(f"[arguslog] transport error: {exc}", file=sys.stderr)
