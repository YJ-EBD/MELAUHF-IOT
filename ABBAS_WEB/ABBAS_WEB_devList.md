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
