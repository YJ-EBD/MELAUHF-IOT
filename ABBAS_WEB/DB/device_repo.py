from __future__ import annotations

import calendar
import math
import os
import secrets
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from .runtime import get_mysql
from .utils import safe_str


SUB_STATUS_ACTIVE = "활성"
SUB_STATUS_EXPIRED = "만료"
# Legacy alias: historical "제한" is treated as "만료".
SUB_STATUS_RESTRICTED = SUB_STATUS_EXPIRED
SUB_STATUS_SET = {SUB_STATUS_ACTIVE, SUB_STATUS_EXPIRED}

SUB_PLAN_TEST = "Test Plan"
SUB_PLAN_MONTHS: Dict[str, int] = {
    "BASIC 6M": 6,
    "BASIC 9M": 9,
    "BASIC 1Y": 12,
}
# [NEW FEATURE] Fixed included energy(J) by plan for legacy rows missing sub_energy_j.
SUB_PLAN_FIXED_ENERGY_J: Dict[str, int] = {
    "BASIC 6M": 22_000_000,
    "BASIC 9M": 14_000_000,
    "BASIC 1Y": 8_000_000,
}
SUB_PLAN_ALLOWED = set(SUB_PLAN_MONTHS.keys()) | {SUB_PLAN_TEST}

TEST_PLAN_MIN_MINUTES = 1
TEST_PLAN_MAX_MINUTES = 525_600

_SUB_SCHEMA_READY = False
ALLOW_AUTO_PROVISION = (os.getenv("ABBAS_ALLOW_AUTO_PROVISION", "0").strip() == "1")


def _norm_device_id(v: str) -> str:
    """Normalize MAC/device_id to lowercase colon format."""
    s = (v or "").strip().lower()
    if not s:
        return ""
    hex_only = "".join(ch for ch in s if ch in "0123456789abcdef")
    if len(hex_only) == 12:
        return ":".join(hex_only[i : i + 2] for i in range(0, 12, 2))
    return s


def _date_only(dt: Any) -> str:
    if isinstance(dt, datetime):
        return dt.date().isoformat()
    return ""


def _datetime_text(dt: Any) -> str:
    if isinstance(dt, datetime):
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    return ""


def _normalize_status(v: str) -> str:
    s = (v or "").strip()
    if s in SUB_STATUS_SET:
        return s
    return SUB_STATUS_EXPIRED


def _add_months(dt: datetime, months: int) -> datetime:
    year = dt.year + ((dt.month - 1 + months) // 12)
    month = ((dt.month - 1 + months) % 12) + 1
    max_day = calendar.monthrange(year, month)[1]
    day = min(dt.day, max_day)
    return dt.replace(year=year, month=month, day=day)


def _remaining_days(now: datetime, expiry_at: Optional[datetime]) -> int:
    if not expiry_at:
        return 0
    sec = (expiry_at - now).total_seconds()
    if sec <= 0:
        return 0
    return int(math.ceil(sec / 86400.0))


def _status_code(kor_status: str) -> str:
    if kor_status == SUB_STATUS_ACTIVE:
        return "active"
    return "expired"


def _columns_of_devices(cur) -> set[str]:
    cur.execute("SHOW COLUMNS FROM devices")
    rows = cur.fetchall() or []
    return {safe_str(r.get("Field")) for r in rows}


def _indexes_of_devices(cur) -> Dict[str, Dict[str, Any]]:
    cur.execute("SHOW INDEX FROM devices")
    rows = cur.fetchall() or []
    out: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        key_name = safe_str(row.get("Key_name"))
        if not key_name:
            continue
        slot = out.setdefault(key_name, {"non_unique": 1, "columns": []})
        try:
            slot["non_unique"] = int(row.get("Non_unique") or 1)
        except Exception:
            slot["non_unique"] = 1
        col_name = safe_str(row.get("Column_name"))
        if col_name:
            slot["columns"].append(col_name)
    return out


def _ensure_subscription_schema_with_cur(cur) -> None:
    global _SUB_SCHEMA_READY
    if _SUB_SCHEMA_READY:
        return

    cols = _columns_of_devices(cur)
    ddls: list[str] = []
    if "sub_status" not in cols:
        ddls.append("ADD COLUMN sub_status VARCHAR(16) NOT NULL DEFAULT '만료' AFTER token")
    if "sub_plan" not in cols:
        ddls.append("ADD COLUMN sub_plan VARCHAR(32) NULL AFTER sub_status")
    if "sub_start_at" not in cols:
        ddls.append("ADD COLUMN sub_start_at DATETIME NULL AFTER sub_plan")
    if "sub_expiry_at" not in cols:
        ddls.append("ADD COLUMN sub_expiry_at DATETIME NULL AFTER sub_start_at")
    if "sub_custom_minutes" not in cols:
        ddls.append("ADD COLUMN sub_custom_minutes INT NULL AFTER sub_expiry_at")
    # [NEW FEATURE] Persist assigned subscription energy value (J).
    if "sub_energy_j" not in cols:
        ddls.append("ADD COLUMN sub_energy_j BIGINT NULL AFTER sub_custom_minutes")
    if "lifecycle_status" not in cols:
        ddls.append("ADD COLUMN lifecycle_status VARCHAR(16) NOT NULL DEFAULT 'active' AFTER device_id")
    if "first_seen_at" not in cols:
        ddls.append("ADD COLUMN first_seen_at DATETIME NULL AFTER lifecycle_status")
    if "last_seen_at" not in cols:
        ddls.append("ADD COLUMN last_seen_at DATETIME NULL AFTER first_seen_at")
    if "last_heartbeat_at" not in cols:
        ddls.append("ADD COLUMN last_heartbeat_at DATETIME NULL AFTER last_seen_at")
    if "last_register_at" not in cols:
        ddls.append("ADD COLUMN last_register_at DATETIME NULL AFTER last_heartbeat_at")
    if "last_subscription_sync_at" not in cols:
        ddls.append("ADD COLUMN last_subscription_sync_at DATETIME NULL AFTER last_register_at")
    if "last_contact_kind" not in cols:
        ddls.append("ADD COLUMN last_contact_kind VARCHAR(24) NULL AFTER last_subscription_sync_at")
    if "last_public_ip" not in cols:
        ddls.append("ADD COLUMN last_public_ip VARCHAR(45) NULL AFTER last_contact_kind")
    if "last_fw" not in cols:
        ddls.append("ADD COLUMN last_fw VARCHAR(64) NULL AFTER last_public_ip")
    if "last_parse_ok" not in cols:
        ddls.append("ADD COLUMN last_parse_ok TINYINT(1) NOT NULL DEFAULT 1 AFTER last_fw")
    if "last_power" not in cols:
        ddls.append("ADD COLUMN last_power VARCHAR(32) NULL AFTER last_parse_ok")
    if "last_time_sec" not in cols:
        ddls.append("ADD COLUMN last_time_sec VARCHAR(32) NULL AFTER last_power")
    if "last_line" not in cols:
        ddls.append("ADD COLUMN last_line TEXT NULL AFTER last_time_sec")
    if "sd_inserted" not in cols:
        ddls.append("ADD COLUMN sd_inserted TINYINT(1) NOT NULL DEFAULT 0 AFTER last_line")
    if "sd_total_mb" not in cols:
        ddls.append("ADD COLUMN sd_total_mb DOUBLE NOT NULL DEFAULT 0 AFTER sd_inserted")
    if "sd_used_mb" not in cols:
        ddls.append("ADD COLUMN sd_used_mb DOUBLE NOT NULL DEFAULT 0 AFTER sd_total_mb")
    if "sd_free_mb" not in cols:
        ddls.append("ADD COLUMN sd_free_mb DOUBLE NOT NULL DEFAULT 0 AFTER sd_used_mb")
    if "used_energy_j" not in cols:
        ddls.append("ADD COLUMN used_energy_j BIGINT NOT NULL DEFAULT 0 AFTER sd_free_mb")
    if "telemetry_count" not in cols:
        ddls.append("ADD COLUMN telemetry_count BIGINT NOT NULL DEFAULT 0 AFTER used_energy_j")

    for ddl in ddls:
        cur.execute(f"ALTER TABLE devices {ddl}")

    idx = _indexes_of_devices(cur)
    legacy_customer_ip_idx = idx.get("uq_devices_customer_ip")
    if legacy_customer_ip_idx and int(legacy_customer_ip_idx.get("non_unique") or 1) == 0:
        try:
            cur.execute("ALTER TABLE devices DROP INDEX uq_devices_customer_ip")
        except Exception:
            pass

    # Legacy cleanup: "제한" status is fully migrated to "만료".
    try:
        cur.execute("UPDATE devices SET sub_status='만료' WHERE sub_status='제한'")
    except Exception:
        pass

    try:
        cur.execute("CREATE INDEX idx_devices_sub_status ON devices (sub_status)")
    except Exception:
        pass
    try:
        cur.execute("CREATE INDEX idx_devices_customer_ip ON devices (customer, ip)")
    except Exception:
        pass
    try:
        cur.execute("CREATE INDEX idx_devices_last_seen_at ON devices (last_seen_at)")
    except Exception:
        pass

    _SUB_SCHEMA_READY = True


def ensure_runtime_schema() -> None:
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_subscription_schema_with_cur(cur)


def _select_devices_with_sub_cur(cur) -> List[Dict[str, Any]]:
    _ensure_subscription_schema_with_cur(cur)
    cur.execute(
        """
        SELECT
          id,
          COALESCE(name, '') AS name,
          COALESCE(ip, '') AS ip,
          COALESCE(customer, '-') AS customer,
          COALESCE(token, '') AS token,
          COALESCE(device_id, '') AS device_id,
          COALESCE(lifecycle_status, 'active') AS lifecycle_status,
          COALESCE(sub_status, '만료') AS sub_status,
          COALESCE(sub_plan, '') AS sub_plan,
          sub_start_at,
          sub_expiry_at,
          sub_custom_minutes,
          sub_energy_j,
          first_seen_at,
          last_seen_at,
          last_heartbeat_at,
          last_register_at,
          last_subscription_sync_at,
          COALESCE(last_contact_kind, '') AS last_contact_kind,
          COALESCE(last_public_ip, '') AS last_public_ip,
          COALESCE(last_fw, '') AS last_fw,
          COALESCE(last_parse_ok, 1) AS last_parse_ok,
          COALESCE(last_power, '') AS last_power,
          COALESCE(last_time_sec, '') AS last_time_sec,
          COALESCE(last_line, '') AS last_line,
          COALESCE(sd_inserted, 0) AS sd_inserted,
          COALESCE(sd_total_mb, 0) AS sd_total_mb,
          COALESCE(sd_used_mb, 0) AS sd_used_mb,
          COALESCE(sd_free_mb, 0) AS sd_free_mb,
          COALESCE(used_energy_j, 0) AS used_energy_j,
          COALESCE(telemetry_count, 0) AS telemetry_count
        FROM devices
        ORDER BY customer ASC, name ASC, ip ASC
        """
    )
    return cur.fetchall() or []


def _select_device_with_sub_by_device_id_cur(cur, device_id: str, for_update: bool = False) -> Optional[Dict[str, Any]]:
    _ensure_subscription_schema_with_cur(cur)
    tail = " FOR UPDATE" if for_update else ""
    cur.execute(
        f"""
        SELECT
          id,
          COALESCE(name, '') AS name,
          COALESCE(ip, '') AS ip,
          COALESCE(customer, '-') AS customer,
          COALESCE(token, '') AS token,
          COALESCE(device_id, '') AS device_id,
          COALESCE(lifecycle_status, 'active') AS lifecycle_status,
          COALESCE(sub_status, '만료') AS sub_status,
          COALESCE(sub_plan, '') AS sub_plan,
          sub_start_at,
          sub_expiry_at,
          sub_custom_minutes,
          sub_energy_j,
          first_seen_at,
          last_seen_at,
          last_heartbeat_at,
          last_register_at,
          last_subscription_sync_at,
          COALESCE(last_contact_kind, '') AS last_contact_kind,
          COALESCE(last_public_ip, '') AS last_public_ip,
          COALESCE(last_fw, '') AS last_fw,
          COALESCE(last_parse_ok, 1) AS last_parse_ok,
          COALESCE(last_power, '') AS last_power,
          COALESCE(last_time_sec, '') AS last_time_sec,
          COALESCE(last_line, '') AS last_line,
          COALESCE(sd_inserted, 0) AS sd_inserted,
          COALESCE(sd_total_mb, 0) AS sd_total_mb,
          COALESCE(sd_used_mb, 0) AS sd_used_mb,
          COALESCE(sd_free_mb, 0) AS sd_free_mb,
          COALESCE(used_energy_j, 0) AS used_energy_j,
          COALESCE(telemetry_count, 0) AS telemetry_count
        FROM devices
        WHERE device_id = %s
        LIMIT 1
        {tail}
        """,
        (device_id,),
    )
    return cur.fetchone()


def _normalize_sub_record(row: Dict[str, Any], now: datetime) -> Dict[str, Any]:
    raw_status = _normalize_status(safe_str(row.get("sub_status")))
    plan = safe_str(row.get("sub_plan"))
    start_at = row.get("sub_start_at")
    expiry_at = row.get("sub_expiry_at")
    try:
        used_energy_j = int(row.get("used_energy_j") or 0)
    except Exception:
        used_energy_j = 0

    energy_raw = row.get("sub_energy_j")
    try:
        energy_j = int(energy_raw or 0)
    except Exception:
        energy_j = 0
    if energy_j <= 0 and plan in SUB_PLAN_FIXED_ENERGY_J:
        energy_j = int(SUB_PLAN_FIXED_ENERGY_J.get(plan, 0))

    status = raw_status
    if status == SUB_STATUS_ACTIVE:
        if not isinstance(expiry_at, datetime):
            status = SUB_STATUS_EXPIRED
        elif expiry_at <= now:
            status = SUB_STATUS_EXPIRED
        elif energy_j > 0 and used_energy_j >= energy_j:
            status = SUB_STATUS_EXPIRED

    rem_days = _remaining_days(now, expiry_at if isinstance(expiry_at, datetime) else None)

    return {
        "status": status,
        "status_code": _status_code(status),
        "plan": plan,
        "start_date": _date_only(start_at),
        "expiry_date": _date_only(expiry_at),
        "remaining_days": rem_days,
        "custom_duration_minutes": row.get("sub_custom_minutes"),
        # [NEW FEATURE] Assigned energy for the current plan.
        "energy_j": energy_j,
        "needs_status_sync": status != raw_status,
    }


def _sync_status_if_needed(cur, pk: int, status: str, *, update_time: bool = False) -> None:
    if update_time:
        cur.execute("UPDATE devices SET sub_status=%s, updated_at=NOW() WHERE id=%s", (status, pk))
    else:
        cur.execute("UPDATE devices SET sub_status=%s WHERE id=%s", (status, pk))


def _shape_subscription_response(row: Dict[str, Any], sub: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "device_id": _norm_device_id(safe_str(row.get("device_id"))),
        "device_name": safe_str(row.get("name")),
        "status": sub["status"],
        "status_code": sub["status_code"],
        "plan": sub["plan"],
        "start_date": sub["start_date"],
        "expiry_date": sub["expiry_date"],
        "remaining_days": int(sub["remaining_days"] or 0),
        "custom_duration_minutes": sub.get("custom_duration_minutes"),
        # [NEW FEATURE] Expose both snake_case and camelCase for API compatibility.
        "energy_j": int(sub.get("energy_j") or 0),
        "energyJ": int(sub.get("energy_j") or 0),
        "ip": safe_str(row.get("ip")),
        "last_public_ip": safe_str(row.get("last_public_ip")),
        "last_fw": safe_str(row.get("last_fw")),
        "last_seen_at": _datetime_text(row.get("last_seen_at")),
        "used_energy_j": int(row.get("used_energy_j") or 0),
        "usedEnergyJ": int(row.get("used_energy_j") or 0),
        "customer": safe_str(row.get("customer") or "-"),
        "token": safe_str(row.get("token")),
    }


def list_saved_devices() -> List[Dict[str, str]]:
    """Return saved devices with stable legacy keys + subscription fields."""
    db = get_mysql()
    now = datetime.now()
    with db.conn() as conn:
        with conn.cursor() as cur:
            rows = _select_devices_with_sub_cur(cur)
            out: List[Dict[str, str]] = []
            for r in rows:
                sub = _normalize_sub_record(r, now)
                if sub["needs_status_sync"]:
                    _sync_status_if_needed(cur, int(r["id"]), sub["status"])
                out.append(
                    {
                        "name": safe_str(r.get("name")),
                        "ip": safe_str(r.get("ip")),
                        "customer": safe_str(r.get("customer") or "-"),
                        "token": safe_str(r.get("token")),
                        "device_id": _norm_device_id(safe_str(r.get("device_id"))),
                        "subscription_status": safe_str(sub["status"]),
                        "subscription_status_code": safe_str(sub["status_code"]),
                        "subscription_plan": safe_str(sub["plan"]),
                        "subscription_start_date": safe_str(sub["start_date"]),
                        "subscription_expiry_date": safe_str(sub["expiry_date"]),
                        "subscription_remaining_days": str(int(sub["remaining_days"])),
                        "lifecycle_status": safe_str(r.get("lifecycle_status") or "active"),
                        "first_seen_at": _datetime_text(r.get("first_seen_at")),
                        "last_seen_at": _datetime_text(r.get("last_seen_at")),
                        "last_heartbeat_at": _datetime_text(r.get("last_heartbeat_at")),
                        "last_register_at": _datetime_text(r.get("last_register_at")),
                        "last_subscription_sync_at": _datetime_text(r.get("last_subscription_sync_at")),
                        "last_contact_kind": safe_str(r.get("last_contact_kind")),
                        "last_public_ip": safe_str(r.get("last_public_ip")),
                        "last_fw": safe_str(r.get("last_fw")),
                        "last_parse_ok": "1" if bool(r.get("last_parse_ok")) else "0",
                        "last_power": safe_str(r.get("last_power")),
                        "last_time_sec": safe_str(r.get("last_time_sec")),
                        "last_line": safe_str(r.get("last_line")),
                        "sd_inserted": "1" if bool(r.get("sd_inserted")) else "0",
                        "sd_total_mb": safe_str(r.get("sd_total_mb")),
                        "sd_used_mb": safe_str(r.get("sd_used_mb")),
                        "sd_free_mb": safe_str(r.get("sd_free_mb")),
                        "used_energy_j": safe_str(r.get("used_energy_j")),
                        "telemetry_count": safe_str(r.get("telemetry_count")),
                    }
                )
    return out


def list_devices_with_subscription() -> List[Dict[str, Any]]:
    db = get_mysql()
    now = datetime.now()
    with db.conn() as conn:
        with conn.cursor() as cur:
            rows = _select_devices_with_sub_cur(cur)
            out: List[Dict[str, Any]] = []
            for r in rows:
                sub = _normalize_sub_record(r, now)
                if sub["needs_status_sync"]:
                    _sync_status_if_needed(cur, int(r["id"]), sub["status"])
                out.append(_shape_subscription_response(r, sub))
    return out


def get_device_by_device_id(device_id: str) -> Optional[Dict[str, Any]]:
    did = _norm_device_id(device_id)
    if not did:
        return None
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_subscription_schema_with_cur(cur)
            cur.execute(
                """
                SELECT
                  id, name, ip, customer, token, device_id,
                  lifecycle_status,
                  sub_status, sub_plan, sub_start_at, sub_expiry_at, sub_custom_minutes, sub_energy_j,
                  first_seen_at, last_seen_at, last_heartbeat_at, last_register_at, last_subscription_sync_at,
                  last_contact_kind, last_public_ip, last_fw, last_parse_ok, last_power, last_time_sec, last_line,
                  sd_inserted, sd_total_mb, sd_used_mb, sd_free_mb, used_energy_j, telemetry_count
                FROM devices
                WHERE device_id = %s
                LIMIT 1
                """,
                (did,),
            )
            row = cur.fetchone()
    return row


def get_device_by_ip_customer(ip: str, customer: str) -> Optional[Dict[str, Any]]:
    ip = (ip or "").strip()
    customer = (customer or "-").strip() or "-"
    if not ip:
        return None
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_subscription_schema_with_cur(cur)
            cur.execute(
                """
                SELECT
                  id, name, ip, customer, token, device_id,
                  lifecycle_status,
                  sub_status, sub_plan, sub_start_at, sub_expiry_at, sub_custom_minutes, sub_energy_j,
                  first_seen_at, last_seen_at, last_heartbeat_at, last_register_at, last_subscription_sync_at,
                  last_contact_kind, last_public_ip, last_fw, last_parse_ok, last_power, last_time_sec, last_line,
                  sd_inserted, sd_total_mb, sd_used_mb, sd_free_mb, used_energy_j, telemetry_count
                FROM devices
                WHERE ip = %s AND customer = %s
                ORDER BY updated_at DESC, id DESC
                LIMIT 1
                """,
                (ip, customer),
            )
            row = cur.fetchone()
    return row


def _select_device_by_identity_cur(cur, *, device_id: str, ip: str, customer: str, for_update: bool = False) -> Optional[Dict[str, Any]]:
    did = _norm_device_id(device_id)
    ip = (ip or "").strip()
    customer = (customer or "-").strip() or "-"
    tail = " FOR UPDATE" if for_update else ""

    _ensure_subscription_schema_with_cur(cur)

    if did:
        cur.execute(
            f"""
            SELECT
              id,
              COALESCE(name, '') AS name,
              COALESCE(ip, '') AS ip,
              COALESCE(customer, '-') AS customer,
              COALESCE(token, '') AS token,
              COALESCE(device_id, '') AS device_id,
              COALESCE(lifecycle_status, 'active') AS lifecycle_status,
              COALESCE(sub_status, '만료') AS sub_status,
              COALESCE(sub_plan, '') AS sub_plan,
              sub_start_at,
              sub_expiry_at,
              sub_custom_minutes,
              sub_energy_j,
              first_seen_at,
              last_seen_at,
              last_heartbeat_at,
              last_register_at,
              last_subscription_sync_at,
              COALESCE(last_contact_kind, '') AS last_contact_kind,
              COALESCE(last_public_ip, '') AS last_public_ip,
              COALESCE(last_fw, '') AS last_fw,
              COALESCE(last_parse_ok, 1) AS last_parse_ok,
              COALESCE(last_power, '') AS last_power,
              COALESCE(last_time_sec, '') AS last_time_sec,
              COALESCE(last_line, '') AS last_line,
              COALESCE(sd_inserted, 0) AS sd_inserted,
              COALESCE(sd_total_mb, 0) AS sd_total_mb,
              COALESCE(sd_used_mb, 0) AS sd_used_mb,
              COALESCE(sd_free_mb, 0) AS sd_free_mb,
              COALESCE(used_energy_j, 0) AS used_energy_j,
              COALESCE(telemetry_count, 0) AS telemetry_count
            FROM devices
            WHERE device_id = %s
            LIMIT 1
            {tail}
            """,
            (did,),
        )
        row = cur.fetchone()
        if row:
            return row

    if not ip:
        return None

    cur.execute(
        f"""
        SELECT
          id,
          COALESCE(name, '') AS name,
          COALESCE(ip, '') AS ip,
          COALESCE(customer, '-') AS customer,
          COALESCE(token, '') AS token,
          COALESCE(device_id, '') AS device_id,
          COALESCE(lifecycle_status, 'active') AS lifecycle_status,
          COALESCE(sub_status, '만료') AS sub_status,
          COALESCE(sub_plan, '') AS sub_plan,
          sub_start_at,
          sub_expiry_at,
          sub_custom_minutes,
          sub_energy_j,
          first_seen_at,
          last_seen_at,
          last_heartbeat_at,
          last_register_at,
          last_subscription_sync_at,
          COALESCE(last_contact_kind, '') AS last_contact_kind,
          COALESCE(last_public_ip, '') AS last_public_ip,
          COALESCE(last_fw, '') AS last_fw,
          COALESCE(last_parse_ok, 1) AS last_parse_ok,
          COALESCE(last_power, '') AS last_power,
          COALESCE(last_time_sec, '') AS last_time_sec,
          COALESCE(last_line, '') AS last_line,
          COALESCE(sd_inserted, 0) AS sd_inserted,
          COALESCE(sd_total_mb, 0) AS sd_total_mb,
          COALESCE(sd_used_mb, 0) AS sd_used_mb,
          COALESCE(sd_free_mb, 0) AS sd_free_mb,
          COALESCE(used_energy_j, 0) AS used_energy_j,
          COALESCE(telemetry_count, 0) AS telemetry_count
        FROM devices
        WHERE ip = %s AND customer = %s
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
        {tail}
        """,
        (ip, customer),
    )
    return cur.fetchone()


def _resolve_trusted_token(existing_token: str, incoming_token: str) -> str:
    stored = (existing_token or "").strip()
    incoming = (incoming_token or "").strip()
    if not stored:
        if not incoming:
            raise ValueError("token required")
        return incoming
    if not incoming:
        raise ValueError("token required")
    if not secrets.compare_digest(stored, incoming):
        raise ValueError("invalid device token")
    return stored


def _update_runtime_fields_with_cur(
    cur,
    pk: int,
    *,
    name: Optional[str] = None,
    ip: Optional[str] = None,
    customer: Optional[str] = None,
    token: Optional[str] = None,
    device_id: Optional[str] = None,
    lifecycle_status: str = "active",
    public_ip: Optional[str] = None,
    fw: Optional[str] = None,
    parse_ok: Optional[bool] = None,
    power: Optional[str] = None,
    time_sec: Optional[str] = None,
    line: Optional[str] = None,
    sd_inserted: Optional[bool] = None,
    sd_total_mb: Optional[float] = None,
    sd_used_mb: Optional[float] = None,
    sd_free_mb: Optional[float] = None,
    used_energy_j: Optional[int] = None,
    last_contact_kind: Optional[str] = None,
    mark_seen: bool = False,
    mark_heartbeat: bool = False,
    mark_register: bool = False,
    mark_subscription_sync: bool = False,
    increment_telemetry: bool = False,
) -> None:
    set_parts: list[str] = ["updated_at=NOW()", "lifecycle_status=%s"]
    params: list[Any] = [lifecycle_status or "active"]

    if name is not None:
        set_parts.append("name=%s")
        params.append((name or "").strip())
    if ip is not None:
        set_parts.append("ip=%s")
        params.append((ip or "").strip())
    if customer is not None:
        set_parts.append("customer=%s")
        params.append((customer or "-").strip() or "-")
    if token is not None:
        set_parts.append("token=%s")
        params.append((token or "").strip())
    if device_id is not None:
        set_parts.append("device_id=%s")
        params.append(_norm_device_id(device_id) or None)
    if public_ip is not None:
        set_parts.append("last_public_ip=%s")
        params.append((public_ip or "").strip())
    if fw is not None:
        set_parts.append("last_fw=%s")
        params.append((fw or "").strip())
    if parse_ok is not None:
        set_parts.append("last_parse_ok=%s")
        params.append(1 if parse_ok else 0)
    if power is not None:
        set_parts.append("last_power=%s")
        params.append((power or "").strip())
    if time_sec is not None:
        set_parts.append("last_time_sec=%s")
        params.append((time_sec or "").strip())
    if line is not None:
        set_parts.append("last_line=%s")
        params.append(line)
    if sd_inserted is not None:
        set_parts.append("sd_inserted=%s")
        params.append(1 if sd_inserted else 0)
    if sd_total_mb is not None:
        set_parts.append("sd_total_mb=%s")
        params.append(float(sd_total_mb))
    if sd_used_mb is not None:
        set_parts.append("sd_used_mb=%s")
        params.append(float(sd_used_mb))
    if sd_free_mb is not None:
        set_parts.append("sd_free_mb=%s")
        params.append(float(sd_free_mb))
    if used_energy_j is not None:
        set_parts.append("used_energy_j=%s")
        params.append(int(used_energy_j))
    if last_contact_kind is not None:
        set_parts.append("last_contact_kind=%s")
        params.append((last_contact_kind or "").strip() or None)
    if mark_seen:
        set_parts.append("first_seen_at=COALESCE(first_seen_at, NOW())")
        set_parts.append("last_seen_at=NOW()")
    if mark_heartbeat:
        set_parts.append("last_heartbeat_at=NOW()")
    if mark_register:
        set_parts.append("last_register_at=NOW()")
    if mark_subscription_sync:
        set_parts.append("last_subscription_sync_at=NOW()")
    if increment_telemetry:
        set_parts.append("telemetry_count=COALESCE(telemetry_count, 0) + 1")

    params.append(int(pk))
    cur.execute(f"UPDATE devices SET {', '.join(set_parts)} WHERE id=%s", tuple(params))


def _record_device_contact_with_cur(
    cur,
    *,
    name: str,
    ip: str,
    customer: str,
    token: str,
    device_id: str,
    public_ip: str = "",
    fw: str = "",
    parse_ok: Optional[bool] = None,
    power: Optional[str] = None,
    time_sec: Optional[str] = None,
    line: Optional[str] = None,
    sd_inserted: Optional[bool] = None,
    sd_total_mb: Optional[float] = None,
    sd_used_mb: Optional[float] = None,
    sd_free_mb: Optional[float] = None,
    used_energy_j: Optional[int] = None,
    last_contact_kind: str = "heartbeat",
    mark_register: bool = False,
    mark_subscription_sync: bool = False,
    increment_telemetry: bool = False,
) -> Dict[str, Any]:
    did = _norm_device_id(device_id)
    token = (token or "").strip()
    ip = (ip or "").strip()
    customer = (customer or "-").strip() or "-"
    name = (name or "").strip()
    public_ip = (public_ip or "").strip()
    fw = (fw or "").strip()

    if not did:
        raise ValueError("device_id required")
    if not token:
        raise ValueError("token required")
    if not ip:
        raise ValueError("ip required")

    row = _select_device_by_identity_cur(cur, device_id=did, ip=ip, customer=customer, for_update=True)
    existing = row is not None
    if row:
        trusted_token = _resolve_trusted_token(safe_str(row.get("token")), token)
        name_value = name or safe_str(row.get("name")) or ip or did
        ip_value = ip or safe_str(row.get("ip")) or did
        customer_value = customer or safe_str(row.get("customer")) or "-"
        _update_runtime_fields_with_cur(
            cur,
            int(row["id"]),
            name=name_value,
            ip=ip_value,
            customer=customer_value,
            token=trusted_token,
            device_id=did,
            lifecycle_status="active",
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
            last_contact_kind=last_contact_kind,
            mark_seen=True,
            mark_heartbeat=True,
            mark_register=mark_register,
            mark_subscription_sync=mark_subscription_sync,
            increment_telemetry=increment_telemetry,
        )
    else:
        if not ALLOW_AUTO_PROVISION:
            raise ValueError("device not provisioned")
        name_value = name or ip or did
        cur.execute(
            """
            INSERT INTO devices (
              name, ip, customer, token, device_id, lifecycle_status,
              first_seen_at, last_seen_at, last_heartbeat_at, last_register_at, last_subscription_sync_at,
              last_contact_kind, last_public_ip, last_fw, last_parse_ok, last_power, last_time_sec, last_line,
              sd_inserted, sd_total_mb, sd_used_mb, sd_free_mb, used_energy_j, telemetry_count,
              created_at, updated_at
            )
            VALUES (
              %s, %s, %s, %s, %s, 'active',
              NOW(), NOW(), NOW(), %s, %s,
              %s, %s, %s, %s, %s, %s, %s,
              %s, %s, %s, %s, %s, %s,
              NOW(), NOW()
            )
            """,
            (
                name_value,
                ip,
                customer,
                token,
                did,
                datetime.now() if mark_register else None,
                datetime.now() if mark_subscription_sync else None,
                last_contact_kind,
                public_ip or None,
                fw or None,
                1 if (True if parse_ok is None else parse_ok) else 0,
                (power or "") or None,
                (time_sec or "") or None,
                line,
                1 if bool(sd_inserted) else 0,
                float(sd_total_mb or 0.0),
                float(sd_used_mb or 0.0),
                float(sd_free_mb or 0.0),
                int(used_energy_j or 0),
                1 if increment_telemetry else 0,
            ),
        )

    row2 = _select_device_with_sub_by_device_id_cur(cur, did, for_update=False)
    if not row2:
        raise RuntimeError("device upsert failed")
    row2["existing"] = existing
    return row2


def register_device(
    *,
    name: str,
    ip: str,
    customer: str,
    token: str,
    device_id: str,
    public_ip: str = "",
    fw: str = "",
    sd_inserted: bool = False,
    sd_total_mb: float = 0.0,
    sd_used_mb: float = 0.0,
    sd_free_mb: float = 0.0,
    used_energy_j: int = 0,
) -> Dict[str, Any]:
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            return _record_device_contact_with_cur(
                cur,
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
                last_contact_kind="register",
                mark_register=True,
            )


def record_device_heartbeat(
    *,
    name: str,
    ip: str,
    customer: str,
    token: str,
    device_id: str,
    public_ip: str = "",
    fw: str = "",
    sd_inserted: Optional[bool] = None,
    sd_total_mb: Optional[float] = None,
    sd_used_mb: Optional[float] = None,
    sd_free_mb: Optional[float] = None,
    used_energy_j: Optional[int] = None,
) -> Dict[str, Any]:
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            return _record_device_contact_with_cur(
                cur,
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
                last_contact_kind="heartbeat",
            )


def record_device_telemetry(
    *,
    name: str,
    ip: str,
    customer: str,
    token: str,
    device_id: str,
    public_ip: str = "",
    fw: str = "",
    parse_ok: bool,
    power: str,
    time_sec: str,
    line: str,
    sd_inserted: Optional[bool] = None,
    sd_total_mb: Optional[float] = None,
    sd_used_mb: Optional[float] = None,
    sd_free_mb: Optional[float] = None,
    used_energy_j: Optional[int] = None,
) -> Dict[str, Any]:
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            return _record_device_contact_with_cur(
                cur,
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
                last_contact_kind="telemetry",
                increment_telemetry=True,
            )


def mark_subscription_sync(
    *,
    name: str,
    ip: str,
    customer: str,
    token: str,
    device_id: str,
    public_ip: str = "",
    fw: str = "",
) -> Dict[str, Any]:
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            return _record_device_contact_with_cur(
                cur,
                name=name,
                ip=ip,
                customer=customer,
                token=token,
                device_id=device_id,
                public_ip=public_ip,
                fw=fw,
                last_contact_kind="subscription_sync",
                mark_subscription_sync=True,
            )


def get_subscription_by_device_id(device_id: str) -> Optional[Dict[str, Any]]:
    did = _norm_device_id(device_id)
    if not did:
        return None

    db = get_mysql()
    now = datetime.now()
    with db.conn() as conn:
        with conn.cursor() as cur:
            row = _select_device_with_sub_by_device_id_cur(cur, did)
            if not row:
                return None
            sub = _normalize_sub_record(row, now)
            if sub["needs_status_sync"]:
                _sync_status_if_needed(cur, int(row["id"]), sub["status"])
            return _shape_subscription_response(row, sub)


def grant_subscription(
    device_id: str,
    plan: str,
    custom_duration_minutes: Optional[int],
    energy_j: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    did = _norm_device_id(device_id)
    if not did:
        raise ValueError("device_id required")

    plan = (plan or "").strip()
    if plan not in SUB_PLAN_ALLOWED:
        raise ValueError("invalid plan")

    now = datetime.now()
    start_at = now
    expiry_at: datetime
    custom_minutes: Optional[int] = None
    # [NEW FEATURE] Keep assigned energy as integer J for all plan types.
    energy_value: Optional[int] = None

    if plan == SUB_PLAN_TEST:
        if custom_duration_minutes is None:
            raise ValueError("custom_duration_minutes required for Test Plan")
        try:
            custom_minutes = int(custom_duration_minutes)
        except Exception as e:
            raise ValueError("custom_duration_minutes must be integer") from e
        if custom_minutes < TEST_PLAN_MIN_MINUTES or custom_minutes > TEST_PLAN_MAX_MINUTES:
            raise ValueError("custom_duration_minutes out of range")
        expiry_at = now + timedelta(minutes=custom_minutes)
    else:
        months = int(SUB_PLAN_MONTHS[plan])
        expiry_at = _add_months(now, months)

    if energy_j is not None:
        try:
            energy_value = int(energy_j)
        except Exception as e:
            raise ValueError("energyJ must be integer") from e

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            row = _select_device_with_sub_by_device_id_cur(cur, did, for_update=True)
            if not row:
                return None
            cur.execute(
                """
                UPDATE devices
                SET
                  sub_status=%s,
                  sub_plan=%s,
                  sub_start_at=%s,
                  sub_expiry_at=%s,
                  sub_custom_minutes=%s,
                  sub_energy_j=%s,
                  updated_at=NOW()
                WHERE id=%s
                """,
                (SUB_STATUS_ACTIVE, plan, start_at, expiry_at, custom_minutes, energy_value, int(row["id"])),
            )
            row2 = _select_device_with_sub_by_device_id_cur(cur, did, for_update=False)
            if not row2:
                return None
            sub = _normalize_sub_record(row2, datetime.now())
            if sub["needs_status_sync"]:
                _sync_status_if_needed(cur, int(row2["id"]), sub["status"], update_time=True)
            return _shape_subscription_response(row2, sub)


def revoke_subscription(device_id: str) -> Optional[Dict[str, Any]]:
    did = _norm_device_id(device_id)
    if not did:
        raise ValueError("device_id required")

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            row = _select_device_with_sub_by_device_id_cur(cur, did, for_update=True)
            if not row:
                return None
            cur.execute(
                """
                UPDATE devices
                SET
                  sub_status=%s,
                  sub_plan=NULL,
                  sub_start_at=NULL,
                  sub_expiry_at=NULL,
                  sub_custom_minutes=NULL,
                  sub_energy_j=NULL,
                  used_energy_j=0,
                  updated_at=NOW()
                WHERE id=%s
                """,
                (SUB_STATUS_EXPIRED, int(row["id"])),
            )
            row2 = _select_device_with_sub_by_device_id_cur(cur, did, for_update=False)
            if not row2:
                return None
            sub = _normalize_sub_record(row2, datetime.now())
            if sub["needs_status_sync"]:
                _sync_status_if_needed(cur, int(row2["id"]), sub["status"], update_time=True)
            return _shape_subscription_response(row2, sub)


def reset_used_energy(device_id: str) -> bool:
    did = _norm_device_id(device_id)
    if not did:
        raise ValueError("device_id required")

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            row = _select_device_with_sub_by_device_id_cur(cur, did, for_update=True)
            if not row:
                return False
            cur.execute(
                """
                UPDATE devices
                SET used_energy_j=0, updated_at=NOW()
                WHERE id=%s
                """,
                (int(row["id"]),),
            )
            return True


def get_subscription_counts() -> Dict[str, int]:
    db = get_mysql()
    now = datetime.now()
    with db.conn() as conn:
        with conn.cursor() as cur:
            rows = _select_devices_with_sub_cur(cur)
            active = 0
            expired = 0
            for r in rows:
                sub = _normalize_sub_record(r, now)
                if sub["needs_status_sync"]:
                    _sync_status_if_needed(cur, int(r["id"]), sub["status"])
                if sub["status"] == SUB_STATUS_ACTIVE:
                    active += 1
                else:
                    expired += 1

            return {
                "total": len(rows),
                "active": active,
                "expired": expired,
                "restricted": 0,
            }


def upsert_device(*, name: str, ip: str, customer: str, token: str, device_id: str) -> Tuple[int, bool]:
    """Insert or update a device.

    Returns: (device_pk, existing)
    """
    name = (name or "").strip() or (ip or "")
    ip = (ip or "").strip()
    customer = (customer or "-").strip() or "-"
    token = (token or "").strip()
    did = _norm_device_id(device_id)

    if not ip:
        raise ValueError("ip required")

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_subscription_schema_with_cur(cur)
            return _upsert_device_with_cur(cur, name=name, ip=ip, customer=customer, token=token, device_id=did)


def delete_device(*, device_id: str = "", ip: str = "", customer: str = "-") -> bool:
    did = _norm_device_id(device_id)
    ip = (ip or "").strip()
    customer = (customer or "-").strip() or "-"

    if not did and not ip:
        raise ValueError("device_id or ip required")

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            if did:
                cur.execute("DELETE FROM devices WHERE device_id=%s", (did,))
                return cur.rowcount > 0
            cur.execute("DELETE FROM devices WHERE ip=%s AND customer=%s", (ip, customer))
            return cur.rowcount > 0


def replace_all_devices(rows: List[Dict[str, str]]) -> None:
    """Replace saved devices set with the given list.

    Used as a drop-in replacement for legacy "rewrite CSV" behaviour.
    """

    rows = rows or []
    keep_keys = set()

    def _key_of(r: Dict[str, str]) -> str:
        did = _norm_device_id(safe_str(r.get("device_id")))
        if did:
            return f"did:{did}"
        ip0 = safe_str(r.get("ip")).strip()
        cust0 = (safe_str(r.get("customer")) or "-").strip() or "-"
        return f"ip:{cust0}:{ip0}"

    for r in rows:
        keep_keys.add(_key_of(r))

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_subscription_schema_with_cur(cur)
            # Upsert each row (single transaction)
            for r in rows:
                _upsert_device_with_cur(
                    cur,
                    name=safe_str(r.get("name")),
                    ip=safe_str(r.get("ip")),
                    customer=safe_str(r.get("customer")),
                    token=safe_str(r.get("token")),
                    device_id=_norm_device_id(safe_str(r.get("device_id"))),
                )

            # Delete missing
            cur.execute("SELECT id, ip, customer, device_id FROM devices")
            current = cur.fetchall() or []
            for r in current:
                did = _norm_device_id(safe_str(r.get("device_id")))
                ip0 = safe_str(r.get("ip")).strip()
                cust0 = (safe_str(r.get("customer")) or "-").strip() or "-"
                k = f"did:{did}" if did else f"ip:{cust0}:{ip0}"
                if k in keep_keys:
                    continue
                cur.execute("DELETE FROM devices WHERE id=%s", (r["id"],))


def _upsert_device_with_cur(cur, *, name: str, ip: str, customer: str, token: str, device_id: str) -> Tuple[int, bool]:
    """Internal upsert that reuses an existing cursor/transaction."""

    name = (name or "").strip() or (ip or "")
    ip = (ip or "").strip()
    customer = (customer or "-").strip() or "-"
    token = (token or "").strip()
    did = _norm_device_id(device_id)

    if not ip:
        raise ValueError("ip required")

    # 1) Prefer device_id match
    existing = None
    if did:
        cur.execute("SELECT id FROM devices WHERE device_id=%s LIMIT 1", (did,))
        existing = cur.fetchone()

    if existing:
        pk = int(existing["id"])
        cur.execute(
            """
            UPDATE devices
            SET name=%s, ip=%s, customer=%s, token=%s, updated_at=NOW()
            WHERE id=%s
            """,
            (name, ip, customer, token, pk),
        )
        return pk, True

    # 2) Fallback: customer+ip match (legacy rows might have empty device_id)
    cur.execute("SELECT id FROM devices WHERE ip=%s AND customer=%s ORDER BY updated_at DESC, id DESC LIMIT 1", (ip, customer))
    existing = cur.fetchone()
    if existing:
        pk = int(existing["id"])
        cur.execute(
            """
            UPDATE devices
            SET name=%s, token=%s, device_id=%s, updated_at=NOW()
            WHERE id=%s
            """,
            (name, token, did or None, pk),
        )
        return pk, True

    # 3) Insert new
    cur.execute(
        """
        INSERT INTO devices (name, ip, customer, token, device_id, created_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, NOW(), NOW())
        """,
        (name, ip, customer, token, did or None),
    )
    pk = int(cur.lastrowid)
    return pk, False
