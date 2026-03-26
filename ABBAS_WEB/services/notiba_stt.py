from __future__ import annotations

import json
import os
import uuid
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request


_OPENAI_API_KEY = (os.getenv("OPENAI_API_KEY") or os.getenv("NOTIBA_OPENAI_API_KEY") or "").strip()
_OPENAI_BASE_URL = (os.getenv("NOTIBA_OPENAI_BASE_URL") or "https://api.openai.com").rstrip("/")
_MODEL_NAME = (os.getenv("NOTIBA_OPENAI_MODEL") or "gpt-4o-transcribe").strip() or "gpt-4o-transcribe"
_LANGUAGE = (os.getenv("NOTIBA_OPENAI_LANGUAGE") or "ko").strip() or "ko"
_NOISE_REDUCTION = (os.getenv("NOTIBA_OPENAI_NOISE_REDUCTION") or "near_field").strip() or "near_field"
_VAD_THRESHOLD = float(os.getenv("NOTIBA_OPENAI_VAD_THRESHOLD", "0.42") or "0.42")
_VAD_PREFIX_MS = max(int(os.getenv("NOTIBA_OPENAI_VAD_PREFIX_MS", "240") or "240"), 0)
_VAD_SILENCE_MS = max(int(os.getenv("NOTIBA_OPENAI_VAD_SILENCE_MS", "420") or "420"), 120)
_PROMPT = (
    os.getenv("NOTIBA_OPENAI_PROMPT")
    or "다음은 한국어 음성 대화입니다. 자연스러운 한국어 문장으로 적고, ABBAS, ASCORD, Notiba AI, ABBA-S Korea 같은 고유명사는 그대로 유지하세요."
).strip()
_TIMEOUT_SEC = max(float(os.getenv("NOTIBA_OPENAI_TIMEOUT_SEC", "18") or "18"), 3.0)


def _noise_reduction_payload() -> dict[str, Any] | None:
    normalized = str(_NOISE_REDUCTION or "").strip().lower()
    if normalized in {"near_field", "far_field"}:
        return {"type": normalized}
    if normalized in {"off", "none", "null", "disable", "disabled"}:
        return None
    return {"type": "near_field"}


def _multipart_form_payload(fields: dict[str, str]) -> tuple[str, bytes]:
    boundary = f"notiba-{uuid.uuid4().hex}"
    chunks: list[bytes] = []
    for key, value in fields.items():
        chunks.extend(
            [
                f"--{boundary}\r\n".encode("utf-8"),
                f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode("utf-8"),
                str(value or "").encode("utf-8"),
                b"\r\n",
            ]
        )
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return f"multipart/form-data; boundary={boundary}", b"".join(chunks)


def notiba_stt_settings() -> dict[str, Any]:
    return {
        "provider": "openai_realtime",
        "transport": "webrtc",
        "type": "transcription",
        "api_base_url": _OPENAI_BASE_URL,
        "model": _MODEL_NAME,
        "language": _LANGUAGE,
        "noise_reduction": _noise_reduction_payload(),
        "turn_detection": {
            "type": "server_vad",
            "threshold": _VAD_THRESHOLD,
            "prefix_padding_ms": _VAD_PREFIX_MS,
            "silence_duration_ms": _VAD_SILENCE_MS,
        },
        "prompt": _PROMPT,
        "configured": bool(_OPENAI_API_KEY),
    }


def build_realtime_transcription_session() -> dict[str, Any]:
    session: dict[str, Any] = {
        "type": "transcription",
        "audio": {
            "input": {
                "transcription": {
                    "model": _MODEL_NAME,
                    "language": _LANGUAGE,
                    "prompt": _PROMPT,
                },
                "turn_detection": {
                    "type": "server_vad",
                    "threshold": _VAD_THRESHOLD,
                    "prefix_padding_ms": _VAD_PREFIX_MS,
                    "silence_duration_ms": _VAD_SILENCE_MS,
                },
            }
        },
    }
    noise_reduction = _noise_reduction_payload()
    if noise_reduction is not None:
        session["audio"]["input"]["noise_reduction"] = noise_reduction
    return session


def create_realtime_client_secret() -> dict[str, Any]:
    if not _OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY 설정이 필요합니다.")
    body = json.dumps({"session": build_realtime_transcription_session()}, ensure_ascii=False).encode("utf-8")
    request = urllib_request.Request(
        f"{_OPENAI_BASE_URL}/v1/realtime/client_secrets",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {_OPENAI_API_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib_request.urlopen(request, timeout=_TIMEOUT_SEC) as response:
            payload = json.loads(response.read().decode("utf-8", errors="replace") or "{}")
    except urllib_error.HTTPError as exc:
        raw_body = exc.read().decode("utf-8", errors="replace")
        detail = raw_body.strip()
        try:
            payload = json.loads(raw_body)
            if isinstance(payload, dict):
                error_payload = payload.get("error")
                if isinstance(error_payload, dict):
                    detail = str(error_payload.get("message") or detail or "").strip()
        except Exception:
            pass
        raise RuntimeError(detail or f"OpenAI Realtime client secret 생성 실패 ({exc.code})") from exc
    except Exception as exc:
        raise RuntimeError(str(exc or "").strip() or "OpenAI Realtime client secret 생성 실패") from exc

    if not isinstance(payload, dict):
        raise RuntimeError("OpenAI Realtime client secret 응답 형식이 올바르지 않습니다.")
    token_value = str(payload.get("value") or "").strip()
    if not token_value:
        client_secret = payload.get("client_secret")
        if isinstance(client_secret, dict):
            token_value = str(client_secret.get("value") or "").strip()
    if not token_value:
        raise RuntimeError("OpenAI Realtime client secret 값이 비어 있습니다.")
    return {
        "value": token_value,
        "expires_at": payload.get("expires_at"),
        "session": payload.get("session") if isinstance(payload.get("session"), dict) else build_realtime_transcription_session(),
    }


def create_realtime_call_answer(sdp_offer: str) -> str:
    normalized_offer = str(sdp_offer or "").strip()
    if not normalized_offer:
        raise RuntimeError("OpenAI Realtime SDP offer가 비어 있습니다.")
    if not _OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY 설정이 필요합니다.")

    session_config = json.dumps(build_realtime_transcription_session(), ensure_ascii=False)
    content_type, body = _multipart_form_payload(
        {
            "sdp": normalized_offer,
            "session": session_config,
        }
    )
    request = urllib_request.Request(
        f"{_OPENAI_BASE_URL}/v1/realtime/calls",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {_OPENAI_API_KEY}",
            "Content-Type": content_type,
            "Accept": "application/sdp, application/json",
        },
    )
    try:
        with urllib_request.urlopen(request, timeout=_TIMEOUT_SEC) as response:
            return response.read().decode("utf-8", errors="replace")
    except urllib_error.HTTPError as exc:
        raw_body = exc.read().decode("utf-8", errors="replace")
        detail = raw_body.strip()
        try:
            payload = json.loads(raw_body)
            if isinstance(payload, dict):
                error_payload = payload.get("error")
                if isinstance(error_payload, dict):
                    detail = str(error_payload.get("message") or detail or "").strip()
        except Exception:
            pass
        raise RuntimeError(detail or f"OpenAI Realtime 세션 생성 실패 ({exc.code})") from exc
    except Exception as exc:
        raise RuntimeError(str(exc or "").strip() or "OpenAI Realtime 세션 생성 실패") from exc


def warmup_notiba_stt() -> dict[str, Any]:
    return {
        "ok": bool(_OPENAI_API_KEY),
        "settings": notiba_stt_settings(),
    }


__all__ = [
    "build_realtime_transcription_session",
    "create_realtime_client_secret",
    "create_realtime_call_answer",
    "notiba_stt_settings",
    "warmup_notiba_stt",
]
