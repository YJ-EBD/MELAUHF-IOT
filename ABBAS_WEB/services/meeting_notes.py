from __future__ import annotations

from datetime import datetime
from pathlib import Path
import re
import threading
import time
from typing import Any


_ROOT_DIR = Path(__file__).resolve().parents[1]
_MEETING_DATA_DIR = _ROOT_DIR / "meeting_data"
_FILENAME_TS_RE = re.compile(r"^(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})")
_ROOM_DIR_RE = re.compile(r"^room-(\d+)__")
_ACTIVE_NOTE_PATHS: dict[tuple[int, str], Path] = {}
_LOCK = threading.Lock()


def meeting_data_dir() -> Path:
    _MEETING_DATA_DIR.mkdir(parents=True, exist_ok=True)
    return _MEETING_DATA_DIR


def _norm_text(value: Any) -> str:
    return str(value or "").strip()


def _safe_segment(value: Any, fallback: str) -> str:
    text = _norm_text(value)
    if not text:
        text = fallback
    text = re.sub(r'[\\/:*?"<>|]+', " ", text)
    text = re.sub(r"\s+", " ", text).strip(" .")
    return text[:80] or fallback


def _room_dir(room_id: int, channel_name: str) -> Path:
    return meeting_data_dir() / f"room-{int(room_id)}__{_safe_segment(channel_name, '채널')}"


def _timestamp_text(raw_value: Any = None) -> str:
    ts = 0.0
    try:
        ts = float(raw_value or 0)
    except Exception:
        ts = 0.0
    if ts <= 0:
        ts = time.time()
    return datetime.fromtimestamp(ts).astimezone().strftime("%Y-%m-%d-%H-%M-%S")


def _display_timestamp(timestamp_text: str) -> str:
    match = _FILENAME_TS_RE.match(_norm_text(timestamp_text))
    if not match:
        return _norm_text(timestamp_text)
    value = match.group(1)
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d-%H-%M-%S")
    except Exception:
        return value
    return parsed.strftime("%Y-%m-%d %H:%M:%S")


def _note_file_path(room_id: int, call_id: str, channel_name: str, started_at: Any = None) -> Path:
    normalized_call_id = _norm_text(call_id)
    cache_key = (int(room_id), normalized_call_id)
    cached_path = _ACTIVE_NOTE_PATHS.get(cache_key)
    if cached_path:
        return cached_path
    timestamp_text = _timestamp_text(started_at)
    directory = _room_dir(room_id, channel_name)
    directory.mkdir(parents=True, exist_ok=True)
    file_path = directory / f"{timestamp_text} {_safe_segment(channel_name, '채널')} 회의록.txt"
    _ACTIVE_NOTE_PATHS[cache_key] = file_path
    return file_path


def append_transcript_entry(
    room_id: int,
    call_id: str,
    channel_name: str,
    display_name: str,
    text: str,
    *,
    started_at: Any = None,
    spoken_at: Any = None,
) -> dict[str, Any] | None:
    target_room_id = int(room_id or 0)
    normalized_call_id = _norm_text(call_id)
    normalized_channel_name = _norm_text(channel_name) or "채널"
    normalized_display_name = _norm_text(display_name) or "사용자"
    normalized_text = _norm_text(text)
    if target_room_id <= 0 or not normalized_call_id or not normalized_text:
        return None

    note_path = _note_file_path(target_room_id, normalized_call_id, normalized_channel_name, started_at)
    header_timestamp = _timestamp_text(started_at or spoken_at)
    note_line = f"{normalized_display_name} : {normalized_text}\n"
    with _LOCK:
        if not note_path.exists():
            note_path.parent.mkdir(parents=True, exist_ok=True)
            note_path.write_text(
                "\n".join([header_timestamp, normalized_channel_name, note_line.rstrip("\n")]) + "\n",
                encoding="utf-8",
            )
        else:
            with note_path.open("a", encoding="utf-8") as handle:
                handle.write(note_line)
    relative_path = note_path.relative_to(meeting_data_dir()).as_posix()
    return {
        "note_id": relative_path,
        "room_id": target_room_id,
        "channel_name": normalized_channel_name,
        "file_name": note_path.name,
    }


def _parse_room_id_from_relative(relative_path: str) -> int:
    parts = Path(relative_path).parts
    if not parts:
        return 0
    match = _ROOM_DIR_RE.match(parts[0])
    if not match:
        return 0
    try:
        return int(match.group(1) or 0)
    except Exception:
        return 0


def _safe_note_path(note_id: str) -> Path:
    relative_text = _norm_text(note_id).replace("\\", "/").lstrip("/")
    if not relative_text:
        raise ValueError("회의록 식별자가 비어 있습니다.")
    root = meeting_data_dir().resolve()
    target_path = (root / relative_text).resolve()
    try:
        target_path.relative_to(root)
    except Exception as exc:
        raise ValueError("회의록 경로가 올바르지 않습니다.") from exc
    if target_path.suffix.lower() != ".txt":
        raise ValueError("지원하지 않는 회의록 형식입니다.")
    return target_path


def list_notes_for_rooms(rooms: list[dict[str, Any]]) -> list[dict[str, Any]]:
    meeting_data_dir()
    room_map = {
        int(room.get("id") or 0): dict(room or {})
        for room in (rooms or [])
        if int((room or {}).get("id") or 0) > 0
    }
    notes_by_room: dict[int, list[dict[str, Any]]] = {room_id: [] for room_id in room_map}
    for note_path in sorted(_MEETING_DATA_DIR.rglob("*.txt"), key=lambda item: item.stat().st_mtime, reverse=True):
        relative_path = note_path.relative_to(_MEETING_DATA_DIR).as_posix()
        room_id = _parse_room_id_from_relative(relative_path)
        if room_id <= 0 or room_id not in room_map:
            continue
        match = _FILENAME_TS_RE.match(note_path.name)
        timestamp_text = match.group(1) if match else ""
        notes_by_room.setdefault(room_id, []).append(
            {
                "note_id": relative_path,
                "file_name": note_path.name,
                "timestamp": timestamp_text,
                "display_timestamp": _display_timestamp(timestamp_text) if timestamp_text else note_path.name,
                "size": int(note_path.stat().st_size or 0),
                "updated_at": float(note_path.stat().st_mtime or 0),
            }
        )

    channels: list[dict[str, Any]] = []
    for room_id, room in room_map.items():
        room_notes = list(notes_by_room.get(room_id) or [])
        latest_updated_at = room_notes[0]["updated_at"] if room_notes else 0.0
        room_title = _norm_text(room.get("name") or room.get("title")) or "채널"
        channels.append(
            {
                "room_id": room_id,
                "room_title": room_title,
                "note_count": len(room_notes),
                "latest_updated_at": latest_updated_at,
                "notes": room_notes,
            }
        )
    channels.sort(key=lambda item: (-float(item.get("latest_updated_at") or 0), _norm_text(item.get("room_title"))))
    return channels


def read_note(note_id: str, allowed_room_ids: set[int] | list[int]) -> dict[str, Any]:
    allowed_ids = {int(room_id or 0) for room_id in (allowed_room_ids or []) if int(room_id or 0) > 0}
    note_path = _safe_note_path(note_id)
    relative_path = note_path.relative_to(meeting_data_dir()).as_posix()
    room_id = _parse_room_id_from_relative(relative_path)
    if room_id <= 0 or room_id not in allowed_ids:
        raise PermissionError("이 회의록을 볼 권한이 없습니다.")
    content = note_path.read_text(encoding="utf-8")
    lines = content.splitlines()
    return {
        "note_id": relative_path,
        "room_id": room_id,
        "file_name": note_path.name,
        "timestamp": lines[0] if lines else "",
        "channel_name": lines[1] if len(lines) > 1 else "",
        "content": content,
    }


__all__ = [
    "append_transcript_entry",
    "list_notes_for_rooms",
    "meeting_data_dir",
    "read_note",
]
