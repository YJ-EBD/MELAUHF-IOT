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
