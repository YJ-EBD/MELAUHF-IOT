// =============================================================================
// Test.ino  —  SD카드 삽입/제거 감지 (ESP32-C5 DevKitC-1)
// =============================================================================
// 기존 코드 사용 핀 (충돌 금지)
//   GPIO 4  : ATmega RX        GPIO 7  : DWIN TX
//   GPIO 5  : ATmega TX        GPIO 8  : RGB Blue
//   GPIO 6  : DWIN RX          GPIO 23 : 외부 버튼
//                              GPIO 25 : RGB Red
//                              GPIO 26 : RGB Green
//                              GPIO 28 : BOOT PIN
//
// SD 모듈 → ESP32-C5 핀 배선
//   SD 모듈   ESP32-C5
//   CS    →  GPIO10
//   MOSI  →  GPIO11
//   SCK   →  GPIO12
//   MISO  →  GPIO9
//   3V3   →  3V3
//   GND   →  GND
// =============================================================================

#include <SPI.h>
#include <SD.h>

// ── SD SPI 핀 ──────────────────────────────────────────────────────────────
#define SD_CS    10
#define SD_MOSI  11
#define SD_SCK   12
#define SD_MISO   9

// ── 상태 변수 ──────────────────────────────────────────────────────────────
static bool     sdInserted  = false;
static uint32_t lastCheckMs = 0;
static const uint32_t CHECK_MS = 800;

// 전방 선언
void sd_setup();
void sd_loop();
static bool probeSD();
static void mountAndPrint();

// =============================================================================
// 단독 실행용 (메인 코드 이식 시엔 sd_setup / sd_loop 만 호출)
// =============================================================================
void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);
  sd_setup();
}

void loop() {
  sd_loop();
}

// =============================================================================
// sd_setup()  —  메인 setup() 끝에서 호출
// =============================================================================
void sd_setup() {
  Serial.println("\n[SD] -- SD카드 감지 초기화 --");
  Serial.printf("[SD] 핀: CS=%d MOSI=%d SCK=%d MISO=%d\n",
                SD_CS, SD_MOSI, SD_SCK, SD_MISO);

  SPI.begin(SD_SCK, SD_MISO, SD_MOSI, SD_CS);

  if (probeSD()) {
    sdInserted = true;
    Serial.println("[SD] SD카드 감지됨 (부팅 시)");
    mountAndPrint();
  } else {
    sdInserted = false;
    Serial.println("[SD] SD카드 없음 (삽입하면 자동 감지)");
  }
}

// =============================================================================
// sd_loop()  —  메인 loop() 안에서 호출 (블로킹 없음)
// =============================================================================
void sd_loop() {
  uint32_t now = millis();
  if ((uint32_t)(now - lastCheckMs) < CHECK_MS) return;
  lastCheckMs = now;

  bool present = probeSD();

  if (present && !sdInserted) {
    sdInserted = true;
    Serial.println("\n[SD] ✅ SD카드 삽입됨!");
    mountAndPrint();

  } else if (!present && sdInserted) {
    sdInserted = false;
    // probeSD() 내부에서 SD.end() 처리 완료
    Serial.println("\n[SD] ❌ SD카드 제거됨.");
  }
}

// =============================================================================
// probeSD()
//  — 매번 SD.end()로 완전히 해제한 뒤 SD.begin()을 재시도한다.
//  — 카드가 없으면 begin()이 false를 반환하므로 제거도 정확히 감지된다.
//  — 기존 방식(begin() 한 번만 호출)은 이미 마운트된 상태에서
//    카드를 빼도 내부 상태가 유지돼 false를 반환하지 않는 문제가 있었음.
// =============================================================================
static bool probeSD() {
  SD.end();                   // 항상 언마운트 후 재시도 (핵심 수정)
  bool ok = SD.begin(SD_CS);
  if (!ok) SD.end();          // 실패 시도 깔끔하게 해제
  return ok;
}

// =============================================================================
// mountAndPrint() — 카드 정보 시리얼 출력
// =============================================================================
static void mountAndPrint() {
  uint8_t t = SD.cardType();
  Serial.print("[SD]   카드 타입 : ");
  switch (t) {
    case CARD_MMC:  Serial.println("MMC");        break;
    case CARD_SD:   Serial.println("SDSC");       break;
    case CARD_SDHC: Serial.println("SDHC/SDXC"); break;
    default:        Serial.println("알 수 없음"); break;
  }
  uint64_t cardMB  = SD.cardSize()   / (1024ULL * 1024ULL);
  uint64_t totalMB = SD.totalBytes() / (1024ULL * 1024ULL);
  uint64_t usedMB  = SD.usedBytes()  / (1024ULL * 1024ULL);
  Serial.printf("[SD]   용량: %llu MB  |  사용: %llu MB  |  여유: %llu MB\n",
                cardMB, usedMB, totalMB - usedMB);
}
