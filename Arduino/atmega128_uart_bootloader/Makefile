MCU := atmega128a
F_CPU := 16000000UL
BOOT_START_BYTE := 0x1F000
BOOT_UART_NUM := 0
BOOT_UART_BAUD := 115200UL
OUT_DIR := build
TARGET := atmega128_uart0_avr109

CC := avr-gcc
OBJCOPY := avr-objcopy
SIZE := avr-size

CFLAGS := \
	-mmcu=$(MCU) \
	-DF_CPU=$(F_CPU) \
	-DBOOT_UART_NUM=$(BOOT_UART_NUM) \
	-DBOOT_UART_BAUD=$(BOOT_UART_BAUD) \
	-Os \
	-std=gnu99 \
	-ffunction-sections \
	-fdata-sections \
	-funsigned-char \
	-funsigned-bitfields \
	-Wall \
	-Wextra

LDFLAGS := \
	-mmcu=$(MCU) \
	-Wl,--gc-sections \
	-Wl,--relax \
	-Wl,--section-start=.text=$(BOOT_START_BYTE)

ELF := $(OUT_DIR)/$(TARGET).elf
HEX := $(OUT_DIR)/$(TARGET).hex
MAP := $(OUT_DIR)/$(TARGET).map
OBJ := $(OUT_DIR)/bootloader.o

.PHONY: all clean

all: $(HEX)
	@$(SIZE) -A --format=avr --mcu=$(MCU) $(ELF)
	@echo "bootloader_hex=$(HEX)"

$(OUT_DIR):
	@mkdir -p $(OUT_DIR)

$(OBJ): bootloader.c | $(OUT_DIR)
	$(CC) $(CFLAGS) -c $< -o $@

$(ELF): $(OBJ)
	$(CC) $(LDFLAGS) -Wl,-Map=$(MAP) $< -o $@

$(HEX): $(ELF)
	$(OBJCOPY) -O ihex -R .eeprom $< $@

clean:
	rm -rf $(OUT_DIR)
