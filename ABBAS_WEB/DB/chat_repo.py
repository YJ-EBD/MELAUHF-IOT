from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import threading
import time
from datetime import datetime
from typing import Any

from pymysql import err as pymysql_err

from .runtime import get_mysql
from . import user_repo


_SCHEMA_READY = False
_DIRECT_MESSAGE_MAX_LEN = 5000
_TALK_BACKUP_FORMAT_VERSION = 1
_TALK_BACKUP_ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(os.path.dirname(__file__)), "Talk_BackUp"))
_TALK_BACKUP_ROOMS_DIR = os.path.join(_TALK_BACKUP_ROOT_DIR, "rooms")
_TALK_BACKUP_MANIFEST_PATH = os.path.join(_TALK_BACKUP_ROOT_DIR, "manifest.json")
_TALK_BACKUP_WRITE_LOCK = threading.Lock()


def _norm_text(value: Any) -> str:
    return str(value or "").strip()


def _norm_user_id(value: Any) -> str:
    return _norm_text(value)


def _norm_room_type(value: Any) -> str:
    room_type = _norm_text(value).lower()
    if room_type in {"dm", "group", "channel"}:
        return room_type
    return "group"


def _norm_app_domain(value: Any, *, room_type: Any = None, room_key: Any = None) -> str:
    normalized = _norm_text(value).lower()
    if normalized in {"talk", "ascord"}:
        return normalized
    normalized_room_key = _norm_text(room_key).lower()
    if normalized_room_key.startswith("ascord:"):
        return "ascord"
    if _norm_room_type(room_type) == "dm":
        return "talk"
    return "talk"


def _norm_channel_mode(value: Any) -> str:
    mode = _norm_text(value).lower()
    if mode == "stage":
        return "stage"
    return "voice"


def _norm_channel_category(value: Any) -> str:
    category = _norm_text(value)
    if len(category) > 60:
        return category[:60].strip()
    return category


def _room_slug_token(value: Any) -> str:
    text = _norm_text(value)
    if not text:
        return ""
    normalized = re.sub(r"\s+", " ", text)
    digest = hashlib.sha1(normalized.encode("utf-8")).hexdigest()
    return digest[:16]


def normalize_app_domain(value: Any, *, room_type: Any = None, room_key: Any = None) -> str:
    return _norm_app_domain(value, room_type=room_type, room_key=room_key)


def room_supports_calls(room: dict[str, Any] | None) -> bool:
    item = dict(room or {})
    return _norm_app_domain(
        item.get("app_domain"),
        room_type=item.get("room_type"),
        room_key=item.get("room_key"),
    ) == "ascord"


_CALL_PERMISSION_KEYS = (
    "connect",
    "start_call",
    "speak",
    "video",
    "screen_share",
    "invite_members",
    "moderate",
)
_DEFAULT_GROUP_CALL_PERMISSIONS = {
    "connect": "member",
    "start_call": "member",
    "speak": "member",
    "video": "member",
    "screen_share": "member",
    "invite_members": "admin",
    "moderate": "admin",
}
_DEFAULT_DM_CALL_PERMISSIONS = {
    "connect": "member",
    "start_call": "member",
    "speak": "member",
    "video": "member",
    "screen_share": "member",
    "invite_members": "none",
    "moderate": "none",
}
_DEFAULT_STAGE_CALL_PERMISSIONS = {
    "connect": "member",
    "start_call": "admin",
    "speak": "admin",
    "video": "none",
    "screen_share": "none",
    "invite_members": "admin",
    "moderate": "admin",
}


def _normalize_call_permission_key(value: Any) -> str:
    key = _norm_text(value).lower()
    alias_map = {
        "connect": "connect",
        "join": "connect",
        "start": "start_call",
        "start_call": "start_call",
        "startcall": "start_call",
        "speak": "speak",
        "voice": "speak",
        "video": "video",
        "camera": "video",
        "screen_share": "screen_share",
        "screenshare": "screen_share",
        "screen": "screen_share",
        "share_screen": "screen_share",
        "invite": "invite_members",
        "invite_members": "invite_members",
        "invitemembers": "invite_members",
        "moderate": "moderate",
        "mod": "moderate",
    }
    normalized = alias_map.get(key, key)
    return normalized if normalized in _CALL_PERMISSION_KEYS else ""


def _normalize_call_permission_level(value: Any, default: str = "member") -> str:
    normalized = _norm_text(value).lower()
    alias_map = {
        "all": "member",
        "everyone": "member",
        "member": "member",
        "members": "member",
        "admin": "admin",
        "admins": "admin",
        "owner": "owner",
        "owners": "owner",
        "none": "none",
        "deny": "none",
        "disabled": "none",
        "nobody": "none",
        "off": "none",
    }
    candidate = alias_map.get(normalized, normalized)
    if candidate in {"member", "admin", "owner", "none"}:
        return candidate
    return default if default in {"member", "admin", "owner", "none"} else "member"


def _default_call_permissions(room_type: Any, channel_mode: Any = None) -> dict[str, str]:
    normalized_room_type = _norm_room_type(room_type)
    if normalized_room_type == "dm":
        return dict(_DEFAULT_DM_CALL_PERMISSIONS)
    if _norm_channel_mode(channel_mode) == "stage":
        return dict(_DEFAULT_STAGE_CALL_PERMISSIONS)
    return dict(_DEFAULT_GROUP_CALL_PERMISSIONS)


def normalize_call_permissions(room_type: Any, values: Any = None, *, channel_mode: Any = None) -> dict[str, str]:
    permissions = _default_call_permissions(room_type, channel_mode)
    if _norm_room_type(room_type) == "dm":
        return permissions

    payload = values
    if isinstance(payload, str):
        try:
            payload = json.loads(payload or "{}")
        except Exception:
            payload = {}
    if not isinstance(payload, dict):
        payload = {}

    for raw_key, raw_value in payload.items():
        key = _normalize_call_permission_key(raw_key)
        if not key:
            continue
        permissions[key] = _normalize_call_permission_level(raw_value, permissions.get(key) or "member")
    return permissions


def serialize_call_permissions(room_type: Any, values: Any = None, *, channel_mode: Any = None) -> str:
    return json.dumps(
        normalize_call_permissions(room_type, values, channel_mode=channel_mode),
        ensure_ascii=False,
        separators=(",", ":"),
    )


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
    normalized_type = _norm_text(message_type).lower()
    if normalized_type == "system":
        return _message_preview(content, limit=limit)
    attachment = _attachment_payload(message_type, content)
    if attachment:
        label = "[이미지]" if attachment.get("kind") == "image" else "[파일]"
        name = attachment.get("name") or attachment.get("url") or "첨부"
        return _message_preview(f"{label} {name}", limit=limit)
    return _message_preview(content, limit=limit)


def _backup_now_text() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _room_backup_dir(room_id: int) -> str:
    return os.path.join(_TALK_BACKUP_ROOMS_DIR, f"room_{int(room_id):06d}")


def _ensure_talk_backup_dirs() -> None:
    os.makedirs(_TALK_BACKUP_ROOMS_DIR, exist_ok=True)


def _atomic_write_text(path: str, text: str) -> None:
    parent_dir = os.path.dirname(path)
    if parent_dir:
        os.makedirs(parent_dir, exist_ok=True)
    temp_dir = parent_dir or None
    temp_prefix = f"{os.path.basename(path)}."
    fd, temp_path = tempfile.mkstemp(prefix=temp_prefix, suffix=".tmp", dir=temp_dir, text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as file_obj:
            file_obj.write(text)
        os.replace(temp_path, path)
    except Exception:
        try:
            os.unlink(temp_path)
        except FileNotFoundError:
            pass
        raise


def _write_json_file(path: str, payload: Any) -> None:
    _atomic_write_text(path, json.dumps(payload, ensure_ascii=False, indent=2))


def _load_talk_backup_manifest() -> dict[str, Any]:
    try:
        with open(_TALK_BACKUP_MANIFEST_PATH, "r", encoding="utf-8") as file_obj:
            payload = json.load(file_obj)
    except Exception:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    rooms = payload.get("rooms") or []
    if not isinstance(rooms, list):
        rooms = []
    return {
        "format_version": _TALK_BACKUP_FORMAT_VERSION,
        "generated_at": _norm_text(payload.get("generated_at")),
        "rooms": rooms,
    }


def _save_talk_backup_manifest(payload: dict[str, Any]) -> None:
    manifest = {
        "format_version": _TALK_BACKUP_FORMAT_VERSION,
        "generated_at": _norm_text(payload.get("generated_at")) or _backup_now_text(),
        "rooms": list(payload.get("rooms") or []),
    }
    _write_json_file(_TALK_BACKUP_MANIFEST_PATH, manifest)


def _member_display_name(member: dict[str, Any] | None) -> str:
    item = dict(member or {})
    return (
        _norm_text(item.get("nickname"))
        or _norm_text(item.get("name"))
        or _norm_user_id(item.get("user_id"))
        or "알 수 없음"
    )


def _room_type_label(room_type: Any) -> str:
    normalized = _norm_room_type(room_type)
    if normalized == "channel":
        return "채널"
    if normalized == "dm":
        return "개인톡"
    return "그룹채팅"


def _room_display_name(room: dict[str, Any] | None, members: list[dict[str, Any]] | None = None) -> str:
    current_room = dict(room or {})
    room_type = _norm_room_type(current_room.get("room_type"))
    explicit_name = _norm_text(current_room.get("name"))
    if room_type != "dm":
        return explicit_name or ("채널" if room_type == "channel" else "그룹 대화")

    member_names = [_member_display_name(member) for member in list(members or []) if _member_display_name(member)]
    if member_names:
        return " / ".join(member_names[:2]) if len(member_names) <= 2 else ", ".join(member_names)
    return explicit_name or f"개인톡 {int(current_room.get('id') or 0)}"


def _message_export_text(message: dict[str, Any] | None) -> str:
    item = dict(message or {})
    attachment = item.get("attachment") or {}
    prefix = "[삭제됨] " if _norm_text(item.get("deleted_at")) else ""
    if attachment:
        label = "[이미지]" if attachment.get("kind") == "image" else "[파일]"
        name = _norm_text(attachment.get("name")) or _norm_text(attachment.get("url")) or "첨부"
        url = _norm_text(attachment.get("url"))
        size_text = _norm_text(attachment.get("size_text"))
        extra = [value for value in [url, size_text] if value]
        return prefix + " ".join(part for part in [label, name] if part) + (f" ({' | '.join(extra)})" if extra else "")
    content = str(item.get("content") or "")
    return prefix + (content if content else "(내용 없음)")


def _render_room_backup_text(snapshot: dict[str, Any]) -> str:
    room = dict(snapshot.get("room") or {})
    members = list(snapshot.get("members") or [])
    messages = list(snapshot.get("messages") or [])
    backup = dict(snapshot.get("backup") or {})
    counts = dict(snapshot.get("counts") or {})

    lines = [
        "ABBAS Talk Backup",
        f"synced_at: {_norm_text(backup.get('synced_at'))}",
        f"sync_reason: {_norm_text(backup.get('sync_reason'))}",
        f"room_id: {int(room.get('id') or 0)}",
        f"room_type: {_room_type_label(room.get('room_type'))} ({_norm_room_type(room.get('room_type'))})",
        f"room_name: {_norm_text(room.get('display_name')) or _room_display_name(room, members)}",
        f"topic: {_norm_text(room.get('topic')) or '-'}",
        f"created_by: {_norm_user_id(room.get('created_by')) or '-'}",
        f"created_at: {_norm_text(room.get('created_at')) or '-'}",
        f"updated_at: {_norm_text(room.get('updated_at')) or '-'}",
        f"deleted_at: {_norm_text(room.get('deleted_at')) or '-'}",
        f"member_total: {int(counts.get('member_total') or len(members))}",
        f"message_total: {int(counts.get('message_total') or len(messages))}",
        f"active_message_total: {int(counts.get('active_message_total') or 0)}",
        f"deleted_message_total: {int(counts.get('deleted_message_total') or 0)}",
        "",
        "[Members]",
    ]

    if members:
        for member in members:
            lines.append(
                "- "
                + " | ".join(
                    [
                        _member_display_name(member),
                        _norm_user_id(member.get("user_id")) or "-",
                        _norm_text(member.get("member_role")) or "member",
                        _norm_text(member.get("department")) or "-",
                    ]
                )
            )
    else:
        lines.append("- (멤버 없음)")

    lines.extend(["", "[Messages]"])
    if not messages:
        lines.append("(메시지 없음)")
        return "\n".join(lines).rstrip() + "\n"

    for message in messages:
        sender_name = _norm_text(message.get("sender_display_name")) or _norm_user_id(message.get("sender_user_id")) or "알 수 없음"
        sender_user_id = _norm_user_id(message.get("sender_user_id")) or "-"
        created_at = _norm_text(message.get("created_at")) or "-"
        message_type = _norm_text(message.get("message_type")) or "text"
        flags: list[str] = []
        edited_at = _norm_text(message.get("edited_at"))
        deleted_at = _norm_text(message.get("deleted_at"))
        if edited_at:
            flags.append(f"edited {edited_at}")
        if deleted_at:
            flags.append(f"deleted {deleted_at}")
        header = f"[{created_at}] {sender_name} ({sender_user_id}) [{message_type}]"
        if flags:
            header += " | " + ", ".join(flags)
        lines.append(header)
        body = _message_export_text(message)
        for segment in str(body).splitlines() or [""]:
            lines.append(f"  {segment}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


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
          channel_category VARCHAR(80) NOT NULL DEFAULT '',
          channel_mode VARCHAR(16) NOT NULL DEFAULT 'voice',
          call_permissions_json LONGTEXT NULL,
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
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS chat_call_logs (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          room_id BIGINT UNSIGNED NOT NULL,
          call_id VARCHAR(128) NOT NULL,
          started_by_user_id VARCHAR(64) NOT NULL DEFAULT '',
          initiated_mode VARCHAR(16) NOT NULL DEFAULT 'audio',
          status VARCHAR(16) NOT NULL DEFAULT 'active',
          max_participant_count INT UNSIGNED NOT NULL DEFAULT 1,
          started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          ended_at DATETIME NULL,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_chat_call_logs_call_id (call_id),
          KEY idx_chat_call_logs_room_recent (room_id, id),
          KEY idx_chat_call_logs_status_recent (status, id)
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
    if "channel_category" not in room_cols:
        cur.execute("ALTER TABLE chat_rooms ADD COLUMN channel_category VARCHAR(80) NOT NULL DEFAULT '' AFTER avatar_path")
    if "channel_mode" not in room_cols:
        cur.execute("ALTER TABLE chat_rooms ADD COLUMN channel_mode VARCHAR(16) NOT NULL DEFAULT 'voice' AFTER channel_category")
    if "call_permissions_json" not in room_cols:
        cur.execute("ALTER TABLE chat_rooms ADD COLUMN call_permissions_json LONGTEXT NULL AFTER channel_mode")

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
    channel_category: str = "",
    channel_mode: str = "voice",
    call_permissions: Any = None,
    created_by: str = "",
) -> int:
    normalized_channel_category = _norm_channel_category(channel_category)
    normalized_channel_mode = _norm_channel_mode(channel_mode)
    call_permissions_json = serialize_call_permissions(
        room_type,
        call_permissions,
        channel_mode=normalized_channel_mode,
    )
    cur.execute(
        """
        INSERT INTO chat_rooms (
          room_type, room_key, name, topic, avatar_path, channel_category, channel_mode, created_by, call_permissions_json, created_at, updated_at
        )
        VALUES (%s, %s, %s, %s, '', %s, %s, %s, %s, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          room_type=VALUES(room_type),
          name=CASE WHEN TRIM(VALUES(name))='' THEN name ELSE VALUES(name) END,
          topic=CASE WHEN TRIM(VALUES(topic))='' THEN topic ELSE VALUES(topic) END,
          channel_category=CASE
            WHEN TRIM(COALESCE(channel_category, ''))='' THEN VALUES(channel_category)
            ELSE channel_category
          END,
          channel_mode=CASE
            WHEN TRIM(COALESCE(channel_mode, ''))='' THEN VALUES(channel_mode)
            ELSE channel_mode
          END,
          call_permissions_json=CASE
            WHEN call_permissions_json IS NULL OR TRIM(call_permissions_json)='' THEN VALUES(call_permissions_json)
            ELSE call_permissions_json
          END,
          updated_at=updated_at
        """,
        (
            room_type,
            room_key,
            name,
            topic,
            normalized_channel_category,
            normalized_channel_mode,
            created_by,
            call_permissions_json,
        ),
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

    ascord_members: list[tuple[str, str]] = []
    touched_room_ids: list[int] = []

    for row in approved_rows:
        user_id = _norm_user_id(row.get("ID"))
        role = str(row.get("ROLE") or "").strip().lower()
        member_role = "member"
        if role == "admin":
            member_role = "admin"
        elif role == "superuser":
            member_role = "owner"
        ascord_members.append((user_id, member_role))

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)

            room_id = _ensure_room_with_cur(
                cur,
                room_type="channel",
                room_key="ascord:global",
                name="전체 채널",
                topic="ASCORD 구성원 전체가 참여하는 기본 음성 채널",
                channel_category="LOBBY",
                channel_mode="voice",
                created_by="system",
            )
            if room_id > 0:
                touched_room_ids.append(room_id)
            _upsert_room_members_with_cur(cur, room_id, ascord_members)
    for room_id in sorted({room_id for room_id in touched_room_ids if room_id > 0}):
        sync_room_backup(room_id, sync_reason="default_room_sync")


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
                  COALESCE(r.channel_category, '') AS channel_category,
                  COALESCE(r.channel_mode, 'voice') AS channel_mode,
                  COALESCE(r.call_permissions_json, '') AS call_permissions_json,
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
        room_type = _norm_room_type(row.get("room_type"))
        rooms.append(
            {
                "id": room_id,
                "room_type": room_type,
                "room_key": _norm_text(row.get("room_key")),
                "app_domain": _norm_app_domain(
                    None,
                    room_type=room_type,
                    room_key=row.get("room_key"),
                ),
                "name": _norm_text(row.get("name")),
                "topic": _norm_text(row.get("topic")),
                "avatar_path": _norm_text(row.get("avatar_path")),
                "channel_category": _norm_channel_category(row.get("channel_category")),
                "channel_mode": _norm_channel_mode(row.get("channel_mode")),
                "call_permissions": normalize_call_permissions(
                    room_type,
                    row.get("call_permissions_json"),
                    channel_mode=row.get("channel_mode"),
                ),
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


def _call_log_row_view(row: dict[str, Any] | None) -> dict[str, Any] | None:
    item = dict(row or {})
    call_id = _norm_text(item.get("call_id"))
    if not call_id:
        return None
    return {
        "id": int(item.get("id") or 0),
        "room_id": int(item.get("room_id") or 0),
        "call_id": call_id,
        "started_by_user_id": _norm_user_id(item.get("started_by_user_id")),
        "started_by_nickname": _norm_text(item.get("started_by_nickname")),
        "started_by_name": _norm_text(item.get("started_by_name")),
        "started_by_department": _norm_text(item.get("started_by_department")),
        "initiated_mode": _norm_text(item.get("initiated_mode")) or "audio",
        "status": _norm_text(item.get("status")) or "active",
        "max_participant_count": max(int(item.get("max_participant_count") or 0), 0),
        "duration_sec": max(int(item.get("duration_sec") or 0), 0),
        "started_at": _norm_text(item.get("started_at")),
        "ended_at": _norm_text(item.get("ended_at")),
        "updated_at": _norm_text(item.get("updated_at")),
    }


def get_call_log_by_call_id(call_id: str) -> dict[str, Any] | None:
    normalized_call_id = _norm_text(call_id)
    if not normalized_call_id:
        return None

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                SELECT
                  log.id,
                  log.room_id,
                  log.call_id,
                  COALESCE(log.started_by_user_id, '') AS started_by_user_id,
                  COALESCE(log.initiated_mode, 'audio') AS initiated_mode,
                  COALESCE(log.status, 'active') AS status,
                  COALESCE(log.max_participant_count, 1) AS max_participant_count,
                  COALESCE(TIMESTAMPDIFF(SECOND, log.started_at, COALESCE(log.ended_at, NOW())), 0) AS duration_sec,
                  COALESCE(DATE_FORMAT(log.started_at, '%%Y-%%m-%%d %%H:%%i:%%s'), '') AS started_at,
                  COALESCE(DATE_FORMAT(log.ended_at, '%%Y-%%m-%%d %%H:%%i:%%s'), '') AS ended_at,
                  COALESCE(DATE_FORMAT(log.updated_at, '%%Y-%%m-%%d %%H:%%i:%%s'), '') AS updated_at,
                  COALESCE(u.nickname, '') AS started_by_nickname,
                  COALESCE(u.name, '') AS started_by_name,
                  COALESCE(u.department, '') AS started_by_department
                FROM chat_call_logs log
                LEFT JOIN users u
                  ON u.user_id = log.started_by_user_id
                WHERE log.call_id=%s
                LIMIT 1
                """,
                (normalized_call_id,),
            )
            row = cur.fetchone() or {}
    return _call_log_row_view(row)


def create_call_log(
    room_id: int,
    call_id: str,
    started_by_user_id: str,
    *,
    initiated_mode: str = "audio",
    participant_count: int = 1,
) -> dict[str, Any] | None:
    try:
        target_room_id = int(room_id)
    except Exception:
        return None
    normalized_call_id = _norm_text(call_id)
    normalized_user_id = _norm_user_id(started_by_user_id)
    normalized_mode = "video" if _norm_text(initiated_mode).lower() == "video" else "audio"
    peak_count = max(int(participant_count or 0), 1)
    if target_room_id <= 0 or not normalized_call_id:
        return None

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                INSERT INTO chat_call_logs (
                  room_id, call_id, started_by_user_id, initiated_mode, status, max_participant_count, started_at, updated_at
                )
                VALUES (%s, %s, %s, %s, 'active', %s, NOW(), NOW())
                ON DUPLICATE KEY UPDATE
                  started_by_user_id=CASE
                    WHEN COALESCE(started_by_user_id, '')='' THEN VALUES(started_by_user_id)
                    ELSE started_by_user_id
                  END,
                  initiated_mode=VALUES(initiated_mode),
                  status=CASE
                    WHEN status='active' THEN status
                    ELSE VALUES(status)
                  END,
                  max_participant_count=GREATEST(COALESCE(max_participant_count, 1), VALUES(max_participant_count)),
                  updated_at=NOW()
                """,
                (target_room_id, normalized_call_id, normalized_user_id, normalized_mode, peak_count),
            )
    return get_call_log_by_call_id(normalized_call_id)


def update_call_log_activity(call_id: str, *, participant_count: int = 1) -> dict[str, Any] | None:
    normalized_call_id = _norm_text(call_id)
    peak_count = max(int(participant_count or 0), 1)
    if not normalized_call_id:
        return None

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                UPDATE chat_call_logs
                SET max_participant_count=GREATEST(COALESCE(max_participant_count, 1), %s),
                    updated_at=NOW()
                WHERE call_id=%s
                """,
                (peak_count, normalized_call_id),
            )
    return get_call_log_by_call_id(normalized_call_id)


def finish_call_log(call_id: str, *, status: str = "ended", participant_count: int = 1) -> dict[str, Any] | None:
    normalized_call_id = _norm_text(call_id)
    normalized_status = _norm_text(status).lower()
    if normalized_status not in {"ended", "missed"}:
        normalized_status = "ended"
    peak_count = max(int(participant_count or 0), 1)
    if not normalized_call_id:
        return None

    completed = False
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                UPDATE chat_call_logs
                SET status=%s,
                    ended_at=COALESCE(ended_at, NOW()),
                    max_participant_count=GREATEST(COALESCE(max_participant_count, 1), %s),
                    updated_at=NOW()
                WHERE call_id=%s
                  AND status='active'
                """,
                (normalized_status, peak_count, normalized_call_id),
            )
            completed = bool(cur.rowcount)
    payload = get_call_log_by_call_id(normalized_call_id)
    if payload:
        payload["just_completed"] = completed
    return payload


def list_call_logs_for_room(room_id: int, *, limit: int = 8) -> list[dict[str, Any]]:
    try:
        target_room_id = int(room_id)
    except Exception:
        return []
    if target_room_id <= 0:
        return []
    normalized_limit = min(max(int(limit or 0), 1), 20)

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                SELECT
                  log.id,
                  log.room_id,
                  log.call_id,
                  COALESCE(log.started_by_user_id, '') AS started_by_user_id,
                  COALESCE(log.initiated_mode, 'audio') AS initiated_mode,
                  COALESCE(log.status, 'active') AS status,
                  COALESCE(log.max_participant_count, 1) AS max_participant_count,
                  COALESCE(TIMESTAMPDIFF(SECOND, log.started_at, COALESCE(log.ended_at, NOW())), 0) AS duration_sec,
                  COALESCE(DATE_FORMAT(log.started_at, '%%Y-%%m-%%d %%H:%%i:%%s'), '') AS started_at,
                  COALESCE(DATE_FORMAT(log.ended_at, '%%Y-%%m-%%d %%H:%%i:%%s'), '') AS ended_at,
                  COALESCE(DATE_FORMAT(log.updated_at, '%%Y-%%m-%%d %%H:%%i:%%s'), '') AS updated_at,
                  COALESCE(u.nickname, '') AS started_by_nickname,
                  COALESCE(u.name, '') AS started_by_name,
                  COALESCE(u.department, '') AS started_by_department
                FROM chat_call_logs log
                INNER JOIN chat_rooms r
                  ON r.id = log.room_id
                LEFT JOIN users u
                  ON u.user_id = log.started_by_user_id
                WHERE log.room_id=%s
                  AND COALESCE(r.room_key, '') LIKE 'ascord:%%'
                ORDER BY
                  COALESCE(log.ended_at, log.updated_at, log.started_at) DESC,
                  log.id DESC
                LIMIT %s
                """,
                (target_room_id, normalized_limit),
            )
            rows = cur.fetchall() or []
    return [payload for payload in (_call_log_row_view(row) for row in rows) if payload]


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
    sync_room_backup(target_room_id, sync_reason="member_added")
    return new_ids


def update_room_member_role(room_id: int, user_id: str, member_role: str) -> bool:
    try:
        target_room_id = int(room_id)
    except Exception:
        return False
    uid = _norm_user_id(user_id)
    normalized_role = _norm_text(member_role).lower() or "member"
    if target_room_id <= 0 or not uid:
        return False
    if normalized_role not in {"owner", "admin", "member"}:
        return False

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                UPDATE chat_room_members
                SET member_role=%s,
                    updated_at=NOW()
                WHERE room_id=%s AND user_id=%s
                """,
                (normalized_role, target_room_id, uid),
            )
            updated = bool(cur.rowcount)
            if updated:
                cur.execute(
                    """
                    UPDATE chat_rooms
                    SET updated_at=NOW()
                    WHERE id=%s
                    """,
                    (target_room_id,),
                )
    if updated:
        sync_room_backup(target_room_id, sync_reason="member_role_updated")
    return updated


def transfer_room_owner(room_id: int, next_owner_user_id: str) -> bool:
    try:
        target_room_id = int(room_id)
    except Exception:
        return False
    next_owner_id = _norm_user_id(next_owner_user_id)
    if target_room_id <= 0 or not next_owner_id:
        return False

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                SELECT COALESCE(created_by, '') AS created_by
                FROM chat_rooms
                WHERE id=%s
                LIMIT 1
                """,
                (target_room_id,),
            )
            room_row = cur.fetchone() or {}
            previous_owner_id = _norm_user_id(room_row.get("created_by"))
            cur.execute(
                """
                UPDATE chat_room_members
                SET member_role='owner',
                    updated_at=NOW()
                WHERE room_id=%s AND user_id=%s
                """,
                (target_room_id, next_owner_id),
            )
            next_owner_updated = bool(cur.rowcount)
            if not next_owner_updated:
                return False
            if previous_owner_id and previous_owner_id != next_owner_id:
                cur.execute(
                    """
                    UPDATE chat_room_members
                    SET member_role='admin',
                        updated_at=NOW()
                    WHERE room_id=%s AND user_id=%s
                    """,
                    (target_room_id, previous_owner_id),
                )
            cur.execute(
                """
                UPDATE chat_rooms
                SET created_by=%s,
                    updated_at=NOW()
                WHERE id=%s
                """,
                (next_owner_id, target_room_id),
            )
    sync_room_backup(target_room_id, sync_reason="room_owner_transferred")
    return True


def remove_room_member(room_id: int, user_id: str) -> bool:
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
                DELETE FROM chat_room_members
                WHERE room_id=%s AND user_id=%s
                """,
                (target_room_id, uid),
            )
            removed = bool(cur.rowcount)
            if removed:
                cur.execute(
                    """
                    UPDATE chat_rooms
                    SET updated_at=NOW()
                    WHERE id=%s
                    """,
                    (target_room_id,),
                )
    if removed:
        sync_room_backup(target_room_id, sync_reason="member_removed")
    return removed


def insert_system_message(room_id: int, content: str) -> dict[str, Any]:
    try:
        target_room_id = int(room_id)
    except Exception:
        raise ValueError("room_id required")
    normalized_content = str(content or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if target_room_id <= 0:
        raise ValueError("room_id required")
    if not normalized_content:
        raise ValueError("message required")
    if len(normalized_content) > _DIRECT_MESSAGE_MAX_LEN:
        raise ValueError(f"메시지는 최대 {_DIRECT_MESSAGE_MAX_LEN}자까지 전송할 수 있습니다.")

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                INSERT INTO chat_messages (
                  room_id, sender_user_id, message_type, content, created_at
                )
                VALUES (%s, %s, %s, %s, NOW())
                """,
                (target_room_id, "system", "system", normalized_content),
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

    sync_room_backup(target_room_id, sync_reason="system_message_created")
    message = get_message_by_id(message_id)
    if not message:
        raise RuntimeError("message load failed")
    return message


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
                  COALESCE(channel_category, '') AS channel_category,
                  COALESCE(channel_mode, 'voice') AS channel_mode,
                  COALESCE(call_permissions_json, '') AS call_permissions_json,
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
    room_type = _norm_room_type(row.get("room_type"))
    return {
        "id": int(row.get("id") or 0),
        "room_type": room_type,
        "room_key": _norm_text(row.get("room_key")),
        "app_domain": _norm_app_domain(
            None,
            room_type=room_type,
            room_key=row.get("room_key"),
        ),
        "name": _norm_text(row.get("name")),
        "topic": _norm_text(row.get("topic")),
        "avatar_path": _norm_text(row.get("avatar_path")),
        "channel_category": _norm_channel_category(row.get("channel_category")),
        "channel_mode": _norm_channel_mode(row.get("channel_mode")),
        "call_permissions": normalize_call_permissions(
            room_type,
            row.get("call_permissions_json"),
            channel_mode=row.get("channel_mode"),
        ),
        "created_by": _norm_user_id(row.get("created_by")),
        "last_message_id": int(row.get("last_message_id") or 0),
    }


def _build_room_backup_snapshot_with_cur(cur, room_id: int) -> dict[str, Any] | None:
    target_room_id = int(room_id or 0)
    if target_room_id <= 0:
        return None

    cur.execute(
        """
        SELECT
          r.id,
          COALESCE(r.room_type, 'group') AS room_type,
          COALESCE(r.room_key, '') AS room_key,
          COALESCE(r.name, '') AS name,
          COALESCE(r.topic, '') AS topic,
          COALESCE(r.avatar_path, '') AS avatar_path,
          COALESCE(r.channel_category, '') AS channel_category,
          COALESCE(r.channel_mode, 'voice') AS channel_mode,
          COALESCE(r.call_permissions_json, '') AS call_permissions_json,
          COALESCE(r.created_by, '') AS created_by,
          COALESCE(r.last_message_id, 0) AS last_message_id,
          COALESCE(DATE_FORMAT(r.created_at, '%%Y-%%m-%%d %%H:%%i:%%s'), '') AS created_at,
          COALESCE(DATE_FORMAT(r.updated_at, '%%Y-%%m-%%d %%H:%%i:%%s'), '') AS updated_at,
          COALESCE(DATE_FORMAT(last_msg.created_at, '%%Y-%%m-%%d %%H:%%i:%%s'), '') AS last_message_at
        FROM chat_rooms r
        LEFT JOIN chat_messages last_msg
          ON last_msg.id = r.last_message_id
        WHERE r.id=%s
        LIMIT 1
        """,
        (target_room_id,),
    )
    room_row = cur.fetchone() or {}
    if not room_row:
        return None
    room_type = _norm_room_type(room_row.get("room_type"))

    cur.execute(
        """
        SELECT
          m.room_id,
          m.user_id,
          COALESCE(m.member_role, 'member') AS member_role,
          COALESCE(DATE_FORMAT(m.joined_at, '%%Y-%%m-%%d %%H:%%i:%%s'), '') AS joined_at,
          COALESCE(u.nickname, '') AS nickname,
          COALESCE(u.name, '') AS name,
          COALESCE(u.department, '') AS department,
          COALESCE(u.profile_image_path, '') AS profile_image_path,
          COALESCE(u.role, 'user') AS role
        FROM chat_room_members m
        LEFT JOIN users u
          ON u.user_id = m.user_id
        WHERE m.room_id=%s
        ORDER BY m.joined_at ASC, m.user_id ASC
        """,
        (target_room_id,),
    )
    member_rows = cur.fetchall() or []
    members: list[dict[str, Any]] = []
    for row in member_rows:
        members.append(
            {
                "user_id": _norm_user_id(row.get("user_id")),
                "member_role": _norm_text(row.get("member_role")) or "member",
                "nickname": _norm_text(row.get("nickname")),
                "name": _norm_text(row.get("name")),
                "department": _norm_text(row.get("department")),
                "profile_image_path": _norm_text(row.get("profile_image_path")),
                "role": _norm_text(row.get("role")) or "user",
                "joined_at": _norm_text(row.get("joined_at")),
                "display_name": _member_display_name(row),
            }
        )

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
        WHERE msg.room_id=%s
        ORDER BY msg.id ASC
        """,
        (target_room_id,),
    )
    message_rows = cur.fetchall() or []
    messages: list[dict[str, Any]] = []
    deleted_message_total = 0
    for row in message_rows:
        attachment = _attachment_payload(row.get("message_type"), row.get("content"))
        deleted_at = _norm_text(row.get("deleted_at"))
        if deleted_at:
            deleted_message_total += 1
        sender_user_id = _norm_user_id(row.get("sender_user_id"))
        sender_display_name = (
            _norm_text(row.get("sender_nickname"))
            or _norm_text(row.get("sender_name"))
            or sender_user_id
            or "알 수 없음"
        )
        messages.append(
            {
                "id": int(row.get("id") or 0),
                "room_id": int(row.get("room_id") or 0),
                "sender_user_id": sender_user_id,
                "sender_display_name": sender_display_name,
                "sender_nickname": _norm_text(row.get("sender_nickname")),
                "sender_name": _norm_text(row.get("sender_name")),
                "sender_department": _norm_text(row.get("sender_department")),
                "sender_profile_image_path": _norm_text(row.get("sender_profile_image_path")),
                "sender_role": _norm_text(row.get("sender_role")) or "user",
                "message_type": _norm_text(row.get("message_type")) or "text",
                "content": str(row.get("content") or ""),
                "content_preview": _message_preview_for_type(row.get("message_type"), row.get("content")),
                "attachment": attachment,
                "created_at": _norm_text(row.get("created_at")),
                "edited_at": _norm_text(row.get("edited_at")),
                "deleted_at": deleted_at,
            }
        )

    room = {
        "id": int(room_row.get("id") or 0),
        "room_type": room_type,
        "room_type_label": _room_type_label(room_row.get("room_type")),
        "room_key": _norm_text(room_row.get("room_key")),
        "app_domain": _norm_app_domain(
            None,
            room_type=room_type,
            room_key=room_row.get("room_key"),
        ),
        "name": _norm_text(room_row.get("name")),
        "display_name": _room_display_name(room_row, members),
        "topic": _norm_text(room_row.get("topic")),
        "avatar_path": _norm_text(room_row.get("avatar_path")),
        "channel_category": _norm_channel_category(room_row.get("channel_category")),
        "channel_mode": _norm_channel_mode(room_row.get("channel_mode")),
        "call_permissions": normalize_call_permissions(
            room_type,
            room_row.get("call_permissions_json"),
            channel_mode=room_row.get("channel_mode"),
        ),
        "created_by": _norm_user_id(room_row.get("created_by")),
        "last_message_id": int(room_row.get("last_message_id") or 0),
        "last_message_at": _norm_text(room_row.get("last_message_at")),
        "created_at": _norm_text(room_row.get("created_at")),
        "updated_at": _norm_text(room_row.get("updated_at")),
        "deleted_at": "",
    }
    return {
        "format_version": _TALK_BACKUP_FORMAT_VERSION,
        "generated_at": _backup_now_text(),
        "room": room,
        "members": members,
        "messages": messages,
        "counts": {
            "member_total": len(members),
            "message_total": len(messages),
            "active_message_total": max(len(messages) - deleted_message_total, 0),
            "deleted_message_total": deleted_message_total,
        },
    }


def _upsert_talk_backup_manifest(snapshot: dict[str, Any], *, room_deleted: bool = False) -> None:
    room = dict(snapshot.get("room") or {})
    room_id = int(room.get("id") or 0)
    if room_id <= 0:
        return

    manifest = _load_talk_backup_manifest()
    rooms_by_id: dict[int, dict[str, Any]] = {}
    for item in list(manifest.get("rooms") or []):
        try:
            existing_room_id = int(item.get("room_id") or 0)
        except Exception:
            existing_room_id = 0
        if existing_room_id > 0:
            rooms_by_id[existing_room_id] = dict(item)

    room_dir = _room_backup_dir(room_id)
    snapshot_path = os.path.relpath(os.path.join(room_dir, "room_snapshot.json"), _TALK_BACKUP_ROOT_DIR).replace(os.sep, "/")
    text_path = os.path.relpath(os.path.join(room_dir, "conversation.txt"), _TALK_BACKUP_ROOT_DIR).replace(os.sep, "/")
    members = list(snapshot.get("members") or [])
    counts = dict(snapshot.get("counts") or {})
    backup = dict(snapshot.get("backup") or {})
    rooms_by_id[room_id] = {
        "room_id": room_id,
        "room_type": _norm_room_type(room.get("room_type")),
        "app_domain": _norm_app_domain(
            room.get("app_domain"),
            room_type=room.get("room_type"),
            room_key=room.get("room_key"),
        ),
        "room_type_label": _room_type_label(room.get("room_type")),
        "room_name": _norm_text(room.get("display_name")) or _room_display_name(room, members),
        "name": _norm_text(room.get("name")),
        "topic": _norm_text(room.get("topic")),
        "room_key": _norm_text(room.get("room_key")),
        "member_ids": [_norm_user_id(member.get("user_id")) for member in members if _norm_user_id(member.get("user_id"))],
        "member_display_names": [_member_display_name(member) for member in members if _member_display_name(member)],
        "message_total": int(counts.get("message_total") or 0),
        "active_message_total": int(counts.get("active_message_total") or 0),
        "deleted_message_total": int(counts.get("deleted_message_total") or 0),
        "last_message_id": int(room.get("last_message_id") or 0),
        "last_message_at": _norm_text(room.get("last_message_at")),
        "created_at": _norm_text(room.get("created_at")),
        "updated_at": _norm_text(room.get("updated_at")),
        "deleted_at": _norm_text(room.get("deleted_at")),
        "is_deleted": bool(room_deleted),
        "last_synced_at": _norm_text(backup.get("synced_at")) or _backup_now_text(),
        "snapshot_path": snapshot_path,
        "text_export_path": text_path,
    }

    manifest["generated_at"] = _norm_text(backup.get("synced_at")) or _backup_now_text()
    manifest["rooms"] = [rooms_by_id[key] for key in sorted(rooms_by_id)]
    _save_talk_backup_manifest(manifest)


def _write_room_backup_snapshot(snapshot: dict[str, Any], *, sync_reason: str = "sync", room_deleted: bool = False, deleted_at: str = "") -> None:
    with _TALK_BACKUP_WRITE_LOCK:
        room = dict(snapshot.get("room") or {})
        room_id = int(room.get("id") or 0)
        if room_id <= 0:
            return
        if _norm_app_domain(
            room.get("app_domain"),
            room_type=room.get("room_type"),
            room_key=room.get("room_key"),
        ) != "talk":
            return

        _ensure_talk_backup_dirs()
        room_dir = _room_backup_dir(room_id)
        synced_at = _backup_now_text()
        room["deleted_at"] = deleted_at if room_deleted else _norm_text(room.get("deleted_at"))
        room["display_name"] = _norm_text(room.get("display_name")) or _room_display_name(room, list(snapshot.get("members") or []))

        payload = {
            "format_version": _TALK_BACKUP_FORMAT_VERSION,
            "backup": {
                "synced_at": synced_at,
                "sync_reason": _norm_text(sync_reason) or "sync",
                "source": "ABBAS_WEB",
            },
            "room": room,
            "members": list(snapshot.get("members") or []),
            "messages": list(snapshot.get("messages") or []),
            "counts": dict(snapshot.get("counts") or {}),
        }

        _write_json_file(os.path.join(room_dir, "room_snapshot.json"), payload)
        _atomic_write_text(os.path.join(room_dir, "conversation.txt"), _render_room_backup_text(payload))
        _upsert_talk_backup_manifest(payload, room_deleted=room_deleted)


def sync_room_backup(room_id: int, *, sync_reason: str = "sync") -> bool:
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
            snapshot = _build_room_backup_snapshot_with_cur(cur, target_room_id)
    if not snapshot:
        return False
    room = dict(snapshot.get("room") or {})
    if _norm_app_domain(
        room.get("app_domain"),
        room_type=room.get("room_type"),
        room_key=room.get("room_key"),
    ) != "talk":
        return False
    _write_room_backup_snapshot(snapshot, sync_reason=sync_reason)
    return True


def sync_all_room_backups() -> int:
    _ensure_talk_backup_dirs()
    db = get_mysql()
    room_ids: list[int] = []
    snapshots: list[dict[str, Any]] = []
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                SELECT id
                FROM chat_rooms
                WHERE COALESCE(room_key, '') NOT LIKE 'ascord:%%'
                ORDER BY id ASC
                """
            )
            room_ids = [int(row.get("id") or 0) for row in (cur.fetchall() or []) if int(row.get("id") or 0) > 0]
            for room_id in room_ids:
                snapshot = _build_room_backup_snapshot_with_cur(cur, room_id)
                if snapshot:
                    snapshots.append(snapshot)
    for snapshot in snapshots:
        _write_room_backup_snapshot(snapshot, sync_reason="startup_sync")
    return len(snapshots)


def sync_stale_room_backups() -> int:
    _ensure_talk_backup_dirs()
    manifest = _load_talk_backup_manifest()
    manifest_map: dict[int, dict[str, Any]] = {}
    for item in list(manifest.get("rooms") or []):
        try:
            room_id = int(item.get("room_id") or 0)
        except Exception:
            room_id = 0
        if room_id <= 0:
            continue
        manifest_map[room_id] = dict(item)

    db = get_mysql()
    snapshots: list[dict[str, Any]] = []
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                SELECT
                  id,
                  COALESCE(room_type, 'group') AS room_type,
                  COALESCE(room_key, '') AS room_key,
                  COALESCE(last_message_id, 0) AS last_message_id,
                  COALESCE(DATE_FORMAT(updated_at, '%%Y-%%m-%%d %%H:%%i:%%s'), '') AS updated_at
                FROM chat_rooms
                WHERE COALESCE(room_key, '') NOT LIKE 'ascord:%%'
                ORDER BY id ASC
                """
            )
            rows = cur.fetchall() or []
            for row in rows:
                room_id = int(row.get("id") or 0)
                if room_id <= 0:
                    continue
                manifest_item = dict(manifest_map.get(room_id) or {})
                room_type = _norm_room_type(row.get("room_type"))
                room_key = _norm_text(row.get("room_key"))
                if (
                    int(manifest_item.get("last_message_id") or 0) == int(row.get("last_message_id") or 0)
                    and _norm_text(manifest_item.get("updated_at")) == _norm_text(row.get("updated_at"))
                    and _norm_room_type(manifest_item.get("room_type")) == room_type
                    and _norm_text(manifest_item.get("room_key")) == room_key
                    and _norm_app_domain(
                        manifest_item.get("app_domain"),
                        room_type=manifest_item.get("room_type"),
                        room_key=manifest_item.get("room_key"),
                    ) == "talk"
                ):
                    continue
                snapshot = _build_room_backup_snapshot_with_cur(cur, room_id)
                if snapshot:
                    snapshots.append(snapshot)

    for snapshot in snapshots:
        _write_room_backup_snapshot(snapshot, sync_reason="startup_sync")
    return len(snapshots)


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
                INNER JOIN chat_rooms r
                  ON r.id = m.room_id
                INNER JOIN chat_messages msg
                  ON msg.room_id = m.room_id
                 AND msg.deleted_at IS NULL
                 AND COALESCE(msg.message_type, 'text') <> 'system'
                 AND msg.sender_user_id <> %s
                LEFT JOIN users u
                  ON u.user_id = msg.sender_user_id
                WHERE m.user_id = %s
                  AND COALESCE(m.is_muted, 0) = 0
                  AND COALESCE(r.room_key, '') NOT LIKE 'ascord:%%'
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
                SELECT
                  1 AS ok,
                  COALESCE(r.room_type, 'group') AS room_type,
                  COALESCE(r.room_key, '') AS room_key
                FROM chat_room_members m
                INNER JOIN chat_rooms r
                  ON r.id = m.room_id
                WHERE m.room_id=%s AND m.user_id=%s
                LIMIT 1
                """,
                (target_room_id, sender_id),
            )
            row = cur.fetchone() or {}
            if not row.get("ok"):
                raise PermissionError("room access denied")
            if _norm_app_domain(
                None,
                room_type=row.get("room_type"),
                room_key=row.get("room_key"),
            ) == "ascord":
                raise ValueError("ASCORD 채널은 텍스트 메시지를 지원하지 않습니다.")

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

    sync_room_backup(target_room_id, sync_reason="message_created")
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

    last_error = None
    for attempt in range(3):
        db = get_mysql()
        try:
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
        except pymysql_err.OperationalError as error:
            last_error = error
            if int((error.args or [0])[0] or 0) != 1020 or attempt >= 2:
                raise
            time.sleep(0.05 * (attempt + 1))
    if last_error:
        raise last_error
    return 0


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
            updated = bool(cur.rowcount)
    if updated:
        sync_room_backup(target_room_id, sync_reason="room_avatar_updated")
    return updated


def update_room_details(
    room_id: int,
    *,
    name: str,
    topic: str = "",
    channel_category: str = "",
    channel_mode: str = "voice",
    call_permissions: Any = None,
) -> bool:
    try:
        target_room_id = int(room_id)
    except Exception:
        raise ValueError("room_id required")
    if target_room_id <= 0:
        raise ValueError("room_id required")

    normalized_name = _norm_text(name)
    normalized_topic = _norm_text(topic)
    normalized_channel_category = _norm_channel_category(channel_category)
    normalized_channel_mode = _norm_channel_mode(channel_mode)
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
                SELECT
                  room_type,
                  COALESCE(room_key, '') AS room_key
                FROM chat_rooms
                WHERE id=%s
                LIMIT 1
                """,
                (target_room_id,),
            )
            room_row = cur.fetchone() or {}
            room_type = _norm_room_type(room_row.get("room_type"))
            room_app_domain = _norm_app_domain(
                None,
                room_type=room_type,
                room_key=room_row.get("room_key"),
            )
            stored_channel_category = normalized_channel_category if room_app_domain == "ascord" else ""
            stored_channel_mode = normalized_channel_mode if room_app_domain == "ascord" else "voice"
            serialized_call_permissions = serialize_call_permissions(
                room_type if room_app_domain != "ascord" else "channel",
                call_permissions if room_app_domain == "ascord" else None,
                channel_mode=stored_channel_mode,
            )
            cur.execute(
                """
                UPDATE chat_rooms
                SET
                  name=%s,
                  topic=%s,
                  channel_category=%s,
                  channel_mode=%s,
                  call_permissions_json=%s,
                  updated_at=NOW()
                WHERE id=%s
                  AND room_type <> 'dm'
                """,
                (
                    normalized_name,
                    normalized_topic,
                    stored_channel_category,
                    stored_channel_mode,
                    serialized_call_permissions,
                    target_room_id,
                ),
            )
            updated = bool(cur.rowcount)
    if updated:
        sync_room_backup(target_room_id, sync_reason="room_updated")
    return updated


def delete_room(room_id: int) -> bool:
    try:
        target_room_id = int(room_id)
    except Exception:
        return False
    if target_room_id <= 0:
        return False

    deleted_snapshot: dict[str, Any] | None = None
    deleted_at = ""
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            deleted_snapshot = _build_room_backup_snapshot_with_cur(cur, target_room_id)
            deleted_at = _backup_now_text()
            cur.execute("DELETE FROM chat_messages WHERE room_id=%s", (target_room_id,))
            cur.execute("DELETE FROM chat_room_members WHERE room_id=%s", (target_room_id,))
            cur.execute("DELETE FROM chat_rooms WHERE id=%s", (target_room_id,))
            deleted = bool(cur.rowcount)
    if deleted and deleted_snapshot:
        _write_room_backup_snapshot(
            deleted_snapshot,
            sync_reason="room_deleted",
            room_deleted=True,
            deleted_at=deleted_at,
        )
    return deleted


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

    room_id = 0
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
    if room_id > 0:
        sync_room_backup(room_id, sync_reason="message_updated")
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
            delete_result = {"room_id": room_id, "message_id": target_message_id}
    if int(delete_result.get("room_id") or 0) > 0:
        sync_room_backup(int(delete_result.get("room_id") or 0), sync_reason="message_deleted")
    return delete_result


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
    sync_room_backup(room_id, sync_reason="direct_room_sync")
    return room_id


def create_group_room(
    name: str,
    created_by: str,
    member_ids: list[str],
    topic: str = "",
    *,
    app_domain: str = "talk",
    channel_category: str = "",
    channel_mode: str = "voice",
    call_permissions: Any = None,
) -> int:
    room_name = _norm_text(name)
    creator_user_id = _norm_user_id(created_by)
    normalized_app_domain = _norm_app_domain(app_domain)
    normalized_channel_category = _norm_channel_category(channel_category)
    normalized_channel_mode = _norm_channel_mode(channel_mode)
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

    if normalized_app_domain != "ascord" and len(unique_members) < 2:
        raise ValueError("그룹방에는 최소 2명 이상이 필요합니다.")

    if normalized_app_domain == "ascord":
        room_type = "channel"
        room_key = f"ascord:{_room_slug_token(room_name)}:{hashlib.sha1(('|'.join(unique_members)).encode('utf-8')).hexdigest()[:12]}"
        stored_channel_category = normalized_channel_category
        stored_channel_mode = normalized_channel_mode
        serialized_call_permissions = serialize_call_permissions(
            "channel",
            call_permissions,
            channel_mode=stored_channel_mode,
        )
    else:
        room_type = "group"
        room_key = f"group:{_room_slug_token(room_name)}:{hashlib.sha1(('|'.join(unique_members)).encode('utf-8')).hexdigest()[:12]}"
        stored_channel_category = ""
        stored_channel_mode = "voice"
        serialized_call_permissions = serialize_call_permissions("group", None, channel_mode="voice")

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                INSERT INTO chat_rooms (
                  room_type, room_key, name, topic, channel_category, channel_mode, created_by, call_permissions_json, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                """,
                (
                    room_type,
                    room_key,
                    room_name,
                    _norm_text(topic),
                    stored_channel_category,
                    stored_channel_mode,
                    creator_user_id,
                    serialized_call_permissions,
                ),
            )
            room_id = int(cur.lastrowid or 0)
            member_rows = [(creator_user_id, "owner")] + [(uid, "member") for uid in unique_members if uid != creator_user_id]
            _upsert_room_members_with_cur(cur, room_id, member_rows)
    sync_room_backup(room_id, sync_reason="group_room_created" if normalized_app_domain != "ascord" else "ascord_room_created")
    return room_id
