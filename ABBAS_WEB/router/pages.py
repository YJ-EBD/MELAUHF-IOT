from __future__ import annotations

import hashlib
import os
import re
import secrets
import socket
import time
import asyncio
import json
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Body, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.templating import Jinja2Templates

from DB import data_repo
from DB import device_repo
from DB import device_ops_repo
from DB import firmware_repo
from DB.runtime import get_mysql
from services.log_store import read_logs as db_read_logs
from redis.session import SESSION_COOKIE_NAME, read_session_user
router = APIRouter()
templates = Jinja2Templates(directory="templates")
DEVICE_LOG_ARCHIVE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "storage", "device_logs")
DEVICE_LOG_UPLOAD_MAX_CHUNK_BYTES = 4096
FIRMWARE_STORAGE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "storage", "firmware")
FIRMWARE_FAMILY_DEFAULT = (os.getenv("ABBAS_FIRMWARE_FAMILY_DEFAULT", "ABBAS_ESP32C5_MELAUHF").strip() or "ABBAS_ESP32C5_MELAUHF")
DEVICE_FIRMWARE_CHECK_INTERVAL_SEC = int(os.getenv("ABBAS_DEVICE_FIRMWARE_CHECK_SEC", "1800"))
FIRMWARE_MAX_UPLOAD_BYTES = int(os.getenv("ABBAS_FIRMWARE_MAX_UPLOAD_BYTES", "3342336"))


def _fmt(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M")


def _parse_runtime_dt(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    s = str(value or "").strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(s, fmt)
        except Exception:
            continue
    return None


def _payload_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    s = str(value).strip().lower()
    if s in {"1", "true", "yes", "y", "on", "o"}:
        return True
    if s in {"0", "false", "no", "n", "off", "x"}:
        return False
    return default


def _payload_mb(value: Any, default: float = 0.0) -> float:
    try:
        v = float(value)
    except Exception:
        v = float(default)
    if v != v:  # NaN guard
        return max(float(default), 0.0)
    return max(v, 0.0)


def _payload_int(value: Any, default: int = 0) -> int:
    try:
        v = int(value)
    except Exception:
        v = int(default)
    return max(v, 0)


def _is_idle_measurement(line: str = "", power: str = "", time_sec: str = "") -> bool:
    raw_line = str(line or "").strip().lower()
    raw_power = str(power or "").strip().lower()
    raw_time = str(time_sec or "").strip().lower()

    if raw_line == "0w,0":
        return True

    power_zero = raw_power in {"0", "0w", "0.0", "0.0w"}
    time_zero = raw_time in {"0", "0s", "0sec", "0.0", "0.0s"}
    return power_zero and time_zero


def _format_capacity_label(mb: float) -> str:
    mb = max(float(mb or 0.0), 0.0)
    if mb >= 1024.0:
        return f"{(mb / 1024.0):.2f} GB"
    return f"{mb:.0f} MB"


def _sanitize_firmware_token(value: Any, default: str = "") -> str:
    raw = str(value or "").strip()
    if not raw:
        raw = default
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", raw).strip("._-")
    return cleaned or default


def _format_firmware_identity(family: str, version: str = "", build_id: str = "") -> str:
    family = str(family or "").strip()
    version = str(version or "").strip()
    build_id = str(build_id or "").strip()
    out = family or "-"
    if version:
        out += f" {version}"
    if build_id:
        out += f" ({build_id})"
    return out


def _extract_firmware_fields(payload: dict[str, Any]) -> tuple[str, str, str, str]:
    family = str(payload.get("fw") or payload.get("fw_family") or payload.get("fwFamily") or "").strip()
    version = str(payload.get("fw_version") or payload.get("fwVersion") or "").strip()
    build_id = str(payload.get("fw_build_id") or payload.get("fwBuildId") or "").strip()
    display = _format_firmware_identity(family, version, build_id)
    return family, version, build_id, display


def _release_download_path(release_id: int) -> str:
    return f"/api/device/ota/download/{int(release_id)}"


def _build_firmware_summary(releases: list[dict[str, Any]], devices: list[dict[str, Any]]) -> dict[str, int]:
    assigned = sum(1 for row in devices if int(row.get("target_release_id") or 0) > 0)
    failures = sum(1 for row in devices if str(row.get("ota_state") or "").strip().lower() in {"failed", "error"})
    current_known = sum(1 for row in devices if str(row.get("current_version") or "").strip())
    return {
        "release_count": len(releases),
        "device_count": len(devices),
        "assigned_count": assigned,
        "failure_count": failures,
        "current_known_count": current_known,
    }


def _build_firmware_payload() -> dict[str, Any]:
    releases = firmware_repo.list_releases()
    devices = firmware_repo.list_device_rows()
    families = sorted(
        {
            str(row.get("family") or "").strip()
            for row in releases
            if str(row.get("family") or "").strip()
        }
        | {
            str(row.get("current_family") or "").strip()
            for row in devices
            if str(row.get("current_family") or "").strip()
        }
        | {FIRMWARE_FAMILY_DEFAULT}
    )
    return {
        "summary": _build_firmware_summary(releases, devices),
        "releases": [
            {
                **row,
                "download_path": _release_download_path(int(row.get("id") or 0)),
            }
            for row in releases
        ],
        "devices": devices,
        "families": families,
        "max_upload_bytes": int(FIRMWARE_MAX_UPLOAD_BYTES),
        "default_family": FIRMWARE_FAMILY_DEFAULT,
    }


def _merge_sd_payload(payload: dict[str, Any], prev: dict[str, Any] | None = None) -> tuple[bool, float, float, float]:
    prev = prev or {}

    sd_inserted = _payload_bool(payload.get("sd_inserted"), _payload_bool(prev.get("sd_inserted"), False))
    sd_total_mb = _payload_mb(payload.get("sd_total_mb"), _payload_mb(prev.get("sd_total_mb"), 0.0))
    sd_used_mb = _payload_mb(payload.get("sd_used_mb"), _payload_mb(prev.get("sd_used_mb"), 0.0))
    sd_free_mb = _payload_mb(payload.get("sd_free_mb"), _payload_mb(prev.get("sd_free_mb"), 0.0))

    if sd_total_mb <= 0.0 and (sd_used_mb > 0.0 or sd_free_mb > 0.0):
        sd_total_mb = sd_used_mb + sd_free_mb

    if (not sd_inserted) and (sd_total_mb > 0.0 or sd_used_mb > 0.0 or sd_free_mb > 0.0):
        sd_inserted = True

    if not sd_inserted:
        return False, 0.0, 0.0, 0.0

    if sd_total_mb > 0.0:
        if sd_used_mb > sd_total_mb:
            sd_used_mb = sd_total_mb
        sd_free_mb = max(sd_total_mb - sd_used_mb, 0.0)

    return True, sd_total_mb, sd_used_mb, sd_free_mb


def _nav_items() -> list[dict[str, str]]:
    return [
        {"key": "dashboard", "label": "대시보드", "path": "/"},
        {"key": "device_status", "label": "디바이스 목록", "path": "/device-status"},
        {"key": "control_panel", "label": "제어 패널", "path": "/control-panel"},
        {"key": "logs", "label": "로그", "path": "/logs"},
        {"key": "data", "label": "데이터", "path": "/data"},
        {"key": "plan", "label": "플랜", "path": "/plan"},
        {"key": "firmware_manage", "label": "Firmware Manage", "path": "/firmware-manage"},
        {"key": "settings", "label": "설정", "path": "/settings"},
    ]


def _dummy_devices(now: datetime) -> list[dict[str, Any]]:
    # NOTE: device names are intentionally kept in English to comply with the exception rule.
    return [
        {
            "name": "Device-A01",
            "online": True,
            "last_seen": _fmt(now - timedelta(minutes=2)),
            "plan_status": "active",
            "plan_expiry": (now + timedelta(days=28)).date().isoformat(),
        },
        {
            "name": "Device-B02",
            "online": True,
            "last_seen": _fmt(now - timedelta(minutes=7)),
            "plan_status": "active",
            "plan_expiry": (now + timedelta(days=6)).date().isoformat(),
        },
        {
            "name": "Device-C03",
            "online": False,
            "last_seen": _fmt(now - timedelta(hours=8, minutes=12)),
            "plan_status": "expired",
            "plan_expiry": (now - timedelta(days=3)).date().isoformat(),
        },
        {
            "name": "Device-D04",
            "online": True,
            "last_seen": _fmt(now - timedelta(minutes=1)),
            "plan_status": "expired",
            "plan_expiry": (now + timedelta(days=2)).date().isoformat(),
        },
        {
            "name": "Device-E05",
            "online": False,
            "last_seen": _fmt(now - timedelta(days=1, hours=1)),
            "plan_status": "expired",
            "plan_expiry": (now - timedelta(days=12)).date().isoformat(),
        },
        {
            "name": "Device-F06",
            "online": True,
            "last_seen": _fmt(now - timedelta(minutes=16)),
            "plan_status": "active",
            "plan_expiry": (now + timedelta(days=90)).date().isoformat(),
        },
        {
            "name": "Device-G07",
            "online": True,
            "last_seen": _fmt(now - timedelta(minutes=4)),
            "plan_status": "active",
            "plan_expiry": (now + timedelta(days=14)).date().isoformat(),
        },
        {
            "name": "Device-H08",
            "online": False,
            "last_seen": _fmt(now - timedelta(hours=3, minutes=45)),
            "plan_status": "expired",
            "plan_expiry": (now + timedelta(days=1)).date().isoformat(),
        },
    ]


def _dummy_logs(now: datetime, devices: list[dict[str, Any]]) -> list[dict[str, Any]]:
    names = [d["name"] for d in devices]
    return [
        {"time": _fmt(now - timedelta(minutes=3)), "device": names[0], "type": "정보", "message": "상태 핑 수신"},
        {"time": _fmt(now - timedelta(minutes=11)), "device": names[3], "type": "경고", "message": "응답 지연 감지"},
        {"time": _fmt(now - timedelta(minutes=22)), "device": names[2], "type": "오류", "message": "통신 실패(재시도 대기)"},
        {"time": _fmt(now - timedelta(hours=1, minutes=7)), "device": names[1], "type": "정보", "message": "사용량 동기화 완료"},
        {"time": _fmt(now - timedelta(hours=2, minutes=41)), "device": names[5], "type": "정보", "message": "설정 값 업데이트(로컬)"},
        {"time": _fmt(now - timedelta(hours=4, minutes=10)), "device": names[4], "type": "경고", "message": "구독 만료 상태 감지"},
    ]


def _counts(devices: list[dict[str, Any]]) -> dict[str, int]:
    total = len(devices)
    online = sum(1 for d in devices if d["online"])
    offline = total - online
    expired = sum(1 for d in devices if d["plan_status"] != "active")
    active = total - expired
    return {
        "total": total,
        "online": online,
        "offline": offline,
        "expired": expired,
        "restricted": 0,
        "active": active,
    }


def _subscription_status_code(status_kor: str) -> str:
    if status_kor == "활성":
        return "active"
    return "expired"


# [NEW FEATURE] Fixed assigned energy by non-test subscription plan (J).
SUB_PLAN_FIXED_ENERGY_J: dict[str, int] = {
    "BASIC 6M": 22_000_000,
    "BASIC 9M": 14_000_000,
    "BASIC 1Y": 8_000_000,
}


def _runtime_used_energy_j(customer: str, device_id: str, ip: str) -> int:
    key = _resolve_runtime_key(customer, ip, _norm_device_id(device_id))
    st = (_DEVICE_STATE.get(key or "") if key else {}) or {}
    if not isinstance(st, dict):
        return 0
    return _payload_int(st.get("used_energy_j"), _payload_int(st.get("usedEnergyJ"), 0))


def _subscription_energy_fields(rec: dict[str, Any]) -> dict[str, int]:
    plan_energy_j = _payload_int(rec.get("energy_j"), _payload_int(rec.get("energyJ"), 0))
    used_energy_j = _runtime_used_energy_j(
        str(rec.get("customer") or "-"),
        str(rec.get("device_id") or ""),
        str(rec.get("ip") or ""),
    )
    if used_energy_j <= 0:
        used_energy_j = _payload_int(rec.get("used_energy_j"), _payload_int(rec.get("usedEnergyJ"), 0))
    remaining_energy_j = max(plan_energy_j - used_energy_j, 0)
    return {
        "energy_j": plan_energy_j,
        "energyJ": plan_energy_j,
        "used_energy_j": used_energy_j,
        "usedEnergyJ": used_energy_j,
        "remaining_energy_j": remaining_energy_j,
        "remainingEnergyJ": remaining_energy_j,
    }


def _build_plan_payload() -> dict[str, Any]:
    rows = device_repo.list_devices_with_subscription()
    devices: list[dict[str, Any]] = []
    counts = {"active": 0, "expired": 0, "restricted": 0}

    for r in rows:
        status = str(r.get("status") or "만료")
        status_code = _subscription_status_code(status)
        if status == "활성":
            counts["active"] += 1
        else:
            counts["expired"] += 1

        item = {
            "device_id": str(r.get("device_id") or ""),
            "name": str(r.get("device_name") or r.get("name") or r.get("ip") or ""),
            "status": status,
            "status_code": status_code,
            "plan": str(r.get("plan") or "-") or "-",
            "start_date": str(r.get("start_date") or "-") or "-",
            "expiry_date": str(r.get("expiry_date") or "-") or "-",
            "remaining_days": int(r.get("remaining_days") or 0),
            "customer": str(r.get("customer") or "-"),
            "ip": str(r.get("ip") or ""),
            # [NEW FEATURE] Assigned/used/remaining energy columns for the plan table.
            **_subscription_energy_fields(r),
        }
        devices.append(item)

    return {"devices": devices, "counts": counts}


def _subscription_response_or_default(device_id: str) -> dict[str, Any]:
    rec = device_repo.get_subscription_by_device_id(device_id)
    if not rec:
        item = {
            "device_id": _norm_device_id(device_id),
            "device_name": "",
            "status": "미등록",
            "status_code": "unregistered",
            "plan": None,
            "start_date": None,
            "expiry_date": None,
            "remaining_days": 0,
        }
        item.update(_subscription_energy_fields(item))
        return item

    plan_value = (str(rec.get("plan")) if rec.get("plan") else None)
    status_value = str(rec.get("status") or "만료")
    status_code_value = str(rec.get("status_code") or _subscription_status_code(status_value))
    # Registered device with revoked/cleared plan should boot to the ready page, not the expired lock page.
    if not plan_value:
        status_value = "미등록"
        status_code_value = "unregistered"

    item = {
        "device_id": str(rec.get("device_id") or _norm_device_id(device_id)),
        "device_name": str(rec.get("device_name") or ""),
        "status": status_value,
        "status_code": status_code_value,
        "plan": plan_value,
        "start_date": (str(rec.get("start_date")) if rec.get("start_date") else None),
        "expiry_date": (str(rec.get("expiry_date")) if rec.get("expiry_date") else None),
        "remaining_days": int(rec.get("remaining_days") or 0),
        "customer": str(rec.get("customer") or "-"),
        "ip": str(rec.get("ip") or ""),
    }
    item.update(_subscription_energy_fields(rec))
    return item


def _base_context(request: Request, active_key: str, **kwargs: Any) -> dict[str, Any]:
    user_id = getattr(request.state, "user_id", "") or ""
    logged_in = bool(user_id)
    return {"request": request, "nav_items": _nav_items(), "nav_active": active_key, "logged_in": logged_in, "current_user_id": user_id, **kwargs}


# ==============================================================
# Runtime device registry (ESP32 -> web) + DB persistence
# ==============================================================
# NOTE: 기존 구조/라우팅을 유지하면서, 저장소만 DB(MySQL/MariaDB)로 전환합니다.

# token map (customer separation)
TOKEN_DIR = "token"
SET_TOKEN_ENV = os.path.join(TOKEN_DIR, "setToken.env")

# Online / Offline 판단 기준(초)
ONLINE_WINDOW_SEC = int(os.getenv("FOR_RND_ONLINE_WINDOW_SEC", "90"))
DEVICE_HEARTBEAT_INTERVAL_SEC = int(os.getenv("ABBAS_DEVICE_HEARTBEAT_SEC", "30"))
DEVICE_TELEMETRY_INTERVAL_SEC = int(os.getenv("ABBAS_DEVICE_TELEMETRY_SEC", "60"))
DEVICE_SUBSCRIPTION_SYNC_INTERVAL_SEC = int(os.getenv("ABBAS_DEVICE_SUBSCRIPTION_SYNC_SEC", "600"))
DEVICE_REGISTER_REFRESH_SEC = int(os.getenv("ABBAS_DEVICE_REGISTER_REFRESH_SEC", "21600"))

# 드롭다운(미등록) 목록에서 ghost device 제거를 위한 TTL(초)
DISCOVERY_TTL_SEC = int(os.getenv("FOR_RND_DISCOVERY_TTL_SEC", str(ONLINE_WINDOW_SEC)))
ENABLE_LAN_DISCOVERY = (os.getenv("ABBAS_ENABLE_LAN_DISCOVERY", "0").strip() == "1")
ENABLE_DIRECT_DEVICE_TCP = (os.getenv("ABBAS_ENABLE_DIRECT_DEVICE_TCP", "0").strip() == "1")

# UDP discovery (ESP32 -> PC) protocol
UDP_DISCOVERY_PORT = int(os.getenv("FOR_RND_UDP_DISCOVERY_PORT", "4210"))
UDP_DISCOVERY_MAGIC = os.getenv("FOR_RND_UDP_DISCOVERY_MAGIC", "DISCOVER_FOR_RND")
UDP_DISCOVERY_REPLY_PREFIX = "FOR_RND_DEVICE|"
UDP_DISCOVERY_TIMEOUT_SEC = float(os.getenv("FOR_RND_UDP_DISCOVERY_TIMEOUT_SEC", "3.0"))

# 오래된 런타임 캐시 정리(초) - 디바이스가 완전히 꺼졌을 때 서버 메모리에서 제거
PRUNE_RUNTIME_SEC = int(os.getenv("FOR_RND_PRUNE_RUNTIME_SEC", str(max(ONLINE_WINDOW_SEC * 6, 90))))

# 서버 메모리 로그 캐시(디바이스별 최근 N라인)
MAX_LOG_LINES = int(os.getenv("FOR_RND_MAX_LOG_LINES", "500"))
RUNTIME_LOG_DEDUP_SEC = int(os.getenv("FOR_RND_RUNTIME_LOG_DEDUP_SEC", "15"))
DEVICE_TCP_PORT = int(os.getenv("FOR_RND_DEVICE_TCP_PORT", "5000"))
REMOTE_RESET_TIMEOUT_SEC = float(os.getenv("FOR_RND_REMOTE_RESET_TIMEOUT_SEC", "1.0"))
REMOTE_SD_DELETE_TIMEOUT_SEC = float(os.getenv("FOR_RND_REMOTE_SD_DELETE_TIMEOUT_SEC", "2.0"))
REMOTE_RESET_COMMAND = "RESET_STATE"
REMOTE_SUBSCRIPTION_RESET_COMMAND = "RESET_SUBSCRIPTION"
TRASHCAN_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "Trashcan")
KST = timezone(timedelta(hours=9))

# 런타임 상태 캐시
_DEVICE_STATE: dict[str, dict[str, Any]] = {}
_DEVICE_LOGS: dict[str, list[dict[str, Any]]] = {}
_LAST_RUNTIME_LOG: dict[str, dict[str, Any]] = {}
_DISCOVERY_CACHE: dict[str, dict[str, Any]] = {}
_IP_CUSTOMER_TO_KEY: dict[tuple[str, str], str] = {}
_TOKEN_TO_KEY: dict[str, str] = {}
_DEVICEID_TO_KEY: dict[str, str] = {}


def _request_client_ip(request: Request) -> str:
    forwarded_for = (request.headers.get("x-forwarded-for") or "").strip()
    if forwarded_for:
        return (forwarded_for.split(",")[0] or "").strip()

    real_ip = (request.headers.get("x-real-ip") or "").strip()
    if real_ip:
        return real_ip

    return (request.client.host if request.client else "").strip()


def _request_user_id(request: Request) -> str:
    sid = request.cookies.get(SESSION_COOKIE_NAME, "") or ""
    return read_session_user(sid) or ""


def _device_polling_policy() -> dict[str, int]:
    return {
        "heartbeat_interval_sec": DEVICE_HEARTBEAT_INTERVAL_SEC,
        "telemetry_interval_sec": DEVICE_TELEMETRY_INTERVAL_SEC,
        "subscription_sync_interval_sec": DEVICE_SUBSCRIPTION_SYNC_INTERVAL_SEC,
        "register_refresh_sec": DEVICE_REGISTER_REFRESH_SEC,
        "firmware_check_interval_sec": DEVICE_FIRMWARE_CHECK_INTERVAL_SEC,
        "online_window_sec": ONLINE_WINDOW_SEC,
    }


def _ensure_device_csv() -> None:
    """CSV 기반 저장소는 폐기되었습니다.

    과거 코드/라우팅 호환을 위해 no-op으로 유지합니다.
    """
    return None


def _ensure_model_token_map_csv() -> None:
    """(미사용) 구형 모델 토큰맵 파일.

    - 사용자 요구: modelTokenMap.csv / 모델명 기반 매핑 로직은 전부 폐기(사용 금지)
    """
    return


def _load_saved_devices() -> list[dict[str, str]]:
    return device_repo.list_saved_devices()


def _append_saved_device(name: str, ip: str, customer: str, token: str = "", device_id: str = "") -> bool:
    name = (name or "").strip()
    ip = (ip or "").strip()
    customer = (customer or "-").strip() or "-"
    token = (token or "").strip()
    device_id = (device_id or "").strip()
    if not ip:
        return False

    # 기존 동작: device_id 우선 중복 방지, fallback IP 중복 방지
    existing = _load_saved_devices()
    if device_id:
        for e in existing:
            if (e.get("device_id") or "").strip() == device_id:
                return True
    for e in existing:
        if (e.get("ip") == ip):
            return True

    try:
        device_repo.upsert_device(name=name or ip, ip=ip, customer=customer, token=token, device_id=device_id)
        return True
    except Exception:
        return False


def _rewrite_saved_devices(rows: list[dict[str, str]]) -> None:
    """Save list of devices to DB.

    기존 코드가 "전체를 다시 쓰는" 방식이므로, DB에서도 동일한 의미로
    replace 동작(UPSERT + 누락 삭제)을 수행합니다.
    """
    device_repo.replace_all_devices(rows)


def _find_saved_device(ip: str, customer: str, token: str = "") -> dict[str, str] | None:
    ip = (ip or "").strip()
    customer = (customer or "-").strip() or "-"
    token = (token or "").strip()
    saved = _load_saved_devices()

    if token:
        for d in saved:
            if (d.get("token") or "").strip() == token:
                return d
    for d in saved:
        if (d.get("ip") == ip):
            return d
    return None


_TOKEN_MAP_LOGGED = False


def _parse_token_map() -> dict[str, str]:
    """(미사용) 구형 모델 토큰맵 로직 무력화."""
    return {}


def _seed_set_token_env_from_env_if_needed() -> None:
    """(레거시) token/setToken.env 운영 방식은 이번 버전에서 사용하지 않습니다."""
    return


def _upsert_token_mapping(token: str, customer: str) -> None:
    """(레거시) token/setToken.env 기반 토큰맵 갱신은 사용하지 않습니다."""
    return


def _remove_token_mapping(token: str) -> None:
    """(레거시) token/setToken.env 기반 토큰맵 삭제는 사용하지 않습니다."""
    return


def _generate_unique_token() -> str:
    """디바이스 저장 시 서버가 자동 생성/부여하는 token.

    - 기존 token map/setToken.env 및 DB의 devices.token과 중복되지 않게 생성
    - 펌웨어 매크로/헤더로 사용하기 쉽도록 ASCII(영문/숫자)만 사용
    """
    existing = set(_parse_token_map().keys())
    for d in _load_saved_devices():
        t = (d.get("token") or "").strip()
        if t:
            existing.add(t)

    # token + 16 hex (총 21자)
    for _ in range(120):
        t = "token" + secrets.token_hex(8)
        if t not in existing:
            return t

    # (극히 예외) 충돌이 반복되면 길이를 늘림
    return "token" + secrets.token_hex(12)


def _extract_auth_token(request: Request, payload: dict[str, Any]) -> str:
    token = (request.headers.get("X-Auth-Token") or request.headers.get("x-auth-token") or "").strip()
    if not token:
        token = str(payload.get("token") or "").strip()
    return token


def _norm_device_id(v: str) -> str:
    """device_id(MAC) 정규화: 대소문자/구분자 차이로 인한 재미등록 버그 방지."""
    s = (v or "").strip().lower()
    if not s:
        return ""
    hex_only = "".join(ch for ch in s if ch in "0123456789abcdef")
    if len(hex_only) == 12:
        return ":".join(hex_only[i:i+2] for i in range(0, 12, 2))
    return s


def _auth_customer(request: Request, payload: dict[str, Any]) -> str:
    """(최소) 토큰 기반 customer 매핑/검증을 하지 않습니다.

    - 사용자 요구: env/setToken.env / modelTokenMap.csv 기반 토큰 로직 전면 폐기
    - token은 디바이스 고유 랜덤값(추적용)으로만 사용
    """
    customer = str(payload.get("customer") or "-").strip() or "-"
    return customer


def _device_record_or_403(device_id: str, token: str) -> dict[str, Any] | None:
    did = _norm_device_id(device_id)
    if not did:
        return None

    rec = device_repo.get_device_by_device_id(did)
    if not rec:
        return None

    expected = str(rec.get("token") or "").strip()
    if expected and not token:
        raise HTTPException(status_code=401, detail="device token required")
    if expected and not secrets.compare_digest(expected, token):
        raise HTTPException(status_code=403, detail="invalid device token")
    return rec


def _require_device_identity(request: Request, payload: dict[str, Any]) -> tuple[str, str, dict[str, Any] | None]:
    token = _extract_auth_token(request, payload)
    device_id = _norm_device_id(str(payload.get("device_id") or "").strip())
    if not device_id:
        raise HTTPException(status_code=400, detail="device_id required")
    if not token:
        raise HTTPException(status_code=400, detail="token required")
    return token, device_id, _device_record_or_403(device_id, token)


def _device_api_meta(device_id: str, ip: str, customer: str) -> dict[str, Any]:
    pending = _pending_remote_command(device_id=device_id, ip=ip, customer=customer) or {}
    return {
        "server_time": datetime.utcnow().replace(tzinfo=timezone.utc).isoformat(),
        "polling": _device_polling_policy(),
        "pending_command_id": int(pending.get("id") or 0),
        "pending_command": str(pending.get("command") or "").strip(),
        "pending_command_queued_at": str(pending.get("queued_at") or "").strip(),
    }


def _append_device_runtime_log(
    runtime_key: str,
    *,
    device_id: str,
    customer: str,
    ip: str,
    when: datetime,
    line: str,
    level: str = "info",
    source: str = "device",
) -> None:
    line = str(line or "").strip()
    if not line:
        return

    prev = _LAST_RUNTIME_LOG.get(runtime_key or "")
    if prev:
        prev_line = str(prev.get("line") or "")
        prev_source = str(prev.get("source") or "")
        prev_when = prev.get("when")
        try:
            age_sec = (when - prev_when).total_seconds() if prev_when else None
        except Exception:
            age_sec = None
        if prev_line == line and prev_source == source and age_sec is not None and age_sec <= RUNTIME_LOG_DEDUP_SEC:
            return

    logs = _DEVICE_LOGS.get(runtime_key)
    if logs is None:
        logs = []
        _DEVICE_LOGS[runtime_key] = logs
    logs.append({"t": when, "line": line})
    _LAST_RUNTIME_LOG[runtime_key] = {"when": when, "line": line, "source": source}
    if len(logs) > MAX_LOG_LINES:
        del logs[: len(logs) - MAX_LOG_LINES]

    try:
        device_ops_repo.append_runtime_log(
            device_id=device_id,
            customer=customer,
            ip=ip,
            line=line,
            level=level,
            source=source,
            created_at=when,
        )
    except Exception:
        pass


def _device_key(customer: str, device_id: str, ip: str) -> str:
    """런타임 상태/로그 캐시 키.

    - 요구사항: 표시명(디바이스명/거래처) 변경이 상태추적/삭제/수정 로직을 깨지 않도록
      customer(표시값)와 무관하게 device_id(고유ID) 우선으로 키를 고정합니다.
    """
    device_id = (device_id or "").strip()
    ip = (ip or "").strip()
    if device_id:
        return device_id
    if ip:
        return ip
    return "unknown"


def _queue_remote_reset(
    device_id: str = "",
    ip: str = "",
    customer: str = "-",
    command: str = REMOTE_RESET_COMMAND,
    queued_by: str = "",
) -> None:
    did = _norm_device_id(device_id)
    if not did:
        return
    try:
        device_ops_repo.queue_command(
            device_id=did,
            customer=(customer or "-").strip() or "-",
            command=(command or REMOTE_RESET_COMMAND).strip() or REMOTE_RESET_COMMAND,
            queued_by=queued_by,
            queued_via="system",
        )
    except Exception:
        pass


def _clear_remote_reset(device_id: str = "", command_id: int = 0, ok: bool = True, result_message: str = "") -> None:
    did = _norm_device_id(device_id)
    if not did or int(command_id or 0) <= 0:
        return
    try:
        device_ops_repo.complete_command(
            command_id=int(command_id),
            device_id=did,
            ok=ok,
            result_message=result_message,
        )
    except Exception:
        pass


def _apply_runtime_reset_cache(key: str) -> None:
    if not key:
        return
    st = _DEVICE_STATE.get(key)
    if st:
        st["parse_ok"] = False
        st["power"] = "-"
        st["time_sec"] = "-"
        st["line"] = ""
        st["used_energy_j"] = 0
        _DEVICE_STATE[key] = st
    _DEVICE_LOGS[key] = []
    _LAST_RUNTIME_LOG.pop(key, None)


def _apply_runtime_subscription_reset_cache(key: str) -> None:
    if not key:
        return
    st = _DEVICE_STATE.get(key)
    if not st:
        return
    st["used_energy_j"] = 0
    _DEVICE_STATE[key] = st


def _pending_remote_command(device_id: str = "", ip: str = "", customer: str = "-") -> dict[str, str] | None:
    did = _norm_device_id(device_id)
    if not did:
        try:
            rec = device_repo.get_device_by_ip_customer((ip or "").strip(), (customer or "-").strip() or "-")
        except Exception:
            rec = None
        did = _norm_device_id(str((rec or {}).get("device_id") or ""))
    if not did:
        return None
    try:
        pending = device_ops_repo.peek_pending_command(device_id=did)
    except Exception:
        pending = None
    return pending


def _send_remote_command(ip: str, command: str, timeout_sec: float = REMOTE_RESET_TIMEOUT_SEC) -> bool:
    ip = (ip or "").strip()
    command = (command or "").strip()
    if not ip or not command:
        return False
    try:
        with socket.create_connection((ip, DEVICE_TCP_PORT), timeout=timeout_sec) as sock:
            sock.settimeout(timeout_sec)
            try:
                sock.recv(256)
            except Exception:
                pass
            sock.sendall((command + "\r\n").encode("utf-8", errors="replace"))
            try:
                sock.recv(256)
            except Exception:
                pass
        print(f"[RESET] remote command ok ip={ip} cmd={command}")
        return True
    except Exception as e:
        print(f"[RESET] remote command fail ip={ip} cmd={command} err={e}")
        return False


def _send_remote_reset(ip: str, timeout_sec: float = REMOTE_RESET_TIMEOUT_SEC) -> bool:
    return _send_remote_command(ip, REMOTE_RESET_COMMAND, timeout_sec=timeout_sec)


def _send_remote_subscription_reset(ip: str, timeout_sec: float = REMOTE_RESET_TIMEOUT_SEC) -> bool:
    return _send_remote_command(ip, REMOTE_SUBSCRIPTION_RESET_COMMAND, timeout_sec=timeout_sec)


def _maybe_remote_reset_pending(device_id: str = "", ip: str = "", customer: str = "-", runtime_key: str = "") -> bool:
    return _pending_remote_command(device_id=device_id, ip=ip, customer=customer) is not None


def _status_of(now: datetime, last_seen: datetime | None, parse_ok: bool) -> str:
    if not last_seen:
        return "Offline"
    if (now - last_seen).total_seconds() > ONLINE_WINDOW_SEC:
        return "Offline"
    return "Online" if parse_ok else "Error"



def _prune_runtime_cache(now: datetime) -> None:
    """오래된 런타임 캐시 정리(ghost device 방지)."""
    try:
        items = list(_DEVICE_STATE.items())
    except Exception:
        return

    for k, st in items:
        try:
            last_seen_dt = st.get("last_seen")
        except Exception:
            last_seen_dt = None
        if not last_seen_dt:
            continue
        try:
            age = (now - last_seen_dt).total_seconds()
        except Exception:
            continue
        if age <= PRUNE_RUNTIME_SEC:
            continue

        token = str(st.get("token") or "").strip()
        device_id = str(st.get("device_id") or "").strip()
        ip = str(st.get("ip") or "").strip()
        customer = str(st.get("customer") or "-").strip() or "-"

        _DEVICE_STATE.pop(k, None)
        _DEVICE_LOGS.pop(k, None)
        _LAST_RUNTIME_LOG.pop(k, None)

        if device_id and _DEVICEID_TO_KEY.get(device_id) == k:
            _DEVICEID_TO_KEY.pop(device_id, None)
        if ip and _IP_CUSTOMER_TO_KEY.get((customer, ip)) == k:
            _IP_CUSTOMER_TO_KEY.pop((customer, ip), None)


def _migrate_device_state_customer(token: str, new_customer: str) -> None:
    """token 기반으로 런타임 상태의 customer 변경(거래처 변경 직후 Offline 고정 방지).

    - token이 여러 디바이스에 공유될 수 있으므로(단일 토큰 모드), 동일 token을 가진 모든 상태를 이동합니다.
    """
    token = (token or "").strip()
    new_customer = (new_customer or "-").strip() or "-"
    if not token:
        return

    for key, st in list(_DEVICE_STATE.items()):
        if str(st.get("token") or "").strip() != token:
            continue

        old_customer = str(st.get("customer") or "-").strip() or "-"
        if old_customer == new_customer:
            continue

        device_id = str(st.get("device_id") or "").strip()
        ip = str(st.get("ip") or "").strip()
        new_key = _device_key(new_customer, device_id, ip)

        st["customer"] = new_customer

        if new_key == key:
            if device_id:
                _DEVICEID_TO_KEY[device_id] = key
            if ip:
                _IP_CUSTOMER_TO_KEY.pop((old_customer, ip), None)
                _IP_CUSTOMER_TO_KEY[(new_customer, ip)] = key
            continue

        # move state
        _DEVICE_STATE.pop(key, None)
        _DEVICE_STATE[new_key] = st

        logs = _DEVICE_LOGS.pop(key, None)
        if logs is not None:
            _DEVICE_LOGS[new_key] = logs
        last_log = _LAST_RUNTIME_LOG.pop(key, None)
        if last_log is not None:
            _LAST_RUNTIME_LOG[new_key] = last_log

        if device_id:
            _DEVICEID_TO_KEY[device_id] = new_key

        if ip:
            _IP_CUSTOMER_TO_KEY.pop((old_customer, ip), None)
            _IP_CUSTOMER_TO_KEY[(new_customer, ip)] = new_key


def _customers_from_saved(saved: list[dict[str, str]]) -> list[str]:
    out = sorted({(d.get("customer") or "-").strip() or "-" for d in saved})
    return out



@router.get("/", name="dashboard")
def dashboard(request: Request):
    # DB 기반: 저장된 디바이스 + 런타임 상태, 서버 로그, 업로드 데이터(행) 통계
    payload = _build_device_status_payload("")
    devices = payload.get("devices") or []
    counts = payload.get("counts") or {}

    # count_today_rows() returns a dict: {procedure, survey, total}
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


def _get_local_ipv4_for_broadcast() -> str:
    """UDP 브로드캐스트 대상 계산을 위한 로컬 IPv4 추정.

    - Windows/일반 환경에서 가장 흔한 방식: UDP 소켓을 외부 주소로 connect하여
      OS가 선택한 로컬 NIC의 IP를 얻습니다(실제 패킷 전송 없음).
    """
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        try:
            s.close()
        except Exception:
            pass
        return ""


def _guess_broadcast_addrs(local_ip: str) -> list[str]:
    addrs = {"255.255.255.255"}
    try:
        parts = (local_ip or "").split(".")
        if len(parts) == 4:
            addrs.add(".".join(parts[:3] + ["255"]))  # 흔한 /24
    except Exception:
        pass
    return sorted(addrs)


def _prune_discovery_cache(now: datetime) -> None:
    try:
        items = list(_DISCOVERY_CACHE.items())
    except Exception:
        return
    for k, d in items:
        try:
            last_seen_dt = d.get("last_seen_dt")
        except Exception:
            last_seen_dt = None
        if not last_seen_dt:
            continue
        try:
            age = (now - last_seen_dt).total_seconds()
        except Exception:
            continue
        if age > DISCOVERY_TTL_SEC:
            _DISCOVERY_CACHE.pop(k, None)


def _udp_discover_devices(timeout_sec: float = None) -> list[dict[str, Any]]:
    """UDP discovery(4210)로 동일 네트워크의 ESP32 탐색.

    - UI의 "찾기" 버튼이 호출하는 /api/devices/discovered 에서 사용.
    - 최소 변경 원칙: 기존 라우팅은 그대로 두고, 내부 로직만 UDP 브로드캐스트 방식으로 보강.
    """
    if not ENABLE_LAN_DISCOVERY:
        return []

    timeout = float(timeout_sec if timeout_sec is not None else UDP_DISCOVERY_TIMEOUT_SEC)
    timeout = max(0.5, min(timeout, 6.0))

    now = datetime.now()

    local_ip = _get_local_ipv4_for_broadcast()
    bcast_addrs = _guess_broadcast_addrs(local_ip)
    print(f"[DISCOVERY] start: local_ip={local_ip or '-'} addrs={bcast_addrs} port={UDP_DISCOVERY_PORT} timeout={timeout:.1f}s")

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    except Exception:
        pass

    try:
        sock.bind(("", 0))  # source port: ephemeral (ESP32가 이 포트로 응답)
    except Exception:
        sock.bind(("0.0.0.0", 0))

    try:
        sock.settimeout(0.25)
    except Exception:
        pass

    payload = (UDP_DISCOVERY_MAGIC or "").encode("utf-8")
    for addr in bcast_addrs:
        try:
            sock.sendto(payload, (addr, UDP_DISCOVERY_PORT))
        except Exception as e:
            print(f"[DISCOVERY] send fail -> {addr}:{UDP_DISCOVERY_PORT} err={e}")

    found: dict[str, dict[str, Any]] = {}
    t_end = time.time() + timeout
    while time.time() < t_end:
        try:
            data, (rip, _rport) = sock.recvfrom(512)
        except socket.timeout:
            continue
        except Exception as e:
            print(f"[DISCOVERY] recv error: {e}")
            break

        msg = ""
        try:
            msg = data.decode("utf-8", errors="ignore").strip()
        except Exception:
            continue
        if not msg.startswith(UDP_DISCOVERY_REPLY_PREFIX):
            continue

        parts = [p.strip() for p in msg.split("|")]
        # 기대 포맷:
        #   FOR_RND_DEVICE|<name/model>|<ip>|<tcp_port>|<device_id(MAC)>|<token(optional)>
        name = parts[1] if len(parts) > 1 else ""
        ip = parts[2] if len(parts) > 2 else (rip or "")
        tcp_port = parts[3] if len(parts) > 3 else ""
        device_id = parts[4] if len(parts) > 4 else ""
        # token: ESP32가 생성한 고유 랜덤값(없으면 빈 값)
        token = parts[5] if len(parts) > 5 else ""
        customer = "-"
        key = device_id or ip or (rip or "")
        if not key:
            key = secrets.token_hex(4)

        item = {
            "name": name,
            "ip": ip,
            "tcp_port": tcp_port,
            "device_id": device_id,
            "token": token,
            "customer": customer,
        }
        found[key] = item
        _DISCOVERY_CACHE[key] = {**item, "last_seen_dt": now}
        print(f"[DISCOVERY] recv: name={name} ip={ip} port={tcp_port} device_id={device_id} token={(token[:8] + '...' if token else '')}")

    try:
        sock.close()
    except Exception:
        pass

    _prune_discovery_cache(now)
    print(f"[DISCOVERY] done: {len(found)} device(s)")
    return list(found.values())


def _build_device_status_payload(selected_customer: str = "") -> dict[str, Any]:
    """device-status 페이지와 폴링 API에서 공용으로 쓰는 데이터 생성."""
    now = datetime.now()
    _prune_runtime_cache(now)
    selected_customer = (selected_customer or "").strip()

    saved = _load_saved_devices()
    customers = _customers_from_saved(saved)

    devices: list[dict[str, Any]] = []
    online_cnt = 0
    offline_cnt = 0
    active_sub_cnt = 0
    expired_sub_cnt = 0

    for row in saved:
        ip = row.get("ip") or ""
        customer = row.get("customer") or "-"
        name = row.get("name") or ip
        token = str(row.get("token") or "").strip()
        device_id = _norm_device_id(str(row.get("device_id") or "").strip())
        last_public_ip = str(row.get("last_public_ip") or "").strip()
        last_fw = str(row.get("last_fw") or "").strip()

        key = None
        st = None

        # (우선) device_id(MAC 등) 기반으로 상태 매칭 (표시명/거래처 수정, IP 변경에도 안정)
        if device_id:
            key = _DEVICEID_TO_KEY.get(device_id)
            st = _DEVICE_STATE.get(key or "") if key else None

        if not st and device_id:
            for _k, _st in list(_DEVICE_STATE.items()):
                if str(_st.get("device_id") or "").strip() == device_id:
                    st = _st
                    key = _k
                    _DEVICEID_TO_KEY[device_id] = _k
                    break

        # (보강) token 기반 매칭: ESP32가 MAC(device_id)을 못 보내는 구성에서도
        # name/customer를 임의 수정해도 Online/Offline 매칭이 깨지지 않도록 한다.
        # - 기존 구형 데이터는 device_id가 비어있을 수 있음
        # - 이 경우 customer+ip 매칭에 의존하면 customer 변경 시 Offline으로 보이는 문제가 발생
        if not st and token:
            key = _TOKEN_TO_KEY.get(token)
            st = _DEVICE_STATE.get(key or "") if key else None

        if not st and token:
            for _k, _st in list(_DEVICE_STATE.items()):
                if str(_st.get("token") or "").strip() == token:
                    st = _st
                    key = _k
                    _TOKEN_TO_KEY[token] = _k
                    # device_id를 뒤늦게 알게 된 경우 MAC 매핑도 보강
                    try:
                        dev = str(_st.get("device_id") or "").strip()
                        if dev:
                            _DEVICEID_TO_KEY[dev] = _k
                    except Exception:
                        pass
                    break

        # (fallback) ip/customer로 매칭(구형 호환)
        if not st and ip:
            key = _IP_CUSTOMER_TO_KEY.get((customer, ip))
            st = _DEVICE_STATE.get(key or "") if key else None

        # (보완) 서버 재시작/매핑 누락 등으로 key가 없을 때, ip/customer로 한번 더 찾기
        if not st and ip:
            for _k, _st in list(_DEVICE_STATE.items()):
                if str(_st.get("ip") or "") == ip and str(_st.get("customer") or "-") == customer:
                    st = _st
                    key = _k
                    _IP_CUSTOMER_TO_KEY[(customer, ip)] = _k
                    break

        last_seen_dt: datetime | None = None
        parse_ok = False
        power = "-"
        time_sec = "-"
        last_line = ""
        sd_inserted = False
        sd_total_mb = 0.0
        sd_used_mb = 0.0
        sd_free_mb = 0.0

        if st:
            ip = str(st.get("ip") or ip)
            last_seen_dt = st.get("last_seen")
            parse_ok = bool(st.get("parse_ok", False))
            power = str(st.get("power") or "-")
            time_sec = str(st.get("time_sec") or "-")
            last_line = str(st.get("line") or "")
            sd_inserted = _payload_bool(st.get("sd_inserted"), False)
            sd_total_mb = _payload_mb(st.get("sd_total_mb"), 0.0)
            sd_used_mb = _payload_mb(st.get("sd_used_mb"), 0.0)
            sd_free_mb = _payload_mb(st.get("sd_free_mb"), 0.0)
            last_public_ip = str(st.get("last_public_ip") or last_public_ip).strip()
            last_fw = str(st.get("fw") or last_fw).strip()
        else:
            last_seen_dt = _parse_runtime_dt(row.get("last_seen_at"))
            parse_ok = _payload_bool(row.get("last_parse_ok"), True)
            power = str(row.get("last_power") or "-")
            time_sec = str(row.get("last_time_sec") or "-")
            last_line = str(row.get("last_line") or "")
            sd_inserted = _payload_bool(row.get("sd_inserted"), False)
            sd_total_mb = _payload_mb(row.get("sd_total_mb"), 0.0)
            sd_used_mb = _payload_mb(row.get("sd_used_mb"), 0.0)
            sd_free_mb = _payload_mb(row.get("sd_free_mb"), 0.0)

        if sd_inserted:
            if sd_total_mb <= 0.0 and (sd_used_mb > 0.0 or sd_free_mb > 0.0):
                sd_total_mb = sd_used_mb + sd_free_mb
            if sd_total_mb > 0.0:
                if sd_used_mb > sd_total_mb:
                    sd_used_mb = sd_total_mb
                sd_free_mb = max(sd_total_mb - sd_used_mb, 0.0)
            sd_used_pct = (sd_used_mb / sd_total_mb * 100.0) if sd_total_mb > 0.0 else 0.0
            if sd_used_pct < 0.0:
                sd_used_pct = 0.0
            if sd_used_pct > 100.0:
                sd_used_pct = 100.0
        else:
            sd_total_mb = 0.0
            sd_used_mb = 0.0
            sd_free_mb = 0.0
            sd_used_pct = 0.0

        status = _status_of(now, last_seen_dt, parse_ok)
        if status == "Online":
            online_cnt += 1
        elif status == "Offline":
            offline_cnt += 1

        sub_status_kor = str(row.get("subscription_status") or "만료")
        if sub_status_kor == "활성":
            active_sub_cnt += 1
        else:
            expired_sub_cnt += 1

        if selected_customer and customer != selected_customer:
            continue

        devices.append(
            {
                "name": name,
                "status": status,
                "last_seen": _fmt(last_seen_dt) if last_seen_dt else "-",
                "plan_status": _subscription_status_code(sub_status_kor),
                "plan_expiry": str(row.get("subscription_expiry_date") or "-"),
                "ip": ip,
                "last_public_ip": last_public_ip,
                "customer": customer,
                "token": token,
                "device_id": device_id,
                "fw": last_fw or "-",
                "power": power,
                "time_sec": time_sec,
                "last_log": last_line,
                "sd_inserted": sd_inserted,
                "sd_total_mb": round(sd_total_mb, 2),
                "sd_used_mb": round(sd_used_mb, 2),
                "sd_free_mb": round(sd_free_mb, 2),
                "sd_total_label": _format_capacity_label(sd_total_mb) if sd_inserted else "-",
                "sd_used_label": _format_capacity_label(sd_used_mb) if sd_inserted else "-",
                "sd_free_label": _format_capacity_label(sd_free_mb) if sd_inserted else "-",
                "sd_used_percent": round(sd_used_pct, 1),
            }
        )

    counts = {
        "total": len(saved),
        "online": online_cnt,
        "offline": offline_cnt,
        "expired": expired_sub_cnt,
        "restricted": 0,
        "active": active_sub_cnt,
    }

    return {"ok": True, "devices": devices, "counts": counts, "customers": customers}


@router.get("/api/device-status")
def api_device_status(customer: str = ""):
    """디바이스 목록(Online/Offline 등) 폴링용 API."""
    payload = _build_device_status_payload(customer)
    return payload



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
    # 저장된 디바이스 리스트 기반으로 데이터 조회 UI 제공
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
    family_value = _sanitize_firmware_token(family, FIRMWARE_FAMILY_DEFAULT)
    version_value = _sanitize_firmware_token(version)
    build_value = _sanitize_firmware_token(build_id, "build")
    if not version_value:
        raise HTTPException(status_code=400, detail="version required")

    filename = str(firmware_file.filename or "firmware.bin").strip() or "firmware.bin"
    if not filename.lower().endswith(".bin"):
        raise HTTPException(status_code=400, detail="firmware file must be .bin")

    raw = await firmware_file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="firmware file required")
    if len(raw) > FIRMWARE_MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"firmware exceeds OTA slot limit ({len(raw)} > {FIRMWARE_MAX_UPLOAD_BYTES} bytes)",
        )

    sha256 = hashlib.sha256(raw).hexdigest()
    release_ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    target_dir = os.path.join(FIRMWARE_STORAGE_DIR, family_value)
    os.makedirs(target_dir, exist_ok=True)
    stored_name = f"{family_value}__{version_value}__{build_value}__{release_ts}.bin"
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
    # [NEW FEATURE] Incoming assigned energy from plan modal payload.
    energy_j_payload = payload.get("energyJ")
    if plan != "Test Plan":
        custom_duration = None
    # [NEW FEATURE] Test Plan uses manual integer, fixed plans use server-side constants.
    if plan == "Test Plan":
        try:
            assigned_energy_j = int(energy_j_payload)
        except Exception as e:
            raise HTTPException(status_code=400, detail="energyJ required for Test Plan") from e
    else:
        assigned_energy_j = int(SUB_PLAN_FIXED_ENERGY_J.get(plan, 0))

    try:
        rec = device_repo.grant_subscription(device_id, plan, custom_duration, assigned_energy_j)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not rec:
        raise HTTPException(status_code=404, detail="device not found")

    return {"ok": True, **_subscription_response_or_default(device_id)}


@router.post("/api/devices/{device_id}/subscription/revoke")
def api_device_subscription_revoke(device_id: str):
    did = _norm_device_id(device_id)
    try:
        rec = device_repo.revoke_subscription(did)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

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


# ==============================================================
# API: ESP32 자동 등록 + 텔레메트리 + UI 헬퍼
# ==============================================================
# - ESP32: /api/device/register, /api/device/telemetry 로 POST
# - 웹 UI:  /api/devices/saved, /api/devices/discovered, /api/device/tail 등 활용


@router.get("/api/device/ping")
def api_device_ping():
    # ESP32 connectivity probe (auth middleware already allows /api/device/*)
    return {"ok": True, "polling": _device_polling_policy()}


@router.get("/api/device/registered")
def api_device_registered(request: Request, device_id: str = ""):
    did = _norm_device_id(device_id)
    if not did:
        raise HTTPException(status_code=400, detail="device_id required")

    token = _extract_auth_token(request, {})
    rec = device_repo.get_device_by_device_id(did)
    if not _request_user_id(request):
        if not token:
            raise HTTPException(status_code=401, detail="device token required")
        if rec:
            _device_record_or_403(did, token)

    rec = device_repo.get_device_by_device_id(did)
    payload = {"ok": True, "registered": bool(rec), "device_id": did}
    payload.update(_device_api_meta(did, str((rec or {}).get("ip") or ""), str((rec or {}).get("customer") or "-")))
    return payload


@router.get("/api/device/ota/check")
def api_device_ota_check(request: Request, device_id: str = ""):
    did = _norm_device_id(device_id)
    token = _extract_auth_token(request, {})
    if not did:
        raise HTTPException(status_code=400, detail="device_id required")
    _device_record_or_403(did, token)

    firmware_repo.record_device_check(device_id=did)
    info = firmware_repo.get_target_release_for_device(device_id=did) or {}

    current_family = str(info.get("current_family") or "").strip()
    current_version = str(info.get("current_version") or "").strip()
    current_build_id = str(info.get("current_build_id") or "").strip()
    current_fw_text = str(info.get("current_fw_text") or "").strip()
    target_release_id = int(info.get("target_release_id") or 0)
    target_family = str(info.get("target_family") or "").strip()
    target_version = str(info.get("target_version") or "").strip()
    target_build_id = str(info.get("target_build_id") or "").strip()
    file_path = str(info.get("file_path") or "").strip()
    enabled = bool(info.get("is_enabled"))
    file_ready = bool(file_path and os.path.exists(file_path))

    same_release = (
        bool(current_family and target_family and current_version and target_version)
        and current_family == target_family
        and current_version == target_version
        and ((not target_build_id) or (current_build_id == target_build_id))
    )
    update_available = bool(target_release_id > 0 and enabled and file_ready and not same_release)

    if same_release and target_release_id > 0:
        firmware_repo.report_device_ota(
            device_id=did,
            state="up_to_date",
            message="current firmware already matches assigned release",
            release_id=target_release_id,
            current_family=current_family,
            current_version=current_version,
            current_build_id=current_build_id,
            current_fw_text=current_fw_text,
        )

    payload = {
        "ok": True,
        "device_id": did,
        "update_available": update_available,
        "current": {
            "family": current_family,
            "version": current_version,
            "build_id": current_build_id,
            "fw": current_fw_text,
        },
        "polling": _device_polling_policy(),
    }

    if update_available:
        payload["release"] = {
            "release_id": target_release_id,
            "release_family": target_family,
            "release_version": target_version,
            "release_build_id": target_build_id,
            "release_sha256": str(info.get("sha256") or "").strip().lower(),
            "release_size_bytes": int(info.get("size_bytes") or 0),
            "release_force_update": bool(info.get("force_update")),
            "release_download_path": _release_download_path(target_release_id),
        }

    return payload


@router.get("/api/device/ota/download/{release_id}")
def api_device_ota_download(request: Request, release_id: int, device_id: str = ""):
    did = _norm_device_id(device_id)
    token = _extract_auth_token(request, {})
    if not did:
        raise HTTPException(status_code=400, detail="device_id required")
    _device_record_or_403(did, token)

    info = firmware_repo.get_target_release_for_device(device_id=did) or {}
    target_release_id = int(info.get("target_release_id") or 0)
    file_path = str(info.get("file_path") or "").strip()
    filename = str(info.get("filename") or "").strip() or "firmware.bin"

    if int(release_id or 0) <= 0 or target_release_id != int(release_id):
        raise HTTPException(status_code=404, detail="release not assigned")
    if not bool(info.get("is_enabled")):
        raise HTTPException(status_code=409, detail="release disabled")
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="firmware file not found")

    return FileResponse(file_path, media_type="application/octet-stream", filename=filename)


@router.post("/api/device/ota/report")
def api_device_ota_report(request: Request, payload: dict[str, Any] = Body(...)):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid payload")

    token, device_id, rec = _require_device_identity(request, payload)
    _ = token
    customer = _auth_customer(request, payload) or str((rec or {}).get("customer") or "-")
    public_ip = _request_client_ip(request)
    ip = str(payload.get("ip") or "").strip() or public_ip or str((rec or {}).get("ip") or "")
    state = str(payload.get("state") or "").strip().lower()
    if not state:
        raise HTTPException(status_code=400, detail="state required")
    message = str(payload.get("message") or payload.get("result_message") or "").strip()
    try:
        release_id = int(payload.get("release_id") or 0)
    except Exception:
        release_id = 0

    family, version, build_id, fw_display = _extract_firmware_fields(payload)
    if not fw_display or fw_display == "-":
        fw_display = _format_firmware_identity(family, version, build_id)

    firmware_repo.report_device_ota(
        device_id=device_id,
        customer=customer,
        device_name=str((rec or {}).get("name") or device_id),
        ip=ip,
        state=state,
        message=message,
        release_id=release_id,
        current_family=family,
        current_version=version,
        current_build_id=build_id,
        current_fw_text=fw_display,
    )
    return {"ok": True, "device_id": device_id, "state": state}


@router.post("/api/device/register")
def api_device_register(request: Request, payload: dict[str, Any] = Body(...)):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid payload")

    token, device_id, _ = _require_device_identity(request, payload)
    customer = _auth_customer(request, payload)
    public_ip = _request_client_ip(request)
    ip = str(payload.get("ip") or "").strip() or public_ip
    fw_family, fw_version, fw_build_id, fw = _extract_firmware_fields(payload)
    name = str(payload.get("name") or payload.get("model") or device_id).strip() or device_id
    now = datetime.now()

    key = _device_key(customer, device_id, ip)

    st = _DEVICE_STATE.get(key) or {}
    prev_last_seen = st.get("last_seen")
    sd_inserted, sd_total_mb, sd_used_mb, sd_free_mb = _merge_sd_payload(payload, st)
    used_energy_j = _payload_int(payload.get("used_energy_j"), _payload_int(payload.get("usedEnergyJ"), _payload_int(st.get("used_energy_j"), 0)))
    st["customer"] = customer
    st["token"] = token
    st["device_id"] = device_id
    st["ip"] = ip
    st["last_public_ip"] = public_ip
    st["fw"] = fw or st.get("fw") or "-"
    st["last_seen"] = now
    st.setdefault("power", "-")
    st.setdefault("time_sec", "-")
    st.setdefault("line", "")
    if str(st.get("line") or "").strip():
        st.setdefault("parse_ok", True)
    else:
        st["parse_ok"] = True
    st["sd_inserted"] = sd_inserted
    st["sd_total_mb"] = sd_total_mb
    st["sd_used_mb"] = sd_used_mb
    st["sd_free_mb"] = sd_free_mb
    st["used_energy_j"] = used_energy_j
    _DEVICE_STATE[key] = st

    if device_id:
        _DEVICEID_TO_KEY[device_id] = key

    if token:
        _TOKEN_TO_KEY[token] = key

    if ip:
        _IP_CUSTOMER_TO_KEY[(customer, ip)] = key

    # 연결 상태 로그(의미있는 상태 중심, 최소 추가)
    try:
        was_offline = (prev_last_seen is None) or ((now - prev_last_seen).total_seconds() > (ONLINE_WINDOW_SEC * 2))
    except Exception:
        was_offline = True
    if was_offline:
        msg = f"연결완료 IP={ip}" if not prev_last_seen else f"재연결 IP={ip}"
        _append_device_runtime_log(
            key,
            device_id=device_id,
            customer=customer,
            ip=ip,
            when=now,
            line=msg,
            source="register",
        )

    try:
        device_repo.register_device(
            name=name,
            ip=ip,
            customer=customer,
            token=token,
            device_id=device_id,
            public_ip=public_ip,
            fw=fw,
            sd_inserted=sd_inserted,
            sd_total_mb=sd_total_mb,
            sd_used_mb=sd_used_mb,
            sd_free_mb=sd_free_mb,
            used_energy_j=used_energy_j,
        )
    except ValueError as e:
        detail = str(e)
        status_code = 403 if ("invalid device token" in detail or "device not provisioned" in detail) else 400
        raise HTTPException(status_code=status_code, detail=detail) from e
    try:
        firmware_repo.touch_device_state(
            device_id=device_id,
            customer=customer,
            device_name=name,
            ip=ip,
            current_family=fw_family,
            current_version=fw_version,
            current_build_id=fw_build_id,
            current_fw_text=fw,
        )
    except Exception:
        pass

    body = {"ok": True, "customer": customer, "registered": True, "device_id": device_id}
    body.update(_device_api_meta(device_id, ip, customer))
    body["subscription"] = _subscription_response_or_default(device_id)
    return JSONResponse(body)


@router.post("/api/device/heartbeat")
def api_device_heartbeat(request: Request, payload: dict[str, Any] = Body(...)):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid payload")

    token, device_id, _ = _require_device_identity(request, payload)
    customer = _auth_customer(request, payload)
    public_ip = _request_client_ip(request)
    ip = str(payload.get("ip") or "").strip() or public_ip
    fw_family, fw_version, fw_build_id, fw = _extract_firmware_fields(payload)
    name = str(payload.get("name") or payload.get("model") or device_id).strip() or device_id
    now = datetime.now()

    key = _device_key(customer, device_id, ip)
    st = _DEVICE_STATE.get(key) or {}
    sd_inserted, sd_total_mb, sd_used_mb, sd_free_mb = _merge_sd_payload(payload, st)
    used_energy_j = _payload_int(payload.get("used_energy_j"), _payload_int(payload.get("usedEnergyJ"), _payload_int(st.get("used_energy_j"), 0)))
    st["customer"] = customer
    st["token"] = token
    st["device_id"] = device_id
    st["ip"] = ip
    st["last_public_ip"] = public_ip
    st["fw"] = fw or st.get("fw") or "-"
    st["last_seen"] = now
    st.setdefault("power", "-")
    st.setdefault("time_sec", "-")
    st.setdefault("line", "")
    if str(st.get("line") or "").strip():
        st.setdefault("parse_ok", True)
    else:
        st["parse_ok"] = True
    st["sd_inserted"] = sd_inserted
    st["sd_total_mb"] = sd_total_mb
    st["sd_used_mb"] = sd_used_mb
    st["sd_free_mb"] = sd_free_mb
    st["used_energy_j"] = used_energy_j
    _DEVICE_STATE[key] = st

    if device_id:
        _DEVICEID_TO_KEY[device_id] = key
    if token:
        _TOKEN_TO_KEY[token] = key
    if ip:
        _IP_CUSTOMER_TO_KEY[(customer, ip)] = key

    try:
        device_repo.record_device_heartbeat(
            name=name,
            ip=ip,
            customer=customer,
            token=token,
            device_id=device_id,
            public_ip=public_ip,
            fw=fw,
            sd_inserted=sd_inserted,
            sd_total_mb=sd_total_mb,
            sd_used_mb=sd_used_mb,
            sd_free_mb=sd_free_mb,
            used_energy_j=used_energy_j,
        )
    except ValueError as e:
        detail = str(e)
        status_code = 403 if ("invalid device token" in detail or "device not provisioned" in detail) else 400
        raise HTTPException(status_code=status_code, detail=detail) from e
    try:
        firmware_repo.touch_device_state(
            device_id=device_id,
            customer=customer,
            device_name=name,
            ip=ip,
            current_family=fw_family,
            current_version=fw_version,
            current_build_id=fw_build_id,
            current_fw_text=fw,
        )
    except Exception:
        pass

    body = {"ok": True, "device_id": device_id}
    body.update(_device_api_meta(device_id, ip, customer))
    return JSONResponse(body)


@router.post("/api/device/telemetry")
def api_device_telemetry(request: Request, payload: dict[str, Any] = Body(...)):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid payload")

    token, device_id, _ = _require_device_identity(request, payload)
    customer = _auth_customer(request, payload)
    public_ip = _request_client_ip(request)
    ip = str(payload.get("ip") or "").strip() or public_ip
    fw_family, fw_version, fw_build_id, fw = _extract_firmware_fields(payload)
    name = str(payload.get("name") or payload.get("model") or device_id).strip() or device_id

    line = payload.get("line")
    if line is None:
        line = ""
    line = str(line)

    power = str(payload.get("power") or "-")
    time_sec = str(payload.get("time_sec") or "-")
    idle_measurement = _is_idle_measurement(line=line, power=power, time_sec=time_sec)
    if idle_measurement:
        power = "-"
        time_sec = "-"
        line = ""

    now = datetime.now()

    # 최소 포맷 검사: line에 콤마가 없으면 Error로 판정(Online window 안에서)
    parse_ok = True if idle_measurement else (bool(line) and ("," in line))

    key = _device_key(customer, device_id, ip)

    st = _DEVICE_STATE.get(key) or {}
    prev_last_seen = st.get("last_seen")
    sd_inserted, sd_total_mb, sd_used_mb, sd_free_mb = _merge_sd_payload(payload, st)
    used_energy_j = _payload_int(payload.get("used_energy_j"), _payload_int(payload.get("usedEnergyJ"), _payload_int(st.get("used_energy_j"), 0)))
    st["customer"] = customer
    st["token"] = token
    st["device_id"] = device_id
    st["ip"] = ip
    st["last_public_ip"] = public_ip
    st["fw"] = fw or st.get("fw") or "-"
    st["last_seen"] = now
    st["parse_ok"] = parse_ok
    st["power"] = power or "-"
    st["time_sec"] = time_sec or "-"
    st["line"] = line
    st["sd_inserted"] = sd_inserted
    st["sd_total_mb"] = sd_total_mb
    st["sd_used_mb"] = sd_used_mb
    st["sd_free_mb"] = sd_free_mb
    st["used_energy_j"] = used_energy_j
    _DEVICE_STATE[key] = st

    if device_id:
        _DEVICEID_TO_KEY[device_id] = key

    if token:
        _TOKEN_TO_KEY[token] = key

    if ip:
        _IP_CUSTOMER_TO_KEY[(customer, ip)] = key

    if line:
        _append_device_runtime_log(
            key,
            device_id=device_id,
            customer=customer,
            ip=ip,
            when=now,
            line=line,
            source="telemetry",
        )

    try:
        device_repo.record_device_telemetry(
            name=name,
            ip=ip,
            customer=customer,
            token=token,
            device_id=device_id,
            public_ip=public_ip,
            fw=fw,
            parse_ok=parse_ok,
            power=power,
            time_sec=time_sec,
            line=line,
            sd_inserted=sd_inserted,
            sd_total_mb=sd_total_mb,
            sd_used_mb=sd_used_mb,
            sd_free_mb=sd_free_mb,
            used_energy_j=used_energy_j,
        )
    except ValueError as e:
        detail = str(e)
        status_code = 403 if ("invalid device token" in detail or "device not provisioned" in detail) else 400
        raise HTTPException(status_code=status_code, detail=detail) from e
    try:
        firmware_repo.touch_device_state(
            device_id=device_id,
            customer=customer,
            device_name=name,
            ip=ip,
            current_family=fw_family,
            current_version=fw_version,
            current_build_id=fw_build_id,
            current_fw_text=fw,
        )
    except Exception:
        pass

    body = {"ok": True, "device_id": device_id}
    body.update(_device_api_meta(device_id, ip, customer))
    return JSONResponse(body)


@router.post("/api/device/command-ack")
def api_device_command_ack(request: Request, payload: dict[str, Any] = Body(...)):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid payload")

    token, device_id, _ = _require_device_identity(request, payload)
    customer = _auth_customer(request, payload)
    ip = str(payload.get("ip") or "").strip()
    command = str(payload.get("command") or "").strip()
    command_id = _payload_int(payload.get("command_id"), 0)
    ok = _payload_bool(payload.get("ok"), True)
    result_message = str(payload.get("result_message") or "").strip()

    if not command:
        raise HTTPException(status_code=400, detail="command required")
    if command_id <= 0:
        raise HTTPException(status_code=400, detail="command_id required")

    pending = _pending_remote_command(device_id=device_id, ip=ip, customer=customer)
    if pending and int(pending.get("id") or 0) == command_id and str(pending.get("command") or "").strip() == command:
        _clear_remote_reset(
            device_id=device_id or str(pending.get("device_id") or ""),
            command_id=command_id,
            ok=ok,
            result_message=result_message,
        )
    else:
        _clear_remote_reset(device_id=device_id, command_id=command_id, ok=ok, result_message=result_message)

    if ok:
        runtime_key = _resolve_runtime_key(customer, ip, device_id, token)
        if command == REMOTE_RESET_COMMAND:
            _apply_runtime_reset_cache(runtime_key or "")
        elif command == REMOTE_SUBSCRIPTION_RESET_COMMAND:
            _apply_runtime_subscription_reset_cache(runtime_key or "")
            try:
                device_repo.reset_used_energy(device_id)
            except ValueError:
                pass

    runtime_key = _resolve_runtime_key(customer, ip, device_id, token) or _device_key(customer, device_id, ip)
    _append_device_runtime_log(
        runtime_key,
        device_id=device_id,
        customer=customer,
        ip=ip,
        when=datetime.now(),
        line=f"[CMD] {'ACK' if ok else 'FAIL'} #{command_id} {command}{(' - ' + result_message) if result_message else ''}",
        level="info" if ok else "warning",
        source="command",
    )

    return {"ok": True}


@router.post("/api/device/log-upload")
def api_device_log_upload(request: Request, payload: dict[str, Any] = Body(...)):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid payload")

    _token, device_id, _rec = _require_device_identity(request, payload)
    kind_key, _command, default_filename = _normalize_sd_log_kind(str(payload.get("kind") or "activity"))
    try:
        chunk_index = int(str(payload.get("chunk_index")))
        chunk_total = int(str(payload.get("chunk_total")))
        total_size = int(str(payload.get("total_size")))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"invalid upload counters: {exc}") from exc
    data_hex = str(payload.get("data_hex") or "").strip()

    if len(data_hex) % 2 != 0:
        raise HTTPException(status_code=400, detail="data_hex length must be even")
    try:
        chunk_bytes = bytes.fromhex(data_hex) if data_hex else b""
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"invalid data_hex: {exc}") from exc

    filename, done, stored_size = _store_uploaded_device_log_chunk(
        device_id=device_id,
        kind=kind_key,
        chunk_index=chunk_index,
        chunk_total=chunk_total,
        total_size=total_size,
        chunk_bytes=chunk_bytes,
    )
    return {
        "ok": True,
        "device_id": device_id,
        "kind": kind_key,
        "filename": filename or default_filename,
        "chunk_index": chunk_index,
        "chunk_total": chunk_total,
        "stored_size": stored_size,
        "done": done,
    }


@router.post("/api/devices/{device_id}/commands")
def api_device_queue_command(request: Request, device_id: str, payload: dict[str, Any] = Body(...)):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid payload")

    did = _norm_device_id(device_id)
    if not did:
        raise HTTPException(status_code=400, detail="device_id required")

    command = str(payload.get("command") or "").strip()
    if not command:
        raise HTTPException(status_code=400, detail="command required")
    if len(command) > 255:
        raise HTTPException(status_code=400, detail="command too long")

    rec = device_repo.get_device_by_device_id(did)
    if not rec:
        raise HTTPException(status_code=404, detail="device not found")

    requested_by = _request_user_id(request) or "admin"
    queued = device_ops_repo.queue_command(
        device_id=did,
        customer=str(rec.get("customer") or "-"),
        command=command,
        queued_by=requested_by,
        queued_via="web",
    )

    runtime_key = _resolve_runtime_key(str(rec.get("customer") or "-"), str(rec.get("ip") or ""), did, str(rec.get("token") or ""))
    _append_device_runtime_log(
        runtime_key or _device_key(str(rec.get("customer") or "-"), did, str(rec.get("ip") or "")),
        device_id=did,
        customer=str(rec.get("customer") or "-"),
        ip=str(rec.get("ip") or ""),
        when=datetime.now(),
        line=f"[CMD] queued #{int(queued.get('id') or 0)} {command} by {requested_by}",
        source="command",
    )

    return {"ok": True, "command_id": int(queued.get("id") or 0), "status": str(queued.get("status") or "queued")}



@router.websocket("/ws/device")
async def ws_device(websocket: WebSocket):
    """ESP32 <-> for_rnd_web WebSocket (통신 상태/Heartbeat/Telemetry).

    - ESP32가 연결되면 즉시 Online 반영 (제어 패널 탐색/LED용)
    - 주기적인 heartbeat 또는 telemetry 수신 시 last_seen 갱신

    Query params(권장):
      - device_id: MAC (aa:bb:cc:dd:ee:ff)
      - token: 디바이스 토큰(임의 문자열)
      - customer: 표시용(미설정 시 '-')
      - ip: (옵션)
    """
    await websocket.accept()

    qp = websocket.query_params
    device_id = _norm_device_id(str(qp.get("device_id") or ""))
    token = str(qp.get("token") or "").strip()
    customer = str(qp.get("customer") or "-").strip() or "-"
    ip = str(qp.get("ip") or "").strip()
    if not ip:
        try:
            ip = (websocket.client.host if websocket.client else "").strip()
        except Exception:
            ip = ""

    key = _device_key(customer, device_id, ip)

    def _touch_state(now: datetime, *, parse_ok: bool = True, line: str = "", power: str = "-", time_sec: str = "-"):
        st = _DEVICE_STATE.get(key) or {}
        st["customer"] = customer
        st["token"] = token
        st["device_id"] = device_id
        st["ip"] = ip
        st.setdefault("fw", "-")
        st["last_seen"] = now
        st["parse_ok"] = bool(parse_ok)
        st["ws_connected"] = True
        if line:
            st["line"] = line
        if power != "-":
            st["power"] = power
        if time_sec != "-":
            st["time_sec"] = time_sec
        st.setdefault("sd_inserted", False)
        st.setdefault("sd_total_mb", 0.0)
        st.setdefault("sd_used_mb", 0.0)
        st.setdefault("sd_free_mb", 0.0)
        st.setdefault("used_energy_j", 0)
        _DEVICE_STATE[key] = st
        if device_id:
            _DEVICEID_TO_KEY[device_id] = key
        if ip:
            _IP_CUSTOMER_TO_KEY[(customer, ip)] = key

    def _append_runtime_log(now: datetime, msg: str):
        _append_device_runtime_log(
            key,
            device_id=device_id,
            customer=customer,
            ip=ip,
            when=now,
            line=msg,
            source="ws",
        )

    now = datetime.now()
    _touch_state(now, parse_ok=True)
    _append_runtime_log(now, f"WS 연결됨 IP={ip}")

    try:
        while True:
            try:
                msg = await websocket.receive_text()
            except WebSocketDisconnect:
                break

            now = datetime.now()
            s = (msg or "").strip()

            # Heartbeat
            if s.upper() in ("PING", "HEARTBEAT"):
                _touch_state(now, parse_ok=True)
                try:
                    await websocket.send_text("PONG")
                except Exception:
                    pass
                continue

            # Best-effort JSON telemetry
            payload = None
            if s.startswith("{"):
                try:
                    import json as _json
                    obj = _json.loads(s)
                    if isinstance(obj, dict):
                        payload = obj
                except Exception:
                    payload = None

            line = ""
            power = "-"
            time_sec = "-"

            if isinstance(payload, dict):
                line = str(payload.get("line") or "")
                power = str(payload.get("power") or "-")
                time_sec = str(payload.get("time_sec") or "-")
            else:
                line = s

            parse_ok = bool(line) and ("," in line)
            _touch_state(now, parse_ok=parse_ok, line=line, power=power, time_sec=time_sec)

            if line:
                _append_runtime_log(now, line)

            # Ack (helps device mark comm OK)
            try:
                await websocket.send_text("OK")
            except Exception:
                pass

    finally:
        now = datetime.now()
        st = _DEVICE_STATE.get(key) or {}
        st["ws_connected"] = False
        _DEVICE_STATE[key] = st
        _append_runtime_log(now, "WS 연결 끊김")


@router.websocket("/ws/control-panel")
async def ws_control_panel(websocket: WebSocket):
    """웹 제어 패널용 WebSocket.

    상용 기본 경로는 direct TCP가 아니라 중앙 명령 큐입니다.

    메시지(JSON)
      - {type:"connect", ip, device_id?, token?, customer?}
      - {type:"disconnect"}
      - {type:"send", cmd}
    """

    # 인증(세션 쿠키)
    sid = ""
    try:
        sid = (websocket.cookies.get(SESSION_COOKIE_NAME, "") or "").strip()
    except Exception:
        sid = ""
    user_id = read_session_user(sid)
    if not user_id:
        # 4401: custom unauthorized
        try:
            await websocket.close(code=4401)
        except Exception:
            pass
        return

    await websocket.accept()

    connected_key = ""
    connected_device_id = ""
    connected_customer = "-"
    connected_ip = ""
    connected_token = ""

    async def send_status(state: str, message: str = ""):
        payload = {"type": "status", "state": state}
        if message:
            payload["message"] = message
        if connected_key:
            payload["key"] = connected_key
        try:
            await websocket.send_text(json.dumps(payload, ensure_ascii=False))
        except Exception:
            pass

    async def send_log(line: str):
        try:
            await websocket.send_text(json.dumps({"type": "log", "line": line}, ensure_ascii=False))
        except Exception:
            pass

    async def send_error(message: str):
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": message}, ensure_ascii=False))
        except Exception:
            pass

    await send_status("disconnected")

    try:
        while True:
            raw = await websocket.receive_text()
            if raw is None:
                continue

            try:
                msg = json.loads(raw)
            except Exception:
                msg = {"type": "raw", "line": str(raw)}

            mtype = str(msg.get("type") or "").strip().lower()

            if mtype == "connect":
                ip = str(msg.get("ip") or "").strip()
                device_id = _norm_device_id(str(msg.get("device_id") or "").strip())
                token = str(msg.get("token") or "").strip()
                customer = str(msg.get("customer") or "-").strip() or "-"
                if not ip:
                    await send_error("ip is required")
                    continue
                if not device_id:
                    await send_error("device_id is required")
                    continue

                rec = device_repo.get_device_by_device_id(device_id)
                if not rec:
                    await send_error("device not found")
                    continue

                connected_key = str(device_id or token or ip)
                connected_device_id = device_id
                connected_customer = customer
                connected_ip = ip
                connected_token = token
                await send_status("connecting", f"명령 큐 연결 준비: {device_id}")
                await send_log(f"[QUEUE] ready device_id={device_id} ip={ip}")
                await send_status("connected", "중앙 명령 큐 연결 완료")

            elif mtype == "disconnect":
                connected_key = ""
                connected_device_id = ""
                connected_customer = "-"
                connected_ip = ""
                connected_token = ""
                await send_status("disconnected")

            elif mtype == "send":
                cmd = str(msg.get("cmd") or "").strip()
                if not cmd:
                    continue
                if not connected_device_id:
                    await send_error("연결 필요: 먼저 디바이스를 연결해 주세요.")
                    continue
                try:
                    queued = device_ops_repo.queue_command(
                        device_id=connected_device_id,
                        customer=connected_customer,
                        command=cmd,
                        queued_by=user_id,
                        queued_via="websocket",
                    )
                    _append_device_runtime_log(
                        _resolve_runtime_key(connected_customer, connected_ip, connected_device_id, connected_token)
                        or _device_key(connected_customer, connected_device_id, connected_ip),
                        device_id=connected_device_id,
                        customer=connected_customer,
                        ip=connected_ip,
                        when=datetime.now(),
                        line=f"[CMD] queued #{int(queued.get('id') or 0)} {cmd} by {user_id}",
                        source="command",
                    )
                    await send_log(f"[QUEUE] #{int(queued.get('id') or 0)} {cmd}")
                except Exception as e:
                    await send_error(f"전송 실패: {e}")

            else:
                # ignore
                continue

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        return


@router.get("/api/devices/saved")
def api_devices_saved(customer: str = ""):
    saved = _load_saved_devices()
    customers = _customers_from_saved(saved)

    if customer:
        saved = [d for d in saved if (d.get("customer") == customer)]

    return {"ok": True, "devices": saved, "customers": customers}



@router.get("/api/devices/discovered")
def api_devices_discovered(customer: str = ""):
    """온라인 ESP32 디바이스 탐색(저장/미저장 모두).

    요구사항:
    - 제어 패널의 "찾기"에서 실제 온라인 디바이스가 반드시 조회되어야 함
    - 저장된 디바이스 리스트를 우선 표시하되, 미등록도 함께 노출

    탐색 순서:
    1) UDP discovery(ESP32: 4210)
    2) 런타임 캐시(ESP32가 /api/device/register|telemetry 또는 WS로 먼저 등록한 경우)
    """
    print(f"[DISCOVERY] /api/devices/discovered called customer={customer or '-'}")

    saved = _load_saved_devices()

    saved_by_did: dict[str, dict[str, str]] = {}
    saved_by_ip: dict[str, dict[str, str]] = {}
    for s in saved:
        did = _norm_device_id(str(s.get("device_id") or ""))
        ip = str(s.get("ip") or "").strip()
        if did:
            saved_by_did[did] = s
        if ip:
            saved_by_ip[ip] = s

    # 1) UDP discovery
    try:
        udp_devices = _udp_discover_devices()
    except Exception as e:
        print(f"[DISCOVERY] udp discovery exception: {e}")
        udp_devices = []

    # UDP 결과 기반으로 saved CSV 보정(기존 등록된 장비의 device_id/token 누락 방지)
    if udp_devices:
        ip_to_did: dict[str, str] = {}
        ip_to_tok: dict[str, str] = {}
        tok_to_did: dict[str, str] = {}
        for d in udp_devices:
            ip0 = str(d.get("ip") or "").strip()
            tok0 = str(d.get("token") or "").strip()
            did0 = _norm_device_id(str(d.get("device_id") or ""))
            if ip0:
                ip_to_did[ip0] = did0
                ip_to_tok[ip0] = tok0
            if tok0 and did0:
                tok_to_did[tok0] = did0

        changed = False
        for row in saved:
            ip0 = str(row.get("ip") or "").strip()
            if not ip0:
                continue

            if not _norm_device_id(str(row.get("device_id") or "")):
                did0 = ip_to_did.get(ip0) or ""
                if not did0:
                    tok_cur = str(row.get("token") or "").strip()
                    if tok_cur:
                        did0 = tok_to_did.get(tok_cur) or ""
                if did0:
                    row["device_id"] = did0
                    changed = True

            if not str(row.get("token") or "").strip():
                tok0 = ip_to_tok.get(ip0) or ""
                if tok0:
                    row["token"] = tok0
                    changed = True

        if changed:
            _rewrite_saved_devices(saved)
            saved = _load_saved_devices()
            saved_by_did.clear()
            saved_by_ip.clear()
            for s in saved:
                did = _norm_device_id(str(s.get("device_id") or ""))
                ip = str(s.get("ip") or "").strip()
                if did:
                    saved_by_did[did] = s
                if ip:
                    saved_by_ip[ip] = s

    # 2) Runtime cache
    now = datetime.now()
    _prune_runtime_cache(now)

    out: dict[str, dict[str, Any]] = {}

    def _merge_saved_fields(item: dict[str, Any]) -> dict[str, Any]:
        did = _norm_device_id(str(item.get("device_id") or ""))
        ip = str(item.get("ip") or "").strip()
        s = saved_by_did.get(did) if did else None
        if not s and ip:
            s = saved_by_ip.get(ip)

        if s:
            item["saved"] = True
            item["name"] = str(s.get("name") or item.get("name") or "")
            item["customer"] = str(s.get("customer") or item.get("customer") or "-")
            item["token"] = str(s.get("token") or item.get("token") or "")
            item["device_id"] = _norm_device_id(str(s.get("device_id") or item.get("device_id") or ""))
            item["ip"] = str(s.get("ip") or item.get("ip") or "")
        else:
            item["saved"] = False
            if not item.get("customer"):
                item["customer"] = "-"
        return item

    # Add UDP devices
    for d in udp_devices:
        item = {
            "name": str(d.get("name") or ""),
            "ip": str(d.get("ip") or "").strip(),
            "tcp_port": str(d.get("tcp_port") or ""),
            "device_id": _norm_device_id(str(d.get("device_id") or "")),
            "token": str(d.get("token") or ""),
            "customer": str(d.get("customer") or "-"),
            "status": "Online",
            "last_seen": _fmt(now),
            "power": "-",
            "time_sec": "-",
        }
        item = _merge_saved_fields(item)
        key = str(item.get("device_id") or item.get("ip") or secrets.token_hex(4))
        out[key] = item

    # Add runtime-online devices (HTTP/WS)
    for _k, st in list(_DEVICE_STATE.items()):
        last_seen_dt = st.get("last_seen")
        parse_ok = bool(st.get("parse_ok", True))
        status = _status_of(now, last_seen_dt, parse_ok)
        if status == "Offline":
            continue

        item = {
            "name": str(st.get("name") or ""),
            "ip": str(st.get("ip") or "").strip(),
            "tcp_port": "",
            "device_id": _norm_device_id(str(st.get("device_id") or "")),
            "token": str(st.get("token") or ""),
            "customer": str(st.get("customer") or "-"),
            "status": status,
            "last_seen": _fmt(last_seen_dt) if last_seen_dt else "-",
            "power": str(st.get("power") or "-"),
            "time_sec": str(st.get("time_sec") or "-"),
        }
        item = _merge_saved_fields(item)
        key = str(item.get("device_id") or item.get("ip") or secrets.token_hex(4))
        if key in out:
            prev = out[key]
            for k2 in ("status", "last_seen", "power", "time_sec"):
                if item.get(k2):
                    prev[k2] = item.get(k2)
            out[key] = prev
        else:
            out[key] = item

    devices = list(out.values())

    if customer:
        devices = [d for d in devices if str(d.get("customer") or "-") == customer]

    devices.sort(key=lambda d: (0 if d.get("saved") else 1, str(d.get("customer") or ""), str(d.get("name") or "")))

    if not devices:
        print("[DISCOVERY] result=0 (no UDP reply, no runtime cache)")

    return {"ok": True, "devices": devices}


@router.post("/api/devices/save")
def api_devices_save(payload: dict[str, Any] = Body(...)):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid payload")

    name = str(payload.get("name") or "").strip()
    ip = str(payload.get("ip") or "").strip()
    customer = str(payload.get("customer") or "-").strip() or "-"
    token = str(payload.get("token") or "").strip()
    device_id = str(payload.get("device_id") or "").strip()

    # (핵심) 식별키는 device_id(MAC 등)로 유지하고, 표시명(디바이스명/거래처)은 수정 가능하도록 분리
    # - ip는 변할 수 있으므로 device_id를 우선 사용합니다.
    st = None
    provision_name = name
    provision_token = token

    if device_id and not ip:
        key = _DEVICEID_TO_KEY.get(device_id)
        st = _DEVICE_STATE.get(key or "") if key else None
        if not st:
            for _k, _st in list(_DEVICE_STATE.items()):
                if str(_st.get("device_id") or "").strip() == device_id:
                    st = _st
                    _DEVICEID_TO_KEY[device_id] = _k
                    break
        if st:
            ip = str(st.get("ip") or "").strip()
            if not token:
                token = str(st.get("token") or "").strip()
            provision_token = token

    if (not device_id) and ip:
        # 구형 호환: ip로 device_id/token를 최대한 보정
        for _k, _st in list(_DEVICE_STATE.items()):
            if str(_st.get("ip") or "").strip() == ip:
                st = _st
                device_id = str(_st.get("device_id") or "").strip()
                if device_id:
                    _DEVICEID_TO_KEY[device_id] = _k
                if not token:
                    token = str(_st.get("token") or "").strip()
                provision_token = token
                break

    if not ip:
        raise HTTPException(status_code=400, detail="ip required")
    if not device_id:
        raise HTTPException(status_code=400, detail="device_id required")


    # (모델 토큰 정책) token은 모델명 단위 고정 값이며, 저장/수정 시 token-map을 자동 수정하지 않습니다.
    # - token이 비어있으면(브라우저에서 저장 요청), 최근 UDP discovery 캐시에서 보정합니다.
    if not token:
        cached = _DISCOVERY_CACHE.get(device_id) if device_id else None
        if not cached and ip:
            for _d in _DISCOVERY_CACHE.values():
                if str(_d.get("ip") or "").strip() == ip:
                    cached = _d
                    break
        if cached:
            token = str(cached.get("token") or "").strip()

    # customer(거래처)는 UI 표시값이며, 토큰으로 자동 매핑하지 않습니다.


    saved = _load_saved_devices()

    # 1) device_id로 기존 등록 여부 확인(우선)
    for idx, d in enumerate(saved):
        if (d.get("device_id") or "").strip() == device_id:
            provision_name = name or (d.get("name") or ip)
            provision_token = token or str(d.get("token") or "").strip()
            saved[idx]["name"] = name or (d.get("name") or ip)
            saved[idx]["customer"] = customer
            saved[idx]["ip"] = ip
            saved[idx]["token"] = provision_token
            saved[idx]["device_id"] = device_id
            _rewrite_saved_devices(saved)
            if provision_token:
                device_repo.upsert_device(
                    name=provision_name,
                    ip=ip,
                    customer=customer,
                    token=provision_token,
                    device_id=device_id,
                )
            local_reset = _maybe_remote_reset_pending(device_id=device_id, ip=ip, customer=customer)
            return {"ok": True, "token": provision_token, "customer": customer, "device_id": device_id, "existing": True, "local_reset": local_reset}

    # 2) (fallback) ip/customer 기반(구형 데이터)
    for idx, d in enumerate(saved):
        if (d.get("ip") == ip):
            provision_name = name or (d.get("name") or ip)
            provision_token = token or str(d.get("token") or "").strip()
            saved[idx]["name"] = name or (d.get("name") or ip)
            saved[idx]["customer"] = customer
            saved[idx]["ip"] = ip
            saved[idx]["token"] = provision_token
            saved[idx]["device_id"] = device_id
            _rewrite_saved_devices(saved)
            if provision_token:
                device_repo.upsert_device(
                    name=provision_name,
                    ip=ip,
                    customer=customer,
                    token=provision_token,
                    device_id=device_id,
                )
            local_reset = _maybe_remote_reset_pending(device_id=device_id, ip=ip, customer=customer)
            return {"ok": True, "token": provision_token, "customer": customer, "device_id": device_id, "existing": True, "local_reset": local_reset}

    # 신규 등록
    if not token:
        raise HTTPException(status_code=400, detail="token required for new device provisioning")
    ok = _append_saved_device(name=name, ip=ip, customer=customer, token=token, device_id=device_id)
    if not ok:
        raise HTTPException(status_code=400, detail="save failed")
    device_repo.upsert_device(
        name=name or ip,
        ip=ip,
        customer=customer,
        token=token,
        device_id=device_id,
    )

    local_reset = _maybe_remote_reset_pending(device_id=device_id, ip=ip, customer=customer)
    return {"ok": True, "token": token, "customer": customer, "device_id": device_id, "existing": False, "local_reset": local_reset}

@router.post("/api/devices/delete")
def api_devices_delete(payload: dict[str, Any] = Body(...)):
    """저장된 디바이스 정보 완전 삭제(토큰 포함)."""
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid payload")

    device_id = _norm_device_id(str(payload.get("device_id") or "").strip())
    token = str(payload.get("token") or "").strip()
    ip = str(payload.get("ip") or "").strip()
    customer = str(payload.get("customer") or "-").strip() or "-"

    if not device_id and not ip:
        raise HTTPException(status_code=400, detail="device_id or ip required")

    saved = _load_saved_devices()
    new_rows: list[dict[str, str]] = []
    deleted: dict[str, str] | None = None

    for d in saved:
        d_dev = _norm_device_id(str(d.get("device_id") or "").strip())
        if device_id and d_dev and d_dev == device_id:
            deleted = d
            continue
        if (not device_id) and ip and (d.get("ip") == ip) and (d.get("customer") == customer):
            deleted = d
            continue
        new_rows.append(d)

    if not deleted:
        raise HTTPException(status_code=404, detail="device not found")

    del_dev = _norm_device_id(str(deleted.get("device_id") or "").strip())
    del_ip = str(deleted.get("ip") or ip).strip()
    del_customer = str(deleted.get("customer") or customer).strip() or "-"
    del_token = str(deleted.get("token") or token).strip()
    _queue_remote_reset(device_id=del_dev, ip=del_ip, customer=del_customer)
    _rewrite_saved_devices(new_rows)
    try:
        device_repo.delete_device(device_id=del_dev, ip=del_ip, customer=del_customer)
    except Exception:
        pass


    # 런타임 캐시 동기화(ghost 방지)
    del_key = ""
    if del_dev:
        del_key = _DEVICEID_TO_KEY.pop(del_dev, None) or ""
    if (not del_key) and del_token:
        del_key = _TOKEN_TO_KEY.get(del_token, "") or ""
    if (not del_key) and del_ip:
        del_key = _IP_CUSTOMER_TO_KEY.get((del_customer, del_ip), "") or ""
    if del_key:
        _DEVICE_STATE.pop(del_key, None)
        _DEVICE_LOGS.pop(del_key, None)
        _LAST_RUNTIME_LOG.pop(del_key, None)

    if del_token:
        _TOKEN_TO_KEY.pop(del_token, None)
    if del_ip:
        _IP_CUSTOMER_TO_KEY.pop((del_customer, del_ip), None)

    local_reset = _maybe_remote_reset_pending(device_id=del_dev, ip=del_ip, customer=del_customer)

    return {"ok": True, "local_reset": local_reset}
@router.post("/api/devices/update")
def api_devices_update(payload: dict[str, Any] = Body(...)):
    """저장된 디바이스 정보 수정."""
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid payload")

    device_id = str(payload.get("device_id") or "").strip()
    token = str(payload.get("token") or "").strip()
    ip = str(payload.get("ip") or "").strip()
    customer_old = str(payload.get("customer_old") or payload.get("customer") or "-").strip() or "-"

    # 수정 값
    new_name = str(payload.get("name") or "").strip()
    customer_new = str(payload.get("customer_new") or customer_old).strip() or "-"

    if not device_id and not ip:
        raise HTTPException(status_code=400, detail="device_id or ip required")

    saved = _load_saved_devices()
    found_idx = -1

    for idx, d in enumerate(saved):
        d_dev = (d.get("device_id") or "").strip()
        if device_id and d_dev and d_dev == device_id:
            found_idx = idx
            break

    if found_idx < 0 and ip:
        for idx, d in enumerate(saved):
            if (d.get("ip") == ip):
                found_idx = idx
                break

    if found_idx < 0:
        raise HTTPException(status_code=404, detail="device not found")

    cur = saved[found_idx]
    cur_token = (cur.get("token") or token or "").strip()
    cur_ip = (cur.get("ip") or "").strip()
    cur_customer = (cur.get("customer") or "-").strip() or "-"
    cur_dev = _norm_device_id((cur.get("device_id") or device_id or "").strip())

    # 이름
    if new_name:
        cur["name"] = new_name

    # 거래처 변경(표시값): 모델 토큰맵(Data/modelTokenMap.csv)은 수정하지 않음
    # (중요) customer를 바꾸더라도 online 매칭이 깨지지 않도록 device_id(MAC)를 최대한 보정한다.
    if customer_new and customer_new != cur_customer:
        cur["customer"] = customer_new

        # ip/customer로 매칭하던 구형 호환 키가 있을 수 있어, 맵을 정리
        try:
            if cur_ip:
                old_key = _IP_CUSTOMER_TO_KEY.pop((cur_customer, cur_ip), None)
                if old_key:
                    _IP_CUSTOMER_TO_KEY[(customer_new, cur_ip)] = old_key
        except Exception:
            pass

    # token/device_id 보정(구형 데이터 호환)
    # - device_id가 비어 있으면 runtime state에서 추출하여 저장해두면,
    #   customer/name을 바꿔도 Online/Offline 매칭이 MAC 기준으로 안정적으로 유지된다.
    if not cur_dev:
        # 1) ip 기준
        if cur_ip:
            for _k, _st in list(_DEVICE_STATE.items()):
                if str(_st.get("ip") or "").strip() == cur_ip:
                    cur_dev = _norm_device_id(str(_st.get("device_id") or "").strip())
                    if cur_dev:
                        _DEVICEID_TO_KEY[cur_dev] = _k
                    if not cur_token:
                        cur_token = str(_st.get("token") or "").strip()
                    break
        # 2) token 기준
        if (not cur_dev) and cur_token:
            for _k, _st in list(_DEVICE_STATE.items()):
                if str(_st.get("token") or "").strip() == cur_token:
                    cur_dev = _norm_device_id(str(_st.get("device_id") or "").strip())
                    if cur_dev:
                        _DEVICEID_TO_KEY[cur_dev] = _k
                    break

    if cur_token:
        cur["token"] = cur_token
    if cur_dev:
        cur["device_id"] = cur_dev

    _rewrite_saved_devices(saved)
    return {"ok": True}


def _resolve_runtime_key(customer: str, ip: str, device_id: str, token: str = "") -> str | None:
    customer = (customer or "-").strip() or "-"
    ip = (ip or "").strip()
    device_id = (device_id or "").strip()
    token = (token or "").strip()

    key = None

    if device_id:
        key = _DEVICEID_TO_KEY.get(device_id)
        if not key:
            for _k, _st in list(_DEVICE_STATE.items()):
                if str(_st.get("device_id") or "").strip() == device_id:
                    key = _k
                    _DEVICEID_TO_KEY[device_id] = _k
                    break

    if not key and token:
        key = _TOKEN_TO_KEY.get(token)
        if not key:
            for _k, _st in list(_DEVICE_STATE.items()):
                if str(_st.get("token") or "").strip() == token:
                    key = _k
                    _TOKEN_TO_KEY[token] = _k
                    break

    if not key and ip:
        key = _IP_CUSTOMER_TO_KEY.get((customer, ip))
        if not key:
            key = _device_key(customer, "", ip)

    return key


def _resolve_device_ip(customer: str, ip: str, device_id: str, token: str = "") -> tuple[str, dict[str, Any], str | None]:
    customer = (customer or "-").strip() or "-"
    ip = (ip or "").strip()
    device_id = (device_id or "").strip()
    token = (token or "").strip()

    key = _resolve_runtime_key(customer, ip, device_id, token)
    st = _DEVICE_STATE.get(key or "") if key else {}

    resolved_ip = str(ip or st.get("ip") or "").strip()
    if not resolved_ip:
        saved = _load_saved_devices()
        if device_id:
            for row in saved:
                if str(row.get("device_id") or "").strip() == device_id:
                    resolved_ip = str(row.get("ip") or "").strip()
                    break
        if not resolved_ip and token:
            for row in saved:
                if str(row.get("token") or "").strip() == token:
                    resolved_ip = str(row.get("ip") or "").strip()
                    break

    return resolved_ip, st, key


def _parse_pipe_kv(line: str) -> dict[str, str]:
    out: dict[str, str] = {}
    parts = (line or "").split("|")
    for seg in parts[1:]:
        if "=" not in seg:
            continue
        k, v = seg.split("=", 1)
        k = (k or "").strip()
        if not k:
            continue
        out[k] = (v or "").strip()
    return out


async def _fetch_sd_log_via_tcp(ip: str, port: int = 5000, timeout_sec: float = 10.0) -> tuple[bool, bytes, str]:
    ok, raw, reason, _filename = await _fetch_named_sd_log_via_tcp(ip, kind="activity", port=port, timeout_sec=timeout_sec)
    return ok, raw, reason


def _normalize_sd_log_kind(kind: str) -> tuple[str, str, str]:
    raw = (kind or "activity").strip().lower()
    if raw in {"energy", "total", "energylog", "totalenergy"}:
        return "energy", "SDLOG ENERGY\r\n", "TotalEnergy.txt"
    return "activity", "SDLOG GET\r\n", "MELAUHF_Log.txt"


def _safe_device_log_key(device_id: str) -> str:
    did = _norm_device_id(device_id)
    if not did:
        return "unknown"
    out_chars: list[str] = []
    for ch in did:
        if ch.isalnum():
            out_chars.append(ch.lower())
        else:
            out_chars.append("_")
    safe = "".join(out_chars).strip("._")
    return safe or "unknown"


def _uploaded_device_log_paths(device_id: str, kind: str) -> tuple[str, str, str]:
    kind_key, _command, filename = _normalize_sd_log_kind(kind)
    safe_dir = os.path.join(DEVICE_LOG_ARCHIVE_DIR, _safe_device_log_key(device_id))
    final_path = os.path.join(safe_dir, filename)
    temp_path = os.path.join(safe_dir, f".{filename}.{kind_key}.part")
    return safe_dir, final_path, temp_path


def _read_uploaded_device_log(device_id: str, kind: str) -> tuple[bool, bytes, str]:
    did = _norm_device_id(device_id)
    if not did:
        return False, b"", ""
    _safe_dir, final_path, _temp_path = _uploaded_device_log_paths(did, kind)
    if not os.path.exists(final_path):
        return False, b"", os.path.basename(final_path)
    try:
        with open(final_path, "rb") as fp:
            return True, fp.read(), os.path.basename(final_path)
    except Exception:
        return False, b"", os.path.basename(final_path)


def _write_uploaded_device_log(device_id: str, kind: str, raw: bytes) -> tuple[bool, str, str]:
    did = _norm_device_id(device_id)
    if not did:
        return False, "", "device_id_required"

    safe_dir, final_path, temp_path = _uploaded_device_log_paths(did, kind)
    try:
        os.makedirs(safe_dir, exist_ok=True)
        if os.path.exists(temp_path):
            os.remove(temp_path)
        with open(final_path, "wb") as fp:
            fp.write(bytes(raw or b""))
    except Exception as exc:
        return False, os.path.basename(final_path), f"write_failed:{exc}"

    return True, os.path.basename(final_path), ""


def _delete_uploaded_device_log(device_id: str, kind: str) -> tuple[bool, str, str]:
    did = _norm_device_id(device_id)
    if not did:
        return False, "", "device_id_required"

    _safe_dir, final_path, temp_path = _uploaded_device_log_paths(did, kind)
    filename = os.path.basename(final_path)

    try:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        if not os.path.exists(final_path):
            return False, filename, "file_not_found"
        os.remove(final_path)
    except Exception as exc:
        return False, filename, f"remove_failed:{exc}"

    return True, filename, ""


def _store_uploaded_device_log_chunk(
    *,
    device_id: str,
    kind: str,
    chunk_index: int,
    chunk_total: int,
    total_size: int,
    chunk_bytes: bytes,
) -> tuple[str, bool, int]:
    did = _norm_device_id(device_id)
    if not did:
        raise HTTPException(status_code=400, detail="device_id required")
    if chunk_total <= 0:
        raise HTTPException(status_code=400, detail="chunk_total must be positive")
    if chunk_index < 0 or chunk_index >= chunk_total:
        raise HTTPException(status_code=400, detail="invalid chunk_index")
    if total_size < 0:
        raise HTTPException(status_code=400, detail="invalid total_size")
    if len(chunk_bytes) > DEVICE_LOG_UPLOAD_MAX_CHUNK_BYTES:
        raise HTTPException(status_code=400, detail="chunk too large")

    safe_dir, final_path, temp_path = _uploaded_device_log_paths(did, kind)
    os.makedirs(safe_dir, exist_ok=True)

    mode = "ab"
    if chunk_index == 0:
        mode = "wb"
    elif not os.path.exists(temp_path):
        raise HTTPException(status_code=409, detail="upload not initialized")

    try:
        with open(temp_path, mode) as fp:
            if chunk_bytes:
                fp.write(chunk_bytes)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"log upload write failed: {exc}") from exc

    try:
        current_size = int(os.path.getsize(temp_path))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"log upload stat failed: {exc}") from exc

    if current_size > total_size:
        raise HTTPException(status_code=400, detail="uploaded chunk bytes exceed total_size")

    done = (chunk_index + 1) >= chunk_total
    if done:
        if current_size != total_size:
            raise HTTPException(status_code=400, detail="uploaded size mismatch")
        try:
            os.replace(temp_path, final_path)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"log upload finalize failed: {exc}") from exc

    return os.path.basename(final_path), done, current_size


def _resolve_device_record_for_logs(customer: str, ip: str, device_id: str) -> dict[str, Any]:
    customer = (customer or "-").strip() or "-"
    ip = (ip or "").strip()
    did = _norm_device_id(device_id)

    try:
        if did:
            rec = device_repo.get_device_by_device_id(did)
            if rec:
                return rec
    except Exception:
        pass

    try:
        if ip:
            rec = device_repo.get_device_by_ip_customer(ip, customer)
            if rec:
                return rec
    except Exception:
        pass

    return {}


def _build_activity_log_fallback_bytes(device_id: str, runtime_key: str | None, st: dict[str, Any], rec: dict[str, Any]) -> bytes:
    lines: list[str] = ["# source: server runtime log mirror"]
    rows: list[dict[str, Any]] = []
    did = _norm_device_id(str(device_id or rec.get("device_id") or ""))

    if did:
        try:
            db_tail = device_ops_repo.tail_runtime_logs(device_id=did, cursor=0, limit=500)
            rows = list(db_tail.get("logs") or [])
        except Exception:
            rows = []

    if not rows and runtime_key:
        cached = list(_DEVICE_LOGS.get(runtime_key) or [])
        for row in cached[-500:]:
            t = row.get("t")
            try:
                t_str = t.strftime("%Y-%m-%d %H:%M:%S") if t else ""
            except Exception:
                t_str = ""
            rows.append({"t": t_str, "line": str(row.get("line") or "")})

    for row in rows:
        msg = str(row.get("line") or "").strip()
        if not msg:
            continue
        t_str = str(row.get("t") or "").strip()
        lines.append(f"[{t_str}] {msg}" if t_str else msg)

    if len(lines) == 1:
        last_seen_dt = st.get("last_seen") or _parse_runtime_dt(rec.get("last_seen_at"))
        last_line = str(st.get("line") or rec.get("last_line") or "").strip()
        if last_line:
            t_str = _fmt(last_seen_dt) if last_seen_dt else ""
            lines.append(f"[{t_str}] {last_line}" if t_str else last_line)
        else:
            lines.append("# central runtime log is empty")

    return ("\n".join(lines) + "\n").encode("utf-8", errors="replace")


def _build_energy_log_fallback_bytes(st: dict[str, Any], rec: dict[str, Any]) -> bytes:
    last_seen_dt = st.get("last_seen") or _parse_runtime_dt(rec.get("last_seen_at"))
    if last_seen_dt:
        day_txt = last_seen_dt.strftime("%Y-%m-%d")
        seen_txt = _fmt(last_seen_dt)
    else:
        now_kst = datetime.now(KST)
        day_txt = now_kst.strftime("%Y-%m-%d")
        seen_txt = ""

    used_energy_j = _payload_int(st.get("used_energy_j"), _payload_int(rec.get("used_energy_j"), 0))
    telemetry_count = _payload_int(rec.get("telemetry_count"), 0)
    power = str(st.get("power") or rec.get("last_power") or "-").strip() or "-"
    time_sec = str(st.get("time_sec") or rec.get("last_time_sec") or "-").strip() or "-"

    lines = [
        "# source: server telemetry energy summary",
        f"[DAILY_TOTAL] DATE={day_txt} TOTAL={used_energy_j} J",
        f"[DEVICE_TOTAL] {used_energy_j} J",
    ]
    if telemetry_count > 0:
        lines.append(f"# telemetry_count={telemetry_count}")
    if seen_txt:
        lines.append(f"# last_seen={seen_txt}")
    if power != "-" or time_sec != "-":
        lines.append(f"# last_power={power} last_time_sec={time_sec}")

    return ("\n".join(lines) + "\n").encode("utf-8", errors="replace")


def _build_named_sd_log_fallback(
    *,
    customer: str,
    ip: str,
    device_id: str,
    token: str,
    kind: str,
) -> tuple[bytes, str, str, str, dict[str, Any]]:
    kind_key, _command, default_filename = _normalize_sd_log_kind(kind)
    resolved_ip, st, runtime_key = _resolve_device_ip(customer, ip, device_id, token)
    rec = _resolve_device_record_for_logs(customer, (resolved_ip or ip), device_id)

    if kind_key == "energy":
        raw = _build_energy_log_fallback_bytes(st, rec)
        source = "server_energy_summary"
    else:
        raw = _build_activity_log_fallback_bytes(device_id, runtime_key, st, rec)
        source = "server_runtime"

    resolved_ip = str(resolved_ip or rec.get("ip") or ip).strip()
    return raw, default_filename, source, resolved_ip, rec


async def _read_named_sd_log(
    *,
    customer: str,
    ip: str,
    device_id: str,
    token: str,
    kind: str,
    timeout_sec: float = 10.0,
) -> dict[str, Any]:
    kind_key, _command, default_filename = _normalize_sd_log_kind(kind)
    resolved_ip, st, _key = _resolve_device_ip(customer, ip, device_id, token)
    rec = _resolve_device_record_for_logs(customer, (resolved_ip or ip), device_id)
    resolved_ip = str(resolved_ip or rec.get("ip") or ip).strip()
    did = _norm_device_id(str(device_id or rec.get("device_id") or st.get("device_id") or ""))

    uploaded_ok, uploaded_raw, uploaded_filename = _read_uploaded_device_log(did, kind_key)
    if uploaded_ok:
        return {
            "ok": True,
            "raw": uploaded_raw,
            "reason": "",
            "filename": uploaded_filename or default_filename,
            "kind": kind_key,
            "source": "server_uploaded_raw",
            "remote_delete_supported": True,
            "resolved_ip": resolved_ip,
            "st": st,
            "record": rec,
        }

    if ENABLE_DIRECT_DEVICE_TCP and resolved_ip:
        ok, raw, reason, filename = await _fetch_named_sd_log_via_tcp(
            resolved_ip, kind=kind_key, timeout_sec=timeout_sec
        )
        if ok:
            return {
                "ok": True,
                "raw": raw,
                "reason": "",
                "filename": filename or default_filename,
                "kind": kind_key,
                "source": "device_sd",
                "remote_delete_supported": True,
                "resolved_ip": resolved_ip,
                "st": st,
                "record": rec,
            }

    raw, filename, source, resolved_ip, rec = _build_named_sd_log_fallback(
        customer=customer,
        ip=ip,
        device_id=device_id,
        token=token,
        kind=kind_key,
    )
    return {
        "ok": True,
        "raw": raw,
        "reason": "",
        "filename": filename or default_filename,
        "kind": kind_key,
        "source": source,
        "remote_delete_supported": False,
        "resolved_ip": resolved_ip,
        "st": st,
        "record": rec,
    }


def _normalize_sd_delete_kind(kind: str) -> tuple[str, str, str]:
    kind_key, _fetch_command, default_filename = _normalize_sd_log_kind(kind)
    if kind_key == "energy":
        return kind_key, "SDDELETE ENERGY\r\n", default_filename
    return kind_key, "SDDELETE LOG\r\n", default_filename


def _trash_name_part(value: str, fallback: str) -> str:
    src = " ".join(str(value or "").strip().split())
    if not src:
        src = fallback

    out_chars: list[str] = []
    for ch in src:
        code = ord(ch)
        if code < 32:
            continue
        if ch in '\\/:*?"<>|':
            out_chars.append("_")
        elif ch.isspace():
            out_chars.append("_")
        else:
            out_chars.append(ch)

    cleaned = "".join(out_chars).strip("._ ")
    return cleaned or fallback


def _make_trashcan_backup_prefix(device_name: str, customer: str) -> str:
    ts = datetime.now(KST).strftime("%Y_%m_%d_%H_%M_%S")
    dev_part = _trash_name_part(device_name, "device")
    customer_part = _trash_name_part(customer, "customer")
    base_name = f"{ts}_{dev_part}_{customer_part}"

    os.makedirs(TRASHCAN_DIR, exist_ok=True)
    candidate = base_name
    if not (
        os.path.exists(os.path.join(TRASHCAN_DIR, f"{candidate}_MELAUHF_Log.txt"))
        or os.path.exists(os.path.join(TRASHCAN_DIR, f"{candidate}_TotalEnergy.txt"))
    ):
        return candidate

    suffix = 2
    while True:
        candidate = f"{base_name}_{suffix:02d}"
        if not (
            os.path.exists(os.path.join(TRASHCAN_DIR, f"{candidate}_MELAUHF_Log.txt"))
            or os.path.exists(os.path.join(TRASHCAN_DIR, f"{candidate}_TotalEnergy.txt"))
        ):
            return candidate
        suffix += 1


def _make_trashcan_backup_name(prefix: str, filename: str) -> str:
    file_part = _trash_name_part(filename, "log.txt")
    return f"{prefix}_{file_part}"


def _extract_daily_total_date(line: str) -> str | None:
    if not line.startswith("[DAILY_TOTAL]"):
        return None
    date_pos = line.find("DATE=")
    if date_pos < 0:
        return None
    date_txt = line[date_pos + 5:date_pos + 15]
    try:
        datetime.strptime(date_txt, "%Y-%m-%d")
    except Exception:
        return None
    return date_txt


def _join_log_lines(lines: list[str]) -> bytes:
    if not lines:
        return b""
    return ("\n".join(lines) + "\n").encode("utf-8")


def _compact_total_energy_backup(raw: bytes) -> tuple[bytes, bytes]:
    text = raw.decode("utf-8", errors="replace").replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")
    daily_counts: dict[str, int] = {}
    device_total_count = 0

    for line in lines:
        if not line:
            continue
        day_key = _extract_daily_total_date(line)
        if day_key:
            daily_counts[day_key] = daily_counts.get(day_key, 0) + 1
            continue
        if line.startswith("[DEVICE_TOTAL]"):
            device_total_count += 1

    daily_seen: dict[str, int] = {}
    device_total_seen = 0
    kept_lines: list[str] = []
    removed_lines: list[str] = []

    for line in lines:
        if not line:
            continue
        if line.startswith("[SESSION]"):
            removed_lines.append(line)
            continue

        day_key = _extract_daily_total_date(line)
        if day_key:
            daily_seen[day_key] = daily_seen.get(day_key, 0) + 1
            if daily_seen[day_key] == daily_counts.get(day_key, 0):
                kept_lines.append(line)
            else:
                removed_lines.append(line)
            continue

        if line.startswith("[DEVICE_TOTAL]"):
            device_total_seen += 1
            if device_total_seen == device_total_count:
                kept_lines.append(line)
            else:
                removed_lines.append(line)
            continue

        kept_lines.append(line)

    return _join_log_lines(kept_lines), _join_log_lines(removed_lines)


async def _delete_named_sd_log_via_tcp(
    ip: str,
    kind: str = "activity",
    port: int = 5000,
    timeout_sec: float = REMOTE_SD_DELETE_TIMEOUT_SEC,
) -> tuple[bool, str, str]:
    reader = None
    writer = None
    reason = ""
    kind_key, command, default_filename = _normalize_sd_delete_kind(kind)
    filename = default_filename

    try:
        reader, writer = await asyncio.wait_for(asyncio.open_connection(ip, port), timeout=4.0)
        writer.write(command.encode("utf-8", errors="replace"))
        await writer.drain()

        loop = asyncio.get_running_loop()
        deadline = loop.time() + max(float(timeout_sec), 1.0)

        while True:
            remain = deadline - loop.time()
            if remain <= 0:
                return False, reason or "timeout", filename

            raw = await asyncio.wait_for(reader.readline(), timeout=min(1.0, remain))
            if not raw:
                return False, reason or "no_response", filename

            line = raw.decode("utf-8", errors="replace").strip()
            if not line or line.startswith("HELLO "):
                continue

            if not line.startswith("SDDELETE|"):
                continue

            fields = _parse_pipe_kv(line)
            ok = fields.get("ok", "0") == "1"
            reason = fields.get("reason", "").strip()
            path = str(fields.get("path", "")).strip()
            if path:
                filename = os.path.basename(path) or filename
            if ok:
                return True, "", filename
            return False, reason or f"{kind_key}_delete_failed", filename

    except Exception as e:
        return False, f"tcp_error:{e}", filename
    finally:
        if writer is not None:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass


async def _fetch_named_sd_log_via_tcp(ip: str, kind: str = "activity", port: int = 5000, timeout_sec: float = 10.0) -> tuple[bool, bytes, str, str]:
    reader = None
    writer = None
    chunks: list[bytes] = []
    started = False
    ended = False
    ok = False
    reason = ""
    _kind, command, default_filename = _normalize_sd_log_kind(kind)
    filename = default_filename

    try:
        reader, writer = await asyncio.wait_for(asyncio.open_connection(ip, port), timeout=4.0)
        writer.write(command.encode("utf-8", errors="replace"))
        await writer.drain()

        loop = asyncio.get_running_loop()
        deadline = loop.time() + max(float(timeout_sec), 1.0)

        while True:
            remain = deadline - loop.time()
            if remain <= 0:
                reason = reason or ("timeout_no_response" if not started else "timeout")
                break

            raw = await asyncio.wait_for(reader.readline(), timeout=min(1.2, remain))
            if not raw:
                if not started:
                    reason = reason or "no_response"
                break

            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue

            if line.startswith("SDLOG_BEGIN|"):
                started = True
                fields = _parse_pipe_kv(line)
                ok = fields.get("ok", "0") == "1"
                reason = fields.get("reason", "")
                path = str(fields.get("path", "")).strip()
                if path:
                    filename = os.path.basename(path) or filename
                continue

            if line.startswith("SDLOG_DATA|"):
                if not started or not ok:
                    continue
                hex_part = line.split("|", 1)[1].strip()
                if not hex_part:
                    continue
                try:
                    chunks.append(bytes.fromhex(hex_part))
                except Exception:
                    ok = False
                    reason = "invalid_hex_chunk"
                continue

            if line.startswith("SDLOG_END|"):
                ended = True
                fields = _parse_pipe_kv(line)
                end_ok = fields.get("ok", "1" if ok else "0") == "1"
                if not ok:
                    reason = reason or fields.get("reason", "sd_error")
                elif not end_ok:
                    ok = False
                    reason = fields.get("reason", "sd_error")
                break

            continue

        if not started:
            return False, b"", reason or "sdlog_not_started", filename
        if not ok:
            return False, b"", reason or "sdlog_failed", filename
        if not ended:
            return False, b"", reason or "sdlog_incomplete", filename
        return True, b"".join(chunks), "", filename

    except Exception as e:
        return False, b"", f"tcp_error:{e}", filename
    finally:
        if writer is not None:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass


@router.get("/api/device/sd-log")
async def api_device_sd_log(ip: str = "", customer: str = "-", device_id: str = "", token: str = "", kind: str = "activity"):
    customer = (customer or "-").strip() or "-"
    ip = (ip or "").strip()
    device_id = (device_id or "").strip()
    token = (token or "").strip()
    kind_key, _cmd, default_filename = _normalize_sd_log_kind(kind)

    if not (device_id or ip or token):
        raise HTTPException(status_code=400, detail="device identity required")

    now = datetime.now()
    _prune_runtime_cache(now)

    result = await _read_named_sd_log(customer=customer, ip=ip, device_id=device_id, token=token, kind=kind_key)
    st = dict(result.get("st") or {})
    rec = dict(result.get("record") or {})
    resolved_ip = str(result.get("resolved_ip") or "").strip()
    text = bytes(result.get("raw") or b"").decode("utf-8", errors="replace")
    return {
        "ok": True,
        "kind": str(result.get("kind") or kind_key),
        "ip": resolved_ip,
        "customer": str(st.get("customer") or rec.get("customer") or customer),
        "device_id": str(st.get("device_id") or rec.get("device_id") or device_id),
        "token": str(st.get("token") or rec.get("token") or token),
        "filename": str(result.get("filename") or default_filename),
        "size_bytes": len(bytes(result.get("raw") or b"")),
        "source": str(result.get("source") or "server_runtime"),
        "remote_delete_supported": bool(result.get("remote_delete_supported")),
        "text": text,
    }


@router.get("/api/device/sd-log/download")
async def api_device_sd_log_download(ip: str = "", customer: str = "-", device_id: str = "", token: str = "", kind: str = "activity"):
    customer = (customer or "-").strip() or "-"
    ip = (ip or "").strip()
    device_id = (device_id or "").strip()
    token = (token or "").strip()
    kind_key, _cmd, default_filename = _normalize_sd_log_kind(kind)

    if not (device_id or ip or token):
        raise HTTPException(status_code=400, detail="device identity required")

    now = datetime.now()
    _prune_runtime_cache(now)

    result = await _read_named_sd_log(customer=customer, ip=ip, device_id=device_id, token=token, kind=kind_key)
    raw = bytes(result.get("raw") or b"")
    filename = str(result.get("filename") or default_filename)
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return Response(content=raw, media_type="text/plain; charset=utf-8", headers=headers)


@router.post("/api/device/sd-log/delete")
async def api_device_sd_log_delete(payload: dict[str, Any] = Body(default={})):
    customer = str(payload.get("customer") or "-").strip() or "-"
    ip = str(payload.get("ip") or "").strip()
    device_id = str(payload.get("device_id") or "").strip()
    token = str(payload.get("token") or "").strip()
    device_name = str(payload.get("device_name") or "").strip()
    kind = str(payload.get("kind") or "activity").strip()
    kind_key, _delete_cmd, default_filename = _normalize_sd_delete_kind(kind)

    now = datetime.now()
    _prune_runtime_cache(now)

    resolved_ip, st, _key = _resolve_device_ip(customer, ip, device_id, token)
    rec = _resolve_device_record_for_logs(customer, (resolved_ip or ip), device_id)
    resolved_ip = str(resolved_ip or rec.get("ip") or ip).strip()
    did = _norm_device_id(str(device_id or rec.get("device_id") or st.get("device_id") or ""))

    resolved_customer = str(st.get("customer") or rec.get("customer") or customer or "-").strip() or "-"
    resolved_name = (
        str(st.get("name") or rec.get("name") or "").strip()
        or str(st.get("device_name") or rec.get("device_name") or "").strip()
        or device_name
        or str(st.get("device_id") or rec.get("device_id") or device_id or did or resolved_ip).strip()
    )

    backup_results: dict[str, dict[str, Any]] = {}
    for fetch_kind in ("activity", "energy"):
        fetch_default_filename = _normalize_sd_log_kind(fetch_kind)[2]
        uploaded_ok = False
        uploaded_raw = b""
        uploaded_filename = fetch_default_filename

        if did:
            uploaded_ok, uploaded_raw, uploaded_filename = _read_uploaded_device_log(did, fetch_kind)

        if uploaded_ok:
            backup_results[fetch_kind] = {
                "ok": True,
                "raw": uploaded_raw,
                "reason": "",
                "filename": uploaded_filename or fetch_default_filename,
                "source": "server_uploaded_raw",
            }
            continue

        if ENABLE_DIRECT_DEVICE_TCP and resolved_ip:
            ok, raw, reason, filename = await _fetch_named_sd_log_via_tcp(resolved_ip, kind=fetch_kind)
            backup_results[fetch_kind] = {
                "ok": ok,
                "raw": raw,
                "reason": reason or "",
                "filename": filename or fetch_default_filename,
                "source": "device_sd" if ok else "",
            }
            continue

        backup_results[fetch_kind] = {
            "ok": False,
            "raw": b"",
            "reason": "file_not_found" if did else ("device_ip_not_found" if not resolved_ip else "direct_device_tcp_disabled"),
            "filename": fetch_default_filename,
            "source": "",
        }

    target_backup = backup_results.get(kind_key) or {}
    if not bool(target_backup.get("ok")):
        return {
            "ok": False,
            "kind": kind_key,
            "reason": f"backup_failed:{target_backup.get('reason') or 'fetch_failed'}",
            "filename": str(target_backup.get("filename") or default_filename),
            "ip": resolved_ip,
            "customer": resolved_customer,
            "device_name": resolved_name,
        }

    compacted_energy_raw = b""
    removed_energy_raw = b""
    if kind_key == "energy":
        compacted_energy_raw, removed_energy_raw = _compact_total_energy_backup(bytes(target_backup.get("raw") or b""))

    backup_dir_rel = os.path.relpath(TRASHCAN_DIR, os.path.dirname(os.path.dirname(__file__)))

    try:
        backup_prefix = _make_trashcan_backup_prefix(resolved_name, resolved_customer)
        backed_up_files: list[str] = []
        backup_missing: list[dict[str, str]] = []

        for fetch_kind in ("activity", "energy"):
            item = backup_results[fetch_kind]
            source_filename = str(item.get("filename") or _normalize_sd_log_kind(fetch_kind)[2])
            if item.get("ok"):
                backup_name = _make_trashcan_backup_name(backup_prefix, source_filename)
                backup_raw = bytes(item.get("raw") or b"")
                if fetch_kind == "energy" and kind_key == "energy":
                    backup_raw = removed_energy_raw
                file_path = os.path.join(TRASHCAN_DIR, backup_name)
                with open(file_path, "wb") as f:
                    f.write(backup_raw)
                backed_up_files.append(backup_name)
            else:
                backup_missing.append(
                    {
                        "kind": fetch_kind,
                        "filename": source_filename,
                        "reason": str(item.get("reason") or "fetch_failed"),
                    }
                )
    except Exception as e:
        return {
            "ok": False,
            "kind": kind_key,
            "reason": f"backup_write_failed:{e}",
            "filename": str(target_backup.get("filename") or default_filename),
            "ip": resolved_ip,
            "customer": resolved_customer,
            "device_name": resolved_name,
            "backup_dir": backup_dir_rel,
        }

    target_source = str(target_backup.get("source") or "")
    if target_source == "server_uploaded_raw":
        if kind_key == "energy":
            delete_ok, deleted_filename, delete_reason = _write_uploaded_device_log(did, kind_key, compacted_energy_raw)
        else:
            delete_ok, deleted_filename, delete_reason = _delete_uploaded_device_log(did, kind_key)
    else:
        if not ENABLE_DIRECT_DEVICE_TCP:
            return {
                "ok": False,
                "kind": kind_key,
                "reason": "direct_device_tcp_disabled",
                "filename": default_filename,
                "ip": resolved_ip,
                "customer": resolved_customer,
                "device_name": resolved_name,
                "backup_dir": backup_dir_rel,
                "backed_up_files": backed_up_files,
                "backup_missing": backup_missing,
            }
        if not resolved_ip:
            return {
                "ok": False,
                "kind": kind_key,
                "reason": "device_ip_not_found",
                "filename": default_filename,
                "ip": resolved_ip,
                "customer": resolved_customer,
                "device_name": resolved_name,
                "backup_dir": backup_dir_rel,
                "backed_up_files": backed_up_files,
                "backup_missing": backup_missing,
            }
        delete_ok, delete_reason, deleted_filename = await _delete_named_sd_log_via_tcp(resolved_ip, kind=kind_key)

    if not delete_ok:
        return {
            "ok": False,
            "kind": kind_key,
            "reason": delete_reason or "delete_failed",
            "filename": deleted_filename or default_filename,
            "ip": resolved_ip,
            "customer": resolved_customer,
            "device_name": resolved_name,
            "backup_dir": backup_dir_rel,
            "backed_up_files": backed_up_files,
            "backup_missing": backup_missing,
        }

    return {
        "ok": True,
        "kind": kind_key,
        "action": "compacted" if kind_key == "energy" else "deleted",
        "filename": deleted_filename or default_filename,
        "ip": resolved_ip,
        "customer": resolved_customer,
        "device_name": resolved_name,
        "backup_dir": backup_dir_rel,
        "backed_up_files": backed_up_files,
        "backup_missing": backup_missing,
    }


@router.get("/api/device/tail")
def api_device_tail(ip: str = "", customer: str = "-", cursor: int = 0, device_id: str = "", token: str = ""):
    customer = (customer or "-").strip() or "-"
    ip = (ip or "").strip()
    device_id = (device_id or "").strip()
    token = (token or "").strip()

    now = datetime.now()
    _prune_runtime_cache(now)
    skip_history = cursor < 0

    key = _resolve_runtime_key(customer, ip, device_id, token)

    if not key:
        raise HTTPException(status_code=400, detail="device_id or ip required")

    st = _DEVICE_STATE.get(key) or {}
    did = _norm_device_id(str(st.get("device_id") or device_id))

    last_seen_dt = st.get("last_seen")
    if not last_seen_dt:
        last_seen_dt = _parse_runtime_dt(st.get("last_seen_at"))
    parse_ok = bool(st.get("parse_ok", True))
    status = _status_of(now, last_seen_dt, parse_ok)

    try:
        db_tail = device_ops_repo.tail_runtime_logs(device_id=did, cursor=cursor, limit=200) if did else {"logs": [], "next_cursor": 0}
    except Exception:
        db_tail = {"logs": [], "next_cursor": 0}

    resp_logs = list(db_tail.get("logs") or [])
    next_cursor = int(db_tail.get("next_cursor") or 0)

    if skip_history and did:
        return {
            "ok": True,
            "customer": str(st.get("customer") or customer),
            "ip": str(st.get("ip") or ip),
            "device_id": did,
            "token": str(st.get("token") or token),
            "status": status,
            "last_seen": _fmt(last_seen_dt) if last_seen_dt else "-",
            "power": str(st.get("power") or "-"),
            "time_sec": str(st.get("time_sec") or "-"),
            "sd_inserted": _payload_bool(st.get("sd_inserted"), False),
            "sd_total_mb": _payload_mb(st.get("sd_total_mb"), 0.0),
            "sd_used_mb": _payload_mb(st.get("sd_used_mb"), 0.0),
            "sd_free_mb": _payload_mb(st.get("sd_free_mb"), 0.0),
            "logs": [],
            "next_cursor": next_cursor,
        }

    if not resp_logs:
        logs = _DEVICE_LOGS.get(key) or []
        if cursor < 0:
            cursor = len(logs)
        if cursor > len(logs):
            cursor = len(logs)
        tail = logs[cursor:]
        if len(tail) > 200:
            tail = tail[-200:]
        next_cursor = len(logs)
        resp_logs = []
        for row in tail:
            t = row.get("t")
            try:
                t_str = t.strftime("%H:%M:%S") if t else ""
            except Exception:
                t_str = ""
            resp_logs.append({"t": t_str, "line": str(row.get("line") or "")})

    return {
        "ok": True,
        "customer": str(st.get("customer") or customer),
        "ip": str(st.get("ip") or ip),
        "device_id": did,
        "token": str(st.get("token") or token),
        "status": status,
        "last_seen": _fmt(last_seen_dt) if last_seen_dt else "-",
        "power": str(st.get("power") or "-"),
        "time_sec": str(st.get("time_sec") or "-"),
        "sd_inserted": _payload_bool(st.get("sd_inserted"), False),
        "sd_total_mb": _payload_mb(st.get("sd_total_mb"), 0.0),
        "sd_used_mb": _payload_mb(st.get("sd_used_mb"), 0.0),
        "sd_free_mb": _payload_mb(st.get("sd_free_mb"), 0.0),
        "logs": resp_logs,
        "next_cursor": next_cursor,
    }
