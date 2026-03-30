# ESP32-C5 + ATmega128 UART OTA 최종 회로 정리

적용 방식:

- 처음 1회: 외부 `ISP`로 `부트로더 + 앱 + 퓨즈` 기록
- 이후: ESP32-C5가 기존 `UART + RESET`으로 `UART OTA` 수행

즉, 최종적으로 현재 회로에서 추가해야 할 것은 `ATmega RESET 자동제어 회로`와 `ISP 헤더`다.

## 1. 최종 결론

현재 회로는 아래를 그대로 유지한다.

- ESP32 `GPIO5` -> ATmega `RXD0`
- ESP32 `GPIO4` <- ATmega `TXD0`
- `GND` 공통
- DWIN 배선 유지
- SD 배선 유지

여기에 아래 2가지만 추가한다.

1. `ESP GPIO24`를 이용한 `ATmega RESET` 자동제어 회로
2. 최초 1회 이식/복구용 `ISP 2x3 헤더`

---

## 2. 현재 회로에서 실제 추가 부품

### 필수 추가

- `Q1` : `2N3904` NPN 트랜지스터 1개
- `R1` : `2.2k` 1개
- `R2` : `10k` 1개
- `J_ISP` : `2x3 ISP 헤더` 1개

### 선택 추가

- `R3` : `100k` 1개
  - `GPIO24`가 부팅 중 뜨는 것을 더 안정적으로 막고 싶을 때 Base pulldown

---

## 3. RESET 회로 최종본

```text
ESP32 GPIO24 ---[R1 2.2k]---- Base (Q1 2N3904)
GND ------------------------- Emitter
Collector ------------------- ATmega RESET

ATmega RESET ---[R2 10k]----- +5V

선택:
Base ---[R3 100k]------------ GND
```

동작:

- `GPIO24 = LOW` -> Q1 OFF -> RESET 해제
- `GPIO24 = HIGH` -> Q1 ON -> RESET Low 강제

이 회로로 ESP32가 ATmega를 원하는 타이밍에 리셋해서 UART 부트로더로 진입시킬 수 있다.

---

## 4. UART OTA에 실제 사용하는 선

현장 업데이트 때 실사용하는 선은 아래 4개다.

| 용도 | ESP32-C5 | ATmega128 |
|---|---|---|
| UART TX | `GPIO5` | `RXD0` |
| UART RX | `GPIO4` | `TXD0` |
| GND | `GND` | `GND` |
| RESET 제어 | `GPIO24` | `RESET` |

즉 실사용 업데이트 경로는 사실상:

- `TX`
- `RX`
- `GND`
- `RESET`

이다.

---

## 5. ISP 헤더 최종본

최초 1회 이식과 벽돌 복구를 위해 반드시 남겨두는 것을 권장한다.

### 2x3 표준 ISP 헤더

```text
1  MISO
2  VCC
3  SCK
4  MOSI
5  RESET
6  GND
```

### 연결 대상

| ISP 헤더 | ATmega128 |
|---|---|
| 1 | `MISO` |
| 2 | `+5V` |
| 3 | `SCK` |
| 4 | `MOSI` |
| 5 | `RESET` |
| 6 | `GND` |

중요:

- 이 ISP 헤더는 외부 AVR ISP 프로그래머가 쓰는 용도다
- 최종 UART OTA 운용 시에는 평소 사용하지 않아도 된다

---

## 6. 지금 회로도에서 어디를 추가해야 하나

현재 회로 이미지 기준으로 보면, 이미 있는 것은:

- ESP32
- ATmega UART 연결
- DWIN
- SD
- 버튼/전원/RGB

그리고 아직 없는 것은:

- `ATmega RESET net`
- `ISP 헤더`
- `GPIO24 -> RESET` 제어선

즉 회로도 수정 포인트는 아래 3개다.

### A. ATmega RESET net을 새로 빼기

ATmega128 실제 MCU의 `RESET` 핀에서 선을 하나 빼야 한다.

이 선은 다음 3곳으로 동시에 간다.

- `Q1 Collector`
- `R2 10k -> +5V`
- `ISP 헤더 pin 5`

### B. ESP32 `GPIO24`를 새로 사용

ESP32의 `GPIO24`에서 선을 하나 빼서:

- `R1 2.2k`
- `Q1 Base`

로 연결한다.

### C. ISP 헤더 추가

ATmega의:

- `MOSI`
- `MISO`
- `SCK`
- `RESET`
- `VCC`
- `GND`

를 2x3 헤더로 뽑는다.

---

## 7. 캐패시터는 필요한가

### RESET 회로용 캐패시터

- **필수 아님**
- 이번 설계에서는 **넣지 않는 것을 권장**

이유:

- RESET은 ESP32 GPIO가 직접 타이밍 제어
- RC 지연이 들어가면 부트로더 진입 타이밍이 오히려 꼬일 수 있음

### 전원 안정화 캐패시터

이건 별개로 필요하다.

- ATmega `VCC/AVCC` 근처 `0.1uF` 세라믹
- 보드 전원 쪽 `10uF` 정도 벌크 캐패시터

즉:

- `RESET RC 캐패시터`는 넣지 말고
- `전원 디커플링 캐패시터`는 정상적으로 유지

---

## 8. 레벨시프팅은 필요한가

현재 UART가 이미 정상 동작 중이라면, **기존 UART 선은 그대로 유지하는 것이 최우선**이다.

즉 이번 리비전에서는:

- `GPIO5 -> ATmega RXD0` 그대로
- `ATmega TXD0 -> GPIO4` 그대로

를 추천한다.

새 보드 리비전에서 안전성을 더 높이고 싶다면 나중에 아래 보호를 검토할 수 있다.

```text
ATmega TXD0 ----[10k]----+----> ESP32 GPIO4
                         |
                        [20k]
                         |
                        GND
```

하지만 지금은 기존 통신이 살아 있으므로, UART 쪽은 건드리지 않는 쪽이 더 안전하다.

---

## 9. 최종 BOM

필수:

- `2N3904` x1
- `2.2k` x1
- `10k` x1
- `2x3 ISP header` x1

선택:

- `100k` x1

보드 기본 안정화:

- `0.1uF` 세라믹 적절 수량
- `10uF` 벌크 적절 수량

---

## 10. 최종 ASCII 회로도

```text
                 +---------------- ESP32-C5 ----------------+
                 |                                          |
                 | GPIO5  -------------------------------------> ATmega RXD0
                 | GPIO4  <------------------------------------- ATmega TXD0
                 | GND    -------------------------------------- GND
                 |                                              |
                 | GPIO24 ---[2.2k]---B  Q1(2N3904)             |
                 |                    C-------------------------> RESET
                 | GND ----------------E                        |
                 +----------------------------------------------+

                                     ATmega RESET ---[10k]--- +5V


                 +--------------- ISP 2x3 Header ---------------+
                 | 1 MISO   -> ATmega MISO                      |
                 | 2 VCC    -> +5V                              |
                 | 3 SCK    -> ATmega SCK                       |
                 | 4 MOSI   -> ATmega MOSI                      |
                 | 5 RESET  -> ATmega RESET                     |
                 | 6 GND    -> GND                              |
                 +----------------------------------------------+
```

---

## 11. 진짜 최종 요약

현재 회로에서 최종적으로 추가할 것:

- `GPIO24 -> 2.2k -> 2N3904 -> ATmega RESET`
- `ATmega RESET -> 10k -> +5V`
- `ATmega ISP 2x3 헤더`

추가하지 않을 것:

- RESET용 캐패시터
- 현재 UART 경로 대수술
- ESP와 ATmega 사이의 상시 SPI 직접배선

즉 이번 프로젝트의 최종 하드웨어 방향은:

- **초기 1회/복구는 외부 ISP**
- **실사용 OTA는 UART + RESET**

이다.
