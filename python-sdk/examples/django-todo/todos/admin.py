from django.contrib import admin

from .models import Todo


@admin.register(Todo)
class TodoAdmin(admin.ModelAdmin):
    list_display = ("title", "priority", "completed", "created_at")
    list_filter = ("completed", "priority")
    search_fields = ("title", "description")
