from __future__ import annotations

from typing import Any

from router.messenger_payloads import (
    _build_messenger_bootstrap_payload,
    _build_single_messenger_message_payload,
    _build_single_messenger_room_payload,
)
from router.messenger_runtime import _MESSENGER_CALL_HUB, _MESSENGER_HUB


def _pages():
    from router import pages as pages_module

    return pages_module


def _messenger_call_log_system_text(call_log: dict[str, Any] | None) -> str:
    pages_module = _pages()
    call_log = call_log or {}
    status = str(call_log.get("status") or "").strip().lower() or "ended"
    duration_text = pages_module._messenger_duration_text(call_log.get("duration_sec"))
    starter_name = (
        str(call_log.get("started_by_display_name") or "").strip()
        or str(call_log.get("started_by_nickname") or "").strip()
        or str(call_log.get("started_by_name") or "").strip()
        or str(call_log.get("started_by_user_id") or "").strip()
        or "알 수 없음"
    )
    participant_peak = max(int(call_log.get("max_participant_count") or 0), 1)
    if status == "missed":
        return f"부재중 통화 · {starter_name}님이 {duration_text} 동안 연결을 시도했습니다."
    return f"ASCORD 통화 종료 · {duration_text} · 최대 {participant_peak}명 연결"


async def _messenger_record_call_started(
    room_id: int,
    room_call: dict[str, Any] | None,
    *,
    actor_user_id: str,
    media_mode: str = "audio",
) -> dict[str, Any] | None:
    pages_module = _pages()
    room_call = room_call or {}
    call_id = str(room_call.get("call_id") or "").strip()
    if int(room_id or 0) <= 0 or not call_id:
        return None
    participant_count = max(int(room_call.get("participant_count") or 0), 1)
    return await pages_module.asyncio.to_thread(
        pages_module.chat_repo.create_call_log,
        room_id,
        call_id,
        actor_user_id,
        initiated_mode=media_mode,
        participant_count=participant_count,
    )


async def _messenger_update_call_activity(room_call: dict[str, Any] | None) -> dict[str, Any] | None:
    pages_module = _pages()
    room_call = room_call or {}
    call_id = str(room_call.get("call_id") or "").strip()
    if not call_id:
        return None
    participant_count = max(int(room_call.get("participant_count") or 0), 1)
    return await pages_module.asyncio.to_thread(
        pages_module.chat_repo.update_call_log_activity,
        call_id,
        participant_count=participant_count,
    )


async def _messenger_finalize_call_log(
    room_id: int,
    previous_room_call: dict[str, Any] | None,
    *,
    notify_user_ids: list[str] | None = None,
) -> dict[str, Any] | None:
    pages_module = _pages()
    previous_room_call = previous_room_call or {}
    target_room_id = int(room_id or previous_room_call.get("room_id") or 0)
    call_id = str(previous_room_call.get("call_id") or "").strip()
    if target_room_id <= 0 or not call_id:
        return None

    existing_log = await pages_module.asyncio.to_thread(pages_module.chat_repo.get_call_log_by_call_id, call_id)
    participant_peak = max(
        int((existing_log or {}).get("max_participant_count") or 0),
        int(previous_room_call.get("participant_count") or 0),
        1,
    )
    completed_log = await pages_module.asyncio.to_thread(
        pages_module.chat_repo.finish_call_log,
        call_id,
        status="missed" if participant_peak <= 1 else "ended",
        participant_count=participant_peak,
    )
    if not completed_log or not completed_log.get("just_completed"):
        return completed_log
    room = await pages_module.asyncio.to_thread(pages_module.chat_repo.get_room_by_id, target_room_id)
    if not pages_module._messenger_supports_calls(room):
        return completed_log

    system_message = await pages_module.asyncio.to_thread(
        pages_module.chat_repo.insert_system_message,
        target_room_id,
        _messenger_call_log_system_text(completed_log),
    )
    target_user_ids = [str(user_id or "").strip() for user_id in list(notify_user_ids or []) if str(user_id or "").strip()]
    if not target_user_ids:
        target_user_ids = await pages_module.asyncio.to_thread(pages_module.chat_repo.list_room_user_ids, target_room_id)
    if target_user_ids:
        await _messenger_emit_message_created(target_user_ids, system_message)
        await _messenger_emit_room_updates(target_user_ids, target_room_id)
    return completed_log


async def _messenger_emit_call_state(user_ids: list[str], room_id: int) -> None:
    pages_module = _pages()
    room_call = await _MESSENGER_CALL_HUB.get_room_call(room_id)
    target_room_id = int(room_id or 0)
    if target_room_id <= 0:
        return
    room = await pages_module.asyncio.to_thread(pages_module.chat_repo.get_room_by_id, target_room_id)
    if not pages_module._messenger_supports_calls(room):
        payload = {"type": "call_cleared", "room_id": target_room_id}
    else:
        payload = (
            {"type": "call_state", "call": room_call}
            if room_call
            else {"type": "call_cleared", "room_id": target_room_id}
        )
    for user_id in pages_module._messenger_unique_user_ids(user_ids):
        await _MESSENGER_HUB.send_to_user(user_id, payload)


async def _messenger_emit_call_state_to_user(user_id: str, room_id: int) -> None:
    pages_module = _pages()
    room_call = await _MESSENGER_CALL_HUB.get_room_call(room_id)
    target_room_id = int(room_id or 0)
    if target_room_id <= 0:
        return
    room = await pages_module.asyncio.to_thread(pages_module.chat_repo.get_room_by_id, target_room_id)
    payload = {"type": "call_cleared", "room_id": target_room_id}
    if pages_module._messenger_supports_calls(room) and room_call:
        payload = {"type": "call_state", "call": room_call}
    await _MESSENGER_HUB.send_to_user(user_id, payload)


async def _messenger_emit_call_admin_control(
    user_id: str,
    *,
    room_id: int,
    action: str,
    actor_user_id: str = "",
) -> None:
    target_room_id = int(room_id or 0)
    normalized_user_id = str(user_id or "").strip()
    if target_room_id <= 0 or not normalized_user_id:
        return
    await _MESSENGER_HUB.send_to_user(
        normalized_user_id,
        {
            "type": "call_admin_control",
            "room_id": target_room_id,
            "action": str(action or "").strip().lower(),
            "actor_user_id": str(actor_user_id or "").strip(),
            "target_user_id": normalized_user_id,
        },
    )


async def _messenger_emit_system_message(
    user_ids: list[str],
    room_id: int,
    content: str,
) -> dict[str, Any] | None:
    pages_module = _pages()
    target_room_id = int(room_id or 0)
    normalized_content = str(content or "").strip()
    if target_room_id <= 0 or not normalized_content:
        return None
    system_message = await pages_module.asyncio.to_thread(
        pages_module.chat_repo.insert_system_message,
        target_room_id,
        normalized_content,
    )
    if system_message:
        await _messenger_emit_message_created(user_ids, system_message)
    return system_message


async def _messenger_emit_notifications_update(user_ids: list[str]) -> None:
    pages_module = _pages()
    for user_id in pages_module._messenger_unique_user_ids(user_ids):
        payload = await pages_module.asyncio.to_thread(_build_messenger_bootstrap_payload, user_id, requested_room_id=0)
        await _MESSENGER_HUB.send_to_user(
            user_id,
            {
                "type": "notifications_updated",
                "notifications": payload.get("notifications") or {"items": [], "counts": {}},
                "counts": payload.get("counts") or {},
            },
        )


async def _messenger_emit_room_update(user_id: str, room_id: int) -> None:
    pages_module = _pages()
    room_payload = await pages_module.asyncio.to_thread(_build_single_messenger_room_payload, user_id, room_id)
    if room_payload is None:
        await _MESSENGER_HUB.send_to_user(user_id, {"type": "room_removed", "room_id": int(room_id)})
        return
    await _MESSENGER_HUB.send_to_user(user_id, {"type": "room_updated", "room": room_payload})


async def _messenger_emit_room_updates(user_ids: list[str], room_id: int) -> None:
    pages_module = _pages()
    for user_id in pages_module._messenger_unique_user_ids(user_ids):
        await _messenger_emit_room_update(user_id, room_id)


async def _messenger_emit_room_state_for_users(user_ids: list[str], room_id: int, *, notify: bool = False) -> None:
    await _messenger_emit_room_updates(user_ids, room_id)
    if notify:
        await _messenger_emit_notifications_update(user_ids)


async def _messenger_refresh_room_state(room_id: int, *, notify: bool = False) -> list[str]:
    pages_module = _pages()
    participant_ids = await pages_module.asyncio.to_thread(pages_module.chat_repo.list_room_user_ids, room_id)
    await _messenger_emit_room_state_for_users(participant_ids, room_id, notify=notify)
    return participant_ids


async def _messenger_emit_message_created(user_ids: list[str], message: dict[str, Any]) -> None:
    pages_module = _pages()
    room_id = int((message or {}).get("room_id") or 0)
    if room_id <= 0:
        return
    for user_id in pages_module._messenger_unique_user_ids(user_ids):
        message_payload = await pages_module.asyncio.to_thread(_build_single_messenger_message_payload, user_id, message)
        if not message_payload:
            continue
        await _MESSENGER_HUB.send_to_user(
            user_id,
            {"type": "message_created", "room_id": room_id, "message": message_payload},
        )


async def _messenger_emit_message_updated(user_ids: list[str], message: dict[str, Any]) -> None:
    pages_module = _pages()
    room_id = int((message or {}).get("room_id") or 0)
    if room_id <= 0:
        return
    for user_id in pages_module._messenger_unique_user_ids(user_ids):
        message_payload = await pages_module.asyncio.to_thread(_build_single_messenger_message_payload, user_id, message)
        if not message_payload:
            continue
        await _MESSENGER_HUB.send_to_user(
            user_id,
            {"type": "message_updated", "room_id": room_id, "message": message_payload},
        )


async def _messenger_emit_message_deleted(user_ids: list[str], *, room_id: int, message_id: int) -> None:
    pages_module = _pages()
    target_room_id = int(room_id or 0)
    target_message_id = int(message_id or 0)
    if target_room_id <= 0 or target_message_id <= 0:
        return
    for user_id in pages_module._messenger_unique_user_ids(user_ids):
        await _MESSENGER_HUB.send_to_user(
            user_id,
            {"type": "message_deleted", "room_id": target_room_id, "message_id": target_message_id},
        )


async def _messenger_emit_typing(user_ids: list[str], *, room_id: int, actor_user_id: str, is_typing: bool) -> None:
    pages_module = _pages()
    actor_directory, _contacts = pages_module._build_messenger_user_directory(actor_user_id)
    actor = actor_directory.get(actor_user_id) or {"display_name": actor_user_id}
    payload = {
        "type": "typing",
        "room_id": int(room_id),
        "user_id": actor_user_id,
        "display_name": str(actor.get("display_name") or actor_user_id),
        "is_typing": bool(is_typing),
    }
    for user_id in pages_module._messenger_unique_user_ids(user_ids):
        if user_id == actor_user_id:
            continue
        await _MESSENGER_HUB.send_to_user(user_id, payload)


__all__ = [
    "_messenger_call_log_system_text",
    "_messenger_emit_call_admin_control",
    "_messenger_emit_call_state",
    "_messenger_emit_call_state_to_user",
    "_messenger_emit_message_created",
    "_messenger_emit_message_deleted",
    "_messenger_emit_message_updated",
    "_messenger_emit_notifications_update",
    "_messenger_emit_room_state_for_users",
    "_messenger_emit_room_update",
    "_messenger_emit_room_updates",
    "_messenger_emit_system_message",
    "_messenger_emit_typing",
    "_messenger_finalize_call_log",
    "_messenger_record_call_started",
    "_messenger_refresh_room_state",
    "_messenger_update_call_activity",
]
