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
