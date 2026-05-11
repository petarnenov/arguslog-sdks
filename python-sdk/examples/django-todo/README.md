# Django TODO — Arguslog Python SDK example

A minimal Django 6 TODO app wired end-to-end to the [`arguslog`](../../) Python SDK. Every
SDK capability has at least one demo route so you can fire it from the browser and watch the
event land on your Arguslog dashboard.

## What this demo proves

The app intentionally exercises every public surface of the Python SDK in a real-world Django
shape:

| SDK feature                         | Where it's wired                                                                                                             |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `arguslog.init()` with full options | [`todoproject/settings.py`](todoproject/settings.py) — DSN, environment, release, sampling, queue, scrubbing, debug          |
| `install_excepthook()`              | `settings.py` — uncaught exceptions outside a view (worker scripts, signals) still surface                                   |
| `install_logging_handler()`         | `settings.py` (level=30 = WARNING) — every `logger.warning/error` is forwarded as an event                                   |
| `set_tag` / `set_context` (global)  | `settings.py` — `component`, `framework`, `runtime` baked into every event                                                   |
| Request middleware                  | [`todos/middleware.py`](todos/middleware.py) — breadcrumbs + tags + contexts per request, with a `request_id` correlation id |
| `set_user`                          | [`todos/views.py`](todos/views.py) — `_identify_demo_user` stamps a synthetic user on every view                             |
| `add_breadcrumb` (manual)           | Every view + every demo route                                                                                                |
| `capture_message`                   | `GET /demo/capture-message/`                                                                                                 |
| `capture_exception`                 | `GET /demo/capture-exception/`                                                                                               |
| Unhandled exception path            | `GET /demo/unhandled/` — view lets it propagate; excepthook + middleware both fire                                           |
| `ZeroDivisionError` capture         | `GET /demo/div-zero/`                                                                                                        |
| Identify / un-identify user         | `GET /demo/set-user/`, `GET /demo/clear-user/`                                                                               |
| Tags + contexts (event-scoped)      | `GET /demo/tags/`, `GET /demo/context/`                                                                                      |
| Breadcrumbs trail                   | `GET /demo/breadcrumbs/` — emits 5 breadcrumbs then fires an event so the timeline is rich                                   |
| Logging integration                 | `GET /demo/logging/` — uses stdlib `logger.warning/error`                                                                    |
| Data scrubbing                      | `GET /demo/scrubbing/` — fires with a `todo_secret_xxx` field, scrubbed by `extra_scrub_patterns`                            |
| Sync flush                          | `GET /demo/flush/`                                                                                                           |
| DSN parsing                         | `GET /demo/dsn/` — returns the structured `parse_dsn()` output                                                               |
| Client introspection                | `GET /demo/client/` — exposes `SDK_NAME`, `SDK_VERSION`, queue stats                                                         |
| Severity levels                     | `GET /demo/levels/` — emits one event per level (`debug`, `info`, `warning`, `error`, `fatal`)                               |
| Slow request                        | `GET /demo/slow/` — middleware records the elapsed time in a breadcrumb                                                      |

All demo routes are linked from `/demo/` so you can click through them in order.

## Project layout

```
django-todo/
├── manage.py                       — standard Django entrypoint
├── requirements.txt                — Django + arguslog pins
├── todoproject/                    — Django project package
│   ├── settings.py                 — Arguslog initialization lives here (top of file)
│   ├── urls.py                     — wires /admin, /, /demo/*
│   ├── asgi.py / wsgi.py
├── todos/                          — Django app
│   ├── models.py                   — Todo model
│   ├── forms.py                    — TodoForm
│   ├── views.py                    — view functions + demo routes
│   ├── urls.py                     — route table for the demos
│   ├── middleware.py               — ArguslogRequestMiddleware
│   ├── admin.py                    — registers Todo in /admin
│   ├── migrations/0001_initial.py
│   └── templates/todos/            — base.html, list.html, demo.html
```

## Quick start

```bash
# from this directory
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Point the SDK at YOUR project. Get the DSN from the dashboard:
#   Project → Settings → DSN keys → copy the arguslog://… string
export ARGUSLOG_DSN="arguslog://YOUR_PUBLIC_KEY@your-host/api/123"
export ARGUSLOG_ENV="development"
export ARGUSLOG_RELEASE="todo-demo@0.1.0"

python manage.py migrate
python manage.py runserver
```

Then visit:

- <http://localhost:8000/> — the TODO list (creates, toggles, deletes are normal CRUD)
- <http://localhost:8000/demo/> — index of every SDK demo

Each click on a demo link fires one or more events / breadcrumbs. Watch them appear on the
Arguslog dashboard under your project's Issues + Events panes.

## How `arguslog.init` is configured

Pulled straight from `todoproject/settings.py`:

```python
_arguslog_client = arguslog.init(
    arguslog.ArguslogOptions(
        dsn=ARGUSLOG_DSN,
        environment=ARGUSLOG_ENVIRONMENT,
        release=ARGUSLOG_RELEASE,
        sample_rate=1.0,             # take every event for the demo
        max_queue_size=512,          # async buffer before back-pressure kicks in
        flush_timeout_seconds=3.0,   # how long sync flush waits
        scrubbing_enabled=True,      # strip stack-frame locals matching the patterns below
        extra_scrub_patterns=[r"todo_secret_\w+"],
        debug=True,                  # verbose stderr logs while you wire things up
    )
)
install_excepthook(_arguslog_client)
install_logging_handler(_arguslog_client, level=30)
```

In production you would:

- Lower `sample_rate` (e.g. 0.1 for 10% of events) once volume is real.
- Turn `debug=False` so the SDK stops printing.
- Wire a deploy-time `ARGUSLOG_RELEASE` so dashboard "by release" filters work.

## How the middleware works

[`todos/middleware.py`](todos/middleware.py) is mounted at the end of Django's middleware list:

1. Generates a 12-char `request_id` (or honours an incoming `X-Request-Id`).
2. Stamps it as a tag + on the `request` context block — every event captured during this
   request carries it.
3. Adds an incoming-request breadcrumb.
4. Calls the next middleware / view.
5. On the way out: adds a response breadcrumb with status code + ms elapsed.
6. On unhandled exception: explicitly calls `arguslog.capture_exception(exc)` and re-raises so
   Django's default 500 page still renders.

The pattern is roughly what a production app should ship — keep it small, never swallow the
exception, attach the request id so you can grep server logs by the same id.

## How the demo routes are organized

`/demo/` lists every SDK capability with a one-line description. Each route is intentionally
small so you can read the source side-by-side with the dashboard outcome:

- `views.demo_capture_message` — single `arguslog.capture_message("…", level="warning")`
- `views.demo_capture_exception` — raises, catches, captures with `capture_exception`
- `views.demo_unhandled` — lets the exception propagate; both the middleware AND the
  excepthook see it (the SDK de-dups on `event_id` so only one event lands)
- `views.demo_breadcrumbs` — 5 breadcrumbs of varying levels then fires an event — the event
  detail on the dashboard shows the full trail
- `views.demo_scrubbing` — a key `todo_secret_alpha=...` is included in tags; the dashboard
  should show it as `[scrubbed]`
- `views.demo_flush` — calls `arguslog.flush()` and reports the queue size before/after

## Common questions

**Why is `debug=True` on?** This is a demo. Production should set `debug=False` (or unset).
The flag controls SDK stderr logging only — it does NOT toggle Django's `DEBUG` setting.

**How do I run this against a self-hosted Arguslog?** Set `ARGUSLOG_DSN` to point at your
ingest host. The host part of the DSN is where the SDK POSTs events — typically your API host
at port 8080 in dev, or `ingest.<your-domain>` in prod.

**Where does the user identity come from?** `_identify_demo_user` in `views.py` fabricates
one and stores it in the session. In a real app this would call `arguslog.set_user({id, email,
username})` from your auth middleware after the user signs in.

**Will the SDK slow my requests down?** No — captures are async and back-pressure-safe. The
middleware does the capture synchronously for unhandled exceptions, but only because you want
the event before the worker terminates. Routine breadcrumbs go onto the queue and ship in the
background.

## Troubleshooting

- **Nothing shows up on the dashboard.** Confirm the DSN is correct (project id at the end is
  numeric; public key is the 32-char base32 chunk). Run `/demo/dsn/` to see the parsed shape.
- **Stack traces are empty.** Check `sample_rate` — at 0.0 nothing fires. Default in the demo
  is 1.0.
- **Logger output isn't getting captured.** `install_logging_handler(level=30)` only forwards
  WARNING+. Lower the level (e.g. `level=20` for INFO) if you want chatty logs to ship.
- **CSRF errors on the demo links.** All demo routes are GET, so this shouldn't happen — if
  it does, you probably renamed one of them to POST without adding `{% csrf_token %}`.

## Cleaning up

```bash
deactivate
rm -rf venv db.sqlite3
```

The SQLite file (`db.sqlite3`) holds the demo todos + the demo-user session — wipe between
runs if you want a clean slate.
