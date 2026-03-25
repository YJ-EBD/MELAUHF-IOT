from __future__ import annotations

from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse


def _pages():
    from router import pages as pages_module

    return pages_module


def _messenger_room_avatar_url_from_value(value: Any) -> str:
    pages_module = _pages()
    path = str(value or "").strip()
    if path.startswith(f"{pages_module.MESSENGER_ROOM_AVATAR_PUBLIC_PREFIX}/"):
        return path
    if path in pages_module.MESSENGER_ROOM_AVATAR_PRESETS:
        return path
    return ""


def _messenger_json_error(detail: str, status_code: int) -> JSONResponse:
    return JSONResponse({"ok": False, "detail": detail}, status_code=status_code)


def _messenger_request_user_id(request: Request) -> str:
    return str(getattr(request.state, "user_id", "") or "").strip()


def _messenger_require_user_id(request: Request) -> tuple[str, JSONResponse | None]:
    current_user_id = _messenger_request_user_id(request)
    if not current_user_id:
        return "", _messenger_json_error("로그인이 필요합니다.", 401)
    return current_user_id, None


async def _messenger_require_room_for_user(
    request: Request,
    room_id: int,
    *,
    not_found_detail: str = "대화방을 찾을 수 없습니다.",
) -> tuple[str, dict[str, Any] | None, JSONResponse | None]:
    pages_module = _pages()
    current_user_id, error_response = _messenger_require_user_id(request)
    if error_response is not None:
        return "", None, error_response
    room = await pages_module.asyncio.to_thread(pages_module.chat_repo.get_room_for_user, room_id, current_user_id)
    if not room:
        return current_user_id, None, _messenger_json_error(not_found_detail, 404)
    return current_user_id, room, None


__all__ = [
    "_messenger_json_error",
    "_messenger_request_user_id",
    "_messenger_require_room_for_user",
    "_messenger_require_user_id",
    "_messenger_room_avatar_url_from_value",
]
