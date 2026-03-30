#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BOOT_DIR="$ROOT_DIR/Arduino/atmega128_uart_bootloader"
BOOT_HEX="$BOOT_DIR/build/atmega128_uart_avr109.hex"
APP_HEX="$ROOT_DIR/Arduino/build/melauhf_atmega_app/hi-aba.hex"
OUT_DIR="$ROOT_DIR/Arduino/build/atmega128_bundle"
MERGED_HEX="$OUT_DIR/MELAUHF_ATmega128_boot_app_merged.hex"

mkdir -p "$OUT_DIR"

make -C "$BOOT_DIR" clean all
"$ROOT_DIR/Arduino/tools/build_melauhf_app.sh"
python3 "$ROOT_DIR/Arduino/tools/merge_ihex.py" -o "$MERGED_HEX" "$APP_HEX" "$BOOT_HEX"

cp "$BOOT_HEX" "$OUT_DIR/"
cp "$APP_HEX" "$OUT_DIR/"

echo "bootloader_hex=$BOOT_HEX"
echo "app_hex=$APP_HEX"
echo "merged_hex=$MERGED_HEX"
echo "recommended_fuses=LFUSE:0xBF HFUSE:0xC2 EFUSE:0xFF"
