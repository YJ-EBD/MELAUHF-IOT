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

## 22. MA5105 7번 페이지 기기등록 2회 입력 문제와 Text Display 초기화 보강
- 수정코드
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/main.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/dwin.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/dwin.h`
- 간단한 설명
  - 7번 페이지에서 기기번호 입력 후 엔터를 처리하는 로직을 정리하고, page7 진입 직후 UART 파서 상태를 초기화해 첫 입력 시퀀스가 이전 수신 잔여 데이터에 영향받지 않도록 보강했다.
  - MA5105는 기기등록 성공 후 즉시 부트 마커를 갱신해 다음 재부팅에서 다시 page7 등록을 강제하지 않도록 수정해서, `FL0788`처럼 1회 입력 후 엔터 1회로 정상 진입하도록 정리했다.
  - Text Display는 page7 진입/성공 시 전체 클리어와 입력 중 6칸 마스킹 표시를 분리해, 쓰레기값 잔존 없이 초반 입력부터 바로 표시되도록 보강했다.

## 23. MA5105 IoT 확장부를 기능별 파일로 재정리
- 수정코드
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/IOT_mode.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/iot_wifi_flow.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/iot_subscription.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/iot_ota.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/iot_uart_bridge.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/iot_boot.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/hi-aba.cproj`
- 간단한 설명
  - 기존 `IOT_mode.c`에 몰려 있던 Wi-Fi 입력/63페이지 흐름, 구독/에너지 상태, OTA 화면 처리, ESP UART 브리지, 68페이지 부팅 체크를 기능별 파일로 분리하고 `IOT_mode.c`는 facade 역할 위주로 다시 정리했다.
  - 현재 단계는 동작 리스크를 줄이기 위해 단일 translation unit 구조를 유지한 채 파일 경계만 먼저 나눈 상태이며, Atmel Studio 프로젝트에서도 새 파일들이 보이도록 항목을 추가했다.
  - 로컬 `avr-gcc` 기준으로 전체 `.c` 파일 컴파일 검증을 다시 돌려, 이번 분리로 인한 신규 컴파일 에러 없이 기존 경고 수준에서 정리되는 것까지 확인했다.

## 24. MA5105 68페이지 부팅 게이트를 실제 ESP 상태 수신 기반으로 재구성
- 수정코드
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/IOT_mode.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/iot_boot.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/iot_uart_bridge.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/iot_wifi_flow.c`
- 간단한 설명
  - 68페이지 부팅 체크를 로컬 상태 확인, ESP 링크 대기, Wi-Fi 연결 단계, 등록 상태, 구독 상태, 에너지 동기화, 최종 목표 페이지 결정 순서로 다시 묶고, 각 단계를 500ms 이상 유지하면서 ESP 활동 프레임은 최대 30초까지 기다리도록 보강했다.
  - `WIFI|` 라인을 page68에서도 바로 파싱하게 바꾸고, `@P63|M|C/A/E` 부팅 Wi-Fi 단계값을 받아 CONNECTING/AP READY/ERROR를 구분하도록 정리했다.
  - ESP 상태가 오지 않거나 순서가 맞지 않으면 `ERR68-*` 코드와 함께 10페이지로 실패시키고, 한 번 10페이지로 분류된 뒤에는 뒤늦은 Wi-Fi heartbeat가 화면을 다시 끌어가지 못하게 가드를 추가했다.

## 25. page68 부팅 중 OTA 프롬프트는 큐잉 후 최종 단계에서만 표시하도록 조정
- 수정코드
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/IOT_mode.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/iot_boot.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/iot_ota.c`
- 간단한 설명
  - 부팅 중 `OTA|Q|<current>|<target>`가 먼저 들어오면 즉시 74페이지로 튀지 않도록 `ota_boot_prompt_pending`에 임시 저장한 뒤, 68페이지의 target page 결정 이후에만 표시하도록 바꿨다.
  - 부트 상태 리셋 시 대기 중 OTA 버전 문자열과 pending 플래그도 함께 초기화해서 이전 부팅의 잔여 프롬프트가 다음 부팅에 섞이지 않도록 정리했다.

## 26. MA5105 62/69페이지 텍스트 디스플레이 출력만 임시 비활성화
- 수정코드
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/tron_mode.c`
- 간단한 설명
  - 요청 기준으로 62페이지 `0xC2D2`, 69페이지 `0xA1B1`, 69페이지 `0xCCCC` Text display 출력은 `dwin_write_text()` 호출만 주석 처리해서 화면 표시만 끄고 값 조합 로직은 그대로 남겨두었다.
  - 필요 시 주석만 해제하면 바로 복구할 수 있도록 포맷/버퍼 구성 코드는 유지했고, 로컬 `avr-gcc` 컴파일로 문법 이상 없이 반영되는 것까지 다시 확인했다.

## 27. MA5105 62페이지 운전 중 플랜 초과 시 즉시 정지/59페이지 전환 보강
- 수정코드
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/common.h`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/IOT_mode.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/iot_subscription.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/tron_mode.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/hic_mode.c`
- 간단한 설명
  - MA5105 62페이지에서 운전 중 사용 에너지가 플랜 에너지를 초과해도 재부팅 전까지 62페이지에 남던 문제를 수정했다.
  - live session delta를 포함한 runtime guard를 추가해 초과 즉시 `setStandby()`와 run-stop UART publish를 수행하고, 로컬 만료 잠금 상태로 59페이지를 지속 유지하도록 정리했다.

## 28. page68 상태 활동 대기시간을 30초에서 60초로 확대
- 수정코드
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/IOT_mode.c`
- 간단한 설명
  - `PAGE68_STATUS_ACTIVITY_WAIT_MS`를 `30000`에서 `60000`으로 조정해, 68페이지 부팅 중 상태 활동 대기 허용 시간을 60초로 늘렸다.
  - 기존 단계별 분기 구조는 유지한 채, 느린 연결/상태 응답 환경에서도 부팅 실패로 너무 빨리 떨어지지 않도록 여유 시간을 확대했다.

## 29. 저장된 Wi-Fi 3회 실패 후 page68이 page10으로 먼저 떨어지던 타이밍 보정
- 수정코드
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/IOT_mode.c`
- 간단한 설명
  - ESP의 저장된 Wi-Fi 부팅 경로는 `25초 x 3회` STA 재시도 후에야 portal AP를 띄우고 `@P63|M|A`를 보내는데, MA5105 68페이지의 `Connecting Wi-Fi...` 단계 대기가 `15초`라서 AP 준비 전에 `ERR68-18`로 10페이지로 떨어질 수 있었다.
  - `PAGE68_WIFI_STATUS_FRAME_WAIT_MS`를 `90000ms`로 늘려, 저장된 Wi-Fi 3회 실패 시 ESP가 재시도를 멈추고 portal AP를 띄운 뒤 68페이지가 63페이지로 정상 전환되도록 보정했다.

## 30. page68 Wi-Fi 재시도 횟수를 부팅 텍스트에 표시
- 수정코드
  - `Arduino/ABBAS_ESPbyMELAUHF.ino`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/IOT_mode.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/iot_wifi_flow.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/iot_boot.c`
- 간단한 설명
  - ESP가 저장된 Wi-Fi 부팅 재시도마다 `@P63|M|C|<attempt>` 형태로 현재 시도 번호를 ATmega에 보내도록 바꿨다.
  - MA5105 68페이지는 첫 시도(`attempt=1`)에는 `"Connecting Wi - Fi . . ."`를 유지하고, 이후 재시도만 `"Reconnecting Wi - Fi (1) . . ."`, `"Reconnecting Wi - Fi (2) . . ."` 형식으로 다시 그리도록 보강했다.

## 31. ESP32-C5 ATmega ISP/RESET 배선 문서화 연동 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `../Arduino/OTA_ATmega_for_ESP32_Plan.md`
- 간단한 설명
  - 이번 채팅에서는 MELAUHF 펌웨어 코드를 변경하지 않고, ESP32-C5에서 ATmega를 ISP/OTA 준비 용도로 다루기 위한 `2N3904 RESET 제어` 배선안을 Arduino 디렉토리 문서로 정리했다.
  - MELAUHF 디렉토리는 기존 동작에 영향 없이 유지하고, 하드웨어 배선 기준은 별도 문서로 관리하는 방향만 기록했다.

## 32. MA5105 62페이지 Wi-Fi 세기 아이콘을 ESP 직결 갱신으로 연동
- 수정코드
  - 코드 수정 없음
  - 연동 확인 파일: `../Arduino/ABBAS_ESPbyMELAUHF.ino`
- 간단한 설명
  - 이번 채팅의 실제 구현은 Arduino(ESP32)에서 DWIN `VAR ICON 0x0AA5`를 현재 연결된 Wi-Fi RSSI에 따라 `0~3` 단계로 직접 갱신하는 작업이었고, MELAUHF ATmega 펌웨어 코드는 수정하지 않았다.
  - MA5105 62페이지 화면 자산과 페이지 ID는 기존 그대로 유지한 채, Wi-Fi 세기 아이콘만 ESP 쪽에서 주기 갱신하도록 역할을 분리했다.

## 33. 관리자 NAS 페이지 개발에 따른 MELAUHF 디렉토리 무변경 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `펌웨어/hi-aba_total_rev6_brf/hi-aba/IOT_mode.c`
- 간단한 설명
  - 이번 채팅의 실제 구현은 `ABBAS_WEB`에서 관리자 전용 NAS 페이지, role 권한 처리, 파일 브라우저 UI/UX를 정리하는 작업이었고, MELAUHF ATmega 펌웨어 코드는 수정하지 않았다.
  - 펌웨어 디렉토리는 기존 페이지 제어와 시리얼 수신 동작을 그대로 유지한 채 `_devList` 기록만 갱신했다.

## 34. 전체 WEB 콘솔 UI 리뉴얼에 따른 MELAUHF 디렉토리 무변경 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `펌웨어/hi-aba_total_rev6_brf/hi-aba/IOT_mode.c`
- 간단한 설명
  - 이번 채팅의 실제 구현은 `ABBAS_WEB`에서 전체 관리자 콘솔 UI/UX 리뉴얼, 로그인/회원가입 화면 개편, 전역 다크모드 및 NAS Center 다크모드 보정을 정리한 작업이었고, MELAUHF ATmega 펌웨어 코드는 수정하지 않았다.
  - 펌웨어 디렉토리는 기존 MA5105 페이지 제어와 시리얼 수신 동작을 그대로 유지한 채 `_devList` 기록만 추가했다.

## 35. NAS Center 세부 UX 보정에 따른 MELAUHF 디렉토리 무변경 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `펌웨어/hi-aba_total_rev6_brf/hi-aba/IOT_mode.c`
- 간단한 설명
  - 이번 채팅의 실제 구현은 `ABBAS_WEB`에서 NAS Center 파일 브라우저 세부 UX, 드래그앤드롭 업로드, 우클릭 메뉴 보정, 로그인 브랜딩 문구 수정 등을 정리하는 작업이었고 MELAUHF ATmega 펌웨어 코드는 수정하지 않았다.
  - 펌웨어 디렉토리는 기존 MA5105 페이지 제어와 ESP UART 수신 동작을 그대로 유지한 채 `_devList` 기록만 갱신했다.

## 36. NAS Center 업로드/상단고정 후속 보정에 따른 MELAUHF 디렉토리 무변경 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `펌웨어/hi-aba_total_rev6_brf/hi-aba/IOT_mode.c`
- 간단한 설명
  - 이번 채팅의 실제 구현은 `ABBAS_WEB`에서 NAS Center 폴더 업로드 안정화, NAS 디바이스/시리얼 표시 보강, 우클릭 상단 고정 기능, 드래그 오버레이 스크롤 보정을 진행한 작업이었고 MELAUHF ATmega 펌웨어 코드는 수정하지 않았다.
  - 펌웨어 디렉토리는 기존 MA5105 페이지 제어와 ESP UART 수신 동작을 그대로 유지한 채 `_devList` 기록만 추가했다.

## 37. NAS Center 내부 이동·마킹·중복 업로드 대응에 따른 MELAUHF 디렉토리 무변경 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `펌웨어/hi-aba_total_rev6_brf/hi-aba/IOT_mode.c`
- 간단한 설명
  - 이번 채팅의 실제 구현은 `ABBAS_WEB`에서 NAS Center 내부 드래그 이동, 중복 업로드 충돌 모달, 마킹 색상 시스템, 빈 폴더 안내 모달, 경로 버튼 드롭 이동을 정리하는 작업이었고 MELAUHF ATmega 펌웨어 코드는 수정하지 않았다.
  - 펌웨어 디렉토리는 기존 MA5105 페이지 제어와 ESP UART 수신 동작을 그대로 유지한 채 `_devList` 기록만 갱신했다.

## 38. NAS Center 다중 파일 다운로드 구조 수정에 따른 MELAUHF 디렉토리 무변경 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `펌웨어/hi-aba_total_rev6_brf/hi-aba/IOT_mode.c`
- 간단한 설명
  - 이번 채팅의 실제 구현은 `ABBAS_WEB`에서 NAS Center 다중 파일 다운로드 ZIP 구조를 평탄화해, 선택한 파일만 직접 내려받도록 정리한 작업이었고 MELAUHF ATmega 펌웨어 코드는 수정하지 않았다.
  - 펌웨어 디렉토리는 기존 MA5105 페이지 제어와 ESP UART 수신 동작을 그대로 유지한 채 `_devList` 기록만 추가했다.

## 39. ABBAS Talk 메신저/NAS 후속 보정에 따른 MELAUHF 디렉토리 무변경 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `펌웨어/hi-aba_total_rev6_brf/hi-aba/IOT_mode.c`
- 간단한 설명
  - 이번 채팅의 실제 구현은 `ABBAS_WEB`에서 팝업 메신저, 실시간 브라우저 알림, 알림 배지/권한/프로필 UX, `/nas` 업로드 계정 닉네임 동기화까지 정리하는 작업이었고 MELAUHF ATmega 펌웨어 코드는 수정하지 않았다.
  - 펌웨어 디렉토리는 기존 MA5105 페이지 제어와 ESP UART 수신 동작을 그대로 유지한 채 `_devList` 기록만 이번 채팅 기준으로 갱신했다.

## 40. NAS 모바일 더블탭 다운로드 기능에 따른 MELAUHF 디렉토리 무변경 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `펌웨어/hi-aba_total_rev6_brf/hi-aba/IOT_mode.c`
- 간단한 설명
  - 이번 채팅의 실제 구현은 `ABBAS_WEB`의 `/nas` 페이지에서 모바일 더블탭 파일 다운로드 확인 모달과 다운로드 시작 UX를 추가하는 작업이었고 MELAUHF ATmega 펌웨어 코드는 수정하지 않았다.
  - 펌웨어 디렉토리는 기존 MA5105 페이지 제어와 ESP UART 수신 동작을 그대로 유지한 채 `_devList` 기록만 이번 채팅 기준으로 갱신했다.

## 41. NAS 모바일 더블동작 감지 보강에 따른 MELAUHF 디렉토리 무변경 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `펌웨어/hi-aba_total_rev6_brf/hi-aba/IOT_mode.c`
- 간단한 설명
  - 이번 채팅의 실제 후속 구현은 `ABBAS_WEB`의 `/nas` 페이지에서 모바일 터치 판별 범위를 넓히고 파일 `dblclick`도 다운로드 확인 모달로 연결하는 보정 작업이었고 MELAUHF ATmega 펌웨어 코드는 수정하지 않았다.
  - 펌웨어 디렉토리는 기존 MA5105 페이지 제어와 ESP UART 수신 동작을 그대로 유지한 채 `_devList` 기록만 이번 채팅 기준으로 갱신했다.

## 42. Android 7.1.2 NAS 터치 후속 보정에 따른 MELAUHF 디렉토리 무변경 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `펌웨어/hi-aba_total_rev6_brf/hi-aba/IOT_mode.c`
- 간단한 설명
  - 이번 채팅의 실제 후속 구현은 `ABBAS_WEB`의 `/nas` 페이지에서 Android 7.1.2 터치 환경에 맞춰 더블탭, 합성 click, 롱프레스 drag/contextmenu 억제를 보강하는 작업이었고 MELAUHF ATmega 펌웨어 코드는 수정하지 않았다.
  - 펌웨어 디렉토리는 기존 MA5105 페이지 제어와 ESP UART 수신 동작을 그대로 유지한 채 `_devList` 기록만 이번 채팅 기준으로 갱신했다.

## 43. NAS 모바일 파일 재터치 즉시 다운로드에 따른 MELAUHF 디렉토리 무변경 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `펌웨어/hi-aba_total_rev6_brf/hi-aba/IOT_mode.c`
- 간단한 설명
  - 이번 채팅의 최종 구현은 `ABBAS_WEB`의 `/nas` 페이지에서 모바일 파일 재터치 시 확인 모달 없이 바로 다운로드하도록 단순화하고, 구형 안드로이드 캐시를 피하기 위해 JS 버전 쿼리를 갱신하는 작업이었고 MELAUHF ATmega 펌웨어 코드는 수정하지 않았다.
  - 펌웨어 디렉토리는 기존 MA5105 페이지 제어와 ESP UART 수신 동작을 그대로 유지한 채 `_devList` 기록만 이번 채팅 기준으로 갱신했다.

## 44. 메신저 토스트 배경 보정에 따른 MELAUHF 디렉토리 무변경 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `펌웨어/hi-aba_total_rev6_brf/hi-aba/IOT_mode.c`
- 간단한 설명
  - 이번 채팅의 실제 구현은 `ABBAS_WEB`에서 ABBAS Talk 메시지 복사/삭제 토스트가 우측 상단에 뜰 때 다크모드에서만 세로로 길게 보이던 배경 오버레이를 제거하고, CSS 캐시 버전을 갱신하는 작업이었고 MELAUHF ATmega 펌웨어 코드는 수정하지 않았다.
  - 펌웨어 디렉토리는 기존 MA5105 페이지 제어와 ESP UART 수신 동작을 그대로 유지한 채 `_devList` 기록만 이번 채팅 기준으로 갱신했다.

## 45. ABBAS Talk LiveKit 그룹 통화 추가에 따른 MELAUHF 디렉토리 무변경 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `펌웨어/hi-aba_total_rev6_brf/hi-aba/IOT_mode.c`
- 간단한 설명
  - 이번 채팅의 실제 구현은 `ABBAS_WEB`에서 LiveKit self-hosted 기반 그룹 통화, 카메라 타일 그리드, 실행 스크립트와 systemd 연동을 추가하는 작업이었고 MELAUHF ATmega 펌웨어 코드는 수정하지 않았다.
  - 펌웨어 디렉토리는 기존 MA5105 페이지 제어와 ESP UART 수신 동작을 그대로 유지한 채 `_devList` 기준점만 이번 채팅 내용으로 갱신했다.

## 46. ASCORD 음성채널/STAGE 및 LiveKit 외부망 안정화에 따른 MELAUHF 디렉토리 무변경 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `펌웨어/hi-aba_total_rev6_brf/hi-aba/IOT_mode.c`
- 간단한 설명
  - 이번 채팅의 실제 구현은 `ABBAS_WEB`에서 ASCORD 음성채널/STAGE, 수신 통화/권한/운영 UX, LiveKit WSS/TURN/TLS 정리와 포트포워딩 점검을 진행한 작업이었고 MELAUHF ATmega 펌웨어 코드는 수정하지 않았다.
  - 펌웨어 디렉토리는 기존 MA5105 페이지 제어와 ESP UART 수신 동작을 그대로 유지한 채 `_devList` 기록만 이번 채팅 기준으로 추가했다.

## 47. ABBAS_WEB 보안·모듈 분리 작업에 따른 MELAUHF 디렉토리 무변경 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `펌웨어/hi-aba_total_rev6_brf/hi-aba/main.c`
- 간단한 설명
  - 이번 채팅의 실제 구현은 `ABBAS_WEB`에서 인증/세션/Redis 보강, 메신저/플랫폼/통합관리/페이지 라우트 분리, 미사용 파일 정리와 Source Control 정리를 진행한 작업이었고 MELAUHF 펌웨어 코드는 수정하지 않았다.
  - MELAUHF 디렉토리는 기존 운전/페이지/UI/ESP 연동 로직을 그대로 유지한 채 `_devList` 기록만 갱신했다.

## 48. ATmega 부트 게이트·에너지 동기화·OTA 복귀 안정화
- 수정코드
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/IOT_mode.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/iot_boot.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/iot_ota.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/iot_subscription.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/iot_uart_bridge.c`
  - `펌웨어/hi-aba_total_rev6_brf/hi-aba/iot_wifi_flow.c`
- 간단한 설명
  - ATmega 펌웨어 쪽에서는 `@FW|B` 부트 알림과 버전 리포트 재전송, page68 부트 대기시간/조건 보정, page71 ATmega 버전 표기, page61·62·73 복귀 흐름 안정화, `OTA|RST` 수신 시 page74에서 확실히 빠져나오는 복구 로직을 추가했다.
  - 동시에 ESP에서 들어오는 `PAGE|`, `P63|M|`, `OTA|` 계열을 우선 큐로 보강해 초기 부트와 OTA 실패 직후 중요한 제어 라인이 slot 렌더링에 밀리지 않게 했고, 부팅 직후 에너지/등록 상태가 늦게 와도 UI가 오류 페이지로 빠지지 않도록 가드했다.

## 49. 이번 채팅 기준 MELAUHF 디렉토리 무변경 및 Source Control 동기화 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `펌웨어/hi-aba_total_rev6_brf/hi-aba/IOT_mode.c`
- 간단한 설명
  - 이번 채팅의 실제 구현은 `Arduino/ATmega_Web_UART_OTA_Minimal`에서 UART OTA 완주 기준을 확보하고 업로드 설정 문서를 정리하는 작업이었고, `MELAUHF` ATmega 펌웨어 코드는 추가 수정하지 않았다.
  - MELAUHF 디렉토리는 기존 펌웨어 변경 상태를 그대로 유지한 채 `_devList` 기록과 Source Control 정리 기준만 이번 채팅 기준으로 맞췄다.

## 50. Arduino 메인 세그먼트 OTA 이식에 따른 MELAUHF 디렉토리 무변경 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `펌웨어/hi-aba_total_rev6_brf/hi-aba/iot_ota.c`
- 간단한 설명
  - 이번 채팅의 실제 구현은 `Arduino/ATmega_Web_UART_OTA_Minimal`의 반복 실기 검증과 `Arduino/ABBAS_ESPbyMELAUHF.ino`에 세그먼트 재진입 OTA 전략을 옮기는 작업이었고, `MELAUHF` ATmega 펌웨어 소스는 추가 수정하지 않았다.
  - 펌웨어 디렉토리는 기존 `FW|B`, `FW|A`, `OTA|DEC`, `OTA|RST` 연동 구조를 그대로 유지한 채 `_devList` 기록만 이번 채팅 기준으로 갱신했다.

## 51. ABBA-S 메일/ASCORD LiveKit 복구에 따른 MELAUHF 디렉토리 무변경 메모
- 수정코드
  - 코드 수정 없음
  - 확인 파일: `펌웨어/hi-aba_total_rev6_brf/hi-aba/IOT_mode.c`
- 간단한 설명
  - 이번 채팅의 실제 구현은 `ABBAS_WEB`에서 이메일 인증 메일 HTML 템플릿, 브랜드명 정리, ASCORD LiveKit/WSS 경로와 서버 복구를 진행한 작업이었고 MELAUHF ATmega 펌웨어 코드는 수정하지 않았다.
  - MELAUHF 디렉토리는 기존 페이지 제어와 ESP UART 수신/OTA 연동 구조를 그대로 유지한 채 `_devList` 기록만 이번 채팅 기준으로 갱신했다.
