# Arduino_devList

## 1. 부팅 시 WEB 구독 동기화 경로 분석
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `ABBAS_ESPbyMELAUHF.ino`
- 간단한 설명
  - 저장된 Wi-Fi로 부팅되면 `webRegisterTick(true)`, `webDeviceRegisteredSyncTick(true)`, `webSubscriptionSyncTick(true)`가 즉시 호출되는 흐름을 확인했다.
  - ESP가 WEB 구독 조회를 담당하고, 그 결과를 UART ASCII 프레임으로 ATmega에 전달하는 구조를 정리했다.

## 2. 구독 상태 전달 순서 확인
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `ABBAS_ESPbyMELAUHF.ino`
- 간단한 설명
  - 활성 구독은 `READY(@SUB|R)`를 먼저 보낸 뒤 `ACTIVE(@SUB|A)`와 `@ENG|A/U/...` 메트릭을 이어서 보내는 순서를 확인했다.
  - 이 순서 때문에 ATmega가 READY를 최종 상태로 오해하면 61페이지로 빨리 풀릴 수 있음을 확인했다.

## 3. 사용E 업로드 책임 경로 확인
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `ABBAS_ESPbyMELAUHF.ino`
- 간단한 설명
  - `used_energy_j`의 WEB 업로드는 ESP의 register/heartbeat/telemetry 경로가 담당하는 구조를 확인했다.
  - 이번 채팅에서는 ESP 코드를 수정하지 않고 ATmega 부팅 판정만 보강했다.

## 4. OTA 펌웨어 식별값/서버 연동 필드 추가
- 수정코드
  - `ABBAS_ESPbyMELAUHF.ino`
- 간단한 설명
  - `FIRMWARE_FAMILY`, `FIRMWARE_VERSION`, `FIRMWARE_BUILD_ID`를 추가하고 register/heartbeat/telemetry/ota-report에 현재 펌웨어 식별값을 함께 보내도록 정리했다.
  - WEB 서버가 장비의 현재 펌웨어와 목표 릴리스를 비교할 수 있도록 기본 메타데이터 경로를 맞췄다.

## 5. OTA 체크 조건과 즉시 검사 스케줄링 추가
- 수정코드
  - `ABBAS_ESPbyMELAUHF.ino`
- 간단한 설명
  - Wi-Fi 연결, post-connect 지연, portal 비활성, 미등록 상태, 운전 중 상태, boot-report 대기 여부를 기준으로 OTA 체크를 제한하도록 구현했다.
  - 저장된 Wi-Fi로 부팅 성공하거나 재연결된 직후에는 즉시 OTA 체크를 예약해 새 릴리스 반영 시간을 줄였다.

## 6. OTA 다운로드/검증/적용 경로 구현
- 수정코드
  - `ABBAS_ESPbyMELAUHF.ino`
- 간단한 설명
  - `/api/device/ota/check` 응답에서 release_id, size, sha256, family/version/build_id를 읽고 pull 방식으로 BIN을 다운로드하도록 구현했다.
  - `Update` + SHA256 검증 + content-length/size 검증을 붙여서 잘못된 이미지나 family mismatch는 적용 전에 차단하도록 정리했다.

## 7. OTA 상태 보고와 재부팅 성공 보고 추가
- 수정코드
  - `ABBAS_ESPbyMELAUHF.ino`
- 간단한 설명
  - OTA 시작/다운로드/재부팅/실패/부팅 성공 상태를 `/api/device/ota/report`로 보고하도록 구현했다.
  - `Preferences`에 `ota_pending`, `ota_release_id`를 저장해 재부팅 뒤 성공 보고가 누락되지 않도록 보강했다.

## 8. OTA와 운전 상태 연동 보강
- 수정코드
  - `ABBAS_ESPbyMELAUHF.ino`
- 간단한 설명
  - 운전 중(`g_runActive`)에는 OTA를 건너뛰고 skip reason을 남기도록 해서 장비 동작 중 펌웨어 교체를 막도록 했다.
  - MELAUHF/ATmega에서 올라오는 `ENG|R` run event와 fallback telemetry를 활용해 OTA 차단 판단이 실제 운전 상태를 따라가도록 정리했다.

## 9. OTA 자동 적용을 사용자 승인 게이트로 변경
- 수정코드
  - `ABBAS_ESPbyMELAUHF.ino`
- 간단한 설명
  - OTA 상위 버전 감지 시 즉시 `webDownloadAndApplyFirmware()`를 실행하지 않고 `@OTA|Q|<현재버전>|<대상버전>` 프롬프트를 ATmega로 전달한 뒤 사용자 결정을 대기하도록 변경했다.
  - ATmega에서 `@OTA|DEC|1` 수신 시에만 OTA를 진행하고, `@OTA|DEC|0` 수신 시에는 현재 부팅 세션에서 OTA를 재시도하지 않도록 `g_webOtaSessionSkipUntilReboot` 게이트를 추가했다.
