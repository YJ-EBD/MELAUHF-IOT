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
    if value in {"admin", "superuser"}:
        return value
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
    if "phone" not in cols:
        cur.execute("ALTER TABLE users ADD COLUMN phone VARCHAR(32) NOT NULL DEFAULT '' AFTER email")
    if "department" not in cols:
        cur.execute("ALTER TABLE users ADD COLUMN department VARCHAR(64) NOT NULL DEFAULT '' AFTER phone")
    if "location" not in cols:
        cur.execute("ALTER TABLE users ADD COLUMN location VARCHAR(64) NOT NULL DEFAULT '' AFTER department")
    if "bio" not in cols:
        cur.execute("ALTER TABLE users ADD COLUMN bio VARCHAR(500) NOT NULL DEFAULT '' AFTER location")
    if "profile_image_path" not in cols:
        cur.execute("ALTER TABLE users ADD COLUMN profile_image_path VARCHAR(255) NOT NULL DEFAULT '' AFTER bio")

    try:
        cur.execute(
            """
            UPDATE users
            SET role='user'
            WHERE role IS NULL
               OR TRIM(role)=''
               OR LOWER(TRIM(role)) NOT IN ('user', 'admin', 'superuser')
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
      ID, PW_HASH, EMAIL, BIRTH, NAME, NICKNAME, PHONE, DEPARTMENT,
      LOCATION, BIO, PROFILE_IMAGE_PATH, ROLE, JOIN_DATE
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
                    COALESCE(NULLIF(TRIM(phone), ''), '') AS phone,
                    COALESCE(NULLIF(TRIM(department), ''), '') AS department,
                    COALESCE(NULLIF(TRIM(location), ''), '') AS location,
                    COALESCE(NULLIF(TRIM(bio), ''), '') AS bio,
                    COALESCE(NULLIF(TRIM(profile_image_path), ''), '') AS profile_image_path,
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
        "PHONE": str(r.get("phone") or "").strip(),
        "DEPARTMENT": str(r.get("department") or "").strip(),
        "LOCATION": str(r.get("location") or "").strip(),
        "BIO": str(r.get("bio") or "").strip(),
        "PROFILE_IMAGE_PATH": str(r.get("profile_image_path") or "").strip(),
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


def update_user_profile_row(
    *,
    user_id: str,
    email: str,
    birth: str,
    name: str,
    nickname: str,
    phone: str = "",
    department: str = "",
    location: str = "",
    bio: str = "",
    profile_image_path: str = "",
) -> None:
    uid = (user_id or "").strip()
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                UPDATE users
                SET email=%s,
                    birth=%s,
                    name=%s,
                    nickname=%s,
                    phone=%s,
                    department=%s,
                    location=%s,
                    bio=%s,
                    profile_image_path=%s,
                    updated_at=NOW()
                WHERE user_id=%s
                """,
                (
                    (email or "").strip(),
                    (birth or "").strip() or None,
                    (name or "").strip(),
                    (nickname or "").strip(),
                    (phone or "").strip(),
                    (department or "").strip(),
                    (location or "").strip(),
                    (bio or "").strip(),
                    (profile_image_path or "").strip(),
                    uid,
                ),
            )


def update_user_password_hash(*, user_id: str, pw_hash: str) -> None:
    uid = (user_id or "").strip()
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                UPDATE users
                SET pw_hash=%s,
                    updated_at=NOW()
                WHERE user_id=%s
                """,
                (
                    (pw_hash or "").strip(),
                    uid,
                ),
            )


def delete_user_row(*, user_id: str) -> None:
    uid = (user_id or "").strip()
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute("DELETE FROM users WHERE user_id=%s", (uid,))
