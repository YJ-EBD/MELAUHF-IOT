#include <Arduino.h>

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

#ifndef ATMEGA_RESET_PIN
#define ATMEGA_RESET_PIN 24
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

#ifndef MELAUHF_POWER_EN_PIN
#define MELAUHF_POWER_EN_PIN -1
#endif

#ifndef MELAUHF_POWER_ON_LEVEL
#define MELAUHF_POWER_ON_LEVEL HIGH
#endif

static const uint32_t USB_BAUD = 115200;
static const uint32_t ATMEGA_BAUD = 115200;
static const uint32_t DWIN_BAUD = 115200;
static const uint32_t RESET_PULSE_MS = 200;

HardwareSerial DWIN(1);
HardwareSerial ATMEGA(2);

static bool g_bridgeEnabled = true;
static bool g_tapEnabled = true;
static char g_cmd[96];
static uint8_t g_cmdLen = 0;
static uint32_t g_atFrameCount = 0;
static uint32_t g_atAsciiCount = 0;
static uint32_t g_dwinForwardBytes = 0;

struct FrameParser {
  uint8_t buf[192];
  uint16_t idx;
  uint8_t need;
  uint8_t state;
};

static FrameParser g_frame = {{0}, 0, 0, 0};
static char g_atLine[160];
static uint16_t g_atLineLen = 0;
static bool g_atLineActive = false;

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

static void atmega_reset_hold() {
  digitalWrite(ATMEGA_RESET_PIN, HIGH);
}

static void atmega_reset_release() {
  digitalWrite(ATMEGA_RESET_PIN, LOW);
}

static void atmega_reset_pulse(uint32_t pulse_ms) {
  atmega_reset_hold();
  delay(pulse_ms);
  atmega_reset_release();
}

static void frameReset() {
  g_frame.idx = 0;
  g_frame.need = 0;
  g_frame.state = 0;
}

static bool frameFeed(uint8_t b, const uint8_t*& frame, uint16_t& frameLen) {
  frame = nullptr;
  frameLen = 0;

  switch (g_frame.state) {
    case 0:
      if (b == 0x5A) {
        g_frame.buf[0] = b;
        g_frame.idx = 1;
        g_frame.state = 1;
      }
      break;
    case 1:
      if (b == 0xA5) {
        g_frame.buf[1] = b;
        g_frame.idx = 2;
        g_frame.state = 2;
      } else if (b == 0x5A) {
        g_frame.buf[0] = 0x5A;
        g_frame.idx = 1;
      } else {
        frameReset();
      }
      break;
    case 2:
      g_frame.need = b;
      g_frame.buf[2] = b;
      g_frame.idx = 3;
      if (g_frame.need < 2 || (uint16_t)(3 + g_frame.need) > sizeof(g_frame.buf)) {
        frameReset();
      } else {
        g_frame.state = 3;
      }
      break;
    case 3:
      g_frame.buf[g_frame.idx++] = b;
      if (g_frame.idx >= (uint16_t)(3 + g_frame.need)) {
        frame = g_frame.buf;
        frameLen = g_frame.idx;
        frameReset();
        return true;
      }
      break;
  }

  return false;
}

static bool startsAsciiLine(uint8_t b) {
  return b == '@' || b == 'p' || b == 'P';
}

static bool atmegaHandleAsciiByte(uint8_t b) {
  if (!g_atLineActive) {
    if (!startsAsciiLine(b)) return false;
    g_atLineActive = true;
    g_atLineLen = 0;
  }

  if (b == '\r') return true;

  if (b == '\n') {
    g_atLine[g_atLineLen] = 0;
    g_atAsciiCount++;
    if (g_tapEnabled) {
      Serial.print("[AT] ");
      Serial.println(g_atLine);
    }
    g_atLineActive = false;
    g_atLineLen = 0;
    return true;
  }

  if (g_atLineLen < sizeof(g_atLine) - 1) {
    g_atLine[g_atLineLen++] = (char)b;
  }
  return true;
}

static void print_help() {
  Serial.println();
  Serial.println("Commands:");
  Serial.println("  help       - show help");
  Serial.println("  ping       - local status");
  Serial.println("  reset      - pulse ATmega reset");
  Serial.println("  hold       - hold ATmega in reset");
  Serial.println("  release    - release ATmega reset");
  Serial.println("  bridge on  - enable DWIN<->ATmega bridge");
  Serial.println("  bridge off - disable DWIN<->ATmega bridge");
  Serial.println("  tap on     - print ATmega ASCII lines");
  Serial.println("  tap off    - mute ATmega ASCII lines");
  Serial.println("  atping     - send 'ping' to ATmega UART");
  Serial.println("  stats      - print bridge counters");
  Serial.println();
}

static void print_status() {
  Serial.printf("[PING] reset_gpio=%d bridge=%s tap=%s AT=%lu DWIN=%lu ASCII=%lu powerPin=%d\n",
                digitalRead(ATMEGA_RESET_PIN),
                g_bridgeEnabled ? "on" : "off",
                g_tapEnabled ? "on" : "off",
                (unsigned long)g_atFrameCount,
                (unsigned long)g_dwinForwardBytes,
                (unsigned long)g_atAsciiCount,
                MELAUHF_POWER_EN_PIN);
}

static void handle_command(const char* line) {
  if (!line || !line[0]) return;

  if (strcasecmp(line, "help") == 0) {
    print_help();
    return;
  }

  if (strcasecmp(line, "ping") == 0) {
    print_status();
    return;
  }

  if (strcasecmp(line, "reset") == 0) {
    Serial.println("[RESET] pulse start");
    atmega_reset_pulse(RESET_PULSE_MS);
    Serial.println("[RESET] pulse end");
    return;
  }

  if (strcasecmp(line, "hold") == 0) {
    atmega_reset_hold();
    Serial.println("[RESET] held");
    return;
  }

  if (strcasecmp(line, "release") == 0) {
    atmega_reset_release();
    Serial.println("[RESET] released");
    return;
  }

  if (strcasecmp(line, "bridge on") == 0) {
    g_bridgeEnabled = true;
    Serial.println("[BRIDGE] enabled");
    return;
  }

  if (strcasecmp(line, "bridge off") == 0) {
    g_bridgeEnabled = false;
    Serial.println("[BRIDGE] disabled");
    return;
  }

  if (strcasecmp(line, "tap on") == 0) {
    g_tapEnabled = true;
    Serial.println("[TAP] enabled");
    return;
  }

  if (strcasecmp(line, "tap off") == 0) {
    g_tapEnabled = false;
    Serial.println("[TAP] disabled");
    return;
  }

  if (strcasecmp(line, "atping") == 0) {
    ATMEGA.print("ping\r\n");
    Serial.println("[AT] ping sent");
    return;
  }

  if (strcasecmp(line, "stats") == 0) {
    Serial.printf("[STATS] at_frames=%lu dwin_bytes=%lu at_ascii=%lu\n",
                  (unsigned long)g_atFrameCount,
                  (unsigned long)g_dwinForwardBytes,
                  (unsigned long)g_atAsciiCount);
    return;
  }

  Serial.print("[ERR] unknown command: ");
  Serial.println(line);
}

static void pump_usb_serial() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\r' || c == '\n') {
      if (g_cmdLen == 0) continue;
      g_cmd[g_cmdLen] = 0;
      handle_command(g_cmd);
      g_cmdLen = 0;
      continue;
    }

    if (g_cmdLen < sizeof(g_cmd) - 1) {
      g_cmd[g_cmdLen++] = c;
    }
  }
}

static void pump_atmega_to_dwin() {
  while (ATMEGA.available()) {
    int v = ATMEGA.read();
    if (v < 0) break;

    uint8_t b = (uint8_t)v;

    if (g_atLineActive || ((g_frame.state == 0) && startsAsciiLine(b))) {
      if (atmegaHandleAsciiByte(b)) {
        continue;
      }
    }

    const uint8_t* frame = nullptr;
    uint16_t frameLen = 0;
    if (frameFeed(b, frame, frameLen)) {
      g_atFrameCount++;
      if (g_bridgeEnabled) {
        DWIN.write(frame, frameLen);
      }
    }
  }
}

static void pump_dwin_to_atmega() {
  while (DWIN.available()) {
    int v = DWIN.read();
    if (v < 0) break;

    if (g_bridgeEnabled) {
      ATMEGA.write((uint8_t)v);
      g_dwinForwardBytes++;
    }
  }
}

void setup() {
  Serial.begin(USB_BAUD);
  delay(150);

  pinMode(PIN_R, OUTPUT);
  pinMode(PIN_G, OUTPUT);
  pinMode(PIN_B, OUTPUT);
  rgbWrite(false, false, true);

  melauhfPowerInit();
  melauhfPowerSet(true);

  pinMode(ATMEGA_RESET_PIN, OUTPUT);
  atmega_reset_release();

  ATMEGA.begin(ATMEGA_BAUD, SERIAL_8N1, ATMEGA_RX_PIN, ATMEGA_TX_PIN);
  DWIN.begin(DWIN_BAUD, SERIAL_8N1, DWIN_RX_PIN, DWIN_TX_PIN);
  frameReset();

  Serial.println();
  Serial.println("=== ABBAS_ESPbyMELAUHF GPIO24 Test ===");
  Serial.printf("ATMEGA UART pins: RX=%d TX=%d @%lu\n",
                ATMEGA_RX_PIN,
                ATMEGA_TX_PIN,
                (unsigned long)ATMEGA_BAUD);
  Serial.printf("DWIN   UART pins: RX=%d TX=%d @%lu\n",
                DWIN_RX_PIN,
                DWIN_TX_PIN,
                (unsigned long)DWIN_BAUD);
  Serial.printf("RESET pin: GPIO%d\n", ATMEGA_RESET_PIN);
  Serial.printf("POWER pin: %d\n", MELAUHF_POWER_EN_PIN);
  Serial.println("Bridge default: ON");
  Serial.println("ASCII tap default: ON");
  print_help();
  rgbWrite(false, true, false);
}

void loop() {
  pump_usb_serial();
  pump_atmega_to_dwin();
  pump_dwin_to_atmega();
  delay(1);
}
