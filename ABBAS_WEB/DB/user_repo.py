from __future__ import annotations

import os
from datetime import datetime
from typing import Any, Dict, Optional

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


def _normalize_approval_status(status: str) -> str:
    value = str(status or "").strip().lower()
    if value == "pending":
        return "pending"
    return "approved"


def _normalize_presence_override(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"online", "away", "dnd", "invisible"}:
        return normalized
    return ""


def _bootstrap_admin_user_ids() -> list[str]:
    raw = (os.getenv("ABBAS_ADMIN_USER_IDS") or "").strip()
    if not raw:
        return []
    return [token for token in {part.strip() for part in raw.split(",")} if token]


def _normalize_datetime_value(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    text = str(value or "").strip()
    if not text:
        return None
    for pattern in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, pattern)
        except ValueError:
            continue
    return None


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
    if "presence_override" not in cols:
        cur.execute("ALTER TABLE users ADD COLUMN presence_override VARCHAR(16) NOT NULL DEFAULT '' AFTER profile_image_path")
    if "approval_status" not in cols:
        cur.execute("ALTER TABLE users ADD COLUMN approval_status VARCHAR(16) NOT NULL DEFAULT 'approved' AFTER role")
    if "approved_at" not in cols:
        cur.execute("ALTER TABLE users ADD COLUMN approved_at DATETIME NULL AFTER approval_status")
    if "approved_by" not in cols:
        cur.execute("ALTER TABLE users ADD COLUMN approved_by VARCHAR(32) NOT NULL DEFAULT '' AFTER approved_at")

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

    try:
        cur.execute(
            """
            UPDATE users
            SET approval_status='approved'
            WHERE approval_status IS NULL
               OR TRIM(approval_status)=''
               OR LOWER(TRIM(approval_status)) NOT IN ('pending', 'approved')
            """
        )
    except Exception:
        pass

    try:
        cur.execute(
            """
            UPDATE users
            SET presence_override=''
            WHERE presence_override IS NULL
               OR LOWER(TRIM(COALESCE(presence_override, ''))) NOT IN ('', 'online', 'away', 'dnd', 'invisible')
            """
        )
    except Exception:
        pass

    try:
        cur.execute(
            """
            UPDATE users
            SET approved_at=COALESCE(approved_at, join_date, created_at, NOW())
            WHERE LOWER(TRIM(COALESCE(approval_status, 'approved')))='approved'
              AND approved_at IS NULL
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


def _map_user_row(r: dict[str, Any]) -> Dict[str, str]:
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
        "PRESENCE_OVERRIDE": _normalize_presence_override(r.get("presence_override")),
        "ROLE": _normalize_role(str(r.get("role") or "").strip()),
        "APPROVAL_STATUS": _normalize_approval_status(str(r.get("approval_status") or "").strip()),
        "APPROVED_AT": str(r.get("approved_at") or "").strip(),
        "APPROVED_BY": str(r.get("approved_by") or "").strip(),
        "JOIN_DATE": str(r.get("join_date") or "").strip(),
    }


def get_user_row(user_id: str) -> Optional[Dict[str, str]]:
    """Return a user row mapped to legacy CSV keys.

    Legacy keys:
      ID, PW_HASH, EMAIL, BIRTH, NAME, NICKNAME, PHONE, DEPARTMENT,
      LOCATION, BIO, PROFILE_IMAGE_PATH, ROLE, APPROVAL_STATUS,
      APPROVED_AT, APPROVED_BY, JOIN_DATE
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
                    COALESCE(NULLIF(TRIM(presence_override), ''), '') AS presence_override,
                    COALESCE(NULLIF(TRIM(role), ''), 'user') AS role,
                    COALESCE(NULLIF(TRIM(approval_status), ''), 'approved') AS approval_status,
                    COALESCE(DATE_FORMAT(approved_at, '%%Y-%%m-%%d %%H:%%i:%%s'), '') AS approved_at,
                    COALESCE(NULLIF(TRIM(approved_by), ''), '') AS approved_by,
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
    return _map_user_row(r)


def create_user_row(
    *,
    user_id: str,
    pw_hash: str,
    email: str,
    birth: str,
    name: str,
    nickname: str,
    role: str = "user",
    approval_status: str = "approved",
    join_date: Any = None,
    approved_at: Any = None,
    approved_by: str = "",
    email_verified: bool = True,
) -> None:
    """Insert a new user.

    Raises on failure (duplicate, etc.).
    """
    uid = (user_id or "").strip()
    role_value = _normalize_role(role)
    approval_value = _normalize_approval_status(approval_status)
    join_date_value = _normalize_datetime_value(join_date) or datetime.now()
    approved_at_value = _normalize_datetime_value(approved_at)
    if approval_value == "approved" and approved_at_value is None:
        approved_at_value = join_date_value
    approved_by_value = (approved_by or "").strip() if approval_value == "approved" else ""
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                INSERT INTO users (
                    user_id, pw_hash, email, birth, name, nickname, role,
                    approval_status, approved_at, approved_by, join_date,
                    email_verified, created_at, updated_at
                )
                VALUES (
                    %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s, NOW(), NOW()
                )
                """,
                (
                    uid,
                    pw_hash,
                    email,
                    birth,
                    name,
                    nickname,
                    role_value,
                    approval_value,
                    approved_at_value,
                    approved_by_value,
                    join_date_value,
                    1 if email_verified else 0,
                ),
            )


def list_user_rows() -> list[Dict[str, str]]:
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
                    COALESCE(NULLIF(TRIM(presence_override), ''), '') AS presence_override,
                    COALESCE(NULLIF(TRIM(role), ''), 'user') AS role,
                    COALESCE(NULLIF(TRIM(approval_status), ''), 'approved') AS approval_status,
                    COALESCE(DATE_FORMAT(approved_at, '%%Y-%%m-%%d %%H:%%i:%%s'), '') AS approved_at,
                    COALESCE(NULLIF(TRIM(approved_by), ''), '') AS approved_by,
                    COALESCE(DATE_FORMAT(join_date, '%%Y-%%m-%%d %%H:%%i:%%s'), '') AS join_date
                FROM users
                ORDER BY
                    CASE LOWER(TRIM(COALESCE(approval_status, 'approved')))
                        WHEN 'pending' THEN 0
                        ELSE 1
                    END ASC,
                    CASE LOWER(TRIM(COALESCE(role, 'user')))
                        WHEN 'superuser' THEN 0
                        WHEN 'admin' THEN 1
                        ELSE 2
                    END ASC,
                    COALESCE(join_date, created_at) DESC,
                    user_id ASC
                """
            )
            rows = cur.fetchall() or []
    return [_map_user_row(row) for row in rows]


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


def update_user_presence_override(*, user_id: str, presence_override: str) -> None:
    uid = (user_id or "").strip()
    presence_value = _normalize_presence_override(presence_override)
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                UPDATE users
                SET presence_override=%s,
                    updated_at=NOW()
                WHERE user_id=%s
                """,
                (
                    presence_value,
                    uid,
                ),
            )


def update_user_role(*, user_id: str, role: str) -> None:
    uid = (user_id or "").strip()
    role_value = _normalize_role(role)
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                UPDATE users
                SET role=%s,
                    updated_at=NOW()
                WHERE user_id=%s
                """,
                (role_value, uid),
            )


def update_user_approval(*, user_id: str, approval_status: str, approved_by: str = "") -> None:
    uid = (user_id or "").strip()
    approval_value = _normalize_approval_status(approval_status)
    approver = (approved_by or "").strip()
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                UPDATE users
                SET approval_status=%s,
                    approved_at=CASE WHEN %s='approved' THEN NOW() ELSE NULL END,
                    approved_by=CASE WHEN %s='approved' THEN %s ELSE '' END,
                    updated_at=NOW()
                WHERE user_id=%s
                """,
                (
                    approval_value,
                    approval_value,
                    approval_value,
                    approver,
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
