from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from fastapi import WebSocket


class _MessengerHub:
    def __init__(self) -> None:
        self._connections: dict[str, list[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, user_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            sockets = self._connections.setdefault(user_id, [])
            if websocket not in sockets:
                sockets.append(websocket)

    async def disconnect(self, user_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            sockets = list(self._connections.get(user_id) or [])
            if websocket in sockets:
                sockets.remove(websocket)
            if sockets:
                self._connections[user_id] = sockets
            else:
                self._connections.pop(user_id, None)

    async def send_to_user(self, user_id: str, payload: dict[str, Any]) -> None:
        async with self._lock:
            sockets = list(self._connections.get(user_id) or [])
        if not sockets:
            return

        serialized = json.dumps(payload, ensure_ascii=False)
        stale_sockets: list[WebSocket] = []
        for websocket in sockets:
            try:
                await websocket.send_text(serialized)
            except Exception:
                stale_sockets.append(websocket)

        if stale_sockets:
            async with self._lock:
                current = list(self._connections.get(user_id) or [])
                current = [websocket for websocket in current if websocket not in stale_sockets]
                if current:
                    self._connections[user_id] = current
                else:
                    self._connections.pop(user_id, None)

    async def has_connection(self, user_id: str) -> bool:
        async with self._lock:
            return bool(self._connections.get(user_id))


class _MessengerCallHub:
    def __init__(self) -> None:
        self._calls_by_room: dict[int, dict[str, Any]] = {}
        self._lock = asyncio.Lock()

    @staticmethod
    def _normalize_mode(value: Any) -> str:
        mode = str(value or "").strip().lower()
        if mode in {"audio", "video"}:
            return mode
        return "audio"

    @staticmethod
    def _normalize_source(value: Any) -> str:
        source = str(value or "").strip().lower()
        if source in {"camera", "screen"}:
            return source
        return "camera"

    @staticmethod
    def _normalize_stage_role(value: Any) -> str:
        return "speaker" if str(value or "").strip().lower() == "speaker" else "audience"

    @staticmethod
    def _participant_view(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "user_id": str(row.get("user_id") or ""),
            "display_name": str(row.get("display_name") or row.get("user_id") or ""),
            "joined_at": float(row.get("joined_at") or 0.0),
            "media_mode": str(row.get("media_mode") or "audio"),
            "audio_enabled": bool(row.get("audio_enabled")),
            "video_enabled": bool(row.get("video_enabled")),
            "sharing_screen": bool(row.get("sharing_screen")),
            "deafened": bool(row.get("deafened")),
            "source": str(row.get("source") or "camera"),
            "server_muted": bool(row.get("server_muted")),
            "stage_role": "speaker" if str(row.get("stage_role") or "").strip().lower() == "speaker" else "audience",
            "speaker_requested": bool(row.get("speaker_requested")),
        }

    def _call_view_locked(self, room_id: int) -> dict[str, Any] | None:
        call = self._calls_by_room.get(int(room_id) or 0)
        if not call:
            return None
        participants = sorted(
            [self._participant_view(item) for item in (call.get("participants") or {}).values()],
            key=lambda item: (
                0 if str(item.get("stage_role") or "") == "speaker" else (1 if bool(item.get("speaker_requested")) else 2),
                float(item.get("joined_at") or 0.0),
                str(item.get("user_id") or ""),
            ),
        )
        return {
            "room_id": int(call.get("room_id") or 0),
            "call_id": str(call.get("call_id") or ""),
            "started_at": float(call.get("started_at") or 0.0),
            "updated_at": float(call.get("updated_at") or 0.0),
            "participant_count": len(participants),
            "speaker_count": sum(1 for item in participants if str(item.get("stage_role") or "") == "speaker"),
            "audience_count": sum(1 for item in participants if str(item.get("stage_role") or "") != "speaker"),
            "speaker_request_count": sum(1 for item in participants if bool(item.get("speaker_requested"))),
            "participants": participants,
        }

    async def get_room_call(self, room_id: int) -> dict[str, Any] | None:
        async with self._lock:
            return self._call_view_locked(int(room_id) or 0)

    async def join_room(
        self,
        room_id: int,
        user_id: str,
        *,
        display_name: str = "",
        media_mode: Any = "audio",
        audio_enabled: bool = True,
        video_enabled: bool = False,
        sharing_screen: bool = False,
        deafened: bool = False,
        source: Any = "camera",
        stage_role: Any = "speaker",
    ) -> dict[str, Any] | None:
        target_room_id = int(room_id or 0)
        normalized_user_id = str(user_id or "").strip()
        if target_room_id <= 0 or not normalized_user_id:
            return None

        async with self._lock:
            call = self._calls_by_room.get(target_room_id)
            now_ts = time.time()
            if not call:
                call = {
                    "room_id": target_room_id,
                    "call_id": f"room-{target_room_id}-{int(now_ts * 1000)}",
                    "started_at": now_ts,
                    "updated_at": now_ts,
                    "participants": {},
                }
                self._calls_by_room[target_room_id] = call

            participants = call["participants"]
            previous = dict(participants.get(normalized_user_id) or {})
            resolved_stage_role = self._normalize_stage_role(previous.get("stage_role") or stage_role)
            participants[normalized_user_id] = {
                "user_id": normalized_user_id,
                "display_name": str(display_name or previous.get("display_name") or normalized_user_id),
                "joined_at": float(previous.get("joined_at") or now_ts),
                "media_mode": self._normalize_mode(media_mode),
                "audio_enabled": False if bool(previous.get("server_muted")) else bool(audio_enabled),
                "video_enabled": bool(video_enabled),
                "sharing_screen": bool(sharing_screen),
                "deafened": bool(deafened),
                "source": self._normalize_source(source),
                "server_muted": bool(previous.get("server_muted")),
                "stage_role": resolved_stage_role,
                "speaker_requested": False if resolved_stage_role == "speaker" else bool(previous.get("speaker_requested")),
            }
            call["updated_at"] = now_ts
            return self._call_view_locked(target_room_id)

    async def update_media_state(
        self,
        room_id: int,
        user_id: str,
        *,
        audio_enabled: Any = None,
        video_enabled: Any = None,
        sharing_screen: Any = None,
        deafened: Any = None,
        media_mode: Any = None,
        source: Any = None,
    ) -> dict[str, Any] | None:
        target_room_id = int(room_id or 0)
        normalized_user_id = str(user_id or "").strip()
        if target_room_id <= 0 or not normalized_user_id:
            return None

        async with self._lock:
            call = self._calls_by_room.get(target_room_id)
            if not call:
                return None
            participants = call.get("participants") or {}
            participant = participants.get(normalized_user_id)
            if not participant:
                return None
            if audio_enabled is not None:
                participant["audio_enabled"] = False if bool(participant.get("server_muted")) else bool(audio_enabled)
            if video_enabled is not None:
                participant["video_enabled"] = bool(video_enabled)
            if sharing_screen is not None:
                participant["sharing_screen"] = bool(sharing_screen)
            if deafened is not None:
                participant["deafened"] = bool(deafened)
            if media_mode is not None:
                participant["media_mode"] = self._normalize_mode(media_mode)
            if source is not None:
                participant["source"] = self._normalize_source(source)
            call["updated_at"] = time.time()
            return self._call_view_locked(target_room_id)

    async def set_stage_role(self, room_id: int, user_id: str, stage_role: Any) -> dict[str, Any] | None:
        target_room_id = int(room_id or 0)
        normalized_user_id = str(user_id or "").strip()
        if target_room_id <= 0 or not normalized_user_id:
            return None
        async with self._lock:
            call = self._calls_by_room.get(target_room_id)
            if not call:
                return None
            participant = (call.get("participants") or {}).get(normalized_user_id)
            if not participant:
                return None
            resolved_stage_role = self._normalize_stage_role(stage_role)
            participant["stage_role"] = resolved_stage_role
            participant["speaker_requested"] = False
            if resolved_stage_role != "speaker":
                participant["audio_enabled"] = False
                participant["video_enabled"] = False
                participant["sharing_screen"] = False
                participant["media_mode"] = "audio"
                participant["source"] = "camera"
            call["updated_at"] = time.time()
            return self._call_view_locked(target_room_id)

    async def set_stage_request(self, room_id: int, user_id: str, requested: bool) -> dict[str, Any] | None:
        target_room_id = int(room_id or 0)
        normalized_user_id = str(user_id or "").strip()
        if target_room_id <= 0 or not normalized_user_id:
            return None
        async with self._lock:
            call = self._calls_by_room.get(target_room_id)
            if not call:
                return None
            participant = (call.get("participants") or {}).get(normalized_user_id)
            if not participant:
                return None
            if self._normalize_stage_role(participant.get("stage_role")) == "speaker":
                participant["speaker_requested"] = False
            else:
                participant["speaker_requested"] = bool(requested)
            call["updated_at"] = time.time()
            return self._call_view_locked(target_room_id)

    async def get_participant(self, room_id: int, user_id: str) -> dict[str, Any] | None:
        target_room_id = int(room_id or 0)
        normalized_user_id = str(user_id or "").strip()
        if target_room_id <= 0 or not normalized_user_id:
            return None
        async with self._lock:
            call = self._calls_by_room.get(target_room_id)
            if not call:
                return None
            participant = (call.get("participants") or {}).get(normalized_user_id)
            return self._participant_view(participant) if participant else None

    async def set_server_muted(self, room_id: int, user_id: str, muted: bool) -> dict[str, Any] | None:
        target_room_id = int(room_id or 0)
        normalized_user_id = str(user_id or "").strip()
        if target_room_id <= 0 or not normalized_user_id:
            return None
        async with self._lock:
            call = self._calls_by_room.get(target_room_id)
            if not call:
                return None
            participant = (call.get("participants") or {}).get(normalized_user_id)
            if not participant:
                return None
            participant["server_muted"] = bool(muted)
            if participant["server_muted"]:
                participant["audio_enabled"] = False
            call["updated_at"] = time.time()
            return self._call_view_locked(target_room_id)

    async def leave_room(self, room_id: int, user_id: str) -> dict[str, Any] | None:
        target_room_id = int(room_id or 0)
        normalized_user_id = str(user_id or "").strip()
        if target_room_id <= 0 or not normalized_user_id:
            return None

        async with self._lock:
            call = self._calls_by_room.get(target_room_id)
            if not call:
                return None
            participants = call.get("participants") or {}
            participants.pop(normalized_user_id, None)
            if not participants:
                self._calls_by_room.pop(target_room_id, None)
                return None
            call["updated_at"] = time.time()
            return self._call_view_locked(target_room_id)

    async def room_has_participant(self, room_id: int, user_id: str) -> bool:
        target_room_id = int(room_id or 0)
        normalized_user_id = str(user_id or "").strip()
        if target_room_id <= 0 or not normalized_user_id:
            return False
        async with self._lock:
            call = self._calls_by_room.get(target_room_id)
            if not call:
                return False
            participants = call.get("participants") or {}
            return normalized_user_id in participants

    async def leave_all(self, user_id: str) -> list[dict[str, Any]]:
        normalized_user_id = str(user_id or "").strip()
        if not normalized_user_id:
            return []
        affected_calls: list[dict[str, Any]] = []
        async with self._lock:
            for room_id in list(self._calls_by_room):
                call = self._calls_by_room.get(room_id)
                if not call:
                    continue
                participants = call.get("participants") or {}
                if normalized_user_id not in participants:
                    continue
                previous_call = self._call_view_locked(int(room_id) or 0)
                participants.pop(normalized_user_id, None)
                if not participants:
                    self._calls_by_room.pop(room_id, None)
                    affected_calls.append(
                        {
                            "room_id": int(room_id),
                            "previous_call": previous_call,
                            "call_cleared": True,
                        }
                    )
                else:
                    call["updated_at"] = time.time()
                    affected_calls.append(
                        {
                            "room_id": int(room_id),
                            "previous_call": previous_call,
                            "call_cleared": False,
                        }
                    )
        return affected_calls


_MESSENGER_HUB = _MessengerHub()
_MESSENGER_CALL_HUB = _MessengerCallHub()


class _MessengerTranscriptHub:
    def __init__(self) -> None:
        self._entries_by_room: dict[int, dict[str, Any]] = {}
        self._lock = asyncio.Lock()

    async def sync_room_call(self, room_id: int, call_id: str) -> list[dict[str, Any]]:
        target_room_id = int(room_id or 0)
        normalized_call_id = str(call_id or "").strip()
        if target_room_id <= 0:
            return []
        async with self._lock:
            if not normalized_call_id:
                self._entries_by_room.pop(target_room_id, None)
                return []
            current = self._entries_by_room.get(target_room_id)
            if not current or str(current.get("call_id") or "") != normalized_call_id:
                current = {
                    "call_id": normalized_call_id,
                    "next_id": 1,
                    "entries": [],
                }
                self._entries_by_room[target_room_id] = current
            return [dict(item) for item in (current.get("entries") or [])]

    async def append_entry(self, room_id: int, call_id: str, entry: dict[str, Any]) -> dict[str, Any] | None:
        target_room_id = int(room_id or 0)
        normalized_call_id = str(call_id or "").strip()
        if target_room_id <= 0 or not normalized_call_id:
            return None
        payload = dict(entry or {})
        async with self._lock:
            current = self._entries_by_room.get(target_room_id)
            if not current or str(current.get("call_id") or "") != normalized_call_id:
                current = {
                    "call_id": normalized_call_id,
                    "next_id": 1,
                    "entries": [],
                }
                self._entries_by_room[target_room_id] = current
            next_id = int(current.get("next_id") or 1)
            current["next_id"] = next_id + 1
            normalized_entry = {
                "id": next_id,
                "room_id": target_room_id,
                "call_id": normalized_call_id,
                "user_id": str(payload.get("user_id") or "").strip(),
                "display_name": str(payload.get("display_name") or "").strip(),
                "source_item_id": str(payload.get("source_item_id") or payload.get("item_id") or "").strip(),
                "text": str(payload.get("text") or "").strip(),
                "spoken_at": float(payload.get("spoken_at") or time.time()),
                "created_at": float(payload.get("created_at") or time.time()),
                "duration_ms": max(int(payload.get("duration_ms") or 0), 0),
            }
            entries = list(current.get("entries") or [])
            entries.append(normalized_entry)
            if len(entries) > 200:
                entries = entries[-200:]
            current["entries"] = entries
            return dict(normalized_entry)

    async def get_room_entries(self, room_id: int, call_id: str) -> list[dict[str, Any]]:
        target_room_id = int(room_id or 0)
        normalized_call_id = str(call_id or "").strip()
        if target_room_id <= 0 or not normalized_call_id:
            return []
        async with self._lock:
            current = self._entries_by_room.get(target_room_id)
            if not current or str(current.get("call_id") or "") != normalized_call_id:
                return []
            return [dict(item) for item in (current.get("entries") or [])]

    async def clear_room(self, room_id: int) -> None:
        target_room_id = int(room_id or 0)
        if target_room_id <= 0:
            return
        async with self._lock:
            self._entries_by_room.pop(target_room_id, None)


_MESSENGER_TRANSCRIPT_HUB = _MessengerTranscriptHub()


__all__ = ["_MESSENGER_CALL_HUB", "_MESSENGER_HUB", "_MESSENGER_TRANSCRIPT_HUB"]
