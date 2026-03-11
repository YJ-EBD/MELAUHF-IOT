# Raspberry Pi Deployment

라즈베리파이 단일 서버 운영 기준 기본 배포 파일입니다.

## 구성

- `systemd`: `abbas-web.service`
- `nginx`: `nginx-abbas-web.conf`
- 앱 프로세스: `uvicorn main:app --workers 1`
- 운영 env 예시: `env.production.example`
- 헬스체크: `check-health.sh`

## 적용 순서

1. `settings.env`에 `MYSQL_*`, `REDIS_*`, `FOR_RND_WEB_*` 값을 맞춘다.
   권장값은 `env.production.example`를 기준으로 시작한다.
   상용운영 기본값은 `UVICORN_RELOAD=0`, `ABBAS_ALLOW_AUTO_PROVISION=0`이다.
2. `deploy/raspberrypi/abbas-web.service`를 `/etc/systemd/system/abbas-web.service`로 복사한다.
3. `deploy/raspberrypi/nginx-abbas-web.conf`를 `/etc/nginx/sites-available/abbas-web`로 복사하고 `sites-enabled`에 링크한다.
4. `sudo systemctl daemon-reload`
5. `sudo systemctl enable --now abbas-web`
6. `sudo nginx -t && sudo systemctl reload nginx`

## 운영 기준

- `uvicorn`은 `workers 1`로 유지한다.
- nginx를 앞단에 두고 `X-Forwarded-For`를 전달한다.
- 외부 공개 포트는 `80/443`만 사용한다.
- 장비 제어는 기본적으로 서버 발신 TCP가 아니라 디바이스의 `heartbeat/telemetry/subscription sync` 응답으로 전달한다.
- `ABBAS_ENABLE_LAN_DISCOVERY=0`, `ABBAS_ENABLE_DIRECT_DEVICE_TCP=0`를 기본값으로 둔다.
- 신규 장비는 웹에서 먼저 `device_id + token`으로 사전 등록한 뒤 현장 설치한다.
- 신규 장비 저장 시 `token` 없는 등록은 허용하지 않는다.
- `/api/health/live`, `/api/health/ready`로 배포 상태를 확인한다.
