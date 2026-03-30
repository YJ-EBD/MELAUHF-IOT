from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Body, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from DB.runtime import get_mysql


def register_platform_routes(router: APIRouter) -> None:
    from router import pages as pages_module

    ATMEGA_FIRMWARE_FAMILY_DEFAULT = pages_module.ATMEGA_FIRMWARE_FAMILY_DEFAULT
    ATMEGA_FIRMWARE_MAX_UPLOAD_BYTES = pages_module.ATMEGA_FIRMWARE_MAX_UPLOAD_BYTES
    templates = pages_module.templates
    _base_context = pages_module._base_context
    _build_plan_payload = pages_module._build_plan_payload
    _build_firmware_payload = pages_module._build_firmware_payload
    _sanitize_firmware_token = pages_module._sanitize_firmware_token
    FIRMWARE_FAMILY_DEFAULT = pages_module.FIRMWARE_FAMILY_DEFAULT
    FIRMWARE_MAX_UPLOAD_BYTES = pages_module.FIRMWARE_MAX_UPLOAD_BYTES
    FIRMWARE_STORAGE_DIR = pages_module.FIRMWARE_STORAGE_DIR
    REMOTE_SUBSCRIPTION_RESET_COMMAND = pages_module.REMOTE_SUBSCRIPTION_RESET_COMMAND
    SUB_PLAN_FIXED_ENERGY_J = pages_module.SUB_PLAN_FIXED_ENERGY_J
    _apply_runtime_subscription_reset_cache = pages_module._apply_runtime_subscription_reset_cache
    _device_api_meta = pages_module._device_api_meta
    _device_record_or_403 = pages_module._device_record_or_403
    _extract_auth_token = pages_module._extract_auth_token
    _norm_device_id = pages_module._norm_device_id
    _payload_bool = pages_module._payload_bool
    _queue_remote_reset = pages_module._queue_remote_reset
    _release_download_path = pages_module._release_download_path
    _request_client_ip = pages_module._request_client_ip
    _request_user_id = pages_module._request_user_id
    _resolve_runtime_key = pages_module._resolve_runtime_key
    _subscription_response_or_default = pages_module._subscription_response_or_default
    device_repo = pages_module.device_repo
    firmware_repo = pages_module.firmware_repo
    os = pages_module.os

    @router.get("/plan", name="plan")
    def plan_page(request: Request):
        payload = _build_plan_payload()
        devices = payload.get("devices") or []
        counts = payload.get("counts") or {"active": 0, "expired": 0, "restricted": 0}
        return templates.TemplateResponse(
            "plan.html",
            _base_context(
                request,
                "plan",
                page_title="플랜",
                devices=devices,
                counts=counts,
            ),
        )

    @router.get("/api/plan/payload")
    def api_plan_payload():
        payload = _build_plan_payload()
        return {"ok": True, **payload}

    @router.get("/api/firmware/payload")
    def api_firmware_payload():
        return {"ok": True, **_build_firmware_payload()}

    @router.get("/api/firmware/atmega/payload")
    def api_firmware_atmega_payload():
        return {
            "ok": True,
            **_build_firmware_payload(
                family_filter=ATMEGA_FIRMWARE_FAMILY_DEFAULT,
                default_family=ATMEGA_FIRMWARE_FAMILY_DEFAULT,
                max_upload_bytes=ATMEGA_FIRMWARE_MAX_UPLOAD_BYTES,
            ),
        }

    async def _api_firmware_create_release_impl(
        request: Request,
        *,
        family: str,
        version: str,
        build_id: str,
        notes: str,
        force_update: str,
        firmware_file: UploadFile,
        default_family: str,
        allowed_extensions: tuple[str, ...],
        max_upload_bytes: int,
    ):
        family_value = _sanitize_firmware_token(family, default_family)
        version_value = _sanitize_firmware_token(version)
        build_value = _sanitize_firmware_token(build_id, "build")
        if not version_value:
            raise HTTPException(status_code=400, detail="version required")

        filename = str(firmware_file.filename or "firmware.bin").strip() or "firmware.bin"
        ext = filename.lower()
        if not any(ext.endswith(suffix) for suffix in allowed_extensions):
            suffix_text = ", ".join(allowed_extensions)
            raise HTTPException(status_code=400, detail=f"firmware file must be {suffix_text}")

        raw = await firmware_file.read()
        if not raw:
            raise HTTPException(status_code=400, detail="firmware file required")
        if len(raw) > max_upload_bytes:
            raise HTTPException(
                status_code=400,
                detail=f"firmware exceeds upload limit ({len(raw)} > {max_upload_bytes} bytes)",
            )

        sha256 = hashlib.sha256(raw).hexdigest()
        release_ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        target_dir = os.path.join(FIRMWARE_STORAGE_DIR, family_value)
        os.makedirs(target_dir, exist_ok=True)
        stored_ext = os.path.splitext(filename)[1] or allowed_extensions[0]
        stored_name = f"{family_value}__{version_value}__{build_value}__{release_ts}{stored_ext}"
        file_path = os.path.join(target_dir, stored_name)

        with open(file_path, "wb") as fh:
            fh.write(raw)

        try:
            release = firmware_repo.create_release(
                family=family_value,
                version=version_value,
                build_id=build_value,
                filename=filename,
                stored_name=stored_name,
                file_path=file_path,
                sha256=sha256,
                size_bytes=len(raw),
                notes=notes,
                uploaded_by=_request_user_id(request) or "admin",
                force_update=_payload_bool(force_update, False),
            )
        except ValueError as exc:
            try:
                if os.path.exists(file_path):
                    os.remove(file_path)
            except Exception:
                pass
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception:
            try:
                if os.path.exists(file_path):
                    os.remove(file_path)
            except Exception:
                pass
            raise

        return {
            "ok": True,
            "release": {
                **release,
                "download_path": _release_download_path(int(release.get("id") or 0)),
            },
        }

    @router.post("/api/firmware/releases")
    async def api_firmware_create_release(
        request: Request,
        family: str = Form(...),
        version: str = Form(...),
        build_id: str = Form(""),
        notes: str = Form(""),
        force_update: str = Form("0"),
        firmware_file: UploadFile = File(...),
    ):
        return await _api_firmware_create_release_impl(
            request,
            family=family,
            version=version,
            build_id=build_id,
            notes=notes,
            force_update=force_update,
            firmware_file=firmware_file,
            default_family=FIRMWARE_FAMILY_DEFAULT,
            allowed_extensions=(".bin",),
            max_upload_bytes=FIRMWARE_MAX_UPLOAD_BYTES,
        )

    @router.post("/api/firmware/atmega/releases")
    async def api_firmware_create_atmega_release(
        request: Request,
        family: str = Form(ATMEGA_FIRMWARE_FAMILY_DEFAULT),
        version: str = Form(...),
        build_id: str = Form(""),
        notes: str = Form(""),
        force_update: str = Form("0"),
        firmware_file: UploadFile = File(...),
    ):
        return await _api_firmware_create_release_impl(
            request,
            family=family or ATMEGA_FIRMWARE_FAMILY_DEFAULT,
            version=version,
            build_id=build_id,
            notes=notes,
            force_update=force_update,
            firmware_file=firmware_file,
            default_family=ATMEGA_FIRMWARE_FAMILY_DEFAULT,
            allowed_extensions=(".hex",),
            max_upload_bytes=ATMEGA_FIRMWARE_MAX_UPLOAD_BYTES,
        )

    @router.post("/api/firmware/releases/delete")
    def api_firmware_delete_releases(payload: dict[str, Any] = Body(...)):
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="invalid payload")
        release_ids_raw = payload.get("release_ids")
        if not isinstance(release_ids_raw, list):
            raise HTTPException(status_code=400, detail="release_ids must be a list")
        try:
            result = firmware_repo.delete_releases(release_ids=release_ids_raw)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"ok": True, **result}

    @router.post("/api/firmware/releases/{release_id}/assign")
    def api_firmware_assign_release(request: Request, release_id: int, payload: dict[str, Any] = Body(...)):
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="invalid payload")
        device_ids_raw = payload.get("device_ids")
        if not isinstance(device_ids_raw, list):
            raise HTTPException(status_code=400, detail="device_ids must be a list")
        try:
            assigned = firmware_repo.assign_release_to_devices(
                release_id=int(release_id),
                device_ids=[str(v or "").strip() for v in device_ids_raw],
                assigned_by=_request_user_id(request) or "admin",
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"ok": True, "assigned": int(assigned)}

    @router.post("/api/firmware/devices/clear-target")
    def api_firmware_clear_targets(payload: dict[str, Any] = Body(...)):
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="invalid payload")
        device_ids_raw = payload.get("device_ids")
        if not isinstance(device_ids_raw, list):
            raise HTTPException(status_code=400, detail="device_ids must be a list")
        try:
            cleared = firmware_repo.clear_targets(device_ids=[str(v or "").strip() for v in device_ids_raw])
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"ok": True, "cleared": int(cleared)}

    @router.get("/api/health/live")
    def api_health_live():
        return {"ok": True, "status": "live"}

    @router.get("/api/health/ready")
    def api_health_ready(request: Request):
        redis_ok = False
        mysql_ok = False

        try:
            get_mysql().ping()
            mysql_ok = True
        except Exception:
            mysql_ok = False

        try:
            redis_obj = getattr(request.app.state, "redis", None)
            redis_ok = bool(redis_obj is not None and redis_obj.ping())
        except Exception:
            redis_ok = False

        ready = mysql_ok and redis_ok
        body = {"ok": ready, "status": "ready" if ready else "degraded", "mysql": mysql_ok, "redis": redis_ok}
        if ready:
            return body
        return JSONResponse(body, status_code=503)

    @router.get("/api/subscriptions/summary")
    def api_subscriptions_summary():
        counts = device_repo.get_subscription_counts()
        return {"ok": True, "counts": counts}

    @router.get("/api/devices/{device_id}/subscription")
    def api_device_subscription_get(request: Request, device_id: str):
        did = _norm_device_id(device_id)
        if not did:
            raise HTTPException(status_code=400, detail="device_id required")

        token = _extract_auth_token(request, {})
        user_id = _request_user_id(request)
        rec = None
        if user_id:
            rec = device_repo.get_device_by_device_id(did)
        else:
            if not token:
                raise HTTPException(status_code=401, detail="device token required")
            rec = _device_record_or_403(did, token)

        if rec and token:
            try:
                device_repo.mark_subscription_sync(
                    name=str(rec.get("name") or did),
                    ip=str(rec.get("ip") or _request_client_ip(request)),
                    customer=str(rec.get("customer") or "-"),
                    token=token,
                    device_id=did,
                    public_ip=_request_client_ip(request),
                    fw=str(rec.get("last_fw") or ""),
                )
            except ValueError:
                pass

        payload = _subscription_response_or_default(did)
        payload.update(_device_api_meta(did, str(payload.get("ip") or ""), str(payload.get("customer") or "-")))
        return payload

    @router.post("/api/devices/{device_id}/subscription/grant")
    def api_device_subscription_grant(device_id: str, payload: dict[str, Any] = Body(...)):
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="invalid payload")

        plan = str(payload.get("plan") or "").strip()
        custom_duration = payload.get("custom_duration_minutes")
        energy_j_payload = payload.get("energyJ")
        if plan != "Test Plan":
            custom_duration = None
        if plan == "Test Plan":
            try:
                assigned_energy_j = int(energy_j_payload)
            except Exception as exc:
                raise HTTPException(status_code=400, detail="energyJ required for Test Plan") from exc
        else:
            assigned_energy_j = int(SUB_PLAN_FIXED_ENERGY_J.get(plan, 0))

        try:
            rec = device_repo.grant_subscription(device_id, plan, custom_duration, assigned_energy_j)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        if not rec:
            raise HTTPException(status_code=404, detail="device not found")

        return {"ok": True, **_subscription_response_or_default(device_id)}

    @router.post("/api/devices/{device_id}/subscription/revoke")
    def api_device_subscription_revoke(device_id: str):
        did = _norm_device_id(device_id)
        try:
            rec = device_repo.revoke_subscription(did)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        if not rec:
            raise HTTPException(status_code=404, detail="device not found")

        target_ip = str(rec.get("ip") or "").strip()
        target_customer = str(rec.get("customer") or "-").strip() or "-"
        _queue_remote_reset(
            device_id=did,
            ip=target_ip,
            customer=target_customer,
            command=REMOTE_SUBSCRIPTION_RESET_COMMAND,
        )

        runtime_key = _resolve_runtime_key(target_customer, target_ip, did)
        _apply_runtime_subscription_reset_cache(runtime_key or "")

        return {"ok": True, "command_queued": REMOTE_SUBSCRIPTION_RESET_COMMAND, **_subscription_response_or_default(did)}
