from __future__ import annotations

import json
import re
from typing import Any


def _pages():
    from router import pages as pages_module

    return pages_module


def _messenger_presence_badge_label(state: str) -> str:
    pages_module = _pages()
    normalized = pages_module._normalize_presence_state(state)
    if normalized == "live":
        return "온라인"
    if normalized == "background":
        return "자리비움"
    return "오프라인"


def _messenger_presence_tone(state: str) -> str:
    pages_module = _pages()
    normalized = pages_module._normalize_presence_state(state)
    if normalized == "live":
        return "online"
    if normalized == "background":
        return "away"
    return "offline"


def _messenger_time_text(value: Any) -> str:
    text = str(value or "").strip()
    if len(text) >= 16:
        return text[11:16]
    return text


def _messenger_preview_text(value: Any, limit: int = 100) -> str:
    preview = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(preview) <= limit:
        return preview
    return preview[: max(limit - 1, 0)].rstrip() + "…"


def _messenger_duration_text(value: Any) -> str:
    try:
        total_seconds = max(int(value or 0), 0)
    except Exception:
        total_seconds = 0
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    if hours > 0:
        return f"{hours}시간 {minutes}분"
    if minutes > 0:
        return f"{minutes}분 {seconds}초"
    return f"{seconds}초"


def _messenger_call_log_view(
    call_log: dict[str, Any] | None,
    user_directory: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    call_log = call_log or {}
    call_id = str(call_log.get("call_id") or "").strip()
    if not call_id:
        return None

    started_by_user_id = str(call_log.get("started_by_user_id") or "").strip()
    starter_profile = user_directory.get(started_by_user_id) or {}
    started_by_display_name = (
        str(starter_profile.get("display_name") or "").strip()
        or str(call_log.get("started_by_nickname") or "").strip()
        or str(call_log.get("started_by_name") or "").strip()
        or started_by_user_id
        or "알 수 없음"
    )
    status = str(call_log.get("status") or "").strip().lower() or "ended"
    if status not in {"active", "ended", "missed"}:
        status = "ended"
    participant_peak = max(int(call_log.get("max_participant_count") or 0), 1)
    duration_sec = max(int(call_log.get("duration_sec") or 0), 0)
    duration_text = _messenger_duration_text(duration_sec)
    time_anchor = str(call_log.get("ended_at") or call_log.get("updated_at") or call_log.get("started_at") or "").strip()
    if status == "missed":
        status_label = "부재중"
        summary = f"{started_by_display_name}님이 {duration_text} 동안 연결을 시도했습니다."
    elif status == "active":
        status_label = "진행 중"
        summary = f"현재 진행 중 · {participant_peak}명 연결"
    else:
        status_label = "통화 종료"
        summary = f"{duration_text} · 최대 {participant_peak}명 연결"
    return {
        "id": int(call_log.get("id") or 0),
        "call_id": call_id,
        "status": status,
        "status_label": status_label,
        "summary": summary,
        "started_by_user_id": started_by_user_id,
        "started_by_display_name": started_by_display_name,
        "initiated_mode": str(call_log.get("initiated_mode") or "audio").strip().lower() or "audio",
        "participant_peak": participant_peak,
        "duration_sec": duration_sec,
        "duration_text": duration_text,
        "started_at": str(call_log.get("started_at") or "").strip(),
        "ended_at": str(call_log.get("ended_at") or "").strip(),
        "time_text": _messenger_time_text(time_anchor),
    }


def _messenger_attachment_from_content(message_type: Any, content: Any) -> dict[str, Any]:
    normalized_type = str(message_type or "").strip().lower()
    if normalized_type not in {"file", "image"}:
        return {}
    try:
        payload = json.loads(str(content or "{}"))
    except Exception:
        payload = {}
    if not isinstance(payload, dict):
        return {}
    url = str(payload.get("url") or "").strip()
    fallback_name = url.rsplit("/", 1)[-1] if url else ""
    return {
        "kind": normalized_type,
        "name": str(payload.get("name") or payload.get("filename") or fallback_name).strip(),
        "url": url,
        "size_text": str(payload.get("size_text") or "").strip(),
        "content_type": str(payload.get("content_type") or "").strip(),
    }


def _messenger_message_preview_for_view(message_type: Any, content: Any) -> str:
    normalized_type = str(message_type or "").strip().lower()
    if normalized_type == "system":
        return _messenger_preview_text(content, limit=100)
    attachment = _messenger_attachment_from_content(message_type, content)
    if attachment:
        label = "[이미지]" if attachment.get("kind") == "image" else "[파일]"
        name = str(attachment.get("name") or attachment.get("url") or "첨부").strip()
        return f"{label} {name}".strip()
    return _messenger_preview_text(content, limit=100)


def _messenger_human_size(num_bytes: int) -> str:
    value = float(max(int(num_bytes or 0), 0))
    unit = "B"
    for next_unit in ["B", "KB", "MB", "GB"]:
        unit = next_unit
        if value < 1024.0 or unit == "GB":
            break
        value /= 1024.0
    if unit == "B":
        return f"{int(value)} {unit}"
    return f"{value:.1f} {unit}"


def _messenger_unique_user_ids(values: list[Any]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values or []:
        user_id = str(value or "").strip()
        if (not user_id) or (user_id in seen):
            continue
        seen.add(user_id)
        result.append(user_id)
    return result


def _messenger_user_view_from_row(
    row: dict[str, Any] | None,
    presence_map: dict[str, dict[str, Any]],
    *,
    current_user_id: str = "",
) -> dict[str, Any]:
    pages_module = _pages()
    row = row or {}
    user_id = str(row.get("ID") or row.get("user_id") or "").strip()
    nickname = str(row.get("NICKNAME") or row.get("nickname") or "").strip()
    name = str(row.get("NAME") or row.get("name") or "").strip()
    department = str(row.get("DEPARTMENT") or row.get("department") or "").strip()
    role = pages_module._normalize_role(row.get("ROLE") or row.get("role") or "")
    approval_status = pages_module._normalize_approval_status(row.get("APPROVAL_STATUS") or row.get("approval_status") or "approved")
    display_name = nickname or name or user_id
    profile_image_url = pages_module._profile_image_url_from_value(row.get("PROFILE_IMAGE_PATH") or row.get("profile_image_path") or "")
    presence = presence_map.get(user_id) or {}
    presence_state = pages_module._normalize_presence_state(presence.get("state") or "")
    return {
        "user_id": user_id,
        "display_name": display_name,
        "nickname": nickname,
        "name": name,
        "department": department,
        "role": role,
        "role_label": pages_module._role_label(role),
        "approval_status": approval_status,
        "profile_image_url": profile_image_url,
        "avatar_initial": pages_module._profile_avatar_initial(display_name, user_id),
        "presence_state": presence_state,
        "presence_label": _messenger_presence_badge_label(presence_state),
        "presence_tone": _messenger_presence_tone(presence_state),
        "presence_page_text": str(presence.get("page_label") or "").strip(),
        "is_online": presence_state in {"live", "background"},
        "is_self": user_id == (current_user_id or ""),
    }


def _messenger_current_user_role(
    current_user_id: str,
    user_directory: dict[str, dict[str, Any]],
) -> str:
    pages_module = _pages()
    current_user = user_directory.get(current_user_id) or {}
    return pages_module._normalize_role(current_user.get("role") or "")


def _messenger_room_app_domain(room: dict[str, Any] | None) -> str:
    pages_module = _pages()
    room = room or {}
    return pages_module.chat_repo.normalize_app_domain(
        room.get("app_domain"),
        room_type=room.get("room_type"),
        room_key=room.get("room_key"),
    )


def _messenger_is_ascord_room(room: dict[str, Any] | None) -> bool:
    return _messenger_room_app_domain(room) == "ascord"


def _messenger_is_talk_room(room: dict[str, Any] | None) -> bool:
    return _messenger_room_app_domain(room) == "talk"


def _messenger_supports_calls(room: dict[str, Any] | None) -> bool:
    return _messenger_is_ascord_room(room)


def _messenger_system_sender_label(room: dict[str, Any] | None) -> str:
    return "ASCORD" if _messenger_is_ascord_room(room) else "ABBAS Talk"


def _messenger_room_type(room: dict[str, Any] | None) -> str:
    room = room or {}
    return str(room.get("room_type") or "").strip().lower()


def _messenger_is_direct_room(room: dict[str, Any] | None) -> bool:
    return _messenger_room_type(room) == "dm"


def _messenger_is_system_room(room: dict[str, Any] | None) -> bool:
    room = room or {}
    created_by = str(room.get("created_by") or "").strip().lower()
    if _messenger_is_direct_room(room):
        return False
    return created_by in {"", "system"}


def _messenger_member_role(value: Any) -> str:
    role = str(value or "").strip().lower()
    if role in {"owner", "admin", "member"}:
        return role
    return "member"


def _messenger_member_role_rank(value: Any) -> int:
    role = _messenger_member_role(value)
    if role == "owner":
        return 30
    if role == "admin":
        return 20
    if role == "member":
        return 10
    return 0


def _messenger_call_permission_level(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"member", "admin", "owner", "none"}:
        return normalized
    if normalized in {"all", "everyone"}:
        return "member"
    if normalized in {"deny", "disabled", "nobody", "off"}:
        return "none"
    return "member"


def _messenger_call_permission_rank(value: Any) -> int:
    level = _messenger_call_permission_level(value)
    if level == "owner":
        return _messenger_member_role_rank("owner")
    if level == "admin":
        return _messenger_member_role_rank("admin")
    if level == "member":
        return _messenger_member_role_rank("member")
    return 1000


def _messenger_channel_mode(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized == "stage":
        return "stage"
    return "voice"


def _messenger_channel_mode_label(value: Any) -> str:
    return "STAGE" if _messenger_channel_mode(value) == "stage" else "VOICE"


def _messenger_is_stage_room(room: dict[str, Any] | None) -> bool:
    room = room or {}
    if not _messenger_supports_calls(room):
        return False
    return _messenger_channel_mode(room.get("channel_mode")) == "stage"


def _messenger_room_channel_category(room: dict[str, Any] | None) -> str:
    room = room or {}
    return str(room.get("channel_category") or "").strip()


def _messenger_call_participant_stage_role(participant: dict[str, Any] | None) -> str:
    participant = participant or {}
    return "speaker" if str(participant.get("stage_role") or "").strip().lower() == "speaker" else "audience"


def _messenger_participant_can_speak_live(
    room: dict[str, Any] | None,
    participant: dict[str, Any] | None,
    current_user_id: str,
    current_user_role: str = "",
) -> bool:
    if _messenger_is_stage_room(room) and participant:
        return _messenger_call_participant_stage_role(participant) == "speaker"
    return _messenger_can_speak_in_call(room, current_user_id, current_user_role)


def _messenger_participant_can_use_video_live(
    room: dict[str, Any] | None,
    participant: dict[str, Any] | None,
    current_user_id: str,
    current_user_role: str = "",
) -> bool:
    if _messenger_is_stage_room(room) and participant and _messenger_call_participant_stage_role(participant) != "speaker":
        return False
    return _messenger_can_use_video_in_call(room, current_user_id, current_user_role)


def _messenger_participant_can_share_screen_live(
    room: dict[str, Any] | None,
    participant: dict[str, Any] | None,
    current_user_id: str,
    current_user_role: str = "",
) -> bool:
    if _messenger_is_stage_room(room) and participant and _messenger_call_participant_stage_role(participant) != "speaker":
        return False
    return _messenger_can_share_screen_in_call(room, current_user_id, current_user_role)


def _messenger_room_call_permissions(room: dict[str, Any] | None) -> dict[str, str]:
    pages_module = _pages()
    room = room or {}
    return pages_module.chat_repo.normalize_call_permissions(
        room.get("room_type"),
        room.get("call_permissions"),
        channel_mode=room.get("channel_mode"),
    )


def _messenger_room_member_role(room: dict[str, Any] | None, user_id: str) -> str:
    room = room or {}
    normalized_user_id = str(user_id or "").strip()
    if not normalized_user_id:
        return "member"
    direct_member_role = str(room.get("member_role") or "").strip()
    if direct_member_role:
        return _messenger_member_role(direct_member_role)
    for member in list(room.get("members") or []):
        if str((member or {}).get("user_id") or "").strip() != normalized_user_id:
            continue
        return _messenger_member_role((member or {}).get("member_role"))
    return "member"


def _messenger_room_has_member(room: dict[str, Any] | None, user_id: str) -> bool:
    room = room or {}
    normalized_user_id = str(user_id or "").strip()
    if not normalized_user_id:
        return False
    for member in list(room.get("members") or []):
        if str((member or {}).get("user_id") or "").strip() == normalized_user_id:
            return True
    return False


def _messenger_can_manage_room(
    room: dict[str, Any] | None,
    current_user_id: str,
    current_user_role: str = "",
) -> bool:
    pages_module = _pages()
    room = room or {}
    room_type = str(room.get("room_type") or "").strip().lower()
    if room_type == "dm":
        return False
    if pages_module._normalize_role(current_user_role) == "superuser":
        return True
    if _messenger_is_system_room(room):
        return False
    return str(room.get("created_by") or "").strip() == str(current_user_id or "").strip()


def _messenger_effective_member_rank(
    room: dict[str, Any] | None,
    current_user_id: str,
    current_user_role: str = "",
) -> int:
    pages_module = _pages()
    if pages_module._normalize_role(current_user_role) == "superuser":
        return 100
    if _messenger_can_manage_room(room, current_user_id, current_user_role):
        return _messenger_member_role_rank("owner")
    return _messenger_member_role_rank(_messenger_room_member_role(room, current_user_id))


def _messenger_has_call_permission(
    room: dict[str, Any] | None,
    current_user_id: str,
    permission_key: str,
    current_user_role: str = "",
) -> bool:
    pages_module = _pages()
    if not _messenger_supports_calls(room):
        return False
    permissions = _messenger_room_call_permissions(room)
    required_level = _messenger_call_permission_level(permissions.get(permission_key))
    if pages_module._normalize_role(current_user_role) == "superuser":
        return True
    if required_level == "none":
        return False
    actor_rank = _messenger_effective_member_rank(room, current_user_id, current_user_role)
    return actor_rank >= _messenger_call_permission_rank(required_level)


def _messenger_can_join_call(
    room: dict[str, Any] | None,
    current_user_id: str,
    current_user_role: str = "",
) -> bool:
    return _messenger_has_call_permission(room, current_user_id, "connect", current_user_role)


def _messenger_can_speak_in_call(
    room: dict[str, Any] | None,
    current_user_id: str,
    current_user_role: str = "",
) -> bool:
    return _messenger_has_call_permission(room, current_user_id, "speak", current_user_role)


def _messenger_can_use_video_in_call(
    room: dict[str, Any] | None,
    current_user_id: str,
    current_user_role: str = "",
) -> bool:
    return _messenger_has_call_permission(room, current_user_id, "video", current_user_role)


def _messenger_can_share_screen_in_call(
    room: dict[str, Any] | None,
    current_user_id: str,
    current_user_role: str = "",
) -> bool:
    return _messenger_has_call_permission(room, current_user_id, "screen_share", current_user_role)


def _messenger_can_invite_room_members(
    room: dict[str, Any] | None,
    current_user_id: str,
    current_user_role: str = "",
) -> bool:
    pages_module = _pages()
    room = room or {}
    room_type = str(room.get("room_type") or "").strip().lower()
    if room_type == "dm":
        return False
    normalized_role = pages_module._normalize_role(current_user_role)
    if normalized_role == "superuser":
        return True
    if _messenger_is_system_room(room):
        return False
    if _messenger_is_talk_room(room):
        return _messenger_effective_member_rank(room, current_user_id, current_user_role) >= _messenger_member_role_rank("admin")
    return _messenger_has_call_permission(room, current_user_id, "invite_members", current_user_role)


def _messenger_can_start_call(
    room: dict[str, Any] | None,
    current_user_id: str,
    current_user_role: str = "",
) -> bool:
    if not _messenger_supports_calls(room):
        return False
    return _messenger_has_call_permission(room, current_user_id, "start_call", current_user_role)


def _messenger_can_moderate_call(
    room: dict[str, Any] | None,
    current_user_id: str,
    current_user_role: str = "",
) -> bool:
    room = room or {}
    room_type = str(room.get("room_type") or "").strip().lower()
    if room_type == "dm" or not _messenger_supports_calls(room):
        return False
    return _messenger_has_call_permission(room, current_user_id, "moderate", current_user_role)


def _messenger_can_manage_room_members(
    room: dict[str, Any] | None,
    current_user_id: str,
    current_user_role: str = "",
) -> bool:
    pages_module = _pages()
    room = room or {}
    room_type = str(room.get("room_type") or "").strip().lower()
    if room_type == "dm":
        return False
    if pages_module._normalize_role(current_user_role) == "superuser":
        return True
    if _messenger_is_system_room(room):
        return False
    return _messenger_effective_member_rank(room, current_user_id, current_user_role) >= _messenger_member_role_rank("admin")


def _messenger_can_manage_member_roles(
    room: dict[str, Any] | None,
    current_user_id: str,
    current_user_role: str = "",
) -> bool:
    pages_module = _pages()
    room = room or {}
    room_type = str(room.get("room_type") or "").strip().lower()
    if room_type == "dm":
        return False
    if pages_module._normalize_role(current_user_role) == "superuser":
        return True
    if _messenger_is_system_room(room):
        return False
    return _messenger_effective_member_rank(room, current_user_id, current_user_role) >= _messenger_member_role_rank("owner")


def _messenger_can_change_room_member_role(
    room: dict[str, Any] | None,
    current_user_id: str,
    target_user_id: str,
    next_member_role: str,
    current_user_role: str = "",
) -> bool:
    room = room or {}
    normalized_target_user_id = str(target_user_id or "").strip()
    normalized_next_member_role = _messenger_member_role(next_member_role)
    if not normalized_target_user_id or normalized_target_user_id == str(current_user_id or "").strip():
        return False
    if normalized_next_member_role not in {"admin", "member"}:
        return False
    if not _messenger_room_has_member(room, normalized_target_user_id):
        return False
    if not _messenger_can_manage_member_roles(room, current_user_id, current_user_role):
        return False
    actor_rank = _messenger_effective_member_rank(room, current_user_id, current_user_role)
    target_rank = _messenger_member_role_rank(_messenger_room_member_role(room, normalized_target_user_id))
    if target_rank >= actor_rank:
        return False
    if target_rank >= _messenger_member_role_rank("owner"):
        return False
    return True


def _messenger_can_remove_room_member(
    room: dict[str, Any] | None,
    current_user_id: str,
    target_user_id: str,
    current_user_role: str = "",
) -> bool:
    room = room or {}
    normalized_target_user_id = str(target_user_id or "").strip()
    if not normalized_target_user_id or normalized_target_user_id == str(current_user_id or "").strip():
        return False
    if not _messenger_room_has_member(room, normalized_target_user_id):
        return False
    if not _messenger_can_manage_room_members(room, current_user_id, current_user_role):
        return False
    actor_rank = _messenger_effective_member_rank(room, current_user_id, current_user_role)
    target_rank = _messenger_member_role_rank(_messenger_room_member_role(room, normalized_target_user_id))
    if target_rank >= actor_rank:
        return False
    if target_rank >= _messenger_member_role_rank("owner"):
        return False
    return True


def _messenger_can_transfer_room_owner(
    room: dict[str, Any] | None,
    current_user_id: str,
    target_user_id: str,
    current_user_role: str = "",
) -> bool:
    pages_module = _pages()
    room = room or {}
    normalized_target_user_id = str(target_user_id or "").strip()
    room_type = str(room.get("room_type") or "").strip().lower()
    if room_type == "dm":
        return False
    if not normalized_target_user_id or normalized_target_user_id == str(current_user_id or "").strip():
        return False
    if _messenger_is_system_room(room):
        return False
    actor_is_superuser = pages_module._normalize_role(current_user_role) == "superuser"
    actor_is_owner = str(room.get("created_by") or "").strip() == str(current_user_id or "").strip()
    if not actor_is_superuser and not actor_is_owner:
        return False
    if not _messenger_room_has_member(room, normalized_target_user_id):
        return False
    if _messenger_room_member_role(room, normalized_target_user_id) == "owner":
        return False
    return True


def _messenger_member_display_name(
    room: dict[str, Any] | None,
    user_id: str,
    user_directory: dict[str, dict[str, Any]] | None = None,
) -> str:
    normalized_user_id = str(user_id or "").strip()
    if not normalized_user_id:
        return ""
    user_directory = user_directory or {}
    member = next(
        (
            member_row
            for member_row in list((room or {}).get("members") or [])
            if str((member_row or {}).get("user_id") or "").strip() == normalized_user_id
        ),
        None,
    ) or {}
    directory_item = user_directory.get(normalized_user_id) or {}
    display_name = (
        str(directory_item.get("display_name") or "").strip()
        or str(member.get("display_name") or "").strip()
        or str(member.get("nickname") or "").strip()
        or str(member.get("name") or "").strip()
        or normalized_user_id
    )
    return display_name


def _messenger_can_edit_message(
    message: dict[str, Any] | None,
    current_user_id: str,
    current_user_role: str = "",
) -> bool:
    message = message or {}
    if str(message.get("deleted_at") or "").strip():
        return False
    if str(message.get("message_type") or "text").strip().lower() != "text":
        return False
    return str(message.get("sender_user_id") or "").strip() == str(current_user_id or "").strip()


def _messenger_can_delete_message(
    message: dict[str, Any] | None,
    current_user_id: str,
    *,
    current_user_role: str = "",
    room_can_manage: bool = False,
) -> bool:
    pages_module = _pages()
    message = message or {}
    if str(message.get("deleted_at") or "").strip():
        return False
    if str(message.get("message_type") or "text").strip().lower() == "system":
        return False
    if room_can_manage or pages_module._normalize_role(current_user_role) == "superuser":
        return True
    return str(message.get("sender_user_id") or "").strip() == str(current_user_id or "").strip()


def _approved_user_rows() -> list[dict[str, Any]]:
    pages_module = _pages()
    rows = pages_module.user_repo.list_user_rows() or []
    approved_rows = [
        row
        for row in rows
        if pages_module._normalize_approval_status(row.get("APPROVAL_STATUS") or "") == "approved"
    ]
    approved_rows.sort(
        key=lambda row: (
            str(row.get("DEPARTMENT") or "").strip(),
            pages_module._display_user_name(row).lower(),
            str(row.get("ID") or "").strip().lower(),
        )
    )
    return approved_rows


def _build_messenger_user_directory(current_user_id: str) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
    pages_module = _pages()
    presence_map = pages_module._build_integrated_admin_presence_state_map()
    approved_rows = _approved_user_rows()
    directory: dict[str, dict[str, Any]] = {}
    contacts: list[dict[str, Any]] = []
    for row in approved_rows:
        user_view = _messenger_user_view_from_row(row, presence_map, current_user_id=current_user_id)
        user_id = str(user_view.get("user_id") or "").strip()
        if not user_id:
            continue
        directory[user_id] = user_view
        if user_id != current_user_id:
            contacts.append(user_view)

    if current_user_id and current_user_id not in directory:
        current_row = pages_module.read_user(current_user_id) or {"user_id": current_user_id}
        directory[current_user_id] = _messenger_user_view_from_row(current_row, presence_map, current_user_id=current_user_id)

    contacts.sort(
        key=lambda item: (
            0 if item.get("is_online") else 1,
            str(item.get("department") or ""),
            str(item.get("display_name") or "").lower(),
        )
    )
    return directory, contacts


def _messenger_room_view(
    room: dict[str, Any] | None,
    current_user_id: str,
    user_directory: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    pages_module = _pages()
    room = room or {}
    room_id = int(room.get("id") or 0)
    if room_id <= 0:
        return None

    raw_members = list(room.get("members") or [])
    member_views: list[dict[str, Any]] = []
    for member in raw_members:
        member_id = str((member or {}).get("user_id") or "").strip()
        base_view = dict(user_directory.get(member_id) or _messenger_user_view_from_row(member, {}, current_user_id=current_user_id))
        base_view["member_role"] = str((member or {}).get("member_role") or "member").strip().lower() or "member"
        member_views.append(base_view)

    member_views.sort(key=lambda item: (0 if item.get("user_id") == current_user_id else 1, str(item.get("display_name") or "").lower()))
    room_type = str(room.get("room_type") or "group").strip().lower() or "group"
    app_domain = _messenger_room_app_domain(room)
    is_ascord = app_domain == "ascord"
    supports_calls = _messenger_supports_calls(room)
    current_user_role = _messenger_current_user_role(current_user_id, user_directory)
    can_manage_room = _messenger_can_manage_room(room, current_user_id, current_user_role)
    can_invite_members = _messenger_can_invite_room_members(room, current_user_id, current_user_role)
    can_join_call = _messenger_can_join_call(room, current_user_id, current_user_role)
    can_start_call = _messenger_can_start_call(room, current_user_id, current_user_role)
    can_speak_in_call = _messenger_can_speak_in_call(room, current_user_id, current_user_role)
    can_use_video_in_call = _messenger_can_use_video_in_call(room, current_user_id, current_user_role)
    can_share_screen_in_call = _messenger_can_share_screen_in_call(room, current_user_id, current_user_role)
    can_moderate_call = _messenger_can_moderate_call(room, current_user_id, current_user_role)
    can_manage_members = _messenger_can_manage_room_members(room, current_user_id, current_user_role)
    can_manage_member_roles = _messenger_can_manage_member_roles(room, current_user_id, current_user_role)
    call_permissions = _messenger_room_call_permissions(room)
    channel_mode = _messenger_channel_mode(room.get("channel_mode"))
    channel_category = _messenger_room_channel_category(room)
    recent_call_views = [
        call_view
        for call_view in (
            _messenger_call_log_view(item, user_directory)
            for item in list(room.get("recent_calls") or [])
        )
        if call_view
    ] if supports_calls else []
    created_by = str(room.get("created_by") or "").strip()
    other_member = next((member for member in member_views if member.get("user_id") != current_user_id), None)
    last_sender_user_id = str(room.get("last_sender_user_id") or "").strip()
    last_sender = user_directory.get(last_sender_user_id) or {}
    preview = str(room.get("last_message_preview") or "").strip()
    if room_type in {"channel", "group"} and preview and last_sender_user_id:
        sender_name = (
            _messenger_system_sender_label(room)
            if last_sender_user_id == "system"
            else ("나" if last_sender_user_id == current_user_id else str(last_sender.get("display_name") or last_sender_user_id))
        )
        preview = f"{sender_name}: {preview}"
    elif not preview:
        preview = str(room.get("topic") or "").strip() or "대화를 시작해보세요."

    if room_type == "dm":
        title = str((other_member or {}).get("display_name") or "새 대화")
        subtitle = str((other_member or {}).get("department") or "").strip() or str((other_member or {}).get("presence_label") or "1:1 대화")
        avatar_initial = str((other_member or {}).get("avatar_initial") or "D")
        avatar_url = str((other_member or {}).get("profile_image_url") or "")
        presence_state = str((other_member or {}).get("presence_state") or "inactive")
        presence_label = str((other_member or {}).get("presence_label") or "오프라인")
        section = "direct"
    else:
        title = str(room.get("name") or "").strip() or "그룹 대화"
        subtitle = str(room.get("topic") or "").strip() or f"{len(member_views)}명 참여"
        avatar_initial = pages_module._profile_avatar_initial(title, "C" if room_type == "channel" else "G")
        avatar_url = pages_module._messenger_room_avatar_url_from_value(room.get("avatar_path"))
        presence_state = "inactive"
        presence_label = "채널" if room_type == "channel" else "그룹"
        section = "channel" if room_type == "channel" else "group"

    if bool(room.get("is_starred")):
        section = "starred"

    active_member_count = sum(1 for member in member_views if member.get("presence_state") in {"live", "background"})
    return {
        "id": room_id,
        "room_type": room_type,
        "room_key": str(room.get("room_key") or "").strip(),
        "app_domain": app_domain,
        "is_ascord": is_ascord,
        "is_talk": not is_ascord,
        "supports_calls": supports_calls,
        "created_by": created_by,
        "title": title,
        "subtitle": subtitle,
        "topic": str(room.get("topic") or "").strip(),
        "channel_category": channel_category,
        "channel_mode": channel_mode,
        "channel_mode_label": _messenger_channel_mode_label(channel_mode),
        "channel_sort_order": int(room.get("channel_sort_order") or 0),
        "avatar_initial": avatar_initial,
        "avatar_url": avatar_url,
        "avatar_path": str(room.get("avatar_path") or "").strip(),
        "presence_state": presence_state,
        "presence_label": presence_label,
        "presence_tone": _messenger_presence_tone(presence_state),
        "is_starred": bool(room.get("is_starred")),
        "is_muted": bool(room.get("is_muted")),
        "member_role": str(room.get("member_role") or "member").strip().lower() or "member",
        "member_count": len(member_views),
        "active_member_count": active_member_count,
        "members": member_views,
        "member_names": ", ".join(str(member.get("display_name") or "") for member in member_views[:4]),
        "unread_count": max(int(room.get("unread_count") or 0), 0),
        "last_message_id": int(room.get("last_message_id") or 0),
        "last_message_at": str(room.get("last_message_at") or "").strip(),
        "last_message_time_text": _messenger_time_text(room.get("last_message_at")),
        "last_message_preview": preview,
        "last_sender_user_id": last_sender_user_id,
        "other_user_id": str((other_member or {}).get("user_id") or ""),
        "section": section,
        "is_system_room": _messenger_is_system_room(room),
        "can_manage_room": can_manage_room,
        "can_edit_room": can_manage_room,
        "can_delete_room": can_manage_room,
        "can_edit_avatar": can_manage_room,
        "can_invite_members": can_invite_members,
        "can_join_call": can_join_call,
        "can_start_call": can_start_call,
        "can_speak_in_call": can_speak_in_call,
        "can_use_video_in_call": can_use_video_in_call,
        "can_share_screen_in_call": can_share_screen_in_call,
        "can_moderate_call": can_moderate_call,
        "can_manage_members": can_manage_members,
        "can_manage_member_roles": can_manage_member_roles,
        "call_permissions": call_permissions,
        "recent_calls": recent_call_views,
        "missed_call_total": sum(1 for item in recent_call_views if item.get("status") == "missed"),
        "is_direct": room_type == "dm",
        "is_channel": room_type == "channel",
        "is_group": room_type == "group",
    }


def _messenger_message_view(
    message: dict[str, Any] | None,
    current_user_id: str,
    user_directory: dict[str, dict[str, Any]],
    *,
    room: dict[str, Any] | None = None,
    current_user_role: str = "",
    room_can_manage: bool = False,
) -> dict[str, Any] | None:
    pages_module = _pages()
    message = message or {}
    message_id = int(message.get("id") or 0)
    if message_id <= 0:
        return None

    sender_user_id = str(message.get("sender_user_id") or "").strip()
    sender_view = dict(user_directory.get(sender_user_id) or _messenger_user_view_from_row(
        {
            "user_id": sender_user_id,
            "nickname": message.get("sender_nickname"),
            "name": message.get("sender_name"),
            "department": message.get("sender_department"),
            "profile_image_path": message.get("sender_profile_image_path"),
            "role": message.get("sender_role"),
        },
        {},
        current_user_id=current_user_id,
    ))
    created_at = str(message.get("created_at") or "").strip()
    message_type = str(message.get("message_type") or "text").strip().lower() or "text"
    is_system_message = message_type == "system" or sender_user_id == "system"
    attachment = _messenger_attachment_from_content(message_type, message.get("content"))
    sender_display_name = _messenger_system_sender_label(room) if is_system_message else str(sender_view.get("display_name") or sender_user_id)
    return {
        "id": message_id,
        "room_id": int(message.get("room_id") or 0),
        "sender_user_id": sender_user_id,
        "sender_display_name": sender_display_name,
        "sender_nickname": str(sender_view.get("nickname") or ""),
        "sender_name": str(sender_view.get("name") or ""),
        "sender_avatar_initial": "A" if is_system_message else str(sender_view.get("avatar_initial") or pages_module._profile_avatar_initial(sender_user_id, "U")),
        "sender_avatar_url": "" if is_system_message else str(sender_view.get("profile_image_url") or ""),
        "sender_department": "" if is_system_message else str(sender_view.get("department") or ""),
        "sender_role_label": "SYSTEM" if is_system_message else str(sender_view.get("role_label") or pages_module._role_label(sender_view.get("role") or "")),
        "system_badge_label": _messenger_system_sender_label(room) if is_system_message else "",
        "sender_presence_tone": str(sender_view.get("presence_tone") or "offline"),
        "sender_presence_label": str(sender_view.get("presence_label") or ""),
        "sender_presence_page_text": str(sender_view.get("presence_page_text") or ""),
        "message_type": message_type,
        "content": str(message.get("content") or ""),
        "attachment": attachment,
        "preview_text": _messenger_message_preview_for_view(message_type, message.get("content")),
        "created_at": created_at,
        "created_date": created_at[:10] if len(created_at) >= 10 else "",
        "time_text": _messenger_time_text(created_at),
        "is_mine": (sender_user_id == current_user_id) and not is_system_message,
        "edited": bool(str(message.get("edited_at") or "").strip()),
        "can_edit": _messenger_can_edit_message(message, current_user_id, current_user_role),
        "can_delete": _messenger_can_delete_message(
            message,
            current_user_id,
            current_user_role=current_user_role,
            room_can_manage=room_can_manage,
        ),
    }


__all__ = [
    "_approved_user_rows",
    "_build_messenger_user_directory",
    "_messenger_attachment_from_content",
    "_messenger_call_log_view",
    "_messenger_call_participant_stage_role",
    "_messenger_call_permission_level",
    "_messenger_call_permission_rank",
    "_messenger_can_change_room_member_role",
    "_messenger_can_delete_message",
    "_messenger_can_edit_message",
    "_messenger_can_invite_room_members",
    "_messenger_can_join_call",
    "_messenger_can_manage_member_roles",
    "_messenger_can_manage_room",
    "_messenger_can_manage_room_members",
    "_messenger_can_moderate_call",
    "_messenger_can_remove_room_member",
    "_messenger_can_share_screen_in_call",
    "_messenger_can_speak_in_call",
    "_messenger_can_start_call",
    "_messenger_can_transfer_room_owner",
    "_messenger_can_use_video_in_call",
    "_messenger_channel_mode",
    "_messenger_channel_mode_label",
    "_messenger_current_user_role",
    "_messenger_duration_text",
    "_messenger_effective_member_rank",
    "_messenger_has_call_permission",
    "_messenger_human_size",
    "_messenger_is_ascord_room",
    "_messenger_is_direct_room",
    "_messenger_is_stage_room",
    "_messenger_is_system_room",
    "_messenger_is_talk_room",
    "_messenger_member_display_name",
    "_messenger_member_role",
    "_messenger_member_role_rank",
    "_messenger_message_preview_for_view",
    "_messenger_message_view",
    "_messenger_participant_can_share_screen_live",
    "_messenger_participant_can_speak_live",
    "_messenger_participant_can_use_video_live",
    "_messenger_presence_badge_label",
    "_messenger_presence_tone",
    "_messenger_preview_text",
    "_messenger_room_app_domain",
    "_messenger_room_call_permissions",
    "_messenger_room_channel_category",
    "_messenger_room_has_member",
    "_messenger_room_member_role",
    "_messenger_room_type",
    "_messenger_room_view",
    "_messenger_supports_calls",
    "_messenger_system_sender_label",
    "_messenger_time_text",
    "_messenger_unique_user_ids",
    "_messenger_user_view_from_row",
]
