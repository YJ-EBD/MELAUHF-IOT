#include <Arduino.h>
#include <SPI.h>
#include <SD.h>
#include <strings.h>

struct HexRecord;

// SD read + HEX parsing + AVR109 programming can overflow the default loop stack.
SET_LOOP_TASK_STACK_SIZE(16 * 1024);

#ifndef ATMEGA_RX_PIN
#define ATMEGA_RX_PIN 4
#endif

#ifndef ATMEGA_TX_PIN
#define ATMEGA_TX_PIN 5
#endif

#ifndef ATMEGA_RESET_PIN
#define ATMEGA_RESET_PIN 24
#endif

#ifndef ATMEGA_RESET_ASSERT_LEVEL
#define ATMEGA_RESET_ASSERT_LEVEL HIGH
#endif

#ifndef SD_SPI_CS_PIN
#define SD_SPI_CS_PIN 10
#endif

#ifndef SD_SPI_MOSI_PIN
#define SD_SPI_MOSI_PIN 11
#endif

#ifndef SD_SPI_SCK_PIN
#define SD_SPI_SCK_PIN 12
#endif

#ifndef SD_SPI_MISO_PIN
#define SD_SPI_MISO_PIN 9
#endif

#ifndef MELAUHF_POWER_EN_PIN
#define MELAUHF_POWER_EN_PIN -1
#endif

#ifndef MELAUHF_POWER_ON_LEVEL
#define MELAUHF_POWER_ON_LEVEL HIGH
#endif

static const uint32_t USB_BAUD = 115200;
static const size_t USB_CDC_RX_BUFFER_BYTES = 8192;
static const size_t ATMEGA_UART_RX_BUFFER_BYTES = 1024;
static const size_t ATMEGA_UART_TX_BUFFER_BYTES = 1024;
static const uint32_t ATMEGA_APP_BAUD = 115200;
// The fast UART1 bootloader is built for 250000, but this ESP32-C5 + board
// wiring combination samples it reliably at 245000 on the host side.
static const uint32_t ATMEGA_BOOTLOADER_BAUD = 245000;
static const uint32_t ATMEGA_BOOTLOADER_FALLBACK_BAUD = 115200;
static const uint32_t ATMEGA_BOOTLOADER_ALT_BAUD = 38400;
static const uint32_t RESET_PULSE_MS = 200;
static const uint32_t BOOT_WAIT_MS = 1500;
static const uint32_t AVR109_REPLY_TIMEOUT_MS = 600;
static const uint32_t AVR109_SIGNATURE_TIMEOUT_MS = 1200;
static const uint32_t AVR109_BLOCK_REPLY_TIMEOUT_MS = 5000;
static const uint32_t AVR109_ERASE_TIMEOUT_MS = 30000;
static const uint32_t AVR109_BLOCK_TX_GAP_US = 1500;
static const uint32_t AVR109_PATCHED_BLOCK_TX_GAP_US = 250;
static const uint8_t AVR109_PATCHED_BLOCK_BURST_BYTES = 16;
static const uint32_t AVR109_PATCHED_BLOCK_BURST_GAP_US = 200;
static const uint32_t AVR109_RETRY_BACKOFF_MS = 12;
static const uint32_t AVR109_RESYNC_PRE_DELAY_MS = 250;
static const uint32_t AVR109_INTER_CMD_GAP_MS = 0;
static const uint32_t HEX_LINE_TIMEOUT_MS = 4000;
static const uint32_t APP_PING_TIMEOUT_MS = 1500;
static const uint32_t ATMEGA_POST_BLOCK_RESET_SETTLE_MS = 100;
static const uint16_t AVR109_BLOCK_CAP = 256;
static const uint16_t AVR109_HOST_BLOCK_CAP = 256;
static const uint16_t AVR109_STREAM_BLOCK_CAP = 256;
static const uint16_t AVR109_SESSION_BLOCK_CAP = 24;
static const uint8_t AVR109_BLOCK_RETRIES = 3;
static const uint32_t SD_SPI_FREQ_HZ = 1000000;
static const uint32_t SD_POWERUP_SETTLE_MS = 600;
static const uint8_t SD_MOUNT_RETRIES = 3;
static const uint32_t SD_MOUNT_RETRY_DELAY_MS = 180;
static const char* SD_DEFAULT_HEX_PATH = "/AtmegaOta.hex";
static const bool AVR109_SKIP_CHIP_ERASE = true;
static const uint32_t AVR109_APP_LAST_BYTE = 0x1EFFFUL;
// Keep destructive UART write/load diagnostics in a high application window by
// default. This avoids trashing the reset vector/app entry and losing the
// only software path back into the bootloader during bring-up.
static const uint32_t AVR109_TEST_BYTE_ADDR = 0x1E000UL;

struct HexRecord {
  uint8_t len;
  uint16_t addr;
  uint8_t type;
  uint8_t data[255];
};

HardwareSerial ATMEGA(2);

static char g_cmd[768];
static uint16_t g_cmdLen = 0;
static bool g_tapEnabled = false;
static bool g_otaActive = false;
static bool g_usbHexActive = false;
static bool g_usbBlockActive = false;
static bool g_usbHexBootSessionOpen = false;
static uint32_t g_atmegaCurrentBaud = ATMEGA_APP_BAUD;
static uint32_t g_flashBlocks = 0;
static uint32_t g_bytesDone = 0;
static uint32_t g_bytesTotal = 0;
static uint16_t g_bootSessionBlocks = 0;
static char g_statusText[96] = "idle";
static char g_sourceText[192] = {0};
static char g_bootloaderId[8] = {0};
static uint32_t g_avr109PatchedBlockTxGapUs = AVR109_PATCHED_BLOCK_TX_GAP_US;
static uint32_t g_avr109InterCmdGapMs = AVR109_INTER_CMD_GAP_MS;
static uint32_t g_atmegaPostBlockResetSettleMs = ATMEGA_POST_BLOCK_RESET_SETTLE_MS;
static uint16_t g_avr109StreamBlockCap = AVR109_STREAM_BLOCK_CAP;
static uint16_t g_avr109SessionBlockCap = AVR109_SESSION_BLOCK_CAP;
static uint16_t g_atmegaFlashChunkCap = AVR109_STREAM_BLOCK_CAP;
static uint8_t g_usbHexBlockBuf[AVR109_BLOCK_CAP];
static uint32_t g_usbHexBlockStart = 0;
static size_t g_usbHexBlockLen = 0;
static uint32_t g_usbHexBaseAddr = 0;
static uint32_t g_usbHexLineNo = 0;

static bool hexParseByte(const char* p, uint8_t& out);
static bool flushFlashBlockCurrentSession(uint32_t blockStartByteAddr,
                                          const uint8_t* blockData,
                                          size_t blockLen,
                                          char* errOut,
                                          size_t errSz);

static void setStatusText(const char* text) {
  snprintf(g_statusText, sizeof(g_statusText), "%s", (text && text[0]) ? text : "idle");
}

static void melauhfPowerInit() {
  if (MELAUHF_POWER_EN_PIN < 0) return;
  pinMode(MELAUHF_POWER_EN_PIN, OUTPUT);
  digitalWrite(MELAUHF_POWER_EN_PIN, MELAUHF_POWER_ON_LEVEL);
}

static void melauhfPowerSet(bool on) {
  if (MELAUHF_POWER_EN_PIN < 0) return;
  int level = on ? MELAUHF_POWER_ON_LEVEL : (MELAUHF_POWER_ON_LEVEL == HIGH ? LOW : HIGH);
  digitalWrite(MELAUHF_POWER_EN_PIN, level);
}

static void atmegaResetHold() {
  digitalWrite(ATMEGA_RESET_PIN, ATMEGA_RESET_ASSERT_LEVEL);
}

static void atmegaResetRelease() {
  digitalWrite(ATMEGA_RESET_PIN, (ATMEGA_RESET_ASSERT_LEVEL == HIGH) ? LOW : HIGH);
}

static void atmegaResetPulse(uint32_t pulseMs) {
  atmegaResetHold();
  delay(pulseMs);
  atmegaResetRelease();
}

static void atmegaDrainRx() {
  uint32_t startMs = millis();
  size_t drained = 0;
  while (ATMEGA.available()) {
    (void)ATMEGA.read();
    drained++;
    if (drained >= 1024U) break;
    if ((uint32_t)(millis() - startMs) > 25U) break;
  }
}

static void atmegaDumpRxBurst(const char* tag, uint32_t idleMs, size_t maxBytes) {
  uint8_t buf[32];
  size_t n = 0;
  if (maxBytes > sizeof(buf)) maxBytes = sizeof(buf);

  uint32_t lastByteMs = millis();
  while ((uint32_t)(millis() - lastByteMs) <= idleMs && n < maxBytes) {
    while (ATMEGA.available() && n < maxBytes) {
      int v = ATMEGA.read();
      if (v < 0) break;
      buf[n++] = (uint8_t)v;
      lastByteMs = millis();
    }
    delay(1);
  }

  if (n == 0) {
    Serial.printf("[RXDUMP] %s none\n", (tag && tag[0]) ? tag : "-");
    return;
  }

  Serial.printf("[RXDUMP] %s hex=", (tag && tag[0]) ? tag : "-");
  for (size_t i = 0; i < n; i++) {
    if (i != 0) Serial.print(' ');
    Serial.printf("%02X", (unsigned)buf[i]);
  }
  Serial.print(" ascii='");
  for (size_t i = 0; i < n; i++) {
    char c = (buf[i] >= 0x20 && buf[i] <= 0x7E) ? (char)buf[i] : '.';
    Serial.print(c);
  }
  Serial.println("'");
}

static void atmegaDumpPostEraseFailureContext() {
  uint32_t prevBaud = g_atmegaCurrentBaud;
  atmegaDumpRxBurst("erase_fail_tail", 40, 24);
  atmegaSwitchUartBaud(ATMEGA_APP_BAUD);
  atmegaDumpRxBurst("erase_fail_appbaud", 80, 48);
  atmegaSwitchUartBaud(prevBaud);
}

static void atmegaOpenUartBaud(uint32_t baud, bool forceReopen) {
  if (baud == 0) return;
  if (!forceReopen && g_atmegaCurrentBaud == baud) return;
  ATMEGA.flush();
  ATMEGA.end();
  delay(2);
  ATMEGA.begin(baud, SERIAL_8N1, ATMEGA_RX_PIN, ATMEGA_TX_PIN);
  g_atmegaCurrentBaud = baud;
  delay(10);
  atmegaDrainRx();
  Serial.printf("[ATOTA] host uart baud=%lu\n", (unsigned long)baud);
}

static void atmegaSwitchUartBaud(uint32_t baud) {
  atmegaOpenUartBaud(baud, false);
}

static void atmegaReopenUartBaud(uint32_t baud) {
  atmegaOpenUartBaud(baud, true);
}

static bool atmegaReadExact(uint8_t* out, size_t len, uint32_t timeoutMs) {
  if (!out && len != 0) return false;

  size_t got = 0;
  uint32_t lastByteMs = millis();
  while (got < len) {
    while (ATMEGA.available()) {
      int v = ATMEGA.read();
      if (v < 0) break;
      out[got++] = (uint8_t)v;
      lastByteMs = millis();
      if (got >= len) return true;
    }
    if ((uint32_t)(millis() - lastByteMs) > timeoutMs) return false;
    delay(1);
  }
  return true;
}

static bool atmegaReadExpectByteDetailed(uint8_t expected,
                                         uint32_t timeoutMs,
                                         char* detailOut,
                                         size_t detailSz) {
  if (detailOut && detailSz > 0) detailOut[0] = 0;

  uint8_t b = 0;
  if (!atmegaReadExact(&b, 1, timeoutMs)) {
    if (detailOut && detailSz > 0) snprintf(detailOut, detailSz, "timeout");
    return false;
  }

  if (b != expected) {
    if (detailOut && detailSz > 0) snprintf(detailOut, detailSz, "reply_%02X", (unsigned)b);
    return false;
  }

  if (detailOut && detailSz > 0) snprintf(detailOut, detailSz, "ok");
  return true;
}

static bool atmegaReadExpectByteTolerantDetailed(uint8_t expected,
                                                 uint32_t timeoutMs,
                                                 char* detailOut,
                                                 size_t detailSz) {
  if (detailOut && detailSz > 0) detailOut[0] = 0;

  uint8_t firstNoise = 0;
  uint8_t lastNoise = 0;
  uint16_t noiseCount = 0;
  uint32_t startMs = millis();
  uint32_t deadline = startMs + timeoutMs;

  while ((int32_t)(millis() - deadline) < 0) {
    while (ATMEGA.available()) {
      int v = ATMEGA.read();
      if (v < 0) break;

      uint8_t b = (uint8_t)v;
      if (b == expected) {
        uint32_t elapsedMs = (uint32_t)(millis() - startMs);
        if (detailOut && detailSz > 0) {
          if (noiseCount == 0) snprintf(detailOut, detailSz, "ok_%lums", (unsigned long)elapsedMs);
          else snprintf(detailOut,
                        detailSz,
                        "ok_%lums_noise_%u_%02X_%02X",
                        (unsigned long)elapsedMs,
                        (unsigned)noiseCount,
                        (unsigned)firstNoise,
                        (unsigned)lastNoise);
        }
        return true;
      }

      if (noiseCount == 0) firstNoise = b;
      lastNoise = b;
      noiseCount++;
    }
    delay(1);
  }

  if (detailOut && detailSz > 0) {
    uint32_t elapsedMs = (uint32_t)(millis() - startMs);
    if (noiseCount == 0) snprintf(detailOut, detailSz, "timeout_%lums", (unsigned long)elapsedMs);
    else snprintf(detailOut,
                  detailSz,
                  "timeout_%lums_noise_%u_%02X_%02X",
                  (unsigned long)elapsedMs,
                  (unsigned)noiseCount,
                  (unsigned)firstNoise,
                  (unsigned)lastNoise);
  }
  return false;
}

static bool atmegaReadExpectByteIgnoringNoiseDetailed(uint8_t expected,
                                                      uint8_t failFast,
                                                      uint32_t timeoutMs,
                                                      char* detailOut,
                                                      size_t detailSz) {
  if (detailOut && detailSz > 0) detailOut[0] = 0;

  uint8_t firstNoise = 0;
  uint8_t lastNoise = 0;
  uint16_t noiseCount = 0;
  uint32_t startMs = millis();
  uint32_t deadline = startMs + timeoutMs;

  while ((int32_t)(millis() - deadline) < 0) {
    while (ATMEGA.available()) {
      int v = ATMEGA.read();
      if (v < 0) break;

      uint8_t b = (uint8_t)v;
      if (b == expected) {
        uint32_t elapsedMs = (uint32_t)(millis() - startMs);
        if (detailOut && detailSz > 0) {
          if (noiseCount == 0) snprintf(detailOut, detailSz, "ok_%lums", (unsigned long)elapsedMs);
          else snprintf(detailOut,
                        detailSz,
                        "ok_%lums_noise_%u_%02X_%02X",
                        (unsigned long)elapsedMs,
                        (unsigned)noiseCount,
                        (unsigned)firstNoise,
                        (unsigned)lastNoise);
        }
        return true;
      }

      if (b == failFast) {
        if (detailOut && detailSz > 0) snprintf(detailOut, detailSz, "reply_%02X", (unsigned)b);
        return false;
      }

      if (noiseCount == 0) firstNoise = b;
      lastNoise = b;
      noiseCount++;
    }
    delay(1);
  }

  if (detailOut && detailSz > 0) {
    uint32_t elapsedMs = (uint32_t)(millis() - startMs);
    if (noiseCount == 0) snprintf(detailOut, detailSz, "timeout_%lums", (unsigned long)elapsedMs);
    else snprintf(detailOut,
                  detailSz,
                  "timeout_%lums_noise_%u_%02X_%02X",
                  (unsigned long)elapsedMs,
                  (unsigned)noiseCount,
                  (unsigned)firstNoise,
                  (unsigned)lastNoise);
  }
  return false;
}

static bool atmegaReadExpectByte(uint8_t expected, uint32_t timeoutMs) {
  char detail[16];
  return atmegaReadExpectByteDetailed(expected, timeoutMs, detail, sizeof(detail));
}

static void avr109FlushTx() {
  ATMEGA.flush();
}

static void avr109InterCmdDelay() {
  delay(g_avr109InterCmdGapMs);
}

static uint32_t avr109ProbeSendDelayMs(void) {
  if (g_atmegaCurrentBaud == ATMEGA_BOOTLOADER_BAUD) return 200;
  return 80;
}

static uint32_t avr109BlockTxGapUs(void) {
  // Legacy bootloaders still need paced block TX to avoid UART overrun.
  // Even the patched AVRBT* bootloaders are more stable with a small host gap
  // once we start chaining many sequential block writes.
  if (strncmp(g_bootloaderId, "AVRBT", 5) == 0) return g_avr109PatchedBlockTxGapUs;
  return AVR109_BLOCK_TX_GAP_US;
}

static void atmegaWritePaced(const uint8_t* data, size_t len, uint32_t gapUs) {
  if (!data || len == 0) return;
  const bool useBurstFlush = (strncmp(g_bootloaderId, "AVRBT", 5) == 0);
  uint8_t burstCount = 0;
  for (size_t i = 0; i < len; i++) {
    ATMEGA.write(data[i]);
    if (useBurstFlush) {
      burstCount++;
      if (burstCount >= AVR109_PATCHED_BLOCK_BURST_BYTES && (i + 1U) < len) {
        // Keep the UART TX FIFO nearly empty during long AVR109 writes so a
        // short scheduler hiccup does not turn into a missing byte mid-block.
        ATMEGA.flush();
        burstCount = 0;
        if (AVR109_PATCHED_BLOCK_BURST_GAP_US > 0) {
          delayMicroseconds(AVR109_PATCHED_BLOCK_BURST_GAP_US);
        }
      }
    }
    if (gapUs > 0 && (i + 1U) < len) delayMicroseconds(gapUs);
  }
}

static bool avr109ReadSignature(uint8_t sig[3]) {
  uint8_t cmd = 's';
  ATMEGA.write(&cmd, 1);
  avr109FlushTx();
  return atmegaReadExact(sig, 3, AVR109_REPLY_TIMEOUT_MS);
}

static bool avr109ReadSignatureTolerantDetailed(uint8_t sig[3],
                                                uint32_t timeoutMs,
                                                char* detailOut,
                                                size_t detailSz) {
  if (detailOut && detailSz > 0) detailOut[0] = 0;
  if (!sig) return false;

  uint8_t cmd = 's';
  uint8_t hist[3] = {0};
  uint8_t histCount = 0;
  uint8_t firstNoise = 0;
  uint8_t lastNoise = 0;
  uint16_t noiseCount = 0;
  uint32_t startMs = millis();

  ATMEGA.write(&cmd, 1);
  avr109FlushTx();

  while ((uint32_t)(millis() - startMs) <= timeoutMs) {
    while (ATMEGA.available()) {
      int v = ATMEGA.read();
      if (v < 0) break;

      uint8_t b = (uint8_t)v;
      if (histCount < sizeof(hist)) {
        hist[histCount++] = b;
      } else {
        hist[0] = hist[1];
        hist[1] = hist[2];
        hist[2] = b;
      }

      if (histCount >= 3 && hist[0] == 0x1E && hist[1] == 0x97 && hist[2] == 0x02) {
        sig[0] = hist[0];
        sig[1] = hist[1];
        sig[2] = hist[2];
        if (detailOut && detailSz > 0) {
          snprintf(detailOut,
                   detailSz,
                   "sig=%02X%02X%02X_%lums_noise_%u",
                   (unsigned)sig[0],
                   (unsigned)sig[1],
                   (unsigned)sig[2],
                   (unsigned long)(millis() - startMs),
                   (unsigned)noiseCount);
        }
        return true;
      }

      if (noiseCount == 0) firstNoise = b;
      lastNoise = b;
      noiseCount++;
    }
    delay(1);
  }

  if (detailOut && detailSz > 0) {
    if (noiseCount == 0) {
      snprintf(detailOut, detailSz, "timeout");
    } else {
      snprintf(detailOut,
               detailSz,
               "timeout_noise_%u_%02X_%02X",
               (unsigned)noiseCount,
               (unsigned)firstNoise,
               (unsigned)lastNoise);
    }
  }
  return false;
}

static bool avr109EnterProgMode() {
  uint8_t cmd = 'P';
  char detail[32];
  ATMEGA.write(&cmd, 1);
  avr109FlushTx();
  if (!atmegaReadExpectByteIgnoringNoiseDetailed('\r',
                                                 '?',
                                                 AVR109_REPLY_TIMEOUT_MS,
                                                 detail,
                                                 sizeof(detail))) {
    return false;
  }
  avr109InterCmdDelay();
  return true;
}

static bool avr109LeaveProgMode() {
  uint8_t cmd = 'L';
  char detail[32];
  ATMEGA.write(&cmd, 1);
  avr109FlushTx();
  if (!atmegaReadExpectByteIgnoringNoiseDetailed('\r',
                                                 '?',
                                                 AVR109_REPLY_TIMEOUT_MS,
                                                 detail,
                                                 sizeof(detail))) {
    return false;
  }
  avr109InterCmdDelay();
  return true;
}

static bool avr109ExitToApp() {
  uint8_t cmd = 'E';
  ATMEGA.write(&cmd, 1);
  avr109FlushTx();
  // The bootloader jumps to the application immediately after ACKing 'E'.
  // Treat this as fire-and-forget so a missed CR does not trigger an unnecessary reset.
  delay(20);
  atmegaDrainRx();
  return true;
}

static bool avr109ChipEraseDetailed(char* detailOut, size_t detailSz) {
  if (detailOut && detailSz > 0) detailOut[0] = 0;
  uint8_t cmd = 'e';
  ATMEGA.write(&cmd, 1);
  avr109FlushTx();
  return atmegaReadExpectByteTolerantDetailed('\r', AVR109_ERASE_TIMEOUT_MS, detailOut, detailSz);
}

static bool avr109ReadProgrammerId(char* out, size_t outSz) {
  if (!out || outSz < 8) return false;

  uint8_t cmd = 'S';
  uint8_t reply[7] = {0};
  out[0] = 0;
  ATMEGA.write(&cmd, 1);
  avr109FlushTx();
  if (!atmegaReadExact(reply, sizeof(reply), AVR109_REPLY_TIMEOUT_MS)) return false;
  memcpy(out, reply, sizeof(reply));
  out[7] = 0;
  avr109InterCmdDelay();
  return true;
}

static bool avr109ReadLockBits(uint8_t& lockBitsOut) {
  uint8_t cmd = 'r';
  lockBitsOut = 0xFF;
  ATMEGA.write(&cmd, 1);
  avr109FlushTx();
  if (!atmegaReadExact(&lockBitsOut, 1, AVR109_REPLY_TIMEOUT_MS)) return false;
  avr109InterCmdDelay();
  return true;
}

static bool avr109QueryBlockSize(uint16_t& blockSizeOut) {
  uint8_t cmd = 'b';
  uint8_t reply[3] = {0};
  blockSizeOut = AVR109_BLOCK_CAP;
  ATMEGA.write(&cmd, 1);
  avr109FlushTx();
  if (!atmegaReadExact(reply, sizeof(reply), AVR109_REPLY_TIMEOUT_MS)) return false;
  if (reply[0] != 'Y') return false;

  uint16_t remoteSize = (uint16_t)(((uint16_t)reply[1] << 8) | reply[2]);
  if (remoteSize == 0) return false;
  if (remoteSize > AVR109_BLOCK_CAP) remoteSize = AVR109_BLOCK_CAP;
  blockSizeOut = remoteSize;
  avr109InterCmdDelay();
  return true;
}

static bool avr109SetWordAddressDetailed(uint16_t wordAddr, char* detailOut, size_t detailSz) {
  if (detailOut && detailSz > 0) detailOut[0] = 0;

  uint8_t cmd[3];
  cmd[0] = 'A';
  cmd[1] = (uint8_t)(wordAddr >> 8);
  cmd[2] = (uint8_t)(wordAddr & 0xFF);
  ATMEGA.write(cmd, sizeof(cmd));
  avr109FlushTx();
  if (!atmegaReadExpectByteIgnoringNoiseDetailed('\r',
                                                 '?',
                                                 AVR109_REPLY_TIMEOUT_MS,
                                                 detailOut,
                                                 detailSz)) {
    return false;
  }
  avr109InterCmdDelay();
  return true;
}

static bool avr109BlockLoadFlashDetailed(const uint8_t* data,
                                         uint16_t len,
                                         char* detailOut,
                                         size_t detailSz) {
  if (detailOut && detailSz > 0) detailOut[0] = 0;
  if (!data || len == 0) {
    if (detailOut && detailSz > 0) snprintf(detailOut, detailSz, "invalid_len");
    return false;
  }

  uint8_t hdr[4];
  hdr[0] = 'B';
  hdr[1] = (uint8_t)(len >> 8);
  hdr[2] = (uint8_t)(len & 0xFF);
  hdr[3] = 'F';
  uint32_t gapUs = avr109BlockTxGapUs();
  atmegaWritePaced(hdr, sizeof(hdr), gapUs);
  atmegaWritePaced(data, len, gapUs);
  avr109FlushTx();
  if (!atmegaReadExpectByteIgnoringNoiseDetailed('\r',
                                                 '?',
                                                 AVR109_BLOCK_REPLY_TIMEOUT_MS,
                                                 detailOut,
                                                 detailSz)) {
    return false;
  }
  avr109InterCmdDelay();
  return true;
}

static bool avr109BlockReadFlashDetailed(uint8_t* out,
                                         uint16_t len,
                                         char* detailOut,
                                         size_t detailSz) {
  if (detailOut && detailSz > 0) detailOut[0] = 0;
  if (!out || len == 0) {
    if (detailOut && detailSz > 0) snprintf(detailOut, detailSz, "invalid_len");
    return false;
  }

  uint8_t hdr[4];
  hdr[0] = 'g';
  hdr[1] = (uint8_t)(len >> 8);
  hdr[2] = (uint8_t)(len & 0xFF);
  hdr[3] = 'F';
  ATMEGA.write(hdr, sizeof(hdr));
  avr109FlushTx();
  if (!atmegaReadExact(out, len, AVR109_BLOCK_REPLY_TIMEOUT_MS)) {
    if (detailOut && detailSz > 0) snprintf(detailOut, detailSz, "timeout");
    return false;
  }
  if (detailOut && detailSz > 0) snprintf(detailOut, detailSz, "ok");
  avr109InterCmdDelay();
  return true;
}

static uint16_t avr109HostFlashChunkCap(uint16_t remoteCap) {
  uint16_t cap = remoteCap;
  if (cap == 0 || cap > AVR109_BLOCK_CAP) cap = AVR109_BLOCK_CAP;
  if (cap > g_avr109StreamBlockCap) cap = g_avr109StreamBlockCap;
  return cap;
}

static bool bootloaderHandshake(char* detailOut, size_t detailSz, uint16_t* blockSizeOut) {
  if (detailOut && detailSz > 0) detailOut[0] = 0;
  if (blockSizeOut) *blockSizeOut = AVR109_BLOCK_CAP;

  atmegaDrainRx();
  atmegaResetPulse(RESET_PULSE_MS);
  delay(avr109ProbeSendDelayMs());

  uint8_t sig[3] = {0};
  char sigDetail[48];
  if (!avr109ReadSignatureTolerantDetailed(sig,
                                           AVR109_SIGNATURE_TIMEOUT_MS,
                                           sigDetail,
                                           sizeof(sigDetail))) {
    if (detailOut && detailSz > 0) {
      snprintf(detailOut,
               detailSz,
               "bootloader_signature_timeout_%s",
               sigDetail[0] ? sigDetail : "unknown");
    }
    return false;
  }
  if (!avr109EnterProgMode()) {
    if (detailOut && detailSz > 0) snprintf(detailOut, detailSz, "prog_mode_enter_failed");
    return false;
  }

  uint16_t blockSize = AVR109_BLOCK_CAP;
  if (!avr109QueryBlockSize(blockSize)) {
    if (detailOut && detailSz > 0) snprintf(detailOut, detailSz, "block_size_query_failed");
    return false;
  }
  if (blockSize > AVR109_HOST_BLOCK_CAP) blockSize = AVR109_HOST_BLOCK_CAP;

  char programmerId[8] = {0};
  uint8_t lockBits = 0xFF;
  bool haveProgrammerId = avr109ReadProgrammerId(programmerId, sizeof(programmerId));
  bool haveLockBits = avr109ReadLockBits(lockBits);
  if (haveProgrammerId) memcpy(g_bootloaderId, programmerId, sizeof(g_bootloaderId));
  else memset(g_bootloaderId, 0, sizeof(g_bootloaderId));

  if (blockSizeOut) *blockSizeOut = blockSize;
  if (detailOut && detailSz > 0) {
    snprintf(detailOut, detailSz, "sig=%02X%02X%02X blk=%u id=%s lock=%s%02X",
             (unsigned)sig[0],
             (unsigned)sig[1],
             (unsigned)sig[2],
             (unsigned)blockSize,
             haveProgrammerId ? programmerId : "?",
             haveLockBits ? "" : "?",
             (unsigned)lockBits);
  }
  return true;
}

static bool bootloaderHandshakeAuto(char* detailOut, size_t detailSz, uint16_t* blockSizeOut) {
  if (detailOut && detailSz > 0) detailOut[0] = 0;
  if (blockSizeOut) *blockSizeOut = AVR109_BLOCK_CAP;

  const uint32_t candidates[] = {
      ATMEGA_BOOTLOADER_BAUD,
      ATMEGA_BOOTLOADER_FALLBACK_BAUD,
      ATMEGA_BOOTLOADER_ALT_BAUD,
  };
  char lastDetail[96] = {0};

  for (size_t i = 0; i < (sizeof(candidates) / sizeof(candidates[0])); i++) {
    if (i > 0 && candidates[i] == candidates[i - 1]) continue;

    atmegaReopenUartBaud(candidates[i]);
    if (bootloaderHandshake(lastDetail, sizeof(lastDetail), blockSizeOut)) {
      if (detailOut && detailSz > 0) snprintf(detailOut, detailSz, "%s", lastDetail);
      return true;
    }

    Serial.printf("[ATOTA] boot baud miss=%lu detail=%s\n",
                  (unsigned long)candidates[i],
                  lastDetail[0] ? lastDetail : "unknown");
  }

  if (detailOut && detailSz > 0) {
    snprintf(detailOut, detailSz, "%s", lastDetail[0] ? lastDetail : "bootloader_signature_timeout");
  }
  return false;
}

static bool bootloaderHandshakeAtBaud(uint32_t baud, char* detailOut, size_t detailSz, uint16_t* blockSizeOut) {
  if (detailOut && detailSz > 0) detailOut[0] = 0;
  if (blockSizeOut) *blockSizeOut = AVR109_BLOCK_CAP;
  if (baud == 0) baud = ATMEGA_BOOTLOADER_ALT_BAUD;

  char lastDetail[96] = {0};
  for (uint8_t attempt = 0; attempt < 3; attempt++) {
    atmegaReopenUartBaud(baud);
    if (bootloaderHandshake(lastDetail, sizeof(lastDetail), blockSizeOut)) {
      if (detailOut && detailSz > 0) snprintf(detailOut, detailSz, "%s", lastDetail);
      return true;
    }
  }

  if (detailOut && detailSz > 0) snprintf(detailOut, detailSz, "%s", lastDetail[0] ? lastDetail : "bootloader_signature_timeout");
  return false;
}

static bool avr109ReadSignatureAutoDetailed(uint8_t sig[3], char* detailOut, size_t detailSz) {
  if (detailOut && detailSz > 0) detailOut[0] = 0;
  if (!sig) return false;

  const uint32_t candidates[] = {
      ATMEGA_BOOTLOADER_BAUD,
      ATMEGA_BOOTLOADER_FALLBACK_BAUD,
      ATMEGA_BOOTLOADER_ALT_BAUD,
  };

  for (size_t i = 0; i < (sizeof(candidates) / sizeof(candidates[0])); i++) {
    if (i > 0 && candidates[i] == candidates[i - 1]) continue;

    atmegaSwitchUartBaud(candidates[i]);
    atmegaDrainRx();
    atmegaResetPulse(RESET_PULSE_MS);
    delay(avr109ProbeSendDelayMs());

    char sigDetail[48];
    if (avr109ReadSignatureTolerantDetailed(sig,
                                            AVR109_SIGNATURE_TIMEOUT_MS,
                                            sigDetail,
                                            sizeof(sigDetail))) {
      if (detailOut && detailSz > 0) {
        snprintf(detailOut,
                 detailSz,
                 "sig=%02X%02X%02X baud=%lu %s",
                 (unsigned)sig[0],
                 (unsigned)sig[1],
                 (unsigned)sig[2],
                 (unsigned long)candidates[i],
                 sigDetail);
      }
      return true;
    }

    Serial.printf("[ATOTA] sig baud miss=%lu detail=%s\n",
                  (unsigned long)candidates[i],
                  sigDetail[0] ? sigDetail : "unknown");
  }

  if (detailOut && detailSz > 0) snprintf(detailOut, detailSz, "bootloader_signature_timeout");
  return false;
}

static void bootloaderCommandCleanup(bool pulseReset) {
  bool exitOk = avr109ExitToApp();
  g_bootSessionBlocks = 0;
  atmegaSwitchUartBaud(ATMEGA_APP_BAUD);
  if (pulseReset && !exitOk) atmegaResetPulse(RESET_PULSE_MS);
  if (pulseReset) delay(g_atmegaPostBlockResetSettleMs);
}

static bool bootloaderResyncForRetry(uint32_t blockStartByteAddr,
                                     uint8_t attempt,
                                     const char* reason,
                                     char* errOut,
                                     size_t errSz) {
  char bootDetail[96];
  uint16_t blockSize = AVR109_BLOCK_CAP;
  Serial.printf("[ATOTA] retry resync addr=0x%05lX attempt=%u/%u reason=%s\n",
                (unsigned long)blockStartByteAddr,
                (unsigned)attempt,
                (unsigned)AVR109_BLOCK_RETRIES,
                (reason && reason[0]) ? reason : "unknown");
  delay(AVR109_RESYNC_PRE_DELAY_MS);
  if (!bootloaderHandshakeAtBaud(ATMEGA_BOOTLOADER_BAUD, bootDetail, sizeof(bootDetail), &blockSize) &&
      !bootloaderHandshakeAuto(bootDetail, sizeof(bootDetail), &blockSize)) {
    if (errOut && errSz > 0) {
      snprintf(errOut, errSz, "retry_resync_failed_%s", bootDetail[0] ? bootDetail : "unknown");
    }
    return false;
  }
  Serial.printf("[ATOTA] retry resync ok addr=0x%05lX blk=%u detail=%s\n",
                (unsigned long)blockStartByteAddr,
                (unsigned)blockSize,
                bootDetail);
  return true;
}

static bool rolloverBootloaderSessionIfNeeded(char* errOut, size_t errSz) {
  if (errOut && errSz > 0) errOut[0] = 0;
  if (g_bootSessionBlocks < g_avr109SessionBlockCap) return true;

  char bootDetail[96];
  uint16_t blockSize = AVR109_BLOCK_CAP;
  Serial.printf("[ATOTA] session rollover blocks=%u\n", (unsigned)g_bootSessionBlocks);
  if (!bootloaderHandshakeAtBaud(ATMEGA_BOOTLOADER_BAUD, bootDetail, sizeof(bootDetail), &blockSize) &&
      !bootloaderHandshakeAuto(bootDetail, sizeof(bootDetail), &blockSize)) {
    if (errOut && errSz > 0) {
      snprintf(errOut, errSz, "session_rollover_failed_%s", bootDetail[0] ? bootDetail : "unknown");
    }
    return false;
  }

  g_bootSessionBlocks = 0;
  if (g_atmegaPostBlockResetSettleMs > 0) {
    delay(g_atmegaPostBlockResetSettleMs);
  }
  return true;
}

static int hexNibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return 10 + (c - 'a');
  if (c >= 'A' && c <= 'F') return 10 + (c - 'A');
  return -1;
}

static bool hexParseByte(const char* p, uint8_t& out) {
  int hi = hexNibble(p[0]);
  int lo = hexNibble(p[1]);
  if (hi < 0 || lo < 0) return false;
  out = (uint8_t)((hi << 4) | lo);
  return true;
}

static bool parseHexLine(const char* line, HexRecord& rec, char* errOut, size_t errSz) {
  if (errOut && errSz > 0) errOut[0] = 0;
  if (!line || line[0] != ':') {
    if (errOut && errSz > 0) snprintf(errOut, errSz, "hex_missing_colon");
    return false;
  }

  size_t lineLen = strlen(line);
  if (lineLen < 11) {
    if (errOut && errSz > 0) snprintf(errOut, errSz, "hex_line_too_short");
    return false;
  }

  uint8_t count = 0;
  uint8_t addrHi = 0;
  uint8_t addrLo = 0;
  uint8_t type = 0;
  if (!hexParseByte(&line[1], count) ||
      !hexParseByte(&line[3], addrHi) ||
      !hexParseByte(&line[5], addrLo) ||
      !hexParseByte(&line[7], type)) {
    if (errOut && errSz > 0) snprintf(errOut, errSz, "hex_header_parse_failed");
    return false;
  }

  size_t expectedChars = 1U + (size_t)(count + 5U) * 2U;
  if (lineLen < expectedChars) {
    if (errOut && errSz > 0) snprintf(errOut, errSz, "hex_line_truncated");
    return false;
  }

  uint8_t sum = (uint8_t)(count + addrHi + addrLo + type);
  rec.len = count;
  rec.addr = (uint16_t)(((uint16_t)addrHi << 8) | addrLo);
  rec.type = type;

  for (uint16_t i = 0; i < count; i++) {
    uint8_t v = 0;
    if (!hexParseByte(&line[9 + i * 2], v)) {
      if (errOut && errSz > 0) snprintf(errOut, errSz, "hex_data_parse_failed");
      return false;
    }
    rec.data[i] = v;
    sum = (uint8_t)(sum + v);
  }

  uint8_t check = 0;
  if (!hexParseByte(&line[9 + count * 2], check)) {
    if (errOut && errSz > 0) snprintf(errOut, errSz, "hex_checksum_parse_failed");
    return false;
  }
  sum = (uint8_t)(sum + check);
  if (sum != 0) {
    if (errOut && errSz > 0) snprintf(errOut, errSz, "hex_checksum_mismatch");
    return false;
  }

  return true;
}

static bool flushFlashBlock(uint32_t blockStartByteAddr,
                            const uint8_t* blockData,
                            size_t blockLen,
                            char* errOut,
                            size_t errSz) {
  if (errOut && errSz > 0) errOut[0] = 0;
  if (!blockData || blockLen == 0) return true;
  if (blockStartByteAddr & 1U) {
    if (errOut && errSz > 0) snprintf(errOut, errSz, "flash_addr_not_even");
    return false;
  }

  uint8_t tmp[AVR109_BLOCK_CAP + 1];
  size_t writeLen = blockLen;
  if (writeLen > sizeof(tmp)) {
    if (errOut && errSz > 0) snprintf(errOut, errSz, "flash_block_too_large");
    return false;
  }
  memcpy(tmp, blockData, writeLen);
  if (writeLen & 1U) {
    tmp[writeLen++] = 0xFF;
  }

  uint32_t sessionBaud = ATMEGA_BOOTLOADER_ALT_BAUD;
  char bootDetail[96];
  uint16_t blockSize = AVR109_BLOCK_CAP;
  if (!bootloaderHandshakeAtBaud(sessionBaud, bootDetail, sizeof(bootDetail), &blockSize)) {
    if (errOut && errSz > 0) {
      snprintf(errOut, errSz, "block_session_failed_%s", bootDetail[0] ? bootDetail : "unknown");
    }
    return false;
  }

  uint16_t wordAddr = (uint16_t)(blockStartByteAddr >> 1);
  char avr109Detail[32];
  for (uint8_t attempt = 1; attempt <= AVR109_BLOCK_RETRIES; attempt++) {
    if (!avr109SetWordAddressDetailed(wordAddr, avr109Detail, sizeof(avr109Detail))) {
      if (attempt >= AVR109_BLOCK_RETRIES) {
        if (errOut && errSz > 0) {
          snprintf(errOut, errSz, "set_address_failed_%s", avr109Detail[0] ? avr109Detail : "unknown");
        }
        return false;
      }
      delay(AVR109_RETRY_BACKOFF_MS * attempt);
      if (!bootloaderResyncForRetry(blockStartByteAddr, attempt, avr109Detail, errOut, errSz)) {
        return false;
      }
      continue;
    }

    if (avr109BlockLoadFlashDetailed(tmp, (uint16_t)writeLen, avr109Detail, sizeof(avr109Detail))) {
      break;
    }

    if (attempt >= AVR109_BLOCK_RETRIES) {
      if (errOut && errSz > 0) {
        snprintf(errOut, errSz, "block_load_failed_%s", avr109Detail[0] ? avr109Detail : "unknown");
      }
      Serial.printf("[ATOTA] block load fail addr=0x%05lX len=%u detail=%s\n",
                    (unsigned long)blockStartByteAddr,
                    (unsigned)writeLen,
                    avr109Detail[0] ? avr109Detail : "unknown");
      return false;
    }

    Serial.printf("[ATOTA] block load retry addr=0x%05lX len=%u attempt=%u/%u detail=%s\n",
                  (unsigned long)blockStartByteAddr,
                  (unsigned)writeLen,
                  (unsigned)attempt,
                  (unsigned)AVR109_BLOCK_RETRIES,
                  avr109Detail[0] ? avr109Detail : "unknown");
    delay(AVR109_RETRY_BACKOFF_MS * attempt);
    if (!bootloaderResyncForRetry(blockStartByteAddr, attempt, avr109Detail, errOut, errSz)) {
      return false;
    }
  }

  if (!avr109ExitToApp()) {
    atmegaResetPulse(RESET_PULSE_MS);
  }
  atmegaSwitchUartBaud(ATMEGA_APP_BAUD);
  delay(g_atmegaPostBlockResetSettleMs);

  g_flashBlocks++;
  g_bytesDone += (uint32_t)blockLen;
  if ((g_flashBlocks & 0x1FU) == 0U) {
    Serial.printf("[ATOTA] flash blocks=%lu bytes=%lu/%lu\n",
                  (unsigned long)g_flashBlocks,
                  (unsigned long)g_bytesDone,
                  (unsigned long)g_bytesTotal);
  }
  return true;
}

static bool flushFlashBlockCurrentSession(uint32_t blockStartByteAddr,
                                          const uint8_t* blockData,
                                          size_t blockLen,
                                          char* errOut,
                                          size_t errSz) {
  if (errOut && errSz > 0) errOut[0] = 0;
  if (!blockData || blockLen == 0) return true;
  if (blockStartByteAddr & 1U) {
    if (errOut && errSz > 0) snprintf(errOut, errSz, "flash_addr_not_even");
    return false;
  }
  if (!rolloverBootloaderSessionIfNeeded(errOut, errSz)) return false;

  uint8_t tmp[AVR109_BLOCK_CAP + 1];
  size_t writeLen = blockLen;
  if (writeLen > sizeof(tmp)) {
    if (errOut && errSz > 0) snprintf(errOut, errSz, "flash_block_too_large");
    return false;
  }
  memcpy(tmp, blockData, writeLen);
  if (writeLen & 1U) {
    tmp[writeLen++] = 0xFF;
  }

  uint16_t wordAddr = (uint16_t)(blockStartByteAddr >> 1);
  char avr109Detail[32];
  for (uint8_t attempt = 1; attempt <= AVR109_BLOCK_RETRIES; attempt++) {
    if (!avr109SetWordAddressDetailed(wordAddr, avr109Detail, sizeof(avr109Detail))) {
      if (attempt >= AVR109_BLOCK_RETRIES) {
        if (errOut && errSz > 0) {
          snprintf(errOut, errSz, "set_address_failed_%s", avr109Detail[0] ? avr109Detail : "unknown");
        }
        return false;
      }
      delay(AVR109_RETRY_BACKOFF_MS * attempt);
      if (!bootloaderResyncForRetry(blockStartByteAddr, attempt, avr109Detail, errOut, errSz)) {
        return false;
      }
      continue;
    }

    if (avr109BlockLoadFlashDetailed(tmp, (uint16_t)writeLen, avr109Detail, sizeof(avr109Detail))) {
      g_bootSessionBlocks++;
      g_flashBlocks++;
      g_bytesDone += (uint32_t)blockLen;
      if ((g_flashBlocks & 0x1FU) == 0U) {
        Serial.printf("[ATOTA] flash blocks=%lu bytes=%lu/%lu\n",
                      (unsigned long)g_flashBlocks,
                      (unsigned long)g_bytesDone,
                      (unsigned long)g_bytesTotal);
      }
      return true;
    }

    if (attempt >= AVR109_BLOCK_RETRIES) {
      if (errOut && errSz > 0) {
        snprintf(errOut, errSz, "block_load_failed_%s", avr109Detail[0] ? avr109Detail : "unknown");
      }
      Serial.printf("[ATOTA] block load fail addr=0x%05lX len=%u detail=%s\n",
                    (unsigned long)blockStartByteAddr,
                    (unsigned)writeLen,
                    avr109Detail[0] ? avr109Detail : "unknown");
      return false;
    }

    Serial.printf("[ATOTA] block load retry addr=0x%05lX len=%u attempt=%u/%u detail=%s\n",
                  (unsigned long)blockStartByteAddr,
                  (unsigned)writeLen,
                  (unsigned)attempt,
                  (unsigned)AVR109_BLOCK_RETRIES,
                  avr109Detail[0] ? avr109Detail : "unknown");
    delay(AVR109_RETRY_BACKOFF_MS * attempt);
    if (!bootloaderResyncForRetry(blockStartByteAddr, attempt, avr109Detail, errOut, errSz)) {
      return false;
    }
  }

  if (errOut && errSz > 0) snprintf(errOut, errSz, "block_load_failed_unknown");
  return false;
}

static bool programHexFile(File& file, const char* sourceLabel, char* errOut, size_t errSz) {
  if (errOut && errSz > 0) errOut[0] = 0;
  if (!file) {
    if (errOut && errSz > 0) snprintf(errOut, errSz, "hex_file_open_failed");
    return false;
  }

  char bootDetail[96];
  uint16_t blockCap = AVR109_BLOCK_CAP;
  setStatusText("entering_bootloader");
  if (!bootloaderHandshakeAuto(bootDetail, sizeof(bootDetail), &blockCap)) {
    if (errOut && errSz > 0) snprintf(errOut, errSz, "%s", bootDetail[0] ? bootDetail : "bootloader_handshake_failed");
    return false;
  }
  g_bootSessionBlocks = 0;
  blockCap = avr109HostFlashChunkCap(blockCap);
  Serial.printf("[ATOTA] bootloader ready %s\n", bootDetail);
  Serial.printf("[ATOTA] block tx gap=%lu us\n", (unsigned long)avr109BlockTxGapUs());
  Serial.printf("[ATOTA] host block cap=%u\n", (unsigned)blockCap);

  char eraseDetail[32];
  if (AVR109_SKIP_CHIP_ERASE) {
    Serial.println("[ATOTA] chip erase skipped -> page erase on write");
  } else {
    Serial.println("[ATOTA] chip erase start");
    if (!avr109ChipEraseDetailed(eraseDetail, sizeof(eraseDetail))) {
      atmegaDumpPostEraseFailureContext();
      if (errOut && errSz > 0) {
        snprintf(errOut, errSz, "chip_erase_failed_%s", eraseDetail[0] ? eraseDetail : "unknown");
      }
      return false;
    }
    Serial.println("[ATOTA] chip erase ok");
  }

  setStatusText("flashing");
  g_bytesDone = 0;
  g_flashBlocks = 0;
  g_bytesTotal = (uint32_t)file.size();

  uint8_t blockBuf[AVR109_BLOCK_CAP];
  uint32_t blockStart = 0;
  size_t blockLen = 0;
  uint32_t baseAddr = 0;
  bool eofSeen = false;
  char lineBuf[620];
  HexRecord rec;
  uint32_t lineNo = 0;
  uint32_t lastLineMs = millis();

  while (file.available()) {
    size_t rawLen = file.readBytesUntil('\n', lineBuf, sizeof(lineBuf) - 1U);
    if (rawLen == 0 && !file.available()) break;
    lineBuf[rawLen] = 0;
    while (rawLen > 0 && (lineBuf[rawLen - 1] == '\r' || lineBuf[rawLen - 1] == '\n')) {
      lineBuf[--rawLen] = 0;
    }
    if (rawLen == 0) continue;
    if ((uint32_t)(millis() - lastLineMs) > HEX_LINE_TIMEOUT_MS) {
      if (errOut && errSz > 0) snprintf(errOut, errSz, "hex_line_timeout");
      return false;
    }
    lastLineMs = millis();
    lineNo++;

    char parseErr[48];
    if (!parseHexLine(lineBuf, rec, parseErr, sizeof(parseErr))) {
      if (errOut && errSz > 0) snprintf(errOut, errSz, "%s@line%lu", parseErr, (unsigned long)lineNo);
      return false;
    }

    if (rec.type == 0x00) {
      uint32_t absAddr = baseAddr + rec.addr;
      size_t offset = 0;
      while (offset < rec.len) {
        if (blockLen == 0) {
          blockStart = absAddr;
        } else if (absAddr != (blockStart + blockLen) || blockLen >= blockCap) {
          if (!flushFlashBlockCurrentSession(blockStart, blockBuf, blockLen, errOut, errSz)) return false;
          blockLen = 0;
          blockStart = absAddr;
        }

        size_t room = blockCap - blockLen;
        size_t chunk = (size_t)(rec.len - offset);
        if (chunk > room) chunk = room;
        memcpy(&blockBuf[blockLen], &rec.data[offset], chunk);
        blockLen += chunk;
        absAddr += chunk;
        offset += chunk;
      }
    } else if (rec.type == 0x01) {
      eofSeen = true;
      break;
    } else if (rec.type == 0x04) {
      if (blockLen > 0) {
        if (!flushFlashBlockCurrentSession(blockStart, blockBuf, blockLen, errOut, errSz)) return false;
        blockLen = 0;
      }
      if (rec.len != 2) {
        if (errOut && errSz > 0) snprintf(errOut, errSz, "ela_len_invalid@line%lu", (unsigned long)lineNo);
        return false;
      }
      baseAddr = (uint32_t)((((uint32_t)rec.data[0] << 8) | rec.data[1]) << 16);
    } else if (rec.type == 0x02) {
      if (blockLen > 0) {
        if (!flushFlashBlockCurrentSession(blockStart, blockBuf, blockLen, errOut, errSz)) return false;
        blockLen = 0;
      }
      if (rec.len != 2) {
        if (errOut && errSz > 0) snprintf(errOut, errSz, "esa_len_invalid@line%lu", (unsigned long)lineNo);
        return false;
      }
      baseAddr = (uint32_t)((((uint32_t)rec.data[0] << 8) | rec.data[1]) << 4);
    } else if (rec.type == 0x03 || rec.type == 0x05) {
      continue;
    } else {
      if (errOut && errSz > 0) snprintf(errOut, errSz, "hex_record_type_%02X@line%lu", (unsigned)rec.type, (unsigned long)lineNo);
      return false;
    }
  }

  if (blockLen > 0) {
    if (!flushFlashBlockCurrentSession(blockStart, blockBuf, blockLen, errOut, errSz)) return false;
  }

  if (!eofSeen) {
    if (errOut && errSz > 0) snprintf(errOut, errSz, "hex_missing_eof");
    return false;
  }

  setStatusText("rebooting_target");
  if (!avr109ExitToApp()) {
    atmegaSwitchUartBaud(ATMEGA_APP_BAUD);
    atmegaResetPulse(RESET_PULSE_MS);
  } else {
    atmegaSwitchUartBaud(ATMEGA_APP_BAUD);
  }
  delay(g_atmegaPostBlockResetSettleMs);
  Serial.printf("[ATOTA] flash done source=%s blocks=%lu bytes=%lu\n",
                (sourceLabel && sourceLabel[0]) ? sourceLabel : "-",
                (unsigned long)g_flashBlocks,
                (unsigned long)g_bytesDone);
  return true;
}

static bool sdBeginCheckedAtFreq(uint32_t freqHz) {
  if (freqHz == 0) return false;
  if (!SD.begin(SD_SPI_CS_PIN, SPI, freqHz)) return false;
  if (SD.cardType() == CARD_NONE) {
    SD.end();
    return false;
  }
  return true;
}

static bool sdProbeAndMount(bool forceRemount) {
  static const uint32_t kFreqCandidates[] = {SD_SPI_FREQ_HZ, 400000U, 2000000U};
  static bool s_sdPowerSettled = false;

  if (!s_sdPowerSettled) {
    delay(SD_POWERUP_SETTLE_MS);
    s_sdPowerSettled = true;
  }

  for (uint8_t attempt = 0; attempt < SD_MOUNT_RETRIES; attempt++) {
    if (forceRemount || attempt > 0) {
      SD.end();
      delay(2);
      SPI.end();
      delay(2);
    }

    pinMode(SD_SPI_CS_PIN, OUTPUT);
    digitalWrite(SD_SPI_CS_PIN, HIGH);
    SPI.begin(SD_SPI_SCK_PIN, SD_SPI_MISO_PIN, SD_SPI_MOSI_PIN, SD_SPI_CS_PIN);

    for (size_t i = 0; i < (sizeof(kFreqCandidates) / sizeof(kFreqCandidates[0])); i++) {
      if (sdBeginCheckedAtFreq(kFreqCandidates[i])) {
        if (attempt > 0 || kFreqCandidates[i] != SD_SPI_FREQ_HZ) {
          Serial.printf("[SD] mount ok attempt=%u freq=%lu Hz\n",
                        (unsigned)(attempt + 1U),
                        (unsigned long)kFreqCandidates[i]);
        }
        return true;
      }
    }

    if ((attempt + 1U) < SD_MOUNT_RETRIES) {
      delay(SD_MOUNT_RETRY_DELAY_MS);
    }
  }
  return false;
}

static void printSdStatus() {
  if (!sdProbeAndMount(false) && !sdProbeAndMount(true)) {
    Serial.println("[SD] not ready");
    return;
  }

  uint8_t cardType = SD.cardType();
  const char* cardTypeLabel = "unknown";
  if (cardType == CARD_MMC) cardTypeLabel = "MMC";
  else if (cardType == CARD_SD) cardTypeLabel = "SDSC";
  else if (cardType == CARD_SDHC) cardTypeLabel = "SDHC/SDXC";

  uint64_t totalMB = SD.cardSize() / (1024ULL * 1024ULL);
  uint64_t usedMB = SD.usedBytes() / (1024ULL * 1024ULL);
  uint64_t freeMB = (totalMB > usedMB) ? (totalMB - usedMB) : 0;

  Serial.printf("[SD] type=%s total=%lluMB used=%lluMB free=%lluMB\n",
                cardTypeLabel,
                (unsigned long long)totalMB,
                (unsigned long long)usedMB,
                (unsigned long long)freeMB);
}

static bool flashFromFilePath(const char* path, char* errOut, size_t errSz) {
  if (errOut && errSz > 0) errOut[0] = 0;
  if (!path || !path[0]) path = SD_DEFAULT_HEX_PATH;

  if (!sdProbeAndMount(false) && !sdProbeAndMount(true)) {
    if (errOut && errSz > 0) snprintf(errOut, errSz, "sd_not_ready");
    return false;
  }
  if (!SD.exists(path)) {
    if (errOut && errSz > 0) snprintf(errOut, errSz, "file_not_found");
    return false;
  }

  File file = SD.open(path, FILE_READ);
  if (!file) {
    if (errOut && errSz > 0) snprintf(errOut, errSz, "file_open_failed");
    return false;
  }

  g_otaActive = true;
  snprintf(g_sourceText, sizeof(g_sourceText), "%s", path);
  Serial.printf("[ATOTA] open file path=%s size=%llu\n", path, (unsigned long long)file.size());
  Serial.println("[ATOTA] switching host uart -> boot baud");
  atmegaSwitchUartBaud(ATMEGA_BOOTLOADER_BAUD);

  bool ok = programHexFile(file, path, errOut, errSz);
  file.close();

  Serial.println("[ATOTA] switching host uart -> app baud");
  atmegaSwitchUartBaud(ATMEGA_APP_BAUD);
  if (!ok && g_flashBlocks == 0) {
    Serial.println("[ATOTA] ota failed before flash commit -> reset target back to app");
    atmegaResetPulse(RESET_PULSE_MS);
  }
  g_otaActive = false;
  setStatusText(ok ? "flash_complete" : ((errOut && errOut[0]) ? errOut : "flash_failed"));
  return ok;
}

static void usbHexResetState() {
  g_usbHexBlockStart = 0;
  g_usbHexBlockLen = 0;
  g_usbHexBaseAddr = 0;
  g_usbHexLineNo = 0;
  g_usbHexBootSessionOpen = false;
  g_atmegaFlashChunkCap = g_avr109StreamBlockCap;
  g_bytesDone = 0;
  g_bytesTotal = 0;
  g_flashBlocks = 0;
}

static void usbHexFinish(bool ok, const char* reason) {
  g_usbHexActive = false;
  g_otaActive = false;
  g_bootSessionBlocks = 0;
  if (g_usbHexBootSessionOpen) {
    if (!avr109ExitToApp()) {
      atmegaResetPulse(RESET_PULSE_MS);
    }
    g_usbHexBootSessionOpen = false;
  }
  atmegaSwitchUartBaud(ATMEGA_APP_BAUD);
  setStatusText(ok ? "flash_complete" : ((reason && reason[0]) ? reason : "flash_failed"));
  Serial.printf("[FLASHUSB] result=%s reason=%s blocks=%lu bytes=%lu/%lu\n",
                ok ? "ok" : "fail",
                (reason && reason[0]) ? reason : "-",
                (unsigned long)g_flashBlocks,
                (unsigned long)g_bytesDone,
                (unsigned long)g_bytesTotal);
}

static void usbBlockFinish(bool ok, const char* reason) {
  g_usbBlockActive = false;
  g_otaActive = false;
  g_bootSessionBlocks = 0;
  if (g_usbHexBootSessionOpen) {
    if (!avr109ExitToApp()) {
      atmegaResetPulse(RESET_PULSE_MS);
    }
    g_usbHexBootSessionOpen = false;
  }
  atmegaSwitchUartBaud(ATMEGA_APP_BAUD);
  setStatusText(ok ? "flash_complete" : ((reason && reason[0]) ? reason : "flash_failed"));
  Serial.printf("[FLASHBLK] result=%s reason=%s blocks=%lu bytes=%lu/%lu\n",
                ok ? "ok" : "fail",
                (reason && reason[0]) ? reason : "-",
                (unsigned long)g_flashBlocks,
                (unsigned long)g_bytesDone,
                (unsigned long)g_bytesTotal);
}

static void usbHexAckLine() {
  Serial.write('+');
  Serial.write('\n');
}

static bool parseUsbBlockLine(char* line,
                              uint32_t& addrOut,
                              uint8_t* dataOut,
                              size_t& lenOut,
                              size_t maxLen,
                              char* errOut,
                              size_t errSz) {
  if (errOut && errSz > 0) errOut[0] = 0;
  addrOut = 0;
  lenOut = 0;
  if (!line || line[0] != '@') {
    if (errOut && errSz > 0) snprintf(errOut, errSz, "block_prefix");
    return false;
  }

  char* sep = strchr(line + 1, '|');
  if (!sep) {
    if (errOut && errSz > 0) snprintf(errOut, errSz, "block_sep");
    return false;
  }
  *sep = 0;

  char* endPtr = nullptr;
  unsigned long addr = strtoul(line + 1, &endPtr, 16);
  if (!endPtr || *endPtr != 0) {
    if (errOut && errSz > 0) snprintf(errOut, errSz, "block_addr");
    return false;
  }

  char* hex = sep + 1;
  size_t hexLen = strlen(hex);
  if ((hexLen & 1U) != 0U) {
    if (errOut && errSz > 0) snprintf(errOut, errSz, "block_hex_len");
    return false;
  }

  size_t dataLen = hexLen / 2U;
  if (dataLen == 0 || dataLen > maxLen) {
    if (errOut && errSz > 0) snprintf(errOut, errSz, "block_len");
    return false;
  }

  for (size_t i = 0; i < dataLen; i++) {
    if (!hexParseByte(&hex[i * 2U], dataOut[i])) {
      if (errOut && errSz > 0) snprintf(errOut, errSz, "block_hex");
      return false;
    }
  }

  addrOut = (uint32_t)addr;
  lenOut = dataLen;
  return true;
}

static void handleUsbBlockLine(char* line) {
  if (!g_usbBlockActive) return;
  if (!line || !line[0]) return;

  if (strcmp(line, "!ABORT") == 0) {
    usbBlockFinish(false, "aborted");
    return;
  }
  if (strcmp(line, "!EOF") == 0) {
    usbBlockFinish(true, "eof");
    return;
  }

  uint8_t blockBuf[AVR109_BLOCK_CAP];
  uint32_t blockAddr = 0;
  size_t blockLen = 0;
  char err[96];
  if (!parseUsbBlockLine(line, blockAddr, blockBuf, blockLen, g_atmegaFlashChunkCap, err, sizeof(err))) {
    usbBlockFinish(false, err[0] ? err : "block_parse_failed");
    return;
  }

  g_bytesTotal += (uint32_t)blockLen;
  if (!flushFlashBlockCurrentSession(blockAddr, blockBuf, blockLen, err, sizeof(err))) {
    usbBlockFinish(false, err[0] ? err : "block_flash_failed");
    return;
  }

  usbHexAckLine();
}

static void handleUsbHexLine(char* line) {
  if (!g_usbHexActive) return;
  if (!line || !line[0]) return;

  if (strcmp(line, "!ABORT") == 0) {
    usbHexFinish(false, "aborted");
    return;
  }

  HexRecord rec;
  char parseErr[64];
  g_usbHexLineNo++;
  if (!parseHexLine(line, rec, parseErr, sizeof(parseErr))) {
    char err[96];
    Serial.printf("[FLASHUSB] bad line %lu: %s\n", (unsigned long)g_usbHexLineNo, line);
    snprintf(err, sizeof(err), "%s@line%lu", parseErr, (unsigned long)g_usbHexLineNo);
    usbHexFinish(false, err);
    return;
  }

  if (rec.type == 0x00) {
    uint32_t absAddr = g_usbHexBaseAddr + rec.addr;
    size_t offset = 0;
    g_bytesTotal += rec.len;
    while (offset < rec.len) {
      if (g_usbHexBlockLen == 0) {
        g_usbHexBlockStart = absAddr;
      } else if (absAddr != (g_usbHexBlockStart + g_usbHexBlockLen) || g_usbHexBlockLen >= g_atmegaFlashChunkCap) {
        char err[96];
        if (!flushFlashBlockCurrentSession(g_usbHexBlockStart, g_usbHexBlockBuf, g_usbHexBlockLen, err, sizeof(err))) {
          usbHexFinish(false, err);
          return;
        }
        g_usbHexBlockLen = 0;
        g_usbHexBlockStart = absAddr;
      }

      size_t room = g_atmegaFlashChunkCap - g_usbHexBlockLen;
      size_t chunk = (size_t)(rec.len - offset);
      if (chunk > room) chunk = room;
      memcpy(&g_usbHexBlockBuf[g_usbHexBlockLen], &rec.data[offset], chunk);
      g_usbHexBlockLen += chunk;
      absAddr += chunk;
      offset += chunk;
    }
    usbHexAckLine();
    return;
  }

  if (rec.type == 0x01) {
    if (g_usbHexBlockLen > 0) {
      char err[96];
      if (!flushFlashBlockCurrentSession(g_usbHexBlockStart, g_usbHexBlockBuf, g_usbHexBlockLen, err, sizeof(err))) {
        usbHexFinish(false, err);
        return;
      }
      g_usbHexBlockLen = 0;
    }
    usbHexFinish(true, "eof");
    return;
  }

  if (rec.type == 0x04) {
    if (g_usbHexBlockLen > 0) {
      char err[96];
      if (!flushFlashBlockCurrentSession(g_usbHexBlockStart, g_usbHexBlockBuf, g_usbHexBlockLen, err, sizeof(err))) {
        usbHexFinish(false, err);
        return;
      }
      g_usbHexBlockLen = 0;
    }
    if (rec.len != 2) {
      usbHexFinish(false, "ela_len_invalid");
      return;
    }
    g_usbHexBaseAddr = (uint32_t)((((uint32_t)rec.data[0] << 8) | rec.data[1]) << 16);
    usbHexAckLine();
    return;
  }

  if (rec.type == 0x02) {
    if (g_usbHexBlockLen > 0) {
      char err[96];
      if (!flushFlashBlockCurrentSession(g_usbHexBlockStart, g_usbHexBlockBuf, g_usbHexBlockLen, err, sizeof(err))) {
        usbHexFinish(false, err);
        return;
      }
      g_usbHexBlockLen = 0;
    }
    if (rec.len != 2) {
      usbHexFinish(false, "esa_len_invalid");
      return;
    }
    g_usbHexBaseAddr = (uint32_t)((((uint32_t)rec.data[0] << 8) | rec.data[1]) << 4);
    usbHexAckLine();
    return;
  }

  if (rec.type == 0x03 || rec.type == 0x05) {
    usbHexAckLine();
    return;
  }

  char err[96];
  snprintf(err, sizeof(err), "hex_record_type_%02X@line%lu",
           (unsigned)rec.type,
           (unsigned long)g_usbHexLineNo);
  usbHexFinish(false, err);
}

static void printHexBytes(const uint8_t* data, size_t len) {
  for (size_t i = 0; i < len; i++) {
    if (i != 0) Serial.print(' ');
    Serial.printf("%02X", (unsigned)data[i]);
  }
}

static bool parseHexByteToken(const char* txt, uint8_t& out) {
  if (!txt || !txt[0]) return false;
  char* endPtr = nullptr;
  unsigned long v = strtoul(txt, &endPtr, 16);
  if (!endPtr || endPtr == txt || *endPtr != 0 || v > 0xFFUL) return false;
  out = (uint8_t)v;
  return true;
}

static bool parseUint32Token(const char* txt, uint32_t& out) {
  if (!txt || !txt[0]) return false;
  char* endPtr = nullptr;
  unsigned long v = strtoul(txt, &endPtr, 0);
  if (!endPtr || endPtr == txt || *endPtr != 0) return false;
  out = (uint32_t)v;
  return true;
}

static bool parseBaudToken(const char* txt, uint32_t& baudOut) {
  if (!txt || !txt[0]) return false;

  if (strcasecmp(txt, "app") == 0) {
    baudOut = ATMEGA_APP_BAUD;
    return true;
  }
  if (strcasecmp(txt, "fast") == 0 || strcasecmp(txt, "bootfast") == 0) {
    baudOut = ATMEGA_BOOTLOADER_BAUD;
    return true;
  }
  if (strcasecmp(txt, "boot") == 0) {
    baudOut = ATMEGA_BOOTLOADER_FALLBACK_BAUD;
    return true;
  }
  if (strcasecmp(txt, "alt") == 0 || strcasecmp(txt, "bootalt") == 0) {
    baudOut = ATMEGA_BOOTLOADER_ALT_BAUD;
    return true;
  }

  return parseUint32Token(txt, baudOut);
}

static bool atmegaWaitForAsciiLine(char* out, size_t outSz, uint32_t timeoutMs) {
  if (!out || outSz == 0) return false;
  out[0] = 0;

  size_t len = 0;
  uint32_t startMs = millis();
  uint32_t lastByteMs = startMs;

  while ((uint32_t)(millis() - startMs) <= timeoutMs) {
    while (ATMEGA.available()) {
      int v = ATMEGA.read();
      if (v < 0) break;

      uint8_t b = (uint8_t)v;
      lastByteMs = millis();

      if (b == '\r') continue;
      if (b == '\n') {
        if (len == 0) continue;
        out[len] = 0;
        return true;
      }

      if (b < 0x20 || b > 0x7E) {
        len = 0;
        continue;
      }

      if (len + 1 < outSz) {
        out[len++] = (char)b;
      } else {
        len = 0;
      }
    }

    if ((uint32_t)(millis() - lastByteMs) > timeoutMs) break;
    delay(1);
  }

  out[0] = 0;
  return false;
}

static void handlePingCommand() {
  char line[64];
  static const char kPing[] = "ping\r\n";

  atmegaSwitchUartBaud(ATMEGA_APP_BAUD);
  atmegaDrainRx();
  ATMEGA.write((const uint8_t*)kPing, sizeof(kPing) - 1U);
  ATMEGA.flush();

  if (!atmegaWaitForAsciiLine(line, sizeof(line), APP_PING_TIMEOUT_MS)) {
    Serial.printf("[PING] FAIL baud=%lu timeout\n", (unsigned long)g_atmegaCurrentBaud);
    return;
  }

  if (strcasecmp(line, "pong") != 0) {
    Serial.printf("[PING] FAIL baud=%lu reply=%s\n",
                  (unsigned long)g_atmegaCurrentBaud,
                  line);
    return;
  }

  Serial.printf("[PING] OK baud=%lu reply=%s\n",
                (unsigned long)g_atmegaCurrentBaud,
                line);
}

static void handleBaudCommand(char* args) {
  uint32_t baud = 0;
  if (!args || !args[0] || !parseBaudToken(args, baud) || baud == 0) {
    Serial.println("[BAUD] usage: baud app|fast|boot|alt|<rate>");
    return;
  }

  atmegaSwitchUartBaud(baud);
  Serial.printf("[BAUD] current=%lu\n", (unsigned long)g_atmegaCurrentBaud);
}

static void printPerfSettings() {
  Serial.printf("[PERF] gap_us=%lu inter_ms=%lu settle_ms=%lu session_cap=%u chunk_cap=%u active_chunk=%u\n",
                (unsigned long)g_avr109PatchedBlockTxGapUs,
                (unsigned long)g_avr109InterCmdGapMs,
                (unsigned long)g_atmegaPostBlockResetSettleMs,
                (unsigned)g_avr109SessionBlockCap,
                (unsigned)g_avr109StreamBlockCap,
                (unsigned)g_atmegaFlashChunkCap);
}

static void handlePerfCommand(char* args) {
  if (!args || !args[0]) {
    printPerfSettings();
    return;
  }

  char* savePtr = nullptr;
  char* key = strtok_r(args, " ", &savePtr);
  char* valueTxt = strtok_r(nullptr, " ", &savePtr);
  char* extraTxt = strtok_r(nullptr, " ", &savePtr);

  if (!key || extraTxt) {
    Serial.println("[PERF] usage: perf | perf reset | perf gap|inter|settle|session|chunk <value>");
    return;
  }

  if (strcasecmp(key, "reset") == 0) {
    g_avr109PatchedBlockTxGapUs = AVR109_PATCHED_BLOCK_TX_GAP_US;
    g_avr109InterCmdGapMs = AVR109_INTER_CMD_GAP_MS;
    g_atmegaPostBlockResetSettleMs = ATMEGA_POST_BLOCK_RESET_SETTLE_MS;
    g_avr109SessionBlockCap = AVR109_SESSION_BLOCK_CAP;
    g_avr109StreamBlockCap = AVR109_STREAM_BLOCK_CAP;
    if (!g_usbHexActive) g_atmegaFlashChunkCap = g_avr109StreamBlockCap;
    printPerfSettings();
    return;
  }

  uint32_t value = 0;
  if (!valueTxt || !parseUint32Token(valueTxt, value)) {
    Serial.println("[PERF] usage: perf gap|inter|settle|session|chunk <value>");
    return;
  }

  if (strcasecmp(key, "gap") == 0) {
    if (value > 5000UL) {
      Serial.println("[PERF] gap out of range (0..5000)");
      return;
    }
    g_avr109PatchedBlockTxGapUs = value;
    printPerfSettings();
    return;
  }

  if (strcasecmp(key, "inter") == 0) {
    if (value > 1000UL) {
      Serial.println("[PERF] inter out of range (0..1000)");
      return;
    }
    g_avr109InterCmdGapMs = value;
    printPerfSettings();
    return;
  }

  if (strcasecmp(key, "settle") == 0) {
    if (value > 5000UL) {
      Serial.println("[PERF] settle out of range (0..5000)");
      return;
    }
    g_atmegaPostBlockResetSettleMs = value;
    printPerfSettings();
    return;
  }

  if (strcasecmp(key, "session") == 0) {
    if (value < 1UL || value > 0xFFFFUL) {
      Serial.println("[PERF] session out of range (1..65535)");
      return;
    }
    g_avr109SessionBlockCap = (uint16_t)value;
    printPerfSettings();
    return;
  }

  if (strcasecmp(key, "chunk") == 0) {
    if (value < 16UL || value > AVR109_BLOCK_CAP) {
      Serial.println("[PERF] chunk out of range (16..256)");
      return;
    }
    g_avr109StreamBlockCap = (uint16_t)value;
    if (!g_usbHexActive) g_atmegaFlashChunkCap = g_avr109StreamBlockCap;
    printPerfSettings();
    return;
  }

  Serial.println("[PERF] usage: perf | perf reset | perf gap|inter|settle|session|chunk <value>");
}

static void handlePeekCommand(char* args) {
  uint32_t baud = ATMEGA_BOOTLOADER_ALT_BAUD;
  uint32_t sendDelayMs = 60;
  uint32_t rxWindowMs = 400;

  if (args && args[0]) {
    char* savePtr = nullptr;
    char* tok = strtok_r(args, " ", &savePtr);
    if (tok) {
      if (!parseBaudToken(tok, baud) || baud == 0) {
        Serial.println("[PEEK] usage: peek [app|boot|alt|<baud>] [send_delay_ms] [rx_window_ms]");
        return;
      }
      tok = strtok_r(nullptr, " ", &savePtr);
    }
    if (tok) {
      if (!parseUint32Token(tok, sendDelayMs)) {
        Serial.println("[PEEK] invalid send delay");
        return;
      }
      tok = strtok_r(nullptr, " ", &savePtr);
    }
    if (tok) {
      if (!parseUint32Token(tok, rxWindowMs)) {
        Serial.println("[PEEK] invalid rx window");
        return;
      }
    }
  }

  atmegaSwitchUartBaud(baud);
  atmegaDrainRx();
  atmegaResetPulse(RESET_PULSE_MS);
  delay(sendDelayMs);

  const uint8_t cmd = 's';
  ATMEGA.write(&cmd, 1);
  ATMEGA.flush();

  uint8_t reply[16];
  size_t got = 0;
  uint32_t startMs = millis();
  uint32_t lastByteMs = startMs;
  while ((uint32_t)(millis() - startMs) <= rxWindowMs && got < sizeof(reply)) {
    while (ATMEGA.available() && got < sizeof(reply)) {
      int v = ATMEGA.read();
      if (v < 0) break;
      reply[got++] = (uint8_t)v;
      lastByteMs = millis();
    }
    if (got > 0 && (uint32_t)(millis() - lastByteMs) > 20U) break;
    delay(1);
  }

  Serial.printf("[PEEK] baud=%lu send_delay=%lu rx_window=%lu got=%u",
                (unsigned long)baud,
                (unsigned long)sendDelayMs,
                (unsigned long)rxWindowMs,
                (unsigned)got);
  if (got > 0) {
    Serial.print(" bytes=");
    printHexBytes(reply, got);
  }
  if (got >= 3 && reply[0] == 0x1E && reply[1] == 0x97 && reply[2] == 0x02) {
    Serial.print(" sig=OK");
  }
  Serial.println();

  atmegaSwitchUartBaud(ATMEGA_APP_BAUD);
  atmegaResetPulse(RESET_PULSE_MS);
}

static void printStatus() {
  Serial.printf("[STATUS] sd_path=%s status=%s source=%s\n",
                SD_DEFAULT_HEX_PATH,
                g_statusText,
                g_sourceText[0] ? g_sourceText : "-");
  Serial.printf("[STATUS] power_pin=%d\n", MELAUHF_POWER_EN_PIN);
  Serial.printf("[STATUS] atmega_baud=%lu ota_active=%u bytes=%lu/%lu blocks=%lu tap=%s\n",
                (unsigned long)g_atmegaCurrentBaud,
                g_otaActive ? 1U : 0U,
                (unsigned long)g_bytesDone,
                (unsigned long)g_bytesTotal,
                (unsigned long)g_flashBlocks,
                g_tapEnabled ? "on" : "off");
  printPerfSettings();
  printSdStatus();
}

static void printHelp() {
  Serial.println();
  Serial.println("Commands:");
  Serial.println("  help               - show help");
  Serial.println("  status             - show SD/OTA state");
  Serial.println("  sd                 - probe SD and print status");
  Serial.println("  flash              - flash /AtmegaOta.hex from SD");
  Serial.println("  flash <sd_path>    - flash explicit HEX from SD");
  Serial.println("  flashusb           - stream Intel HEX over USB serial");
  Serial.println("  flashblk           - stream @ADDR|HEX blocks over USB serial");
  Serial.println("  power on|off       - toggle ATmega power enable pin");
  Serial.println("  reset              - pulse ATmega reset");
  Serial.println("  hold               - hold ATmega in reset");
  Serial.println("  release            - release ATmega reset");
  Serial.println("  baud <mode|rate>   - set host UART: app|fast|boot|alt|<rate>");
  Serial.println("  perf [...]         - show/tune flash timing parameters");
  Serial.println("  ping               - send app ping and wait for pong");
  Serial.println("  peek [...]         - reset, send AVR109 's', dump raw reply");
  Serial.println("  tap on|off         - raw UART tap");
  Serial.println("  drain              - clear bytes waiting from ATmega");
  Serial.println("  sig                - send AVR109 's'");
  Serial.println("  probe              - reset and probe bootloader");
  Serial.println("  erase              - handshake + chip erase only");
  Serial.println("  prog               - send AVR109 'P'");
  Serial.println("  leave              - send AVR109 'L'");
  Serial.println("  block              - query AVR109 block size");
  Serial.println("  id                 - read AVR109 programmer id");
  Serial.println("  lock               - read lock bits");
  Serial.println("  handshake          - probe + prog + block + id + lock");
  Serial.println("  writetest [len]    - write/read test at high flash address");
  Serial.println("  writetestaddr a l  - write/read test at explicit byte address");
  Serial.println("  writeseq a b l     - write/read contiguous blocks in one session");
  Serial.println("  loadseq a b l      - load contiguous blocks without readback");
  Serial.println("  send <hex...>      - send raw UART bytes");
  Serial.println();
}

static void handleSendCommand(char* args) {
  if (!args || !args[0]) {
    Serial.println("[SEND] usage: send <hex...>");
    return;
  }

  uint8_t bytes[32];
  size_t count = 0;
  char* savePtr = nullptr;
  char* tok = strtok_r(args, " ", &savePtr);
  while (tok) {
    if (count >= sizeof(bytes)) {
      Serial.println("[SEND] too many bytes (max 32)");
      return;
    }
    if (!parseHexByteToken(tok, bytes[count])) {
      Serial.printf("[SEND] invalid hex byte: %s\n", tok);
      return;
    }
    count++;
    tok = strtok_r(nullptr, " ", &savePtr);
  }

  if (count == 0) {
    Serial.println("[SEND] usage: send <hex...>");
    return;
  }

  ATMEGA.write(bytes, count);
  ATMEGA.flush();
  Serial.print("[SEND] tx: ");
  printHexBytes(bytes, count);
  Serial.println();
}

static void handleHandshakeCommand() {
  char detail[96];
  uint16_t blockSize = 0;
  if (!bootloaderHandshakeAuto(detail, sizeof(detail), &blockSize)) {
    Serial.printf("[HANDSHAKE] FAIL: %s\n", detail);
    atmegaSwitchUartBaud(ATMEGA_APP_BAUD);
    return;
  }
  Serial.printf("[HANDSHAKE] %s\n", detail);
  bootloaderCommandCleanup(true);
}

static void printWriteTestBytes(const uint8_t* data, uint16_t len) {
  for (uint16_t i = 0; i < len; i++) {
    if (i != 0) Serial.print(' ');
    Serial.printf("%02X", (unsigned)data[i]);
  }
}

static void runWriteTestAtAddr(uint32_t byteAddr, uint16_t len) {
  if (len == 0 || len > AVR109_HOST_BLOCK_CAP) {
    Serial.printf("[WTEST] invalid len=%u (max=%u)\n",
                  (unsigned)len,
                  (unsigned)AVR109_HOST_BLOCK_CAP);
    return;
  }
  if ((byteAddr & 1UL) != 0UL) {
    Serial.printf("[WTEST] invalid addr=0x%05lX (must be even)\n", (unsigned long)byteAddr);
    return;
  }

  uint8_t tx[AVR109_HOST_BLOCK_CAP];
  uint8_t rx[AVR109_HOST_BLOCK_CAP];
  for (uint16_t i = 0; i < len; i++) {
    tx[i] = (uint8_t)(0xA0U + i);
    rx[i] = 0;
  }

  uint16_t wordAddr = (uint16_t)(byteAddr >> 1);
  char detail[32];
  if (!avr109SetWordAddressDetailed(wordAddr, detail, sizeof(detail))) {
    Serial.printf("[WTEST] addr=0x%05lX len=%u setaddr_fail %s\n",
                  (unsigned long)byteAddr,
                  (unsigned)len,
                  detail[0] ? detail : "unknown");
    return;
  }

  if (!avr109BlockLoadFlashDetailed(tx, len, detail, sizeof(detail))) {
    Serial.printf("[WTEST] addr=0x%05lX len=%u load_fail %s tx=",
                  (unsigned long)byteAddr,
                  (unsigned)len,
                  detail[0] ? detail : "unknown");
    printWriteTestBytes(tx, len);
    Serial.println();
    return;
  }

  if (!avr109SetWordAddressDetailed(wordAddr, detail, sizeof(detail))) {
    Serial.printf("[WTEST] addr=0x%05lX len=%u setaddr_read_fail %s\n",
                  (unsigned long)byteAddr,
                  (unsigned)len,
                  detail[0] ? detail : "unknown");
    return;
  }

  if (!avr109BlockReadFlashDetailed(rx, len, detail, sizeof(detail))) {
    Serial.printf("[WTEST] addr=0x%05lX len=%u read_fail %s\n",
                  (unsigned long)byteAddr,
                  (unsigned)len,
                  detail[0] ? detail : "unknown");
    return;
  }

  bool match = (memcmp(tx, rx, len) == 0);
  Serial.printf("[WTEST] addr=0x%05lX len=%u %s rx=",
                (unsigned long)byteAddr,
                (unsigned)len,
                match ? "ok" : "mismatch");
  printWriteTestBytes(rx, len);
  Serial.println();
}

static void runWriteTestLen(uint16_t len) {
  runWriteTestAtAddr(AVR109_TEST_BYTE_ADDR, len);
}

static bool isSafeFlashTestRange(uint32_t byteAddr, uint32_t len) {
  if (len == 0) return false;
  if (byteAddr < AVR109_TEST_BYTE_ADDR) return false;
  uint32_t endAddr = byteAddr + len - 1UL;
  if (endAddr < byteAddr) return false;
  return endAddr <= AVR109_APP_LAST_BYTE;
}

static bool allowFlashTestRange(const char* tag,
                                uint32_t byteAddr,
                                uint32_t len,
                                bool forceUnsafe) {
  if (forceUnsafe) return true;
  if (isSafeFlashTestRange(byteAddr, len)) return true;

  Serial.printf("[%s] reject unsafe range addr=0x%05lX len=%lu; add 'force' to override\n",
                (tag && tag[0]) ? tag : "TEST",
                (unsigned long)byteAddr,
                (unsigned long)len);
  return false;
}

static bool runLoadOnlyAtAddr(uint32_t byteAddr, uint16_t len, char* detailOut, size_t detailSz) {
  if (detailOut && detailSz > 0) detailOut[0] = 0;
  if (len == 0 || len > AVR109_HOST_BLOCK_CAP) {
    if (detailOut && detailSz > 0) snprintf(detailOut, detailSz, "invalid_len");
    return false;
  }
  if (byteAddr & 1U) {
    if (detailOut && detailSz > 0) snprintf(detailOut, detailSz, "addr_not_even");
    return false;
  }

  uint8_t tx[AVR109_HOST_BLOCK_CAP];
  for (uint16_t i = 0; i < len; i++) {
    tx[i] = (uint8_t)(0xA0U + i);
  }

  uint16_t wordAddr = (uint16_t)(byteAddr >> 1);
  if (!avr109SetWordAddressDetailed(wordAddr, detailOut, detailSz)) return false;
  if (!avr109BlockLoadFlashDetailed(tx, len, detailOut, detailSz)) return false;
  if (detailOut && detailSz > 0) snprintf(detailOut, detailSz, "ok");
  return true;
}

static void handleWriteTestCommand(char* args) {
  atmegaSwitchUartBaud(ATMEGA_BOOTLOADER_BAUD);

  char detail[96];
  uint16_t blockSize = 0;
  if (!bootloaderHandshakeAuto(detail, sizeof(detail), &blockSize)) {
    Serial.printf("[WTEST] handshake_fail %s\n", detail);
    atmegaSwitchUartBaud(ATMEGA_APP_BAUD);
    return;
  }

  Serial.printf("[WTEST] ready %s addr=0x%05lX\n",
                detail,
                (unsigned long)AVR109_TEST_BYTE_ADDR);

  if (args && args[0]) {
    char* endPtr = nullptr;
    unsigned long len = strtoul(args, &endPtr, 0);
    if (!endPtr || endPtr == args || *endPtr != 0) {
      Serial.printf("[WTEST] invalid arg: %s\n", args);
    } else {
      runWriteTestLen((uint16_t)len);
    }
  } else {
    runWriteTestLen(2);
    runWriteTestLen(16);
    runWriteTestLen(64);
    runWriteTestLen(256);
  }

  bootloaderCommandCleanup(true);
}

static void handleWriteTestAddrCommand(char* args) {
  if (!args || !args[0]) {
    Serial.println("[WTESTADDR] usage: writetestaddr <byte_addr> [len] [force]");
    return;
  }

  char* savePtr = nullptr;
  char* addrTxt = strtok_r(args, " ", &savePtr);
  char* lenTxt = strtok_r(nullptr, " ", &savePtr);
  char* modeTxt = strtok_r(nullptr, " ", &savePtr);
  char* extraTxt = strtok_r(nullptr, " ", &savePtr);
  if (!addrTxt || extraTxt ||
      (modeTxt && strcasecmp(modeTxt, "force") != 0 && strcasecmp(modeTxt, "unsafe") != 0)) {
    Serial.println("[WTESTADDR] usage: writetestaddr <byte_addr> [len] [force]");
    return;
  }

  uint32_t byteAddr = 0;
  if (!parseUint32Token(addrTxt, byteAddr)) {
    Serial.printf("[WTESTADDR] invalid addr: %s\n", addrTxt);
    return;
  }

  uint16_t len = 16;
  if (lenTxt && lenTxt[0]) {
    uint32_t len32 = 0;
    if (!parseUint32Token(lenTxt, len32) || len32 == 0 || len32 > AVR109_HOST_BLOCK_CAP) {
      Serial.printf("[WTESTADDR] invalid len: %s\n", lenTxt);
      return;
    }
    len = (uint16_t)len32;
  }
  bool forceUnsafe = (modeTxt != nullptr);
  if (!allowFlashTestRange("WTESTADDR", byteAddr, len, forceUnsafe)) return;

  atmegaSwitchUartBaud(ATMEGA_BOOTLOADER_BAUD);

  char detail[96];
  uint16_t blockSize = 0;
  if (!bootloaderHandshakeAuto(detail, sizeof(detail), &blockSize)) {
    Serial.printf("[WTESTADDR] handshake_fail %s\n", detail);
    atmegaSwitchUartBaud(ATMEGA_APP_BAUD);
    return;
  }

  Serial.printf("[WTESTADDR] ready %s addr=0x%05lX len=%u\n",
                detail,
                (unsigned long)byteAddr,
                (unsigned)len);
  runWriteTestAtAddr(byteAddr, len);

  bootloaderCommandCleanup(true);
}

static void handleWriteSeqCommand(char* args) {
  if (!args || !args[0]) {
    Serial.println("[WSEQ] usage: writeseq <start_addr> [blocks] [len] [force]");
    return;
  }

  char* savePtr = nullptr;
  char* addrTxt = strtok_r(args, " ", &savePtr);
  char* blocksTxt = strtok_r(nullptr, " ", &savePtr);
  char* lenTxt = strtok_r(nullptr, " ", &savePtr);
  char* modeTxt = strtok_r(nullptr, " ", &savePtr);
  char* extraTxt = strtok_r(nullptr, " ", &savePtr);
  if (!addrTxt || extraTxt ||
      (modeTxt && strcasecmp(modeTxt, "force") != 0 && strcasecmp(modeTxt, "unsafe") != 0)) {
    Serial.println("[WSEQ] usage: writeseq <start_addr> [blocks] [len] [force]");
    return;
  }

  uint32_t startAddr = 0;
  if (!parseUint32Token(addrTxt, startAddr)) {
    Serial.printf("[WSEQ] invalid addr: %s\n", addrTxt);
    return;
  }

  uint32_t blocks = 8;
  if (blocksTxt && blocksTxt[0]) {
    if (!parseUint32Token(blocksTxt, blocks) || blocks == 0 || blocks > 64) {
      Serial.printf("[WSEQ] invalid blocks: %s\n", blocksTxt);
      return;
    }
  }

  uint16_t len = 256;
  if (lenTxt && lenTxt[0]) {
    uint32_t len32 = 0;
    if (!parseUint32Token(lenTxt, len32) || len32 == 0 || len32 > AVR109_HOST_BLOCK_CAP) {
      Serial.printf("[WSEQ] invalid len: %s\n", lenTxt);
      return;
    }
    len = (uint16_t)len32;
  }
  bool forceUnsafe = (modeTxt != nullptr);
  uint32_t totalLen = (uint32_t)len * blocks;
  if (!allowFlashTestRange("WSEQ", startAddr, totalLen, forceUnsafe)) return;

  atmegaSwitchUartBaud(ATMEGA_BOOTLOADER_BAUD);

  char detail[96];
  uint16_t blockSize = 0;
  if (!bootloaderHandshakeAuto(detail, sizeof(detail), &blockSize)) {
    Serial.printf("[WSEQ] handshake_fail %s\n", detail);
    atmegaSwitchUartBaud(ATMEGA_APP_BAUD);
    return;
  }

  Serial.printf("[WSEQ] ready %s start=0x%05lX blocks=%lu len=%u\n",
                detail,
                (unsigned long)startAddr,
                (unsigned long)blocks,
                (unsigned)len);

  for (uint32_t i = 0; i < blocks; i++) {
    uint32_t addr = startAddr + ((uint32_t)len * i);
    Serial.printf("[WSEQ] block %lu/%lu addr=0x%05lX\n",
                  (unsigned long)(i + 1U),
                  (unsigned long)blocks,
                  (unsigned long)addr);
    runWriteTestAtAddr(addr, len);
  }

  bootloaderCommandCleanup(true);
}

static void handleLoadSeqCommand(char* args) {
  if (!args || !args[0]) {
    Serial.println("[LSEQ] usage: loadseq <start_addr> [blocks] [len] [force]");
    return;
  }

  char* savePtr = nullptr;
  char* addrTxt = strtok_r(args, " ", &savePtr);
  char* blocksTxt = strtok_r(nullptr, " ", &savePtr);
  char* lenTxt = strtok_r(nullptr, " ", &savePtr);
  char* modeTxt = strtok_r(nullptr, " ", &savePtr);
  char* extraTxt = strtok_r(nullptr, " ", &savePtr);
  if (!addrTxt || extraTxt ||
      (modeTxt && strcasecmp(modeTxt, "force") != 0 && strcasecmp(modeTxt, "unsafe") != 0)) {
    Serial.println("[LSEQ] usage: loadseq <start_addr> [blocks] [len] [force]");
    return;
  }

  uint32_t startAddr = 0;
  if (!parseUint32Token(addrTxt, startAddr)) {
    Serial.printf("[LSEQ] invalid addr: %s\n", addrTxt);
    return;
  }

  uint32_t blocks = 8;
  if (blocksTxt && blocksTxt[0]) {
    if (!parseUint32Token(blocksTxt, blocks) || blocks == 0 || blocks > 128) {
      Serial.printf("[LSEQ] invalid blocks: %s\n", blocksTxt);
      return;
    }
  }

  uint16_t len = 256;
  if (lenTxt && lenTxt[0]) {
    uint32_t len32 = 0;
    if (!parseUint32Token(lenTxt, len32) || len32 == 0 || len32 > AVR109_HOST_BLOCK_CAP) {
      Serial.printf("[LSEQ] invalid len: %s\n", lenTxt);
      return;
    }
    len = (uint16_t)len32;
  }
  bool forceUnsafe = (modeTxt != nullptr);
  uint32_t totalLen = (uint32_t)len * blocks;
  if (!allowFlashTestRange("LSEQ", startAddr, totalLen, forceUnsafe)) return;

  atmegaSwitchUartBaud(ATMEGA_BOOTLOADER_BAUD);

  char detail[96];
  uint16_t blockSize = 0;
  if (!bootloaderHandshakeAuto(detail, sizeof(detail), &blockSize)) {
    Serial.printf("[LSEQ] handshake_fail %s\n", detail);
    atmegaSwitchUartBaud(ATMEGA_APP_BAUD);
    return;
  }

  Serial.printf("[LSEQ] ready %s start=0x%05lX blocks=%lu len=%u\n",
                detail,
                (unsigned long)startAddr,
                (unsigned long)blocks,
                (unsigned)len);

  for (uint32_t i = 0; i < blocks; i++) {
    uint32_t addr = startAddr + ((uint32_t)len * i);
    if (!runLoadOnlyAtAddr(addr, len, detail, sizeof(detail))) {
      Serial.printf("[LSEQ] block %lu/%lu addr=0x%05lX fail %s\n",
                    (unsigned long)(i + 1U),
                    (unsigned long)blocks,
                    (unsigned long)addr,
                    detail[0] ? detail : "unknown");
      break;
    }
    Serial.printf("[LSEQ] block %lu/%lu addr=0x%05lX ok\n",
                  (unsigned long)(i + 1U),
                  (unsigned long)blocks,
                  (unsigned long)addr);
  }

  bootloaderCommandCleanup(true);
}

static void handleEraseCommand() {
  char bootDetail[96];
  char eraseDetail[32];
  uint16_t blockSize = 0;

  atmegaSwitchUartBaud(ATMEGA_BOOTLOADER_BAUD);
  if (!bootloaderHandshakeAuto(bootDetail, sizeof(bootDetail), &blockSize)) {
    Serial.printf("[ERASE] FAIL handshake=%s\n", bootDetail);
    atmegaSwitchUartBaud(ATMEGA_APP_BAUD);
    return;
  }

  Serial.printf("[ERASE] handshake %s\n", bootDetail);
  if (AVR109_SKIP_CHIP_ERASE) {
    Serial.println("[ERASE] SKIP page_erase_on_write");
    bootloaderCommandCleanup(true);
    return;
  }

  if (!avr109ChipEraseDetailed(eraseDetail, sizeof(eraseDetail))) {
    atmegaDumpPostEraseFailureContext();
    Serial.printf("[ERASE] FAIL %s\n", eraseDetail[0] ? eraseDetail : "unknown");
    atmegaSwitchUartBaud(ATMEGA_APP_BAUD);
    atmegaResetPulse(RESET_PULSE_MS);
    return;
  }

  Serial.println("[ERASE] OK");
  bootloaderCommandCleanup(true);
}

static void handleFlashCommand(char* args) {
  const char* path = (args && args[0]) ? args : SD_DEFAULT_HEX_PATH;
  char err[96];
  bool ok = flashFromFilePath(path, err, sizeof(err));
  Serial.printf("[FLASH] result=%s reason=%s\n", ok ? "ok" : "fail", ok ? "-" : err);
}

static void handleFlashUsbCommand() {
  if (g_usbHexActive) {
    Serial.println("[FLASHUSB] already_active");
    return;
  }

  usbHexResetState();
  Serial.println("[FLASHUSB] handshake begin");
  char bootDetail[96];
  char eraseDetail[32];
  uint16_t blockSize = 0;
  if (!bootloaderHandshakeAuto(bootDetail, sizeof(bootDetail), &blockSize)) {
    atmegaSwitchUartBaud(ATMEGA_APP_BAUD);
    setStatusText("bootloader_handshake_failed");
    Serial.printf("[FLASHUSB] result=fail reason=%s\n", bootDetail[0] ? bootDetail : "bootloader_handshake_failed");
    return;
  }

  if (AVR109_SKIP_CHIP_ERASE) {
    Serial.println("[FLASHUSB] chip erase skipped -> page erase on write");
  } else {
    Serial.println("[FLASHUSB] chip erase start");
    if (!avr109ChipEraseDetailed(eraseDetail, sizeof(eraseDetail))) {
      atmegaDumpPostEraseFailureContext();
      atmegaSwitchUartBaud(ATMEGA_APP_BAUD);
      atmegaResetPulse(RESET_PULSE_MS);
      setStatusText(eraseDetail[0] ? eraseDetail : "chip_erase_failed");
      Serial.printf("[FLASHUSB] result=fail reason=chip_erase_failed_%s\n",
                    eraseDetail[0] ? eraseDetail : "unknown");
      return;
    }
    Serial.println("[FLASHUSB] chip erase ok");
  }

  g_usbHexActive = true;
  g_otaActive = true;
  g_usbHexBootSessionOpen = true;
  g_bootSessionBlocks = 0;
  g_atmegaFlashChunkCap = avr109HostFlashChunkCap(blockSize);
  snprintf(g_sourceText, sizeof(g_sourceText), "%s", "usb_hex_stream");
  setStatusText("awaiting_usb_hex");
  Serial.printf("[FLASHUSB] bootloader ready %s\n", bootDetail);
  Serial.printf("[ATOTA] block tx gap=%lu us\n", (unsigned long)avr109BlockTxGapUs());
  Serial.printf("[FLASHUSB] host block cap=%u\n", (unsigned)g_atmegaFlashChunkCap);
  Serial.println("[FLASHUSB] ready: send Intel HEX lines, finish with :00000001FF");
}

static void handleFlashBlockCommand() {
  if (g_usbBlockActive) {
    Serial.println("[FLASHBLK] already_active");
    return;
  }

  usbHexResetState();
  Serial.println("[FLASHBLK] handshake begin");
  char bootDetail[96];
  char eraseDetail[32];
  uint16_t blockSize = 0;
  if (!bootloaderHandshakeAuto(bootDetail, sizeof(bootDetail), &blockSize)) {
    atmegaSwitchUartBaud(ATMEGA_APP_BAUD);
    setStatusText("bootloader_handshake_failed");
    Serial.printf("[FLASHBLK] result=fail reason=%s\n", bootDetail[0] ? bootDetail : "bootloader_handshake_failed");
    return;
  }

  if (AVR109_SKIP_CHIP_ERASE) {
    Serial.println("[FLASHBLK] chip erase skipped -> page erase on write");
  } else {
    Serial.println("[FLASHBLK] chip erase start");
    if (!avr109ChipEraseDetailed(eraseDetail, sizeof(eraseDetail))) {
      atmegaDumpPostEraseFailureContext();
      atmegaSwitchUartBaud(ATMEGA_APP_BAUD);
      atmegaResetPulse(RESET_PULSE_MS);
      setStatusText(eraseDetail[0] ? eraseDetail : "chip_erase_failed");
      Serial.printf("[FLASHBLK] result=fail reason=chip_erase_failed_%s\n",
                    eraseDetail[0] ? eraseDetail : "unknown");
      return;
    }
    Serial.println("[FLASHBLK] chip erase ok");
  }

  g_usbBlockActive = true;
  g_otaActive = true;
  g_usbHexBootSessionOpen = true;
  g_bootSessionBlocks = 0;
  g_atmegaFlashChunkCap = avr109HostFlashChunkCap(blockSize);
  snprintf(g_sourceText, sizeof(g_sourceText), "%s", "usb_block_stream");
  setStatusText("awaiting_usb_block");
  Serial.printf("[FLASHBLK] bootloader ready %s\n", bootDetail);
  Serial.printf("[ATOTA] block tx gap=%lu us\n", (unsigned long)avr109BlockTxGapUs());
  Serial.printf("[FLASHBLK] host block cap=%u\n", (unsigned)g_atmegaFlashChunkCap);
  Serial.println("[FLASHBLK] ready: send @ADDR|HEX lines, finish with !EOF");
}

static void handleCommand(char* line) {
  if (!line || !line[0]) return;

  char* arg = strchr(line, ' ');
  if (arg) {
    *arg++ = 0;
    while (*arg == ' ') arg++;
  }

  if (strcasecmp(line, "help") == 0) {
    printHelp();
    return;
  }

  if (strcasecmp(line, "status") == 0) {
    printStatus();
    return;
  }

  if (strcasecmp(line, "sd") == 0) {
    printSdStatus();
    return;
  }

  if (strcasecmp(line, "flash") == 0) {
    handleFlashCommand(arg);
    return;
  }

  if (strcasecmp(line, "flashusb") == 0) {
    handleFlashUsbCommand();
    return;
  }

  if (strcasecmp(line, "flashblk") == 0) {
    handleFlashBlockCommand();
    return;
  }

  if (strcasecmp(line, "power") == 0) {
    if (arg && strcasecmp(arg, "on") == 0) {
      melauhfPowerSet(true);
      Serial.println("[POWER] ON");
      return;
    }
    if (arg && strcasecmp(arg, "off") == 0) {
      melauhfPowerSet(false);
      Serial.println("[POWER] OFF");
      return;
    }
    Serial.println("[POWER] usage: power on | power off");
    return;
  }

  if (strcasecmp(line, "reset") == 0) {
    Serial.println("[RESET] pulse start");
    atmegaResetPulse(RESET_PULSE_MS);
    Serial.println("[RESET] pulse end");
    return;
  }

  if (strcasecmp(line, "hold") == 0) {
    atmegaResetHold();
    Serial.println("[RESET] held");
    return;
  }

  if (strcasecmp(line, "release") == 0) {
    atmegaResetRelease();
    Serial.println("[RESET] released");
    return;
  }

  if (strcasecmp(line, "baud") == 0) {
    handleBaudCommand(arg);
    return;
  }

  if (strcasecmp(line, "perf") == 0) {
    handlePerfCommand(arg);
    return;
  }

  if (strcasecmp(line, "ping") == 0) {
    handlePingCommand();
    return;
  }

  if (strcasecmp(line, "peek") == 0) {
    handlePeekCommand(arg);
    return;
  }

  if (strcasecmp(line, "tap") == 0) {
    if (arg && strcasecmp(arg, "on") == 0) {
      g_tapEnabled = true;
      Serial.println("[TAP] ON");
      return;
    }
    if (arg && strcasecmp(arg, "off") == 0) {
      g_tapEnabled = false;
      Serial.println("[TAP] OFF");
      return;
    }
    Serial.println("[TAP] usage: tap on | tap off");
    return;
  }

  if (strcasecmp(line, "drain") == 0) {
    atmegaDrainRx();
    Serial.println("[RX] drained");
    return;
  }

  if (strcasecmp(line, "sig") == 0) {
    char detail[48];
    uint8_t sig[3] = {0};
    if (!avr109ReadSignatureAutoDetailed(sig, detail, sizeof(detail))) {
      Serial.printf("[SIG] FAIL %s\n", detail[0] ? detail : "unknown");
      atmegaSwitchUartBaud(ATMEGA_APP_BAUD);
      atmegaResetPulse(RESET_PULSE_MS);
      return;
    }
    Serial.printf("[SIG] baud=%lu ", (unsigned long)g_atmegaCurrentBaud);
    printHexBytes(sig, sizeof(sig));
    Serial.println();
    bootloaderCommandCleanup(true);
    return;
  }

  if (strcasecmp(line, "probe") == 0) {
    char detail[96];
    uint16_t blockSize = 0;
    if (bootloaderHandshakeAuto(detail, sizeof(detail), &blockSize)) {
      Serial.printf("[PROBE] OK %s\n", detail);
      bootloaderCommandCleanup(true);
    } else {
      Serial.printf("[PROBE] FAIL %s\n", detail);
      atmegaSwitchUartBaud(ATMEGA_APP_BAUD);
    }
    return;
  }

  if (strcasecmp(line, "erase") == 0) {
    handleEraseCommand();
    return;
  }

  if (strcasecmp(line, "prog") == 0) {
    char detail[96];
    uint16_t blockSize = 0;
    if (!bootloaderHandshakeAuto(detail, sizeof(detail), &blockSize)) {
      Serial.printf("[PROG] FAIL %s\n", detail);
      atmegaSwitchUartBaud(ATMEGA_APP_BAUD);
      return;
    }
    Serial.printf("[PROG] OK %s\n", detail);
    bootloaderCommandCleanup(true);
    return;
  }

  if (strcasecmp(line, "leave") == 0) {
    char detail[96];
    uint16_t blockSize = 0;
    if (!bootloaderHandshakeAuto(detail, sizeof(detail), &blockSize)) {
      Serial.printf("[LEAVE] FAIL %s\n", detail);
      atmegaSwitchUartBaud(ATMEGA_APP_BAUD);
      return;
    }
    Serial.println(avr109ExitToApp() ? "[LEAVE] OK" : "[LEAVE] FAIL");
    atmegaSwitchUartBaud(ATMEGA_APP_BAUD);
    delay(g_atmegaPostBlockResetSettleMs);
    return;
  }

  if (strcasecmp(line, "block") == 0) {
    char detail[96];
    uint16_t blockSize = 0;
    if (!bootloaderHandshakeAuto(detail, sizeof(detail), &blockSize)) {
      Serial.printf("[BLOCK] FAIL %s\n", detail);
      atmegaSwitchUartBaud(ATMEGA_APP_BAUD);
      return;
    }
    Serial.printf("[BLOCK] size=%u baud=%lu\n",
                  (unsigned)blockSize,
                  (unsigned long)g_atmegaCurrentBaud);
    bootloaderCommandCleanup(true);
    return;
  }

  if (strcasecmp(line, "id") == 0) {
    char detail[96];
    char id[8];
    uint16_t blockSize = 0;
    if (!bootloaderHandshakeAuto(detail, sizeof(detail), &blockSize)) {
      Serial.printf("[ID] FAIL %s\n", detail);
      atmegaSwitchUartBaud(ATMEGA_APP_BAUD);
      return;
    }
    if (!avr109ReadProgrammerId(id, sizeof(id))) Serial.println("[ID] FAIL read");
    else Serial.printf("[ID] %s baud=%lu\n", id, (unsigned long)g_atmegaCurrentBaud);
    bootloaderCommandCleanup(true);
    return;
  }

  if (strcasecmp(line, "lock") == 0) {
    char detail[96];
    uint8_t lockBits = 0xFF;
    uint16_t blockSize = 0;
    if (!bootloaderHandshakeAuto(detail, sizeof(detail), &blockSize)) {
      Serial.printf("[LOCK] FAIL %s\n", detail);
      atmegaSwitchUartBaud(ATMEGA_APP_BAUD);
      return;
    }
    if (!avr109ReadLockBits(lockBits)) Serial.println("[LOCK] FAIL read");
    else Serial.printf("[LOCK] 0x%02X baud=%lu\n",
                       (unsigned)lockBits,
                       (unsigned long)g_atmegaCurrentBaud);
    bootloaderCommandCleanup(true);
    return;
  }

  if (strcasecmp(line, "handshake") == 0) {
    handleHandshakeCommand();
    return;
  }

  if (strcasecmp(line, "writetest") == 0) {
    handleWriteTestCommand(arg);
    return;
  }

  if (strcasecmp(line, "writetestaddr") == 0) {
    handleWriteTestAddrCommand(arg);
    return;
  }

  if (strcasecmp(line, "writeseq") == 0) {
    handleWriteSeqCommand(arg);
    return;
  }

  if (strcasecmp(line, "loadseq") == 0) {
    handleLoadSeqCommand(arg);
    return;
  }

  if (strcasecmp(line, "send") == 0) {
    handleSendCommand(arg);
    return;
  }

  Serial.printf("[ERR] unknown command: %s\n", line);
}

void setup() {
  Serial.setRxBufferSize(USB_CDC_RX_BUFFER_BYTES);
  Serial.begin(USB_BAUD);
  delay(250);

  melauhfPowerInit();
  melauhfPowerSet(true);

  pinMode(ATMEGA_RESET_PIN, OUTPUT);
  atmegaResetRelease();
  ATMEGA.setRxBufferSize(ATMEGA_UART_RX_BUFFER_BYTES);
  ATMEGA.setTxBufferSize(ATMEGA_UART_TX_BUFFER_BYTES);
  ATMEGA.begin(ATMEGA_APP_BAUD, SERIAL_8N1, ATMEGA_RX_PIN, ATMEGA_TX_PIN);

  Serial.println();
  Serial.println("=== ATmega SD UART Flash Test ===");
  Serial.printf("[CFG] ATmega UART2 RX=%d TX=%d app=%lu boot_fast=%lu boot=%lu alt_boot=%lu reset=%d\n",
                ATMEGA_RX_PIN,
                ATMEGA_TX_PIN,
                (unsigned long)ATMEGA_APP_BAUD,
                (unsigned long)ATMEGA_BOOTLOADER_BAUD,
                (unsigned long)ATMEGA_BOOTLOADER_FALLBACK_BAUD,
                (unsigned long)ATMEGA_BOOTLOADER_ALT_BAUD,
                ATMEGA_RESET_PIN);
  Serial.printf("[CFG] SD CS=%d MOSI=%d SCK=%d MISO=%d\n",
                SD_SPI_CS_PIN,
                SD_SPI_MOSI_PIN,
                SD_SPI_SCK_PIN,
                SD_SPI_MISO_PIN);
  Serial.printf("[CFG] power_pin=%d\n", MELAUHF_POWER_EN_PIN);
  Serial.printf("[CFG] default_hex=%s\n", SD_DEFAULT_HEX_PATH);

  Serial.println("[SD] deferred; run 'sd' or 'flash' after boot");
  printHelp();
}

void loop() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\r' || c == '\n') {
      if (g_cmdLen == 0) continue;
      g_cmd[g_cmdLen] = 0;
      if (g_usbHexActive) handleUsbHexLine(g_cmd);
      else if (g_usbBlockActive) handleUsbBlockLine(g_cmd);
      else handleCommand(g_cmd);
      g_cmdLen = 0;
      continue;
    }
    if (g_cmdLen < sizeof(g_cmd) - 1) {
      g_cmd[g_cmdLen++] = c;
    }
  }

  if (!g_otaActive && g_tapEnabled) {
    while (ATMEGA.available()) {
      int v = ATMEGA.read();
      if (v < 0) break;
      Serial.printf("[TAP] 0x%02X '%c'\n",
                    (unsigned)v,
                    (v >= 0x20 && v <= 0x7E) ? v : '.');
    }
  }
}
