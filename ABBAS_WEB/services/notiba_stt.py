from __future__ import annotations

import json
import os
import uuid
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request


_DEFAULT_PROMPT = (
    "다음은 한국어 음성 대화입니다. 자연스러운 한국어 문장으로 적고, "
    "ABBAS, ASCORD, Notiba AI, ABBA-S Korea 같은 고유명사는 그대로 유지하세요."
)


def _env_text(key: str, default: str = "") -> str:
    value = str(os.getenv(key) or "").strip()
    return value or default


def _env_int(key: str, default: int, minimum: int | None = None, maximum: int | None = None) -> int:
    try:
        value = int(str(os.getenv(key, str(default)) or str(default)).strip())
    except Exception:
        value = int(default)
    if minimum is not None:
        value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    return value


def _env_float(key: str, default: float, minimum: float | None = None, maximum: float | None = None) -> float:
    try:
        value = float(str(os.getenv(key, str(default)) or str(default)).strip())
    except Exception:
        value = float(default)
    if minimum is not None:
        value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    return value


def _env_bool(key: str, default: bool) -> bool:
    raw_value = os.getenv(key)
    if raw_value is None:
        return bool(default)
    normalized = str(raw_value or "").strip().lower()
    if not normalized:
        return bool(default)
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False
    return bool(default)


def _read_notiba_settings() -> dict[str, Any]:
    return {
        "api_key": _env_text("OPENAI_API_KEY") or _env_text("NOTIBA_OPENAI_API_KEY"),
        "api_base_url": _env_text("NOTIBA_OPENAI_BASE_URL", "https://api.openai.com").rstrip("/"),
        "model": _env_text("NOTIBA_OPENAI_MODEL", "gpt-4o-transcribe"),
        "language": _env_text("NOTIBA_OPENAI_LANGUAGE", "ko"),
        "noise_reduction": _env_text("NOTIBA_OPENAI_NOISE_REDUCTION", "near_field"),
        "vad_threshold": _env_float("NOTIBA_OPENAI_VAD_THRESHOLD", 0.42, minimum=0.0, maximum=1.0),
        "vad_prefix_ms": _env_int("NOTIBA_OPENAI_VAD_PREFIX_MS", 240, minimum=0, maximum=6000),
        "vad_silence_ms": _env_int("NOTIBA_OPENAI_VAD_SILENCE_MS", 420, minimum=120, maximum=12000),
        "prompt": _env_text("NOTIBA_OPENAI_PROMPT", _DEFAULT_PROMPT),
        "timeout_sec": _env_float("NOTIBA_OPENAI_TIMEOUT_SEC", 18.0, minimum=3.0, maximum=120.0),
        "client_tuning": {
            "merge_window_ms": _env_int("NOTIBA_CLIENT_MERGE_WINDOW_MS", 5000, minimum=0, maximum=120000),
            "merge_max_chars": _env_int("NOTIBA_CLIENT_MERGE_MAX_CHARS", 220, minimum=40, maximum=4000),
            "partial_push_ms": _env_int("NOTIBA_CLIENT_PARTIAL_PUSH_MS", 120, minimum=40, maximum=5000),
            "reconnect_ms": _env_int("NOTIBA_CLIENT_RECONNECT_MS", 700, minimum=100, maximum=15000),
            "audio_constraints": {
                "channel_count": _env_int("NOTIBA_CAPTURE_CHANNEL_COUNT", 1, minimum=1, maximum=2),
                "echo_cancellation": _env_bool("NOTIBA_CAPTURE_ECHO_CANCELLATION", True),
                "noise_suppression": _env_bool("NOTIBA_CAPTURE_NOISE_SUPPRESSION", True),
                "auto_gain_control": _env_bool("NOTIBA_CAPTURE_AUTO_GAIN_CONTROL", True),
            },
        },
    }


def _noise_reduction_payload(value: Any) -> dict[str, Any] | None:
    normalized = str(value or "").strip().lower()
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
    settings = _read_notiba_settings()
    return {
        "provider": "openai_realtime",
        "transport": "webrtc",
        "type": "transcription",
        "api_base_url": settings["api_base_url"],
        "model": settings["model"],
        "language": settings["language"],
        "noise_reduction": _noise_reduction_payload(settings["noise_reduction"]),
        "turn_detection": {
            "type": "server_vad",
            "threshold": settings["vad_threshold"],
            "prefix_padding_ms": settings["vad_prefix_ms"],
            "silence_duration_ms": settings["vad_silence_ms"],
        },
        "prompt": settings["prompt"],
        "timeout_sec": settings["timeout_sec"],
        "client_tuning": settings["client_tuning"],
        "configured": bool(settings["api_key"]),
    }


def build_realtime_transcription_session() -> dict[str, Any]:
    settings = _read_notiba_settings()
    session: dict[str, Any] = {
        "type": "transcription",
        "audio": {
            "input": {
                "transcription": {
                    "model": settings["model"],
                    "language": settings["language"],
                    "prompt": settings["prompt"],
                },
                "turn_detection": {
                    "type": "server_vad",
                    "threshold": settings["vad_threshold"],
                    "prefix_padding_ms": settings["vad_prefix_ms"],
                    "silence_duration_ms": settings["vad_silence_ms"],
                },
            }
        },
    }
    noise_reduction = _noise_reduction_payload(settings["noise_reduction"])
    if noise_reduction is not None:
        session["audio"]["input"]["noise_reduction"] = noise_reduction
    return session


def create_realtime_client_secret() -> dict[str, Any]:
    settings = _read_notiba_settings()
    if not settings["api_key"]:
        raise RuntimeError("OPENAI_API_KEY 설정이 필요합니다.")
    body = json.dumps({"session": build_realtime_transcription_session()}, ensure_ascii=False).encode("utf-8")
    request = urllib_request.Request(
        f"{settings['api_base_url']}/v1/realtime/client_secrets",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {settings['api_key']}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib_request.urlopen(request, timeout=settings["timeout_sec"]) as response:
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
    settings = _read_notiba_settings()
    if not settings["api_key"]:
        raise RuntimeError("OPENAI_API_KEY 설정이 필요합니다.")

    session_config = json.dumps(build_realtime_transcription_session(), ensure_ascii=False)
    content_type, body = _multipart_form_payload(
        {
            "sdp": normalized_offer,
            "session": session_config,
        }
    )
    request = urllib_request.Request(
        f"{settings['api_base_url']}/v1/realtime/calls",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {settings['api_key']}",
            "Content-Type": content_type,
            "Accept": "application/sdp, application/json",
        },
    )
    try:
        with urllib_request.urlopen(request, timeout=settings["timeout_sec"]) as response:
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
    settings = _read_notiba_settings()
    return {
        "ok": bool(settings["api_key"]),
        "settings": notiba_stt_settings(),
    }


__all__ = [
    "build_realtime_transcription_session",
    "create_realtime_client_secret",
    "create_realtime_call_answer",
    "notiba_stt_settings",
    "warmup_notiba_stt",
]
