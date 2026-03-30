#include <Arduino.h>

#ifndef ATMEGA_RX_PIN
#define ATMEGA_RX_PIN 4
#endif

#ifndef ATMEGA_TX_PIN
#define ATMEGA_TX_PIN 5
#endif

#ifndef ATMEGA_RESET_PIN
#define ATMEGA_RESET_PIN 24
#endif

static const uint32_t USB_BAUD = 115200;
static const uint32_t ATMEGA_BAUD = 115200;
static const uint32_t RESET_PULSE_MS = 200;
static const uint32_t BOOT_WAIT_MS = 1500;
static const uint32_t BYTE_TIMEOUT_MS = 250;

HardwareSerial ATMEGA(2);

static char g_cmd[96];
static uint8_t g_cmdLen = 0;
static bool g_tapEnabled = false;
static bool g_resetAssertHigh = true;

static void atmegaResetHold() {
  digitalWrite(ATMEGA_RESET_PIN, g_resetAssertHigh ? HIGH : LOW);
}

static void atmegaResetRelease() {
  digitalWrite(ATMEGA_RESET_PIN, g_resetAssertHigh ? LOW : HIGH);
}

static void atmegaResetPulse(uint32_t pulseMs) {
  atmegaResetHold();
  delay(pulseMs);
  atmegaResetRelease();
}

static void atmegaDrainRx() {
  while (ATMEGA.available()) {
    (void)ATMEGA.read();
  }
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

static bool atmegaReadExpectByte(uint8_t expected, uint32_t timeoutMs) {
  uint8_t b = 0;
  if (!atmegaReadExact(&b, 1, timeoutMs)) return false;
  if (b != expected) {
    Serial.printf("[RX] expected=0x%02X got=0x%02X\n", (unsigned)expected, (unsigned)b);
    return false;
  }
  return true;
}

static void printHexBytes(const uint8_t* data, size_t len) {
  for (size_t i = 0; i < len; i++) {
    if (i != 0) Serial.print(' ');
    Serial.printf("%02X", (unsigned)data[i]);
  }
}

static bool looksLikeDwinHeader(const uint8_t* data, size_t len) {
  if (!data || len < 3) return false;
  return (data[0] == 0x5A && data[1] == 0xA5);
}

static bool avr109ReadSignature(uint8_t sig[3]) {
  uint8_t cmd = 's';
  ATMEGA.write(&cmd, 1);
  ATMEGA.flush();
  return atmegaReadExact(sig, 3, BYTE_TIMEOUT_MS);
}

static bool avr109EnterProgMode() {
  uint8_t cmd = 'P';
  ATMEGA.write(&cmd, 1);
  ATMEGA.flush();
  return atmegaReadExpectByte('\r', BYTE_TIMEOUT_MS);
}

static bool avr109LeaveProgMode() {
  uint8_t cmd = 'L';
  ATMEGA.write(&cmd, 1);
  ATMEGA.flush();
  return atmegaReadExpectByte('\r', BYTE_TIMEOUT_MS);
}

static bool avr109QueryBlockSize(uint16_t& blockSizeOut) {
  uint8_t cmd = 'b';
  uint8_t reply[3] = {0};
  blockSizeOut = 0;

  ATMEGA.write(&cmd, 1);
  ATMEGA.flush();
  if (!atmegaReadExact(reply, sizeof(reply), BYTE_TIMEOUT_MS)) return false;
  if (reply[0] != 'Y') {
    Serial.printf("[BLK] unexpected reply: 0x%02X 0x%02X 0x%02X\n",
                  (unsigned)reply[0], (unsigned)reply[1], (unsigned)reply[2]);
    return false;
  }

  blockSizeOut = (uint16_t)(((uint16_t)reply[1] << 8) | reply[2]);
  return true;
}

static bool avr109ReadProgrammerId(char* out, size_t outSz) {
  if (!out || outSz < 8) return false;
  uint8_t cmd = 'S';
  uint8_t id[7] = {0};

  ATMEGA.write(&cmd, 1);
  ATMEGA.flush();
  if (!atmegaReadExact(id, sizeof(id), BYTE_TIMEOUT_MS)) return false;

  memcpy(out, id, sizeof(id));
  out[7] = 0;
  return true;
}

static bool avr109ReadVersion(char which, uint8_t out[2]) {
  if (!out) return false;
  ATMEGA.write((uint8_t)which);
  ATMEGA.flush();
  return atmegaReadExact(out, 2, BYTE_TIMEOUT_MS);
}

static bool parseHexByteToken(const char* txt, uint8_t& out) {
  if (!txt || !txt[0]) return false;
  char* endPtr = nullptr;
  unsigned long v = strtoul(txt, &endPtr, 16);
  if (!endPtr || endPtr == txt || *endPtr != 0 || v > 0xFFUL) return false;
  out = (uint8_t)v;
  return true;
}

static bool runProbe(bool verbose) {
  uint8_t sig[3] = {0};
  bool found = false;
  uint32_t dwinLikeReplies = 0;
  uint32_t otherReplies = 0;
  uint32_t deadline = millis() + BOOT_WAIT_MS;

  atmegaDrainRx();
  atmegaResetPulse(RESET_PULSE_MS);
  delay(40);

  while ((int32_t)(millis() - deadline) < 0) {
    atmegaDrainRx();
    if (avr109ReadSignature(sig)) {
      if (verbose) {
        Serial.print("[PROBE] signature reply: ");
        printHexBytes(sig, sizeof(sig));
        Serial.println();
      }
      if (looksLikeDwinHeader(sig, sizeof(sig))) dwinLikeReplies++;
      else otherReplies++;
      if (sig[0] == 0x1E && sig[1] == 0x97 && sig[2] == 0x02) {
        found = true;
        break;
      }
    }
    delay(25);
  }

  if (found) {
    Serial.println("[PROBE] bootloader signature OK (1E 97 02)");
  } else {
    Serial.println("[PROBE] FAIL: bootloader signature timeout");
    if (dwinLikeReplies > 0) {
      Serial.printf("[PROBE] hint: saw %lu DWIN-like replies (5A A5 ...)\n",
                    (unsigned long)dwinLikeReplies);
      Serial.println("[PROBE] hint: ATmega app is running and sending screen frames.");
      Serial.println("[PROBE] hint: bootloader is not active on this UART, or BOOTRST/bootloader is missing.");
    } else if (otherReplies > 0) {
      Serial.printf("[PROBE] hint: saw %lu non-AVR109 replies on UART\n",
                    (unsigned long)otherReplies);
    } else {
      Serial.println("[PROBE] hint: no UART reply at all during boot window");
    }
  }
  return found;
}

static void printHelp() {
  Serial.println();
  Serial.println("Commands:");
  Serial.println("  help               - show help");
  Serial.println("  status             - show current pin/uart state");
  Serial.println("  reset              - pulse ATmega reset");
  Serial.println("  hold               - hold ATmega in reset");
  Serial.println("  release            - release ATmega reset");
  Serial.println("  polarity high      - reset asserted by GPIO HIGH");
  Serial.println("  polarity low       - reset asserted by GPIO LOW");
  Serial.println("  drain              - clear bytes waiting from ATmega");
  Serial.println("  tap on             - print raw bytes from ATmega");
  Serial.println("  tap off            - mute raw byte tap");
  Serial.println("  sig                - send 's' and read 3-byte signature");
  Serial.println("  probe              - reset and poll for bootloader signature");
  Serial.println("  prog               - send 'P' and expect CR");
  Serial.println("  leave              - send 'L' and expect CR");
  Serial.println("  block              - send 'b' and read block size");
  Serial.println("  id                 - send 'S' and read programmer id");
  Serial.println("  ver hw             - send 'V' and read 2-byte version");
  Serial.println("  ver sw             - send 'v' and read 2-byte version");
  Serial.println("  handshake          - probe + prog + block");
  Serial.println("  send <hex...>      - send raw bytes, example: send 73 50");
  Serial.println();
  Serial.println("Notes:");
  Serial.println("  Default polarity: HIGH = reset asserted");
  Serial.println("  Use Serial Monitor at 115200, line ending: Newline");
  Serial.println();
}

static void printStatus() {
  Serial.printf("[STATUS] reset_gpio=%d uart=%lu tap=%s\n",
                digitalRead(ATMEGA_RESET_PIN),
                (unsigned long)ATMEGA_BAUD,
                g_tapEnabled ? "on" : "off");
  Serial.printf("[STATUS] RX=%d TX=%d RESET=%d pulse=%lu boot_wait=%lu timeout=%lu assert=%s\n",
                ATMEGA_RX_PIN,
                ATMEGA_TX_PIN,
                ATMEGA_RESET_PIN,
                (unsigned long)RESET_PULSE_MS,
                (unsigned long)BOOT_WAIT_MS,
                (unsigned long)BYTE_TIMEOUT_MS,
                g_resetAssertHigh ? "HIGH" : "LOW");
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

static void handleVersionCommand(const char* arg) {
  uint8_t reply[2] = {0};
  char which = 0;

  if (arg && strcasecmp(arg, "hw") == 0) which = 'V';
  else if (arg && strcasecmp(arg, "sw") == 0) which = 'v';
  else {
    Serial.println("[VER] usage: ver hw | ver sw");
    return;
  }

  if (!avr109ReadVersion(which, reply)) {
    Serial.printf("[VER] FAIL: no reply for '%c'\n", which);
    return;
  }

  Serial.printf("[VER] %s='%c%c' (0x%02X 0x%02X)\n",
                (which == 'V') ? "hw" : "sw",
                (char)reply[0], (char)reply[1],
                (unsigned)reply[0], (unsigned)reply[1]);
}

static void handleHandshakeCommand() {
  uint16_t blockSize = 0;

  if (!runProbe(true)) return;
  if (!avr109EnterProgMode()) {
    Serial.println("[HANDSHAKE] FAIL: enter prog mode");
    return;
  }
  Serial.println("[HANDSHAKE] prog mode OK");

  if (!avr109QueryBlockSize(blockSize)) {
    Serial.println("[HANDSHAKE] FAIL: block size query");
    return;
  }
  Serial.printf("[HANDSHAKE] block size OK: %u\n", (unsigned)blockSize);
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

  if (strcasecmp(line, "polarity") == 0) {
    if (arg && strcasecmp(arg, "high") == 0) {
      g_resetAssertHigh = true;
      atmegaResetRelease();
      Serial.println("[RESET] polarity set: HIGH asserts reset");
      return;
    }
    if (arg && strcasecmp(arg, "low") == 0) {
      g_resetAssertHigh = false;
      atmegaResetRelease();
      Serial.println("[RESET] polarity set: LOW asserts reset");
      return;
    }
    Serial.println("[RESET] usage: polarity high | polarity low");
    return;
  }

  if (strcasecmp(line, "drain") == 0) {
    atmegaDrainRx();
    Serial.println("[RX] drained");
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

  if (strcasecmp(line, "sig") == 0) {
    uint8_t sig[3] = {0};
    if (!avr109ReadSignature(sig)) {
      Serial.println("[SIG] FAIL: timeout");
      return;
    }
    Serial.print("[SIG] ");
    printHexBytes(sig, sizeof(sig));
    if (sig[0] == 0x1E && sig[1] == 0x97 && sig[2] == 0x02) {
      Serial.print("  <- OK");
    }
    Serial.println();
    return;
  }

  if (strcasecmp(line, "probe") == 0) {
    (void)runProbe(true);
    return;
  }

  if (strcasecmp(line, "prog") == 0) {
    if (avr109EnterProgMode()) Serial.println("[PROG] OK");
    else Serial.println("[PROG] FAIL");
    return;
  }

  if (strcasecmp(line, "leave") == 0) {
    if (avr109LeaveProgMode()) Serial.println("[LEAVE] OK");
    else Serial.println("[LEAVE] FAIL");
    return;
  }

  if (strcasecmp(line, "block") == 0) {
    uint16_t blockSize = 0;
    if (!avr109QueryBlockSize(blockSize)) {
      Serial.println("[BLOCK] FAIL");
      return;
    }
    Serial.printf("[BLOCK] size=%u\n", (unsigned)blockSize);
    return;
  }

  if (strcasecmp(line, "id") == 0) {
    char id[8];
    if (!avr109ReadProgrammerId(id, sizeof(id))) {
      Serial.println("[ID] FAIL");
      return;
    }
    Serial.printf("[ID] %s\n", id);
    return;
  }

  if (strcasecmp(line, "ver") == 0) {
    handleVersionCommand(arg);
    return;
  }

  if (strcasecmp(line, "handshake") == 0) {
    handleHandshakeCommand();
    return;
  }

  if (strcasecmp(line, "send") == 0) {
    handleSendCommand(arg);
    return;
  }

  Serial.print("[ERR] unknown command: ");
  Serial.println(line);
}

void setup() {
  Serial.begin(USB_BAUD);
  delay(250);

  pinMode(ATMEGA_RESET_PIN, OUTPUT);
  atmegaResetRelease();

  ATMEGA.begin(ATMEGA_BAUD, SERIAL_8N1, ATMEGA_RX_PIN, ATMEGA_TX_PIN);

  Serial.println();
  Serial.println("=== ATmega AVR109 Bootloader Test ===");
  Serial.printf("ATMEGA UART pins: RX=%d TX=%d @%lu\n",
                ATMEGA_RX_PIN,
                ATMEGA_TX_PIN,
                (unsigned long)ATMEGA_BAUD);
  Serial.printf("ATMEGA RESET pin: GPIO%d\n", ATMEGA_RESET_PIN);
  Serial.println("Bootloader expects signature: 1E 97 02");
  printHelp();
}

void loop() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\r' || c == '\n') {
      if (g_cmdLen == 0) continue;
      g_cmd[g_cmdLen] = 0;
      handleCommand(g_cmd);
      g_cmdLen = 0;
      continue;
    }

    if (g_cmdLen < sizeof(g_cmd) - 1) {
      g_cmd[g_cmdLen++] = c;
    }
  }

  while (ATMEGA.available()) {
    int v = ATMEGA.read();
    if (v < 0) break;
    if (g_tapEnabled) {
      Serial.printf("[TAP] 0x%02X '%c'\n",
                    (unsigned)v,
                    (v >= 0x20 && v <= 0x7E) ? v : '.');
    }
  }
}
