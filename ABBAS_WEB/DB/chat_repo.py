from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from .runtime import get_mysql
from . import user_repo


_SCHEMA_READY = False
_DIRECT_MESSAGE_MAX_LEN = 5000


def _norm_text(value: Any) -> str:
    return str(value or "").strip()


def _norm_user_id(value: Any) -> str:
    return _norm_text(value)


def _norm_room_type(value: Any) -> str:
    room_type = _norm_text(value).lower()
    if room_type in {"dm", "group", "channel"}:
        return room_type
    return "group"


def _room_slug_token(value: Any) -> str:
    text = _norm_text(value)
    if not text:
        return ""
    normalized = re.sub(r"\s+", " ", text)
    digest = hashlib.sha1(normalized.encode("utf-8")).hexdigest()
    return digest[:16]


def _message_preview(value: Any, limit: int = 140) -> str:
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    return text[: max(limit - 1, 0)].rstrip() + "…"


def _attachment_payload(message_type: Any, content: Any) -> dict[str, str]:
    normalized_type = _norm_text(message_type).lower()
    if normalized_type not in {"file", "image"}:
        return {}
    try:
        payload = json.loads(str(content or "{}"))
    except Exception:
        payload = {}
    if not isinstance(payload, dict):
        return {}
    url = _norm_text(payload.get("url"))
    fallback_name = url.rsplit("/", 1)[-1] if url else ""
    return {
        "kind": normalized_type,
        "name": _norm_text(payload.get("name")) or _norm_text(payload.get("filename")) or fallback_name,
        "url": url,
        "size_text": _norm_text(payload.get("size_text")),
        "content_type": _norm_text(payload.get("content_type")),
    }


def _message_preview_for_type(message_type: Any, content: Any, limit: int = 140) -> str:
    attachment = _attachment_payload(message_type, content)
    if attachment:
        label = "[이미지]" if attachment.get("kind") == "image" else "[파일]"
        name = attachment.get("name") or attachment.get("url") or "첨부"
        return _message_preview(f"{label} {name}", limit=limit)
    return _message_preview(content, limit=limit)


def _ensure_schema_with_cur(cur) -> None:
    global _SCHEMA_READY
    if _SCHEMA_READY:
        return

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS chat_rooms (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          room_type VARCHAR(16) NOT NULL,
          room_key VARCHAR(191) NOT NULL DEFAULT '',
          name VARCHAR(255) NOT NULL DEFAULT '',
          topic VARCHAR(255) NOT NULL DEFAULT '',
          avatar_path VARCHAR(255) NOT NULL DEFAULT '',
          created_by VARCHAR(64) NOT NULL DEFAULT '',
          last_message_id BIGINT UNSIGNED NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_chat_rooms_room_key (room_key),
          KEY idx_chat_rooms_type_updated (room_type, updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS chat_room_members (
          room_id BIGINT UNSIGNED NOT NULL,
          user_id VARCHAR(64) NOT NULL,
          member_role VARCHAR(16) NOT NULL DEFAULT 'member',
          last_read_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
          is_starred TINYINT(1) NOT NULL DEFAULT 0,
          is_muted TINYINT(1) NOT NULL DEFAULT 0,
          joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (room_id, user_id),
          KEY idx_chat_room_members_user (user_id, updated_at),
          KEY idx_chat_room_members_room (room_id, updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS chat_messages (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          room_id BIGINT UNSIGNED NOT NULL,
          sender_user_id VARCHAR(64) NOT NULL,
          message_type VARCHAR(16) NOT NULL DEFAULT 'text',
          content TEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          edited_at DATETIME NULL,
          deleted_at DATETIME NULL,
          PRIMARY KEY (id),
          KEY idx_chat_messages_room_recent (room_id, id),
          KEY idx_chat_messages_sender_recent (sender_user_id, id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )

    try:
        cur.execute("SHOW COLUMNS FROM chat_rooms")
        room_cols = {str(row.get('Field') or '').strip() for row in (cur.fetchall() or [])}
    except Exception:
        room_cols = set()
    if "avatar_path" not in room_cols:
        cur.execute("ALTER TABLE chat_rooms ADD COLUMN avatar_path VARCHAR(255) NOT NULL DEFAULT '' AFTER topic")

    try:
        cur.execute("SHOW COLUMNS FROM chat_room_members")
        cols = {str(row.get('Field') or '').strip() for row in (cur.fetchall() or [])}
    except Exception:
        cols = set()
    if "is_starred" not in cols:
        cur.execute("ALTER TABLE chat_room_members ADD COLUMN is_starred TINYINT(1) NOT NULL DEFAULT 0 AFTER last_read_message_id")
    if "is_muted" not in cols:
        cur.execute("ALTER TABLE chat_room_members ADD COLUMN is_muted TINYINT(1) NOT NULL DEFAULT 0 AFTER is_starred")
    if "updated_at" not in cols:
        cur.execute("ALTER TABLE chat_room_members ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER joined_at")

    _SCHEMA_READY = True


def ensure_schema() -> None:
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)


def _ensure_room_with_cur(
    cur,
    *,
    room_type: str,
    room_key: str,
    name: str,
    topic: str = "",
    created_by: str = "",
) -> int:
    cur.execute(
        """
        INSERT INTO chat_rooms (
          room_type, room_key, name, topic, created_by, created_at, updated_at
        )
        VALUES (%s, %s, %s, %s, %s, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          room_type=VALUES(room_type),
          name=CASE WHEN TRIM(VALUES(name))='' THEN name ELSE VALUES(name) END,
          topic=CASE WHEN TRIM(VALUES(topic))='' THEN topic ELSE VALUES(topic) END,
          updated_at=updated_at
        """,
        (room_type, room_key, name, topic, created_by),
    )
    cur.execute("SELECT id FROM chat_rooms WHERE room_key=%s LIMIT 1", (room_key,))
    row = cur.fetchone() or {}
    return int(row.get("id") or 0)


def _upsert_room_members_with_cur(cur, room_id: int, member_rows: list[tuple[str, str]]) -> int:
    normalized_rows: list[tuple[int, str, str]] = []
    seen: set[str] = set()
    for user_id, member_role in member_rows:
        uid = _norm_user_id(user_id)
        role = _norm_text(member_role).lower() or "member"
        if not uid or uid in seen:
            continue
        seen.add(uid)
        if role not in {"owner", "admin", "member"}:
            role = "member"
        normalized_rows.append((int(room_id), uid, role))
    if not normalized_rows:
        return 0

    cur.executemany(
        """
        INSERT INTO chat_room_members (
          room_id, user_id, member_role, joined_at, updated_at
        )
        VALUES (%s, %s, %s, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          member_role=CASE
            WHEN chat_room_members.member_role='owner' THEN chat_room_members.member_role
            ELSE VALUES(member_role)
          END,
          updated_at=NOW()
        """,
        normalized_rows,
    )
    return len(normalized_rows)


def ensure_default_rooms() -> None:
    approved_rows = [
        row
        for row in (user_repo.list_user_rows() or [])
        if str(row.get("APPROVAL_STATUS") or "").strip().lower() == "approved"
        and _norm_user_id(row.get("ID"))
    ]
    if not approved_rows:
        return

    company_members = [(_norm_user_id(row.get("ID")), "member") for row in approved_rows]
    department_map: dict[str, list[tuple[str, str]]] = {}
    leadership_members: list[tuple[str, str]] = []

    for row in approved_rows:
        user_id = _norm_user_id(row.get("ID"))
        role = str(row.get("ROLE") or "").strip().lower()
        department = _norm_text(row.get("DEPARTMENT"))
        if department:
            department_map.setdefault(department, []).append((user_id, "member"))
        if role in {"admin", "superuser"}:
            leadership_members.append((user_id, "admin" if role == "admin" else "owner"))

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)

            room_id = _ensure_room_with_cur(
                cur,
                room_type="channel",
                room_key="channel:company",
                name="전체 채널",
                topic="ABBAS_WEB 구성원 전체가 참여하는 공용 채널",
                created_by="system",
            )
            _upsert_room_members_with_cur(cur, room_id, company_members)

            if leadership_members:
                leadership_room_id = _ensure_room_with_cur(
                    cur,
                    room_type="channel",
                    room_key="channel:leadership",
                    name="운영 리더 채널",
                    topic="관리자와 슈퍼유저를 위한 운영 협업 채널",
                    created_by="system",
                )
                _upsert_room_members_with_cur(cur, leadership_room_id, leadership_members)

            for department, members in department_map.items():
                if not members:
                    continue
                department_room_id = _ensure_room_with_cur(
                    cur,
                    room_type="channel",
                    room_key=f"channel:dept:{_room_slug_token(department)}",
                    name=f"{department} 채널",
                    topic=f"{department} 팀 협업용 기본 채널",
                    created_by="system",
                )
                _upsert_room_members_with_cur(cur, department_room_id, members)


def _load_room_member_rows(cur, room_ids: list[int]) -> dict[int, list[dict[str, Any]]]:
    if not room_ids:
        return {}

    placeholders = ", ".join(["%s"] * len(room_ids))
    cur.execute(
        f"""
        SELECT
          m.room_id,
          m.user_id,
          COALESCE(m.member_role, 'member') AS member_role,
          COALESCE(u.nickname, '') AS nickname,
          COALESCE(u.name, '') AS name,
          COALESCE(u.department, '') AS department,
          COALESCE(u.profile_image_path, '') AS profile_image_path,
          COALESCE(u.role, 'user') AS role
        FROM chat_room_members m
        LEFT JOIN users u
          ON u.user_id = m.user_id
        WHERE m.room_id IN ({placeholders})
        ORDER BY m.room_id ASC, m.joined_at ASC, m.user_id ASC
        """,
        tuple(room_ids),
    )
    rows = cur.fetchall() or []
    result: dict[int, list[dict[str, Any]]] = {}
    for row in rows:
        room_id = int(row.get("room_id") or 0)
        if room_id <= 0:
            continue
        result.setdefault(room_id, []).append(
            {
                "user_id": _norm_user_id(row.get("user_id")),
                "member_role": _norm_text(row.get("member_role")) or "member",
                "nickname": _norm_text(row.get("nickname")),
                "name": _norm_text(row.get("name")),
                "department": _norm_text(row.get("department")),
                "profile_image_path": _norm_text(row.get("profile_image_path")),
                "role": _norm_text(row.get("role")) or "user",
            }
        )
    return result


def list_rooms_for_user(user_id: str) -> list[dict[str, Any]]:
    uid = _norm_user_id(user_id)
    if not uid:
        return []

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                SELECT
                  r.id,
                  r.room_type,
                  COALESCE(r.room_key, '') AS room_key,
                  COALESCE(r.name, '') AS name,
                  COALESCE(r.topic, '') AS topic,
                  COALESCE(r.avatar_path, '') AS avatar_path,
                  COALESCE(r.created_by, '') AS created_by,
                  COALESCE(m.member_role, 'member') AS member_role,
                  COALESCE(m.last_read_message_id, 0) AS last_read_message_id,
                  COALESCE(m.is_starred, 0) AS is_starred,
                  COALESCE(m.is_muted, 0) AS is_muted,
                  COALESCE(last_msg.id, 0) AS last_message_id,
                  COALESCE(last_msg.message_type, 'text') AS last_message_type,
                  COALESCE(last_msg.sender_user_id, '') AS last_sender_user_id,
                  COALESCE(last_msg.content, '') AS last_message_text,
                  COALESCE(DATE_FORMAT(last_msg.created_at, '%%Y-%%m-%%d %%H:%%i:%%s'), '') AS last_message_at,
                  (
                    SELECT COUNT(*)
                    FROM chat_messages unread_msg
                    WHERE unread_msg.room_id = r.id
                      AND unread_msg.deleted_at IS NULL
                      AND unread_msg.id > COALESCE(m.last_read_message_id, 0)
                      AND unread_msg.sender_user_id <> %s
                  ) AS unread_count
                FROM chat_room_members m
                INNER JOIN chat_rooms r
                  ON r.id = m.room_id
                LEFT JOIN chat_messages last_msg
                  ON last_msg.id = r.last_message_id
                WHERE m.user_id = %s
                ORDER BY
                  CASE WHEN COALESCE(last_msg.created_at, r.updated_at) IS NULL THEN 1 ELSE 0 END ASC,
                  COALESCE(last_msg.created_at, r.updated_at) DESC,
                  r.id DESC
                """,
                (uid, uid),
            )
            rows = cur.fetchall() or []
            room_ids = [int(row.get("id") or 0) for row in rows if int(row.get("id") or 0) > 0]
            member_map = _load_room_member_rows(cur, room_ids)

    rooms: list[dict[str, Any]] = []
    for row in rows:
        room_id = int(row.get("id") or 0)
        if room_id <= 0:
            continue
        rooms.append(
            {
                "id": room_id,
                "room_type": _norm_room_type(row.get("room_type")),
                "room_key": _norm_text(row.get("room_key")),
                "name": _norm_text(row.get("name")),
                "topic": _norm_text(row.get("topic")),
                "avatar_path": _norm_text(row.get("avatar_path")),
                "created_by": _norm_user_id(row.get("created_by")),
                "member_role": _norm_text(row.get("member_role")) or "member",
                "last_read_message_id": int(row.get("last_read_message_id") or 0),
                "is_starred": bool(int(row.get("is_starred") or 0)),
                "is_muted": bool(int(row.get("is_muted") or 0)),
                "last_message_id": int(row.get("last_message_id") or 0),
                "last_message_type": _norm_text(row.get("last_message_type")) or "text",
                "last_sender_user_id": _norm_user_id(row.get("last_sender_user_id")),
                "last_message_text": _norm_text(row.get("last_message_text")),
                "last_message_preview": _message_preview_for_type(row.get("last_message_type"), row.get("last_message_text")),
                "last_message_at": _norm_text(row.get("last_message_at")),
                "unread_count": max(int(row.get("unread_count") or 0), 0),
                "members": member_map.get(room_id, []),
            }
        )
    return rooms


def get_room_for_user(room_id: int, user_id: str) -> dict[str, Any] | None:
    uid = _norm_user_id(user_id)
    try:
        target_room_id = int(room_id)
    except Exception:
        return None
    if target_room_id <= 0 or not uid:
        return None
    rooms = list_rooms_for_user(uid)
    for room in rooms:
        if int(room.get("id") or 0) == target_room_id:
            return room
    return None


def list_room_user_ids(room_id: int) -> list[str]:
    try:
        target_room_id = int(room_id)
    except Exception:
        return []
    if target_room_id <= 0:
        return []

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                SELECT user_id
                FROM chat_room_members
                WHERE room_id=%s
                ORDER BY joined_at ASC, user_id ASC
                """,
                (target_room_id,),
            )
            rows = cur.fetchall() or []
    return [_norm_user_id(row.get("user_id")) for row in rows if _norm_user_id(row.get("user_id"))]


def room_has_member(room_id: int, user_id: str) -> bool:
    try:
        target_room_id = int(room_id)
    except Exception:
        return False
    uid = _norm_user_id(user_id)
    if target_room_id <= 0 or not uid:
        return False

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                SELECT 1 AS ok
                FROM chat_room_members
                WHERE room_id=%s AND user_id=%s
                LIMIT 1
                """,
                (target_room_id, uid),
            )
            row = cur.fetchone() or {}
    return bool(row.get("ok"))


def add_room_members(room_id: int, member_ids: list[str]) -> list[str]:
    try:
        target_room_id = int(room_id)
    except Exception:
        return []
    if target_room_id <= 0:
        return []

    normalized_ids: list[str] = []
    seen: set[str] = set()
    for raw_user_id in list(member_ids or []):
        user_id = _norm_user_id(raw_user_id)
        if not user_id or user_id in seen:
            continue
        seen.add(user_id)
        normalized_ids.append(user_id)
    if not normalized_ids:
        return []

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                SELECT user_id
                FROM chat_room_members
                WHERE room_id=%s
                """,
                (target_room_id,),
            )
            existing_ids = {
                _norm_user_id(row.get("user_id"))
                for row in (cur.fetchall() or [])
                if _norm_user_id(row.get("user_id"))
            }
            new_ids = [user_id for user_id in normalized_ids if user_id not in existing_ids]
            if not new_ids:
                return []
            _upsert_room_members_with_cur(cur, target_room_id, [(user_id, "member") for user_id in new_ids])
            cur.execute(
                """
                UPDATE chat_rooms
                SET updated_at=NOW()
                WHERE id=%s
                """,
                (target_room_id,),
            )
    return new_ids


def get_room_by_id(room_id: int) -> dict[str, Any] | None:
    try:
        target_room_id = int(room_id)
    except Exception:
        return None
    if target_room_id <= 0:
        return None

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                SELECT
                  id,
                  COALESCE(room_type, 'group') AS room_type,
                  COALESCE(room_key, '') AS room_key,
                  COALESCE(name, '') AS name,
                  COALESCE(topic, '') AS topic,
                  COALESCE(avatar_path, '') AS avatar_path,
                  COALESCE(created_by, '') AS created_by,
                  COALESCE(last_message_id, 0) AS last_message_id
                FROM chat_rooms
                WHERE id=%s
                LIMIT 1
                """,
                (target_room_id,),
            )
            row = cur.fetchone() or {}
    if not row:
        return None
    return {
        "id": int(row.get("id") or 0),
        "room_type": _norm_room_type(row.get("room_type")),
        "room_key": _norm_text(row.get("room_key")),
        "name": _norm_text(row.get("name")),
        "topic": _norm_text(row.get("topic")),
        "avatar_path": _norm_text(row.get("avatar_path")),
        "created_by": _norm_user_id(row.get("created_by")),
        "last_message_id": int(row.get("last_message_id") or 0),
    }


def _refresh_room_last_message_with_cur(cur, room_id: int) -> int:
    target_room_id = int(room_id or 0)
    if target_room_id <= 0:
        return 0
    cur.execute(
        """
        SELECT COALESCE(MAX(id), 0) AS last_message_id
        FROM chat_messages
        WHERE room_id=%s
          AND deleted_at IS NULL
        """,
        (target_room_id,),
    )
    row = cur.fetchone() or {}
    last_message_id = int(row.get("last_message_id") or 0)
    cur.execute(
        """
        UPDATE chat_rooms
        SET last_message_id=%s, updated_at=NOW()
        WHERE id=%s
        """,
        (last_message_id if last_message_id > 0 else None, target_room_id),
    )
    return last_message_id


def list_messages_for_user(user_id: str, room_id: int, limit: int = 80, before_message_id: int = 0) -> list[dict[str, Any]]:
    uid = _norm_user_id(user_id)
    try:
        target_room_id = int(room_id)
    except Exception:
        target_room_id = 0
    try:
        cursor_id = int(before_message_id or 0)
    except Exception:
        cursor_id = 0
    limit = max(min(int(limit or 80), 200), 1)
    if target_room_id <= 0 or not uid or not room_has_member(target_room_id, uid):
        return []

    where_before = ""
    params: list[Any] = [target_room_id]
    if cursor_id > 0:
        where_before = "AND msg.id < %s"
        params.append(cursor_id)
    params.append(limit)

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                f"""
                SELECT
                  msg.id,
                  msg.room_id,
                  msg.sender_user_id,
                  COALESCE(msg.message_type, 'text') AS message_type,
                  COALESCE(msg.content, '') AS content,
                  COALESCE(DATE_FORMAT(msg.created_at, '%%Y-%%m-%%d %%H:%%i:%%s'), '') AS created_at,
                  COALESCE(DATE_FORMAT(msg.edited_at, '%%Y-%%m-%%d %%H:%%i:%%s'), '') AS edited_at,
                  COALESCE(u.nickname, '') AS sender_nickname,
                  COALESCE(u.name, '') AS sender_name,
                  COALESCE(u.department, '') AS sender_department,
                  COALESCE(u.profile_image_path, '') AS sender_profile_image_path,
                  COALESCE(u.role, 'user') AS sender_role
                FROM (
                  SELECT *
                  FROM chat_messages
                  WHERE room_id=%s
                    AND deleted_at IS NULL
                    {where_before}
                  ORDER BY id DESC
                  LIMIT %s
                ) AS msg
                LEFT JOIN users u
                  ON u.user_id = msg.sender_user_id
                ORDER BY msg.id ASC
                """,
                tuple(params),
            )
            rows = cur.fetchall() or []

    messages: list[dict[str, Any]] = []
    for row in rows:
        messages.append(
            {
                "id": int(row.get("id") or 0),
                "room_id": int(row.get("room_id") or 0),
                "sender_user_id": _norm_user_id(row.get("sender_user_id")),
                "message_type": _norm_text(row.get("message_type")) or "text",
                "content": str(row.get("content") or ""),
                "created_at": _norm_text(row.get("created_at")),
                "edited_at": _norm_text(row.get("edited_at")),
                "sender_nickname": _norm_text(row.get("sender_nickname")),
                "sender_name": _norm_text(row.get("sender_name")),
                "sender_department": _norm_text(row.get("sender_department")),
                "sender_profile_image_path": _norm_text(row.get("sender_profile_image_path")),
                "sender_role": _norm_text(row.get("sender_role")) or "user",
            }
        )
    return messages


def get_message_by_id(message_id: int) -> dict[str, Any] | None:
    try:
        target_message_id = int(message_id)
    except Exception:
        return None
    if target_message_id <= 0:
        return None

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                SELECT
                  msg.id,
                  msg.room_id,
                  msg.sender_user_id,
                  COALESCE(msg.message_type, 'text') AS message_type,
                  COALESCE(msg.content, '') AS content,
                  COALESCE(DATE_FORMAT(msg.created_at, '%%Y-%%m-%%d %%H:%%i:%%s'), '') AS created_at,
                  COALESCE(DATE_FORMAT(msg.edited_at, '%%Y-%%m-%%d %%H:%%i:%%s'), '') AS edited_at,
                  COALESCE(DATE_FORMAT(msg.deleted_at, '%%Y-%%m-%%d %%H:%%i:%%s'), '') AS deleted_at,
                  COALESCE(u.nickname, '') AS sender_nickname,
                  COALESCE(u.name, '') AS sender_name,
                  COALESCE(u.department, '') AS sender_department,
                  COALESCE(u.profile_image_path, '') AS sender_profile_image_path,
                  COALESCE(u.role, 'user') AS sender_role
                FROM chat_messages msg
                LEFT JOIN users u
                  ON u.user_id = msg.sender_user_id
                WHERE msg.id=%s
                LIMIT 1
                """,
                (target_message_id,),
            )
            row = cur.fetchone() or {}
    if not row:
        return None
    return {
        "id": int(row.get("id") or 0),
        "room_id": int(row.get("room_id") or 0),
        "sender_user_id": _norm_user_id(row.get("sender_user_id")),
        "message_type": _norm_text(row.get("message_type")) or "text",
        "content": str(row.get("content") or ""),
        "created_at": _norm_text(row.get("created_at")),
        "edited_at": _norm_text(row.get("edited_at")),
        "deleted_at": _norm_text(row.get("deleted_at")),
        "sender_nickname": _norm_text(row.get("sender_nickname")),
        "sender_name": _norm_text(row.get("sender_name")),
        "sender_department": _norm_text(row.get("sender_department")),
        "sender_profile_image_path": _norm_text(row.get("sender_profile_image_path")),
        "sender_role": _norm_text(row.get("sender_role")) or "user",
    }


def list_recent_notifications_for_user(user_id: str, limit: int = 20) -> list[dict[str, Any]]:
    uid = _norm_user_id(user_id)
    limit = max(min(int(limit or 20), 50), 1)
    if not uid:
        return []

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                SELECT
                  msg.id,
                  msg.room_id,
                  msg.sender_user_id,
                  COALESCE(msg.message_type, 'text') AS message_type,
                  COALESCE(msg.content, '') AS content,
                  COALESCE(DATE_FORMAT(msg.created_at, '%%Y-%%m-%%d %%H:%%i:%%s'), '') AS created_at,
                  COALESCE(DATE_FORMAT(msg.edited_at, '%%Y-%%m-%%d %%H:%%i:%%s'), '') AS edited_at,
                  COALESCE(u.nickname, '') AS sender_nickname,
                  COALESCE(u.name, '') AS sender_name,
                  COALESCE(u.department, '') AS sender_department,
                  COALESCE(u.profile_image_path, '') AS sender_profile_image_path,
                  COALESCE(u.role, 'user') AS sender_role,
                  CASE
                    WHEN msg.id > COALESCE(m.last_read_message_id, 0) THEN 1
                    ELSE 0
                  END AS is_unread
                FROM chat_room_members m
                INNER JOIN chat_messages msg
                  ON msg.room_id = m.room_id
                 AND msg.deleted_at IS NULL
                 AND msg.sender_user_id <> %s
                LEFT JOIN users u
                  ON u.user_id = msg.sender_user_id
                WHERE m.user_id = %s
                  AND COALESCE(m.is_muted, 0) = 0
                ORDER BY msg.id DESC
                LIMIT %s
                """,
                (uid, uid, limit),
            )
            rows = cur.fetchall() or []

    notifications: list[dict[str, Any]] = []
    for row in rows:
        notifications.append(
            {
                "id": int(row.get("id") or 0),
                "room_id": int(row.get("room_id") or 0),
                "sender_user_id": _norm_user_id(row.get("sender_user_id")),
                "message_type": _norm_text(row.get("message_type")) or "text",
                "content": str(row.get("content") or ""),
                "created_at": _norm_text(row.get("created_at")),
                "edited_at": _norm_text(row.get("edited_at")),
                "sender_nickname": _norm_text(row.get("sender_nickname")),
                "sender_name": _norm_text(row.get("sender_name")),
                "sender_department": _norm_text(row.get("sender_department")),
                "sender_profile_image_path": _norm_text(row.get("sender_profile_image_path")),
                "sender_role": _norm_text(row.get("sender_role")) or "user",
                "is_unread": bool(int(row.get("is_unread") or 0)),
            }
        )
    return notifications


def insert_message(room_id: int, sender_user_id: str, content: str, message_type: str = "text") -> dict[str, Any]:
    try:
        target_room_id = int(room_id)
    except Exception:
        raise ValueError("room_id required")
    sender_id = _norm_user_id(sender_user_id)
    normalized_content = str(content or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    normalized_message_type = _norm_text(message_type).lower() or "text"
    if target_room_id <= 0:
        raise ValueError("room_id required")
    if not sender_id:
        raise ValueError("sender required")
    if not normalized_content:
        raise ValueError("message required")
    if normalized_message_type not in {"text", "file", "image"}:
        raise ValueError("message_type invalid")
    if len(normalized_content) > _DIRECT_MESSAGE_MAX_LEN:
        raise ValueError(f"메시지는 최대 {_DIRECT_MESSAGE_MAX_LEN}자까지 전송할 수 있습니다.")

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                SELECT 1 AS ok
                FROM chat_room_members
                WHERE room_id=%s AND user_id=%s
                LIMIT 1
                """,
                (target_room_id, sender_id),
            )
            row = cur.fetchone() or {}
            if not row.get("ok"):
                raise PermissionError("room access denied")

            cur.execute(
                """
                INSERT INTO chat_messages (
                  room_id, sender_user_id, message_type, content, created_at
                )
                VALUES (%s, %s, %s, %s, NOW())
                """,
                (target_room_id, sender_id, normalized_message_type, normalized_content),
            )
            message_id = int(cur.lastrowid or 0)

            cur.execute(
                """
                UPDATE chat_rooms
                SET last_message_id=%s, updated_at=NOW()
                WHERE id=%s
                """,
                (message_id, target_room_id),
            )
            cur.execute(
                """
                UPDATE chat_room_members
                SET last_read_message_id=GREATEST(COALESCE(last_read_message_id, 0), %s),
                    updated_at=NOW()
                WHERE room_id=%s AND user_id=%s
                """,
                (message_id, target_room_id, sender_id),
            )

    messages = list_messages_for_user(sender_id, target_room_id, limit=1)
    if not messages:
        raise RuntimeError("message load failed")
    return messages[-1]


def mark_room_read(room_id: int, user_id: str, message_id: int = 0) -> int:
    try:
        target_room_id = int(room_id)
    except Exception:
        return 0
    uid = _norm_user_id(user_id)
    try:
        target_message_id = int(message_id or 0)
    except Exception:
        target_message_id = 0
    if target_room_id <= 0 or not uid:
        return 0

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                SELECT COALESCE(last_message_id, 0) AS last_message_id
                FROM chat_rooms
                WHERE id=%s
                LIMIT 1
                """,
                (target_room_id,),
            )
            room_row = cur.fetchone() or {}
            room_last_message_id = int(room_row.get("last_message_id") or 0)
            if room_last_message_id <= 0:
                return 0

            resolved_message_id = room_last_message_id if target_message_id <= 0 else min(target_message_id, room_last_message_id)
            cur.execute(
                """
                UPDATE chat_room_members
                SET last_read_message_id=GREATEST(COALESCE(last_read_message_id, 0), %s),
                    updated_at=NOW()
                WHERE room_id=%s AND user_id=%s
                """,
                (resolved_message_id, target_room_id, uid),
            )
    return resolved_message_id


def set_room_star(room_id: int, user_id: str, starred: bool) -> bool:
    try:
        target_room_id = int(room_id)
    except Exception:
        return False
    uid = _norm_user_id(user_id)
    if target_room_id <= 0 or not uid:
        return False

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                UPDATE chat_room_members
                SET is_starred=%s, updated_at=NOW()
                WHERE room_id=%s AND user_id=%s
                """,
                (1 if starred else 0, target_room_id, uid),
            )
            return bool(cur.rowcount)


def set_room_mute(room_id: int, user_id: str, muted: bool) -> bool:
    try:
        target_room_id = int(room_id)
    except Exception:
        return False
    uid = _norm_user_id(user_id)
    if target_room_id <= 0 or not uid:
        return False

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                UPDATE chat_room_members
                SET is_muted=%s, updated_at=NOW()
                WHERE room_id=%s AND user_id=%s
                """,
                (1 if muted else 0, target_room_id, uid),
            )
            return bool(cur.rowcount)


def set_room_avatar(room_id: int, avatar_path: str) -> bool:
    try:
        target_room_id = int(room_id)
    except Exception:
        return False
    if target_room_id <= 0:
        return False

    normalized_avatar_path = _norm_text(avatar_path)
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                UPDATE chat_rooms
                SET avatar_path=%s, updated_at=NOW()
                WHERE id=%s AND room_type <> 'dm'
                """,
                (normalized_avatar_path, target_room_id),
            )
            return bool(cur.rowcount)


def update_room_details(room_id: int, *, name: str, topic: str = "") -> bool:
    try:
        target_room_id = int(room_id)
    except Exception:
        raise ValueError("room_id required")
    if target_room_id <= 0:
        raise ValueError("room_id required")

    normalized_name = _norm_text(name)
    normalized_topic = _norm_text(topic)
    if len(normalized_name) < 2:
        raise ValueError("대화방 이름은 2자 이상 입력해주세요.")
    if len(normalized_name) > 80:
        raise ValueError("대화방 이름은 80자 이하로 입력해주세요.")
    if len(normalized_topic) > 120:
        raise ValueError("대화방 설명은 120자 이하로 입력해주세요.")

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                UPDATE chat_rooms
                SET name=%s, topic=%s, updated_at=NOW()
                WHERE id=%s
                  AND room_type <> 'dm'
                """,
                (normalized_name, normalized_topic, target_room_id),
            )
            return bool(cur.rowcount)


def delete_room(room_id: int) -> bool:
    try:
        target_room_id = int(room_id)
    except Exception:
        return False
    if target_room_id <= 0:
        return False

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute("DELETE FROM chat_messages WHERE room_id=%s", (target_room_id,))
            cur.execute("DELETE FROM chat_room_members WHERE room_id=%s", (target_room_id,))
            cur.execute("DELETE FROM chat_rooms WHERE id=%s", (target_room_id,))
            return bool(cur.rowcount)


def update_message_content(message_id: int, content: str) -> dict[str, Any] | None:
    try:
        target_message_id = int(message_id)
    except Exception:
        raise ValueError("message_id required")
    if target_message_id <= 0:
        raise ValueError("message_id required")

    normalized_content = str(content or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized_content:
        raise ValueError("message required")
    if len(normalized_content) > _DIRECT_MESSAGE_MAX_LEN:
        raise ValueError(f"메시지는 최대 {_DIRECT_MESSAGE_MAX_LEN}자까지 입력할 수 있습니다.")

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                UPDATE chat_messages
                SET content=%s, edited_at=NOW()
                WHERE id=%s
                  AND deleted_at IS NULL
                """,
                (normalized_content, target_message_id),
            )
            if not cur.rowcount:
                return None
            cur.execute("SELECT room_id FROM chat_messages WHERE id=%s LIMIT 1", (target_message_id,))
            row = cur.fetchone() or {}
            room_id = int(row.get("room_id") or 0)
            if room_id > 0:
                _refresh_room_last_message_with_cur(cur, room_id)
    return get_message_by_id(target_message_id)


def delete_message(message_id: int) -> dict[str, int]:
    try:
        target_message_id = int(message_id)
    except Exception:
        return {"room_id": 0, "message_id": 0}
    if target_message_id <= 0:
        return {"room_id": 0, "message_id": 0}

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                SELECT room_id
                FROM chat_messages
                WHERE id=%s
                  AND deleted_at IS NULL
                LIMIT 1
                """,
                (target_message_id,),
            )
            row = cur.fetchone() or {}
            room_id = int(row.get("room_id") or 0)
            if room_id <= 0:
                return {"room_id": 0, "message_id": 0}
            cur.execute(
                """
                UPDATE chat_messages
                SET deleted_at=NOW()
                WHERE id=%s
                  AND deleted_at IS NULL
                """,
                (target_message_id,),
            )
            if not cur.rowcount:
                return {"room_id": 0, "message_id": 0}
            _refresh_room_last_message_with_cur(cur, room_id)
            return {"room_id": room_id, "message_id": target_message_id}


def get_or_create_direct_room(user_id: str, target_user_id: str) -> int:
    user_a = _norm_user_id(user_id)
    user_b = _norm_user_id(target_user_id)
    if not user_a or not user_b or user_a == user_b:
        raise ValueError("direct room target is invalid")

    pair = sorted([user_a, user_b])
    room_key = f"dm:{pair[0]}:{pair[1]}"

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            room_id = _ensure_room_with_cur(
                cur,
                room_type="dm",
                room_key=room_key,
                name="",
                topic="",
                created_by=user_a,
            )
            _upsert_room_members_with_cur(cur, room_id, [(pair[0], "member"), (pair[1], "member")])
            cur.execute("UPDATE chat_rooms SET updated_at=updated_at WHERE id=%s", (room_id,))
            return room_id


def create_group_room(name: str, created_by: str, member_ids: list[str], topic: str = "") -> int:
    room_name = _norm_text(name)
    creator_user_id = _norm_user_id(created_by)
    if not creator_user_id:
        raise ValueError("creator required")
    if len(room_name) < 2:
        raise ValueError("방 이름은 2자 이상 입력해주세요.")

    unique_members: list[str] = []
    seen: set[str] = set()
    for raw_user_id in [creator_user_id] + list(member_ids or []):
        uid = _norm_user_id(raw_user_id)
        if not uid or uid in seen:
            continue
        seen.add(uid)
        unique_members.append(uid)

    if len(unique_members) < 2:
        raise ValueError("그룹방에는 최소 2명 이상이 필요합니다.")

    room_key = f"group:{_room_slug_token(room_name)}:{hashlib.sha1(('|'.join(unique_members)).encode('utf-8')).hexdigest()[:12]}"

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                INSERT INTO chat_rooms (
                  room_type, room_key, name, topic, created_by, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, NOW(), NOW())
                """,
                ("group", room_key, room_name, _norm_text(topic), creator_user_id),
            )
            room_id = int(cur.lastrowid or 0)
            member_rows = [(creator_user_id, "owner")] + [(uid, "member") for uid in unique_members if uid != creator_user_id]
            _upsert_room_members_with_cur(cur, room_id, member_rows)
            return room_id
