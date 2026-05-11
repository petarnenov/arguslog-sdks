from django.urls import path

from . import views

urlpatterns = [
    path("", views.todo_list, name="todo_list"),
    path("create/", views.todo_create, name="todo_create"),
    path("<int:pk>/toggle/", views.todo_toggle, name="todo_toggle"),
    path("<int:pk>/delete/", views.todo_delete, name="todo_delete"),

    # Arguslog SDK demos
    path("demo/", views.demo_index, name="demo_index"),
    path("demo/capture-message/", views.demo_capture_message, name="demo_capture_message"),
    path("demo/capture-exception/", views.demo_capture_exception, name="demo_capture_exception"),
    path("demo/unhandled/", views.demo_unhandled, name="demo_unhandled"),
    path("demo/div-zero/", views.demo_division_by_zero, name="demo_div_zero"),
    path("demo/set-user/", views.demo_set_user, name="demo_set_user"),
    path("demo/clear-user/", views.demo_clear_user, name="demo_clear_user"),
    path("demo/tags/", views.demo_tags, name="demo_tags"),
    path("demo/context/", views.demo_context, name="demo_context"),
    path("demo/breadcrumbs/", views.demo_breadcrumbs, name="demo_breadcrumbs"),
    path("demo/logging/", views.demo_logging_handler, name="demo_logging"),
    path("demo/scrubbing/", views.demo_scrubbing, name="demo_scrubbing"),
    path("demo/flush/", views.demo_flush, name="demo_flush"),
    path("demo/dsn/", views.demo_dsn_parse, name="demo_dsn"),
    path("demo/client/", views.demo_client_info, name="demo_client"),
    path("demo/levels/", views.demo_levels, name="demo_levels"),
    path("demo/slow/", views.demo_slow, name="demo_slow"),
]
