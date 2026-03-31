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

#ifndef BOOT_UART_NUM
#define BOOT_UART_NUM 0
#endif

#ifndef BOOT_UART_BAUD
#define BOOT_UART_BAUD 115200UL
#endif

#define UART_UBRR_VALUE ((uint16_t)(((F_CPU + (BOOT_UART_BAUD * 4UL)) / (BOOT_UART_BAUD * 8UL)) - 1UL))
#ifndef BOOT_WAIT_MS
#define BOOT_WAIT_MS 1500U
#endif

#ifndef COMMAND_IDLE_TIMEOUT_MS
#define COMMAND_IDLE_TIMEOUT_MS 15000U
#endif

#ifndef BLOCK_RX_TIMEOUT_MS
#define BLOCK_RX_TIMEOUT_MS 500U
#endif

#ifndef POST_BLOCK_WRITE_DELAY_MS
#define POST_BLOCK_WRITE_DELAY_MS 1U
#endif
#define FLASH_BLOCK_CAP 256U
#define BOOT_START_BYTE 0x1F000UL
#define APP_LAST_BYTE (BOOT_START_BYTE - 1UL)

#if BOOT_UART_NUM == 0
#define UART_UCSRA UCSR0A
#define UART_UCSRB UCSR0B
#define UART_UCSRC UCSR0C
#define UART_UBRRH UBRR0H
#define UART_UBRRL UBRR0L
#define UART_UDR UDR0
#define UART_BIT_U2X U2X0
#define UART_BIT_RXEN RXEN0
#define UART_BIT_TXEN TXEN0
#define UART_BIT_UCSZ1 UCSZ01
#define UART_BIT_UCSZ0 UCSZ00
#define UART_BIT_UDRE UDRE0
#define UART_BIT_RXC RXC0
#elif BOOT_UART_NUM == 1
#define UART_UCSRA UCSR1A
#define UART_UCSRB UCSR1B
#define UART_UCSRC UCSR1C
#define UART_UBRRH UBRR1H
#define UART_UBRRL UBRR1L
#define UART_UDR UDR1
#define UART_BIT_U2X U2X1
#define UART_BIT_RXEN RXEN1
#define UART_BIT_TXEN TXEN1
#define UART_BIT_UCSZ1 UCSZ11
#define UART_BIT_UCSZ0 UCSZ10
#define UART_BIT_UDRE UDRE1
#define UART_BIT_RXC RXC1
#else
#error "BOOT_UART_NUM must be 0 or 1"
#endif

static uint8_t g_pageBuffer[SPM_PAGESIZE];
static uint8_t g_blockBuffer[FLASH_BLOCK_CAP];
static uint32_t g_wordAddress = 0;

static void uartInit(void) {
  UART_UCSRA = _BV(UART_BIT_U2X);
  UART_UCSRB = _BV(UART_BIT_RXEN) | _BV(UART_BIT_TXEN);
  UART_UCSRC = _BV(UART_BIT_UCSZ1) | _BV(UART_BIT_UCSZ0);
  UART_UBRRH = 0;
  UART_UBRRL = UART_UBRR_VALUE;
}

static void uartPutc(uint8_t value) {
  while ((UART_UCSRA & _BV(UART_BIT_UDRE)) == 0) {
  }
  UART_UDR = value;
}

static uint8_t uartGetcBlocking(void) {
  while ((UART_UCSRA & _BV(UART_BIT_RXC)) == 0) {
  }
  return UART_UDR;
}

static bool uartGetcTimeout(uint8_t* out, uint16_t timeoutMs) {
  if (!out) return false;
  while (timeoutMs-- > 0U) {
    // Poll at microsecond granularity so block-mode RX does not overrun the
    // single-byte UART data register at 38400 baud.
    for (uint16_t i = 0; i < 1000U; i++) {
      if ((i & 0x3FU) == 0U) wdt_reset();
      if (UART_UCSRA & _BV(UART_BIT_RXC)) {
        *out = UART_UDR;
        return true;
      }
      _delay_us(1);
    }
  }
  return false;
}

static bool appPresent(void) {
  return pgm_read_word_far(0UL) != 0xFFFFU;
}

__attribute__((noreturn)) static void jumpToApp(void) {
  cli();
  UART_UCSRA = 0;
  UART_UCSRB = 0;
  UART_UCSRC = 0;
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
  wdt_reset();
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
    wdt_reset();
    boot_page_erase_safe(pageAddr);
  }
  boot_rww_enable_safe();
}

static void sendProgrammerId(void) {
  // 7-byte AVR109 ID so we can tell patched bootloaders apart in the field.
#if BOOT_UART_NUM == 0
  static const char kId[] = "AVRBT0W";
#else
  static const char kId[] = "AVRBT2W";
#endif
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
  uint8_t lenHi = 0;
  uint8_t lenLo = 0;
  uint8_t memType = 0;

  if (!uartGetcTimeout(&lenHi, BLOCK_RX_TIMEOUT_MS) ||
      !uartGetcTimeout(&lenLo, BLOCK_RX_TIMEOUT_MS) ||
      !uartGetcTimeout(&memType, BLOCK_RX_TIMEOUT_MS)) {
    uartPutc('?');
    return;
  }

  uint16_t len = ((uint16_t)lenHi << 8) | lenLo;

  if (len > FLASH_BLOCK_CAP) {
    for (uint16_t i = 0; i < len; i++) {
      (void)uartGetcBlocking();
    }
    uartPutc('?');
    return;
  }

  for (uint16_t i = 0; i < len; i++) {
    if (!uartGetcTimeout(&g_blockBuffer[i], BLOCK_RX_TIMEOUT_MS)) {
      uartPutc('?');
      return;
    }
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
  for (uint8_t i = 0; i < POST_BLOCK_WRITE_DELAY_MS; i++) {
    _delay_ms(1);
  }
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
#if defined(MCUSR)
  MCUSR = 0;
#elif defined(MCUCSR)
  MCUCSR = 0;
#endif
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
