from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Body, Form, Request
from fastapi.responses import FileResponse, RedirectResponse, HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

from services.user_store import authenticate_with_status
from services.user_store import create_user, user_exists
from services.smtp_utils import send_naver_verification_email
from redis.session import (
    ActiveSessionExistsError,
    SESSION_COOKIE_NAME,
    clear_session_cookie,
    create_session,
    delete_session,
    set_session_cookie,
)
from redis.simple_redis import RedisError
from redis.session import read_session_user

import secrets
import time

router = APIRouter()
templates = Jinja2Templates(directory="templates")
_FAVICON_PATH = Path(__file__).resolve().parents[1] / "logo" / "abbas_favicon.ico"


def _wants_json_response(request: Request) -> bool:
    requested_with = (request.headers.get("x-requested-with", "") or "").strip().lower()
    accept = (request.headers.get("accept", "") or "").strip().lower()
    return requested_with == "xmlhttprequest" or "application/json" in accept


def _login_template_response(
    request: Request,
    *,
    next_url: str,
    status_code: int,
    user_id_value: str = "",
    error: str = "",
    ok: str = "",
    swal_error_title: str = "",
    swal_error_text: str = "",
    can_force_login: bool = False,
):
    resp = templates.TemplateResponse(
        "login.html",
        {
            "request": request,
            "next": next_url,
            "user_id_value": user_id_value,
            "error": error,
            "ok": ok,
            "swal_error_title": swal_error_title,
            "swal_error_text": swal_error_text,
            "can_force_login": can_force_login,
        },
        status_code=status_code,
    )
    resp.headers["Cache-Control"] = "no-store"
    return resp


def _login_error_response(
    request: Request,
    *,
    next_url: str,
    status_code: int,
    user_id_value: str = "",
    error: str = "",
    swal_error_title: str = "",
    swal_error_text: str = "",
    can_force_login: bool = False,
):
    if _wants_json_response(request):
        return JSONResponse(
            {
                "ok": False,
                "error": error,
                "swal_error_title": swal_error_title,
                "swal_error_text": swal_error_text,
                "can_force_login": can_force_login,
                "next": next_url,
                "user_id_value": user_id_value,
            },
            status_code=status_code,
            headers={"Cache-Control": "no-store"},
        )

    return _login_template_response(
        request,
        next_url=next_url,
        status_code=status_code,
        user_id_value=user_id_value,
        error=error,
        swal_error_title=swal_error_title,
        swal_error_text=swal_error_text,
        can_force_login=can_force_login,
    )


@router.head("/favicon.ico", response_class=FileResponse)
@router.get("/favicon.ico", response_class=FileResponse)
def favicon():
    return FileResponse(str(_FAVICON_PATH), media_type="image/x-icon")


@router.get("/login", response_class=HTMLResponse)
def login_page(request: Request, next: str = "/"):
    # 이미 로그인 상태에서 뒤로가기로 /login에 접근하면
    # 강제로 대시보드로 보내서 '로그인 화면으로 돌아가는' 버그를 방지합니다.
    sid = request.cookies.get(SESSION_COOKIE_NAME, "") or ""
    if sid and read_session_user(sid):
        return RedirectResponse(url=next or "/", status_code=302)
    return _login_template_response(request, next_url=next, status_code=200)


@router.get("/signup", response_class=HTMLResponse)
def signup_page(request: Request):
    # 로그인 상태면 회원가입 페이지 접근 대신 대시보드로
    sid = request.cookies.get(SESSION_COOKIE_NAME, "") or ""
    if sid and read_session_user(sid):
        return RedirectResponse(url="/", status_code=302)
    resp = templates.TemplateResponse("signup.html", {"request": request})
    resp.headers["Cache-Control"] = "no-store"
    return resp


@router.post("/signup", response_class=HTMLResponse)
def signup_action(
    request: Request,
    user_id: str = Form(""),
    password: str = Form(""),
    password2: str = Form(""),
    email: str = Form(""),
    birth: str = Form(""),
    name: str = Form(""),
    nickname: str = Form(""),
    email_verify_token: str = Form(""),
):
    # 로그인 상태면 가입 불필요
    sid = request.cookies.get(SESSION_COOKIE_NAME, "") or ""
    if sid and read_session_user(sid):
        return RedirectResponse(url="/", status_code=302)

    if (password or "") != (password2 or ""):
        return templates.TemplateResponse(
            "signup.html",
            {"request": request, "error": "비밀번호 확인이 일치하지 않습니다."},
            status_code=400,
        )

    # 이메일 인증 토큰 검증 (Redis)
    r = getattr(request.app.state, "redis", None)
    if r is None:
        return templates.TemplateResponse(
            "signup.html",
            {"request": request, "error": "Redis 미구성 상태입니다. (이메일 인증 불가)"},
            status_code=500,
        )

    token = (email_verify_token or "").strip()
    if not token:
        return templates.TemplateResponse(
            "signup.html",
            {"request": request, "error": "이메일 인증을 완료해주세요."},
            status_code=400,
        )

    try:
        token_key = f"email:verify_token:{token}"
        verified_email = r.get_str(token_key) or ""
    except Exception:
        verified_email = ""

    if not verified_email:
        return templates.TemplateResponse(
            "signup.html",
            {"request": request, "error": "이메일 인증 토큰이 만료되었거나 올바르지 않습니다."},
            status_code=400,
        )

    if (verified_email or "").strip().lower() != (email or "").strip().lower():
        return templates.TemplateResponse(
            "signup.html",
            {"request": request, "error": "인증된 이메일과 입력한 이메일이 일치하지 않습니다."},
            status_code=400,
        )

    ok, msg = create_user(
        user_id=user_id,
        password=password,
        email=email,
        birth=birth,
        name=name,
        nickname=nickname,
    )
    if not ok:
        return templates.TemplateResponse(
            "signup.html",
            {"request": request, "error": msg},
            status_code=400,
        )

    # 사용 완료 토큰 제거
    try:
        r.execute("DEL", token_key)
    except Exception:
        pass

    # 가입 완료 후 로그인 화면으로
    return templates.TemplateResponse(
        "login.html",
        {
            "request": request,
            "next": "/",
            "ok": "회원가입 신청이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.",
        },
        status_code=200,
    )


@router.get("/auth/check-id")
def api_check_id(user_id: str = ""):
    uid = (user_id or "").strip()
    try:
        exists = bool(user_exists(uid))
    except Exception:
        exists = False
    return JSONResponse({"ok": True, "exists": exists})


@router.post("/auth/email/send-code")
def api_send_email_code(request: Request, payload: dict = Body(default={})):  # type: ignore
    email = (payload.get("email") or "").strip()
    if not email or "@" not in email:
        return JSONResponse({"ok": False, "detail": "이메일 형식이 올바르지 않습니다."}, status_code=400)

    r = getattr(request.app.state, "redis", None)
    if r is None:
        return JSONResponse({"ok": False, "detail": "Redis 미구성 상태입니다."}, status_code=500)

    code = f"{secrets.randbelow(1_000_000):06d}"
    now = int(time.time())

    # 5분 유효
    try:
        r.set(f"email:code:{email.lower()}", f"{code}|{now}", ex=300)
    except Exception as e:
        print(f"[AUTH] email code cache failed: {e}")
        return JSONResponse(
            {"ok": False, "detail": "이메일 인증 요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요."},
            status_code=500,
        )

    try:
        send_naver_verification_email(email, code)
    except Exception as e:
        print(f"[AUTH] email code send failed: {e}")
        return JSONResponse(
            {"ok": False, "detail": "인증 메일 전송에 실패했습니다. 잠시 후 다시 시도해주세요."},
            status_code=500,
        )

    return JSONResponse({"ok": True})


@router.post("/auth/email/verify-code")
def api_verify_email_code(request: Request, payload: dict = Body(default={})):  # type: ignore
    email = (payload.get("email") or "").strip()
    code = (payload.get("code") or "").strip()
    if not email or not code:
        return JSONResponse({"ok": False, "detail": "이메일/코드가 필요합니다."}, status_code=400)

    r = getattr(request.app.state, "redis", None)
    if r is None:
        return JSONResponse({"ok": False, "detail": "Redis 미구성 상태입니다."}, status_code=500)

    try:
        v = r.get_str(f"email:code:{email.lower()}") or ""
    except Exception:
        v = ""

    if not v:
        return JSONResponse({"ok": False, "detail": "인증 코드가 만료되었습니다."}, status_code=400)

    try:
        saved_code, _ts = v.split("|", 1)
    except Exception:
        saved_code = v

    if saved_code != code:
        return JSONResponse({"ok": False, "detail": "인증 코드가 올바르지 않습니다."}, status_code=400)

    verify_token = secrets.token_urlsafe(24)
    try:
        r.set(f"email:verify_token:{verify_token}", email.lower(), ex=900)  # 15분
        # 사용된 코드 삭제
        r.execute("DEL", f"email:code:{email.lower()}")
    except Exception as e:
        print(f"[AUTH] email verify token save failed: {e}")
        return JSONResponse(
            {"ok": False, "detail": "이메일 인증 확인을 처리하지 못했습니다. 잠시 후 다시 시도해주세요."},
            status_code=500,
        )

    return JSONResponse({"ok": True, "verify_token": verify_token})


@router.post("/login")
def login_action(
    request: Request,
    user_id: str = Form(""),
    password: str = Form(""),
    next: str = Form("/"),
    remember_id: str = Form("", alias="remember_id"),
    auto_login: str = Form("", alias="auto_login"),
    force_login: str = Form("", alias="force_login"),
):
    ok, auth_status = authenticate_with_status(user_id, password)
    if not ok:
        if auth_status == "pending":
            pending_msg = "관리자 승인대기중 입니다"
            return _login_error_response(
                request,
                next_url=next,
                status_code=403,
                user_id_value=user_id,
                error=pending_msg,
                swal_error_title="승인 대기",
                swal_error_text=pending_msg,
            )
        return _login_error_response(
            request,
            next_url=next,
            status_code=400,
            user_id_value=user_id,
            error="아이디 또는 비밀번호가 올바르지 않습니다.",
        )

    auto = str(auto_login).lower() in ("1", "true", "on", "yes")
    force = str(force_login).lower() in ("1", "true", "on", "yes")
    try:
        sid = create_session(user_id=user_id, auto_login=auto, force_replace=force)
    except ActiveSessionExistsError as exc:
        live_msg = "현재 활성 세션이 감지되었습니다. 기존 세션을 종료하고 이 브라우저에서 다시 로그인할 수 있습니다."
        return _login_error_response(
            request,
            next_url=next,
            status_code=409,
            user_id_value=user_id,
            error=live_msg,
            swal_error_title="중복 로그인 감지",
            swal_error_text=live_msg,
            can_force_login=exc.has_live_presence,
        )
    except (RedisError, Exception):
        return _login_error_response(
            request,
            next_url=next,
            status_code=500,
            user_id_value=user_id,
            error="Redis 연결 실패로 로그인할 수 없습니다. (REDIS_HOST/PORT/PASSWORD 확인)",
        )

    redirect_url = next or "/"
    if _wants_json_response(request):
        resp = JSONResponse({"ok": True, "redirect_url": redirect_url}, headers={"Cache-Control": "no-store"})
        set_session_cookie(resp, sid, auto_login=auto)
        _ = remember_id
        return resp

    resp = RedirectResponse(url=redirect_url, status_code=302)
    set_session_cookie(resp, sid, auto_login=auto)

    # remember_id: handled by client(localStorage). Server does not alter session.
    _ = remember_id
    return resp


@router.get("/logout")
def logout(request: Request):
    sid = request.cookies.get(SESSION_COOKIE_NAME, "") or ""
    if sid:
        delete_session(sid)
    resp = RedirectResponse(url="/login", status_code=302)
    clear_session_cookie(resp)
    return resp
