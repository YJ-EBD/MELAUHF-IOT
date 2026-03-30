# ATmega128 초기 1회 ISP 기록 절차

이 절차는 `ESP32-C5 -> ATmega128A UART OTA`를 쓰기 전에 최초 1회만 수행합니다.

## 목적

- UART 부트로더 기록
- 앱 펌웨어 기록
- 부트로더 시작 퓨즈 설정
- EEPROM 기존 데이터는 유지

## 현재 확인된 기준값

- MCU: `MEGA128`
- Signature: `0x1E 0x97 0x02`
- 기존 Fuse
  - `LFUSE = 0xBF`
  - `HFUSE = 0xC1`
  - `EFUSE = 0xFF`
- 목표 Fuse
  - `LFUSE = 0xBF`
  - `HFUSE = 0xC2`
  - `EFUSE = 0xFF`

`HFUSE 0xC2`는 `BOOTRST` 활성과 `4KB boot section` 기준으로 잡은 값입니다.

## 올릴 파일

1. `UART 부트로더 HEX`
2. `현재 앱 HEX`
3. `EEPROM`은 이번 작업에서 쓰지 않음

## 리산테크 플래셔 순서

1. 현재 상태 백업
   - `설정값 읽기`
   - `Iss파일 저장`
   - 가능하면 현재 `FLASH`도 별도 백업

2. 부트로더 HEX 준비
   - ATmega128A / UART0 / 115200 기준 부트로더 파일 선택

3. 앱 HEX 준비
   - 현재 운용 앱 HEX 파일 선택

4. Fuse 입력
   - `Extended = 0xFF`
   - `High = 0xC2`
   - `Low = 0xBF`

5. EEPROM 쓰기 해제
   - `EEPROM` 항목은 체크하지 않음

6. 기록
   - 부트로더 + 앱 + fuse를 ISP로 기록

7. 검증
   - 전원 재인가
   - ESP32의 `GPIO24 RESET` 회로 유지
   - UART 부트로더 진입 테스트

## 주의

- 기존 장비 데이터 보존을 위해 `EEPROM`은 쓰지 않는 것을 권장합니다.
- ISP 완료 후부터는 `TX/RX/GND + RESET(GPIO24)`만으로 OTA를 진행합니다.
- 이후 ABBAS_WEB의 `ATmega Firmware` 페이지에서 `.hex` 업로드, 배정, 즉시 업데이트를 사용할 수 있습니다.
