from __future__ import annotations

"""settings.env loader (minimal, dependency-free).

요구사항:
  - Redis/SMTP 설정을 settings.env 파일에서 설정 가능
  - OS 환경변수가 이미 설정돼 있으면 그것을 우선(override)

지원 포맷:
  - KEY=VALUE
  - # 주석
  - 공백 라인 무시
  - VALUE 양끝 따옴표(단/쌍) 제거
"""

import os
from typing import Dict


def _strip_quotes(v: str) -> str:
    s = (v or "").strip()
    if len(s) >= 2 and ((s[0] == '"' and s[-1] == '"') or (s[0] == "'" and s[-1] == "'")):
        return s[1:-1]
    return s


def parse_env_file(path: str) -> Dict[str, str]:
    out: Dict[str, str] = {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                s = (line or "").strip()
                if not s or s.startswith("#"):
                    continue
                if "=" not in s:
                    continue
                k, v = s.split("=", 1)
                k = (k or "").strip()
                v = _strip_quotes(v)
                if not k:
                    continue
                out[k] = v
    except FileNotFoundError:
        return {}
    except Exception:
        # settings.env 파싱 실패는 서버 실행을 막지 않도록 조용히 무시
        return {}
    return out


def load_settings_env() -> str:
    """Load settings.env into os.environ (if missing).

    우선순위:
      1) 환경변수 SETTINGS_ENV_PATH (절대/상대 경로)
      2) 프로젝트 루트(이 파일과 같은 폴더)의 settings.env

    Returns:
      - 실제 사용한 settings.env 경로(없으면 "")
    """

    # This file lives in core/. settings.env should be located at project root (for_rnd_web/)
    core_dir = os.path.dirname(os.path.abspath(__file__))
    base_dir = os.path.dirname(core_dir)
    path = os.getenv("SETTINGS_ENV_PATH", "").strip()
    if path:
        if not os.path.isabs(path):
            path = os.path.join(base_dir, path)
    else:
        path = os.path.join(base_dir, "settings.env")

    kv = parse_env_file(path)
    if not kv:
        return "" if not os.path.exists(path) else path

    for k, v in kv.items():
        # OS 환경변수 우선. 단, ""(빈 문자열)로 설정된 경우는 실질적으로 미설정으로 간주하여 settings.env 값을 사용.
        cur = os.getenv(k)
        if cur is None or str(cur).strip() == "":
            os.environ[k] = v

    return path
