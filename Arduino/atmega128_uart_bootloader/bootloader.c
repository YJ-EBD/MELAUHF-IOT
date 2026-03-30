#include <avr/boot.h>
#include <avr/eeprom.h>
#include <avr/interrupt.h>
#include <avr/io.h>
#include <avr/pgmspace.h>
#include <avr/wdt.h>
#include <stdbool.h>
#include <stdint.h>
#include <util/delay.h>

#ifndef F_CPU
#define F_CPU 16000000UL
#endif

#define UART_UBRR_VALUE 16U
#define BOOT_WAIT_MS 1500U
#define COMMAND_IDLE_TIMEOUT_MS 1000U
#define FLASH_BLOCK_CAP 256U
#define BOOT_START_BYTE 0x1F000UL
#define APP_LAST_BYTE (BOOT_START_BYTE - 1UL)

static uint8_t g_pageBuffer[SPM_PAGESIZE];
static uint8_t g_blockBuffer[FLASH_BLOCK_CAP];
static uint32_t g_wordAddress = 0;

static void uartInit(void) {
  UCSR0A = _BV(U2X0);
  UCSR0B = _BV(RXEN0) | _BV(TXEN0);
  UCSR0C = _BV(UCSZ01) | _BV(UCSZ00);
  UBRR0H = 0;
  UBRR0L = UART_UBRR_VALUE;
}

static void uartPutc(uint8_t value) {
  while ((UCSR0A & _BV(UDRE0)) == 0) {
  }
  UDR0 = value;
}

static uint8_t uartGetcBlocking(void) {
  while ((UCSR0A & _BV(RXC0)) == 0) {
  }
  return UDR0;
}

static bool uartGetcTimeout(uint8_t* out, uint16_t timeoutMs) {
  if (!out) return false;
  while (timeoutMs-- > 0U) {
    if (UCSR0A & _BV(RXC0)) {
      *out = UDR0;
      return true;
    }
    _delay_ms(1);
  }
  return false;
}

static bool appPresent(void) {
  return pgm_read_word_far(0UL) != 0xFFFFU;
}

__attribute__((noreturn)) static void jumpToApp(void) {
  cli();
  UCSR0A = 0;
  UCSR0B = 0;
  UCSR0C = 0;
#if defined(RAMPZ)
  RAMPZ = 0;
#endif
  asm volatile("jmp 0x0000");
  for (;;) {
  }
}

static void flashReadPage(uint32_t pageAddr) {
  for (uint16_t i = 0; i < SPM_PAGESIZE; i++) {
    g_pageBuffer[i] = pgm_read_byte_far(pageAddr + i);
  }
}

static void flashWritePage(uint32_t pageAddr) {
  eeprom_busy_wait();
  boot_page_erase_safe(pageAddr);
  for (uint16_t i = 0; i < SPM_PAGESIZE; i += 2U) {
    uint16_t word = (uint16_t)g_pageBuffer[i] | ((uint16_t)g_pageBuffer[i + 1U] << 8);
    boot_page_fill_safe(pageAddr + i, word);
  }
  boot_page_write_safe(pageAddr);
  boot_rww_enable_safe();
}

static bool flashWriteBytes(uint32_t byteAddr, const uint8_t* data, uint16_t len) {
  if (!data) return false;
  if (len == 0U) return true;
  if (byteAddr > APP_LAST_BYTE) return false;
  if ((byteAddr + (uint32_t)len - 1UL) > APP_LAST_BYTE) return false;

  while (len > 0U) {
    uint32_t pageAddr = byteAddr & ~((uint32_t)SPM_PAGESIZE - 1UL);
    uint16_t pageOffset = (uint16_t)(byteAddr - pageAddr);
    uint16_t chunk = (uint16_t)SPM_PAGESIZE - pageOffset;
    if (chunk > len) chunk = len;

    flashReadPage(pageAddr);
    for (uint16_t i = 0; i < chunk; i++) {
      g_pageBuffer[pageOffset + i] = data[i];
    }
    flashWritePage(pageAddr);

    byteAddr += chunk;
    data += chunk;
    len -= chunk;
  }

  return true;
}

static void eraseApplication(void) {
  for (uint32_t pageAddr = 0UL; pageAddr < BOOT_START_BYTE; pageAddr += SPM_PAGESIZE) {
    boot_page_erase_safe(pageAddr);
  }
  boot_rww_enable_safe();
}

static void sendProgrammerId(void) {
  static const char kId[] = "AVRBOOT";
  for (uint8_t i = 0; i < (sizeof(kId) - 1U); i++) {
    uartPutc((uint8_t)kId[i]);
  }
}

static void handleSetAddress(void) {
  uint8_t high = uartGetcBlocking();
  uint8_t low = uartGetcBlocking();
  g_wordAddress = ((uint32_t)high << 8) | low;
  uartPutc('\r');
}

static void handleBlockLoad(void) {
  uint16_t len = ((uint16_t)uartGetcBlocking() << 8);
  len |= uartGetcBlocking();
  uint8_t memType = uartGetcBlocking();

  if (len > FLASH_BLOCK_CAP) {
    for (uint16_t i = 0; i < len; i++) {
      (void)uartGetcBlocking();
    }
    uartPutc('?');
    return;
  }

  for (uint16_t i = 0; i < len; i++) {
    g_blockBuffer[i] = uartGetcBlocking();
  }

  if (memType != 'F') {
    uartPutc('?');
    return;
  }

  uint32_t byteAddr = g_wordAddress << 1;
  if (!flashWriteBytes(byteAddr, g_blockBuffer, len)) {
    uartPutc('?');
    return;
  }

  g_wordAddress += (uint32_t)((len + 1U) / 2U);
  uartPutc('\r');
}

static void handleBlockRead(void) {
  uint16_t len = ((uint16_t)uartGetcBlocking() << 8);
  len |= uartGetcBlocking();
  uint8_t memType = uartGetcBlocking();

  if (memType == 'F') {
    uint32_t byteAddr = g_wordAddress << 1;
    for (uint16_t i = 0; i < len; i++) {
      uartPutc(pgm_read_byte_far(byteAddr + i));
    }
    g_wordAddress += (uint32_t)((len + 1U) / 2U);
    return;
  }

  if (memType == 'E') {
    uint16_t eepAddr = (uint16_t)g_wordAddress;
    for (uint16_t i = 0; i < len; i++) {
      uartPutc(eeprom_read_byte((const uint8_t*)(uintptr_t)(eepAddr + i)));
    }
    g_wordAddress += len;
    return;
  }

  for (uint16_t i = 0; i < len; i++) {
    uartPutc(0xFF);
  }
}

static void handleCommand(uint8_t cmd) {
  switch (cmd) {
    case 'a':
      uartPutc('Y');
      break;
    case 'A':
      handleSetAddress();
      break;
    case 'b':
      uartPutc('Y');
      uartPutc((uint8_t)(FLASH_BLOCK_CAP >> 8));
      uartPutc((uint8_t)(FLASH_BLOCK_CAP & 0xFF));
      break;
    case 'B':
      handleBlockLoad();
      break;
    case 'e':
      eraseApplication();
      uartPutc('\r');
      break;
    case 'E':
      uartPutc('\r');
      jumpToApp();
      break;
    case 'F':
      uartPutc(boot_lock_fuse_bits_get(GET_LOW_FUSE_BITS));
      break;
    case 'g':
      handleBlockRead();
      break;
    case 'L':
      uartPutc('\r');
      break;
    case 'N':
      uartPutc(boot_lock_fuse_bits_get(GET_HIGH_FUSE_BITS));
      break;
    case 'P':
      uartPutc('\r');
      break;
    case 'p':
      uartPutc('S');
      break;
    case 'Q':
      uartPutc(boot_lock_fuse_bits_get(GET_EXTENDED_FUSE_BITS));
      break;
    case 'r':
      uartPutc(boot_lock_fuse_bits_get(GET_LOCK_BITS));
      break;
    case 'S':
      sendProgrammerId();
      break;
    case 's':
      uartPutc(0x1E);
      uartPutc(0x97);
      uartPutc(0x02);
      break;
    case 'T':
    case 'x':
    case 'y':
      (void)uartGetcBlocking();
      uartPutc('\r');
      break;
    case 't':
      uartPutc(0x00);
      break;
    case 'V':
      uartPutc('1');
      uartPutc('0');
      break;
    case 'v':
      uartPutc('1');
      uartPutc('0');
      break;
    default:
      uartPutc('?');
      break;
  }
}

int main(void) {
  cli();
  wdt_disable();
  uartInit();

  uint8_t firstCmd = 0;
  if (!uartGetcTimeout(&firstCmd, BOOT_WAIT_MS)) {
    if (appPresent()) jumpToApp();
    firstCmd = 'S';
  }

  for (;;) {
    handleCommand(firstCmd);
    if (!uartGetcTimeout(&firstCmd, COMMAND_IDLE_TIMEOUT_MS)) {
      if (appPresent()) jumpToApp();
      firstCmd = 'S';
    }
  }
}
