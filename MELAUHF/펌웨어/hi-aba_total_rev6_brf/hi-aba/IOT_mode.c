/*
 * IOT_mode.c
 *
 * Extracted IoT, Wi-Fi, OTA, page-63~74 UI flow, and ESP bridge logic
 * from main.c so the core firmware boot/runtime skeleton stays closer to the
 * EA2247 layout while preserving MA5105 behavior.
 */

#include <avr/io.h>
#include <avr/interrupt.h>
#include <util/delay.h>
#include <avr/eeprom.h>
#include <avr/pgmspace.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "IOT_mode.h"
#include "dwin.h"
#include "common_f.h"
#include "crc.h"
#include "ds1307.h"
#include "i2c.h"

volatile U08 dwin_page_now = 0xFF;
volatile U08 g_hw_output_lock = 1;
volatile U08 sub_active = 0;
volatile U08 sub_dirty = 0;
int16_t sub_remain_days = 0;
char sub_plan_text[11] = "-";
char sub_range_text[22] = "-";
char sub_dday_text[11] = "D-0";
#define SUB_STATE_UNKNOWN 0
#define SUB_STATE_ACTIVE  1
#define SUB_STATE_READY   2
#define SUB_STATE_EXPIRED 3
#define SUB_STATE_UNREGISTERED 4
#define SUB_STATE_OFFLINE 5
static volatile U08 sub_state_seen = 0;
static volatile U08 sub_state_code = SUB_STATE_UNKNOWN;
static volatile U08 sub_ready_pending = 0;
static uint32_t sub_ready_pending_sec = 0;
#define SUB_READY_GRACE_SEC 1U
// [NEW FEATURE] Energy metrics received from ESP for page57/page71 rendering.
static uint32_t g_energy_assigned_j = 0;
static uint32_t g_energy_used_j = 0;
static uint32_t g_energy_daily_avg_j = 0;
static uint32_t g_energy_monthly_avg_j = 0;
static uint32_t g_energy_projected_j = 0;
static uint16_t g_energy_elapsed_days = 1;
static uint16_t g_energy_remaining_days = 0;
static volatile U08 g_energy_dirty = 1;
static volatile U08 g_energy_local_expired_lock = 0;
static volatile U08 g_energy_sync_seen_mask = 0;
#define ENERGY_SYNC_SEEN_ASSIGNED 0x01
#define ENERGY_SYNC_SEEN_USED     0x02

static volatile U08 sub_uart_active = 0;
static volatile U08 sub_uart_ready = 0;
static volatile U08 sub_uart_len = 0;
static volatile U08 sub_uart_drop = 0;
static volatile U08 sub_uart_bracket_mode = 0;
// Keep enough room for active subscription lines while staying within
// ATmega128A SRAM limits.
#define SUB_UART_LINE_MAX 48
static char sub_uart_line[SUB_UART_LINE_MAX];
static volatile U08 sub_uart_q_head = 0;
static volatile U08 sub_uart_q_tail = 0;
static volatile U08 sub_uart_q_count = 0;
// [NEW FEATURE] Set when ESP command headers are observed on UART0 wiring variant.
static volatile U08 esp_bridge_uart0_seen = 0;
// Keep RAM usage under ATmega128A 4KB SRAM limit while preserving
// minimal burst buffering for ESP text commands.
#define SUB_UART_Q_DEPTH 2
static char sub_uart_queue[SUB_UART_Q_DEPTH][SUB_UART_LINE_MAX];
static inline void UART1_TX(uint8_t b);
static inline void UART1_TX_STR(const char* s);
static inline void UART0_TX(uint8_t b);
static inline void UART0_TX_STR(const char* s);
static void subscription_enter_lock_page(U08 page);
static void subscription_show_connected_page(void);
static U08 subscription_resolve_connected_target_page(U08 resumePage, U08 *targetPage);
static void subscription_restore_ready_page(void);
static void energy_clear_subscription_snapshot(void);
static void energy_reset_sync_state(void);
static U08 energy_sync_ready(void);
static U08 energy_subscription_exhausted(void);
static void subscription_ready_pending_arm(void);
static void subscription_ready_pending_cancel(void);
static void subscription_ready_pending_tick(void);
static U08 subscription_uart_line_is_priority(const char *line);
static U08 energy_parse_line_fast_isr(const char *line);
static void ota_finish_prompt(U08 accept);
static void p63_wifi_status_set(U08 connected);

static volatile U08 p63_scan_req = 0;
static volatile U08 p63_prev_req = 0;
static volatile U08 p63_next_req = 0;
static volatile U16 p63_last_key = 0;

// Runtime key queue depth; 8 is sufficient for bursty page-touch forwarding
// while leaving a little more SRAM headroom on ATmega128A.
#define RKC_UART_Q_DEPTH 8
static volatile U08 rkc_uart_q_head = 0;
static volatile U08 rkc_uart_q_tail = 0;
static volatile U08 rkc_uart_q_count = 0;
static U08 rkc_uart_q_page[RKC_UART_Q_DEPTH];
static U16 rkc_uart_q_key[RKC_UART_Q_DEPTH];

static volatile U08 p63_rx_state = 0;
static volatile U08 p63_rx_need = 0;
static volatile U08 p63_rx_idx = 0;
// Key/touch frames are short; keeping this above observed frame size preserves
// parser safety while reclaiming SRAM on ATmega128A.
static volatile U08 p63_rx_buf[48];

static volatile U08 p63_anim_on = 0;
static U08 p63_anim_visible = 0;
static U08 p63_anim_frame = 0;
static volatile U16 p63_anim_ms = 0;
static U16 p63_anim_last_ms = 0;

static volatile U08 p63_wifi_connected_state = 0xFF;
static volatile U08 p63_wifi_status_seen = 0;
static volatile U08 p63_boot_wifi_phase = 0;
static volatile U08 reg_gate_status_seen = 0;
static volatile U08 reg_gate_registered = 1;
static volatile uint32_t p63_wifi_last_seen_sec = 0;
static uint32_t p63_wifi_boot_sec = 0;
static uint32_t p63_wifi_last_no_signal_sec = 0;
static volatile U08 p63_scan_busy = 0;
static volatile uint32_t p63_scan_busy_until_sec = 0;
static volatile U08 p63_fail_safe_stop = 0;
static U08 p63_page_before_fail = 0;
static U08 p63_wifi_page_last_sent = 0xFF;
static U08 p63_last_page_seen = 0xFF;
static U08 p63_boot_resume_page = 0;
static volatile U08 p63_boot_waiting_status = 0;
static uint32_t p63_connected_wait_start_sec = 0;

#define WIFI_FIELD_SSID 0
#define WIFI_FIELD_PW   1

#define WIFI_TEXT_VP_SSID 0xB001
#define WIFI_TEXT_VP_PW   0xB100
#define WIFI_TEXT_DISPLAY_LEN 32
#define WIFI_PW_ICON_VP 0xC001
// DGUS VAR ICON writes selector values, not absolute icon IDs.
// 0 -> icon ID 469, 1 -> icon ID 470 (configured in HMI).
#define WIFI_PW_ICON_VAL_MASKED 0
#define WIFI_PW_ICON_VAL_VISIBLE 1
#define WIFI_PW_MASK_SLOT_COUNT 14
#define WIFI_PW_MASK_SLOT_SHOW_VAL 0U
#define WIFI_PW_MASK_SLOT_HIDE_VAL 0xFFFFU

#define WIFI_KEY_FOCUS_SSID 0x0B00
#define WIFI_KEY_FOCUS_PW   0x0B01

#define WIFI_KEY_NUM_1 0x0A01
#define WIFI_KEY_NUM_9 0x0A09
#define WIFI_KEY_NUM_0 0x0A10
#define WIFI_KEY_NUM_MINUS 0x0A11
#define WIFI_KEY_NUM_EQUAL 0x0A12

#define WIFI_KEY_UPPER_FIRST 0xAA01
#define WIFI_KEY_UPPER_LAST  0xAA26
#define WIFI_KEY_LOWER_FIRST 0xBB01
#define WIFI_KEY_LOWER_LAST  0xBB26
#define WIFI_KEY_SYMBOL_FIRST 0xCC01
#define WIFI_KEY_SYMBOL_LAST  0xCC28

#define WIFI_KEY_BACKSPACE 0xAAA1
#define WIFI_KEY_RETURN    0xAAA2
#define WIFI_KEY_SHIFT     0xAAA3
#define WIFI_KEY_GO        0xAAA4
#define WIFI_KEY_SPACE     0xAAA5
#define WIFI_KEY_SYMBOL    0xAAA6
#define WIFI_KEY_PW_ICON_TOGGLE 0xC011

#define WIFI_PAGE_LIST 63
#define WIFI_PAGE_UPPER 64
#define WIFI_PAGE_LOWER 65
#define WIFI_PAGE_SYMBOL 66
#define WIFI_PAGE_CONNECTING 67
#define WIFI_PAGE_CONNECTED 61
#define WIFI_PAGE_BOOT_CHECK 68
#define WIFI_PAGE_REGISTER_WAIT 73
#define WIFI_PAGE_SUB_EXPIRED 59
#define WIFI_PAGE_SUB_OFFLINE 20
#define OTA_PAGE_FIRMWARE_UPDATE 74

#define P63_BOOT_WIFI_PHASE_NONE       0U
#define P63_BOOT_WIFI_PHASE_CONNECTING 1U
#define P63_BOOT_WIFI_PHASE_AP_READY   2U
#define P63_BOOT_WIFI_PHASE_ERROR      3U

#define OTA_KEY_UPDATE_ACCEPT 0xBC01
#define OTA_KEY_UPDATE_SKIP   0xBC02
#define OTA_TEXT_VP_CURRENT_VERSION 0x1A10
#define OTA_TEXT_VP_TARGET_VERSION  0x1B50
#define OTA_VERSION_TEXT_LEN 24
#define OTA_TEXT_VP_PROGRESS 0xD222
#define OTA_PROGRESS_VARICON_VP 0x1C1A
#define OTA_PROGRESS_TEXT_LEN 20
#define OTA_PROGRESS_ICON_HIDE_VAL 0xFFFFU
#define OTA_PROGRESS_ICON_MAX 9U
#define OTA_REBOOT_ICON_FIRST 10U
#define OTA_REBOOT_ICON_LAST  26U
// Timer0 ISR frequency is ~1225Hz, so 245 ticks is about 200ms.
#define OTA_REBOOT_ANIM_PERIOD_TICKS 245U

#define PAGE71_TEXT_VP_ESP_VERSION    0xD100
#define PAGE71_TEXT_VP_ATMEGA_VERSION 0xD500
#define PAGE71_TEXT_LEN 20U
#define PAGE71_ESP_VERSION_CACHE_LEN 12U
#define PAGE71_DEFAULT_ESP_VERSION "26.3.13.1"

#define OTA_PROGRESS_PHASE_NONE      0
#define OTA_PROGRESS_PHASE_DOWNLOAD  1
#define OTA_PROGRESS_PHASE_UPDATE    2
#define OTA_PROGRESS_PHASE_REBOOT    3

#define OTA_PROMPT_FLAG_ACTIVE  0x01
#define OTA_PROMPT_FLAG_SHOWN   0x02
#define OTA_PROMPT_FLAG_DECIDED 0x04
static volatile U08 ota_prompt_flags = 0;
static U08 ota_prev_page = 0;
static volatile U08 ota_progress_phase = OTA_PROGRESS_PHASE_NONE;
static U08 ota_progress_index = 0;
static uint32_t ota_progress_last_sec = 0;
static volatile U08 ota_boot_prompt_pending = 0;
static char ota_boot_current_version[OTA_VERSION_TEXT_LEN + 1] = {0};
static char ota_boot_target_version[OTA_VERSION_TEXT_LEN + 1] = {0};
static char page71_esp_version_text[PAGE71_ESP_VERSION_CACHE_LEN] = PAGE71_DEFAULT_ESP_VERSION;

#define WIFI_FAIL_TEXT_VP 0xB222
#define WIFI_FAIL_TEXT_LEN 32

#define WIFI_KEY_P63_SLOT1 0x4111
#define WIFI_KEY_P63_SLOT5 0x4115

#define PAGE67_ICON_SLOT_COUNT 11
#define PAGE67_ICON_BASE_ID 471
// Page68 boot check requirements.
#define PAGE68_CHECK_COUNT 10
#define PAGE68_ICON_VP 0x0C0A
#define PAGE68_TEXT_VP 0xC222
#define PAGE68_TEXT_LEN 32
#define PAGE68_STEP_MIN_MS 500
#define PAGE68_STATUS_ACTIVITY_WAIT_MS 60000
#define PAGE68_WIFI_PHASE_WAIT_MS 15000
#define PAGE68_WIFI_STATUS_FRAME_WAIT_MS 15000
#define PAGE68_REG_STATUS_WAIT_MS 3200
#define PAGE68_SUB_STATUS_WAIT_MS 3200
#define PAGE68_ENERGY_STATUS_WAIT_MS 3200
#define PAGE68_OTA_PROMPT_WAIT_MS 1000
#define PAGE68_REFRESH_PERIOD_MS 250
#define PAGE68_FAIL_PAGE 10
#define PAGE68_ERROR_VP 0x1200
#define PAGE68_ERROR_TEXT_LEN 16
// DGUS VAR ICON generally expects selector index (0..N), not absolute icon ID.
// Page68 object 0x0C0A is expected to map:
// index 0..9 -> icon ID 482..491
#define PAGE68_ICON_INDEX_BASE 0
// Timer0 ISR frequency ~=1225Hz, 368 ticks ~= 300ms.
#define PAGE67_ANIM_PERIOD_TICKS 368

static volatile U08 page68_boot_active = 0;
static U08 page68_current_step = 0xFF;
static char page68_text_cache[PAGE68_TEXT_LEN + 1] = {0};
static uint16_t page68_refresh_elapsed_ms = 0;

char ssid_buf[33] = {0};
char pw_buf[64] = {0};
uint8_t ssid_len = 0;
uint8_t pw_len = 0;
uint8_t active_field = WIFI_FIELD_PW;
uint8_t current_page = WIFI_PAGE_LOWER;
static U08 wifi_pw_masked = 1;

#define WIFI_SSID_SLOT_MAX_LEN 33
static char p63_slot_ssid[5][WIFI_SSID_SLOT_MAX_LEN];
static uint8_t p63_slot_lock_mask = 0;
static const char wifi_upper_map[27] PROGMEM = "QWERTYUIOPASDFGHJKLZXCVBNM";
static const char wifi_lower_map[27] PROGMEM = "qwertyuiopasdfghjklzxcvbnm";
static const char wifi_symbol_map[28] PROGMEM = {
	'!', '@', '#', '$', '%', '^', '&', '*', '(', ')',
	'-', '/', ';', ':', '?', '!', '\'', '"', '=', '[',
	']', '{', '}', '\\', '|', '~', ',', '.'
};
// PW mask slots on pages 64/65/66: DD01..DD09, DD10..DD14
static const uint16_t wifi_pw_mask_slots[WIFI_PW_MASK_SLOT_COUNT] PROGMEM = {
	0xDD01, 0xDD02, 0xDD03, 0xDD04, 0xDD05, 0xDD06, 0xDD07,
	0xDD08, 0xDD09, 0xDD10, 0xDD11, 0xDD12, 0xDD13, 0xDD14
};
// Primary slot order requested: AB01..AB09, AB10, AB11.
static const uint16_t page67_varicon_slots[PAGE67_ICON_SLOT_COUNT] PROGMEM = {
	0xAB01, 0xAB02, 0xAB03, 0xAB04, 0xAB05, 0xAB06,
	0xAB07, 0xAB08, 0xAB09, 0xAB10, 0xAB11
};

#define WIFI_KEY_Q_DEPTH 6
static volatile U08 wifi_key_q_head = 0;
static volatile U08 wifi_key_q_tail = 0;
static volatile U08 wifi_key_q_count = 0;
static U16 wifi_key_q[WIFI_KEY_Q_DEPTH];
static volatile U16 page67_tick = 0;
static volatile U08 page67_anim_running = 0;
static U16 page67_anim_last_tick = 0;
static U08 page67_anim_shift = 0;

// Keep fail-safe, but tolerate short ESP-side blocking windows (HTTP/scan bursts).
#define P63_WIFI_STATUS_NO_SIGNAL_SEC 12U
#define P63_SCAN_BUSY_HOLD_SEC 12U
#define P63_CONNECTED_RESTORE_GRACE_SEC 3U
#define WIFI_CONNECT_ATTEMPT_HOLD_SEC 45U
// Timer0 tick is ~1225Hz with current Init_Timer0() (16MHz/256/(50+1)).
// 612 ticks ~= 500ms.
#define P63_SCAN_ANIM_PERIOD_TICKS 612U
#define P63_SCAN_ICON_SHOW_ID 0U
#define P63_SCAN_ICON_HIDE_ID 1U
#define P63_SCAN_DOT_HIDE_ID 0xFFFFU
#define P63_SCAN_DOT_OFF_ID 0U
#define P63_SCAN_DOT_ON_ID 1U

static inline void SetVarIcon(uint16_t varIconId, uint16_t iconId)
{
	varIconInt(varIconId, iconId);
}

#include "iot_wifi_flow.c"
#include "iot_ota.c"
#include "iot_subscription.c"
#include "iot_uart_bridge.c"
#include "iot_boot.c"

void subscription_mark_page_change(U08 page)
{
	if ((page == 7) || (page == WIFI_PAGE_CONNECTED) || (page == WIFI_PAGE_BOOT_CHECK) ||
	    (page == WIFI_PAGE_SUB_EXPIRED) || (page == WIFI_PAGE_SUB_OFFLINE) ||
	    wifi_is_guard_page(page))
	{
		// BUGFIX: apply isolation immediately on 7/61/63~68/73 page transition.
		subscription_force_hw_isolation();
	}
	else
	{
		g_hw_output_lock = 0;
	}

	if ((page == WIFI_PAGE_CONNECTING) || (page == WIFI_PAGE_REGISTER_WAIT))
	{
		page67_anim_start();
	}
	else
	{
		page67_anim_stop();
	}

	if (page == 63)
	{
		U08 i;
		p63_set_anim(0);
		for (i = 0; i < 5; i++)
		{
			PAGE63_RenderSlot(i, p63_slot_ssid[i], p63_slot_locked(i));
		}
	}
	else if (wifi_is_keyboard_page(page))
	{
		// Keep icon state consistent when page 64/65/66 is entered externally.
		wifi_apply_pw_icon_state();
		wifi_refresh_field_display(WIFI_FIELD_PW);
	}

	if ((page == WIFI_PAGE_BOOT_CHECK) && page68_boot_active &&
	    (page68_current_step < PAGE68_CHECK_COUNT))
	{
		page68_render_cached_step();
	}

	dwin_page_now = page;
	p63_last_page_seen = page;
	if ((dwin_page_now == 57) && sub_active)
	{
		sub_dirty = 1;
	}
}

void subscription_ui_tick(void)
{
	static U08 prev_page = 0xFF;
	U16 wifiKey;

	rkc_flush_to_esp();
	while (wifi_key_queue_pop(&wifiKey))
	{
		handle_key(wifiKey);
	}

	subscription_uart_pump_lines();
	if ((ota_prompt_flags & OTA_PROMPT_FLAG_ACTIVE) && (dwin_page_now != OTA_PAGE_FIRMWARE_UPDATE))
	{
		pageChange(OTA_PAGE_FIRMWARE_UPDATE);
	}

	p63_wifi_boot_tick();
	p63_ui_tick();
	registration_gate_tick();
	energy_local_expired_page_tick();
	subscription_ready_pending_tick();
	page67_anim_update();

	if (prev_page != dwin_page_now)
	{
		prev_page = dwin_page_now;
		if ((dwin_page_now == 57) && sub_active)
		{
			sub_dirty = 1;
		}
	}

	if (sub_dirty && sub_active && (dwin_page_now == 57))
	{
		SUBSCRIPTION_Render57(sub_plan_text, sub_range_text, sub_dday_text, sub_remain_days);
		sub_dirty = 0;
	}
	ota_progress_tick();
	// [NEW FEATURE] Keep page57/page71 energy text/icon widgets refreshed.
	energy_ui_tick();
	if ((ota_prompt_flags & OTA_PROMPT_FLAG_ACTIVE) && (dwin_page_now != OTA_PAGE_FIRMWARE_UPDATE))
	{
		pageChange(OTA_PAGE_FIRMWARE_UPDATE);
	}
}

void IOT_mode_force_hw_isolation(void)
{
	subscription_force_hw_isolation();
}

U08 IOT_mode_isolation_page_active(void)
{
	return subscription_isolation_page_active();
}

U08 IOT_mode_hw_safe_page_active(void)
{
	return subscription_hw_safe_page_active();
}

U08 IOT_mode_run_boot_checks(U08 resumePage)
{
	return page68_run_boot_checks(resumePage);
}

void IOT_mode_reset_boot_state(U08 bootResumePage)
{
	p63_wifi_connected_state = 0xFF;
	p63_wifi_status_seen = 0;
	p63_boot_wifi_phase = 0;
	reg_gate_status_seen = 0;
	reg_gate_registered = 1;
	sub_state_seen = 0;
	sub_state_code = SUB_STATE_UNKNOWN;
	p63_wifi_boot_sec = 0;
	p63_wifi_last_seen_sec = 0;
	p63_wifi_last_no_signal_sec = 0;
	p63_wifi_page_last_sent = dwin_page_now;
	p63_boot_resume_page = bootResumePage;
	p63_boot_waiting_status = 0;
	p63_connected_wait_start_sec = 0;
	subscription_ready_pending_cancel();
	p63_scan_busy = 0;
	p63_scan_busy_until_sec = 0;
	p63_fail_safe_stop = 0;
	energy_reset_sync_state();
	g_energy_local_expired_lock = 0U;
	page68_boot_active = 0;
	page68_current_step = 0xFF;
	page68_text_cache[0] = 0;
	page68_refresh_elapsed_ms = 0;
	ota_boot_prompt_pending = 0;
	ota_boot_current_version[0] = 0;
	ota_boot_target_version[0] = 0;
}

U08 IOT_mode_prepare_boot_resume_page(U08 fallbackPage)
{
	U08 bootResumePage = fallbackPage;

	if (bootResumePage == 0)
	{
		bootResumePage = 1;
	}

	if (eeprom_read_byte(&WIFI_BOOT_PAGE61_ONCE) != 0)
	{
		eeprom_update_byte(&WIFI_BOOT_PAGE61_ONCE, 0);
		eeprom_busy_wait();
		bootResumePage = IOT_MODE_PAGE_CONNECTED;
	}

	IOT_mode_reset_boot_state(bootResumePage);
	return bootResumePage;
}

void IOT_mode_wait_for_runtime_ready(void)
{
	while (subscription_isolation_page_active())
	{
		asm("wdr");
		subscription_ui_tick();
		subscription_hw_isolation_tick();
		_delay_ms(10);
	}
}

void IOT_mode_apply_runtime_hw_gate(void)
{
	if (subscription_hw_safe_page_active())
	{
		subscription_force_hw_isolation();
		return;
	}

	g_hw_output_lock = 0;
	AC_ON;
	TIME_START;
}

U08 IOT_mode_runtime_outputs_enabled(void)
{
	return subscription_hw_safe_page_active() ? 0U : 1U;
}

U08 IOT_mode_runtime_page(U08 startPageValue)
{
	if (startPageValue == 0)
	{
		return 1;
	}
	if (startPageValue == IOT_MODE_PAGE_CONNECTED)
	{
		return IOT_MODE_PAGE_RUNTIME;
	}
	return (U08)(startPageValue + 2U);
}
