"""Optional integrations: stdlib excepthook, stdlib logging handler.

Frameworks (Django, Flask, FastAPI) will live as siblings here; we ship the lowest-common
denominator hooks first so any Python app can opt in without pulling in a framework dep."""
