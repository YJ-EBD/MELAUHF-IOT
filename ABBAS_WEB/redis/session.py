from __future__ import annotations

import json
import os
import secrets
import time
from dataclasses import dataclass
from typing import Any, Iterable, Optional

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

    def ttl(self, key: str) -> int:
        try:
            return int(self._client.execute("TTL", key))
        except Exception:
            return -2


class ActiveSessionExistsError(Exception):
    def __init__(self, user_id: str, *, sid: str = "", has_live_presence: bool = False, presence_count: int = 0):
        self.user_id = (user_id or "").strip()
        self.sid = (sid or "").strip()
        self.has_live_presence = bool(has_live_presence)
        self.presence_count = max(int(presence_count or 0), 0)
        super().__init__(f"active session exists for user '{self.user_id}'")


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
USER_SESSION_PREFIX = "for_rnd_web:user_sess"
LIVE_PRESENCE_PREFIX = "for_rnd_web:presence"
LIVE_PRESENCE_TTL_SEC = max(int(_env("LIVE_PRESENCE_TTL_SEC", "20")), 5)

# Default TTLs (override via settings.env or OS env)
DEFAULT_SESSION_TTL_SEC = int(_env("SESSION_TTL_SEC", "43200"))  # 12 hours
AUTO_LOGIN_TTL_SEC = int(_env("AUTO_LOGIN_TTL_SEC", "2592000"))  # 30 days


def _sess_key(sid: str) -> str:
    return f"for_rnd_web:sess:{sid}"


def _user_sess_key(user_id: str) -> str:
    return f"{USER_SESSION_PREFIX}:{(user_id or '').strip()}"


def _find_existing_session_id(r: RedisClient, user_id: str) -> Optional[str]:
    user = (user_id or "").strip()
    if not user:
        return None

    for sess_key in r.scan_iter(match="for_rnd_web:sess:*"):
        try:
            if r.get(sess_key) != user:
                continue
        except Exception:
            continue

        sid = sess_key.rsplit(":", 1)[-1]
        ttl = r.ttl(sess_key)
        if ttl > 0:
            try:
                r.setex(_user_sess_key(user), ttl, sid)
            except Exception:
                pass
        return sid
    return None


def _get_active_session_id(r: RedisClient, user_id: str) -> Optional[str]:
    user = (user_id or "").strip()
    if not user:
        return None

    sid = r.get(_user_sess_key(user))
    if not sid:
        return _find_existing_session_id(r, user)

    if r.get(_sess_key(sid)) == user:
        return sid

    try:
        r.delete(_user_sess_key(user))
    except Exception:
        pass
    return _find_existing_session_id(r, user)


def _list_session_ids_for_user(r: RedisClient, user_id: str) -> list[str]:
    user = (user_id or "").strip()
    if not user:
        return []

    session_ids: list[str] = []
    seen: set[str] = set()
    indexed_sid = str(r.get(_user_sess_key(user)) or "").strip()
    if indexed_sid and r.get(_sess_key(indexed_sid)) == user:
        session_ids.append(indexed_sid)
        seen.add(indexed_sid)

    for sess_key in r.scan_iter(match="for_rnd_web:sess:*"):
        try:
            if r.get(sess_key) != user:
                continue
        except Exception:
            continue

        sid = sess_key.rsplit(":", 1)[-1]
        if sid in seen:
            continue
        session_ids.append(sid)
        seen.add(sid)
    return session_ids


def _list_presence_keys_for_session(r: RedisClient, user_id: str, sid: str) -> list[str]:
    user = (user_id or "").strip()
    session_id = (sid or "").strip()
    if not user or not session_id:
        return []

    keys: list[str] = []
    for presence_key in r.scan_iter(match=f"{LIVE_PRESENCE_PREFIX}:{user}:*"):
        try:
            raw = r.get(presence_key)
            if not raw:
                continue
            data = json.loads(raw)
            if str(data.get("user_id") or "").strip() != user:
                continue
            if str(data.get("sid") or "").strip() != session_id:
                continue
            if r.ttl(presence_key) <= 0:
                continue
            keys.append(presence_key)
        except Exception:
            continue
    return keys


def _delete_presence_for_session(r: RedisClient, user_id: str, sid: str) -> None:
    keys = _list_presence_keys_for_session(r, user_id, sid)
    if not keys:
        return
    try:
        r.delete_many(keys)
    except Exception:
        pass


def _delete_user_sessions(r: RedisClient, user_id: str, session_ids: Optional[Iterable[str]] = None) -> None:
    user = (user_id or "").strip()
    if not user:
        return

    ids = [str(sid or "").strip() for sid in (session_ids or _list_session_ids_for_user(r, user))]
    ids = [sid for sid in ids if sid]
    if not ids:
        try:
            r.delete(_user_sess_key(user))
        except Exception:
            pass
        return

    sess_keys = [_sess_key(sid) for sid in ids]
    for sid in ids:
        _delete_presence_for_session(r, user, sid)

    try:
        r.delete_many(sess_keys)
    except Exception:
        pass
    try:
        r.delete(_user_sess_key(user))
    except Exception:
        pass


def new_session_id() -> str:
    return secrets.token_urlsafe(32)


def create_session(*, user_id: str, auto_login: bool, force_replace: bool = False) -> str:
    user = (user_id or "").strip()
    sid = new_session_id()
    ttl = AUTO_LOGIN_TTL_SEC if auto_login else DEFAULT_SESSION_TTL_SEC
    r = get_redis()
    session_ids = _list_session_ids_for_user(r, user)
    if session_ids:
        live_sid = ""
        live_presence_count = 0
        for existing_sid in session_ids:
            presence_count = len(_list_presence_keys_for_session(r, user, existing_sid))
            if presence_count > 0:
                live_sid = existing_sid
                live_presence_count = presence_count
                break

        if live_sid and not force_replace:
            raise ActiveSessionExistsError(
                user,
                sid=live_sid,
                has_live_presence=True,
                presence_count=live_presence_count,
            )

        _delete_user_sessions(r, user, session_ids)

    # If Redis is down, login must fail clearly (do not silently create a dead session).
    r.setex(_sess_key(sid), ttl, user)
    if user:
        r.setex(_user_sess_key(user), ttl, sid)
    return sid


def read_session_user(sid: str) -> Optional[str]:
    sid = (sid or "").strip()
    if not sid:
        return None
    try:
        r = get_redis()
        user = r.get(_sess_key(sid))
        if not user:
            return None

        active_sid = r.get(_user_sess_key(user))
        # Backward-compatible: older sessions may not have a user->sid index yet.
        if active_sid and active_sid != sid:
            try:
                r.delete(_sess_key(sid))
            except Exception:
                pass
            return None
        return user
    except Exception:
        return None


def refresh_session(sid: str, *, auto_login: bool = False) -> None:
    """Sliding TTL refresh. If key missing, does nothing."""
    sid = (sid or "").strip()
    if not sid:
        return
    ttl = AUTO_LOGIN_TTL_SEC if auto_login else DEFAULT_SESSION_TTL_SEC
    try:
        r = get_redis()
        user = r.get(_sess_key(sid))
        if not user:
            return

        active_sid = r.get(_user_sess_key(user))
        if active_sid and active_sid != sid:
            try:
                r.delete(_sess_key(sid))
            except Exception:
                pass
            return

        r.expire(_sess_key(sid), ttl)
        if active_sid == sid:
            r.expire(_user_sess_key(user), ttl)
        elif not active_sid:
            # One-time backfill for sessions created before user->sid indexing existed.
            r.setex(_user_sess_key(user), ttl, sid)
    except Exception:
        return


def delete_session(sid: str) -> None:
    sid = (sid or "").strip()
    if not sid:
        return
    try:
        r = get_redis()
        user = r.get(_sess_key(sid))
        r.delete(_sess_key(sid))

        if user:
            _delete_presence_for_session(r, user, sid)
            active_sid = r.get(_user_sess_key(user))
            if active_sid == sid:
                r.delete(_user_sess_key(user))
    except Exception:
        return


def _presence_key(user_id: str, client_id: str) -> str:
    return f"{LIVE_PRESENCE_PREFIX}:{(user_id or '').strip()}:{(client_id or '').strip()}"


def _normalize_presence_client_state(value: Any) -> str:
    state = str(value or "").strip().lower()
    if state == "hidden":
        return "hidden"
    return "visible"


def touch_live_presence(*, user_id: str, client_id: str, sid: str, state: Any, path: str = "", title: str = "") -> None:
    user = (user_id or "").strip()
    client = (client_id or "").strip()
    session_id = (sid or "").strip()
    if not user or not client or not session_id:
        return

    payload = {
        "user_id": user,
        "client_id": client,
        "sid": session_id,
        "state": _normalize_presence_client_state(state),
        "path": str(path or "").strip()[:160],
        "title": str(title or "").strip()[:160],
        "updated_at_ts": time.time(),
    }
    try:
        r = get_redis()
        if r.get(_sess_key(session_id)) != user:
            try:
                r.delete(_presence_key(user, client))
            except Exception:
                pass
            return

        active_sid = r.get(_user_sess_key(user))
        if active_sid and active_sid != session_id:
            try:
                r.delete(_presence_key(user, client))
            except Exception:
                pass
            return

        r.setex(_presence_key(user, client), LIVE_PRESENCE_TTL_SEC, json.dumps(payload, ensure_ascii=False))
    except Exception:
        return


def clear_live_presence(*, user_id: str, client_id: str) -> None:
    user = (user_id or "").strip()
    client = (client_id or "").strip()
    if not user or not client:
        return
    try:
        get_redis().delete(_presence_key(user, client))
    except Exception:
        return


def list_live_presence() -> list[dict[str, Any]]:
    try:
        r = get_redis()
    except Exception:
        return []

    entries: list[dict[str, Any]] = []
    for presence_key in r.scan_iter(match=f"{LIVE_PRESENCE_PREFIX}:*"):
        try:
            raw = r.get(presence_key)
            if not raw:
                continue
            data = json.loads(raw)
            user_id = str(data.get("user_id") or "").strip()
            client_id = str(data.get("client_id") or "").strip()
            sid = str(data.get("sid") or "").strip()
            if not user_id or not client_id or not sid:
                continue

            if r.get(_sess_key(sid)) != user_id:
                try:
                    r.delete(presence_key)
                except Exception:
                    pass
                continue

            active_sid = r.get(_user_sess_key(user_id))
            if active_sid and active_sid != sid:
                try:
                    r.delete(presence_key)
                except Exception:
                    pass
                continue

            ttl = r.ttl(presence_key)
            entries.append(
                {
                    "user_id": user_id,
                    "client_id": client_id,
                    "sid": sid,
                    "state": _normalize_presence_client_state(data.get("state")),
                    "path": str(data.get("path") or "").strip(),
                    "title": str(data.get("title") or "").strip(),
                    "updated_at_ts": float(data.get("updated_at_ts") or 0.0),
                    "ttl_sec": ttl if ttl > 0 else 0,
                }
            )
        except Exception:
            continue

    entries.sort(key=lambda item: (str(item.get("user_id") or ""), str(item.get("client_id") or "")))
    return entries


def list_active_sessions() -> list[dict[str, Any]]:
    try:
        r = get_redis()
    except Exception:
        return []

    sessions: list[dict[str, Any]] = []
    for sess_key in r.scan_iter(match="for_rnd_web:sess:*"):
        try:
            user_id = str(r.get(sess_key) or "").strip()
            if not user_id:
                continue
            sid = sess_key.rsplit(":", 1)[-1]
            active_sid = r.get(_user_sess_key(user_id))
            if active_sid and active_sid != sid:
                continue
            ttl = r.ttl(sess_key)
            sessions.append(
                {
                    "sid": sid,
                    "user_id": user_id,
                    "ttl_sec": ttl if ttl > 0 else 0,
                }
            )
        except Exception:
            continue

    sessions.sort(key=lambda item: (str(item.get("user_id") or ""), str(item.get("sid") or "")))
    return sessions


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
