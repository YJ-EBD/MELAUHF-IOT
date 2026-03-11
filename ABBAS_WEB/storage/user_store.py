"""Legacy storage shim (DB-backed).

storage/ 패키지는 현재 라우팅에서 사용되지는 않지만,
CSV 저장/조회 코드가 남지 않도록 DB 기반으로 통일합니다.
"""

from __future__ import annotations

from services.user_store import (
    authenticate,
    create_user,
    ensure_user_dir,
    is_valid_user_id,
    read_user,
    user_exists,
    verify_password,
)

__all__ = [
    "ensure_user_dir",
    "is_valid_user_id",
    "user_exists",
    "read_user",
    "verify_password",
    "authenticate",
    "create_user",
]
