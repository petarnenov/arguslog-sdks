from __future__ import annotations

import logging

from arguslog import ArguslogClient, ArguslogOptions
from arguslog.integrations.logging import (
    ArguslogLoggingHandler,
    install_logging_handler,
)

from .conftest import RecordingTransport


def _make_client(transport: RecordingTransport) -> ArguslogClient:
    return ArguslogClient(
        ArguslogOptions(dsn="arguslog://k@localhost:8080/api/1"), transport=transport
    )


def test_error_with_exc_info_becomes_capture_exception(
    transport: RecordingTransport,
) -> None:
    client = _make_client(transport)
    logger = logging.getLogger("test_error_with_exc")
    logger.setLevel(logging.DEBUG)
    handler = ArguslogLoggingHandler(client, level=logging.ERROR)
    logger.addHandler(handler)

    try:
        try:
            raise RuntimeError("logged-fail")
        except RuntimeError:
            logger.error("something went wrong", exc_info=True)
    finally:
        logger.removeHandler(handler)
        client.close()

    payload = transport.parsed()[0]
    assert payload["exception"]["values"][0]["type"] == "RuntimeError"
    assert payload["tags"]["logger"] == "test_error_with_exc"


def test_warning_without_exc_info_becomes_capture_message(
    transport: RecordingTransport,
) -> None:
    client = _make_client(transport)
    logger = logging.getLogger("test_warn")
    logger.setLevel(logging.DEBUG)
    handler = ArguslogLoggingHandler(client, level=logging.WARNING)
    logger.addHandler(handler)

    try:
        logger.warning("getting close to disk full")
    finally:
        logger.removeHandler(handler)
        client.close()

    payload = transport.parsed()[0]
    assert payload["message"] == "getting close to disk full"
    assert payload["level"] == "warning"


def test_below_threshold_is_dropped(transport: RecordingTransport) -> None:
    client = _make_client(transport)
    logger = logging.getLogger("test_below")
    logger.setLevel(logging.DEBUG)
    handler = ArguslogLoggingHandler(client, level=logging.ERROR)
    logger.addHandler(handler)

    try:
        logger.info("noise")
    finally:
        logger.removeHandler(handler)
        client.close()

    assert transport.bodies == []


def test_critical_maps_to_fatal(transport: RecordingTransport) -> None:
    client = _make_client(transport)
    logger = logging.getLogger("test_critical")
    logger.setLevel(logging.DEBUG)
    handler = ArguslogLoggingHandler(client, level=logging.DEBUG)
    logger.addHandler(handler)

    try:
        logger.critical("system on fire")
    finally:
        logger.removeHandler(handler)
        client.close()

    payload = transport.parsed()[0]
    assert payload["level"] == "fatal"


def test_install_helper_attaches_to_root(transport: RecordingTransport) -> None:
    client = _make_client(transport)
    root = logging.getLogger()
    handler = install_logging_handler(client, level=logging.ERROR)
    try:
        assert handler in root.handlers
    finally:
        root.removeHandler(handler)
        client.close()
