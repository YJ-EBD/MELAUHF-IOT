from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from .runtime import get_mysql


_SCHEMA_READY = False


def _norm_device_id(v: str) -> str:
    s = (v or "").strip().lower()
    if not s:
        return ""
    hex_only = "".join(ch for ch in s if ch in "0123456789abcdef")
    if len(hex_only) == 12:
        return ":".join(hex_only[i : i + 2] for i in range(0, 12, 2))
    return s


def _ensure_schema_with_cur(cur) -> None:
    global _SCHEMA_READY
    if _SCHEMA_READY:
        return

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS device_commands (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          device_id VARCHAR(64) NOT NULL,
          customer VARCHAR(128) NOT NULL DEFAULT '-',
          command VARCHAR(255) NOT NULL,
          status VARCHAR(16) NOT NULL DEFAULT 'queued',
          queued_by VARCHAR(64) NULL,
          queued_via VARCHAR(16) NOT NULL DEFAULT 'web',
          queued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          dispatched_at DATETIME NULL,
          acked_at DATETIME NULL,
          result_ok TINYINT(1) NULL,
          result_message TEXT NULL,
          payload_json LONGTEXT NULL,
          PRIMARY KEY (id),
          KEY idx_device_commands_pending (device_id, status, id),
          KEY idx_device_commands_recent (device_id, id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS device_runtime_logs (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          device_id VARCHAR(64) NOT NULL,
          customer VARCHAR(128) NOT NULL DEFAULT '-',
          ip VARCHAR(45) NOT NULL DEFAULT '',
          level VARCHAR(16) NOT NULL DEFAULT 'info',
          source VARCHAR(24) NOT NULL DEFAULT 'device',
          line TEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_device_runtime_logs_recent (device_id, id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )
    _SCHEMA_READY = True


def ensure_schema() -> None:
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)


def queue_command(
    *,
    device_id: str,
    customer: str,
    command: str,
    queued_by: str = "",
    queued_via: str = "web",
    payload_json: str = "",
) -> Dict[str, Any]:
    did = _norm_device_id(device_id)
    customer = (customer or "-").strip() or "-"
    command = (command or "").strip()
    queued_by = (queued_by or "").strip()
    queued_via = (queued_via or "web").strip() or "web"
    payload_json = (payload_json or "").strip()

    if not did:
        raise ValueError("device_id required")
    if not command:
        raise ValueError("command required")

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                INSERT INTO device_commands (
                  device_id, customer, command, status, queued_by, queued_via, queued_at, payload_json
                )
                VALUES (%s, %s, %s, 'queued', %s, %s, NOW(), %s)
                """,
                (did, customer, command, queued_by or None, queued_via, payload_json or None),
            )
            cmd_id = int(cur.lastrowid)
            cur.execute(
                """
                SELECT
                  id, device_id, customer, command, status,
                  COALESCE(queued_by, '') AS queued_by,
                  COALESCE(queued_via, '') AS queued_via,
                  DATE_FORMAT(queued_at, '%%Y-%%m-%%d %%H:%%i:%%s') AS queued_at,
                  DATE_FORMAT(dispatched_at, '%%Y-%%m-%%d %%H:%%i:%%s') AS dispatched_at,
                  DATE_FORMAT(acked_at, '%%Y-%%m-%%d %%H:%%i:%%s') AS acked_at,
                  COALESCE(result_ok, NULL) AS result_ok,
                  COALESCE(result_message, '') AS result_message
                FROM device_commands
                WHERE id=%s
                LIMIT 1
                """,
                (cmd_id,),
            )
            return cur.fetchone() or {"id": cmd_id, "device_id": did, "customer": customer, "command": command}


def peek_pending_command(*, device_id: str) -> Optional[Dict[str, Any]]:
    did = _norm_device_id(device_id)
    if not did:
        return None

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                SELECT
                  id, device_id, customer, command, status,
                  COALESCE(queued_by, '') AS queued_by,
                  COALESCE(queued_via, '') AS queued_via,
                  DATE_FORMAT(queued_at, '%%Y-%%m-%%d %%H:%%i:%%s') AS queued_at,
                  DATE_FORMAT(dispatched_at, '%%Y-%%m-%%d %%H:%%i:%%s') AS dispatched_at,
                  DATE_FORMAT(acked_at, '%%Y-%%m-%%d %%H:%%i:%%s') AS acked_at,
                  COALESCE(result_ok, NULL) AS result_ok,
                  COALESCE(result_message, '') AS result_message
                FROM device_commands
                WHERE device_id=%s
                  AND status IN ('queued', 'dispatched')
                ORDER BY id ASC
                LIMIT 1
                """,
                (did,),
            )
            row = cur.fetchone()
            if not row:
                return None
            if str(row.get("status") or "") == "queued":
                cur.execute(
                    """
                    UPDATE device_commands
                    SET status='dispatched', dispatched_at=COALESCE(dispatched_at, NOW())
                    WHERE id=%s
                    """,
                    (int(row["id"]),),
                )
                row["status"] = "dispatched"
                row["dispatched_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            return row


def complete_command(
    *,
    command_id: int,
    device_id: str,
    ok: bool,
    result_message: str = "",
) -> bool:
    did = _norm_device_id(device_id)
    if not did:
        return False
    try:
        cmd_id = int(command_id)
    except Exception:
        return False
    if cmd_id <= 0:
        return False

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                UPDATE device_commands
                SET
                  status=%s,
                  acked_at=NOW(),
                  result_ok=%s,
                  result_message=%s
                WHERE id=%s AND device_id=%s
                """,
                ("acked" if ok else "failed", 1 if ok else 0, (result_message or "").strip() or None, cmd_id, did),
            )
            return cur.rowcount > 0


def append_runtime_log(
    *,
    device_id: str,
    customer: str,
    ip: str,
    line: str,
    level: str = "info",
    source: str = "device",
    created_at: Optional[datetime] = None,
) -> None:
    did = _norm_device_id(device_id)
    line = (line or "").strip()
    if not did or not line:
        return

    customer = (customer or "-").strip() or "-"
    ip = (ip or "").strip()
    level = (level or "info").strip() or "info"
    source = (source or "device").strip() or "device"
    created_at = created_at or datetime.now()

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                INSERT INTO device_runtime_logs (
                  device_id, customer, ip, level, source, line, created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (did, customer, ip, level, source, line, created_at.strftime("%Y-%m-%d %H:%M:%S")),
            )


def tail_runtime_logs(*, device_id: str, cursor: int = 0, limit: int = 200) -> Dict[str, Any]:
    did = _norm_device_id(device_id)
    try:
        cursor_id = int(cursor or 0)
    except Exception:
        cursor_id = 0
    limit = max(min(int(limit or 200), 500), 1)

    if not did:
        return {"logs": [], "next_cursor": max(cursor_id, 0)}

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)

            if cursor_id < 0:
                cur.execute(
                    """
                    SELECT COALESCE(MAX(id), 0) AS max_id
                    FROM device_runtime_logs
                    WHERE device_id=%s
                    """,
                    (did,),
                )
                row = cur.fetchone() or {}
                return {"logs": [], "next_cursor": int(row.get("max_id") or 0)}

            if cursor_id <= 0:
                cur.execute(
                    """
                    SELECT
                      id,
                      DATE_FORMAT(created_at, '%%H:%%i:%%s') AS t,
                      line
                    FROM (
                      SELECT id, created_at, line
                      FROM device_runtime_logs
                      WHERE device_id=%s
                      ORDER BY id DESC
                      LIMIT %s
                    ) q
                    ORDER BY id ASC
                    """,
                    (did, limit),
                )
            else:
                cur.execute(
                    """
                    SELECT
                      id,
                      DATE_FORMAT(created_at, '%%H:%%i:%%s') AS t,
                      line
                    FROM device_runtime_logs
                    WHERE device_id=%s AND id > %s
                    ORDER BY id ASC
                    LIMIT %s
                    """,
                    (did, cursor_id, limit),
                )
            rows = cur.fetchall() or []

    next_cursor = cursor_id
    logs: List[Dict[str, Any]] = []
    for row in rows:
        log_id = int(row.get("id") or 0)
        if log_id > next_cursor:
            next_cursor = log_id
        logs.append({"id": log_id, "t": str(row.get("t") or "").strip(), "line": str(row.get("line") or "")})
    return {"logs": logs, "next_cursor": next_cursor}
