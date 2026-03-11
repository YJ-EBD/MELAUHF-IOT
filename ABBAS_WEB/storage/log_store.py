"""Legacy storage shim (DB-backed)."""

from __future__ import annotations

from typing import Dict, List

from DB.log_repo import append_log as _append
from DB.log_repo import read_logs as _read


def ensure_log_csv() -> None:
    return None


def append_log(device: str, type_: str, message: str) -> None:
    _append(device=device, type_=type_, message=message)


def read_logs(limit: int = 200, device: str = "", type_: str = "") -> List[Dict[str, str]]:
    return _read(limit=limit, device=device, type_=type_)
