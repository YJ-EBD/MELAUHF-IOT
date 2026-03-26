from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse


def register_messenger_api_routes(router: APIRouter) -> None:
    from router import pages as pages_module
    from services import meeting_notes

    asyncio = pages_module.asyncio
    chat_repo = pages_module.chat_repo
    json = pages_module.json
    os = pages_module.os
    re = pages_module.re
    secrets = pages_module.secrets
    time = pages_module.time
    user_repo = pages_module.user_repo
    livekit_api = pages_module.livekit_api
    LIVEKIT_API_KEY = pages_module.LIVEKIT_API_KEY
    LIVEKIT_API_SECRET = pages_module.LIVEKIT_API_SECRET
    MESSENGER_ROOM_AVATAR_PRESETS = pages_module.MESSENGER_ROOM_AVATAR_PRESETS
    MESSENGER_UPLOAD_ALLOWED_EXTENSIONS = pages_module.MESSENGER_UPLOAD_ALLOWED_EXTENSIONS
    MESSENGER_UPLOAD_MAX_BYTES = pages_module.MESSENGER_UPLOAD_MAX_BYTES
    MESSENGER_UPLOAD_PUBLIC_PREFIX = pages_module.MESSENGER_UPLOAD_PUBLIC_PREFIX
    MESSENGER_UPLOAD_STORAGE_DIR = pages_module.MESSENGER_UPLOAD_STORAGE_DIR
    _MESSENGER_HUB = pages_module._MESSENGER_HUB
    _MESSENGER_CALL_HUB = pages_module._MESSENGER_CALL_HUB
    _MESSENGER_TRANSCRIPT_HUB = pages_module._MESSENGER_TRANSCRIPT_HUB
    _approved_user_rows = pages_module._approved_user_rows
    _build_messenger_bootstrap_payload = pages_module._build_messenger_bootstrap_payload
    _build_messenger_room_messages_payload = pages_module._build_messenger_room_messages_payload
    _build_messenger_user_directory = pages_module._build_messenger_user_directory
    _build_messenger_user_profile_payload = pages_module._build_messenger_user_profile_payload
    _build_single_messenger_message_payload = pages_module._build_single_messenger_message_payload
    _build_single_messenger_room_payload = pages_module._build_single_messenger_room_payload
    _delete_managed_messenger_room_avatar = pages_module._delete_managed_messenger_room_avatar
    _display_user_name = pages_module._display_user_name
    _livekit_enabled = pages_module._livekit_enabled
    _livekit_identity_token = pages_module._livekit_identity_token
    _livekit_public_ws_url = pages_module._livekit_public_ws_url
    _livekit_room_name = pages_module._livekit_room_name
    _messenger_call_participant_stage_role = pages_module._messenger_call_participant_stage_role
    _messenger_can_change_room_member_role = pages_module._messenger_can_change_room_member_role
    _messenger_can_delete_message = pages_module._messenger_can_delete_message
    _messenger_can_edit_message = pages_module._messenger_can_edit_message
    _messenger_can_invite_room_members = pages_module._messenger_can_invite_room_members
    _messenger_can_join_call = pages_module._messenger_can_join_call
    _messenger_can_manage_room = pages_module._messenger_can_manage_room
    _messenger_can_moderate_call = pages_module._messenger_can_moderate_call
    _messenger_can_remove_room_member = pages_module._messenger_can_remove_room_member
    _messenger_can_start_call = pages_module._messenger_can_start_call
    _messenger_can_transfer_room_owner = pages_module._messenger_can_transfer_room_owner
    _messenger_channel_mode = pages_module._messenger_channel_mode
    _messenger_emit_call_admin_control = pages_module._messenger_emit_call_admin_control
    _messenger_emit_call_state = pages_module._messenger_emit_call_state
    _messenger_emit_message_created = pages_module._messenger_emit_message_created
    _messenger_emit_message_deleted = pages_module._messenger_emit_message_deleted
    _messenger_emit_message_updated = pages_module._messenger_emit_message_updated
    _messenger_emit_notifications_update = pages_module._messenger_emit_notifications_update
    _messenger_emit_room_state_for_users = pages_module._messenger_emit_room_state_for_users
    _messenger_emit_room_update = pages_module._messenger_emit_room_update
    _messenger_emit_room_updates = pages_module._messenger_emit_room_updates
    _messenger_emit_system_message = pages_module._messenger_emit_system_message
    _messenger_finalize_call_log = pages_module._messenger_finalize_call_log
    _messenger_human_size = pages_module._messenger_human_size
    _messenger_is_ascord_room = pages_module._messenger_is_ascord_room
    _messenger_is_direct_room = pages_module._messenger_is_direct_room
    _messenger_is_stage_room = pages_module._messenger_is_stage_room
    _messenger_is_system_room = pages_module._messenger_is_system_room
    _messenger_json_error = pages_module._messenger_json_error
    _messenger_member_display_name = pages_module._messenger_member_display_name
    _messenger_member_role = pages_module._messenger_member_role
    _messenger_participant_can_use_video_live = pages_module._messenger_participant_can_use_video_live
    _messenger_refresh_room_state = pages_module._messenger_refresh_room_state
    _messenger_require_room_for_user = pages_module._messenger_require_room_for_user
    _messenger_require_user_id = pages_module._messenger_require_user_id
    _messenger_room_avatar_url_from_value = pages_module._messenger_room_avatar_url_from_value
    _messenger_room_has_member = pages_module._messenger_room_has_member
    _messenger_room_member_role = pages_module._messenger_room_member_role
    _messenger_supports_calls = pages_module._messenger_supports_calls
    _payload_bool = pages_module._payload_bool
    _payload_int = pages_module._payload_int
    _request_user_role = pages_module._request_user_role
    _request_user_row = pages_module._request_user_row
    _store_messenger_room_avatar = pages_module._store_messenger_room_avatar
    notiba_stt = pages_module.notiba_stt

    def _ascord_workspace_name() -> str:
        return "ABBA-S Korea"

    def _ascord_workspace_sort_key(item: dict[str, Any] | None) -> tuple[Any, ...]:
        payload = item or {}
        return (
            0 if payload.get("is_online") else 1,
            str(payload.get("department") or ""),
            str(payload.get("display_name") or "").lower(),
            str(payload.get("user_id") or "").lower(),
        )

    def _ascord_workspace_membership_payload(user_directory: dict[str, dict[str, Any]]) -> dict[str, Any]:
        membership_rows = chat_repo.list_workspace_members("ascord")
        membership_map = {
            str(row.get("user_id") or "").strip(): dict(row)
            for row in membership_rows
            if str(row.get("user_id") or "").strip()
        }
        active_members: list[dict[str, Any]] = []
        invited_members: list[dict[str, Any]] = []
        for user_id, membership in membership_map.items():
            profile = dict(user_directory.get(user_id) or {})
            if not profile:
                continue
            profile["workspace_invite_status"] = str(membership.get("invite_status") or "active")
            profile["workspace_member_role"] = str(membership.get("member_role") or "member")
            profile["workspace_invited_at"] = str(membership.get("invited_at") or "")
            profile["workspace_joined_at"] = str(membership.get("joined_at") or "")
            if str(membership.get("invite_status") or "active") == "active":
                active_members.append(profile)
            else:
                invited_members.append(profile)
        active_members.sort(key=_ascord_workspace_sort_key)
        invited_members.sort(key=_ascord_workspace_sort_key)
        return {
            "active_members": active_members,
            "invited_members": invited_members,
            "membership_map": membership_map,
        }

    def _parse_ascord_invite_content(content: Any) -> dict[str, Any]:
        try:
            payload = json.loads(str(content or "{}"))
        except Exception:
            payload = {}
        if not isinstance(payload, dict):
            return {}
        workspace_key = str(payload.get("workspace_key") or "").strip().lower() or "ascord"
        if workspace_key != "ascord":
            return {}
        return payload

    def _notiba_transcript_spoken_at(raw_value: Any) -> float:
        try:
            spoken_at = float(raw_value or 0) / 1000.0
        except Exception:
            spoken_at = 0.0
        now_ts = time.time()
        if spoken_at <= 0:
            return now_ts
        return min(now_ts + 2.0, max(now_ts - 180.0, spoken_at))

    @router.post("/api/messenger/rooms/{room_id}/call/session")
    async def api_messenger_room_call_session(
        request: Request,
        room_id: int,
        payload: dict[str, Any] = Body(default={}),
    ):
        current_user_id, room, error_response = await _messenger_require_room_for_user(
            request,
            room_id,
            not_found_detail="대화방에 접근할 수 없습니다.",
        )
        if error_response is not None:
            return error_response
        if not _messenger_supports_calls(room):
            return _messenger_json_error("ASCORD 채널에서만 통화 세션을 열 수 있습니다.", 400)
        current_user_role = _request_user_role(request)
        existing_room_call = await _MESSENGER_CALL_HUB.get_room_call(room_id)
        if not _messenger_can_join_call(room, current_user_id, current_user_role):
            return _messenger_json_error("이 채널 통화에 참여할 권한이 없습니다.", 403)
        if (not existing_room_call) and (not _messenger_can_start_call(room, current_user_id, current_user_role)):
            return _messenger_json_error("이 채널에서 새 통화를 시작할 권한이 없습니다.", 403)

        if not _livekit_enabled():
            detail = "LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET 설정이 필요합니다."
            if livekit_api is None:
                detail = "livekit-api 패키지가 설치되지 않았습니다. requirements.txt 설치 후 다시 시도해주세요."
            return _messenger_json_error(detail, 503)

        client_id_raw = str(payload.get("client_id") or "").strip()
        client_id = _livekit_identity_token(client_id_raw) or secrets.token_hex(6)
        requested_mode = "video" if str(payload.get("preferred_mode") or "").strip().lower() == "video" else "audio"
        current_participant = await _MESSENGER_CALL_HUB.get_participant(room_id, current_user_id)
        can_use_video = _messenger_participant_can_use_video_live(
            room,
            current_participant,
            current_user_id,
            current_user_role,
        )
        preferred_mode = "video" if requested_mode == "video" and can_use_video else "audio"

        current_user = _request_user_row(request)
        display_name = str(current_user.get("NAME") or "").strip() or _display_user_name(current_user) or current_user_id
        room_name = _livekit_room_name(room_id)
        participant_identity = "__".join(
            [
                _livekit_identity_token(current_user_id) or "user",
                client_id,
            ]
        )
        token = (
            livekit_api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
            .with_identity(participant_identity)
            .with_name(display_name)
            .with_grants(
                livekit_api.VideoGrants(
                    room_join=True,
                    room=room_name,
                )
            )
            .to_jwt()
        )

        return JSONResponse(
            {
                "ok": True,
                "payload": {
                    "server_url": _livekit_public_ws_url(),
                    "participant_token": token,
                    "participant_identity": participant_identity,
                    "participant_name": display_name,
                    "room_name": room_name,
                    "room_id": int(room_id),
                    "preferred_mode": preferred_mode,
                },
            }
        )

    @router.get("/api/messenger/rooms/{room_id}/call/transcripts")
    async def api_messenger_room_call_transcripts(
        request: Request,
        room_id: int,
    ):
        _current_user_id, room, error_response = await _messenger_require_room_for_user(
            request,
            room_id,
            not_found_detail="대화방에 접근할 수 없습니다.",
        )
        if error_response is not None:
            return error_response
        if not _messenger_supports_calls(room):
            return JSONResponse(
                {
                    "ok": True,
                    "call_id": "",
                    "entries": [],
                    "settings": notiba_stt.notiba_stt_settings(),
                }
            )

        room_call = await _MESSENGER_CALL_HUB.get_room_call(room_id)
        call_id = str((room_call or {}).get("call_id") or "").strip()
        entries = await _MESSENGER_TRANSCRIPT_HUB.sync_room_call(room_id, call_id)
        return JSONResponse(
            {
                "ok": True,
                "call_id": call_id,
                "entries": entries,
                "settings": notiba_stt.notiba_stt_settings(),
            }
        )

    @router.post("/api/messenger/rooms/{room_id}/call/transcription/session")
    async def api_messenger_room_call_transcription_session(
        request: Request,
        room_id: int,
    ):
        current_user_id, room, error_response = await _messenger_require_room_for_user(
            request,
            room_id,
            not_found_detail="대화방에 접근할 수 없습니다.",
        )
        if error_response is not None:
            return error_response
        if not _messenger_supports_calls(room):
            return _messenger_json_error("ASCORD 채널 음성통화에서만 Notiba AI를 사용할 수 있습니다.", 400)

        room_call = await _MESSENGER_CALL_HUB.get_room_call(room_id)
        current_call_id = str((room_call or {}).get("call_id") or "").strip()
        if not current_call_id:
            return _messenger_json_error("현재 진행 중인 음성통화가 없습니다.", 409)

        participant = await _MESSENGER_CALL_HUB.get_participant(room_id, current_user_id)
        if not participant:
            return _messenger_json_error("이 통화에 참여 중인 사용자만 Notiba AI를 사용할 수 있습니다.", 403)

        try:
            client_secret = await asyncio.to_thread(notiba_stt.create_realtime_client_secret)
        except Exception as exc:
            return _messenger_json_error(f"Notiba AI Realtime 세션 생성 실패: {exc}", 503)

        return JSONResponse(
            {
                "ok": True,
                "value": str(client_secret.get("value") or ""),
                "expires_at": client_secret.get("expires_at"),
                "session": client_secret.get("session") or notiba_stt.build_realtime_transcription_session(),
                "settings": notiba_stt.notiba_stt_settings(),
            }
        )

    @router.post("/api/messenger/rooms/{room_id}/call/transcript-event")
    async def api_messenger_room_call_transcript_event(
        request: Request,
        room_id: int,
        payload: dict[str, Any] = Body(default={}),
    ):
        current_user_id, room, error_response = await _messenger_require_room_for_user(
            request,
            room_id,
            not_found_detail="대화방에 접근할 수 없습니다.",
        )
        if error_response is not None:
            return error_response
        if not _messenger_supports_calls(room):
            return _messenger_json_error("ASCORD 채널 음성통화에서만 Notiba AI를 사용할 수 있습니다.", 400)

        room_call = await _MESSENGER_CALL_HUB.get_room_call(room_id)
        current_call_id = str((room_call or {}).get("call_id") or "").strip()
        if not current_call_id:
            return _messenger_json_error("현재 진행 중인 음성통화가 없습니다.", 409)
        normalized_call_id = str(payload.get("call_id") or "").strip()
        if normalized_call_id and normalized_call_id != current_call_id:
            return _messenger_json_error("통화 세션이 변경되어 전사를 건너뜁니다.", 409)

        participant = await _MESSENGER_CALL_HUB.get_participant(room_id, current_user_id)
        if not participant:
            return _messenger_json_error("이 통화에 참여 중인 사용자만 전사를 보낼 수 있습니다.", 403)
        transcript_text = str(payload.get("text") or "").strip()
        if not transcript_text:
            return JSONResponse({"ok": True, "call_id": current_call_id, "entry": None})

        current_user = _request_user_row(request)
        display_name = str(current_user.get("NAME") or "").strip() or _display_user_name(current_user) or current_user_id
        spoken_at = _notiba_transcript_spoken_at(payload.get("spoken_at_ms"))
        source_item_id = str(payload.get("item_id") or "").strip()
        transcript_state = str(payload.get("state") or "").strip().lower()
        is_final = transcript_state == "final"
        participant_ids = sorted(set(await asyncio.to_thread(chat_repo.list_room_user_ids, room_id)))

        if not is_final:
            partial_entry = {
                "item_id": source_item_id,
                "room_id": int(room_id),
                "call_id": current_call_id,
                "user_id": current_user_id,
                "display_name": display_name,
                "text": transcript_text,
                "spoken_at": spoken_at,
                "created_at": time.time(),
            }
            broadcast_payload = {
                "type": "call_transcript_partial",
                "room_id": int(room_id),
                "call_id": current_call_id,
                "entry": partial_entry,
            }
            await asyncio.gather(*[
                _MESSENGER_HUB.send_to_user(participant_id, broadcast_payload)
                for participant_id in participant_ids
                if str(participant_id or "").strip()
            ])
            return JSONResponse(
                {
                    "ok": True,
                    "call_id": current_call_id,
                    "entry": partial_entry,
                    "settings": notiba_stt.notiba_stt_settings(),
                }
            )

        await _MESSENGER_TRANSCRIPT_HUB.sync_room_call(room_id, current_call_id)
        entry = await _MESSENGER_TRANSCRIPT_HUB.append_entry(
            room_id,
            current_call_id,
            {
                "user_id": current_user_id,
                "display_name": display_name,
                "source_item_id": source_item_id,
                "text": transcript_text,
                "spoken_at": spoken_at,
                "created_at": time.time(),
                "duration_ms": max(int(payload.get("duration_ms") or 0), 0),
            },
        )
        if not entry:
            return JSONResponse({"ok": True, "call_id": current_call_id, "entry": None})

        try:
            await asyncio.to_thread(
                meeting_notes.append_transcript_entry,
                room_id,
                current_call_id,
                str(room.get("name") or room.get("title") or "채널").strip() or "채널",
                display_name,
                transcript_text,
                started_at=(room_call or {}).get("started_at"),
                spoken_at=spoken_at,
            )
        except Exception:
            pass

        broadcast_payload = {
            "type": "call_transcript",
            "room_id": int(room_id),
            "call_id": current_call_id,
            "item_id": source_item_id,
            "entry": entry,
        }
        await asyncio.gather(*[
            _MESSENGER_HUB.send_to_user(participant_id, broadcast_payload)
            for participant_id in participant_ids
            if str(participant_id or "").strip()
        ])
        return JSONResponse(
            {
                "ok": True,
                "call_id": current_call_id,
                "entry": entry,
                "settings": notiba_stt.notiba_stt_settings(),
            }
        )

    @router.get("/api/messenger/meeting-notes")
    async def api_messenger_meeting_notes(
        request: Request,
    ):
        current_user_id, error_response = _messenger_require_user_id(request)
        if error_response is not None:
            return error_response
        rooms = await asyncio.to_thread(chat_repo.list_rooms_for_user, current_user_id)
        channels = await asyncio.to_thread(
            meeting_notes.list_notes_for_rooms,
            [
                room
                for room in (rooms or [])
                if _messenger_is_ascord_room(room) and _messenger_supports_calls(room)
            ],
            current_user_id,
        )
        return JSONResponse({"ok": True, "channels": channels})

    @router.get("/api/messenger/meeting-notes/read")
    async def api_messenger_meeting_note_read(
        request: Request,
        note_id: str = "",
    ):
        current_user_id, error_response = _messenger_require_user_id(request)
        if error_response is not None:
            return error_response
        rooms = await asyncio.to_thread(chat_repo.list_rooms_for_user, current_user_id)
        allowed_room_ids = {
            int(room.get("id") or 0)
            for room in (rooms or [])
            if _messenger_is_ascord_room(room) and _messenger_supports_calls(room)
        }
        try:
            note_payload = await asyncio.to_thread(meeting_notes.read_note, note_id, allowed_room_ids, current_user_id)
        except PermissionError as exc:
            return _messenger_json_error(str(exc) or "이 회의록을 볼 권한이 없습니다.", 403)
        except FileNotFoundError:
            return _messenger_json_error("회의록을 찾을 수 없습니다.", 404)
        except ValueError as exc:
            return _messenger_json_error(str(exc) or "회의록을 읽지 못했습니다.", 400)
        return JSONResponse({"ok": True, "note": note_payload})

    @router.post("/api/messenger/rooms/{room_id}/call/moderate")
    async def api_messenger_room_call_moderate(
        request: Request,
        room_id: int,
        payload: dict[str, Any] = Body(default={}),
    ):
        current_user_id, room, error_response = await _messenger_require_room_for_user(
            request,
            room_id,
            not_found_detail="대화방에 접근할 수 없습니다.",
        )
        if error_response is not None:
            return error_response
        if not _messenger_supports_calls(room):
            return _messenger_json_error("ASCORD 채널에서만 통화 제어를 사용할 수 있습니다.", 400)

        current_user_role = _request_user_role(request)
        if not _messenger_can_moderate_call(room, current_user_id, current_user_role):
            return _messenger_json_error("이 채널의 통화를 제어할 권한이 없습니다.", 403)

        action = str(payload.get("action") or "").strip().lower()
        target_user_id = str(payload.get("target_user_id") or "").strip()
        if not target_user_id:
            return _messenger_json_error("대상 사용자를 선택해주세요.", 400)
        if target_user_id == current_user_id:
            return _messenger_json_error("자기 자신에게는 이 작업을 적용할 수 없습니다.", 400)

        participant = await _MESSENGER_CALL_HUB.get_participant(room_id, target_user_id)
        if not participant:
            return _messenger_json_error("현재 통화에 연결된 참여자가 아닙니다.", 404)

        if action not in {
            "server_mute",
            "server_unmute",
            "disable_camera",
            "disable_screen_share",
            "disconnect",
            "grant_speaker",
            "move_to_audience",
        }:
            return _messenger_json_error("지원하지 않는 통화 제어 작업입니다.", 400)

        room_call: dict[str, Any] | None = None
        if action == "server_mute":
            room_call = await _MESSENGER_CALL_HUB.set_server_muted(room_id, target_user_id, True)
        elif action == "server_unmute":
            room_call = await _MESSENGER_CALL_HUB.set_server_muted(room_id, target_user_id, False)
        elif action == "disable_camera":
            next_mode = "video" if bool(participant.get("sharing_screen")) else "audio"
            room_call = await _MESSENGER_CALL_HUB.update_media_state(
                room_id,
                target_user_id,
                video_enabled=False,
                media_mode=next_mode,
            )
        elif action == "disable_screen_share":
            next_mode = "video" if bool(participant.get("video_enabled")) else "audio"
            room_call = await _MESSENGER_CALL_HUB.update_media_state(
                room_id,
                target_user_id,
                sharing_screen=False,
                media_mode=next_mode,
                source="camera",
            )
        elif action == "disconnect":
            previous_room_call = await _MESSENGER_CALL_HUB.get_room_call(room_id)
            room_call = await _MESSENGER_CALL_HUB.leave_room(room_id, target_user_id)
            if (not room_call) and previous_room_call:
                await _messenger_finalize_call_log(room_id, previous_room_call)
        elif action == "grant_speaker":
            if not _messenger_is_stage_room(room):
                return _messenger_json_error("STAGE 채널에서만 발표자 승격을 사용할 수 있습니다.", 400)
            room_call = await _MESSENGER_CALL_HUB.set_stage_role(room_id, target_user_id, "speaker")
        elif action == "move_to_audience":
            if not _messenger_is_stage_room(room):
                return _messenger_json_error("STAGE 채널에서만 청중 강등을 사용할 수 있습니다.", 400)
            room_call = await _MESSENGER_CALL_HUB.set_stage_role(room_id, target_user_id, "audience")

        if action in {"server_mute", "server_unmute", "disable_camera", "disable_screen_share", "grant_speaker", "move_to_audience"} and not room_call:
            return _messenger_json_error("통화 상태를 갱신하지 못했습니다.", 409)

        await _messenger_emit_call_admin_control(
            target_user_id,
            room_id=room_id,
            action=action,
            actor_user_id=current_user_id,
        )
        participant_ids = await asyncio.to_thread(chat_repo.list_room_user_ids, room_id)
        if _messenger_is_stage_room(room) and action in {"grant_speaker", "move_to_audience"}:
            user_directory, _contacts = await asyncio.to_thread(_build_messenger_user_directory, current_user_id)
            actor_name = _messenger_member_display_name(room, current_user_id, user_directory)
            target_name = _messenger_member_display_name(room, target_user_id, user_directory)
            log_text = (
                f"{actor_name}님이 {target_name}님을 발표자로 승격했습니다."
                if action == "grant_speaker"
                else f"{actor_name}님이 {target_name}님을 청중으로 전환했습니다."
            )
            await _messenger_emit_system_message(participant_ids, room_id, log_text)
        await _messenger_emit_call_state(participant_ids, room_id)
        return JSONResponse({"ok": True, "call": room_call, "room_id": int(room_id), "target_user_id": target_user_id, "action": action})

    @router.post("/api/messenger/rooms/{room_id}/call/stage")
    async def api_messenger_room_call_stage(
        request: Request,
        room_id: int,
        payload: dict[str, Any] = Body(default={}),
    ):
        current_user_id, room, error_response = await _messenger_require_room_for_user(
            request,
            room_id,
            not_found_detail="대화방에 접근할 수 없습니다.",
        )
        if error_response is not None:
            return error_response
        if not _messenger_supports_calls(room):
            return _messenger_json_error("ASCORD STAGE 채널에서만 사용할 수 있습니다.", 400)
        if not _messenger_is_stage_room(room):
            return _messenger_json_error("STAGE 채널에서만 사용할 수 있는 요청입니다.", 400)

        participant = await _MESSENGER_CALL_HUB.get_participant(room_id, current_user_id)
        if not participant:
            return _messenger_json_error("먼저 이 STAGE 채널 통화에 참여해주세요.", 409)

        action = str(payload.get("action") or "").strip().lower()
        if action not in {"request_speaker", "withdraw_request", "move_self_to_audience"}:
            return _messenger_json_error("지원하지 않는 STAGE 작업입니다.", 400)

        room_call: dict[str, Any] | None = None
        if action == "request_speaker":
            if _messenger_call_participant_stage_role(participant) == "speaker":
                return _messenger_json_error("이미 발표자 권한으로 연결되어 있습니다.", 409)
            room_call = await _MESSENGER_CALL_HUB.set_stage_request(room_id, current_user_id, True)
        elif action == "withdraw_request":
            room_call = await _MESSENGER_CALL_HUB.set_stage_request(room_id, current_user_id, False)
        elif action == "move_self_to_audience":
            room_call = await _MESSENGER_CALL_HUB.set_stage_role(room_id, current_user_id, "audience")

        if not room_call:
            return _messenger_json_error("STAGE 상태를 갱신하지 못했습니다.", 409)

        participant_ids = await asyncio.to_thread(chat_repo.list_room_user_ids, room_id)
        user_directory, _contacts = await asyncio.to_thread(_build_messenger_user_directory, current_user_id)
        actor_name = _messenger_member_display_name(room, current_user_id, user_directory)
        log_text = ""
        if action == "request_speaker":
            log_text = f"{actor_name}님이 발언 요청을 보냈습니다."
        elif action == "withdraw_request":
            log_text = f"{actor_name}님이 발언 요청을 취소했습니다."
        elif action == "move_self_to_audience":
            log_text = f"{actor_name}님이 스스로 청중으로 전환했습니다."
        if log_text:
            await _messenger_emit_system_message(participant_ids, room_id, log_text)
        await _messenger_emit_call_state(participant_ids, room_id)
        return JSONResponse({"ok": True, "call": room_call, "room_id": int(room_id), "action": action})

    @router.get("/api/messenger/bootstrap")
    def api_messenger_bootstrap(request: Request, room_id: int = 0):
        current_user_id, error_response = _messenger_require_user_id(request)
        if error_response is not None:
            return error_response
        payload = _build_messenger_bootstrap_payload(current_user_id, requested_room_id=room_id)
        return JSONResponse({"ok": True, "payload": payload})

    @router.get("/api/messenger/rooms/{room_id}/messages")
    def api_messenger_room_messages(
        request: Request,
        room_id: int,
        limit: int = 80,
        before_message_id: int = 0,
    ):
        current_user_id, error_response = _messenger_require_user_id(request)
        if error_response is not None:
            return error_response
        payload = _build_messenger_room_messages_payload(
            current_user_id,
            room_id,
            limit=limit,
            before_message_id=before_message_id,
        )
        if not payload:
            return _messenger_json_error("대화방을 찾을 수 없습니다.", 404)
        return JSONResponse({"ok": True, "payload": payload})

    @router.post("/api/messenger/rooms")
    async def api_messenger_create_room(request: Request, payload: dict[str, Any] = Body(default={})):
        current_user_id, error_response = _messenger_require_user_id(request)
        if error_response is not None:
            return error_response

        app_domain = chat_repo.normalize_app_domain(payload.get("app_domain"))
        room_mode = str(payload.get("mode") or payload.get("room_type") or "").strip().lower()
        if room_mode in {"dm", "direct"}:
            room_mode = "dm"
        elif room_mode == "channel":
            room_mode = "channel"
        else:
            room_mode = "group"
        if app_domain == "ascord":
            if room_mode == "dm":
                return _messenger_json_error("ASCORD에서는 1:1 대화를 만들 수 없습니다.", 400)
            room_mode = "channel"
        else:
            room_mode = "dm" if room_mode == "dm" else "group"
        approved_user_ids = {str(row.get("ID") or "").strip() for row in _approved_user_rows()}

        try:
            if room_mode == "dm":
                target_user_id = str(payload.get("target_user_id") or "").strip()
                if (not target_user_id) or (target_user_id not in approved_user_ids):
                    return _messenger_json_error("대화 상대를 찾을 수 없습니다.", 404)
                room_id = await asyncio.to_thread(chat_repo.get_or_create_direct_room, current_user_id, target_user_id)
            else:
                room_name = str(payload.get("name") or "").strip()
                topic = str(payload.get("topic") or "").strip()
                channel_category = str(payload.get("channel_category") or "").strip()
                channel_mode = _messenger_channel_mode(payload.get("channel_mode"))
                call_permissions = payload.get("call_permissions")
                member_ids = [
                    str(user_id or "").strip()
                    for user_id in (payload.get("member_ids") or [])
                    if str(user_id or "").strip() in approved_user_ids
                ]
                room_id = await asyncio.to_thread(
                    chat_repo.create_group_room,
                    room_name,
                    current_user_id,
                    member_ids,
                    topic,
                    app_domain=app_domain,
                    channel_category=channel_category,
                    channel_mode=channel_mode,
                    call_permissions=call_permissions,
                )
        except ValueError as exc:
            return JSONResponse({"ok": False, "detail": str(exc)}, status_code=400)
        except Exception as exc:
            return JSONResponse({"ok": False, "detail": f"대화방 생성 실패: {exc}"}, status_code=500)

        await _messenger_refresh_room_state(room_id, notify=True)
        room_payload = await asyncio.to_thread(_build_single_messenger_room_payload, current_user_id, room_id)
        return JSONResponse({"ok": True, "room_id": room_id, "room": room_payload})

    @router.patch("/api/messenger/rooms/{room_id}")
    async def api_messenger_update_room(
        request: Request,
        room_id: int,
        payload: dict[str, Any] = Body(default={}),
    ):
        current_user_id, room, error_response = await _messenger_require_room_for_user(request, room_id)
        if error_response is not None:
            return error_response
        if _messenger_is_direct_room(room):
            return _messenger_json_error("1:1 대화방은 이름을 수정할 수 없습니다.", 400)
        if not _messenger_can_manage_room(room, current_user_id, _request_user_role(request)):
            return _messenger_json_error("대화방 수정 권한이 없습니다.", 403)

        try:
            await asyncio.to_thread(
                chat_repo.update_room_details,
                room_id,
                name=str(payload.get("name") or room.get("name") or "").strip(),
                topic=str(payload.get("topic") or "").strip(),
                channel_category=(
                    str(payload.get("channel_category") or "").strip()
                    if "channel_category" in payload
                    else str(room.get("channel_category") or "").strip()
                ),
                channel_mode=(
                    _messenger_channel_mode(payload.get("channel_mode"))
                    if "channel_mode" in payload
                    else _messenger_channel_mode(room.get("channel_mode"))
                ),
                call_permissions=payload.get("call_permissions") if "call_permissions" in payload else room.get("call_permissions"),
            )
        except ValueError as exc:
            return JSONResponse({"ok": False, "detail": str(exc)}, status_code=400)
        except Exception as exc:
            return JSONResponse({"ok": False, "detail": f"대화방 수정 실패: {exc}"}, status_code=500)

        await _messenger_refresh_room_state(room_id)
        room_payload = await asyncio.to_thread(_build_single_messenger_room_payload, current_user_id, room_id)
        return JSONResponse({"ok": True, "room": room_payload})

    @router.post("/api/messenger/rooms/ascord/voice-order")
    async def api_messenger_reorder_ascord_voice_channels(
        request: Request,
        payload: dict[str, Any] = Body(default={}),
    ):
        current_user_id = _messenger_require_user_id(request)
        current_user_role = str(_request_user_role(request) or "").strip().lower()
        if current_user_role not in {"admin", "superuser"}:
            return _messenger_json_error("ADMIN 또는 SuperUser만 음성채널 순서를 조정할 수 있습니다.", 403)

        raw_room_ids = payload.get("room_ids")
        if not isinstance(raw_room_ids, list):
            return _messenger_json_error("room_ids 배열이 필요합니다.", 400)

        normalized_room_ids: list[int] = []
        seen_ids: set[int] = set()
        for raw_room_id in raw_room_ids:
            room_id_value = _payload_int(raw_room_id)
            if room_id_value <= 0 or room_id_value in seen_ids:
                continue
            room = await asyncio.to_thread(chat_repo.get_room_for_user, room_id_value, current_user_id)
            if not room or not _messenger_is_ascord_room(room) or not _messenger_supports_calls(room):
                return _messenger_json_error("ASCORD 음성채널만 순서를 조정할 수 있습니다.", 400)
            seen_ids.add(room_id_value)
            normalized_room_ids.append(room_id_value)
        if not normalized_room_ids:
            return _messenger_json_error("순서를 저장할 음성채널이 없습니다.", 400)

        try:
            await asyncio.to_thread(chat_repo.reorder_ascord_voice_channels, normalized_room_ids)
        except ValueError as exc:
            return JSONResponse({"ok": False, "detail": str(exc)}, status_code=400)
        except Exception as exc:
            return JSONResponse({"ok": False, "detail": f"음성채널 순서 저장 실패: {exc}"}, status_code=500)

        room_payloads: list[dict[str, Any]] = []
        for room_id in normalized_room_ids:
            await _messenger_refresh_room_state(room_id, notify=True)
            room_payload = await asyncio.to_thread(_build_single_messenger_room_payload, current_user_id, room_id)
            if room_payload:
                room_payloads.append(room_payload)
        return JSONResponse({"ok": True, "rooms": room_payloads})

    @router.delete("/api/messenger/rooms/{room_id}")
    async def api_messenger_delete_room(
        request: Request,
        room_id: int,
    ):
        current_user_id, room, error_response = await _messenger_require_room_for_user(request, room_id)
        if error_response is not None:
            return error_response
        if _messenger_is_direct_room(room):
            return _messenger_json_error("1:1 대화방은 삭제할 수 없습니다.", 400)
        if not _messenger_can_manage_room(room, current_user_id, _request_user_role(request)):
            return _messenger_json_error("대화방 삭제 권한이 없습니다.", 403)

        participant_ids = await asyncio.to_thread(chat_repo.list_room_user_ids, room_id)
        previous_avatar_path = _messenger_room_avatar_url_from_value(room.get("avatar_path"))
        deleted = await asyncio.to_thread(chat_repo.delete_room, room_id)
        if not deleted:
            return JSONResponse({"ok": False, "detail": "대화방 삭제에 실패했습니다."}, status_code=500)

        try:
            await asyncio.to_thread(
                meeting_notes.mark_room_deleted,
                room_id,
                str(room.get("name") or room.get("title") or "채널").strip() or "채널",
                participant_ids,
                deleted_at=time.time(),
            )
        except Exception:
            pass

        if previous_avatar_path:
            _delete_managed_messenger_room_avatar(previous_avatar_path)
        await _messenger_emit_room_state_for_users(participant_ids, room_id, notify=True)
        return JSONResponse({"ok": True, "room_id": room_id})

    @router.post("/api/messenger/rooms/{room_id}/members")
    async def api_messenger_invite_room_members(
        request: Request,
        room_id: int,
        payload: dict[str, Any] = Body(default={}),
    ):
        current_user_id, room, error_response = await _messenger_require_room_for_user(request, room_id)
        if error_response is not None:
            return error_response
        if _messenger_is_direct_room(room):
            return _messenger_json_error("1:1 대화방에는 멤버를 초대할 수 없습니다.", 400)
        if not _messenger_can_invite_room_members(room, current_user_id, _request_user_role(request)):
            return _messenger_json_error("멤버 초대 권한이 없습니다.", 403)

        user_directory, _contacts = await asyncio.to_thread(_build_messenger_user_directory, current_user_id)
        existing_member_ids = {
            str((member or {}).get("user_id") or "").strip()
            for member in list(room.get("members") or [])
            if str((member or {}).get("user_id") or "").strip()
        }
        requested_member_ids = [
            str(user_id or "").strip()
            for user_id in (payload.get("member_ids") or [])
        ]
        invite_member_ids: list[str] = []
        seen_user_ids: set[str] = set()
        for user_id in requested_member_ids:
            if not user_id or user_id in seen_user_ids:
                continue
            seen_user_ids.add(user_id)
            if user_id not in user_directory:
                continue
            if user_id in existing_member_ids:
                continue
            invite_member_ids.append(user_id)

        if not invite_member_ids:
            return JSONResponse({"ok": False, "detail": "초대할 구성원을 선택해주세요."}, status_code=400)

        try:
            added_member_ids = await asyncio.to_thread(chat_repo.add_room_members, room_id, invite_member_ids)
        except Exception as exc:
            return JSONResponse({"ok": False, "detail": f"멤버 초대 실패: {exc}"}, status_code=500)

        if not added_member_ids:
            return JSONResponse({"ok": False, "detail": "추가로 초대할 수 있는 구성원이 없습니다."}, status_code=400)

        await _messenger_refresh_room_state(room_id, notify=True)
        room_payload = await asyncio.to_thread(_build_single_messenger_room_payload, current_user_id, room_id)
        return JSONResponse({"ok": True, "room": room_payload, "member_ids": added_member_ids})

    @router.get("/api/messenger/ascord/workspace-invite")
    async def api_messenger_ascord_workspace_invite(
        request: Request,
        room_id: int = 0,
    ):
        current_user_id, room, error_response = await _messenger_require_room_for_user(request, room_id)
        if error_response is not None:
            return error_response
        if not _messenger_is_ascord_room(room):
            return _messenger_json_error("ASCORD 채널에서만 서버 초대를 열 수 있습니다.", 400)
        if not _messenger_can_invite_room_members(room, current_user_id, _request_user_role(request)):
            return _messenger_json_error("서버 초대 권한이 없습니다.", 403)

        user_directory, _contacts = await asyncio.to_thread(_build_messenger_user_directory, current_user_id)
        membership_payload = await asyncio.to_thread(_ascord_workspace_membership_payload, user_directory)
        active_member_ids = {
            str(item.get("user_id") or "").strip()
            for item in membership_payload.get("active_members") or []
            if str(item.get("user_id") or "").strip()
        }
        pending_members = membership_payload.get("invited_members") or []
        pending_member_ids = {
            str(item.get("user_id") or "").strip()
            for item in pending_members
            if str(item.get("user_id") or "").strip()
        }

        invite_candidates: list[dict[str, Any]] = []
        for user_id, profile in user_directory.items():
            if not user_id or user_id == current_user_id:
                continue
            if user_id in active_member_ids:
                continue
            item = dict(profile)
            item["workspace_invite_status"] = "invited" if user_id in pending_member_ids else "available"
            invite_candidates.append(item)
        invite_candidates.sort(
            key=lambda item: (
                1 if str(item.get("workspace_invite_status") or "available") == "invited" else 0,
                *_ascord_workspace_sort_key(item),
            )
        )

        base_url = str(request.base_url).rstrip("/")
        invite_link = f"{base_url}/message?open_messenger=1"
        if int(room.get("id") or 0) > 0:
            invite_link += f"&messenger_room_id={int(room.get('id') or 0)}"

        return JSONResponse(
            {
                "ok": True,
                "payload": {
                    "workspace": {
                        "key": "ascord",
                        "name": _ascord_workspace_name(),
                    },
                    "target_room": {
                        "id": int(room.get("id") or 0),
                        "title": str(room.get("title") or "ASCORD 채널"),
                        "channel_mode": str(room.get("channel_mode") or "voice"),
                    },
                    "invite_link": invite_link,
                    "server_members": membership_payload.get("active_members") or [],
                    "invite_candidates": invite_candidates,
                },
            }
        )

    @router.post("/api/messenger/ascord/workspace-invites")
    async def api_messenger_send_ascord_workspace_invite(
        request: Request,
        payload: dict[str, Any] = Body(default={}),
    ):
        room_id = int(payload.get("room_id") or 0)
        target_user_id = str(payload.get("user_id") or "").strip()
        current_user_id, room, error_response = await _messenger_require_room_for_user(request, room_id)
        if error_response is not None:
            return error_response
        if not _messenger_is_ascord_room(room):
            return _messenger_json_error("ASCORD 채널에서만 서버 초대를 보낼 수 있습니다.", 400)
        if not _messenger_can_invite_room_members(room, current_user_id, _request_user_role(request)):
            return _messenger_json_error("서버 초대 권한이 없습니다.", 403)
        if (not target_user_id) or target_user_id == current_user_id:
            return _messenger_json_error("초대할 사용자를 확인해주세요.", 400)

        user_directory, _contacts = await asyncio.to_thread(_build_messenger_user_directory, current_user_id)
        if target_user_id not in user_directory:
            return _messenger_json_error("사용자 정보를 찾을 수 없습니다.", 404)

        membership_payload = await asyncio.to_thread(_ascord_workspace_membership_payload, user_directory)
        active_member_ids = {
            str(item.get("user_id") or "").strip()
            for item in membership_payload.get("active_members") or []
            if str(item.get("user_id") or "").strip()
        }
        if target_user_id not in active_member_ids:
            await asyncio.to_thread(chat_repo.invite_workspace_members, "ascord", [target_user_id], current_user_id)

        dm_room_id = await asyncio.to_thread(chat_repo.get_or_create_direct_room, current_user_id, target_user_id)
        base_url = str(request.base_url).rstrip("/")
        invite_link = f"{base_url}/message?open_messenger=1&messenger_room_id={room_id}"
        invite_content = json.dumps(
            {
                "workspace_key": "ascord",
                "workspace_name": _ascord_workspace_name(),
                "invite_url": invite_link,
                "target_room_id": room_id,
                "target_room_title": str(room.get("title") or "ASCORD 채널"),
                "target_room_mode": str(room.get("channel_mode") or "voice"),
                "invited_user_id": target_user_id,
                "invited_by_user_id": current_user_id,
                "card_title": "음성 채널에 초대받았어요",
                "card_detail": f"{_ascord_workspace_name()} 워크스페이스 · {str(room.get('title') or 'ASCORD 채널')}",
                "button_label": "음성 채널 참가하기",
            },
            ensure_ascii=False,
        )
        try:
            message = await asyncio.to_thread(chat_repo.insert_message, dm_room_id, current_user_id, invite_content, "ascord_invite")
        except Exception as exc:
            return _messenger_json_error(f"서버 초대 메시지 전송에 실패했습니다: {exc}", 500)

        participant_ids = await asyncio.to_thread(chat_repo.list_room_user_ids, dm_room_id)
        await _messenger_emit_room_state_for_users(participant_ids, dm_room_id, notify=True)
        await _messenger_emit_message_created(participant_ids, message)
        message_payload = await asyncio.to_thread(_build_single_messenger_message_payload, current_user_id, message)
        return JSONResponse({"ok": True, "room_id": dm_room_id, "message": message_payload})

    @router.post("/api/messenger/messages/{message_id}/ascord-invite/accept")
    async def api_messenger_accept_ascord_workspace_invite(
        request: Request,
        message_id: int,
    ):
        current_user_id, error_response = _messenger_require_user_id(request)
        if error_response is not None:
            return error_response

        message = await asyncio.to_thread(chat_repo.get_message_by_id, message_id)
        if not message:
            return _messenger_json_error("초대 메시지를 찾을 수 없습니다.", 404)
        if str(message.get("message_type") or "").strip().lower() != "ascord_invite":
            return _messenger_json_error("ASCORD 초대 메시지가 아닙니다.", 400)
        if not await asyncio.to_thread(chat_repo.room_has_member, int(message.get("room_id") or 0), current_user_id):
            return _messenger_json_error("초대 메시지에 접근할 수 없습니다.", 403)

        invite_payload = _parse_ascord_invite_content(message.get("content"))
        if not invite_payload:
            return _messenger_json_error("초대 정보를 읽을 수 없습니다.", 400)
        invited_user_id = str(invite_payload.get("invited_user_id") or "").strip()
        if invited_user_id and invited_user_id != current_user_id:
            return _messenger_json_error("이 초대는 현재 계정을 위한 메시지가 아닙니다.", 403)

        workspace_row = await asyncio.to_thread(chat_repo.activate_workspace_member, "ascord", current_user_id)
        if not workspace_row:
            return _messenger_json_error("ASCORD 서버 멤버십을 활성화하지 못했습니다.", 400)

        target_room_id = int(invite_payload.get("target_room_id") or 0)
        room_payload = None
        if target_room_id > 0:
            target_room = await asyncio.to_thread(chat_repo.get_room_by_id, target_room_id)
            if target_room and _messenger_is_ascord_room(target_room):
                await asyncio.to_thread(chat_repo.add_room_members, target_room_id, [current_user_id])
                participant_ids = await asyncio.to_thread(chat_repo.list_room_user_ids, target_room_id)
                await _messenger_emit_room_state_for_users(participant_ids, target_room_id, notify=True)
                room_payload = await asyncio.to_thread(_build_single_messenger_room_payload, current_user_id, target_room_id)

        return JSONResponse(
            {
                "ok": True,
                "workspace_member": workspace_row,
                "room": room_payload,
                "target_room_id": target_room_id,
            }
        )

    @router.patch("/api/messenger/rooms/{room_id}/members/{target_user_id}")
    async def api_messenger_update_room_member_role(
        request: Request,
        room_id: int,
        target_user_id: str,
        payload: dict[str, Any] = Body(default={}),
    ):
        current_user_id, room, error_response = await _messenger_require_room_for_user(request, room_id)
        if error_response is not None:
            return error_response
        if _messenger_is_direct_room(room):
            return _messenger_json_error("1:1 대화방에서는 멤버 역할을 변경할 수 없습니다.", 400)

        normalized_target_user_id = str(target_user_id or "").strip()
        if not normalized_target_user_id:
            return _messenger_json_error("대상 사용자를 선택해주세요.", 400)
        if not _messenger_room_has_member(room, normalized_target_user_id):
            return _messenger_json_error("현재 이 대화방에 참여 중인 구성원이 아닙니다.", 404)

        next_member_role = _messenger_member_role(payload.get("member_role") or payload.get("role"))
        if next_member_role not in {"admin", "member"}:
            return _messenger_json_error("지원하지 않는 멤버 역할입니다.", 400)
        if not _messenger_can_change_room_member_role(
            room,
            current_user_id,
            normalized_target_user_id,
            next_member_role,
            _request_user_role(request),
        ):
            return _messenger_json_error("이 구성원의 역할을 변경할 권한이 없습니다.", 403)

        current_member_role = _messenger_room_member_role(room, normalized_target_user_id)
        if current_member_role == next_member_role:
            room_payload = await asyncio.to_thread(_build_single_messenger_room_payload, current_user_id, room_id)
            return JSONResponse(
                {
                    "ok": True,
                    "room": room_payload,
                    "room_id": int(room_id),
                    "target_user_id": normalized_target_user_id,
                    "member_role": next_member_role,
                }
            )

        try:
            updated = await asyncio.to_thread(chat_repo.update_room_member_role, room_id, normalized_target_user_id, next_member_role)
        except Exception as exc:
            return JSONResponse({"ok": False, "detail": f"멤버 역할 변경 실패: {exc}"}, status_code=500)

        if not updated:
            return JSONResponse({"ok": False, "detail": "멤버 역할을 변경하지 못했습니다."}, status_code=500)

        participant_ids = await asyncio.to_thread(chat_repo.list_room_user_ids, room_id)
        user_directory, _contacts = await asyncio.to_thread(_build_messenger_user_directory, current_user_id)
        actor_name = _messenger_member_display_name(room, current_user_id, user_directory)
        target_name = _messenger_member_display_name(room, normalized_target_user_id, user_directory)
        system_message = await asyncio.to_thread(
            chat_repo.insert_system_message,
            room_id,
            f"{actor_name}님이 {target_name}님을 {'ADMIN' if next_member_role == 'admin' else '일반 멤버'}로 변경했습니다.",
        )
        await _messenger_emit_message_created(participant_ids, system_message)
        await _messenger_emit_room_updates(participant_ids, room_id)
        room_payload = await asyncio.to_thread(_build_single_messenger_room_payload, current_user_id, room_id)
        return JSONResponse(
            {
                "ok": True,
                "room": room_payload,
                "room_id": int(room_id),
                "target_user_id": normalized_target_user_id,
                "member_role": next_member_role,
            }
        )

    @router.delete("/api/messenger/rooms/{room_id}/members/{target_user_id}")
    async def api_messenger_remove_room_member(
        request: Request,
        room_id: int,
        target_user_id: str,
    ):
        current_user_id, room, error_response = await _messenger_require_room_for_user(request, room_id)
        if error_response is not None:
            return error_response
        if _messenger_is_direct_room(room):
            return _messenger_json_error("1:1 대화방에서는 구성원을 제거할 수 없습니다.", 400)

        normalized_target_user_id = str(target_user_id or "").strip()
        if not normalized_target_user_id:
            return _messenger_json_error("대상 사용자를 선택해주세요.", 400)
        if not _messenger_room_has_member(room, normalized_target_user_id):
            return _messenger_json_error("현재 이 대화방에 참여 중인 구성원이 아닙니다.", 404)
        if not _messenger_can_remove_room_member(room, current_user_id, normalized_target_user_id, _request_user_role(request)):
            return _messenger_json_error("이 구성원을 제거할 권한이 없습니다.", 403)

        previous_participant_ids = await asyncio.to_thread(chat_repo.list_room_user_ids, room_id)
        remaining_participant_ids = [user_id for user_id in previous_participant_ids if user_id != normalized_target_user_id]
        removed_call_participant = await _MESSENGER_CALL_HUB.get_participant(room_id, normalized_target_user_id)
        previous_room_call = await _MESSENGER_CALL_HUB.get_room_call(room_id) if removed_call_participant else None
        if removed_call_participant:
            next_room_call = await _MESSENGER_CALL_HUB.leave_room(room_id, normalized_target_user_id)
            if (not next_room_call) and previous_room_call:
                await _messenger_finalize_call_log(room_id, previous_room_call, notify_user_ids=remaining_participant_ids)

        try:
            removed = await asyncio.to_thread(chat_repo.remove_room_member, room_id, normalized_target_user_id)
        except Exception as exc:
            return JSONResponse({"ok": False, "detail": f"멤버 제거 실패: {exc}"}, status_code=500)

        if not removed:
            return JSONResponse({"ok": False, "detail": "구성원을 제거하지 못했습니다."}, status_code=500)

        if removed_call_participant:
            await _messenger_emit_call_admin_control(
                normalized_target_user_id,
                room_id=room_id,
                action="disconnect",
                actor_user_id=current_user_id,
            )
        user_directory, _contacts = await asyncio.to_thread(_build_messenger_user_directory, current_user_id)
        actor_name = _messenger_member_display_name(room, current_user_id, user_directory)
        target_name = _messenger_member_display_name(room, normalized_target_user_id, user_directory)
        if remaining_participant_ids:
            system_message = await asyncio.to_thread(
                chat_repo.insert_system_message,
                room_id,
                f"{actor_name}님이 {target_name}님을 채널에서 제거했습니다.",
            )
            await _messenger_emit_message_created(remaining_participant_ids, system_message)
        await _messenger_emit_room_updates(previous_participant_ids, room_id)
        await _messenger_emit_notifications_update(previous_participant_ids)
        await _messenger_emit_call_state(remaining_participant_ids, room_id)
        room_payload = await asyncio.to_thread(_build_single_messenger_room_payload, current_user_id, room_id)
        return JSONResponse(
            {
                "ok": True,
                "room": room_payload,
                "room_id": int(room_id),
                "target_user_id": normalized_target_user_id,
            }
        )

    @router.post("/api/messenger/rooms/{room_id}/members/{target_user_id}/transfer-owner")
    async def api_messenger_transfer_room_owner(
        request: Request,
        room_id: int,
        target_user_id: str,
    ):
        current_user_id, room, error_response = await _messenger_require_room_for_user(request, room_id)
        if error_response is not None:
            return error_response
        if _messenger_is_direct_room(room):
            return _messenger_json_error("1:1 대화방에서는 owner를 이전할 수 없습니다.", 400)

        normalized_target_user_id = str(target_user_id or "").strip()
        if not normalized_target_user_id:
            return _messenger_json_error("대상 사용자를 선택해주세요.", 400)
        if not _messenger_can_transfer_room_owner(room, current_user_id, normalized_target_user_id, _request_user_role(request)):
            return _messenger_json_error("이 구성원에게 owner를 이전할 권한이 없습니다.", 403)

        try:
            transferred = await asyncio.to_thread(chat_repo.transfer_room_owner, room_id, normalized_target_user_id)
        except Exception as exc:
            return JSONResponse({"ok": False, "detail": f"owner 이전 실패: {exc}"}, status_code=500)

        if not transferred:
            return JSONResponse({"ok": False, "detail": "owner를 이전하지 못했습니다."}, status_code=500)

        participant_ids = await asyncio.to_thread(chat_repo.list_room_user_ids, room_id)
        user_directory, _contacts = await asyncio.to_thread(_build_messenger_user_directory, current_user_id)
        actor_name = _messenger_member_display_name(room, current_user_id, user_directory)
        target_name = _messenger_member_display_name(room, normalized_target_user_id, user_directory)
        system_message = await asyncio.to_thread(
            chat_repo.insert_system_message,
            room_id,
            f"{actor_name}님이 {target_name}님에게 OWNER 권한을 이전했습니다.",
        )
        await _messenger_emit_message_created(participant_ids, system_message)
        await _messenger_emit_room_updates(participant_ids, room_id)
        room_payload = await asyncio.to_thread(_build_single_messenger_room_payload, current_user_id, room_id)
        return JSONResponse(
            {
                "ok": True,
                "room": room_payload,
                "room_id": int(room_id),
                "target_user_id": normalized_target_user_id,
            }
        )

    @router.post("/api/messenger/rooms/{room_id}/leave")
    async def api_messenger_leave_room(
        request: Request,
        room_id: int,
    ):
        current_user_id, room, error_response = await _messenger_require_room_for_user(request, room_id)
        if error_response is not None:
            return error_response
        if _messenger_is_direct_room(room):
            return _messenger_json_error("1:1 대화방에서는 나가기 대신 대화를 닫아주세요.", 400)
        if _messenger_is_system_room(room):
            return _messenger_json_error("기본 채널에서는 나갈 수 없습니다.", 400)

        my_role = _messenger_room_member_role(room, current_user_id)
        if my_role == "owner":
            return _messenger_json_error("owner는 먼저 다른 구성원에게 권한을 이전한 뒤 나갈 수 있습니다.", 400)

        previous_participant_ids = await asyncio.to_thread(chat_repo.list_room_user_ids, room_id)
        remaining_participant_ids = [user_id for user_id in previous_participant_ids if user_id != current_user_id]
        self_call_participant = await _MESSENGER_CALL_HUB.get_participant(room_id, current_user_id)
        previous_room_call = await _MESSENGER_CALL_HUB.get_room_call(room_id) if self_call_participant else None
        if self_call_participant:
            next_room_call = await _MESSENGER_CALL_HUB.leave_room(room_id, current_user_id)
            if (not next_room_call) and previous_room_call:
                await _messenger_finalize_call_log(room_id, previous_room_call, notify_user_ids=remaining_participant_ids)

        try:
            removed = await asyncio.to_thread(chat_repo.remove_room_member, room_id, current_user_id)
        except Exception as exc:
            return JSONResponse({"ok": False, "detail": f"채널 나가기 실패: {exc}"}, status_code=500)

        if not removed:
            return JSONResponse({"ok": False, "detail": "채널에서 나가지 못했습니다."}, status_code=500)

        user_directory, _contacts = await asyncio.to_thread(_build_messenger_user_directory, current_user_id)
        actor_name = _messenger_member_display_name(room, current_user_id, user_directory)
        if remaining_participant_ids:
            system_message = await asyncio.to_thread(
                chat_repo.insert_system_message,
                room_id,
                f"{actor_name}님이 채널을 나갔습니다.",
            )
            await _messenger_emit_message_created(remaining_participant_ids, system_message)
        await _messenger_emit_room_updates(previous_participant_ids, room_id)
        await _messenger_emit_notifications_update(previous_participant_ids)
        await _messenger_emit_call_state(remaining_participant_ids, room_id)
        return JSONResponse({"ok": True, "room_id": int(room_id)})

    @router.post("/api/messenger/rooms/{room_id}/messages")
    async def api_messenger_send_message(
        request: Request,
        room_id: int,
        payload: dict[str, Any] = Body(default={}),
    ):
        current_user_id, room, error_response = await _messenger_require_room_for_user(request, room_id)
        if error_response is not None:
            return error_response
        if _messenger_is_ascord_room(room):
            return _messenger_json_error("ASCORD 채널은 텍스트 메시지를 지원하지 않습니다.", 400)

        content = str(payload.get("content") or "").strip()
        try:
            message = await asyncio.to_thread(chat_repo.insert_message, room_id, current_user_id, content)
        except PermissionError:
            return JSONResponse({"ok": False, "detail": "대화방 접근 권한이 없습니다."}, status_code=403)
        except ValueError as exc:
            return JSONResponse({"ok": False, "detail": str(exc)}, status_code=400)
        except Exception as exc:
            return JSONResponse({"ok": False, "detail": f"메시지 전송 실패: {exc}"}, status_code=500)

        participant_ids = await asyncio.to_thread(chat_repo.list_room_user_ids, room_id)
        await _messenger_emit_message_created(participant_ids, message)
        await _messenger_emit_room_state_for_users(participant_ids, room_id, notify=True)
        message_payload = await asyncio.to_thread(_build_single_messenger_message_payload, current_user_id, message)
        return JSONResponse({"ok": True, "message": message_payload})

    @router.patch("/api/messenger/messages/{message_id}")
    async def api_messenger_update_message(
        request: Request,
        message_id: int,
        payload: dict[str, Any] = Body(default={}),
    ):
        current_user_id, error_response = _messenger_require_user_id(request)
        if error_response is not None:
            return error_response

        current_user_role = _request_user_role(request)
        message = await asyncio.to_thread(chat_repo.get_message_by_id, message_id)
        if not message or str(message.get("deleted_at") or "").strip():
            return JSONResponse({"ok": False, "detail": "메시지를 찾을 수 없습니다."}, status_code=404)

        room_id = int(message.get("room_id") or 0)
        if room_id <= 0 or not await asyncio.to_thread(chat_repo.room_has_member, room_id, current_user_id):
            return JSONResponse({"ok": False, "detail": "메시지를 찾을 수 없습니다."}, status_code=404)
        if not _messenger_can_edit_message(message, current_user_id, current_user_role):
            return JSONResponse({"ok": False, "detail": "메시지 수정 권한이 없습니다."}, status_code=403)

        try:
            updated_message = await asyncio.to_thread(chat_repo.update_message_content, message_id, str(payload.get("content") or ""))
        except ValueError as exc:
            return JSONResponse({"ok": False, "detail": str(exc)}, status_code=400)
        except Exception as exc:
            return JSONResponse({"ok": False, "detail": f"메시지 수정 실패: {exc}"}, status_code=500)
        if not updated_message:
            return JSONResponse({"ok": False, "detail": "메시지 수정에 실패했습니다."}, status_code=500)

        participant_ids = await asyncio.to_thread(chat_repo.list_room_user_ids, room_id)
        await _messenger_emit_message_updated(participant_ids, updated_message)
        await _messenger_emit_room_updates(participant_ids, room_id)
        await _messenger_emit_notifications_update(participant_ids)
        message_payload = await asyncio.to_thread(_build_single_messenger_message_payload, current_user_id, updated_message)
        return JSONResponse({"ok": True, "message": message_payload})

    @router.delete("/api/messenger/messages/{message_id}")
    async def api_messenger_delete_message(
        request: Request,
        message_id: int,
    ):
        current_user_id, error_response = _messenger_require_user_id(request)
        if error_response is not None:
            return error_response

        current_user_role = _request_user_role(request)
        message = await asyncio.to_thread(chat_repo.get_message_by_id, message_id)
        if not message or str(message.get("deleted_at") or "").strip():
            return JSONResponse({"ok": False, "detail": "메시지를 찾을 수 없습니다."}, status_code=404)

        room_id = int(message.get("room_id") or 0)
        room = await asyncio.to_thread(chat_repo.get_room_for_user, room_id, current_user_id)
        if not room:
            return JSONResponse({"ok": False, "detail": "메시지를 찾을 수 없습니다."}, status_code=404)
        room_can_manage = _messenger_can_manage_room(room, current_user_id, current_user_role)
        if not _messenger_can_delete_message(message, current_user_id, current_user_role=current_user_role, room_can_manage=room_can_manage):
            return JSONResponse({"ok": False, "detail": "메시지 삭제 권한이 없습니다."}, status_code=403)

        delete_result = await asyncio.to_thread(chat_repo.delete_message, message_id)
        if int(delete_result.get("room_id") or 0) <= 0:
            return JSONResponse({"ok": False, "detail": "메시지 삭제에 실패했습니다."}, status_code=500)

        participant_ids = await asyncio.to_thread(chat_repo.list_room_user_ids, room_id)
        await _messenger_emit_message_deleted(participant_ids, room_id=room_id, message_id=message_id)
        await _messenger_emit_room_state_for_users(participant_ids, room_id, notify=True)
        return JSONResponse({"ok": True, "room_id": room_id, "message_id": message_id})

    @router.post("/api/messenger/rooms/{room_id}/read")
    async def api_messenger_mark_read(
        request: Request,
        room_id: int,
        payload: dict[str, Any] = Body(default={}),
    ):
        current_user_id, _room, error_response = await _messenger_require_room_for_user(request, room_id)
        if error_response is not None:
            return error_response

        message_id = _payload_int(payload.get("message_id"), 0)
        resolved_message_id = await asyncio.to_thread(chat_repo.mark_room_read, room_id, current_user_id, message_id)
        await _messenger_emit_room_update(current_user_id, room_id)
        await _messenger_emit_notifications_update([current_user_id])
        return JSONResponse({"ok": True, "message_id": resolved_message_id})

    @router.post("/api/messenger/rooms/{room_id}/star")
    async def api_messenger_room_star(
        request: Request,
        room_id: int,
        payload: dict[str, Any] = Body(default={}),
    ):
        current_user_id, _room, error_response = await _messenger_require_room_for_user(request, room_id)
        if error_response is not None:
            return error_response

        starred = _payload_bool(payload.get("starred"), False)
        await asyncio.to_thread(chat_repo.set_room_star, room_id, current_user_id, starred)
        await _messenger_emit_room_update(current_user_id, room_id)
        room_payload = await asyncio.to_thread(_build_single_messenger_room_payload, current_user_id, room_id)
        return JSONResponse({"ok": True, "room": room_payload})

    @router.post("/api/messenger/rooms/{room_id}/mute")
    async def api_messenger_room_mute(
        request: Request,
        room_id: int,
        payload: dict[str, Any] = Body(default={}),
    ):
        current_user_id, _room, error_response = await _messenger_require_room_for_user(request, room_id)
        if error_response is not None:
            return error_response

        muted = _payload_bool(payload.get("muted"), False)
        await asyncio.to_thread(chat_repo.set_room_mute, room_id, current_user_id, muted)
        await _messenger_emit_room_update(current_user_id, room_id)
        await _messenger_emit_notifications_update([current_user_id])
        room_payload = await asyncio.to_thread(_build_single_messenger_room_payload, current_user_id, room_id)
        return JSONResponse({"ok": True, "room": room_payload})

    @router.post("/api/messenger/rooms/{room_id}/avatar")
    async def api_messenger_room_avatar(
        request: Request,
        room_id: int,
        payload: dict[str, Any] = Body(default={}),
    ):
        current_user_id, room, error_response = await _messenger_require_room_for_user(request, room_id)
        if error_response is not None:
            return error_response
        if _messenger_is_direct_room(room):
            return _messenger_json_error("1:1 대화방은 상대 프로필을 사용합니다.", 400)
        if not _messenger_can_manage_room(room, current_user_id, _request_user_role(request)):
            return _messenger_json_error("방 이미지 수정 권한이 없습니다.", 403)

        next_avatar_path = str(payload.get("avatar_path") or "").strip()
        if next_avatar_path and next_avatar_path not in MESSENGER_ROOM_AVATAR_PRESETS:
            return _messenger_json_error("허용되지 않는 기본 이미지입니다.", 400)

        previous_avatar_path = _messenger_room_avatar_url_from_value(room.get("avatar_path"))
        await asyncio.to_thread(chat_repo.set_room_avatar, room_id, next_avatar_path)
        if previous_avatar_path and previous_avatar_path != next_avatar_path:
            _delete_managed_messenger_room_avatar(previous_avatar_path)

        await _messenger_refresh_room_state(room_id)
        room_payload = await asyncio.to_thread(_build_single_messenger_room_payload, current_user_id, room_id)
        return JSONResponse({"ok": True, "room": room_payload})

    @router.post("/api/messenger/rooms/{room_id}/avatar/upload")
    async def api_messenger_room_avatar_upload(
        request: Request,
        room_id: int,
        avatar: UploadFile = File(...),
    ):
        current_user_id, room, error_response = await _messenger_require_room_for_user(request, room_id)
        if error_response is not None:
            return error_response
        if _messenger_is_direct_room(room):
            return _messenger_json_error("1:1 대화방은 상대 프로필을 사용합니다.", 400)
        if not _messenger_can_manage_room(room, current_user_id, _request_user_role(request)):
            return _messenger_json_error("방 이미지 수정 권한이 없습니다.", 403)

        try:
            stored_avatar_path = await _store_messenger_room_avatar(room_id, avatar)
        except ValueError as exc:
            return JSONResponse({"ok": False, "detail": str(exc)}, status_code=400)
        except Exception as exc:
            return JSONResponse({"ok": False, "detail": f"방 이미지 업로드 실패: {exc}"}, status_code=500)
        finally:
            try:
                await avatar.close()
            except Exception:
                pass

        previous_avatar_path = _messenger_room_avatar_url_from_value(room.get("avatar_path"))
        try:
            await asyncio.to_thread(chat_repo.set_room_avatar, room_id, stored_avatar_path)
        except Exception as exc:
            _delete_managed_messenger_room_avatar(stored_avatar_path)
            return JSONResponse({"ok": False, "detail": f"방 이미지 저장 실패: {exc}"}, status_code=500)

        if previous_avatar_path and previous_avatar_path != stored_avatar_path:
            _delete_managed_messenger_room_avatar(previous_avatar_path)

        await _messenger_refresh_room_state(room_id)
        room_payload = await asyncio.to_thread(_build_single_messenger_room_payload, current_user_id, room_id)
        return JSONResponse({"ok": True, "room": room_payload})

    @router.post("/api/messenger/rooms/{room_id}/attachments")
    async def api_messenger_upload_attachment(
        request: Request,
        room_id: int,
        attachment: UploadFile = File(...),
    ):
        current_user_id, room, error_response = await _messenger_require_room_for_user(request, room_id)
        if error_response is not None:
            return error_response
        if _messenger_is_ascord_room(room):
            return _messenger_json_error("ASCORD 채널은 파일 첨부를 지원하지 않습니다.", 400)

        filename = os.path.basename(str(attachment.filename or "").strip())
        content_type = str(attachment.content_type or "").strip()
        if not filename:
            return _messenger_json_error("첨부 파일 이름이 올바르지 않습니다.", 400)

        _, ext = os.path.splitext(filename)
        ext = ext.lower()
        if ext not in MESSENGER_UPLOAD_ALLOWED_EXTENSIONS:
            return _messenger_json_error("허용되지 않는 첨부 파일 형식입니다.", 400)

        try:
            file_bytes = await attachment.read()
        finally:
            try:
                await attachment.close()
            except Exception:
                pass

        if not file_bytes:
            return _messenger_json_error("빈 파일은 업로드할 수 없습니다.", 400)
        if len(file_bytes) > MESSENGER_UPLOAD_MAX_BYTES:
            return _messenger_json_error(
                f"첨부 파일은 최대 {_messenger_human_size(MESSENGER_UPLOAD_MAX_BYTES)}까지 업로드할 수 있습니다.",
                400,
            )

        room_dir = os.path.join(MESSENGER_UPLOAD_STORAGE_DIR, str(int(room_id)))
        os.makedirs(room_dir, exist_ok=True)
        safe_root = re.sub(r"[^A-Za-z0-9._-]+", "_", os.path.splitext(filename)[0]).strip("._") or "file"
        stored_name = f"{int(time.time())}_{secrets.token_hex(5)}_{safe_root[:80]}{ext}"
        stored_path = os.path.join(room_dir, stored_name)
        with open(stored_path, "wb") as file_obj:
            file_obj.write(file_bytes)

        public_url = f"{MESSENGER_UPLOAD_PUBLIC_PREFIX}/{int(room_id)}/{stored_name}"
        message_type = "image" if (content_type.startswith("image/") or ext in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"}) else "file"
        message_content = json.dumps(
            {
                "name": filename,
                "url": public_url,
                "size_text": _messenger_human_size(len(file_bytes)),
                "content_type": content_type,
            },
            ensure_ascii=False,
        )

        try:
            message = await asyncio.to_thread(chat_repo.insert_message, room_id, current_user_id, message_content, message_type)
        except Exception as exc:
            try:
                os.remove(stored_path)
            except Exception:
                pass
            return JSONResponse({"ok": False, "detail": f"첨부 파일 전송 실패: {exc}"}, status_code=500)

        participant_ids = await asyncio.to_thread(chat_repo.list_room_user_ids, room_id)
        await _messenger_emit_message_created(participant_ids, message)
        await _messenger_emit_room_state_for_users(participant_ids, room_id, notify=True)
        message_payload = await asyncio.to_thread(_build_single_messenger_message_payload, current_user_id, message)
        return JSONResponse({"ok": True, "message": message_payload})

    @router.get("/api/messenger/users/{target_user_id}/profile")
    async def api_messenger_user_profile(
        request: Request,
        target_user_id: str,
    ):
        current_user_id, error_response = _messenger_require_user_id(request)
        if error_response is not None:
            return error_response

        profile_payload = await asyncio.to_thread(_build_messenger_user_profile_payload, current_user_id, target_user_id)
        if not profile_payload:
            return JSONResponse({"ok": False, "detail": "사용자 정보를 찾을 수 없습니다."}, status_code=404)
        return JSONResponse({"ok": True, "profile": profile_payload})

    @router.post("/api/messenger/presence-status")
    async def api_messenger_presence_status(
        request: Request,
        payload: dict[str, Any] = Body(default={}),
    ):
        current_user_id, error_response = _messenger_require_user_id(request)
        if error_response is not None:
            return error_response

        next_status = str((payload or {}).get("status") or "").strip().lower()
        if next_status not in {"online", "away", "dnd", "invisible"}:
            return JSONResponse({"ok": False, "detail": "지원하지 않는 상태입니다."}, status_code=400)

        try:
            await asyncio.to_thread(
                user_repo.update_user_presence_override,
                user_id=current_user_id,
                presence_override=next_status,
            )
            refreshed_row = await asyncio.to_thread(pages_module.read_user, current_user_id)
            try:
                request.state.user_row = refreshed_row or {}
            except Exception:
                pass
            profile_payload = await asyncio.to_thread(_build_messenger_user_profile_payload, current_user_id, current_user_id)
            active_sessions = await asyncio.to_thread(pages_module.list_active_sessions)
            target_user_ids = pages_module._messenger_unique_user_ids(
                [item.get("user_id") for item in list(active_sessions or [])] + [current_user_id]
            )
            for target_user_id in target_user_ids:
                bootstrap_payload = await asyncio.to_thread(_build_messenger_bootstrap_payload, target_user_id, requested_room_id=0)
                await _MESSENGER_HUB.send_to_user(target_user_id, {"type": "bootstrap", "payload": bootstrap_payload})
        except Exception:
            return JSONResponse({"ok": False, "detail": "상태를 저장하지 못했습니다."}, status_code=500)

        return JSONResponse({"ok": True, "profile": profile_payload or {}})


__all__ = ["register_messenger_api_routes"]
