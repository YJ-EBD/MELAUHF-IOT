# ATmega UART OTA Upload Settings

## 1. 목적
- `ATmega_Web_UART_OTA_Minimal.ino` 기준으로 ATmega128A UART OTA를 실기 검증한 설정과 실행 절차를 한곳에 정리한다.
- 이 문서는 `ABBAS_ESPbyMELAUHF.ino` 적용 전의 기준선 문서다.

## 2. 사용 파일
- 스케치: `ATmega_Web_UART_OTA_Minimal.ino`
- 블록 업로더: `flashblk_segment_uploader.py`
- 라인 업로더: `flashusb_segment_uploader.py`
- 대상 HEX: `/home/abbas/Desktop/Arduino/build/melauhf_atmega_app/hi-aba.hex`

## 3. 하드웨어/통신 기준
- 보드: ESP32-C5
- ATmega UART2: `RX=4`, `TX=5`
- ATmega RESET: `GPIO24`
- ATmega app baud: `115200`
- bootloader baud: `245000`
- fallback baud: `115200`
- alt baud: `38400`
- bootloader ID: `AVRBT2W`
- AVR109 block size: `256`

## 4. 스케치 컴파일/업로드
```bash
arduino-cli compile --fqbn esp32:esp32:esp32c5 --board-options CDCOnBoot=cdc /home/abbas/Desktop/Arduino/ATmega_Web_UART_OTA_Minimal
arduino-cli upload -p /dev/ttyACM0 --fqbn esp32:esp32:esp32c5 --board-options CDCOnBoot=cdc,UploadSpeed=115200 /home/abbas/Desktop/Arduino/ATmega_Web_UART_OTA_Minimal
```

## 5. 검증된 안전 설정
- 업로더 방식: `flashblk`
- `chunk=256`
- `segment_blocks=12`
- `rollover_blocks=65535`
- `gap_us=250`
- `settle_ms=100`
- `window_blocks=6`
- `order=high`
- `block_order=low`
- `segment_delay_sec=1.0`
- `start_retries=3`
- `start_retry_delay_sec=1.5`

## 6. 검증된 전체 업로드 명령
기본값이 이미 안전 설정으로 맞춰져 있으므로 아래처럼 실행하면 된다.

```bash
python3 /home/abbas/Desktop/Arduino/ATmega_Web_UART_OTA_Minimal/flashblk_segment_uploader.py
```

명시적으로 쓰면 아래와 같다.

```bash
python3 /home/abbas/Desktop/Arduino/ATmega_Web_UART_OTA_Minimal/flashblk_segment_uploader.py \
  --chunk 256 \
  --segment-blocks 12 \
  --rollover-blocks 65535 \
  --gap-us 250 \
  --settle-ms 100 \
  --window-blocks 6 \
  --order high \
  --block-order low \
  --segment-delay-sec 1.0 \
  --start-retries 3 \
  --start-retry-delay-sec 1.5
```

## 7. 실기 검증 결과
- segment 8 단독 성공: `chunk=256`, `window=6`, `gap=250`, `settle=100`
- 앞 8세그먼트 연속 성공: `22.463s`
- 앞 10세그먼트 연속 성공: `33.219s`
- 전체 `hi-aba.hex` 84,514B 성공: `93.887s`
- 전체 성공 후 검증:
  - `ping` OK
  - `probe` OK
  - `peek 245000 200 1200` => `1E 97 02 sig=OK`

## 8. 헬스 체크 명령
직접 점검할 때는 USB 연결 후 약 10초 대기 뒤 아래 순서로 본다.

```text
ping
probe
peek 245000 200 1200
```

정상 기준:
- `ping` => `pong`
- `probe` => `[PROBE] OK sig=1E9702 blk=256 id=AVRBT2W lock=FF`
- `peek` => `got=3 bytes=1E 97 02 sig=OK`

## 9. 이번 채팅에서 반영된 업로더 정리
- `flashblk` 기반 블록 스트리밍 경로 추가/정리
- 시작 handshake 실패 시 segment start retry 추가
- 기본값을 full-success 기준으로 조정
- `block_order` 실험 옵션 추가

## 10. 아직 남은 제한
- `50초 이내` 목표는 아직 미달성이다.
- 단일 bootloader session(`segment-blocks`를 매우 크게 잡고 한 번에 쓰는 방식)은 현재 안정적으로 완주하지 못했다.
- `ABBAS_ESPbyMELAUHF.ino`에는 아직 이 설정을 적용하지 않았다.

## 11. 다음 적용 순서
1. 이 문서 기준 설정으로 minimal에서 반복 재검증
2. `ABBAS_ESPbyMELAUHF.ino`에 동일한 UART OTA 파라미터와 retry 전략 이식
3. 메인 스케치에서 다시 실기 OTA/복귀 검증
