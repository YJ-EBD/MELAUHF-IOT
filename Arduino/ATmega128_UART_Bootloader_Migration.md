# ATmega128 UART Bootloader Migration

현재 하드웨어 기준:

- ESP32 <-> ATmega 연결은 `UART0` 사용
- ESP32가 `GPIO24`로 `ATmega RESET` 제어 가능
- 현재 ATmega 펌웨어 백업 완료

이 문서는 다음 단계인 `부트로더/퓨즈 확정`과 `최초 1회 ISP 이식` 기준을 정리한다.

## 1. 현재 코드 기준 확인

ATmega 쪽에서 ESP 연동 UART는 `UART0`다.

- [Init.c](/home/abbas/Desktop/MELAUHF/펌웨어/hi-aba_total_rev6_brf/hi-aba/Init.c)
- [iot_uart_bridge.c](/home/abbas/Desktop/MELAUHF/펌웨어/hi-aba_total_rev6_brf/hi-aba/iot_uart_bridge.c)

확인된 점:

- `F_CPU = 16000000`
- `UART0 = 115200`
- `UART1 = DWIN`

즉 UART OTA 부트로더는 `UART0`, `115200`, `16MHz` 기준으로 잡는 것이 가장 자연스럽다.

## 2. 권장 부트로더 방향

권장안:

- `UART0` 기반 부트로더
- `115200 8N1`
- `RESET` 후 짧은 대기시간 동안 업로드 요청 수신
- 요청이 없으면 기존 앱(`0x0000`)으로 점프

프로토콜은 `AVR109` 계열이 가장 무난한 쪽으로 본다.

이유:

- Microchip AVR109 앱노트가 AVR의 Self-programming + UART 부트로더 구조를 직접 설명함
- 부트로더는 Boot Section에서 실행되어야 함

참고:

- AVR109 App Note: https://ww1.microchip.com/downloads/en/Appnotes/doc1644.pdf

중요:

- 위 프로토콜 선택은 공식 앱노트 구조를 기준으로 한 권장 방향이다
- 실제 PC 업로드 도구 선택은 이후 확정

## 3. 부트 섹션 크기 권장

ATmega128 Boot Section은 4가지 크기를 선택할 수 있다.

Microchip ATmega128 datasheet 기준:

- `BOOTSZ=11` -> 512 words -> Boot start `0xFE00`
- `BOOTSZ=10` -> 1024 words -> Boot start `0xFC00`
- `BOOTSZ=01` -> 2048 words -> Boot start `0xF800`
- `BOOTSZ=00` -> 4096 words -> Boot start `0xF000`

권장 기본값:

- `BOOTSZ1:0 = 01`
- 즉 `2048 words = 4096 bytes (4KB)`
- Boot Reset Address = `0xF800`

이유:

- 너무 작게 잡으면 부트로더 확장 여유가 부족함
- 8KB는 보통 과함
- 4KB가 가장 무난한 시작점

참고:

- ATmega128 datasheet Boot Size Configuration: https://ww1.microchip.com/downloads/en/DeviceDoc/doc2467.pdf

## 4. BOOTRST 동작

ATmega128 datasheet 기준:

- `BOOTRST = 0` -> Reset Vector가 Boot Loader로 감
- `BOOTRST = 1` -> Reset Vector가 앱 시작 주소 `0x0000`

UART OTA 목적이면 권장:

- `BOOTRST = 0`

즉, 매 리셋마다 부트로더가 먼저 실행되고:

1. UART 업로드 요청이 있으면 업데이트
2. 없으면 앱으로 점프

이 구조가 지금 하드웨어와 가장 잘 맞는다.

## 5. 퓨즈 변경 원칙

절대 원칙:

- `LFUSE`, `EFUSE`는 **현재 백업값 유지**
- `HFUSE`도 상위 비트는 **현재 백업값 유지**
- 바꾸는 것은 필요한 하위 비트만

ATmega128 High Fuse bit mapping:

- bit3 = `EESAVE`
- bit2 = `BOOTSZ1`
- bit1 = `BOOTSZ0`
- bit0 = `BOOTRST`

권장 상태:

- `EESAVE = 0` 권장
- `BOOTSZ1 = 0`
- `BOOTSZ0 = 1`
- `BOOTRST = 0`

즉 하위 nibble 권장값:

```text
bit3 bit2 bit1 bit0
 0    0    1    0   = 0x2
```

설명:

- `EESAVE=0`이면 Chip Erase 후에도 EEPROM 보존
- 현재 펌웨어가 EEPROM을 많이 쓰므로 이 쪽이 더 안전

주의:

- 이미 EEPROM 백업을 했더라도, 현장 데이터 보존 측면에서 `EESAVE=0`을 추천

## 6. 왜 EESAVE를 추천하나

현재 펌웨어는 EEPROM 의존도가 높다.

예:

- [main.c](/home/abbas/Desktop/MELAUHF/펌웨어/hi-aba_total_rev6_brf/hi-aba/main.c) 에서 모드, 시간, 파워 프로파일, 설치일, 부팅 상태 등을 EEPROM에서 읽음

따라서 최초 이식 이후에도:

- 앱 재기록
- 복구 작업
- 현장 펌웨어 업데이트 보조 작업

중 EEPROM 보존 가치가 높다.

## 7. 최종 권장 퓨즈 방향

현재 백업값을 기준으로:

- `LFUSE` = 그대로 유지
- `EFUSE` = 그대로 유지
- `HFUSE` = 상위 4비트 유지 + 하위 4비트만 조정

즉 개념적으로는:

```text
new_hfuse = (backup_hfuse & 0xF0) | 0x02
```

이 식은 아래를 의미한다.

- 상위 nibble 그대로
- 하위 nibble = `EESAVE=0, BOOTSZ=01, BOOTRST=0`

주의:

- 이건 **현재 보드가 외부 16MHz 클럭/기타 상위 HFUSE 설정이 이미 정상이라는 전제**
- 그래서 상위 비트는 건드리지 않는 것이 안전

## 8. 최초 1회 ISP 기록 순서 권장

권장 순서:

1. 현재 fuse 값 다시 메모
2. `HFUSE`를 먼저 새 값으로 설정
3. 부트로더 이미지를 Boot Section 주소에 기록
4. 앱 이미지를 Application Section에 기록
5. Verify
6. Lock bits는 첫 성공 이후에 검토

중요:

- 부트로더와 앱은 **주소가 겹치지 않게** 준비해야 함
- 가장 안전한 방법은 `병합된 HEX` 또는 주소가 명확히 분리된 두 이미지 사용

## 9. Lock bits는 지금 바로 건드리지 말 것

첫 이식 때는 권장:

- `Lock bits` 변경하지 않음

이유:

- UART OTA 경로가 완전히 검증되기 전에는 복구 자유도가 중요
- Lock bit를 너무 일찍 걸면 디버깅이 어려워짐

즉:

- 1차 성공
- PC UART 재업로드 성공
- ESP OTA 성공

이후에 보호정책 검토

## 10. 다음 실전 단계

지금 다음으로 해야 할 일은 2개다.

1. 실제 사용할 `ATmega128 UART 부트로더`를 확정
2. 백업해둔 `HFUSE` 값을 기준으로 정확한 새 `HFUSE` 계산

그 다음에야 아래가 가능하다.

- 최초 1회 ISP 기록
- PC UART 업로드 1회 성공 검증
- ESP OTA 구현

## 11. 지금 시점의 결론

현재 보드 기준으로 가장 무난한 방향은:

- `UART0`
- `115200`
- `BOOTRST=0`
- `BOOTSZ=01` (4KB)
- `EESAVE=0`

그리고 나머지 퓨즈는 백업값 유지다.

---

## 참고 소스

- ATmega128 datasheet: https://ww1.microchip.com/downloads/en/DeviceDoc/doc2467.pdf
- AVR109 app note: https://ww1.microchip.com/downloads/en/Appnotes/doc1644.pdf
