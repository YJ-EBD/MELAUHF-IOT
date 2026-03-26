from __future__ import annotations

import re
from typing import Any


def _pages():
    from router import pages as pages_module

    return pages_module


def _build_messenger_room_views(current_user_id: str, user_directory: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    pages_module = _pages()
    rooms = pages_module.chat_repo.list_rooms_for_user(current_user_id)
    room_views = [pages_module._messenger_room_view(room, current_user_id, user_directory) for room in rooms]
    return [room for room in room_views if room]


def _preferred_bootstrap_room_id(room_views: list[dict[str, Any]]) -> int:
    rooms = [room for room in (room_views or []) if isinstance(room, dict)]
    if not rooms:
        return 0

    for room in rooms:
        if str(room.get("room_key") or "").strip().lower() == "ascord:global":
            return int(room.get("id") or 0)

    for room in rooms:
        if (
            str(room.get("app_domain") or "").strip().lower() == "ascord"
            and str(room.get("title") or "").strip() == "전체 채널"
        ):
            return int(room.get("id") or 0)

    return int(rooms[0].get("id") or 0)


def _messenger_notification_aliases(current_user_id: str, current_user: dict[str, Any] | None) -> list[str]:
    current_user = current_user or {}
    candidates = [
        current_user_id,
        current_user.get("display_name"),
        current_user.get("nickname"),
        current_user.get("name"),
    ]
    aliases: list[str] = []
    seen: set[str] = set()
    for value in candidates:
        text = str(value or "").strip()
        if not text:
            continue
        variants = [text]
        squashed = re.sub(r"\s+", "", text)
        if squashed and squashed != text:
            variants.append(squashed)
        for variant in variants:
            lowered = variant.lower()
            if lowered in seen:
                continue
            seen.add(lowered)
            aliases.append(variant)
    return aliases


def _messenger_message_mentions_user(content: Any, current_user_id: str, current_user: dict[str, Any] | None) -> bool:
    text = str(content or "").strip()
    if not text:
        return False
    lowered = text.lower()
    for alias in _messenger_notification_aliases(current_user_id, current_user):
        alias_text = str(alias or "").strip()
        if not alias_text:
            continue
        pattern = re.compile(
            rf"(?<!\S)@{re.escape(alias_text)}(?=$|[\s.,!?;:)\]}}>\"])",
            re.IGNORECASE,
        )
        if pattern.search(text):
            return True
        if ("@" + alias_text.lower()) in lowered:
            return True
    return False


def _build_messenger_notifications_payload(
    current_user_id: str,
    user_directory: dict[str, dict[str, Any]],
    room_views: list[dict[str, Any]],
    current_user: dict[str, Any] | None = None,
) -> dict[str, Any]:
    pages_module = _pages()
    room_map = {int(room.get("id") or 0): room for room in (room_views or []) if int(room.get("id") or 0) > 0}
    current_user = current_user or user_directory.get(current_user_id) or {}
    raw_notifications = pages_module.chat_repo.list_recent_notifications_for_user(current_user_id, limit=16)
    items: list[dict[str, Any]] = []

    for row in raw_notifications:
        room_id = int(row.get("room_id") or 0)
        room_view = room_map.get(room_id)
        if (not room_view) or bool(room_view.get("is_muted")):
            continue
        message_view = pages_module._messenger_message_view(row, current_user_id, user_directory, room=room_view)
        if not message_view:
            continue
        content_preview = pages_module._messenger_preview_text(message_view.get("preview_text"), limit=92)
        is_mention = _messenger_message_mentions_user(message_view.get("content"), current_user_id, current_user)
        sender_display_name = str(message_view.get("sender_display_name") or "")
        items.append(
            {
                "id": f"room-{room_id}-message-{int(message_view.get('id') or 0)}",
                "room_id": room_id,
                "message_id": int(message_view.get("id") or 0),
                "kind": "mention" if is_mention else "message",
                "kind_label": "멘션" if is_mention else "새 메시지",
                "is_unread": bool(row.get("is_unread")),
                "room_title": str(room_view.get("title") or "대화방"),
                "room_type": str(room_view.get("room_type") or "group"),
                "room_avatar_initial": str(room_view.get("avatar_initial") or "C"),
                "room_avatar_url": str(room_view.get("avatar_url") or ""),
                "sender_display_name": sender_display_name,
                "sender_avatar_initial": str(message_view.get("sender_avatar_initial") or "U"),
                "sender_avatar_url": str(message_view.get("sender_avatar_url") or ""),
                "sender_department": str(message_view.get("sender_department") or ""),
                "preview": content_preview,
                "summary": f"{sender_display_name}: {content_preview}" if content_preview else sender_display_name,
                "created_at": str(message_view.get("created_at") or ""),
                "time_text": str(message_view.get("time_text") or ""),
            }
        )

    counts = {
        "total": len(items),
        "unread_total": sum(1 for item in items if item.get("is_unread")),
        "mention_total": sum(1 for item in items if item.get("kind") == "mention"),
        "unread_mention_total": sum(1 for item in items if item.get("kind") == "mention" and item.get("is_unread")),
    }
    return {"items": items, "counts": counts}


def _build_messenger_bootstrap_payload(current_user_id: str, *, requested_room_id: int = 0) -> dict[str, Any]:
    pages_module = _pages()
    pages_module.chat_repo.ensure_default_rooms()
    user_directory, contacts = pages_module._build_messenger_user_directory(current_user_id)
    room_views = _build_messenger_room_views(current_user_id, user_directory)
    selected_room_id = 0
    if requested_room_id > 0 and any(int(room.get("id") or 0) == int(requested_room_id) for room in room_views):
        selected_room_id = int(requested_room_id)
    elif room_views:
        selected_room_id = _preferred_bootstrap_room_id(room_views)
    if selected_room_id > 0:
        selected_recent_calls = pages_module.chat_repo.list_call_logs_for_room(selected_room_id, limit=6)
        room_views = [
            dict(room, recent_calls=selected_recent_calls) if int(room.get("id") or 0) == selected_room_id else room
            for room in room_views
        ]

    current_user = user_directory.get(current_user_id) or pages_module._messenger_user_view_from_row(
        pages_module.read_user(current_user_id) or {"user_id": current_user_id},
        {},
        current_user_id=current_user_id,
    )
    notifications = _build_messenger_notifications_payload(current_user_id, user_directory, room_views, current_user)
    counts = {
        "room_total": len(room_views),
        "unread_total": sum(int(room.get("unread_count") or 0) for room in room_views),
        "starred_total": sum(1 for room in room_views if room.get("is_starred")),
        "channel_total": sum(1 for room in room_views if room.get("is_channel")),
        "group_total": sum(1 for room in room_views if room.get("is_group")),
        "direct_total": sum(1 for room in room_views if room.get("is_direct")),
        "online_contacts": sum(1 for contact in contacts if contact.get("is_online")),
        "notification_total": int((notifications.get("counts") or {}).get("total") or 0),
        "unread_notification_total": int((notifications.get("counts") or {}).get("unread_total") or 0),
        "mention_total": int((notifications.get("counts") or {}).get("mention_total") or 0),
    }
    return {
        "current_user": current_user,
        "rooms": room_views,
        "contacts": contacts,
        "counts": counts,
        "notifications": notifications,
        "active_room_id": selected_room_id,
    }


def _build_messenger_room_messages_payload(
    current_user_id: str,
    room_id: int,
    *,
    limit: int = 80,
    before_message_id: int = 0,
) -> dict[str, Any] | None:
    pages_module = _pages()
    user_directory, _contacts = pages_module._build_messenger_user_directory(current_user_id)
    room = pages_module.chat_repo.get_room_for_user(room_id, current_user_id)
    if not room:
        return None
    room = dict(room)
    room["recent_calls"] = pages_module.chat_repo.list_call_logs_for_room(room_id, limit=6) if pages_module._messenger_supports_calls(room) else []

    room_view = pages_module._messenger_room_view(room, current_user_id, user_directory)
    if not room_view:
        return None

    current_user_role = pages_module._messenger_current_user_role(current_user_id, user_directory)
    messages = pages_module.chat_repo.list_messages_for_user(current_user_id, room_id, limit=limit, before_message_id=before_message_id)
    message_views = [
        pages_module._messenger_message_view(
            message,
            current_user_id,
            user_directory,
            room=room,
            current_user_role=current_user_role,
            room_can_manage=bool(room_view.get("can_manage_room")),
        )
        for message in messages
    ]
    filtered_messages = [message for message in message_views if message]
    next_before_message_id = int(filtered_messages[0].get("id") or 0) if filtered_messages else 0
    return {
        "room": room_view,
        "messages": filtered_messages,
        "next_before_message_id": next_before_message_id,
    }


def _build_single_messenger_room_payload(current_user_id: str, room_id: int) -> dict[str, Any] | None:
    pages_module = _pages()
    user_directory, _contacts = pages_module._build_messenger_user_directory(current_user_id)
    room = pages_module.chat_repo.get_room_for_user(room_id, current_user_id)
    if not room:
        return None
    room = dict(room)
    room["recent_calls"] = pages_module.chat_repo.list_call_logs_for_room(room_id, limit=6) if pages_module._messenger_supports_calls(room) else []
    return pages_module._messenger_room_view(room, current_user_id, user_directory)


def _build_single_messenger_message_payload(
    current_user_id: str,
    message: dict[str, Any] | None,
) -> dict[str, Any] | None:
    pages_module = _pages()
    user_directory, _contacts = pages_module._build_messenger_user_directory(current_user_id)
    current_user_role = pages_module._messenger_current_user_role(current_user_id, user_directory)
    room_id = int((message or {}).get("room_id") or 0)
    room = pages_module.chat_repo.get_room_for_user(room_id, current_user_id) if room_id > 0 else None
    room_view = pages_module._messenger_room_view(room, current_user_id, user_directory) if room else None
    return pages_module._messenger_message_view(
        message,
        current_user_id,
        user_directory,
        room=room,
        current_user_role=current_user_role,
        room_can_manage=bool((room_view or {}).get("can_manage_room")),
    )


def _build_messenger_user_profile_payload(
    current_user_id: str,
    target_user_id: str,
) -> dict[str, Any] | None:
    pages_module = _pages()
    normalized_target_user_id = str(target_user_id or "").strip()
    if not normalized_target_user_id:
        return None

    user_directory, _contacts = pages_module._build_messenger_user_directory(current_user_id)
    target_row = pages_module.read_user(normalized_target_user_id) or {}
    if not target_row and normalized_target_user_id not in user_directory:
        return None

    presence_map = pages_module._build_integrated_admin_presence_state_map()
    user_view = dict(
        user_directory.get(normalized_target_user_id)
        or pages_module._messenger_user_view_from_row(
            target_row or {"user_id": normalized_target_user_id},
            presence_map,
            current_user_id=current_user_id,
        )
    )
    profile_form = pages_module._build_profile_form(normalized_target_user_id, target_row)
    return {
        "user_id": normalized_target_user_id,
        "display_name": str(user_view.get("display_name") or profile_form.get("display_name") or normalized_target_user_id),
        "nickname": str(profile_form.get("nickname") or user_view.get("nickname") or ""),
        "name": str(profile_form.get("name") or ""),
        "department": str(user_view.get("department") or profile_form.get("department") or ""),
        "role": str(user_view.get("role") or profile_form.get("role") or "user"),
        "role_label": str(user_view.get("role_label") or profile_form.get("role_label") or "USER"),
        "profile_image_url": str(profile_form.get("profile_image_url") or user_view.get("profile_image_url") or ""),
        "avatar_initial": str(user_view.get("avatar_initial") or profile_form.get("avatar_initial") or pages_module._profile_avatar_initial(normalized_target_user_id, normalized_target_user_id)),
        "presence_label": str(user_view.get("presence_label") or ""),
        "presence_page_text": str(user_view.get("presence_page_text") or ""),
        "presence_tone": str(user_view.get("presence_tone") or "offline"),
        "is_self": normalized_target_user_id == current_user_id,
        "email": str(profile_form.get("email") or ""),
        "phone": str(profile_form.get("phone") or ""),
        "location": str(profile_form.get("location") or ""),
        "bio": str(profile_form.get("bio") or ""),
        "join_date": str(profile_form.get("join_date") or ""),
    }


__all__ = [
    "_build_messenger_bootstrap_payload",
    "_build_messenger_notifications_payload",
    "_build_messenger_room_messages_payload",
    "_build_messenger_room_views",
    "_build_messenger_user_profile_payload",
    "_build_single_messenger_message_payload",
    "_build_single_messenger_room_payload",
    "_messenger_message_mentions_user",
    "_messenger_notification_aliases",
]
