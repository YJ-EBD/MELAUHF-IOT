# ABBAS_WEB Fleet Operation Architecture Guide

## 1. 문서 목적

이 문서는 현재 `ABBAS_WEB`와 `ABBAS_ESPbyMELAUHF.ino`를 기준으로,

- 전국에 설치된 `ESP32-MELAUHF` 기기를 어떤 방식으로 운영해야 하는지
- 서버는 어떤 형태로 두는 것이 맞는지
- 기기 등록, 구독 플랜, 로그/텔레메트리, 보안, 배포를 어떻게 설계해야 하는지

를 한 번에 정리한 운영 아키텍처 가이드입니다.

대상 독자는 다음과 같습니다.

- 사내 운영팀
- CS팀
- 서버/펌웨어 개발 담당자
- 향후 인프라 확장 의사결정 담당자

## 1.1 현재 적용된 1차 운영 리뉴얼

이번 리뉴얼에서는 `클라우드 이전`이 아니라 `현재 Raspberry Pi 서버 유지`를 전제로, 실제 운영이 가능하도록 다음 항목을 먼저 반영했습니다.

- 디바이스 식별을 `device_id + token` 중심으로 고정
- `devices` 테이블에 `last_seen`, `last_heartbeat`, `last_subscription_sync`, `last_public_ip`, `fw`, `sd`, `used_energy_j` 저장
- ESP32 서버 호출 주기를 `heartbeat 30초`, `summary telemetry 60초`, `subscription sync 10분`, `register refresh 6시간` 수준으로 완화
- 서버 발신 TCP 제어를 기본 경로로 두지 않고, 대기 명령을 디바이스 응답에 실어 보내는 방식으로 전환
- 디바이스 명령 큐와 최근 런타임 로그를 DB에 영속화
- health endpoint와 Raspberry Pi 운영 env 예시 추가
- 라즈베리파이 운영용 `systemd`/`nginx` 샘플 파일 추가

즉, 현재 구조는 `라즈베리파이 단일 서버 + 중앙 제어형 outbound 통신 + DB 기반 명령/로그 영속화`를 기준으로 상용 운영에 가까운 상태까지 끌어올린 버전입니다.

---

## 2. 현재 플랫폼의 성격

현재 플랫폼을 한 줄로 요약하면 다음과 같습니다.

`관리자 인증 + ESP32 다중 디바이스 운영관리 + 실시간 로그/제어 + 업로드 데이터 조회 + 구독 관리`

현재 `ABBAS_WEB`는 관리자 콘솔 역할을 수행합니다.

- 관리자 로그인/세션 인증
- 디바이스 목록 및 상태 조회
- 로그/텔레메트리 조회
- 구독 상태 부여/회수
- 업로드 데이터 조회
- 제어 패널 제공

현재 펌웨어는 이미 다음 기능을 일부 수행하고 있습니다.

- 현장 Wi-Fi 연결
- 중앙 웹 서버로 등록 요청
- 중앙 웹 서버로 텔레메트리 전송
- 중앙 웹 서버에서 구독 상태 조회

즉, 플랫폼의 방향 자체는 맞습니다.

다만 현재 구조는 `사내/근거리 LAN 기반 관리도구` 성격이 아직 남아 있고, `전국 100~1000대 fleet 운영` 기준으로는 몇 가지 핵심 전환이 필요합니다.

---

## 3. 현재 구조에서 유지할 것과 바꿔야 할 것

### 3.1 그대로 유지해도 되는 것

- 기기에서 현장 Wi-Fi를 직접 설정하는 방식
- ESP32가 서버로 먼저 접속하는 outbound 통신 방식
- 관리자 웹 콘솔을 별도 웹 서비스로 운영하는 방식
- 서버가 구독 상태를 관리하고 기기가 이를 동기화하는 방향
- MySQL/MariaDB + Redis + FastAPI 기반 운영도구 구조

### 3.2 반드시 바꿔야 하는 것

- 서버가 기기를 직접 찾는 `UDP discovery` 중심 구조
- 서버가 기기로 직접 TCP 접속하는 구조를 기본 운영 방식으로 쓰는 것
- `IP`를 기기 식별의 기준으로 쓰는 것
- TLS 검증 없이 `setInsecure()`로 HTTPS를 사용하는 것
- 기기 등록을 웹에서 수동 입력하는 것을 주 등록 방식으로 두는 것
- 기기가 너무 짧은 간격으로 과도하게 poll하는 방식

---

## 4. 전국 설치형 ESP32 운영의 기본 원칙

전국에 납품된 ESP32는 대부분 다음 환경에 놓입니다.

- 고객사 공유기/NAT 뒤
- 사설 IP 환경
- 내부망 정책이 제각각
- 포트포워딩 불가 또는 비권장
- 현장별 네트워크 품질 편차 존재

이 조건에서는 다음 원칙이 반드시 필요합니다.

### 4.1 중앙 서버는 인터넷에서 접근 가능한 위치에 둔다

- 사내 내부망 깊숙한 곳이 아니라
- `클라우드 VM` 또는 `DMZ/Public zone`에 둔다

### 4.2 기기는 항상 서버로 먼저 연결한다

- `device -> server` outbound 통신만 허용
- `server -> device` 직접 접속은 기본 경로로 쓰지 않음

### 4.3 현장 기기에는 포트포워딩을 요구하지 않는다

- 고객사 네트워크에 포트 개방 요구 금지
- 공유기 설정 변경 의존 최소화

### 4.4 기기 식별은 IP가 아니라 고유 ID로 한다

- `device_id`
- `serial`
- `provisioning token`
- 또는 `device certificate`

상용운영 기본값에서는 `신규 미등록 장비의 자동 등록(auto-provision)`을 끄고,
서버에 미리 `device_id + token`이 준비된 장비만 활성화해야 합니다.
관리자 웹의 신규 장비 저장도 `token` 없는 상태로는 허용하지 않는 편이 맞습니다.

### 4.5 구독 상태의 진실값은 서버가 가진다

- 장비 내부 값이 아니라 서버 DB가 기준
- 기기는 서버가 내린 정책을 캐시하고 집행만 수행

---

## 5. 권장 운영 구조

가장 현실적인 권장안은 아래와 같습니다.

### 5.1 권장 구조 요약

```text
사내/CS 직원 브라우저
        |
        | HTTPS + VPN/IP 제한
        v
  Admin Web (ABBAS_WEB)
        |
        | Internal API / DB access
        v
  Device Control Plane
        |
        | HTTPS or MQTT over TLS
        v
전국의 ESP32-MELAUHF 기기
```

더 실무적으로 나누면 다음과 같습니다.

```text
Nginx / TLS Termination
  |- admin.example.com      -> ABBAS_WEB (관리자 UI/API)
  |- device-api.example.com -> Device API / Ingest API

Backend
  |- FastAPI admin service
  |- Device ingest service
  |- Command worker / scheduler

Data
  |- MariaDB
  |- Redis
  |- Object storage(optional, 로그/백업)
```

### 5.2 추천 역할 분리

`ABBAS_WEB`는 앞으로 다음 역할에 집중하는 것이 맞습니다.

- 관리자 포털
- 운영 대시보드
- 구독 관리 UI
- CS/사내 직원용 디바이스 조회/조작 화면

반대로 다음 역할은 점차 별도 service 또는 별도 모듈로 분리하는 것이 좋습니다.

- 대량 기기 등록/프로비저닝
- 고빈도 텔레메트리 수집
- 명령 큐 처리
- 디바이스 상태 동기화

즉, `ABBAS_WEB = Admin Console`, `Device API = Fleet Control Plane`으로 보는 것이 맞습니다.

---

## 6. 어떤 서버를 써야 하는가

현재는 서버를 라즈베리파이에서 유지하므로, 이 문서의 권장안은 다음처럼 해석해야 합니다.

- `지금 당장`: Raspberry Pi + Nginx + FastAPI + MariaDB + Redis
- `향후 300대 이상`: Raspberry Pi에서 x86 VM 또는 클라우드 VM으로 이전 검토
- `향후 1000대 이상`: 앱/DB/ingest 분리 검토

### 6.1 가장 추천하는 방식

`클라우드 VM + Nginx + FastAPI + MariaDB + Redis`

이유는 다음과 같습니다.

- 전국 기기가 안정적으로 붙을 수 있음
- 고정 도메인과 TLS 인증서 운영이 쉬움
- 사내망을 외부에 직접 열 필요가 없음
- 장애 대응과 백업이 쉬움
- CS/사내 사용자와 디바이스를 같은 중앙 서버로 모을 수 있음

### 6.2 권장 서버 형태

#### 초기 운영 (100대 안팎)

- Ubuntu 22.04 LTS 또는 24.04 LTS
- 2 vCPU / 4 GB RAM 이상
- 80 GB SSD 이상
- Nginx
- Uvicorn
- MariaDB
- Redis
- systemd

#### 중간 운영 (300~500대)

- 4 vCPU / 8 GB RAM 이상
- DB와 앱을 분리하거나, 최소한 DB 백업 자동화
- 로그 저장소 분리 검토

#### 1000대급 진입

- 8 vCPU / 16 GB RAM 이상부터 검토
- `ABBAS_WEB`와 `device ingest` 분리 권장
- MariaDB 관리형 서비스 또는 별도 DB 서버 권장
- 텔레메트리 처리 정책 축소 또는 비동기 큐 도입 권장

### 6.3 사내 서버를 쓰면 안 되는가

완전히 불가능한 것은 아닙니다.

다만 다음 조건이 만족되지 않으면 비추천입니다.

- 공인 도메인/TLS 안정 운영 가능
- 고정 공인 IP
- 이중화된 인터넷 회선 또는 장애 대응 체계
- 방화벽/보안 운영 인력 존재
- DMZ 구간 분리 가능

사내 서버를 써야 한다면 다음 방식이어야 합니다.

- `내부망 한가운데`가 아니라 `DMZ/Public zone`
- 기기 접속 포트는 `443`만 공개
- 관리자 웹은 VPN 또는 IP 제한 적용

즉, `사내 내부망 직접 노출`은 안 되고, `DMZ 성격의 공개 서버`로 봐야 합니다.

---

## 7. 서버 소프트웨어 권장 조합

### 7.1 권장 조합

- OS: Ubuntu LTS
- Reverse Proxy: Nginx
- App Server: Uvicorn
- App: FastAPI (`ABBAS_WEB`)
- DB: MariaDB 또는 MySQL
- Cache/Session: Redis
- Process Manager: systemd
- TLS: Let's Encrypt 또는 상용 인증서

### 7.2 왜 이 조합이 맞는가

- 현재 코드가 FastAPI/Uvicorn 구조에 맞춰져 있음
- 정적 파일, WebSocket, 프록시 처리가 쉬움
- MariaDB/Redis는 현재 코드와 잘 맞음
- systemd로 부팅 시 자동실행/재시작 관리 가능

### 7.3 즉시 피해야 할 운영 방식

- `python main.py`를 수동으로 띄워 두는 운영
- 개발용 `reload=True` 상태로 상시 운영
- `nohup`만으로 장기 운영
- 서버 내부에만 열어두고 외부 기기에서 붙게 하려는 구성

현재 `ABBAS_WEB`는 런타임 상태 일부를 메모리에 유지하므로, 당장은 `Uvicorn 1 worker`가 안전합니다. 멀티워커는 추후 상태 저장 방식을 바꾼 뒤 검토해야 합니다.

운영 기본 환경값은 아래처럼 두는 것이 맞습니다.

- `UVICORN_RELOAD=0`
- `ABBAS_ENABLE_LAN_DISCOVERY=0`
- `ABBAS_ENABLE_DIRECT_DEVICE_TCP=0`
- `ABBAS_ALLOW_AUTO_PROVISION=0`

---

## 8. 디바이스 통신은 어떤 식으로 운영해야 하는가

### 8.1 현재 방식 중 유지 가능한 부분

현재 펌웨어는 다음 구조를 이미 가지고 있습니다.

- AP/captive portal을 통해 현장 Wi-Fi 입력
- Wi-Fi 연결 후 웹 서버로 HTTPS 요청
- 등록/텔레메트리/구독 조회 수행

이 중 `Wi-Fi 설정`과 `서버로 outbound 연결`은 유지 가능합니다.

### 8.2 바꿔야 할 부분

다음은 전국 운영 기준으로 기본 경로가 되면 안 됩니다.

- UDP discovery 기반 탐색
- 서버발 TCP 직접 접속 제어
- TLS 미검증 HTTPS

권장 통신 모델은 아래와 같습니다.

#### 기본 통신

- `ESP32 -> device-api.example.com`
- 프로토콜: `HTTPS` 또는 `MQTT over TLS`
- 인증: `device secret` 또는 `device certificate`

#### 펌웨어 배포 조건

- `ESP32-C5` 기준 현재 펌웨어 크기는 기본 4MB/1.2MB APP 파티션을 초과합니다.
- 실제 출하/배포 프로파일은 `Huge APP (3MB)` 또는 동급 앱 파티션을 사용해야 합니다.
- 이 조건이 빠지면 코드는 정상이어도 업로드가 실패합니다.

#### 등록

- 출고 후 첫 연결 시 registration/provisioning
- 단, 상용운영에서는 서버에 없는 `device_id`는 등록 거부

#### 상태 보고

- heartbeat
- telemetry
- log upload

#### 정책 동기화

- subscription / entitlement sync
- command queue polling 또는 MQTT subscribe

---

## 9. 기기 등록은 어떻게 운영해야 하는가

전국 100~1000대 규모에서는 `웹에서 사람이 수동으로 한 대씩 등록`하는 구조는 오래 못 갑니다.

### 9.1 권장 등록 프로세스

#### 단계 1. 출고 전 사전 등록

서버에 다음 정보를 미리 등록합니다.

- `device_id`
- `serial_number`
- `model`
- `firmware_version`
- `bootstrap_token` 또는 초기 인증값
- `manufactured_at`
- `shipment_batch`
- `status = manufactured / shipped`

#### 단계 2. 현장 설치 시 고객사에 할당

CS 또는 설치 담당이 다음을 연결합니다.

- 고객사
- 지점
- 담당자
- 계약 플랜
- 설치일

#### 단계 3. 첫 부팅 시 서버 활성화

기기는 서버에 자신을 증명하고 활성화합니다.

- 서버는 bootstrap credential 검증
- 정상 장비면 `active` 전환
- 필요시 장기 credential 또는 갱신 토큰 발급

### 9.2 운영 상태(lifecycle) 권장값

- `manufactured`
- `shipped`
- `installed`
- `active`
- `suspended`
- `expired`
- `revoked`
- `retired`

### 9.3 CS 화면에서 필요한 기능

- 대량 등록(import)
- 대량 고객 할당
- 대량 플랜 부여
- 단말 검색
- 설치/교체 이력 조회
- 비정상 미접속 장비 필터링

---

## 10. 구독 플랜은 어떻게 운영해야 하는가

### 10.1 핵심 원칙

구독 플랜의 진실값은 반드시 서버가 가져야 합니다.

기기는 다음만 수행해야 합니다.

- 서버 정책 조회
- 정책 캐시
- 로컬 제한 집행

### 10.2 서버가 관리해야 하는 값

- 현재 플랜 코드
- 시작일
- 만료일
- 상태 (`active`, `expired`, `suspended`, `revoked`)
- 에너지 한도
- 남은 에너지
- grace period
- 마지막 동기화 시각

### 10.3 권장 동작

#### active

- 정상 사용 허용

#### expired

- 유예 정책에 따라 제한 모드 진입

#### suspended

- 미납/점검/운영정지 상태

#### revoked

- 강제 사용 중지

### 10.4 기기 쪽 구현 권장

- 구독 정보는 부팅 시 1회 조회
- 이후 주기적 재동기화
- 연결 중이면 push/queue 반영
- 오프라인 시 마지막 entitlement 캐시 사용
- `grace_until`이 지나면 제한 모드 전환

즉, `서버가 권한을 결정하고, 기기는 그 정책을 실행하는 구조`가 맞습니다.

---

## 11. 현재 polling 주기 문제와 운영 권장값

현재 펌웨어 기본값은 다음과 같습니다.

- register: `15초`
- telemetry: `1초`
- subscription sync: `5초`
- registered check: `3초`

이 값은 1000대 운영 기준으로 너무 공격적입니다.

### 11.1 현재 방식의 대략적 요청량

#### 100대

- telemetry: 약 `100 req/s`
- registered check: 약 `33 req/s`
- subscription sync: 약 `20 req/s`
- register: 약 `6.7 req/s`
- 합계: 약 `160 req/s`

#### 1000대

- telemetry: 약 `1000 req/s`
- registered check: 약 `333 req/s`
- subscription sync: 약 `200 req/s`
- register: 약 `66 req/s`
- 합계: 약 `1600 req/s`

이 수치는 단순한 polling만으로도 서버에 큰 부담을 줍니다.

### 11.2 권장 주기

#### 등록

- 부팅 직후 1회
- 재연결 시 1회
- 주기 반복 등록은 최소화

#### registered check

- 정상 활성화 이후 제거 또는 1회성 사용

#### heartbeat

- idle 상태: `30~60초`
- 동작 중(active session): `5~10초`

#### subscription sync

- 부팅 시 1회
- 이후 `10~60분` 간격
- 강제 변경은 push 또는 command queue 반영

#### telemetry

- 매초 전체 업로드 대신
- 상태 변화 시 전송
- 또는 5~30초 단위 집계 전송

즉, `고빈도 polling`에서 `event + summary + sparse heartbeat`로 바꾸는 것이 맞습니다.

---

## 12. 서버 측 데이터 모델 권장안

### 12.1 최소 권장 테이블

- `users`
- `customers`
- `sites`
- `devices`
- `device_credentials`
- `device_assignments`
- `plan_templates`
- `device_entitlements`
- `entitlement_events`
- `device_heartbeats`
- `device_logs`
- `command_queue`
- `command_results`

### 12.2 각 테이블의 역할

#### devices

- 기기 마스터
- 고유 식별자와 제조 정보 저장

#### device_assignments

- 어느 고객사/지점에 설치됐는지 기록

#### device_entitlements

- 현재 적용 중인 구독 플랜과 상태

#### entitlement_events

- 플랜 부여/변경/회수 이력

#### device_heartbeats

- 마지막 접속, fw 버전, RSSI, 네트워크 상태

#### command_queue

- 기기에 전달할 원격 명령 대기열

#### command_results

- 명령 수행 결과 저장

### 12.3 현재 구조에서 바꿔야 할 DB 관점

- `IP`를 식별 기준으로 의존하지 않기
- `customer + ip` 중심 구조를 장기 기준으로 두지 않기
- `device_id` 또는 `serial`을 1차 키로 운영하기

---

## 13. 보안 권장사항

### 13.1 반드시 해야 하는 것

- 모든 디바이스 통신은 `HTTPS/TLS` 또는 `MQTT over TLS`
- 서버 인증서 검증 활성화
- 관리자 웹은 `VPN` 또는 `IP allowlist`
- 관리자 계정 강한 비밀번호 정책
- Redis, MariaDB는 외부 직접 노출 금지
- 22번 SSH는 관리자 IP만 허용

### 13.2 디바이스 인증 권장

#### 최소 권장

- device_id + per-device secret/token

#### 더 좋은 방식

- per-device certificate
- 제조 시 기기별 credential 주입

### 13.3 현재 펌웨어에서 우선 수정해야 할 보안 포인트

- `WiFiClientSecure.setInsecure()` 제거
- 서버 인증서 또는 CA bundle 검증 적용
- 모든 디바이스가 공용 고정 토큰을 쓰지 않도록 설계
- bootstrap token과 long-term credential을 분리

---

## 14. 직원/CS 웹 접근 방식

이 웹은 사내/CS 직원이 쓰는 운영도구이므로, 완전 공개 서비스로 두는 것은 적절하지 않습니다.

### 14.1 권장 접근 정책

- 직원은 `VPN`을 통해 접속
- 또는 `IP allowlist + MFA`
- 관리자/CS 계정은 역할 분리

### 14.2 권장 권한 구분

- `admin`: 전체 설정/플랜/계정 관리
- `ops`: 기기 조회, 상태 확인, 기본 조작
- `cs`: 고객사/지점 단위 조회, 구독 확인, 기본 지원 작업
- `auditor`: 조회 전용

---

## 15. 추천 배포 토폴로지

### 15.1 가장 현실적인 1차 배포안

```text
Internet
  |
  +-- admin.example.com
  |      -> Nginx
  |      -> ABBAS_WEB (FastAPI/Uvicorn)
  |
  +-- device-api.example.com
         -> Nginx
         -> Device API / Ingest API

DB Layer
  -> MariaDB
  -> Redis
```

### 15.2 같은 서버에서 시작하는 경우

초기에는 한 대의 VM에서 시작해도 됩니다.

- Nginx
- ABBAS_WEB
- Device API
- MariaDB
- Redis

다만 이 경우에도 논리적 분리는 해 두는 것이 좋습니다.

- 관리자용 URL 분리
- 디바이스용 URL 분리
- systemd 서비스 분리
- DB 접근 계정 분리

### 15.3 규모가 커질 때 분리 순서

1. `ABBAS_WEB`와 `device ingest` 분리
2. DB 분리 또는 관리형 DB 전환
3. 로그/백업 저장소 분리
4. command worker 분리
5. 필요시 MQTT broker 도입

---

## 16. 운영 중 권장 절차

### 16.1 신규 기기 출고

1. device_id 발급
2. serial 등록
3. bootstrap credential 생성
4. 서버 재고 등록
5. 출고 상태 변경

### 16.2 현장 설치

1. 기기 전원 인가
2. captive portal로 Wi-Fi 설정
3. 서버 연결 확인
4. 고객사/지점 할당
5. 플랜 부여
6. 초기 heartbeat/구독 sync 확인

### 16.3 장애 대응

- 최근 heartbeat 시각 확인
- 최근 subscription sync 확인
- 마지막 로그 확인
- 지점/SSID 변경 여부 확인
- 명령 큐 또는 재동기화 요청

---

## 17. 현재 코드 기준으로 바로 해야 할 개선

### 17.1 서버 쪽

- `ABBAS_WEB`를 관리자 콘솔 중심으로 역할 재정의
- 런타임 상태 메모리 의존 구간 점검
- 디바이스 식별을 `device_id` 중심으로 정리
- UDP discovery, 직접 TCP 제어 의존도 축소
- 구독 정책을 entitlement 테이블 중심으로 정리

### 17.2 펌웨어 쪽

- TLS 검증 적용
- polling 주기 축소
- registration 흐름 간소화
- registered check 상시 polling 제거
- subscription sync 간격 확대
- 이벤트 기반 telemetry 전송으로 전환
- 추후 MQTT/WebSocket 장기 연결 검토

### 17.3 운영 쪽

- 공개 서버/도메인 확보
- 관리자 접근 정책 수립
- 백업/장애복구 절차 수립
- 기기 lifecycle 문서화
- CS용 설치 매뉴얼 작성

---

## 18. 단계별 실행 계획

### Phase 1. 현재 구조 안정화

- 클라우드 VM 1대 구축
- Nginx + Uvicorn + MariaDB + Redis 구성
- HTTPS 적용
- 관리자 웹과 디바이스 API 경로 분리
- polling 주기 완화
- TLS 검증 적용

### Phase 2. fleet 운영 기능 정리

- 사전등록/출고등록 프로세스 구축
- 고객사/지점 할당 테이블 추가
- entitlement 구조 정비
- 대량 등록/대량 플랜 부여 화면 구축

### Phase 3. 고도화

- device ingest 분리
- command queue 정식 도입
- 이벤트 기반 통신 전환
- 로그/백업 저장소 분리

### Phase 4. 1000대 이상 대비

- 관리형 DB 전환 또는 DB 전용 서버
- 장기적으로 AWS IoT Core / Azure IoT Hub 검토
- shadow/twin, jobs, provisioning 개념 도입

---

## 19. 최종 권장안

가장 현실적인 결론은 다음과 같습니다.

### 19.1 지금 당장 추천하는 운영 방식

- 서버는 `클라우드 VM` 사용
- OS는 `Ubuntu LTS`
- 앞단은 `Nginx`
- 앱은 `FastAPI + Uvicorn`
- DB는 `MariaDB`
- 세션/캐시는 `Redis`
- 프로세스 관리는 `systemd`
- 기기는 `HTTPS`로 중앙 서버에 outbound 연결
- 직원/CS는 `VPN 또는 IP 제한`을 통해 관리자 웹 접속

### 19.2 지금 구조에서 유지할 것

- Wi-Fi 설정 방식
- 중앙 서버 기반 운영
- 관리자 웹 콘솔 구조

### 19.3 반드시 바꿔야 할 것

- LAN 전제 직접 제어 구조
- IP 중심 식별
- 과도한 polling
- TLS 미검증
- 수동 등록 중심 운영

### 19.4 장기적으로 지향할 구조

`ABBAS_WEB = 운영 포털`, `Device API = fleet control plane`, `기기는 중앙 서버로 먼저 연결`, `구독은 entitlement 기반`, `명령은 queue 기반`

---

## 20. 공식 문서 참고

운영/확장 방향을 판단할 때 참고한 공식 문서는 아래와 같습니다.

- FastAPI deployment concepts  
  https://fastapi.tiangolo.com/deployment/concepts/

- Uvicorn deployment  
  https://www.uvicorn.org/deployment/

- AWS IoT Device Shadow  
  https://docs.aws.amazon.com/iot/latest/developerguide/iot-device-shadows.html

- AWS IoT Jobs  
  https://docs.aws.amazon.com/iot/latest/developerguide/create-manage-jobs.html

- Azure IoT DPS  
  https://learn.microsoft.com/en-us/azure/iot-dps/

- Azure IoT Hub device twins  
  https://learn.microsoft.com/en-us/azure/iot-hub/how-to-device-twins

이 문서의 AWS/Azure 관련 내용은 위 공식 개념들을 `ABBAS_WEB + ESP32-MELAUHF` 환경에 맞춰 적용한 권장안입니다.
