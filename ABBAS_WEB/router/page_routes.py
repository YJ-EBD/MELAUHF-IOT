from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse


def register_page_routes(router: APIRouter) -> None:
    from router import pages as pages_module

    FIRMWARE_FAMILY_DEFAULT = pages_module.FIRMWARE_FAMILY_DEFAULT
    FIRMWARE_MAX_UPLOAD_BYTES = pages_module.FIRMWARE_MAX_UPLOAD_BYTES
    _base_context = pages_module._base_context
    _build_device_status_payload = pages_module._build_device_status_payload
    _build_firmware_payload = pages_module._build_firmware_payload
    _customers_from_saved = pages_module._customers_from_saved
    _load_saved_devices = pages_module._load_saved_devices
    _payload_int = pages_module._payload_int
    data_repo = pages_module.data_repo
    db_read_logs = pages_module.db_read_logs
    templates = pages_module.templates

    @router.get("/", name="dashboard")
    def dashboard(request: Request):
        payload = _build_device_status_payload("")
        devices = payload.get("devices") or []
        counts = payload.get("counts") or {}

        today_rows = data_repo.count_today_rows() or {}
        today_total_rows = int((today_rows.get("total") if isinstance(today_rows, dict) else today_rows) or 0)
        today_max = max(today_total_rows, 1)

        usage_overview = [
            {
                "id": "donut_total_devices",
                "title": "전체 기기 개수",
                "value": counts["total"],
                "unit": "대",
                "max": counts["total"] if counts["total"] > 0 else 1,
                "color": "primary",
            },
            {
                "id": "donut_expired_devices",
                "title": "구독 만료 기기 수",
                "value": counts["expired"],
                "unit": "대",
                "max": max(counts["total"], 1),
                "color": "danger",
            },
            {
                "id": "donut_today_usage",
                "title": "오늘 적재된 데이터",
                "value": today_total_rows,
                "unit": "행",
                "max": today_max,
                "color": "success",
            },
        ]

        recent_logs = (db_read_logs(limit=20) or [])[:4]

        return templates.TemplateResponse(
            "index.html",
            _base_context(
                request,
                "dashboard",
                page_title="대시보드",
                devices=devices,
                counts=counts,
                usage_overview=usage_overview,
                recent_logs=recent_logs,
            ),
        )

    @router.get("/device-status", name="device_status")
    def device_status(request: Request):
        selected_customer = (request.query_params.get("customer") or "").strip()
        payload = _build_device_status_payload(selected_customer)
        customers = payload.get("customers") or []
        devices = payload.get("devices") or []
        counts = payload.get("counts") or {}

        return templates.TemplateResponse(
            "device_status.html",
            _base_context(
                request,
                "device_status",
                page_title="디바이스 목록",
                devices=devices,
                counts=counts,
                customers=customers,
                selected_customer=selected_customer,
            ),
        )

    @router.get("/control-panel", name="control_panel")
    def control_panel(request: Request):
        saved = _load_saved_devices()
        customers = _customers_from_saved(saved)
        selected_customer = (request.query_params.get("customer") or "").strip()

        selected = ""
        if saved:
            selected = saved[0].get("name") or ""
        return templates.TemplateResponse(
            "control_panel.html",
            _base_context(
                request,
                "control_panel",
                page_title="제어 패널",
                devices=saved,
                selected_device=selected,
                customers=customers,
                selected_customer=selected_customer,
            ),
        )

    @router.get("/logs", name="logs")
    def logs(request: Request):
        payload = _build_device_status_payload("")
        devices = payload.get("devices") or []

        return templates.TemplateResponse(
            "logs.html",
            _base_context(request, "logs", page_title="로그", devices=devices),
        )

    @router.get("/settings", name="settings")
    def settings(request: Request):
        return templates.TemplateResponse("settings.html", _base_context(request, "settings", page_title="설정"))

    @router.get("/firmware-manage", name="firmware_manage")
    def firmware_manage_page(request: Request):
        payload = _build_firmware_payload()
        return templates.TemplateResponse(
            "firmware_manage.html",
            _base_context(
                request,
                "firmware_manage",
                page_title="Firmware Manage",
                summary=payload.get("summary") or {},
                releases=payload.get("releases") or [],
                devices=payload.get("devices") or [],
                families=payload.get("families") or [],
                max_upload_bytes=int(payload.get("max_upload_bytes") or FIRMWARE_MAX_UPLOAD_BYTES),
                default_family=str(payload.get("default_family") or FIRMWARE_FAMILY_DEFAULT),
            ),
        )

    @router.get("/data", name="data")
    def data_page(request: Request):
        saved = _load_saved_devices()
        return templates.TemplateResponse(
            "data.html",
            _base_context(
                request,
                "data",
                page_title="데이터",
                devices=saved,
            ),
        )

    @router.get("/messenger", name="messenger")
    def messenger_page(request: Request):
        requested_room_id = _payload_int(request.query_params.get("room_id"), 0)
        redirect_url = "/?open_messenger=1"
        if requested_room_id > 0:
            redirect_url += f"&messenger_room_id={requested_room_id}"
        return RedirectResponse(url=redirect_url, status_code=302)

    @router.get("/message", name="message")
    def message_page(request: Request):
        return messenger_page(request)
