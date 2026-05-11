import time
import uuid

import arguslog


class ArguslogRequestMiddleware:
    """Adds a breadcrumb for every request and captures unhandled exceptions."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request_id = request.headers.get("X-Request-Id") or uuid.uuid4().hex[:12]
        request.arguslog_request_id = request_id

        arguslog.set_tag("request_id", request_id)
        arguslog.set_context(
            "request",
            {
                "method": request.method,
                "path": request.path,
                "query": request.META.get("QUERY_STRING", ""),
                "user_agent": request.META.get("HTTP_USER_AGENT", ""),
            },
        )
        arguslog.add_breadcrumb(
            {
                "category": "http",
                "message": f"{request.method} {request.path}",
                "level": "info",
                "data": {"request_id": request_id},
            }
        )

        started = time.monotonic()
        response = self.get_response(request)
        duration_ms = int((time.monotonic() - started) * 1000)

        arguslog.add_breadcrumb(
            {
                "category": "http",
                "message": f"response {response.status_code} ({duration_ms}ms)",
                "level": "info" if response.status_code < 500 else "error",
                "data": {"status": response.status_code, "duration_ms": duration_ms},
            }
        )
        response["X-Request-Id"] = request_id
        return response

    def process_exception(self, request, exception):
        event_id = arguslog.capture_exception(
            exception,
            tags={
                "request_id": getattr(request, "arguslog_request_id", "unknown"),
                "view": request.resolver_match.view_name if request.resolver_match else "?",
            },
        )
        if event_id:
            request.arguslog_event_id = event_id
        return None
