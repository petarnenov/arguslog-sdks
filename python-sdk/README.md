# arguslog (Python SDK)

[![PyPI version](https://img.shields.io/pypi/v/arguslog.svg)](https://pypi.org/project/arguslog/)
[![Python versions](https://img.shields.io/pypi/pyversions/arguslog.svg)](https://pypi.org/project/arguslog/)
[![License](https://img.shields.io/pypi/l/arguslog.svg)](https://github.com/petarnenov/arguslog/blob/main/LICENSE)

Python SDK for [Arguslog](https://arguslog.org) — a multi-tenant error tracking platform.
Captures unhandled exceptions, manually-reported errors, and `logging` records from
Python 3.9+ apps, then ships them to the Arguslog ingest endpoint where they're
fingerprinted, stored, and surfaced on the dashboard.

**Zero runtime dependencies.** Uses stdlib `urllib.request` for transport and
`threading.Thread` for the background sender. No `requests`, no `httpx`, no async
runtime — drops cleanly into any Python service.

## Install

```bash
pip install arguslog
# or
poetry add arguslog
# or
uv add arguslog
```

## Quick start

```python
import arguslog

arguslog.init(
    "arguslog://<key>@<host>/api/<projectId>",
    environment="production",
    release="1.2.3",
)

try:
    do_something_risky()
except Exception as exc:
    arguslog.capture_exception(exc)

# Always flush before short-lived processes exit — the background sender
# won't get a chance to drain otherwise.
arguslog.flush()
```

The SDK is a no-op until `init` runs, so importing the module from places that load
before bootstrap is safe.

## DSN format

```
arguslog://<publicKey>@<host>/api/<projectId>
```

The `publicKey` is project-scoped. Get it from your Arguslog project settings page;
load it from `os.environ` like any other secret.

## Public API

The module-level functions wrap a singleton `ArguslogClient` — same shape across the
JS / Java / Python SDKs so events from a Python service look identical to ones from a
Node service for the same project.

```python
arguslog.init(dsn_or_options, transport=None, **options)   # → ArguslogClient
arguslog.get_client() -> Optional[ArguslogClient]

arguslog.capture_exception(exc, level="error", tags=None) -> Optional[str]   # event id
arguslog.capture_message(msg, level="info", tags=None)    -> Optional[str]

arguslog.set_user({"id": ..., "email": ..., "username": ...})  # email auto-scrubbed
arguslog.set_tag(key, value)
arguslog.set_context(name, dict)
arguslog.add_breadcrumb({"category": ..., "message": ..., "level": ..., "data": {...}})

arguslog.flush()        # block until queue drained or flush_timeout_seconds elapses
arguslog.close()        # flush + tear down background thread
```

`init` accepts either a DSN string (with optional kwargs) or an `ArguslogOptions`
instance:

```python
from arguslog import ArguslogOptions, init

init(
    ArguslogOptions(
        dsn="arguslog://<key>@<host>/api/<projectId>",
        environment="production",
        release="1.2.3",
        sample_rate=1.0,
        max_queue_size=256,
        flush_timeout_seconds=2.0,
        scrubbing_enabled=True,
        extra_scrub_patterns=[r"cust_[a-z0-9]+"],
        debug=False,
    )
)
```

| Option                  | Type            | Default | Notes                                                             |
| ----------------------- | --------------- | ------- | ----------------------------------------------------------------- |
| `dsn`                   | `str`           | _req._  | See "DSN format" above.                                           |
| `environment`           | `str`           | `None`  | E.g. `production`, `staging`.                                     |
| `release`               | `str`           | `None`  | Free-form version stamped on every event.                         |
| `sample_rate`           | `float` 0.0–1.0 | `1.0`   | Fraction of events kept.                                          |
| `max_queue_size`        | `int`           | `256`   | Background queue size; events dropped when full (logged at WARN). |
| `flush_timeout_seconds` | `float`         | `2.0`   | Upper bound for `flush()`.                                        |
| `scrubbing_enabled`     | `bool`          | `True`  | Redact emails/IPs/credit-cards from messages and contexts.        |
| `extra_scrub_patterns`  | `list[str]`     | `[]`    | Extra regex strings to scrub.                                     |
| `debug`                 | `bool`          | `False` | Logs every send to stderr — never enable in production.           |

## Integrations

### Uncaught exceptions (`sys.excepthook`)

Captures anything that propagates out of your top-level frame (and that hasn't been
caught by `try/except`). Preserves the previous hook so debuggers / IPython keep
working.

```python
import arguslog
from arguslog.integrations.excepthook import install_excepthook

arguslog.init("arguslog://<key>@<host>/api/<projectId>")
install_excepthook(arguslog.get_client())
```

`install_excepthook` returns an `uninstall()` callable for tests / hot-reload teardown.
`KeyboardInterrupt` is intentionally not captured (it's user intent, not an error).

### `logging` integration

Forwards `logging.ERROR`-or-higher records into Arguslog as either `capture_exception`
(when `exc_info` is attached) or `capture_message`:

```python
import logging
import arguslog
from arguslog.integrations.logging import install_logging_handler

arguslog.init("arguslog://<key>@<host>/api/<projectId>")
install_logging_handler(arguslog.get_client(), level=logging.ERROR)

logger = logging.getLogger("billing")

try:
    charge_card(order_id)
except Exception:
    logger.exception("payment failed")  # → capture_exception with full traceback
```

Records carry the logger name as a `logger` tag so dashboard filters can pivot on it.

The mapping is:

| Python level | Arguslog level |
| ------------ | -------------- |
| `DEBUG`      | `debug`        |
| `INFO`       | `info`         |
| `WARNING`    | `warning`      |
| `ERROR`      | `error`        |
| `CRITICAL`   | `fatal`        |

Custom numeric levels round down to the nearest standard level.

## Framework recipes

### Flask

```python
from flask import Flask, g, request
import arguslog
from arguslog.integrations.excepthook import install_excepthook

arguslog.init(os.environ["ARGUSLOG_DSN"], release=os.environ.get("RELEASE"))
install_excepthook(arguslog.get_client())

app = Flask(__name__)

@app.before_request
def attach_user():
    arguslog.add_breadcrumb({
        "category": "http",
        "message": f"{request.method} {request.path}",
        "level": "info",
        "data": {"method": request.method, "path": request.path},
    })
    if user := getattr(g, "user", None):
        arguslog.set_user({"id": str(user.id), "email": user.email})

@app.errorhandler(Exception)
def on_error(exc):
    arguslog.capture_exception(exc, tags={"framework": "flask"})
    raise  # let Flask's default handler render the 500
```

For better isolation, push these into per-request thread-locals using `flask.g` and a
`teardown_request` that calls `arguslog.set_user(None)`.

### Django

```python
# myproject/middleware.py
import arguslog

class ArguslogMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        arguslog.add_breadcrumb({
            "category": "http",
            "message": f"{request.method} {request.path}",
            "level": "info",
        })
        if request.user.is_authenticated:
            arguslog.set_user({"id": str(request.user.pk), "email": request.user.email})
        return self.get_response(request)

    def process_exception(self, request, exception):
        arguslog.capture_exception(exception, tags={"framework": "django"})
        return None  # let Django render its own error page
```

```python
# settings.py
MIDDLEWARE = [
    "myproject.middleware.ArguslogMiddleware",
    *MIDDLEWARE,
]
```

Add `arguslog.init(os.environ["ARGUSLOG_DSN"])` to your `wsgi.py` / `asgi.py` so the SDK
boots before the first request lands.

### FastAPI

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
import arguslog
from arguslog.integrations.excepthook import install_excepthook

@asynccontextmanager
async def lifespan(_: FastAPI):
    arguslog.init(os.environ["ARGUSLOG_DSN"], release=os.environ.get("RELEASE"))
    install_excepthook(arguslog.get_client())
    yield
    arguslog.close()

app = FastAPI(lifespan=lifespan)

@app.middleware("http")
async def arguslog_breadcrumb(request: Request, call_next):
    arguslog.add_breadcrumb({
        "category": "http",
        "message": f"{request.method} {request.url.path}",
        "level": "info",
    })
    return await call_next(request)

@app.exception_handler(Exception)
async def capture(_: Request, exc: Exception):
    arguslog.capture_exception(exc, tags={"framework": "fastapi"})
    raise exc
```

## CLI tools / short-lived scripts

For one-shot scripts, **always call `flush()` before exit**. Python tears down threads
abruptly on interpreter shutdown, which strands the background sender mid-request:

```python
import arguslog

arguslog.init(os.environ["ARGUSLOG_DSN"])
try:
    main()
finally:
    arguslog.flush()  # blocks up to flush_timeout_seconds
```

`flush_timeout_seconds` (default `2.0`) bounds the wait so a flapping ingest endpoint
doesn't hang your CLI.

## AWS Lambda / serverless

Same pattern as CLIs — the runtime freezes the moment your handler returns:

```python
import arguslog

arguslog.init(os.environ["ARGUSLOG_DSN"])

def handler(event, context):
    try:
        return business_logic(event)
    except Exception as exc:
        arguslog.capture_exception(exc)
        raise
    finally:
        arguslog.flush()  # critical — Lambda freezes on return
```

## Threads, asyncio, multiprocessing

- **Threads.** The singleton client is thread-safe; `set_user`/`set_tag`/breadcrumbs
  share a single global scope. If you need per-thread isolation, instantiate
  `ArguslogClient` directly and inject it.
- **asyncio.** The transport runs on its own background thread, so awaiting `flush()`
  works from any event loop without blocking.
- **multiprocessing.** Forked workers must call `arguslog.init(...)` themselves —
  the parent's background thread doesn't survive `os.fork()`.

## Sourcemap / release upload

Python apps don't have JavaScript-style sourcemaps, but you can still cut a release tag
so events from this version are grouped together on the dashboard. Use
[`@arguslog/cli`](https://www.npmjs.com/package/@arguslog/cli) from your release pipeline:

```bash
arguslog releases new "$RELEASE" --project 42
```

Then pass that exact `RELEASE` string as `release="…"` in `init()`. Exact match is
how the dashboard groups events under a release.

## Troubleshooting

**Events not appearing on the dashboard.**
Set `debug=True` in `init` — the SDK logs every send (and every send failure) to stderr.
A 401 means the public key is wrong; a connection error means the DSN host isn't
reachable from your environment (proxy, NAT, VPC egress).

**Events dropped after a burst.**
Check the WARN-level log line about `arguslog: queue full, dropping event`. Either bump
`max_queue_size` (default `256`) or lower `sample_rate` for high-throughput services.

**`flush()` returns immediately on a fresh interpreter.**
Make sure `init(...)` was called first. `flush` on an uninitialised module is a no-op.

**Stack traces are truncated to the framework frame.**
You captured a re-raised exception. `capture_exception` honors `__traceback__`, but if
you re-raise without `raise … from exc`, Python may chain a new frame as the root.
Capture closer to the original `try/except`.

**`PermissionError: [Errno 13] permission denied` on the credentials file (CLI).**
That's the Arguslog _CLI_, not the Python SDK — see
[`@arguslog/cli`](https://www.npmjs.com/package/@arguslog/cli) for that flow.

## Source

The full implementation lives in the [arguslog monorepo](https://github.com/petarnenov/arguslog)
at `python-sdk/`. Issues and PRs welcome.
