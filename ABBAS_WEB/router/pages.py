from __future__ import annotations

import os
import platform
import re
import secrets
import shutil
import socket
import subprocess
import tempfile
import time
import asyncio
import json
import zipfile
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Body, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates
from starlette.background import BackgroundTask

from DB import data_repo
from DB import device_repo
from DB import device_ops_repo
from DB import firmware_repo
from DB import chat_repo
from DB import nas_repo
from DB import user_repo
from router.messenger_access import (
    _messenger_json_error,
    _messenger_request_user_id,
    _messenger_require_room_for_user,
    _messenger_require_user_id,
    _messenger_room_avatar_url_from_value,
)
from router.messenger_events import (
    _messenger_call_log_system_text,
    _messenger_emit_call_admin_control,
    _messenger_emit_call_state,
    _messenger_emit_call_state_to_user,
    _messenger_emit_message_created,
    _messenger_emit_message_deleted,
    _messenger_emit_message_updated,
    _messenger_emit_notifications_update,
    _messenger_emit_room_state_for_users,
    _messenger_emit_room_update,
    _messenger_emit_room_updates,
    _messenger_emit_system_message,
    _messenger_emit_typing,
    _messenger_finalize_call_log,
    _messenger_record_call_started,
    _messenger_refresh_room_state,
    _messenger_update_call_activity,
)
from router.messenger_payloads import (
    _build_messenger_bootstrap_payload,
    _build_messenger_notifications_payload,
    _build_messenger_room_messages_payload,
    _build_messenger_room_views,
    _build_messenger_user_profile_payload,
    _build_single_messenger_message_payload,
    _build_single_messenger_room_payload,
    _messenger_message_mentions_user,
    _messenger_notification_aliases,
)
from router.messenger_runtime import _MESSENGER_CALL_HUB, _MESSENGER_HUB
from router.messenger_views import (
    _approved_user_rows,
    _build_messenger_user_directory,
    _messenger_attachment_from_content,
    _messenger_call_log_view,
    _messenger_call_participant_stage_role,
    _messenger_call_permission_level,
    _messenger_call_permission_rank,
    _messenger_can_change_room_member_role,
    _messenger_can_delete_message,
    _messenger_can_edit_message,
    _messenger_can_invite_room_members,
    _messenger_can_join_call,
    _messenger_can_manage_member_roles,
    _messenger_can_manage_room,
    _messenger_can_manage_room_members,
    _messenger_can_moderate_call,
    _messenger_can_remove_room_member,
    _messenger_can_share_screen_in_call,
    _messenger_can_speak_in_call,
    _messenger_can_start_call,
    _messenger_can_transfer_room_owner,
    _messenger_can_use_video_in_call,
    _messenger_channel_mode,
    _messenger_channel_mode_label,
    _messenger_current_user_role,
    _messenger_duration_text,
    _messenger_effective_member_rank,
    _messenger_has_call_permission,
    _messenger_human_size,
    _messenger_is_ascord_room,
    _messenger_is_direct_room,
    _messenger_is_stage_room,
    _messenger_is_system_room,
    _messenger_is_talk_room,
    _messenger_member_display_name,
    _messenger_member_role,
    _messenger_member_role_rank,
    _messenger_message_preview_for_view,
    _messenger_message_view,
    _messenger_participant_can_share_screen_live,
    _messenger_participant_can_speak_live,
    _messenger_participant_can_use_video_live,
    _messenger_presence_badge_label,
    _messenger_presence_tone,
    _messenger_preview_text,
    _messenger_room_app_domain,
    _messenger_room_call_permissions,
    _messenger_room_channel_category,
    _messenger_room_has_member,
    _messenger_room_member_role,
    _messenger_room_type,
    _messenger_room_view,
    _messenger_supports_calls,
    _messenger_system_sender_label,
    _messenger_time_text,
    _messenger_unique_user_ids,
    _messenger_user_view_from_row,
)
from services.log_store import read_logs as db_read_logs
from services.user_store import hash_password_for_storage, read_user
from redis.session import (
    SESSION_COOKIE_NAME,
    clear_live_presence,
    clear_session_cookie,
    delete_session,
    list_active_sessions,
    list_live_presence,
    read_session_user,
    touch_live_presence,
)

try:
    from livekit import api as livekit_api
except Exception:
    livekit_api = None

try:
    import psutil
except Exception:
    psutil = None

router = APIRouter()
templates = Jinja2Templates(directory="templates")
DEVICE_LOG_ARCHIVE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "storage", "device_logs")
DEVICE_LOG_UPLOAD_MAX_CHUNK_BYTES = 4096
FIRMWARE_STORAGE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "storage", "firmware")
FIRMWARE_FAMILY_DEFAULT = (os.getenv("ABBAS_FIRMWARE_FAMILY_DEFAULT", "ABBAS_ESP32C5_MELAUHF").strip() or "ABBAS_ESP32C5_MELAUHF")
DEVICE_FIRMWARE_CHECK_INTERVAL_SEC = int(os.getenv("ABBAS_DEVICE_FIRMWARE_CHECK_SEC", "1800"))
FIRMWARE_MAX_UPLOAD_BYTES = int(os.getenv("ABBAS_FIRMWARE_MAX_UPLOAD_BYTES", "3342336"))
NAS_MODEL_CONTAINS = (os.getenv("ABBAS_NAS_MODEL_CONTAINS", "Backup+ Desk").strip() or "Backup+ Desk")
NAS_LABEL_DEFAULT = (os.getenv("ABBAS_NAS_LABEL", "Seagate Backup+ Desk").strip() or "Seagate Backup+ Desk")
NAS_ROOT_OVERRIDE = (os.getenv("ABBAS_NAS_ROOT") or "").strip()
NAS_LIST_LIMIT = max(int(os.getenv("ABBAS_NAS_LIST_LIMIT", "1000")), 100)
NAS_UPLOAD_CHUNK_BYTES = max(int(os.getenv("ABBAS_NAS_UPLOAD_CHUNK_BYTES", str(1024 * 1024))), 65536)
NAS_RECYCLE_DIR_NAME = ".ABBAS_NAS_RECYCLE_BIN"
NAS_RECYCLE_META_SUFFIX = ".__nas_meta__.json"
NAS_PIN_META_FILENAME = ".ABBAS_NAS_PINS.json"
NAS_MARK_META_FILENAME = ".ABBAS_NAS_MARKS.json"
NAS_MARK_COLOR_SET = {"red", "orange", "yellow", "green", "blue", "purple"}
NAS_HIDDEN_ENTRY_NAMES = {
    "$RECYCLE.BIN",
    "System Volume Information",
    NAS_RECYCLE_DIR_NAME,
    NAS_PIN_META_FILENAME,
    NAS_MARK_META_FILENAME,
}
_NAS_INFO_CACHE: dict[str, Any] = {}
_NAS_INFO_CACHE_TS = 0.0
_NAS_STATUS_CACHE: dict[str, Any] = {}
_NAS_STATUS_CACHE_TS = 0.0
_NAS_USER_PROFILE_CACHE: dict[str, dict[str, str]] = {}
LIVEKIT_URL = (os.getenv("LIVEKIT_URL") or "").strip()
LIVEKIT_API_KEY = (os.getenv("LIVEKIT_API_KEY") or "").strip()
LIVEKIT_API_SECRET = (os.getenv("LIVEKIT_API_SECRET") or "").strip()
LIVEKIT_ROOM_PREFIX = (os.getenv("LIVEKIT_ROOM_PREFIX") or "abbas-talk-room-").strip() or "abbas-talk-room-"
PROFILE_IMAGE_STORAGE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "uploads", "profile-images")
PROFILE_IMAGE_PUBLIC_PREFIX = "/static/uploads/profile-images"
PROFILE_IMAGE_MAX_BYTES = int(os.getenv("ABBAS_PROFILE_IMAGE_MAX_BYTES", str(3 * 1024 * 1024)))
PROFILE_IMAGE_ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
MESSENGER_UPLOAD_STORAGE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "uploads", "messenger")
MESSENGER_UPLOAD_PUBLIC_PREFIX = "/static/uploads/messenger"
MESSENGER_UPLOAD_MAX_BYTES = int(os.getenv("ABBAS_MESSENGER_UPLOAD_MAX_BYTES", str(25 * 1024 * 1024)))
MESSENGER_UPLOAD_ALLOWED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".txt", ".csv", ".zip", ".7z", ".mp4", ".mov", ".mp3", ".wav",
}
MESSENGER_ROOM_AVATAR_STORAGE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "uploads", "messenger-room-avatars")
MESSENGER_ROOM_AVATAR_PUBLIC_PREFIX = "/static/uploads/messenger-room-avatars"
MESSENGER_ROOM_AVATAR_PRESET_PREFIX = "/static/img/messenger-room-presets"
MESSENGER_ROOM_AVATAR_PRESETS = [
    f"{MESSENGER_ROOM_AVATAR_PRESET_PREFIX}/preset-{index:02d}.svg"
    for index in range(1, 11)
]
MESSENGER_ROOM_AVATAR_MAX_BYTES = int(os.getenv("ABBAS_MESSENGER_ROOM_AVATAR_MAX_BYTES", str(3 * 1024 * 1024)))
MESSENGER_ROOM_AVATAR_ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"}
_NET_RATE_CACHE: dict[str, dict[str, float]] = {}


def _fmt(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M")


def _parse_runtime_dt(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    s = str(value or "").strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(s, fmt)
        except Exception:
            continue
    return None


def _payload_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    s = str(value).strip().lower()
    if s in {"1", "true", "yes", "y", "on", "o"}:
        return True
    if s in {"0", "false", "no", "n", "off", "x"}:
        return False
    return default


def _payload_mb(value: Any, default: float = 0.0) -> float:
    try:
        v = float(value)
    except Exception:
        v = float(default)
    if v != v:  # NaN guard
        return max(float(default), 0.0)
    return max(v, 0.0)


def _payload_int(value: Any, default: int = 0) -> int:
    try:
        v = int(value)
    except Exception:
        v = int(default)
    return max(v, 0)


def _is_idle_measurement(line: str = "", power: str = "", time_sec: str = "") -> bool:
    raw_line = str(line or "").strip().lower()
    raw_power = str(power or "").strip().lower()
    raw_time = str(time_sec or "").strip().lower()

    if raw_line == "0w,0":
        return True

    power_zero = raw_power in {"0", "0w", "0.0", "0.0w"}
    time_zero = raw_time in {"0", "0s", "0sec", "0.0", "0.0s"}
    return power_zero and time_zero


def _format_capacity_label(mb: float) -> str:
    mb = max(float(mb or 0.0), 0.0)
    if mb >= 1024.0:
        return f"{(mb / 1024.0):.2f} GB"
    return f"{mb:.0f} MB"


def _sanitize_firmware_token(value: Any, default: str = "") -> str:
    raw = str(value or "").strip()
    if not raw:
        raw = default
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", raw).strip("._-")
    return cleaned or default


def _format_firmware_identity(family: str, version: str = "", build_id: str = "") -> str:
    family = str(family or "").strip()
    version = str(version or "").strip()
    build_id = str(build_id or "").strip()
    out = family or "-"
    if version:
        out += f" {version}"
    if build_id:
        out += f" ({build_id})"
    return out


def _extract_firmware_fields(payload: dict[str, Any]) -> tuple[str, str, str, str]:
    family = str(payload.get("fw") or payload.get("fw_family") or payload.get("fwFamily") or "").strip()
    version = str(payload.get("fw_version") or payload.get("fwVersion") or "").strip()
    build_id = str(payload.get("fw_build_id") or payload.get("fwBuildId") or "").strip()
    display = _format_firmware_identity(family, version, build_id)
    return family, version, build_id, display


def _release_download_path(release_id: int) -> str:
    return f"/api/device/ota/download/{int(release_id)}"


def _build_firmware_summary(releases: list[dict[str, Any]], devices: list[dict[str, Any]]) -> dict[str, int]:
    assigned = sum(1 for row in devices if int(row.get("target_release_id") or 0) > 0)
    failures = sum(1 for row in devices if str(row.get("ota_state") or "").strip().lower() in {"failed", "error"})
    current_known = sum(1 for row in devices if str(row.get("current_version") or "").strip())
    return {
        "release_count": len(releases),
        "device_count": len(devices),
        "assigned_count": assigned,
        "failure_count": failures,
        "current_known_count": current_known,
    }


def _build_firmware_payload() -> dict[str, Any]:
    releases = firmware_repo.list_releases()
    devices = firmware_repo.list_device_rows()
    families = sorted(
        {
            str(row.get("family") or "").strip()
            for row in releases
            if str(row.get("family") or "").strip()
        }
        | {
            str(row.get("current_family") or "").strip()
            for row in devices
            if str(row.get("current_family") or "").strip()
        }
        | {FIRMWARE_FAMILY_DEFAULT}
    )
    return {
        "summary": _build_firmware_summary(releases, devices),
        "releases": [
            {
                **row,
                "download_path": _release_download_path(int(row.get("id") or 0)),
            }
            for row in releases
        ],
        "devices": devices,
        "families": families,
        "max_upload_bytes": int(FIRMWARE_MAX_UPLOAD_BYTES),
        "default_family": FIRMWARE_FAMILY_DEFAULT,
    }


def _merge_sd_payload(payload: dict[str, Any], prev: dict[str, Any] | None = None) -> tuple[bool, float, float, float]:
    prev = prev or {}

    sd_inserted = _payload_bool(payload.get("sd_inserted"), _payload_bool(prev.get("sd_inserted"), False))
    sd_total_mb = _payload_mb(payload.get("sd_total_mb"), _payload_mb(prev.get("sd_total_mb"), 0.0))
    sd_used_mb = _payload_mb(payload.get("sd_used_mb"), _payload_mb(prev.get("sd_used_mb"), 0.0))
    sd_free_mb = _payload_mb(payload.get("sd_free_mb"), _payload_mb(prev.get("sd_free_mb"), 0.0))

    if sd_total_mb <= 0.0 and (sd_used_mb > 0.0 or sd_free_mb > 0.0):
        sd_total_mb = sd_used_mb + sd_free_mb

    if (not sd_inserted) and (sd_total_mb > 0.0 or sd_used_mb > 0.0 or sd_free_mb > 0.0):
        sd_inserted = True

    if not sd_inserted:
        return False, 0.0, 0.0, 0.0

    if sd_total_mb > 0.0:
        if sd_used_mb > sd_total_mb:
            sd_used_mb = sd_total_mb
        sd_free_mb = max(sd_total_mb - sd_used_mb, 0.0)

    return True, sd_total_mb, sd_used_mb, sd_free_mb


def _normalize_role(value: Any) -> str:
    role = str(value or "").strip().lower()
    if role in {"admin", "superuser"}:
        return role
    return "user"


def _role_has_admin_access(value: Any) -> bool:
    return _normalize_role(value) in {"admin", "superuser"}


def _role_label(value: Any) -> str:
    role = _normalize_role(value)
    if role == "superuser":
        return "SuperUser"
    if role == "admin":
        return "ADMIN"
    return "USER"


def _normalize_approval_status(value: Any) -> str:
    status = str(value or "").strip().lower()
    if status == "approved":
        return "approved"
    return "pending"


def _approval_label(value: Any) -> str:
    status = _normalize_approval_status(value)
    if status == "approved":
        return "승인완료"
    return "승인대기"


def _role_rank(value: Any) -> int:
    role = _normalize_role(value)
    if role == "superuser":
        return 2
    if role == "admin":
        return 1
    return 0


def _promoted_role(value: Any) -> str:
    role = _normalize_role(value)
    if role == "user":
        return "admin"
    if role == "admin":
        return "superuser"
    return "superuser"


def _demoted_role(value: Any) -> str:
    role = _normalize_role(value)
    if role == "superuser":
        return "admin"
    if role == "admin":
        return "user"
    return "user"


def _format_duration_text(total_seconds: Any) -> str:
    try:
        seconds = max(int(float(total_seconds or 0)), 0)
    except Exception:
        seconds = 0
    days, rem = divmod(seconds, 86400)
    hours, rem = divmod(rem, 3600)
    minutes, _ = divmod(rem, 60)
    if days > 0:
        return f"{days}일 {hours}시간"
    if hours > 0:
        return f"{hours}시간 {minutes}분"
    if minutes > 0:
        return f"{minutes}분"
    return "방금"


def _normalize_presence_state(value: Any) -> str:
    state = str(value or "").strip().lower()
    if state in {"live", "visible"}:
        return "live"
    if state in {"background", "hidden"}:
        return "background"
    return "inactive"


def _presence_rank(value: Any) -> int:
    state = _normalize_presence_state(value)
    if state == "live":
        return 2
    if state == "background":
        return 1
    return 0


def _presence_label(value: Any) -> str:
    state = _normalize_presence_state(value)
    if state == "live":
        return "LIVE"
    if state == "background":
        return "BACKGROUND"
    return "INACTIVE"


def _presence_page_label(title: Any, path: Any) -> str:
    title_text = str(title or "").strip()
    path_text = str(path or "").strip()
    if title_text and "|" in title_text:
        title_text = title_text.split("|", 1)[0].strip()
    return title_text or path_text


def _presence_detail_text(state: Any, *, is_logged_in: bool, visible_count: Any = 0, hidden_count: Any = 0) -> str:
    normalized = _normalize_presence_state(state)
    try:
        visible = max(int(visible_count or 0), 0)
    except Exception:
        visible = 0
    try:
        hidden = max(int(hidden_count or 0), 0)
    except Exception:
        hidden = 0

    if normalized == "live":
        if hidden > 0:
            return f"표시 {max(visible, 1)} · 숨김 {hidden}"
        return "창 표시 중"
    if normalized == "background":
        if hidden > 1:
            return f"숨김 창 {hidden}개"
        return "창 숨김 상태"
    if is_logged_in:
        return "로그인 유지, 브라우저 미접속"
    return "세션 없음"


def _format_rate_bits_per_sec(bits_per_sec: Any) -> str:
    try:
        rate = max(float(bits_per_sec or 0), 0.0)
    except Exception:
        rate = 0.0
    units = ["bps", "Kbps", "Mbps", "Gbps", "Tbps"]
    idx = 0
    while rate >= 1000.0 and idx < (len(units) - 1):
        rate /= 1000.0
        idx += 1
    if idx == 0:
        return f"{int(rate)} {units[idx]}"
    return f"{rate:.1f} {units[idx]}"


def _display_user_name(row: dict[str, Any] | None) -> str:
    row = row or {}
    user_id = str(row.get("ID") or row.get("user_id") or "").strip()
    nickname = str(row.get("NICKNAME") or row.get("nickname") or "").strip()
    name = str(row.get("NAME") or row.get("name") or "").strip()
    return nickname or name or user_id


def _profile_image_url_from_value(value: Any) -> str:
    path = str(value or "").strip()
    if path.startswith(f"{PROFILE_IMAGE_PUBLIC_PREFIX}/"):
        return path
    return ""

def _profile_avatar_initial(display_name: Any, fallback: Any = "U") -> str:
    text = str(display_name or fallback or "U").strip()
    return (text[:1] or "U").upper()


def _build_profile_form(user_id: str, row: dict[str, Any] | None = None) -> dict[str, str]:
    row = row or {}
    nickname = str(row.get("NICKNAME") or "").strip()
    name = str(row.get("NAME") or "").strip()
    display_name = nickname or name or user_id
    return {
        "user_id": str(user_id or "").strip(),
        "role": _normalize_role(row.get("ROLE") or ""),
        "role_label": _role_label(row.get("ROLE") or ""),
        "name": name,
        "nickname": nickname,
        "email": str(row.get("EMAIL") or "").strip(),
        "birth": str(row.get("BIRTH") or "").strip(),
        "phone": str(row.get("PHONE") or "").strip(),
        "department": str(row.get("DEPARTMENT") or "").strip(),
        "location": str(row.get("LOCATION") or "").strip(),
        "bio": str(row.get("BIO") or "").strip(),
        "presence_override": str(row.get("PRESENCE_OVERRIDE") or "").strip().lower(),
        "join_date": str(row.get("JOIN_DATE") or "").strip(),
        "profile_image_url": _profile_image_url_from_value(row.get("PROFILE_IMAGE_PATH") or ""),
        "display_name": display_name,
        "avatar_initial": _profile_avatar_initial(display_name, user_id),
        "remove_profile_image": "0",
    }


def _request_user_row(request: Request) -> dict[str, Any]:
    cached = getattr(request.state, "user_row", None)
    if cached is not None:
        return cached

    user_id = getattr(request.state, "user_id", "") or _request_user_id(request)
    row = read_user(user_id) if user_id else None
    normalized = row or {}
    try:
        request.state.user_row = normalized
    except Exception:
        pass
    return normalized


def _request_user_role(request: Request) -> str:
    row = _request_user_row(request)
    return _normalize_role(row.get("ROLE") or "")


def _livekit_enabled() -> bool:
    return bool(LIVEKIT_URL and LIVEKIT_API_KEY and LIVEKIT_API_SECRET and livekit_api is not None)


def _livekit_public_ws_url() -> str:
    raw = str(LIVEKIT_URL or "").strip()
    if not raw:
        return ""
    if raw.startswith("https://"):
        return "wss://" + raw[len("https://"):]
    if raw.startswith("http://"):
        return "ws://" + raw[len("http://"):]
    return raw


def _livekit_room_name(room_id: int) -> str:
    try:
        target_room_id = int(room_id)
    except Exception:
        target_room_id = 0
    return f"{LIVEKIT_ROOM_PREFIX}{max(target_room_id, 0)}"


def _livekit_identity_token(value: Any) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", str(value or "").strip()).strip("-._")


def _request_is_admin(request: Request) -> bool:
    return _role_has_admin_access(_request_user_role(request))


def _require_admin(request: Request) -> None:
    if not _request_is_admin(request):
        raise HTTPException(status_code=403, detail="관리자 권한이 필요합니다.")


def _require_superuser(request: Request) -> None:
    if _request_user_role(request) != "superuser":
        raise HTTPException(status_code=403, detail="슈퍼어드민 권한이 필요합니다.")


def _admin_forbidden_page(request: Request, *, message: str = ""):
    detail = message or "role 값이 admin 또는 superuser인 계정만 이 페이지에 접근할 수 있습니다."
    return templates.TemplateResponse(
        "forbidden.html",
        _base_context(
            request,
            "",
            page_title="접근 제한",
            forbidden_title="관리자 전용 페이지",
            forbidden_message=detail,
        ),
        status_code=403,
    )


def _superuser_forbidden_page(request: Request, *, message: str = ""):
    detail = message or "role 값이 superuser인 계정만 이 페이지에 접근할 수 있습니다."
    return templates.TemplateResponse(
        "forbidden.html",
        _base_context(
            request,
            "",
            page_title="접근 제한",
            forbidden_title="슈퍼어드민 전용 페이지",
            forbidden_message=detail,
        ),
        status_code=403,
    )


def _nav_items(*, is_admin: bool = False) -> list[dict[str, str]]:
    items = [
        {"key": "dashboard", "label": "대시보드", "path": "/"},
        {"key": "device_status", "label": "디바이스 목록", "path": "/device-status"},
        {"key": "control_panel", "label": "제어 패널", "path": "/control-panel"},
        {"key": "logs", "label": "로그", "path": "/logs"},
        {"key": "data", "label": "데이터", "path": "/data"},
        {"key": "plan", "label": "플랜", "path": "/plan"},
        {"key": "firmware_manage", "label": "Firmware Manage", "path": "/firmware-manage"},
        {"key": "settings", "label": "설정", "path": "/settings"},
    ]
    if is_admin:
        items.insert(6, {"key": "nas", "label": "NAS Center", "path": "/nas"})
    return items


def _format_bytes(value: Any) -> str:
    try:
        size = float(value or 0)
    except Exception:
        size = 0.0
    units = ["B", "KB", "MB", "GB", "TB", "PB"]
    unit_idx = 0
    while size >= 1024.0 and unit_idx < (len(units) - 1):
        size /= 1024.0
        unit_idx += 1
    if unit_idx == 0:
        return f"{int(size)} {units[unit_idx]}"
    return f"{size:.2f} {units[unit_idx]}"


def _network_primary_interface() -> tuple[str, Any, Any]:
    if psutil is None:
        return "", None, None
    try:
        stats = psutil.net_if_stats()
        counters = psutil.net_io_counters(pernic=True)
    except Exception:
        return "", None, None

    candidates: list[tuple[float, float, str, Any, Any]] = []
    for iface, iface_stats in (stats or {}).items():
        if not iface or iface.startswith("lo") or not getattr(iface_stats, "isup", False):
            continue
        iface_counter = (counters or {}).get(iface)
        total_bytes = 0.0
        if iface_counter is not None:
            total_bytes = float(getattr(iface_counter, "bytes_recv", 0) or 0) + float(getattr(iface_counter, "bytes_sent", 0) or 0)
        speed = float(getattr(iface_stats, "speed", 0) or 0)
        candidates.append((total_bytes, speed, iface, iface_stats, iface_counter))

    if not candidates:
        return "", None, None

    candidates.sort(key=lambda item: (item[0], item[1], item[2]), reverse=True)
    _total_bytes, _speed, iface, iface_stats, iface_counter = candidates[0]
    return iface, iface_stats, iface_counter


def _system_metric_cards() -> list[dict[str, Any]]:
    hostname = socket.gethostname() or "-"
    machine = ""
    try:
        machine = platform.machine()
    except Exception:
        machine = ""
    if psutil is None:
        return [
            {
                "key": "cpu",
                "label": "CPU",
                "percent": 0.0,
                "center_text": "0%",
                "metric_text": "psutil unavailable",
                "detail_text": f"{hostname} {machine}".strip(),
            },
            {
                "key": "memory",
                "label": "RAM",
                "percent": 0.0,
                "center_text": "0%",
                "metric_text": "psutil unavailable",
                "detail_text": "메모리 정보 비활성화",
            },
            {
                "key": "disk",
                "label": "Storage",
                "percent": 0.0,
                "center_text": "0%",
                "metric_text": "psutil unavailable",
                "detail_text": "디스크 정보 비활성화",
            },
            {
                "key": "network",
                "label": "Network",
                "percent": 0.0,
                "center_text": "0%",
                "metric_text": "psutil unavailable",
                "detail_text": "네트워크 정보 비활성화",
            },
        ]

    cpu_percent = 0.0
    try:
        cpu_percent = float(psutil.cpu_percent(interval=0.12))
    except Exception:
        cpu_percent = 0.0
    cpu_count = 0
    try:
        cpu_count = int(psutil.cpu_count(logical=True) or 0)
    except Exception:
        cpu_count = 0
    load_text = ""
    try:
        load1, load5, load15 = os.getloadavg()
        load_text = f"Load {load1:.2f} / {load5:.2f} / {load15:.2f}"
    except Exception:
        load_text = "Load 정보 없음"

    memory_percent = 0.0
    memory_used = 0
    memory_total = 0
    try:
        vm = psutil.virtual_memory()
        memory_percent = float(getattr(vm, "percent", 0.0) or 0.0)
        memory_used = int(getattr(vm, "used", 0) or 0)
        memory_total = int(getattr(vm, "total", 0) or 0)
    except Exception:
        pass

    disk_percent = 0.0
    disk_used = 0
    disk_total = 0
    disk_free = 0
    try:
        disk = psutil.disk_usage("/")
        disk_percent = float(getattr(disk, "percent", 0.0) or 0.0)
        disk_used = int(getattr(disk, "used", 0) or 0)
        disk_total = int(getattr(disk, "total", 0) or 0)
        disk_free = int(getattr(disk, "free", 0) or 0)
    except Exception:
        pass

    iface, iface_stats, iface_counter = _network_primary_interface()
    speed_mbps = float(getattr(iface_stats, "speed", 0) or 0) if iface_stats is not None else 0.0
    speed_inferred = False
    if speed_mbps <= 0:
        speed_mbps = 100.0
        speed_inferred = True

    rx_total = int(getattr(iface_counter, "bytes_recv", 0) or 0) if iface_counter is not None else 0
    tx_total = int(getattr(iface_counter, "bytes_sent", 0) or 0) if iface_counter is not None else 0
    total_bytes = rx_total + tx_total
    now_ts = time.time()
    prev = _NET_RATE_CACHE.get(iface or "")
    rate_bytes_per_sec = 0.0
    if prev and iface:
        prev_total = float(prev.get("total_bytes") or 0.0)
        prev_ts = float(prev.get("ts") or 0.0)
        if now_ts > prev_ts:
            rate_bytes_per_sec = max(float(total_bytes) - prev_total, 0.0) / max(now_ts - prev_ts, 0.25)
    if iface:
        _NET_RATE_CACHE[iface] = {"ts": now_ts, "total_bytes": float(total_bytes)}
    network_percent = min(100.0, ((rate_bytes_per_sec * 8.0) / (speed_mbps * 1_000_000.0)) * 100.0) if speed_mbps > 0 else 0.0

    network_detail = f"{iface or '인터페이스 없음'} | RX {_format_bytes(rx_total)} / TX {_format_bytes(tx_total)}"
    if speed_inferred and iface:
        network_detail = f"{network_detail} | 100Mbps 기준 추정"

    return [
        {
            "key": "cpu",
            "label": "CPU",
            "percent": round(cpu_percent, 1),
            "center_text": f"{cpu_percent:.1f}%",
            "metric_text": f"{cpu_count} Threads" if cpu_count > 0 else "CPU 정보 없음",
            "detail_text": load_text,
        },
        {
            "key": "memory",
            "label": "RAM",
            "percent": round(memory_percent, 1),
            "center_text": f"{memory_percent:.1f}%",
            "metric_text": f"{_format_bytes(memory_used)} / {_format_bytes(memory_total)}",
            "detail_text": "메모리 사용량",
        },
        {
            "key": "disk",
            "label": "Storage",
            "percent": round(disk_percent, 1),
            "center_text": f"{disk_percent:.1f}%",
            "metric_text": f"{_format_bytes(disk_used)} / {_format_bytes(disk_total)}",
            "detail_text": f"여유 공간 {_format_bytes(disk_free)}",
        },
        {
            "key": "network",
            "label": "Network",
            "percent": round(network_percent, 1),
            "center_text": f"{network_percent:.1f}%",
            "metric_text": _format_rate_bits_per_sec(rate_bytes_per_sec * 8.0),
            "detail_text": network_detail,
        },
    ]


def _system_overview_summary() -> dict[str, str]:
    hostname = socket.gethostname() or "-"
    platform_label = f"{platform.system()} {platform.release()}".strip()
    machine = ""
    try:
        machine = platform.machine()
    except Exception:
        machine = ""

    uptime_text = "-"
    if psutil is not None:
        try:
            boot_ts = float(psutil.boot_time() or 0.0)
            if boot_ts > 0:
                uptime_text = _format_duration_text(time.time() - boot_ts)
        except Exception:
            uptime_text = "-"

    return {
        "hostname": hostname,
        "platform": " ".join(part for part in [platform_label, machine] if part).strip() or "-",
        "uptime_text": uptime_text,
    }


def _build_integrated_admin_system_payload() -> dict[str, Any]:
    return {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "system": {
            **_system_overview_summary(),
            "metrics": _system_metric_cards(),
        },
    }


def _build_integrated_admin_presence_state_map() -> dict[str, dict[str, Any]]:
    presence_map: dict[str, dict[str, Any]] = {}
    for entry in list_live_presence():
        user_id = str(entry.get("user_id") or "").strip()
        if not user_id:
            continue
        state = _normalize_presence_state(entry.get("state") or "")
        info = presence_map.setdefault(
            user_id,
            {
                "state": "inactive",
                "client_count": 0,
                "visible_count": 0,
                "hidden_count": 0,
                "page_title": "",
                "page_path": "",
                "last_seen_ts": 0.0,
            },
        )
        info["client_count"] += 1
        if state == "live":
            info["visible_count"] += 1
        elif state == "background":
            info["hidden_count"] += 1

        if _presence_rank(state) > _presence_rank(info.get("state")):
            info["state"] = state

        try:
            updated_at_ts = float(entry.get("updated_at_ts") or 0.0)
        except Exception:
            updated_at_ts = 0.0
        if updated_at_ts >= float(info.get("last_seen_ts") or 0.0):
            info["last_seen_ts"] = updated_at_ts
            info["page_title"] = str(entry.get("title") or "").strip()
            info["page_path"] = str(entry.get("path") or "").strip()

    for info in presence_map.values():
        info["page_label"] = _presence_page_label(info.get("page_title"), info.get("page_path"))
    return presence_map


def _build_integrated_admin_user_views(current_user_id: str) -> dict[str, Any]:
    rows = user_repo.list_user_rows()
    sessions = list_active_sessions()
    session_map = {
        str(item.get("user_id") or "").strip(): item
        for item in sessions
        if str(item.get("user_id") or "").strip()
    }
    presence_map = _build_integrated_admin_presence_state_map()

    approved_users: list[dict[str, Any]] = []
    pending_users: list[dict[str, Any]] = []

    for row in rows:
        user_id = str(row.get("ID") or "").strip()
        role = _normalize_role(row.get("ROLE") or "")
        approval_status = _normalize_approval_status(row.get("APPROVAL_STATUS") or "")
        session = session_map.get(user_id)
        presence = presence_map.get(user_id) or {}
        presence_state = _normalize_presence_state(presence.get("state") or "")
        display_name = _display_user_name(row)
        item = {
            "user_id": user_id,
            "display_name": display_name,
            "email": str(row.get("EMAIL") or "").strip(),
            "role": role,
            "role_label": _role_label(role),
            "approval_status": approval_status,
            "approval_label": _approval_label(approval_status),
            "join_date": str(row.get("JOIN_DATE") or "").strip(),
            "approved_at": str(row.get("APPROVED_AT") or "").strip(),
            "approved_by": str(row.get("APPROVED_BY") or "").strip(),
            "is_logged_in": bool(session),
            "session_ttl_text": _format_duration_text(session.get("ttl_sec") or 0) if session else "-",
            "session_id_preview": (str(session.get("sid") or "")[:12] + "...") if session else "",
            "presence_state": presence_state,
            "presence_label": _presence_label(presence_state),
            "presence_detail_text": _presence_detail_text(
                presence_state,
                is_logged_in=bool(session),
                visible_count=presence.get("visible_count") or 0,
                hidden_count=presence.get("hidden_count") or 0,
            ),
            "presence_page_text": str(presence.get("page_label") or "").strip(),
            "presence_client_count": int(presence.get("client_count") or 0),
            "is_active_presence": presence_state in {"live", "background"},
            "can_promote": approval_status == "approved" and role != "superuser" and user_id != current_user_id,
            "can_demote": approval_status == "approved" and role != "user" and user_id != current_user_id,
            "is_current_user": user_id == current_user_id,
        }
        if approval_status == "pending":
            pending_users.append(item)
        else:
            approved_users.append(item)

    approved_users.sort(
        key=lambda item: (
            -_presence_rank(item.get("presence_state")),
            0 if item.get("is_logged_in") else 1,
            -_role_rank(item.get("role")),
            str(item.get("user_id") or ""),
        )
    )
    pending_users.sort(key=lambda item: str(item.get("join_date") or ""), reverse=True)

    return {
        "total_users": len(rows),
        "approved_users": approved_users,
        "pending_users": pending_users,
        "active_users": list(approved_users),
        "active_sessions": sum(1 for item in approved_users if item.get("is_active_presence")),
    }


def _collect_usb_devices() -> list[dict[str, str]]:
    devices: list[dict[str, str]] = []
    try:
        proc = subprocess.run(
            ["lsusb"],
            capture_output=True,
            text=True,
            check=False,
            timeout=3.0,
        )
        if proc.returncode == 0:
            for raw_line in (proc.stdout or "").splitlines():
                line = raw_line.strip()
                if not line:
                    continue
                match = re.match(r"Bus\s+(\d+)\s+Device\s+(\d+):\s+ID\s+([0-9a-fA-F]{4}:[0-9a-fA-F]{4})\s*(.*)", line)
                if not match:
                    continue
                name = match.group(4).strip() or "USB Device"
                devices.append(
                    {
                        "bus": match.group(1),
                        "device": match.group(2),
                        "id": match.group(3).lower(),
                        "name": name,
                        "source": "lsusb",
                    }
                )
    except Exception:
        devices = []

    if devices:
        return devices

    sysfs_root = "/sys/bus/usb/devices"
    if not os.path.isdir(sysfs_root):
        return []

    for entry_name in sorted(os.listdir(sysfs_root)):
        entry_path = os.path.join(sysfs_root, entry_name)
        if not os.path.isdir(entry_path):
            continue

        def _read(path_name: str) -> str:
            try:
                with open(os.path.join(entry_path, path_name), "r", encoding="utf-8") as fp:
                    return fp.read().strip()
            except Exception:
                return ""

        product = _read("product")
        manufacturer = _read("manufacturer")
        vendor_id = _read("idVendor")
        product_id = _read("idProduct")
        bus = _read("busnum")
        device = _read("devnum")
        if not any([product, manufacturer, vendor_id, product_id]):
            continue
        name = " ".join(part for part in [manufacturer, product] if part).strip() or "USB Device"
        devices.append(
            {
                "bus": bus,
                "device": device,
                "id": f"{vendor_id}:{product_id}".strip(":"),
                "name": name,
                "source": "sysfs",
            }
        )

    return devices


def _build_integrated_admin_realtime_payload(current_user_id: str) -> dict[str, Any]:
    user_views = _build_integrated_admin_user_views(current_user_id)
    return {
        **_build_integrated_admin_system_payload(),
        "summary": {
            "active_sessions": user_views["active_sessions"],
        },
        "users": user_views["approved_users"],
        "active_users": user_views["active_users"],
    }


def _build_integrated_admin_payload(request: Request) -> dict[str, Any]:
    current_user_id = getattr(request.state, "user_id", "") or ""
    user_views = _build_integrated_admin_user_views(current_user_id)
    usb_devices = _collect_usb_devices()
    summary = {
        "total_users": user_views["total_users"],
        "approved_users": len(user_views["approved_users"]),
        "pending_users": len(user_views["pending_users"]),
        "active_sessions": user_views["active_sessions"],
        "usb_devices": len(usb_devices),
    }

    return {
        **_build_integrated_admin_system_payload(),
        "summary": summary,
        "users": user_views["approved_users"],
        "pending_users": user_views["pending_users"],
        "active_users": user_views["active_users"],
        "usb_devices": usb_devices,
    }


def _clean_drive_text(value: Any) -> str:
    return str(value or "").replace("_", " ").strip()


def _normalize_dev_path(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if raw.startswith("/dev/"):
        return raw
    if raw.startswith("UUID=") or raw.startswith("LABEL="):
        return ""
    return f"/dev/{raw.lstrip('/')}"


def _findmnt_source_for_target(path: str) -> str:
    target = str(path or "").strip()
    if not target:
        return ""
    try:
        proc = subprocess.run(
            ["findmnt", "-n", "-o", "SOURCE", "--target", target],
            capture_output=True,
            text=True,
            check=False,
            timeout=3.0,
        )
    except Exception:
        return ""
    if proc.returncode != 0:
        return ""
    return _normalize_dev_path(proc.stdout)


def _lsblk_parent_device(dev_path: str) -> str:
    device = _normalize_dev_path(dev_path)
    if not device:
        return ""
    try:
        proc = subprocess.run(
            ["lsblk", "-no", "PKNAME", device],
            capture_output=True,
            text=True,
            check=False,
            timeout=3.0,
        )
    except Exception:
        return ""
    if proc.returncode != 0:
        return ""
    parent_name = str(proc.stdout or "").strip()
    return _normalize_dev_path(parent_name)


def _udevadm_properties(dev_path: str) -> dict[str, str]:
    device = _normalize_dev_path(dev_path)
    if not device:
        return {}
    try:
        proc = subprocess.run(
            ["udevadm", "info", "--query=property", "--name", device],
            capture_output=True,
            text=True,
            check=False,
            timeout=3.0,
        )
    except Exception:
        return {}
    if proc.returncode != 0:
        return {}
    props: dict[str, str] = {}
    for line in str(proc.stdout or "").splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = str(key or "").strip()
        value = str(value or "").strip()
        if key:
            props[key] = value
    return props


def _nas_metadata_from_mount_path(mount_path: str) -> dict[str, Any]:
    target = str(mount_path or "").strip()
    if not target or not os.path.isdir(target):
        return {}

    mount_device = _findmnt_source_for_target(target)
    if not mount_device:
        return {}

    disk_device = _lsblk_parent_device(mount_device) or mount_device
    disk_props = _udevadm_properties(disk_device)
    mount_props = _udevadm_properties(mount_device)

    serial = (
        str(disk_props.get("ID_SERIAL_SHORT") or "").strip()
        or str(mount_props.get("ID_SERIAL_SHORT") or "").strip()
        or str(disk_props.get("ID_SERIAL") or "").strip()
        or str(mount_props.get("ID_SERIAL") or "").strip()
    )
    transport = (
        str(disk_props.get("ID_BUS") or "").strip().lower()
        or str(mount_props.get("ID_BUS") or "").strip().lower()
    )
    model = _clean_drive_text(disk_props.get("ID_MODEL") or mount_props.get("ID_MODEL") or "")
    vendor = _clean_drive_text(disk_props.get("ID_VENDOR") or mount_props.get("ID_VENDOR") or "")

    return {
        "root": os.path.realpath(target),
        "mount_path": target,
        "mount_device": mount_device,
        "disk_device": disk_device,
        "transport": transport,
        "serial": serial,
        "model": model,
        "vendor": vendor,
    }


def _enrich_nas_candidate(item: dict[str, Any]) -> dict[str, Any]:
    current = dict(item or {})
    mount_path = str(current.get("mount_path") or "").strip()
    extra = _nas_metadata_from_mount_path(mount_path)
    if extra:
        for key, value in extra.items():
            if value and not str(current.get(key) or "").strip():
                current[key] = value
        if extra.get("root"):
            current["root"] = str(current.get("root") or extra.get("root")).strip() or str(extra.get("root") or "")

    vendor = _clean_drive_text(current.get("vendor") or "Seagate") or "Seagate"
    model = _clean_drive_text(current.get("model") or NAS_LABEL_DEFAULT) or NAS_LABEL_DEFAULT
    label = " ".join(part for part in [vendor, model] if part).strip() or NAS_LABEL_DEFAULT
    current["vendor"] = vendor
    current["model"] = model
    current["label"] = label
    return current


def _nas_identity_incomplete(item: dict[str, Any]) -> bool:
    current = dict(item or {})
    if not bool(current.get("mounted")):
        return False
    return not (
        str(current.get("mount_device") or "").strip()
        and str(current.get("disk_device") or "").strip()
        and str(current.get("serial") or "").strip()
    )


def _walk_lsblk_nodes(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for node in nodes:
        out.append(node)
        children = node.get("children") or []
        if children:
            out.extend(_walk_lsblk_nodes(children))
    return out


def _find_mounted_descendant(node: dict[str, Any]) -> dict[str, Any] | None:
    mountpoint = str(node.get("mountpoint") or "").strip()
    if mountpoint:
        return node
    for child in node.get("children") or []:
        found = _find_mounted_descendant(child)
        if found:
            return found
    return None


def _lsblk_candidates(*, require_mounted: bool = True) -> list[dict[str, Any]]:
    try:
        proc = subprocess.run(
            [
                "lsblk",
                "-J",
                "-b",
                "-o",
                "NAME,MODEL,VENDOR,SIZE,TYPE,MOUNTPOINT,TRAN,SERIAL",
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=3.0,
        )
    except Exception:
        return []

    if proc.returncode != 0:
        return []

    try:
        payload = json.loads(proc.stdout or "{}")
    except Exception:
        return []

    candidates: list[dict[str, Any]] = []
    for node in _walk_lsblk_nodes(payload.get("blockdevices") or []):
        if str(node.get("type") or "").strip() != "disk":
            continue

        mounted = _find_mounted_descendant(node)
        mountpoint = str((mounted or {}).get("mountpoint") or "").strip()
        is_mounted = bool(mountpoint) and os.path.isdir(mountpoint)
        if require_mounted and not is_mounted:
            continue

        disk_name = str(node.get("name") or "").strip()
        mounted_name = str((mounted or {}).get("name") or disk_name).strip()
        model = _clean_drive_text(node.get("model") or NAS_LABEL_DEFAULT)
        vendor = _clean_drive_text(node.get("vendor") or "")
        label = " ".join(part for part in [vendor, model] if part).strip() or NAS_LABEL_DEFAULT
        candidates.append(
            {
                "root": os.path.realpath(mountpoint) if is_mounted else "",
                "mount_path": mountpoint if is_mounted else "",
                "disk_device": f"/dev/{disk_name}" if disk_name else "",
                "mount_device": f"/dev/{mounted_name}" if is_mounted and mounted_name else "",
                "model": model or NAS_LABEL_DEFAULT,
                "vendor": vendor,
                "transport": str(node.get("tran") or "").strip(),
                "serial": str(node.get("serial") or "").strip(),
                "reported_size_bytes": _payload_int(node.get("size"), 0),
                "label": label,
                "connected": True,
                "mounted": is_mounted,
            }
        )
    return candidates


def _path_usage(path: str) -> dict[str, Any]:
    st = os.statvfs(path)
    total_bytes = int(st.f_blocks * st.f_frsize)
    free_bytes = int(st.f_bavail * st.f_frsize)
    used_bytes = max(total_bytes - free_bytes, 0)
    usage_percent = round((used_bytes / total_bytes * 100.0), 1) if total_bytes > 0 else 0.0
    return {
        "total_bytes": total_bytes,
        "free_bytes": free_bytes,
        "used_bytes": used_bytes,
        "usage_percent": usage_percent,
        "total_label": _format_bytes(total_bytes),
        "free_label": _format_bytes(free_bytes),
        "used_label": _format_bytes(used_bytes),
    }


def _nas_placeholder_drive(*, connected: bool = False) -> dict[str, Any]:
    return {
        "root": "",
        "mount_path": "",
        "disk_device": "",
        "mount_device": "",
        "model": NAS_LABEL_DEFAULT,
        "vendor": "Seagate",
        "transport": "",
        "serial": "",
        "reported_size_bytes": 0,
        "label": NAS_LABEL_DEFAULT,
        "connected": connected,
        "mounted": False,
        "total_bytes": 0,
        "free_bytes": 0,
        "used_bytes": 0,
        "usage_percent": 0.0,
        "total_label": "-",
        "free_label": "-",
        "used_label": "-",
        "reported_size_label": "-",
    }


def _nas_candidate_matches_target(item: dict[str, Any]) -> bool:
    haystack = " ".join(
        [
            str(item.get("label") or ""),
            str(item.get("model") or ""),
            str(item.get("vendor") or ""),
        ]
    ).strip().lower()
    if not haystack:
        return False

    hints = [
        str(NAS_MODEL_CONTAINS or "").strip().lower(),
        str(NAS_LABEL_DEFAULT or "").strip().lower(),
        "seagate backup+ desk",
    ]
    return any(hint and hint in haystack for hint in hints)


def _select_nas_candidate(candidates: list[dict[str, Any]]) -> dict[str, Any] | None:
    matches = [dict(item) for item in candidates if _nas_candidate_matches_target(item)]
    if not matches:
        return None

    if NAS_ROOT_OVERRIDE and os.path.isdir(NAS_ROOT_OVERRIDE):
        override_root = os.path.realpath(NAS_ROOT_OVERRIDE)
        for item in matches:
            mount_path = str(item.get("mount_path") or "").strip()
            if mount_path and os.path.realpath(mount_path) == override_root:
                return item
            root = str(item.get("root") or "").strip()
            if root and root == override_root:
                return item

    return matches[0]


def _default_nas_candidate_from_override() -> dict[str, Any] | None:
    if not NAS_ROOT_OVERRIDE or not os.path.isdir(NAS_ROOT_OVERRIDE):
        return None
    if not os.path.ismount(NAS_ROOT_OVERRIDE):
        return None
    root = os.path.realpath(NAS_ROOT_OVERRIDE)
    for item in _lsblk_candidates(require_mounted=True):
        mount_path = str(item.get("mount_path") or "").strip()
        if mount_path and os.path.realpath(mount_path) == root:
            candidate = _nas_placeholder_drive(connected=True)
            candidate.update(item)
            candidate["root"] = root
            candidate["mount_path"] = NAS_ROOT_OVERRIDE
            candidate["connected"] = True
            candidate["mounted"] = True
            return candidate

    candidate = _nas_placeholder_drive(connected=True)
    candidate.update(
        {
            "root": root,
            "mount_path": NAS_ROOT_OVERRIDE,
            "transport": "usb",
            "connected": True,
            "mounted": True,
        }
    )
    return _enrich_nas_candidate(candidate)


def _get_nas_mount_info(*, force_refresh: bool = False) -> dict[str, Any] | None:
    global _NAS_INFO_CACHE, _NAS_INFO_CACHE_TS
    now_ts = time.time()
    if (not force_refresh) and _NAS_INFO_CACHE and (now_ts - _NAS_INFO_CACHE_TS) < 5.0:
        cached = _enrich_nas_candidate(_NAS_INFO_CACHE)
        if not _nas_identity_incomplete(cached):
            _NAS_INFO_CACHE = dict(cached)
            _NAS_INFO_CACHE_TS = now_ts
            return dict(cached)

    candidate = _default_nas_candidate_from_override()
    if candidate is None:
        candidate = _select_nas_candidate(_lsblk_candidates(require_mounted=True))

    if candidate is None:
        _NAS_INFO_CACHE = {}
        _NAS_INFO_CACHE_TS = now_ts
        return None

    try:
        usage = _path_usage(str(candidate.get("root") or ""))
    except Exception:
        _NAS_INFO_CACHE = {}
        _NAS_INFO_CACHE_TS = now_ts
        return None

    info = _enrich_nas_candidate({**candidate, **usage, "connected": True, "mounted": True})
    _NAS_INFO_CACHE = dict(info)
    _NAS_INFO_CACHE_TS = now_ts
    return info


def _get_nas_drive_status(*, force_refresh: bool = False) -> dict[str, Any]:
    global _NAS_STATUS_CACHE, _NAS_STATUS_CACHE_TS
    now_ts = time.time()
    if (not force_refresh) and _NAS_STATUS_CACHE and (now_ts - _NAS_STATUS_CACHE_TS) < 5.0:
        cached = _enrich_nas_candidate(_NAS_STATUS_CACHE)
        if not _nas_identity_incomplete(cached):
            _NAS_STATUS_CACHE = dict(cached)
            _NAS_STATUS_CACHE_TS = now_ts
            return dict(cached)

    mounted_info = _get_nas_mount_info(force_refresh=force_refresh)
    if mounted_info:
        status = dict(mounted_info)
    else:
        candidate = _select_nas_candidate(_lsblk_candidates(require_mounted=False))
        if candidate is None:
            status = _nas_placeholder_drive(connected=False)
        else:
            status = _nas_placeholder_drive(connected=True)
            status.update(candidate)
            status["connected"] = True
            status["mounted"] = bool(candidate.get("mounted"))
            status["label"] = NAS_LABEL_DEFAULT
            if not status["mounted"]:
                status["root"] = ""
                status["mount_path"] = ""
                status["mount_device"] = ""

    status = _enrich_nas_candidate(status)
    reported_size = int(status.get("reported_size_bytes") or 0)
    status["reported_size_label"] = _format_bytes(reported_size) if reported_size > 0 else "-"
    status["label"] = str(status.get("label") or NAS_LABEL_DEFAULT).strip() or NAS_LABEL_DEFAULT
    status["model"] = str(status.get("model") or NAS_LABEL_DEFAULT).strip() or NAS_LABEL_DEFAULT
    status["vendor"] = str(status.get("vendor") or "Seagate").strip() or "Seagate"
    status["connected"] = bool(status.get("connected"))
    status["mounted"] = bool(status.get("mounted"))

    if not status["mounted"]:
        status["total_label"] = "-"
        status["free_label"] = "-"
        status["used_label"] = "-"
        status["usage_percent"] = 0.0

    _NAS_STATUS_CACHE = dict(status)
    _NAS_STATUS_CACHE_TS = now_ts
    return status


def _nas_unavailable_detail() -> str:
    status = _get_nas_drive_status(force_refresh=True)
    if status.get("connected") and not status.get("mounted"):
        return "Seagate Backup+ Desk는 연결되어 있지만 아직 마운트되지 않았습니다."
    return "Seagate Backup+ Desk가 연결되어 있지 않습니다."


def _normalize_nas_rel_path(value: Any) -> str:
    raw = str(value or "").strip().replace("\\", "/")
    normalized = os.path.normpath("/" + raw.lstrip("/")).replace("\\", "/")
    if normalized in {"", "/."}:
        return "/"
    if normalized == "/..":
        raise HTTPException(status_code=400, detail="올바르지 않은 경로입니다.")
    if normalized.startswith("/../"):
        raise HTTPException(status_code=400, detail="허용되지 않은 경로입니다.")
    if not normalized.startswith("/"):
        normalized = f"/{normalized}"
    return normalized


def _resolve_nas_path(path: Any, *, allow_missing: bool = False) -> tuple[dict[str, Any], str, str]:
    info = _get_nas_mount_info()
    if not info:
        raise HTTPException(status_code=503, detail=_nas_unavailable_detail())

    root = os.path.realpath(str(info.get("root") or ""))
    if not root or not os.path.isdir(root):
        raise HTTPException(status_code=503, detail="NAS 저장소 루트를 찾을 수 없습니다.")

    rel_path = _normalize_nas_rel_path(path)
    if _is_nas_recycle_rel_path(rel_path):
        raise HTTPException(status_code=403, detail="휴지통 전용 경로는 일반 탐색으로 열 수 없습니다.")
    target = os.path.realpath(os.path.join(root, rel_path.lstrip("/")))
    try:
        inside_root = os.path.commonpath([root, target]) == root
    except Exception:
        inside_root = False
    if not inside_root:
        raise HTTPException(status_code=400, detail="NAS 루트 밖으로 이동할 수 없습니다.")
    if (not allow_missing) and (not os.path.exists(target)):
        raise HTTPException(status_code=404, detail="대상을 찾을 수 없습니다.")
    return info, rel_path, target


def _nas_breadcrumbs(rel_path: str) -> list[dict[str, str]]:
    crumbs = [{"name": "ROOT", "path": "/"}]
    parts = [part for part in str(rel_path or "/").strip("/").split("/") if part]
    acc: list[str] = []
    for part in parts:
        acc.append(part)
        crumbs.append({"name": part, "path": "/" + "/".join(acc)})
    return crumbs


def _nas_file_kind(name: str, is_dir: bool) -> str:
    if is_dir:
        return "folder"
    ext = os.path.splitext(name)[1].strip().lower()
    if ext in {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".svg"}:
        return "image"
    if ext in {".mp4", ".mov", ".avi", ".mkv", ".webm"}:
        return "video"
    if ext in {".mp3", ".wav", ".aac", ".flac", ".m4a"}:
        return "audio"
    if ext in {".zip", ".7z", ".rar", ".tar", ".gz"}:
        return "archive"
    if ext in {".pdf"}:
        return "pdf"
    if ext in {".csv", ".txt", ".log", ".json", ".xml", ".md"}:
        return "text"
    if ext in {".bin", ".hex", ".uf2"}:
        return "binary"
    return "file"


def _safe_unlink(path: str) -> None:
    try:
        if path and os.path.exists(path):
            os.remove(path)
    except Exception:
        pass


def _nas_archive_root_name(rel_path: str) -> str:
    normalized = _normalize_nas_rel_path(rel_path).rstrip("/")
    if normalized in {"", "/"}:
        return "ROOT"
    return os.path.basename(normalized) or "ROOT"


def _nas_unique_archive_root_name(rel_path: str, used_names: set[str]) -> str:
    base_name = _nas_archive_root_name(rel_path)
    candidate = base_name
    stem, ext = os.path.splitext(base_name)
    suffix_index = 2
    candidate_key = candidate.casefold()

    while candidate_key in used_names:
        if stem:
            candidate = f"{stem} ({suffix_index}){ext}"
        else:
            candidate = f"{base_name} ({suffix_index})"
        candidate_key = candidate.casefold()
        suffix_index += 1

    used_names.add(candidate_key)
    return candidate


def _nas_archive_download_name(paths: list[str]) -> str:
    if len(paths) == 1:
        base_name = os.path.basename(str(paths[0] or "/").rstrip("/")) or "ROOT"
        safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", base_name).strip("._-") or "nas_item"
        return f"{safe_name}.zip"
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"nas_selection_{timestamp}.zip"


def _write_nas_directory_to_zip(archive: zipfile.ZipFile, full_path: str, arc_root: str) -> None:
    root_name = str(arc_root or "ROOT").strip("/").replace("\\", "/") or "ROOT"
    archive.writestr(f"{root_name}/", "")

    for current_root, dirnames, filenames in os.walk(full_path):
        dirnames.sort()
        filenames.sort()
        rel_dir = os.path.relpath(current_root, full_path)
        current_arc = root_name if rel_dir == "." else f"{root_name}/{rel_dir.replace(os.sep, '/')}"
        if rel_dir != ".":
            archive.writestr(f"{current_arc}/", "")
        for filename in filenames:
            file_path = os.path.join(current_root, filename)
            rel_file = filename if rel_dir == "." else f"{rel_dir.replace(os.sep, '/')}/{filename}"
            archive.write(file_path, arcname=f"{root_name}/{rel_file}")


def _relative_nas_path(root: str, absolute_path: str) -> str:
    rel = os.path.relpath(absolute_path, root)
    if rel in {".", ""}:
        return "/"
    return "/" + rel.replace(os.sep, "/")


def _list_nas_directory(rel_path: str) -> dict[str, Any]:
    info, normalized_path, full_path = _resolve_nas_path(rel_path)
    if not os.path.isdir(full_path):
        raise HTTPException(status_code=400, detail="폴더만 열람할 수 있습니다.")

    root = os.path.realpath(str(info.get("root") or ""))
    pin_meta = _read_nas_pin_meta(root)
    mark_meta = _read_nas_mark_meta(root)
    entries: list[dict[str, Any]] = []
    dir_count = 0
    file_count = 0

    for entry in os.scandir(full_path):
        try:
            if _is_hidden_nas_entry(entry.name):
                continue

            resolved = os.path.realpath(entry.path)
            if os.path.commonpath([root, resolved]) != root:
                continue

            is_dir = os.path.isdir(resolved)
            stat_result = os.stat(resolved)
            item_rel_path = _relative_nas_path(root, resolved)
            pinned_at = float(pin_meta.get(item_rel_path) or 0.0)
            mark_color = _normalize_nas_mark_color((mark_meta.get(item_rel_path) or {}).get("color"))
            size_bytes = 0 if is_dir else int(stat_result.st_size)
            if is_dir:
                dir_count += 1
            else:
                file_count += 1

            entries.append(
                {
                    "name": entry.name,
                    "path": item_rel_path,
                    "type": "directory" if is_dir else "file",
                    "kind": _nas_file_kind(entry.name, is_dir),
                    "extension": os.path.splitext(entry.name)[1].strip().lower(),
                    "size_bytes": size_bytes,
                    "size_label": "-" if is_dir else _format_bytes(size_bytes),
                    "modified_at": datetime.fromtimestamp(stat_result.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
                    "downloadable": not is_dir,
                    "pinned": pinned_at > 0,
                    "pinned_at": pinned_at,
                    "marked": bool(mark_color),
                    "mark_color": mark_color,
                }
            )
        except Exception:
            continue

    uploader_rows = nas_repo.get_uploader_rows([item.get("path") for item in entries])
    for item in entries:
        uploader_entry = _normalize_nas_uploader_entry(uploader_rows.get(item.get("path")))
        item["uploader_name"] = str(uploader_entry.get("display_name") or "-")
        item["uploader_nickname"] = str(uploader_entry.get("nickname") or "")
        item["uploader_id"] = str(uploader_entry.get("user_id") or "")
        item["uploader_profile_image_url"] = str(uploader_entry.get("profile_image_url") or "")
        item["uploader_avatar_initial"] = str(uploader_entry.get("avatar_initial") or "U")

    entries.sort(
        key=lambda item: (
            0 if item.get("pinned") else 1,
            -float(item.get("pinned_at") or 0.0) if item.get("pinned") else 0.0,
            0 if item.get("type") == "directory" else 1,
            str(item.get("name") or "").lower(),
        )
    )
    truncated = len(entries) > NAS_LIST_LIMIT
    if truncated:
        entries = entries[:NAS_LIST_LIMIT]

    parent_path = None
    if normalized_path != "/":
        parent_path = os.path.dirname(normalized_path.rstrip("/")) or "/"

    drive = dict(info)
    drive["reported_size_label"] = _format_bytes(int(drive.get("reported_size_bytes") or 0))

    return {
        "ok": True,
        "drive": drive,
        "current_path": normalized_path,
        "current_name": os.path.basename(normalized_path.rstrip("/")) if normalized_path != "/" else str(info.get("label") or NAS_LABEL_DEFAULT),
        "parent_path": parent_path,
        "is_root": normalized_path == "/",
        "breadcrumbs": _nas_breadcrumbs(normalized_path),
        "counts": {
            "total": len(entries),
            "directories": dir_count,
            "files": file_count,
        },
        "truncated": truncated,
        "items": entries,
        "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }


def _safe_upload_name(filename: str) -> str:
    cleaned = os.path.basename(str(filename or "").replace("\\", "/")).strip()
    if cleaned in {"", ".", ".."}:
        return ""
    return cleaned


def _safe_upload_rel_path(value: Any) -> str:
    raw = str(value or "").replace("\\", "/").strip()
    if not raw:
        return ""
    parts = [part.strip() for part in raw.split("/") if str(part or "").strip()]
    if not parts:
        return ""
    for part in parts:
        if part in {".", ".."}:
            return ""
        if "\x00" in part:
            return ""
        if _is_hidden_nas_entry(part):
            return ""
    return "/".join(parts)


def _normalize_nas_mark_color(value: Any) -> str:
    color = str(value or "").strip().lower()
    if color in NAS_MARK_COLOR_SET:
        return color
    return ""


def _nas_rel_path_has_prefix(path: Any, prefix: Any) -> bool:
    normalized_path = _normalize_nas_rel_path(path)
    normalized_prefix = _normalize_nas_rel_path(prefix)
    if normalized_prefix == "/":
        return True
    return normalized_path == normalized_prefix or normalized_path.startswith(normalized_prefix + "/")


def _collapse_nas_rel_paths(paths: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw_path in paths:
        rel_path = _normalize_nas_rel_path(raw_path)
        if rel_path in seen:
            continue
        seen.add(rel_path)
        normalized.append(rel_path)

    normalized.sort(key=lambda value: (value.count("/"), len(value), value))
    collapsed: list[str] = []
    for rel_path in normalized:
        if any(_nas_rel_path_has_prefix(rel_path, parent_path) for parent_path in collapsed):
            continue
        collapsed.append(rel_path)
    return collapsed


def _drop_nas_meta_paths(entries: dict[str, Any], rel_path: str) -> dict[str, Any]:
    target_path = _normalize_nas_rel_path(rel_path)
    next_entries: dict[str, Any] = {}
    for raw_path, value in (entries or {}).items():
        try:
            current_path = _normalize_nas_rel_path(raw_path)
        except HTTPException:
            continue
        if _nas_rel_path_has_prefix(current_path, target_path):
            continue
        next_entries[current_path] = value
    return next_entries


def _remap_nas_meta_paths(entries: dict[str, Any], old_rel_path: str, new_rel_path: str) -> dict[str, Any]:
    source_path = _normalize_nas_rel_path(old_rel_path)
    target_path = _normalize_nas_rel_path(new_rel_path)
    if source_path == "/" or source_path == target_path:
        return dict(entries or {})

    remapped: dict[str, Any] = {}
    for raw_path, value in (entries or {}).items():
        try:
            current_path = _normalize_nas_rel_path(raw_path)
        except HTTPException:
            continue
        if not _nas_rel_path_has_prefix(current_path, source_path):
            remapped[current_path] = value
            continue
        suffix = current_path[len(source_path):]
        next_path = _normalize_nas_rel_path((target_path.rstrip("/") + suffix) if target_path != "/" else (suffix or "/"))
        remapped[next_path] = value
    return remapped


def _is_hidden_nas_entry(name: str) -> bool:
    return str(name or "").strip() in NAS_HIDDEN_ENTRY_NAMES


def _validate_nas_new_folder_name(name: Any) -> str:
    cleaned = str(name or "").strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="새 폴더 이름을 입력해주세요.")
    if cleaned in {".", ".."}:
        raise HTTPException(status_code=400, detail="이 폴더 이름은 사용할 수 없습니다.")
    if "/" in cleaned or "\\" in cleaned:
        raise HTTPException(status_code=400, detail="폴더 이름에는 경로 구분자를 사용할 수 없습니다.")
    if "\x00" in cleaned:
        raise HTTPException(status_code=400, detail="폴더 이름에 허용되지 않은 문자가 포함되어 있습니다.")
    if _is_hidden_nas_entry(cleaned):
        raise HTTPException(status_code=400, detail="시스템 예약 폴더 이름은 사용할 수 없습니다.")
    return cleaned


def _validate_nas_rename_name(name: Any) -> str:
    cleaned = str(name or "").strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="새 이름을 입력해주세요.")
    if cleaned in {".", ".."}:
        raise HTTPException(status_code=400, detail="이 이름은 사용할 수 없습니다.")
    if "/" in cleaned or "\\" in cleaned:
        raise HTTPException(status_code=400, detail="이름에는 경로 구분자를 사용할 수 없습니다.")
    if "\x00" in cleaned:
        raise HTTPException(status_code=400, detail="이름에 허용되지 않은 문자가 포함되어 있습니다.")
    if _is_hidden_nas_entry(cleaned):
        raise HTTPException(status_code=400, detail="시스템 예약 이름은 사용할 수 없습니다.")
    return cleaned


def _is_nas_recycle_rel_path(rel_path: str) -> bool:
    recycle_prefix = f"/{NAS_RECYCLE_DIR_NAME}"
    return rel_path == recycle_prefix or rel_path.startswith(recycle_prefix + "/")


def _ensure_nas_recycle_dir(root: str) -> str:
    recycle_dir = os.path.join(root, NAS_RECYCLE_DIR_NAME)
    os.makedirs(recycle_dir, exist_ok=True)
    return recycle_dir


def _validate_nas_recycle_item_id(item_id: Any) -> str:
    cleaned = str(item_id or "").strip()
    if not cleaned or cleaned in {".", ".."}:
        raise HTTPException(status_code=400, detail="휴지통 항목 식별자가 올바르지 않습니다.")
    if "/" in cleaned or "\\" in cleaned:
        raise HTTPException(status_code=400, detail="휴지통 항목 식별자가 올바르지 않습니다.")
    return cleaned


def _make_nas_recycle_item_id(original_name: str) -> str:
    safe_name = re.sub(r"[^A-Za-z0-9._()-]+", "_", str(original_name or "").strip()).strip("._")
    safe_name = safe_name or "item"
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"{ts}_{secrets.token_hex(4)}_{safe_name}"


def _nas_recycle_meta_path(recycle_dir: str, item_id: str) -> str:
    return os.path.join(recycle_dir, f"{item_id}{NAS_RECYCLE_META_SUFFIX}")


def _nas_size_label(path: str) -> str:
    if os.path.isdir(path):
        return "-"
    try:
        return _format_bytes(os.path.getsize(path))
    except Exception:
        return "-"


def _nas_pin_meta_path(root: str) -> str:
    return os.path.join(root, NAS_PIN_META_FILENAME)


def _nas_mark_meta_path(root: str) -> str:
    return os.path.join(root, NAS_MARK_META_FILENAME)


def _lookup_nas_user_profile(user_id: Any) -> dict[str, str]:
    normalized_user_id = str(user_id or "").strip()
    if not normalized_user_id:
        return {}

    cached = _NAS_USER_PROFILE_CACHE.get(normalized_user_id)
    if cached is not None:
        return dict(cached)

    try:
        row = read_user(normalized_user_id) or {}
    except Exception:
        row = {}

    profile = {
        "user_id": normalized_user_id,
        "nickname": str(row.get("NICKNAME") or "").strip(),
        "name": str(row.get("NAME") or "").strip(),
        "profile_image_url": _profile_image_url_from_value(row.get("PROFILE_IMAGE_PATH") or ""),
    }
    profile["display_name"] = profile["nickname"] or profile["name"] or normalized_user_id
    profile["avatar_initial"] = _profile_avatar_initial(profile["display_name"], normalized_user_id)
    _NAS_USER_PROFILE_CACHE[normalized_user_id] = dict(profile)
    return dict(profile)


def _clear_nas_user_profile_cache(user_id: Any) -> None:
    normalized_user_id = str(user_id or "").strip()
    if not normalized_user_id:
        return
    _NAS_USER_PROFILE_CACHE.pop(normalized_user_id, None)


def _normalize_nas_uploader_entry(value: Any) -> dict[str, Any]:
    payload = value if isinstance(value, dict) else {}
    user_id = str(payload.get("user_id") or "").strip()
    nickname = str(payload.get("nickname") or "").strip()
    name = str(payload.get("name") or "").strip()
    profile_image_url = _profile_image_url_from_value(payload.get("profile_image_url") or "")
    if user_id and user_id != "-":
        profile = _lookup_nas_user_profile(user_id)
        nickname = profile.get("nickname") or nickname
        name = profile.get("name") or name
        profile_image_url = profile.get("profile_image_url") or profile_image_url
    display_name = nickname or name or user_id
    if not display_name:
        return {}

    try:
        updated_at = float(payload.get("updated_at") or 0.0)
    except Exception:
        updated_at = 0.0

    return {
        "user_id": user_id,
        "nickname": nickname,
        "name": name,
        "display_name": display_name,
        "profile_image_url": profile_image_url,
        "avatar_initial": _profile_avatar_initial(display_name, user_id),
        "updated_at": updated_at,
    }


def _current_nas_uploader_entry(request: Request) -> dict[str, Any]:
    user_id = getattr(request.state, "user_id", "") or _request_user_id(request)
    row = _request_user_row(request) if user_id else {}
    return _normalize_nas_uploader_entry(
        {
            "user_id": user_id,
            "nickname": str(row.get("NICKNAME") or "").strip(),
            "name": str(row.get("NAME") or "").strip(),
            "updated_at": time.time(),
        }
    )


def _set_nas_uploader_state(root: str, rel_paths: list[str], uploader: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], list[str]]:
    normalized_uploader = _normalize_nas_uploader_entry(uploader)
    if not normalized_uploader:
        return {}, []

    changed_paths: list[str] = []
    upsert_rows: list[dict[str, Any]] = []
    for raw_path in rel_paths:
        rel_path = _normalize_nas_rel_path(raw_path)
        if rel_path == "/" or _is_nas_recycle_rel_path(rel_path):
            continue
        upsert_rows.append(
            {
                "rel_path": rel_path,
                "user_id": normalized_uploader.get("user_id") or "",
                "nickname": normalized_uploader.get("nickname") or "",
                "name": normalized_uploader.get("name") or "",
            }
        )
        changed_paths.append(rel_path)

    if upsert_rows:
        nas_repo.upsert_uploader_rows(upsert_rows)

    return (
        {
            row["rel_path"]: {
                "user_id": row.get("user_id") or "",
                "nickname": row.get("nickname") or "",
                "name": row.get("name") or "",
                "display_name": normalized_uploader.get("display_name") or "",
                "updated_at": time.time(),
            }
            for row in upsert_rows
        },
        changed_paths,
    )


def _remove_nas_uploader_state(root: str, rel_path: str) -> None:
    normalized_path = _normalize_nas_rel_path(rel_path)
    if normalized_path == "/":
        return
    nas_repo.delete_uploader_prefix(normalized_path)


def _rename_nas_uploader_state(root: str, old_rel_path: str, new_rel_path: str) -> None:
    source_path = _normalize_nas_rel_path(old_rel_path)
    target_path = _normalize_nas_rel_path(new_rel_path)
    if source_path == "/" or source_path == target_path:
        return
    nas_repo.remap_uploader_prefix(source_path, target_path)


def _read_nas_pin_meta(root: str) -> dict[str, float]:
    meta_path = _nas_pin_meta_path(root)
    if not meta_path or not os.path.exists(meta_path):
        return {}
    try:
        with open(meta_path, "r", encoding="utf-8") as fp:
            payload = json.load(fp)
    except Exception:
        return {}
    raw_pins = payload.get("pins") if isinstance(payload, dict) else {}
    if not isinstance(raw_pins, dict):
        return {}

    pins: dict[str, float] = {}
    for raw_path, raw_value in raw_pins.items():
        try:
            rel_path = _normalize_nas_rel_path(raw_path)
        except HTTPException:
            continue
        if rel_path == "/" or _is_nas_recycle_rel_path(rel_path):
            continue
        try:
            pins[rel_path] = float(raw_value)
        except Exception:
            continue
    return pins


def _write_nas_pin_meta(root: str, pins: dict[str, float]) -> None:
    meta_path = _nas_pin_meta_path(root)
    if not pins:
        _safe_unlink(meta_path)
        return
    payload = {
        "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "pins": dict(sorted(pins.items(), key=lambda item: item[1], reverse=True)),
    }
    temp_path = f"{meta_path}.tmp"
    try:
        with open(temp_path, "w", encoding="utf-8") as fp:
            json.dump(payload, fp, ensure_ascii=False, indent=2)
        os.replace(temp_path, meta_path)
    finally:
        try:
            if os.path.exists(temp_path):
                os.remove(temp_path)
        except Exception:
            pass


def _set_nas_pin_state(root: str, rel_paths: list[str], *, pinned: bool) -> tuple[dict[str, float], list[str]]:
    pins = _read_nas_pin_meta(root)
    changed_paths: list[str] = []
    timestamp_base = time.time()
    for index, raw_path in enumerate(rel_paths):
        rel_path = _normalize_nas_rel_path(raw_path)
        if rel_path == "/" or _is_nas_recycle_rel_path(rel_path):
            continue
        if pinned:
            pins[rel_path] = timestamp_base + (index * 0.000001)
            changed_paths.append(rel_path)
            continue
        if rel_path in pins:
            pins.pop(rel_path, None)
            changed_paths.append(rel_path)
    _write_nas_pin_meta(root, pins)
    return pins, changed_paths


def _remove_nas_pin_state(root: str, rel_path: str) -> None:
    pins = _read_nas_pin_meta(root)
    next_pins = _drop_nas_meta_paths(pins, rel_path)
    if next_pins == pins:
        return
    _write_nas_pin_meta(root, next_pins)


def _rename_nas_pin_state(root: str, old_rel_path: str, new_rel_path: str) -> None:
    pins = _read_nas_pin_meta(root)
    next_pins = _remap_nas_meta_paths(pins, old_rel_path, new_rel_path)
    if next_pins == pins:
        return
    _write_nas_pin_meta(root, next_pins)


def _read_nas_mark_meta(root: str) -> dict[str, dict[str, Any]]:
    meta_path = _nas_mark_meta_path(root)
    if not meta_path or not os.path.exists(meta_path):
        return {}
    try:
        with open(meta_path, "r", encoding="utf-8") as fp:
            payload = json.load(fp)
    except Exception:
        return {}
    raw_marks = payload.get("marks") if isinstance(payload, dict) else {}
    if not isinstance(raw_marks, dict):
        return {}

    marks: dict[str, dict[str, Any]] = {}
    for raw_path, raw_value in raw_marks.items():
        try:
            rel_path = _normalize_nas_rel_path(raw_path)
        except HTTPException:
            continue
        if rel_path == "/" or _is_nas_recycle_rel_path(rel_path):
            continue
        if not isinstance(raw_value, dict):
            continue
        color = _normalize_nas_mark_color(raw_value.get("color"))
        if not color:
            continue
        try:
            updated_at = float(raw_value.get("updated_at") or 0.0)
        except Exception:
            updated_at = 0.0
        marks[rel_path] = {
            "color": color,
            "updated_at": updated_at,
        }
    return marks


def _write_nas_mark_meta(root: str, marks: dict[str, dict[str, Any]]) -> None:
    meta_path = _nas_mark_meta_path(root)
    if not marks:
        _safe_unlink(meta_path)
        return
    payload = {
        "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "marks": dict(
            sorted(
                marks.items(),
                key=lambda item: float((item[1] or {}).get("updated_at") or 0.0),
                reverse=True,
            )
        ),
    }
    temp_path = f"{meta_path}.tmp"
    try:
        with open(temp_path, "w", encoding="utf-8") as fp:
            json.dump(payload, fp, ensure_ascii=False, indent=2)
        os.replace(temp_path, meta_path)
    finally:
        try:
            if os.path.exists(temp_path):
                os.remove(temp_path)
        except Exception:
            pass


def _set_nas_mark_state(root: str, rel_paths: list[str], color: str | None) -> tuple[dict[str, dict[str, Any]], list[str]]:
    normalized_color = _normalize_nas_mark_color(color)
    marks = _read_nas_mark_meta(root)
    changed_paths: list[str] = []
    timestamp_base = time.time()
    for index, raw_path in enumerate(rel_paths):
        rel_path = _normalize_nas_rel_path(raw_path)
        if rel_path == "/" or _is_nas_recycle_rel_path(rel_path):
            continue
        if normalized_color:
            marks[rel_path] = {
                "color": normalized_color,
                "updated_at": timestamp_base + (index * 0.000001),
            }
            changed_paths.append(rel_path)
            continue
        if rel_path in marks:
            marks.pop(rel_path, None)
            changed_paths.append(rel_path)
    _write_nas_mark_meta(root, marks)
    return marks, changed_paths


def _remove_nas_mark_state(root: str, rel_path: str) -> None:
    marks = _read_nas_mark_meta(root)
    next_marks = _drop_nas_meta_paths(marks, rel_path)
    if next_marks == marks:
        return
    _write_nas_mark_meta(root, next_marks)


def _rename_nas_mark_state(root: str, old_rel_path: str, new_rel_path: str) -> None:
    marks = _read_nas_mark_meta(root)
    next_marks = _remap_nas_meta_paths(marks, old_rel_path, new_rel_path)
    if next_marks == marks:
        return
    _write_nas_mark_meta(root, next_marks)


def _move_nas_item_to_recycle(rel_path: str) -> dict[str, Any]:
    info, normalized_path, full_path = _resolve_nas_path(rel_path)
    if normalized_path == "/":
        raise HTTPException(status_code=400, detail="루트 폴더는 휴지통으로 이동할 수 없습니다.")

    root = os.path.realpath(str(info.get("root") or ""))
    recycle_dir = _ensure_nas_recycle_dir(root)
    original_name = os.path.basename(full_path.rstrip(os.sep)) or os.path.basename(full_path)
    item_id = _make_nas_recycle_item_id(original_name)
    recycle_path = os.path.join(recycle_dir, item_id)
    meta_path = _nas_recycle_meta_path(recycle_dir, item_id)
    deleted_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    item_type = "directory" if os.path.isdir(full_path) else "file"

    meta = {
        "item_id": item_id,
        "original_name": original_name,
        "original_path": normalized_path,
        "deleted_at": deleted_at,
        "type": item_type,
    }

    moved = False
    try:
        shutil.move(full_path, recycle_path)
        moved = True
        with open(meta_path, "w", encoding="utf-8") as fp:
            json.dump(meta, fp, ensure_ascii=False, indent=2)
    except Exception as exc:
        if moved:
            try:
                if os.path.exists(recycle_path) and not os.path.exists(full_path):
                    shutil.move(recycle_path, full_path)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=f"휴지통 이동에 실패했습니다: {exc}")

    _remove_nas_pin_state(root, normalized_path)
    _remove_nas_mark_state(root, normalized_path)
    _rename_nas_uploader_state(root, normalized_path, _relative_nas_path(root, recycle_path))
    return {
        **meta,
        "size_label": _nas_size_label(recycle_path),
    }


def _nas_join_rel_path(base_rel_path: str, child_rel_path: str) -> str:
    base = _normalize_nas_rel_path(base_rel_path)
    child = _safe_upload_rel_path(child_rel_path)
    if not child:
        return base
    return (base.rstrip("/") + "/" + child) if base != "/" else "/" + child


def _collect_nas_upload_conflicts(path: str, directories: list[str], file_paths: list[str]) -> list[dict[str, Any]]:
    info, rel_path, full_path = _resolve_nas_path(path)
    if not os.path.isdir(full_path):
        raise HTTPException(status_code=400, detail="업로드 대상은 폴더여야 합니다.")

    root = os.path.realpath(str(info.get("root") or full_path))
    conflicts: list[dict[str, Any]] = []
    seen_paths: set[str] = set()

    for safe_directory in directories:
        destination_dir = os.path.realpath(os.path.join(full_path, safe_directory))
        if os.path.commonpath([root, destination_dir]) != root:
            continue
        if safe_directory in seen_paths:
            continue
        if os.path.isdir(destination_dir):
            seen_paths.add(safe_directory)
            conflicts.append(
                {
                    "relative_path": safe_directory,
                    "target_path": _nas_join_rel_path(rel_path, safe_directory),
                    "name": os.path.basename(safe_directory),
                    "incoming_type": "directory",
                    "existing_type": "directory",
                    "can_overwrite": True,
                }
            )
            continue
        if os.path.isfile(destination_dir):
            seen_paths.add(safe_directory)
            conflicts.append(
                {
                    "relative_path": safe_directory,
                    "target_path": _nas_join_rel_path(rel_path, safe_directory),
                    "name": os.path.basename(safe_directory),
                    "incoming_type": "directory",
                    "existing_type": "file",
                    "can_overwrite": False,
                }
            )

    for safe_rel_path in file_paths:
        destination = os.path.realpath(os.path.join(full_path, safe_rel_path))
        if os.path.commonpath([root, destination]) != root:
            continue
        if safe_rel_path in seen_paths:
            continue
        if os.path.isfile(destination):
            seen_paths.add(safe_rel_path)
            conflicts.append(
                {
                    "relative_path": safe_rel_path,
                    "target_path": _nas_join_rel_path(rel_path, safe_rel_path),
                    "name": os.path.basename(safe_rel_path),
                    "incoming_type": "file",
                    "existing_type": "file",
                    "can_overwrite": True,
                }
            )
            continue
        if os.path.isdir(destination):
            seen_paths.add(safe_rel_path)
            conflicts.append(
                {
                    "relative_path": safe_rel_path,
                    "target_path": _nas_join_rel_path(rel_path, safe_rel_path),
                    "name": os.path.basename(safe_rel_path),
                    "incoming_type": "file",
                    "existing_type": "directory",
                    "can_overwrite": False,
                }
            )

    conflicts.sort(
        key=lambda item: (
            str(item.get("relative_path") or "").count("/"),
            0 if str(item.get("incoming_type") or "") == "directory" else 1,
            str(item.get("relative_path") or ""),
        )
    )
    return conflicts


def _prepare_nas_move_item(rel_path: str, destination_path: str) -> dict[str, Any]:
    info, normalized_source, full_source = _resolve_nas_path(rel_path)
    _dest_info, normalized_destination, full_destination = _resolve_nas_path(destination_path)
    if normalized_source == "/":
        raise HTTPException(status_code=400, detail="루트 폴더는 이동할 수 없습니다.")
    if not os.path.isdir(full_destination):
        raise HTTPException(status_code=400, detail="이동 대상은 폴더여야 합니다.")
    if normalized_source == normalized_destination:
        raise HTTPException(status_code=400, detail="같은 위치로는 이동할 수 없습니다.")
    if _nas_rel_path_has_prefix(normalized_destination, normalized_source):
        raise HTTPException(status_code=400, detail="폴더를 자기 자신 또는 하위 폴더 안으로 이동할 수 없습니다.")

    root = os.path.realpath(str(info.get("root") or full_source))
    source_name = os.path.basename(full_source.rstrip(os.sep)) or os.path.basename(full_source)
    target_path = os.path.realpath(os.path.join(full_destination, source_name))
    if os.path.commonpath([root, target_path]) != root:
        raise HTTPException(status_code=400, detail="NAS 루트 밖으로 이동할 수 없습니다.")
    if target_path == full_source:
        raise HTTPException(status_code=400, detail="이미 이 위치에 있는 항목입니다.")
    if os.path.exists(target_path):
        raise HTTPException(status_code=409, detail="대상 폴더에 같은 이름의 파일 또는 폴더가 이미 존재합니다.")

    return {
        "root": root,
        "source_name": source_name,
        "item_type": "directory" if os.path.isdir(full_source) else "file",
        "normalized_source": normalized_source,
        "normalized_destination": normalized_destination,
        "full_source": full_source,
        "full_destination": full_destination,
        "target_path": target_path,
    }


def _execute_nas_prepared_move(move_item: dict[str, Any]) -> dict[str, Any]:
    root = os.path.realpath(str(move_item.get("root") or ""))
    normalized_source = _normalize_nas_rel_path(move_item.get("normalized_source") or "/")
    normalized_destination = _normalize_nas_rel_path(move_item.get("normalized_destination") or "/")
    full_source = os.path.realpath(str(move_item.get("full_source") or ""))
    target_path = os.path.realpath(str(move_item.get("target_path") or ""))
    source_name = str(move_item.get("source_name") or "").strip()
    item_type = "directory" if str(move_item.get("item_type") or "") == "directory" else "file"

    try:
        shutil.move(full_source, target_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"이동에 실패했습니다: {exc}")

    next_rel_path = _relative_nas_path(root, target_path)
    _rename_nas_pin_state(root, normalized_source, next_rel_path)
    _rename_nas_mark_state(root, normalized_source, next_rel_path)
    _rename_nas_uploader_state(root, normalized_source, next_rel_path)
    return {
        "ok": True,
        "name": source_name,
        "old_path": normalized_source,
        "path": next_rel_path,
        "destination_path": normalized_destination,
        "type": item_type,
    }


def _rollback_nas_prepared_move(move_item: dict[str, Any]) -> None:
    root = os.path.realpath(str(move_item.get("root") or ""))
    original_source = os.path.realpath(str(move_item.get("full_source") or ""))
    current_target = os.path.realpath(str(move_item.get("target_path") or ""))
    if (not original_source) or (not current_target) or (not os.path.exists(current_target)):
        return
    shutil.move(current_target, original_source)
    moved_rel_path = _relative_nas_path(root, current_target)
    original_rel_path = _relative_nas_path(root, original_source)
    _rename_nas_pin_state(root, moved_rel_path, original_rel_path)
    _rename_nas_mark_state(root, moved_rel_path, original_rel_path)
    _rename_nas_uploader_state(root, moved_rel_path, original_rel_path)


def _move_nas_item(rel_path: str, destination_path: str) -> dict[str, Any]:
    return _execute_nas_prepared_move(_prepare_nas_move_item(rel_path, destination_path))


def _list_nas_recycle_items() -> dict[str, Any]:
    info = _get_nas_mount_info()
    if not info:
        raise HTTPException(status_code=503, detail=_nas_unavailable_detail())

    root = os.path.realpath(str(info.get("root") or ""))
    recycle_dir = _ensure_nas_recycle_dir(root)
    items: list[dict[str, Any]] = []

    for entry in os.scandir(recycle_dir):
        if (not entry.is_file()) or (not entry.name.endswith(NAS_RECYCLE_META_SUFFIX)):
            continue

        item_id = entry.name[:-len(NAS_RECYCLE_META_SUFFIX)]
        meta_path = entry.path
        recycle_path = os.path.join(recycle_dir, item_id)
        if not os.path.exists(recycle_path):
            continue

        try:
            with open(meta_path, "r", encoding="utf-8") as fp:
                meta = json.load(fp)
        except Exception:
            meta = {}

        items.append(
            {
                "item_id": item_id,
                "name": str(meta.get("original_name") or item_id),
                "original_path": str(meta.get("original_path") or "/"),
                "deleted_at": str(meta.get("deleted_at") or datetime.fromtimestamp(os.path.getmtime(meta_path)).strftime("%Y-%m-%d %H:%M:%S")),
                "type": str(meta.get("type") or ("directory" if os.path.isdir(recycle_path) else "file")),
                "size_label": _nas_size_label(recycle_path),
            }
        )

    items.sort(key=lambda item: str(item.get("deleted_at") or ""), reverse=True)
    return {"ok": True, "count": len(items), "items": items}


def _resolve_nas_recycle_item(item_id: Any) -> tuple[dict[str, Any], str, str, str, dict[str, Any]]:
    info = _get_nas_mount_info()
    if not info:
        raise HTTPException(status_code=503, detail=_nas_unavailable_detail())

    root = os.path.realpath(str(info.get("root") or ""))
    recycle_dir = _ensure_nas_recycle_dir(root)
    resolved_item_id = _validate_nas_recycle_item_id(item_id)
    recycle_path = os.path.join(recycle_dir, resolved_item_id)
    meta_path = _nas_recycle_meta_path(recycle_dir, resolved_item_id)

    if not os.path.exists(recycle_path) or not os.path.exists(meta_path):
        raise HTTPException(status_code=404, detail="휴지통 항목을 찾을 수 없습니다.")

    try:
        with open(meta_path, "r", encoding="utf-8") as fp:
            meta = json.load(fp)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"휴지통 메타데이터를 읽지 못했습니다: {exc}")

    return info, recycle_dir, recycle_path, meta_path, meta


def _unique_restore_target(path: str) -> str:
    if not os.path.exists(path):
        return path

    parent = os.path.dirname(path)
    filename = os.path.basename(path)
    stem, ext = os.path.splitext(filename)
    suffix = 1
    while True:
        label = "restored" if suffix == 1 else f"restored {suffix}"
        candidate = os.path.join(parent, f"{stem} ({label}){ext}")
        if not os.path.exists(candidate):
            return candidate
        suffix += 1


def _dummy_devices(now: datetime) -> list[dict[str, Any]]:
    # NOTE: device names are intentionally kept in English to comply with the exception rule.
    return [
        {
            "name": "Device-A01",
            "online": True,
            "last_seen": _fmt(now - timedelta(minutes=2)),
            "plan_status": "active",
            "plan_expiry": (now + timedelta(days=28)).date().isoformat(),
        },
        {
            "name": "Device-B02",
            "online": True,
            "last_seen": _fmt(now - timedelta(minutes=7)),
            "plan_status": "active",
            "plan_expiry": (now + timedelta(days=6)).date().isoformat(),
        },
        {
            "name": "Device-C03",
            "online": False,
            "last_seen": _fmt(now - timedelta(hours=8, minutes=12)),
            "plan_status": "expired",
            "plan_expiry": (now - timedelta(days=3)).date().isoformat(),
        },
        {
            "name": "Device-D04",
            "online": True,
            "last_seen": _fmt(now - timedelta(minutes=1)),
            "plan_status": "expired",
            "plan_expiry": (now + timedelta(days=2)).date().isoformat(),
        },
        {
            "name": "Device-E05",
            "online": False,
            "last_seen": _fmt(now - timedelta(days=1, hours=1)),
            "plan_status": "expired",
            "plan_expiry": (now - timedelta(days=12)).date().isoformat(),
        },
        {
            "name": "Device-F06",
            "online": True,
            "last_seen": _fmt(now - timedelta(minutes=16)),
            "plan_status": "active",
            "plan_expiry": (now + timedelta(days=90)).date().isoformat(),
        },
        {
            "name": "Device-G07",
            "online": True,
            "last_seen": _fmt(now - timedelta(minutes=4)),
            "plan_status": "active",
            "plan_expiry": (now + timedelta(days=14)).date().isoformat(),
        },
        {
            "name": "Device-H08",
            "online": False,
            "last_seen": _fmt(now - timedelta(hours=3, minutes=45)),
            "plan_status": "expired",
            "plan_expiry": (now + timedelta(days=1)).date().isoformat(),
        },
    ]


def _dummy_logs(now: datetime, devices: list[dict[str, Any]]) -> list[dict[str, Any]]:
    names = [d["name"] for d in devices]
    return [
        {"time": _fmt(now - timedelta(minutes=3)), "device": names[0], "type": "정보", "message": "상태 핑 수신"},
        {"time": _fmt(now - timedelta(minutes=11)), "device": names[3], "type": "경고", "message": "응답 지연 감지"},
        {"time": _fmt(now - timedelta(minutes=22)), "device": names[2], "type": "오류", "message": "통신 실패(재시도 대기)"},
        {"time": _fmt(now - timedelta(hours=1, minutes=7)), "device": names[1], "type": "정보", "message": "사용량 동기화 완료"},
        {"time": _fmt(now - timedelta(hours=2, minutes=41)), "device": names[5], "type": "정보", "message": "설정 값 업데이트(로컬)"},
        {"time": _fmt(now - timedelta(hours=4, minutes=10)), "device": names[4], "type": "경고", "message": "구독 만료 상태 감지"},
    ]


def _counts(devices: list[dict[str, Any]]) -> dict[str, int]:
    total = len(devices)
    online = sum(1 for d in devices if d["online"])
    offline = total - online
    expired = sum(1 for d in devices if d["plan_status"] != "active")
    active = total - expired
    return {
        "total": total,
        "online": online,
        "offline": offline,
        "expired": expired,
        "restricted": 0,
        "active": active,
    }


def _subscription_status_code(status_kor: str) -> str:
    if status_kor == "활성":
        return "active"
    return "expired"


# [NEW FEATURE] Fixed assigned energy by non-test subscription plan (J).
SUB_PLAN_FIXED_ENERGY_J: dict[str, int] = {
    "BASIC 6M": 22_000_000,
    "BASIC 9M": 14_000_000,
    "BASIC 1Y": 8_000_000,
}


def _runtime_used_energy_j(customer: str, device_id: str, ip: str) -> int:
    key = _resolve_runtime_key(customer, ip, _norm_device_id(device_id))
    st = (_DEVICE_STATE.get(key or "") if key else {}) or {}
    if not isinstance(st, dict):
        return 0
    return _payload_int(st.get("used_energy_j"), _payload_int(st.get("usedEnergyJ"), 0))


def _subscription_energy_fields(rec: dict[str, Any]) -> dict[str, int]:
    plan_energy_j = _payload_int(rec.get("energy_j"), _payload_int(rec.get("energyJ"), 0))
    used_energy_j = _runtime_used_energy_j(
        str(rec.get("customer") or "-"),
        str(rec.get("device_id") or ""),
        str(rec.get("ip") or ""),
    )
    if used_energy_j <= 0:
        used_energy_j = _payload_int(rec.get("used_energy_j"), _payload_int(rec.get("usedEnergyJ"), 0))
    remaining_energy_j = max(plan_energy_j - used_energy_j, 0)
    return {
        "energy_j": plan_energy_j,
        "energyJ": plan_energy_j,
        "used_energy_j": used_energy_j,
        "usedEnergyJ": used_energy_j,
        "remaining_energy_j": remaining_energy_j,
        "remainingEnergyJ": remaining_energy_j,
    }


def _build_plan_payload() -> dict[str, Any]:
    rows = device_repo.list_devices_with_subscription()
    devices: list[dict[str, Any]] = []
    counts = {"active": 0, "expired": 0, "restricted": 0}

    for r in rows:
        status = str(r.get("status") or "만료")
        status_code = _subscription_status_code(status)
        if status == "활성":
            counts["active"] += 1
        else:
            counts["expired"] += 1

        item = {
            "device_id": str(r.get("device_id") or ""),
            "name": str(r.get("device_name") or r.get("name") or r.get("ip") or ""),
            "status": status,
            "status_code": status_code,
            "plan": str(r.get("plan") or "-") or "-",
            "start_date": str(r.get("start_date") or "-") or "-",
            "expiry_date": str(r.get("expiry_date") or "-") or "-",
            "remaining_days": int(r.get("remaining_days") or 0),
            "customer": str(r.get("customer") or "-"),
            "ip": str(r.get("ip") or ""),
            # [NEW FEATURE] Assigned/used/remaining energy columns for the plan table.
            **_subscription_energy_fields(r),
        }
        devices.append(item)

    return {"devices": devices, "counts": counts}


def _subscription_response_or_default(device_id: str) -> dict[str, Any]:
    rec = device_repo.get_subscription_by_device_id(device_id)
    if not rec:
        item = {
            "device_id": _norm_device_id(device_id),
            "device_name": "",
            "status": "미등록",
            "status_code": "unregistered",
            "plan": None,
            "start_date": None,
            "expiry_date": None,
            "remaining_days": 0,
        }
        item.update(_subscription_energy_fields(item))
        return item

    plan_value = (str(rec.get("plan")) if rec.get("plan") else None)
    status_value = str(rec.get("status") or "만료")
    status_code_value = str(rec.get("status_code") or _subscription_status_code(status_value))
    # Registered device with revoked/cleared plan should boot to the ready page, not the expired lock page.
    if not plan_value:
        status_value = "미등록"
        status_code_value = "unregistered"

    item = {
        "device_id": str(rec.get("device_id") or _norm_device_id(device_id)),
        "device_name": str(rec.get("device_name") or ""),
        "status": status_value,
        "status_code": status_code_value,
        "plan": plan_value,
        "start_date": (str(rec.get("start_date")) if rec.get("start_date") else None),
        "expiry_date": (str(rec.get("expiry_date")) if rec.get("expiry_date") else None),
        "remaining_days": int(rec.get("remaining_days") or 0),
        "customer": str(rec.get("customer") or "-"),
        "ip": str(rec.get("ip") or ""),
    }
    item.update(_subscription_energy_fields(rec))
    return item


def _base_context(request: Request, active_key: str, **kwargs: Any) -> dict[str, Any]:
    user_id = getattr(request.state, "user_id", "") or ""
    logged_in = bool(user_id)
    current_user_role = _request_user_role(request) if logged_in else "user"
    is_admin = _role_has_admin_access(current_user_role)
    is_superuser = current_user_role == "superuser"
    current_user = _request_user_row(request) if logged_in else {}
    current_profile = _build_profile_form(user_id, current_user) if logged_in else _build_profile_form("", {})
    current_user_name = str(current_profile.get("display_name") or user_id or "").strip()
    return {
        "request": request,
        "nav_items": _nav_items(is_admin=is_admin),
        "nav_active": active_key,
        "logged_in": logged_in,
        "current_user_id": user_id,
        "current_user_name": current_user_name,
        "current_user_role": current_user_role,
        "current_user_role_label": _role_label(current_user_role),
        "current_user_profile_image_url": current_profile.get("profile_image_url") or "",
        "is_admin": is_admin,
        "is_superuser": is_superuser,
        "livekit_enabled": _livekit_enabled(),
        "livekit_ws_url": _livekit_public_ws_url(),
        **kwargs,
    }


def _profile_settings_context(
    request: Request,
    *,
    form_data: dict[str, Any] | None = None,
    errors: list[str] | None = None,
    saved: bool = False,
) -> dict[str, Any]:
    user_id = getattr(request.state, "user_id", "") or ""
    row = _request_user_row(request) if user_id else {}
    profile_form = _build_profile_form(user_id, row)
    if form_data:
        for key, value in form_data.items():
            profile_form[key] = str(value or "").strip() if key != "profile_image_url" else _profile_image_url_from_value(value)
        display_name = profile_form.get("nickname") or profile_form.get("name") or user_id
        profile_form["display_name"] = display_name
        profile_form["avatar_initial"] = _profile_avatar_initial(display_name, user_id)
        profile_form["role_label"] = _role_label(profile_form.get("role") or row.get("ROLE") or "")
    return _base_context(
        request,
        "profile_settings",
        page_title="프로필 설정",
        profile_form=profile_form,
        profile_errors=errors or [],
        profile_saved=saved,
        profile_image_max_mb=max(1, PROFILE_IMAGE_MAX_BYTES // (1024 * 1024)),
    )


def _managed_profile_image_abspath(public_path: Any) -> str:
    safe_public = _profile_image_url_from_value(public_path)
    if not safe_public:
        return ""
    filename = os.path.basename(safe_public)
    full_path = os.path.realpath(os.path.join(PROFILE_IMAGE_STORAGE_DIR, filename))
    root = os.path.realpath(PROFILE_IMAGE_STORAGE_DIR)
    if not full_path.startswith(root + os.sep):
        return ""
    return full_path


def _delete_managed_profile_image(public_path: Any) -> None:
    file_path = _managed_profile_image_abspath(public_path)
    if file_path and os.path.exists(file_path):
        try:
            os.remove(file_path)
        except Exception:
            pass


async def _store_profile_image(user_id: str, upload: UploadFile) -> str:
    filename = str(upload.filename or "").strip()
    ext = os.path.splitext(filename)[1].strip().lower()
    if ext not in PROFILE_IMAGE_ALLOWED_EXTENSIONS:
        allowed = ", ".join(sorted(PROFILE_IMAGE_ALLOWED_EXTENSIONS))
        raise ValueError(f"프로필 이미지는 {allowed} 형식만 업로드할 수 있습니다.")

    content_type = str(upload.content_type or "").strip().lower()
    if content_type and not content_type.startswith("image/"):
        raise ValueError("이미지 파일만 업로드할 수 있습니다.")

    raw = await upload.read()
    if not raw:
        raise ValueError("업로드된 이미지 파일이 비어 있습니다.")
    if len(raw) > PROFILE_IMAGE_MAX_BYTES:
        raise ValueError(f"프로필 이미지는 최대 {max(1, PROFILE_IMAGE_MAX_BYTES // (1024 * 1024))}MB까지 업로드할 수 있습니다.")

    os.makedirs(PROFILE_IMAGE_STORAGE_DIR, exist_ok=True)
    safe_user_id = re.sub(r"[^A-Za-z0-9_-]+", "-", str(user_id or "").strip()).strip("-") or "user"
    output_name = f"{safe_user_id}-{int(time.time())}-{secrets.token_hex(4)}{ext}"
    output_path = os.path.join(PROFILE_IMAGE_STORAGE_DIR, output_name)
    with open(output_path, "wb") as fp:
        fp.write(raw)
    return f"{PROFILE_IMAGE_PUBLIC_PREFIX}/{output_name}"


def _managed_messenger_room_avatar_abspath(public_path: Any) -> str:
    safe_public = _messenger_room_avatar_url_from_value(public_path)
    if not safe_public or not safe_public.startswith(f"{MESSENGER_ROOM_AVATAR_PUBLIC_PREFIX}/"):
        return ""
    filename = os.path.basename(safe_public)
    full_path = os.path.realpath(os.path.join(MESSENGER_ROOM_AVATAR_STORAGE_DIR, filename))
    root = os.path.realpath(MESSENGER_ROOM_AVATAR_STORAGE_DIR)
    if not full_path.startswith(root + os.sep):
        return ""
    return full_path


def _delete_managed_messenger_room_avatar(public_path: Any) -> None:
    file_path = _managed_messenger_room_avatar_abspath(public_path)
    if file_path and os.path.exists(file_path):
        try:
            os.remove(file_path)
        except Exception:
            pass


async def _store_messenger_room_avatar(room_id: int, upload: UploadFile) -> str:
    filename = str(upload.filename or "").strip()
    ext = os.path.splitext(filename)[1].strip().lower()
    if ext not in MESSENGER_ROOM_AVATAR_ALLOWED_EXTENSIONS:
        allowed = ", ".join(sorted(MESSENGER_ROOM_AVATAR_ALLOWED_EXTENSIONS))
        raise ValueError(f"방 이미지는 {allowed} 형식만 업로드할 수 있습니다.")

    content_type = str(upload.content_type or "").strip().lower()
    if content_type and not content_type.startswith("image/"):
        raise ValueError("이미지 파일만 업로드할 수 있습니다.")

    raw = await upload.read()
    if not raw:
        raise ValueError("업로드된 이미지 파일이 비어 있습니다.")
    if len(raw) > MESSENGER_ROOM_AVATAR_MAX_BYTES:
        raise ValueError(f"방 이미지는 최대 {max(1, MESSENGER_ROOM_AVATAR_MAX_BYTES // (1024 * 1024))}MB까지 업로드할 수 있습니다.")

    os.makedirs(MESSENGER_ROOM_AVATAR_STORAGE_DIR, exist_ok=True)
    output_name = f"room-{int(room_id)}-{int(time.time())}-{secrets.token_hex(4)}{ext}"
    output_path = os.path.join(MESSENGER_ROOM_AVATAR_STORAGE_DIR, output_name)
    with open(output_path, "wb") as fp:
        fp.write(raw)
    return f"{MESSENGER_ROOM_AVATAR_PUBLIC_PREFIX}/{output_name}"


# ==============================================================
# Runtime device registry (ESP32 -> web) + DB persistence
# ==============================================================
# NOTE: 기존 구조/라우팅을 유지하면서, 저장소만 DB(MySQL/MariaDB)로 전환합니다.

# token map (customer separation)
TOKEN_DIR = "token"
SET_TOKEN_ENV = os.path.join(TOKEN_DIR, "setToken.env")

# Online / Offline 판단 기준(초)
ONLINE_WINDOW_SEC = int(os.getenv("FOR_RND_ONLINE_WINDOW_SEC", "90"))
DEVICE_HEARTBEAT_INTERVAL_SEC = int(os.getenv("ABBAS_DEVICE_HEARTBEAT_SEC", "30"))
DEVICE_TELEMETRY_INTERVAL_SEC = int(os.getenv("ABBAS_DEVICE_TELEMETRY_SEC", "60"))
DEVICE_SUBSCRIPTION_SYNC_INTERVAL_SEC = int(os.getenv("ABBAS_DEVICE_SUBSCRIPTION_SYNC_SEC", "600"))
DEVICE_REGISTER_REFRESH_SEC = int(os.getenv("ABBAS_DEVICE_REGISTER_REFRESH_SEC", "21600"))

# 드롭다운(미등록) 목록에서 ghost device 제거를 위한 TTL(초)
DISCOVERY_TTL_SEC = int(os.getenv("FOR_RND_DISCOVERY_TTL_SEC", str(ONLINE_WINDOW_SEC)))
ENABLE_LAN_DISCOVERY = (os.getenv("ABBAS_ENABLE_LAN_DISCOVERY", "0").strip() == "1")
ENABLE_DIRECT_DEVICE_TCP = (os.getenv("ABBAS_ENABLE_DIRECT_DEVICE_TCP", "0").strip() == "1")

# UDP discovery (ESP32 -> PC) protocol
UDP_DISCOVERY_PORT = int(os.getenv("FOR_RND_UDP_DISCOVERY_PORT", "4210"))
UDP_DISCOVERY_MAGIC = os.getenv("FOR_RND_UDP_DISCOVERY_MAGIC", "DISCOVER_FOR_RND")
UDP_DISCOVERY_REPLY_PREFIX = "FOR_RND_DEVICE|"
UDP_DISCOVERY_TIMEOUT_SEC = float(os.getenv("FOR_RND_UDP_DISCOVERY_TIMEOUT_SEC", "3.0"))

# 오래된 런타임 캐시 정리(초) - 디바이스가 완전히 꺼졌을 때 서버 메모리에서 제거
PRUNE_RUNTIME_SEC = int(os.getenv("FOR_RND_PRUNE_RUNTIME_SEC", str(max(ONLINE_WINDOW_SEC * 6, 90))))

# 서버 메모리 로그 캐시(디바이스별 최근 N라인)
MAX_LOG_LINES = int(os.getenv("FOR_RND_MAX_LOG_LINES", "500"))
RUNTIME_LOG_DEDUP_SEC = int(os.getenv("FOR_RND_RUNTIME_LOG_DEDUP_SEC", "15"))
DEVICE_TCP_PORT = int(os.getenv("FOR_RND_DEVICE_TCP_PORT", "5000"))
REMOTE_RESET_TIMEOUT_SEC = float(os.getenv("FOR_RND_REMOTE_RESET_TIMEOUT_SEC", "1.0"))
REMOTE_SD_DELETE_TIMEOUT_SEC = float(os.getenv("FOR_RND_REMOTE_SD_DELETE_TIMEOUT_SEC", "2.0"))
REMOTE_RESET_COMMAND = "RESET_STATE"
REMOTE_SUBSCRIPTION_RESET_COMMAND = "RESET_SUBSCRIPTION"
TRASHCAN_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "Trashcan")
KST = timezone(timedelta(hours=9))

# 런타임 상태 캐시
_DEVICE_STATE: dict[str, dict[str, Any]] = {}
_DEVICE_LOGS: dict[str, list[dict[str, Any]]] = {}
_LAST_RUNTIME_LOG: dict[str, dict[str, Any]] = {}
_DISCOVERY_CACHE: dict[str, dict[str, Any]] = {}
_IP_CUSTOMER_TO_KEY: dict[tuple[str, str], str] = {}
_TOKEN_TO_KEY: dict[str, str] = {}
_DEVICEID_TO_KEY: dict[str, str] = {}


def _request_client_ip(request: Request) -> str:
    forwarded_for = (request.headers.get("x-forwarded-for") or "").strip()
    if forwarded_for:
        return (forwarded_for.split(",")[0] or "").strip()

    real_ip = (request.headers.get("x-real-ip") or "").strip()
    if real_ip:
        return real_ip

    return (request.client.host if request.client else "").strip()


def _request_user_id(request: Request) -> str:
    sid = request.cookies.get(SESSION_COOKIE_NAME, "") or ""
    return read_session_user(sid) or ""


def _device_polling_policy() -> dict[str, int]:
    return {
        "heartbeat_interval_sec": DEVICE_HEARTBEAT_INTERVAL_SEC,
        "telemetry_interval_sec": DEVICE_TELEMETRY_INTERVAL_SEC,
        "subscription_sync_interval_sec": DEVICE_SUBSCRIPTION_SYNC_INTERVAL_SEC,
        "register_refresh_sec": DEVICE_REGISTER_REFRESH_SEC,
        "firmware_check_interval_sec": DEVICE_FIRMWARE_CHECK_INTERVAL_SEC,
        "online_window_sec": ONLINE_WINDOW_SEC,
    }


def _ensure_device_csv() -> None:
    """CSV 기반 저장소는 폐기되었습니다.

    과거 코드/라우팅 호환을 위해 no-op으로 유지합니다.
    """
    return None


def _ensure_model_token_map_csv() -> None:
    """(미사용) 구형 모델 토큰맵 파일.

    - 사용자 요구: modelTokenMap.csv / 모델명 기반 매핑 로직은 전부 폐기(사용 금지)
    """
    return


def _load_saved_devices() -> list[dict[str, str]]:
    return device_repo.list_saved_devices()


def _append_saved_device(name: str, ip: str, customer: str, token: str = "", device_id: str = "") -> bool:
    name = (name or "").strip()
    ip = (ip or "").strip()
    customer = (customer or "-").strip() or "-"
    token = (token or "").strip()
    device_id = (device_id or "").strip()
    if not ip:
        return False

    # 기존 동작: device_id 우선 중복 방지, fallback IP 중복 방지
    existing = _load_saved_devices()
    if device_id:
        for e in existing:
            if (e.get("device_id") or "").strip() == device_id:
                return True
    for e in existing:
        if (e.get("ip") == ip):
            return True

    try:
        device_repo.upsert_device(name=name or ip, ip=ip, customer=customer, token=token, device_id=device_id)
        return True
    except Exception:
        return False


def _rewrite_saved_devices(rows: list[dict[str, str]]) -> None:
    """Save list of devices to DB.

    기존 코드가 "전체를 다시 쓰는" 방식이므로, DB에서도 동일한 의미로
    replace 동작(UPSERT + 누락 삭제)을 수행합니다.
    """
    device_repo.replace_all_devices(rows)


def _find_saved_device(ip: str, customer: str, token: str = "") -> dict[str, str] | None:
    ip = (ip or "").strip()
    customer = (customer or "-").strip() or "-"
    token = (token or "").strip()
    saved = _load_saved_devices()

    if token:
        for d in saved:
            if (d.get("token") or "").strip() == token:
                return d
    for d in saved:
        if (d.get("ip") == ip):
            return d
    return None


_TOKEN_MAP_LOGGED = False


def _parse_token_map() -> dict[str, str]:
    """(미사용) 구형 모델 토큰맵 로직 무력화."""
    return {}


def _seed_set_token_env_from_env_if_needed() -> None:
    """(레거시) token/setToken.env 운영 방식은 이번 버전에서 사용하지 않습니다."""
    return


def _upsert_token_mapping(token: str, customer: str) -> None:
    """(레거시) token/setToken.env 기반 토큰맵 갱신은 사용하지 않습니다."""
    return


def _remove_token_mapping(token: str) -> None:
    """(레거시) token/setToken.env 기반 토큰맵 삭제는 사용하지 않습니다."""
    return


def _generate_unique_token() -> str:
    """디바이스 저장 시 서버가 자동 생성/부여하는 token.

    - 기존 token map/setToken.env 및 DB의 devices.token과 중복되지 않게 생성
    - 펌웨어 매크로/헤더로 사용하기 쉽도록 ASCII(영문/숫자)만 사용
    """
    existing = set(_parse_token_map().keys())
    for d in _load_saved_devices():
        t = (d.get("token") or "").strip()
        if t:
            existing.add(t)

    # token + 16 hex (총 21자)
    for _ in range(120):
        t = "token" + secrets.token_hex(8)
        if t not in existing:
            return t

    # (극히 예외) 충돌이 반복되면 길이를 늘림
    return "token" + secrets.token_hex(12)


def _extract_auth_token(request: Request, payload: dict[str, Any]) -> str:
    token = (request.headers.get("X-Auth-Token") or request.headers.get("x-auth-token") or "").strip()
    if not token:
        token = str(payload.get("token") or "").strip()
    return token


def _norm_device_id(v: str) -> str:
    """device_id(MAC) 정규화: 대소문자/구분자 차이로 인한 재미등록 버그 방지."""
    s = (v or "").strip().lower()
    if not s:
        return ""
    hex_only = "".join(ch for ch in s if ch in "0123456789abcdef")
    if len(hex_only) == 12:
        return ":".join(hex_only[i:i+2] for i in range(0, 12, 2))
    return s


def _auth_customer(request: Request, payload: dict[str, Any]) -> str:
    """(최소) 토큰 기반 customer 매핑/검증을 하지 않습니다.

    - 사용자 요구: env/setToken.env / modelTokenMap.csv 기반 토큰 로직 전면 폐기
    - token은 디바이스 고유 랜덤값(추적용)으로만 사용
    """
    customer = str(payload.get("customer") or "-").strip() or "-"
    return customer


def _device_record_or_403(device_id: str, token: str) -> dict[str, Any] | None:
    did = _norm_device_id(device_id)
    if not did:
        return None

    rec = device_repo.get_device_by_device_id(did)
    if not rec:
        return None

    expected = str(rec.get("token") or "").strip()
    if expected and not token:
        raise HTTPException(status_code=401, detail="device token required")
    if expected and not secrets.compare_digest(expected, token):
        raise HTTPException(status_code=403, detail="invalid device token")
    return rec


def _require_device_identity(
    request: Request,
    payload: dict[str, Any],
    *,
    require_registered: bool = False,
) -> tuple[str, str, dict[str, Any] | None]:
    token = _extract_auth_token(request, payload)
    device_id = _norm_device_id(str(payload.get("device_id") or "").strip())
    if not device_id:
        raise HTTPException(status_code=400, detail="device_id required")
    if not token:
        raise HTTPException(status_code=400, detail="token required")
    rec = _device_record_or_403(device_id, token)
    if require_registered and not rec:
        raise HTTPException(status_code=404, detail="device not found")
    return token, device_id, rec


def _device_api_meta(device_id: str, ip: str, customer: str) -> dict[str, Any]:
    pending = _pending_remote_command(device_id=device_id, ip=ip, customer=customer) or {}
    return {
        "server_time": datetime.utcnow().replace(tzinfo=timezone.utc).isoformat(),
        "polling": _device_polling_policy(),
        "pending_command_id": int(pending.get("id") or 0),
        "pending_command": str(pending.get("command") or "").strip(),
        "pending_command_queued_at": str(pending.get("queued_at") or "").strip(),
    }


def _append_device_runtime_log(
    runtime_key: str,
    *,
    device_id: str,
    customer: str,
    ip: str,
    when: datetime,
    line: str,
    level: str = "info",
    source: str = "device",
) -> None:
    line = str(line or "").strip()
    if not line:
        return

    prev = _LAST_RUNTIME_LOG.get(runtime_key or "")
    if prev:
        prev_line = str(prev.get("line") or "")
        prev_source = str(prev.get("source") or "")
        prev_when = prev.get("when")
        try:
            age_sec = (when - prev_when).total_seconds() if prev_when else None
        except Exception:
            age_sec = None
        if prev_line == line and prev_source == source and age_sec is not None and age_sec <= RUNTIME_LOG_DEDUP_SEC:
            return

    logs = _DEVICE_LOGS.get(runtime_key)
    if logs is None:
        logs = []
        _DEVICE_LOGS[runtime_key] = logs
    logs.append({"t": when, "line": line})
    _LAST_RUNTIME_LOG[runtime_key] = {"when": when, "line": line, "source": source}
    if len(logs) > MAX_LOG_LINES:
        del logs[: len(logs) - MAX_LOG_LINES]

    try:
        device_ops_repo.append_runtime_log(
            device_id=device_id,
            customer=customer,
            ip=ip,
            line=line,
            level=level,
            source=source,
            created_at=when,
        )
    except Exception:
        pass


def _device_key(customer: str, device_id: str, ip: str) -> str:
    """런타임 상태/로그 캐시 키.

    - 요구사항: 표시명(디바이스명/거래처) 변경이 상태추적/삭제/수정 로직을 깨지 않도록
      customer(표시값)와 무관하게 device_id(고유ID) 우선으로 키를 고정합니다.
    """
    device_id = (device_id or "").strip()
    ip = (ip or "").strip()
    if device_id:
        return device_id
    if ip:
        return ip
    return "unknown"


def _queue_remote_reset(
    device_id: str = "",
    ip: str = "",
    customer: str = "-",
    command: str = REMOTE_RESET_COMMAND,
    queued_by: str = "",
) -> None:
    did = _norm_device_id(device_id)
    if not did:
        return
    try:
        device_ops_repo.queue_command(
            device_id=did,
            customer=(customer or "-").strip() or "-",
            command=(command or REMOTE_RESET_COMMAND).strip() or REMOTE_RESET_COMMAND,
            queued_by=queued_by,
            queued_via="system",
        )
    except Exception:
        pass


def _clear_remote_reset(device_id: str = "", command_id: int = 0, ok: bool = True, result_message: str = "") -> None:
    did = _norm_device_id(device_id)
    if not did or int(command_id or 0) <= 0:
        return
    try:
        device_ops_repo.complete_command(
            command_id=int(command_id),
            device_id=did,
            ok=ok,
            result_message=result_message,
        )
    except Exception:
        pass


def _apply_runtime_reset_cache(key: str) -> None:
    if not key:
        return
    st = _DEVICE_STATE.get(key)
    if st:
        st["parse_ok"] = False
        st["power"] = "-"
        st["time_sec"] = "-"
        st["line"] = ""
        st["used_energy_j"] = 0
        _DEVICE_STATE[key] = st
    _DEVICE_LOGS[key] = []
    _LAST_RUNTIME_LOG.pop(key, None)


def _apply_runtime_subscription_reset_cache(key: str) -> None:
    if not key:
        return
    st = _DEVICE_STATE.get(key)
    if not st:
        return
    st["used_energy_j"] = 0
    _DEVICE_STATE[key] = st


def _pending_remote_command(device_id: str = "", ip: str = "", customer: str = "-") -> dict[str, str] | None:
    did = _norm_device_id(device_id)
    if not did:
        try:
            rec = device_repo.get_device_by_ip_customer((ip or "").strip(), (customer or "-").strip() or "-")
        except Exception:
            rec = None
        did = _norm_device_id(str((rec or {}).get("device_id") or ""))
    if not did:
        return None
    try:
        pending = device_ops_repo.peek_pending_command(device_id=did)
    except Exception:
        pending = None
    return pending


def _send_remote_command(ip: str, command: str, timeout_sec: float = REMOTE_RESET_TIMEOUT_SEC) -> bool:
    ip = (ip or "").strip()
    command = (command or "").strip()
    if not ip or not command:
        return False
    try:
        with socket.create_connection((ip, DEVICE_TCP_PORT), timeout=timeout_sec) as sock:
            sock.settimeout(timeout_sec)
            try:
                sock.recv(256)
            except Exception:
                pass
            sock.sendall((command + "\r\n").encode("utf-8", errors="replace"))
            try:
                sock.recv(256)
            except Exception:
                pass
        print(f"[RESET] remote command ok ip={ip} cmd={command}")
        return True
    except Exception as e:
        print(f"[RESET] remote command fail ip={ip} cmd={command} err={e}")
        return False


def _send_remote_reset(ip: str, timeout_sec: float = REMOTE_RESET_TIMEOUT_SEC) -> bool:
    return _send_remote_command(ip, REMOTE_RESET_COMMAND, timeout_sec=timeout_sec)


def _send_remote_subscription_reset(ip: str, timeout_sec: float = REMOTE_RESET_TIMEOUT_SEC) -> bool:
    return _send_remote_command(ip, REMOTE_SUBSCRIPTION_RESET_COMMAND, timeout_sec=timeout_sec)


def _maybe_remote_reset_pending(device_id: str = "", ip: str = "", customer: str = "-", runtime_key: str = "") -> bool:
    return _pending_remote_command(device_id=device_id, ip=ip, customer=customer) is not None


def _status_of(now: datetime, last_seen: datetime | None, parse_ok: bool) -> str:
    if not last_seen:
        return "Offline"
    if (now - last_seen).total_seconds() > ONLINE_WINDOW_SEC:
        return "Offline"
    return "Online" if parse_ok else "Error"



def _prune_runtime_cache(now: datetime) -> None:
    """오래된 런타임 캐시 정리(ghost device 방지)."""
    try:
        items = list(_DEVICE_STATE.items())
    except Exception:
        return

    for k, st in items:
        try:
            last_seen_dt = st.get("last_seen")
        except Exception:
            last_seen_dt = None
        if not last_seen_dt:
            continue
        try:
            age = (now - last_seen_dt).total_seconds()
        except Exception:
            continue
        if age <= PRUNE_RUNTIME_SEC:
            continue

        token = str(st.get("token") or "").strip()
        device_id = str(st.get("device_id") or "").strip()
        ip = str(st.get("ip") or "").strip()
        customer = str(st.get("customer") or "-").strip() or "-"

        _DEVICE_STATE.pop(k, None)
        _DEVICE_LOGS.pop(k, None)
        _LAST_RUNTIME_LOG.pop(k, None)

        if device_id and _DEVICEID_TO_KEY.get(device_id) == k:
            _DEVICEID_TO_KEY.pop(device_id, None)
        if ip and _IP_CUSTOMER_TO_KEY.get((customer, ip)) == k:
            _IP_CUSTOMER_TO_KEY.pop((customer, ip), None)


def _migrate_device_state_customer(token: str, new_customer: str) -> None:
    """token 기반으로 런타임 상태의 customer 변경(거래처 변경 직후 Offline 고정 방지).

    - token이 여러 디바이스에 공유될 수 있으므로(단일 토큰 모드), 동일 token을 가진 모든 상태를 이동합니다.
    """
    token = (token or "").strip()
    new_customer = (new_customer or "-").strip() or "-"
    if not token:
        return

    for key, st in list(_DEVICE_STATE.items()):
        if str(st.get("token") or "").strip() != token:
            continue

        old_customer = str(st.get("customer") or "-").strip() or "-"
        if old_customer == new_customer:
            continue

        device_id = str(st.get("device_id") or "").strip()
        ip = str(st.get("ip") or "").strip()
        new_key = _device_key(new_customer, device_id, ip)

        st["customer"] = new_customer

        if new_key == key:
            if device_id:
                _DEVICEID_TO_KEY[device_id] = key
            if ip:
                _IP_CUSTOMER_TO_KEY.pop((old_customer, ip), None)
                _IP_CUSTOMER_TO_KEY[(new_customer, ip)] = key
            continue

        # move state
        _DEVICE_STATE.pop(key, None)
        _DEVICE_STATE[new_key] = st

        logs = _DEVICE_LOGS.pop(key, None)
        if logs is not None:
            _DEVICE_LOGS[new_key] = logs
        last_log = _LAST_RUNTIME_LOG.pop(key, None)
        if last_log is not None:
            _LAST_RUNTIME_LOG[new_key] = last_log

        if device_id:
            _DEVICEID_TO_KEY[device_id] = new_key

        if ip:
            _IP_CUSTOMER_TO_KEY.pop((old_customer, ip), None)
            _IP_CUSTOMER_TO_KEY[(new_customer, ip)] = new_key


def _customers_from_saved(saved: list[dict[str, str]]) -> list[str]:
    out = sorted({(d.get("customer") or "-").strip() or "-" for d in saved})
    return out


def _get_local_ipv4_for_broadcast() -> str:
    """UDP 브로드캐스트 대상 계산을 위한 로컬 IPv4 추정.

    - Windows/일반 환경에서 가장 흔한 방식: UDP 소켓을 외부 주소로 connect하여
      OS가 선택한 로컬 NIC의 IP를 얻습니다(실제 패킷 전송 없음).
    """
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        try:
            s.close()
        except Exception:
            pass
        return ""


def _guess_broadcast_addrs(local_ip: str) -> list[str]:
    addrs = {"255.255.255.255"}
    try:
        parts = (local_ip or "").split(".")
        if len(parts) == 4:
            addrs.add(".".join(parts[:3] + ["255"]))  # 흔한 /24
    except Exception:
        pass
    return sorted(addrs)


def _prune_discovery_cache(now: datetime) -> None:
    try:
        items = list(_DISCOVERY_CACHE.items())
    except Exception:
        return
    for k, d in items:
        try:
            last_seen_dt = d.get("last_seen_dt")
        except Exception:
            last_seen_dt = None
        if not last_seen_dt:
            continue
        try:
            age = (now - last_seen_dt).total_seconds()
        except Exception:
            continue
        if age > DISCOVERY_TTL_SEC:
            _DISCOVERY_CACHE.pop(k, None)


def _udp_discover_devices(timeout_sec: float = None) -> list[dict[str, Any]]:
    """UDP discovery(4210)로 동일 네트워크의 ESP32 탐색.

    - UI의 "찾기" 버튼이 호출하는 /api/devices/discovered 에서 사용.
    - 최소 변경 원칙: 기존 라우팅은 그대로 두고, 내부 로직만 UDP 브로드캐스트 방식으로 보강.
    """
    if not ENABLE_LAN_DISCOVERY:
        return []

    timeout = float(timeout_sec if timeout_sec is not None else UDP_DISCOVERY_TIMEOUT_SEC)
    timeout = max(0.5, min(timeout, 6.0))

    now = datetime.now()

    local_ip = _get_local_ipv4_for_broadcast()
    bcast_addrs = _guess_broadcast_addrs(local_ip)
    print(f"[DISCOVERY] start: local_ip={local_ip or '-'} addrs={bcast_addrs} port={UDP_DISCOVERY_PORT} timeout={timeout:.1f}s")

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    except Exception:
        pass

    try:
        sock.bind(("", 0))  # source port: ephemeral (ESP32가 이 포트로 응답)
    except Exception:
        sock.bind(("0.0.0.0", 0))

    try:
        sock.settimeout(0.25)
    except Exception:
        pass

    payload = (UDP_DISCOVERY_MAGIC or "").encode("utf-8")
    for addr in bcast_addrs:
        try:
            sock.sendto(payload, (addr, UDP_DISCOVERY_PORT))
        except Exception as e:
            print(f"[DISCOVERY] send fail -> {addr}:{UDP_DISCOVERY_PORT} err={e}")

    found: dict[str, dict[str, Any]] = {}
    t_end = time.time() + timeout
    while time.time() < t_end:
        try:
            data, (rip, _rport) = sock.recvfrom(512)
        except socket.timeout:
            continue
        except Exception as e:
            print(f"[DISCOVERY] recv error: {e}")
            break

        msg = ""
        try:
            msg = data.decode("utf-8", errors="ignore").strip()
        except Exception:
            continue
        if not msg.startswith(UDP_DISCOVERY_REPLY_PREFIX):
            continue

        parts = [p.strip() for p in msg.split("|")]
        # 기대 포맷:
        #   FOR_RND_DEVICE|<name/model>|<ip>|<tcp_port>|<device_id(MAC)>|<token(optional)>
        name = parts[1] if len(parts) > 1 else ""
        ip = parts[2] if len(parts) > 2 else (rip or "")
        tcp_port = parts[3] if len(parts) > 3 else ""
        device_id = parts[4] if len(parts) > 4 else ""
        # token: ESP32가 생성한 고유 랜덤값(없으면 빈 값)
        token = parts[5] if len(parts) > 5 else ""
        customer = "-"
        key = device_id or ip or (rip or "")
        if not key:
            key = secrets.token_hex(4)

        item = {
            "name": name,
            "ip": ip,
            "tcp_port": tcp_port,
            "device_id": device_id,
            "token": token,
            "customer": customer,
        }
        found[key] = item
        _DISCOVERY_CACHE[key] = {**item, "last_seen_dt": now}
        print(f"[DISCOVERY] recv: name={name} ip={ip} port={tcp_port} device_id={device_id} token={(token[:8] + '...' if token else '')}")

    try:
        sock.close()
    except Exception:
        pass

    _prune_discovery_cache(now)
    print(f"[DISCOVERY] done: {len(found)} device(s)")
    return list(found.values())


def _build_device_status_payload(selected_customer: str = "") -> dict[str, Any]:
    """device-status 페이지와 폴링 API에서 공용으로 쓰는 데이터 생성."""
    now = datetime.now()
    _prune_runtime_cache(now)
    selected_customer = (selected_customer or "").strip()

    saved = _load_saved_devices()
    customers = _customers_from_saved(saved)

    devices: list[dict[str, Any]] = []
    online_cnt = 0
    offline_cnt = 0
    active_sub_cnt = 0
    expired_sub_cnt = 0

    for row in saved:
        ip = row.get("ip") or ""
        customer = row.get("customer") or "-"
        name = row.get("name") or ip
        token = str(row.get("token") or "").strip()
        device_id = _norm_device_id(str(row.get("device_id") or "").strip())
        last_public_ip = str(row.get("last_public_ip") or "").strip()
        last_fw = str(row.get("last_fw") or "").strip()

        key = None
        st = None

        # (우선) device_id(MAC 등) 기반으로 상태 매칭 (표시명/거래처 수정, IP 변경에도 안정)
        if device_id:
            key = _DEVICEID_TO_KEY.get(device_id)
            st = _DEVICE_STATE.get(key or "") if key else None

        if not st and device_id:
            for _k, _st in list(_DEVICE_STATE.items()):
                if str(_st.get("device_id") or "").strip() == device_id:
                    st = _st
                    key = _k
                    _DEVICEID_TO_KEY[device_id] = _k
                    break

        # (보강) token 기반 매칭: ESP32가 MAC(device_id)을 못 보내는 구성에서도
        # name/customer를 임의 수정해도 Online/Offline 매칭이 깨지지 않도록 한다.
        # - 기존 구형 데이터는 device_id가 비어있을 수 있음
        # - 이 경우 customer+ip 매칭에 의존하면 customer 변경 시 Offline으로 보이는 문제가 발생
        if not st and token:
            key = _TOKEN_TO_KEY.get(token)
            st = _DEVICE_STATE.get(key or "") if key else None

        if not st and token:
            for _k, _st in list(_DEVICE_STATE.items()):
                if str(_st.get("token") or "").strip() == token:
                    st = _st
                    key = _k
                    _TOKEN_TO_KEY[token] = _k
                    # device_id를 뒤늦게 알게 된 경우 MAC 매핑도 보강
                    try:
                        dev = str(_st.get("device_id") or "").strip()
                        if dev:
                            _DEVICEID_TO_KEY[dev] = _k
                    except Exception:
                        pass
                    break

        # (fallback) ip/customer로 매칭(구형 호환)
        if not st and ip:
            key = _IP_CUSTOMER_TO_KEY.get((customer, ip))
            st = _DEVICE_STATE.get(key or "") if key else None

        # (보완) 서버 재시작/매핑 누락 등으로 key가 없을 때, ip/customer로 한번 더 찾기
        if not st and ip:
            for _k, _st in list(_DEVICE_STATE.items()):
                if str(_st.get("ip") or "") == ip and str(_st.get("customer") or "-") == customer:
                    st = _st
                    key = _k
                    _IP_CUSTOMER_TO_KEY[(customer, ip)] = _k
                    break

        last_seen_dt: datetime | None = None
        parse_ok = False
        power = "-"
        time_sec = "-"
        last_line = ""
        sd_inserted = False
        sd_total_mb = 0.0
        sd_used_mb = 0.0
        sd_free_mb = 0.0

        if st:
            ip = str(st.get("ip") or ip)
            last_seen_dt = st.get("last_seen")
            parse_ok = bool(st.get("parse_ok", False))
            power = str(st.get("power") or "-")
            time_sec = str(st.get("time_sec") or "-")
            last_line = str(st.get("line") or "")
            sd_inserted = _payload_bool(st.get("sd_inserted"), False)
            sd_total_mb = _payload_mb(st.get("sd_total_mb"), 0.0)
            sd_used_mb = _payload_mb(st.get("sd_used_mb"), 0.0)
            sd_free_mb = _payload_mb(st.get("sd_free_mb"), 0.0)
            last_public_ip = str(st.get("last_public_ip") or last_public_ip).strip()
            last_fw = str(st.get("fw") or last_fw).strip()
        else:
            last_seen_dt = _parse_runtime_dt(row.get("last_seen_at"))
            parse_ok = _payload_bool(row.get("last_parse_ok"), True)
            power = str(row.get("last_power") or "-")
            time_sec = str(row.get("last_time_sec") or "-")
            last_line = str(row.get("last_line") or "")
            sd_inserted = _payload_bool(row.get("sd_inserted"), False)
            sd_total_mb = _payload_mb(row.get("sd_total_mb"), 0.0)
            sd_used_mb = _payload_mb(row.get("sd_used_mb"), 0.0)
            sd_free_mb = _payload_mb(row.get("sd_free_mb"), 0.0)

        if sd_inserted:
            if sd_total_mb <= 0.0 and (sd_used_mb > 0.0 or sd_free_mb > 0.0):
                sd_total_mb = sd_used_mb + sd_free_mb
            if sd_total_mb > 0.0:
                if sd_used_mb > sd_total_mb:
                    sd_used_mb = sd_total_mb
                sd_free_mb = max(sd_total_mb - sd_used_mb, 0.0)
            sd_used_pct = (sd_used_mb / sd_total_mb * 100.0) if sd_total_mb > 0.0 else 0.0
            if sd_used_pct < 0.0:
                sd_used_pct = 0.0
            if sd_used_pct > 100.0:
                sd_used_pct = 100.0
        else:
            sd_total_mb = 0.0
            sd_used_mb = 0.0
            sd_free_mb = 0.0
            sd_used_pct = 0.0

        status = _status_of(now, last_seen_dt, parse_ok)
        if status == "Online":
            online_cnt += 1
        elif status == "Offline":
            offline_cnt += 1

        sub_status_kor = str(row.get("subscription_status") or "만료")
        if sub_status_kor == "활성":
            active_sub_cnt += 1
        else:
            expired_sub_cnt += 1

        if selected_customer and customer != selected_customer:
            continue

        devices.append(
            {
                "name": name,
                "status": status,
                "last_seen": _fmt(last_seen_dt) if last_seen_dt else "-",
                "plan_status": _subscription_status_code(sub_status_kor),
                "plan_expiry": str(row.get("subscription_expiry_date") or "-"),
                "ip": ip,
                "last_public_ip": last_public_ip,
                "customer": customer,
                "token": token,
                "device_id": device_id,
                "fw": last_fw or "-",
                "power": power,
                "time_sec": time_sec,
                "last_log": last_line,
                "sd_inserted": sd_inserted,
                "sd_total_mb": round(sd_total_mb, 2),
                "sd_used_mb": round(sd_used_mb, 2),
                "sd_free_mb": round(sd_free_mb, 2),
                "sd_total_label": _format_capacity_label(sd_total_mb) if sd_inserted else "-",
                "sd_used_label": _format_capacity_label(sd_used_mb) if sd_inserted else "-",
                "sd_free_label": _format_capacity_label(sd_free_mb) if sd_inserted else "-",
                "sd_used_percent": round(sd_used_pct, 1),
            }
        )

    counts = {
        "total": len(saved),
        "online": online_cnt,
        "offline": offline_cnt,
        "expired": expired_sub_cnt,
        "restricted": 0,
        "active": active_sub_cnt,
    }

    return {"ok": True, "devices": devices, "counts": counts, "customers": customers}


@router.get("/api/device-status")
def api_device_status(customer: str = ""):
    """디바이스 목록(Online/Offline 등) 폴링용 API."""
    payload = _build_device_status_payload(customer)
    return payload


from router.page_routes import register_page_routes

register_page_routes(router)


@router.get("/nas", name="nas")
def nas_page(request: Request):
    if not _request_is_admin(request):
        return _admin_forbidden_page(request, message="role 값이 admin 또는 superuser인 계정만 NAS 메뉴를 보고 NAS 페이지에 접속할 수 있습니다.")

    drive = _get_nas_drive_status(force_refresh=True)
    return templates.TemplateResponse(
        "nas.html",
        _base_context(
            request,
            "nas",
            page_title="NAS Center",
            nas_drive=drive,
            nas_model_hint=NAS_LABEL_DEFAULT,
        ),
    )


@router.get("/api/nas/status")
def api_nas_status(request: Request):
    _require_admin(request)
    drive = _get_nas_drive_status(force_refresh=True)
    return JSONResponse({"ok": True, "drive": drive})


@router.get("/api/nas/browse")
def api_nas_browse(request: Request, path: str = "/"):
    _require_admin(request)
    return JSONResponse(_list_nas_directory(path))


@router.get("/api/nas/download")
def api_nas_download(request: Request, path: str = "/"):
    _require_admin(request)
    _info, _rel_path, full_path = _resolve_nas_path(path)
    if not os.path.isfile(full_path):
        raise HTTPException(status_code=400, detail="파일만 다운로드할 수 있습니다.")
    filename = os.path.basename(full_path) or "download.bin"
    return FileResponse(full_path, filename=filename)


@router.post("/api/nas/download-batch")
def api_nas_download_batch(request: Request, payload: dict[str, Any] = Body(default={})):
    _require_admin(request)

    raw_paths = payload.get("paths")
    if not isinstance(raw_paths, list):
        single_path = str(payload.get("path") or "").strip()
        raw_paths = [single_path] if single_path else []

    paths: list[str] = []
    seen_paths: set[str] = set()
    for raw_path in raw_paths:
        normalized_path = _normalize_nas_rel_path(raw_path)
        if normalized_path in seen_paths:
            continue
        seen_paths.add(normalized_path)
        paths.append(normalized_path)

    if not paths:
        raise HTTPException(status_code=400, detail="다운로드할 항목을 선택해주세요.")

    paths = _collapse_nas_rel_paths(paths)

    resolved_items: list[tuple[str, str, str]] = []
    for path in paths:
        _info, rel_path, full_path = _resolve_nas_path(path)
        if os.path.isfile(full_path):
            resolved_items.append((rel_path, full_path, "file"))
            continue
        if os.path.isdir(full_path):
            resolved_items.append((rel_path, full_path, "directory"))
            continue
        raise HTTPException(status_code=400, detail="파일 또는 폴더만 다운로드할 수 있습니다.")

    archive_file = tempfile.NamedTemporaryFile(prefix="abbas_nas_", suffix=".zip", delete=False)
    archive_path = archive_file.name
    archive_file.close()

    try:
        with zipfile.ZipFile(archive_path, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
            used_archive_roots: set[str] = set()
            for rel_path, full_path, item_type in resolved_items:
                archive_root = _nas_unique_archive_root_name(rel_path, used_archive_roots)
                if item_type == "file":
                    archive.write(full_path, arcname=archive_root)
                else:
                    _write_nas_directory_to_zip(archive, full_path, archive_root)
    except Exception:
        _safe_unlink(archive_path)
        raise

    return FileResponse(
        archive_path,
        media_type="application/zip",
        filename=_nas_archive_download_name(paths),
        background=BackgroundTask(_safe_unlink, archive_path),
    )


@router.post("/api/nas/upload/conflicts")
def api_nas_upload_conflicts(request: Request, payload: dict[str, Any] = Body(default={})):
    _require_admin(request)
    path = payload.get("path") or "/"

    directories: list[str] = []
    seen_directories: set[str] = set()
    for raw_directory in payload.get("directories") or []:
        safe_directory = _safe_upload_rel_path(raw_directory)
        if (not safe_directory) or (safe_directory in seen_directories):
            continue
        seen_directories.add(safe_directory)
        directories.append(safe_directory)

    file_paths: list[str] = []
    seen_file_paths: set[str] = set()
    for raw_file_path in payload.get("file_paths") or []:
        safe_file_path = _safe_upload_rel_path(raw_file_path)
        if (not safe_file_path) or (safe_file_path in seen_file_paths):
            continue
        seen_file_paths.add(safe_file_path)
        file_paths.append(safe_file_path)

    conflicts = _collect_nas_upload_conflicts(path, directories, file_paths)
    return JSONResponse({"ok": True, "count": len(conflicts), "conflicts": conflicts})


@router.post("/api/nas/upload/directories")
def api_nas_upload_directories(request: Request, payload: dict[str, Any] = Body(default={})):
    _require_admin(request)
    path = payload.get("path") or "/"
    info, rel_path, full_path = _resolve_nas_path(path)
    if not os.path.isdir(full_path):
        raise HTTPException(status_code=400, detail="업로드 대상은 폴더여야 합니다.")

    created_directories: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    root = os.path.realpath(str(info.get("root") or full_path))
    current_uploader = _current_nas_uploader_entry(request)
    seen_directories: set[str] = set()
    skipped_directory_paths: set[str] = set()
    overwrite_set: set[str] = set()
    created_directory_paths: list[str] = []

    for raw_overwrite_path in payload.get("overwrite_paths") or []:
        safe_overwrite_path = _safe_upload_rel_path(raw_overwrite_path)
        if safe_overwrite_path:
            overwrite_set.add(safe_overwrite_path)

    def has_skipped_directory_ancestor(rel_value: str) -> bool:
        rel_candidate = _safe_upload_rel_path(rel_value)
        if not rel_candidate:
            return False
        normalized_candidate = "/" + rel_candidate
        return any(
            normalized_candidate == ("/" + skipped_dir)
            or normalized_candidate.startswith("/" + skipped_dir + "/")
            for skipped_dir in skipped_directory_paths
        )

    for raw_directory in payload.get("directories") or []:
        safe_directory = _safe_upload_rel_path(raw_directory)
        if not safe_directory:
            skipped.append({"name": str(raw_directory or ""), "reason": "폴더 경로가 올바르지 않습니다."})
            continue
        if has_skipped_directory_ancestor(safe_directory):
            skipped.append({"name": safe_directory, "reason": "상위 폴더 업로드를 건너뛰도록 선택했습니다."})
            continue
        if safe_directory in seen_directories:
            continue

        destination_dir = os.path.realpath(os.path.join(full_path, safe_directory))
        if os.path.commonpath([root, destination_dir]) != root:
            skipped.append({"name": safe_directory, "reason": "허용되지 않은 경로입니다."})
            skipped_directory_paths.add(safe_directory)
            continue
        if os.path.isfile(destination_dir):
            skipped.append({"name": safe_directory, "reason": "동일한 이름의 파일이 이미 있습니다."})
            skipped_directory_paths.add(safe_directory)
            continue
        if os.path.isdir(destination_dir) and safe_directory not in overwrite_set:
            skipped.append({"name": safe_directory, "reason": "동일한 이름의 폴더가 이미 있습니다."})
            skipped_directory_paths.add(safe_directory)
            continue

        try:
            existed_before = os.path.isdir(destination_dir)
            os.makedirs(destination_dir, exist_ok=True)
            seen_directories.add(safe_directory)
            if not existed_before:
                created_path = rel_path.rstrip("/") + "/" + safe_directory if rel_path != "/" else "/" + safe_directory
                created_directories.append(
                    {
                        "name": os.path.basename(safe_directory),
                        "path": created_path,
                    }
                )
                created_directory_paths.append(created_path)
        except Exception as exc:
            skipped.append({"name": safe_directory, "reason": f"폴더 생성 실패: {exc}"})
            skipped_directory_paths.add(safe_directory)

    if created_directory_paths:
        _set_nas_uploader_state(root, created_directory_paths, current_uploader)

    return JSONResponse(
        {
            "ok": True,
            "path": rel_path,
            "saved": [],
            "created_directories": created_directories,
            "skipped": skipped,
            "saved_count": 0,
            "created_directory_count": len(created_directories),
            "skipped_count": len(skipped),
        }
    )


@router.post("/api/nas/upload")
async def api_nas_upload(
    request: Request,
    path: str = Form("/"),
    directories: list[str] | None = Form(default=None),
    file_paths: list[str] | None = Form(default=None),
    overwrite_paths: list[str] | None = Form(default=None),
    files: list[UploadFile] | None = File(default=None),
):
    _require_admin(request)
    info, rel_path, full_path = _resolve_nas_path(path)
    if not os.path.isdir(full_path):
        raise HTTPException(status_code=400, detail="업로드 대상은 폴더여야 합니다.")

    saved: list[dict[str, Any]] = []
    created_directories: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    root = os.path.realpath(str(info.get("root") or full_path))
    current_uploader = _current_nas_uploader_entry(request)
    seen_directories: set[str] = set()
    skipped_directory_paths: set[str] = set()
    overwrite_set: set[str] = set()
    created_directory_paths: list[str] = []
    saved_paths: list[str] = []
    for raw_overwrite_path in overwrite_paths or []:
        safe_overwrite_path = _safe_upload_rel_path(raw_overwrite_path)
        if safe_overwrite_path:
            overwrite_set.add(safe_overwrite_path)

    def has_skipped_directory_ancestor(rel_value: str) -> bool:
        rel_candidate = _safe_upload_rel_path(rel_value)
        if not rel_candidate:
            return False
        normalized_candidate = "/" + rel_candidate
        return any(
            normalized_candidate == ("/" + skipped_dir)
            or normalized_candidate.startswith("/" + skipped_dir + "/")
            for skipped_dir in skipped_directory_paths
        )

    for raw_directory in directories or []:
        safe_directory = _safe_upload_rel_path(raw_directory)
        if not safe_directory:
            skipped.append({"name": str(raw_directory or ""), "reason": "폴더 경로가 올바르지 않습니다."})
            continue
        if has_skipped_directory_ancestor(safe_directory):
            skipped.append({"name": safe_directory, "reason": "상위 폴더 업로드를 건너뛰도록 선택했습니다."})
            continue
        if safe_directory in seen_directories:
            continue

        destination_dir = os.path.realpath(os.path.join(full_path, safe_directory))
        if os.path.commonpath([root, destination_dir]) != root:
            skipped.append({"name": safe_directory, "reason": "허용되지 않은 경로입니다."})
            skipped_directory_paths.add(safe_directory)
            continue
        if os.path.isfile(destination_dir):
            skipped.append({"name": safe_directory, "reason": "동일한 이름의 파일이 이미 있습니다."})
            skipped_directory_paths.add(safe_directory)
            continue
        if os.path.isdir(destination_dir) and safe_directory not in overwrite_set:
            skipped.append({"name": safe_directory, "reason": "동일한 이름의 폴더가 이미 있습니다."})
            skipped_directory_paths.add(safe_directory)
            continue

        try:
            existed_before = os.path.isdir(destination_dir)
            os.makedirs(destination_dir, exist_ok=True)
            seen_directories.add(safe_directory)
            if not existed_before:
                created_path = rel_path.rstrip("/") + "/" + safe_directory if rel_path != "/" else "/" + safe_directory
                created_directories.append(
                    {
                        "name": os.path.basename(safe_directory),
                        "path": created_path,
                    }
                )
                created_directory_paths.append(created_path)
        except Exception as exc:
            skipped.append({"name": safe_directory, "reason": f"폴더 생성 실패: {exc}"})
            skipped_directory_paths.add(safe_directory)

    for index, upload in enumerate(files or []):
        raw_rel_path = ""
        if index < len(file_paths or []):
            raw_rel_path = str(file_paths[index] or "")
        if not raw_rel_path:
            raw_rel_path = upload.filename or ""

        safe_rel_path = _safe_upload_rel_path(raw_rel_path)
        if not safe_rel_path:
            skipped.append({"name": raw_rel_path or upload.filename or "", "reason": "파일명이 올바르지 않습니다."})
            try:
                await upload.close()
            except Exception:
                pass
            continue

        safe_name = _safe_upload_name(safe_rel_path)
        if has_skipped_directory_ancestor(safe_rel_path):
            skipped.append({"name": safe_name, "reason": "상위 폴더 업로드를 건너뛰도록 선택했습니다."})
            try:
                await upload.close()
            except Exception:
                pass
            continue
        destination = os.path.realpath(os.path.join(full_path, safe_rel_path))
        if os.path.commonpath([root, destination]) != root:
            skipped.append({"name": safe_rel_path, "reason": "허용되지 않은 경로입니다."})
            try:
                await upload.close()
            except Exception:
                pass
            continue
        if os.path.isdir(destination):
            skipped.append({"name": safe_name, "reason": "동일한 이름의 폴더가 이미 있습니다."})
            try:
                await upload.close()
            except Exception:
                pass
            continue
        if os.path.isfile(destination) and safe_rel_path not in overwrite_set:
            skipped.append({"name": safe_name, "reason": "동일한 이름의 파일이 이미 있습니다."})
            try:
                await upload.close()
            except Exception:
                pass
            continue

        parent_dir = os.path.dirname(destination)
        try:
            if parent_dir:
                os.makedirs(parent_dir, exist_ok=True)
        except Exception as exc:
            skipped.append({"name": safe_rel_path, "reason": f"폴더 생성 실패: {exc}"})
            try:
                await upload.close()
            except Exception:
                pass
            continue
        size_bytes = 0
        try:
            with open(destination, "wb") as fp:
                while True:
                    chunk = await upload.read(NAS_UPLOAD_CHUNK_BYTES)
                    if not chunk:
                        break
                    fp.write(chunk)
                    size_bytes += len(chunk)
            saved.append(
                {
                    "name": safe_name,
                    "path": rel_path.rstrip("/") + "/" + safe_rel_path if rel_path != "/" else "/" + safe_rel_path,
                    "relative_path": safe_rel_path,
                    "size_bytes": size_bytes,
                    "size_label": _format_bytes(size_bytes),
                }
            )
            saved_paths.append(saved[-1]["path"])
        except Exception as exc:
            try:
                if os.path.exists(destination):
                    os.remove(destination)
            except Exception:
                pass
            skipped.append({"name": safe_name, "reason": f"저장 실패: {exc}"})
        finally:
            try:
                await upload.close()
            except Exception:
                pass

    if created_directory_paths:
        _set_nas_uploader_state(root, created_directory_paths, current_uploader)
    if saved_paths:
        _set_nas_uploader_state(root, saved_paths, current_uploader)

    return JSONResponse(
        {
            "ok": True,
            "path": rel_path,
            "saved": saved,
            "created_directories": created_directories,
            "skipped": skipped,
            "saved_count": len(saved),
            "created_directory_count": len(created_directories),
            "skipped_count": len(skipped),
        }
    )


@router.post("/api/nas/mkdir")
def api_nas_mkdir(
    request: Request,
    payload: dict[str, Any] = Body(default={}),
):
    _require_admin(request)
    path = payload.get("path") or "/"
    name = _validate_nas_new_folder_name(payload.get("name") or "")
    info, rel_path, full_path = _resolve_nas_path(path)
    if not os.path.isdir(full_path):
        raise HTTPException(status_code=400, detail="새 폴더를 만들 위치는 폴더여야 합니다.")

    target = os.path.realpath(os.path.join(full_path, name))
    root = os.path.realpath(str(info.get("root") or full_path))
    if os.path.commonpath([root, target]) != root:
        raise HTTPException(status_code=400, detail="NAS 루트 밖에는 폴더를 만들 수 없습니다.")
    if os.path.exists(target):
        raise HTTPException(status_code=409, detail="같은 이름의 파일 또는 폴더가 이미 존재합니다.")

    try:
        os.mkdir(target)
    except FileExistsError:
        raise HTTPException(status_code=409, detail="같은 이름의 파일 또는 폴더가 이미 존재합니다.")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"폴더 생성에 실패했습니다: {exc}")

    created_path = rel_path.rstrip("/") + "/" + name if rel_path != "/" else "/" + name
    _set_nas_uploader_state(root, [created_path], _current_nas_uploader_entry(request))
    return JSONResponse(
        {
            "ok": True,
            "name": name,
            "path": created_path,
            "parent_path": rel_path,
        }
    )


@router.post("/api/nas/move")
def api_nas_move(
    request: Request,
    payload: dict[str, Any] = Body(default={}),
):
    _require_admin(request)
    destination = payload.get("destination") or payload.get("target_path") or "/"
    raw_paths = payload.get("paths")
    paths: list[str] = []

    if isinstance(raw_paths, list):
        seen: set[str] = set()
        for value in raw_paths:
            normalized = str(value or "").strip()
            if (not normalized) or (normalized in seen):
                continue
            seen.add(normalized)
            paths.append(normalized)

    if not paths:
        single_path = str(payload.get("path") or "").strip()
        if single_path:
            paths = [single_path]

    if not paths:
        raise HTTPException(status_code=400, detail="이동할 항목이 없습니다.")

    normalized_paths: list[str] = []
    seen_paths: set[str] = set()
    for path in paths:
        _info, rel_path, full_path = _resolve_nas_path(path)
        if rel_path == "/" or (not os.path.exists(full_path)):
            continue
        if rel_path in seen_paths:
            continue
        seen_paths.add(rel_path)
        normalized_paths.append(rel_path)

    collapsed_paths = _collapse_nas_rel_paths(normalized_paths)
    if not collapsed_paths:
        raise HTTPException(status_code=400, detail="이동할 수 있는 항목이 없습니다.")

    prepared_moves = [_prepare_nas_move_item(path, destination) for path in collapsed_paths]
    target_paths: set[str] = set()
    for move_item in prepared_moves:
        target_path = os.path.realpath(str(move_item.get("target_path") or ""))
        if not target_path:
            raise HTTPException(status_code=400, detail="이동 대상 경로를 확인하지 못했습니다.")
        if target_path in target_paths:
            raise HTTPException(status_code=409, detail="대상 폴더에 같은 이름의 파일 또는 폴더가 이미 존재합니다.")
        target_paths.add(target_path)

    completed_moves: list[dict[str, Any]] = []
    results: list[dict[str, Any]] = []
    try:
        for move_item in prepared_moves:
            results.append(_execute_nas_prepared_move(move_item))
            completed_moves.append(move_item)
    except HTTPException as exc:
        rollback_failed = False
        for move_item in reversed(completed_moves):
            try:
                _rollback_nas_prepared_move(move_item)
            except Exception:
                rollback_failed = True
        if rollback_failed:
            raise HTTPException(status_code=500, detail="항목 이동 중 문제가 발생했고 일부 항목을 원래 위치로 되돌리지 못했습니다.") from exc
        raise

    if len(results) == 1:
        return JSONResponse({"ok": True, "moved_count": 1, **results[0]})
    return JSONResponse({"ok": True, "moved_count": len(results), "items": results})


@router.post("/api/nas/delete")
def api_nas_delete(
    request: Request,
    payload: dict[str, Any] = Body(default={}),
):
    _require_admin(request)
    raw_paths = payload.get("paths")
    paths: list[str] = []

    if isinstance(raw_paths, list):
        seen: set[str] = set()
        for value in raw_paths:
            normalized = str(value or "").strip()
            if (not normalized) or (normalized in seen):
                continue
            seen.add(normalized)
            paths.append(normalized)

    if not paths:
        single_path = str(payload.get("path") or "").strip() or "/"
        paths = [single_path]

    if not paths:
        raise HTTPException(status_code=400, detail="휴지통으로 이동할 항목이 없습니다.")

    results = [_move_nas_item_to_recycle(path) for path in _collapse_nas_rel_paths(paths)]
    if len(results) == 1:
        return JSONResponse({"ok": True, "moved_count": 1, **results[0]})
    return JSONResponse({"ok": True, "moved_count": len(results), "items": results})


@router.post("/api/nas/pin")
def api_nas_pin(
    request: Request,
    payload: dict[str, Any] = Body(default={}),
):
    _require_admin(request)
    raw_paths = payload.get("paths")
    pinned = bool(payload.get("pinned", True))
    paths: list[str] = []

    if isinstance(raw_paths, list):
        seen: set[str] = set()
        for value in raw_paths:
            normalized = str(value or "").strip()
            if (not normalized) or (normalized in seen):
                continue
            seen.add(normalized)
            paths.append(normalized)

    if not paths:
        single_path = str(payload.get("path") or "").strip()
        if single_path:
            paths = [single_path]

    if not paths:
        raise HTTPException(status_code=400, detail="상단 고정할 항목이 없습니다.")

    info = _get_nas_mount_info()
    if not info:
        raise HTTPException(status_code=503, detail=_nas_unavailable_detail())
    root = os.path.realpath(str(info.get("root") or ""))

    normalized_paths: list[str] = []
    seen_paths: set[str] = set()
    for path in paths:
        _info, rel_path, full_path = _resolve_nas_path(path)
        if rel_path == "/":
            continue
        if not os.path.exists(full_path):
            continue
        if rel_path in seen_paths:
            continue
        seen_paths.add(rel_path)
        normalized_paths.append(rel_path)

    if not normalized_paths:
        raise HTTPException(status_code=400, detail="상단 고정할 수 있는 항목이 없습니다.")

    _pins, changed_paths = _set_nas_pin_state(root, normalized_paths, pinned=pinned)
    action_label = "pinned" if pinned else "unpinned"
    return JSONResponse(
        {
            "ok": True,
            "action": action_label,
            "pinned": pinned,
            "count": len(changed_paths),
            "paths": changed_paths,
        }
    )


@router.post("/api/nas/mark")
def api_nas_mark(
    request: Request,
    payload: dict[str, Any] = Body(default={}),
):
    _require_admin(request)
    raw_paths = payload.get("paths")
    raw_color = payload.get("color")
    color = _normalize_nas_mark_color(raw_color)
    clear_mark = bool(payload.get("clear")) or (raw_color is None) or (str(raw_color or "").strip() == "")
    if (not clear_mark) and (not color):
        raise HTTPException(status_code=400, detail="지원하지 않는 마킹 색상입니다.")

    paths: list[str] = []
    if isinstance(raw_paths, list):
        seen: set[str] = set()
        for value in raw_paths:
            normalized = str(value or "").strip()
            if (not normalized) or (normalized in seen):
                continue
            seen.add(normalized)
            paths.append(normalized)

    if not paths:
        single_path = str(payload.get("path") or "").strip()
        if single_path:
            paths = [single_path]

    if not paths:
        raise HTTPException(status_code=400, detail="마킹할 항목이 없습니다.")

    info = _get_nas_mount_info()
    if not info:
        raise HTTPException(status_code=503, detail=_nas_unavailable_detail())
    root = os.path.realpath(str(info.get("root") or ""))

    normalized_paths: list[str] = []
    seen_paths: set[str] = set()
    for path in paths:
        _info, rel_path, full_path = _resolve_nas_path(path)
        if rel_path == "/" or (not os.path.exists(full_path)):
            continue
        if rel_path in seen_paths:
            continue
        seen_paths.add(rel_path)
        normalized_paths.append(rel_path)

    if not normalized_paths:
        raise HTTPException(status_code=400, detail="마킹할 수 있는 항목이 없습니다.")

    _marks, changed_paths = _set_nas_mark_state(root, normalized_paths, None if clear_mark else color)
    action_label = "unmarked" if clear_mark else "marked"
    return JSONResponse(
        {
            "ok": True,
            "action": action_label,
            "color": "" if clear_mark else color,
            "count": len(changed_paths),
            "paths": changed_paths,
        }
    )


@router.post("/api/nas/rename")
def api_nas_rename(
    request: Request,
    payload: dict[str, Any] = Body(default={}),
):
    _require_admin(request)
    path = payload.get("path") or "/"
    new_name = _validate_nas_rename_name(payload.get("name") or "")
    info, rel_path, full_path = _resolve_nas_path(path)
    if rel_path == "/":
        raise HTTPException(status_code=400, detail="루트 폴더 이름은 변경할 수 없습니다.")

    root = os.path.realpath(str(info.get("root") or full_path))
    item_type = "directory" if os.path.isdir(full_path) else "file"
    original_name = os.path.basename(full_path.rstrip(os.sep)) or os.path.basename(full_path)
    if new_name == original_name:
        return JSONResponse(
            {
                "ok": True,
                "old_name": original_name,
                "name": new_name,
                "old_path": rel_path,
                "path": rel_path,
                "type": item_type,
            }
        )

    parent_dir = os.path.dirname(full_path)
    target_path = os.path.realpath(os.path.join(parent_dir, new_name))
    if os.path.commonpath([root, target_path]) != root:
        raise HTTPException(status_code=400, detail="NAS 루트 밖으로 이름을 변경할 수 없습니다.")
    if os.path.exists(target_path):
        raise HTTPException(status_code=409, detail="같은 이름의 파일 또는 폴더가 이미 존재합니다.")

    try:
        os.rename(full_path, target_path)
    except FileExistsError:
        raise HTTPException(status_code=409, detail="같은 이름의 파일 또는 폴더가 이미 존재합니다.")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"이름 변경에 실패했습니다: {exc}")

    next_rel_path = _relative_nas_path(root, target_path)
    _rename_nas_pin_state(root, rel_path, next_rel_path)
    _rename_nas_mark_state(root, rel_path, next_rel_path)
    _rename_nas_uploader_state(root, rel_path, next_rel_path)
    return JSONResponse(
        {
            "ok": True,
            "old_name": original_name,
            "name": new_name,
            "old_path": rel_path,
            "path": next_rel_path,
            "type": item_type,
        }
    )


@router.get("/api/nas/trash")
def api_nas_trash(request: Request):
    _require_admin(request)
    return JSONResponse(_list_nas_recycle_items())


@router.post("/api/nas/trash/restore")
def api_nas_trash_restore(
    request: Request,
    payload: dict[str, Any] = Body(default={}),
):
    _require_admin(request)
    info, _recycle_dir, recycle_path, meta_path, meta = _resolve_nas_recycle_item(payload.get("item_id"))
    root = os.path.realpath(str(info.get("root") or ""))
    original_path = _normalize_nas_rel_path(meta.get("original_path") or "/")
    if original_path == "/" or _is_nas_recycle_rel_path(original_path):
        raise HTTPException(status_code=400, detail="복원할 원래 경로가 올바르지 않습니다.")

    target_path = os.path.realpath(os.path.join(root, original_path.lstrip("/")))
    if os.path.commonpath([root, target_path]) != root:
        raise HTTPException(status_code=400, detail="복원 대상 경로가 NAS 루트 밖입니다.")

    parent_dir = os.path.dirname(target_path)
    os.makedirs(parent_dir, exist_ok=True)
    final_target = _unique_restore_target(target_path)
    recycle_rel_path = _relative_nas_path(root, recycle_path)

    try:
        shutil.move(recycle_path, final_target)
        if os.path.exists(meta_path):
            os.remove(meta_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"휴지통 복원에 실패했습니다: {exc}")

    restored_rel_path = _relative_nas_path(root, final_target)
    _rename_nas_uploader_state(root, recycle_rel_path, restored_rel_path)
    return JSONResponse({"ok": True, "path": restored_rel_path})


@router.post("/api/nas/trash/purge")
def api_nas_trash_purge(
    request: Request,
    payload: dict[str, Any] = Body(default={}),
):
    _require_admin(request)
    info, _recycle_dir, recycle_path, meta_path, _meta = _resolve_nas_recycle_item(payload.get("item_id"))
    root = os.path.realpath(str(info.get("root") or ""))
    recycle_rel_path = _relative_nas_path(root, recycle_path)

    try:
        if os.path.isdir(recycle_path):
            shutil.rmtree(recycle_path)
        else:
            os.remove(recycle_path)
        if os.path.exists(meta_path):
            os.remove(meta_path)
        _remove_nas_uploader_state(root, recycle_rel_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"휴지통 항목 삭제에 실패했습니다: {exc}")

    return JSONResponse({"ok": True})


@router.post("/api/nas/trash/empty")
def api_nas_trash_empty(request: Request):
    _require_admin(request)
    removed_count = 0
    recycle_items = _list_nas_recycle_items().get("items") or []
    for item in recycle_items:
        try:
            info, _recycle_dir, recycle_path, meta_path, _meta = _resolve_nas_recycle_item(item.get("item_id"))
            root = os.path.realpath(str(info.get("root") or ""))
            recycle_rel_path = _relative_nas_path(root, recycle_path)
            if os.path.isdir(recycle_path):
                shutil.rmtree(recycle_path)
            else:
                os.remove(recycle_path)
            if os.path.exists(meta_path):
                os.remove(meta_path)
            _remove_nas_uploader_state(root, recycle_rel_path)
            removed_count += 1
        except Exception:
            continue

    return JSONResponse({"ok": True, "removed_count": removed_count})


@router.get("/profile-settings", name="profile_settings")
def profile_settings_page(request: Request, saved: int = 0):
    if not (getattr(request.state, "user_id", "") or ""):
        return RedirectResponse(url="/login", status_code=303)
    return templates.TemplateResponse(
        "profile_settings.html",
        _profile_settings_context(request, saved=bool(saved)),
    )


@router.post("/profile-settings", name="profile_settings_save")
async def profile_settings_save(
    request: Request,
    name: str = Form(""),
    nickname: str = Form(""),
    email: str = Form(""),
    birth: str = Form(""),
    phone: str = Form(""),
    department: str = Form(""),
    location: str = Form(""),
    bio: str = Form(""),
    new_password: str = Form(""),
    confirm_password: str = Form(""),
    remove_profile_image: str = Form("0"),
    profile_image: UploadFile | None = File(default=None),
):
    user_id = getattr(request.state, "user_id", "") or ""
    if not user_id:
        return RedirectResponse(url="/login", status_code=303)

    current_row = _request_user_row(request)
    current_form = _build_profile_form(user_id, current_row)
    remove_image = str(remove_profile_image or "").strip().lower() in {"1", "true", "yes", "on"}

    form_data = {
        "user_id": user_id,
        "role": current_form.get("role") or "user",
        "role_label": current_form.get("role_label") or "USER",
        "join_date": current_form.get("join_date") or "",
        "name": str(name or "").strip(),
        "nickname": str(nickname or "").strip(),
        "email": str(email or "").strip(),
        "birth": str(birth or "").strip(),
        "phone": str(phone or "").strip(),
        "department": str(department or "").strip(),
        "location": str(location or "").strip(),
        "bio": str(bio or "").strip(),
        "new_password": "",
        "confirm_password": "",
        "profile_image_url": "" if remove_image else (current_form.get("profile_image_url") or ""),
        "remove_profile_image": "1" if remove_image else "0",
    }
    new_password_value = str(new_password or "")
    confirm_password_value = str(confirm_password or "")

    errors: list[str] = []
    if not form_data["name"]:
        errors.append("이름을 입력해주세요.")
    if not form_data["nickname"]:
        errors.append("닉네임을 입력해주세요.")
    if not form_data["email"] or "@" not in form_data["email"] or "." not in form_data["email"]:
        errors.append("이메일 형식이 올바르지 않습니다.")
    if form_data["birth"]:
        try:
            datetime.strptime(form_data["birth"], "%Y-%m-%d")
        except Exception:
            errors.append("생년월일은 YYYY-MM-DD 형식으로 입력해주세요.")

    if len(form_data["phone"]) > 32:
        errors.append("연락처는 32자 이하로 입력해주세요.")
    if len(form_data["department"]) > 64:
        errors.append("소속/부서는 64자 이하로 입력해주세요.")
    if len(form_data["location"]) > 64:
        errors.append("위치는 64자 이하로 입력해주세요.")
    if len(form_data["bio"]) > 500:
        errors.append("소개는 500자 이하로 입력해주세요.")
    if new_password_value or confirm_password_value:
        if len(new_password_value) < 6:
            errors.append("새 비밀번호는 6자 이상이어야 합니다.")
        if new_password_value != confirm_password_value:
            errors.append("비밀번호 재확인이 일치하지 않습니다.")

    old_image_url = current_form.get("profile_image_url") or ""
    uploaded_image_url = ""
    try:
        if profile_image and str(profile_image.filename or "").strip():
            uploaded_image_url = await _store_profile_image(user_id, profile_image)
            form_data["profile_image_url"] = uploaded_image_url
    except ValueError as exc:
        errors.append(str(exc))
    finally:
        if profile_image is not None:
            try:
                await profile_image.close()
            except Exception:
                pass

    if errors:
        if uploaded_image_url:
            _delete_managed_profile_image(uploaded_image_url)
        form_data["profile_image_url"] = old_image_url if not remove_image else ""
        return templates.TemplateResponse(
            "profile_settings.html",
            _profile_settings_context(request, form_data=form_data, errors=errors),
            status_code=400,
        )

    final_image_url = uploaded_image_url or ("" if remove_image else old_image_url)

    try:
        user_repo.update_user_profile_row(
            user_id=user_id,
            email=form_data["email"],
            birth=form_data["birth"],
            name=form_data["name"],
            nickname=form_data["nickname"],
            phone=form_data["phone"],
            department=form_data["department"],
            location=form_data["location"],
            bio=form_data["bio"],
            profile_image_path=final_image_url,
        )
        nas_repo.update_uploader_user_profile(
            user_id,
            nickname=form_data["nickname"],
            name=form_data["name"],
        )
        if new_password_value:
            user_repo.update_user_password_hash(
                user_id=user_id,
                pw_hash=hash_password_for_storage(new_password_value),
            )
    except Exception:
        if uploaded_image_url:
            _delete_managed_profile_image(uploaded_image_url)
        return templates.TemplateResponse(
            "profile_settings.html",
            _profile_settings_context(
                request,
                form_data={**form_data, "profile_image_url": old_image_url if not remove_image else ""},
                errors=["프로필 정보를 저장하지 못했습니다. 잠시 후 다시 시도해주세요."],
            ),
            status_code=500,
        )

    if old_image_url and old_image_url != final_image_url:
        _delete_managed_profile_image(old_image_url)

    _clear_nas_user_profile_cache(user_id)

    try:
        request.state.user_row = read_user(user_id) or {}
    except Exception:
        pass

    return RedirectResponse(url="/profile-settings?saved=1", status_code=303)


@router.post("/profile-settings/delete", name="profile_settings_delete")
def profile_settings_delete(request: Request):
    user_id = getattr(request.state, "user_id", "") or ""
    if not user_id:
        return RedirectResponse(url="/login", status_code=303)

    current_row = _request_user_row(request)
    current_form = _build_profile_form(user_id, current_row)
    profile_image_url = current_form.get("profile_image_url") or ""
    nickname = current_form.get("nickname") or current_form.get("name") or ""

    try:
        nas_repo.anonymize_uploader_user(user_id, fallback_nickname=nickname)
        user_repo.delete_user_row(user_id=user_id)
    except Exception:
        return templates.TemplateResponse(
            "profile_settings.html",
            _profile_settings_context(request, errors=["회원탈퇴를 처리하지 못했습니다. 잠시 후 다시 시도해주세요."]),
            status_code=500,
        )

    _delete_managed_profile_image(profile_image_url)
    _clear_nas_user_profile_cache(user_id)

    try:
        request.state.user_row = {}
    except Exception:
        pass
    try:
        request.state.user_id = ""
    except Exception:
        pass

    sid = request.cookies.get(SESSION_COOKIE_NAME, "") or ""
    if sid:
        try:
            delete_session(sid)
        except Exception:
            pass

    response = RedirectResponse(url="/login", status_code=303)
    clear_session_cookie(response)
    return response

async def _reject_websocket_with_code(websocket: WebSocket, code: int) -> None:
    try:
        await websocket.accept()
    except Exception:
        pass
    try:
        await websocket.close(code=code)
    except Exception:
        pass


from router.integrated_admin_api import register_integrated_admin_routes

register_integrated_admin_routes(router)
from router.messenger_ws import register_messenger_ws_routes

register_messenger_ws_routes(router)


from router.messenger_api import register_messenger_api_routes

register_messenger_api_routes(router)


# ==============================================================
# API: ESP32 자동 등록 + 텔레메트리 + UI 헬퍼
# ==============================================================
# - ESP32: /api/device/register, /api/device/telemetry 로 POST
# - 웹 UI:  /api/devices/saved, /api/devices/discovered, /api/device/tail 등 활용


@router.get("/api/device/ping")
def api_device_ping():
    # ESP32 connectivity probe (auth middleware already allows /api/device/*)
    return {"ok": True, "polling": _device_polling_policy()}


@router.get("/api/device/registered")
def api_device_registered(request: Request, device_id: str = ""):
    did = _norm_device_id(device_id)
    if not did:
        raise HTTPException(status_code=400, detail="device_id required")

    token = _extract_auth_token(request, {})
    rec = device_repo.get_device_by_device_id(did)
    if not _request_user_id(request):
        if not token:
            raise HTTPException(status_code=401, detail="device token required")
        if rec:
            _device_record_or_403(did, token)

    rec = device_repo.get_device_by_device_id(did)
    payload = {"ok": True, "registered": bool(rec), "device_id": did}
    payload.update(_device_api_meta(did, str((rec or {}).get("ip") or ""), str((rec or {}).get("customer") or "-")))
    return payload


@router.get("/api/device/ota/check")
def api_device_ota_check(request: Request, device_id: str = ""):
    did = _norm_device_id(device_id)
    token = _extract_auth_token(request, {})
    if not did:
        raise HTTPException(status_code=400, detail="device_id required")
    rec = _device_record_or_403(did, token)
    if not rec:
        raise HTTPException(status_code=404, detail="device not found")

    firmware_repo.record_device_check(device_id=did)
    info = firmware_repo.get_target_release_for_device(device_id=did) or {}

    current_family = str(info.get("current_family") or "").strip()
    current_version = str(info.get("current_version") or "").strip()
    current_build_id = str(info.get("current_build_id") or "").strip()
    current_fw_text = str(info.get("current_fw_text") or "").strip()
    target_release_id = int(info.get("target_release_id") or 0)
    target_family = str(info.get("target_family") or "").strip()
    target_version = str(info.get("target_version") or "").strip()
    target_build_id = str(info.get("target_build_id") or "").strip()
    file_path = str(info.get("file_path") or "").strip()
    enabled = bool(info.get("is_enabled"))
    file_ready = bool(file_path and os.path.exists(file_path))

    same_release = (
        bool(current_family and target_family and current_version and target_version)
        and current_family == target_family
        and current_version == target_version
        and ((not target_build_id) or (current_build_id == target_build_id))
    )
    update_available = bool(target_release_id > 0 and enabled and file_ready and not same_release)

    if same_release and target_release_id > 0:
        firmware_repo.report_device_ota(
            device_id=did,
            state="up_to_date",
            message="current firmware already matches assigned release",
            release_id=target_release_id,
            current_family=current_family,
            current_version=current_version,
            current_build_id=current_build_id,
            current_fw_text=current_fw_text,
        )

    payload = {
        "ok": True,
        "device_id": did,
        "update_available": update_available,
        "current": {
            "family": current_family,
            "version": current_version,
            "build_id": current_build_id,
            "fw": current_fw_text,
        },
        "polling": _device_polling_policy(),
    }

    if update_available:
        payload["release"] = {
            "release_id": target_release_id,
            "release_family": target_family,
            "release_version": target_version,
            "release_build_id": target_build_id,
            "release_sha256": str(info.get("sha256") or "").strip().lower(),
            "release_size_bytes": int(info.get("size_bytes") or 0),
            "release_force_update": bool(info.get("force_update")),
            "release_download_path": _release_download_path(target_release_id),
        }

    return payload


@router.get("/api/device/ota/download/{release_id}")
def api_device_ota_download(request: Request, release_id: int, device_id: str = ""):
    did = _norm_device_id(device_id)
    token = _extract_auth_token(request, {})
    if not did:
        raise HTTPException(status_code=400, detail="device_id required")
    rec = _device_record_or_403(did, token)
    if not rec:
        raise HTTPException(status_code=404, detail="device not found")

    info = firmware_repo.get_target_release_for_device(device_id=did) or {}
    target_release_id = int(info.get("target_release_id") or 0)
    file_path = str(info.get("file_path") or "").strip()
    filename = str(info.get("filename") or "").strip() or "firmware.bin"

    if int(release_id or 0) <= 0 or target_release_id != int(release_id):
        raise HTTPException(status_code=404, detail="release not assigned")
    if not bool(info.get("is_enabled")):
        raise HTTPException(status_code=409, detail="release disabled")
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="firmware file not found")

    return FileResponse(file_path, media_type="application/octet-stream", filename=filename)


@router.post("/api/device/ota/report")
def api_device_ota_report(request: Request, payload: dict[str, Any] = Body(...)):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid payload")

    token, device_id, rec = _require_device_identity(request, payload, require_registered=True)
    _ = token
    customer = _auth_customer(request, payload) or str((rec or {}).get("customer") or "-")
    public_ip = _request_client_ip(request)
    ip = str(payload.get("ip") or "").strip() or public_ip or str((rec or {}).get("ip") or "")
    state = str(payload.get("state") or "").strip().lower()
    if not state:
        raise HTTPException(status_code=400, detail="state required")
    message = str(payload.get("message") or payload.get("result_message") or "").strip()
    try:
        release_id = int(payload.get("release_id") or 0)
    except Exception:
        release_id = 0

    family, version, build_id, fw_display = _extract_firmware_fields(payload)
    if not fw_display or fw_display == "-":
        fw_display = _format_firmware_identity(family, version, build_id)

    firmware_repo.report_device_ota(
        device_id=device_id,
        customer=customer,
        device_name=str((rec or {}).get("name") or device_id),
        ip=ip,
        state=state,
        message=message,
        release_id=release_id,
        current_family=family,
        current_version=version,
        current_build_id=build_id,
        current_fw_text=fw_display,
    )
    return {"ok": True, "device_id": device_id, "state": state}


@router.post("/api/device/register")
def api_device_register(request: Request, payload: dict[str, Any] = Body(...)):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid payload")

    token, device_id, _ = _require_device_identity(request, payload)
    customer = _auth_customer(request, payload)
    public_ip = _request_client_ip(request)
    ip = str(payload.get("ip") or "").strip() or public_ip
    fw_family, fw_version, fw_build_id, fw = _extract_firmware_fields(payload)
    name = str(payload.get("name") or payload.get("model") or device_id).strip() or device_id
    now = datetime.now()

    key = _device_key(customer, device_id, ip)

    st = _DEVICE_STATE.get(key) or {}
    prev_last_seen = st.get("last_seen")
    sd_inserted, sd_total_mb, sd_used_mb, sd_free_mb = _merge_sd_payload(payload, st)
    used_energy_j = _payload_int(payload.get("used_energy_j"), _payload_int(payload.get("usedEnergyJ"), _payload_int(st.get("used_energy_j"), 0)))
    st["customer"] = customer
    st["token"] = token
    st["device_id"] = device_id
    st["ip"] = ip
    st["last_public_ip"] = public_ip
    st["fw"] = fw or st.get("fw") or "-"
    st["last_seen"] = now
    st.setdefault("power", "-")
    st.setdefault("time_sec", "-")
    st.setdefault("line", "")
    if str(st.get("line") or "").strip():
        st.setdefault("parse_ok", True)
    else:
        st["parse_ok"] = True
    st["sd_inserted"] = sd_inserted
    st["sd_total_mb"] = sd_total_mb
    st["sd_used_mb"] = sd_used_mb
    st["sd_free_mb"] = sd_free_mb
    st["used_energy_j"] = used_energy_j
    _DEVICE_STATE[key] = st

    if device_id:
        _DEVICEID_TO_KEY[device_id] = key

    if token:
        _TOKEN_TO_KEY[token] = key

    if ip:
        _IP_CUSTOMER_TO_KEY[(customer, ip)] = key

    # 연결 상태 로그(의미있는 상태 중심, 최소 추가)
    try:
        was_offline = (prev_last_seen is None) or ((now - prev_last_seen).total_seconds() > (ONLINE_WINDOW_SEC * 2))
    except Exception:
        was_offline = True
    if was_offline:
        msg = f"연결완료 IP={ip}" if not prev_last_seen else f"재연결 IP={ip}"
        _append_device_runtime_log(
            key,
            device_id=device_id,
            customer=customer,
            ip=ip,
            when=now,
            line=msg,
            source="register",
        )

    try:
        device_repo.register_device(
            name=name,
            ip=ip,
            customer=customer,
            token=token,
            device_id=device_id,
            public_ip=public_ip,
            fw=fw,
            sd_inserted=sd_inserted,
            sd_total_mb=sd_total_mb,
            sd_used_mb=sd_used_mb,
            sd_free_mb=sd_free_mb,
            used_energy_j=used_energy_j,
        )
    except ValueError as e:
        detail = str(e)
        status_code = 403 if ("invalid device token" in detail or "device not provisioned" in detail) else 400
        raise HTTPException(status_code=status_code, detail=detail) from e
    try:
        firmware_repo.touch_device_state(
            device_id=device_id,
            customer=customer,
            device_name=name,
            ip=ip,
            current_family=fw_family,
            current_version=fw_version,
            current_build_id=fw_build_id,
            current_fw_text=fw,
        )
    except Exception:
        pass

    body = {"ok": True, "customer": customer, "registered": True, "device_id": device_id}
    body.update(_device_api_meta(device_id, ip, customer))
    body["subscription"] = _subscription_response_or_default(device_id)
    return JSONResponse(body)


@router.post("/api/device/heartbeat")
def api_device_heartbeat(request: Request, payload: dict[str, Any] = Body(...)):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid payload")

    token, device_id, _ = _require_device_identity(request, payload)
    customer = _auth_customer(request, payload)
    public_ip = _request_client_ip(request)
    ip = str(payload.get("ip") or "").strip() or public_ip
    fw_family, fw_version, fw_build_id, fw = _extract_firmware_fields(payload)
    name = str(payload.get("name") or payload.get("model") or device_id).strip() or device_id
    now = datetime.now()

    key = _device_key(customer, device_id, ip)
    st = _DEVICE_STATE.get(key) or {}
    sd_inserted, sd_total_mb, sd_used_mb, sd_free_mb = _merge_sd_payload(payload, st)
    used_energy_j = _payload_int(payload.get("used_energy_j"), _payload_int(payload.get("usedEnergyJ"), _payload_int(st.get("used_energy_j"), 0)))
    st["customer"] = customer
    st["token"] = token
    st["device_id"] = device_id
    st["ip"] = ip
    st["last_public_ip"] = public_ip
    st["fw"] = fw or st.get("fw") or "-"
    st["last_seen"] = now
    st.setdefault("power", "-")
    st.setdefault("time_sec", "-")
    st.setdefault("line", "")
    if str(st.get("line") or "").strip():
        st.setdefault("parse_ok", True)
    else:
        st["parse_ok"] = True
    st["sd_inserted"] = sd_inserted
    st["sd_total_mb"] = sd_total_mb
    st["sd_used_mb"] = sd_used_mb
    st["sd_free_mb"] = sd_free_mb
    st["used_energy_j"] = used_energy_j
    _DEVICE_STATE[key] = st

    if device_id:
        _DEVICEID_TO_KEY[device_id] = key
    if token:
        _TOKEN_TO_KEY[token] = key
    if ip:
        _IP_CUSTOMER_TO_KEY[(customer, ip)] = key

    try:
        device_repo.record_device_heartbeat(
            name=name,
            ip=ip,
            customer=customer,
            token=token,
            device_id=device_id,
            public_ip=public_ip,
            fw=fw,
            sd_inserted=sd_inserted,
            sd_total_mb=sd_total_mb,
            sd_used_mb=sd_used_mb,
            sd_free_mb=sd_free_mb,
            used_energy_j=used_energy_j,
        )
    except ValueError as e:
        detail = str(e)
        status_code = 403 if ("invalid device token" in detail or "device not provisioned" in detail) else 400
        raise HTTPException(status_code=status_code, detail=detail) from e
    try:
        firmware_repo.touch_device_state(
            device_id=device_id,
            customer=customer,
            device_name=name,
            ip=ip,
            current_family=fw_family,
            current_version=fw_version,
            current_build_id=fw_build_id,
            current_fw_text=fw,
        )
    except Exception:
        pass

    body = {"ok": True, "device_id": device_id}
    body.update(_device_api_meta(device_id, ip, customer))
    return JSONResponse(body)


@router.post("/api/device/telemetry")
def api_device_telemetry(request: Request, payload: dict[str, Any] = Body(...)):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid payload")

    token, device_id, _ = _require_device_identity(request, payload)
    customer = _auth_customer(request, payload)
    public_ip = _request_client_ip(request)
    ip = str(payload.get("ip") or "").strip() or public_ip
    fw_family, fw_version, fw_build_id, fw = _extract_firmware_fields(payload)
    name = str(payload.get("name") or payload.get("model") or device_id).strip() or device_id

    line = payload.get("line")
    if line is None:
        line = ""
    line = str(line)

    power = str(payload.get("power") or "-")
    time_sec = str(payload.get("time_sec") or "-")
    idle_measurement = _is_idle_measurement(line=line, power=power, time_sec=time_sec)
    if idle_measurement:
        power = "-"
        time_sec = "-"
        line = ""

    now = datetime.now()

    # 최소 포맷 검사: line에 콤마가 없으면 Error로 판정(Online window 안에서)
    parse_ok = True if idle_measurement else (bool(line) and ("," in line))

    key = _device_key(customer, device_id, ip)

    st = _DEVICE_STATE.get(key) or {}
    prev_last_seen = st.get("last_seen")
    sd_inserted, sd_total_mb, sd_used_mb, sd_free_mb = _merge_sd_payload(payload, st)
    used_energy_j = _payload_int(payload.get("used_energy_j"), _payload_int(payload.get("usedEnergyJ"), _payload_int(st.get("used_energy_j"), 0)))
    st["customer"] = customer
    st["token"] = token
    st["device_id"] = device_id
    st["ip"] = ip
    st["last_public_ip"] = public_ip
    st["fw"] = fw or st.get("fw") or "-"
    st["last_seen"] = now
    st["parse_ok"] = parse_ok
    st["power"] = power or "-"
    st["time_sec"] = time_sec or "-"
    st["line"] = line
    st["sd_inserted"] = sd_inserted
    st["sd_total_mb"] = sd_total_mb
    st["sd_used_mb"] = sd_used_mb
    st["sd_free_mb"] = sd_free_mb
    st["used_energy_j"] = used_energy_j
    _DEVICE_STATE[key] = st

    if device_id:
        _DEVICEID_TO_KEY[device_id] = key

    if token:
        _TOKEN_TO_KEY[token] = key

    if ip:
        _IP_CUSTOMER_TO_KEY[(customer, ip)] = key

    if line:
        _append_device_runtime_log(
            key,
            device_id=device_id,
            customer=customer,
            ip=ip,
            when=now,
            line=line,
            source="telemetry",
        )

    try:
        device_repo.record_device_telemetry(
            name=name,
            ip=ip,
            customer=customer,
            token=token,
            device_id=device_id,
            public_ip=public_ip,
            fw=fw,
            parse_ok=parse_ok,
            power=power,
            time_sec=time_sec,
            line=line,
            sd_inserted=sd_inserted,
            sd_total_mb=sd_total_mb,
            sd_used_mb=sd_used_mb,
            sd_free_mb=sd_free_mb,
            used_energy_j=used_energy_j,
        )
    except ValueError as e:
        detail = str(e)
        status_code = 403 if ("invalid device token" in detail or "device not provisioned" in detail) else 400
        raise HTTPException(status_code=status_code, detail=detail) from e
    try:
        firmware_repo.touch_device_state(
            device_id=device_id,
            customer=customer,
            device_name=name,
            ip=ip,
            current_family=fw_family,
            current_version=fw_version,
            current_build_id=fw_build_id,
            current_fw_text=fw,
        )
    except Exception:
        pass

    body = {"ok": True, "device_id": device_id}
    body.update(_device_api_meta(device_id, ip, customer))
    return JSONResponse(body)


@router.post("/api/device/command-ack")
def api_device_command_ack(request: Request, payload: dict[str, Any] = Body(...)):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid payload")

    token, device_id, _ = _require_device_identity(request, payload)
    customer = _auth_customer(request, payload)
    ip = str(payload.get("ip") or "").strip()
    command = str(payload.get("command") or "").strip()
    command_id = _payload_int(payload.get("command_id"), 0)
    ok = _payload_bool(payload.get("ok"), True)
    result_message = str(payload.get("result_message") or "").strip()

    if not command:
        raise HTTPException(status_code=400, detail="command required")
    if command_id <= 0:
        raise HTTPException(status_code=400, detail="command_id required")

    pending = _pending_remote_command(device_id=device_id, ip=ip, customer=customer)
    if pending and int(pending.get("id") or 0) == command_id and str(pending.get("command") or "").strip() == command:
        _clear_remote_reset(
            device_id=device_id or str(pending.get("device_id") or ""),
            command_id=command_id,
            ok=ok,
            result_message=result_message,
        )
    else:
        _clear_remote_reset(device_id=device_id, command_id=command_id, ok=ok, result_message=result_message)

    if ok:
        runtime_key = _resolve_runtime_key(customer, ip, device_id, token)
        if command == REMOTE_RESET_COMMAND:
            _apply_runtime_reset_cache(runtime_key or "")
        elif command == REMOTE_SUBSCRIPTION_RESET_COMMAND:
            _apply_runtime_subscription_reset_cache(runtime_key or "")
            try:
                device_repo.reset_used_energy(device_id)
            except ValueError:
                pass

    runtime_key = _resolve_runtime_key(customer, ip, device_id, token) or _device_key(customer, device_id, ip)
    _append_device_runtime_log(
        runtime_key,
        device_id=device_id,
        customer=customer,
        ip=ip,
        when=datetime.now(),
        line=f"[CMD] {'ACK' if ok else 'FAIL'} #{command_id} {command}{(' - ' + result_message) if result_message else ''}",
        level="info" if ok else "warning",
        source="command",
    )

    return {"ok": True}


@router.post("/api/device/log-upload")
def api_device_log_upload(request: Request, payload: dict[str, Any] = Body(...)):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid payload")

    _token, device_id, _rec = _require_device_identity(request, payload)
    kind_key, _command, default_filename = _normalize_sd_log_kind(str(payload.get("kind") or "activity"))
    try:
        chunk_index = int(str(payload.get("chunk_index")))
        chunk_total = int(str(payload.get("chunk_total")))
        total_size = int(str(payload.get("total_size")))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"invalid upload counters: {exc}") from exc
    data_hex = str(payload.get("data_hex") or "").strip()

    if len(data_hex) % 2 != 0:
        raise HTTPException(status_code=400, detail="data_hex length must be even")
    try:
        chunk_bytes = bytes.fromhex(data_hex) if data_hex else b""
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"invalid data_hex: {exc}") from exc

    filename, done, stored_size = _store_uploaded_device_log_chunk(
        device_id=device_id,
        kind=kind_key,
        chunk_index=chunk_index,
        chunk_total=chunk_total,
        total_size=total_size,
        chunk_bytes=chunk_bytes,
    )
    return {
        "ok": True,
        "device_id": device_id,
        "kind": kind_key,
        "filename": filename or default_filename,
        "chunk_index": chunk_index,
        "chunk_total": chunk_total,
        "stored_size": stored_size,
        "done": done,
    }


@router.post("/api/devices/{device_id}/commands")
def api_device_queue_command(request: Request, device_id: str, payload: dict[str, Any] = Body(...)):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid payload")

    did = _norm_device_id(device_id)
    if not did:
        raise HTTPException(status_code=400, detail="device_id required")

    command = str(payload.get("command") or "").strip()
    if not command:
        raise HTTPException(status_code=400, detail="command required")
    if len(command) > 255:
        raise HTTPException(status_code=400, detail="command too long")

    rec = device_repo.get_device_by_device_id(did)
    if not rec:
        raise HTTPException(status_code=404, detail="device not found")

    requested_by = _request_user_id(request) or "admin"
    queued = device_ops_repo.queue_command(
        device_id=did,
        customer=str(rec.get("customer") or "-"),
        command=command,
        queued_by=requested_by,
        queued_via="web",
    )

    runtime_key = _resolve_runtime_key(str(rec.get("customer") or "-"), str(rec.get("ip") or ""), did, str(rec.get("token") or ""))
    _append_device_runtime_log(
        runtime_key or _device_key(str(rec.get("customer") or "-"), did, str(rec.get("ip") or "")),
        device_id=did,
        customer=str(rec.get("customer") or "-"),
        ip=str(rec.get("ip") or ""),
        when=datetime.now(),
        line=f"[CMD] queued #{int(queued.get('id') or 0)} {command} by {requested_by}",
        source="command",
    )

    return {"ok": True, "command_id": int(queued.get("id") or 0), "status": str(queued.get("status") or "queued")}



@router.websocket("/ws/device")
async def ws_device(websocket: WebSocket):
    """ESP32 <-> for_rnd_web WebSocket (통신 상태/Heartbeat/Telemetry).

    - ESP32가 연결되면 즉시 Online 반영 (제어 패널 탐색/LED용)
    - 주기적인 heartbeat 또는 telemetry 수신 시 last_seen 갱신

    Query params(권장):
      - device_id: MAC (aa:bb:cc:dd:ee:ff)
      - token: 디바이스 토큰(임의 문자열)
      - customer: 표시용(미설정 시 '-')
      - ip: (옵션)
    """
    await websocket.accept()

    qp = websocket.query_params
    device_id = _norm_device_id(str(qp.get("device_id") or ""))
    token = str(qp.get("token") or "").strip()
    customer = str(qp.get("customer") or "-").strip() or "-"
    ip = str(qp.get("ip") or "").strip()
    if not ip:
        try:
            ip = (websocket.client.host if websocket.client else "").strip()
        except Exception:
            ip = ""

    key = _device_key(customer, device_id, ip)

    def _touch_state(now: datetime, *, parse_ok: bool = True, line: str = "", power: str = "-", time_sec: str = "-"):
        st = _DEVICE_STATE.get(key) or {}
        st["customer"] = customer
        st["token"] = token
        st["device_id"] = device_id
        st["ip"] = ip
        st.setdefault("fw", "-")
        st["last_seen"] = now
        st["parse_ok"] = bool(parse_ok)
        st["ws_connected"] = True
        if line:
            st["line"] = line
        if power != "-":
            st["power"] = power
        if time_sec != "-":
            st["time_sec"] = time_sec
        st.setdefault("sd_inserted", False)
        st.setdefault("sd_total_mb", 0.0)
        st.setdefault("sd_used_mb", 0.0)
        st.setdefault("sd_free_mb", 0.0)
        st.setdefault("used_energy_j", 0)
        _DEVICE_STATE[key] = st
        if device_id:
            _DEVICEID_TO_KEY[device_id] = key
        if ip:
            _IP_CUSTOMER_TO_KEY[(customer, ip)] = key

    def _append_runtime_log(now: datetime, msg: str):
        _append_device_runtime_log(
            key,
            device_id=device_id,
            customer=customer,
            ip=ip,
            when=now,
            line=msg,
            source="ws",
        )

    now = datetime.now()
    _touch_state(now, parse_ok=True)
    _append_runtime_log(now, f"WS 연결됨 IP={ip}")

    try:
        while True:
            try:
                msg = await websocket.receive_text()
            except WebSocketDisconnect:
                break

            now = datetime.now()
            s = (msg or "").strip()

            # Heartbeat
            if s.upper() in ("PING", "HEARTBEAT"):
                _touch_state(now, parse_ok=True)
                try:
                    await websocket.send_text("PONG")
                except Exception:
                    pass
                continue

            # Best-effort JSON telemetry
            payload = None
            if s.startswith("{"):
                try:
                    import json as _json
                    obj = _json.loads(s)
                    if isinstance(obj, dict):
                        payload = obj
                except Exception:
                    payload = None

            line = ""
            power = "-"
            time_sec = "-"

            if isinstance(payload, dict):
                line = str(payload.get("line") or "")
                power = str(payload.get("power") or "-")
                time_sec = str(payload.get("time_sec") or "-")
            else:
                line = s

            parse_ok = bool(line) and ("," in line)
            _touch_state(now, parse_ok=parse_ok, line=line, power=power, time_sec=time_sec)

            if line:
                _append_runtime_log(now, line)

            # Ack (helps device mark comm OK)
            try:
                await websocket.send_text("OK")
            except Exception:
                pass

    finally:
        now = datetime.now()
        st = _DEVICE_STATE.get(key) or {}
        st["ws_connected"] = False
        _DEVICE_STATE[key] = st
        _append_runtime_log(now, "WS 연결 끊김")


@router.websocket("/ws/control-panel")
async def ws_control_panel(websocket: WebSocket):
    """웹 제어 패널용 WebSocket.

    상용 기본 경로는 direct TCP가 아니라 중앙 명령 큐입니다.

    메시지(JSON)
      - {type:"connect", ip, device_id?, token?, customer?}
      - {type:"disconnect"}
      - {type:"send", cmd}
    """

    # 인증(세션 쿠키)
    sid = ""
    try:
        sid = (websocket.cookies.get(SESSION_COOKIE_NAME, "") or "").strip()
    except Exception:
        sid = ""
    user_id = read_session_user(sid)
    if not user_id:
        # 4401: custom unauthorized
        try:
            await websocket.close(code=4401)
        except Exception:
            pass
        return

    await websocket.accept()

    connected_key = ""
    connected_device_id = ""
    connected_customer = "-"
    connected_ip = ""
    connected_token = ""

    async def send_status(state: str, message: str = ""):
        payload = {"type": "status", "state": state}
        if message:
            payload["message"] = message
        if connected_key:
            payload["key"] = connected_key
        try:
            await websocket.send_text(json.dumps(payload, ensure_ascii=False))
        except Exception:
            pass

    async def send_log(line: str):
        try:
            await websocket.send_text(json.dumps({"type": "log", "line": line}, ensure_ascii=False))
        except Exception:
            pass

    async def send_error(message: str):
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": message}, ensure_ascii=False))
        except Exception:
            pass

    await send_status("disconnected")

    try:
        while True:
            raw = await websocket.receive_text()
            if raw is None:
                continue

            try:
                msg = json.loads(raw)
            except Exception:
                msg = {"type": "raw", "line": str(raw)}

            mtype = str(msg.get("type") or "").strip().lower()

            if mtype == "connect":
                ip = str(msg.get("ip") or "").strip()
                device_id = _norm_device_id(str(msg.get("device_id") or "").strip())
                token = str(msg.get("token") or "").strip()
                customer = str(msg.get("customer") or "-").strip() or "-"
                if not ip:
                    await send_error("ip is required")
                    continue
                if not device_id:
                    await send_error("device_id is required")
                    continue

                rec = device_repo.get_device_by_device_id(device_id)
                if not rec:
                    await send_error("device not found")
                    continue

                connected_key = str(device_id or token or ip)
                connected_device_id = device_id
                connected_customer = customer
                connected_ip = ip
                connected_token = token
                await send_status("connecting", f"명령 큐 연결 준비: {device_id}")
                await send_log(f"[QUEUE] ready device_id={device_id} ip={ip}")
                await send_status("connected", "중앙 명령 큐 연결 완료")

            elif mtype == "disconnect":
                connected_key = ""
                connected_device_id = ""
                connected_customer = "-"
                connected_ip = ""
                connected_token = ""
                await send_status("disconnected")

            elif mtype == "send":
                cmd = str(msg.get("cmd") or "").strip()
                if not cmd:
                    continue
                if not connected_device_id:
                    await send_error("연결 필요: 먼저 디바이스를 연결해 주세요.")
                    continue
                try:
                    queued = device_ops_repo.queue_command(
                        device_id=connected_device_id,
                        customer=connected_customer,
                        command=cmd,
                        queued_by=user_id,
                        queued_via="websocket",
                    )
                    _append_device_runtime_log(
                        _resolve_runtime_key(connected_customer, connected_ip, connected_device_id, connected_token)
                        or _device_key(connected_customer, connected_device_id, connected_ip),
                        device_id=connected_device_id,
                        customer=connected_customer,
                        ip=connected_ip,
                        when=datetime.now(),
                        line=f"[CMD] queued #{int(queued.get('id') or 0)} {cmd} by {user_id}",
                        source="command",
                    )
                    await send_log(f"[QUEUE] #{int(queued.get('id') or 0)} {cmd}")
                except Exception as e:
                    await send_error(f"전송 실패: {e}")

            else:
                # ignore
                continue

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        return


@router.get("/api/devices/saved")
def api_devices_saved(customer: str = ""):
    saved = _load_saved_devices()
    customers = _customers_from_saved(saved)

    if customer:
        saved = [d for d in saved if (d.get("customer") == customer)]

    return {"ok": True, "devices": saved, "customers": customers}



@router.get("/api/devices/discovered")
def api_devices_discovered(customer: str = ""):
    """온라인 ESP32 디바이스 탐색(저장/미저장 모두).

    요구사항:
    - 제어 패널의 "찾기"에서 실제 온라인 디바이스가 반드시 조회되어야 함
    - 저장된 디바이스 리스트를 우선 표시하되, 미등록도 함께 노출

    탐색 순서:
    1) UDP discovery(ESP32: 4210)
    2) 런타임 캐시(ESP32가 /api/device/register|telemetry 또는 WS로 먼저 등록한 경우)
    """
    print(f"[DISCOVERY] /api/devices/discovered called customer={customer or '-'}")

    saved = _load_saved_devices()

    saved_by_did: dict[str, dict[str, str]] = {}
    saved_by_ip: dict[str, dict[str, str]] = {}
    for s in saved:
        did = _norm_device_id(str(s.get("device_id") or ""))
        ip = str(s.get("ip") or "").strip()
        if did:
            saved_by_did[did] = s
        if ip:
            saved_by_ip[ip] = s

    # 1) UDP discovery
    try:
        udp_devices = _udp_discover_devices()
    except Exception as e:
        print(f"[DISCOVERY] udp discovery exception: {e}")
        udp_devices = []

    # UDP 결과 기반으로 saved CSV 보정(기존 등록된 장비의 device_id/token 누락 방지)
    if udp_devices:
        ip_to_did: dict[str, str] = {}
        ip_to_tok: dict[str, str] = {}
        tok_to_did: dict[str, str] = {}
        for d in udp_devices:
            ip0 = str(d.get("ip") or "").strip()
            tok0 = str(d.get("token") or "").strip()
            did0 = _norm_device_id(str(d.get("device_id") or ""))
            if ip0:
                ip_to_did[ip0] = did0
                ip_to_tok[ip0] = tok0
            if tok0 and did0:
                tok_to_did[tok0] = did0

        changed = False
        for row in saved:
            ip0 = str(row.get("ip") or "").strip()
            if not ip0:
                continue

            if not _norm_device_id(str(row.get("device_id") or "")):
                did0 = ip_to_did.get(ip0) or ""
                if not did0:
                    tok_cur = str(row.get("token") or "").strip()
                    if tok_cur:
                        did0 = tok_to_did.get(tok_cur) or ""
                if did0:
                    row["device_id"] = did0
                    changed = True

            if not str(row.get("token") or "").strip():
                tok0 = ip_to_tok.get(ip0) or ""
                if tok0:
                    row["token"] = tok0
                    changed = True

        if changed:
            _rewrite_saved_devices(saved)
            saved = _load_saved_devices()
            saved_by_did.clear()
            saved_by_ip.clear()
            for s in saved:
                did = _norm_device_id(str(s.get("device_id") or ""))
                ip = str(s.get("ip") or "").strip()
                if did:
                    saved_by_did[did] = s
                if ip:
                    saved_by_ip[ip] = s

    # 2) Runtime cache
    now = datetime.now()
    _prune_runtime_cache(now)

    out: dict[str, dict[str, Any]] = {}

    def _merge_saved_fields(item: dict[str, Any]) -> dict[str, Any]:
        did = _norm_device_id(str(item.get("device_id") or ""))
        ip = str(item.get("ip") or "").strip()
        s = saved_by_did.get(did) if did else None
        if not s and ip:
            s = saved_by_ip.get(ip)

        if s:
            item["saved"] = True
            item["name"] = str(s.get("name") or item.get("name") or "")
            item["customer"] = str(s.get("customer") or item.get("customer") or "-")
            item["token"] = str(s.get("token") or item.get("token") or "")
            item["device_id"] = _norm_device_id(str(s.get("device_id") or item.get("device_id") or ""))
            item["ip"] = str(s.get("ip") or item.get("ip") or "")
        else:
            item["saved"] = False
            if not item.get("customer"):
                item["customer"] = "-"
        return item

    # Add UDP devices
    for d in udp_devices:
        item = {
            "name": str(d.get("name") or ""),
            "ip": str(d.get("ip") or "").strip(),
            "tcp_port": str(d.get("tcp_port") or ""),
            "device_id": _norm_device_id(str(d.get("device_id") or "")),
            "token": str(d.get("token") or ""),
            "customer": str(d.get("customer") or "-"),
            "status": "Online",
            "last_seen": _fmt(now),
            "power": "-",
            "time_sec": "-",
        }
        item = _merge_saved_fields(item)
        key = str(item.get("device_id") or item.get("ip") or secrets.token_hex(4))
        out[key] = item

    # Add runtime-online devices (HTTP/WS)
    for _k, st in list(_DEVICE_STATE.items()):
        last_seen_dt = st.get("last_seen")
        parse_ok = bool(st.get("parse_ok", True))
        status = _status_of(now, last_seen_dt, parse_ok)
        if status == "Offline":
            continue

        item = {
            "name": str(st.get("name") or ""),
            "ip": str(st.get("ip") or "").strip(),
            "tcp_port": "",
            "device_id": _norm_device_id(str(st.get("device_id") or "")),
            "token": str(st.get("token") or ""),
            "customer": str(st.get("customer") or "-"),
            "status": status,
            "last_seen": _fmt(last_seen_dt) if last_seen_dt else "-",
            "power": str(st.get("power") or "-"),
            "time_sec": str(st.get("time_sec") or "-"),
        }
        item = _merge_saved_fields(item)
        key = str(item.get("device_id") or item.get("ip") or secrets.token_hex(4))
        if key in out:
            prev = out[key]
            for k2 in ("status", "last_seen", "power", "time_sec"):
                if item.get(k2):
                    prev[k2] = item.get(k2)
            out[key] = prev
        else:
            out[key] = item

    devices = list(out.values())

    if customer:
        devices = [d for d in devices if str(d.get("customer") or "-") == customer]

    devices.sort(key=lambda d: (0 if d.get("saved") else 1, str(d.get("customer") or ""), str(d.get("name") or "")))

    if not devices:
        print("[DISCOVERY] result=0 (no UDP reply, no runtime cache)")

    return {"ok": True, "devices": devices}


@router.post("/api/devices/save")
def api_devices_save(payload: dict[str, Any] = Body(...)):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid payload")

    name = str(payload.get("name") or "").strip()
    ip = str(payload.get("ip") or "").strip()
    customer = str(payload.get("customer") or "-").strip() or "-"
    token = str(payload.get("token") or "").strip()
    device_id = str(payload.get("device_id") or "").strip()

    # (핵심) 식별키는 device_id(MAC 등)로 유지하고, 표시명(디바이스명/거래처)은 수정 가능하도록 분리
    # - ip는 변할 수 있으므로 device_id를 우선 사용합니다.
    st = None
    provision_name = name
    provision_token = token

    if device_id and not ip:
        key = _DEVICEID_TO_KEY.get(device_id)
        st = _DEVICE_STATE.get(key or "") if key else None
        if not st:
            for _k, _st in list(_DEVICE_STATE.items()):
                if str(_st.get("device_id") or "").strip() == device_id:
                    st = _st
                    _DEVICEID_TO_KEY[device_id] = _k
                    break
        if st:
            ip = str(st.get("ip") or "").strip()
            if not token:
                token = str(st.get("token") or "").strip()
            provision_token = token

    if (not device_id) and ip:
        # 구형 호환: ip로 device_id/token를 최대한 보정
        for _k, _st in list(_DEVICE_STATE.items()):
            if str(_st.get("ip") or "").strip() == ip:
                st = _st
                device_id = str(_st.get("device_id") or "").strip()
                if device_id:
                    _DEVICEID_TO_KEY[device_id] = _k
                if not token:
                    token = str(_st.get("token") or "").strip()
                provision_token = token
                break

    if not ip:
        raise HTTPException(status_code=400, detail="ip required")
    if not device_id:
        raise HTTPException(status_code=400, detail="device_id required")


    # (모델 토큰 정책) token은 모델명 단위 고정 값이며, 저장/수정 시 token-map을 자동 수정하지 않습니다.
    # - token이 비어있으면(브라우저에서 저장 요청), 최근 UDP discovery 캐시에서 보정합니다.
    if not token:
        cached = _DISCOVERY_CACHE.get(device_id) if device_id else None
        if not cached and ip:
            for _d in _DISCOVERY_CACHE.values():
                if str(_d.get("ip") or "").strip() == ip:
                    cached = _d
                    break
        if cached:
            token = str(cached.get("token") or "").strip()

    # customer(거래처)는 UI 표시값이며, 토큰으로 자동 매핑하지 않습니다.


    saved = _load_saved_devices()

    # 1) device_id로 기존 등록 여부 확인(우선)
    for idx, d in enumerate(saved):
        if (d.get("device_id") or "").strip() == device_id:
            provision_name = name or (d.get("name") or ip)
            provision_token = token or str(d.get("token") or "").strip()
            saved[idx]["name"] = name or (d.get("name") or ip)
            saved[idx]["customer"] = customer
            saved[idx]["ip"] = ip
            saved[idx]["token"] = provision_token
            saved[idx]["device_id"] = device_id
            _rewrite_saved_devices(saved)
            if provision_token:
                device_repo.upsert_device(
                    name=provision_name,
                    ip=ip,
                    customer=customer,
                    token=provision_token,
                    device_id=device_id,
                )
            local_reset = _maybe_remote_reset_pending(device_id=device_id, ip=ip, customer=customer)
            return {"ok": True, "token": provision_token, "customer": customer, "device_id": device_id, "existing": True, "local_reset": local_reset}

    # 2) (fallback) ip/customer 기반(구형 데이터)
    for idx, d in enumerate(saved):
        if (d.get("ip") == ip):
            provision_name = name or (d.get("name") or ip)
            provision_token = token or str(d.get("token") or "").strip()
            saved[idx]["name"] = name or (d.get("name") or ip)
            saved[idx]["customer"] = customer
            saved[idx]["ip"] = ip
            saved[idx]["token"] = provision_token
            saved[idx]["device_id"] = device_id
            _rewrite_saved_devices(saved)
            if provision_token:
                device_repo.upsert_device(
                    name=provision_name,
                    ip=ip,
                    customer=customer,
                    token=provision_token,
                    device_id=device_id,
                )
            local_reset = _maybe_remote_reset_pending(device_id=device_id, ip=ip, customer=customer)
            return {"ok": True, "token": provision_token, "customer": customer, "device_id": device_id, "existing": True, "local_reset": local_reset}

    # 신규 등록
    if not token:
        raise HTTPException(status_code=400, detail="token required for new device provisioning")
    ok = _append_saved_device(name=name, ip=ip, customer=customer, token=token, device_id=device_id)
    if not ok:
        raise HTTPException(status_code=400, detail="save failed")
    device_repo.upsert_device(
        name=name or ip,
        ip=ip,
        customer=customer,
        token=token,
        device_id=device_id,
    )

    local_reset = _maybe_remote_reset_pending(device_id=device_id, ip=ip, customer=customer)
    return {"ok": True, "token": token, "customer": customer, "device_id": device_id, "existing": False, "local_reset": local_reset}

@router.post("/api/devices/delete")
def api_devices_delete(payload: dict[str, Any] = Body(...)):
    """저장된 디바이스 정보 완전 삭제(토큰 포함)."""
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid payload")

    device_id = _norm_device_id(str(payload.get("device_id") or "").strip())
    token = str(payload.get("token") or "").strip()
    ip = str(payload.get("ip") or "").strip()
    customer = str(payload.get("customer") or "-").strip() or "-"

    if not device_id and not ip:
        raise HTTPException(status_code=400, detail="device_id or ip required")

    saved = _load_saved_devices()
    new_rows: list[dict[str, str]] = []
    deleted: dict[str, str] | None = None

    for d in saved:
        d_dev = _norm_device_id(str(d.get("device_id") or "").strip())
        if device_id and d_dev and d_dev == device_id:
            deleted = d
            continue
        if (not device_id) and ip and (d.get("ip") == ip) and (d.get("customer") == customer):
            deleted = d
            continue
        new_rows.append(d)

    if not deleted:
        raise HTTPException(status_code=404, detail="device not found")

    del_dev = _norm_device_id(str(deleted.get("device_id") or "").strip())
    del_ip = str(deleted.get("ip") or ip).strip()
    del_customer = str(deleted.get("customer") or customer).strip() or "-"
    del_token = str(deleted.get("token") or token).strip()
    _queue_remote_reset(device_id=del_dev, ip=del_ip, customer=del_customer)
    _rewrite_saved_devices(new_rows)
    try:
        device_repo.delete_device(device_id=del_dev, ip=del_ip, customer=del_customer)
    except Exception:
        pass


    # 런타임 캐시 동기화(ghost 방지)
    del_key = ""
    if del_dev:
        del_key = _DEVICEID_TO_KEY.pop(del_dev, None) or ""
    if (not del_key) and del_token:
        del_key = _TOKEN_TO_KEY.get(del_token, "") or ""
    if (not del_key) and del_ip:
        del_key = _IP_CUSTOMER_TO_KEY.get((del_customer, del_ip), "") or ""
    if del_key:
        _DEVICE_STATE.pop(del_key, None)
        _DEVICE_LOGS.pop(del_key, None)
        _LAST_RUNTIME_LOG.pop(del_key, None)

    if del_token:
        _TOKEN_TO_KEY.pop(del_token, None)
    if del_ip:
        _IP_CUSTOMER_TO_KEY.pop((del_customer, del_ip), None)

    local_reset = _maybe_remote_reset_pending(device_id=del_dev, ip=del_ip, customer=del_customer)

    return {"ok": True, "local_reset": local_reset}
@router.post("/api/devices/update")
def api_devices_update(payload: dict[str, Any] = Body(...)):
    """저장된 디바이스 정보 수정."""
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid payload")

    device_id = str(payload.get("device_id") or "").strip()
    token = str(payload.get("token") or "").strip()
    ip = str(payload.get("ip") or "").strip()
    customer_old = str(payload.get("customer_old") or payload.get("customer") or "-").strip() or "-"

    # 수정 값
    new_name = str(payload.get("name") or "").strip()
    customer_new = str(payload.get("customer_new") or customer_old).strip() or "-"

    if not device_id and not ip:
        raise HTTPException(status_code=400, detail="device_id or ip required")

    saved = _load_saved_devices()
    found_idx = -1

    for idx, d in enumerate(saved):
        d_dev = (d.get("device_id") or "").strip()
        if device_id and d_dev and d_dev == device_id:
            found_idx = idx
            break

    if found_idx < 0 and ip:
        for idx, d in enumerate(saved):
            if (d.get("ip") == ip):
                found_idx = idx
                break

    if found_idx < 0:
        raise HTTPException(status_code=404, detail="device not found")

    cur = saved[found_idx]
    cur_token = (cur.get("token") or token or "").strip()
    cur_ip = (cur.get("ip") or "").strip()
    cur_customer = (cur.get("customer") or "-").strip() or "-"
    cur_dev = _norm_device_id((cur.get("device_id") or device_id or "").strip())

    # 이름
    if new_name:
        cur["name"] = new_name

    # 거래처 변경(표시값): 모델 토큰맵(Data/modelTokenMap.csv)은 수정하지 않음
    # (중요) customer를 바꾸더라도 online 매칭이 깨지지 않도록 device_id(MAC)를 최대한 보정한다.
    if customer_new and customer_new != cur_customer:
        cur["customer"] = customer_new

        # ip/customer로 매칭하던 구형 호환 키가 있을 수 있어, 맵을 정리
        try:
            if cur_ip:
                old_key = _IP_CUSTOMER_TO_KEY.pop((cur_customer, cur_ip), None)
                if old_key:
                    _IP_CUSTOMER_TO_KEY[(customer_new, cur_ip)] = old_key
        except Exception:
            pass

    # token/device_id 보정(구형 데이터 호환)
    # - device_id가 비어 있으면 runtime state에서 추출하여 저장해두면,
    #   customer/name을 바꿔도 Online/Offline 매칭이 MAC 기준으로 안정적으로 유지된다.
    if not cur_dev:
        # 1) ip 기준
        if cur_ip:
            for _k, _st in list(_DEVICE_STATE.items()):
                if str(_st.get("ip") or "").strip() == cur_ip:
                    cur_dev = _norm_device_id(str(_st.get("device_id") or "").strip())
                    if cur_dev:
                        _DEVICEID_TO_KEY[cur_dev] = _k
                    if not cur_token:
                        cur_token = str(_st.get("token") or "").strip()
                    break
        # 2) token 기준
        if (not cur_dev) and cur_token:
            for _k, _st in list(_DEVICE_STATE.items()):
                if str(_st.get("token") or "").strip() == cur_token:
                    cur_dev = _norm_device_id(str(_st.get("device_id") or "").strip())
                    if cur_dev:
                        _DEVICEID_TO_KEY[cur_dev] = _k
                    break

    if cur_token:
        cur["token"] = cur_token
    if cur_dev:
        cur["device_id"] = cur_dev

    _rewrite_saved_devices(saved)
    return {"ok": True}


def _resolve_runtime_key(customer: str, ip: str, device_id: str, token: str = "") -> str | None:
    customer = (customer or "-").strip() or "-"
    ip = (ip or "").strip()
    device_id = (device_id or "").strip()
    token = (token or "").strip()

    key = None

    if device_id:
        key = _DEVICEID_TO_KEY.get(device_id)
        if not key:
            for _k, _st in list(_DEVICE_STATE.items()):
                if str(_st.get("device_id") or "").strip() == device_id:
                    key = _k
                    _DEVICEID_TO_KEY[device_id] = _k
                    break

    if not key and token:
        key = _TOKEN_TO_KEY.get(token)
        if not key:
            for _k, _st in list(_DEVICE_STATE.items()):
                if str(_st.get("token") or "").strip() == token:
                    key = _k
                    _TOKEN_TO_KEY[token] = _k
                    break

    if not key and ip:
        key = _IP_CUSTOMER_TO_KEY.get((customer, ip))
        if not key:
            key = _device_key(customer, "", ip)

    return key


def _resolve_device_ip(customer: str, ip: str, device_id: str, token: str = "") -> tuple[str, dict[str, Any], str | None]:
    customer = (customer or "-").strip() or "-"
    ip = (ip or "").strip()
    device_id = (device_id or "").strip()
    token = (token or "").strip()

    key = _resolve_runtime_key(customer, ip, device_id, token)
    st = _DEVICE_STATE.get(key or "") if key else {}

    resolved_ip = str(ip or st.get("ip") or "").strip()
    if not resolved_ip:
        saved = _load_saved_devices()
        if device_id:
            for row in saved:
                if str(row.get("device_id") or "").strip() == device_id:
                    resolved_ip = str(row.get("ip") or "").strip()
                    break
        if not resolved_ip and token:
            for row in saved:
                if str(row.get("token") or "").strip() == token:
                    resolved_ip = str(row.get("ip") or "").strip()
                    break

    return resolved_ip, st, key


from router.platform_api import register_platform_routes

register_platform_routes(router)


def _parse_pipe_kv(line: str) -> dict[str, str]:
    out: dict[str, str] = {}
    parts = (line or "").split("|")
    for seg in parts[1:]:
        if "=" not in seg:
            continue
        k, v = seg.split("=", 1)
        k = (k or "").strip()
        if not k:
            continue
        out[k] = (v or "").strip()
    return out


async def _fetch_sd_log_via_tcp(ip: str, port: int = 5000, timeout_sec: float = 10.0) -> tuple[bool, bytes, str]:
    ok, raw, reason, _filename = await _fetch_named_sd_log_via_tcp(ip, kind="activity", port=port, timeout_sec=timeout_sec)
    return ok, raw, reason


def _normalize_sd_log_kind(kind: str) -> tuple[str, str, str]:
    raw = (kind or "activity").strip().lower()
    if raw in {"energy", "total", "energylog", "totalenergy"}:
        return "energy", "SDLOG ENERGY\r\n", "TotalEnergy.txt"
    return "activity", "SDLOG GET\r\n", "MELAUHF_Log.txt"


def _safe_device_log_key(device_id: str) -> str:
    did = _norm_device_id(device_id)
    if not did:
        return "unknown"
    out_chars: list[str] = []
    for ch in did:
        if ch.isalnum():
            out_chars.append(ch.lower())
        else:
            out_chars.append("_")
    safe = "".join(out_chars).strip("._")
    return safe or "unknown"


def _uploaded_device_log_paths(device_id: str, kind: str) -> tuple[str, str, str]:
    kind_key, _command, filename = _normalize_sd_log_kind(kind)
    safe_dir = os.path.join(DEVICE_LOG_ARCHIVE_DIR, _safe_device_log_key(device_id))
    final_path = os.path.join(safe_dir, filename)
    temp_path = os.path.join(safe_dir, f".{filename}.{kind_key}.part")
    return safe_dir, final_path, temp_path


def _read_uploaded_device_log(device_id: str, kind: str) -> tuple[bool, bytes, str]:
    did = _norm_device_id(device_id)
    if not did:
        return False, b"", ""
    _safe_dir, final_path, _temp_path = _uploaded_device_log_paths(did, kind)
    if not os.path.exists(final_path):
        return False, b"", os.path.basename(final_path)
    try:
        with open(final_path, "rb") as fp:
            return True, fp.read(), os.path.basename(final_path)
    except Exception:
        return False, b"", os.path.basename(final_path)


def _write_uploaded_device_log(device_id: str, kind: str, raw: bytes) -> tuple[bool, str, str]:
    did = _norm_device_id(device_id)
    if not did:
        return False, "", "device_id_required"

    safe_dir, final_path, temp_path = _uploaded_device_log_paths(did, kind)
    try:
        os.makedirs(safe_dir, exist_ok=True)
        if os.path.exists(temp_path):
            os.remove(temp_path)
        with open(final_path, "wb") as fp:
            fp.write(bytes(raw or b""))
    except Exception as exc:
        return False, os.path.basename(final_path), f"write_failed:{exc}"

    return True, os.path.basename(final_path), ""


def _delete_uploaded_device_log(device_id: str, kind: str) -> tuple[bool, str, str]:
    did = _norm_device_id(device_id)
    if not did:
        return False, "", "device_id_required"

    _safe_dir, final_path, temp_path = _uploaded_device_log_paths(did, kind)
    filename = os.path.basename(final_path)

    try:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        if not os.path.exists(final_path):
            return False, filename, "file_not_found"
        os.remove(final_path)
    except Exception as exc:
        return False, filename, f"remove_failed:{exc}"

    return True, filename, ""


def _store_uploaded_device_log_chunk(
    *,
    device_id: str,
    kind: str,
    chunk_index: int,
    chunk_total: int,
    total_size: int,
    chunk_bytes: bytes,
) -> tuple[str, bool, int]:
    did = _norm_device_id(device_id)
    if not did:
        raise HTTPException(status_code=400, detail="device_id required")
    if chunk_total <= 0:
        raise HTTPException(status_code=400, detail="chunk_total must be positive")
    if chunk_index < 0 or chunk_index >= chunk_total:
        raise HTTPException(status_code=400, detail="invalid chunk_index")
    if total_size < 0:
        raise HTTPException(status_code=400, detail="invalid total_size")
    if len(chunk_bytes) > DEVICE_LOG_UPLOAD_MAX_CHUNK_BYTES:
        raise HTTPException(status_code=400, detail="chunk too large")

    safe_dir, final_path, temp_path = _uploaded_device_log_paths(did, kind)
    os.makedirs(safe_dir, exist_ok=True)

    mode = "ab"
    if chunk_index == 0:
        mode = "wb"
    elif not os.path.exists(temp_path):
        raise HTTPException(status_code=409, detail="upload not initialized")

    try:
        with open(temp_path, mode) as fp:
            if chunk_bytes:
                fp.write(chunk_bytes)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"log upload write failed: {exc}") from exc

    try:
        current_size = int(os.path.getsize(temp_path))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"log upload stat failed: {exc}") from exc

    if current_size > total_size:
        raise HTTPException(status_code=400, detail="uploaded chunk bytes exceed total_size")

    done = (chunk_index + 1) >= chunk_total
    if done:
        if current_size != total_size:
            raise HTTPException(status_code=400, detail="uploaded size mismatch")
        try:
            os.replace(temp_path, final_path)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"log upload finalize failed: {exc}") from exc

    return os.path.basename(final_path), done, current_size


def _resolve_device_record_for_logs(customer: str, ip: str, device_id: str) -> dict[str, Any]:
    customer = (customer or "-").strip() or "-"
    ip = (ip or "").strip()
    did = _norm_device_id(device_id)

    try:
        if did:
            rec = device_repo.get_device_by_device_id(did)
            if rec:
                return rec
    except Exception:
        pass

    try:
        if ip:
            rec = device_repo.get_device_by_ip_customer(ip, customer)
            if rec:
                return rec
    except Exception:
        pass

    return {}


def _build_activity_log_fallback_bytes(device_id: str, runtime_key: str | None, st: dict[str, Any], rec: dict[str, Any]) -> bytes:
    lines: list[str] = ["# source: server runtime log mirror"]
    rows: list[dict[str, Any]] = []
    did = _norm_device_id(str(device_id or rec.get("device_id") or ""))

    if did:
        try:
            db_tail = device_ops_repo.tail_runtime_logs(device_id=did, cursor=0, limit=500)
            rows = list(db_tail.get("logs") or [])
        except Exception:
            rows = []

    if not rows and runtime_key:
        cached = list(_DEVICE_LOGS.get(runtime_key) or [])
        for row in cached[-500:]:
            t = row.get("t")
            try:
                t_str = t.strftime("%Y-%m-%d %H:%M:%S") if t else ""
            except Exception:
                t_str = ""
            rows.append({"t": t_str, "line": str(row.get("line") or "")})

    for row in rows:
        msg = str(row.get("line") or "").strip()
        if not msg:
            continue
        t_str = str(row.get("t") or "").strip()
        lines.append(f"[{t_str}] {msg}" if t_str else msg)

    if len(lines) == 1:
        last_seen_dt = st.get("last_seen") or _parse_runtime_dt(rec.get("last_seen_at"))
        last_line = str(st.get("line") or rec.get("last_line") or "").strip()
        if last_line:
            t_str = _fmt(last_seen_dt) if last_seen_dt else ""
            lines.append(f"[{t_str}] {last_line}" if t_str else last_line)
        else:
            lines.append("# central runtime log is empty")

    return ("\n".join(lines) + "\n").encode("utf-8", errors="replace")


def _build_energy_log_fallback_bytes(st: dict[str, Any], rec: dict[str, Any]) -> bytes:
    last_seen_dt = st.get("last_seen") or _parse_runtime_dt(rec.get("last_seen_at"))
    if last_seen_dt:
        day_txt = last_seen_dt.strftime("%Y-%m-%d")
        seen_txt = _fmt(last_seen_dt)
    else:
        now_kst = datetime.now(KST)
        day_txt = now_kst.strftime("%Y-%m-%d")
        seen_txt = ""

    used_energy_j = _payload_int(st.get("used_energy_j"), _payload_int(rec.get("used_energy_j"), 0))
    telemetry_count = _payload_int(rec.get("telemetry_count"), 0)
    power = str(st.get("power") or rec.get("last_power") or "-").strip() or "-"
    time_sec = str(st.get("time_sec") or rec.get("last_time_sec") or "-").strip() or "-"

    lines = [
        "# source: server telemetry energy summary",
        f"[DAILY_TOTAL] DATE={day_txt} TOTAL={used_energy_j} J",
        f"[DEVICE_TOTAL] {used_energy_j} J",
    ]
    if telemetry_count > 0:
        lines.append(f"# telemetry_count={telemetry_count}")
    if seen_txt:
        lines.append(f"# last_seen={seen_txt}")
    if power != "-" or time_sec != "-":
        lines.append(f"# last_power={power} last_time_sec={time_sec}")

    return ("\n".join(lines) + "\n").encode("utf-8", errors="replace")


def _build_named_sd_log_fallback(
    *,
    customer: str,
    ip: str,
    device_id: str,
    token: str,
    kind: str,
) -> tuple[bytes, str, str, str, dict[str, Any]]:
    kind_key, _command, default_filename = _normalize_sd_log_kind(kind)
    resolved_ip, st, runtime_key = _resolve_device_ip(customer, ip, device_id, token)
    rec = _resolve_device_record_for_logs(customer, (resolved_ip or ip), device_id)

    if kind_key == "energy":
        raw = _build_energy_log_fallback_bytes(st, rec)
        source = "server_energy_summary"
    else:
        raw = _build_activity_log_fallback_bytes(device_id, runtime_key, st, rec)
        source = "server_runtime"

    resolved_ip = str(resolved_ip or rec.get("ip") or ip).strip()
    return raw, default_filename, source, resolved_ip, rec


async def _read_named_sd_log(
    *,
    customer: str,
    ip: str,
    device_id: str,
    token: str,
    kind: str,
    timeout_sec: float = 10.0,
) -> dict[str, Any]:
    kind_key, _command, default_filename = _normalize_sd_log_kind(kind)
    resolved_ip, st, _key = _resolve_device_ip(customer, ip, device_id, token)
    rec = _resolve_device_record_for_logs(customer, (resolved_ip or ip), device_id)
    resolved_ip = str(resolved_ip or rec.get("ip") or ip).strip()
    did = _norm_device_id(str(device_id or rec.get("device_id") or st.get("device_id") or ""))

    uploaded_ok, uploaded_raw, uploaded_filename = _read_uploaded_device_log(did, kind_key)
    if uploaded_ok:
        return {
            "ok": True,
            "raw": uploaded_raw,
            "reason": "",
            "filename": uploaded_filename or default_filename,
            "kind": kind_key,
            "source": "server_uploaded_raw",
            "remote_delete_supported": True,
            "resolved_ip": resolved_ip,
            "st": st,
            "record": rec,
        }

    if ENABLE_DIRECT_DEVICE_TCP and resolved_ip:
        ok, raw, reason, filename = await _fetch_named_sd_log_via_tcp(
            resolved_ip, kind=kind_key, timeout_sec=timeout_sec
        )
        if ok:
            return {
                "ok": True,
                "raw": raw,
                "reason": "",
                "filename": filename or default_filename,
                "kind": kind_key,
                "source": "device_sd",
                "remote_delete_supported": True,
                "resolved_ip": resolved_ip,
                "st": st,
                "record": rec,
            }

    raw, filename, source, resolved_ip, rec = _build_named_sd_log_fallback(
        customer=customer,
        ip=ip,
        device_id=device_id,
        token=token,
        kind=kind_key,
    )
    return {
        "ok": True,
        "raw": raw,
        "reason": "",
        "filename": filename or default_filename,
        "kind": kind_key,
        "source": source,
        "remote_delete_supported": False,
        "resolved_ip": resolved_ip,
        "st": st,
        "record": rec,
    }


def _normalize_sd_delete_kind(kind: str) -> tuple[str, str, str]:
    kind_key, _fetch_command, default_filename = _normalize_sd_log_kind(kind)
    if kind_key == "energy":
        return kind_key, "SDDELETE ENERGY\r\n", default_filename
    return kind_key, "SDDELETE LOG\r\n", default_filename


def _trash_name_part(value: str, fallback: str) -> str:
    src = " ".join(str(value or "").strip().split())
    if not src:
        src = fallback

    out_chars: list[str] = []
    for ch in src:
        code = ord(ch)
        if code < 32:
            continue
        if ch in '\\/:*?"<>|':
            out_chars.append("_")
        elif ch.isspace():
            out_chars.append("_")
        else:
            out_chars.append(ch)

    cleaned = "".join(out_chars).strip("._ ")
    return cleaned or fallback


def _make_trashcan_backup_prefix(device_name: str, customer: str) -> str:
    ts = datetime.now(KST).strftime("%Y_%m_%d_%H_%M_%S")
    dev_part = _trash_name_part(device_name, "device")
    customer_part = _trash_name_part(customer, "customer")
    base_name = f"{ts}_{dev_part}_{customer_part}"

    os.makedirs(TRASHCAN_DIR, exist_ok=True)
    candidate = base_name
    if not (
        os.path.exists(os.path.join(TRASHCAN_DIR, f"{candidate}_MELAUHF_Log.txt"))
        or os.path.exists(os.path.join(TRASHCAN_DIR, f"{candidate}_TotalEnergy.txt"))
    ):
        return candidate

    suffix = 2
    while True:
        candidate = f"{base_name}_{suffix:02d}"
        if not (
            os.path.exists(os.path.join(TRASHCAN_DIR, f"{candidate}_MELAUHF_Log.txt"))
            or os.path.exists(os.path.join(TRASHCAN_DIR, f"{candidate}_TotalEnergy.txt"))
        ):
            return candidate
        suffix += 1


def _make_trashcan_backup_name(prefix: str, filename: str) -> str:
    file_part = _trash_name_part(filename, "log.txt")
    return f"{prefix}_{file_part}"


def _extract_daily_total_date(line: str) -> str | None:
    if not line.startswith("[DAILY_TOTAL]"):
        return None
    date_pos = line.find("DATE=")
    if date_pos < 0:
        return None
    date_txt = line[date_pos + 5:date_pos + 15]
    try:
        datetime.strptime(date_txt, "%Y-%m-%d")
    except Exception:
        return None
    return date_txt


def _join_log_lines(lines: list[str]) -> bytes:
    if not lines:
        return b""
    return ("\n".join(lines) + "\n").encode("utf-8")


def _compact_total_energy_backup(raw: bytes) -> tuple[bytes, bytes]:
    text = raw.decode("utf-8", errors="replace").replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")
    daily_counts: dict[str, int] = {}
    device_total_count = 0

    for line in lines:
        if not line:
            continue
        day_key = _extract_daily_total_date(line)
        if day_key:
            daily_counts[day_key] = daily_counts.get(day_key, 0) + 1
            continue
        if line.startswith("[DEVICE_TOTAL]"):
            device_total_count += 1

    daily_seen: dict[str, int] = {}
    device_total_seen = 0
    kept_lines: list[str] = []
    removed_lines: list[str] = []

    for line in lines:
        if not line:
            continue
        if line.startswith("[SESSION]"):
            removed_lines.append(line)
            continue

        day_key = _extract_daily_total_date(line)
        if day_key:
            daily_seen[day_key] = daily_seen.get(day_key, 0) + 1
            if daily_seen[day_key] == daily_counts.get(day_key, 0):
                kept_lines.append(line)
            else:
                removed_lines.append(line)
            continue

        if line.startswith("[DEVICE_TOTAL]"):
            device_total_seen += 1
            if device_total_seen == device_total_count:
                kept_lines.append(line)
            else:
                removed_lines.append(line)
            continue

        kept_lines.append(line)

    return _join_log_lines(kept_lines), _join_log_lines(removed_lines)


async def _delete_named_sd_log_via_tcp(
    ip: str,
    kind: str = "activity",
    port: int = 5000,
    timeout_sec: float = REMOTE_SD_DELETE_TIMEOUT_SEC,
) -> tuple[bool, str, str]:
    reader = None
    writer = None
    reason = ""
    kind_key, command, default_filename = _normalize_sd_delete_kind(kind)
    filename = default_filename

    try:
        reader, writer = await asyncio.wait_for(asyncio.open_connection(ip, port), timeout=4.0)
        writer.write(command.encode("utf-8", errors="replace"))
        await writer.drain()

        loop = asyncio.get_running_loop()
        deadline = loop.time() + max(float(timeout_sec), 1.0)

        while True:
            remain = deadline - loop.time()
            if remain <= 0:
                return False, reason or "timeout", filename

            raw = await asyncio.wait_for(reader.readline(), timeout=min(1.0, remain))
            if not raw:
                return False, reason or "no_response", filename

            line = raw.decode("utf-8", errors="replace").strip()
            if not line or line.startswith("HELLO "):
                continue

            if not line.startswith("SDDELETE|"):
                continue

            fields = _parse_pipe_kv(line)
            ok = fields.get("ok", "0") == "1"
            reason = fields.get("reason", "").strip()
            path = str(fields.get("path", "")).strip()
            if path:
                filename = os.path.basename(path) or filename
            if ok:
                return True, "", filename
            return False, reason or f"{kind_key}_delete_failed", filename

    except Exception as e:
        return False, f"tcp_error:{e}", filename
    finally:
        if writer is not None:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass


async def _fetch_named_sd_log_via_tcp(ip: str, kind: str = "activity", port: int = 5000, timeout_sec: float = 10.0) -> tuple[bool, bytes, str, str]:
    reader = None
    writer = None
    chunks: list[bytes] = []
    started = False
    ended = False
    ok = False
    reason = ""
    _kind, command, default_filename = _normalize_sd_log_kind(kind)
    filename = default_filename

    try:
        reader, writer = await asyncio.wait_for(asyncio.open_connection(ip, port), timeout=4.0)
        writer.write(command.encode("utf-8", errors="replace"))
        await writer.drain()

        loop = asyncio.get_running_loop()
        deadline = loop.time() + max(float(timeout_sec), 1.0)

        while True:
            remain = deadline - loop.time()
            if remain <= 0:
                reason = reason or ("timeout_no_response" if not started else "timeout")
                break

            raw = await asyncio.wait_for(reader.readline(), timeout=min(1.2, remain))
            if not raw:
                if not started:
                    reason = reason or "no_response"
                break

            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue

            if line.startswith("SDLOG_BEGIN|"):
                started = True
                fields = _parse_pipe_kv(line)
                ok = fields.get("ok", "0") == "1"
                reason = fields.get("reason", "")
                path = str(fields.get("path", "")).strip()
                if path:
                    filename = os.path.basename(path) or filename
                continue

            if line.startswith("SDLOG_DATA|"):
                if not started or not ok:
                    continue
                hex_part = line.split("|", 1)[1].strip()
                if not hex_part:
                    continue
                try:
                    chunks.append(bytes.fromhex(hex_part))
                except Exception:
                    ok = False
                    reason = "invalid_hex_chunk"
                continue

            if line.startswith("SDLOG_END|"):
                ended = True
                fields = _parse_pipe_kv(line)
                end_ok = fields.get("ok", "1" if ok else "0") == "1"
                if not ok:
                    reason = reason or fields.get("reason", "sd_error")
                elif not end_ok:
                    ok = False
                    reason = fields.get("reason", "sd_error")
                break

            continue

        if not started:
            return False, b"", reason or "sdlog_not_started", filename
        if not ok:
            return False, b"", reason or "sdlog_failed", filename
        if not ended:
            return False, b"", reason or "sdlog_incomplete", filename
        return True, b"".join(chunks), "", filename

    except Exception as e:
        return False, b"", f"tcp_error:{e}", filename
    finally:
        if writer is not None:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass


@router.get("/api/device/sd-log")
async def api_device_sd_log(ip: str = "", customer: str = "-", device_id: str = "", token: str = "", kind: str = "activity"):
    customer = (customer or "-").strip() or "-"
    ip = (ip or "").strip()
    device_id = (device_id or "").strip()
    token = (token or "").strip()
    kind_key, _cmd, default_filename = _normalize_sd_log_kind(kind)

    if not (device_id or ip or token):
        raise HTTPException(status_code=400, detail="device identity required")

    now = datetime.now()
    _prune_runtime_cache(now)

    result = await _read_named_sd_log(customer=customer, ip=ip, device_id=device_id, token=token, kind=kind_key)
    st = dict(result.get("st") or {})
    rec = dict(result.get("record") or {})
    resolved_ip = str(result.get("resolved_ip") or "").strip()
    text = bytes(result.get("raw") or b"").decode("utf-8", errors="replace")
    return {
        "ok": True,
        "kind": str(result.get("kind") or kind_key),
        "ip": resolved_ip,
        "customer": str(st.get("customer") or rec.get("customer") or customer),
        "device_id": str(st.get("device_id") or rec.get("device_id") or device_id),
        "token": str(st.get("token") or rec.get("token") or token),
        "filename": str(result.get("filename") or default_filename),
        "size_bytes": len(bytes(result.get("raw") or b"")),
        "source": str(result.get("source") or "server_runtime"),
        "remote_delete_supported": bool(result.get("remote_delete_supported")),
        "text": text,
    }


@router.get("/api/device/sd-log/download")
async def api_device_sd_log_download(ip: str = "", customer: str = "-", device_id: str = "", token: str = "", kind: str = "activity"):
    customer = (customer or "-").strip() or "-"
    ip = (ip or "").strip()
    device_id = (device_id or "").strip()
    token = (token or "").strip()
    kind_key, _cmd, default_filename = _normalize_sd_log_kind(kind)

    if not (device_id or ip or token):
        raise HTTPException(status_code=400, detail="device identity required")

    now = datetime.now()
    _prune_runtime_cache(now)

    result = await _read_named_sd_log(customer=customer, ip=ip, device_id=device_id, token=token, kind=kind_key)
    raw = bytes(result.get("raw") or b"")
    filename = str(result.get("filename") or default_filename)
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return Response(content=raw, media_type="text/plain; charset=utf-8", headers=headers)


@router.post("/api/device/sd-log/delete")
async def api_device_sd_log_delete(payload: dict[str, Any] = Body(default={})):
    customer = str(payload.get("customer") or "-").strip() or "-"
    ip = str(payload.get("ip") or "").strip()
    device_id = str(payload.get("device_id") or "").strip()
    token = str(payload.get("token") or "").strip()
    device_name = str(payload.get("device_name") or "").strip()
    kind = str(payload.get("kind") or "activity").strip()
    kind_key, _delete_cmd, default_filename = _normalize_sd_delete_kind(kind)

    now = datetime.now()
    _prune_runtime_cache(now)

    resolved_ip, st, _key = _resolve_device_ip(customer, ip, device_id, token)
    rec = _resolve_device_record_for_logs(customer, (resolved_ip or ip), device_id)
    resolved_ip = str(resolved_ip or rec.get("ip") or ip).strip()
    did = _norm_device_id(str(device_id or rec.get("device_id") or st.get("device_id") or ""))

    resolved_customer = str(st.get("customer") or rec.get("customer") or customer or "-").strip() or "-"
    resolved_name = (
        str(st.get("name") or rec.get("name") or "").strip()
        or str(st.get("device_name") or rec.get("device_name") or "").strip()
        or device_name
        or str(st.get("device_id") or rec.get("device_id") or device_id or did or resolved_ip).strip()
    )

    backup_results: dict[str, dict[str, Any]] = {}
    for fetch_kind in ("activity", "energy"):
        fetch_default_filename = _normalize_sd_log_kind(fetch_kind)[2]
        uploaded_ok = False
        uploaded_raw = b""
        uploaded_filename = fetch_default_filename

        if did:
            uploaded_ok, uploaded_raw, uploaded_filename = _read_uploaded_device_log(did, fetch_kind)

        if uploaded_ok:
            backup_results[fetch_kind] = {
                "ok": True,
                "raw": uploaded_raw,
                "reason": "",
                "filename": uploaded_filename or fetch_default_filename,
                "source": "server_uploaded_raw",
            }
            continue

        if ENABLE_DIRECT_DEVICE_TCP and resolved_ip:
            ok, raw, reason, filename = await _fetch_named_sd_log_via_tcp(resolved_ip, kind=fetch_kind)
            backup_results[fetch_kind] = {
                "ok": ok,
                "raw": raw,
                "reason": reason or "",
                "filename": filename or fetch_default_filename,
                "source": "device_sd" if ok else "",
            }
            continue

        backup_results[fetch_kind] = {
            "ok": False,
            "raw": b"",
            "reason": "file_not_found" if did else ("device_ip_not_found" if not resolved_ip else "direct_device_tcp_disabled"),
            "filename": fetch_default_filename,
            "source": "",
        }

    target_backup = backup_results.get(kind_key) or {}
    if not bool(target_backup.get("ok")):
        return {
            "ok": False,
            "kind": kind_key,
            "reason": f"backup_failed:{target_backup.get('reason') or 'fetch_failed'}",
            "filename": str(target_backup.get("filename") or default_filename),
            "ip": resolved_ip,
            "customer": resolved_customer,
            "device_name": resolved_name,
        }

    compacted_energy_raw = b""
    removed_energy_raw = b""
    if kind_key == "energy":
        compacted_energy_raw, removed_energy_raw = _compact_total_energy_backup(bytes(target_backup.get("raw") or b""))

    backup_dir_rel = os.path.relpath(TRASHCAN_DIR, os.path.dirname(os.path.dirname(__file__)))

    try:
        backup_prefix = _make_trashcan_backup_prefix(resolved_name, resolved_customer)
        backed_up_files: list[str] = []
        backup_missing: list[dict[str, str]] = []

        for fetch_kind in ("activity", "energy"):
            item = backup_results[fetch_kind]
            source_filename = str(item.get("filename") or _normalize_sd_log_kind(fetch_kind)[2])
            if item.get("ok"):
                backup_name = _make_trashcan_backup_name(backup_prefix, source_filename)
                backup_raw = bytes(item.get("raw") or b"")
                if fetch_kind == "energy" and kind_key == "energy":
                    backup_raw = removed_energy_raw
                file_path = os.path.join(TRASHCAN_DIR, backup_name)
                with open(file_path, "wb") as f:
                    f.write(backup_raw)
                backed_up_files.append(backup_name)
            else:
                backup_missing.append(
                    {
                        "kind": fetch_kind,
                        "filename": source_filename,
                        "reason": str(item.get("reason") or "fetch_failed"),
                    }
                )
    except Exception as e:
        return {
            "ok": False,
            "kind": kind_key,
            "reason": f"backup_write_failed:{e}",
            "filename": str(target_backup.get("filename") or default_filename),
            "ip": resolved_ip,
            "customer": resolved_customer,
            "device_name": resolved_name,
            "backup_dir": backup_dir_rel,
        }

    target_source = str(target_backup.get("source") or "")
    if target_source == "server_uploaded_raw":
        if kind_key == "energy":
            delete_ok, deleted_filename, delete_reason = _write_uploaded_device_log(did, kind_key, compacted_energy_raw)
        else:
            delete_ok, deleted_filename, delete_reason = _delete_uploaded_device_log(did, kind_key)
    else:
        if not ENABLE_DIRECT_DEVICE_TCP:
            return {
                "ok": False,
                "kind": kind_key,
                "reason": "direct_device_tcp_disabled",
                "filename": default_filename,
                "ip": resolved_ip,
                "customer": resolved_customer,
                "device_name": resolved_name,
                "backup_dir": backup_dir_rel,
                "backed_up_files": backed_up_files,
                "backup_missing": backup_missing,
            }
        if not resolved_ip:
            return {
                "ok": False,
                "kind": kind_key,
                "reason": "device_ip_not_found",
                "filename": default_filename,
                "ip": resolved_ip,
                "customer": resolved_customer,
                "device_name": resolved_name,
                "backup_dir": backup_dir_rel,
                "backed_up_files": backed_up_files,
                "backup_missing": backup_missing,
            }
        delete_ok, delete_reason, deleted_filename = await _delete_named_sd_log_via_tcp(resolved_ip, kind=kind_key)

    if not delete_ok:
        return {
            "ok": False,
            "kind": kind_key,
            "reason": delete_reason or "delete_failed",
            "filename": deleted_filename or default_filename,
            "ip": resolved_ip,
            "customer": resolved_customer,
            "device_name": resolved_name,
            "backup_dir": backup_dir_rel,
            "backed_up_files": backed_up_files,
            "backup_missing": backup_missing,
        }

    return {
        "ok": True,
        "kind": kind_key,
        "action": "compacted" if kind_key == "energy" else "deleted",
        "filename": deleted_filename or default_filename,
        "ip": resolved_ip,
        "customer": resolved_customer,
        "device_name": resolved_name,
        "backup_dir": backup_dir_rel,
        "backed_up_files": backed_up_files,
        "backup_missing": backup_missing,
    }


@router.get("/api/device/tail")
def api_device_tail(ip: str = "", customer: str = "-", cursor: int = 0, device_id: str = "", token: str = ""):
    customer = (customer or "-").strip() or "-"
    ip = (ip or "").strip()
    device_id = (device_id or "").strip()
    token = (token or "").strip()

    now = datetime.now()
    _prune_runtime_cache(now)
    skip_history = cursor < 0

    key = _resolve_runtime_key(customer, ip, device_id, token)

    if not key:
        raise HTTPException(status_code=400, detail="device_id or ip required")

    st = _DEVICE_STATE.get(key) or {}
    did = _norm_device_id(str(st.get("device_id") or device_id))

    last_seen_dt = st.get("last_seen")
    if not last_seen_dt:
        last_seen_dt = _parse_runtime_dt(st.get("last_seen_at"))
    parse_ok = bool(st.get("parse_ok", True))
    status = _status_of(now, last_seen_dt, parse_ok)

    try:
        db_tail = device_ops_repo.tail_runtime_logs(device_id=did, cursor=cursor, limit=200) if did else {"logs": [], "next_cursor": 0}
    except Exception:
        db_tail = {"logs": [], "next_cursor": 0}

    resp_logs = list(db_tail.get("logs") or [])
    next_cursor = int(db_tail.get("next_cursor") or 0)

    if skip_history and did:
        return {
            "ok": True,
            "customer": str(st.get("customer") or customer),
            "ip": str(st.get("ip") or ip),
            "device_id": did,
            "token": str(st.get("token") or token),
            "status": status,
            "last_seen": _fmt(last_seen_dt) if last_seen_dt else "-",
            "power": str(st.get("power") or "-"),
            "time_sec": str(st.get("time_sec") or "-"),
            "sd_inserted": _payload_bool(st.get("sd_inserted"), False),
            "sd_total_mb": _payload_mb(st.get("sd_total_mb"), 0.0),
            "sd_used_mb": _payload_mb(st.get("sd_used_mb"), 0.0),
            "sd_free_mb": _payload_mb(st.get("sd_free_mb"), 0.0),
            "logs": [],
            "next_cursor": next_cursor,
        }

    if not resp_logs:
        logs = _DEVICE_LOGS.get(key) or []
        if cursor < 0:
            cursor = len(logs)
        if cursor > len(logs):
            cursor = len(logs)
        tail = logs[cursor:]
        if len(tail) > 200:
            tail = tail[-200:]
        next_cursor = len(logs)
        resp_logs = []
        for row in tail:
            t = row.get("t")
            try:
                t_str = t.strftime("%H:%M:%S") if t else ""
            except Exception:
                t_str = ""
            resp_logs.append({"t": t_str, "line": str(row.get("line") or "")})

    return {
        "ok": True,
        "customer": str(st.get("customer") or customer),
        "ip": str(st.get("ip") or ip),
        "device_id": did,
        "token": str(st.get("token") or token),
        "status": status,
        "last_seen": _fmt(last_seen_dt) if last_seen_dt else "-",
        "power": str(st.get("power") or "-"),
        "time_sec": str(st.get("time_sec") or "-"),
        "sd_inserted": _payload_bool(st.get("sd_inserted"), False),
        "sd_total_mb": _payload_mb(st.get("sd_total_mb"), 0.0),
        "sd_used_mb": _payload_mb(st.get("sd_used_mb"), 0.0),
        "sd_free_mb": _payload_mb(st.get("sd_free_mb"), 0.0),
        "logs": resp_logs,
        "next_cursor": next_cursor,
    }
