from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from typing import Optional

from services.data_store import normalize_device_id, read_rows_paginated
from services.device_csv import load_saved_devices

router = APIRouter()


@router.get("/api/data/devices")
def api_data_devices():
    return {"ok": True, "devices": load_saved_devices()}


@router.get("/api/data/procedure")
def api_data_procedure(
    device_id: str = "",
    offset: int = 0,
    limit: int = 200,
    q: str = "",
    cursor: Optional[int] = None,
):
    did = normalize_device_id(device_id)
    if not did:
        return JSONResponse({"ok": False, "detail": "device_id required"}, status_code=400)
    rows, page = read_rows_paginated(did, "procedure", offset=offset, limit=limit, query=q, cursor=cursor)
    return {
        "ok": True,
        "device_id": did,
        "rows": rows,
        # legacy(offset) + new(cursor) both returned for compatibility
        "next_offset": page.get("next_offset", 0),
        "next_cursor": page.get("next_cursor"),
        "has_more": bool(page.get("has_more")),
    }


@router.get("/api/data/survey")
def api_data_survey(
    device_id: str = "",
    offset: int = 0,
    limit: int = 200,
    q: str = "",
    cursor: Optional[int] = None,
):
    did = normalize_device_id(device_id)
    if not did:
        return JSONResponse({"ok": False, "detail": "device_id required"}, status_code=400)
    rows, page = read_rows_paginated(did, "survey", offset=offset, limit=limit, query=q, cursor=cursor)
    return {
        "ok": True,
        "device_id": did,
        "rows": rows,
        "next_offset": page.get("next_offset", 0),
        "next_cursor": page.get("next_cursor"),
        "has_more": bool(page.get("has_more")),
    }
