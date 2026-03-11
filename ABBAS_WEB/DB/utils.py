from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Optional


KST = timezone(timedelta(hours=9))


def sha256_hex(s: str) -> str:
    return hashlib.sha256((s or "").encode("utf-8", errors="ignore")).hexdigest()


def parse_saved_at_kst(value: str) -> Optional[datetime]:
    """Parse saved_at_kst string into *naive KST* datetime.

    Desktop(for_rnd) emits ISO8601 with timezone, e.g.
      2026-01-15T17:35:00+09:00

    We store it as naive KST datetime (timezone dropped) for easy display and
    indexing.
    """
    s = (value or "").strip()
    if not s:
        return None

    # 1) ISO8601 with timezone
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is not None:
            dt = dt.astimezone(KST).replace(tzinfo=None)
        return dt
    except Exception:
        pass

    # 2) Common fallback formats
    for fmt in (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y/%m/%d %H:%M:%S",
        "%Y/%m/%d %H:%M",
        "%Y-%m-%dT%H:%M:%S",
    ):
        try:
            return datetime.strptime(s, fmt)
        except Exception:
            continue

    return None


def safe_str(v) -> str:
    if v is None:
        return ""
    return str(v)
