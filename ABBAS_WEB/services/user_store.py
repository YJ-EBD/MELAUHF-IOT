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
            email_verified=True,
        )
    except Exception as e:
        # MySQL duplicate key, connection error etc.
        return False, f"저장 실패: {e}"

    return True, "ok"


def authenticate(user_id: str, password: str) -> bool:
    user = read_user(user_id)
    if not user:
        return False
    return _verify_password(password, user.get("PW_HASH") or "")
