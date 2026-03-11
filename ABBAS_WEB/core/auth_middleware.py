from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import RedirectResponse

from redis.session import SESSION_COOKIE_NAME, read_session_user, refresh_session


class AuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, public_paths: list[str] | None = None):
        super().__init__(app)
        self.public_paths = set(public_paths or [])

        # Always-public paths (hard allowlist)
        # If /login is not excluded, the middleware will redirect
        #   /login -> /login?next=/login?next=... (infinite loop)
        self._always_public_exact = {
            "/login",
            "/signup",
            "/logout",
            "/favicon.ico",
            "/robots.txt",
            "/sitemap.xml",
        }

        self._always_public_prefix = (
            "/login",  # includes /login?next=...
            "/signup",  # includes /signup?... 
            "/auth/",  # signup utilities (id check, email verification)
            "/static/",
            "/api/health/",
            "/api/device/",  # device telemetry/register endpoints are public
        )

    async def dispatch(self, request: Request, call_next):
        path = request.url.path or "/"

        # public/static + always allowlist
        if path in self._always_public_exact or path in self.public_paths:
            return await call_next(request)

        # ESP32 subscription polling endpoint only (grant/revoke stays authenticated).
        if request.method == "GET" and path.startswith("/api/devices/") and path.endswith("/subscription"):
            return await call_next(request)

        for pfx in self._always_public_prefix:
            if path.startswith(pfx):
                return await call_next(request)

        sid = request.cookies.get(SESSION_COOKIE_NAME, "") or ""
        user_id = read_session_user(sid)

        if not user_id:
            # Prevent redirect loops: never nest next= inside /login requests
            if path.startswith("/login"):
                return await call_next(request)

            next_q = request.url.path
            if request.url.query:
                next_q = f"{next_q}?{request.url.query}"
            return RedirectResponse(url=f"/login?next={next_q}", status_code=302)

        # Sliding refresh (keep session alive while active)
        refresh_session(sid, auto_login=False)

        request.state.user_id = user_id
        return await call_next(request)
