from __future__ import annotations

import contextlib
import json
import queue as _queue
import random
import threading
import time
import traceback
import uuid
from typing import Any, Optional

from ._dsn import parse_dsn
from ._options import ArguslogOptions
from ._scrubber import Scrubber
from ._transport import HttpTransport, TransportProtocol

SDK_NAME = "arguslog.python"
SDK_VERSION = "1.0.0"

_LEVELS = {"debug", "info", "warning", "error", "fatal"}


class ArguslogClient:
    """Background-sender error tracking client.

    Mirrors the wire format produced by java-sdk/.../ArguslogClient.java so events from a Python
    service look identical to a Java one on the ingest side.
    """

    def __init__(
        self,
        options: ArguslogOptions,
        transport: Optional[TransportProtocol] = None,
    ) -> None:
        self._options = options
        self._dsn = parse_dsn(options.dsn)
        self._transport: TransportProtocol = transport or HttpTransport(self._dsn, options.debug)
        self._scrubber = Scrubber(options.scrubbing_enabled, options.extra_scrub_patterns)
        self._queue: _queue.Queue[Optional[str]] = _queue.Queue(maxsize=options.max_queue_size)
        self._user: Optional[dict[str, Any]] = None
        self._tags: dict[str, str] = {}
        self._contexts: dict[str, dict[str, Any]] = {}
        self._breadcrumbs: list[dict[str, Any]] = []
        self._max_breadcrumbs = 50
        self._lock = threading.Lock()
        self._running = True
        self._worker = threading.Thread(target=self._pump, name="arguslog-sender", daemon=True)
        self._worker.start()

    # --- public mutators ----------------------------------------------------

    def set_user(self, user: Optional[dict[str, Any]]) -> None:
        with self._lock:
            self._user = dict(user) if user else None

    def set_tag(self, key: str, value: str) -> None:
        with self._lock:
            self._tags[key] = value

    def set_context(self, name: str, ctx: dict[str, Any]) -> None:
        with self._lock:
            self._contexts[name] = dict(ctx)

    def add_breadcrumb(self, crumb: dict[str, Any]) -> None:
        with self._lock:
            entry = dict(crumb)
            entry.setdefault("timestamp", int(time.time() * 1000))
            self._breadcrumbs.append(entry)
            if len(self._breadcrumbs) > self._max_breadcrumbs:
                self._breadcrumbs = self._breadcrumbs[-self._max_breadcrumbs :]

    # --- capture ------------------------------------------------------------

    def capture_exception(
        self,
        error: BaseException,
        level: str = "error",
        tags: Optional[dict[str, str]] = None,
    ) -> Optional[str]:
        if not self._should_sample():
            return None
        event = self._base_event(level)
        event["exception"] = {
            "values": [
                {
                    "type": type(error).__name__,
                    "value": self._scrubber.scrub(str(error) if error.args else ""),
                    "stacktrace": {
                        "raw": "".join(
                            traceback.format_exception(type(error), error, error.__traceback__)
                        )
                    },
                }
            ]
        }
        if tags:
            event.setdefault("tags", {}).update(tags)
        return self._enqueue(event)

    def capture_message(
        self, message: str, level: str = "info", tags: Optional[dict[str, str]] = None
    ) -> Optional[str]:
        if not self._should_sample():
            return None
        event = self._base_event(level)
        event["message"] = self._scrubber.scrub(message)
        if tags:
            event.setdefault("tags", {}).update(tags)
        return self._enqueue(event)

    # --- lifecycle ----------------------------------------------------------

    def flush(self, timeout: Optional[float] = None) -> None:
        deadline = time.monotonic() + (
            self._options.flush_timeout_seconds if timeout is None else timeout
        )
        while not self._queue.empty() and time.monotonic() < deadline:
            time.sleep(0.02)

    def close(self) -> None:
        self.flush()
        self._running = False
        # sentinel to wake the pump if it's blocked on get()
        with contextlib.suppress(_queue.Full):
            self._queue.put_nowait(None)

    # --- internals ----------------------------------------------------------

    def _should_sample(self) -> bool:
        rate = self._options.sample_rate
        if rate >= 1.0:
            return True
        if rate <= 0.0:
            return False
        return random.random() < rate

    def _base_event(self, level: str) -> dict[str, Any]:
        normalized = level if level in _LEVELS else "error"
        event: dict[str, Any] = {
            "eventId": uuid.uuid4().hex,
            "timestamp": int(time.time() * 1000),
            "platform": "python",
            "level": normalized,
            "sdk": {"name": SDK_NAME, "version": SDK_VERSION},
        }
        if self._options.environment:
            event["environment"] = self._options.environment
        if self._options.release:
            event["release"] = self._options.release
        with self._lock:
            if self._user:
                event["user"] = dict(self._user)
            if self._tags:
                event["tags"] = dict(self._tags)
            if self._contexts:
                event["contexts"] = {k: dict(v) for k, v in self._contexts.items()}
            if self._breadcrumbs:
                event["breadcrumbs"] = list(self._breadcrumbs)
        return event

    def _enqueue(self, event: dict[str, Any]) -> Optional[str]:
        body = json.dumps(event, separators=(",", ":"), ensure_ascii=False)
        try:
            self._queue.put_nowait(body)
        except _queue.Full:
            if self._options.debug:
                import sys

                print("[arguslog] queue full, dropping event", file=sys.stderr)
            return None
        return event["eventId"]

    def _pump(self) -> None:
        while self._running:
            try:
                body = self._queue.get(timeout=0.5)
            except _queue.Empty:
                continue
            if body is None:
                break
            try:
                self._transport.send(body)
            except Exception:
                if self._options.debug:
                    import sys

                    traceback.print_exc(file=sys.stderr)
        # drain on shutdown
        while True:
            try:
                body = self._queue.get_nowait()
            except _queue.Empty:
                return
            if body is None:
                continue
            with contextlib.suppress(Exception):
                self._transport.send(body)
