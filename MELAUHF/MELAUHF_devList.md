# MELAUHF_devList

## 1. 68번 부팅 페이지에서 READY 상태를 임시 상태로 변경
- 수정코드
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/main.c`
  - `SUB_STATE_READY`를 61페이지 진입 허용 상태에서 제외
- 간단한 설명
  - 구독 회수, 무플랜, 초기 등록 상태에서 READY만 보고 61페이지로 이동하던 문제를 막도록 수정했다.
  - 최종 상태가 READY로 남으면 59페이지 만료 잠금으로 처리하도록 정리했다.

## 2. ACTIVE 상태는 플랜E/사용E 확인 후에만 61페이지 진입 허용
- 수정코드
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/main.c`
  - `ENG|A`, `ENG|U` 수신 확인 플래그 추가
  - 플랜E 0 또는 `사용E >= 플랜E`이면 59페이지 분기
- 간단한 설명
  - 68번 페이지에서 ACTIVE만 먼저 받아도 바로 61로 가지 않도록 수정했다.
  - 에너지 메트릭까지 확인한 뒤 정상 조건일 때만 61페이지로 풀리게 했다.

## 3. READY 수신 시 로컬 사용E/플랜 미러 초기화
- 수정코드
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/main.c`
  - `energy_clear_subscription_snapshot()` 추가
- 간단한 설명
  - 회수 후 오프라인 부팅 또는 무플랜 READY 수신 시 이전 세션의 A200/플랜 정보가 남지 않도록 로컬 미러를 0으로 초기화했다.
  - 부팅 중 stale 값 재사용 때문에 잘못 풀리는 경로를 줄이도록 정리했다.

## 4. 59/20 페이지 자동 해제 조건 보강
- 수정코드
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/main.c`
  - `subscription_restore_ready_page()` 분기 재정렬
- 간단한 설명
  - 만료/오프라인 페이지에 있을 때도 현재 구독/에너지 판정을 다시 통과한 경우에만 61페이지로 복귀하도록 수정했다.
  - READY만 들어온 상태에서는 자동 해제되지 않도록 정리했다.

## 5. 62페이지 운전 중 WEB 회수 시 59페이지 강제 이동 보강
- 수정코드
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/main.c`
  - `subscription_ready_pending_arm()`, `subscription_ready_pending_tick()` 추가
- 간단한 설명
  - 62페이지에 머무르는 상태에서 WEB 플랜 페이지의 회수 처리로 READY만 들어오면 기존에는 화면이 그대로 유지될 수 있었다.
  - READY 뒤에 ACTIVE가 짧은 유예 시간 안에 오지 않으면 59페이지 만료 잠금으로 전환하도록 런타임 분기를 보강했다.

## 6. OTA 직접 구현 주체를 ESP32로 유지하는 구조 확인
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `펌웨어/hi-aba_total_rev6_brf/hi-aba/main.c`, `common.h`
- 간단한 설명
  - MELAUHF 쪽에는 HTTP 다운로드/이미지 검증/재부팅 기반 OTA 로직을 넣지 않고, ESP32가 WEB과 통신하며 pull-OTA를 수행하는 구조를 유지한다.
  - 이 디렉토리는 OTA 적용 엔진 자체보다는 운전/에너지 상태를 ESP에 넘겨 OTA 판정에 간접 참여하는 역할로 정리했다.

## 7. 운전 상태 UART 이벤트로 ESP OTA 차단 판단 지원
- 수정코드
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/main.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/common.h`
- 간단한 설명
  - `energy_uart_publish_run_event()` 경로로 run start/stop과 totalEnergy를 ESP32에 전달해, ESP가 운전 중에는 OTA를 건너뛰도록 연동했다.
  - OTA 자체는 ESP가 수행하지만, 실제 장비가 가동 중인지 판정하는 신호는 MELAUHF 런타임이 제공하도록 역할을 나눴다.

## 8. totalEnergy 리셋 시 ESP 쪽 OTA/에너지 상태 동기화 보강
- 수정코드
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/brf_mode.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/hic_mode.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/nam_mode.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/tron_mode.c`
- 간단한 설명
  - 에너지 리셋 후 `old_totalEnergy` 표시값과 UART run-event를 함께 0으로 맞춰 ESP 쪽 세션/원격 상태가 stale 값으로 남지 않도록 보강했다.
  - 이 동기화 덕분에 ESP의 원격 telemetry, 로그, OTA 전제조건 판정이 장비 내부 에너지 상태와 어긋나지 않게 정리했다.

## 9. 74페이지 OTA 사용자 확인 플로우 추가
- 수정코드
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/main.c`
- 간단한 설명
  - `OTA|Q|현재버전|대상버전` UART 라인을 수신하면 DWIN 74페이지로 이동하고, `0x1A10`/`0x1B50` 텍스트 영역에 현재/대상 버전을 표시하도록 추가했다.
  - 74페이지에서 `0xBC01`(승인) 시 `@OTA|DEC|1`, `0xBC02`(스킵) 시 `@OTA|DEC|0`를 ESP로 전송하고, 같은 부팅 세션에서는 재프롬프트를 막도록 세션 플래그를 구성했다.

## 10. OTA 세션 리셋 명령(`OTA|RST`) 수신 처리 추가
- 수정코드
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/main.c`
- 간단한 설명
  - ESP가 `@OTA|RST`(또는 `@OTA|RESET`)를 보내면 ATmega의 OTA 프롬프트 세션 플래그를 초기화하도록 파서 분기를 추가했다.
  - 필요 시 활성 74페이지 프롬프트를 이전 페이지로 되돌린 뒤 플래그를 리셋해, ESP 단독 재부팅 이후 재프롬프트가 자동 skip으로 오인되지 않도록 정리했다.

## 11. ATmega128A SRAM 초과 링크 에러(.bss) 해소 및 컴파일 경고 정리
- 수정코드
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/main.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/brf_mode.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/hic_mode.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/tron_mode.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/i2c.c`
- 간단한 설명
  - `address ... section '.bss' is not within region 'data'` 링크 실패를 해결하기 위해 ATmega RAM 사용 버퍼를 축소(`SUB_UART_LINE_MAX`, `SUB_UART_Q_DEPTH`, `RKC_UART_Q_DEPTH`)해 SRAM 사용량을 줄였다.
  - `ds1307_dateset` implicit declaration 경고를 없애기 위해 mode 소스에 `ds1307.h` include를 명시했고, `i2c.c`의 `dsi_read()`는 기본 반환값을 추가해 non-void 경고를 정리했다.

## 12. OTA 74페이지와 구독 잠금 페이지(59/20/73) 충돌 루프 차단
- 수정코드
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/main.c`
  - 함수: `subscription_enter_lock_page()`
- 간단한 설명
  - OTA 프롬프트가 활성(`OTA_PROMPT_FLAG_ACTIVE`)된 동안에는 `subscription_enter_lock_page()`가 74페이지 외 페이지 강제를 수행하지 않도록 가드를 추가했다.
  - 이 보강으로 로그에서 확인된 `page 74 -> page 59 -> page 74` 왕복(플리커/루프) 현상을 차단하고, 사용자 승인 키(`0xBC01/0xBC02`) 입력 안정성을 높였다.

## 13. OTA 74페이지 진행 상태 텍스트/아이콘 단계 표시 추가
- 수정코드
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/main.c`
  - 상수 추가: `OTA_TEXT_VP_PROGRESS(0xD222)`, `OTA_PROGRESS_VARICON_VP(0x1C1A)`
  - 함수 추가: `ota_progress_reset()`, `ota_progress_start_download()`, `ota_progress_start_update()`, `ota_progress_enter_reboot()`, `ota_progress_tick()`
- 간단한 설명
  - OTA 승인 후 74페이지에서 `"Downloading. . ." -> "Firmware Update. . ." -> "Rebooting. . ."` 문구를 단계별로 표시하고 varicon 인덱스를 0~9로 진행하도록 보강했다.
  - `OTA|RST`/스킵/재진입 시 진행 상태를 초기화하고, 74페이지 진입 직전 `setStandby()`를 수행해 표시 안정성을 높였다.

## 14. OTA 74페이지 Rebooting 애니메이션을 10~26 반복으로 확장
- 수정코드
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/main.c`
  - 상수 추가: `OTA_REBOOT_ICON_FIRST(10)`, `OTA_REBOOT_ICON_LAST(26)`, `OTA_REBOOT_ANIM_PERIOD_TICKS(245)`
- 간단한 설명
  - `"Downloading. . ."`와 `"Firmware Update. . ."` 단계는 기존처럼 `0x1C1A` varicon을 0~9 진행률로 유지하고, `"Rebooting. . ."` 단계에 들어가면 10~26번 이미지를 0.2초 간격으로 반복 표시하도록 수정했다.
  - 새 전용 타이머 전역 대신 기존 Timer0 기반 `page67_tick`를 재사용해 SRAM 증가를 최소화하면서 74페이지 재부팅 대기 애니메이션만 확장했다.

## 15. 71페이지 ESP/ATmega 버전 문구 표시 추가
- 수정코드
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/main.c`
  - VP 추가: `0xD100`, `0xD500`
- 간단한 설명
  - 71페이지에서 `0xD100`에 `"ESP Ver <version>"`, `0xD500`에 `"ATmega Ver "`를 출력하도록 추가했다.
  - ESP 버전은 기본값으로 `26.3.13.1`을 사용하고, 이후 `@OTA|Q|<current_version>|<target_version>`를 수신하면 현재 버전 값으로 덮어써서 최신 OTA 프롬프트 기준 문자열을 유지하도록 정리했다.

## 16. 62페이지 `0x8016` 냉각 버튼 UI 동기화 버그 수정
- 수정코드
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/tron_mode.c`
- 간단한 설명
  - MA5105 page62의 `0x8016` 버튼이 `cool_ui_show != 0` 조건에 막혀 실제 `peltier_op` 토글과 UI 갱신이 누락되던 문제를 정리했다.
  - 버튼 입력 시 `0x3008` VAR ICON과 `0x1310` 온도 텍스트 숨김/표시가 `peltier_op` 기준으로 즉시 다시 그려지도록 helper 경로를 추가했다.

## 17. MA5105 부팅 68페이지 단계 재구성 및 Wi-Fi 연결 중 63페이지 전환 차단
- 수정코드
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/main.c`
- 간단한 설명
  - 68페이지 `0x0C0A`/`0xC222` 표시를 `0~9` 단계 기준으로 재구성하고, 7단계는 Wi-Fi 연결 시도, 미연결 분기는 8단계(AP 검색)로 표시하도록 조정했다.
  - Wi-Fi 연결 시도 중(`64/65/66/67`)에는 상태 heartbeat가 들어와도 63페이지로 강제 이동하지 않도록 가드를 추가했다.
  - `address ... section '.bss' is not within region 'data'` 링크 에러를 피하기 위해 신규 전역 대신 기존 상태 변수(`p63_scan_busy`)를 재활용해 SRAM 증가 없이 반영했다.

## 18. MA5105 IoT 확장부를 `IOT_mode` 모듈로 분리해 EA2247형 메인 구조로 정리
- 수정코드
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/main.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/IOT_mode.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/IOT_mode.h`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/common.h`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/hi-aba.cproj`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/Debug/Makefile`
- 간단한 설명
  - `main.c`에서 Wi-Fi/OTA/구독/ESP UART/63~74페이지 처리와 관련된 대형 블록을 `IOT_mode.c`로 분리해, EA2247처럼 메인 파일이 부트/EEPROM/모드 선택 중심 역할에 가깝도록 정리했다.
  - 페이지 ID/순서는 유지했고, 기존 MA5105 동작을 바꾸지 않으면서 IoT 확장부만 모듈 경계로 분리했다.
  - 로컬 `avr-gcc` 기준으로 전체 번역 단위 문법 검증은 통과했고, 남은 전체 링크 실패는 기존 SRAM 한계/구형 AVR-GCC 전제 차이 성격으로 확인했다.

## 19. page57/page63/page69 동작 재정리 및 HMI 연동 안정화
- 수정코드
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/IOT_mode.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/tron_mode.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/dwin.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/common_f.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/main.c`
- 간단한 설명
  - page63의 Wi-Fi 연결 후 복귀 분기와 ESP UART 상태줄 처리 우선순위를 다시 정리해, 연결 성공 후 61페이지 복귀와 등록/구독 상태 해석이 더 안정적으로 동작하도록 보강했다.
  - page57은 `ABBAS_WEB -> ESP32 -> @ENG|... -> ATmega` 경로를 다시 점검하고, `0xA100~0xA500`, `0xDA10`, `0xDB01`, `0xBB22`가 ESP의 플랜/에너지 값으로 다시 그려지도록 복구했다.
  - page69는 디버깅 단계에서 27개 숫자 VAR ICON(`0x3301~0x3327`)만 `000` 고정 표시로 잠시 단순화해, 기존 엔지니어링 로직과 화면 숫자 덮어쓰기 경로를 분리해서 점검할 수 있게 정리했다.

## 20. MA5105 69페이지 shadow 곡선/디버그 출력/테스트 버튼 동작 정리
- 수정코드
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/main.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/tron_mode.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/common.h`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/dwin.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/brf_mode.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/hic_mode.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/nam_mode.c`
- 간단한 설명
  - MA5105 69페이지는 `pw_data/pw_data_face` 실시간 배열을 직접 흔들지 않고 shadow anchor 9개를 기준으로 표시/저장/Reset을 처리하도록 다시 묶었고, `0xCCCC` 텍스트에 현재 Body/Face 앵커값 로그를 출력하도록 추가했다.
  - page69는 공통 UI 갱신과 충돌하지 않도록 `0x3301~0x3327` 숫자 VAR ICON 중심으로 분리했고, page62 아이콘 동기화는 62페이지에서만 동작하도록 범위를 좁혔다.
  - `+/-`는 5단위 증감으로 조정했고, `0x4101~0x4109` 테스트 버튼은 EA2247 61페이지와 같은 방식으로 고정 전력 테스트를 시작하고, 테스트 중 첫 입력은 테스트 정지만 수행하도록 정리했다.

## 21. MA5105 62/69페이지 출력 불안정 원인 분석 및 SRAM 초과 보정
- 수정코드
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/main.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/tron_mode.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/tron_mode.h`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/dwin.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/crc.c`
- 간단한 설명
  - MA5105 62페이지 출력과 69페이지 테스트에서 `C/O` 값이 버튼마다 랜덤하게 변하던 현상을 추적한 결과, 보정 곡선 자체 문제 외에 ATmega128A SRAM 초과로 전역 배열과 스택이 서로 덮이는 상태를 확인했다.
  - page62/page63 콘솔 출력(`0xC2D2`), page69 콘솔 출력(`0xA1B1`), page69 테스트 토글/정지, 9개 앵커 기반 부팅 곡선 복원을 정리하고, `dwin.c`/`crc.c`의 CRC 테이블을 `PROGMEM`으로 옮겨 SRAM 사용량을 줄였다.
  - 전체 링크 기준 `data+bss`가 4361B에서 3337B로 내려가도록 보정해, MA5105 62/69페이지 디버그 값이 런타임 메모리 깨짐 때문에 흔들리던 핵심 원인을 해소했다.
