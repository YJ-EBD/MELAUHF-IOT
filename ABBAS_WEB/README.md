# ABBAS_WEB

`ABBAS_WEB`은 ESP32 여러 대를 등록하고 상태를 모니터링하며, 로그/텔레메트리를 조회하고, 구독 상태를 관리하는 관리자 콘솔입니다.  
서버는 `FastAPI + Jinja2` 기반으로 동작하며, 운영 데이터는 `MySQL/MariaDB`에 저장합니다.

코드 내부에는 과거 명칭인 `for_rnd`가 일부 남아 있습니다. 앱 타이틀, DB 이름, 환경변수 이름에서 해당 명칭이 보일 수 있습니다.

## 주요 기능

- 관리자 로그인, 로그아웃, 세션 인증
- 회원가입, 아이디 중복 확인, 이메일 인증 코드 검증
- ESP32 디바이스 등록, 수정, 삭제, 등록 여부 확인
- 디바이스 온라인/오프라인 상태, 마지막 연결 시각, 고객사별 상태 관리
- 디바이스 자동 탐색 및 저장된 디바이스 목록 조회
- 디바이스 로그/텔레메트리 수집 및 최근 로그 조회
- WebSocket 기반 관리자 제어 패널 + 중앙 명령 큐 제어
- 구독 상태 조회, 부여, 만료, 회수 관리
- 플랜별 에너지 사용량/잔여량 관리
- 시술/설문 CSV 업로드 후 DB 적재
- 디바이스별 데이터 조회, 검색, 페이지네이션
- SD 로그 조회, 다운로드, 삭제 전 백업
- 서버 로그 저장 및 조회

## 기술 스택

- Backend: FastAPI
- Templating: Jinja2
- Database: MySQL/MariaDB
- Session/Email verification cache: Redis
- Frontend assets: HTML templates + static CSS/JS
- File upload: `python-multipart`
- DB driver: `PyMySQL`

## 디렉터리 구조

```text
ABBAS_WEB/
├── main.py              # FastAPI 엔트리포인트
├── core/                # 환경변수 로더, 인증 미들웨어
├── router/              # 페이지/API/WebSocket 라우터
├── DB/                  # MySQL wrapper + repository
├── redis/               # Redis 세션/간이 Redis 클라이언트
├── services/            # 서비스 계층 및 호환용 shim
├── storage/             # 레거시 import 호환용 shim
├── templates/           # Jinja2 템플릿
├── static/              # CSS/JS/이미지
├── SQL/                 # DB 생성/테이블/인덱스 SQL
├── deploy/              # Raspberry Pi/nginx/systemd 배포 예시
├── scripts/             # CSV -> MySQL 마이그레이션 스크립트
├── Data/                # 과거 CSV 입력 소스
├── Trashcan/            # SD 로그 백업 파일
├── settings.env         # 로컬 설정 파일
└── requirements.txt
```

## 현재 라우팅 개요

### 인증

- `/login`
- `/logout`
- `/signup`
- `/auth/check-id`
- `/auth/email/send-code`
- `/auth/email/verify-code`

### 관리자 페이지

- `/`
- `/device-status`
- `/control-panel`
- `/logs`
- `/data`
- `/plan`
- `/settings`

### 디바이스/운영 API

- `/api/device/register`
- `/api/device/heartbeat`
- `/api/device/registered`
- `/api/device/telemetry`
- `/api/device/command-ack`
- `/api/devices/{device_id}/commands`
- `/api/health/live`
- `/api/health/ready`
- `/api/device/tail`
- `/api/device/sd-log`
- `/api/device/sd-log/download`
- `/api/device/sd-log/delete`
- `/api/devices/saved`
- `/api/devices/discovered`
- `/api/devices/save`
- `/api/devices/update`
- `/api/devices/delete`
- `/api/devices/{device_id}/subscription`
- `/api/devices/{device_id}/subscription/grant`
- `/api/devices/{device_id}/subscription/revoke`

### Desktop 업로드/API

- `/api/desktop/device_registered`
- `/api/desktop/upload`
- `/api/data/devices`
- `/api/data/procedure`
- `/api/data/survey`

### WebSocket

- `/ws/device`
- `/ws/control-panel`

## 운영 저장소 원칙

- 운영 저장소는 `MySQL/MariaDB`만 사용합니다.
- CSV는 운영 저장소가 아니라 업로드 입력 포맷 또는 1회성 마이그레이션 입력 소스로만 사용합니다.
- 서버 런타임에서 예전 CSV 저장/조회 경로는 사용하지 않도록 정리되어 있습니다.

추가 운영 문서:

- `FLEET_OPERATION_ARCHITECTURE.md`
- `deploy/raspberrypi/README.md`

## 요구 사항

- Python 3.11+
- MySQL 또는 MariaDB
- Redis

필수 Python 패키지:

```txt
fastapi
uvicorn[standard]
jinja2
python-multipart
pymysql
```

## 설치 및 실행

### 1. 가상환경 생성

```bash
cd /home/abbas/Desktop/ABBAS_WEB
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. DB 준비

필요한 SQL 파일:

- `SQL/00_create_database.sql`
- `SQL/01_tables.sql`
- `SQL/02_indexes.sql`
- `SQL/03_seed_optional.sql`

### 3. 환경변수 설정

기본적으로 `settings.env`를 읽습니다.  
OS 환경변수가 이미 있으면 그 값을 우선 사용합니다.

주요 설정 키:

```env
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=
MYSQL_DATABASE=for_rnd
MYSQL_CHARSET=utf8mb4

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_DB=0
REDIS_PASSWORD=
REDIS_TIMEOUT_SEC=2.5

SESSION_TTL_SEC=43200
AUTO_LOGIN_TTL_SEC=2592000

NAVER_SMTP_USER=
NAVER_SMTP_PASS=
NAVER_SMTP_HOST=smtp.naver.com
NAVER_SMTP_PORT=465
NAVER_SMTP_FROM=

FOR_RND_WEB_HOST=127.0.0.1
FOR_RND_WEB_PORT=8000
UVICORN_RELOAD=0
```

추가 런타임 옵션 예시:

```env
FOR_RND_ONLINE_WINDOW_SEC=90
FOR_RND_DISCOVERY_TTL_SEC=90
FOR_RND_DEVICE_TCP_PORT=5000
FOR_RND_UDP_DISCOVERY_PORT=4210

ABBAS_DEVICE_HEARTBEAT_SEC=30
ABBAS_DEVICE_TELEMETRY_SEC=60
ABBAS_DEVICE_SUBSCRIPTION_SYNC_SEC=600
ABBAS_DEVICE_REGISTER_REFRESH_SEC=21600

ABBAS_ENABLE_LAN_DISCOVERY=0
ABBAS_ENABLE_DIRECT_DEVICE_TCP=0
ABBAS_ALLOW_AUTO_PROVISION=0
```

펌웨어 운영 기본값:

- `WEB_TLS_INSECURE=0`
- `WEB_TLS_CA_CERT` 설정 필수
- `ENABLE_LAN_SERVICES=0`
- 신규 장비는 서버에 먼저 `device_id + token`으로 사전 등록한 뒤 설치
- 웹의 신규 디바이스 저장도 `token` 없는 등록은 거부
- `ESP32-C5` 빌드는 기본 1.2MB APP 파티션이 아니라 `Huge APP (3MB)` 또는 동급 파티션 사용 권장

### 4. 서버 실행

```bash
cd /home/abbas/Desktop/ABBAS_WEB
source venv/bin/activate
uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1
```

또는:

```bash
export UVICORN_RELOAD=0
python main.py
```

## 데이터 마이그레이션

기존 CSV 데이터를 1회성으로 DB에 옮길 때만 사용합니다.

```bash
cd /home/abbas/Desktop/ABBAS_WEB
source venv/bin/activate
python scripts/migrate_csv_to_mysql.py
```

마이그레이션 대상:

- `Data/deviceList.csv`
- `Data/serverLogs.csv`
- `Data/deviceData/...`

## 템플릿 페이지

- `templates/index.html`: 대시보드
- `templates/device_status.html`: 디바이스 목록/상태
- `templates/control_panel.html`: 제어 패널
- `templates/logs.html`: 로그 페이지
- `templates/data.html`: 데이터 조회
- `templates/plan.html`: 구독/플랜 관리
- `templates/settings.html`: 설정 페이지
- `templates/login.html`: 로그인
- `templates/signup.html`: 회원가입

## 주의 사항

- Redis가 없으면 로그인/세션/이메일 인증 기능이 정상 동작하지 않습니다.
- MySQL/MariaDB 연결에 실패하면 서버는 startup 단계에서 예외를 발생시킵니다.
- 디바이스 런타임 상태 일부는 서버 메모리에 유지되므로, 현재 구조는 단일 프로세스 운영 전제를 갖습니다.
- `storage/`와 일부 `services/` 모듈은 레거시 import 호환을 위한 shim 성격이 있습니다.
- 프로젝트 내부의 `uvicorn.log`, `venv/`는 실행 환경 산출물입니다.

## 빠른 요약

`ABBAS_WEB`은 관리자 인증, ESP32 다중 디바이스 관리, 실시간 로그/제어, 업로드 데이터 조회, 구독 관리를 하나로 묶은 웹 콘솔입니다.
