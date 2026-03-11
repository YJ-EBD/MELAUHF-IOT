from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage


def send_naver_verification_email(to_email: str, code: str) -> None:
    """Send a 6-digit verification code via Naver SMTP.

    Env:
    - NAVER_SMTP_USER: naver id (e.g. ...@naver.com)
    - NAVER_SMTP_PASS: app password or SMTP password
    - NAVER_SMTP_HOST: default smtp.naver.com
    - NAVER_SMTP_PORT: default 465 (SSL)
    """
    user = os.getenv("NAVER_SMTP_USER", "").strip()
    pw = os.getenv("NAVER_SMTP_PASS", "").strip()
    host = os.getenv("NAVER_SMTP_HOST", "smtp.naver.com").strip() or "smtp.naver.com"
    port = int(os.getenv("NAVER_SMTP_PORT", "465"))
    from_email = (os.getenv("NAVER_SMTP_FROM", "") or user).strip()

    if not user or not pw:
        raise RuntimeError("SMTP 설정이 없습니다(NAVER_SMTP_USER/NAVER_SMTP_PASS).")

    msg = EmailMessage()
    msg["Subject"] = "[IMQA] 이메일 인증 코드"
    msg["From"] = from_email
    msg["To"] = (to_email or "").strip()

    body = (
        "IMQA 회원가입 이메일 인증 코드입니다.\n\n"
        f"인증 코드: {code}\n\n"
        "※ 본인이 요청하지 않았다면 본 메일을 무시해주세요."
    )
    msg.set_content(body)

    # Naver: SSL 465 recommended
    with smtplib.SMTP_SSL(host, port, timeout=10) as s:
        s.login(user, pw)
        s.send_message(msg)
