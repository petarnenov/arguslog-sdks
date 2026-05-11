"""Install a ``sys.excepthook`` wrapper that captures unhandled exceptions before delegating
to the previous hook. The previous hook is preserved so existing crash-reporting tooling
(IPython, debuggers, etc.) keeps working — we never replace it outright.
"""

from __future__ import annotations

import sys
from types import TracebackType
from typing import Callable, Optional

from .._client import ArguslogClient

ExceptHook = Callable[
    [type[BaseException], BaseException, Optional[TracebackType]],
    None,
]


def install_excepthook(client: ArguslogClient) -> Callable[[], None]:
    """Wrap ``sys.excepthook`` so uncaught exceptions are captured.

    Returns an ``uninstall`` callable for tests / hot-reload teardown.
    """
    previous: ExceptHook = sys.excepthook

    def hook(
        exc_type: type[BaseException],
        exc_value: BaseException,
        exc_tb: Optional[TracebackType],
    ) -> None:
        # KeyboardInterrupt is user intent, not an error worth tracking.
        if not issubclass(exc_type, KeyboardInterrupt):
            try:
                client.capture_exception(exc_value, tags={"integration": "excepthook"})
                client.flush()
            except Exception:
                pass
        previous(exc_type, exc_value, exc_tb)

    sys.excepthook = hook

    def uninstall() -> None:
        if sys.excepthook is hook:
            sys.excepthook = previous

    return uninstall
