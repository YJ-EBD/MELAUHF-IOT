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

## 10. Force OTA 적용/ATmega 세션 리셋/실패 시 화면 복귀 보강
- 수정코드
  - `ABBAS_ESPbyMELAUHF.ino`
- 간단한 설명
  - `release_force_update` 릴리스는 사용자 입력 대기 없이 자동 승인 경로로 OTA를 진행하도록 분기를 추가하고, 기존 session-skip 상태와 충돌하지 않도록 force-update 우선 처리를 보강했다.
  - OTA 프롬프트 전 `@OTA|RST`를 ATmega에 전송해 ESP 단독 재부팅 후에도 ATmega의 이전 프롬프트 세션 플래그 때문에 자동 skip 되지 않도록 정리했다.
  - 승인 후 메타데이터 오류/적용 실패 시 `@PAGE|61` 복귀를 요청해 DWIN 74페이지 고정 상태를 완화했다.

## 11. ESP 펌웨어 버전 태그 갱신
- 수정코드
  - `ABBAS_ESPbyMELAUHF.ino`
- 간단한 설명
  - `FIRMWARE_VERSION` 값을 `2026.03.12.9`에서 `26.3.13.1`로 갱신해 현재 배포/검증 대상 빌드를 식별할 수 있도록 정리했다.
  - WEB OTA 체크/리포트와 Firmware Manage 화면에서 현재 장비 버전 표기가 일치하도록 버전 문자열 기준점을 맞췄다.

## 12. ATmega OTA 74페이지 고정 안정화 패치 반영 메모
- 수정코드
  - 코드 수정 없음
  - 연동 확인 파일: `ABBAS_ESPbyMELAUHF.ino` (`OTA|DEC`, `@OTA|Q`, `@PAGE|61`)
- 간단한 설명
  - 이번 변경의 실제 코드는 MELAUHF `main.c`에만 적용되었고, Arduino(ESP) 코드는 추가 수정 없이 기존 사용자 승인 OTA 흐름을 그대로 사용한다.
  - ATmega가 OTA 프롬프트 활성 중 잠금 페이지 강제를 무시하도록 보강되어, ESP 측 `OTA|DEC` 처리 경로가 더 안정적으로 동작하도록 정리했다.

## 13. OTA 74페이지 진행 문구 가시성 점검 연동 정리
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `ABBAS_ESPbyMELAUHF.ino`
- 간단한 설명
  - ESP는 `@OTA|Q`, `@OTA|DEC`, `@PAGE|61` 기반 사용자 승인 OTA 제어를 유지하고, 74페이지 진행 문구(`0xD222`) 출력은 ATmega/DWIN 책임 경로임을 재확인했다.
  - 이번 채팅 기준 Arduino 디렉토리는 기능 변경 없이 devList/소스컨트롤 기준점 정리만 반영했다.

## 14. 71페이지 ESP 버전 표시 기준 재확인
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `ABBAS_ESPbyMELAUHF.ino`
- 간단한 설명
  - 71페이지 `0xD100`의 ESP 버전 표시는 ESP 코드에서 별도 신규 프레임을 추가하지 않고, 기존 `@OTA|Q|<current_version>|<target_version>`의 `current_version`과 `FIRMWARE_VERSION("26.3.13.1")` 기준을 따르도록 정리했다.
  - 이번 채팅의 실제 반영은 ATmega가 기본 ESP 버전 문자열을 보유하고 필요 시 `OTA|Q` 수신값으로 덮어쓰는 방향으로 처리했고, Arduino 코드는 수정하지 않았다.

## 15. 62페이지 `0x8016` 냉각 버튼 버그 분석 연동 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `ABBAS_ESPbyMELAUHF.ino`, `storage/device_logs/*/MELAUHF_Log.txt`
- 간단한 설명
  - `RKC : 0x8016` 입력은 ESP 로그 경로까지 정상 수집되는 것을 확인했고, 실제 수정 지점은 ESP가 아니라 MELAUHF ATmega `tron_mode.c` 임을 다시 확인했다.
  - 이번 채팅의 page62 냉각 버튼/아이콘/온도 텍스트 버그는 Arduino 디렉토리 기능 변경 없이 연동 확인만 수행했다.

## 16. 68페이지 Wi-Fi 단계 분기 패치 연동 확인
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `ABBAS_ESPbyMELAUHF.ino`
- 간단한 설명
  - 이번 채팅에서 실제 코드 변경은 ATmega `main.c`에만 적용했고, Arduino(ESP) 코드는 기존 `@P63|W`, `@P63|B`, `@WIFI|R` 송신 구조를 유지했다.
  - ATmega가 Wi-Fi 연결 시도/미연결(AP 검색) 상태를 표시하도록 분기 보강되었기 때문에, ESP 측은 추가 포맷 변경 없이 기존 heartbeat/result 라인으로 연동되도록 정리했다.

## 17. MA5105 `IOT_mode` 분리 리팩터링 연동 기준 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `ABBAS_ESPbyMELAUHF.ino`
- 간단한 설명
  - 이번 채팅에서 실제 코드 수정은 MELAUHF ATmega 펌웨어 쪽에만 적용했고, Arduino(ESP) 디렉토리는 동작 경로 확인과 devList 기준점 업데이트만 수행했다.
  - ESP가 송신하는 `@SUB|`, `@P63|`, `@WIFI|`, `@OTA|`, `@ENG|` 프레임 책임은 유지한 채, ATmega 측 수신/페이지 처리 구현 위치만 `IOT_mode.c`로 이동한 상태로 정리했다.

## 18. page57 플랜/에너지 표시 경로 재확인
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `ABBAS_ESPbyMELAUHF.ino`
- 간단한 설명
  - `ABBAS_WEB` 플랜 응답의 `energyJ/energy_j`, `start_date`, `remaining_days`가 ESP에서 `g_assignedEnergyJ`, `g_planStartDate`, `g_planRemainingDays`로 반영된 뒤 `@ENG|A/U/D/M/P/E/R` 라인으로 ATmega page57 표시를 갱신하는 구조를 다시 확인했다.
  - 이번 채팅의 실제 수정은 ATmega 쪽 `ENG` 수신 안정화였고, Arduino 디렉토리는 코드 변경 없이 값 공급 경로 점검과 devList 업데이트만 반영했다.

## 19. MA5105 69페이지 디버그/테스트 패치 연동 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `ABBAS_ESPbyMELAUHF.ino`
- 간단한 설명
  - 이번 채팅의 실제 구현은 MELAUHF ATmega 펌웨어에서 `0xCCCC` 디버그 출력, page69 shadow 값 표시, 5단위 증감, 테스트 버튼 동작 정리를 반영한 내용이며 Arduino(ESP) 코드는 수정하지 않았다.
  - ESP는 기존처럼 `@ENG|...`, `@SUB|...`, `@OTA|...` 프레임만 공급하고, MA5105 page69 숫자/테스트 동작은 ATmega 내부 로직이 책임지는 기준으로 정리했다.

## 20. MA5105 62/69페이지 출력 불안정 분석 연동 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `ABBAS_ESPbyMELAUHF.ino`
- 간단한 설명
  - 이번 채팅의 실제 수정은 MELAUHF ATmega 펌웨어에서 page62/page69 출력 흔들림과 메모리 사용량을 정리한 내용이며, Arduino(ESP) 코드는 변경하지 않았다.
  - ESP는 기존처럼 `@ENG|...`, `@SUB|...`, `@OTA|...` 프레임 공급 책임만 유지하고, MA5105 62/69페이지의 보정/디버그/출력 안정화는 ATmega 내부 처리 기준으로 정리했다.

## 21. 68페이지 부팅 Wi-Fi 단계 상태를 ESP에서 직접 송신하도록 보강
- 수정코드
  - `ABBAS_ESPbyMELAUHF.ino`
- 간단한 설명
  - 저장된 Wi-Fi 부팅 시작 시 `@P63|M|C`, AP 준비 완료 시 `@P63|M|A`, AP 시작 실패 시 `@P63|M|E`를 ATmega로 보내서 MA5105 68페이지가 실제 ESP 부팅 Wi-Fi 단계를 구분할 수 있도록 정리했다.
  - 동일 상태의 중복 송신은 `g_atmegaBootUiStateLast`로 막고, 저장된 Wi-Fi 부팅 성공 직후에는 `@WIFI|R|1`도 즉시 보내서 ATmega 부팅 게이트가 연결 결과를 바로 확정할 수 있게 보강했다.

## 22. 이번 채팅 기준 ESP 디렉토리 무변경 연동 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `ABBAS_ESPbyMELAUHF.ino`
- 간단한 설명
  - 이번 채팅의 실제 구현은 MELAUHF ATmega 펌웨어에서 page62 운전 중 플랜 초과 시 즉시 정지/59페이지 전환을 보강하고, page68 상태 활동 대기를 60초로 늘리는 작업이었다.
  - Arduino(ESP32) 디렉토리는 기능 변경 없이 기존 `@SUB|`, `@ENG|`, `@WIFI|`, `@OTA|` 연동 구조를 유지하는 기준만 devList에 정리했다.

## 23. page68 Wi-Fi 재시도 번호를 ESP에서 함께 전달하도록 정리
- 수정코드
  - `ABBAS_ESPbyMELAUHF.ino`
- 간단한 설명
  - 저장된 Wi-Fi 자동 연결 시 ESP가 각 부팅 재시도마다 `@P63|M|C|<attempt>`를 보내도록 바꿔, ATmega가 68페이지에서 첫 시도와 재연결 시도를 구분할 수 있게 정리했다.
  - 첫 시도는 기존처럼 `Connecting Wi - Fi . . .`를 유지하고, 2번째/3번째 시도부터만 `Reconnecting Wi - Fi (1) . . .`, `Reconnecting Wi - Fi (2) . . .`로 표시되도록 ATmega 쪽 표시 기준과 맞췄다.

## 24. ESP32-C5 기반 ATmega OTA/ISP 1안 배선 문서 추가
- 수정코드
  - `OTA_ATmega_for_ESP32_Plan.md`
- 간단한 설명
  - `ABBAS_ESPbyMELAUHF.ino`의 현재 핀 정의를 기준으로 `GPIO12/11/9` SPI 배선과 `GPIO24 + 2N3904`를 이용한 `ATmega RESET` 제어 구성을 문서로 정리했다.
  - `MISO` 분압(`10k/20k`), `SD SPI` 공용 버스 주의사항, 수동 RESET 대신 `2N3904`로 자동 제어하는 `1안` 설명을 함께 남겼다.

## 25. MA5105 62페이지 Wi-Fi 세기 VAR ICON(`0x0AA5`) 실시간 갱신 추가
- 수정코드
  - `ABBAS_ESPbyMELAUHF.ino`
- 간단한 설명
  - DWIN 직접 word write helper(`dwinWriteWord`)를 추가하고, 현재 DWIN page가 62일 때만 ESP32가 `0x0AA5`에 현재 연결 Wi-Fi RSSI 기준 아이콘 index `0~3`을 1초 주기로 써주도록 `page62WifiIconTick()`을 추가했다.
  - 미연결 상태는 `0(매우약함)`으로 처리하고, 62페이지 재진입 시 즉시 반영되도록 마지막 페이지/아이콘 캐시를 함께 두어 화면이 계속 갱신되도록 정리했다.

## 26. 관리자 NAS 페이지 개발에 따른 Arduino 디렉토리 무변경 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `ABBAS_ESPbyMELAUHF.ino`
- 간단한 설명
  - 이번 채팅의 실제 구현은 `ABBAS_WEB`에서 관리자 권한 기반 NAS 페이지와 파일 브라우저 UI/UX를 추가하는 작업이었고, Arduino(ESP32) 코드는 수정하지 않았다.
  - ESP 디렉토리는 기존 시리얼 연동, OTA, Wi-Fi 상태 송신 동작을 그대로 유지한 채 `_devList` 기록만 갱신했다.

## 27. 전체 WEB 콘솔 UI 리뉴얼에 따른 Arduino 디렉토리 무변경 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `ABBAS_ESPbyMELAUHF.ino`
- 간단한 설명
  - 이번 채팅의 실제 구현은 `ABBAS_WEB`에서 전체 관리자 콘솔 UI/UX 리뉴얼, 로그인/회원가입 화면 개편, 전역 다크모드와 NAS Center 다크모드 보정을 진행한 작업이었고, Arduino(ESP32) 코드는 수정하지 않았다.
  - Arduino 디렉토리는 기존 디바이스 제어/통신/OTA 동작을 그대로 유지한 채 `_devList` 기록만 추가했다.

## 28. NAS Center 세부 UX 보정에 따른 Arduino 디렉토리 무변경 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `ABBAS_ESPbyMELAUHF.ino`
- 간단한 설명
  - 이번 채팅의 실제 구현은 `ABBAS_WEB`에서 NAS Center 탐색기형 UI 세부 조정, 우클릭 메뉴 위치 보정, 드래그앤드롭 업로드, 로그인 문구/지원 메일 수정 등을 정리하는 작업이었고 Arduino(ESP32) 코드는 수정하지 않았다.
  - Arduino 디렉토리는 기존 Wi-Fi/OTA/UART 연동 동작을 그대로 유지한 채 `_devList` 기록만 갱신했다.

## 29. NAS Center 업로드/상단고정 후속 보정에 따른 Arduino 디렉토리 무변경 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `ABBAS_ESPbyMELAUHF.ino`
- 간단한 설명
  - 이번 채팅의 실제 구현은 `ABBAS_WEB`에서 NAS Center 폴더 업로드 안정화, NAS 디바이스/시리얼 표시 보강, 우클릭 상단 고정 기능, 드래그 오버레이 스크롤 보정을 진행한 작업이었고 Arduino(ESP32) 코드는 수정하지 않았다.
  - Arduino 디렉토리는 기존 Wi-Fi/OTA/UART 연동 동작을 그대로 유지한 채 `_devList` 기록만 추가했다.

## 30. NAS Center 내부 이동·마킹·중복 업로드 대응에 따른 Arduino 디렉토리 무변경 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `ABBAS_ESPbyMELAUHF.ino`
- 간단한 설명
  - 이번 채팅의 실제 구현은 `ABBAS_WEB`에서 NAS Center 내부 드래그 이동, 중복 업로드 충돌 모달, 마킹 색상 시스템, 빈 폴더 안내 모달, 경로 버튼 드롭 이동을 정리하는 작업이었고 Arduino(ESP32) 코드는 수정하지 않았다.
  - Arduino 디렉토리는 기존 Wi-Fi/OTA/UART 연동 동작을 그대로 유지한 채 `_devList` 기록만 갱신했다.
