"""``logging.Handler`` that forwards records into Arguslog.

Mirrors the role of the Logback appender in the Java SDK: ERROR-or-higher records with an
attached exception become ``capture_exception`` calls; everything else becomes a
``capture_message`` if the level is at or above the handler's threshold.
"""

from __future__ import annotations

import logging
from typing import Optional

from .._client import ArguslogClient

_PY_TO_ARGUSLOG_LEVEL = {
    logging.DEBUG: "debug",
    logging.INFO: "info",
    logging.WARNING: "warning",
    logging.ERROR: "error",
    logging.CRITICAL: "fatal",
}


class ArguslogLoggingHandler(logging.Handler):
    def __init__(self, client: ArguslogClient, level: int = logging.ERROR) -> None:
        super().__init__(level=level)
        self._client = client

    def emit(self, record: logging.LogRecord) -> None:
        try:
            arguslog_level = _arguslog_level_for(record.levelno)
            tags = {"logger": record.name}
            exc_info = record.exc_info
            if exc_info and exc_info[1] is not None:
                self._client.capture_exception(exc_info[1], level=arguslog_level, tags=tags)
            else:
                self._client.capture_message(self.format(record), level=arguslog_level, tags=tags)
        except Exception:
            self.handleError(record)


def _arguslog_level_for(levelno: int) -> str:
    # Python lets users register custom numeric levels; map any unknown value to the closest
    # standard one rather than dropping the record.
    for threshold in sorted(_PY_TO_ARGUSLOG_LEVEL.keys(), reverse=True):
        if levelno >= threshold:
            return _PY_TO_ARGUSLOG_LEVEL[threshold]
    return "debug"


def install_logging_handler(
    client: ArguslogClient, level: int = logging.ERROR, logger: Optional[logging.Logger] = None
) -> ArguslogLoggingHandler:
    """Attach a handler to the given logger (root logger by default)."""
    target = logger or logging.getLogger()
    handler = ArguslogLoggingHandler(client, level=level)
    target.addHandler(handler)
    return handler
