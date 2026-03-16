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
