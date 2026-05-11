from django import forms

from .models import Todo


class TodoForm(forms.ModelForm):
    class Meta:
        model = Todo
        fields = ["title", "description", "priority"]
        widgets = {
            "title": forms.TextInput(attrs={"class": "form-input", "placeholder": "What needs doing?"}),
            "description": forms.Textarea(attrs={"class": "form-input", "rows": 2, "placeholder": "Details (optional)"}),
            "priority": forms.Select(attrs={"class": "form-input"}),
        }
