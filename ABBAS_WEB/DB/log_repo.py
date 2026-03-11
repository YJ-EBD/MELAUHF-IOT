from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List

from .runtime import get_mysql
from .utils import sha256_hex


def append_log(device: str, type_: str, message: str, *, time: datetime | None = None) -> None:
    device = (device or "-").strip() or "-"
    type_ = (type_ or "정보").strip() or "정보"
    message = (message or "").strip()
    time = time or datetime.now()

    # Used only for migration idempotency / optional dedupe. Runtime logs still insert...
    row_hash = sha256_hex(f"{time.strftime('%Y-%m-%d %H:%M:%S')}|{device}|{type_}|{message}")

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT IGNORE INTO server_logs (time, device, type, message, row_hash, created_at)
                VALUES (%s, %s, %s, %s, %s, NOW())
                """,
                (time.strftime("%Y-%m-%d %H:%M:%S"), device, type_, message, row_hash),
            )


def read_logs(limit: int = 200, device: str = "", type_: str = "") -> List[Dict[str, str]]:
    device = (device or "").strip()
    type_ = (type_ or "").strip()
    limit = max(int(limit or 200), 1)

    wh = []
    params: list[Any] = []
    if device:
        wh.append("device=%s")
        params.append(device)
    if type_:
        wh.append("type=%s")
        params.append(type_)
    where_sql = ("WHERE " + " AND ".join(wh)) if wh else ""

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                  DATE_FORMAT(time, '%%Y-%%m-%%d %%H:%%i:%%s') AS time,
                  device, type, message
                FROM server_logs
                {where_sql}
                ORDER BY id DESC
                LIMIT %s
                """,
                tuple(params + [limit]),
            )
            rows = cur.fetchall() or []

    out: List[Dict[str, str]] = []
    for r in rows:
        out.append(
            {
                "time": str(r.get("time") or "").strip(),
                "device": str(r.get("device") or "").strip(),
                "type": str(r.get("type") or "").strip(),
                "message": str(r.get("message") or "").strip(),
            }
        )
    return out
