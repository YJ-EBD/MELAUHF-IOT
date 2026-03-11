from __future__ import annotations

import os
import secrets
from dataclasses import dataclass
from typing import Iterable, Optional

# NOTE:
# This project has a local package named "redis/".
# Importing "redis" (redis-py) will be shadowed by this package, causing:
#   AttributeError: module 'redis' has no attribute 'Redis'
# Therefore, we use a tiny socket-based Redis client implemented in
# redis/simple_redis.py.

from .simple_redis import RedisError, SimpleRedis, config_from_env

# ==========================================================
# Redis session utilities (backward compatible)
# ==========================================================
# Why this file exists:
# - main.py (legacy) imports rotate_boot_id from redis.session.
# - Email verification used to store codes under a key that included boot_id,
#   causing verification failures. We now store codes per-email (single key).
# - Sessions use sliding TTL; session keys do NOT depend on boot_id.


def _env(key: str, default: str = "") -> str:
    v = os.getenv(key)
    return v if v is not None else default


@dataclass(frozen=True)
class RedisSettings:
    host: str
    port: int
    db: int
    password: str
    timeout_sec: float


def redis_settings_from_env() -> RedisSettings:
    return RedisSettings(
        host=_env("REDIS_HOST", "127.0.0.1"),
        port=int(_env("REDIS_PORT", "6379")),
        db=int(_env("REDIS_DB", "0")),
        password=_env("REDIS_PASSWORD", ""),
        timeout_sec=float(_env("REDIS_TIMEOUT_SEC", "2.5")),
    )


class RedisClient:
    """Small adapter used by the rest of the app.

    Internally uses SimpleRedis (socket-based). This avoids the name-collision
    problem where our local package 'redis/' shadows the external 'redis' lib.
    """

    def __init__(self, s: RedisSettings | None = None, *, client: SimpleRedis | None = None):
        if client is not None:
            self._client = client
            return

        # Create from settings/env
        if s is None:
            s = redis_settings_from_env()

        # SimpleRedis loads env too, but we pass explicit config to avoid drift.
        cfg = config_from_env()
        cfg.host = s.host
        cfg.port = s.port
        cfg.db = s.db
        cfg.password = s.password
        cfg.timeout_sec = s.timeout_sec
        self._client = SimpleRedis(cfg)

    # basic
    def ping(self) -> bool:
        return bool(self._client.ping())

    def get(self, key: str) -> Optional[str]:
        return self._client.get_str(key)

    def set(self, key: str, value: str) -> None:
        self._client.set(key, value)

    def setex(self, key: str, ttl_sec: int, value: str) -> None:
        self._client.setex(key, ttl_sec, value)

    def expire(self, key: str, ttl_sec: int) -> bool:
        return bool(self._client.expire(key, ttl_sec))

    def delete(self, key: str) -> int:
        return int(self._client.delete(key))

    def delete_many(self, keys: Iterable[str]) -> int:
        keys = list(keys)
        if not keys:
            return 0
        return int(self._client.delete(*keys))

    def scan_iter(self, match: str) -> Iterable[str]:
        return self._client.scan_iter(match=match)


# singleton
_REDIS: Optional[RedisClient] = None
_REDIS_DISABLED: bool = False


def bind_redis_client(simple_client: SimpleRedis) -> None:
    """Bind a SimpleRedis instance created elsewhere (e.g., main.py startup).

    This keeps a single Redis connection policy for the whole app.
    """
    global _REDIS, _REDIS_DISABLED
    _REDIS_DISABLED = False
    _REDIS = RedisClient(client=simple_client)


def get_redis() -> RedisClient:
    """Return a usable Redis client.

    Raises RedisError if Redis is unavailable.
    """
    global _REDIS, _REDIS_DISABLED
    if _REDIS_DISABLED:
        raise RedisError("redis disabled")

    if _REDIS is None:
        _REDIS = RedisClient(redis_settings_from_env())

    # Verify connectivity once (and cache failure to avoid noisy repeats)
    try:
        if not _REDIS.ping():
            raise RedisError("redis ping failed")
    except Exception as e:
        _REDIS_DISABLED = True
        raise RedisError(str(e))

    return _REDIS


# ==========================================================
# Boot ID (legacy compatibility)
# ==========================================================

BOOT_ID_KEY = "for_rnd_web:boot_id"


def rotate_boot_id(redis_client: SimpleRedis | None = None) -> str:
    """Legacy API used by main.py.

    main.py historically called rotate_boot_id(app.state.redis).
    - If a client is provided, we bind it so the rest of the app (middleware)
      uses the same Redis instance.
    - If Redis is down, we still return a boot_id (best-effort) without raising.
    """
    if redis_client is not None:
        try:
            bind_redis_client(redis_client)
        except Exception:
            # binding failure should not crash startup
            pass

    bid = secrets.token_hex(16)
    try:
        get_redis().set(BOOT_ID_KEY, bid)
    except Exception:
        pass
    return bid


def get_boot_id() -> str:
    try:
        bid = get_redis().get(BOOT_ID_KEY)
    except Exception:
        bid = None
    if bid:
        return bid
    return rotate_boot_id()


# ==========================================================
# Session API
# ==========================================================

SESSION_COOKIE_NAME = "sid"

# Default TTLs (override via settings.env or OS env)
DEFAULT_SESSION_TTL_SEC = int(_env("SESSION_TTL_SEC", "43200"))  # 12 hours
AUTO_LOGIN_TTL_SEC = int(_env("AUTO_LOGIN_TTL_SEC", "2592000"))  # 30 days


def _sess_key(sid: str) -> str:
    return f"for_rnd_web:sess:{sid}"


def new_session_id() -> str:
    return secrets.token_urlsafe(32)


def create_session(*, user_id: str, auto_login: bool) -> str:
    sid = new_session_id()
    ttl = AUTO_LOGIN_TTL_SEC if auto_login else DEFAULT_SESSION_TTL_SEC
    # If Redis is down, login must fail clearly (do not silently create a dead session).
    get_redis().setex(_sess_key(sid), ttl, (user_id or "").strip())
    return sid


def read_session_user(sid: str) -> Optional[str]:
    sid = (sid or "").strip()
    if not sid:
        return None
    try:
        return get_redis().get(_sess_key(sid))
    except Exception:
        return None


def refresh_session(sid: str, *, auto_login: bool = False) -> None:
    """Sliding TTL refresh. If key missing, does nothing."""
    sid = (sid or "").strip()
    if not sid:
        return
    ttl = AUTO_LOGIN_TTL_SEC if auto_login else DEFAULT_SESSION_TTL_SEC
    try:
        get_redis().expire(_sess_key(sid), ttl)
    except Exception:
        return


def delete_session(sid: str) -> None:
    sid = (sid or "").strip()
    if not sid:
        return
    try:
        get_redis().delete(_sess_key(sid))
    except Exception:
        return


def set_session_cookie(response, sid: str, *, auto_login: bool) -> None:
    """Set host-only cookie (no Domain attribute)."""
    if auto_login:
        response.set_cookie(
            key=SESSION_COOKIE_NAME,
            value=sid,
            max_age=AUTO_LOGIN_TTL_SEC,
            httponly=True,
            samesite="lax",
            secure=False,
            path="/",
        )
    else:
        response.set_cookie(
            key=SESSION_COOKIE_NAME,
            value=sid,
            httponly=True,
            samesite="lax",
            secure=False,
            path="/",
        )


def clear_session_cookie(response) -> None:
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")


# ==========================================================
# Email verification code (single key per email)
# ==========================================================

EMAIL_CODE_TTL_SEC = int(_env("EMAIL_CODE_TTL_SEC", "600"))  # 10 minutes
EMAIL_CODE_PREFIX = "for_rnd_web:email_code"


def _norm_email(email: str) -> str:
    return (email or "").strip().lower()


def _email_key(email: str) -> str:
    # New stable key: for_rnd_web:email_code:<email>
    return f"{EMAIL_CODE_PREFIX}:{_norm_email(email)}"


def set_email_code(email: str, code: str, ttl_sec: int = EMAIL_CODE_TTL_SEC) -> None:
    """Store one active code per email.

    Also deletes legacy keys: for_rnd_web:email_code:*:<email>
    """
    e = _norm_email(email)
    if not e:
        return
    try:
        r = get_redis()
    except Exception:
        return

    # cleanup legacy keys (boot_id depended)
    legacy_pattern = f"{EMAIL_CODE_PREFIX}:*:{e}"
    legacy_keys = list(r.scan_iter(match=legacy_pattern))
    if legacy_keys:
        r.delete_many(legacy_keys)

    r.setex(_email_key(e), int(ttl_sec), (code or "").strip())


def get_email_code(email: str) -> Optional[str]:
    e = _norm_email(email)
    if not e:
        return None
    try:
        return get_redis().get(_email_key(e))
    except Exception:
        return None


def verify_email_code(email: str, input_code: str) -> bool:
    e = _norm_email(email)
    c = (input_code or "").strip()
    if not e or not c:
        return False
    stored = get_email_code(e)
    if not stored:
        return False
    if stored.strip() != c:
        return False

    # one-time use
    try:
        get_redis().delete(_email_key(e))
    except Exception:
        pass
    return True
