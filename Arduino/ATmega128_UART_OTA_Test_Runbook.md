# ATmega128 UART OTA Test Runbook

이 문서는 현재 하드웨어 상태에서 `UART OTA`를 실제로 검증할 때의 순서를 정리한 것이다.

전제:

- 회로 추가 완료
  - 기존 `TX/RX/GND` 유지
  - `GPIO24 -> 2.2k -> 2N3904 Base`
  - `Emitter -> GND`
  - `Collector -> ATmega RESET`
  - `ATmega RESET -> 10k -> +5V`
- 최초 ISP 작업은 PC에서 수행
- 현재 작업 디렉토리의 로컬 환경에는 `avrdude`가 설치되어 있지 않아서, 실제 플래시 명령은 실행하지 못했다

---

## 0. 목표

최종적으로 확인할 것은 아래 4가지다.

1. ESP32가 `GPIO24`로 ATmega 리셋을 정상 제어하는지
2. PC ISP로 현재 펌웨어를 안전하게 백업할 수 있는지
3. PC ISP로 `부트로더 + 앱 + 퓨즈`를 정상 기록할 수 있는지
4. 이후 `UART`로 새 앱 업로드가 실제로 되는지

---

## 1. Step 1: GPIO24 RESET 단독 확인

사용 파일:

- [ATmega_GPIO24_Reset_Test.ino](/home/abbas/Desktop/Arduino/ATmega_GPIO24_Reset_Test.ino)

해야 할 일:

1. ESP32-C5에 `ATmega_GPIO24_Reset_Test.ino` 업로드
2. 시리얼 모니터를 `115200`으로 열기
3. 아래 명령을 순서대로 입력

```text
ping
reset
hold
release
```

기대 결과:

- `ping`에서 `reset_gpio` 상태가 출력됨
- `reset`에서 ATmega가 한 번 재시작되는 반응이 보여야 함
- `hold` 중에는 ATmega가 계속 RESET 상태
- `release` 후 다시 부팅

이 단계가 실패하면 다음 단계로 가지 않는다.

체크 포인트:

- `GPIO24`가 실제로 2N3904 Base 쪽으로 연결됐는지
- GND가 공통인지
- RESET net이 실제 ATmega RESET 핀에 연결됐는지
- 기존 보드에 RESET 풀업이 중복 추가되지 않았는지

---

## 2. Step 2: 현재 ATmega 펌웨어 백업

이 단계는 반드시 먼저 한다.

백업 대상:

- `flash`
- `eeprom`
- `fuse`
- `lock bits`

권장 백업 파일명 예:

```text
backup_flash.hex
backup_eeprom.hex
backup_fuses.txt
backup_locks.txt
```

예시 `avrdude` 템플릿:

```bash
avrdude -p m128 -c <PROGRAMMER> \
  -U flash:r:backup_flash.hex:i \
  -U eeprom:r:backup_eeprom.hex:i \
  -U lfuse:r:backup_lfuse.hex:h \
  -U hfuse:r:backup_hfuse.hex:h \
  -U efuse:r:backup_efuse.hex:h \
  -U lock:r:backup_lock.hex:h
```

주의:

- `<PROGRAMMER>`는 실제 ISP 프로그래머에 맞게 바꿔야 함
- 백업이 끝나기 전에는 절대 퓨즈나 부트로더를 덮지 않는다

---

## 3. Step 3: 부트로더/퓨즈 준비

이 단계는 실제로 `UART OTA`가 가능해지는 핵심 단계다.

필요한 것:

- `ATmega128용 부트로더 hex`
- 앱 펌웨어 hex
- 부트로더 크기에 맞는 퓨즈값

중요한 설정 개념:

- `BOOTRST` : 리셋 후 부트로더로 먼저 진입
- `BOOTSZ` : 부트로더 영역 크기 설정

여기서는 아직 부트로더 바이너리와 퓨즈값이 확정되지 않았으므로, 실제 값은 보류다.

즉 이 단계의 실무 절차는:

1. 사용할 부트로더 확정
2. 부트로더 크기 확인
3. 그 크기에 맞는 퓨즈 계산
4. PC ISP로 부트로더/앱/퓨즈 기록

주의:

- 퓨즈를 잘못 쓰면 부팅 방식이나 클럭이 틀어질 수 있음
- 그래서 백업 이후에만 진행

---

## 4. Step 4: PC에서 UART 업로드 1회 성공

ESP OTA보다 먼저, `PC -> UART 부트로더` 업로드를 한 번 성공시켜야 한다.

이유:

- 이 단계가 안 되면 ESP32가 대신 해도 안 됨
- 즉 `ESP OTA`는 결국 이 UART 업로드 절차를 자동화한 것뿐이다

권장 테스트 앱:

- 버전 문자열이 명확히 달라지는 펌웨어
- LED 패턴이 바뀌는 간단한 펌웨어
- 시작 페이지나 시리얼 배너가 명확히 달라지는 펌웨어

이 단계에서 확인할 것:

- 리셋 후 부트로더가 일정 시간 UART를 기다리는지
- 업로드 완료 후 앱으로 정상 점프하는지
- 업로드 실패 시에도 다시 ISP 복구가 가능한지

---

## 5. Step 5: ESP32 OTA 준비 전 확인

PC UART 업로드가 성공한 뒤에만 넘어간다.

그 다음 ESP32 쪽 OTA 순서는 이렇게 된다.

1. OTA 파일 다운로드
2. 무결성 체크
3. 장비를 안전한 상태로 전환
4. `GPIO24`로 ATmega RESET
5. UART 부트로더로 hex/bin 전송
6. 완료 후 앱 재시작
7. 버전 확인

---

## 6. 지금 당장 해야 할 것

가장 먼저 할 일은 아래 2개다.

1. `ATmega_GPIO24_Reset_Test.ino` 업로드
2. `reset / hold / release` 테스트

이게 되면 다음은:

3. 현재 펌웨어 ISP 백업
4. 부트로더/퓨즈 확정

---

## 7. 진행 순서 요약

```text
Step 1  GPIO24 RESET 동작 확인
Step 2  현재 ATmega flash/eeprom/fuse 백업
Step 3  부트로더 + 앱 + 퓨즈 ISP 기록
Step 4  PC UART 업로드 1회 성공
Step 5  그 다음 ESP32 OTA 구현
```

---

## 8. 현재 상태에서의 판단

지금 하드웨어가 끝났다면, 첫 번째 성공 기준은 아주 단순하다.

> ESP32에서 `GPIO24`를 올렸을 때 ATmega가 확실히 리셋되는가

이게 확인되면 다음 단계로 넘어가면 된다.
