"""Legacy device CSV shim (DB-backed).

for_rnd_web에서는 더 이상 Data/deviceList.csv를 저장/조회하지 않습니다.

기존 import(services.device_csv.load_saved_devices)를 깨지 않기 위해
동일한 함수명을 유지하되, 내부 구현은 MySQL(MariaDB)로 완전 전환합니다.
"""

from __future__ import annotations

from typing import Dict, List

from DB.device_repo import list_saved_devices


def ensure_device_csv() -> None:
    """CSV 기반 저장소는 폐기되었습니다.

    과거 코드와의 호환을 위해 no-op으로 유지합니다.
    """


def load_saved_devices() -> List[Dict[str, str]]:
    return list_saved_devices()
