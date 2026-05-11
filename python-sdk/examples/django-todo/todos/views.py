"""TODO views. Each view exercises a slice of the arguslog Python SDK.

The "demo" routes intentionally trigger errors / messages so the dashboard fills
with events that show off every SDK capability.
"""

from __future__ import annotations

import logging
import random
import time

import arguslog
from django.contrib import messages
from django.http import HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from .forms import TodoForm
from .models import Todo

logger = logging.getLogger("todos")


def _identify_demo_user(request) -> dict:
    """Pretend we have an authenticated user. Stored in session for the demo."""
    user = request.session.get("demo_user")
    if not user:
        user = {
            "id": f"user-{random.randint(1000, 9999)}",
            "email": "demo@example.com",
            "username": "demo",
        }
        request.session["demo_user"] = user
    arguslog.set_user(user)
    return user


def todo_list(request):
    user = _identify_demo_user(request)
    arguslog.add_breadcrumb(
        {"category": "view", "message": "todo_list", "level": "info", "data": {"user": user["id"]}}
    )
    todos = Todo.objects.all()
    return render(
        request,
        "todos/list.html",
        {"todos": todos, "form": TodoForm(), "user": user},
    )


@require_POST
def todo_create(request):
    _identify_demo_user(request)
    form = TodoForm(request.POST)
    if form.is_valid():
        todo = form.save()
        arguslog.add_breadcrumb(
            {
                "category": "db",
                "message": "todo.created",
                "level": "info",
                "data": {"id": todo.id, "priority": todo.priority},
            }
        )
        arguslog.capture_message(
            f"Todo created: {todo.title}",
            level="info",
            tags={"action": "create", "priority": todo.priority},
        )
        messages.success(request, "Todo created")
    else:
        arguslog.capture_message(
            "Todo create validation failed",
            level="warning",
            tags={"action": "create", "errors": ",".join(form.errors.keys())},
        )
        messages.error(request, "Could not create todo")
    return redirect("todo_list")


@require_POST
def todo_toggle(request, pk: int):
    _identify_demo_user(request)
    todo = get_object_or_404(Todo, pk=pk)
    todo.completed = not todo.completed
    todo.save()
    arguslog.add_breadcrumb(
        {
            "category": "db",
            "message": "todo.toggled",
            "level": "info",
            "data": {"id": todo.id, "completed": todo.completed},
        }
    )
    return redirect("todo_list")


@require_POST
def todo_delete(request, pk: int):
    _identify_demo_user(request)
    todo = get_object_or_404(Todo, pk=pk)
    title = todo.title
    todo.delete()
    arguslog.capture_message(
        f"Todo deleted: {title}", level="info", tags={"action": "delete"}
    )
    return redirect("todo_list")


# ---------------------------------------------------------------------------
# Demo routes — these intentionally exercise SDK features for the dashboard.
# ---------------------------------------------------------------------------


def demo_index(request):
    _identify_demo_user(request)
    return render(request, "todos/demo.html")


def demo_capture_message(request):
    _identify_demo_user(request)
    level = request.GET.get("level", "info")
    arguslog.capture_message(
        f"Demo {level} message at {time.time():.0f}",
        level=level,
        tags={"demo": "capture_message", "level": level},
    )
    messages.success(request, f"Sent {level} message to arguslog")
    return redirect("demo_index")


def demo_capture_exception(request):
    _identify_demo_user(request)
    try:
        raise ValueError("Demo ValueError captured manually")
    except ValueError as exc:
        event_id = arguslog.capture_exception(
            exc, tags={"demo": "capture_exception"}
        )
    messages.success(request, f"Captured exception (event_id={event_id})")
    return redirect("demo_index")


def demo_unhandled(request):
    _identify_demo_user(request)
    # Caught by middleware.process_exception
    raise RuntimeError("Unhandled exception — should be caught by middleware")


def demo_division_by_zero(request):
    _identify_demo_user(request)
    arguslog.add_breadcrumb(
        {"category": "calc", "message": "about to divide by zero", "level": "warning"}
    )
    return JsonResponse({"result": 1 / 0})


def demo_set_user(request):
    custom = {
        "id": request.GET.get("id", "user-vip-001"),
        "email": request.GET.get("email", "vip@example.com"),
        "username": request.GET.get("username", "vip-user"),
        "plan": "enterprise",
    }
    request.session["demo_user"] = custom
    arguslog.set_user(custom)
    arguslog.capture_message(
        "User identity updated", level="info", tags={"demo": "set_user"}
    )
    messages.success(request, f"Identified as {custom['email']}")
    return redirect("demo_index")


def demo_clear_user(request):
    request.session.pop("demo_user", None)
    arguslog.set_user(None)
    arguslog.capture_message(
        "User identity cleared", level="info", tags={"demo": "clear_user"}
    )
    messages.success(request, "User cleared")
    return redirect("demo_index")


def demo_tags(request):
    _identify_demo_user(request)
    arguslog.set_tag("feature_flag", "new_ui")
    arguslog.set_tag("ab_test_bucket", random.choice(["A", "B", "control"]))
    arguslog.capture_message(
        "Custom tags attached", level="info", tags={"demo": "set_tag"}
    )
    messages.success(request, "Custom tags set globally")
    return redirect("demo_index")


def demo_context(request):
    _identify_demo_user(request)
    arguslog.set_context(
        "billing",
        {"plan": "pro", "seats": 12, "renewal": "2026-12-01", "mrr_usd": 199},
    )
    arguslog.set_context(
        "device", {"os": "macOS", "version": "15.4", "arch": "arm64"}
    )
    arguslog.capture_message(
        "Rich context attached", level="info", tags={"demo": "set_context"}
    )
    messages.success(request, "Structured context attached")
    return redirect("demo_index")


def demo_breadcrumbs(request):
    _identify_demo_user(request)
    for step in ["page.load", "form.focus", "form.type", "form.submit"]:
        arguslog.add_breadcrumb(
            {
                "category": "ui",
                "message": step,
                "level": "info",
                "data": {"step": step, "ts": time.time()},
            }
        )
    try:
        raise LookupError("Demo error after breadcrumb trail")
    except LookupError as exc:
        arguslog.capture_exception(exc, tags={"demo": "breadcrumbs"})
    messages.success(request, "Breadcrumb trail + exception sent")
    return redirect("demo_index")


def demo_logging_handler(request):
    """Logs flow through the logging integration -> arguslog."""
    _identify_demo_user(request)
    logger.warning("WARN via logging handler %s", time.time())
    logger.error("ERROR via logging handler %s", time.time())
    try:
        {}["missing"]
    except KeyError:
        logger.exception("Exception via logger.exception")
    messages.success(request, "Sent 3 log records through logging integration")
    return redirect("demo_index")


def demo_scrubbing(request):
    """The scrubber should redact secret-looking values before transport."""
    _identify_demo_user(request)
    arguslog.set_context(
        "payment",
        {
            "card_number": "4111-1111-1111-1111",
            "cvv": "123",
            "api_key": "sk_live_ABCDEFGHIJKLMNOP",
            "todo_secret_token": "should-be-scrubbed",
        },
    )
    arguslog.capture_message(
        "PII payload (will be scrubbed)",
        level="warning",
        tags={"demo": "scrubbing"},
    )
    messages.success(request, "Sensitive context sent — should arrive scrubbed")
    return redirect("demo_index")


def demo_flush(request):
    _identify_demo_user(request)
    arguslog.capture_message(
        "Message right before flush()", level="info", tags={"demo": "flush"}
    )
    arguslog.flush(timeout=3.0)
    messages.success(request, "flush(3.0s) called — queue drained")
    return redirect("demo_index")


def demo_dsn_parse(request):
    from django.conf import settings
    parsed = arguslog.parse_dsn(settings.ARGUSLOG_DSN)
    return JsonResponse(
        {
            "scheme": parsed.scheme,
            "public_key": parsed.public_key,
            "host": parsed.host,
            "project_id": parsed.project_id,
            "ingest_url": parsed.ingest_url,
        }
    )


def demo_client_info(request):
    from django.conf import settings
    return JsonResponse(
        {
            "sdk_name": arguslog.SDK_NAME,
            "sdk_version": arguslog.SDK_VERSION,
            "environment": settings.ARGUSLOG_ENVIRONMENT,
            "release": settings.ARGUSLOG_RELEASE,
            "client_attached": arguslog.get_client() is not None,
        }
    )


def demo_levels(request):
    """Fire one message per supported level."""
    _identify_demo_user(request)
    for level in ["debug", "info", "warning", "error", "fatal"]:
        arguslog.capture_message(
            f"Message at level={level}",
            level=level,
            tags={"demo": "levels", "level": level},
        )
    messages.success(request, "Sent one event per level (debug..fatal)")
    return redirect("demo_index")


def demo_slow(request):
    """Pretend to do slow work and breadcrumb each step."""
    _identify_demo_user(request)
    for i in range(1, 4):
        arguslog.add_breadcrumb(
            {
                "category": "perf",
                "message": f"step {i}",
                "level": "info",
                "data": {"step": i},
            }
        )
        time.sleep(0.15)
    arguslog.capture_message(
        "Slow operation completed",
        level="info",
        tags={"demo": "perf"},
    )
    return HttpResponse("done")
