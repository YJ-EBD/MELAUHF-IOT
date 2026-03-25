from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse


def register_integrated_admin_routes(router: APIRouter) -> None:
    from router import pages as pages_module

    SESSION_COOKIE_NAME = pages_module.SESSION_COOKIE_NAME
    _base_context = pages_module._base_context
    _build_integrated_admin_payload = pages_module._build_integrated_admin_payload
    _build_integrated_admin_realtime_payload = pages_module._build_integrated_admin_realtime_payload
    _demoted_role = pages_module._demoted_role
    _normalize_approval_status = pages_module._normalize_approval_status
    _normalize_role = pages_module._normalize_role
    _promoted_role = pages_module._promoted_role
    _reject_websocket_with_code = pages_module._reject_websocket_with_code
    _request_user_role = pages_module._request_user_role
    _require_superuser = pages_module._require_superuser
    _role_label = pages_module._role_label
    _superuser_forbidden_page = pages_module._superuser_forbidden_page
    asyncio = pages_module.asyncio
    clear_live_presence = pages_module.clear_live_presence
    json = pages_module.json
    read_session_user = pages_module.read_session_user
    read_user = pages_module.read_user
    re = pages_module.re
    templates = pages_module.templates
    touch_live_presence = pages_module.touch_live_presence
    user_repo = pages_module.user_repo

    def _integrated_admin_target_user(target_user_id: str) -> dict[str, Any]:
        row = read_user(target_user_id) or {}
        if not row:
            raise HTTPException(status_code=404, detail="대상 계정을 찾을 수 없습니다.")
        return row

    @router.get("/integrated-admin", name="integrated_admin")
    def integrated_admin_page(request: Request):
        if _request_user_role(request) != "superuser":
            return _superuser_forbidden_page(request, message="role 값이 superuser인 계정만 통합관리 페이지에 접근할 수 있습니다.")
        return templates.TemplateResponse(
            "integrated_admin.html",
            _base_context(
                request,
                "settings",
                page_title="통합관리",
            ),
        )

    @router.get("/api/integrated-admin/overview")
    def api_integrated_admin_overview(request: Request):
        _require_superuser(request)
        return JSONResponse({"ok": True, "payload": _build_integrated_admin_payload(request)})

    @router.post("/api/live-presence/disconnect")
    def api_live_presence_disconnect(request: Request, client_id: str = ""):
        sid = request.cookies.get(SESSION_COOKIE_NAME, "") or ""
        user_id = read_session_user(sid)
        if user_id and client_id:
            clear_live_presence(user_id=user_id, client_id=client_id)
        return Response(status_code=204)

    @router.websocket("/ws/live-presence")
    async def ws_live_presence(websocket: WebSocket):
        client_id = str(websocket.query_params.get("client_id") or "").strip()
        if not re.match(r"^[A-Za-z0-9._:-]{8,128}$", client_id):
            await _reject_websocket_with_code(websocket, 4400)
            return

        sid = ""
        try:
            sid = (websocket.cookies.get(SESSION_COOKIE_NAME, "") or "").strip()
        except Exception:
            sid = ""

        user_id = read_session_user(sid)
        if not user_id:
            await _reject_websocket_with_code(websocket, 4401)
            return

        await websocket.accept()
        current_state = "visible"
        current_path = ""
        current_title = ""

        try:
            while True:
                try:
                    raw = await asyncio.wait_for(websocket.receive_text(), timeout=8.0)
                    try:
                        payload = json.loads(raw or "{}")
                    except Exception:
                        payload = {}
                    current_state = str(payload.get("state") or current_state or "visible")
                    current_path = str(payload.get("path") or current_path or "")
                    current_title = str(payload.get("title") or current_title or "")
                except asyncio.TimeoutError:
                    pass
                current_user_id = await asyncio.to_thread(read_session_user, sid)
                if current_user_id != user_id:
                    try:
                        await websocket.close(code=4401)
                    except Exception:
                        pass
                    break
                await asyncio.to_thread(
                    touch_live_presence,
                    user_id=user_id,
                    client_id=client_id,
                    sid=sid,
                    state=current_state,
                    path=current_path,
                    title=current_title,
                )
        except WebSocketDisconnect:
            pass
        except Exception:
            try:
                await websocket.close()
            except Exception:
                pass
        finally:
            await asyncio.to_thread(clear_live_presence, user_id=user_id, client_id=client_id)

    @router.websocket("/ws/integrated-admin/system")
    async def ws_integrated_admin_system(websocket: WebSocket):
        sid = ""
        try:
            sid = (websocket.cookies.get(SESSION_COOKIE_NAME, "") or "").strip()
        except Exception:
            sid = ""

        user_id = read_session_user(sid)
        if not user_id:
            await _reject_websocket_with_code(websocket, 4401)
            return

        row = read_user(user_id) or {}
        if _normalize_role(row.get("ROLE") or "") != "superuser":
            await _reject_websocket_with_code(websocket, 4403)
            return

        await websocket.accept()

        try:
            while True:
                payload = await asyncio.to_thread(_build_integrated_admin_realtime_payload, user_id)
                await websocket.send_text(json.dumps({"type": "realtime_snapshot", "payload": payload}, ensure_ascii=False))
                await asyncio.sleep(1.0)
        except WebSocketDisconnect:
            return
        except Exception:
            try:
                await websocket.close()
            except Exception:
                pass

    @router.post("/api/integrated-admin/users/{target_user_id}/promote")
    def api_integrated_admin_user_promote(request: Request, target_user_id: str):
        _require_superuser(request)
        current_user_id = getattr(request.state, "user_id", "") or ""
        target_row = _integrated_admin_target_user(target_user_id)
        target_id = str(target_row.get("ID") or "").strip()
        if target_id == current_user_id:
            return JSONResponse({"ok": False, "detail": "현재 로그인한 슈퍼어드민 계정은 직접 승격/강등할 수 없습니다."}, status_code=400)

        if _normalize_approval_status(target_row.get("APPROVAL_STATUS") or "") != "approved":
            return JSONResponse({"ok": False, "detail": "승인 완료된 계정만 role 변경이 가능합니다."}, status_code=409)

        current_role = _normalize_role(target_row.get("ROLE") or "")
        next_role = _promoted_role(current_role)
        if next_role == current_role:
            return JSONResponse({"ok": True, "message": "이미 최고 권한입니다.", "role": current_role, "role_label": _role_label(current_role)})

        user_repo.update_user_role(user_id=target_id, role=next_role)
        return JSONResponse({"ok": True, "message": "승격 완료", "role": next_role, "role_label": _role_label(next_role)})

    @router.post("/api/integrated-admin/users/{target_user_id}/demote")
    def api_integrated_admin_user_demote(request: Request, target_user_id: str):
        _require_superuser(request)
        current_user_id = getattr(request.state, "user_id", "") or ""
        target_row = _integrated_admin_target_user(target_user_id)
        target_id = str(target_row.get("ID") or "").strip()
        if target_id == current_user_id:
            return JSONResponse({"ok": False, "detail": "현재 로그인한 슈퍼어드민 계정은 직접 승격/강등할 수 없습니다."}, status_code=400)

        if _normalize_approval_status(target_row.get("APPROVAL_STATUS") or "") != "approved":
            return JSONResponse({"ok": False, "detail": "승인 완료된 계정만 role 변경이 가능합니다."}, status_code=409)

        current_role = _normalize_role(target_row.get("ROLE") or "")
        next_role = _demoted_role(current_role)
        if next_role == current_role:
            return JSONResponse({"ok": True, "message": "이미 최하위 권한입니다.", "role": current_role, "role_label": _role_label(current_role)})

        user_repo.update_user_role(user_id=target_id, role=next_role)
        return JSONResponse({"ok": True, "message": "강등 완료", "role": next_role, "role_label": _role_label(next_role)})

    @router.post("/api/integrated-admin/users/{target_user_id}/approve")
    def api_integrated_admin_user_approve(request: Request, target_user_id: str):
        _require_superuser(request)
        target_row = _integrated_admin_target_user(target_user_id)
        target_id = str(target_row.get("ID") or "").strip()
        if _normalize_approval_status(target_row.get("APPROVAL_STATUS") or "") == "approved":
            return JSONResponse({"ok": True, "message": "이미 승인된 계정입니다."})

        user_repo.update_user_approval(
            user_id=target_id,
            approval_status="approved",
            approved_by=(getattr(request.state, "user_id", "") or ""),
        )
        return JSONResponse({"ok": True, "message": "승인 완료"})
