from __future__ import annotations

import os
from typing import Dict, Optional

from .runtime import get_mysql

_USER_SCHEMA_READY = False


def _columns_of_users(cur) -> set[str]:
    cur.execute("SHOW COLUMNS FROM users")
    rows = cur.fetchall() or []
    return {str(row.get("Field") or "").strip() for row in rows}


def _normalize_role(role: str) -> str:
    value = str(role or "").strip().lower()
    if value == "admin":
        return "admin"
    return "user"


def _bootstrap_admin_user_ids() -> list[str]:
    raw = (os.getenv("ABBAS_ADMIN_USER_IDS") or "").strip()
    if not raw:
        return []
    return [token for token in {part.strip() for part in raw.split(",")} if token]


def _ensure_schema_with_cur(cur) -> None:
    global _USER_SCHEMA_READY
    if _USER_SCHEMA_READY:
        return

    cols = _columns_of_users(cur)
    if "role" not in cols:
        cur.execute("ALTER TABLE users ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'user' AFTER nickname")

    try:
        cur.execute(
            """
            UPDATE users
            SET role='user'
            WHERE role IS NULL
               OR TRIM(role)=''
               OR LOWER(TRIM(role)) NOT IN ('user', 'admin')
            """
        )
    except Exception:
        pass

    admin_ids = _bootstrap_admin_user_ids()
    if admin_ids:
        placeholders = ", ".join(["%s"] * len(admin_ids))
        cur.execute(
            f"UPDATE users SET role='admin' WHERE user_id IN ({placeholders})",
            tuple(admin_ids),
        )

    _USER_SCHEMA_READY = True


def ensure_schema() -> None:
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)


def user_exists(user_id: str) -> bool:
    uid = (user_id or "").strip()
    if not uid:
        return False
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute("SELECT 1 AS ok FROM users WHERE user_id=%s LIMIT 1", (uid,))
            row = cur.fetchone()
    return bool(row)


def get_user_row(user_id: str) -> Optional[Dict[str, str]]:
    """Return a user row mapped to legacy CSV keys.

    Legacy keys:
      ID, PW_HASH, EMAIL, BIRTH, NAME, NICKNAME, ROLE, JOIN_DATE
    """
    uid = (user_id or "").strip()
    if not uid:
        return None
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                SELECT user_id, pw_hash, email, birth, name, nickname,
                    COALESCE(NULLIF(TRIM(role), ''), 'user') AS role,
                    DATE_FORMAT(join_date, '%%Y-%%m-%%d %%H:%%i:%%s') AS join_date
                FROM users
                WHERE user_id=%s
                LIMIT 1
                """,
                (uid,),
            )

            r = cur.fetchone()
    if not r:
        return None
    return {
        "ID": str(r.get("user_id") or "").strip(),
        "PW_HASH": str(r.get("pw_hash") or "").strip(),
        "EMAIL": str(r.get("email") or "").strip(),
        "BIRTH": str(r.get("birth") or "").strip(),
        "NAME": str(r.get("name") or "").strip(),
        "NICKNAME": str(r.get("nickname") or "").strip(),
        "ROLE": _normalize_role(str(r.get("role") or "").strip()),
        "JOIN_DATE": str(r.get("join_date") or "").strip(),
    }


def create_user_row(
    *,
    user_id: str,
    pw_hash: str,
    email: str,
    birth: str,
    name: str,
    nickname: str,
    role: str = "user",
    email_verified: bool = True,
) -> None:
    """Insert a new user.

    Raises on failure (duplicate, etc.).
    """
    uid = (user_id or "").strip()
    role_value = _normalize_role(role)
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                INSERT INTO users (user_id, pw_hash, email, birth, name, nickname, role, join_date, email_verified, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, NOW(), %s, NOW(), NOW())
                """,
                (
                    uid,
                    pw_hash,
                    email,
                    birth,
                    name,
                    nickname,
                    role_value,
                    1 if email_verified else 0,
                ),
            )
