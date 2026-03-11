"""Device data storage (DB-backed).

for_rnd_web에서는 더 이상 Data/deviceData/*/*.csv 를 저장/조회하지 않습니다.

데스크톱(for_rnd) 앱은 CSV 파일을 업로드 payload로 전송하므로,
서버는 업로드된 CSV를 '파싱'하여 DB에 적재합니다.
"""

from __future__ import annotations

import csv
import io
from typing import Any, Dict, List, Optional, Tuple

from DB import data_repo


def normalize_device_id(v: str) -> str:
    """MAC 정규화: aabbccddeeff -> aa:bb:..."""
    s = (v or "").strip().lower()
    if not s:
        return ""
    hex_only = "".join(ch for ch in s if ch in "0123456789abcdef")
    if len(hex_only) == 12:
        return ":".join(hex_only[i : i + 2] for i in range(0, 12, 2))
    return s


def _decode_csv_bytes(content: bytes) -> str:
    try:
        return (content or b"").decode("utf-8-sig")
    except Exception:
        # best effort
        return (content or b"").decode("utf-8", errors="ignore")


def parse_csv_rows(content: bytes) -> List[Dict[str, str]]:
    """Parse uploaded CSV bytes into list of dict rows (trimmed)."""
    text = _decode_csv_bytes(content)
    if not text.strip():
        return []

    reader = csv.DictReader(io.StringIO(text))
    rows: List[Dict[str, str]] = []
    for r in reader:
        if not r:
            continue
        rows.append({str(k): (str(v) if v is not None else "").strip() for k, v in r.items()})
    return rows


def ingest_csv_bytes_to_db(device_id: str, kind: str, filename: str, content: bytes) -> int:
    """Parse CSV bytes and insert into DB.

    kind: procedure | survey
    Returns inserted row count (dedupe applied).
    """
    did = normalize_device_id(device_id)
    kind_l = (kind or "").strip().lower()
    fname = (filename or "").strip() or "data.csv"
    rows = parse_csv_rows(content)

    if kind_l == "procedure":
        return data_repo.insert_procedure_rows(did, fname, rows)
    if kind_l == "survey":
        return data_repo.insert_survey_rows(did, fname, rows)
    raise ValueError("invalid kind")


def read_rows_paginated(
    device_id: str,
    kind: str,
    offset: int = 0,
    limit: int = 200,
    query: str = "",
    cursor: Optional[int] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Read rows from DB.

    Returns: (rows, page_info)
      page_info: {has_more, next_cursor, next_offset}
    """
    did = normalize_device_id(device_id)
    kind_l = (kind or "").strip().lower()

    if kind_l == "procedure":
        return data_repo.paginate_procedure(device_id=did, limit=limit, cursor=cursor, offset=offset, query=query)
    if kind_l == "survey":
        return data_repo.paginate_survey(device_id=did, limit=limit, cursor=cursor, offset=offset, query=query)
    raise ValueError("invalid kind")
