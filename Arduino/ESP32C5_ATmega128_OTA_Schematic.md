# ESP32-C5 -> ATmega128 OTA/ISP 회로도

현재 [`ABBAS_ESPbyMELAUHF.ino`](/home/abbas/Desktop/Arduino/ABBAS_ESPbyMELAUHF.ino)의 핀맵을 기준으로, ESP32-C5가 Wi-Fi로 받은 펌웨어를 ATmega128에 ISP 방식으로 기록하기 위한 회로도이다.

이 문서는 "ESP32가 OTA 파일을 다운로드 -> ATmega128을 RESET -> SPI(ISP)로 플래시 기록" 구조를 전제로 한다.

## 1. 현재 코드 기준 점유 핀

- `GPIO4` : ATmega UART RX
- `GPIO5` : ATmega UART TX
- `GPIO6` : DWIN RX
- `GPIO7` : DWIN TX
- `GPIO9` : SD SPI MISO
- `GPIO10` : SD SPI CS
- `GPIO11` : SD SPI MOSI
- `GPIO12` : SD SPI SCK
- `GPIO23` : 외부 버튼
- `GPIO28` : BOOT 버튼

따라서 OTA/ISP는 기존 SD SPI 버스를 재사용하고, `RESET` 제어만 새로 추가하는 구성이 가장 현실적이다.

권장 추가 핀:

- `GPIO24` : ATmega `RESET` 강제 Low 제어용

## 2. 권장 회로 구성

### 핵심 아이디어

- `SCK/MOSI/MISO`는 ESP32-C5의 기존 SPI 버스를 그대로 사용
- `ATmega RESET`은 ESP GPIO를 직접 꽂지 않고 `2N3904` NPN으로 Low만 당김
- `ATmega MISO(5V)`는 ESP32-C5 입력 보호를 위해 분압 후 수신
- SD 카드도 같은 SPI 버스를 쓰므로, ISP 중에는 `SD CS`를 반드시 High 유지

## 3. 메인 회로도

```text
                        +---------------- ESP32-C5 ----------------+
                        |                                          |
                        |  GPIO12 ------------------------------+   |
                        |                                       |   |
                        |  GPIO11 ---------------------------+   |   |
                        |                                    |   |   |
                        |  GPIO9  <---[10k]---+-------------+---+   |
                        |                     |                     |
                        |                    [20k]                  |
                        |                     |                     |
                        |                    GND                    |
                        |                                           |
                        |  GPIO24 ---[2.2k]---B   2N3904            |
                        |                       C----------------+   |
                        |  GND -----------------E                |   |
                        |                                       |   |
                        |  GPIO5  ------------------------------|---+--> ATmega RXD0
                        |  GPIO4  <-----------------------------|------- ATmega TXD0
                        +---------------------------------------|-------+
                                                                |
                                                                |
                +----------------------- ATmega128 -----------------------+
                |                                                        |
                | ISP SCK  <---------------------------------------------+---- ESP GPIO12
                | ISP MOSI <---------------------------------------------+---- ESP GPIO11
                | ISP MISO ------------------------------------------+-------- ESP GPIO9 (via divider)
                |                                                     |
                | RESET  <--------------------------------------------+---- 2N3904 collector
                | RESET ----[10k]---- +5V                              |
                |                                                        |
                | RXD0   <---------------------------------------------------- ESP GPIO5
                | TXD0   -----------------------------------------------------> ESP GPIO4
                |                                                        |
                | VCC    -------------------- +5V                         |
                | GND    -------------------- GND ------------------------+---- ESP GND
                +--------------------------------------------------------+

                +----------------------- SD Card ------------------------+
                | CS    <---------------------------------------------- ESP GPIO10
                | MOSI  <---------------------------------------------- ESP GPIO11
                | SCK   <---------------------------------------------- ESP GPIO12
                | MISO  ----------------------------------------------> ESP GPIO9
                | VCC   -------------------- 3.3V
                | GND   -------------------- GND
                +-------------------------------------------------------+
```

## 4. 배선표

### ESP32-C5 <-> ATmega128 ISP

| ESP32-C5 | 부품/조건 | ATmega128 |
|---|---|---|
| `GPIO12` | 직접 연결 | `SCK` |
| `GPIO11` | 직접 연결 | `MOSI` |
| `GPIO9` | `10k:20k` 분압 후 입력 | `MISO` |
| `GPIO24` | `2.2k` 직렬 -> `2N3904 Base` | `RESET` Low 제어 |
| `GND` | 공통 GND | `GND` |

### ESP32-C5 <-> 기존 UART

| ESP32-C5 | ATmega128 |
|---|---|
| `GPIO5` | `RXD0` |
| `GPIO4` | `TXD0` |

### ESP32-C5 <-> SD Card

| ESP32-C5 | SD |
|---|---|
| `GPIO10` | `CS` |
| `GPIO11` | `MOSI` |
| `GPIO12` | `SCK` |
| `GPIO9` | `MISO` |
| `3.3V` | `VCC` |
| `GND` | `GND` |

## 5. RESET 드라이버 상세

`ATmega RESET`은 5V 풀업 상태를 유지하고, ESP32는 NPN 트랜지스터로만 Low를 만든다.

```text
ESP32 GPIO24 ---[2.2k]---- Base (2N3904)
GND ---------------------- Emitter
Collector ---------------- ATmega RESET

ATmega RESET ---[10k]----- +5V
Base ---[100k]------------ GND    ; 선택사항, 부팅시 오동작 방지
```

동작:

- `GPIO24 = LOW` -> 트랜지스터 OFF -> `RESET` High 유지
- `GPIO24 = HIGH` -> 트랜지스터 ON -> `RESET` Low

이 방식이 좋은 이유:

- ESP32 3.3V GPIO를 5V RESET 라인에 직접 연결하지 않음
- 강제로 Low만 만들기 때문에 안전함
- 기존 수동 RESET 작업을 자동화 가능

## 6. MISO 레벨 시프팅 상세

ATmega128이 5V 동작이면 `MISO`가 5V 레벨로 올라오므로 ESP32-C5 입력 보호가 필요하다.

권장 분압:

```text
ATmega MISO ----[10k]----+----> ESP32 GPIO9
                         |
                        [20k]
                         |
                        GND
```

이때 ESP 입력 전압은 대략 3.3V 수준으로 내려간다.

`MOSI`와 `SCK`는 `ESP32(3.3V) -> ATmega(5V)` 방향이므로 일반적으로 직접 연결 가능하다.

## 7. 권장 ISP 헤더

ATmega 쪽에는 2x3 ISP 헤더를 빼두는 것을 권장한다.

```text
ATmega ISP Header

1  MISO
2  VCC
3  SCK
4  MOSI
5  RESET
6  GND
```

ESP32-C5 보드와의 연결은 이 헤더 기준으로 잡으면 유지보수가 편하다.

## 8. SD 공유 SPI 주의사항

현재 코드상 SD와 OTA/ISP가 같은 SPI 핀을 사용한다.

즉, OTA 중에는 아래 조건을 지켜야 한다.

- `GPIO10(SD CS)`는 항상 High
- 가능하면 OTA 기록 동안 SD 접근 금지
- 가장 안전한 방법은 OTA 중 SD 카드 제거 또는 SD 전원 차단

추가 권장사항:

- `SD CS`에 `47k` pull-up 추가
- SD 모듈이 CS High에서 MISO를 완전히 tri-state 하지 않으면, SD MISO에 직렬 저항 `330~1k` 추가 검토

더 안정적으로 만들려면 다음 중 하나를 추가할 수 있다.

- SD 전원 차단용 P-MOSFET
- SD MISO 차단용 `74LVC1T125` 또는 `74HC125`

하지만 1차 제작은 "CS High 유지 + OTA 중 SD 미사용"만으로 먼저 시작하는 것이 단순하다.

## 9. 전원 권장

- ESP32-C5 : `3.3V`
- ATmega128 : `5V`
- 두 보드는 반드시 `GND` 공통

권장 디커플링:

- ATmega128 VCC/AVCC 근처 `0.1uF` 세라믹
- ESP32-C5 `3.3V` 라인 안정화
- RESET 라인과 SPI 배선은 너무 길지 않게

## 10. 실제 제작용 요약

가장 권장하는 현재 기준 회로는 아래 한 줄로 요약된다.

- `GPIO12 -> SCK`
- `GPIO11 -> MOSI`
- `ATmega MISO -> 10k/20k 분압 -> GPIO9`
- `GPIO24 -> 2.2k -> 2N3904 Base`, `Collector -> ATmega RESET`, `Emitter -> GND`
- `RESET -> 10k -> +5V`
- `GPIO10 -> SD CS`
- `GPIO4/5`는 기존 UART 유지
- `GND` 공통

## 11. 추천 BOM

- `2N3904` x1
- `2.2k` x1
- `10k` x2
- `20k` x1
- `100k` x1 선택사항
- `0.1uF` 세라믹 여러 개
- 2x3 ISP 헤더 x1

## 12. 다음 단계

이 회로가 준비되면 펌웨어 쪽 다음 작업은 보통 순서가 이렇다.

1. ESP32에서 OTA 바이너리 다운로드
2. `GPIO24`로 ATmega RESET 제어
3. SPI로 ATmega ISP 진입
4. Flash write / verify
5. RESET release
6. 기존 UART 브리지 복귀

원하면 다음 단계로 바로 이어서 해드릴 수 있다.

- `KiCad용 회로도 텍스트(netlist 스타일)`로 변환
- `실제 배선도 PNG/SVG용 ASCII 초안` 제작
- `ESP32-C5에서 ATmega128 ISP/OTA 제어용 아두이노 코드` 뼈대 작성
- `현재 ABBAS_ESPbyMELAUHF.ino에 붙일 OTA 업데이트 상태머신 설계`
