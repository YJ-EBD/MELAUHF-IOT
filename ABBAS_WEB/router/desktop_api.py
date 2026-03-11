from __future__ import annotations

import time

from typing import List

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import JSONResponse

from services.data_store import normalize_device_id, ingest_csv_bytes_to_db
from services.device_csv import load_saved_devices
from services.log_store import append_log

router = APIRouter()

_PENDING_LOG_THROTTLE = {}  # device_id -> last_log_epoch
_PENDING_LOG_THROTTLE_SEC = 120


def _find_saved(device_id: str):
    did = normalize_device_id(device_id)
    for d in load_saved_devices():
        if normalize_device_id(d.get("device_id") or "") == did and did:
            return d
    return None


@router.get("/api/desktop/device_registered")
def device_registered(device_id: str = ""):
    did = normalize_device_id(device_id)
    if not did:
        return JSONResponse({"ok": False, "detail": "device_id required"}, status_code=400)

    d = _find_saved(did)
    if not d:
        # 요구사항: 미등록 상태에서 업로드/시도 로그
        now = time.time()
        last = _PENDING_LOG_THROTTLE.get(did, 0)
        if now - last > _PENDING_LOG_THROTTLE_SEC:
            append_log(f"알수없음 + {did}", "경고", "시술/설문 업로드 대기: 미등록 디바이스")
            _PENDING_LOG_THROTTLE[did] = now
        return {"ok": True, "registered": False, "device_id": did}

    return {"ok": True, "registered": True, "device": d, "device_id": did}


@router.post("/api/desktop/upload")
async def desktop_upload(
    device_id: str = Form(...),
    kind: str = Form(...),
    files: List[UploadFile] = File(...),
):
    did = normalize_device_id(device_id)
    if not did:
        return JSONResponse({"ok": False, "detail": "device_id required"}, status_code=400)

    d = _find_saved(did)
    if not d:
        now = time.time()
        last = _PENDING_LOG_THROTTLE.get(did, 0)
        if now - last > _PENDING_LOG_THROTTLE_SEC:
            append_log(f"알수없음 + {did}", "경고", f"업로드 실패(미등록): kind={kind}")
            _PENDING_LOG_THROTTLE[did] = now
        return JSONResponse({"ok": False, "detail": "device_not_registered", "registered": False}, status_code=409)

    kind_l = (kind or "").strip().lower()
    if kind_l not in ("procedure", "survey"):
        return JSONResponse({"ok": False, "detail": "kind must be procedure|survey"}, status_code=400)

    if not files:
        return JSONResponse({"ok": False, "detail": "files required"}, status_code=400)

    processed_files = 0
    inserted_rows_total = 0
    for f in files:
        try:
            content = await f.read()
            inserted = ingest_csv_bytes_to_db(did, kind_l, f.filename or "data.csv", content)
            inserted_rows_total += int(inserted or 0)
            processed_files += 1
        except Exception as e:
            append_log(d.get("name") or did, "오류", f"업로드 실패: {e}")
            return JSONResponse({"ok": False, "detail": f"save failed: {e}"}, status_code=500)

    append_log(
        d.get("name") or did,
        "정보",
        f"업로드 성공(DB): kind={kind_l}, files={processed_files}, inserted_rows={inserted_rows_total}",
    )

    return {"ok": True, "saved": processed_files, "inserted_rows": inserted_rows_total}
