from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ArguslogOptions:
    """Configuration for ArguslogClient. DSN is the only required field; the rest match the
    cross-language defaults from the Java/Node SDKs so an event payload from a Python service
    is shaped identically to one from a JVM service."""

    dsn: str
    environment: Optional[str] = None
    release: Optional[str] = None
    sample_rate: float = 1.0
    max_queue_size: int = 256
    flush_timeout_seconds: float = 2.0
    scrubbing_enabled: bool = True
    extra_scrub_patterns: list[str] = field(default_factory=list)
    debug: bool = False

    def __post_init__(self) -> None:
        if not self.dsn:
            raise ValueError("dsn is required")
        if not 0.0 <= self.sample_rate <= 1.0:
            raise ValueError("sample_rate must be in [0, 1]")
        if self.max_queue_size <= 0:
            raise ValueError("max_queue_size must be > 0")
