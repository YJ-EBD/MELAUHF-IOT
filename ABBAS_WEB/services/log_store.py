"""Server log storage (DB-backed).

for_rnd_web에서는 Data/serverLogs.csv를 더 이상 저장/조회하지 않습니다.
기존 import/services.log_store 인터페이스는 유지합니다.
"""

from __future__ import annotations

from typing import Dict, List

from DB import log_repo


def ensure_log_csv() -> None:
    """CSV 기반 로그 저장소는 폐기되었습니다(호환용 no-op)."""
    return None


def append_log(device: str, type_: str, message: str) -> None:
    log_repo.append_log(device, type_, message)


def read_logs(limit: int = 200, device: str = "", type_: str = "") -> List[Dict[str, str]]:
    return log_repo.read_logs(limit=limit, device=device, type_=type_)
