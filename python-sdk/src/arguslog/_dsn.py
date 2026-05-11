"""DSN parser kept in lockstep with packages/sdk-browser/src/dsn.ts and
java-sdk/src/main/java/org/arguslog/sdk/Dsn.java.

User-facing DSN format: arguslog://<publicKey>@<host>/api/<projectId>
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_DSN_RE = re.compile(r"^arguslog://([^@]+)@([^/]+)/api/([^/?#]+)$")
_LOOPBACK_HOSTS = {"localhost", "0.0.0.0", "[::1]", "::1"}


class InvalidDsnError(ValueError):
    """Raised when a DSN string fails to match the expected shape."""


@dataclass(frozen=True)
class ParsedDsn:
    public_key: str
    host: str
    scheme: str
    project_id: str
    ingest_url: str


def parse_dsn(raw: str) -> ParsedDsn:
    if raw is None:
        raise InvalidDsnError("dsn is required")
    match = _DSN_RE.match(raw)
    if not match:
        raise InvalidDsnError(f"Invalid DSN: {raw}")
    public_key, host, project_id = match.group(1), match.group(2), match.group(3)
    if not public_key or not host or not project_id:
        raise InvalidDsnError(f"Invalid DSN: {raw}")
    scheme = "http" if _is_dev_host(host) else "https"
    ingest_url = f"{scheme}://{host}/api/{project_id}/events"
    return ParsedDsn(public_key, host, scheme, project_id, ingest_url)


def _is_dev_host(host: str) -> bool:
    bare = host[: host.index("]") + 1] if host.startswith("[") else host.split(":", 1)[0]
    if bare in _LOOPBACK_HOSTS or bare.startswith("127."):
        return True
    # RFC1918 private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16. A device on the same
    # LAN pointing at the dev box is still a dev-mode transport; ingest only listens on plain
    # HTTP locally, so HTTPS upgrade would fail the TLS handshake silently.
    parts = bare.split(".")
    if len(parts) != 4:
        return False
    try:
        a, b, c, d = (int(p) for p in parts)
    except ValueError:
        return False
    if not all(0 <= n <= 255 for n in (a, b, c, d)):
        return False
    if a == 10:
        return True
    if a == 192 and b == 168:
        return True
    return a == 172 and 16 <= b <= 31
