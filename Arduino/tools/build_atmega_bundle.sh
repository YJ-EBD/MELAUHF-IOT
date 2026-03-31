#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BOOT_DIR="$ROOT_DIR/Arduino/atmega128_uart_bootloader"
APP_HEX="$ROOT_DIR/Arduino/build/melauhf_atmega_app/hi-aba.hex"
OUT_DIR="$ROOT_DIR/Arduino/build/atmega128_bundle"
FINAL_HEX="$OUT_DIR/MELAUHF_ATmega128_boot_app_merged_uart1_250000.hex"

mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR"/*.hex

make -C "$BOOT_DIR" clean all BOOT_UART_NUM=1 BOOT_UART_BAUD=250000UL TARGET=atmega128_uart1_250000_avr109

"$ROOT_DIR/Arduino/tools/build_melauhf_app.sh"
python3 "$ROOT_DIR/Arduino/tools/merge_ihex.py" \
  -o "$FINAL_HEX" \
  "$APP_HEX" \
  "$BOOT_DIR/build/atmega128_uart1_250000_avr109.hex"
make -C "$BOOT_DIR" clean

echo "app_hex=$APP_HEX"
echo "isp_hex=$FINAL_HEX"
echo "bootloader_uart1_fast=UART1@250000(host=245000)"
echo "recommended_fuses=LFUSE:0xBF HFUSE:0xC2 EFUSE:0xFF"
