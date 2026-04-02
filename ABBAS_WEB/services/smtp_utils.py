from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage
from html import escape


def _build_verification_plain_text(brand_name: str, code: str, expires_minutes: int) -> str:
    return (
        f"{brand_name} 회원가입 이메일 인증 코드입니다.\n\n"
        f"인증 코드: {code}\n"
        f"유효 시간: {expires_minutes}분\n\n"
        "회원가입 화면으로 돌아가 위 코드를 입력해주세요.\n"
        "본인이 요청하지 않았다면 본 메일을 무시해주세요."
    )


def _build_verification_html(
    brand_name: str,
    product_name: str,
    to_email: str,
    code: str,
    expires_minutes: int,
) -> str:
    normalized_code = (code or "").strip()
    safe_brand_name = escape(brand_name)
    safe_product_name = escape(product_name)
    safe_email = escape((to_email or "").strip())
    safe_code = escape(normalized_code)
    if len(normalized_code) == 6 and normalized_code.isdigit():
        code_display = escape(f"{normalized_code[:3]} {normalized_code[3:]}")
    else:
        code_display = safe_code

    return f"""\
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{safe_brand_name} 이메일 인증</title>
  </head>
  <body style="margin:0;padding:0;background-color:#edf3fb;font-family:'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',Arial,sans-serif;color:#182544;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
      {safe_brand_name} 이메일 인증 코드 {safe_code}
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background-color:#edf3fb;margin:0;padding:28px 0;">
      <tr>
        <td align="center" style="padding:0 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;">
            <tr>
              <td style="background-color:#1c53de;background-image:linear-gradient(145deg,#2d6fff 0%,#1c53de 52%,#123eae 100%);border-radius:28px 28px 0 0;padding:38px 40px 30px;color:#ffffff;">
                <div style="font-size:12px;line-height:1.2;font-weight:800;letter-spacing:0.16em;color:rgba(233,240,255,0.76);">EMAIL VERIFICATION</div>
                <div style="margin-top:14px;font-size:30px;line-height:1.3;font-weight:800;letter-spacing:-0.03em;">
                  회원가입을 계속하려면<br>이메일 인증을 완료해주세요.
                </div>
                <div style="margin-top:14px;font-size:15px;line-height:1.8;color:rgba(233,240,255,0.86);">
                  {safe_product_name} 계정 생성 요청이 접수되었습니다.
                  아래 인증 코드를 입력하면 회원가입을 계속 진행할 수 있습니다.
                </div>
              </td>
            </tr>
            <tr>
              <td style="background-color:#ffffff;border-radius:0 0 28px 28px;padding:34px 40px 40px;box-shadow:0 22px 50px rgba(20,48,105,0.14);">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border:1px solid #d7e1f2;border-radius:22px;background-color:#f8fbff;">
                  <tr>
                    <td style="padding:26px 26px 24px;">
                      <div style="font-size:12px;line-height:1.2;font-weight:800;letter-spacing:0.14em;color:#7f8fad;">인증 코드</div>
                      <div style="margin-top:14px;padding:20px 22px;border-radius:18px;border:1px solid #cfd9eb;background-color:#ffffff;font-size:34px;line-height:1.1;font-weight:800;letter-spacing:0.18em;color:#1846c7;text-align:center;">
                        {code_display}
                      </div>
                      <div style="margin-top:16px;font-size:14px;line-height:1.8;color:#62728f;">
                        요청 이메일:
                        <strong style="color:#1d2b49;">{safe_email}</strong>
                        <br>
                        유효 시간:
                        <strong style="color:#1d2b49;">{expires_minutes}분</strong>
                      </div>
                    </td>
                  </tr>
                </table>

                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin-top:18px;border-collapse:separate;">
                  <tr>
                    <td style="padding:18px 20px;border-radius:18px;background-color:#f4f8ff;border:1px solid #e2ebf8;font-size:14px;line-height:1.8;color:#5f6f8d;">
                      <strong style="display:block;margin-bottom:6px;color:#182544;">안내</strong>
                      이 코드는 회원가입 화면에서만 입력해주세요.<br>
                      본인이 요청하지 않았다면 이 메일을 무시하셔도 안전합니다.
                    </td>
                  </tr>
                </table>

                <div style="margin-top:26px;font-size:12px;line-height:1.8;color:#8a97b2;">
                  본 메일은 발신 전용 자동 안내 메일입니다.<br>
                  {safe_brand_name} | {safe_product_name}
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""


def send_naver_verification_email(to_email: str, code: str, expires_minutes: int = 5) -> None:
    """Send a 6-digit verification code via Naver SMTP.

    Env:
    - NAVER_SMTP_USER: naver id (e.g. ...@naver.com)
    - NAVER_SMTP_PASS: app password or SMTP password
    - NAVER_SMTP_HOST: default smtp.naver.com
    - NAVER_SMTP_PORT: default 465 (SSL)
    - MAIL_BRAND_NAME: default ABBA-S
    - MAIL_PRODUCT_NAME: default IOT Control Platforms
    """
    user = os.getenv("NAVER_SMTP_USER", "").strip()
    pw = os.getenv("NAVER_SMTP_PASS", "").strip()
    host = os.getenv("NAVER_SMTP_HOST", "smtp.naver.com").strip() or "smtp.naver.com"
    port = int(os.getenv("NAVER_SMTP_PORT", "465"))
    from_email = (os.getenv("NAVER_SMTP_FROM", "") or user).strip()
    brand_name = os.getenv("MAIL_BRAND_NAME", "ABBA-S").strip() or "ABBA-S"
    product_name = os.getenv("MAIL_PRODUCT_NAME", "IOT Control Platforms").strip() or "IOT Control Platforms"

    if not user or not pw:
        raise RuntimeError("SMTP 설정이 없습니다(NAVER_SMTP_USER/NAVER_SMTP_PASS).")

    msg = EmailMessage()
    msg["Subject"] = f"[ {brand_name} ] 이메일 인증 코드"
    msg["From"] = from_email
    msg["To"] = (to_email or "").strip()

    msg.set_content(_build_verification_plain_text(brand_name, code, expires_minutes))
    msg.add_alternative(
        _build_verification_html(brand_name, product_name, to_email, code, expires_minutes),
        subtype="html",
    )

    # Naver: SSL 465 recommended
    with smtplib.SMTP_SSL(host, port, timeout=10) as s:
        s.login(user, pw)
        s.send_message(msg)
