from core.env_loader import load_settings_env

# source venv/bin/activate
# uvicorn main:app --host 127.0.0.1 --port 8000 --reload
# curl ifconfig.me
# pkill -f "uvicorn"
# sudo ss -lntp | grep :8000
# sudo kill -9 

# pkill -f "uvicor"
# nohup ./venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 > uvicorn.log 2>&1 &
# sudo systemctl restart redis-server
# cd ~/Desktop/ABBAS_WEB && source venv/bin/activate

# (요구사항) settings.env에서 Redis/SMTP 설정을 읽어 환경변수에 주입
# - OS 환경변수가 있으면 그 값을 우선합니다.
load_settings_env()

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from core.auth_middleware import AuthMiddleware
from redis.simple_redis import SimpleRedis
from redis.session import rotate_boot_id
from router.auth import router as auth_router
from router.pages import router as pages_router
from router.desktop_api import router as desktop_api_router
from router.data_api import router as data_api_router
from DB.runtime import get_mysql
from DB import device_repo, device_ops_repo, firmware_repo, user_repo

app = FastAPI(title="for_rnd 관리자 콘솔")

# 정적 파일
app.mount("/static", StaticFiles(directory="static"), name="static")

# (신규) 인증 미들웨어
app.add_middleware(AuthMiddleware)

# 라우팅
app.include_router(auth_router)
app.include_router(desktop_api_router)
app.include_router(data_api_router)
app.include_router(pages_router)


@app.on_event("startup")
async def on_startup() -> None:
    # Redis 연결 + 서버 재시작 시 세션 무효화(boot_id 회전)
    app.state.redis = SimpleRedis()
    try:
        rotate_boot_id(app.state.redis)
    except Exception:
        # Redis가 없으면 로그인 기능이 정상 동작할 수 없습니다.
        # 개발/테스트에서 빠르게 원인 파악할 수 있도록 출력만 남깁니다.
        try:
            print("[AUTH] Redis 연결 실패 - 로그인 기능 비활성화(REDIS_HOST/PORT/PASSWORD/USERNAME 확인)")
        except Exception:
            pass
        # 인증이 불가능한 상태에서 API가 계속 401로만 동작하는 혼란을 줄이기 위해
        # redis 객체를 제거해 '미구성' 상태로 명확하게 둡니다.
        try:
            app.state.redis = None
        except Exception:
            pass

    # MySQL/MariaDB 연결 확인 (CSV fallback 없음)
    try:
        get_mysql().ping()
        user_repo.ensure_schema()
        device_repo.ensure_runtime_schema()
        device_ops_repo.ensure_schema()
        firmware_repo.ensure_schema()
        print("[DB] MySQL/MariaDB 연결 OK")
    except Exception as e:
        # 운영 중 CSV로 저장/조회하는 fallback은 허용되지 않습니다.
        print(f"[DB] MySQL/MariaDB 연결 실패: {e}")
        raise


@app.on_event("shutdown")
async def on_shutdown() -> None:
    try:
        r = getattr(app.state, "redis", None)
        if r is not None:
            r.close()
    except Exception:
        pass


if __name__ == "__main__":
    # 편의 실행: python main.py
    # - settings.env의 FOR_RND_WEB_HOST/FOR_RND_WEB_PORT를 사용
    # - 기본값은 운영 안전성을 위해 reload 비활성화
    import os
    import uvicorn

    host = (os.getenv("FOR_RND_WEB_HOST") or "127.0.0.1").strip()
    try:
        port = int(os.getenv("FOR_RND_WEB_PORT") or "8000")
    except Exception:
        port = 8000
    reload_enabled = (os.getenv("UVICORN_RELOAD", "0").strip() == "1")

    uvicorn.run("main:app", host=host, port=port, reload=reload_enabled)
