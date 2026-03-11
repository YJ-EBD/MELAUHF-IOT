"""Legacy storage shim (DB-backed).

storage/ 패키지는 현재 라우팅에서 사용되지는 않지만,
CSV 저장/조회 코드가 남지 않도록 DB 기반으로 통일합니다.
"""

from __future__ import annotations

from typing import Dict, List

from DB.device_repo import list_saved_devices


def ensure_device_csv() -> None:
    return None


def load_saved_devices() -> List[Dict[str, str]]:
    return list_saved_devices()
