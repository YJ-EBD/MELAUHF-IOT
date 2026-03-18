# OTA ATmega for ESP32 Plan

## 목적

현재 `ABBAS_ESPbyMELAUHF.ino`의 핀맵을 기준으로, ESP32-C5에서 ATmega를 ISP 방식으로 다루기 위한 `1안`을 정리한다.

이 문서는 `2N3904`를 사용해 `ATmega RESET`을 ESP 쪽에서 안전하게 제어하는 구성을 기준으로 한다.

현재 스케치 기준 확인된 주요 핀:

- `SD_SPI_CS_PIN = GPIO10`
- `SD_SPI_MOSI_PIN = GPIO11`
- `SD_SPI_SCK_PIN = GPIO12`
- `SD_SPI_MISO_PIN = GPIO9`
- `ATMEGA_RX_PIN = GPIO4`
- `ATMEGA_TX_PIN = GPIO5`
- `DWIN_RX_PIN = GPIO6`
- `DWIN_TX_PIN = GPIO7`

## 1안 요약

가장 추천하는 방법은 기존 `2N3904`를 이용해서 `ATmega RESET`을 `GND`로 끌어내리는 방식이다.

이 방식의 장점:

- `RESET`을 손으로 직접 대지 않아도 된다
- `ESP GPIO`를 `ATmega 5V RESET`에 직접 연결하지 않아 더 안전하다
- 한 번 배선해 두면 매번 재배선할 필요가 없다

핵심 개념:

- `SCK`, `MOSI`, `MISO`는 ESP32의 SPI 핀을 사용한다
- `RESET`은 `2N3904`가 대신 `GND`로 당긴다
- ATmega의 `RESET` 풀업은 기존 회로를 유지한다

## 1안 배선도

### SPI / 공통 배선

```text
ESP32-C5                          ATmega ISP Target

GPIO12  ----------------------->  SCK
GPIO11  ----------------------->  MOSI

ATmega MISO ---10k---+--------->  GPIO9
                     |
                    20k
                     |
                    GND

GND     ----------------------->  GND
```

설명:

- `ATmega`가 `5V`로 동작하면 `MISO`는 그대로 ESP에 넣지 말고 위 저항분배기를 거치는 것이 안전하다
- `MOSI`, `SCK`는 `ESP32 3.3V -> ATmega` 방향이라 보통 그대로 사용 가능하다

### RESET 제어 배선

```text
ESP32-C5                               2N3904                     ATmega

GPIO24 ---- 1k ~ 4.7k ----> Base
GND -----------------------> Emitter
                              Collector -----------------------> RESET

ATmega RESET ---- 10k ----> +5V   (기존 풀업 유지)
```

선택 권장:

- `GPIO24`를 `RESET 제어용`으로 사용
- 베이스 저항은 `1k ~ 4.7k`
- 필요하면 `Base-GND` 사이에 `10k` 풀다운을 추가해도 좋다

동작 개념:

- `GPIO24 HIGH` -> `2N3904 ON` -> `RESET LOW`
- `GPIO24 LOW` -> `2N3904 OFF` -> `RESET`은 풀업으로 다시 `HIGH`

즉 `2N3904`는 `ATmega RESET`을 직접 `GND`로 끌어내리는 스위치 역할을 한다.

## 정리된 전체 배선

```text
ESP32-C5                                  ATmega

GPIO12  --------------------------------> SCK
GPIO11  --------------------------------> MOSI

ATmega MISO ---10k---+------------------> GPIO9
                     |
                    20k
                     |
                    GND

GPIO24 --- 1k~4.7k ---> 2N3904 Base
GND ------------------> 2N3904 Emitter
2N3904 Collector -----> ATmega RESET

ATmega RESET --- 10k ---> +5V   (existing pull-up)

GND ------------------------------------> GND
```

## 1안 설명

이 구성은 `수동 RESET` 대신 `ESP32`가 `ATmega RESET`을 제어할 수 있게 해 준다.

따라서 수동 방식처럼:

- `RESET 선을 손으로 GND에 대고`
- `끝나면 다시 떼는`

과정을 반복하지 않아도 된다.

즉, 이전에 이야기한 수동 방식보다 훨씬 안정적이고 편하다.

## 실무 메모

- 현재 스케치는 `SD`가 같은 `SPI` 버스를 사용한다
- 따라서 ISP 작업 중에는 `SD 카드 제거`가 가장 안전하다
- 카드를 빼지 않는다면 최소한 `SD CS(GPIO10)`가 확실히 비활성 상태여야 한다
- `ESP GPIO`를 `ATmega RESET`에 직접 연결하는 방식은 권장하지 않는다
- `ATmega`가 `5V`이면 `MISO -> ESP`는 반드시 전압을 낮춰 받는 편이 좋다

## 결론

`1안`은 현재 조건에서 가장 깔끔한 자동화 배선이다.

핵심만 다시 적으면:

- `SPI`는 `GPIO12 / GPIO11 / GPIO9`
- `RESET`은 `GPIO24 + 2N3904`
- `MISO`는 저항분배기 사용
- `SD`는 가능하면 작업 중 분리

이 구성이 되면 `직접 RESET 선을 뺐다 꼈다` 하는 수동 작업은 없어지고, `2N3904`가 그 역할을 대신한다.
