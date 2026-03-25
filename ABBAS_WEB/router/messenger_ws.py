from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect


def register_messenger_ws_routes(router: APIRouter) -> None:
    from router import pages as pages_module

    asyncio = pages_module.asyncio
    chat_repo = pages_module.chat_repo
    json = pages_module.json
    read_session_user = pages_module.read_session_user
    read_user = pages_module.read_user
    SESSION_COOKIE_NAME = pages_module.SESSION_COOKIE_NAME
    _MESSENGER_CALL_HUB = pages_module._MESSENGER_CALL_HUB
    _MESSENGER_HUB = pages_module._MESSENGER_HUB
    _build_messenger_bootstrap_payload = pages_module._build_messenger_bootstrap_payload
    _messenger_can_join_call = pages_module._messenger_can_join_call
    _messenger_can_share_screen_in_call = pages_module._messenger_can_share_screen_in_call
    _messenger_can_speak_in_call = pages_module._messenger_can_speak_in_call
    _messenger_can_start_call = pages_module._messenger_can_start_call
    _messenger_can_use_video_in_call = pages_module._messenger_can_use_video_in_call
    _messenger_emit_call_state = pages_module._messenger_emit_call_state
    _messenger_emit_call_state_to_user = pages_module._messenger_emit_call_state_to_user
    _messenger_emit_room_update = pages_module._messenger_emit_room_update
    _messenger_emit_typing = pages_module._messenger_emit_typing
    _messenger_finalize_call_log = pages_module._messenger_finalize_call_log
    _messenger_is_stage_room = pages_module._messenger_is_stage_room
    _messenger_record_call_started = pages_module._messenger_record_call_started
    _messenger_supports_calls = pages_module._messenger_supports_calls
    _messenger_update_call_activity = pages_module._messenger_update_call_activity
    _normalize_role = pages_module._normalize_role
    _payload_bool = pages_module._payload_bool
    _payload_int = pages_module._payload_int
    _reject_websocket_with_code = pages_module._reject_websocket_with_code

    @router.websocket("/ws/messenger")
    async def ws_messenger(websocket: WebSocket):
        sid = ""
        try:
            sid = (websocket.cookies.get(SESSION_COOKIE_NAME, "") or "").strip()
        except Exception:
            sid = ""

        user_id = read_session_user(sid)
        if not user_id:
            await _reject_websocket_with_code(websocket, 4401)
            return

        await _MESSENGER_HUB.connect(user_id, websocket)
        await websocket.send_text(json.dumps({"type": "connected", "user_id": user_id}, ensure_ascii=False))

        try:
            while True:
                raw = await websocket.receive_text()
                try:
                    payload = json.loads(raw or "{}")
                except Exception:
                    payload = {}

                event_type = str(payload.get("type") or "").strip().lower()
                if event_type == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}, ensure_ascii=False))
                    continue

                if event_type == "typing":
                    room_id = _payload_int(payload.get("room_id"), 0)
                    if room_id <= 0:
                        continue
                    has_access = await asyncio.to_thread(chat_repo.room_has_member, room_id, user_id)
                    if not has_access:
                        continue
                    participant_ids = await asyncio.to_thread(chat_repo.list_room_user_ids, room_id)
                    await _messenger_emit_typing(
                        participant_ids,
                        room_id=room_id,
                        actor_user_id=user_id,
                        is_typing=_payload_bool(payload.get("is_typing"), False),
                    )
                    continue

                if event_type == "refresh_room":
                    room_id = _payload_int(payload.get("room_id"), 0)
                    if room_id > 0:
                        await _messenger_emit_room_update(user_id, room_id)
                        await _messenger_emit_call_state_to_user(user_id, room_id)
                    continue

                if event_type == "refresh_bootstrap":
                    bootstrap_payload = await asyncio.to_thread(_build_messenger_bootstrap_payload, user_id)
                    await _MESSENGER_HUB.send_to_user(user_id, {"type": "bootstrap", "payload": bootstrap_payload})
                    continue

                if event_type == "call_sync":
                    room_id = _payload_int(payload.get("room_id"), 0)
                    if room_id <= 0:
                        continue
                    room = await asyncio.to_thread(chat_repo.get_room_for_user, room_id, user_id)
                    if not room:
                        continue
                    if not _messenger_supports_calls(room):
                        await _MESSENGER_HUB.send_to_user(user_id, {"type": "call_cleared", "room_id": room_id})
                        continue
                    await _messenger_emit_call_state_to_user(user_id, room_id)
                    continue

                if event_type == "call_join":
                    room_id = _payload_int(payload.get("room_id"), 0)
                    if room_id <= 0:
                        continue
                    room = await asyncio.to_thread(chat_repo.get_room_for_user, room_id, user_id)
                    if not room:
                        continue
                    current_user_role = _normalize_role((read_user(user_id) or {}).get("ROLE") or "")
                    if not _messenger_can_join_call(room, user_id, current_user_role):
                        continue
                    room_is_stage = _messenger_is_stage_room(room)
                    existing_room_call = await _MESSENGER_CALL_HUB.get_room_call(room_id)
                    if (not existing_room_call) and (not _messenger_can_start_call(room, user_id, current_user_role)):
                        continue
                    can_speak = _messenger_can_speak_in_call(room, user_id, current_user_role)
                    can_use_video = _messenger_can_use_video_in_call(room, user_id, current_user_role)
                    can_share_screen = _messenger_can_share_screen_in_call(room, user_id, current_user_role)
                    stage_role = "speaker" if (can_speak or not room_is_stage) else "audience"
                    requested_mode = str(payload.get("media_mode") or payload.get("mode") or "").strip().lower()
                    sanitized_audio_enabled = _payload_bool(payload.get("audio_enabled"), True) and can_speak
                    sanitized_video_enabled = _payload_bool(payload.get("video_enabled"), False) and can_use_video
                    sanitized_sharing_screen = _payload_bool(payload.get("sharing_screen"), False) and can_share_screen
                    sanitized_media_mode = "video" if (
                        sanitized_video_enabled
                        or sanitized_sharing_screen
                        or (requested_mode == "video" and can_use_video)
                    ) else "audio"
                    sanitized_source = "screen" if sanitized_sharing_screen else "camera"
                    room_call = await _MESSENGER_CALL_HUB.join_room(
                        room_id,
                        user_id,
                        media_mode=sanitized_media_mode,
                        audio_enabled=sanitized_audio_enabled,
                        video_enabled=sanitized_video_enabled,
                        sharing_screen=sanitized_sharing_screen,
                        source=sanitized_source,
                        stage_role=stage_role,
                    )
                    if room_call:
                        if existing_room_call:
                            await _messenger_update_call_activity(room_call)
                        else:
                            await _messenger_record_call_started(
                                room_id,
                                room_call,
                                actor_user_id=user_id,
                                media_mode=sanitized_media_mode,
                            )
                    participant_ids = await asyncio.to_thread(chat_repo.list_room_user_ids, room_id)
                    await _messenger_emit_call_state(participant_ids, room_id)
                    if room_call:
                        await _MESSENGER_HUB.send_to_user(
                            user_id,
                            {"type": "call_joined", "room_id": room_id, "call": room_call},
                        )
                    continue

                if event_type == "call_leave":
                    room_id = _payload_int(payload.get("room_id"), 0)
                    if room_id <= 0:
                        continue
                    room = await asyncio.to_thread(chat_repo.get_room_for_user, room_id, user_id)
                    if not room:
                        continue
                    if not _messenger_supports_calls(room):
                        await _MESSENGER_CALL_HUB.leave_room(room_id, user_id)
                        await _MESSENGER_HUB.send_to_user(user_id, {"type": "call_cleared", "room_id": room_id})
                        continue
                    previous_room_call = await _MESSENGER_CALL_HUB.get_room_call(room_id)
                    room_call = await _MESSENGER_CALL_HUB.leave_room(room_id, user_id)
                    if (not room_call) and previous_room_call:
                        await _messenger_finalize_call_log(room_id, previous_room_call)
                    participant_ids = await asyncio.to_thread(chat_repo.list_room_user_ids, room_id)
                    await _messenger_emit_call_state(participant_ids, room_id)
                    continue

                if event_type == "call_media_state":
                    room_id = _payload_int(payload.get("room_id"), 0)
                    if room_id <= 0:
                        continue
                    room = await asyncio.to_thread(chat_repo.get_room_for_user, room_id, user_id)
                    if not room:
                        continue
                    if not _messenger_supports_calls(room):
                        await _MESSENGER_HUB.send_to_user(user_id, {"type": "call_cleared", "room_id": room_id})
                        continue
                    is_participant = await _MESSENGER_CALL_HUB.room_has_participant(room_id, user_id)
                    if not is_participant:
                        continue
                    current_user_role = _normalize_role((read_user(user_id) or {}).get("ROLE") or "")
                    current_participant = await _MESSENGER_CALL_HUB.get_participant(room_id, user_id)
                    if not current_participant:
                        continue
                    can_speak = pages_module._messenger_participant_can_speak_live(room, current_participant, user_id, current_user_role)
                    can_use_video = pages_module._messenger_participant_can_use_video_live(room, current_participant, user_id, current_user_role)
                    can_share_screen = pages_module._messenger_participant_can_share_screen_live(room, current_participant, user_id, current_user_role)
                    next_audio_enabled = None
                    next_video_enabled = None
                    next_sharing_screen = None
                    if "audio_enabled" in payload:
                        next_audio_enabled = _payload_bool(payload.get("audio_enabled"), False) and can_speak
                    if "video_enabled" in payload:
                        next_video_enabled = _payload_bool(payload.get("video_enabled"), False) and can_use_video
                    if "sharing_screen" in payload:
                        next_sharing_screen = _payload_bool(payload.get("sharing_screen"), False) and can_share_screen
                    resolved_video_enabled = bool(current_participant.get("video_enabled")) if next_video_enabled is None else bool(next_video_enabled)
                    resolved_sharing_screen = bool(current_participant.get("sharing_screen")) if next_sharing_screen is None else bool(next_sharing_screen)
                    next_media_mode = None
                    if ("media_mode" in payload) or ("mode" in payload) or (next_video_enabled is not None) or (next_sharing_screen is not None):
                        requested_mode = str(payload.get("media_mode") or payload.get("mode") or current_participant.get("media_mode") or "").strip().lower()
                        next_media_mode = "video" if (
                            resolved_video_enabled
                            or resolved_sharing_screen
                            or (requested_mode == "video" and can_use_video)
                        ) else "audio"
                    next_source = None
                    if ("source" in payload) or (next_sharing_screen is not None):
                        next_source = "screen" if resolved_sharing_screen else "camera"
                    await _MESSENGER_CALL_HUB.update_media_state(
                        room_id,
                        user_id,
                        audio_enabled=next_audio_enabled,
                        video_enabled=next_video_enabled,
                        sharing_screen=next_sharing_screen,
                        media_mode=next_media_mode,
                        source=next_source,
                    )
                    participant_ids = await asyncio.to_thread(chat_repo.list_room_user_ids, room_id)
                    await _messenger_emit_call_state(participant_ids, room_id)
                    continue

                if event_type == "call_signal":
                    room_id = _payload_int(payload.get("room_id"), 0)
                    target_user_id = str(payload.get("target_user_id") or "").strip()
                    signal = payload.get("signal") if isinstance(payload.get("signal"), dict) else {}
                    if room_id <= 0 or not target_user_id or not signal:
                        continue
                    room = await asyncio.to_thread(chat_repo.get_room_for_user, room_id, user_id)
                    if not room:
                        continue
                    if not _messenger_supports_calls(room):
                        continue
                    sender_in_call = await _MESSENGER_CALL_HUB.room_has_participant(room_id, user_id)
                    target_in_call = await _MESSENGER_CALL_HUB.room_has_participant(room_id, target_user_id)
                    if not sender_in_call or not target_in_call:
                        continue
                    await _MESSENGER_HUB.send_to_user(
                        target_user_id,
                        {
                            "type": "call_signal",
                            "room_id": room_id,
                            "from_user_id": user_id,
                            "target_user_id": target_user_id,
                            "signal": signal,
                        },
                    )
                    continue
        except WebSocketDisconnect:
            pass
        except Exception:
            try:
                await websocket.close()
            except Exception:
                pass
        finally:
            await _MESSENGER_HUB.disconnect(user_id, websocket)
            if user_id and not await _MESSENGER_HUB.has_connection(user_id):
                affected_calls = await _MESSENGER_CALL_HUB.leave_all(user_id)
                for affected in affected_calls:
                    room_id = int((affected or {}).get("room_id") or 0)
                    previous_call = (affected or {}).get("previous_call") if isinstance(affected, dict) else None
                    if room_id <= 0:
                        continue
                    if isinstance(affected, dict) and bool(affected.get("call_cleared")):
                        await _messenger_finalize_call_log(room_id, previous_call)
                    participant_ids = await asyncio.to_thread(chat_repo.list_room_user_ids, room_id)
                    await _messenger_emit_call_state(participant_ids, room_id)
            return


__all__ = ["register_messenger_ws_routes"]
