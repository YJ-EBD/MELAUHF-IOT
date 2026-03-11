from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from .runtime import get_mysql
from .utils import parse_saved_at_kst, safe_str, sha256_hex


def _norm_device_id(v: str) -> str:
    s = (v or "").strip().lower()
    if not s:
        return ""
    hex_only = "".join(ch for ch in s if ch in "0123456789abcdef")
    if len(hex_only) == 12:
        return ":".join(hex_only[i : i + 2] for i in range(0, 12, 2))
    return s


def _get_device_pk(cur, device_id: str) -> Optional[int]:
    did = _norm_device_id(device_id)
    if not did:
        return None
    cur.execute("SELECT id FROM devices WHERE device_id=%s LIMIT 1", (did,))
    row = cur.fetchone()
    if not row:
        return None
    try:
        return int(row["id"])
    except Exception:
        return None


def _row_hash(kind: str, device_pk: int, fields: List[str]) -> str:
    base = "|".join([kind, str(device_pk)] + [safe_str(x).strip() for x in fields])
    return sha256_hex(base)


def insert_procedure_rows(device_id: str, source_filename: str, rows: List[Dict[str, Any]]) -> int:
    """Insert procedure rows with idempotent de-duplication."""
    rows = rows or []
    if not rows:
        return 0

    db = get_mysql()
    inserted = 0
    with db.conn() as conn:
        with conn.cursor() as cur:
            device_pk = _get_device_pk(cur, device_id)
            if not device_pk:
                raise ValueError("device not registered")

            params: List[tuple] = []
            for r in rows:
                saved_at_raw = safe_str(r.get("saved_at_kst"))
                saved_at_dt = parse_saved_at_kst(saved_at_raw)
                customer_name = safe_str(r.get("customer_name"))
                gender = safe_str(r.get("gender"))
                phone = safe_str(r.get("phone"))
                complaint_face = safe_str(r.get("complaint_face"))
                complaint_body = safe_str(r.get("complaint_body"))
                treatment_area = safe_str(r.get("treatment_area"))
                treatment_time_min = safe_str(r.get("treatment_time_min"))
                treatment_power_w = safe_str(r.get("treatment_power_w"))

                rh = _row_hash(
                    "procedure",
                    device_pk,
                    [
                        saved_at_raw,
                        customer_name,
                        gender,
                        phone,
                        complaint_face,
                        complaint_body,
                        treatment_area,
                        treatment_time_min,
                        treatment_power_w,
                    ],
                )

                params.append(
                    (
                        device_pk,
                        saved_at_dt.strftime("%Y-%m-%d %H:%M:%S") if saved_at_dt else None,
                        saved_at_raw,
                        customer_name,
                        gender,
                        phone,
                        complaint_face,
                        complaint_body,
                        treatment_area,
                        treatment_time_min,
                        treatment_power_w,
                        (source_filename or "").strip() or "-",
                        rh,
                    )
                )

            cur.executemany(
                """
                INSERT IGNORE INTO procedure_records
                  (device_pk, saved_at_kst, saved_at_raw, customer_name, gender, phone,
                   complaint_face, complaint_body, treatment_area, treatment_time_min,
                   treatment_power_w, source_filename, row_hash, created_at)
                VALUES
                  (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                """,
                params,
            )
            inserted = int(cur.rowcount or 0)

    return inserted


def insert_survey_rows(device_id: str, source_filename: str, rows: List[Dict[str, Any]]) -> int:
    """Insert survey rows with idempotent de-duplication."""
    rows = rows or []
    if not rows:
        return 0

    db = get_mysql()
    inserted = 0
    with db.conn() as conn:
        with conn.cursor() as cur:
            device_pk = _get_device_pk(cur, device_id)
            if not device_pk:
                raise ValueError("device not registered")

            params: List[tuple] = []
            for r in rows:
                saved_at_raw = safe_str(r.get("saved_at_kst"))
                saved_at_dt = parse_saved_at_kst(saved_at_raw)
                customer_name = safe_str(r.get("customer_name"))
                post_effect = safe_str(r.get("post_effect"))
                satisfaction = safe_str(r.get("satisfaction"))

                rh = _row_hash(
                    "survey",
                    device_pk,
                    [saved_at_raw, customer_name, post_effect, satisfaction],
                )

                params.append(
                    (
                        device_pk,
                        saved_at_dt.strftime("%Y-%m-%d %H:%M:%S") if saved_at_dt else None,
                        saved_at_raw,
                        customer_name,
                        post_effect,
                        satisfaction,
                        (source_filename or "").strip() or "-",
                        rh,
                    )
                )

            cur.executemany(
                """
                INSERT IGNORE INTO survey_records
                  (device_pk, saved_at_kst, saved_at_raw, customer_name, post_effect,
                   satisfaction, source_filename, row_hash, created_at)
                VALUES
                  (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
                """,
                params,
            )
            inserted = int(cur.rowcount or 0)

    return inserted


def _build_filter_where(kind: str, q: str) -> Tuple[str, List[Any]]:
    q = (q or "").strip()
    if not q:
        return "", []
    like = f"%{q}%"

    if kind == "procedure":
        cols = [
            "saved_at_raw",
            "customer_name",
            "gender",
            "phone",
            "complaint_face",
            "complaint_body",
            "treatment_area",
            "treatment_time_min",
            "treatment_power_w",
            "source_filename",
        ]
    else:
        cols = [
            "saved_at_raw",
            "customer_name",
            "post_effect",
            "satisfaction",
            "source_filename",
        ]

    wh = " OR ".join([f"{c} LIKE %s" for c in cols])
    return f"AND ({wh})", [like] * len(cols)


def paginate_procedure(
    *,
    device_id: str,
    limit: int = 200,
    cursor: Optional[int] = None,
    offset: int = 0,
    query: str = "",
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Paginate procedure rows.

    Returns: (rows, page_info)
      page_info: {has_more, next_cursor, next_offset}
    """
    limit = max(int(limit or 200), 1)
    offset = max(int(offset or 0), 0)

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            device_pk = _get_device_pk(cur, device_id)
            if not device_pk:
                return [], {"has_more": False, "next_cursor": None, "next_offset": 0}

            cursor_sql = ""
            cursor_params: List[Any] = []
            if cursor:
                cursor_sql = "AND id < %s"
                cursor_params.append(int(cursor))

            filter_sql, filter_params = _build_filter_where("procedure", query)
            params: List[Any] = [device_pk] + cursor_params + filter_params

            # If cursor is not provided, we still support legacy offset pagination.
            # Cursor pagination is preferred to prevent duplicates.
            limit_sql = "LIMIT %s"
            if cursor:
                cur.execute(
                    f"""
                    SELECT id AS __id, source_filename AS __file,
                           COALESCE(saved_at_raw, DATE_FORMAT(saved_at_kst, '%Y-%m-%d %H:%i:%s')) AS saved_at_kst,
                           customer_name, gender, phone,
                           complaint_face, complaint_body, treatment_area,
                           treatment_time_min, treatment_power_w
                    FROM procedure_records
                    WHERE device_pk=%s {cursor_sql} {filter_sql}
                    ORDER BY id DESC
                    {limit_sql}
                    """,
                    tuple(params + [limit + 1]),
                )
            else:
                cur.execute(
                    f"""
                    SELECT id AS __id, source_filename AS __file,
                           COALESCE(saved_at_raw, DATE_FORMAT(saved_at_kst, '%Y-%m-%d %H:%i:%s')) AS saved_at_kst,
                           customer_name, gender, phone,
                           complaint_face, complaint_body, treatment_area,
                           treatment_time_min, treatment_power_w
                    FROM procedure_records
                    WHERE device_pk=%s {filter_sql}
                    ORDER BY id DESC
                    LIMIT %s OFFSET %s
                    """,
                    tuple([device_pk] + filter_params + [limit + 1, offset]),
                )

            fetched = cur.fetchall() or []

    has_more = len(fetched) > limit
    page = fetched[:limit]

    next_cursor = None
    if page:
        try:
            next_cursor = int(page[-1].get("__id"))
        except Exception:
            next_cursor = None

    next_offset = offset + len(page)

    return page, {"has_more": has_more, "next_cursor": next_cursor, "next_offset": next_offset}


def paginate_survey(
    *,
    device_id: str,
    limit: int = 200,
    cursor: Optional[int] = None,
    offset: int = 0,
    query: str = "",
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    limit = max(int(limit or 200), 1)
    offset = max(int(offset or 0), 0)

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            device_pk = _get_device_pk(cur, device_id)
            if not device_pk:
                return [], {"has_more": False, "next_cursor": None, "next_offset": 0}

            cursor_sql = ""
            cursor_params: List[Any] = []
            if cursor:
                cursor_sql = "AND id < %s"
                cursor_params.append(int(cursor))

            filter_sql, filter_params = _build_filter_where("survey", query)
            params: List[Any] = [device_pk] + cursor_params + filter_params

            if cursor:
                cur.execute(
                    f"""
                    SELECT id AS __id, source_filename AS __file,
                           COALESCE(saved_at_raw, DATE_FORMAT(saved_at_kst, '%Y-%m-%d %H:%i:%s')) AS saved_at_kst,
                           customer_name, post_effect, satisfaction
                    FROM survey_records
                    WHERE device_pk=%s {cursor_sql} {filter_sql}
                    ORDER BY id DESC
                    LIMIT %s
                    """,
                    tuple(params + [limit + 1]),
                )
            else:
                cur.execute(
                    f"""
                    SELECT id AS __id, source_filename AS __file,
                           COALESCE(saved_at_raw, DATE_FORMAT(saved_at_kst, '%Y-%m-%d %H:%i:%s')) AS saved_at_kst,
                           customer_name, post_effect, satisfaction
                    FROM survey_records
                    WHERE device_pk=%s {filter_sql}
                    ORDER BY id DESC
                    LIMIT %s OFFSET %s
                    """,
                    tuple([device_pk] + filter_params + [limit + 1, offset]),
                )

            fetched = cur.fetchall() or []

    has_more = len(fetched) > limit
    page = fetched[:limit]

    next_cursor = None
    if page:
        try:
            next_cursor = int(page[-1].get("__id"))
        except Exception:
            next_cursor = None

    next_offset = offset + len(page)

    return page, {"has_more": has_more, "next_cursor": next_cursor, "next_offset": next_offset}


def count_today_rows() -> Dict[str, int]:
    """Counts for dashboard (today based on created_at)."""
    db = get_mysql()
    today = date.today().strftime("%Y-%m-%d")
    with db.conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT COUNT(*) AS c FROM procedure_records WHERE DATE(created_at)=%s""",
                (today,),
            )
            proc = int((cur.fetchone() or {}).get("c") or 0)
            cur.execute(
                """SELECT COUNT(*) AS c FROM survey_records WHERE DATE(created_at)=%s""",
                (today,),
            )
            surv = int((cur.fetchone() or {}).get("c") or 0)
    return {"procedure": proc, "survey": surv, "total": proc + surv}
