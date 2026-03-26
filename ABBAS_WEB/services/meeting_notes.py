from __future__ import annotations

from datetime import datetime
from pathlib import Path
import json
import re
import threading
import time
from typing import Any


_ROOT_DIR = Path(__file__).resolve().parents[1]
_MEETING_DATA_DIR = _ROOT_DIR / "meeting_data"
_FILENAME_TS_RE = re.compile(r"^(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})")
_ROOM_DIR_RE = re.compile(r"^room-(\d+)__")
_ROOM_META_FILENAME = "__room_meta__.json"
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


def _room_dirs(room_id: int) -> list[Path]:
    target_room_id = int(room_id or 0)
    if target_room_id <= 0:
        return []
    return sorted(
        [
            item
            for item in meeting_data_dir().glob(f"room-{target_room_id}__*")
            if item.is_dir()
        ],
        key=lambda item: item.name.lower(),
    )


def _room_meta_path(directory: Path) -> Path:
    return directory / _ROOM_META_FILENAME


def _channel_name_from_dir(directory: Path) -> str:
    name = directory.name
    match = _ROOM_DIR_RE.match(name)
    if not match:
        return "채널"
    prefix = f"room-{match.group(1)}__"
    return _safe_segment(name[len(prefix):], "채널")


def _load_room_meta(directory: Path) -> dict[str, Any]:
    meta_path = _room_meta_path(directory)
    if not meta_path.exists():
        return {}
    try:
        payload = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        payload = {}
    return payload if isinstance(payload, dict) else {}


def _can_read_deleted_room(directory: Path, current_user_id: str) -> bool:
    meta = _load_room_meta(directory)
    if str(meta.get("deleted") or "").lower() not in {"1", "true", "yes"} and meta.get("deleted") is not True:
        return False
    normalized_user_id = _norm_text(current_user_id)
    if not normalized_user_id:
        return False
    allowed_ids = {
        _norm_text(item)
        for item in (meta.get("allowed_user_ids") or [])
        if _norm_text(item)
    }
    return normalized_user_id in allowed_ids


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


def mark_room_deleted(
    room_id: int,
    channel_name: str,
    allowed_user_ids: list[str] | set[str] | tuple[str, ...],
    *,
    deleted_at: Any = None,
) -> bool:
    target_room_id = int(room_id or 0)
    if target_room_id <= 0:
        return False
    directories = _room_dirs(target_room_id)
    if not directories:
        return False
    normalized_ids = sorted({
        _norm_text(user_id)
        for user_id in (allowed_user_ids or [])
        if _norm_text(user_id)
    })
    payload = {
        "room_id": target_room_id,
        "channel_name": _norm_text(channel_name) or "채널",
        "deleted": True,
        "deleted_at": _timestamp_text(deleted_at),
        "allowed_user_ids": normalized_ids,
    }
    with _LOCK:
        for directory in directories:
            _room_meta_path(directory).write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
    return True


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


def list_notes_for_rooms(rooms: list[dict[str, Any]], current_user_id: str = "") -> list[dict[str, Any]]:
    meeting_data_dir()
    normalized_current_user_id = _norm_text(current_user_id)
    room_map = {
        int(room.get("id") or 0): dict(room or {})
        for room in (rooms or [])
        if int((room or {}).get("id") or 0) > 0
    }
    notes_by_room: dict[int, list[dict[str, Any]]] = {room_id: [] for room_id in room_map}
    deleted_notes: list[dict[str, Any]] = []
    for note_path in sorted(_MEETING_DATA_DIR.rglob("*.txt"), key=lambda item: item.stat().st_mtime, reverse=True):
        relative_path = note_path.relative_to(_MEETING_DATA_DIR).as_posix()
        room_id = _parse_room_id_from_relative(relative_path)
        if room_id <= 0:
            continue
        match = _FILENAME_TS_RE.match(note_path.name)
        timestamp_text = match.group(1) if match else ""
        room_meta = _load_room_meta(note_path.parent)
        note_payload = {
            "note_id": relative_path,
            "file_name": note_path.name,
            "timestamp": timestamp_text,
            "display_timestamp": _display_timestamp(timestamp_text) if timestamp_text else note_path.name,
            "size": int(note_path.stat().st_size or 0),
            "updated_at": float(note_path.stat().st_mtime or 0),
            "channel_name": _norm_text(room_meta.get("channel_name")) or _channel_name_from_dir(note_path.parent),
        }
        if room_id in room_map:
            notes_by_room.setdefault(room_id, []).append(note_payload)
            continue
        if normalized_current_user_id and _can_read_deleted_room(note_path.parent, normalized_current_user_id):
            deleted_notes.append(note_payload)

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
    if deleted_notes:
        deleted_notes.sort(key=lambda item: (-float(item.get("updated_at") or 0), _norm_text(item.get("channel_name"))))
        channels.append(
            {
                "room_id": -1,
                "room_title": "삭제된 채널",
                "note_count": len(deleted_notes),
                "latest_updated_at": float(deleted_notes[0].get("updated_at") or 0),
                "notes": deleted_notes,
                "deleted_bucket": True,
            }
        )
    channels.sort(key=lambda item: (-float(item.get("latest_updated_at") or 0), _norm_text(item.get("room_title"))))
    deleted_bucket = [item for item in channels if item.get("deleted_bucket")]
    live_channels = [item for item in channels if not item.get("deleted_bucket")]
    channels = live_channels + deleted_bucket
    return channels


def read_note(note_id: str, allowed_room_ids: set[int] | list[int], current_user_id: str = "") -> dict[str, Any]:
    allowed_ids = {int(room_id or 0) for room_id in (allowed_room_ids or []) if int(room_id or 0) > 0}
    note_path = _safe_note_path(note_id)
    relative_path = note_path.relative_to(meeting_data_dir()).as_posix()
    room_id = _parse_room_id_from_relative(relative_path)
    if room_id <= 0:
        raise PermissionError("이 회의록을 볼 권한이 없습니다.")
    if room_id not in allowed_ids and not _can_read_deleted_room(note_path.parent, current_user_id):
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
    "mark_room_deleted",
    "meeting_data_dir",
    "read_note",
]
