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

HardwareSerial ATMEGA(2);

static char g_cmd[64];
static uint8_t g_cmdLen = 0;
static bool g_tapEnabled = false;

static void print_help(void) {
  Serial.println();
  Serial.println("Commands:");
  Serial.println("  help     - show help");
  Serial.println("  reset    - pulse ATmega reset");
  Serial.println("  hold     - hold ATmega in reset");
  Serial.println("  release  - release ATmega reset");
  Serial.println("  ping     - print local status");
  Serial.println("  tap on   - show raw ATmega UART bytes");
  Serial.println("  tap off  - hide raw ATmega UART bytes");
  Serial.println();
  Serial.println("Notes:");
  Serial.println("  GPIO24 HIGH  = reset asserted");
  Serial.println("  GPIO24 LOW   = reset released");
  Serial.println("  CR or LF line ending is accepted");
  Serial.println();
}

static void atmega_reset_hold(void) {
  digitalWrite(ATMEGA_RESET_PIN, HIGH);
}

static void atmega_reset_release(void) {
  digitalWrite(ATMEGA_RESET_PIN, LOW);
}

static void atmega_reset_pulse(uint32_t pulse_ms) {
  atmega_reset_hold();
  delay(pulse_ms);
  atmega_reset_release();
}

static void handle_command(const char* line) {
  if (!line || !line[0]) return;

  if (strcasecmp(line, "help") == 0) {
    print_help();
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
    Serial.println("[RESET] held low on ATmega side");
    return;
  }

  if (strcasecmp(line, "release") == 0) {
    atmega_reset_release();
    Serial.println("[RESET] released");
    return;
  }

  if (strcasecmp(line, "ping") == 0) {
    Serial.printf("[PING] reset_gpio=%d uart=%lu tap=%s\n",
                  digitalRead(ATMEGA_RESET_PIN),
                  (unsigned long)ATMEGA_BAUD,
                  g_tapEnabled ? "on" : "off");
    return;
  }

  if (strcasecmp(line, "tap on") == 0) {
    g_tapEnabled = true;
    Serial.println("[TAP] raw ATmega UART output enabled");
    return;
  }

  if (strcasecmp(line, "tap off") == 0) {
    g_tapEnabled = false;
    Serial.println("[TAP] raw ATmega UART output muted");
    return;
  }

  Serial.print("[ERR] unknown command: ");
  Serial.println(line);
}

void setup() {
  Serial.begin(USB_BAUD);
  delay(200);

  pinMode(ATMEGA_RESET_PIN, OUTPUT);
  atmega_reset_release();

  ATMEGA.begin(ATMEGA_BAUD, SERIAL_8N1, ATMEGA_RX_PIN, ATMEGA_TX_PIN);

  Serial.println();
  Serial.println("=== ATmega GPIO24 Reset Test ===");
  Serial.printf("ATMEGA UART pins: RX=%d TX=%d @%lu\n",
                ATMEGA_RX_PIN,
                ATMEGA_TX_PIN,
                (unsigned long)ATMEGA_BAUD);
  Serial.printf("ATMEGA RESET pin: GPIO%d (active via NPN)\n", ATMEGA_RESET_PIN);
  Serial.println("Default state: reset released");
  Serial.println("Raw ATmega UART tap: OFF");
  print_help();
}

void loop() {
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

  while (ATMEGA.available()) {
    char c = (char)ATMEGA.read();
    if (g_tapEnabled) {
      Serial.write(c);
    }
  }
}
