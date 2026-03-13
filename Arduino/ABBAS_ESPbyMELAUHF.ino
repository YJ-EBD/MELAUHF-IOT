
struct _DwinParser;
struct _DwinForwardParser;
struct TeFileStats;
struct WebLogUploadJob;
static void melauhfPowerSet(bool on);

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <time.h>
#include <ctype.h>
#include <SPI.h>
#include <SD.h>
#include "freertos/semphr.h"

#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Update.h>
#include "mbedtls/sha256.h"

#ifndef DWIN_RX_PIN
#define DWIN_RX_PIN 6
#endif
#ifndef DWIN_TX_PIN
#define DWIN_TX_PIN 7
#endif
#ifndef ATMEGA_RX_PIN
#define ATMEGA_RX_PIN 4
#endif
#ifndef ATMEGA_TX_PIN
#define ATMEGA_TX_PIN 5
#endif

static const uint32_t ATMEGA_BAUD = 115200;
static const uint32_t DWIN_BAUD   = 115200;

HardwareSerial DWIN(1);
HardwareSerial ATMEGA(2);
static SemaphoreHandle_t g_dwinTxMutex = nullptr;
static volatile uint8_t g_dwinCurrentPage = 0xFF;
static void sdAppendPageLog(uint8_t page);
static void sdAppendRkcLog(uint16_t keyCode);
static void logRkcEvent(uint8_t page, uint16_t keyCode, bool allowPageUpdate);
static void stopPortal();
static bool sdProbeAndMount(bool forceRemount);
// [NEW FEATURE] Energy subscription/session tracking forward declarations.
static void teQueueRunEventFromAtmega(uint8_t runState, uint32_t totalEnergy);
static void teTick();
static void tePublishMetricsToAtmega(bool force);
static void teEnsureLedgerFileReady();
static void teResetSubscriptionState();
static void teResetLocalState();
static void subscriptionApplyExpired();
static void subscriptionApplyUnregistered();
static void webRegisterTick(bool force);
static void webLogUploadTick();
static void webMarkLogUploadDirty(const char* path);
static void atmegaPublishSubscriptionActive(const char* planLabel, const char* range, int remainingDays);
static void notifyAtmegaWifiConnectResult(bool ok);
static void webScheduleImmediateFirmwareCheck(const char* reason);
static void webFirmwareImmediateCheckTick();
static void webFirmwareDecisionTick();

static const uint16_t CRC_TABLE[256] PROGMEM = {
  0x0000,0xc0c1,0xc181,0x0140,0xc301,0x03c0,0x0280,0xc241,
  0xc601,0x06c0,0x0780,0xc741,0x0500,0xc5c1,0xc481,0x0440,
  0xcc01,0x0cc0,0x0d80,0xcd41,0x0f00,0xcfc1,0xce81,0x0e40,
  0x0a00,0xcac1,0xcb81,0x0b40,0xc901,0x09c0,0x0880,0xc841,
  0xd801,0x18c0,0x1980,0xd941,0x1b00,0xdbc1,0xda81,0x1a40,
  0x1e00,0xdec1,0xdf81,0x1f40,0xdd01,0x1dc0,0x1c80,0xdc41,
  0x1400,0xd4c1,0xd581,0x1540,0xd701,0x17c0,0x1680,0xd641,
  0xd201,0x12c0,0x1380,0xd341,0x1100,0xd1c1,0xd081,0x1040,
  0xf001,0x30c0,0x3180,0xf141,0x3300,0xf3c1,0xf281,0x3240,
  0x3600,0xf6c1,0xf781,0x3740,0xf501,0x35c0,0x3480,0xf441,
  0x3c00,0xfcc1,0xfd81,0x3d40,0xff01,0x3fc0,0x3e80,0xfe41,
  0xfa01,0x3ac0,0x3b80,0xfb41,0x3900,0xf9c1,0xf881,0x3840,
  0x2800,0xe8c1,0xe981,0x2940,0xeb01,0x2bc0,0x2a80,0xea41,
  0xee01,0x2ec0,0x2f80,0xef41,0x2d00,0xedc1,0xec81,0x2c40,
  0xe401,0x24c0,0x2580,0xe541,0x2700,0xe7c1,0xe681,0x2640,
  0x2200,0xe2c1,0xe381,0x2340,0xe101,0x21c0,0x2080,0xe041,
  0xa001,0x60c0,0x6180,0xa141,0x6300,0xa3c1,0xa281,0x6240,
  0x6600,0xa6c1,0xa781,0x6740,0xa501,0x65c0,0x6480,0xa441,
  0x6c00,0xacc1,0xad81,0x6d40,0xaf01,0x6fc0,0x6e80,0xae41,
  0xaa01,0x6ac0,0x6b80,0xab41,0x6900,0xa9c1,0xa881,0x6840,
  0x7800,0xb8c1,0xb981,0x7940,0xbb01,0x7bc0,0x7a80,0xba41,
  0xbe01,0x7ec0,0x7f80,0xbf41,0x7d00,0xbdc1,0xbc81,0x7c40,
  0xb401,0x74c0,0x7580,0xb541,0x7700,0xb7c1,0xb681,0x7640,
  0x7200,0xb2c1,0xb381,0x7340,0xb101,0x71c0,0x7080,0xb041,
  0x5000,0x90c1,0x9181,0x5140,0x9301,0x53c0,0x5280,0x9241,
  0x9601,0x56c0,0x5780,0x9741,0x5500,0x95c1,0x9481,0x5440,
  0x9c01,0x5cc0,0x5d80,0x9d41,0x5f00,0x9fc1,0x9e81,0x5e40,
  0x5a00,0x9ac1,0x9b81,0x5b40,0x9901,0x59c0,0x5880,0x9841,
  0x8801,0x48c0,0x4980,0x8941,0x4b00,0x8bc1,0x8a81,0x4a40,
  0x4e00,0x8ec1,0x8f81,0x4f40,0x8d01,0x4dc0,0x4c80,0x8c41,
  0x4400,0x84c1,0x8581,0x4540,0x8701,0x47c0,0x4680,0x8641,
  0x8201,0x42c0,0x4380,0x8341,0x4100,0x81c1,0x8081,0x4040
};

static uint16_t update_crc(const uint8_t *data, uint16_t len) {
  uint16_t crc_accum = 0xFFFF;
  for (uint16_t j = 0; j < len; j++) {
    uint16_t idx = (uint16_t)(((crc_accum >> 8) ^ data[j]) & 0xFF);
    uint16_t i = pgm_read_word(&CRC_TABLE[idx]);
    crc_accum = (uint16_t)((((i & 0x00FF) ^ (crc_accum & 0x00FF)) << 8) + (i >> 8));
  }
  return crc_accum;
}

static void dwin_write_raw_atomic(const uint8_t* data, size_t len) {
  if (!data || len == 0) return;

  if (!g_dwinTxMutex) {
    g_dwinTxMutex = xSemaphoreCreateMutex();
  }
  if (g_dwinTxMutex) {
    if (xSemaphoreTake(g_dwinTxMutex, portMAX_DELAY) == pdTRUE) {
      DWIN.write(data, len);
      DWIN.flush();
      xSemaphoreGive(g_dwinTxMutex);
      return;
    }
  }

  DWIN.write(data, len);
  DWIN.flush();
}

struct _DwinParser {
  uint8_t buf[64];
  uint8_t idx;
  uint8_t need;
  uint8_t state;
};

static _DwinParser g_pAtmega2Dwin = {{0}, 0, 0, 0};
static _DwinParser g_pDwin2Atmega = {{0}, 0, 0, 0};

static const uint8_t DWIN_PAGE_WIFI_SCAN = 63;
static const uint16_t DWIN_KEY_PAGE63_SCAN = 0x4444;
static const uint16_t DWIN_KEY_PAGE63_PREV = 0x4101;
static const uint16_t DWIN_KEY_PAGE63_NEXT = 0x4102;
static const uint8_t DWIN_PAGE_DEVICE_READY = 61;
static const uint8_t DWIN_PAGE_WIFI_CONNECTING = 67;
static const uint8_t DWIN_PAGE_DEVICE_UNREGISTERED = 73;
static const uint32_t ATMEGA_STATE_REPUBLISH_MS = 1000;

static volatile bool g_page63ScanReq = false;
static volatile bool g_page63PrevReq = false;
static volatile bool g_page63NextReq = false;
static volatile bool g_page63AnyKeyReq = false;
static volatile uint16_t g_page63LastKeyCode = 0x0000;

static volatile bool     g_runActive = false;
static volatile uint32_t g_runStartMs = 0;
static volatile uint16_t g_lastKnownW = 0;
static volatile uint16_t g_runW = 0;

static volatile int      g_standbyPage = -1;
static volatile bool     g_pendingLearnReady = false;
static volatile bool     g_pendingLearnStandby = false;
static volatile uint32_t g_pendingUntilMs = 0;

static volatile uint8_t  g_pwrDigits[3]  = {0, 0, 0};
// [NEW FEATURE] Fallback run-event state used by early telemetry handlers.
static volatile uint32_t g_teLastRealEventMs = 0;
// [NEW FEATURE] Fallback run-event state used by early telemetry handlers.
static uint32_t g_teFallbackTotalJ = 0;


static inline void _dwinParserReset(_DwinParser& p) {
  p.idx = 0;
  p.need = 0;
  p.state = 0;
}

static inline uint16_t _teleCalcW() {
  return (uint16_t)(g_pwrDigits[0] * 100U + g_pwrDigits[1] * 10U + g_pwrDigits[2]);
}

static inline void _teleNotePage(uint8_t page, uint32_t now) {
  if (g_standbyPage < 0 && !g_runActive && now < 15000U) {
    g_standbyPage = (int)page;
  }

  if ((g_pendingLearnReady || g_pendingLearnStandby) && (int32_t)(now - g_pendingUntilMs) > 0) {
    g_pendingLearnReady = false;
    g_pendingLearnStandby = false;
  }

  if (g_pendingLearnReady) {
    g_pendingLearnReady = false;
  } else if (g_pendingLearnStandby) {
    g_standbyPage = (int)page;
    g_pendingLearnStandby = false;
  }

  if (g_runActive && g_standbyPage >= 0 && (int)page == g_standbyPage) {
    g_runActive = false;
    g_runW = 0;
  }
}

static inline void _teleOnBtn(uint8_t btn, uint32_t now) {
  // [NEW FEATURE] Accept both legacy 0x06 and MA5105 run key 0x01 (0x8001 low byte).
  if (btn != 0x06 && btn != 0x01) return;

  if (!g_runActive) {
    g_runActive = true;
    g_runStartMs = now;
    g_runW = _teleCalcW();
    g_lastKnownW = g_runW;

    g_pendingLearnReady = true;
    g_pendingLearnStandby = false;
    g_pendingUntilMs = now + 800U;
    // [NEW FEATURE] Fallback run-event synthesis when firmware-side ENG|R is absent.
    if ((uint32_t)(now - g_teLastRealEventMs) > 2000U) {
      teQueueRunEventFromAtmega(1U, g_teFallbackTotalJ);
      Serial.printf("[TE] fallback run-start total=%lu\n", (unsigned long)g_teFallbackTotalJ);
    }
  } else {
    g_runActive = false;
    g_runW = 0;

    g_pendingLearnStandby = true;
    g_pendingLearnReady = false;
    g_pendingUntilMs = now + 800U;
    // [NEW FEATURE] Fallback run-event synthesis when firmware-side ENG|R is absent.
    if ((uint32_t)(now - g_teLastRealEventMs) > 2000U) {
      g_teFallbackTotalJ += (uint32_t)_teleCalcW();
      teQueueRunEventFromAtmega(0U, g_teFallbackTotalJ);
      Serial.printf("[TE] fallback run-stop total=%lu\n", (unsigned long)g_teFallbackTotalJ);
    }
  }
}

static inline void _teleHandleAtmegaFrame(const uint8_t* payload, uint8_t plen, uint32_t now) {
  if (plen == 5 && payload[0] == 0x82 && payload[3] == 0x00) {
    uint16_t addr = (uint16_t)((payload[1] << 8) | payload[2]);
    if (addr >= 0x1000 && addr <= 0x1002) {
      uint8_t i = (uint8_t)(addr - 0x1000);
      g_pwrDigits[i] = payload[4];
      uint16_t w = _teleCalcW();
      g_lastKnownW = w;
      if (g_runActive) g_runW = w;
    }
    return;
  }

  if (plen == 7 && payload[0] == 0x82 && payload[1] == 0x00 && payload[2] == 0x84 &&
      payload[3] == 0x5A && payload[4] == 0x01 && payload[5] == 0x00) {
    if (g_dwinCurrentPage != payload[6]) {
      g_dwinCurrentPage = payload[6];
      sdAppendPageLog(payload[6]);
    } else {
      g_dwinCurrentPage = payload[6];
    }
    _teleNotePage(payload[6], now);
    return;
  }
}

static inline void _teleHandleDwinFrame(const uint8_t* payload, uint8_t plen, uint32_t now) {
  if (plen >= 6 && payload[0] == 0x83) {
    uint16_t addr = (uint16_t)((payload[1] << 8) | payload[2]);
    if (!((addr == 0x3000) || (addr == 0x0000))) return;

    uint16_t keyCode = 0;
    if (payload[3] >= 1) {
      // Read response can be variable-size: use the last returned word as key code.
      keyCode = (uint16_t)((payload[plen - 2] << 8) | payload[plen - 1]);
    } else {
      keyCode = (uint16_t)((payload[4] << 8) | payload[5]);
    }

    // Capture all touch key codes in chronological order as a fallback path,
    // even when ATmega-side ASCII forwarding is unavailable.
    if (keyCode != 0x0000) {
      logRkcEvent(g_dwinCurrentPage, keyCode, false);
    }

    // Legacy runtime keys still use 0x3000 + 0x80xx style.
    if ((addr == 0x3000) && (((keyCode >> 8) & 0xFF) == 0x80)) {
      _teleOnBtn((uint8_t)(keyCode & 0xFF), now);
    }

    // Page63 key handling is owned by ATmega and delivered through "@P63|K|...." lines.
    if (g_dwinCurrentPage == DWIN_PAGE_WIFI_SCAN && addr == 0x0000) {
      return;
    }
    return;
  }
}

static inline void _dwinFeed(_DwinParser& p, uint8_t b, bool fromAtmega, uint32_t now) {
  switch (p.state) {
    case 0:
      if (b == 0x5A) { p.buf[0] = b; p.idx = 1; p.state = 1; }
      break;
    case 1:
      if (b == 0xA5) { p.buf[1] = b; p.idx = 2; p.state = 2; }
      else { p.state = (b == 0x5A) ? 1 : 0; if (p.state == 1) { p.buf[0] = 0x5A; p.idx = 1; } }
      break;
    case 2:
      p.need = b;
      p.buf[2] = b;
      p.idx = 3;
      if (p.need < 2 || p.need > (sizeof(p.buf) - 3)) _dwinParserReset(p);
      else p.state = 3;
      break;
    case 3:
      p.buf[p.idx++] = b;
      if (p.idx >= (uint8_t)(3 + p.need)) {
        uint8_t plen = (uint8_t)(p.need - 2);
        const uint8_t* payload = &p.buf[3];
        const uint8_t crcH = p.buf[3 + plen];
        const uint8_t crcL = p.buf[3 + plen + 1];
        uint16_t crc = update_crc(payload, plen);
        if (((uint8_t)(crc >> 8) == crcH) && ((uint8_t)(crc & 0xFF) == crcL)) {
          if (fromAtmega) _teleHandleAtmegaFrame(payload, plen, now);
          else _teleHandleDwinFrame(payload, plen, now);
        }
        _dwinParserReset(p);
      }
      break;
  }
}

static inline void tele_sniff_atmega_to_dwin(uint8_t b, uint32_t now) { _dwinFeed(g_pAtmega2Dwin, b, true, now); }
static inline void tele_sniff_dwin_to_atmega(uint8_t b, uint32_t now) { _dwinFeed(g_pDwin2Atmega, b, false, now); }

static bool   g_bridgeEnabled = true;
static String g_cmdLine;

enum SubscriptionGateState : uint8_t {
  SUB_GATE_BOOT_WAIT = 0,
  SUB_GATE_ACTIVE,
  SUB_GATE_EXPIRED,
  SUB_GATE_RESTRICTED,
  SUB_GATE_UNREGISTERED,
  SUB_GATE_OFFLINE
};

static SubscriptionGateState g_subGateState = SUB_GATE_BOOT_WAIT;
static uint8_t g_subLockPage = 60;
static uint32_t g_subLockLastPushMs = 0;
static bool g_subBootResolved = false;
static uint32_t lastWebSubscriptionOkMs = 0;
static char g_atmegaSubStateCode = 0;
static char g_atmegaSubPlanLabel[20] = {0};
static char g_atmegaSubRange[40] = {0};
static int g_atmegaSubRemainingDays = 0;
static uint32_t g_lastAtmegaRegPublishMs = 0;
static uint32_t g_lastAtmegaSubPublishMs = 0;

static bool     g_pingWaiting = false;
static uint32_t g_pingSentAt  = 0;
static String   g_pingLine;
static bool     g_atmegaLineActive = false;
static bool     g_atmegaLineDrop = false;
static uint8_t  g_atmegaLineLen = 0;
static char     g_atmegaLineBuf[96];
static bool     g_atmegaCredDrop = false;
static uint8_t  g_atmegaCredLen = 0;
static char     g_atmegaCredBuf[128];
static char     g_atmegaPendingSsid[33] = {0};
static char     g_atmegaPendingPass[65] = {0};
static bool     g_atmegaPendingHaveSsid = false;
static bool     g_atmegaPendingHavePass = false;
static volatile bool g_atmegaPendingConnectReq = false;
static bool     g_atmegaConnectFlowActive = false;
// OTA prompt/session state for this boot cycle (driven by ATmega decision).
static bool     g_webOtaPromptShownThisBoot = false;
static bool     g_webOtaAwaitingUserDecision = false;
static bool     g_webOtaApprovedByUser = false;
static bool     g_webOtaSessionSkipUntilReboot = false;
static volatile int8_t g_webOtaDecisionReqValue = -1; // -1:none, 0:skip, 1:accept
static uint64_t g_webOtaPromptReleaseId = 0;
static uint64_t g_webOtaPromptSizeBytes = 0;
static uint8_t  g_lastRkcPage = 0xFF;
static uint16_t g_lastRkcKey = 0x0000;
static uint32_t g_lastRkcMs = 0;
static const uint32_t RKC_LOG_DEDUP_MS = 120;

static inline void atmegaLineReset() {
  g_atmegaLineActive = false;
  g_atmegaLineDrop = false;
  g_atmegaLineLen = 0;
}

static inline void atmegaCredReset() {
  g_atmegaCredDrop = false;
  g_atmegaCredLen = 0;
}

static void atmegaCopyCredField(char* dst, size_t dstSize, const char* src) {
  if (!dst || dstSize == 0) return;
  if (!src) src = "";
  size_t n = 0;
  while (src[n] != 0 && (n + 1) < dstSize) {
    dst[n] = src[n];
    n++;
  }
  dst[n] = 0;
}

static void atmegaQueueConnectIfReady() {
  if (g_atmegaPendingConnectReq) return;
  if (!g_atmegaPendingHaveSsid || !g_atmegaPendingHavePass) return;
  g_atmegaPendingConnectReq = true;
  g_atmegaPendingHaveSsid = false;
  g_atmegaPendingHavePass = false;
  Serial.printf("[AT->ESP] credentials ready -> queue connect (ssid='%s', pass_len=%u)\n",
                g_atmegaPendingSsid,
                (unsigned)strlen(g_atmegaPendingPass));
}

static void atmegaSniffCredentialByte(uint8_t b) {
  if (b == '\r') return;

  if (b == '\n') {
    if (!g_atmegaPendingConnectReq && !g_atmegaCredDrop && g_atmegaCredLen > 0) {
      g_atmegaCredBuf[g_atmegaCredLen] = 0;
      if (strncmp(g_atmegaCredBuf, "SSID:", 5) == 0) {
        // Start a fresh credential transaction on each SSID line.
        // This prevents reusing a stale password from a previous attempt.
        memset(g_atmegaPendingPass, 0, sizeof(g_atmegaPendingPass));
        g_atmegaPendingHavePass = false;
        atmegaCopyCredField(g_atmegaPendingSsid, sizeof(g_atmegaPendingSsid), &g_atmegaCredBuf[5]);
        g_atmegaPendingHaveSsid = true;
        Serial.printf("[AT->ESP] SSID:%s\n", g_atmegaPendingSsid);
      } else if (strncmp(g_atmegaCredBuf, "PW:", 3) == 0) {
        atmegaCopyCredField(g_atmegaPendingPass, sizeof(g_atmegaPendingPass), &g_atmegaCredBuf[3]);
        g_atmegaPendingHavePass = true;
        // Some ATmega bursts can drop an SSID line; in that case reuse the last
        // selected SSID so 0xAAA4 still triggers a connect attempt with new PW.
        if (!g_atmegaPendingHaveSsid && g_atmegaPendingSsid[0] != 0) {
          g_atmegaPendingHaveSsid = true;
          Serial.printf("[AT->ESP] SSID(reuse):%s\n", g_atmegaPendingSsid);
        }
        Serial.printf("[AT->ESP] PW:(len=%u)\n", (unsigned)strlen(g_atmegaPendingPass));
      }
      atmegaQueueConnectIfReady();
    }
    atmegaCredReset();
    return;
  }

  if (b < 0x20 || b > 0x7E) {
    atmegaCredReset();
    return;
  }

  if (g_atmegaCredDrop) {
    return;
  }

  if (g_atmegaCredLen + 1 < sizeof(g_atmegaCredBuf)) {
    g_atmegaCredBuf[g_atmegaCredLen++] = (char)b;
  } else {
    g_atmegaCredDrop = true;
  }
}

static void logRkcEvent(uint8_t page, uint16_t keyCode, bool allowPageUpdate) {
  if (keyCode == 0x0000) return;

  uint32_t now = millis();
  if (g_lastRkcPage == page && g_lastRkcKey == keyCode &&
      g_lastRkcMs != 0 &&
      (uint32_t)(now - g_lastRkcMs) < RKC_LOG_DEDUP_MS) {
    return;
  }

  if (page != 0xFF) {
    if (allowPageUpdate && g_dwinCurrentPage != page) {
      g_dwinCurrentPage = page;
    }
    sdAppendPageLog(page);
  }
  sdAppendRkcLog(keyCode);

  g_lastRkcPage = page;
  g_lastRkcKey = keyCode;
  g_lastRkcMs = now;
}

static void page63HandleAtmegaKeyCode(uint16_t keyCode) {
  if (keyCode == 0x0000) return;
  g_page63AnyKeyReq = true;
  if (keyCode == DWIN_KEY_PAGE63_SCAN) g_page63ScanReq = true;
  else if (keyCode == DWIN_KEY_PAGE63_NEXT) g_page63NextReq = true;
  else if (keyCode == DWIN_KEY_PAGE63_PREV) g_page63PrevReq = true;
  else return;

  g_page63LastKeyCode = keyCode;
  Serial.printf("[P63] key=0x%04X (ATmega)\n", (unsigned)keyCode);
}

static bool atmegaHandleAsciiByte(uint8_t b) {
  if (!g_atmegaLineActive) {
    if (b == '@') {
      g_atmegaLineActive = true;
      g_atmegaLineDrop = false;
      g_atmegaLineLen = 0;
      return true;
    }
    return false;
  }

  if (b == '\r') {
    return true;
  }

  if (b == '\n') {
    if (!g_atmegaLineDrop && g_atmegaLineLen > 0) {
      g_atmegaLineBuf[g_atmegaLineLen] = 0;
      if (strncmp(g_atmegaLineBuf, "P63|K|", 6) == 0) {
        const char* keyTxt = &g_atmegaLineBuf[6];
        uint16_t key = (uint16_t)strtoul(keyTxt, nullptr, 16);
        page63HandleAtmegaKeyCode(key);
      } else if (strncmp(g_atmegaLineBuf, "RKC|", 4) == 0) {
        char* savePtr = nullptr;
        char* pageTxt = strtok_r(&g_atmegaLineBuf[4], "|", &savePtr);
        char* keyTxt = strtok_r(nullptr, "|", &savePtr);
        if (pageTxt && keyTxt) {
          uint32_t pageRaw = strtoul(pageTxt, nullptr, 10);
          uint32_t keyRaw = strtoul(keyTxt, nullptr, 16);
          if (pageRaw <= 255U) {
            uint8_t page = (uint8_t)pageRaw;
            uint16_t key = (uint16_t)(keyRaw & 0xFFFFU);
            logRkcEvent(page, key, true);
          }
        }
      } else if (strncmp(g_atmegaLineBuf, "ENG|R|", 6) == 0) {
        // [NEW FEATURE] Run/stop telemetry from firmware (Page62 0x8001 handler).
        unsigned long runState = 0;
        unsigned long totalJ = 0;
        if (sscanf(&g_atmegaLineBuf[6], "%lu|%lu", &runState, &totalJ) == 2) {
          g_teLastRealEventMs = millis();
          g_teFallbackTotalJ = (uint32_t)totalJ;
          teQueueRunEventFromAtmega((runState != 0UL) ? 1U : 0U, (uint32_t)totalJ);
          Serial.printf("[AT->ESP] ENG|R run=%lu total=%lu\n", runState, totalJ);
        }
      } else if (strncmp(g_atmegaLineBuf, "WIFI|S|", 7) == 0) {
        const char* ssid = &g_atmegaLineBuf[7];
        // Start a new explicit ATmega credential transaction on S.
        memset(g_atmegaPendingPass, 0, sizeof(g_atmegaPendingPass));
        g_atmegaPendingHavePass = false;
        atmegaCopyCredField(g_atmegaPendingSsid, sizeof(g_atmegaPendingSsid), ssid);
        g_atmegaPendingHaveSsid = (g_atmegaPendingSsid[0] != 0);
        Serial.printf("[AT->ESP] WIFI|S ssid='%s'\n", g_atmegaPendingSsid);
      } else if (strncmp(g_atmegaLineBuf, "WIFI|P|", 7) == 0) {
        const char* pass = &g_atmegaLineBuf[7];
        atmegaCopyCredField(g_atmegaPendingPass, sizeof(g_atmegaPendingPass), pass);
        g_atmegaPendingHavePass = true;
        Serial.printf("[AT->ESP] WIFI|P len=%u\n", (unsigned)strlen(g_atmegaPendingPass));
      } else if (strcmp(g_atmegaLineBuf, "WIFI|G") == 0) {
        if (g_atmegaPendingHaveSsid && g_atmegaPendingHavePass) {
          g_atmegaPendingConnectReq = true;
          g_atmegaPendingHaveSsid = false;
          g_atmegaPendingHavePass = false;
          Serial.printf("[AT->ESP] WIFI|G -> queue connect (ssid='%s', pass_len=%u)\n",
                        g_atmegaPendingSsid,
                        (unsigned)strlen(g_atmegaPendingPass));
        } else {
          Serial.printf("[AT->ESP] WIFI|G ignored (haveSsid=%u, havePass=%u)\n",
                        g_atmegaPendingHaveSsid ? 1U : 0U,
                        g_atmegaPendingHavePass ? 1U : 0U);
        }
      } else if (strncmp(g_atmegaLineBuf, "OTA|DEC|", 8) == 0) {
        unsigned long dec = strtoul(&g_atmegaLineBuf[8], nullptr, 10);
        if (dec <= 1UL) {
          g_webOtaDecisionReqValue = (int8_t)dec;
          Serial.printf("[AT->ESP] OTA decision=%lu\n", dec);
        } else {
          Serial.printf("[AT->ESP] OTA decision ignored (raw=%s)\n", g_atmegaLineBuf);
        }
      }
    }
    atmegaLineReset();
    return true;
  }

  if (g_atmegaLineDrop) {
    return true;
  }

  if (g_atmegaLineLen + 1 < sizeof(g_atmegaLineBuf)) {
    g_atmegaLineBuf[g_atmegaLineLen++] = (char)b;
  } else {
    g_atmegaLineDrop = true;
  }
  return true;
}

static uint8_t g_dwinPrev = 0;
static bool    g_seenDwinHeader = false;
static inline void mark_dwin_rx_byte(uint8_t b) {
  if (g_dwinPrev == 0x5A && b == 0xA5) g_seenDwinHeader = true;
  g_dwinPrev = b;
}


static const uint32_t ASSIST_WINDOW_MS       = 12000;
static const uint32_t AT_SILENCE_RESET_MS    = 900;
static const uint32_t CAPTURE_IDLE_END_MS    = 140;
static const uint32_t CAPTURE_MAX_MS         = 2500;
static const size_t   CAPTURE_MAX_BYTES      = 512;
static const size_t   CAPTURE_MIN_BYTES      = 12;

static const uint32_t REPLAY_DELAY_MS        = 250;
static const uint32_t REPLAY_INTERVAL_MS     = 250;
static const uint8_t  REPLAY_MAX_COUNT       = 2;

static const uint32_t ASSIST_COOLDOWN_MS     = 4000;

static uint32_t g_bootMs = 0;

static uint8_t  g_capBuf[CAPTURE_MAX_BYTES];
static size_t   g_capLen = 0;
static bool     g_captureActive = false;
static uint32_t g_captureStartMs = 0;
static uint32_t g_lastCapByteMs  = 0;

static bool     g_replayActive = false;
static uint8_t  g_replayCount = 0;
static uint32_t g_nextReplayMs = 0;

static uint32_t g_lastAtRxMs = 0;
static uint32_t g_lastAssistDoneMs = 0;
static bool     g_assistLockedOut = false;

static void setBridgeEnabledForSubscription(bool enable, const char* reason) {
  if (g_bridgeEnabled == enable) return;
  g_bridgeEnabled = enable;
  if (!enable) {
    g_captureActive = false;
    g_replayActive = false;
    g_capLen = 0;
  }
  Serial.printf("[SUB] bridge=%s (%s)\n", enable ? "ON" : "OFF", (reason ? reason : "-"));
}

static void clearSubscriptionLockPage() {
  g_subLockPage = 0xFF;
  g_subLockLastPushMs = 0;
}

static void atmegaPublishSubscriptionStateSimple(char stateCode) {
  char line[20];
  int n = snprintf(line, sizeof(line), "@SUB|%c\n", stateCode);
  if (n <= 0) return;
  if ((size_t)n >= sizeof(line)) n = (int)sizeof(line) - 1;

  g_atmegaSubStateCode = stateCode;
  g_atmegaSubPlanLabel[0] = 0;
  g_atmegaSubRange[0] = 0;
  g_atmegaSubRemainingDays = 0;
  g_lastAtmegaSubPublishMs = millis();

  ATMEGA.write((const uint8_t*)line, (size_t)n);
  ATMEGA.flush();
}

static void applyRegisteredReadyPage(const char* reason) {
  melauhfPowerSet(true);
  setBridgeEnabledForSubscription(true, reason);
  clearSubscriptionLockPage();
  atmegaPublishSubscriptionStateSimple('R');
  g_subGateState = SUB_GATE_ACTIVE;
  g_subBootResolved = true;
  lastWebSubscriptionOkMs = millis();
  Serial.printf("[SUB] registered ready -> ATmega (%s)\n", (reason ? reason : "-"));
}

static void pushSubscriptionLockPage(uint8_t page, const char* reason) {
  uint32_t now = millis();
  bool due = (g_subLockLastPushMs == 0) ||
             (page != g_subLockPage) ||
             ((uint32_t)(now - g_subLockLastPushMs) >= ATMEGA_STATE_REPUBLISH_MS);
  if (!due) return;
  if (page == 59) {
    atmegaPublishSubscriptionStateSimple('E');
  } else if (page == 20) {
    atmegaPublishSubscriptionStateSimple('O');
  } else if (page == DWIN_PAGE_DEVICE_UNREGISTERED) {
    atmegaPublishSubscriptionStateSimple('U');
  } else {
    return;
  }
  g_subLockPage = page;
  g_subLockLastPushMs = now;
  Serial.printf("[SUB] lock page=%u -> ATmega (%s)\n", (unsigned)page, (reason ? reason : "-"));
}

static void subscriptionEnterOfflineLock(const char* reason) {
  g_subGateState = SUB_GATE_OFFLINE;
  // ATmega owns all DWIN page changes, so the bridge must stay alive
  // even while the device is offline/locked.
  setBridgeEnabledForSubscription(true, reason);
  if (!g_subBootResolved) return;
  melauhfPowerSet(false);
  pushSubscriptionLockPage(20, reason);
}

static inline bool assist_allowed(uint32_t now) {
  if (g_assistLockedOut) return false;
  if (now - g_bootMs > ASSIST_WINDOW_MS) return false;
  if (g_seenDwinHeader) {
    g_assistLockedOut = true;
    return false;
  }
  if (g_lastAssistDoneMs && (now - g_lastAssistDoneMs < ASSIST_COOLDOWN_MS)) return false;
  return true;
}

static void assist_start_capture(uint32_t now) {
  g_captureActive = true;
  g_captureStartMs = now;
  g_lastCapByteMs = now;
  g_capLen = 0;
  g_replayActive = false;
  g_replayCount = 0;
  g_nextReplayMs = 0;

  Serial.println("[BRG] ATmega burst detected -> capture start");
}

static void assist_end_capture_and_schedule_replay(uint32_t now) {
  g_captureActive = false;

  if (g_capLen < CAPTURE_MIN_BYTES) {
    Serial.printf("[BRG] capture end len=%u (ignored)\n", (unsigned)g_capLen);
    g_capLen = 0;
    g_lastAssistDoneMs = now;
    return;
  }

  Serial.printf("[BRG] capture end len=%u -> schedule replay\n", (unsigned)g_capLen);
  g_replayActive = true;
  g_replayCount = 0;
  g_nextReplayMs = now + REPLAY_DELAY_MS;
}

static void assist_tick(uint32_t now) {
  if (g_captureActive) {
    if ((now - g_lastCapByteMs > CAPTURE_IDLE_END_MS) || (now - g_captureStartMs > CAPTURE_MAX_MS)) {
      assist_end_capture_and_schedule_replay(now);
    }
  }

  if (g_replayActive && now >= g_nextReplayMs) {
    if (g_replayCount < REPLAY_MAX_COUNT && g_capLen > 0) {
      g_replayCount++;
      Serial.printf("[BRG] replay #%u (%u bytes)\n", (unsigned)g_replayCount, (unsigned)g_capLen);
      dwin_write_raw_atomic(g_capBuf, g_capLen);
      g_nextReplayMs = now + REPLAY_INTERVAL_MS;
      return;
    }

    g_replayActive = false;
    Serial.println("[BRG] replay done");
    g_capLen = 0;
    g_lastAssistDoneMs = now;
  }
}

static void print_status() {
  const char* subState = "BOOT_WAIT";
  if (g_subGateState == SUB_GATE_ACTIVE) subState = "ACTIVE";
  else if (g_subGateState == SUB_GATE_EXPIRED) subState = "EXPIRED";
  else if (g_subGateState == SUB_GATE_RESTRICTED) subState = "EXPIRED";
  else if (g_subGateState == SUB_GATE_UNREGISTERED) subState = "UNREGISTERED";
  else if (g_subGateState == SUB_GATE_OFFLINE) subState = "OFFLINE";
  Serial.printf("[STATUS] bridge=%s, seenDwinHeader=%s\n",
                g_bridgeEnabled ? "ON" : "OFF",
                g_seenDwinHeader ? "YES" : "NO");
  Serial.printf("[STATUS] subGate=%s, bootResolved=%s, lastSubOkAgo=%lu ms\n",
                subState,
                g_subBootResolved ? "YES" : "NO",
                (unsigned long)(lastWebSubscriptionOkMs ? (millis() - lastWebSubscriptionOkMs) : 0));
  Serial.printf("[STATUS] assistAllowed=%s, capture=%s len=%u, replay=%s count=%u\n",
                assist_allowed(millis()) ? "YES" : "NO",
                g_captureActive ? "ON" : "OFF",
                (unsigned)g_capLen,
                g_replayActive ? "ON" : "OFF",
                (unsigned)g_replayCount);
}

static void atmegaRequestPageChange(uint8_t page) {
  char line[20];
  int n = snprintf(line, sizeof(line), "@PAGE|%u\n", (unsigned)page);
  if (n <= 0) return;
  if ((size_t)n >= sizeof(line)) n = (int)sizeof(line) - 1;
  ATMEGA.write((const uint8_t*)line, (size_t)n);
  ATMEGA.flush();
  Serial.printf("[ESP->AT] PAGE|%u\n", (unsigned)page);
}

static void handle_command(const String &lineRaw) {
  String line = lineRaw;
  line.trim();
  if (!line.length()) return;

  String op = line;
  String arg;
  int sp = line.indexOf(' ');
  if (sp >= 0) {
    op = line.substring(0, sp);
    arg = line.substring(sp + 1);
    arg.trim();
  }
  op.toLowerCase();

  if (op == "help") {
    Serial.println("Commands:");
    Serial.println("  help");
    Serial.println("  status");
    Serial.println("  bridge on|off");
    Serial.println("  ping");
    Serial.println("  reset_subscription");
    Serial.println("  reset_state");
    Serial.println("  page <n> / page1,page2,...");
    return;
  }

  if (op == "status") {
    print_status();
    return;
  }

  if (op == "bridge") {
    arg.toLowerCase();
    if (arg == "on") {
      g_bridgeEnabled = true;
      Serial.println("[BRIDGE] ON");
      return;
    }
    if (arg == "off") {
      g_bridgeEnabled = false;
      Serial.println("[BRIDGE] OFF");
      return;
    }
    Serial.println("Usage: bridge on|off");
    return;
  }

  if (op == "ping") {
    Serial.println("[ESP32] -> ping");
    g_pingWaiting = true;
    g_pingSentAt = millis();
    g_pingLine = "";
    ATMEGA.write("ping\r\n");
    return;
  }

  if (op == "reset_subscription" || op == "resetsubscription") {
    teResetSubscriptionState();
    Serial.println("[CMD] subscription state reset");
    return;
  }

  if (op == "reset_state" || op == "resetstate") {
    teResetLocalState();
    Serial.println("[CMD] local state reset");
    return;
  }

  if (op.startsWith("page") && op.length() > 4 && arg.length() == 0) {
    String n = op.substring(4);
    int pg = n.toInt();
    if (pg < 0) pg = 0;
    if (pg > 255) pg = 255;
    Serial.printf("[CMD] page %d\n", pg);
    atmegaRequestPageChange((uint8_t)pg);
    return;
  }

  if (op == "page") {
    int pg = arg.toInt();
    if (pg < 0) pg = 0;
    if (pg > 255) pg = 255;
    Serial.printf("[CMD] page %d\n", pg);
    atmegaRequestPageChange((uint8_t)pg);
    return;
  }

  Serial.println("Unknown command. Type: help");
}

static void pump_usb_serial() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      handle_command(g_cmdLine);
      g_cmdLine = "";
    } else {
      if (g_cmdLine.length() < 200) g_cmdLine += c;
    }
  }
}

struct _DwinForwardParser {
  uint8_t buf[192];
  uint16_t idx;
  uint8_t need;
  uint8_t state;
};

static _DwinForwardParser g_at2dForward = {{0}, 0, 0, 0};

static inline void _dwinForwardReset() {
  g_at2dForward.idx = 0;
  g_at2dForward.need = 0;
  g_at2dForward.state = 0;
}

static bool at2dFeedFrame(uint8_t b, const uint8_t*& frame, uint16_t& frameLen) {
  frame = nullptr;
  frameLen = 0;
  switch (g_at2dForward.state) {
    case 0:
      if (b == 0x5A) {
        g_at2dForward.buf[0] = b;
        g_at2dForward.idx = 1;
        g_at2dForward.state = 1;
      }
      break;
    case 1:
      if (b == 0xA5) {
        g_at2dForward.buf[1] = b;
        g_at2dForward.idx = 2;
        g_at2dForward.state = 2;
      } else if (b == 0x5A) {
        g_at2dForward.buf[0] = 0x5A;
        g_at2dForward.idx = 1;
      } else {
        _dwinForwardReset();
      }
      break;
    case 2:
      g_at2dForward.need = b;
      g_at2dForward.buf[2] = b;
      g_at2dForward.idx = 3;
      if (g_at2dForward.need < 2 || (uint16_t)(3 + g_at2dForward.need) > sizeof(g_at2dForward.buf)) {
        _dwinForwardReset();
      } else {
        g_at2dForward.state = 3;
      }
      break;
    case 3:
      g_at2dForward.buf[g_at2dForward.idx++] = b;
      if (g_at2dForward.idx >= (uint16_t)(3 + g_at2dForward.need)) {
        frame = g_at2dForward.buf;
        frameLen = g_at2dForward.idx;
        _dwinForwardReset();
        return true;
      }
      break;
  }
  return false;
}

static void pump_atmega_to_dwin(uint32_t now) {
  if (!g_bridgeEnabled) {
    _dwinForwardReset();
  }

  if (g_replayActive) {
    g_replayActive = false;
    g_replayCount = REPLAY_MAX_COUNT;
    g_capLen = 0;
    g_lastAssistDoneMs = now;
    _dwinForwardReset();
  }
  while (ATMEGA.available()) {
    int v = ATMEGA.read();
    if (v < 0) break;
    uint8_t b = (uint8_t)v;

    // Passive credential sniffer for ATmega text lines:
    // SSID:<...>\r\nPW:<...>\r\n
    // This does not consume bridge payload; it only prints to ESP USB log.
    atmegaSniffCredentialByte(b);

    if (g_atmegaLineActive || ((g_at2dForward.state == 0) && (b == '@'))) {
      if (atmegaHandleAsciiByte(b)) {
        continue;
      }
    }

    if (g_atmegaLineActive) {
      continue;
    }

    tele_sniff_atmega_to_dwin(b, now);
    uint32_t prevAtMs = g_lastAtRxMs;
    g_lastAtRxMs = now;

    if (g_pingWaiting) {
      if (b == '\r') continue;
      if (b == '\n') {
        String line = g_pingLine;
        g_pingLine = "";
        line.trim();
        if (line.equalsIgnoreCase("pong")) {
          Serial.println("[ESP32] <- pong");
          g_pingWaiting = false;
        }
        continue;
      }
      if (b >= 0x20 && b <= 0x7E) {
        if (g_pingLine.length() < 64) g_pingLine += (char)b;
        continue;
      }
    }

    if (g_bridgeEnabled && assist_allowed(now) && !g_captureActive && !g_replayActive) {
      if (prevAtMs == 0 || (now - prevAtMs > AT_SILENCE_RESET_MS)) {
        assist_start_capture(now);
      }
    }

    if (g_bridgeEnabled && g_captureActive) {
      g_lastCapByteMs = now;
      if (g_capLen < CAPTURE_MAX_BYTES) {
        g_capBuf[g_capLen++] = b;
      }
    }

    if (g_bridgeEnabled && !g_replayActive) {
      const uint8_t* frame = nullptr;
      uint16_t frameLen = 0;
      if (at2dFeedFrame(b, frame, frameLen)) {
        dwin_write_raw_atomic(frame, frameLen);
      }
    }
  }

  if (g_pingWaiting && (now - g_pingSentAt > 1500)) {
    Serial.println("[ESP32] pong TIMEOUT");
    g_pingWaiting = false;
  }
}


static void pump_dwin_to_atmega(uint32_t now) {
  while (DWIN.available()) {
    int v = DWIN.read();
    if (v < 0) break;
    uint8_t b = (uint8_t)v;
    mark_dwin_rx_byte(b);
    tele_sniff_dwin_to_atmega(b, now);
    if (g_bridgeEnabled) {
      ATMEGA.write(b);
    }
  }
}



static void mel_bridgeSetup() {
  g_bootMs = millis();
  Serial.println();
  Serial.println("[MEL] bridge init...");
  Serial.printf("[MEL] ATmega UART2 pins: RX=%d TX=%d @%lu\n", ATMEGA_RX_PIN, ATMEGA_TX_PIN, (unsigned long)ATMEGA_BAUD);
  Serial.printf("[MEL] DWIN  UART1 pins: RX=%d TX=%d @%lu\n", DWIN_RX_PIN, DWIN_TX_PIN, (unsigned long)DWIN_BAUD);
  ATMEGA.begin(ATMEGA_BAUD, SERIAL_8N1, ATMEGA_RX_PIN, ATMEGA_TX_PIN);
  DWIN.begin(DWIN_BAUD, SERIAL_8N1, DWIN_RX_PIN, DWIN_TX_PIN);
  if (!g_dwinTxMutex) {
    g_dwinTxMutex = xSemaphoreCreateMutex();
  }
  _dwinForwardReset();
  Serial.println("[MEL] bridge ready. Type 'help' for MEL commands.");
}

static TaskHandle_t g_melBridgeTaskHandle = nullptr;
static volatile bool g_melBridgeTaskRunning = false;

static inline void mel_bridge_ping_timeout_check(uint32_t now) {
  if (g_pingWaiting && (now - g_pingSentAt > 1500)) {
    Serial.println("[ESP32] pong TIMEOUT");
    g_pingWaiting = false;
  }
}

static void mel_bridgeTask(void *param) {
  (void)param;

  for (;;) {
    uint32_t now = millis();
    bool didWork = false;

    if (Serial.available()) {
      pump_usb_serial();
      didWork = true;
    }

    if (ATMEGA.available()) {
      pump_atmega_to_dwin(now);
      didWork = true;
    } else {
      mel_bridge_ping_timeout_check(now);
    }

    if (DWIN.available()) {
      pump_dwin_to_atmega(now);
      didWork = true;
    }

    if (g_bridgeEnabled && (assist_allowed(now) || g_captureActive || g_replayActive)) {
      assist_tick(now);
      didWork = true;
    }

    if (!didWork) {
      vTaskDelay(1);
    } else {
      taskYIELD();
    }
  }
}

static void mel_bridgeStartTask() {
  if (g_melBridgeTaskRunning) return;

  const UBaseType_t prio = 3;
  const uint32_t stackWords = 4096;

  if (xTaskCreate(mel_bridgeTask, "mel_bridge", stackWords, nullptr, prio, &g_melBridgeTaskHandle) == pdPASS) {
    g_melBridgeTaskRunning = true;
    Serial.println("[MEL] bridge task started");
  } else {
    g_melBridgeTaskHandle = nullptr;
    g_melBridgeTaskRunning = false;
    Serial.println("[MEL] ERROR: bridge task start failed");
  }
}

extern "C" {
#include "esp_wifi.h"
}
#include "esp_log.h"

static const char* AP_SSID = "ABBA-S";
static const char* AP_PASS = "fori3145!!!";

static const char* PORTAL_DOMAIN = "abba-s.com";

IPAddress AP_IP(192, 168, 4, 1);
IPAddress AP_GW(192, 168, 4, 1);
IPAddress AP_SN(255, 255, 255, 0);

static const uint16_t DNS_PORT = 53;

static const int MAX_CONNECT_TRIES = 3;
static const uint32_t CONNECT_TIMEOUT_MS = 25000;

static const bool CONTINUOUS_RETRY_WITH_SAVED_CREDS = true;
static const uint32_t RETRY_BASE_MS = 2000;
static const uint32_t RETRY_MAX_MS  = 30000;
static const uint32_t RETRY_JITTER_MS = 300;

static const bool USE_5G_AP = false;
static const int  AP_CH_24G = 1;
static const int  AP_CH_5G  = 36;
static const int  AP_MAX_CONN = 4;

static const bool FORCE_AP_2G_BANDMODE = true;
static const bool STA_USE_5G_ONLY      = false;
static const bool WIFI_LOG_SILENCE     = true;

static const uint32_t SCAN_COOLDOWN_MS = 2500;
static const int MAX_SCAN_RESULTS = 15;

#ifndef WIFI_SCAN_RUNNING
#define WIFI_SCAN_RUNNING (-1)
#endif
#ifndef WIFI_SCAN_FAILED
#define WIFI_SCAN_FAILED (-2)
#endif

static const uint8_t DWIN_PAGE63_SLOTS = 5;
static const uint8_t DWIN_PAGE63_SSID_TEXT_LEN = 32;
static const uint8_t DWIN_PAGE63_SEC_TEXT_LEN = 12;
static const uint8_t DWIN_PAGE63_MAX_RESULTS = (uint8_t)MAX_SCAN_RESULTS;
static const uint32_t DWIN_PAGE63_STATUS_HB_MS = 1000;

struct Page63WifiResult {
  char ssid[DWIN_PAGE63_SSID_TEXT_LEN + 1];
  char sec[DWIN_PAGE63_SEC_TEXT_LEN + 1];
  bool locked;
};

static Page63WifiResult g_page63WifiResults[DWIN_PAGE63_MAX_RESULTS];
static uint8_t g_page63WifiCount = 0;
static uint8_t g_page63WifiPage = 0;
static bool g_page63ScanRunning = false;
static bool g_page63ListDirty = true;
static uint8_t g_page63LastSeenPage = 0xFF;
static bool g_page63EntryLogged = false;
static uint32_t g_page63LastStatusMs = 0;
static uint8_t g_page63LastStatusConnected = 0xFF;

#ifndef WEB_SERVER_BASE_URL
#define WEB_SERVER_BASE_URL "https://www.yjcooperation.com"
#endif

#ifndef FIRMWARE_FAMILY
#define FIRMWARE_FAMILY "ABBAS_ESP32C5_MELAUHF"
#endif
#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "26.3.13.1"
#endif
#ifndef FIRMWARE_BUILD_ID
#define FIRMWARE_BUILD_ID "ota-base"
#endif

#ifndef DEVICE_MODEL
#define DEVICE_MODEL "ABBA-S"
#endif

#ifndef WEB_AUTH_TOKEN
#define WEB_AUTH_TOKEN DEVICE_MODEL
#endif

#ifndef DEVICE_CUSTOMER
#define DEVICE_CUSTOMER "-"
#endif
#ifndef WEB_TLS_INSECURE
#define WEB_TLS_INSECURE 0
#endif
#ifndef WEB_TLS_CA_CERT
#define WEB_TLS_CA_CERT ""
#endif
#ifndef ENABLE_LAN_SERVICES
#define ENABLE_LAN_SERVICES 0
#endif
static const char* WEB_REGISTER_PATH = "/api/device/register";
static const char* WEB_HEARTBEAT_PATH = "/api/device/heartbeat";
static const char* WEB_TELEMETRY_PATH = "/api/device/telemetry";
static const char* WEB_LOG_UPLOAD_PATH = "/api/device/log-upload";
static const char* WEB_OTA_REPORT_PATH = "/api/device/ota/report";
static const uint32_t WEB_REGISTER_PERIOD_MS = 600000;
static const uint32_t WEB_HEARTBEAT_PERIOD_MS = 30000;
static const uint32_t WEB_TELEMETRY_PERIOD_MS = 60000;
static const uint32_t WEB_TELEMETRY_FORCE_PERIOD_MS = 300000;
static const uint32_t WEB_SUBSCRIPTION_SYNC_PERIOD_MS = 600000;
static const uint32_t WEB_DEVICE_REGISTERED_SYNC_PERIOD_MS = 21600000;
static const uint32_t WEB_DEVICE_REGISTERED_RECHECK_PERIOD_MS = 5000;
static const uint32_t WEB_FIRMWARE_CHECK_PERIOD_MS = 1800000;
static const uint32_t WEB_OTA_BOOT_REPORT_RETRY_MS = 15000;
static const uint32_t WEB_OTA_POST_CONNECT_DELAY_MS = 15000;
static const uint32_t WEB_LOG_UPLOAD_STEP_MS = 250;
static const uint32_t WEB_LOG_UPLOAD_RETRY_MS = 5000;
static const uint16_t WEB_LOG_UPLOAD_CHUNK_BYTES = 384;
static const uint16_t WEB_HTTP_CONNECT_TIMEOUT_MS = 2000;
static const uint16_t WEB_HTTP_RESPONSE_TIMEOUT_MS = 2500;
static const uint16_t WEB_OTA_HTTP_CONNECT_TIMEOUT_MS = 5000;
static const uint16_t WEB_OTA_HTTP_RESPONSE_TIMEOUT_MS = 30000;

static const uint16_t TCP_PORT = 5000;
static const uint16_t DISCOVERY_PORT = 4210;
static const char* DISCOVERY_MAGIC = "DISCOVER_FOR_RND";
static const char* DISCOVERY_REPLY_PREFIX = "FOR_RND_DEVICE|";
static const char* DEVICE_NAME = DEVICE_MODEL;

static const uint32_t MEASURE_INTERVAL_MS = 200;

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
static const char* SD_LOG_FILE_PATH = "/MELAUHF_Log.txt";
// [NEW FEATURE] SD ledger file for session/day/device energy tracking.
static const char* SD_TOTAL_ENERGY_FILE_PATH = "/TotalEnergy.txt";
// [NEW FEATURE] Temporary file used when compacting TotalEnergy ledger in place.
static const char* SD_TOTAL_ENERGY_TEMP_PATH = "/TotalEnergy.tmp";
static const uint32_t SD_PROBE_INTERVAL_NO_CARD_MS = 2000;
static const uint32_t SD_PROBE_INTERVAL_NO_CARD_MAX_MS = 8000;
static const uint32_t SD_PROBE_INTERVAL_WITH_CARD_MS = 5000;
static const uint32_t SD_STATS_REFRESH_MS = 120000;
static const uint32_t SD_HEAVY_STATS_REFRESH_MS = 300000;
static const uint32_t SD_LOG_MIN_INTERVAL_MS = 3000;
static const uint32_t SD_SPI_FREQ_HZ = 1000000;
static const uint8_t SD_REMOVE_FAIL_STREAK = 2;
static const time_t CLOCK_VALID_EPOCH = (time_t)1704067200; // 2024-01-01 00:00:00 UTC
static const uint32_t NTP_RESYNC_INTERVAL_MS = 60000;
// [NEW FEATURE] Periodic push interval for energy metrics to ATmega firmware.
static const uint32_t ENERGY_PUSH_INTERVAL_MS = 4000;

#ifndef DEVICE_TZ_INFO
#define DEVICE_TZ_INFO "KST-9"
#endif
#ifndef DEVICE_NTP_SERVER_1
#define DEVICE_NTP_SERVER_1 "pool.ntp.org"
#endif
#ifndef DEVICE_NTP_SERVER_2
#define DEVICE_NTP_SERVER_2 "time.google.com"
#endif
#ifndef DEVICE_NTP_SERVER_3
#define DEVICE_NTP_SERVER_3 "time.cloudflare.com"
#endif

#ifndef PIN_R
#define PIN_R 8
#endif
#ifndef PIN_G
#define PIN_G 26
#endif
#ifndef PIN_B
#define PIN_B 25
#endif
#ifndef PIN_BTN
#define PIN_BTN 23
#endif

#ifndef MELAUHF_POWER_EN_PIN
#define MELAUHF_POWER_EN_PIN -1
#endif
#ifndef MELAUHF_POWER_ON_LEVEL
#define MELAUHF_POWER_ON_LEVEL HIGH
#endif

static const uint32_t BTN_HOLD_MS = 2000;
static const uint32_t RGB_BLINK_MS = 300;
static const uint32_t COMM_OK_WINDOW_MS = 35000;

#ifndef BOOT_PIN
#define BOOT_PIN 28
#endif

WebServer server(80);
DNSServer dnsServer;
Preferences prefs;

WiFiUDP udp;
WiFiServer tcpServer(TCP_PORT);
WiFiClient tcpClient;
bool netServicesStarted = false;

WiFiClient webPlainClient;
WiFiClientSecure webSecureClient;
bool webSecureClientReady = false;
static uint8_t g_otaDownloadBuf[2048] = {0};
static uint8_t g_otaShaRaw[32] = {0};
static char g_otaShaHex[65] = {0};
static char g_otaDidEnc[96] = {0};
static char g_otaPath[320] = {0};
static char g_otaUrl[512] = {0};
static char g_otaTargetFamily[96] = {0};
static char g_otaTargetVersion[64] = {0};
static char g_otaTargetBuildId[64] = {0};
static char g_otaDownloadPath[192] = {0};
static char g_otaExpectedSha256[80] = {0};
static char g_otaErrorMsg[96] = {0};
static uint32_t g_lastStaConnectedMs = 0;
static bool g_webFirmwareImmediateCheckPending = false;
static uint32_t g_webFirmwareImmediateCheckAtMs = 0;
static uint32_t g_webFirmwareSkipLogMs = 0;
static char g_webFirmwareLastSkipReason[40] = {0};
static mbedtls_sha256_context g_otaShaCtx;

uint32_t lastWebRegisterMs = 0;
uint32_t lastWebHeartbeatMs = 0;
uint32_t lastWebTelemetryMs = 0;
uint32_t lastWebTelemetryForceMs = 0;
uint32_t lastWebSubscriptionSyncMs = 0;
uint32_t lastWebDeviceRegisteredSyncMs = 0;
uint32_t lastWebFirmwareCheckMs = 0;
uint32_t lastWebOtaBootReportMs = 0;
static char cachedDeviceId[18] = {0};
static char cachedDeviceToken[33] = {0};
uint32_t lastWebOkMs = 0;
uint32_t lastWebFailMs = 0;
static bool g_webDeviceRegisteredKnown = false;
static bool g_webDeviceRegistered = true;
static bool g_webTelemetryDirty = true;
static uint64_t g_lastHandledCommandId = 0;
static bool g_lastHandledCommandLoaded = false;
static bool g_webOtaPendingBootReport = false;
static uint64_t g_webOtaPendingReleaseId = 0;

wl_status_t lastStaStatus = WL_IDLE_STATUS;

String savedSsid;
String savedPass;

bool portalMode = false;
uint32_t portalShutdownAtMs = 0;
bool portalConnectInProgress = false;
bool portalConnectDone = false;
uint32_t portalConnectDoneMs = 0;
bool portalLastConnectOk = false;
bool portalSuccessPageServed = false;
uint32_t portalShutdownForceAtMs = 0;
uint32_t portalConnectStartMs = 0;
static char portalPendingSsid[33] = {0};
static char portalPendingPass[65] = {0};
uint32_t lastScanMs = 0;

uint32_t nextStaAttemptMs = 0;
uint32_t staBackoffMs = RETRY_BASE_MS;
uint32_t lastStaAttemptMs = 0;
int      staAttemptCount = 0;


bool booting = true;
uint32_t bootDoneMs = 0;
static const uint32_t BOOT_BLUE_HOLD_MS = 900;

static char lastOutLine[40] = "0W,0";
uint32_t lastMeasTickMs = 0;
// [NEW FEATURE] Assigned plan energy + plan date context from WEB API.
static uint64_t g_assignedEnergyJ = 0;
static char g_planStartDate[20] = {0};
static int g_planRemainingDays = 0;

// [NEW FEATURE] Runtime/session ledger state (persisted with Preferences).
static bool g_teSessionActive = false;
static uint64_t g_teSessionStartTotalJ = 0;
static char g_teSessionStartDate[11] = {0};
static char g_teSessionStartTime[9] = {0};
static char g_teCurrentDayDate[11] = {0};
static uint64_t g_teCurrentDayTotalJ = 0;
static uint64_t g_teDeviceTotalJ = 0;

// [NEW FEATURE] Deferred run-event handoff from bridge task to loop task.
struct TeRunEventItem {
  uint8_t runState;
  uint32_t totalJ;
};
static const uint8_t TE_RUN_EVENT_Q_CAP = 16;
static TeRunEventItem g_teRunEventQ[TE_RUN_EVENT_Q_CAP];
static volatile uint8_t g_teRunEventQHead = 0;
static volatile uint8_t g_teRunEventQTail = 0;
static volatile uint32_t g_teRunEventDropCount = 0;
// [NEW FEATURE] De-dup guard for mirrored UART run-event lines.
static volatile uint8_t g_teLastQueuedRunState = 0xFF;
// [NEW FEATURE] De-dup guard for mirrored UART run-event lines.
static volatile uint32_t g_teLastQueuedTotalJ = 0;
// [NEW FEATURE] De-dup guard for mirrored UART run-event lines.
static volatile uint32_t g_teLastQueuedMs = 0;

// [NEW FEATURE] Last published metric cache to avoid redundant UART spam.
static uint64_t g_teLastPubAssignedJ = UINT64_MAX;
static uint64_t g_teLastPubUsedJ = UINT64_MAX;
static uint64_t g_teLastPubDailyAvgJ = UINT64_MAX;
static uint64_t g_teLastPubMonthlyAvgJ = UINT64_MAX;
static uint64_t g_teLastPubProjectedJ = UINT64_MAX;
static uint32_t g_teLastPubElapsedDays = UINT32_MAX;
static uint32_t g_teLastPubRemainDays = UINT32_MAX;
static uint32_t g_teLastPushMs = 0;
// [NEW FEATURE] Tracks whether /TotalEnergy.txt bootstrap exists for current SD mount cycle.
static bool g_teLedgerFileReady = false;

static bool g_sdInserted = false;
static uint32_t g_sdNoCardProbeIntervalMs = SD_PROBE_INTERVAL_NO_CARD_MS;
static uint64_t g_sdTotalMB = 0;
static uint64_t g_sdUsedMB = 0;
static uint64_t g_sdFreeMB = 0;
static uint32_t g_sdLastProbeMs = 0;
static uint32_t g_sdLastStatsMs = 0;
static uint32_t g_sdLastHeavyStatsMs = 0;
static uint32_t g_sdLastLogWriteMs = 0;
static uint8_t g_sdFailStreak = 0;
static bool g_sdDirty = false;
static char g_sdLastLoggedLine[96] = {0};
static uint8_t g_sdLastLoggedPage = 0xFF;
static bool g_timeSyncRequested = false;
static bool g_timeSynced = false;
static uint32_t g_timeLastRequestMs = 0;

struct WebLogUploadJob {
  const char* kind;
  const char* path;
  uint32_t desiredVersion;
  uint32_t syncedVersion;
  uint32_t uploadVersion;
  bool active;
  size_t fileSize;
  uint32_t chunkIndex;
  uint32_t chunkTotal;
  uint32_t nextAttemptMs;
};

static WebLogUploadJob g_webLogUploadJobs[] = {
  {"activity", SD_LOG_FILE_PATH, 0, 0, 0, false, 0, 0, 0, 0},
  {"energy", SD_TOTAL_ENERGY_FILE_PATH, 0, 0, 0, false, 0, 0, 0, 0},
};
static uint8_t g_webLogUploadNextSlot = 0;

static void onWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info);

static bool setBandMode2G() {
#if defined(WIFI_BAND_MODE_2G)
  esp_err_t e = esp_wifi_set_bandmode(WIFI_BAND_MODE_2G);
  if (e != ESP_OK) {
    Serial.printf("[BAND] esp_wifi_set_bandmode(2G) failed: %d\n", (int)e);
    return false;
  }
  Serial.println("[BAND] AP bandmode forced to 2.4GHz (2G)");
  return true;
#else
  Serial.println("[BAND] WIFI_BAND_MODE_2G not available in this core; using channel-only 2.4GHz AP");
  return false;
#endif
}

static bool setBandModeSTA() {
#if defined(WIFI_BAND_MODE_5G) && defined(WIFI_BAND_MODE_AUTO)
  wifi_band_mode_t m = STA_USE_5G_ONLY ? WIFI_BAND_MODE_5G : WIFI_BAND_MODE_AUTO;
  esp_err_t e = esp_wifi_set_bandmode(m);
  if (e != ESP_OK) {
    Serial.printf("[BAND] esp_wifi_set_bandmode(STA %s) failed: %d\n", STA_USE_5G_ONLY ? "5G" : "AUTO", (int)e);
    return false;
  }
  Serial.printf("[BAND] STA bandmode set to %s\n", STA_USE_5G_ONLY ? "5G" : "AUTO");
  return true;
#elif defined(WIFI_BAND_MODE_AUTO)
  esp_err_t e = esp_wifi_set_bandmode(WIFI_BAND_MODE_AUTO);
  if (e != ESP_OK) {
    Serial.printf("[BAND] esp_wifi_set_bandmode(AUTO) failed: %d\n", (int)e);
    return false;
  }
  Serial.println("[BAND] STA bandmode set to AUTO");
  return true;
#else
  Serial.println("[BAND] bandmode API not available; keeping default");
  return false;
#endif
}


static const char* wifiEventName(int e) {
#if defined(ARDUINO_EVENT_WIFI_READY)
  switch (e) {
    case ARDUINO_EVENT_WIFI_READY: return "WIFI_READY";
    case ARDUINO_EVENT_WIFI_SCAN_DONE: return "SCAN_DONE";
    case ARDUINO_EVENT_WIFI_STA_START: return "STA_START";
    case ARDUINO_EVENT_WIFI_STA_STOP: return "STA_STOP";
    case ARDUINO_EVENT_WIFI_STA_CONNECTED: return "STA_CONNECTED";
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED: return "STA_DISCONNECTED";
    case ARDUINO_EVENT_WIFI_STA_GOT_IP: return "STA_GOT_IP";
    case ARDUINO_EVENT_WIFI_STA_LOST_IP: return "STA_LOST_IP";
    case ARDUINO_EVENT_WIFI_AP_START: return "AP_START";
    case ARDUINO_EVENT_WIFI_AP_STOP: return "AP_STOP";
    case ARDUINO_EVENT_WIFI_AP_STACONNECTED: return "AP_STACONNECTED";
    case ARDUINO_EVENT_WIFI_AP_STADISCONNECTED: return "AP_STADISCONNECTED";
    default: return "EVENT";
  }
#else
  return "EVENT";
#endif
}

static bool clockIsValid() {
  return time(nullptr) >= CLOCK_VALID_EPOCH;
}

static void requestTimeSync(bool force) {
  if (WiFi.status() != WL_CONNECTED) return;

  uint32_t nowMs = millis();
  if (!force && g_timeSyncRequested &&
      (uint32_t)(nowMs - g_timeLastRequestMs) < NTP_RESYNC_INTERVAL_MS) {
    return;
  }

  configTzTime(DEVICE_TZ_INFO, DEVICE_NTP_SERVER_1, DEVICE_NTP_SERVER_2, DEVICE_NTP_SERVER_3);
  g_timeSyncRequested = true;
  g_timeLastRequestMs = nowMs;
  Serial.printf("[TIME] NTP sync requested (tz=%s)\n", DEVICE_TZ_INFO);
}

static void timeSyncTick() {
  if (WiFi.status() != WL_CONNECTED) return;

  if (clockIsValid()) {
    if (!g_timeSynced) {
      g_timeSynced = true;
      time_t nowEpoch = time(nullptr);
      struct tm nowTm;
      memset(&nowTm, 0, sizeof(nowTm));
      localtime_r(&nowEpoch, &nowTm);
      Serial.printf("[TIME] NTP sync complete: %04d-%02d-%02d %02d:%02d:%02d\n",
                    nowTm.tm_year + 1900, nowTm.tm_mon + 1, nowTm.tm_mday,
                    nowTm.tm_hour, nowTm.tm_min, nowTm.tm_sec);
    }
    return;
  }

  g_timeSynced = false;
  requestTimeSync(false);
}

static void onWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
  (void)info;
  Serial.printf("[EVT] %s (%d)\n", wifiEventName((int)event), (int)event);

  if ((int)event == (int)ARDUINO_EVENT_WIFI_STA_GOT_IP || (int)event == (int)ARDUINO_EVENT_WIFI_STA_CONNECTED) {
    Serial.printf("[EVT] STA ssid='%s' status=%s(%d)\n",
                  WiFi.SSID().c_str(), wlStatusStr(WiFi.status()), (int)WiFi.status());
  }
  if ((int)event == (int)ARDUINO_EVENT_WIFI_STA_GOT_IP) {
    Serial.printf("[EVT] STA IP=%s RSSI=%d dBm\n",
                  WiFi.localIP().toString().c_str(), (int)WiFi.RSSI());
    requestTimeSync(true);
  }
  if ((int)event == (int)ARDUINO_EVENT_WIFI_AP_START) {
    Serial.printf("[EVT] AP SSID='%s' IP=%s\n", AP_SSID, WiFi.softAPIP().toString().c_str());
  }
}
static const char HTML_PAGE[] PROGMEM = R"HTML(
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ABBA-S WiFi Setup</title>
  <style>
    :root{
      --blue:#3b4bff;
      --text:#1f2937;
      --muted:#6b7280;
      --border:#e5e7eb;
      --bg:#ffffff;
      --soft:#f3f4f6;
    }
    body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#fff;color:var(--text);}
    .wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;}
    .card{width:min(520px,92vw);text-align:center;}
    h1{margin:0 0 10px 0;font-size:44px;letter-spacing:-0.5px;color:var(--blue);}
    .sub{margin:0 0 22px 0;color:var(--muted);font-size:13px;}
    .field{display:flex;align-items:center;gap:10px;border:1px solid var(--border);border-radius:10px;padding:14px 14px;background:var(--bg);margin:12px auto;box-sizing:border-box;}
    .icon{width:18px;height:18px;opacity:.55;flex:0 0 auto;}
    input,select{border:0;outline:none;width:100%;font-size:14px;color:var(--text);background:transparent;}
    .row{display:flex;gap:10px;align-items:stretch;justify-content:center;margin-top:6px;}
    .btn{width:100%;padding:14px 16px;border:0;border-radius:10px;background:var(--blue);color:#fff;font-weight:600;cursor:pointer;margin-top:10px;box-shadow:0 8px 20px rgba(59,75,255,.25);}
    .btn:active{transform:translateY(1px);}
    .btn-soft{width:140px;padding:12px 14px;border-radius:10px;border:1px solid var(--border);background:var(--soft);color:#111827;font-weight:600;cursor:pointer;box-shadow:none;margin-top:0;}
    .btn-soft:active{transform:translateY(1px);}
    .hint{margin-top:10px;color:var(--muted);font-size:12px;line-height:1.45;text-align:left;}
    .status{margin-top:10px;font-size:12px;color:var(--muted);min-height:18px;text-align:left;}
    .ok{color:#0f766e;font-weight:600;}
    .err{color:#b91c1c;font-weight:600;}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>ABBA-S</h1>
      <p class="sub">abba-s & foriver iot test</p>

      <div class="field">
        <svg class="icon" viewBox="0 0 24 24" fill="none">
          <path d="M4 20c0-3.314 3.582-6 8-6s8 2.686 8 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" stroke-width="2"/>
        </svg>
        <select id="ssidSelect">
          <option value="">주변 Wi-Fi 목록을 불러오려면 Scan을 누르세요</option>
        </select>
      </div>

      <div class="row">
        <button class="btn-soft" id="scanBtn" type="button">Scan</button>
        <button class="btn-soft" id="useBtn" type="button">선택 SSID 사용</button>
      </div>

      <form method="POST" action="/connect" style="margin-top:14px;">
        <div class="field">
          <svg class="icon" viewBox="0 0 24 24" fill="none">
            <path d="M3 7h18M6 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" stroke="currentColor" stroke-width="2"/>
          </svg>
          <input id="ssidInput" name="ssid" placeholder="Enter Wi-Fi SSID" required maxlength="32" />
        </div>

        <div class="field">
          <svg class="icon" viewBox="0 0 24 24" fill="none">
            <path d="M7 11V8a5 5 0 0 1 10 0v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M6 11h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z" stroke="currentColor" stroke-width="2"/>
          </svg>
          <input name="pass" type="password" placeholder="Enter Wi-Fi Password" maxlength="64" />
        </div>

        <button class="btn" type="submit">접속</button>
      </form>

      <div class="status" id="status"></div>

      <div class="hint">
        - Scan → 주변 Wi-Fi 목록을 불러옵니다.<br>
        - “선택 SSID 사용”을 누르면 입력칸에 자동 입력됩니다.<br>
        - 접속 성공 시 저장되어 다음 전원 ON 시 바로 접속합니다.<br>
        - <b>BOOT 버튼을 2초 이상</b> 길게 누르면 저장된 Wi-Fi가 삭제되고 AP가 다시 켜집니다.
      </div>
    </div>
  </div>

<script>
  const statusEl = document.getElementById('status');
  const ssidSelect = document.getElementById('ssidSelect');
  const ssidInput  = document.getElementById('ssidInput');
  const scanBtn    = document.getElementById('scanBtn');
  const useBtn     = document.getElementById('useBtn');

  function setStatus(text, cls){
    statusEl.className = 'status ' + (cls||'');
    statusEl.textContent = text || '';
  }

  async function scanWifi(){
    setStatus('스캔 중...', '');
    scanBtn.disabled = true;
    try{
      const res = await fetch('/scan', {cache:'no-store'});
      if(!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();

      ssidSelect.innerHTML = '';
      if(!data || !data.networks || data.networks.length === 0){
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '검색된 Wi-Fi가 없습니다';
        ssidSelect.appendChild(opt);
        setStatus('검색된 Wi-Fi가 없습니다.', 'err');
        return;
      }

      const ph = document.createElement('option');
      ph.value = '';
      ph.textContent = 'SSID 선택 (Signal / Security)';
      ssidSelect.appendChild(ph);

      data.networks.forEach(n=>{
        const opt = document.createElement('option');
        opt.value = n.ssid;
        opt.textContent = `${n.ssid}   (${n.rssi} dBm, ${n.sec})`;
        ssidSelect.appendChild(opt);
      });

      setStatus(`스캔 완료: ${data.networks.length}개`, 'ok');
    }catch(e){
      setStatus('스캔 실패: ' + e.message, 'err');
    }finally{
      scanBtn.disabled = false;
    }
  }

  scanBtn.addEventListener('click', scanWifi);

  useBtn.addEventListener('click', ()=>{
    if(ssidSelect.value){
      ssidInput.value = ssidSelect.value;
      setStatus('SSID 입력칸에 적용됨: ' + ssidSelect.value, 'ok');
    }else{
      setStatus('SSID를 먼저 선택하세요.', 'err');
    }
  });
</script>
</body>
</html>
)HTML";

static String htmlMessagePage(const String& title, const String& msg, bool ok) {
  String s;
  s += "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>";
  s += "<title>" + title + "</title>";
  s += "<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#fff;color:#111827}"
       ".box{width:min(520px,92vw);text-align:center;padding:26px}"
       "h2{margin:0 0 10px 0;color:#3b4bff;font-size:28px}"
       "p{margin:0;color:#6b7280;line-height:1.5}"
       ".tag{margin-top:14px;display:inline-block;padding:10px 14px;border-radius:10px;background:#f3f4f6}"
       ".ok{color:#0f766e;font-weight:700}.err{color:#b91c1c;font-weight:700}"
       "a{color:#3b4bff;text-decoration:none;font-weight:600}</style></head><body>";
  s += "<div class='box'>";
  s += "<h2>" + title + "</h2>";
  s += "<p>" + msg + "</p>";
  s += "<div class='tag " + String(ok ? "ok" : "err") + "'>" + (ok ? "SUCCESS" : "FAILED") + "</div>";
  s += "<p style='margin-top:16px'><a href='/'>돌아가기</a></p>";
  s += "</div></body></html>";
  return s;
}

static void saveCreds(const String& ssid, const String& pass) {
  prefs.begin("abba-s", false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  prefs.end();
  Serial.printf("[CFG] Saved creds: ssid='%s' (pass_len=%d)\n", ssid.c_str(), (int)pass.length());
}

static void clearCreds() {
  prefs.begin("abba-s", false);
  prefs.remove("ssid");
  prefs.remove("pass");
  prefs.end();

  WiFi.disconnect(true, true);

  savedSsid = "";
  savedPass = "";

  Serial.println("[CFG] Cleared saved creds + WiFi.disconnect(true,true)");
}

static void loadCreds() {
  prefs.begin("abba-s", true);
  savedSsid = prefs.getString("ssid", "");
  savedPass = prefs.getString("pass", "");
  prefs.end();

  if (savedSsid.length() > 0) Serial.printf("[CFG] Loaded saved SSID='%s' (pass_len=%d)\n", savedSsid.c_str(), (int)savedPass.length());
  else Serial.println("[CFG] No saved credentials in NVS");
}

static const char* wlStatusStr(wl_status_t st) {
  switch (st) {
    case WL_NO_SHIELD: return "WL_NO_SHIELD";
    case WL_IDLE_STATUS: return "WL_IDLE_STATUS";
    case WL_NO_SSID_AVAIL: return "WL_NO_SSID_AVAIL";
    case WL_SCAN_COMPLETED: return "WL_SCAN_COMPLETED";
    case WL_CONNECTED: return "WL_CONNECTED";
    case WL_CONNECT_FAILED: return "WL_CONNECT_FAILED";
    case WL_CONNECTION_LOST: return "WL_CONNECTION_LOST";
    case WL_DISCONNECTED: return "WL_DISCONNECTED";
    default: return "WL_UNKNOWN";
  }
}

static void printStaInfoOnce() {
  Serial.printf("[STA] status=%s (%d)\n", wlStatusStr(WiFi.status()), (int)WiFi.status());
  Serial.printf("[STA] RSSI=%d dBm\n", (int)WiFi.RSSI());
  Serial.printf("[STA] IP=%s\n", WiFi.localIP().toString().c_str());
  Serial.printf("[STA] GW=%s\n", WiFi.gatewayIP().toString().c_str());
  Serial.printf("[STA] MASK=%s\n", WiFi.subnetMask().toString().c_str());
  Serial.printf("[STA] DNS=%s\n", WiFi.dnsIP().toString().c_str());
}

static bool waitForStaGotIP(uint32_t timeoutMs) {
  uint32_t t0 = millis();
  uint32_t lastPrint = 0;
  while (millis() - t0 < timeoutMs) {
    wl_status_t st = WiFi.status();
    IPAddress ip = WiFi.localIP();
    if (st == WL_CONNECTED && ip && ip != IPAddress(0,0,0,0)) {
      uint32_t stableT0 = millis();
      while (millis() - stableT0 < 1200) {
        if (WiFi.status() != WL_CONNECTED) break;
        delay(20);
      }
      if (WiFi.status() == WL_CONNECTED) return true;
    }
    if (millis() - lastPrint >= 1000) {
      lastPrint = millis();
      Serial.printf("[STA] ...connecting (%lu ms) status=%s ip=%s\n",
                    (unsigned long)(millis() - t0),
                    wlStatusStr(st),
                    ip.toString().c_str());
    }
    delay(120);
  }
  return false;
}

static bool tryConnectSTA(const String& ssid, const String& pass, int tries) {
  Serial.println("[STA] --- STA connect start ---");

  WiFi.mode(WIFI_STA);

  WiFi.disconnect(false, true);
  delay(200);

  setBandModeSTA();

  for (int i = 1; i <= tries; i++) {
    Serial.printf("[STA] Try %d/%d -> SSID='%s' (pass_len=%d)\n",
                  i, tries, ssid.c_str(), (int)pass.length());

    if (pass.length() == 0) WiFi.begin(ssid.c_str());
    else WiFi.begin(ssid.c_str(), pass.c_str());

    bool ok = waitForStaGotIP(CONNECT_TIMEOUT_MS);
    if (ok) {
    portalConnectDone = true;
    portalConnectInProgress = false;
    portalConnectDoneMs = millis();
      Serial.printf("[STA] ✅ Connected (try %d)\n", i);
      printStaInfoOnce();
      Serial.println("[STA] --- STA connect done ---");
      return true;
    }

    Serial.printf("[STA] ❌ Timeout/Fail (try %d). status=%s ip=%s\n",
                  i, wlStatusStr(WiFi.status()), WiFi.localIP().toString().c_str());

    WiFi.disconnect(false, true);
    delay(400);
  }

  Serial.println("[STA] --- STA connect failed (all tries) ---");
  return false;
}

static void scheduleNextStaAttempt(uint32_t nowMs) {
  if (staBackoffMs < RETRY_MAX_MS) {
    staBackoffMs = min(RETRY_MAX_MS, staBackoffMs * 2);
  }
  uint32_t jitter = (uint32_t)(esp_random() % (RETRY_JITTER_MS + 1));
  nextStaAttemptMs = nowMs + staBackoffMs + jitter;
}

static void resetStaBackoff(uint32_t nowMs) {
  staBackoffMs = RETRY_BASE_MS;
  uint32_t jitter = (uint32_t)(esp_random() % (RETRY_JITTER_MS + 1));
  nextStaAttemptMs = nowMs + jitter;
}

static void attemptStaConnectOnce(const String& ssid, const String& pass, bool keepAp) {
  if (ssid.length() == 0) return;

  if (keepAp) {
    WiFi.mode(WIFI_AP_STA);
  } else {
    WiFi.mode(WIFI_STA);
  }

  setBandModeSTA();

  Serial.printf("[STA] (bg) begin -> SSID='%s' pass_len=%d keepAp=%s attempt#=%d backoff=%lu ms\n",
                ssid.c_str(), (int)pass.length(), keepAp ? "true" : "false",
                staAttemptCount + 1, (unsigned long)staBackoffMs);

  if (pass.length() == 0) WiFi.begin(ssid.c_str());
  else WiFi.begin(ssid.c_str(), pass.c_str());

  staAttemptCount++;
  lastStaAttemptMs = millis();
}


static const char* secLabel(wifi_auth_mode_t auth) {
  switch (auth) {
    case WIFI_AUTH_OPEN: return "OPEN";
    case WIFI_AUTH_WEP: return "WEP";
    case WIFI_AUTH_WPA_PSK: return "WPA";
    case WIFI_AUTH_WPA2_PSK: return "WPA2";
    case WIFI_AUTH_WPA_WPA2_PSK: return "WPA/WPA2";
    case WIFI_AUTH_WPA2_ENTERPRISE: return "WPA2-ENT";
    case WIFI_AUTH_WPA3_PSK: return "WPA3";
    case WIFI_AUTH_WPA2_WPA3_PSK: return "WPA2/WPA3";
    default: return "SEC";
  }
}

static bool authNeedsLockIcon(wifi_auth_mode_t auth) {
  return strcmp(secLabel(auth), "OPEN") != 0;
}

static void rgbWrite(bool r, bool g, bool b) {
  digitalWrite(PIN_R, r ? HIGH : LOW);
  digitalWrite(PIN_G, g ? HIGH : LOW);
  digitalWrite(PIN_B, b ? HIGH : LOW);
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

static void updateRgbTick() {
  const uint32_t nowMs = millis();
  const bool blinkOn = ((nowMs / RGB_BLINK_MS) % 2) == 0;

  bool r = false, g = false, b = false;
  bool blink = false;

  if (booting || (bootDoneMs > 0 && (nowMs - bootDoneMs) < BOOT_BLUE_HOLD_MS)) {
    r = false; g = false; b = true;
    blink = false;
  } else {
    const bool wifiConnected = (WiFi.status() == WL_CONNECTED);

    bool connecting = false;
    if (portalConnectInProgress) connecting = true;
    if (!connecting && !wifiConnected && lastStaAttemptMs > 0) {
      if ((nowMs - lastStaAttemptMs) < CONNECT_TIMEOUT_MS) connecting = true;
    }
    else if (connecting) {
      r = true; g = true; b = false;
      blink = true;
    }
    else if (portalMode) {
      r = false; g = false; b = true;
      blink = true;
    }
    else if (wifiConnected) {
      r = false; g = true; b = false;
      blink = false;
    }
    else {
      bool failed = false;
      if (portalConnectDone && !wifiConnected) failed = true;
      if (lastStaAttemptMs > 0 && (nowMs - lastStaAttemptMs) >= CONNECT_TIMEOUT_MS) failed = true;

      if (failed) {
        r = true; g = false; b = false;
        blink = false;
      } else {
        r = false; g = false; b = true;
        blink = false;
      }
    }

    if (!portalMode && wifiConnected) {
      const bool commKnown = (lastWebOkMs > 0) || (lastWebFailMs > 0);
      if (commKnown) {
        const bool commOk = (lastWebOkMs > 0) && ((nowMs - lastWebOkMs) <= COMM_OK_WINDOW_MS);
        blink = true;
        if (commOk) {
          r = false; g = true; b = false;
        } else {
          r = true; g = false; b = false;
        }
      }
    }
  }

  if (blink && !blinkOn) {
    rgbWrite(false, false, false);
  } else {
    rgbWrite(r, g, b);
  }
}

static int btnStableState = LOW;
static int btnLastRead = LOW;
static uint32_t btnLastChangeMs = 0;
static uint32_t btnPressedStartMs = 0;
static bool btnLongFired = false;

static int bootBtnStableState = HIGH;
static int bootBtnLastRead = HIGH;
static uint32_t bootBtnLastChangeMs = 0;
static uint32_t bootBtnPressedStartMs = 0;
static bool bootBtnLongFired = false;

static bool bootPressedLong(uint32_t holdMs) {
  const uint32_t nowMs = millis();
  const int raw = digitalRead(PIN_BTN);


static bool seenLowOnce = false;
if (raw == LOW) seenLowOnce = true;
if (nowMs < 1500 || !seenLowOnce) {
  btnLastRead = raw;
  btnStableState = raw;
  btnPressedStartMs = 0;
  btnLongFired = false;
  btnLastChangeMs = nowMs;
  return false;
}

  if (raw != btnLastRead) {
    btnLastRead = raw;
    btnLastChangeMs = nowMs;
  }

  if ((nowMs - btnLastChangeMs) > 30 && raw != btnStableState) {
    btnStableState = raw;
    if (btnStableState == HIGH) {
      btnPressedStartMs = nowMs;
      btnLongFired = false;
    } else {
      btnPressedStartMs = 0;
      btnLongFired = false;
    }
  }

  if (btnStableState == HIGH && !btnLongFired && btnPressedStartMs > 0) {
    if ((nowMs - btnPressedStartMs) >= holdMs) {
      btnLongFired = true;
      return true;
    }
  }
  return false;
}

static bool boot0PressedLong(uint32_t holdMs) {
  const uint32_t nowMs = millis();
  const int raw = digitalRead(BOOT_PIN);

  static bool seenHighOnce = false;
  if (raw == HIGH) seenHighOnce = true;
  if (nowMs < 1500 || !seenHighOnce) {
    bootBtnLastRead = raw;
    bootBtnStableState = raw;
    bootBtnPressedStartMs = 0;
    bootBtnLongFired = false;
    bootBtnLastChangeMs = nowMs;
    return false;
  }

  if (raw != bootBtnLastRead) {
    bootBtnLastRead = raw;
    bootBtnLastChangeMs = nowMs;
  }

  if ((nowMs - bootBtnLastChangeMs) > 30 && raw != bootBtnStableState) {
    bootBtnStableState = raw;
    if (bootBtnStableState == LOW) {
      bootBtnPressedStartMs = nowMs;
      bootBtnLongFired = false;
    } else {
      bootBtnPressedStartMs = 0;
      bootBtnLongFired = false;
    }
  }

  if (bootBtnStableState == LOW && !bootBtnLongFired && bootBtnPressedStartMs > 0) {
    if ((nowMs - bootBtnPressedStartMs) >= holdMs) {
      bootBtnLongFired = true;
      return true;
    }
  }
  return false;
}

void doBootResetIfHeld() {
  if (bootPressedLong(BTN_HOLD_MS)) {
    Serial.println("[BTN] Long press detected -> clear creds and reboot");
    clearCreds();
    delay(300);
    ESP.restart();
  }
}

void doBootResetIfHeldOnboard() {
  if (boot0PressedLong(BTN_HOLD_MS)) {
    Serial.println("[BOOT] Long press detected -> clear creds and reboot");
    clearCreds();
    delay(300);
    ESP.restart();
  }
}






static void startNetServicesIfNeeded() {
  if (netServicesStarted) return;
#if !ENABLE_LAN_SERVICES
  return;
#endif

  bool okUdp = udp.begin(DISCOVERY_PORT);
  tcpServer.begin();
  netServicesStarted = true;

  Serial.printf("[NET] UDP discovery %s on %u, TCP stream on %u\n",
                okUdp ? "OK" : "FAIL", (unsigned)DISCOVERY_PORT, (unsigned)TCP_PORT);
  Serial.printf("[NET] STA IP=%s\n", WiFi.localIP().toString().c_str());
}

static void stopNetServicesIfNeeded() {
  if (!netServicesStarted) return;
#if !ENABLE_LAN_SERVICES
  netServicesStarted = false;
  return;
#endif

  if (tcpClient) {
    tcpClient.stop();
  }
  udp.stop();

  netServicesStarted = false;
  Serial.println("[NET] Services stopped");
}

static void ipToStr(const IPAddress& ip, char* out, size_t outSz) {
  if (!out || outSz < 8) return;
  snprintf(out, outSz, "%u.%u.%u.%u", (unsigned)ip[0], (unsigned)ip[1], (unsigned)ip[2], (unsigned)ip[3]);
}

static const char* deviceIdC() {
  if (cachedDeviceId[0] == 0) {
    uint8_t mac[6];
    WiFi.macAddress(mac);
    snprintf(cachedDeviceId, sizeof(cachedDeviceId), "%02X:%02X:%02X:%02X:%02X:%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  }
  return cachedDeviceId;
}

static const char* deviceTokenC() {
  if (cachedDeviceToken[0] != 0) return cachedDeviceToken;

  prefs.begin("abba-s", false);
  String v = prefs.getString("dev_uid", "");
  if (v.length() >= 16) {
    v.toCharArray(cachedDeviceToken, sizeof(cachedDeviceToken));
    prefs.end();
    Serial.printf("[TOKEN] Loaded dev_uid=%s\n", cachedDeviceToken);
    return cachedDeviceToken;
  }

  uint8_t b[16];
  for (int i = 0; i < 16; i += 4) {
    uint32_t r = esp_random();
    b[i + 0] = (uint8_t)(r >> 24);
    b[i + 1] = (uint8_t)(r >> 16);
    b[i + 2] = (uint8_t)(r >> 8);
    b[i + 3] = (uint8_t)(r);
  }
  static const char kHexDigits[] = "0123456789abcdef";
  for (int i = 0; i < 16; i++) {
    const uint8_t v = b[i];
    cachedDeviceToken[i * 2] = kHexDigits[(v >> 4) & 0x0F];
    cachedDeviceToken[i * 2 + 1] = kHexDigits[v & 0x0F];
  }
  cachedDeviceToken[32] = '\0';

  prefs.putString("dev_uid", cachedDeviceToken);
  prefs.end();
  Serial.printf("[TOKEN] Generated dev_uid=%s\n", cachedDeviceToken);
  return cachedDeviceToken;
}

static const char* firmwareFamilyC() {
  return FIRMWARE_FAMILY;
}

static const char* firmwareVersionC() {
  return FIRMWARE_VERSION;
}

static const char* firmwareBuildIdC() {
  return FIRMWARE_BUILD_ID;
}

static void otaSetPendingBootReport(bool pending, uint64_t releaseId = 0) {
  prefs.begin("abba-s", false);
  prefs.putBool("ota_pending", pending);
  if (pending && releaseId > 0) {
    prefs.putString("ota_release_id", String((unsigned long long)releaseId));
  } else {
    prefs.remove("ota_release_id");
  }
  prefs.end();
  g_webOtaPendingBootReport = pending;
  g_webOtaPendingReleaseId = (pending && releaseId > 0) ? releaseId : 0;
}

static bool otaLoadPendingBootReport() {
  prefs.begin("abba-s", true);
  bool pending = prefs.getBool("ota_pending", false);
  String releaseIdText = prefs.getString("ota_release_id", "");
  prefs.end();
  g_webOtaPendingBootReport = pending;
  g_webOtaPendingReleaseId = 0;
  if (pending && releaseIdText.length() > 0) {
    char* endPtr = nullptr;
    unsigned long long rid = strtoull(releaseIdText.c_str(), &endPtr, 10);
    if (endPtr && endPtr != releaseIdText.c_str()) {
      g_webOtaPendingReleaseId = (uint64_t)rid;
    }
  }
  return pending;
}

static void webLogFirmwareSkip(const char* reason) {
  if (!reason || !reason[0]) reason = "unknown";

  uint32_t now = millis();
  if ((strcmp(g_webFirmwareLastSkipReason, reason) == 0) &&
      g_webFirmwareSkipLogMs != 0 &&
      (uint32_t)(now - g_webFirmwareSkipLogMs) < 5000U) {
    return;
  }

  snprintf(g_webFirmwareLastSkipReason, sizeof(g_webFirmwareLastSkipReason), "%s", reason);
  g_webFirmwareSkipLogMs = now;
  Serial.printf("[OTA] skip: %s\n", reason);
}

static bool webOtaNetworkReady() {
  if (WiFi.status() != WL_CONNECTED) return false;
  if (portalMode) return false;
  if (g_lastStaConnectedMs == 0) return false;
  return (uint32_t)(millis() - g_lastStaConnectedMs) >= WEB_OTA_POST_CONNECT_DELAY_MS;
}

static void otaSanitizeLineField(const char* src, char* out, size_t outSz) {
  if (!out || outSz == 0) return;
  out[0] = 0;
  if (!src) return;

  size_t oi = 0;
  for (size_t i = 0; src[i] != 0 && oi + 1 < outSz; i++) {
    uint8_t c = (uint8_t)src[i];
    if (c < 0x20 || c > 0x7E || c == '|' || c == '\r' || c == '\n') c = '?';
    out[oi++] = (char)c;
  }
  out[oi] = 0;
}

static void atmegaPublishOtaSessionReset() {
  static const char* kResetLine = "@OTA|RST\n";
  const size_t n = strlen(kResetLine);
  if (n == 0) return;
  ATMEGA.write((const uint8_t*)kResetLine, n);
  ATMEGA.flush();
  Serial.println("[ESP->AT] OTA session reset");
}

static void atmegaPublishOtaPrompt(const char* currentVersion, const char* targetVersion) {
  char currentSafe[32];
  char targetSafe[32];
  char line[96];

  // If only ESP rebooted (ATmega stayed up), clear ATmega prompt-session flags first.
  atmegaPublishOtaSessionReset();

  otaSanitizeLineField(currentVersion, currentSafe, sizeof(currentSafe));
  otaSanitizeLineField(targetVersion, targetSafe, sizeof(targetSafe));
  if (currentSafe[0] == 0) strlcpy(currentSafe, "-", sizeof(currentSafe));
  if (targetSafe[0] == 0) strlcpy(targetSafe, "-", sizeof(targetSafe));

  int n = snprintf(line, sizeof(line), "@OTA|Q|%s|%s\n", currentSafe, targetSafe);
  if (n <= 0) return;
  if ((size_t)n >= sizeof(line)) n = (int)sizeof(line) - 1;
  ATMEGA.write((const uint8_t*)line, (size_t)n);
  ATMEGA.flush();
  Serial.printf("[ESP->AT] OTA prompt cur=%s target=%s\n", currentSafe, targetSafe);
}

static bool webPrepareSecureClient() {
  if (webSecureClientReady) return true;
#if WEB_TLS_INSECURE
  webSecureClient.setInsecure();
  Serial.println("[WEB] TLS verify disabled (WEB_TLS_INSECURE=1)");
#else
  const char* caCert = WEB_TLS_CA_CERT;
  if (caCert && caCert[0]) {
    webSecureClient.setCACert(caCert);
    Serial.println("[WEB] TLS CA cert loaded");
  } else {
    webSecureClient.setInsecure();
    Serial.println("[WEB] WARN: WEB_TLS_CA_CERT missing, falling back to insecure TLS");
  }
#endif
  webSecureClientReady = true;
  return true;
}

static bool webPostJson(const char* path, const char* json, size_t jsonLen, String* bodyOut = nullptr, int* codeOut = nullptr) {
  if (WiFi.status() != WL_CONNECTED) return false;
  if (bodyOut) *bodyOut = "";
  if (codeOut) *codeOut = 0;

  char url[256];
  snprintf(url, sizeof(url), "%s%s", WEB_SERVER_BASE_URL, path);
  HTTPClient http;
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.setConnectTimeout((int32_t)WEB_HTTP_CONNECT_TIMEOUT_MS);
  http.setTimeout((uint16_t)WEB_HTTP_RESPONSE_TIMEOUT_MS);

  const bool isHttps = (strncmp(url, "https://", 8) == 0);

  bool begun = false;
  if (isHttps) {
    if (!webPrepareSecureClient()) return false;
    begun = http.begin(webSecureClient, url);
  } else {
    begun = http.begin(webPlainClient, url);
  }

  if (!begun) {
    Serial.printf("[WEB] ❌ begin() failed: %s\n", url);
    lastWebFailMs = millis();
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Auth-Token", deviceTokenC());

  int code = http.POST((uint8_t*)json, (int)jsonLen);
  if (code <= 0) {
    Serial.printf("[WEB] ❌ POST fail (%s) code=%d\n", path, code);
    http.end();
    lastWebFailMs = millis();
    return false;
  }

  String body = http.getString();
  int blen = (int)body.length();
  if (bodyOut) *bodyOut = body;
  if (codeOut) *codeOut = code;
  const bool ok = (code >= 200 && code < 300);
  const bool isTelemetryPath = (path && (strcmp(path, WEB_TELEMETRY_PATH) == 0));
  const bool isLogUploadPath = (path && (strcmp(path, WEB_LOG_UPLOAD_PATH) == 0));
  if (!ok || (!isTelemetryPath && !isLogUploadPath)) {
    if (blen > 0) {
      String head = body.substring(0, blen > 160 ? 160 : blen);
      head.replace("\r", "");
      head.replace("\n", " ");
      Serial.printf("[WEB] POST %s -> code=%d, body_len=%d, body_head=%s\n", path, code, blen, head.c_str());
    } else {
      Serial.printf("[WEB] POST %s -> code=%d, body_len=0\n", path, code);
    }
  }
  http.end();

  if (ok) lastWebOkMs = millis();
  else lastWebFailMs = millis();

  return ok;
}

static bool webGetPath(const char* path, String& bodyOut, int& codeOut) {
  bodyOut = "";
  codeOut = 0;
  if (WiFi.status() != WL_CONNECTED) return false;

  char url[320];
  snprintf(url, sizeof(url), "%s%s", WEB_SERVER_BASE_URL, (path ? path : ""));
  HTTPClient http;
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.setConnectTimeout((int32_t)WEB_HTTP_CONNECT_TIMEOUT_MS);
  http.setTimeout((uint16_t)WEB_HTTP_RESPONSE_TIMEOUT_MS);

  const bool isHttps = (strncmp(url, "https://", 8) == 0);
  bool begun = false;
  if (isHttps) {
    if (!webPrepareSecureClient()) return false;
    begun = http.begin(webSecureClient, url);
  } else {
    begun = http.begin(webPlainClient, url);
  }

  if (!begun) {
    Serial.printf("[WEB] ❌ GET begin() failed: %s\n", url);
    lastWebFailMs = millis();
    return false;
  }

  http.addHeader("X-Auth-Token", deviceTokenC());
  codeOut = http.GET();
  bodyOut = http.getString();

  bool ok = (codeOut >= 200 && codeOut < 300);
  http.end();

  if (ok) lastWebOkMs = millis();
  else lastWebFailMs = millis();

  return ok;
}

static bool webGetPing() {
  String body;
  int code = 0;
  bool ok = webGetPath("/api/device/ping", body, code);
  int blen = (int)body.length();
  String head = body.substring(0, blen > 120 ? 120 : blen);
  head.replace("\r", "");
  head.replace("\n", " ");
  Serial.printf("[WEB] GET /api/device/ping -> code=%d, head='%s'\n", code, head.c_str());
  return ok;
}

static void atmegaPublishRegistrationState(bool registered) {
  char line[16];
  int n = snprintf(line, sizeof(line), "@REG|%u\n", registered ? 1U : 0U);
  if (n <= 0) return;
  if ((size_t)n >= sizeof(line)) n = (int)sizeof(line) - 1;
  g_lastAtmegaRegPublishMs = millis();
  ATMEGA.write((const uint8_t*)line, (size_t)n);
  ATMEGA.flush();
}

static void atmegaRepublishStateTick() {
  uint32_t now = millis();

  if (g_webDeviceRegisteredKnown &&
      ((g_lastAtmegaRegPublishMs == 0) ||
       ((uint32_t)(now - g_lastAtmegaRegPublishMs) >= ATMEGA_STATE_REPUBLISH_MS))) {
    atmegaPublishRegistrationState(g_webDeviceRegistered);
  }

  if (g_atmegaSubStateCode != 0 &&
      ((g_lastAtmegaSubPublishMs == 0) ||
       ((uint32_t)(now - g_lastAtmegaSubPublishMs) >= ATMEGA_STATE_REPUBLISH_MS))) {
    if (g_atmegaSubStateCode == 'A') {
      atmegaPublishSubscriptionActive(g_atmegaSubPlanLabel, g_atmegaSubRange, g_atmegaSubRemainingDays);
    } else {
      atmegaPublishSubscriptionStateSimple(g_atmegaSubStateCode);
    }
  }
}

static void webDeviceRegisteredSyncTick(bool force) {
  if (WiFi.status() != WL_CONNECTED) return;

  uint32_t now = millis();
  uint32_t syncPeriodMs = WEB_DEVICE_REGISTERED_SYNC_PERIOD_MS;
  if (g_webDeviceRegisteredKnown && !g_webDeviceRegistered) {
    syncPeriodMs = WEB_DEVICE_REGISTERED_RECHECK_PERIOD_MS;
  }
  if (!force && (uint32_t)(now - lastWebDeviceRegisteredSyncMs) < syncPeriodMs) {
    return;
  }
  lastWebDeviceRegisteredSyncMs = now;

  char didEnc[96];
  char path[192];
  bool registered = g_webDeviceRegistered;

  urlEncodeValue(deviceIdC(), didEnc, sizeof(didEnc));
  snprintf(path, sizeof(path), "/api/device/registered?device_id=%s", didEnc);

  String body;
  int code = 0;
  if (!webGetPath(path, body, code)) {
    Serial.printf("[WEB] GET %s failed (code=%d)\n", path, code);
    return;
  }

  if (!jsonExtractBoolValue(body, "registered", registered)) {
    Serial.printf("[WEB] GET %s parse fail\n", path);
    return;
  }

  webUpdateRegisteredState(registered);
}

static void urlEncodeValue(const char* src, char* out, size_t outSz) {
  if (!out || outSz == 0) return;
  out[0] = 0;
  if (!src) return;

  static const char HEX_DIGITS[] = "0123456789ABCDEF";
  size_t oi = 0;
  for (size_t i = 0; src[i] != 0 && oi + 1 < outSz; i++) {
    uint8_t c = (uint8_t)src[i];
    bool safe = ((c >= 'a' && c <= 'z') ||
                 (c >= 'A' && c <= 'Z') ||
                 (c >= '0' && c <= '9') ||
                 c == '-' || c == '_' || c == '.' || c == '-');
    if (safe) {
      out[oi++] = (char)c;
      continue;
    }
    if (oi + 3 >= outSz) break;
    out[oi++] = '%';
    out[oi++] = HEX_DIGITS[(c >> 4) & 0x0F];
    out[oi++] = HEX_DIGITS[c & 0x0F];
  }
  out[oi] = 0;
}

static void jsonAppendFieldPrefix(String& out, const char* key) {
  if (out.length() > 1 && out[out.length() - 1] != '{') out += ',';
  out += '"';
  out += (key ? key : "");
  out += "\":";
}

static void jsonAppendEscapedString(String& out, const char* src) {
  if (!src) src = "";
  for (size_t i = 0; src[i] != 0; i++) {
    unsigned char c = (unsigned char)src[i];
    switch (c) {
      case '\\': out += "\\\\"; break;
      case '"': out += "\\\""; break;
      case '\b': out += "\\b"; break;
      case '\f': out += "\\f"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) {
          char tmp[8];
          snprintf(tmp, sizeof(tmp), "\\u%04x", (unsigned)c);
          out += tmp;
        } else {
          out += (char)c;
        }
        break;
    }
  }
}

static void jsonAppendQuotedField(String& out, const char* key, const char* value) {
  jsonAppendFieldPrefix(out, key);
  out += '"';
  jsonAppendEscapedString(out, value);
  out += '"';
}

static void jsonAppendBoolField(String& out, const char* key, bool value) {
  jsonAppendFieldPrefix(out, key);
  out += value ? "true" : "false";
}

static void jsonAppendUint64Field(String& out, const char* key, uint64_t value) {
  char tmp[32];
  snprintf(tmp, sizeof(tmp), "%llu", (unsigned long long)value);
  jsonAppendFieldPrefix(out, key);
  out += tmp;
}

static bool jsonExtractStringValue(const String& body, const char* key, char* out, size_t outSz) {
  if (!out || outSz == 0 || !key || !*key) return false;
  out[0] = 0;

  String pat = String("\"") + key + "\"";
  int p = body.indexOf(pat);
  if (p < 0) return false;
  p = body.indexOf(':', p + (int)pat.length());
  if (p < 0) return false;
  p++;

  while (p < body.length() && (body[p] == ' ' || body[p] == '\t' || body[p] == '\r' || body[p] == '\n')) p++;
  if (p >= body.length()) return false;

  if (body.startsWith("null", p)) return false;

  size_t oi = 0;
  if (body[p] == '"') {
    p++;
    while (p < body.length()) {
      char c = body[p++];
      if (c == '\\' && p < body.length()) {
        c = body[p++];
      } else if (c == '"') {
        break;
      }
      if (oi + 1 < outSz) out[oi++] = c;
    }
    out[oi] = 0;
    return oi > 0;
  }

  while (p < body.length()) {
    char c = body[p];
    if (c == ',' || c == '}' || c == ' ' || c == '\t' || c == '\r' || c == '\n') break;
    if (oi + 1 < outSz) out[oi++] = c;
    p++;
  }
  out[oi] = 0;
  return oi > 0;
}

static bool jsonExtractIntValue(const String& body, const char* key, int& out) {
  char tmp[24];
  if (!jsonExtractStringValue(body, key, tmp, sizeof(tmp))) return false;
  out = atoi(tmp);
  return true;
}

static bool jsonExtractBoolValue(const String& body, const char* key, bool& out) {
  char tmp[16];
  if (!jsonExtractStringValue(body, key, tmp, sizeof(tmp))) return false;

  for (size_t i = 0; tmp[i] != 0; i++) {
    tmp[i] = (char)tolower((unsigned char)tmp[i]);
  }

  if (strcmp(tmp, "true") == 0 || strcmp(tmp, "1") == 0) {
    out = true;
    return true;
  }
  if (strcmp(tmp, "false") == 0 || strcmp(tmp, "0") == 0) {
    out = false;
    return true;
  }
  return false;
}

static void formatDateDots(const char* isoDate, char* out, size_t outSz) {
  if (!out || outSz == 0) return;
  out[0] = 0;
  if (!isoDate || !isoDate[0]) {
    snprintf(out, outSz, "-");
    return;
  }

  size_t oi = 0;
  for (size_t i = 0; isoDate[i] != 0 && oi + 1 < outSz; i++) {
    char c = isoDate[i];
    if (c == '-') c = '.';
    out[oi++] = c;
  }
  out[oi] = 0;
}

static bool parseIsoDateYmd(const char* isoDate, int& y, int& m, int& d) {
  if (!isoDate) return false;
  if (strlen(isoDate) < 10) return false;
  if (!isdigit((unsigned char)isoDate[0]) || !isdigit((unsigned char)isoDate[1]) ||
      !isdigit((unsigned char)isoDate[2]) || !isdigit((unsigned char)isoDate[3])) return false;
  char sep1 = isoDate[4];
  char sep2 = isoDate[7];
  if (!((sep1 == '-' || sep1 == '.') && (sep2 == '-' || sep2 == '.'))) return false;
  if (!isdigit((unsigned char)isoDate[5]) || !isdigit((unsigned char)isoDate[6]) ||
      !isdigit((unsigned char)isoDate[8]) || !isdigit((unsigned char)isoDate[9])) return false;

  y = (isoDate[0] - '0') * 1000 + (isoDate[1] - '0') * 100 + (isoDate[2] - '0') * 10 + (isoDate[3] - '0');
  m = (isoDate[5] - '0') * 10 + (isoDate[6] - '0');
  d = (isoDate[8] - '0') * 10 + (isoDate[9] - '0');
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  return true;
}

static int daysFromCivilYmd(int y, unsigned m, unsigned d) {
  y -= (m <= 2);
  const int era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = (unsigned)(y - era * 400);
  const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + (int)doe - 719468;
}

static bool calcRemainingDaysFromExpiry(const char* expiryDate, int& outDays) {
  int ey = 0, em = 0, ed = 0;
  if (!parseIsoDateYmd(expiryDate, ey, em, ed)) return false;

  time_t now = time(nullptr);
  if (now < 1704067200) return false;

  struct tm nowTm;
  gmtime_r(&now, &nowTm);
  int cy = nowTm.tm_year + 1900;
  int cm = nowTm.tm_mon + 1;
  int cd = nowTm.tm_mday;

  int diff = daysFromCivilYmd(ey, (unsigned)em, (unsigned)ed) - daysFromCivilYmd(cy, (unsigned)cm, (unsigned)cd);
  if (diff < 0) diff = 0;
  outDays = diff;
  return true;
}

// [NEW FEATURE] Parse unsigned 64-bit decimal safely.
static uint64_t teParseU64(const char* txt, uint64_t fallback = 0) {
  if (!txt || !txt[0]) return fallback;
  char* endPtr = nullptr;
  unsigned long long v = strtoull(txt, &endPtr, 10);
  if (!endPtr || endPtr == txt) return fallback;
  return (uint64_t)v;
}

static void webLoadLastHandledCommandId() {
  if (g_lastHandledCommandLoaded) return;
  g_lastHandledCommandLoaded = true;

  prefs.begin("abba-s", false);
  String v = prefs.getString("last_cmd_id", "");
  prefs.end();

  g_lastHandledCommandId = teParseU64(v.c_str(), 0);
  Serial.printf("[WEB] last_cmd_id=%llu\n", (unsigned long long)g_lastHandledCommandId);
}

static void webSaveLastHandledCommandId() {
  prefs.begin("abba-s", false);
  prefs.putString("last_cmd_id", String((unsigned long long)g_lastHandledCommandId));
  prefs.end();
}

// [NEW FEATURE] Clamp 64-bit metric to firmware-side 32-bit transport.
static uint32_t teClampU32(uint64_t v) {
  if (v > 0xFFFFFFFFULL) return 0xFFFFFFFFUL;
  return (uint32_t)v;
}

// [NEW FEATURE] Extract 64-bit JSON field without changing existing parser flow.
static bool jsonExtractUint64Value(const String& body, const char* key, uint64_t& out) {
  char tmp[32];
  if (!jsonExtractStringValue(body, key, tmp, sizeof(tmp))) return false;
  out = teParseU64(tmp, out);
  return true;
}

static void jsonAppendFirmwareFields(String& out) {
  jsonAppendQuotedField(out, "fw", firmwareFamilyC());
  jsonAppendQuotedField(out, "fw_version", firmwareVersionC());
  jsonAppendQuotedField(out, "fw_build_id", firmwareBuildIdC());
}

static bool webPostOtaReport(const char* state, uint64_t releaseId, const char* message) {
  if (WiFi.status() != WL_CONNECTED) return false;

  char ip[16];
  ipToStr(WiFi.localIP(), ip, sizeof(ip));

  String json;
  json.reserve(384);
  json = "{";
  jsonAppendQuotedField(json, "ip", ip);
  jsonAppendQuotedField(json, "device_id", deviceIdC());
  jsonAppendQuotedField(json, "customer", DEVICE_CUSTOMER);
  jsonAppendQuotedField(json, "token", deviceTokenC());
  jsonAppendQuotedField(json, "state", (state && state[0]) ? state : "idle");
  jsonAppendQuotedField(json, "message", (message && message[0]) ? message : "");
  jsonAppendUint64Field(json, "release_id", releaseId);
  jsonAppendFirmwareFields(json);
  json += "}";

  String body;
  int code = 0;
  bool ok = webPostJson(WEB_OTA_REPORT_PATH, json.c_str(), json.length(), &body, &code);
  if (!ok) {
    Serial.printf("[OTA] report failed state=%s code=%d\n", (state ? state : "-"), code);
  }
  return ok;
}

static bool webDownloadAndApplyFirmware(
    const char* downloadPath,
    uint64_t releaseId,
    const char* targetFamily,
    const char* targetVersion,
    const char* targetBuildId,
    uint64_t expectedSize,
    const char* expectedSha256,
    char* errorOut,
    size_t errorOutSz) {
  if (errorOut && errorOutSz > 0) errorOut[0] = 0;
  if (!downloadPath || !downloadPath[0]) {
    if (errorOut && errorOutSz > 0) snprintf(errorOut, errorOutSz, "download_path_missing");
    return false;
  }
  if (WiFi.status() != WL_CONNECTED) {
    if (errorOut && errorOutSz > 0) snprintf(errorOut, errorOutSz, "wifi_not_connected");
    return false;
  }

  urlEncodeValue(deviceIdC(), g_otaDidEnc, sizeof(g_otaDidEnc));
  snprintf(g_otaPath, sizeof(g_otaPath), "%s%sdevice_id=%s",
           downloadPath,
           strchr(downloadPath, '?') ? "&" : "?",
           g_otaDidEnc);

  snprintf(g_otaUrl, sizeof(g_otaUrl), "%s%s", WEB_SERVER_BASE_URL, g_otaPath);

  HTTPClient http;
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.setConnectTimeout((int32_t)WEB_OTA_HTTP_CONNECT_TIMEOUT_MS);
  http.setTimeout((uint16_t)WEB_OTA_HTTP_RESPONSE_TIMEOUT_MS);

  const bool isHttps = (strncmp(g_otaUrl, "https://", 8) == 0);
  bool begun = false;
  if (isHttps) {
    if (!webPrepareSecureClient()) {
      if (errorOut && errorOutSz > 0) snprintf(errorOut, errorOutSz, "secure_client_prepare_failed");
      return false;
    }
    begun = http.begin(webSecureClient, g_otaUrl);
  } else {
    begun = http.begin(webPlainClient, g_otaUrl);
  }

  if (!begun) {
    if (errorOut && errorOutSz > 0) snprintf(errorOut, errorOutSz, "http_begin_failed");
    return false;
  }

  http.addHeader("X-Auth-Token", deviceTokenC());
  int code = http.GET();
  if (code != HTTP_CODE_OK) {
    if (errorOut && errorOutSz > 0) snprintf(errorOut, errorOutSz, "http_status_%d", code);
    http.end();
    return false;
  }

  int contentLength = http.getSize();
  if (contentLength > 0 && expectedSize > 0 && (uint64_t)contentLength != expectedSize) {
    if (errorOut && errorOutSz > 0) snprintf(errorOut, errorOutSz, "size_mismatch_header");
    http.end();
    return false;
  }

  size_t updateSize = (expectedSize > 0 && expectedSize <= 0xFFFFFFFFULL) ? (size_t)expectedSize : UPDATE_SIZE_UNKNOWN;
  if (!Update.begin(updateSize)) {
    if (errorOut && errorOutSz > 0) snprintf(errorOut, errorOutSz, "update_begin_failed");
    http.end();
    return false;
  }

  WiFiClient* stream = http.getStreamPtr();
  if (!stream) {
    Update.abort();
    http.end();
    if (errorOut && errorOutSz > 0) snprintf(errorOut, errorOutSz, "stream_missing");
    return false;
  }

  mbedtls_sha256_init(&g_otaShaCtx);
  mbedtls_sha256_starts(&g_otaShaCtx, 0);

  uint64_t written = 0;
  uint32_t lastDataMs = millis();
  uint32_t lastProgressMs = 0;

  while (http.connected() || stream->available() > 0) {
    size_t avail = stream->available();
    if (avail == 0) {
      if ((uint32_t)(millis() - lastDataMs) > WEB_OTA_HTTP_RESPONSE_TIMEOUT_MS) {
        break;
      }
      delay(1);
      continue;
    }

    size_t toRead = avail;
    if (toRead > sizeof(g_otaDownloadBuf)) toRead = sizeof(g_otaDownloadBuf);
    int readLen = stream->readBytes(g_otaDownloadBuf, toRead);
    if (readLen <= 0) {
      delay(1);
      continue;
    }

    lastDataMs = millis();
    mbedtls_sha256_update(&g_otaShaCtx, g_otaDownloadBuf, (size_t)readLen);

    size_t writeLen = Update.write(g_otaDownloadBuf, (size_t)readLen);
    if (writeLen != (size_t)readLen) {
      mbedtls_sha256_free(&g_otaShaCtx);
      Update.abort();
      http.end();
      if (errorOut && errorOutSz > 0) snprintf(errorOut, errorOutSz, "update_write_failed");
      return false;
    }

    written += (uint64_t)writeLen;
    if ((uint32_t)(millis() - lastProgressMs) >= 1000U) {
      lastProgressMs = millis();
      Serial.printf("[OTA] downloading release=%llu bytes=%llu\n",
                    (unsigned long long)releaseId,
                    (unsigned long long)written);
    }
  }

  memset(g_otaShaRaw, 0, sizeof(g_otaShaRaw));
  memset(g_otaShaHex, 0, sizeof(g_otaShaHex));
  mbedtls_sha256_finish(&g_otaShaCtx, g_otaShaRaw);
  mbedtls_sha256_free(&g_otaShaCtx);
  for (size_t i = 0; i < sizeof(g_otaShaRaw); i++) {
    snprintf(&g_otaShaHex[i * 2], 3, "%02x", (unsigned int)g_otaShaRaw[i]);
  }

  if (expectedSize > 0 && written != expectedSize) {
    Update.abort();
    http.end();
    if (errorOut && errorOutSz > 0) snprintf(errorOut, errorOutSz, "size_mismatch_body");
    return false;
  }
  if (contentLength > 0 && written != (uint64_t)contentLength) {
    Update.abort();
    http.end();
    if (errorOut && errorOutSz > 0) snprintf(errorOut, errorOutSz, "content_length_mismatch");
    return false;
  }
  if (expectedSha256 && expectedSha256[0] && strcasecmp(expectedSha256, g_otaShaHex) != 0) {
    Update.abort();
    http.end();
    if (errorOut && errorOutSz > 0) snprintf(errorOut, errorOutSz, "sha256_mismatch");
    return false;
  }

  if (!Update.end()) {
    http.end();
    if (errorOut && errorOutSz > 0) snprintf(errorOut, errorOutSz, "update_end_failed");
    return false;
  }
  if (!Update.isFinished()) {
    http.end();
    if (errorOut && errorOutSz > 0) snprintf(errorOut, errorOutSz, "update_not_finished");
    return false;
  }

  http.end();

  Serial.printf("[OTA] ready to reboot release=%llu target=%s %s (%s)\n",
                (unsigned long long)releaseId,
                (targetFamily && targetFamily[0]) ? targetFamily : "-",
                (targetVersion && targetVersion[0]) ? targetVersion : "-",
                (targetBuildId && targetBuildId[0]) ? targetBuildId : "-");

  otaSetPendingBootReport(true, releaseId);
  webPostOtaReport("rebooting", releaseId, "ota image applied; rebooting");
  notifyAtmegaWifiConnectResult(true);
  delay(600);
  ESP.restart();
  return true;
}

static void webOtaBootReportTick() {
  if (!g_webOtaPendingBootReport) return;
  if (!webOtaNetworkReady()) return;

  uint32_t now = millis();
  if ((uint32_t)(now - lastWebOtaBootReportMs) < WEB_OTA_BOOT_REPORT_RETRY_MS) return;
  lastWebOtaBootReportMs = now;

  Serial.printf("[OTA] reporting boot success release=%llu\n",
                (unsigned long long)g_webOtaPendingReleaseId);
  if (webPostOtaReport("success", g_webOtaPendingReleaseId, "booted updated firmware")) {
    otaSetPendingBootReport(false);
  }
}

static void webScheduleImmediateFirmwareCheck(const char* reason) {
  uint32_t dueMs = millis() + WEB_OTA_POST_CONNECT_DELAY_MS;
  bool shouldLog = !g_webFirmwareImmediateCheckPending;

  g_webFirmwareImmediateCheckPending = true;
  g_webFirmwareImmediateCheckAtMs = dueMs;

  if (shouldLog) {
    Serial.printf("[OTA] immediate check scheduled in %lu ms (%s)\n",
                  (unsigned long)WEB_OTA_POST_CONNECT_DELAY_MS,
                  (reason && reason[0]) ? reason : "-");
  }
}

static void webFirmwareCheckTick(bool force) {
  if (WiFi.status() != WL_CONNECTED) {
    if (force) webLogFirmwareSkip("wifi_not_connected");
    return;
  }
  if (portalMode) {
    if (force) webLogFirmwareSkip("portal_mode");
    return;
  }
  if (g_lastStaConnectedMs == 0) {
    if (force) webLogFirmwareSkip("sta_connect_time_unknown");
    return;
  }
  if (!webOtaNetworkReady()) {
    if (force) webLogFirmwareSkip("post_connect_delay");
    return;
  }
  if (g_webOtaPendingBootReport) {
    if (force) webLogFirmwareSkip("awaiting_boot_report");
    return;
  }
  if (g_webOtaAwaitingUserDecision) {
    webLogFirmwareSkip("awaiting_user_ota_decision");
    return;
  }
  if (g_runActive) {
    webLogFirmwareSkip("run_active");
    return;
  }
  if (g_webDeviceRegisteredKnown && !g_webDeviceRegistered) {
    webLogFirmwareSkip("device_unregistered");
    return;
  }

  uint32_t now = millis();
  if (!force && (uint32_t)(now - lastWebFirmwareCheckMs) < WEB_FIRMWARE_CHECK_PERIOD_MS) return;
  lastWebFirmwareCheckMs = now;

  memset(g_otaTargetFamily, 0, sizeof(g_otaTargetFamily));
  memset(g_otaTargetVersion, 0, sizeof(g_otaTargetVersion));
  memset(g_otaTargetBuildId, 0, sizeof(g_otaTargetBuildId));
  memset(g_otaDownloadPath, 0, sizeof(g_otaDownloadPath));
  memset(g_otaExpectedSha256, 0, sizeof(g_otaExpectedSha256));
  memset(g_otaErrorMsg, 0, sizeof(g_otaErrorMsg));

  urlEncodeValue(deviceIdC(), g_otaDidEnc, sizeof(g_otaDidEnc));
  snprintf(g_otaPath, sizeof(g_otaPath), "/api/device/ota/check?device_id=%s", g_otaDidEnc);
  Serial.printf("[OTA] checking %s\n", g_otaPath);

  String body;
  int code = 0;
  if (!webGetPath(g_otaPath, body, code)) {
    Serial.printf("[OTA] check failed code=%d path=%s\n", code, g_otaPath);
    return;
  }

  bool updateAvailable = false;
  if (!jsonExtractBoolValue(body, "update_available", updateAvailable)) {
    Serial.println("[OTA] invalid check response: update_available missing");
    return;
  }
  if (!updateAvailable) {
    Serial.println("[OTA] no update available");
    return;
  }

  uint64_t releaseId = 0;
  uint64_t sizeBytes = 0;
  bool forceUpdate = false;

  jsonExtractUint64Value(body, "release_id", releaseId);
  jsonExtractUint64Value(body, "release_size_bytes", sizeBytes);
  jsonExtractBoolValue(body, "release_force_update", forceUpdate);
  jsonExtractStringValue(body, "release_family", g_otaTargetFamily, sizeof(g_otaTargetFamily));
  jsonExtractStringValue(body, "release_version", g_otaTargetVersion, sizeof(g_otaTargetVersion));
  jsonExtractStringValue(body, "release_build_id", g_otaTargetBuildId, sizeof(g_otaTargetBuildId));
  jsonExtractStringValue(body, "release_download_path", g_otaDownloadPath, sizeof(g_otaDownloadPath));
  jsonExtractStringValue(body, "release_sha256", g_otaExpectedSha256, sizeof(g_otaExpectedSha256));

  if (releaseId == 0 || !g_otaDownloadPath[0]) {
    Serial.println("[OTA] invalid check response");
    return;
  }
  if (g_webOtaSessionSkipUntilReboot && !forceUpdate) {
    webLogFirmwareSkip("ota_session_skip_until_reboot");
    return;
  }
  if (g_otaTargetFamily[0] && strcmp(g_otaTargetFamily, firmwareFamilyC()) != 0) {
    Serial.printf("[OTA] skipped family mismatch target=%s current=%s\n", g_otaTargetFamily, firmwareFamilyC());
    webPostOtaReport("failed", releaseId, "family_mismatch");
    return;
  }
  if (g_webOtaSessionSkipUntilReboot && forceUpdate) {
    g_webOtaSessionSkipUntilReboot = false;
    Serial.printf("[OTA] force update overrides session skip release=%llu\n",
                  (unsigned long long)releaseId);
  }

  Serial.printf("[OTA] update available release=%llu force=%u target=%s %s (%s)\n",
                (unsigned long long)releaseId,
                forceUpdate ? 1U : 0U,
                g_otaTargetFamily[0] ? g_otaTargetFamily : "-",
                g_otaTargetVersion[0] ? g_otaTargetVersion : "-",
                g_otaTargetBuildId[0] ? g_otaTargetBuildId : "-");

  if (forceUpdate) {
    g_webOtaPromptShownThisBoot = true;
    g_webOtaAwaitingUserDecision = true;
    g_webOtaApprovedByUser = true;
    g_webOtaDecisionReqValue = -1;
    g_webOtaPromptReleaseId = releaseId;
    g_webOtaPromptSizeBytes = sizeBytes;
    webPostOtaReport("approved", releaseId, "force_update_auto_approved");
    Serial.printf("[OTA] force update auto-approved release=%llu\n", (unsigned long long)releaseId);
    return;
  }

  if (!g_webOtaPromptShownThisBoot) {
    g_webOtaPromptShownThisBoot = true;
    g_webOtaAwaitingUserDecision = true;
    g_webOtaApprovedByUser = false;
    g_webOtaDecisionReqValue = -1;
    g_webOtaPromptReleaseId = releaseId;
    g_webOtaPromptSizeBytes = sizeBytes;
    atmegaPublishOtaPrompt(firmwareVersionC(), g_otaTargetVersion);
    webPostOtaReport("pending_user", releaseId, "awaiting_user_decision");
    Serial.printf("[OTA] waiting user decision release=%llu\n", (unsigned long long)releaseId);
    return;
  }

  webLogFirmwareSkip("ota_prompt_already_shown");
}

static void webFirmwareDecisionTick() {
  int8_t decision = g_webOtaDecisionReqValue;
  if (decision >= 0) {
    g_webOtaDecisionReqValue = -1;
    if (!g_webOtaAwaitingUserDecision || g_webOtaPromptReleaseId == 0) {
      Serial.printf("[OTA] decision ignored value=%d (no pending prompt)\n", (int)decision);
    } else if (decision == 0) {
      uint64_t releaseId = g_webOtaPromptReleaseId;
      g_webOtaAwaitingUserDecision = false;
      g_webOtaApprovedByUser = false;
      g_webOtaSessionSkipUntilReboot = true;
      webPostOtaReport("skipped", releaseId, "user_skipped_until_reboot");
      Serial.printf("[OTA] user skipped release=%llu (blocked until reboot)\n",
                    (unsigned long long)releaseId);
    } else {
      g_webOtaApprovedByUser = true;
      webPostOtaReport("approved", g_webOtaPromptReleaseId, "user_approved_update");
      Serial.printf("[OTA] user approved release=%llu\n",
                    (unsigned long long)g_webOtaPromptReleaseId);
    }
  }

  if (!g_webOtaAwaitingUserDecision || !g_webOtaApprovedByUser) return;
  if (WiFi.status() != WL_CONNECTED) return;
  if (portalMode) return;
  if (!webOtaNetworkReady()) return;
  if (g_webOtaPendingBootReport) return;
  if (g_runActive) return;
  if (g_webDeviceRegisteredKnown && !g_webDeviceRegistered) return;
  if (g_webOtaPromptReleaseId == 0 || !g_otaDownloadPath[0]) {
    Serial.println("[OTA] pending metadata missing after approval");
    g_webOtaAwaitingUserDecision = false;
    g_webOtaApprovedByUser = false;
    g_webOtaSessionSkipUntilReboot = true;
    atmegaRequestPageChange(DWIN_PAGE_DEVICE_READY);
    return;
  }

  uint64_t releaseId = g_webOtaPromptReleaseId;
  uint64_t sizeBytes = g_webOtaPromptSizeBytes;
  webPostOtaReport("downloading", releaseId, "ota download started");

  if (!webDownloadAndApplyFirmware(
          g_otaDownloadPath,
          releaseId,
          g_otaTargetFamily,
          g_otaTargetVersion,
          g_otaTargetBuildId,
          sizeBytes,
          g_otaExpectedSha256,
          g_otaErrorMsg,
          sizeof(g_otaErrorMsg))) {
    Serial.printf("[OTA] apply failed release=%llu reason=%s\n",
                  (unsigned long long)releaseId,
                  g_otaErrorMsg[0] ? g_otaErrorMsg : "unknown");
    webPostOtaReport("failed", releaseId, g_otaErrorMsg[0] ? g_otaErrorMsg : "ota_apply_failed");
    g_webOtaAwaitingUserDecision = false;
    g_webOtaApprovedByUser = false;
    g_webOtaSessionSkipUntilReboot = true;
    atmegaRequestPageChange(DWIN_PAGE_DEVICE_READY);
  }
}

static void webFirmwareImmediateCheckTick() {
  if (!g_webFirmwareImmediateCheckPending) return;
  if (WiFi.status() != WL_CONNECTED) return;

  uint32_t now = millis();
  if ((int32_t)(now - g_webFirmwareImmediateCheckAtMs) < 0) return;

  if (portalMode) {
    webLogFirmwareSkip("portal_mode");
    return;
  }
  if (g_runActive) {
    webLogFirmwareSkip("run_active");
    return;
  }
  if (g_webDeviceRegisteredKnown && !g_webDeviceRegistered) {
    webLogFirmwareSkip("device_unregistered");
    return;
  }
  if (g_webOtaPendingBootReport) {
    webLogFirmwareSkip("awaiting_boot_report");
    return;
  }

  g_webFirmwareImmediateCheckPending = false;
  Serial.println("[OTA] running scheduled immediate check");
  webFirmwareCheckTick(true);
}

static void webUpdateRegisteredState(bool registered) {
  bool changed = (!g_webDeviceRegisteredKnown) || (g_webDeviceRegistered != registered);
  bool becameRegistered = (!g_webDeviceRegisteredKnown) || (!g_webDeviceRegistered && registered);
  g_webDeviceRegisteredKnown = true;
  g_webDeviceRegistered = registered;
  atmegaPublishRegistrationState(registered);
  if (!registered) {
    subscriptionApplyUnregistered();
  }
  if (becameRegistered) {
    lastWebRegisterMs = 0;
    lastWebHeartbeatMs = 0;
    lastWebTelemetryMs = 0;
    lastWebTelemetryForceMs = 0;
    lastWebSubscriptionSyncMs = 0;
    lastWebDeviceRegisteredSyncMs = 0;
    g_webTelemetryDirty = true;
    webMarkLogUploadDirty(SD_LOG_FILE_PATH);
    webMarkLogUploadDirty(SD_TOTAL_ENERGY_FILE_PATH);
  }
  if (changed) {
    Serial.printf("[WEB] device registered=%u\n", registered ? 1U : 0U);
  }
}

static void webUpdateRegisteredStateFromBody(const String& body, bool fallbackValue) {
  bool registered = fallbackValue;
  if (jsonExtractBoolValue(body, "registered", registered)) {
    webUpdateRegisteredState(registered);
  }
}

static void webHandleProvisioningReject(const char* path, int code, const String& body) {
  if (code != 401 && code != 403) return;
  webUpdateRegisteredState(false);
  lastWebDeviceRegisteredSyncMs = 0;

  String head = body.substring(0, body.length() > 160 ? 160 : body.length());
  head.replace("\r", "");
  head.replace("\n", " ");
  if (head.length() > 0) {
    Serial.printf("[WEB] provisioning rejected path=%s code=%d body=%s\n", path ? path : "-", code, head.c_str());
  } else {
    Serial.printf("[WEB] provisioning rejected path=%s code=%d\n", path ? path : "-", code);
  }
}

static bool webLogUploadPending(const WebLogUploadJob& job) {
  return job.active || (job.desiredVersion != job.syncedVersion);
}

static void webLogUploadReset(WebLogUploadJob& job, uint32_t delayMs) {
  job.active = false;
  job.fileSize = 0;
  job.chunkIndex = 0;
  job.chunkTotal = 0;
  job.nextAttemptMs = millis() + delayMs;
}

static void webAppendHex(String& out, const uint8_t* data, size_t len) {
  static const char HEX_DIGITS[] = "0123456789abcdef";
  if (!data || len == 0) return;
  for (size_t i = 0; i < len; i++) {
    uint8_t v = data[i];
    out += HEX_DIGITS[(v >> 4) & 0x0F];
    out += HEX_DIGITS[v & 0x0F];
  }
}

static void webMarkLogUploadDirty(const char* path) {
  if (!path || !path[0]) return;
  for (size_t i = 0; i < (sizeof(g_webLogUploadJobs) / sizeof(g_webLogUploadJobs[0])); i++) {
    WebLogUploadJob& job = g_webLogUploadJobs[i];
    if (strcmp(job.path, path) != 0) continue;
    job.desiredVersion++;
    if (job.desiredVersion == 0) job.desiredVersion = 1;
    if (!job.active) job.nextAttemptMs = 0;
    return;
  }
}

static bool webPrepareLogUploadJob(WebLogUploadJob& job) {
  job.fileSize = 0;
  if (g_sdInserted && SD.exists(job.path)) {
    File f = SD.open(job.path, FILE_READ);
    if (!f) {
      Serial.printf("[WEB] log upload open fail kind=%s path=%s\n", job.kind, job.path);
      return false;
    }
    job.fileSize = (size_t)f.size();
    f.close();
  }
  job.chunkTotal = (uint32_t)((job.fileSize + WEB_LOG_UPLOAD_CHUNK_BYTES - 1U) / WEB_LOG_UPLOAD_CHUNK_BYTES);
  if (job.chunkTotal == 0) job.chunkTotal = 1;
  job.chunkIndex = 0;
  job.uploadVersion = job.desiredVersion;
  job.active = true;
  job.nextAttemptMs = 0;
  return true;
}

static bool webSendLogUploadChunk(WebLogUploadJob& job, uint32_t now) {
  uint8_t chunkBuf[WEB_LOG_UPLOAD_CHUNK_BYTES];
  size_t chunkLen = 0;

  if (job.fileSize > 0) {
    File f = SD.open(job.path, FILE_READ);
    if (!f) {
      Serial.printf("[WEB] log upload reopen fail kind=%s path=%s\n", job.kind, job.path);
      webLogUploadReset(job, WEB_LOG_UPLOAD_RETRY_MS);
      return false;
    }

    uint32_t offset = job.chunkIndex * (uint32_t)WEB_LOG_UPLOAD_CHUNK_BYTES;
    if (!f.seek(offset)) {
      f.close();
      Serial.printf("[WEB] log upload seek fail kind=%s offset=%lu\n", job.kind, (unsigned long)offset);
      webLogUploadReset(job, WEB_LOG_UPLOAD_RETRY_MS);
      return false;
    }

    chunkLen = f.read(chunkBuf, sizeof(chunkBuf));
    f.close();
  }

  char ip[16];
  ipToStr(WiFi.localIP(), ip, sizeof(ip));

  String json;
  json.reserve(1200 + (chunkLen * 2U));
  json = "{";
  jsonAppendQuotedField(json, "ip", ip);
  jsonAppendQuotedField(json, "device_id", deviceIdC());
  jsonAppendQuotedField(json, "customer", DEVICE_CUSTOMER);
  jsonAppendQuotedField(json, "token", deviceTokenC());
  jsonAppendQuotedField(json, "kind", job.kind);
  jsonAppendUint64Field(json, "chunk_index", job.chunkIndex);
  jsonAppendUint64Field(json, "chunk_total", job.chunkTotal);
  jsonAppendUint64Field(json, "total_size", job.fileSize);
  jsonAppendFieldPrefix(json, "data_hex");
  json += '"';
  webAppendHex(json, chunkBuf, chunkLen);
  json += '"';
  json += "}";

  String body;
  int code = 0;
  if (!webPostJson(WEB_LOG_UPLOAD_PATH, json.c_str(), json.length(), &body, &code)) {
    webHandleProvisioningReject(WEB_LOG_UPLOAD_PATH, code, body);
    Serial.printf("[WEB] log upload fail kind=%s chunk=%lu/%lu code=%d\n",
                  job.kind,
                  (unsigned long)(job.chunkIndex + 1U),
                  (unsigned long)job.chunkTotal,
                  code);
    webLogUploadReset(job, WEB_LOG_UPLOAD_RETRY_MS);
    return false;
  }

  if ((job.chunkIndex + 1U) >= job.chunkTotal) {
    size_t completedSize = job.fileSize;
    job.syncedVersion = job.uploadVersion;
    job.active = false;
    job.fileSize = 0;
    job.chunkIndex = 0;
    job.chunkTotal = 0;
    job.nextAttemptMs = 0;
    Serial.printf("[WEB] log upload complete kind=%s bytes=%u version=%lu\n",
                  job.kind,
                  (unsigned)completedSize,
                  (unsigned long)job.syncedVersion);
  } else {
    job.chunkIndex++;
    job.nextAttemptMs = now + WEB_LOG_UPLOAD_STEP_MS;
  }
  return true;
}

static void webLogUploadTick() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (g_webDeviceRegisteredKnown && !g_webDeviceRegistered) return;

  uint32_t now = millis();
  const size_t jobCount = sizeof(g_webLogUploadJobs) / sizeof(g_webLogUploadJobs[0]);

  for (size_t i = 0; i < jobCount; i++) {
    WebLogUploadJob& job = g_webLogUploadJobs[i];
    if (!job.active) continue;
    if (job.nextAttemptMs != 0 && (int32_t)(now - job.nextAttemptMs) < 0) return;
    webSendLogUploadChunk(job, now);
    return;
  }

  for (size_t i = 0; i < jobCount; i++) {
    size_t idx = (g_webLogUploadNextSlot + i) % jobCount;
    WebLogUploadJob& job = g_webLogUploadJobs[idx];
    if (!webLogUploadPending(job)) continue;
    if (job.nextAttemptMs != 0 && (int32_t)(now - job.nextAttemptMs) < 0) continue;
    if (!webPrepareLogUploadJob(job)) {
      webLogUploadReset(job, WEB_LOG_UPLOAD_RETRY_MS);
      return;
    }
    g_webLogUploadNextSlot = (uint8_t)((idx + 1U) % jobCount);
    webSendLogUploadChunk(job, now);
    return;
  }
}

static bool webAcknowledgePendingCommand(const char* command, uint64_t commandId, bool ok, const char* resultMessage = nullptr) {
  if (!command || !command[0]) return false;
  if (commandId == 0) return false;

  char ip[16];
  ipToStr(WiFi.localIP(), ip, sizeof(ip));

  const char* result = (resultMessage && resultMessage[0]) ? resultMessage : "";
  String json;
  json.reserve(384);
  json = "{";
  jsonAppendQuotedField(json, "ip", ip);
  jsonAppendQuotedField(json, "device_id", deviceIdC());
  jsonAppendQuotedField(json, "customer", DEVICE_CUSTOMER);
  jsonAppendQuotedField(json, "token", deviceTokenC());
  jsonAppendQuotedField(json, "command", command);
  jsonAppendUint64Field(json, "command_id", commandId);
  jsonAppendBoolField(json, "ok", ok);
  jsonAppendQuotedField(json, "result_message", result);
  json += "}";

  String body;
  int code = 0;
  bool ackOk = webPostJson("/api/device/command-ack", json.c_str(), json.length(), &body, &code);
  if (!ackOk) {
    Serial.printf("[WEB] command ack failed cmd=%s code=%d\n", command, code);
  }
  return ackOk;
}

static bool webHandlePendingCommand(const String& body) {
  webLoadLastHandledCommandId();

  uint64_t commandId = 0;
  char command[40] = {0};
  if (!jsonExtractUint64Value(body, "pending_command_id", commandId)) return false;
  if (!jsonExtractStringValue(body, "pending_command", command, sizeof(command))) return false;
  if (!command[0] || commandId == 0) return false;

  if (commandId <= g_lastHandledCommandId) {
    webAcknowledgePendingCommand(command, commandId, true, "duplicate_ack");
    return true;
  }

  bool ok = true;
  const char* resultMessage = "";
  if (strcasecmp(command, "RESET_STATE") == 0 || strcasecmp(command, "RESETSTATE") == 0) {
    Serial.println("[WEB] pending command RESET_STATE");
    teResetLocalState();
    g_webTelemetryDirty = true;
    lastWebTelemetryMs = 0;
  } else if (strcasecmp(command, "RESET_SUBSCRIPTION") == 0 || strcasecmp(command, "RESETSUBSCRIPTION") == 0) {
    Serial.println("[WEB] pending command RESET_SUBSCRIPTION");
    teResetSubscriptionState();
    g_webTelemetryDirty = true;
    lastWebTelemetryMs = 0;
  } else if (strcasecmp(command, "PING") == 0) {
    Serial.println("[WEB] pending command PING");
  } else if (strncasecmp(command, "PAGE", 4) == 0) {
    Serial.printf("[WEB] pending command %s\n", command);
    handle_command(String(command));
  } else {
    Serial.printf("[WEB] custom pending command %s\n", command);
    handle_command(String(command));
    resultMessage = "custom_command";
  }

  g_lastHandledCommandId = commandId;
  webSaveLastHandledCommandId();
  webAcknowledgePendingCommand(command, commandId, ok, resultMessage);
  return ok;
}

// [NEW FEATURE] Build date/time strings used by TotalEnergy session ledger.
static bool teNowDateTime(char* dateOut, size_t dateSz, char* timeOut, size_t timeSz) {
  if (dateOut && dateSz > 0) dateOut[0] = 0;
  if (timeOut && timeSz > 0) timeOut[0] = 0;
  if (!dateOut || !timeOut || dateSz < 11 || timeSz < 9) return false;

  time_t nowEpoch = time(nullptr);
  if (nowEpoch < CLOCK_VALID_EPOCH) {
    uint32_t up = millis() / 1000U;
    uint32_t hh = (up / 3600U) % 24U;
    uint32_t mm = (up / 60U) % 60U;
    uint32_t ss = up % 60U;
    snprintf(dateOut, dateSz, "1970-01-01");
    snprintf(timeOut, timeSz, "%02lu:%02lu:%02lu", (unsigned long)hh, (unsigned long)mm, (unsigned long)ss);
    return false;
  }

  struct tm nowTm;
  memset(&nowTm, 0, sizeof(nowTm));
  localtime_r(&nowEpoch, &nowTm);
  snprintf(dateOut, dateSz, "%04d-%02d-%02d", nowTm.tm_year + 1900, nowTm.tm_mon + 1, nowTm.tm_mday);
  snprintf(timeOut, timeSz, "%02d:%02d:%02d", nowTm.tm_hour, nowTm.tm_min, nowTm.tm_sec);
  return true;
}

// [NEW FEATURE] Elapsed day count from subscription start date (min 1 when valid).
static bool calcElapsedDaysFromStart(const char* startDate, uint32_t& outDays) {
  int sy = 0, sm = 0, sd = 0;
  if (!parseIsoDateYmd(startDate, sy, sm, sd)) return false;

  time_t now = time(nullptr);
  if (now < CLOCK_VALID_EPOCH) return false;

  struct tm nowTm;
  // [NEW FEATURE] Use local calendar date so elapsed_days matches the WEB subscription period.
  localtime_r(&now, &nowTm);
  int cy = nowTm.tm_year + 1900;
  int cm = nowTm.tm_mon + 1;
  int cd = nowTm.tm_mday;

  int diff = daysFromCivilYmd(cy, (unsigned)cm, (unsigned)cd) - daysFromCivilYmd(sy, (unsigned)sm, (unsigned)sd);
  if (diff < 0) diff = 0;
  outDays = (uint32_t)(diff + 1);
  return true;
}

// [NEW FEATURE] Persist assigned/session totals so reboot does not lose ledger context.
static void tePrefsLoad() {
  prefs.begin("abba-energy", true);
  String assigned = prefs.getString("assigned_j", "");
  String dayDate = prefs.getString("day_date", "");
  String dayTotal = prefs.getString("day_total", "");
  String devTotal = prefs.getString("dev_total", "");
  prefs.end();

  g_assignedEnergyJ = teParseU64(assigned.c_str(), 0);
  g_teCurrentDayTotalJ = teParseU64(dayTotal.c_str(), 0);
  g_teDeviceTotalJ = teParseU64(devTotal.c_str(), 0);
  strlcpy(g_teCurrentDayDate, dayDate.c_str(), sizeof(g_teCurrentDayDate));
}

// [NEW FEATURE] Save current ledger counters to Preferences.
static void tePrefsSaveState() {
  char numBuf[24];
  prefs.begin("abba-energy", false);
  snprintf(numBuf, sizeof(numBuf), "%llu", (unsigned long long)g_assignedEnergyJ);
  prefs.putString("assigned_j", numBuf);
  prefs.putString("day_date", String(g_teCurrentDayDate));
  snprintf(numBuf, sizeof(numBuf), "%llu", (unsigned long long)g_teCurrentDayTotalJ);
  prefs.putString("day_total", numBuf);
  snprintf(numBuf, sizeof(numBuf), "%llu", (unsigned long long)g_teDeviceTotalJ);
  prefs.putString("dev_total", numBuf);
  prefs.end();
}

// [NEW FEATURE] Force next ENG push after local reprovision reset.
static void teInvalidatePublishedMetrics() {
  g_teLastPubAssignedJ = UINT64_MAX;
  g_teLastPubUsedJ = UINT64_MAX;
  g_teLastPubDailyAvgJ = UINT64_MAX;
  g_teLastPubMonthlyAvgJ = UINT64_MAX;
  g_teLastPubProjectedJ = UINT64_MAX;
  g_teLastPubElapsedDays = UINT32_MAX;
  g_teLastPubRemainDays = UINT32_MAX;
  g_teLastPushMs = 0;
}

static void teResetSubscriptionState() {
  g_assignedEnergyJ = 0;
  g_planStartDate[0] = 0;
  g_planRemainingDays = 0;

  g_teSessionActive = false;
  g_teSessionStartTotalJ = 0;
  g_teSessionStartDate[0] = 0;
  g_teSessionStartTime[0] = 0;
  g_teCurrentDayDate[0] = 0;
  g_teCurrentDayTotalJ = 0;
  g_teDeviceTotalJ = 0;

  g_teRunEventQHead = 0;
  g_teRunEventQTail = 0;
  g_teRunEventDropCount = 0;
  g_teLastQueuedRunState = 0xFF;
  g_teLastQueuedTotalJ = 0;
  g_teLastQueuedMs = 0;
  g_teLastRealEventMs = 0;
  g_teFallbackTotalJ = 0;

  strlcpy(lastOutLine, "0W,0", sizeof(lastOutLine));
  g_teLedgerFileReady = false;

  bool storageReady = g_sdInserted;
  if (!storageReady) {
    if (sdProbeAndMount(false) || sdProbeAndMount(true)) {
      g_sdInserted = true;
      storageReady = true;
    }
  }

  if (storageReady && SD.exists(SD_TOTAL_ENERGY_FILE_PATH)) {
    SD.remove(SD_TOTAL_ENERGY_FILE_PATH);
  }

  tePrefsSaveState();
  teInvalidatePublishedMetrics();
  teEnsureLedgerFileReady();
  if (g_webDeviceRegisteredKnown && !g_webDeviceRegistered) {
    subscriptionApplyUnregistered();
  } else {
    subscriptionApplyExpired();
  }
  tePublishMetricsToAtmega(true);
  webMarkLogUploadDirty(SD_TOTAL_ENERGY_FILE_PATH);
  Serial.println("[TE] subscription state reset complete");
}

// [NEW FEATURE] Clear local SD logs + energy ledger when WEB deletes/re-registers the device.
static void teResetLocalState() {
  prefs.begin("abba-energy", false);
  prefs.clear();
  prefs.end();

  g_assignedEnergyJ = 0;
  g_planStartDate[0] = 0;
  g_planRemainingDays = 0;

  g_teSessionActive = false;
  g_teSessionStartTotalJ = 0;
  g_teSessionStartDate[0] = 0;
  g_teSessionStartTime[0] = 0;
  g_teCurrentDayDate[0] = 0;
  g_teCurrentDayTotalJ = 0;
  g_teDeviceTotalJ = 0;

  g_teRunEventQHead = 0;
  g_teRunEventQTail = 0;
  g_teRunEventDropCount = 0;
  g_teLastQueuedRunState = 0xFF;
  g_teLastQueuedTotalJ = 0;
  g_teLastQueuedMs = 0;
  g_teLastRealEventMs = 0;
  g_teFallbackTotalJ = 0;

  strlcpy(lastOutLine, "0W,0", sizeof(lastOutLine));
  g_sdLastLoggedLine[0] = 0;
  g_sdLastLoggedPage = 0xFF;
  g_teLedgerFileReady = false;

  bool storageReady = g_sdInserted;
  if (!storageReady) {
    if (sdProbeAndMount(false) || sdProbeAndMount(true)) {
      g_sdInserted = true;
      storageReady = true;
    }
  }

  if (storageReady) {
    if (SD.exists(SD_LOG_FILE_PATH)) SD.remove(SD_LOG_FILE_PATH);
    if (SD.exists(SD_TOTAL_ENERGY_FILE_PATH)) SD.remove(SD_TOTAL_ENERGY_FILE_PATH);
  }

  teInvalidatePublishedMetrics();
  teEnsureLedgerFileReady();
  tePublishMetricsToAtmega(true);
  webMarkLogUploadDirty(SD_LOG_FILE_PATH);
  webMarkLogUploadDirty(SD_TOTAL_ENERGY_FILE_PATH);
  Serial.println("[TE] local state reset complete");
}

// [NEW FEATURE] Append raw ledger line to /TotalEnergy.txt (append-only).
static bool teAppendLedgerLine(const char* line) {
  if (!line || !line[0]) return false;

  if (!g_sdInserted) {
    if (!sdProbeAndMount(false) && !sdProbeAndMount(true)) return false;
    g_sdInserted = true;
  }

  File f = SD.open(SD_TOTAL_ENERGY_FILE_PATH, FILE_APPEND);
  if (!f) {
    if (!sdProbeAndMount(true)) return false;
    f = SD.open(SD_TOTAL_ENERGY_FILE_PATH, FILE_APPEND);
    if (!f) return false;
    g_sdInserted = true;
  }
  f.printf("%s\n", line);
  f.close();
  webMarkLogUploadDirty(SD_TOTAL_ENERGY_FILE_PATH);
  Serial.printf("[TE] append ok: %s\n", line);
  return true;
}

// [NEW FEATURE] Ensure /TotalEnergy.txt exists even before the first run-stop event.
static void teEnsureLedgerFileReady() {
  static uint32_t s_lastEnsureFailLogMs = 0;
  if (g_teLedgerFileReady) return;

  // [NEW FEATURE] Do not compete with sdSetup/sdTick mount flow when SD is not detected yet.
  if (!g_sdInserted) {
    uint32_t now = millis();
    if ((uint32_t)(now - s_lastEnsureFailLogMs) >= 5000U) {
      s_lastEnsureFailLogMs = now;
      Serial.println("[TE] ledger ensure skip: SD not detected yet");
    }
    return;
  }

  File f = SD.open(SD_TOTAL_ENERGY_FILE_PATH, FILE_APPEND);
  if (!f) {
    if (!sdProbeAndMount(true)) {
      uint32_t now = millis();
      if ((uint32_t)(now - s_lastEnsureFailLogMs) >= 5000U) {
        s_lastEnsureFailLogMs = now;
        Serial.println("[TE] ledger ensure fail: remount failed");
      }
      return;
    }
    f = SD.open(SD_TOTAL_ENERGY_FILE_PATH, FILE_APPEND);
    if (!f) {
      uint32_t now = millis();
      if ((uint32_t)(now - s_lastEnsureFailLogMs) >= 5000U) {
        s_lastEnsureFailLogMs = now;
        Serial.println("[TE] ledger ensure fail: open append failed");
      }
      return;
    }
    g_sdInserted = true;
  }

  if (f.size() == 0) {
    char line[96];
    snprintf(line, sizeof(line), "[DEVICE_TOTAL] %llu J", (unsigned long long)g_teDeviceTotalJ);
    f.printf("%s\n", line);
    tePrefsSaveState();
    webMarkLogUploadDirty(SD_TOTAL_ENERGY_FILE_PATH);
    Serial.printf("[TE] ledger init created: %s\n", SD_TOTAL_ENERGY_FILE_PATH);
  }

  f.close();
  g_teLedgerFileReady = true;
  Serial.println("[TE] ledger ready");
}

// [NEW FEATURE] Append previous day's total once at calendar day boundary.
static void teFlushDailyIfDateChanged() {
  char today[11];
  char nowTime[9];
  if (!teNowDateTime(today, sizeof(today), nowTime, sizeof(nowTime))) {
    return;
  }

  if (g_teCurrentDayDate[0] == 0) {
    strlcpy(g_teCurrentDayDate, today, sizeof(g_teCurrentDayDate));
    tePrefsSaveState();
    return;
  }

  if (strcmp(g_teCurrentDayDate, today) == 0) {
    return;
  }

  char line[128];
  snprintf(line, sizeof(line), "[DAILY_TOTAL] DATE=%s TOTAL=%llu J",
           g_teCurrentDayDate, (unsigned long long)g_teCurrentDayTotalJ);
  if (!teAppendLedgerLine(line)) return;

  strlcpy(g_teCurrentDayDate, today, sizeof(g_teCurrentDayDate));
  g_teCurrentDayTotalJ = 0;
  tePrefsSaveState();
}

// [NEW FEATURE] Queue run/stop event from ATmega parsing context.
static void teQueueRunEventFromAtmega(uint8_t runState, uint32_t totalEnergy) {
  static uint32_t s_lastDropLogMs = 0;
  // [NEW FEATURE] Ignore immediate duplicates (e.g., mirrored UART0/UART1 event lines).
  uint8_t normalizedState = runState ? 1U : 0U;
  uint32_t now = millis();
  if ((g_teLastQueuedRunState == normalizedState) &&
      (g_teLastQueuedTotalJ == totalEnergy) &&
      ((uint32_t)(now - g_teLastQueuedMs) <= 300U)) {
    return;
  }
  g_teLastQueuedRunState = normalizedState;
  g_teLastQueuedTotalJ = totalEnergy;
  g_teLastQueuedMs = now;

  uint8_t head = g_teRunEventQHead;
  uint8_t next = (uint8_t)((head + 1U) % TE_RUN_EVENT_Q_CAP);
  if (next == g_teRunEventQTail) {
    // Queue full: drop oldest to preserve newest real-time state.
    g_teRunEventQTail = (uint8_t)((g_teRunEventQTail + 1U) % TE_RUN_EVENT_Q_CAP);
    g_teRunEventDropCount++;
    if ((uint32_t)(now - s_lastDropLogMs) >= 1000U) {
      s_lastDropLogMs = now;
      Serial.printf("[TE] run-event queue overflow drops=%lu\n", (unsigned long)g_teRunEventDropCount);
    }
  }
  g_teRunEventQ[head].runState = normalizedState;
  g_teRunEventQ[head].totalJ = totalEnergy;
  g_teRunEventQHead = next;
}

static bool teDequeueRunEvent(uint8_t& runStateOut, uint32_t& totalOut) {
  uint8_t tail = g_teRunEventQTail;
  if (tail == g_teRunEventQHead) return false;

  runStateOut = g_teRunEventQ[tail].runState;
  totalOut = g_teRunEventQ[tail].totalJ;
  g_teRunEventQTail = (uint8_t)((tail + 1U) % TE_RUN_EVENT_Q_CAP);
  return true;
}

struct TeFileStats {
  uint64_t deviceTotal;
  uint64_t dailySum;
  uint32_t dailyCount;
  uint64_t monthlySum;
  uint32_t monthlyCount;
};

// [NEW FEATURE] Parse /TotalEnergy.txt and compute daily/monthly aggregate metrics.
static void teComputeFileStats(TeFileStats& out) {
  out.deviceTotal = g_teDeviceTotalJ;
  out.dailySum = 0;
  out.dailyCount = 0;
  out.monthlySum = 0;
  out.monthlyCount = 0;

  if (!g_sdInserted) return;
  File f = SD.open(SD_TOTAL_ENERGY_FILE_PATH, FILE_READ);
  if (!f) return;

  static const uint8_t TE_MONTH_BUCKET_MAX = 120;
  uint32_t monthKeys[TE_MONTH_BUCKET_MAX];
  uint64_t monthTotals[TE_MONTH_BUCKET_MAX];
  uint8_t monthUsed = 0;
  // [NEW FEATURE] DAILY_TOTAL can now be appended multiple times per date as a cumulative snapshot.
  char lastDailyDate[11] = {0};
  uint64_t lastDailyTotal = 0;
  memset(monthKeys, 0, sizeof(monthKeys));
  memset(monthTotals, 0, sizeof(monthTotals));

  char line[192];
  while (f.available()) {
    size_t n = f.readBytesUntil('\n', line, sizeof(line) - 1);
    line[n] = 0;
    if (n == 0) continue;

    if (strncmp(line, "[DEVICE_TOTAL]", 14) == 0) {
      const char* p = line + 14;
      while (*p == ' ' || *p == '\t') p++;
      out.deviceTotal = teParseU64(p, out.deviceTotal);
      continue;
    }

    if (strncmp(line, "[DAILY_TOTAL]", 13) == 0) {
      const char* datePos = strstr(line, "DATE=");
      const char* totalPos = strstr(line, "TOTAL=");
      char dateKey[11] = {0};
      bool validDate = false;
      if (!datePos || !totalPos) continue;
      datePos += 5;
      totalPos += 6;

      uint64_t dayTotal = teParseU64(totalPos, 0);
      uint64_t dayDelta = dayTotal;

      if (isdigit((unsigned char)datePos[0]) && isdigit((unsigned char)datePos[1]) &&
          isdigit((unsigned char)datePos[2]) && isdigit((unsigned char)datePos[3]) &&
          datePos[4] == '-' &&
          isdigit((unsigned char)datePos[5]) && isdigit((unsigned char)datePos[6]) &&
          datePos[7] == '-' &&
          isdigit((unsigned char)datePos[8]) && isdigit((unsigned char)datePos[9])) {
        memcpy(dateKey, datePos, 10);
        dateKey[10] = 0;
        validDate = true;
      }

      if (validDate && strcmp(lastDailyDate, dateKey) == 0) {
        if (dayTotal >= lastDailyTotal) {
          dayDelta = dayTotal - lastDailyTotal;
        } else {
          dayDelta = 0;
        }
      } else {
        out.dailyCount++;
      }

      out.dailySum += dayDelta;
      if (validDate) {
        strlcpy(lastDailyDate, dateKey, sizeof(lastDailyDate));
        lastDailyTotal = dayTotal;
      }

      if (validDate) {
        uint32_t year = (uint32_t)(datePos[0] - '0') * 1000U +
                        (uint32_t)(datePos[1] - '0') * 100U +
                        (uint32_t)(datePos[2] - '0') * 10U +
                        (uint32_t)(datePos[3] - '0');
        uint32_t month = (uint32_t)(datePos[5] - '0') * 10U + (uint32_t)(datePos[6] - '0');
        uint32_t ym = year * 100U + month;

        uint8_t i = 0;
        for (; i < monthUsed; i++) {
          if (monthKeys[i] == ym) {
            monthTotals[i] += dayDelta;
            break;
          }
        }
        if (i == monthUsed && monthUsed < TE_MONTH_BUCKET_MAX) {
          monthKeys[monthUsed] = ym;
          monthTotals[monthUsed] = dayDelta;
          monthUsed++;
        }
      }
    }
  }
  f.close();

  out.monthlyCount = monthUsed;
  for (uint8_t i = 0; i < monthUsed; i++) {
    out.monthlySum += monthTotals[i];
  }
}

// [NEW FEATURE] Send one energy metric line to ATmega firmware parser.
static void teSendMetricToAtmega(char key, uint64_t value) {
  char line[52];
  uint32_t v = teClampU32(value);
  snprintf(line, sizeof(line), "@ENG|%c|%lu\n", key, (unsigned long)v);
  ATMEGA.write((const uint8_t*)line, strlen(line));
  ATMEGA.flush();
  Serial.printf("[ESP->AT] ENG|%c|%lu\n", key, (unsigned long)v);
}

// [NEW FEATURE] Publish page57/page71 source metrics to firmware through existing UART text channel.
static void tePublishMetricsToAtmega(bool force) {
  uint32_t now = millis();
  if (!force && (uint32_t)(now - g_teLastPushMs) < ENERGY_PUSH_INTERVAL_MS) return;

  TeFileStats stats;
  teComputeFileStats(stats);
  g_teDeviceTotalJ = stats.deviceTotal;

  uint64_t dailyAvg = (stats.dailyCount > 0) ? (stats.dailySum / (uint64_t)stats.dailyCount) : 0;
  uint64_t monthlyAvg = (stats.monthlyCount > 0) ? (stats.monthlySum / (uint64_t)stats.monthlyCount) : 0;
  uint32_t elapsedDays = 1;
  if (!calcElapsedDaysFromStart(g_planStartDate, elapsedDays) || elapsedDays == 0) elapsedDays = 1;
  uint32_t remainDays = (g_planRemainingDays > 0) ? (uint32_t)g_planRemainingDays : 0;
  uint64_t projected = stats.deviceTotal + (dailyAvg * (uint64_t)remainDays);

  if (force || g_teLastPubAssignedJ != g_assignedEnergyJ) teSendMetricToAtmega('A', g_assignedEnergyJ);
  if (force || g_teLastPubUsedJ != stats.deviceTotal) teSendMetricToAtmega('U', stats.deviceTotal);
  if (force || g_teLastPubDailyAvgJ != dailyAvg) teSendMetricToAtmega('D', dailyAvg);
  if (force || g_teLastPubMonthlyAvgJ != monthlyAvg) teSendMetricToAtmega('M', monthlyAvg);
  if (force || g_teLastPubProjectedJ != projected) teSendMetricToAtmega('P', projected);
  if (force || g_teLastPubElapsedDays != elapsedDays) teSendMetricToAtmega('E', elapsedDays);
  if (force || g_teLastPubRemainDays != remainDays) teSendMetricToAtmega('R', remainDays);

  g_teLastPubAssignedJ = g_assignedEnergyJ;
  g_teLastPubUsedJ = stats.deviceTotal;
  g_teLastPubDailyAvgJ = dailyAvg;
  g_teLastPubMonthlyAvgJ = monthlyAvg;
  g_teLastPubProjectedJ = projected;
  g_teLastPubElapsedDays = elapsedDays;
  g_teLastPubRemainDays = remainDays;
  g_teLastPushMs = now;
}

// [NEW FEATURE] Consume queued run/stop events and append TotalEnergy.txt ledger lines.
static void teProcessPendingRunEvent() {
  uint8_t runState = 0;
  uint32_t totalRaw = 0;

  while (teDequeueRunEvent(runState, totalRaw)) {
    uint64_t totalNow = totalRaw;

    char nowDate[11];
    char nowTime[9];
    teNowDateTime(nowDate, sizeof(nowDate), nowTime, sizeof(nowTime));

    if (runState) {
      if (!g_teSessionActive) {
        g_teSessionActive = true;
        g_teSessionStartTotalJ = totalNow;
        strlcpy(g_teSessionStartDate, nowDate, sizeof(g_teSessionStartDate));
        strlcpy(g_teSessionStartTime, nowTime, sizeof(g_teSessionStartTime));
        Serial.printf("[TE] session start date=%s time=%s total=%llu\n",
                      g_teSessionStartDate, g_teSessionStartTime,
                      (unsigned long long)g_teSessionStartTotalJ);
      }
      continue;
    }

    if (!g_teSessionActive) {
      // Stop event without a matching start; keep metrics only.
      tePublishMetricsToAtmega(true);
      continue;
    }

    if (g_teCurrentDayDate[0] == 0) {
      strlcpy(g_teCurrentDayDate, nowDate, sizeof(g_teCurrentDayDate));
    } else if (strcmp(g_teCurrentDayDate, nowDate) != 0) {
      char dailyLine[128];
      snprintf(dailyLine, sizeof(dailyLine), "[DAILY_TOTAL] DATE=%s TOTAL=%llu J",
               g_teCurrentDayDate, (unsigned long long)g_teCurrentDayTotalJ);
      if (teAppendLedgerLine(dailyLine)) {
        strlcpy(g_teCurrentDayDate, nowDate, sizeof(g_teCurrentDayDate));
        g_teCurrentDayTotalJ = 0;
      }
    }

    uint64_t sessionEnergy = 0;
    if (totalNow >= g_teSessionStartTotalJ) {
      sessionEnergy = totalNow - g_teSessionStartTotalJ;
    } else {
      Serial.printf("[TE] warn: stop total rollback start=%llu stop=%llu\n",
                    (unsigned long long)g_teSessionStartTotalJ,
                    (unsigned long long)totalNow);
    }

    char sessionLine[192];
    snprintf(sessionLine, sizeof(sessionLine),
             "[SESSION] DATE=%s START=%s END=%s ENERGY=%llu J",
             g_teSessionStartDate[0] ? g_teSessionStartDate : nowDate,
             g_teSessionStartTime[0] ? g_teSessionStartTime : nowTime,
             nowTime,
             (unsigned long long)sessionEnergy);
    teAppendLedgerLine(sessionLine);

    g_teCurrentDayTotalJ += sessionEnergy;
    g_teDeviceTotalJ += sessionEnergy;

    // [NEW FEATURE] Append cumulative DAILY_TOTAL snapshot on every session stop.
    char dailyLine[128];
    snprintf(dailyLine, sizeof(dailyLine), "[DAILY_TOTAL] DATE=%s TOTAL=%llu J",
             g_teCurrentDayDate[0] ? g_teCurrentDayDate : nowDate,
             (unsigned long long)g_teCurrentDayTotalJ);
    teAppendLedgerLine(dailyLine);

    char deviceLine[96];
    snprintf(deviceLine, sizeof(deviceLine), "[DEVICE_TOTAL] %llu J", (unsigned long long)g_teDeviceTotalJ);
    teAppendLedgerLine(deviceLine);

    g_teSessionActive = false;
    g_teSessionStartTotalJ = 0;
    g_teSessionStartDate[0] = 0;
    g_teSessionStartTime[0] = 0;
    tePrefsSaveState();
    tePublishMetricsToAtmega(true);
  }
}

// [NEW FEATURE] Central energy tick: daily rollover, run-event processing, firmware metric sync.
static void teTick() {
  teEnsureLedgerFileReady();
  teProcessPendingRunEvent();
  teFlushDailyIfDateChanged();
  tePublishMetricsToAtmega(false);
}

static void normalizePlanLabel(const char* in, char* out, size_t outSz) {
  if (!out || outSz == 0) return;
  out[0] = 0;
  if (!in || !in[0]) {
    snprintf(out, outSz, "-");
    return;
  }

  char tmp[40];
  size_t n = strlen(in);
  if (n >= sizeof(tmp)) n = sizeof(tmp) - 1;
  memcpy(tmp, in, n);
  tmp[n] = 0;

  char packed[40];
  size_t pi = 0;
  for (size_t i = 0; tmp[i] != 0 && pi + 1 < sizeof(packed); i++) {
    char c = tmp[i];
    if (c == ' ' || c == '\t') continue;
    packed[pi++] = (char)toupper((unsigned char)c);
  }
  packed[pi] = 0;

  if (!strcmp(packed, "BASIC1M")) snprintf(out, outSz, "BASIC 1m");
  else if (!strcmp(packed, "BASIC3M")) snprintf(out, outSz, "BASIC 3m");
  else if (!strcmp(packed, "BASIC6M")) snprintf(out, outSz, "BASIC 6m");
  else if (!strcmp(packed, "BASIC9M")) snprintf(out, outSz, "BASIC 9m");
  else if (!strcmp(packed, "BASIC1Y")) snprintf(out, outSz, "BASIC 1Y");
  else if (!strcmp(packed, "TESTPLAN")) snprintf(out, outSz, "Test Plan");
  else snprintf(out, outSz, "-");
}

static void sanitizeSubField(const char* in, char* out, size_t outSz) {
  if (!out || outSz == 0) return;
  out[0] = 0;
  if (!in) return;

  size_t oi = 0;
  for (size_t i = 0; in[i] != 0 && oi + 1 < outSz; i++) {
    char c = in[i];
    if (c == '|' || c == '\r' || c == '\n') c = ' ';
    if ((uint8_t)c < 0x20 || (uint8_t)c > 0x7E) c = ' ';
    out[oi++] = c;
  }
  out[oi] = 0;
}

static void atmegaPublishSubscriptionActive(const char* planLabel, const char* range, int remainingDays) {
  char planSafe[20];
  char rangeSafe[40];
  char line[120];

  sanitizeSubField(planLabel, planSafe, sizeof(planSafe));
  sanitizeSubField(range, rangeSafe, sizeof(rangeSafe));
  if (remainingDays < 0) remainingDays = 0;

  g_atmegaSubStateCode = 'A';
  strncpy(g_atmegaSubPlanLabel, planSafe, sizeof(g_atmegaSubPlanLabel) - 1);
  g_atmegaSubPlanLabel[sizeof(g_atmegaSubPlanLabel) - 1] = 0;
  strncpy(g_atmegaSubRange, rangeSafe, sizeof(g_atmegaSubRange) - 1);
  g_atmegaSubRange[sizeof(g_atmegaSubRange) - 1] = 0;
  g_atmegaSubRemainingDays = remainingDays;
  g_lastAtmegaSubPublishMs = millis();

  snprintf(line, sizeof(line), "@SUB|A|%s|%s|%d\n", planSafe, rangeSafe, remainingDays);
  ATMEGA.write((const uint8_t*)line, strlen(line));
  ATMEGA.flush();
}

static void dwinRenderSubscriptionActive(const char* plan, const char* startDate, const char* expiryDate, int remainingDays) {
  char planLabel[16];
  normalizePlanLabel(plan, planLabel, sizeof(planLabel));

  char sDot[16];
  char eDot[16];
  formatDateDots(startDate, sDot, sizeof(sDot));
  formatDateDots(expiryDate, eDot, sizeof(eDot));

  char range[48];
  snprintf(range, sizeof(range), "%s-%s", sDot, eDot);

  if (remainingDays < 0) remainingDays = 0;
  atmegaPublishSubscriptionActive(planLabel, range, remainingDays);
  Serial.printf("[SUB] ACTIVE plan='%s' remain=%d period='%s'\n", planLabel, remainingDays, range);
}

static int resolveRemainingDays(const char* expiryDate, int apiRemainingDays) {
  int localDays = 0;
  bool localOk = calcRemainingDaysFromExpiry(expiryDate, localDays);
  bool apiOk = (apiRemainingDays >= 0);

  if (localOk && apiOk) {
    int diff = localDays - apiRemainingDays;
    if (diff < 0) diff = -diff;
    if (diff <= 1) return localDays;
    return apiRemainingDays;
  }
  if (localOk) return localDays;
  if (apiOk) return apiRemainingDays;
  return 0;
}

static void subscriptionApplyActive(const char* plan, const char* startDate, const char* expiryDate, int remainingDays) {
  int resolvedDays = resolveRemainingDays(expiryDate, remainingDays);
  // Ensure bridge forwarding is active before ATmega emits DWIN text/icon frames.
  applyRegisteredReadyPage("active");
  dwinRenderSubscriptionActive(plan, startDate, expiryDate, resolvedDays);
  melauhfPowerSet(true);
  g_subGateState = SUB_GATE_ACTIVE;
  g_subBootResolved = true;
  lastWebSubscriptionOkMs = millis();
}

static void subscriptionApplyExpired() {
  melauhfPowerSet(true);
  setBridgeEnabledForSubscription(true, "expired");
  pushSubscriptionLockPage(59, "expired");
  g_subGateState = SUB_GATE_EXPIRED;
  g_subBootResolved = true;
  lastWebSubscriptionOkMs = millis();
  Serial.println("[SUB] EXPIRED -> page 59");
}

static void subscriptionApplyUnregistered() {
  melauhfPowerSet(true);
  setBridgeEnabledForSubscription(true, "unregistered");
  pushSubscriptionLockPage(DWIN_PAGE_DEVICE_UNREGISTERED, "unregistered");
  g_subGateState = SUB_GATE_UNREGISTERED;
  g_subBootResolved = true;
  lastWebSubscriptionOkMs = millis();
  Serial.printf("[SUB] UNREGISTERED -> page %u\n", (unsigned)DWIN_PAGE_DEVICE_UNREGISTERED);
}

static void webSubscriptionSyncTick(bool force) {
  if (WiFi.status() != WL_CONNECTED) {
    if (portalMode) {
      setBridgeEnabledForSubscription(true, "portal_wifi_disconnected");
      return;
    }
    subscriptionEnterOfflineLock("wifi_disconnected");
    return;
  }
  uint32_t now = millis();
  if (!force && (uint32_t)(now - lastWebSubscriptionSyncMs) < WEB_SUBSCRIPTION_SYNC_PERIOD_MS) return;
  lastWebSubscriptionSyncMs = now;

  char didEnc[96];
  char path[192];
  urlEncodeValue(deviceIdC(), didEnc, sizeof(didEnc));
  snprintf(path, sizeof(path), "/api/devices/%s/subscription", didEnc);

  String body;
  int code = 0;
  bool ok = webGetPath(path, body, code);
  if (!ok) {
    Serial.printf("[SUB] GET %s failed (code=%d)\n", path, code);
    subscriptionEnterOfflineLock("subscription_api_fail");
    return;
  }

  webHandlePendingCommand(body);

  char statusCode[20] = {0};
  char statusRaw[24] = {0};
  char plan[40] = {0};
  char startDate[20] = {0};
  char expiryDate[20] = {0};
  int remainingDays = -1;
  uint64_t assignedEnergy = g_assignedEnergyJ;

  jsonExtractStringValue(body, "status_code", statusCode, sizeof(statusCode));
  jsonExtractStringValue(body, "status", statusRaw, sizeof(statusRaw));
  jsonExtractStringValue(body, "plan", plan, sizeof(plan));
  jsonExtractStringValue(body, "start_date", startDate, sizeof(startDate));
  jsonExtractStringValue(body, "expiry_date", expiryDate, sizeof(expiryDate));
  jsonExtractIntValue(body, "remaining_days", remainingDays);
  // [NEW FEATURE] Read assigned subscription energy (J) without altering legacy fields.
  if (!jsonExtractUint64Value(body, "energyJ", assignedEnergy)) {
    jsonExtractUint64Value(body, "energy_j", assignedEnergy);
  }

  if (statusCode[0] == 0) {
    if (!strcasecmp(statusRaw, "active")) strncpy(statusCode, "active", sizeof(statusCode) - 1);
    else if (!strcasecmp(statusRaw, "expired")) strncpy(statusCode, "expired", sizeof(statusCode) - 1);
    else if (!strcasecmp(statusRaw, "unregistered")) strncpy(statusCode, "unregistered", sizeof(statusCode) - 1);
    else if (!strcasecmp(statusRaw, "restricted")) strncpy(statusCode, "expired", sizeof(statusCode) - 1);
    else strncpy(statusCode, "expired", sizeof(statusCode) - 1);
  }

  bool deviceRegistered = g_webDeviceRegisteredKnown && g_webDeviceRegistered;
  bool deviceUnregistered = ((!strcasecmp(statusCode, "unregistered")) && !deviceRegistered) ||
                            (!strcasecmp(statusCode, "expired") && !deviceRegistered);
  bool deviceRegisteredNoPlan = (!strcasecmp(statusCode, "unregistered")) && deviceRegistered;

  if (!strcasecmp(statusCode, "active")) {
    // [NEW FEATURE] Persist active plan energy and plan date context for page57/page71 metrics.
    if (g_assignedEnergyJ != assignedEnergy) {
      g_assignedEnergyJ = assignedEnergy;
      tePrefsSaveState();
    }
    strlcpy(g_planStartDate, startDate, sizeof(g_planStartDate));
    g_planRemainingDays = (remainingDays > 0) ? remainingDays : 0;
    // [NEW FEATURE] Trace assigned energy ingestion from WEB subscription payload.
    Serial.printf("[SUB] energyJ=%llu start=%s remain=%d\n",
                  (unsigned long long)g_assignedEnergyJ,
                  g_planStartDate,
                  g_planRemainingDays);
    subscriptionApplyActive(plan, startDate, expiryDate, remainingDays);
    tePublishMetricsToAtmega(true);
  } else if (deviceRegisteredNoPlan) {
    g_planStartDate[0] = 0;
    g_planRemainingDays = 0;
    applyRegisteredReadyPage("registered_no_plan");
    tePublishMetricsToAtmega(true);
  } else if (deviceUnregistered) {
    if (g_assignedEnergyJ != 0) {
      g_assignedEnergyJ = 0;
      tePrefsSaveState();
    }
    g_planStartDate[0] = 0;
    g_planRemainingDays = 0;
    subscriptionApplyUnregistered();
    tePublishMetricsToAtmega(true);
  } else if (!strcasecmp(statusCode, "expired")) {
    // [NEW FEATURE] Keep assigned energy aligned with the latest WEB payload even on expiry/revoke.
    if (g_assignedEnergyJ != assignedEnergy) {
      g_assignedEnergyJ = assignedEnergy;
      tePrefsSaveState();
    }
    g_planStartDate[0] = 0;
    g_planRemainingDays = 0;
    subscriptionApplyExpired();
    tePublishMetricsToAtmega(true);
  } else {
    // [NEW FEATURE] Keep assigned energy aligned with the latest WEB payload even on fallback expiry.
    if (g_assignedEnergyJ != assignedEnergy) {
      g_assignedEnergyJ = assignedEnergy;
      tePrefsSaveState();
    }
    g_planStartDate[0] = 0;
    g_planRemainingDays = 0;
    subscriptionApplyExpired();
    tePublishMetricsToAtmega(true);
  }
}

static uint32_t lastWebPingMs = 0;
static void webPingTick() {
  if (WiFi.status() != WL_CONNECTED) return;
  uint32_t now = millis();
  uint32_t period = ((lastWebOkMs == 0 && lastWebFailMs == 0) ? 2000 : 15000);
  if ((uint32_t)(now - lastWebPingMs) < period) return;
  lastWebPingMs = now;
  webGetPing();
}


static void extractPowerTimeFromLineC(const char* line, char* powerOut, size_t powerSz, char* timeOut, size_t timeSz) {
  if (powerOut && powerSz) { powerOut[0] = '-'; if (powerSz > 1) powerOut[1] = 0; }
  if (timeOut && timeSz)  { timeOut[0]  = '-'; if (timeSz > 1)  timeOut[1]  = 0; }
  if (!line) return;

  const char* comma = strchr(line, ',');
  if (!comma) return;

  const char* p = line;
  while (*p == ' ' || *p == '\t') p++;
  if (!isdigit((unsigned char)*p)) return;

  const char* w = comma;
  while (w > p && (w[-1] == ' ' || w[-1] == '\t')) w--;
  if (w <= p || w[-1] != 'W') return;

  size_t labelLen = (size_t)(w - p);
  if (labelLen >= powerSz) labelLen = powerSz - 1;
  memcpy(powerOut, p, labelLen);
  powerOut[labelLen] = 0;

  const char* s = comma + 1;
  while (*s == ' ' || *s == '\t') s++;
  size_t secLen = strcspn(s, "\r\n");
  while (secLen > 0 && (s[secLen - 1] == ' ' || s[secLen - 1] == '\t')) secLen--;
  if (secLen == 0) return;
  if (secLen >= timeSz) secLen = timeSz - 1;
  memcpy(timeOut, s, secLen);
  timeOut[secLen] = 0;
}

static void sdResetUsageStats() {
  g_sdTotalMB = 0;
  g_sdUsedMB = 0;
  g_sdFreeMB = 0;
  g_sdLastStatsMs = 0;
  g_sdLastHeavyStatsMs = 0;
}

static bool sdBeginCheckedAtFreq(uint32_t freqHz) {
  if (freqHz == 0) return false;
  if (!SD.begin(SD_SPI_CS_PIN, SPI, freqHz)) return false;

  uint8_t cardType = SD.cardType();
  if (cardType == CARD_NONE) {
    SD.end();
    return false;
  }
  return true;
}

static bool sdProbeAndMount(bool forceRemount) {
  static uint32_t s_lastProbeFailLogMs = 0;
  static const uint32_t kFreqCandidates[] = { SD_SPI_FREQ_HZ, 400000U, 2000000U };

  if (!forceRemount && g_sdInserted) {
    uint8_t t = SD.cardType();
    if (t != CARD_NONE) return true;
  }

  if (forceRemount) {
    SD.end();
    delay(2);
  }

  // [NEW FEATURE] Keep CS idle-high before each mount attempt for signal stability.
  pinMode(SD_SPI_CS_PIN, OUTPUT);
  digitalWrite(SD_SPI_CS_PIN, HIGH);
  SPI.begin(SD_SPI_SCK_PIN, SD_SPI_MISO_PIN, SD_SPI_MOSI_PIN, SD_SPI_CS_PIN);

  for (size_t i = 0; i < (sizeof(kFreqCandidates) / sizeof(kFreqCandidates[0])); i++) {
    uint32_t freq = kFreqCandidates[i];
    bool dup = false;
    for (size_t j = 0; j < i; j++) {
      if (kFreqCandidates[j] == freq) {
        dup = true;
        break;
      }
    }
    if (dup) continue;
    if (sdBeginCheckedAtFreq(freq)) {
      if (freq != SD_SPI_FREQ_HZ) {
        Serial.printf("[SD] mounted with fallback SPI freq=%lu Hz\n", (unsigned long)freq);
      }
      return true;
    }
  }

  // [NEW FEATURE] Hard bus reset fallback.
  if (forceRemount) {
    SPI.end();
    delay(2);
    pinMode(SD_SPI_CS_PIN, OUTPUT);
    digitalWrite(SD_SPI_CS_PIN, HIGH);
    SPI.begin(SD_SPI_SCK_PIN, SD_SPI_MISO_PIN, SD_SPI_MOSI_PIN, SD_SPI_CS_PIN);

    for (size_t i = 0; i < (sizeof(kFreqCandidates) / sizeof(kFreqCandidates[0])); i++) {
      uint32_t freq = kFreqCandidates[i];
      bool dup = false;
      for (size_t j = 0; j < i; j++) {
        if (kFreqCandidates[j] == freq) {
          dup = true;
          break;
        }
      }
      if (dup) continue;
      if (sdBeginCheckedAtFreq(freq)) {
        if (freq != SD_SPI_FREQ_HZ) {
          Serial.printf("[SD] mounted after bus reset, SPI freq=%lu Hz\n", (unsigned long)freq);
        }
        return true;
      }
    }
  }

  uint32_t now = millis();
  if ((uint32_t)(now - s_lastProbeFailLogMs) >= 5000U) {
    s_lastProbeFailLogMs = now;
    Serial.println("[SD] probe/mount failed");
  }
  if (forceRemount) SD.end();
  return false;
}

static bool sdRefreshUsageStats(bool printToSerial, bool forceHeavyRead) {
  if (!g_sdInserted) return false;

  uint8_t cardType = SD.cardType();
  if (cardType == CARD_NONE) {
    return false;
  }

  const char* cardTypeLabel = "알 수 없음";
  if (cardType == CARD_MMC) cardTypeLabel = "MMC";
  else if (cardType == CARD_SD) cardTypeLabel = "SDSC";
  else if (cardType == CARD_SDHC) cardTypeLabel = "SDHC/SDXC";

  uint64_t totalMB = SD.cardSize() / (1024ULL * 1024ULL);
  uint64_t usedMB = g_sdUsedMB;
  uint64_t freeMB = g_sdFreeMB;

  uint32_t now = millis();
  bool heavyReadDue = forceHeavyRead ||
                      (g_sdLastHeavyStatsMs == 0) ||
                      ((uint32_t)(now - g_sdLastHeavyStatsMs) >= SD_HEAVY_STATS_REFRESH_MS);

  if (heavyReadDue) {
    uint64_t totalBytes = SD.totalBytes();
    uint64_t usedBytes = SD.usedBytes();

    if (totalBytes == 0) totalBytes = SD.cardSize();
    if (totalBytes > 0) {
      if (usedBytes > totalBytes) usedBytes = totalBytes;
      totalMB = totalBytes / (1024ULL * 1024ULL);
      usedMB = usedBytes / (1024ULL * 1024ULL);
      freeMB = (totalBytes - usedBytes) / (1024ULL * 1024ULL);
      g_sdLastHeavyStatsMs = now;
    }
  }
  if (totalMB == 0) totalMB = g_sdTotalMB;

  uint64_t prevTotal = g_sdTotalMB;
  uint64_t prevUsed = g_sdUsedMB;
  uint64_t prevFree = g_sdFreeMB;

  if (totalMB > 0) {
    g_sdTotalMB = totalMB;
    if (usedMB > g_sdTotalMB) usedMB = g_sdTotalMB;
    if (freeMB > g_sdTotalMB) freeMB = g_sdTotalMB;
    if ((usedMB + freeMB) > g_sdTotalMB) {
      freeMB = (g_sdTotalMB >= usedMB) ? (g_sdTotalMB - usedMB) : 0;
    }
    if (usedMB == 0 && freeMB == 0) {
      freeMB = g_sdTotalMB;
    }
    g_sdUsedMB = usedMB;
    g_sdFreeMB = freeMB;
  } else {
    g_sdTotalMB = 0;
    g_sdUsedMB = 0;
    g_sdFreeMB = 0;
  }

  g_sdLastStatsMs = now;
  if (prevTotal != g_sdTotalMB || prevUsed != g_sdUsedMB || prevFree != g_sdFreeMB) {
    g_sdDirty = true;
  }

  if (printToSerial) {
    Serial.print("[SD]   카드 타입 : ");
    Serial.println(cardTypeLabel);
    Serial.printf("[SD]   용량: %llu MB  |  사용: %llu MB  |  여유: %llu MB\n",
                  (unsigned long long)g_sdTotalMB,
                  (unsigned long long)g_sdUsedMB,
                  (unsigned long long)g_sdFreeMB);
  }

  return true;
}

static void sdBuildTimestamp(char* out, size_t outSz) {
  if (!out || outSz == 0) return;
  out[0] = 0;

  time_t nowEpoch = time(nullptr);
  if (nowEpoch < CLOCK_VALID_EPOCH) {
    uint32_t upSec = millis() / 1000U;
    snprintf(out, outSz, "UNSYNC+%lus", (unsigned long)upSec);
    return;
  }

  struct tm nowTm;
  memset(&nowTm, 0, sizeof(nowTm));
  localtime_r(&nowEpoch, &nowTm);
  snprintf(out, outSz, "%04d-%02d-%02d %02d:%02d:%02d",
           nowTm.tm_year + 1900, nowTm.tm_mon + 1, nowTm.tm_mday,
           nowTm.tm_hour, nowTm.tm_min, nowTm.tm_sec);
}

static void sdAppendLogLineInternal(const char* line, bool rateLimit, bool dedupe) {
  if (!g_sdInserted || !line || !line[0]) return;

  char safe[96];
  size_t oi = 0;
  for (size_t i = 0; line[i] != 0 && oi + 1 < sizeof(safe); i++) {
    char c = line[i];
    if (c == '\r' || c == '\n') break;
    if ((uint8_t)c < 0x20 || (uint8_t)c > 0x7E) c = ' ';
    safe[oi++] = c;
  }
  safe[oi] = 0;
  if (!safe[0]) return;

  uint32_t now = millis();
  if (rateLimit && (uint32_t)(now - g_sdLastLogWriteMs) < SD_LOG_MIN_INTERVAL_MS) {
    return;
  }
  if (dedupe && strcmp(g_sdLastLoggedLine, safe) == 0) {
    return;
  }

  File f = SD.open(SD_LOG_FILE_PATH, FILE_APPEND);
  if (!f) {
    if (!sdProbeAndMount(false) && !sdProbeAndMount(true)) {
      return;
    }
    f = SD.open(SD_LOG_FILE_PATH, FILE_APPEND);
    if (!f) return;
  }

  char ts[24];
  char stamped[128];
  sdBuildTimestamp(ts, sizeof(ts));
  snprintf(stamped, sizeof(stamped), "[%s] %s", ts, safe);

  f.printf("%s\n", stamped);
  f.close();
  webMarkLogUploadDirty(SD_LOG_FILE_PATH);

  if (dedupe) strlcpy(g_sdLastLoggedLine, safe, sizeof(g_sdLastLoggedLine));
  else g_sdLastLoggedLine[0] = 0;
  g_sdLastLogWriteMs = now;
  if ((uint32_t)(now - g_sdLastStatsMs) >= SD_STATS_REFRESH_MS) {
    sdRefreshUsageStats(false, false);
  }
}

static void sdAppendLogLine(const char* line) {
  sdAppendLogLineInternal(line, true, true);
}

static void sdAppendLogLineImmediate(const char* line) {
  sdAppendLogLineInternal(line, false, false);
}

static void sdAppendEventLog(const char* eventText) {
  sdAppendLogLine(eventText);
}

static void sdAppendPageLog(uint8_t page) {
  if (g_sdLastLoggedPage == page) return;
  g_sdLastLoggedPage = page;

  char line[24];
  snprintf(line, sizeof(line), "page %u", (unsigned)page);
  sdAppendLogLineImmediate(line);
}

static void sdAppendRkcLog(uint16_t keyCode) {
  char line[24];
  snprintf(line, sizeof(line), "RKC : 0x%04X", (unsigned)keyCode);
  sdAppendLogLineImmediate(line);
}

static void sdSetup() {
  Serial.println();
  Serial.println("[SD] -- SD카드 감지 초기화 --");
  Serial.printf("[SD] 핀: CS=%d MOSI=%d SCK=%d MISO=%d\n",
                SD_SPI_CS_PIN, SD_SPI_MOSI_PIN, SD_SPI_SCK_PIN, SD_SPI_MISO_PIN);
  // [NEW FEATURE] Ensure CS idle-high before SPI/SD init.
  pinMode(SD_SPI_CS_PIN, OUTPUT);
  digitalWrite(SD_SPI_CS_PIN, HIGH);
  SPI.begin(SD_SPI_SCK_PIN, SD_SPI_MISO_PIN, SD_SPI_MOSI_PIN, SD_SPI_CS_PIN);

  bool present = false;
  // [NEW FEATURE] SD power-up can be slow on some boards; retry a few times before declaring no card.
  for (uint8_t i = 0; i < 3 && !present; i++) {
    present = sdProbeAndMount(false);
    if (!present) present = sdProbeAndMount(true);
    if (!present) delay(120);
  }
  g_sdInserted = present;
  g_sdLastProbeMs = millis();
  g_sdFailStreak = 0;
  g_sdNoCardProbeIntervalMs = SD_PROBE_INTERVAL_NO_CARD_MS;
  g_sdDirty = true;
  g_sdLastLoggedPage = 0xFF;

  if (present) {
    Serial.println("[SD] SD카드 감지됨 (부팅 시)");
    sdRefreshUsageStats(true, true);
    sdAppendEventLog("BOOT: SD ready");
  } else {
    sdResetUsageStats();
    Serial.println("[SD] SD카드 없음 (삽입하면 자동 감지)");
  }
}

static void sdTick() {
  static uint32_t s_lastNoCardLogMs = 0;
  uint32_t now = millis();
  uint32_t interval = g_sdInserted ? SD_PROBE_INTERVAL_WITH_CARD_MS : g_sdNoCardProbeIntervalMs;
  if ((uint32_t)(now - g_sdLastProbeMs) < interval) return;
  g_sdLastProbeMs = now;

  if (g_sdInserted) {
    bool present = sdProbeAndMount(true);

    if (!present) {
      g_sdFailStreak++;
      if (g_sdFailStreak < SD_REMOVE_FAIL_STREAK) return;
      Serial.println();
      Serial.println("[SD] ❌ SD카드 제거됨.");
      g_sdFailStreak = 0;
      g_sdInserted = false;
      g_sdNoCardProbeIntervalMs = SD_PROBE_INTERVAL_NO_CARD_MS;
      g_sdDirty = true;
      g_sdLastLoggedPage = 0xFF;
      g_teLedgerFileReady = false; // [NEW FEATURE] Re-bootstrap ledger file after card removal.
      sdResetUsageStats();
      SD.end();
      return;
    }

    g_sdFailStreak = 0;
    if ((uint32_t)(now - g_sdLastStatsMs) >= SD_STATS_REFRESH_MS) {
      bool forceHeavy = (g_sdLastHeavyStatsMs == 0) ||
                        ((uint32_t)(now - g_sdLastHeavyStatsMs) >= SD_HEAVY_STATS_REFRESH_MS);
      sdRefreshUsageStats(false, forceHeavy);
    }
    return;
  }

  bool present = false;
  present = sdProbeAndMount(false);
  if (!present) present = sdProbeAndMount(true);
  if (present) {
    g_sdFailStreak = 0;
    g_sdInserted = true;
    g_sdNoCardProbeIntervalMs = SD_PROBE_INTERVAL_NO_CARD_MS;
    g_sdDirty = true;
    g_sdLastHeavyStatsMs = 0;
    g_sdLastLoggedPage = 0xFF;
    g_teLedgerFileReady = false; // [NEW FEATURE] Re-bootstrap ledger file after card insertion.
    Serial.println();
    Serial.println("[SD] ✅ SD카드 삽입됨!");
    sdRefreshUsageStats(true, true);
    sdAppendEventLog("EVENT: SD inserted");
  } else {
    g_sdFailStreak = 0;
    if (g_sdNoCardProbeIntervalMs < SD_PROBE_INTERVAL_NO_CARD_MAX_MS) {
      g_sdNoCardProbeIntervalMs = min(SD_PROBE_INTERVAL_NO_CARD_MAX_MS, g_sdNoCardProbeIntervalMs * 2U);
    }
    // [NEW FEATURE] Throttled probe failure log to aid field diagnosis.
    if ((uint32_t)(now - s_lastNoCardLogMs) >= 5000U) {
      s_lastNoCardLogMs = now;
      Serial.println("[SD] probe failed (no card or mount fail)");
    }
  }
}

static void tcpSendSdLogDump(WiFiClient& client, const char* path) {
  if (!client || !client.connected()) return;
  if (!path || !path[0]) path = SD_LOG_FILE_PATH;

  if (!g_sdInserted) {
    client.print("SDLOG_BEGIN|ok=0|reason=no_sd\n");
    client.print("SDLOG_END|ok=0\n");
    return;
  }

  File f = SD.open(path, FILE_READ);
  if (!f) {
    if (!sdProbeAndMount(false) && !sdProbeAndMount(true)) {
      g_sdInserted = false;
      g_sdDirty = true;
      sdResetUsageStats();
      client.print("SDLOG_BEGIN|ok=0|reason=no_sd\n");
      client.print("SDLOG_END|ok=0\n");
      return;
    }
    f = SD.open(path, FILE_READ);
  }
  if (!f) {
    client.print("SDLOG_BEGIN|ok=0|reason=file_not_found\n");
    client.print("SDLOG_END|ok=0\n");
    return;
  }

  client.printf("SDLOG_BEGIN|ok=1|path=%s|size=%lu\n", path, (unsigned long)f.size());
  static const char SD_HEX_DIGITS[] = "0123456789ABCDEF";
  uint8_t buf[64];
  char hex[(64 * 2) + 1];

  while (client.connected() && f.available()) {
    size_t n = f.read(buf, sizeof(buf));
    if (n == 0) break;
    for (size_t i = 0; i < n; i++) {
      hex[i * 2] = SD_HEX_DIGITS[(buf[i] >> 4) & 0x0F];
      hex[i * 2 + 1] = SD_HEX_DIGITS[buf[i] & 0x0F];
    }
    hex[n * 2] = 0;
    client.print("SDLOG_DATA|");
    client.print(hex);
    client.print('\n');
  }

  f.close();
  client.print("SDLOG_END|ok=1\n");
  sdRefreshUsageStats(false, false);
}

struct TeCompactDayCounter {
  char date[11];
  uint16_t totalCount;
  uint16_t seenCount;
};

static const uint16_t TE_COMPACT_DAY_MAX = 1024;
static TeCompactDayCounter g_teCompactDayCounters[TE_COMPACT_DAY_MAX];

static void teSetCompactReason(char* out, size_t outSz, const char* reason) {
  if (!out || outSz == 0) return;
  out[0] = 0;
  if (reason && reason[0]) {
    strlcpy(out, reason, outSz);
  }
}

static bool teExtractDailyDateKey(const char* line, char* dateOut, size_t dateSz) {
  if (!line || !dateOut || dateSz < 11) return false;
  dateOut[0] = 0;
  if (strncmp(line, "[DAILY_TOTAL]", 13) != 0) return false;

  const char* datePos = strstr(line, "DATE=");
  if (!datePos) return false;
  datePos += 5;

  if (!isdigit((unsigned char)datePos[0]) || !isdigit((unsigned char)datePos[1]) ||
      !isdigit((unsigned char)datePos[2]) || !isdigit((unsigned char)datePos[3]) ||
      datePos[4] != '-' ||
      !isdigit((unsigned char)datePos[5]) || !isdigit((unsigned char)datePos[6]) ||
      datePos[7] != '-' ||
      !isdigit((unsigned char)datePos[8]) || !isdigit((unsigned char)datePos[9])) {
    return false;
  }

  memcpy(dateOut, datePos, 10);
  dateOut[10] = 0;
  return true;
}

static int teFindCompactDayCounter(const char* dateKey, uint16_t used) {
  if (!dateKey || !dateKey[0]) return -1;
  for (uint16_t i = 0; i < used; i++) {
    if (strcmp(g_teCompactDayCounters[i].date, dateKey) == 0) return (int)i;
  }
  return -1;
}

static bool teCopySdFile(const char* srcPath, const char* dstPath) {
  if (!srcPath || !srcPath[0] || !dstPath || !dstPath[0]) return false;

  File src = SD.open(srcPath, FILE_READ);
  if (!src) return false;

  if (SD.exists(dstPath)) SD.remove(dstPath);
  File dst = SD.open(dstPath, FILE_WRITE);
  if (!dst) {
    src.close();
    return false;
  }

  uint8_t buf[128];
  bool ok = true;
  while (src.available()) {
    size_t n = src.read(buf, sizeof(buf));
    if (n == 0) break;
    if (dst.write(buf, n) != n) {
      ok = false;
      break;
    }
  }

  dst.close();
  src.close();
  return ok;
}

static bool teCompactTotalEnergyFile(char* reasonOut, size_t reasonSz, uint32_t& removedLinesOut, uint32_t& keptLinesOut) {
  removedLinesOut = 0;
  keptLinesOut = 0;
  teSetCompactReason(reasonOut, reasonSz, "");

  if (!g_sdInserted) {
    if (!sdProbeAndMount(false) && !sdProbeAndMount(true)) {
      teSetCompactReason(reasonOut, reasonSz, "no_sd");
      return false;
    }
    g_sdInserted = true;
  }

  if (!SD.exists(SD_TOTAL_ENERGY_FILE_PATH)) {
    teSetCompactReason(reasonOut, reasonSz, "file_not_found");
    return false;
  }

  if (SD.exists(SD_TOTAL_ENERGY_TEMP_PATH)) {
    SD.remove(SD_TOTAL_ENERGY_TEMP_PATH);
  }

  memset(g_teCompactDayCounters, 0, sizeof(g_teCompactDayCounters));
  uint16_t dayUsed = 0;
  uint32_t deviceTotalCount = 0;
  char line[192];
  char dateKey[11];

  File src = SD.open(SD_TOTAL_ENERGY_FILE_PATH, FILE_READ);
  if (!src) {
    teSetCompactReason(reasonOut, reasonSz, "open_read_failed");
    return false;
  }

  while (src.available()) {
    size_t n = src.readBytesUntil('\n', line, sizeof(line) - 1);
    line[n] = 0;
    while (n > 0 && line[n - 1] == '\r') line[--n] = 0;
    if (!line[0]) continue;

    if (teExtractDailyDateKey(line, dateKey, sizeof(dateKey))) {
      int idx = teFindCompactDayCounter(dateKey, dayUsed);
      if (idx < 0) {
        if (dayUsed >= TE_COMPACT_DAY_MAX) {
          src.close();
          teSetCompactReason(reasonOut, reasonSz, "too_many_days");
          return false;
        }
        idx = (int)dayUsed++;
        memset(&g_teCompactDayCounters[idx], 0, sizeof(g_teCompactDayCounters[idx]));
        strlcpy(g_teCompactDayCounters[idx].date, dateKey, sizeof(g_teCompactDayCounters[idx].date));
      }
      if (g_teCompactDayCounters[idx].totalCount < 0xFFFFU) {
        g_teCompactDayCounters[idx].totalCount++;
      }
      continue;
    }

    if (strncmp(line, "[DEVICE_TOTAL]", 14) == 0) {
      deviceTotalCount++;
    }
  }
  src.close();

  src = SD.open(SD_TOTAL_ENERGY_FILE_PATH, FILE_READ);
  if (!src) {
    teSetCompactReason(reasonOut, reasonSz, "reopen_read_failed");
    return false;
  }

  File dst = SD.open(SD_TOTAL_ENERGY_TEMP_PATH, FILE_WRITE);
  if (!dst) {
    src.close();
    teSetCompactReason(reasonOut, reasonSz, "open_temp_failed");
    return false;
  }

  for (uint16_t i = 0; i < dayUsed; i++) {
    g_teCompactDayCounters[i].seenCount = 0;
  }

  uint32_t deviceTotalSeen = 0;
  bool writeOk = true;

  while (src.available()) {
    size_t n = src.readBytesUntil('\n', line, sizeof(line) - 1);
    line[n] = 0;
    while (n > 0 && line[n - 1] == '\r') line[--n] = 0;
    if (!line[0]) continue;

    bool keepLine = true;

    if (strncmp(line, "[SESSION]", 9) == 0) {
      keepLine = false;
    } else if (teExtractDailyDateKey(line, dateKey, sizeof(dateKey))) {
      int idx = teFindCompactDayCounter(dateKey, dayUsed);
      if (idx >= 0) {
        if (g_teCompactDayCounters[idx].seenCount < 0xFFFFU) {
          g_teCompactDayCounters[idx].seenCount++;
        }
        keepLine = (g_teCompactDayCounters[idx].seenCount == g_teCompactDayCounters[idx].totalCount);
      }
    } else if (strncmp(line, "[DEVICE_TOTAL]", 14) == 0) {
      deviceTotalSeen++;
      keepLine = (deviceTotalSeen == deviceTotalCount);
    }

    if (keepLine) {
      if (dst.printf("%s\n", line) <= 0) {
        writeOk = false;
        teSetCompactReason(reasonOut, reasonSz, "write_temp_failed");
        break;
      }
      keptLinesOut++;
    } else {
      removedLinesOut++;
    }
  }

  src.close();
  dst.close();

  if (!writeOk) {
    SD.remove(SD_TOTAL_ENERGY_TEMP_PATH);
    return false;
  }

  if (deviceTotalCount == 0 || keptLinesOut == 0) {
    File appendFile = SD.open(SD_TOTAL_ENERGY_TEMP_PATH, FILE_APPEND);
    if (!appendFile) {
      SD.remove(SD_TOTAL_ENERGY_TEMP_PATH);
      teSetCompactReason(reasonOut, reasonSz, "append_temp_failed");
      return false;
    }
    char deviceLine[96];
    snprintf(deviceLine, sizeof(deviceLine), "[DEVICE_TOTAL] %llu J", (unsigned long long)g_teDeviceTotalJ);
    if (appendFile.printf("%s\n", deviceLine) <= 0) {
      appendFile.close();
      SD.remove(SD_TOTAL_ENERGY_TEMP_PATH);
      teSetCompactReason(reasonOut, reasonSz, "append_device_total_failed");
      return false;
    }
    appendFile.close();
    keptLinesOut++;
  }

  if (SD.exists(SD_TOTAL_ENERGY_FILE_PATH) && !SD.remove(SD_TOTAL_ENERGY_FILE_PATH)) {
    SD.remove(SD_TOTAL_ENERGY_TEMP_PATH);
    teSetCompactReason(reasonOut, reasonSz, "remove_original_failed");
    return false;
  }

  bool commitOk = SD.rename(SD_TOTAL_ENERGY_TEMP_PATH, SD_TOTAL_ENERGY_FILE_PATH);
  if (!commitOk) {
    commitOk = teCopySdFile(SD_TOTAL_ENERGY_TEMP_PATH, SD_TOTAL_ENERGY_FILE_PATH);
    if (commitOk) {
      SD.remove(SD_TOTAL_ENERGY_TEMP_PATH);
    }
  }

  if (!commitOk) {
    teSetCompactReason(reasonOut, reasonSz, "commit_failed");
    return false;
  }

  g_teLedgerFileReady = true;
  g_sdDirty = true;
  teInvalidatePublishedMetrics();
  tePublishMetricsToAtmega(true);
  webMarkLogUploadDirty(SD_TOTAL_ENERGY_FILE_PATH);
  sdRefreshUsageStats(false, true);
  Serial.printf("[TE] compact ok removed=%lu kept=%lu\n",
                (unsigned long)removedLinesOut,
                (unsigned long)keptLinesOut);
  return true;
}

static void tcpDeleteSdLogFile(WiFiClient& client, const char* path) {
  if (!client || !client.connected()) return;
  if (!path || !path[0]) path = SD_LOG_FILE_PATH;

  if (!g_sdInserted) {
    client.printf("SDDELETE|ok=0|reason=no_sd|path=%s\n", path);
    return;
  }

  if (!SD.exists(path)) {
    if (!sdProbeAndMount(false) && !sdProbeAndMount(true)) {
      g_sdInserted = false;
      g_sdDirty = true;
      sdResetUsageStats();
      client.printf("SDDELETE|ok=0|reason=no_sd|path=%s\n", path);
      return;
    }
  }

  if (!SD.exists(path)) {
    client.printf("SDDELETE|ok=0|reason=file_not_found|path=%s\n", path);
    return;
  }

  if (strcmp(path, SD_TOTAL_ENERGY_FILE_PATH) == 0) {
    char reason[48];
    uint32_t removedLines = 0;
    uint32_t keptLines = 0;
    if (!teCompactTotalEnergyFile(reason, sizeof(reason), removedLines, keptLines)) {
      client.printf("SDDELETE|ok=0|reason=%s|path=%s\n", reason[0] ? reason : "compact_failed", path);
      return;
    }
    Serial.printf("[SD] compact ok: %s removed=%lu kept=%lu\n",
                  path,
                  (unsigned long)removedLines,
                  (unsigned long)keptLines);
    client.printf("SDDELETE|ok=1|path=%s|action=compacted|removed=%lu|kept=%lu\n",
                  path,
                  (unsigned long)removedLines,
                  (unsigned long)keptLines);
    return;
  }

  if (!SD.remove(path)) {
    client.printf("SDDELETE|ok=0|reason=remove_failed|path=%s\n", path);
    return;
  }

  if (strcmp(path, SD_LOG_FILE_PATH) == 0) {
    g_sdLastLoggedLine[0] = 0;
    g_sdLastLoggedPage = 0xFF;
  }

  g_sdDirty = true;
  sdRefreshUsageStats(false, true);
  Serial.printf("[SD] delete ok: %s\n", path);
  client.printf("SDDELETE|ok=1|path=%s\n", path);
}

static void webRegisterTick(bool force) {
  if (WiFi.status() != WL_CONNECTED) return;
  if (!force && g_webDeviceRegisteredKnown && !g_webDeviceRegistered) return;
  uint32_t now = millis();
  if (!force && (uint32_t)(now - lastWebRegisterMs) < WEB_REGISTER_PERIOD_MS) return;

  char ip[16];
  ipToStr(WiFi.localIP(), ip, sizeof(ip));

  String json;
  json.reserve(512);
  json = "{";
  jsonAppendQuotedField(json, "ip", ip);
  jsonAppendQuotedField(json, "device_id", deviceIdC());
  jsonAppendQuotedField(json, "customer", DEVICE_CUSTOMER);
  jsonAppendQuotedField(json, "token", deviceTokenC());
  jsonAppendFirmwareFields(json);
  jsonAppendBoolField(json, "sd_inserted", g_sdInserted);
  jsonAppendUint64Field(json, "sd_total_mb", g_sdTotalMB);
  jsonAppendUint64Field(json, "sd_used_mb", g_sdUsedMB);
  jsonAppendUint64Field(json, "sd_free_mb", g_sdFreeMB);
  jsonAppendUint64Field(json, "used_energy_j", g_teDeviceTotalJ);
  json += "}";

  String body;
  int code = 0;
  if (!webPostJson(WEB_REGISTER_PATH, json.c_str(), json.length(), &body, &code)) {
    webHandleProvisioningReject(WEB_REGISTER_PATH, code, body);
    return;
  }

  lastWebRegisterMs = now;
  webUpdateRegisteredStateFromBody(body, true);
  webHandlePendingCommand(body);
}

static void webHeartbeatTick() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (g_webDeviceRegisteredKnown && !g_webDeviceRegistered) return;
  uint32_t now = millis();
  if ((uint32_t)(now - lastWebHeartbeatMs) < WEB_HEARTBEAT_PERIOD_MS) return;

  char ip[16];
  ipToStr(WiFi.localIP(), ip, sizeof(ip));

  String json;
  json.reserve(512);
  json = "{";
  jsonAppendQuotedField(json, "ip", ip);
  jsonAppendQuotedField(json, "device_id", deviceIdC());
  jsonAppendQuotedField(json, "customer", DEVICE_CUSTOMER);
  jsonAppendQuotedField(json, "token", deviceTokenC());
  jsonAppendFirmwareFields(json);
  jsonAppendBoolField(json, "sd_inserted", g_sdInserted);
  jsonAppendUint64Field(json, "sd_total_mb", g_sdTotalMB);
  jsonAppendUint64Field(json, "sd_used_mb", g_sdUsedMB);
  jsonAppendUint64Field(json, "sd_free_mb", g_sdFreeMB);
  jsonAppendUint64Field(json, "used_energy_j", g_teDeviceTotalJ);
  json += "}";

  String body;
  int code = 0;
  if (!webPostJson(WEB_HEARTBEAT_PATH, json.c_str(), json.length(), &body, &code)) {
    webHandleProvisioningReject(WEB_HEARTBEAT_PATH, code, body);
    return;
  }

  lastWebHeartbeatMs = now;
  webHandlePendingCommand(body);
}

static void webTelemetryTick() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (g_webDeviceRegisteredKnown && !g_webDeviceRegistered) return;
  uint32_t now = millis();
  bool forceSummary = ((uint32_t)(now - lastWebTelemetryForceMs) >= WEB_TELEMETRY_FORCE_PERIOD_MS);
  if (!g_webTelemetryDirty && !forceSummary) return;
  if (!forceSummary && (uint32_t)(now - lastWebTelemetryMs) < WEB_TELEMETRY_PERIOD_MS) return;

  char power[12];
  char timeSec[12];
  extractPowerTimeFromLineC(lastOutLine, power, sizeof(power), timeSec, sizeof(timeSec));

  char ip[16];
  ipToStr(WiFi.localIP(), ip, sizeof(ip));

  String json;
  json.reserve(768);
  json = "{";
  jsonAppendQuotedField(json, "ip", ip);
  jsonAppendQuotedField(json, "device_id", deviceIdC());
  jsonAppendQuotedField(json, "customer", DEVICE_CUSTOMER);
  jsonAppendQuotedField(json, "token", deviceTokenC());
  jsonAppendFirmwareFields(json);
  jsonAppendQuotedField(json, "line", lastOutLine);
  jsonAppendQuotedField(json, "power", power);
  jsonAppendQuotedField(json, "time_sec", timeSec);
  jsonAppendBoolField(json, "sd_inserted", g_sdInserted);
  jsonAppendUint64Field(json, "sd_total_mb", g_sdTotalMB);
  jsonAppendUint64Field(json, "sd_used_mb", g_sdUsedMB);
  jsonAppendUint64Field(json, "sd_free_mb", g_sdFreeMB);
  jsonAppendUint64Field(json, "used_energy_j", g_teDeviceTotalJ);
  json += "}";

  String body;
  int code = 0;
  if (!webPostJson(WEB_TELEMETRY_PATH, json.c_str(), json.length(), &body, &code)) {
    webHandleProvisioningReject(WEB_TELEMETRY_PATH, code, body);
    return;
  }

  lastWebTelemetryMs = now;
  if (forceSummary || lastWebTelemetryForceMs == 0) {
    lastWebTelemetryForceMs = now;
  }
  g_webTelemetryDirty = false;
  webHandlePendingCommand(body);
}

static void handleUdpDiscoveryOnce() {
  if (!netServicesStarted) return;

  int packetSize = udp.parsePacket();
  if (packetSize <= 0) return;

  char buf[128];
  int len = udp.read(buf, (int)sizeof(buf) - 1);
  if (len <= 0) return;
  buf[len] = '\0';

  int s = 0; while (buf[s] == ' ' || buf[s] == '\t' || buf[s] == '\r' || buf[s] == '\n') s++;
  int e = (int)strlen(buf); while (e > s && (buf[e-1] == ' ' || buf[e-1] == '\t' || buf[e-1] == '\r' || buf[e-1] == '\n')) e--;
  buf[e] = 0;
  if (strcmp(buf + s, DISCOVERY_MAGIC) != 0) return;

  IPAddress rip = udp.remoteIP();
  uint16_t rport = udp.remotePort();

  char ip[16];
  ipToStr(WiFi.localIP(), ip, sizeof(ip));
  char reply[220];
  int n = snprintf(reply, sizeof(reply), "%s%s|%s|%u|%s|%s",
                   DISCOVERY_REPLY_PREFIX, DEVICE_NAME, ip, (unsigned)TCP_PORT, deviceIdC(), deviceTokenC());
  if (n < 0) return;
  if ((size_t)n >= sizeof(reply)) n = (int)sizeof(reply) - 1;

  udp.beginPacket(rip, rport);
  udp.write((const uint8_t*)reply, (size_t)n);
  udp.endPacket();
}

static void tcpSendLineIfConnected(const char* line) {
  if (!tcpClient) return;
  if (!tcpClient.connected()) return;
  tcpClient.print(line ? line : "");
  tcpClient.print('\n');
}

static void handleTcpServerOnce() {
  if (!netServicesStarted) return;

  WiFiClient newClient = tcpServer.available();
  if (newClient) {
    if (tcpClient && tcpClient.connected()) {
      Serial.println("[TCP] New client -> replace old");
      tcpClient.stop();
    }
    tcpClient = newClient;
    tcpClient.setNoDelay(true);
    Serial.printf("[TCP] Client connected: %s:%u\n", tcpClient.remoteIP().toString().c_str(), (unsigned)tcpClient.remotePort());

    tcpClient.printf("HELLO %s IP=%s TCP=%u\n", DEVICE_NAME, WiFi.localIP().toString().c_str(), (unsigned)TCP_PORT);
    tcpSendLineIfConnected(lastOutLine);
  }

  static char rxBuf[128];
  static uint8_t rxLen = 0;
  if (tcpClient && tcpClient.connected()) {
    while (tcpClient.available()) {
      char c = (char)tcpClient.read();
      if (c == '\r') continue;
      if (c == '\n') {
        rxBuf[rxLen] = 0;
        char* s = rxBuf;
        while (*s == ' ' || *s == '\t') s++;
        char* end = s + strlen(s);
        while (end > s && (end[-1] == ' ' || end[-1] == '\t')) end--;
        *end = 0;
        if (*s) {
          if (strcasecmp(s, "PING") == 0) {
            tcpClient.print("PONG\n");
          } else if (strcasecmp(s, "GET") == 0) {
            tcpSendLineIfConnected(lastOutLine);
          } else if (strcasecmp(s, "INFO") == 0) {
            char ip[16];
            ipToStr(WiFi.localIP(), ip, sizeof(ip));
            tcpClient.printf("INFO %s SSID=%s IP=%s RSSI=%d\n",
                             DEVICE_NAME, WiFi.SSID().c_str(), ip, (int)WiFi.RSSI());
          } else if (strcasecmp(s, "SDLOG") == 0 ||
                     strcasecmp(s, "SDLOG GET") == 0 ||
                     strcasecmp(s, "SDLOG_DUMP") == 0) {
            tcpSendSdLogDump(tcpClient, SD_LOG_FILE_PATH);
          } else if (strcasecmp(s, "SDLOG ENERGY") == 0 ||
                     strcasecmp(s, "SDLOG TOTAL") == 0 ||
                     strcasecmp(s, "ENERGYLOG") == 0) {
            tcpSendSdLogDump(tcpClient, SD_TOTAL_ENERGY_FILE_PATH);
          } else if (strcasecmp(s, "SDDELETE") == 0 ||
                     strcasecmp(s, "SDDELETE LOG") == 0 ||
                     strcasecmp(s, "SDDELETE ACTIVITY") == 0 ||
                     strcasecmp(s, "DELETELOG") == 0) {
            tcpDeleteSdLogFile(tcpClient, SD_LOG_FILE_PATH);
          } else if (strcasecmp(s, "SDDELETE ENERGY") == 0 ||
                     strcasecmp(s, "SDDELETE TOTAL") == 0 ||
                     strcasecmp(s, "DELETEENERGYLOG") == 0) {
            tcpDeleteSdLogFile(tcpClient, SD_TOTAL_ENERGY_FILE_PATH);
          } else if (strcasecmp(s, "RESET_STATE") == 0 ||
                     strcasecmp(s, "RESETSTATE") == 0) {
            teResetLocalState();
            tcpClient.print("OK RESET_STATE\n");
          } else if (strcasecmp(s, "RESET_SUBSCRIPTION") == 0 ||
                     strcasecmp(s, "RESETSUBSCRIPTION") == 0) {
            teResetSubscriptionState();
            tcpClient.print("OK RESET_SUBSCRIPTION\n");
          } else if (strncasecmp(s, "PAGE", 4) == 0) {
            handle_command(String(s));
            tcpClient.printf("OK %s\n", s);
          }
        }
        rxLen = 0;
      } else {
        if (rxLen < (sizeof(rxBuf) - 1)) {
          rxBuf[rxLen++] = c;
        }
      }
    }
  }

  if (tcpClient && !tcpClient.connected()) {
    Serial.println("[TCP] Client disconnected");
    tcpClient.stop();
  }
}

static void updateMeasurementTick() {
  uint32_t now = millis();
  if ((uint32_t)(now - lastMeasTickMs) < MEASURE_INTERVAL_MS) return;
  lastMeasTickMs = now;

  if (!g_runActive) {
    if (strcmp(lastOutLine, "0W,0") != 0) {
      strlcpy(lastOutLine, "0W,0", sizeof(lastOutLine));
      sdAppendLogLine(lastOutLine);
      g_webTelemetryDirty = true;
      lastWebTelemetryMs = 0;
    }
    return;
  }

  uint16_t w = g_runW ? g_runW : g_lastKnownW;
  if (w == 0) {
    if (strcmp(lastOutLine, "0W,0") != 0) {
      strlcpy(lastOutLine, "0W,0", sizeof(lastOutLine));
      sdAppendLogLine(lastOutLine);
      g_webTelemetryDirty = true;
      lastWebTelemetryMs = 0;
    }
    return;
  }

  unsigned long elapsed_sec = (unsigned long)((now - g_runStartMs) / 1000UL) + 1UL;

  char buf[40];
  snprintf(buf, sizeof(buf), "%uW,%lu", (unsigned)w, elapsed_sec);
  if (strcmp(buf, lastOutLine) != 0) {
    strlcpy(lastOutLine, buf, sizeof(lastOutLine));
    sdAppendLogLine(lastOutLine);
    tcpSendLineIfConnected(lastOutLine);
    g_webTelemetryDirty = true;
    lastWebTelemetryMs = 0;
  }
}


static bool isCaptivePortalRequest() {
  String host = server.hostHeader();
  host.toLowerCase();
  if (host.length() == 0) return true;
  if (host.indexOf(PORTAL_DOMAIN) >= 0) return false;
  if (host == AP_IP.toString()) return false;
  return true;
}

static void handleRoot() {
  Serial.printf("[HTTP] GET /  Host='%s'\n", server.hostHeader().c_str());
  if (isCaptivePortalRequest()) {
    Serial.println("[HTTP] captive request -> serve portal page");
    handleConnectGet();
    return;
  }
  server.send(200, "text/html", FPSTR(HTML_PAGE));
}

static void handleConnectStatus() {
  char buf[256];
  const char* state = "idle";
  if (portalConnectInProgress) state = "connecting";
  else if (portalConnectDone && portalLastConnectOk) state = "connected";
  else if (portalConnectDone && !portalLastConnectOk) state = "failed";

  IPAddress ip = WiFi.localIP();
  char ipStr[16];
  ipToStr(ip, ipStr, sizeof(ipStr));

  snprintf(buf, sizeof(buf),
           "{\"ok\":true,\"state\":\"%s\",\"ssid\":\"%s\",\"ip\":\"%s\"}",
           state,
           (WiFi.status() == WL_CONNECTED ? WiFi.SSID().c_str() : ""),
           ipStr);
  server.send(200, "application/json", buf);
}

static const char* htmlConnectWorkingPage() {
  return "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
         "<title>CONNECTING</title>"
         "<meta http-equiv='refresh' content='1;url=http://192.168.4.1/connect'>"
         "<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#fff;color:#111827}"
         ".box{width:min(560px,92vw);text-align:center;padding:26px}"
         "h2{margin:0 0 10px 0;color:#3b4bff;font-size:28px}"
         "p{margin:0;color:#6b7280;line-height:1.5}"
         ".tag{margin-top:14px;display:inline-block;padding:10px 14px;border-radius:10px;background:#f3f4f6;color:#0f766e;font-weight:700}</style>"
         "</head><body><div class='box'><h2>CONNECTING</h2>"
         "<p>Wi-Fi 연결을 시도 중입니다. 잠시만 기다려 주세요...</p>"
         "<div class='tag'>PLEASE WAIT</div></div></body></html>";
}

static void handleConnectGet() {
  if (portalConnectInProgress) {
    server.send(200, "text/html", htmlConnectWorkingPage());
    return;
  }

  if (portalConnectDone && portalLastConnectOk && WiFi.status() == WL_CONNECTED && WiFi.localIP() != IPAddress(0,0,0,0)) {
    portalSuccessPageServed = true;

    char ipStr[16];
    ipToStr(WiFi.localIP(), ipStr, sizeof(ipStr));

    String s;
    s.reserve(1200);
    s += "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>";
    s += "<title>CONNECTED</title>";
    s += "<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#fff;color:#111827}"
         ".box{width:min(560px,92vw);text-align:center;padding:26px}"
         "h2{margin:0 0 10px 0;color:#3b4bff;font-size:28px}"
         "p{margin:0;color:#6b7280;line-height:1.55}"
         ".tag{margin-top:14px;display:inline-block;padding:10px 14px;border-radius:10px;background:#f3f4f6;color:#0f766e;font-weight:700}"
         "a{color:#3b4bff;text-decoration:none;font-weight:600}</style></head><body>";
    s += "<div class='box'><h2>SUCCESS</h2><p>";
    s += "Wi-Fi 연결 완료!<br/>SSID: ";
    s += WiFi.SSID();
    s += "<br/>IP: ";
    s += ipStr;
    s += "<br/><br/>잠시 후 ABBA-S(AP) 가 자동으로 종료됩니다.<br/>"
         "폰/PC의 Wi-Fi를 <b>";
    s += WiFi.SSID();
    s += "</b> 로 전환한 뒤 아래 주소로 접속하세요.<br/><br/>";
    s += "<a href='";
    s += WEB_SERVER_BASE_URL;
    s += "'>";
    s += WEB_SERVER_BASE_URL;
    s += "</a>";
    s += "</p><div class='tag'>CONNECTED</div></div></body></html>";
    server.send(200, "text/html", s);

    portalShutdownAtMs = millis() + 5000;
    portalShutdownForceAtMs = millis() + 15000;
    return;
  }

  if (portalConnectDone && !portalLastConnectOk) {
    server.send(200, "text/html",
                htmlMessagePage("FAILED",
                                String("연결 실패.<br/>status=") + wlStatusStr(WiFi.status()) +
                                "<br/>다시 SSID/PW를 확인 후 재시도 해주세요.",
                                false));
    return;
  }

  server.send(200, "text/html", FPSTR(HTML_PAGE));
}

static void handleConnectPost() {
  if (portalConnectInProgress) {
    server.send(200, "text/html", htmlConnectWorkingPage());
    return;
  }

  String ssid = server.arg("ssid");
  String pass = server.arg("pass");
  ssid.trim();

  Serial.printf("[HTTP] POST /connect  ssid='%s' pass='%s' (len=%d)\n", ssid.c_str(), pass.c_str(), (int)pass.length());
  if (ssid.length() == 0) {
    Serial.println("[HTTP] /connect invalid: empty SSID");
    server.send(400, "text/html", htmlMessagePage("입력 오류", "SSID를 입력해 주세요.", false));
    return;
  }

  memset(portalPendingSsid, 0, sizeof(portalPendingSsid));
  memset(portalPendingPass, 0, sizeof(portalPendingPass));
  ssid.toCharArray(portalPendingSsid, sizeof(portalPendingSsid));
  pass.toCharArray(portalPendingPass, sizeof(portalPendingPass));

  portalConnectInProgress = true;
  portalConnectDone = false;
  portalLastConnectOk = false;
  portalSuccessPageServed = false;
  portalShutdownAtMs = 0;
  portalShutdownForceAtMs = 0;

  WiFi.mode(WIFI_AP_STA);
  setBandModeSTA();
  WiFi.disconnect(false, true);
  delay(80);

  Serial.printf("[STA] (portal) connect begin -> SSID='%s'\n", portalPendingSsid);
  if (strlen(portalPendingPass) == 0) WiFi.begin(portalPendingSsid);
  else WiFi.begin(portalPendingSsid, portalPendingPass);

  portalConnectStartMs = millis();
  g_atmegaConnectFlowActive = false;

  server.sendHeader("Location", "http://192.168.4.1/connect", true);
  server.send(303, "text/plain", "Connecting...");
}

static void notifyAtmegaWifiConnectResult(bool ok) {
  char line[24];
  snprintf(line, sizeof(line), "@WIFI|R|%u\n", ok ? 1U : 0U);
  ATMEGA.print(line);
  Serial.printf("[ESP->AT] WIFI result=%u\n", ok ? 1U : 0U);
}

static void atmegaCredentialConnectTick() {
  if (!g_atmegaPendingConnectReq) return;
  g_atmegaPendingConnectReq = false;

  if (g_atmegaPendingSsid[0] == 0) {
    Serial.println("[AT->ESP] connect request ignored: empty SSID");
    notifyAtmegaWifiConnectResult(false);
    g_atmegaConnectFlowActive = false;
    return;
  }

  memset(portalPendingSsid, 0, sizeof(portalPendingSsid));
  memset(portalPendingPass, 0, sizeof(portalPendingPass));
  strncpy(portalPendingSsid, g_atmegaPendingSsid, sizeof(portalPendingSsid) - 1);
  strncpy(portalPendingPass, g_atmegaPendingPass, sizeof(portalPendingPass) - 1);

  portalConnectInProgress = true;
  portalConnectDone = false;
  portalLastConnectOk = false;
  portalSuccessPageServed = false;
  portalShutdownAtMs = 0;
  portalShutdownForceAtMs = 0;

  WiFi.mode(WIFI_AP_STA);
  setBandModeSTA();
  WiFi.disconnect(false, true);
  delay(80);

  Serial.printf("[STA] (atmega) connect begin -> SSID='%s'\n", portalPendingSsid);
  if (strlen(portalPendingPass) == 0) WiFi.begin(portalPendingSsid);
  else WiFi.begin(portalPendingSsid, portalPendingPass);

  portalConnectStartMs = millis();
  g_atmegaConnectFlowActive = true;
}

static void portalConnectTick() {
  if (!portalConnectInProgress) return;

  const uint32_t nowMs = millis();
  if (WiFi.status() == WL_CONNECTED && WiFi.localIP() != IPAddress(0,0,0,0)) {
    Serial.printf("[STA] ✅ (portal) connected. SSID='%s' IP=%s\n",
                  WiFi.SSID().c_str(),
                  WiFi.localIP().toString().c_str());

    saveCreds(String(portalPendingSsid), String(portalPendingPass));

    portalConnectInProgress = false;
    portalConnectDone = true;
    portalConnectDoneMs = nowMs;
    portalLastConnectOk = true;

    bool fromAtmega = g_atmegaConnectFlowActive;
    if (fromAtmega) {
      notifyAtmegaWifiConnectResult(true);
      g_atmegaConnectFlowActive = false;
    }

    if (fromAtmega && portalMode) {
      // DWIN-triggered success should mirror web success end-state:
      // stop the provisioning AP immediately.
      stopPortal();
      startNetServicesIfNeeded();
      portalShutdownAtMs = 0;
      portalShutdownForceAtMs = 0;
      Serial.println("[AP] portal stopped after ATmega Wi-Fi success");
    } else {
      if (portalShutdownAtMs == 0) portalShutdownAtMs = millis() + 15000;
      if (portalShutdownForceAtMs == 0) portalShutdownForceAtMs = millis() + 120000;
    }
    return;
  }

  if ((int32_t)(nowMs - portalConnectStartMs) >= (int32_t)CONNECT_TIMEOUT_MS) {
    Serial.printf("[STA] ❌ (portal) connect timeout. status=%s ip=%s\n",
                  wlStatusStr(WiFi.status()), WiFi.localIP().toString().c_str());
    portalConnectInProgress = false;
    portalConnectDone = true;
    portalConnectDoneMs = nowMs;
    portalLastConnectOk = false;

    WiFi.disconnect(false, true);
    delay(60);
    if (portalMode) {
      dnsServer.start(DNS_PORT, "*", AP_IP);
      Serial.println("[DNS] restarted after connect timeout (portal)");
    }
    if (g_atmegaConnectFlowActive) {
      notifyAtmegaWifiConnectResult(false);
      g_atmegaConnectFlowActive = false;
    }
  }
}

static void handleForget() {
  Serial.println("[HTTP] GET /forget");
  clearCreds();
  server.send(200, "text/html", htmlMessagePage("삭제 완료", "저장된 Wi-Fi 정보를 삭제했습니다. 재부팅합니다.", true));
  delay(800);
  ESP.restart();
}

static void handleGenerate204() {
  Serial.printf("[HTTP] GET /generate_204 Host='%s'\n", server.hostHeader().c_str());
  String url = String("http://192.168.4.1/connect");

  server.sendHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  server.sendHeader("Pragma", "no-cache");
  server.sendHeader("Expires", "0");
  server.sendHeader("Location", url, true);
  server.send(302, "text/plain", "Captive portal");
}

static void handleNotFound() {
  const String uri = server.uri();
  if (uri == "/" || uri.startsWith("/connect")) {
    handleConnectGet();
    return;
  }

  if (server.method() == HTTP_GET || server.method() == HTTP_HEAD) {
    Serial.printf("[HTTP] 404 %s Host='%s' -> serve portal page\n",
                  server.uri().c_str(), server.hostHeader().c_str());
    handleConnectGet();
    return;
  }

  String url = String("http://192.168.4.1/connect");
  int code = 307;
  Serial.printf("[HTTP] 404 %s Host='%s' -> redirect %s (%d)\n",
                server.uri().c_str(), server.hostHeader().c_str(), url.c_str(), code);

  server.sendHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  server.sendHeader("Pragma", "no-cache");
  server.sendHeader("Expires", "0");
  server.sendHeader("Location", url, true);
  server.send(code, "text/plain", "Captive portal");
}

static void page63SetScanBusyViaAtmega(bool on) {
  char line[16];
  int n = snprintf(line, sizeof(line), "@P63|B|%u\n", on ? 1U : 0U);
  if (n <= 0) return;
  if ((size_t)n >= sizeof(line)) n = (int)sizeof(line) - 1;
  Serial.printf("[P63->AT] scan_busy=%u raw=\"%s\"\n", on ? 1U : 0U, line);
  ATMEGA.write((const uint8_t*)line, (size_t)n);
  ATMEGA.flush();
}

static int runBlockingScanLikeWeb(bool* cooldown) {
  if (cooldown) *cooldown = false;

  uint32_t now = millis();
  if (now - lastScanMs < SCAN_COOLDOWN_MS) {
    if (cooldown) *cooldown = true;
    Serial.println("[SCAN] cooldown active -> return empty list");
    return 0;
  }
  lastScanMs = now;

  int n = 0;
  page63SetScanBusyViaAtmega(true);

  WiFi.mode(WIFI_AP_STA);
  esp_wifi_set_ps(WIFI_PS_NONE);
  WiFi.scanDelete();
  Serial.println("[SCAN] start... (AP+STA, blocking)");
  n = WiFi.scanNetworks(false, false);
  if (n < 0) n = 0;

  if (n == 0) {
    Serial.println("[SCAN] fallback: stop AP -> STA scan -> restore AP");

    bool apWasOn = portalMode;
    dnsServer.stop();
    WiFi.softAPdisconnect(true);
    delay(30);

    WiFi.mode(WIFI_STA);
    esp_wifi_set_ps(WIFI_PS_NONE);
    WiFi.disconnect(false, true);
    delay(30);
    WiFi.scanDelete();
    n = WiFi.scanNetworks(false, false);
    if (n < 0) n = 0;

    if (apWasOn) {
      WiFi.mode(WIFI_AP_STA);
      startPortal();
    }
  }

  Serial.printf("[SCAN] found %d networks\n", n);
  page63SetScanBusyViaAtmega(false);
  return n;
}

static void handleScan() {
  Serial.println("[HTTP] GET /scan");

  bool cooldown = false;
  int n = runBlockingScanLikeWeb(&cooldown);
  if (cooldown) {
    server.send(200, "application/json", "{\"ok\":true,\"cooldown\":true,\"networks\":[]}");
    return;
  }

  String json = "{\"ok\":true,\"networks\":[";
  int added = 0;

  for (int i = 0; i < n && added < MAX_SCAN_RESULTS; i++) {
    String ssid = WiFi.SSID(i);
    int32_t rssi = WiFi.RSSI(i);
    wifi_auth_mode_t auth = WiFi.encryptionType(i);
    if (ssid.length() == 0) continue;

    Serial.printf("[SCAN] %02d: ssid='%s' rssi=%d sec=%s\n", i, ssid.c_str(), (int)rssi, secLabel(auth));

    ssid.replace("\\", "\\\\");
    ssid.replace("\"", "\\\"");

    if (added > 0) json += ",";
    json += "{\"ssid\":\"" + ssid + "\",\"rssi\":" + String(rssi) + ",\"sec\":\"" + String(secLabel(auth)) + "\"}";
    added++;
  }
  json += "]}";

  WiFi.scanDelete();
  server.send(200, "application/json", json);
}

static void page63NormalizeSsid(const String& src, char* out, size_t outSz) {
  if (!out || outSz == 0) return;
  out[0] = 0;

  size_t oi = 0;
  for (size_t i = 0; i < src.length() && oi + 1 < outSz; i++) {
    uint8_t c = (uint8_t)src[i];
    if (c < 0x20 || c > 0x7E) c = '?';
    out[oi++] = (char)c;
  }
  out[oi] = 0;
}

static void page63SendSlotToAtmega(uint8_t slot, const char* text, const char* sec) {
  if (slot >= DWIN_PAGE63_SLOTS) return;

  char safe[DWIN_PAGE63_SSID_TEXT_LEN + 1];
  char safeSec[DWIN_PAGE63_SEC_TEXT_LEN + 1];
  size_t oi = 0;
  if (text) {
    for (size_t i = 0; text[i] != 0 && oi < DWIN_PAGE63_SSID_TEXT_LEN; i++) {
      uint8_t c = (uint8_t)text[i];
      if (c < 0x20 || c > 0x7E || c == '|' || c == '\r' || c == '\n') c = '?';
      safe[oi++] = (char)c;
    }
  }
  safe[oi] = 0;

  oi = 0;
  if (sec) {
    for (size_t i = 0; sec[i] != 0 && oi < DWIN_PAGE63_SEC_TEXT_LEN; i++) {
      uint8_t c = (uint8_t)sec[i];
      if (c < 0x20 || c > 0x7E || c == '|' || c == '\r' || c == '\n') c = '?';
      safeSec[oi++] = (char)c;
    }
  }
  safeSec[oi] = 0;
  if (safeSec[0] == 0) {
    strncpy(safeSec, "OPEN", sizeof(safeSec) - 1);
    safeSec[sizeof(safeSec) - 1] = 0;
  }

  bool locked = (strcmp(safeSec, "OPEN") != 0);

  char line[96];
  int n = snprintf(line, sizeof(line), "@P63|S|%u|%s|%s\n",
                   (unsigned)(slot + 1), safeSec, safe);
  if (n <= 0) return;
  if ((size_t)n >= sizeof(line)) n = (int)sizeof(line) - 1;
  Serial.printf("[P63->AT] slot=%u sec=%s lock=%u ssid='%s' raw=\"%s\"\n",
                (unsigned)(slot + 1), safeSec, locked ? 1U : 0U, safe, line);
  ATMEGA.write((const uint8_t*)line, (size_t)n);
  ATMEGA.flush();
  // ATmega side currently buffers one completed line at a time.
  // Small inter-line gap prevents slot bursts from collapsing to the last line.
  delay(4);
}

static void page63ClearSlotsViaAtmega() {
  for (uint8_t slot = 0; slot < DWIN_PAGE63_SLOTS; slot++) {
    page63SendSlotToAtmega(slot, "", "OPEN");
  }
}

static void page63ClearViaAtmega() {
  static const char kCmd[] = "@P63|C\n";
  ATMEGA.write((const uint8_t*)kCmd, sizeof(kCmd) - 1);
  ATMEGA.flush();
}

static void page63SetScanAnimViaAtmega(bool on) {
  char line[16];
  int n = snprintf(line, sizeof(line), "@P63|A|%u\n", on ? 1U : 0U);
  if (n <= 0) return;
  if ((size_t)n >= sizeof(line)) n = (int)sizeof(line) - 1;
  Serial.printf("[P63->AT] scan_anim=%u raw=\"%s\"\n", on ? 1U : 0U, line);
  ATMEGA.write((const uint8_t*)line, (size_t)n);
  ATMEGA.flush();
}

static void page63SendWiFiStatusToAtmega() {
  uint8_t connected = (WiFi.status() == WL_CONNECTED) ? 1U : 0U;
  uint8_t prevConnected = g_page63LastStatusConnected;
  if ((connected == g_page63LastStatusConnected) &&
      (g_page63LastStatusMs != 0) &&
      (millis() - g_page63LastStatusMs < DWIN_PAGE63_STATUS_HB_MS)) {
    return;
  }

  g_page63LastStatusMs = millis();
  g_page63LastStatusConnected = connected;

  char line[24];
  int n = snprintf(line, sizeof(line), "@P63|W|%u\n", connected);
  if (n <= 0) return;
  if ((size_t)n >= sizeof(line)) n = (int)sizeof(line) - 1;
  ATMEGA.write((const uint8_t*)line, (size_t)n);
  ATMEGA.flush();
  if (connected != prevConnected) {
    Serial.printf("[P63] status=%u to ATmega\n", (unsigned)connected);
  }
}

static void page63ResetResults() {
  g_page63WifiCount = 0;
  g_page63WifiPage = 0;
  for (uint8_t i = 0; i < DWIN_PAGE63_MAX_RESULTS; i++) {
    g_page63WifiResults[i].ssid[0] = '\0';
    g_page63WifiResults[i].sec[0] = '\0';
    g_page63WifiResults[i].locked = false;
  }
}

static void page63RenderList() {
  uint16_t base = (uint16_t)g_page63WifiPage * DWIN_PAGE63_SLOTS;
  Serial.printf("[P63] render page=%u base=%u total=%u\n",
                (unsigned)g_page63WifiPage, (unsigned)base, (unsigned)g_page63WifiCount);
  for (uint8_t slot = 0; slot < DWIN_PAGE63_SLOTS; slot++) {
    uint16_t idx = (uint16_t)(base + slot);
    if (idx < g_page63WifiCount) {
      page63SendSlotToAtmega(slot, g_page63WifiResults[idx].ssid, g_page63WifiResults[idx].sec);
    } else {
      page63SendSlotToAtmega(slot, "", "OPEN");
    }
  }
  g_page63ListDirty = false;
}

static void page63PreparePage63Enter() {
  page63ResetResults();
  page63ClearSlotsViaAtmega();
  page63ClearViaAtmega();
  page63SetScanAnimViaAtmega(g_page63ScanRunning);
  g_page63ListDirty = true;
}

static void page63StoreScanResults(int n) {
  page63ResetResults();
  for (int i = 0; i < n && g_page63WifiCount < DWIN_PAGE63_MAX_RESULTS; i++) {
    String ssid = WiFi.SSID(i);
    int32_t rssi = WiFi.RSSI(i);
    wifi_auth_mode_t auth = WiFi.encryptionType(i);
    const char* sec = secLabel(auth);
    if (ssid.length() == 0) continue;

    Page63WifiResult& dst = g_page63WifiResults[g_page63WifiCount];
    memset(dst.ssid, 0, sizeof(dst.ssid));
    memset(dst.sec, 0, sizeof(dst.sec));
    page63NormalizeSsid(ssid, dst.ssid, sizeof(dst.ssid));
    if (dst.ssid[0] == 0) continue;
    strncpy(dst.sec, sec, sizeof(dst.sec) - 1);
    dst.sec[sizeof(dst.sec) - 1] = '\0';
    dst.locked = authNeedsLockIcon(auth);
    Serial.printf("[SCAN] %02d: ssid='%s' rssi=%d sec=%s\n",
                  i, dst.ssid, (int)rssi, dst.sec);
    g_page63WifiCount++;
  }
  Serial.printf("[P63] stored=%u network(s)\n", (unsigned)g_page63WifiCount);
}

static void page63StartScan() {
  if (g_page63ScanRunning) return;

  page63ResetResults();
  page63ClearSlotsViaAtmega();
  g_page63ScanRunning = true;
  page63SetScanAnimViaAtmega(true);
  g_page63ListDirty = false;

  bool cooldown = false;
  int n = runBlockingScanLikeWeb(&cooldown);
  page63StoreScanResults(n);
  WiFi.scanDelete();

  g_page63ScanRunning = false;
  page63SetScanAnimViaAtmega(false);
  g_page63ListDirty = true;
  if (g_dwinCurrentPage == DWIN_PAGE_WIFI_SCAN) {
    page63RenderList();
  }
  Serial.printf("[P63] scan complete: %u ssid(s)\n", (unsigned)g_page63WifiCount);
}

static void page63WifiTick() {
  uint8_t pageNow = g_dwinCurrentPage;
  bool onPage63 = (pageNow == DWIN_PAGE_WIFI_SCAN);

  if (pageNow != g_page63LastSeenPage) {
    g_page63LastSeenPage = pageNow;
    if (onPage63) {
      page63PreparePage63Enter();
      g_page63LastKeyCode = 0x0000;
      g_page63AnyKeyReq = false;
      if (!g_page63EntryLogged) {
        Serial.println("[P63] enter page 63");
        g_page63EntryLogged = true;
      }
    } else {
      page63SetScanAnimViaAtmega(false);
      g_page63LastKeyCode = 0x0000;
      g_page63AnyKeyReq = false;
      g_page63EntryLogged = false;
    }
  }

  bool reqScan = g_page63ScanReq;
  bool reqPrev = g_page63PrevReq;
  bool reqNext = g_page63NextReq;
  bool reqAny = g_page63AnyKeyReq;
  g_page63ScanReq = false;
  g_page63PrevReq = false;
  g_page63NextReq = false;
  g_page63AnyKeyReq = false;

  if (!onPage63) {
    reqScan = false;
    reqPrev = false;
    reqNext = false;
    reqAny = false;
  }

  if (onPage63 && reqAny) {
    if (reqScan) Serial.println("[P63] scan key request");
    if (reqPrev) Serial.println("[P63] prev key request");
    if (reqNext) Serial.println("[P63] next key request");
  }

  if (reqScan) {
    page63StartScan();
  }

  if (!g_page63ScanRunning && (reqNext || reqPrev)) {
    uint8_t maxPage = 0;
    if (g_page63WifiCount > 0) {
      maxPage = (uint8_t)((g_page63WifiCount - 1) / DWIN_PAGE63_SLOTS);
    }

    uint8_t oldPage = g_page63WifiPage;
    if (reqNext && g_page63WifiPage < maxPage) g_page63WifiPage++;
    if (reqPrev && g_page63WifiPage > 0) g_page63WifiPage--;
    if (g_page63WifiPage != oldPage) g_page63ListDirty = true;
  }

  if (!onPage63) return;

  if (g_page63ListDirty) {
    page63ClearViaAtmega();
    page63RenderList();
  }
}

static void startPortal() {
  portalMode = true;
  portalShutdownAtMs = 0;
  portalShutdownForceAtMs = 0;
  portalConnectInProgress = false;
  portalConnectDone = false;
  portalLastConnectOk = false;
  portalSuccessPageServed = false;

  // Provisioning mode must keep MEL bridge alive so ATmega can continue to drive DWIN.
  setBridgeEnabledForSubscription(true, "portal_start");
  page63ResetResults();
  g_page63ListDirty = true;
  page63ClearSlotsViaAtmega();
  page63ClearViaAtmega();
  page63SetScanAnimViaAtmega(false);

  Serial.println("[AP] Starting provisioning AP + Captive Portal...");
  Serial.printf("[AP] SSID='%s' PASS='%s'\n", AP_SSID, AP_PASS);

  WiFi.mode(WIFI_AP_STA);

  if (WIFI_LOG_SILENCE) {
    esp_log_level_set("wifi", ESP_LOG_NONE);
  }

  if (FORCE_AP_2G_BANDMODE) {
    setBandMode2G();
  }

  bool cfgOk = WiFi.softAPConfig(AP_IP, AP_GW, AP_SN);
  Serial.printf("[AP] softAPConfig -> %s (IP=%s)\n", cfgOk ? "OK" : "FAIL", AP_IP.toString().c_str());

  int channel = USE_5G_AP ? AP_CH_5G : AP_CH_24G;
  Serial.printf("[AP] softAP start (USE_5G_AP=%s, channel=%d)\n", USE_5G_AP ? "true" : "false", channel);

  bool apOk = WiFi.softAP(AP_SSID, AP_PASS, channel, false, AP_MAX_CONN);
  Serial.printf("[AP] softAP(...) -> %s\n", apOk ? "OK" : "FAIL");

  if (!apOk && USE_5G_AP) {
    Serial.println("[AP] 5GHz softAP failed. Retrying 2.4GHz channel 1...");
    apOk = WiFi.softAP(AP_SSID, AP_PASS, AP_CH_24G, false, AP_MAX_CONN);
    Serial.printf("[AP] softAP retry (2.4GHz ch1) -> %s\n", apOk ? "OK" : "FAIL");
  }

  IPAddress sip = WiFi.softAPIP();
  Serial.printf("[AP] softAPIP=%s\n", sip.toString().c_str());
  Serial.printf("[AP] mac=%s\n", WiFi.softAPmacAddress().c_str());

  if (!apOk) {
    Serial.println("[AP] ❌ AP start failed. (Check board/core, power, antenna, region/channel)");
  } else {
    Serial.println("[AP] ✅ AP should be visible now. (If not, try 2.4GHz Wi-Fi list on phone)");
  }

  dnsServer.start(DNS_PORT, "*", AP_IP);
  Serial.println("[DNS] Captive DNS started (* -> 192.168.4.1)");

  server.on("/", HTTP_GET, handleRoot);
  server.on("/", HTTP_HEAD, handleRoot);
  server.on("/connect", HTTP_GET, handleConnectGet);
  server.on("/connect", HTTP_HEAD, handleConnectGet);
  server.on("/connect", HTTP_POST, handleConnectPost);
  server.on("/connect_status", HTTP_GET, handleConnectStatus);
  server.on("/forget", HTTP_GET, handleForget);
  server.on("/scan", HTTP_GET, handleScan);

  server.on("/generate_204", HTTP_GET, handleGenerate204);
  server.on("/gen_204", HTTP_GET, handleGenerate204);
  server.on("/hotspot-detect.html", HTTP_GET, handleRoot);
  server.on("/library/test/success.html", HTTP_GET, handleRoot);
  server.on("/ncsi.txt", HTTP_GET, handleRoot);
  server.onNotFound(handleNotFound);

  server.begin();
  Serial.println("[HTTP] Web server started on port 80");
}

static void stopPortal() {
  Serial.println("[AP] Stopping provisioning AP + Captive Portal...");
  dnsServer.stop();
  server.stop();
  Serial.println("[HTTP] Web server stopped.");
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  portalMode = false;
  portalShutdownAtMs = 0;
  portalShutdownForceAtMs = 0;
  portalConnectInProgress = false;
  portalConnectDone = false;
  portalLastConnectOk = false;
  portalSuccessPageServed = false;
  Serial.println("[AP] ✅ Portal stopped. (softAPdisconnect=true)");
}


void setup() {
  Serial.begin(115200);
  delay(150);
  melauhfPowerInit();
  mel_bridgeSetup();
  mel_bridgeStartTask();
  delay(1050);
  Serial.println();
  Serial.println("[APP] setup() entered");
  Serial.flush();

  if (WIFI_LOG_SILENCE) {
    esp_log_level_set("wifi", ESP_LOG_NONE);
  }

  pinMode(PIN_BTN, INPUT_PULLDOWN);
  pinMode(BOOT_PIN, INPUT_PULLUP);
  pinMode(PIN_R, OUTPUT);
  pinMode(PIN_G, OUTPUT);
  pinMode(PIN_B, OUTPUT);
  rgbWrite(false, false, true);
  sdSetup();
  // [NEW FEATURE] Restore persisted subscription energy + ledger totals.
  tePrefsLoad();
  otaLoadPendingBootReport();
  // [NEW FEATURE] Force ledger bootstrap at boot when SD is present.
  teEnsureLedgerFileReady();
  // [NEW FEATURE] Runtime marker to verify this energy-enabled build is flashed.
  Serial.printf("[TE] build marker: energy-sync+ledger v2 | fw=%s %s (%s)\n",
                firmwareFamilyC(), firmwareVersionC(), firmwareBuildIdC());

  Serial.println();
  Serial.println("=== ESP32-C5 ABBA-S WiFi Provisioning (Scan Dropdown) v2 + BOOT RESET ===");

  Serial.printf("[SYS] ChipModel=%s\n", ESP.getChipModel());
  Serial.printf("[SYS] SDK=%s\n", ESP.getSdkVersion());

  WiFi.onEvent(onWiFiEvent);
  Serial.println("[SYS] WiFi event logger attached");

  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);
  Serial.println("[SYS] WiFi.persistent(false), AutoReconnect(true), Sleep(false)");


  updateRgbTick();

  loadCreds();
  bool hasCreds = (savedSsid.length() > 0);

  if (hasCreds) {
    Serial.printf("[BOOT] Saved creds found -> STA connect first (no AP). SSID='%s'\n", savedSsid.c_str());

    bool ok = tryConnectSTA(savedSsid, savedPass, MAX_CONNECT_TRIES);
    if (ok) {
      Serial.println("[BOOT] ✅ STA connected. Portal NOT started.");
      portalMode = false;

      booting = false;
      bootDoneMs = millis();
      g_lastStaConnectedMs = millis();
      startNetServicesIfNeeded();
      lastWebHeartbeatMs = 0;
      lastWebTelemetryMs = 0;
      g_webTelemetryDirty = true;
      lastWebFirmwareCheckMs = 0;
      lastWebOtaBootReportMs = 0;
      webScheduleImmediateFirmwareCheck("boot_sta_connected");
      webRegisterTick(true);
      webDeviceRegisteredSyncTick(true);
      webSubscriptionSyncTick(true);
      g_page63LastStatusMs = 0;
      g_page63LastStatusConnected = 0xFF;
      return;
    }

    Serial.println("[BOOT] ❌ STA failed 3 times. Starting portal AP for reconfiguration.");
    resetStaBackoff(millis());
    startPortal();
  } else {
    Serial.println("[BOOT] No saved creds. Starting portal AP for configuration.");
    startPortal();
  }
  booting = false;
  bootDoneMs = millis();
  g_page63LastStatusMs = 0;
  g_page63LastStatusConnected = 0xFF;

}

void loop() {
  static uint32_t lastBootCheck = 0;
  if (millis() - lastBootCheck >= 60) {
    lastBootCheck = millis();
    doBootResetIfHeld();
    doBootResetIfHeldOnboard();
    updateRgbTick();
  }

  if (CONTINUOUS_RETRY_WITH_SAVED_CREDS && savedSsid.length() > 0) {
    if (WiFi.status() != WL_CONNECTED) {
      uint32_t now = millis();
      if (nextStaAttemptMs == 0) resetStaBackoff(now);
      if ((int32_t)(now - nextStaAttemptMs) >= 0) {
        attemptStaConnectOnce(savedSsid, savedPass, portalMode);
        scheduleNextStaAttempt(now);
      }
    } else {
      resetStaBackoff(millis());
    }
  }

  atmegaCredentialConnectTick();
  portalConnectTick();

  wl_status_t st = WiFi.status();
  page63SendWiFiStatusToAtmega();
  if (portalMode) {
    dnsServer.processNextRequest();
    server.handleClient();
  }
  if (st != lastStaStatus) {
    lastStaStatus = st;
    Serial.printf("[STA] status changed -> %s (%d)\n", wlStatusStr(st), (int)st);
    if (st == WL_CONNECTED) {
      g_lastStaConnectedMs = millis();
      printStaInfoOnce();

      lastWebHeartbeatMs = 0;
      lastWebTelemetryMs = 0;
      g_webTelemetryDirty = true;
      lastWebFirmwareCheckMs = 0;
      lastWebOtaBootReportMs = 0;
      webScheduleImmediateFirmwareCheck("sta_status_connected");
      webRegisterTick(true);
      webDeviceRegisteredSyncTick(true);
      webSubscriptionSyncTick(true);
    } else {
      g_lastStaConnectedMs = 0;
      g_webFirmwareImmediateCheckPending = false;
    }
  }

  if (st == WL_CONNECTED) {
    timeSyncTick();
    startNetServicesIfNeeded();
    handleUdpDiscoveryOnce();
    handleTcpServerOnce();

    webRegisterTick(false);
    webHeartbeatTick();
    webPingTick();
    webDeviceRegisteredSyncTick(false);
    webSubscriptionSyncTick(false);
    webOtaBootReportTick();
    webFirmwareDecisionTick();
    webFirmwareImmediateCheckTick();
    webFirmwareCheckTick(false);
    webLogUploadTick();
  } else {
    stopNetServicesIfNeeded();
    if (portalMode) {
      setBridgeEnabledForSubscription(true, "portal_loop_wifi_disconnected");
    } else {
      subscriptionEnterOfflineLock("wifi_not_connected");
    }
  }

  updateMeasurementTick();
  sdTick();
  // [NEW FEATURE] Process run-session ledger and keep page57/page71 metrics synced to firmware.
  teTick();

  if (g_sdDirty && WiFi.status() == WL_CONNECTED) {
    g_sdDirty = false;
    webRegisterTick(true);
    lastWebHeartbeatMs = 0;
    lastWebTelemetryMs = 0;
    g_webTelemetryDirty = true;
  }

  webTelemetryTick();

  page63WifiTick();
  atmegaRepublishStateTick();

  if (portalShutdownAtMs > 0 && (int32_t)(millis() - portalShutdownAtMs) >= 0) {
    const uint32_t nowMs = millis();
    const bool forceStop = (portalShutdownForceAtMs > 0) && ((int32_t)(nowMs - portalShutdownForceAtMs) >= 0);
    if (WiFi.status() == WL_CONNECTED && (portalSuccessPageServed || forceStop)) {
      stopPortal();
      startNetServicesIfNeeded();
      portalShutdownAtMs = 0;
      portalShutdownForceAtMs = 0;
    } else if (WiFi.status() != WL_CONNECTED) {
      portalShutdownAtMs = 0;
      portalShutdownForceAtMs = 0;
      if (portalMode) {
        dnsServer.start(DNS_PORT, "*", AP_IP);
      }
    }
  }

  delay(2);
}
