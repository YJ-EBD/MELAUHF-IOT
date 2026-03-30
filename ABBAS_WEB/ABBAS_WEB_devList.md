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

## 27. NAS Center 탐색기형 UI 마감 보정 및 로그인 문구 정리
- 수정코드
  - `templates/nas.html`
  - `static/js/nas_page.js`
  - `templates/login.html`
- 간단한 설명
  - NAS Center는 Windows 탐색기 느낌에 더 가깝도록 상단 탐색 바와 좌측 패널, 파일 목록 레이아웃을 다시 정리했고, 우클릭 메뉴 위치를 커서 기준으로 보정했다. 파일 목록 영역 드래그앤드롭 업로드, 검색창/주소창 카드 높이 및 내부 요소 크기 정렬, 휴지통 버튼과 `휴지통으로 이동` 위험 액션의 빨간 계열 강조도 함께 반영했다.
  - 로그인 페이지는 쇼케이스 타이틀을 `통합관리 솔루션`으로 바꾸고, 지원 메일을 `sp2passb56@abba-s.com`으로 교체해 현재 브랜드 문구 기준으로 맞췄다.

## 28. 관리자 계정 중복 로그인 차단 정책 보강
- 수정코드
  - `redis/session.py`
  - `router/auth.py`
  - `templates/login.html`
- 간단한 설명
  - Redis 세션 관리에 `user_id -> active sid` 인덱스를 추가하고, 기존 로그인 세션이 살아 있으면 새 기기 로그인은 발급 단계에서 차단하도록 정책을 바꿨다. 예전 방식으로 남아 있던 세션도 스캔/백필해서 현재 활성 세션으로 해석되도록 보강했다.
  - 로그인 차단 시에는 기존 기기를 유지하고, 새로 로그인 시도한 기기에서 SweetAlert2 경고창으로 `중복 로그인 차단` 안내가 뜨도록 로그인 템플릿과 라우터 응답을 연결했다.

## 29. NAS Center 탐색 UX 정리 및 섹션 사이드바 고정 보정
- 수정코드
  - `static/css/cleanpay_theme.css`
  - `templates/nas.html`
  - `static/js/nas_page.js`
- 간단한 설명
  - 메인 워크스페이스의 `section-sidebar`가 데스크톱에서 헤더 아래에 고정되고, 내부 메뉴만 스크롤되도록 레이아웃을 보정했다. 모바일 구간에서는 기존 자연 흐름을 유지하도록 분기 처리했다.
  - NAS Center는 `Seagate Backup+ Desk` 기준 드라이브 정보 카드 배치와 정보 표현을 정리하고, 파일 목록에서 드래그 다중 선택, 자동 스크롤, 우클릭 배치 작업, 이름 변경, 바깥 클릭 선택 해제, 목록/상태 표시 보정까지 탐색기형 상호작용을 한 번에 다듬었다.
  - `새 폴더 만들기`와 `이름 변경`은 같은 Bootstrap 모달을 공용으로 쓰도록 바꿔 디자인과 입력 흐름이 완전히 동일하게 동작하도록 정리했다.

## 30. NAS Center 노션형 선택 UX 및 우클릭 다운로드 보강
- 수정코드
  - `router/pages.py`
  - `static/js/nas_page.js`
  - `ABBAS_WEB_devList.md`
- 간단한 설명
  - NAS Center 파일 목록을 `1클릭 선택`, `더블클릭 폴더 열기`, `우클릭 다운로드` 흐름으로 정리하고, 선택 항목이 여러 개일 때는 ZIP으로 묶어 다운로드할 수 있도록 배치 다운로드 경로를 연결했다.
  - 탐색기 영역 클릭 후 `Ctrl+A` 전체 선택, `Ctrl+좌클릭` 개별 토글 선택, `Ctrl+드래그` 범위 항목 개별 선택/해제 토글이 노션처럼 동작하도록 선택 상태와 키보드 포커스 로직을 보강했다.

## 31. NAS Center 대용량 업로드 및 삭제 확인 모달 보강
- 수정코드
  - `deploy/raspberrypi/nginx-abbas-web.conf`
  - `templates/nas.html`
  - `static/js/nas_page.js`
  - `ABBAS_WEB_devList.md`
- 간단한 설명
  - NAS 업로드는 프록시 업로드 제한을 없애는 방향으로 배포용 Nginx 설정을 `client_max_body_size 0` 기준으로 정리했고, 대용량 파일 업로드 중에는 진행 모달에 가로 게이지, 퍼센트, `업로드된 용량 / 총 용량`이 실시간으로 표시되도록 바꿨다.
  - NAS 탐색기 목록 클릭 시 보이던 기본 포커스 테두리는 숨기고, 선택 항목에서 `Delete` 키나 `휴지통으로 이동` 액션을 실행할 때는 기존 디자인과 같은 Bootstrap 확인 모달이 떠서 `예`면 휴지통 이동, `아니오`면 유지되도록 정리했다.

## 32. NAS Center 업로드 안정화와 상단 고정 기능 추가
- 수정코드
  - `main.py`
  - `DB/user_repo.py`
  - `router/pages.py`
  - `templates/nas.html`
  - `static/js/nas_page.js`
  - `ABBAS_WEB_devList.md`
- 간단한 설명
  - 이번 채팅에서는 NAS Center 드래그앤드롭 업로드 흐름을 다시 정리해, 단일 파일 업로드가 100% 이후 모달에 남아 있던 문제와 폴더 업로드가 0%에 멈추거나 폴더만 생성되고 내부 파일이 빠지던 문제를 프론트/백엔드 양쪽에서 보강했다.
  - NAS 디스크 정보는 재부팅 전에도 `디바이스`, `시리얼` 값이 `-`로 비지 않도록 `findmnt/udevadm` 기반 보강 경로를 추가했고, 우클릭 메뉴에는 `상단 고정/상단 고정 해제`를 넣어 최근 고정 순으로 최상단 정렬되게 정리했다.
  - 파일 드롭 오버레이는 스크롤 위치를 따라가도록 보정해서 목록을 아래로 내린 상태에서도 `"파일을 놓으면 현재 폴더에 업로드됩니다"` 안내 영역이 화면 기준으로 자연스럽게 보이도록 맞췄다.

## 33. NAS Center 내부 이동·중복 업로드 대응·마킹·빈 폴더 안내 보강
- 수정코드
  - `router/pages.py`
  - `templates/nas.html`
  - `static/js/nas_page.js`
- 간단한 설명
  - 이번 채팅에서는 NAS Center에 파일/폴더 내부 드래그 이동을 확장해 목록의 폴더 행뿐 아니라 `nasPaneLocation` 경로 버튼에도 드롭 이동이 가능하도록 정리했고, 다중 이동은 중간에 일부만 먼저 반영되지 않도록 서버 쪽 사전 검증과 롤백 보호를 함께 넣었다.
  - 드래그앤드롭 업로드는 중복 파일/폴더 충돌 모달(`건너뛰기/덮어쓰기/취소/모든 파일에 대하여 적용`), 중요 항목 마킹/마킹 해제와 색상 선택 모달, 마킹된 행 강조 스타일을 추가해 탐색기형 상호작용을 더 보강했다.
  - 빈 폴더 드롭은 브라우저 fallback placeholder를 걸러서 별도 안내 모달이 뜨도록 분기했고, 드래그앤드롭 업로드 항목이 업로드 대기 큐에 남지 않도록 즉시 업로드 전용 흐름으로 다시 정리했다.

## 34. 회원가입 오류 문구·레이아웃·사이트 아이콘 정리
- 수정코드
  - `router/auth.py`
  - `services/user_store.py`
  - `static/css/auth_cleanpay.css`
  - `static/js/signup.js`
  - `templates/base.html`
  - `templates/login.html`
  - `templates/signup.html`
  - `logo/logo.png`
  - `ABBAS_WEB_devList.md`
- 간단한 설명
  - 회원가입 시 DB 중복 예외를 그대로 노출하지 않도록 바꿔, 이메일 중복은 `이미 존재하는 이메일입니다.`처럼 사용자용 문구로 표시되게 정리했다. 이메일 인증 발송/검증 실패도 내부 예외 문자열 대신 안내 문구만 노출하도록 보강했다.
  - 회원가입 화면은 쇼케이스 타이틀을 `통합관리 솔루션`으로 맞추고, 비밀번호·이름 입력칸 겹침과 `미인증` 상태 배지 줄바꿈이 생기지 않도록 입력/그리드/배지 CSS를 보정했다.
  - 브라우저 탭 아이콘은 `/favicon.ico`가 `ABBAS_WEB/logo/logo.png`를 직접 응답하도록 연결하고, 공통 페이지/로그인/회원가입 템플릿 모두 같은 favicon 경로를 쓰도록 정리했다.

## 35. NAS Center 다중 파일 다운로드 ZIP 구조 평탄화
- 수정코드
  - `router/pages.py`
- 간단한 설명
  - NAS Center에서 여러 파일을 동시에 다운로드할 때 ZIP 내부에 원래 디렉토리 경로까지 함께 들어가던 문제를 수정했다.
  - 이제 다중 선택 다운로드는 선택한 파일/폴더 이름만 ZIP 루트 기준으로 담고, 같은 이름이 겹치는 경우에는 ` (2)` 접미사를 붙여 충돌 없이 내려받도록 정리했다.

## 36. NAS Center 업로드 계정 표시 및 업로더 저장소 DB 전환
- 수정코드
  - `DB/nas_repo.py`
  - `main.py`
  - `router/pages.py`
  - `templates/nas.html`
  - `static/js/nas_page.js`
  - `ABBAS_WEB_devList.md`
- 간단한 설명
  - NAS Center 파일 목록에 `업로드 계정` 컬럼을 추가해 업로드한 사용자의 닉네임과 ID가 함께 보이도록 정리했다. 새 업로드/새 폴더 생성뿐 아니라 이름 변경, 내부 이동, 휴지통 이동/복원 이후에도 업로더 정보가 유지되도록 서버 로직을 보강했다.
  - 업로더 메타는 NAS 숨김 JSON이 아니라 MySQL `nas_item_uploaders` 테이블에 저장하도록 구조를 바꿨고, 기존 NAS에 있던 전체 398개 항목은 이번 채팅 기준 관리자 계정 `sp2passb56(Lion)`으로 DB에 일괄 백필했다.

## 37. 이번 채팅 기준 ABBAS_WEB 소스컨트롤 정리 메모
- 수정코드
  - 코드 수정 없음
- 간단한 설명
  - 이번 채팅의 실변경 파일은 `ABBAS_WEB` 디렉토리 내부(`DB/nas_repo.py`, `main.py`, `router/pages.py`, `templates/nas.html`, `static/js/nas_page.js`, `ABBAS_WEB_devList.md`)로 한정해 정리했다.
  - Arduino/MELAUHF 등 다른 디렉토리에는 영향이 가지 않도록 커밋 범위를 분리하고, NAS 업로더 임시 숨김 JSON은 DB 이관 완료 후 제거하는 기준으로 소스컨트롤 상태를 정리했다.

## 38. 프로필 설정 페이지·상단 사용자 메뉴·권한 확장 추가
- 수정코드
  - `SQL/01_tables.sql`
  - `DB/user_repo.py`
  - `services/user_store.py`
  - `router/pages.py`
  - `templates/base.html`
  - `templates/profile_settings.html`
  - `static/css/cleanpay_theme.css`
  - `static/js/common.js`
  - `static/js/profile_settings.js`
- 간단한 설명
  - 상단 `topbar-user`를 드롭다운 메뉴 구조로 바꾸고, 기존 로그아웃 버튼을 메뉴 안으로 이동했다. `SuperUser` 계정에는 로그아웃 자리 대신 `통합관리` 버튼이 보이도록 정리했고, `admin/superuser` 권한 인식도 함께 확장했다.
  - `/profile-settings` 페이지를 새로 추가해 프로필 이미지, 이름/닉네임, 이메일, 연락처, 부서, 위치, 소개, 비밀번호 변경을 한 화면에서 처리하도록 연결했다.
  - 회원탈퇴는 SweetAlert2 확인 모달을 거쳐 진행되며, 계정/프로필 정보 삭제 후 세션도 함께 정리하도록 보강했다.

## 39. 프로필 설정 UI/네비게이션 정리 및 다크모드 버튼 보강
- 수정코드
  - `templates/base.html`
  - `templates/profile_settings.html`
  - `static/css/cleanpay_theme.css`
- 간단한 설명
  - 프로필 설정 화면은 좌우 요약/수정 레이아웃으로 구성하고, 비밀번호 변경/재확인 정렬과 저장/확인/회원탈퇴 버튼 호버 효과를 라이트·다크모드 모두에서 자연스럽게 보이도록 정리했다.
  - 상단 네비에서 `관리설정` 항목은 제거하고, 프로필 설정 메뉴는 좌측 사이드바에서 다른 메뉴와 같은 형식으로만 보이도록 구조를 다시 맞췄다.
  - 프로필 섹션 타이틀은 최종적으로 `개인 기능설정`으로 반영했다.

## 40. NAS 업로더 프로필 이미지 표시 및 탈퇴 익명화 처리
- 수정코드
  - `DB/nas_repo.py`
  - `router/pages.py`
  - `templates/nas.html`
  - `static/js/nas_page.js`
- 간단한 설명
  - NAS Center의 `업로드 계정` 영역에 닉네임/ID 텍스트만 보이던 구조를 바꿔, 좌측에 사용자 프로필 이미지 또는 이니셜 아바타가 함께 표시되도록 수정했다.
  - 회원탈퇴 시 NAS 업로더 메타는 실제 파일은 유지한 채 닉네임만 남기고, 사용자 ID는 `-`로 익명화되도록 정리했다.

## 41. 대시보드 도넛 차트 테마 전환 즉시 반영 보강
- 수정코드
  - `static/js/common.js`
  - `static/js/dashboard.js`
- 간단한 설명
  - 대시보드 도넛 그래프 내부 텍스트 색상이 테마 전환 직후 바로 바뀌지 않고 hover 때만 갱신되던 문제를 수정했다.
  - 공통 테마 토글에서 `app:themechange` 이벤트를 발생시키고, 대시보드 차트가 이 이벤트와 `data-bs-theme` 속성 변화를 감지해 즉시 다시 그려지도록 보강했다.

## 42. 프로필 업로드 런타임 파일 Source Control 제외 기준 추가
- 수정코드
  - 루트 `.gitignore`
  - `ABBAS_WEB_devList.md`
- 간단한 설명
  - 프로필 설정 기능에서 생성되는 `ABBAS_WEB/static/uploads/profile-images/**` 파일은 사용자 업로드 산출물이므로 기본 커밋 범위에서 제외하도록 기준을 추가했다.
  - 이 기준으로 기능 코드와 런타임 데이터가 분리되어, 다른 디렉토리나 배포 코드에 영향 없이 Source Control을 정리할 수 있게 맞췄다.

## 43. SuperUser 통합관리 페이지 및 관리자 승인 플로우 추가
- 수정코드
  - `SQL/01_tables.sql`
  - `DB/user_repo.py`
  - `services/user_store.py`
  - `router/auth.py`
  - `router/pages.py`
  - `templates/base.html`
  - `templates/login.html`
  - `templates/integrated_admin.html`
  - `static/css/integrated_admin.css`
  - `static/js/integrated_admin.js`
  - `requirements.txt`
- 간단한 설명
  - `SuperUser` 전용 `/integrated-admin` 페이지를 추가하고, CPU/RAM/Storage/Network 상태, 승인 대기 회원, 역할 승격/강등, USB 목록을 한 화면에서 관리할 수 있게 정리했다.
  - 회원가입은 기본적으로 `pending` 승인 대기 상태로 저장되며, 관리자 승인 전 로그인 시 `관리자 승인대기중 입니다` 안내가 뜨도록 승인 플로우를 연결했다.

## 44. 통합관리 슈퍼어드민 다크 UI 및 사이드바/상태표시 보정
- 수정코드
  - `templates/integrated_admin.html`
  - `static/css/integrated_admin.css`
  - `static/js/integrated_admin.js`
- 간단한 설명
  - 첨부 시안 기준의 완전 다크 슈퍼어드민 대시보드 레이아웃으로 통합관리 화면을 재구성하고, 좌측 고정 사이드바/검색/위젯 카드 구조를 반영했다.
  - 모바일 및 낮은 화면 높이에서 하단 요소가 잘리던 문제를 고치고, 세션 상태 텍스트·버튼 색상·카드 레이아웃을 이번 채팅 기준으로 함께 보정했다.

## 45. 통합관리 시스템 메트릭 WebSocket 실시간화 및 브라우저 Presence 추적 추가
- 수정코드
  - `redis/session.py`
  - `router/pages.py`
  - `templates/base.html`
  - `templates/integrated_admin.html`
  - `static/js/live_presence.js`
  - `static/js/integrated_admin.js`
  - `static/css/integrated_admin.css`
- 간단한 설명
  - 통합관리 시스템 메트릭은 WebSocket 기반으로 1초 단위 실시간 갱신되도록 바꾸고, 별도의 브라우저 presence WebSocket을 추가해 실제 창 표시/백그라운드/미접속 상태를 `LIVE / BACKGROUND / INACTIVE`로 구분해 보여주도록 정리했다.
  - 기존 `Active Sessions`는 단순 로그인 유지 세션이 아니라 실제 브라우저 연결 상태 중심으로 바뀌었고, 비활성 계정은 흐리게 보이도록 처리했다.

## 46. 대시보드 도넛 그래프 멀티세그먼트 디자인 및 테마 연동 배경 추가
- 수정코드
  - `static/js/dashboard.js`
  - `static/css/admin.css`
- 간단한 설명
  - 대시보드의 `전체 기기 개수`, `구독 만료 기기 수`, `오늘 적재된 데이터` 도넛 그래프를 첨부 이미지 느낌의 멀티 컬러 분절 링 스타일로 변경하고, 중앙 수치/라벨은 기존처럼 그래프 정중앙에 유지했다.
  - 도넛 그래프 배경은 라이트/다크 모드에 맞는 스테이지 색상으로 분리해 현재 ABBAS_WEB 테마와 자연스럽게 어울리도록 보정했다.

## 47. 사이트 파비콘 교체 및 공통 탭 아이콘 타입 정리
- 수정코드
  - `router/auth.py`
  - `templates/base.html`
  - `templates/login.html`
  - `templates/signup.html`
  - `templates/integrated_admin.html`
  - `logo/abbas_favicon.ico`
- 간단한 설명
  - `/favicon.ico` 응답이 기존 `logo.png` 대신 `abbas_favicon.ico`를 반환하도록 교체하고, media type도 `.ico` 형식에 맞게 정리했다.
  - 공통 베이스/로그인/회원가입/통합관리 템플릿의 favicon 링크 타입을 함께 맞춰 브라우저 탭 아이콘이 일관되게 표시되도록 보정했다.

## 48. 로그인 세션 자동 회수 및 강제 로그인 확인 플로우 추가
- 수정코드
  - `redis/session.py`
  - `router/auth.py`
  - `router/pages.py`
  - `templates/login.html`
- 간단한 설명
  - 동일 계정의 Redis 세션이 남아 있어도 실제 browser presence가 없으면 기존 세션을 자동 회수한 뒤 새 로그인을 허용하도록 로그인 정책을 바꿨다.
  - 실제 presence가 살아 있는 경우에는 로그인 화면에서 `기존 세션 끊고 로그인` 확인을 띄워 강제 로그인할 수 있게 했고, 이전 세션의 presence heartbeat와 WebSocket도 더 이상 살아나지 않도록 정리했다.

## 49. ABBAS Talk 팝업 메신저 및 실시간 협업 기능 추가
- 수정코드
  - `DB/chat_repo.py`
  - `main.py`
  - `router/pages.py`
  - `templates/base.html`
  - `templates/messenger_popup.html`
  - `static/css/messenger.css`
  - `static/css/cleanpay_theme.css`
  - `static/js/messenger.js`
  - `static/img/messenger-room-presets/*`
- 간단한 설명
  - Kakao Work/Channel 스타일을 참고한 전역 팝업형 사내 메신저를 추가하고, 채널·그룹방·DM·안읽음·멘션·읽음 처리·참여자 관리·방 프로필 이미지·우클릭 메뉴·프로필 모달·SweetAlert 기반 편집 흐름을 연결했다.
  - 실시간 WebSocket 이벤트, 상단 메신저 배지/알림 드롭다운, 다크모드 보정, 팝업 드래그 이동, 메시지 수정/삭제 권한 분리, 토스트/모달 레이어 정리까지 이번 채팅 기준으로 함께 반영했다.

## 50. NAS 업로드 계정 닉네임 동기화 및 브라우저 메시지 알림 보강
- 수정코드
  - `DB/nas_repo.py`
  - `router/pages.py`
  - `static/js/messenger.js`
  - 루트 `.gitignore`
- 간단한 설명
  - 프로필에서 닉네임을 바꿔도 `/nas`의 `업로드 계정`이 예전 닉네임을 보여주던 문제를 수정하고, 프로필 저장 시 NAS 업로더 메타데이터도 함께 갱신되도록 정리했다.
  - 메신저는 브라우저 최소화/백그라운드 상태에서도 새 메시지를 시스템 알림으로 띄울 수 있게 보강했고, 런타임 업로드 파일과 참고용 캡처 이미지는 Source Control 기본 범위에서 제외되도록 정리했다.

## 51. NAS 모바일 더블탭 파일 다운로드 확인 모달 추가
- 수정코드
  - `templates/nas.html`
  - `static/js/nas_page.js`
- 간단한 설명
  - 모바일 터치 환경에서 `/nas` 파일 행을 더블탭하면 기존 NAS 모달과 동일한 스타일의 다운로드 확인 모달이 먼저 뜨고, 확인 시 실제 다운로드가 시작되도록 정리했다.
  - 폴더는 모바일 더블탭 시 기존 의미대로 열리도록 유지하고, 데스크톱 `dblclick` 흐름은 그대로 두어 입력 환경별 동작이 섞이지 않게 보강했다.

## 52. NAS 모바일 다운로드 더블동작 감지 보강
- 수정코드
  - `static/js/nas_page.js`
- 간단한 설명
  - 일부 모바일/테스트 환경에서 다운로드 확인 모달이 뜨지 않던 문제를 보완하기 위해 터치 입력 판별을 `matchMedia`뿐 아니라 `sourceCapabilities`, `pointerType`, `maxTouchPoints`까지 함께 보도록 넓혔다.
  - 파일 `dblclick`도 다운로드 확인 모달로 직접 연결해, 실제 모바일 더블탭과 브라우저 모바일 테스트 환경의 마우스 더블클릭 모두 같은 흐름으로 동작하도록 정리했다.

## 53. Android 7.1.2 대응 NAS 터치 더블탭/롱프레스 억제 보강
- 수정코드
  - `static/js/nas_page.js`
  - `templates/nas.html`
- 간단한 설명
  - Android 7.1.2 실기기에서 더블탭 시 브라우저 확대가 먼저 일어나고, 롱프레스 시 행 드래그/컨텍스트 메뉴가 개입하던 문제를 줄이기 위해 `touchstart/touchmove/touchend` 기반 행 처리와 합성 click 무시, drag/contextmenu 억제를 추가했다.
  - `.nas-file-row`에 `touch-action: manipulation`과 `-webkit-touch-callout: none`을 넣고, 터치 직후에는 `dragstart`/`contextmenu`를 잠시 차단해 모바일 더블탭 다운로드 모달 흐름이 끊기지 않도록 정리했다.

## 54. NAS 모바일 파일 재터치 즉시 다운로드 및 스크립트 캐시 갱신
- 수정코드
  - `static/js/nas_page.js`
  - `templates/nas.html`
- 간단한 설명
  - 모바일에서는 같은 파일을 다시 터치하면 확인 모달 없이 바로 다운로드를 시작하고, 같은 폴더를 다시 터치하면 바로 진입하도록 `activateRowItem()` 기준으로 동작을 단순화했다.
  - `nas_page.js` 로드 쿼리 버전을 갱신해 구형 안드로이드 브라우저가 이전 캐시 스크립트를 계속 쓰지 않도록 정리했다.

## 55. 메신저 우측 상단 토스트 세로 블러 배경 제거
- 수정코드
  - `static/css/cleanpay_theme.css`
  - `templates/base.html`
- 간단한 설명
  - ABBAS Talk에서 메시지 복사/삭제 시 SweetAlert2 토스트가 우측 상단에 뜰 때, 다크모드에서만 컨테이너 전체에 세로로 길게 깔리던 블러 배경이 보이지 않도록 토스트 위치용 `swal2-container` 예외 스타일을 추가했다.
  - 라이트/다크 모두 토스트 카드만 남고 뒤쪽 긴 블러 오버레이는 생기지 않도록 정리했으며, CSS 캐시가 남지 않게 `cleanpay_theme.css` 버전 쿼리도 함께 갱신했다.

## 56. ABBAS Talk 대화 전체 백업 및 Source Control 안전 정리
- 수정코드
  - `DB/chat_repo.py`
  - `main.py`
  - `.gitignore`
- 간단한 설명
  - ABBAS Talk의 채널/그룹채팅/개인톡 메시지를 방 단위 스냅샷과 텍스트 내역으로 `Talk_BackUp` 디렉토리에 자동 백업하도록 추가했고, 서버 시작 시 기존 대화도 한 번에 동기화되도록 연결했다.
  - 메시지 전송/수정/삭제, 방 생성/수정/삭제, 멤버 추가 시 백업이 즉시 갱신되게 정리했으며, 런타임 백업 산출물 `Talk_BackUp/`은 다른 디렉토리에 영향이 가지 않도록 Source Control 기본 추적 대상에서 제외했다.

## 57. ABBAS Talk 그룹 통화 LiveKit 연동 및 50명급 카메라 그리드 추가
- 수정코드
  - `requirements.txt`
  - `router/pages.py`
  - `templates/base.html`
  - `templates/messenger_popup.html`
  - `static/css/messenger.css`
  - `static/js/messenger.js`
- 간단한 설명
  - ABBAS Talk 메신저에 LiveKit 기반 그룹 통화 세션 생성과 방별 call presence/signaling 연동을 추가해, 브라우저가 room token을 받아 self-hosted SFU에 접속하도록 정리했다.
  - 통화 바/참여 버튼/마이크·카메라·화면공유·나가기 UI와 영상 그리드를 붙였고, 카메라를 켠 참가자는 모두 타일로 표시되며 인원 수가 많아질수록 더 촘촘한 레이아웃으로 배치되도록 정리했다.

## 58. 무료 self-hosted LiveKit 실행 스크립트·systemd 정리 및 Source Control 안전 기준 추가
- 수정코드
  - `.gitignore`
  - `LIVEKIT_SETUP.md`
  - `scripts/livekit_local.sh`
  - `scripts/abbas_web_service.sh`
  - `scripts/start_group_call_stack.sh`
  - `deploy/systemd/abbas-livekit.service`
  - `deploy/systemd/abbas-web.override.conf`
- 간단한 설명
  - 프로젝트 내부 `bin/livekit-server`와 `systemd` 서비스(`abbas-livekit.service`, `abbas-web.service`) 기준으로 self-hosted LiveKit과 ABBAS_WEB를 안전하게 재기동할 수 있는 스크립트와 문서를 추가했다.
  - 런타임 바이너리/PID/로그 파일은 `.gitignore`로 기본 추적 대상에서 제외해 다른 디렉토리에 영향이 가지 않도록 정리했고, 중복으로 8000 포트를 잡던 기존 `for_rnd_web.service`는 비활성화 기준으로 문서화했다.

## 59. ASCORD 음성채널/STAGE 확장과 LiveKit 외부망 연결 안정화
- 수정코드
  - `DB/chat_repo.py`
  - `router/pages.py`
  - `templates/base.html`
  - `templates/messenger_popup.html`
  - `static/css/messenger.css`
  - `static/js/live_presence.js`
  - `static/js/messenger.js`
  - `deploy/systemd/abbas-livekit.service`
  - `deploy/raspberrypi/nginx-abbas-web.conf`
  - `scripts/livekit_local.sh`
  - `deploy/livekit/livekit.yml`
- 간단한 설명
  - `messenger-popup-window`를 `ASCORD` 전용 음성채널 화면으로 확장하고, VOICE/STAGE 모드, 발언 요청/승격, 수신 통화/부재중, 권한 매트릭스, 운영 로그, 장치 선택, PTT, 개별 볼륨, 카메라 타일 그리드까지 디스코드식 통화 UX를 한 흐름으로 정리했다.
  - self-hosted LiveKit의 WSS/TURN/TLS/릴레이 설정과 메신저 웹소켓 재연결, 읽음 처리, 채널 입장, 알림 배지, 통화 상태 동기화 버그를 함께 보정해서 외부망 실사용 점검이 가능한 기준까지 맞췄다.

## 60. WEB 보안/운영 보강과 메신저·플랫폼 모듈 분리 정리
- 수정코드
  - `.gitignore`
  - `DB/chat_repo.py`
  - `DB/user_repo.py`
  - `core/auth_middleware.py`
  - `main.py`
  - `redis/session.py`
  - `redis/simple_redis.py`
  - `router/auth.py`
  - `router/pages.py`
  - `router/messenger_access.py`
  - `router/messenger_api.py`
  - `router/messenger_events.py`
  - `router/messenger_payloads.py`
  - `router/messenger_runtime.py`
  - `router/messenger_views.py`
  - `router/messenger_ws.py`
  - `router/platform_api.py`
  - `router/integrated_admin_api.py`
  - `router/page_routes.py`
  - `scripts/migrate_csv_to_mysql.py`
  - `services/user_store.py`
  - `static/css/messenger.css`
  - `static/js/messenger.js`
  - 삭제 정리: `router/web.py`, `router/mainPage.py`, `storage/user_store.py`, `utils/smtp_utils.py`, `redis/simple_redis.py.bak`
- 간단한 설명
  - 로그인 `next` 안전화, 인증 rate limit, 세션/Redis 처리 보강, 레거시 user store/migration 정합화, 채팅 백업 startup 처리 보정 등 운영 안정성과 보안 측면을 먼저 정리했다.
  - 메신저 REST/WebSocket/runtime/payload/view/access 계층과 플랫폼/통합관리/일반 페이지 라우트를 별도 모듈로 분리해 `router/pages.py` 결합도를 낮추고, 미사용 파일은 Source Control에 남지 않게 정리했다.
  - 이번 채팅 기준 검증은 `python3 -m compileall -q . -x 'venv'`, `git diff --check`, 1st-party JS `node --check`, `venv` 기반 라우터 로드 확인까지 완료했다.

## 61. ASCORD 디스코드형 음성채널 UI 재구성과 로그 500 원인 패치
- 수정코드
  - `ABBAS_WEB_devList.md`
  - `DB/chat_repo.py`
  - `static/css/messenger.css`
  - `static/js/messenger.js`
  - `templates/messenger_popup.html`
- 간단한 설명
  - ASCORD 음성채널 화면을 디스코드 스크린샷 기준으로 다시 정리하면서 서버 드롭다운, 초대 모달, 좌측 음성 도크, 하단 콜 도크, 전체화면, 채널 생성 모달, 화면공유 선택 UI, hover 메타/버튼 노출, speaking 강조, 라이트·다크 테마 전환까지 한 흐름으로 재구성했다.
  - `uvicorn.log`에 남아 있던 메신저 bootstrap 500 오류는 `DB/chat_repo.py`의 SQL `LIKE 'ascord:%'` 패턴이 PyMySQL `%` 포맷과 충돌하던 문제로 확인했고, `%%` 이스케이프 처리로 수정했다.
  - 이번 채팅 기준 검증은 `python -m py_compile`, Chromium 기반 JS 파싱 확인, CSS 계산값 확인, `list_call_logs_for_room()` 직접 호출, `/login` HTTP 응답 확인까지 진행했다.

## 62. ASCORD 음성채널 실시간 상태 동기화와 테마/UI 후속 보정
- 수정코드
  - `ABBAS_WEB_devList.md`
  - `router/messenger_runtime.py`
  - `router/messenger_ws.py`
  - `static/css/messenger.css`
  - `static/js/messenger.js`
- 간단한 설명
  - ASCORD 음성채널 참가자 렌더링을 후속 보정해서 캠/화면공유 카드와 오디오 전용 네임카드가 함께 보이도록 정리했고, 채널 목록의 통화 경과시간이 실시간으로 갱신되며 다른 음성채널의 참가자와 마이크 음소거·헤드셋 상태도 라이브로 노출되게 보정했다.
  - 라이트/다크 모드별 네임카드 배경·텍스트·메타·버튼 대비를 다시 잡고, 공유 모달 선택 상태 표시, 유틸리티 카드 버튼 배치, 빈 ASCORD 통화 화면의 전체 폭 정렬, LiveKit 영상 카드 초기 흰색 깜빡임 완화까지 함께 정리했다.
  - 메신저 부트스트랩/웹소켓 재연결 시 모든 ASCORD 음성채널에 `call_sync`를 보내도록 바꿔 새로고침 직후에도 채널 클릭 없이 라이브 멤버 정보가 채워지게 했고, 검증은 `git diff --check`, `python -m py_compile`, Chromium 기반 JS/CSS 계산값 확인으로 점검했다.

## 63. ASCORD 워크스페이스/음성채널 운영 UX 보강과 정렬·빈화면 후속 수정
- 수정코드
  - `ABBAS_WEB_devList.md`
  - `DB/chat_repo.py`
  - `router/messenger_api.py`
  - `router/messenger_views.py`
  - `static/css/messenger.css`
  - `static/js/messenger.js`
  - `templates/messenger_popup.html`
- 간단한 설명
  - ASCORD 전용으로 워크스페이스명을 `ABBA-S Korea`로 고정하고, 불필요한 서버 메뉴를 제거했으며, 설정 패널 토글 동작, 라이트·다크 모드별 수신함/공유 모달 대비, 채널 멤버 상태 아이콘 위치, 도크 버튼 구성, 입장 효과음, 빈 음성채널 화면 커버 영역까지 디스코드식 운영 UX에 맞춰 후속 보정했다.
  - ASCORD 음성채널은 `channel_sort_order` 기반으로 위치가 고정되게 바꾸고, `admin`/`superuser`만 드래그앤드롭으로 순서를 바꿀 수 있도록 저장 API와 DB 정렬 필드를 추가했다. 동시에 마이크 음소거/헤드셋 상태 변경 시 참가자 카드 순서가 흔들리지 않도록 룸별 참여자 순서를 고정 캐시하도록 정리했다.
  - 이후 사용자 피드백으로 헤드셋 버튼 복구, 정렬 저장 검증 완화, 빈 ASCORD 스테이지의 스크롤/높이 맞춤까지 추가 보정했고, 이번 채팅 기준 검증은 `git diff --check`, `python3 -m py_compile`, Chromium 기반 JS 로드 확인, `uvicorn.log` 최근 구간 점검으로 마무리했다.

## 64. ASCORD 기본 채널 선택 고정과 카드 더블클릭 참가·장치 확인 모달 보강
- 수정코드
  - `ABBAS_WEB_devList.md`
  - `router/messenger_payloads.py`
  - `static/js/messenger.js`
- 간단한 설명
  - ASCORD 첫 진입/새로고침 시 임의 채널이 아니라 기본 음성채널 `전체 채널`(`room_key = ascord:global`)이 먼저 선택되도록 부트스트랩과 프론트 기본 선택 우선순위를 함께 정리했다.
  - 음성채널 참가 UX는 우측 볼륨 버튼 의존도를 낮추고, 사이드바 채널 카드 자체를 더블클릭하면 바로 참가되게 바꿨다.
  - 마이크나 출력 장치가 비어 있는 경우에는 참가 전에 장치 확인 모달을 띄우고, 새로고침으로 장치 목록을 다시 잡은 뒤 참가/취소를 고를 수 있게 했으며, 마이크가 없더라도 듣기 전용으로 ASCORD 채널에 참가할 수 있도록 보강했다.

## 65. ASCORD 효과음 적용과 올뮤트·카드 비주얼 후속 보정
- 수정코드
  - `ABBAS_WEB_devList.md`
  - `main.py`
  - `static/css/messenger.css`
  - `static/js/messenger.js`
  - `sounds/ascord_join.mp3`
  - `sounds/ascord_out.mp3`
  - `sounds/ascord_mute.mp3`
  - `sounds/ascord_unmute.mp3`
  - `sounds/ascord_stream_start.mp3`
  - `sounds/ascord_stream_stop.mp3`
- 간단한 설명
  - ASCORD 음성채널 참가/퇴장, 마이크·헤드셋 올뮤트/해제, 화면공유 시작/종료 시 각각 전용 MP3 효과음이 재생되도록 `sounds` 정적 경로와 프론트 재생 유틸을 연결했다.
  - 음성채널 이동은 이미 다른 채널에 들어간 상태에서도 카드 더블클릭만으로 바로 전환되게 single click 선택 지연을 보강했고, 올뮤트 시에는 마이크 상태도 함께 꺼져 보이도록 도킹 버튼 상태와 헤드셋 슬래시 아이콘 스타일을 정리했다.
  - ASCORD 통화 카드 UI는 사용자별 랜덤 컬러를 라이트/다크 테마 밝기에 맞춰 적용하고, 하단 배지가 전체화면 버튼과 겹치지 않도록 여백을 조정했으며, `LIVE`/`PINNED` 텍스트 배지는 제거하고 좌상단 핀 아이콘으로 고정 표시되게 다듬었다.

## 66. ASCORD 서버 초대 모달 재구성과 ABBAS Talk DM 초대 카드 흐름 추가
- 수정코드
  - `ABBAS_WEB_devList.md`
  - `DB/chat_repo.py`
  - `router/messenger_api.py`
  - `router/messenger_views.py`
  - `static/css/messenger.css`
  - `static/js/messenger.js`
- 간단한 설명
  - ASCORD 전용 초대 모달을 디스코드형 구조로 다시 정리하면서 라이트 모드 기준으로 색감과 섹션 배치를 다듬었고, 기존 `LIVE 채널`/`새 채널` 진입 요소를 정리한 뒤 `서버 멤버`와 `서버에 초대하기`를 분리해 볼 수 있는 아코디언형 초대 모달로 확장했다.
  - 백엔드에는 `chat_workspace_members` 테이블을 추가해 ASCORD 서버 초대 상태를 `active`/`invited`로 따로 관리하도록 했고, 서버 초대 모달 조회 API·ASCORD 초대 DM 전송 API·개인톡 초대 메시지 수락 API를 함께 연결했다.
  - 초대 버튼을 누르면 해당 사용자와의 ABBAS Talk 개인톡에 `ascord_invite` 카드 메시지가 전송되고, 받은 사용자는 메시지 카드의 `음성 채널 참가하기` 버튼으로 초대를 수락해 ASCORD 멤버 상태를 활성화하고 대상 음성채널 입장 흐름으로 이어지도록 구성했다. 이번 채팅 기준 검증은 `python3 -m py_compile`, `git diff --check`까지 완료했다.

## 67. ASCORD 프로필·채널 생성·통화 스테이지 UX 후속 보정
- 수정코드
  - `ABBAS_WEB_devList.md`
  - `DB/user_repo.py`
  - `router/messenger_api.py`
  - `router/messenger_payloads.py`
  - `router/messenger_views.py`
  - `router/pages.py`
  - `static/css/messenger.css`
  - `static/js/messenger.js`
  - `templates/messenger_popup.html`
- 간단한 설명
  - ASCORD 하단 프로필 카드를 디스코드형 구조로 다시 정리하고, 프로필 메뉴·상태 서브메뉴·상태 override 저장을 연결해 `온라인/자리 비움/방해 금지/오프라인 표시`를 실제로 바꾸고 부트스트랩 응답과 하단 상태 표시에도 반영되게 보강했다.
  - 채널 생성 모달은 디스코드형 레이아웃으로 재구성한 뒤 공개/비공개 채널 토글, 채널 타입 라디오, 비공개 멤버 선택 리스트, 선택 체크/테두리/상태점, 라이트·다크 테마별 강조색까지 후속 보정했다. 화면공유는 웹 제약에 맞춰 별도 ASCORD 선택 모달 없이 브라우저 공유 선택기로 바로 이어지게 정리했다.
  - ASCORD 통화 스테이지는 빈 화면 헤더를 stage 내부로 재배치해 배경이 자연스럽게 이어지도록 정리했고, 실제 음성채널 입장 후에는 상단 헤더 슬롯이 hover 시 위에서 아래로 내려오는 애니메이션으로 보이게 맞췄다. 함께 워크스페이스 서버 메뉴를 카테고리 단위 구분선으로 정리하고 `서버 나가기`는 라이트·다크 모두 빨간 강조가 유지되게 다듬었다. 이번 채팅 기준 검증은 `python3 -m py_compile`, `git diff --check`까지 완료했다.

## 68. ASCORD 통화 카드·전체화면 렌더 안정화와 empty stage 높이 보정
- 수정코드
  - `ABBAS_WEB_devList.md`
  - `static/css/messenger.css`
  - `static/js/messenger.js`
- 간단한 설명
  - ASCORD 음성채팅에서 카메라와 화면공유를 켰을 때 카드 상태에서는 정상인데 전체화면에서 `네임카드/검은 화면/실제 영상`이 반복되던 문제를 추적해, 통화 카드와 전체화면 슬롯이 같은 LiveKit 트랙을 계속 다시 붙이지 않고 기존 미디어 엘리먼트를 재사용하도록 렌더 경로를 안정화했다.
  - 트랙 준비 전 placeholder를 너무 빨리 숨기지 않도록 ready 처리 시점을 보강하고, remote audio sink도 불필요한 재생성을 줄여 전체적인 통화 렌더가 더 안정적으로 유지되게 정리했다.
  - 후속 회귀로 남았던 ASCORD empty stage의 높이 계산도 함께 보정해 `messenger-call-empty messenger-call-empty--ascord`가 `messenger-popup-window` 아래로 밀려나지 않도록 맞췄다. 이번 채팅 기준 검증은 `git diff --check`까지 완료했고, 이 환경에는 `node`가 없어 JS 문법 체크는 별도로 돌리지 못했다.

## 69. Notiba AI 패널 아이콘 적용과 ASCORD 영상 비율 유지 보정
- 수정코드
  - `ABBAS_WEB_devList.md`
  - `logo/Notiba_ai.png`
  - `main.py`
  - `static/css/messenger.css`
  - `static/js/messenger.js`
  - `templates/messenger_popup.html`
- 간단한 설명
  - `messengerRoomLinkBtn`은 더 이상 대화 링크를 복사하지 않고, 오른쪽에서 왼쪽으로 슬라이드 인되는 패널을 여는 버튼으로 유지하면서 패널 타이틀을 `Notiba AI`로 고정했다. 버튼과 패널 좌측 아이콘은 `/logo/Notiba_ai.png`를 공용으로 사용하도록 연결했고, `/logo` 정적 경로도 함께 마운트했다.
  - 사용자 제공 `Notiba_ai.png`를 기준으로 버튼/드로어 아이콘 크기를 단계적으로 키우고, `messengerRoomLinkBtn` 안에서 아이콘이 정중앙에 보이도록 padding 제거와 위치 보정까지 반영했다. 라이트/다크 모드의 기존 패널 색상은 유지하면서 아이콘만 자연스럽게 교체되게 정리했다.
  - ASCORD 음성채팅에서는 카메라 카드와 전체화면 슬롯이 영상 비율 때문에 늘어나지 않도록 카드 높이를 고정하고 `object-fit: contain` 기준으로 바꿔, 남는 위아래 공간은 검은 배경 또는 전체화면 배경으로 처리되게 보강했다. 이번 채팅 기준 검증은 `python3 -m py_compile`, `git diff --check`까지 완료했다.

## 70. Notiba AI 버튼 노출 범위 조정과 ASCORD hover 안정화
- 수정코드
  - `ABBAS_WEB_devList.md`
  - `static/css/messenger.css`
  - `static/js/messenger.js`
- 간단한 설명
  - ABBAS Talk에서는 헤더 액션 전체를 숨기지 않고, `messenger-notiba-ai-icon messenger-notiba-ai-icon--button`을 사용하는 `messengerRoomLinkBtn`만 감추도록 범위를 다시 좁혔다.
  - ASCORD 음성채팅 중 하단 `messenger-ascord-call-dock`가 hover 해제 후 한 번씩 남아 있던 문제는 CSS 인접 hover 의존을 끊고, `pointerenter/pointerleave` 기반의 visible 클래스 동기화로 바꿔 안정적으로 내려가게 보강했다.
  - `Notiba AI` 창을 열었을 때는 `messengerRoomLinkBtn`에 남아 있던 focus 때문에 상단 `messenger-chat-header`가 자동으로 올라가지 않던 문제를 함께 정리해, 버튼 focus를 지우고 drawer 닫기 버튼으로 넘기도록 수정했다. 이번 채팅 기준 검증은 `git diff --check`까지 완료했다.

## 71. Notiba AI OpenAI 실시간 전사 전환과 채널별 회의록 저장/브라우저 추가
- 수정코드
  - `ABBAS_WEB_devList.md`
  - `.gitignore`
  - `requirements.txt`
  - `router/messenger_api.py`
  - `router/messenger_runtime.py`
  - `router/pages.py`
  - `services/meeting_notes.py`
  - `services/notiba_stt.py`
  - `static/css/messenger.css`
  - `static/js/messenger.js`
  - `templates/messenger_popup.html`
- 간단한 설명
  - Notiba AI 전사 엔진을 라즈베리파이 로컬 추론 중심 구조에서 OpenAI Realtime 기반의 유저별 오디오 전사 구조로 전환해, ASCORD 음성채팅 참여자 각각의 발화를 더 빠르게 `A : ... / B : ...` 형식으로 누적 표시할 수 있게 정리했다. partial/final 전사 이벤트와 pending 표시, Realtime 세션 발급, 브라우저 직접 SDP 연결 흐름도 함께 보강했다.
  - Notiba AI의 최종 전사 문장은 채널/통화별로 `/meeting_data` 아래에 `YYYY-MM-DD-HH-MM-SS OO채널 회의록.txt` 형식으로 자동 저장되도록 `meeting_notes` 서비스를 추가했다. 파일 내용은 첫 줄 저장 시각, 둘째 줄 채널명, 이후 `유저 : 내용` 줄 단위 누적으로 기록되며, 병렬 통화도 채널별로 따로 분리 저장되게 구성했다.
  - ASCORD 좌측 사이드바의 `이벤트` 단축버튼은 `회의록`으로 교체했고, 누르면 채널별 회의록 브라우저 모달이 열리도록 확장했다. 채널 항목에 커서를 올리면 오른쪽에서 날짜별 회의록 목록이 슬라이드되며, 개별 회의록을 클릭하면 별도 뷰어 모달에서 전체 내용을 읽을 수 있게 했다. 함께 사용하지 않던 대용량 `한국인 피부상태 측정 데이터` 폴더도 정리했다. 이번 채팅 기준 검증은 `python3 -m py_compile`, `git diff --check`, 임시 경로 회의록 저장/조회 스모크 테스트까지 완료했다.

## 72. 삭제된 채널 회의록 버킷 노출과 우측 목록 표시 보정
- 수정코드
  - `ABBAS_WEB_devList.md`
  - `router/messenger_api.py`
  - `services/meeting_notes.py`
  - `static/css/messenger.css`
  - `static/js/messenger.js`
- 간단한 설명
  - 음성채널 삭제 시 기존 회의록 텍스트 파일은 남기되, 회의록 모달에서 사라지지 않도록 `삭제된 채널` 버킷을 추가했다. 삭제 시점의 채널명과 기존 멤버 ID를 메타데이터로 저장해, 원래 그 채널을 볼 수 있던 사용자만 계속 열람할 수 있게 했다.
  - 회의록 목록 API는 현재 살아 있는 ASCORD 음성채널 외에도 삭제 메타가 남아 있는 회의록 폴더를 함께 스캔해 `삭제된 채널` 항목으로 묶어 내려주고, 각 회의록에는 원래 채널명을 함께 표시하도록 보강했다.
  - 프론트에서는 `삭제된 채널` 항목의 hover/선택 스타일을 별도로 다듬고, 내부적으로 사용하는 가상 room id도 정상 선택 대상으로 처리해 오른쪽 날짜별 회의록 패널이 즉시 열리도록 수정했다. 이번 채팅 기준 검증은 `python3 -m py_compile`, `git diff --check`, 임시 경로 삭제 회의록 읽기 스모크 테스트까지 완료했다.

## 73. Notiba AI 설정값 settings.env 외부화와 프론트 튜닝 연동
- 수정코드
  - `ABBAS_WEB_devList.md`
  - `services/notiba_stt.py`
  - `static/js/messenger.js`
- 간단한 설명
  - Notiba AI의 OpenAI Realtime 전사 설정을 서버 코드 안의 고정 상수 대신 env 기반 로더로 재구성해, 모델명·언어·노이즈 리덕션·VAD threshold/prefix/silence·프롬프트·타임아웃을 `settings.env` 기준으로 바로 조절할 수 있게 정리했다.
  - 프론트에서 하드코딩되어 있던 Notiba AI 병합 시간, 최대 글자 수, partial 전송 주기, 재연결 지연, 마이크 캡처 옵션도 서버가 내려주는 `client_tuning` 값을 따라가도록 연결해, `settings.env` 한 곳에서 실사용 튜닝을 바꿀 수 있게 맞췄다.
  - 기존 Notiba AI 동작을 깨지 않도록 기본값은 이전과 동일하게 유지했고, 이번 채팅 기준 검증은 `python3 -m py_compile`, `git diff --check`, 런타임 설정값 로드 확인까지 완료했다.

## 74. ATmega Firmware Manage 페이지와 즉시 OTA 명령 연동
- 수정코드
  - `ABBAS_WEB_devList.md`
  - `router/page_routes.py`
  - `router/pages.py`
  - `router/platform_api.py`
  - `static/js/firmware_manage.js`
  - `templates/base.html`
  - `templates/firmware_manage.html`
- 간단한 설명
  - 기존 ESP32용 펌웨어 관리 화면을 일반화해 `/firmware-manage-atmega` 페이지를 추가하고, ATmega 전용 family filter, HEX 업로드 허용, 요약/릴리스/디바이스 payload 분리, 관리자 네비게이션 진입점을 함께 붙였다.
  - 서버에서는 ATmega 릴리스 업로드 API와 장비 일괄 명령 큐 API를 추가해 배정 직후 `CHECK_OTA`를 바로 넣을 수 있게 했고, 프론트 JS도 payload/upload/즉시실행 경로를 data attribute 기반으로 재사용하도록 정리해 ESP32/ATmega 관리 화면을 같은 템플릿으로 운용할 수 있게 맞췄다.
