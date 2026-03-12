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
