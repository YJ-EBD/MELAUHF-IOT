# ABBAS_WEB_devList

## 1. 부팅 시 구독 API 응답 구조 확인
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `router/pages.py`, `DB/device_repo.py`
- 간단한 설명
  - `/api/devices/{device_id}/subscription` 응답이 `status_code`, `energyJ`, `usedEnergyJ`를 함께 반환하는 구조를 확인했다.
  - 서버 측에서 구독 상태, 플랜E, 사용E를 어떻게 내려주는지 이번 채팅 기준으로 정리했다.

## 2. 구독 회수 시 서버 처리 흐름 확인
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `DB/device_repo.py`, `router/pages.py`
- 간단한 설명
  - 구독 회수 시 `used_energy_j=0` 초기화와 원격 `RESET_SUBSCRIPTION` 명령 큐잉 흐름을 확인했다.
  - 다만 이번 채팅에서는 DWIN/ATmega만 수정 조건이어서 WEB 코드는 변경하지 않았다.

## 3. 등록 장비의 무플랜/회수 상태 응답 확인
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `router/pages.py`
- 간단한 설명
  - 등록된 장비라도 플랜 정보가 비어 있으면 READY 성격으로 해석될 수 있는 서버 응답 경로를 확인했다.
  - 이 영향으로 ATmega 부팅 분기를 강화하는 방향으로 대응했다.

## 4. OTA 릴리스 저장소/상태 스키마 추가
- 수정코드
  - `DB/firmware_repo.py`
  - `main.py`
- 간단한 설명
  - `firmware_releases`, `device_firmware_state` 기준으로 OTA 릴리스 메타데이터와 장비별 현재/목표 펌웨어 상태를 저장하는 경로를 추가했다.
  - 서버 시작 시 OTA 스키마를 자동 보장하도록 초기화 경로를 연결했다.

## 5. Firmware Manage 페이지와 OTA 관리 UI 추가
- 수정코드
  - `router/pages.py`
  - `templates/base.html`
  - `templates/firmware_manage.html`
  - `static/js/firmware_manage.js`
- 간단한 설명
  - `/firmware-manage` 페이지, payload API, 릴리스 목록, 장비별 현재 펌웨어/목표 릴리스/OTA 상태를 한 화면에서 관리하는 UI를 추가했다.
  - BIN 업로드, 릴리스 선택, 장비 배정/배정 해제 흐름을 프론트와 백엔드에 연결했다.

## 6. 장비 Pull-OTA API 추가
- 수정코드
  - `router/pages.py`
  - `DB/firmware_repo.py`
- 간단한 설명
  - 장비용 `/api/device/ota/check`, `/api/device/ota/download/{release_id}`, `/api/device/ota/report` 경로를 추가했다.
  - 현재 펌웨어와 목표 릴리스를 비교해 update 여부를 판단하고, 성공 보고나 same-release 판정 시 목표 릴리스를 자동 해제하도록 정리했다.

## 7. OTA 릴리스 업로드/배정 규칙 추가
- 수정코드
  - `router/pages.py`
  - `DB/firmware_repo.py`
- 간단한 설명
  - 업로드된 BIN을 `storage/firmware/<family>/...` 구조로 저장하고, sha256/size/build_id/force_update 정보를 함께 관리하도록 만들었다.
  - 장비별 목표 릴리스를 배정하면 OTA 상태를 `available`로 두고 장비가 주기적으로 pull 하도록 서버 경로를 정리했다.

## 8. Firmware Manage 릴리스 다중 삭제 기능 추가
- 수정코드
  - `templates/firmware_manage.html`
  - `static/js/firmware_manage.js`
  - `router/pages.py`
  - `DB/firmware_repo.py`
- 간단한 설명
  - 릴리스 목록에 개별 체크/전체 선택/삭제 버튼을 추가하고, SweetAlert2 확인 모달에서 선택된 릴리스 목록을 스크롤로 검토한 뒤 삭제하도록 구현했다.
  - 릴리스 삭제 시 장비에 걸린 `target_release_id`도 함께 정리해 OTA 상태가 꼬이지 않도록 처리했다.

## 9. OTA 사용자 승인 정책 반영을 위한 인터페이스 유지 확인
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `router/pages.py` (`/api/device/ota/check`, `/api/device/ota/report`)
- 간단한 설명
  - 이번 작업에서는 WEB API 스펙을 변경하지 않고, ESP/ATmega가 기존 OTA check/report 인터페이스 위에서 사용자 승인 게이트를 수행하도록 유지했다.
  - 결과적으로 서버는 기존 릴리스 배정/상태 보고 구조를 그대로 사용하고, 즉시 업데이트 여부는 펌웨어 단에서 제어하도록 분리했다.

## 10. Firmware Manage 상태 배지 확장 및 데이터 쿼리 포맷 이스케이프 정리
- 수정코드
  - `static/js/firmware_manage.js`
  - `DB/data_repo.py`
- 간단한 설명
  - OTA 상태 배지에 `pending_user`, `approved`, `skipped`를 추가해 사용자 승인 기반 OTA 진행 상태가 화면에서 즉시 구분되도록 정리했다.
  - `data_repo.py`의 `DATE_FORMAT` 문자열을 Python f-string 환경에 맞게 `%%` 이스케이프 처리해 쿼리 포맷 문자가 안전하게 전달되도록 보강했다.

## 11. 소스컨트롤 정리 기준점 업데이트
- 수정코드
  - 코드 수정 없음
- 간단한 설명
  - 이번 커밋에서는 ABBAS_WEB 디렉토리의 기능 코드 변경 없이, Arduino/MELAUHF 패치와 devList 동기화 중심으로 소스컨트롤 기준점을 정리했다.
  - 추후 Firmware Manage 변경사항 추적 시 본 항목(11번)을 기준으로 이어서 관리하도록 메모를 남겼다.

## 12. OTA 74페이지/구독 잠금 페이지 충돌 패치 연동 확인
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `router/pages.py`, `templates/firmware_manage.html`, `static/js/firmware_manage.js`
- 간단한 설명
  - 이번 패치에서 적용된 실제 수정은 MELAUHF `main.c`의 페이지 전환 충돌 가드이며, ABBAS_WEB 디렉토리 코드는 변경하지 않았다.
  - Firmware Manage의 OTA 배정/보고 인터페이스는 기존 스펙 그대로 유지되어 ATmega 74페이지 사용자 승인 흐름과 호환됨을 재확인했다.

## 13. 소스컨트롤 무영향 정리 기준 업데이트
- 수정코드
  - 코드 수정 없음
  - 확인 항목: `storage/firmware/ABBAS_ESP32C5_MELAUHF/*.bin`
- 간단한 설명
  - 이번 채팅에서는 WEB 기능 코드를 변경하지 않고 devList 동기화만 진행했다.
  - 로컬 OTA BIN 산출물은 코드 변경과 분리해 관리하는 기준으로 정리하고, 기본 커밋 범위에서는 제외했다.

## 14. 71/74페이지 ATmega 패치 연동 및 소스컨트롤 제외 항목 확인
- 수정코드
  - 코드 수정 없음
  - 확인 항목: `storage/device_logs/*/TotalEnergy.txt`
- 간단한 설명
  - 이번 채팅의 실제 구현은 MELAUHF ATmega 펌웨어(`main.c`)에서만 진행했고, ABBAS_WEB 디렉토리 기능 코드는 변경하지 않았다.
  - 런타임 장비 로그 파일(`TotalEnergy.txt`)은 자동 생성 데이터 성격으로 보고 기본 커밋 범위에서 제외하는 기준을 다시 확인했다.

## 15. 런타임 activity partial 로그 파일 소스컨트롤 제외 정리
- 수정코드
  - 루트 `.gitignore`

## 16. 이번 채팅 기준 WEB 디렉토리 무변경 기준점 정리
- 수정코드
  - 코드 수정 없음
- 간단한 설명
  - 이번 채팅의 실제 기능 수정은 `Arduino`와 `MELAUHF` 디렉토리에만 반영했고, `ABBAS_WEB` 디렉토리의 라우터/DB/UI 코드는 건드리지 않았다.
  - 소스컨트롤 정리 시 WEB 디렉토리는 기존 상태를 그대로 유지하는 기준점만 남기고, 이번 커밋에서는 devList 기록 외 기능 영향이 없도록 정리했다.
  - 정리 대상: `storage/device_logs/*/.MELAUHF_Log.txt.activity.part`
- 간단한 설명
  - WEB 런타임 중 생성되는 `.MELAUHF_Log.txt.activity.part` 파일은 장비 로그 병합 중간 산출물이라 기능 소스와 분리해 관리하는 편이 안전하다고 판단했다.
  - 이번 채팅에서는 실제 코드 변경과 무관한 partial 로그가 Source Control에 남지 않도록 제외 규칙과 인덱스 정리를 함께 반영했다.

## 16. ATmega 68/63 페이지 안정화 패치 연동 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `main.py`, `router/pages.py`
- 간단한 설명
  - 이번 채팅에서 WEB 디렉토리 기능 코드는 변경하지 않고, ATmega 펌웨어(`MELAUHF/.../main.c`)의 68페이지 단계 분기 및 63페이지 전환 가드만 반영했다.
  - 기존 WEB API/서비스 흐름을 유지한 상태에서 소스컨트롤 정리(디렉토리별 devList 동기화) 기준만 업데이트했다.

## 17. MA5105 `IOT_mode` 구조 분리 작업 연동 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `router/pages.py`, `DB/device_repo.py`
- 간단한 설명
  - 이번 채팅의 실제 구현은 MELAUHF ATmega 펌웨어에서 Wi-Fi/OTA/구독/63~74페이지 처리 블록을 `IOT_mode.c`로 분리하는 구조 정리였고, ABBAS_WEB 기능 코드는 변경하지 않았다.
  - WEB API 스펙은 그대로 유지되며, 서버는 기존처럼 구독/OTA 상태를 내려주고 ATmega 쪽 모듈 경계만 정리된 기준으로 devList를 갱신했다.

## 18. page57 플랜/에너지 표시 연동 점검 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `router/pages.py`, `DB/device_repo.py`
- 간단한 설명
  - 이번 채팅에서는 WEB 플랜 페이지 payload가 여전히 `status_code`, `plan`, `start_date`, `expiry_date`, `remaining_days`, `energyJ/energy_j`를 내려주고 있음을 다시 확인했다.
  - 실제 수정은 MELAUHF ATmega의 `@ENG|...` 수신 안정화였고, ABBAS_WEB 디렉토리는 기능 변경 없이 연동 경로 확인과 devList 기준점만 업데이트했다.

## 19. MA5105 69페이지 펌웨어 패치 연동 기준 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `router/pages.py`, `DB/device_repo.py`
- 간단한 설명
  - 이번 채팅의 실제 코드 변경은 MELAUHF ATmega 펌웨어의 69페이지 shadow 곡선/디버그 출력/테스트 버튼 정리였고, ABBAS_WEB 디렉토리 기능 코드는 변경하지 않았다.
  - WEB 쪽은 기존 구독/플랜/에너지 응답 구조를 그대로 유지한 상태에서, ATmega가 page69 디버그와 값 표시를 더 안정적으로 처리하는 기준으로 연동 메모만 갱신했다.

## 20. MA5105 62/69페이지 저출력·랜덤 출력 원인 분석 연동 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `router/pages.py`, `DB/device_repo.py`
- 간단한 설명
  - 이번 채팅의 실제 수정은 MELAUHF ATmega 펌웨어에서 page62/page69 출력 경로와 디버그/메모리 사용량을 정리한 내용이며, ABBAS_WEB 디렉토리 기능 코드는 변경하지 않았다.
  - WEB API 스펙은 그대로 유지되고, 서버는 기존 구독/플랜/에너지 정보를 내려주는 역할을 유지한 채 ATmega 쪽 디버그와 보정 로직 안정화 작업만 연동 기준으로 기록했다.

## 21. 이번 채팅 기준 WEB 디렉토리 무변경 및 소스컨트롤 정리 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `router/pages.py`, `DB/device_repo.py`
- 간단한 설명
  - 이번 채팅의 실제 구현은 MELAUHF ATmega 펌웨어에서 page62 런타임 구독 만료 즉시 59페이지 전환 보강과 page68 상태 활동 대기시간 조정에 집중했고, ABBAS_WEB 기능 코드는 변경하지 않았다.
  - 소스컨트롤 정리 시 WEB 디렉토리는 기존 API/DB/UI 동작에 영향이 없도록 유지하는 기준만 devList에 기록했다.

## 22. 이번 채팅 기준 WEB 디렉토리 안전 유지 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `router/pages.py`, `DB/device_repo.py`
- 간단한 설명
  - 이번 채팅의 실제 코드 변경은 `Arduino`와 `MELAUHF` 디렉토리에만 반영했고, `ABBAS_WEB`은 기능 수정 없이 기존 API/DB/UI 동작을 그대로 유지했다.
  - 디렉토리별 `_devList` 정리와 소스컨트롤 정리 기준만 맞추고, WEB 디렉토리에 영향이 갈 수 있는 추가 수정은 넣지 않았다.

## 23. ESP32-C5 ATmega 배선 문서화 연동 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `router/pages.py`, `DB/device_repo.py`
- 간단한 설명
  - 이번 채팅의 실제 문서 추가는 `Arduino/OTA_ATmega_for_ESP32_Plan.md`에만 반영했고, ABBAS_WEB 디렉토리의 API/DB/UI 코드는 수정하지 않았다.
  - WEB 디렉토리는 기존 OTA/구독 응답 구조를 그대로 유지한 상태에서, 하드웨어 배선 정리와 소스컨트롤 기준만 맞추는 메모를 남겼다.

## 24. MA5105 62페이지 Wi-Fi 세기 아이콘 연동 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `router/pages.py`, `DB/device_repo.py`
- 간단한 설명
  - 이번 채팅의 실제 구현은 Arduino(ESP32)에서 MA5105 62페이지 `VAR ICON 0x0AA5`를 현재 연결 Wi-Fi RSSI에 따라 0~3 단계로 갱신하는 작업이었고, ABBAS_WEB 기능 코드는 변경하지 않았다.
  - WEB 디렉토리는 기존 구독/OTA/API 동작을 그대로 유지한 채, 디렉토리별 devList 정리와 소스컨트롤 기준점만 업데이트했다.

## 25. 관리자 전용 NAS 페이지 및 파일 브라우저 UI 추가
- 수정코드
  - `README.md`
  - `SQL/01_tables.sql`
  - `services/user_store.py`
  - `router/pages.py`
  - `templates/base.html`
  - `templates/nas.html`
  - `templates/forbidden.html`
  - `static/js/nas_page.js`
- 간단한 설명
  - 사용자 `role` 기반 관리자 권한 구조를 정리하고, `admin`만 메뉴 노출과 `/nas` 접근이 가능하도록 맞췄다. 외장하드 `Seagate Backup+ Desk`를 대상으로 파일 열람, 업로드, 다운로드, 새 폴더 생성, 휴지통 이동/복원/영구삭제 흐름을 NAS 페이지에 추가했다.
  - NAS UI는 우클릭 컨텍스트 메뉴, 전체 행 클릭 이동, Windows 탐색기 느낌의 파일 브라우저 카드, 시스템 폴더 숨김 처리, 브랜드 문구(`IOT Control Platforms` / `Control Console`) 반영까지 이번 채팅 기준으로 함께 정리했다.

## 26. 전체 WEB 콘솔 UI 리뉴얼 및 다크모드 보정
- 수정코드
  - `templates/base.html`
  - `templates/login.html`
  - `templates/signup.html`
  - `static/css/cleanpay_theme.css`
  - `static/css/auth_cleanpay.css`
  - `static/js/common.js`
- 간단한 설명
  - 첨부 시안 방향에 맞춰 상단 1차 메뉴, 좌측 2차 메뉴, 밝은 업무형 카드/테이블/폼 중심으로 `ABBAS_WEB` 공통 레이아웃과 인증 화면을 전면 리뉴얼했다. `base.html`을 쓰는 전체 페이지와 메뉴가 같은 디자인 시스템을 공유하도록 전역 테마 CSS를 추가했다.
  - 다크모드는 초기 페이지 진입 시 잠깐 밝게 보이던 플래시를 없애고, 카드/표/버튼/입력창/배지/모달과 NAS Center 내부 요소까지 어두운 배경 + 밝은 텍스트 기준으로 다시 맞춰 전체적으로 어색한 흰색 요소가 남지 않도록 보정했다.
