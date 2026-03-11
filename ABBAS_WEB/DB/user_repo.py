from __future__ import annotations

from typing import Dict, Optional

from .runtime import get_mysql


def user_exists(user_id: str) -> bool:
    uid = (user_id or "").strip()
    if not uid:
        return False
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 AS ok FROM users WHERE user_id=%s LIMIT 1", (uid,))
            row = cur.fetchone()
    return bool(row)


def get_user_row(user_id: str) -> Optional[Dict[str, str]]:
    """Return a user row mapped to legacy CSV keys.

    Legacy keys:
      ID, PW_HASH, EMAIL, BIRTH, NAME, NICKNAME, JOIN_DATE
    """
    uid = (user_id or "").strip()
    if not uid:
        return None
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT user_id, pw_hash, email, birth, name, nickname,
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
    email_verified: bool = True,
) -> None:
    """Insert a new user.

    Raises on failure (duplicate, etc.).
    """
    uid = (user_id or "").strip()
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO users (user_id, pw_hash, email, birth, name, nickname, join_date, email_verified, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, NOW(), %s, NOW(), NOW())
                """,
                (
                    uid,
                    pw_hash,
                    email,
                    birth,
                    name,
                    nickname,
                    1 if email_verified else 0,
                ),
            )
