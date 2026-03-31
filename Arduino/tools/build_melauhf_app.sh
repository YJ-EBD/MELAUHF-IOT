#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="$ROOT_DIR/MELAUHF/펌웨어/hi-aba_total_rev6_brf/hi-aba"
OUT_DIR="$ROOT_DIR/Arduino/build/melauhf_atmega_app"

CC="${CC:-avr-gcc}"
OBJCOPY="${OBJCOPY:-avr-objcopy}"
SIZE="${SIZE:-avr-size}"

SOURCES=(
  ads1115.c
  brf_mode.c
  common_f.c
  ds1307.c
  hic_mode.c
  i2c.c
  tron_mode.c
  crc.c
  dwin.c
  Init.c
  IOT_mode.c
  main.c
)

CFLAGS=(
  -mmcu=atmega128a
  -DF_CPU=16000000
  -DDEBUG
  -O1
  -std=gnu99
  -fcommon
  -funsigned-char
  -funsigned-bitfields
  -ffunction-sections
  -fdata-sections
  -fpack-struct
  -fshort-enums
  -mrelax
  -g2
  -Wall
)

mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR"/*.o "$OUT_DIR"/*.d "$OUT_DIR"/hi-aba.elf "$OUT_DIR"/hi-aba.hex "$OUT_DIR"/hi-aba.eep "$OUT_DIR"/hi-aba.map

for source in "${SOURCES[@]}"; do
  object="$OUT_DIR/${source%.c}.o"
  "$CC" "${CFLAGS[@]}" -c "$SRC_DIR/$source" -o "$object"
done

OBJECTS=()
for source in "${SOURCES[@]}"; do
  OBJECTS+=("$OUT_DIR/${source%.c}.o")
done

"$CC" \
  -mmcu=atmega128a \
  -Wl,-Map="$OUT_DIR/hi-aba.map" \
  -Wl,--start-group \
  -Wl,-lm \
  -Wl,--end-group \
  -Wl,--gc-sections \
  -mrelax \
  "${OBJECTS[@]}" \
  -o "$OUT_DIR/hi-aba.elf"

"$OBJCOPY" -O ihex -R .eeprom "$OUT_DIR/hi-aba.elf" "$OUT_DIR/hi-aba.hex"
"$OBJCOPY" -O ihex -j .eeprom --change-section-lma .eeprom=0 "$OUT_DIR/hi-aba.elf" "$OUT_DIR/hi-aba.eep" 2>/dev/null || true
"$SIZE" -A --format=avr --mcu=atmega128a "$OUT_DIR/hi-aba.elf"
rm -f "$OUT_DIR"/*.o "$OUT_DIR"/*.d "$OUT_DIR"/hi-aba.elf "$OUT_DIR"/hi-aba.eep "$OUT_DIR"/hi-aba.map

echo "app_hex=$OUT_DIR/hi-aba.hex"
