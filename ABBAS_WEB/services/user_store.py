from __future__ import annotations

"""User storage (DB-backed).

for_rnd_web에서는 더 이상 userData/*.csv를 저장/조회하지 않습니다.
기존 기능을 깨지 않기 위해 기존 함수 시그니처는 유지하고,
내부 구현만 MySQL(MariaDB) 기반으로 전환합니다.
"""

import base64
import hashlib
import re
import secrets
from datetime import datetime
from typing import Dict, Optional, Tuple

from DB import user_repo

USER_HEADERS = [
    "ID",
    "PW_HASH",
    "EMAIL",
    "BIRTH",
    "NAME",
    "NICKNAME",
    "PHONE",
    "DEPARTMENT",
    "LOCATION",
    "BIO",
    "PROFILE_IMAGE_PATH",
    "ROLE",
    "APPROVAL_STATUS",
    "APPROVED_AT",
    "APPROVED_BY",
    "JOIN_DATE",
]

_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_\-]{2,31}$")


def ensure_user_dir() -> None:
    """CSV 저장소는 폐기되었습니다.

    과거 코드 호환용 no-op.
    """
    return None


def is_valid_user_id(user_id: str) -> bool:
    return bool(_ID_RE.match((user_id or "").strip()))


def user_exists(user_id: str) -> bool:
    if not is_valid_user_id(user_id):
        return False
    return user_repo.user_exists((user_id or "").strip())


def _hash_password(password: str, iterations: int = 200_000) -> str:
    pw = (password or "").encode("utf-8")
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw, salt, iterations)

    salt_b64 = base64.urlsafe_b64encode(salt).decode("utf-8").rstrip("=")
    dk_b64 = base64.urlsafe_b64encode(dk).decode("utf-8").rstrip("=")

    return f"pbkdf2_sha256${iterations}${salt_b64}${dk_b64}"


def hash_password_for_storage(password: str) -> str:
    return _hash_password(password)


def _verify_password(password: str, stored: str) -> bool:
    try:
        algo, it_s, salt_b64, dk_b64 = (stored or "").split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        iterations = int(it_s)

        # padding 복원
        def _pad(s: str) -> str:
            return s + "=" * ((4 - (len(s) % 4)) % 4)

        salt = base64.urlsafe_b64decode(_pad(salt_b64).encode("utf-8"))
        dk_expected = base64.urlsafe_b64decode(_pad(dk_b64).encode("utf-8"))

        dk = hashlib.pbkdf2_hmac("sha256", (password or "").encode("utf-8"), salt, iterations)
        return secrets.compare_digest(dk, dk_expected)
    except Exception:
        return False


def read_user(user_id: str) -> Optional[Dict[str, str]]:
    if not is_valid_user_id(user_id):
        return None
    return user_repo.get_user_row((user_id or "").strip())


def get_user_role(user_id: str) -> str:
    user = read_user(user_id)
    if not user:
        return "user"
    role = str(user.get("ROLE") or "").strip().lower()
    if role in {"admin", "superuser"}:
        return role
    return "user"


def get_user_approval_status(user_id: str) -> str:
    user = read_user(user_id)
    if not user:
        return "pending"
    status = str(user.get("APPROVAL_STATUS") or "").strip().lower()
    if status == "approved":
        return "approved"
    return "pending"


def is_admin_user(user_id: str) -> bool:
    return get_user_role(user_id) in {"admin", "superuser"}


def _friendly_create_user_error(exc: Exception) -> str:
    detail = str(exc or "")
    detail_lc = detail.lower()
    args = getattr(exc, "args", ()) or ()
    code = args[0] if args else None

    if code == 1062 or "duplicate entry" in detail_lc:
        if "uq_users_email" in detail_lc:
            return "이미 존재하는 이메일입니다."
        if "uq_users_user_id" in detail_lc:
            return "이미 존재하는 ID입니다."
        return "이미 존재하는 회원 정보입니다."

    return "저장에 실패했습니다. 잠시 후 다시 시도해주세요."


def create_user(
    user_id: str,
    password: str,
    email: str,
    birth: str,
    name: str,
    nickname: str,
) -> Tuple[bool, str]:
    """Create user (DB)."""

    user_id = (user_id or "").strip()
    if not is_valid_user_id(user_id):
        return False, "ID 형식이 올바르지 않습니다(영문/숫자/(_,-) 3~32자)."

    if user_exists(user_id):
        return False, "이미 존재하는 ID입니다."

    password = password or ""
    if len(password) < 6:
        return False, "비밀번호는 6자 이상이어야 합니다."

    email = (email or "").strip()
    if "@" not in email or "." not in email:
        return False, "이메일 형식이 올바르지 않습니다."

    birth = (birth or "").strip()  # YYYY-MM-DD
    name = (name or "").strip()
    nickname = (nickname or "").strip()

    if not name:
        return False, "이름을 입력해주세요."
    if not nickname:
        return False, "닉네임을 입력해주세요."

    pw_hash = _hash_password(password)
    try:
        user_repo.create_user_row(
            user_id=user_id,
            pw_hash=pw_hash,
            email=email,
            birth=birth,
            name=name,
            nickname=nickname,
            role="user",
            approval_status="pending",
            email_verified=True,
        )
    except Exception as e:
        print(f"[AUTH] create_user failed: {e}")
        return False, _friendly_create_user_error(e)

    return True, "ok"


def authenticate_with_status(user_id: str, password: str) -> Tuple[bool, str]:
    user = read_user(user_id)
    if not user:
        return False, "invalid"

    if not _verify_password(password, user.get("PW_HASH") or ""):
        return False, "invalid"

    approval_status = str(user.get("APPROVAL_STATUS") or "").strip().lower()
    if approval_status != "approved":
        return False, "pending"

    return True, "approved"


def authenticate(user_id: str, password: str) -> bool:
    ok, status = authenticate_with_status(user_id, password)
    return ok and status == "approved"
