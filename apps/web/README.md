# apps/web

This workspace is intentionally a stub for a future web UI.

The UI will consume the embedded HTTP API exposed by the worker daemon:

- `GET /health` is public.
- All other routes require `Authorization: Bearer <API_TOKEN>`.
