/*
* hi-aba.c
*
* Created: 2022-06-28 오후 1:50:26
* Author : impar
*/

#include <avr/io.h>
#include <avr/interrupt.h>
#include <avr/sleep.h>
#include <avr/wdt.h>
#include <util/delay.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <avr/pgmspace.h>
#include "init.h"
#include <avr/eeprom.h>
#include "dwin.h"
#include <math.h>
#include "common_f.h"
#include "crc.h"
#include "tron_mode.h"
#include "hic_mode.h"
#include "brf_mode.h"
#include "ds1307.h"
#include "i2c.h"


EEMEM unsigned char OP_MODE = 0, OP_MODE_CK = 0;
EEMEM unsigned long LIMIT_TIME = 90000, LIMIT_TIME_CK = 0x1000000 - 90000;
EEMEM unsigned char TRON_200_MODE = 0, TRON_200_MODE_CK = 0;

EEMEM unsigned char J16_MODE=0;

EEMEM uint32_t EEP_DUMY[10];
EEMEM uint32_t PW_TIME[40] = {0, 0, 0, 0, 0,
	0, 0, 0, 0, 0,
	0, 0, 0, 0, 0,
	0, 0, 0, 0, 0,
	0, 0, 0, 0, 0,
	0, 0, 0, 0, 0,
	0, 0, 0, 0, 0,
0, 0, 0, 0, 0};
EEMEM uint32_t TT_TIME0 = 0;
EEMEM uint32_t TT_TIME1 = 0;
EEMEM uint32_t TT_TIME2 = 0;
EEMEM unsigned char TT_TIME_CHECKSUM0 = 0;
EEMEM unsigned char TT_TIME_CHECKSUM1 = 0;
EEMEM unsigned char TT_TIME_CHECKSUM2 = 0;
EEMEM unsigned char PW_MAX = 200;
EEMEM unsigned char MW_SENSOR = 1;
EEMEM unsigned char TRIG_MODE = 0;
EEMEM unsigned char COOL_UI = 0;
EEMEM unsigned char SOUND_MODE = 1;
EEMEM unsigned char SOUND_VOLUME=3;

EEMEM unsigned char INIT_BOOT=0;
EEMEM unsigned char WIFI_BOOT_PAGE61_ONCE = 0;

EEMEM uint8_t PW_VALUE[40] = {5, 10, 15, 20, 25,
	30, 35, 40, 45, 50,
	55, 60, 65, 70, 75,
	80, 85, 90, 95, 100,
	105, 110, 115, 120, 125,
	130, 135, 140, 145, 150,
	155, 160, 165, 170, 175,
180, 185, 190, 195, 200};

EEMEM uint8_t PW_VALUE_FACE[40] = {5, 10, 15, 20, 25,
	30, 35, 40, 45, 50,
	55, 60, 65, 70, 75,
	80, 85, 90, 95, 100,
	105, 110, 115, 120, 125,
	130, 135, 140, 145, 150,
	155, 160, 165, 170, 175,
180, 185, 190, 195, 200};

EEMEM uint32_t D_DATE=0x630102;

U08 cool_ui_show = 1;
U08 EM_SOUND	= 1;

U08 pw_data[40];
U08 pw_data_face[40];
U08 f_volt[26],r_volt[26];
U08 MaxPower = 100;
U08 HICmode = 0;
U08 BRFmode = 0;
U08 TRON_200 = 0;
U08 sound_v=0;

U08 RIM_pause=0;
U08 rxbuf[256], parsBuf[10], ckHeader = 0, txBuf[256], eep_s_num = 0;
U08 rx0buf[256], pars0Buf[100], write0Cnt = 0, read0Cnt = 0, pars0Cnt = 0, ck0Header = 0, resCMD = 0, resLen = 0;
U08 writeCnt = 0, readCnt = 0, parsCnt = 0, init_boot = 0;

U08 selectMem = 0, opPage = 0, txWriteCnt = 0, txReadCnt = 0, enc_cnt = 0, checksum = 0;
uint32_t sec_cnt = 0, total_time = 0;
uint32_t opower = 10, settime = 600, otime = 600;
uint32_t totalEnergy = 0, old_totalEnergy = 0;

U08 sFace_pw=10,sBody_pw=10;

U08 old_triger = 0, triger_cnt = 0;

U08 foot_op = 0, eng_show = 0;

uint32_t ckTime = 0, ck_oldtime = 0, ck_hand_time = 0;

uint8_t lsm6d_fail = 0, RIM_CK = 1, RIM_ERR_CNT = 0;
int16_t off_cnt = 0, on_cnt = 0;
int32_t hand_moving = 0, old_hand_moving = 0, diff_moving = 0;

U08 RIM_RQ_cnt = 0;

U16 RIM_temp, RIM_forwar_p, RIM_set_p, RIM_reverse_p;

U08 moving_sensing = 0, eng_show_mode = 0, peltier_op = 1, temp_err = 0;
int16_t ntc_t = 250;
unsigned long lim_time = 0;

uint8_t wf_state = 0, prv_wf_state = 0, fail_temp_ck = 0;

uint16_t wf_cnt = 0, wf_frq = 0, wf_err_cnt = 0,wl_err_cnt = 0,temp_err_cnt=0;
uint8_t eng_emi=0,j16mode=0;

U08 dev_mode = 0, moving_temp_on = 0,body_face=0,startPage=0,passmode=0;
U08 engPass[6]={0x20,0x20,0x20,0x20,0x20,0x20};

U08 TEMP_SIMUL=0;

uint32_t ins_date=990101;
uint32_t cur_date=000101;

U08 time_err=0;

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
// ESP text commands stay well under this limit in current protocol
// (SUB active is the longest form and remains around 43 chars).
// Keep this compact to preserve SRAM headroom on ATmega128A (4KB).
#define SUB_UART_LINE_MAX 56
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
static U08 subscription_resolve_connected_target_page(U08 resumePage, U08 *targetPage);
static void subscription_restore_ready_page(void);
static void energy_clear_subscription_snapshot(void);
static void energy_reset_sync_state(void);
static U08 energy_sync_ready(void);
static U08 energy_subscription_exhausted(void);
static void subscription_ready_pending_arm(void);
static void subscription_ready_pending_cancel(void);
static void subscription_ready_pending_tick(void);

static volatile U08 p63_scan_req = 0;
static volatile U08 p63_prev_req = 0;
static volatile U08 p63_next_req = 0;
static volatile U16 p63_last_key = 0;

// Runtime key queue depth; 12 is sufficient and keeps SRAM usage bounded.
#define RKC_UART_Q_DEPTH 12
static volatile U08 rkc_uart_q_head = 0;
static volatile U08 rkc_uart_q_tail = 0;
static volatile U08 rkc_uart_q_count = 0;
static U08 rkc_uart_q_page[RKC_UART_Q_DEPTH];
static U16 rkc_uart_q_key[RKC_UART_Q_DEPTH];

static volatile U08 p63_rx_state = 0;
static volatile U08 p63_rx_need = 0;
static volatile U08 p63_rx_idx = 0;
static volatile U08 p63_rx_buf[64];

static volatile U08 p63_anim_on = 0;
static U08 p63_anim_visible = 0;
static U08 p63_anim_frame = 0;
static volatile U16 p63_anim_ms = 0;
static U16 p63_anim_last_ms = 0;

static volatile U08 p63_wifi_connected_state = 0xFF;
static volatile U08 p63_wifi_status_seen = 0;
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
#define PAGE68_STEP_MIN_MS 100
#define PAGE68_REG_STATUS_WAIT_MS 3200
#define PAGE68_SUB_STATUS_WAIT_MS 3200
#define PAGE68_ENERGY_STATUS_WAIT_MS 3200
#define PAGE68_FAIL_PAGE 10
#define PAGE68_ERROR_VP 0x1200
#define PAGE68_ERROR_TEXT_LEN 16
// DGUS VAR ICON generally expects selector index (0..N), not absolute icon ID.
// Page68 object 0x0C0A is expected to map:
// index 0..9 -> icon ID 482..491
#define PAGE68_ICON_INDEX_BASE 0
// Timer0 ISR frequency ~=1225Hz, 368 ticks ~= 300ms.
#define PAGE67_ANIM_PERIOD_TICKS 368

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

#define WIFI_KEY_Q_DEPTH 8
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
// Timer0 tick is ~1225Hz with current Init_Timer0() (16MHz/256/(50+1)).
// 612 ticks ~= 500ms.
#define P63_SCAN_ANIM_PERIOD_TICKS 612U
#define P63_SCAN_ICON_SHOW_ID 0U
#define P63_SCAN_ICON_HIDE_ID 1U
#define P63_SCAN_DOT_HIDE_ID 0xFFFFU
#define P63_SCAN_DOT_OFF_ID 0U
#define P63_SCAN_DOT_ON_ID 1U

static U08 wifi_is_keyboard_page(U08 page)
{
	return (page == WIFI_PAGE_UPPER) || (page == WIFI_PAGE_LOWER) || (page == WIFI_PAGE_SYMBOL);
}

static int8_t wifi_key_decimal_index(U16 key, U08 highByte, U08 maxOrdinal)
{
	U08 low;
	U08 tens;
	U08 ones;
	U08 ord;

	if (((U08)(key >> 8)) != highByte)
	{
		return -1;
	}

	low = (U08)key;
	tens = (U08)(low >> 4);
	ones = (U08)(low & 0x0F);
	if (ones > 9)
	{
		return -1;
	}

	ord = (U08)(tens * 10U + ones);
	if ((ord < 1U) || (ord > maxOrdinal))
	{
		return -1;
	}

	return (int8_t)(ord - 1U);
}

static U08 wifi_is_local_input_key(U08 page, U16 key)
{
	if ((key == 0x0000) || (key == 0x4444) || (key == 0x4101) || (key == 0x4102))
	{
		return 0;
	}

	if ((page == WIFI_PAGE_LIST) && (key >= WIFI_KEY_P63_SLOT1) && (key <= WIFI_KEY_P63_SLOT5))
	{
		return 1;
	}

	if ((page == OTA_PAGE_FIRMWARE_UPDATE) && (ota_prompt_flags & OTA_PROMPT_FLAG_ACTIVE) &&
	    ((key == OTA_KEY_UPDATE_ACCEPT) || (key == OTA_KEY_UPDATE_SKIP)))
	{
		return 1;
	}

	if (!wifi_is_keyboard_page(page))
	{
		return 0;
	}

	if ((key == WIFI_KEY_FOCUS_SSID) || (key == WIFI_KEY_FOCUS_PW))
	{
		return 1;
	}
	if (((key >= WIFI_KEY_NUM_1) && (key <= WIFI_KEY_NUM_9)) ||
	    (key == WIFI_KEY_NUM_0) ||
	    (key == WIFI_KEY_NUM_MINUS) ||
	    (key == WIFI_KEY_NUM_EQUAL))
	{
		return 1;
	}
	if (wifi_key_decimal_index(key, 0xAA, 26) >= 0)
	{
		return 1;
	}
	if (wifi_key_decimal_index(key, 0xBB, 26) >= 0)
	{
		return 1;
	}
	if (wifi_key_decimal_index(key, 0xCC, 28) >= 0)
	{
		return 1;
	}
	if (key == WIFI_KEY_PW_ICON_TOGGLE)
	{
		return 1;
	}
	if ((key >= WIFI_KEY_BACKSPACE) && (key <= WIFI_KEY_SYMBOL))
	{
		return 1;
	}

	return 0;
}

static void wifi_key_queue_push(U16 key)
{
	U08 nextHead;

	if (key == 0x0000)
	{
		return;
	}

	nextHead = (U08)((wifi_key_q_head + 1) % WIFI_KEY_Q_DEPTH);
	if (nextHead == wifi_key_q_tail)
	{
		wifi_key_q_tail = (U08)((wifi_key_q_tail + 1) % WIFI_KEY_Q_DEPTH);
		if (wifi_key_q_count > 0)
		{
			wifi_key_q_count--;
		}
	}

	wifi_key_q[wifi_key_q_head] = key;
	wifi_key_q_head = nextHead;
	if (wifi_key_q_count < WIFI_KEY_Q_DEPTH)
	{
		wifi_key_q_count++;
	}
}

static U08 wifi_key_queue_pop(U16 *key)
{
	U08 hasItem = 0;

	if (key == 0)
	{
		return 0;
	}

	cli();
	if (wifi_key_q_count > 0)
	{
		*key = wifi_key_q[wifi_key_q_tail];
		wifi_key_q_tail = (U08)((wifi_key_q_tail + 1) % WIFI_KEY_Q_DEPTH);
		wifi_key_q_count--;
		hasItem = 1;
	}
	sei();

	return hasItem;
}

static void wifi_copy_field(char *dst, uint8_t dstSz, const char *src)
{
	uint8_t i = 0;

	if ((dst == 0) || (dstSz == 0))
	{
		return;
	}

	dst[0] = 0;
	if (src == 0)
	{
		return;
	}

	while ((src[i] != 0) && (i + 1 < dstSz))
	{
		char c = src[i];
		if ((c == '|') || (c == '\r') || (c == '\n'))
		{
			break;
		}
		if ((c >= 0x20) && (c <= 0x7E))
		{
			dst[i] = c;
		}
		else
		{
			dst[i] = ' ';
		}
		i++;
	}
	dst[i] = 0;
}

static char wifi_map_char_P(const char *map, uint8_t idx)
{
	return (char)pgm_read_byte(map + idx);
}

static void p63_slot_clear_all(void)
{
	memset(p63_slot_ssid, 0, sizeof(p63_slot_ssid));
	p63_slot_lock_mask = 0;
}

static void p63_slot_set(U08 slot, const char *ssid, U08 locked)
{
	uint8_t bit;

	if (slot >= 5)
	{
		return;
	}
	wifi_copy_field(p63_slot_ssid[slot], sizeof(p63_slot_ssid[slot]), ssid);
	bit = (uint8_t)(1U << slot);
	if (locked)
	{
		p63_slot_lock_mask |= bit;
	}
	else
	{
		p63_slot_lock_mask &= (uint8_t)~bit;
	}
}

static U08 p63_slot_locked(U08 slot)
{
	if (slot >= 5)
	{
		return 0;
	}
	return (p63_slot_lock_mask & (uint8_t)(1U << slot)) ? 1U : 0U;
}

static inline void SetVarIcon(uint16_t varIconId, uint16_t iconId)
{
	varIconInt(varIconId, iconId);
}

static void page67_anim_apply(U08 shift)
{
	U08 slot;
	U08 s = (U08)(shift % PAGE67_ICON_SLOT_COUNT);

	for (slot = 0; slot < PAGE67_ICON_SLOT_COUNT; slot++)
	{
		uint16_t vp = (uint16_t)pgm_read_word(&page67_varicon_slots[slot]);
		// Requested order:
		// shift=0: 471..481
		// shift=1: 472..481,471
		// shift=2: 473..481,471,472
		U08 iconOffset = (U08)((slot + s) % PAGE67_ICON_SLOT_COUNT);
		/*
		 * Page67 VAR ICON objects are configured in DWIN as:
		 * value range 0..10 -> icon ID range 471..481.
		 * So ATmega must write index value (0..10), not absolute 471..481.
		 */
		SetVarIcon(vp, (uint16_t)iconOffset);
	}
}

void page67_anim_init(void)
{
	page67_anim_shift = 0;
	page67_anim_apply(0);
}

static void page67_anim_start(void)
{
	cli();
	page67_tick = 0;
	sei();
	page67_anim_last_tick = 0;
	page67_anim_shift = 0;
	page67_anim_running = 1;
	page67_anim_init();
}

void page67_anim_stop(void)
{
	page67_anim_running = 0;
}

static void page67_anim_update(void)
{
	U16 nowTick;

	if (!page67_anim_running)
	{
		return;
	}

	cli();
	nowTick = page67_tick;
	sei();

	if ((U16)(nowTick - page67_anim_last_tick) < PAGE67_ANIM_PERIOD_TICKS)
	{
		return;
	}

	page67_anim_last_tick = nowTick;
	page67_anim_shift = (U08)((page67_anim_shift + 1U) % PAGE67_ICON_SLOT_COUNT);
	page67_anim_apply(page67_anim_shift);
}

static U08 wifi_is_guard_page(U08 page)
{
	if ((page >= WIFI_PAGE_LIST) && (page <= WIFI_PAGE_CONNECTING))
	{
		return 1;
	}
	return (page == WIFI_PAGE_REGISTER_WAIT) ? 1U : 0U;
}

static uint32_t p63_now_sec(void)
{
	uint32_t sec;
	cli();
	sec = ckTime;
	sei();
	return sec;
}

static inline void rkc_queue_push(U08 page, U16 key)
{
	U08 nextHead;

	if (key == 0x0000)
	{
		return;
	}

	nextHead = (U08)((rkc_uart_q_head + 1) % RKC_UART_Q_DEPTH);
	if (nextHead == rkc_uart_q_tail)
	{
		rkc_uart_q_tail = (U08)((rkc_uart_q_tail + 1) % RKC_UART_Q_DEPTH);
		if (rkc_uart_q_count > 0)
		{
			rkc_uart_q_count--;
		}
	}

	rkc_uart_q_page[rkc_uart_q_head] = page;
	rkc_uart_q_key[rkc_uart_q_head] = key;
	rkc_uart_q_head = nextHead;
	if (rkc_uart_q_count < RKC_UART_Q_DEPTH)
	{
		rkc_uart_q_count++;
	}
}

static void rkc_flush_to_esp(void)
{
	U08 hasItem;
	U08 page;
	U16 key;
	char line[28];

	for (;;)
	{
		hasItem = 0;
		page = 0;
		key = 0;

		cli();
		if (rkc_uart_q_count > 0)
		{
			page = rkc_uart_q_page[rkc_uart_q_tail];
			key = rkc_uart_q_key[rkc_uart_q_tail];
			rkc_uart_q_tail = (U08)((rkc_uart_q_tail + 1) % RKC_UART_Q_DEPTH);
			rkc_uart_q_count--;
			hasItem = 1;
		}
		sei();

		if (!hasItem)
		{
			break;
		}

		snprintf(line, sizeof(line), "@RKC|%u|%04X\n", (unsigned int)page, (unsigned int)key);
		UART1_TX_STR(line);
	}
}

static void wifi_apply_pw_icon_state(void)
{
	SetVarIcon(WIFI_PW_ICON_VP, wifi_pw_masked ? WIFI_PW_ICON_VAL_MASKED : WIFI_PW_ICON_VAL_VISIBLE);
}

static void wifi_apply_pw_mask_slots(uint8_t visibleCount)
{
	uint8_t i;
	uint16_t vp;

	if (visibleCount > WIFI_PW_MASK_SLOT_COUNT)
	{
		visibleCount = WIFI_PW_MASK_SLOT_COUNT;
	}

	for (i = 0; i < WIFI_PW_MASK_SLOT_COUNT; i++)
	{
		vp = (uint16_t)pgm_read_word(&wifi_pw_mask_slots[i]);
		SetVarIcon(vp, (i < visibleCount) ? WIFI_PW_MASK_SLOT_SHOW_VAL : WIFI_PW_MASK_SLOT_HIDE_VAL);
	}
}

static void wifi_refresh_field_display(U08 field)
{
	if (field == WIFI_FIELD_SSID)
	{
		dwin_write_text(WIFI_TEXT_VP_SSID, ssid_buf, WIFI_TEXT_DISPLAY_LEN);
	}
	else
	{
		if (wifi_pw_masked)
		{
			wifi_apply_pw_mask_slots(pw_len);
			dwin_write_text(WIFI_TEXT_VP_PW, "", WIFI_TEXT_DISPLAY_LEN);
		}
		else
		{
			wifi_apply_pw_mask_slots(0);
			dwin_write_text(WIFI_TEXT_VP_PW, pw_buf, WIFI_TEXT_DISPLAY_LEN);
		}
	}
}

static void wifi_set_focus(U08 field)
{
	// DWIN returns 0x0B00/0x0B01 on field touch. ATmega keeps authoritative focus state.
	active_field = (field == WIFI_FIELD_SSID) ? WIFI_FIELD_SSID : WIFI_FIELD_PW;
}

static void wifi_append_char(char c)
{
	if (active_field == WIFI_FIELD_SSID)
	{
		if (ssid_len < (uint8_t)(sizeof(ssid_buf) - 1))
		{
			ssid_buf[ssid_len++] = c;
			ssid_buf[ssid_len] = 0;
			wifi_refresh_field_display(WIFI_FIELD_SSID);
		}
	}
	else
	{
		if (pw_len < (uint8_t)(sizeof(pw_buf) - 1))
		{
			pw_buf[pw_len++] = c;
			pw_buf[pw_len] = 0;
			wifi_refresh_field_display(WIFI_FIELD_PW);
		}
	}
}

static void wifi_backspace_active(void)
{
	if (active_field == WIFI_FIELD_SSID)
	{
		if (ssid_len > 0)
		{
			ssid_len--;
			ssid_buf[ssid_len] = 0;
			wifi_refresh_field_display(WIFI_FIELD_SSID);
		}
	}
	else
	{
		if (pw_len > 0)
		{
			pw_len--;
			pw_buf[pw_len] = 0;
			wifi_refresh_field_display(WIFI_FIELD_PW);
		}
	}
}

static void wifi_load_selected_ssid(U08 slot)
{
	if ((slot >= 5) || (p63_slot_ssid[slot][0] == 0))
	{
		return;
	}

	// Page63 button-to-SSID VP mapping is fixed:
	// 0x4111->0x4410, 0x4112->0x4530, 0x4113->0x4650, 0x4114->0x4770, 0x4115->0x4890
	wifi_copy_field(ssid_buf, sizeof(ssid_buf), p63_slot_ssid[slot]);
	ssid_len = (uint8_t)strlen(ssid_buf);

	// New SSID selection starts with an empty PW field.
	pw_buf[0] = 0;
	pw_len = 0;
	wifi_pw_masked = 1;
	wifi_apply_pw_icon_state();

	wifi_refresh_field_display(WIFI_FIELD_SSID);
	wifi_refresh_field_display(WIFI_FIELD_PW);

	active_field = WIFI_FIELD_PW;
	current_page = WIFI_PAGE_LOWER;
	dwin_switch_page(WIFI_PAGE_LOWER);
}

void send_wifi_credentials(void)
{
	uint8_t i = 0;
	char line[160];

	// 1) Reliable framed commands for ESP parser.
	snprintf(line, sizeof(line), "@WIFI|S|%s\n", ssid_buf);
	UART1_TX_STR(line);
	while (line[i] != 0)
	{
		TX0_char((unsigned char)line[i++]);
	}

	i = 0;
	snprintf(line, sizeof(line), "@WIFI|P|%s\n", pw_buf);
	UART1_TX_STR(line);
	while (line[i] != 0)
	{
		TX0_char((unsigned char)line[i++]);
	}

	UART1_TX_STR("@WIFI|G\n");
	TX0_char('@'); TX0_char('W'); TX0_char('I'); TX0_char('F'); TX0_char('I');
	TX0_char('|'); TX0_char('G'); TX0_char('\n');

	// 2) Legacy credential lines kept for backward compatibility / debug.
	i = 0;
	snprintf(line, sizeof(line), "SSID:%s\r\nPW:%s\r\n", ssid_buf, pw_buf);
	UART1_TX_STR(line);
	while (line[i] != 0)
	{
		TX0_char((unsigned char)line[i++]);
	}
}

static void wifi_mark_page61_boot_once(void)
{
	eeprom_update_byte(&WIFI_BOOT_PAGE61_ONCE, 1);
	eeprom_busy_wait();
}

static void wifi_reboot_for_connected_state(void)
{
	wifi_mark_page61_boot_once();
	asm("jmp 0");
}

static void wifi_apply_connect_fail_ui(void)
{
	page67_anim_stop();
	dwin_switch_page(WIFI_PAGE_LOWER);
	dwin_write_text(WIFI_FAIL_TEXT_VP, "Device connection failed!", WIFI_FAIL_TEXT_LEN);
}

static void wifi_apply_connect_result(U08 ok)
{
	if (ok)
	{
		wifi_reboot_for_connected_state();
		return;
	}

	wifi_apply_connect_fail_ui();
}

static uint32_t ota_now_sec(void)
{
	uint32_t sec;
	cli();
	sec = ckTime;
	sei();
	return sec;
}

static void ota_progress_write_text(const char *text)
{
	char line[OTA_PROGRESS_TEXT_LEN + 1];
	wifi_copy_field(line, sizeof(line), text);
	dwin_write_text(OTA_TEXT_VP_PROGRESS, line, OTA_PROGRESS_TEXT_LEN);
}

static void ota_progress_reset(void)
{
	ota_progress_phase = OTA_PROGRESS_PHASE_NONE;
	ota_progress_index = 0;
	ota_progress_last_sec = ota_now_sec();
	SetVarIcon(OTA_PROGRESS_VARICON_VP, OTA_PROGRESS_ICON_HIDE_VAL);
}

static void ota_progress_start_download(void)
{
	ota_progress_phase = OTA_PROGRESS_PHASE_DOWNLOAD;
	ota_progress_index = 0;
	ota_progress_last_sec = ota_now_sec();
	ota_progress_write_text("Downloading. . .");
	SetVarIcon(OTA_PROGRESS_VARICON_VP, 0);
}

static void ota_progress_start_update(void)
{
	ota_progress_phase = OTA_PROGRESS_PHASE_UPDATE;
	ota_progress_index = 0;
	ota_progress_last_sec = ota_now_sec();
	ota_progress_write_text("Firmware Update. . .");
	SetVarIcon(OTA_PROGRESS_VARICON_VP, 0);
}

static void ota_progress_enter_reboot(void)
{
	ota_progress_phase = OTA_PROGRESS_PHASE_REBOOT;
	ota_progress_index = OTA_PROGRESS_ICON_MAX;
	ota_progress_last_sec = ota_now_sec();
	SetVarIcon(OTA_PROGRESS_VARICON_VP, OTA_PROGRESS_ICON_MAX);
	ota_progress_write_text("Rebooting. . .");
}

static void ota_progress_tick(void)
{
	uint32_t nowSec;

	if ((ota_progress_phase != OTA_PROGRESS_PHASE_DOWNLOAD) &&
	    (ota_progress_phase != OTA_PROGRESS_PHASE_UPDATE))
	{
		return;
	}

	if (dwin_page_now != OTA_PAGE_FIRMWARE_UPDATE)
	{
		return;
	}

	nowSec = ota_now_sec();
	if (nowSec == ota_progress_last_sec)
	{
		return;
	}
	ota_progress_last_sec = nowSec;

	if (ota_progress_index < OTA_PROGRESS_ICON_MAX)
	{
		ota_progress_index++;
		SetVarIcon(OTA_PROGRESS_VARICON_VP, ota_progress_index);
		if ((ota_progress_phase == OTA_PROGRESS_PHASE_UPDATE) && (ota_progress_index >= OTA_PROGRESS_ICON_MAX))
		{
			ota_progress_enter_reboot();
		}
		return;
	}

	if (ota_progress_phase == OTA_PROGRESS_PHASE_DOWNLOAD)
	{
		ota_progress_start_update();
		return;
	}

	if (ota_progress_phase == OTA_PROGRESS_PHASE_UPDATE)
	{
		ota_progress_enter_reboot();
		return;
	}
}

static void ota_uart_publish_decision(U08 accept)
{
	char line[20];
	snprintf(line, sizeof(line), "@OTA|DEC|%u\n", (unsigned int)(accept ? 1U : 0U));
	UART1_TX_STR(line);
	if (esp_bridge_uart0_seen)
	{
		UART0_TX_STR(line);
	}
}

static void ota_enter_prompt(const char *currentVersion, const char *targetVersion)
{
	char currentText[OTA_VERSION_TEXT_LEN + 1];
	char targetText[OTA_VERSION_TEXT_LEN + 1];

	if (ota_prompt_flags & OTA_PROMPT_FLAG_ACTIVE)
	{
		return;
	}

	if (ota_prompt_flags & (OTA_PROMPT_FLAG_SHOWN | OTA_PROMPT_FLAG_DECIDED))
	{
		ota_uart_publish_decision(0U);
		return;
	}

	ota_progress_reset();

	if ((dwin_page_now != 0) && (dwin_page_now != 0xFF))
	{
		ota_prev_page = dwin_page_now;
	}
	else if (startPage != 0)
	{
		ota_prev_page = startPage;
	}
	else
	{
		ota_prev_page = WIFI_PAGE_CONNECTED;
	}

	wifi_copy_field(currentText, sizeof(currentText), currentVersion);
	wifi_copy_field(targetText, sizeof(targetText), targetVersion);
	if (currentText[0] == 0)
	{
		strcpy(currentText, "-");
	}
	if (targetText[0] == 0)
	{
		strcpy(targetText, "-");
	}

	if (opPage & 0x02)
	{
		setStandby();
		opPage = 1;
	}

	pageChange(OTA_PAGE_FIRMWARE_UPDATE);
	dwin_write_text(OTA_TEXT_VP_CURRENT_VERSION, currentText, OTA_VERSION_TEXT_LEN);
	dwin_write_text(OTA_TEXT_VP_TARGET_VERSION, targetText, OTA_VERSION_TEXT_LEN);
	ota_progress_write_text("");
	SetVarIcon(OTA_PROGRESS_VARICON_VP, OTA_PROGRESS_ICON_HIDE_VAL);

	ota_prompt_flags |= (OTA_PROMPT_FLAG_ACTIVE | OTA_PROMPT_FLAG_SHOWN);
}

static void ota_finish_prompt(U08 accept)
{
	if ((ota_prompt_flags & OTA_PROMPT_FLAG_ACTIVE) == 0)
	{
		return;
	}

	ota_prompt_flags &= (U08)~OTA_PROMPT_FLAG_ACTIVE;
	ota_prompt_flags |= OTA_PROMPT_FLAG_DECIDED;
	ota_uart_publish_decision(accept ? 1U : 0U);
	if (accept)
	{
		ota_progress_start_download();
	}
	else
	{
		ota_progress_reset();
	}

	if (!accept)
	{
		if ((ota_prev_page != 0) && (ota_prev_page != OTA_PAGE_FIRMWARE_UPDATE))
		{
			pageChange(ota_prev_page);
		}
	}
}

void handle_key(uint16_t key_code)
{
	U08 pageNow = dwin_page_now;
	int8_t key_idx;
	char append_ch = 0;

	if ((pageNow == OTA_PAGE_FIRMWARE_UPDATE) && (ota_prompt_flags & OTA_PROMPT_FLAG_ACTIVE))
	{
		if (key_code == OTA_KEY_UPDATE_ACCEPT)
		{
			ota_finish_prompt(1U);
			return;
		}
		if (key_code == OTA_KEY_UPDATE_SKIP)
		{
			ota_finish_prompt(0U);
			return;
		}
		return;
	}

	if (wifi_is_keyboard_page(pageNow))
	{
		current_page = pageNow;
	}

	// Page 63 SSID select keys: load full SSID, default focus to PW, then move to page 65.
	if ((pageNow == WIFI_PAGE_LIST) && (key_code >= WIFI_KEY_P63_SLOT1) && (key_code <= WIFI_KEY_P63_SLOT5))
	{
		wifi_load_selected_ssid((U08)(key_code - WIFI_KEY_P63_SLOT1));
		return;
	}

	if (!wifi_is_keyboard_page(pageNow))
	{
		return;
	}

	// Focus keys: 0x0B00 selects SSID field, 0x0B01 selects PW field.
	if (key_code == WIFI_KEY_FOCUS_SSID)
	{
		wifi_set_focus(WIFI_FIELD_SSID);
		return;
	}
	if (key_code == WIFI_KEY_FOCUS_PW)
	{
		wifi_set_focus(WIFI_FIELD_PW);
		return;
	}
	if (key_code == WIFI_KEY_PW_ICON_TOGGLE)
	{
		wifi_pw_masked = (wifi_pw_masked == 0U) ? 1U : 0U;
		wifi_apply_pw_icon_state();
		wifi_refresh_field_display(WIFI_FIELD_PW);
		return;
	}

	// Page 65 lowercase key block: 0xBB01~0xBB26 map to qwerty...m.
	key_idx = wifi_key_decimal_index(key_code, 0xBB, 26);
	if ((current_page == WIFI_PAGE_LOWER) && (key_idx >= 0))
	{
		append_ch = wifi_map_char_P(wifi_lower_map, (uint8_t)key_idx);
		wifi_append_char(append_ch);
		return;
	}

	// Page 64 uppercase key block: 0xAA01~0xAA26 map to QWERTY...M.
	key_idx = wifi_key_decimal_index(key_code, 0xAA, 26);
	if ((current_page == WIFI_PAGE_UPPER) && (key_idx >= 0))
	{
		append_ch = wifi_map_char_P(wifi_upper_map, (uint8_t)key_idx);
		wifi_append_char(append_ch);
		return;
	}

	// Page 66 symbol key block: 0xCC01~0xCC28 map to symbol list order.
	key_idx = wifi_key_decimal_index(key_code, 0xCC, 28);
	if ((current_page == WIFI_PAGE_SYMBOL) && (key_idx >= 0))
	{
		append_ch = wifi_map_char_P(wifi_symbol_map, (uint8_t)key_idx);
		wifi_append_char(append_ch);
		return;
	}

	// Number/symbol row block (common on pages 64/65/66): 0x0A01~0x0A12.
	if ((key_code >= WIFI_KEY_NUM_1) && (key_code <= WIFI_KEY_NUM_9))
	{
		append_ch = (char)('1' + (key_code - WIFI_KEY_NUM_1));
		wifi_append_char(append_ch);
		return;
	}
	if (key_code == WIFI_KEY_NUM_0)
	{
		wifi_append_char('0');
		return;
	}
	if (key_code == WIFI_KEY_NUM_MINUS)
	{
		wifi_append_char('-');
		return;
	}
	if (key_code == WIFI_KEY_NUM_EQUAL)
	{
		wifi_append_char('=');
		return;
	}

	// Backspace block: remove one character from active field.
	if (key_code == WIFI_KEY_BACKSPACE)
	{
		wifi_backspace_active();
		return;
	}

	// Return block: keyboard pages return to WiFi list page 63.
	if (key_code == WIFI_KEY_RETURN)
	{
		dwin_switch_page(WIFI_PAGE_LIST);
		return;
	}

	// Shift block: 65->64, 64->65, 66->65 while keeping buffers/focus.
	if (key_code == WIFI_KEY_SHIFT)
	{
		if (current_page == WIFI_PAGE_LOWER)
		{
			current_page = WIFI_PAGE_UPPER;
		}
		else
		{
			current_page = WIFI_PAGE_LOWER;
		}
		dwin_switch_page(current_page);
		return;
	}

	// Go block: send Wi-Fi credentials to ESP32 and move to page 67.
	if (key_code == WIFI_KEY_GO)
	{
		send_wifi_credentials();
		// Start animation immediately from key path as an extra safety path.
		page67_anim_start();
		dwin_switch_page(WIFI_PAGE_CONNECTING);
		return;
	}

	// Space block: append space to the active field.
	if (key_code == WIFI_KEY_SPACE)
	{
		wifi_append_char(' ');
		return;
	}

	// Symbol block: move to page 66 while preserving active field and buffers.
	if (key_code == WIFI_KEY_SYMBOL)
	{
		current_page = WIFI_PAGE_SYMBOL;
		dwin_switch_page(WIFI_PAGE_SYMBOL);
		return;
	}
}

static void p63_isr_note_key(U16 key)
{
	U08 pageNow = dwin_page_now;
	U08 localWifiKey = 0;

	if (key == 0x0000)
	{
		if (pageNow == 63)
		{
			p63_last_key = 0;
		}
		return;
	}

	if (wifi_is_local_input_key(pageNow, key))
	{
		wifi_key_queue_push(key);
		localWifiKey = 1;
	}

	if (!localWifiKey)
	{
		rkc_queue_push(pageNow, key);
	}

	if (pageNow != 63)
	{
		return;
	}

	// Some DWIN projects do not emit a key-release frame (0x0000).
	// Keep repeated key presses accepted even when key code is identical.
	(void)(key == p63_last_key);
	p63_last_key = key;

	if (key == 0x4444)
	{
		p63_scan_req = 1;
	}
	else if (key == 0x4101)
	{
		p63_prev_req = 1;
	}
	else if (key == 0x4102)
	{
		p63_next_req = 1;
	}
}

static void p63_isr_handle_frame(volatile U08 *buf, U08 need)
{
	U08 plen;
	U16 crc_calc;
	U16 crc_rx;
	U16 addr;
	U16 key;

	if (need < 4)
	{
		return;
	}

	plen = need - 2;
	crc_calc = update_crc((unsigned char *)buf, plen);
	crc_rx = ((U16)buf[plen] << 8) | (U16)buf[plen + 1];
	if (crc_calc != crc_rx)
	{
		return;
	}

	if ((plen < 6) || (buf[0] != 0x83))
	{
		return;
	}

	addr = ((U16)buf[1] << 8) | (U16)buf[2];
	if (addr != 0x0000)
	{
		return;
	}

	if (buf[3] >= 1)
	{
		key = ((U16)buf[plen - 2] << 8) | (U16)buf[plen - 1];
	}
	else
	{
		key = ((U16)buf[4] << 8) | (U16)buf[5];
	}
	p63_isr_note_key(key);
}

static void p63_isr_feed(U08 b)
{
	switch (p63_rx_state)
	{
		case 0:
		if (b == 0x5A)
		{
			p63_rx_state = 1;
		}
		break;

		case 1:
		if (b == 0xA5)
		{
			p63_rx_state = 2;
		}
		else if (b != 0x5A)
		{
			p63_rx_state = 0;
		}
		break;

		case 2:
		p63_rx_need = b;
		p63_rx_idx = 0;
		if ((p63_rx_need < 2) || (p63_rx_need > sizeof(p63_rx_buf)))
		{
			p63_rx_state = 0;
		}
		else
		{
			p63_rx_state = 3;
		}
		break;

		case 3:
		p63_rx_buf[p63_rx_idx++] = b;
		if (p63_rx_idx >= p63_rx_need)
		{
			p63_isr_handle_frame(p63_rx_buf, p63_rx_need);
			p63_rx_state = 0;
			p63_rx_idx = 0;
			p63_rx_need = 0;
		}
		break;

		default:
		p63_rx_state = 0;
		p63_rx_idx = 0;
		p63_rx_need = 0;
		break;
	}
}

static void p63_send_key_to_esp(U16 key)
{
	char line[20];
	snprintf(line, sizeof(line), "@P63|K|%04X\n", (unsigned int)key);
	UART1_TX_STR(line);
}

static void p63_scan_icons_hide(void)
{
	varIconInt(0x3000, P63_SCAN_ICON_HIDE_ID);
	varIconInt(0x3001, P63_SCAN_DOT_HIDE_ID);
	varIconInt(0x3002, P63_SCAN_DOT_HIDE_ID);
	varIconInt(0x3003, P63_SCAN_DOT_HIDE_ID);
	p63_anim_visible = 0;
	p63_anim_frame = 0;
	p63_anim_ms = 0;
	p63_anim_last_ms = 0;
}

static void p63_scan_icons_frame(U08 frame)
{
	U16 d1 = 0;
	U16 d2 = 0;
	U16 d3 = 0;
	U08 f = frame % 3;

	if (!p63_anim_visible)
	{
		varIconInt(0x3000, P63_SCAN_ICON_SHOW_ID);
		p63_anim_visible = 1;
	}

	if (f == 0)
	{
		d1 = P63_SCAN_DOT_ON_ID; d2 = P63_SCAN_DOT_OFF_ID; d3 = P63_SCAN_DOT_OFF_ID;
	}
	else if (f == 1)
	{
		d1 = P63_SCAN_DOT_OFF_ID; d2 = P63_SCAN_DOT_ON_ID; d3 = P63_SCAN_DOT_OFF_ID;
	}
	else
	{
		d1 = P63_SCAN_DOT_OFF_ID; d2 = P63_SCAN_DOT_OFF_ID; d3 = P63_SCAN_DOT_ON_ID;
	}

	varIconInt(0x3001, d1);
	varIconInt(0x3002, d2);
	varIconInt(0x3003, d3);
}

static void p63_set_anim(U08 on)
{
	if (on)
	{
		p63_anim_on = 1;
		cli();
		p63_anim_ms = 0;
		p63_anim_frame = 0;
		sei();
		p63_anim_last_ms = 0;
		p63_scan_icons_frame(0);
	}
	else
	{
		p63_anim_on = 0;
		p63_scan_icons_hide();
	}
}

static void p63_enter_fail_safe(void)
{
	if ((dwin_page_now != 0) && (dwin_page_now != 0xFF))
	{
		p63_page_before_fail = dwin_page_now;
	}

	p63_fail_safe_stop = 1;
	p63_scan_req = 0;
	p63_prev_req = 0;
	p63_next_req = 0;
	p63_last_key = 0;
	cli();
	wifi_key_q_head = 0;
	wifi_key_q_tail = 0;
	wifi_key_q_count = 0;
	sei();
	page67_anim_stop();
	p63_set_anim(0);
	p63_slot_clear_all();
	PAGE63_ClearAll();
	// Recovery behavior: keep current UI page visible.
	// Do not force page 0 (black screen) on transient UART/status issues.
	p63_wifi_page_last_sent = dwin_page_now;
}

static void p63_exit_fail_safe(void)
{
	p63_fail_safe_stop = 0;
}

static void p63_wifi_page_apply(U08 connected)
{
	if (dwin_page_now == WIFI_PAGE_BOOT_CHECK)
	{
		// Keep page68 visible until boot checks are explicitly finished.
		p63_wifi_page_last_sent = dwin_page_now;
		return;
	}

	if (connected)
	{
		U08 restore = p63_boot_resume_page;
		U08 targetPage = restore;
		p63_exit_fail_safe();
		// Boot race fix: if page68 had to fall back to page63 before first status frame,
		// restore the intended runtime page only after registration/subscription gates resolve.
		if (p63_boot_waiting_status && (dwin_page_now == WIFI_PAGE_LIST))
		{
			if ((restore == 0) || (restore == 0xFF))
			{
				restore = (startPage != 0) ? startPage : WIFI_PAGE_CONNECTED;
			}
			if (subscription_resolve_connected_target_page(restore, &targetPage))
			{
				if ((targetPage != WIFI_PAGE_LIST) && (dwin_page_now != targetPage))
				{
					pageChange(targetPage);
				}
				p63_wifi_page_last_sent = targetPage;
				p63_boot_waiting_status = 0;
			}
			else
			{
				p63_wifi_page_last_sent = dwin_page_now;
			}
			return;
		}
		if (dwin_page_now == 0)
		{
			restore = p63_page_before_fail;
			if ((restore == 0) || (restore == 0xFF))
			{
				restore = (startPage != 0) ? startPage : 63;
			}
			if (restore != 0)
			{
				pageChange(restore);
			}
		}
		p63_wifi_page_last_sent = dwin_page_now;
	}
	else
	{
		if ((dwin_page_now == WIFI_PAGE_SUB_EXPIRED) || (dwin_page_now == WIFI_PAGE_SUB_OFFLINE))
		{
			p63_wifi_page_last_sent = dwin_page_now;
			return;
		}
		// ESP is alive but Wi-Fi is not connected: show page63 and allow scan flow.
		p63_exit_fail_safe();
		if (p63_wifi_page_last_sent != 63)
		{
			pageChange(63);
			p63_wifi_page_last_sent = 63;
		}
	}
}

static void p63_wifi_status_set(U08 connected)
{
	p63_wifi_connected_state = connected ? 1U : 0U;
	p63_wifi_status_seen = 1;
	p63_wifi_last_seen_sec = p63_now_sec();
	p63_wifi_boot_sec = p63_now_sec();
	// Any heartbeat/status frame means ESP link is alive; clear scan-busy hold.
	p63_scan_busy = 0;
	p63_scan_busy_until_sec = 0;
	p63_wifi_page_apply(connected);
}

static void p63_wifi_boot_tick(void)
{
	uint32_t nowSec = p63_now_sec();

	// Recovery guard: some boot sequences can briefly report page 0.
	// After first-boot flow is finished, immediately restore to startPage.
	if ((dwin_page_now == 0) && (init_boot != 0))
	{
		if (startPage == 0)
		{
			startPage = 1;
		}
		pageChange(startPage);
		p63_wifi_page_last_sent = startPage;
		p63_wifi_last_no_signal_sec = nowSec;
		if (p63_wifi_status_seen)
		{
			p63_wifi_last_seen_sec = nowSec;
		}
		return;
	}

	if (p63_scan_busy)
	{
		if ((p63_scan_busy_until_sec != 0) && (nowSec >= p63_scan_busy_until_sec))
		{
			p63_scan_busy = 0;
			p63_scan_busy_until_sec = 0;
		}
		else
		{
			p63_wifi_last_no_signal_sec = nowSec;
			if (p63_wifi_status_seen)
			{
				p63_wifi_last_seen_sec = nowSec;
			}
			return;
		}
	}

	// While scan animation is active on page63, ESP32 may be busy in blocking scan.
	// Do not treat missing heartbeat in this window as ESP power-off.
	if (p63_anim_on)
	{
		p63_wifi_last_no_signal_sec = nowSec;
		if (p63_wifi_status_seen)
		{
			p63_wifi_last_seen_sec = nowSec;
		}
		return;
	}

	if (!p63_wifi_status_seen)
	{
		if (p63_wifi_boot_sec == 0)
		{
			p63_wifi_boot_sec = nowSec;
			p63_wifi_last_no_signal_sec = nowSec;
			p63_wifi_page_last_sent = dwin_page_now;
			return;
		}

		if ((nowSec - p63_wifi_last_no_signal_sec) >= P63_WIFI_STATUS_NO_SIGNAL_SEC)
		{
			p63_enter_fail_safe();
		}
		return;
	}

	if ((nowSec - p63_wifi_last_seen_sec) >= P63_WIFI_STATUS_NO_SIGNAL_SEC)
	{
		p63_wifi_status_seen = 0;
		p63_wifi_boot_sec = nowSec;
		p63_wifi_last_no_signal_sec = nowSec;
		p63_wifi_connected_state = 0xFF;
		p63_wifi_last_seen_sec = 0;
		p63_enter_fail_safe();
	}
}

static void p63_ui_tick(void)
{
	U08 do_scan = 0;
	U08 do_prev = 0;
	U08 do_next = 0;

	if (p63_fail_safe_stop)
	{
		cli();
		p63_scan_req = 0;
		p63_prev_req = 0;
		p63_next_req = 0;
		sei();
		p63_set_anim(0);
		return;
	}

	cli();
	if (p63_scan_req)
	{
		do_scan = 1;
		p63_scan_req = 0;
	}
	if (p63_prev_req)
	{
		do_prev = 1;
		p63_prev_req = 0;
	}
	if (p63_next_req)
	{
		do_next = 1;
		p63_next_req = 0;
	}
	sei();

	if (do_scan)
	{
		p63_send_key_to_esp(0x4444);
		p63_set_anim(1);
	}
	if (do_prev)
	{
		p63_send_key_to_esp(0x4101);
	}
	if (do_next)
	{
		p63_send_key_to_esp(0x4102);
	}

	if (p63_anim_on)
	{
		uint16_t nowMs;

		cli();
		nowMs = p63_anim_ms;
		sei();
		if ((uint16_t)(nowMs - p63_anim_last_ms) >= P63_SCAN_ANIM_PERIOD_TICKS)
		{
			p63_anim_last_ms = nowMs;
			p63_scan_icons_frame(p63_anim_frame);
			p63_anim_frame = (p63_anim_frame + 1) % 3;
		}
	}
}

static void sub_copy_field(char *dst, uint8_t dstSz, const char *src)
{
	uint8_t i = 0;
	if ((dst == 0) || (dstSz == 0))
	{
		return;
	}
	dst[0] = 0;
	if (src == 0)
	{
		return;
	}
	while ((src[i] != 0) && (i + 1 < dstSz))
	{
		char c = src[i];
		if ((c == '|') || (c == '\r') || (c == '\n'))
		{
			break;
		}
		if ((c >= 0x20) && (c <= 0x7E))
		{
			dst[i] = c;
		}
		else
		{
			dst[i] = ' ';
		}
		i++;
	}
	dst[i] = 0;
}

static void sub_build_dday(int16_t remain, char *out, uint8_t outSz)
{
	if ((out == 0) || (outSz == 0))
	{
		return;
	}
	if (remain < 0)
	{
		remain = 0;
	}
	snprintf(out, outSz, "D-%d", (int)remain);
}

static void sub_apply_active(const char *planTok, const char *rangeTok, int remain)
{
	if ((planTok == 0) || (rangeTok == 0))
	{
		return;
	}
	if (remain < 0)
	{
		remain = 0;
	}

	sub_copy_field(sub_plan_text, sizeof(sub_plan_text), planTok);
	sub_copy_field(sub_range_text, sizeof(sub_range_text), rangeTok);
	sub_remain_days = (int16_t)remain;
	sub_build_dday(sub_remain_days, sub_dday_text, sizeof(sub_dday_text));
	sub_active = 1;
	sub_dirty = 1;
	sub_state_seen = 1U;
	sub_state_code = SUB_STATE_ACTIVE;
	subscription_ready_pending_cancel();
	// Always push text VPs (0x3100/0x3300) as soon as SUB line is parsed.
	// Icon VPs are still page-scoped inside SUBSCRIPTION_Render57().
	SUBSCRIPTION_Render57(sub_plan_text, sub_range_text, sub_dday_text, sub_remain_days);
	if (dwin_page_now == 57)
	{
		sub_dirty = 0;
	}
}

static void sub_clear_state(void)
{
	sub_active = 0;
	sub_dirty = 0;
}

static void energy_reset_sync_state(void)
{
	g_energy_sync_seen_mask = 0U;
}

static U08 energy_sync_ready(void)
{
	return ((g_energy_sync_seen_mask & (ENERGY_SYNC_SEEN_ASSIGNED | ENERGY_SYNC_SEEN_USED)) ==
	        (ENERGY_SYNC_SEEN_ASSIGNED | ENERGY_SYNC_SEEN_USED)) ? 1U : 0U;
}

static void energy_clear_subscription_snapshot(void)
{
	g_energy_assigned_j = 0U;
	g_energy_used_j = 0U;
	g_energy_daily_avg_j = 0U;
	g_energy_monthly_avg_j = 0U;
	g_energy_projected_j = 0U;
	g_energy_elapsed_days = 1U;
	g_energy_remaining_days = 0U;
	g_energy_local_expired_lock = 0U;
	g_energy_dirty = 1U;
	energy_reset_sync_state();
}

static void subscription_ready_pending_cancel(void)
{
	sub_ready_pending = 0U;
	sub_ready_pending_sec = 0U;
}

static void subscription_ready_pending_arm(void)
{
	sub_ready_pending = 1U;
	sub_ready_pending_sec = p63_now_sec();
}

static void subscription_ready_pending_tick(void)
{
	uint32_t nowSec;
	U08 page = dwin_page_now;

	if (!sub_ready_pending)
	{
		return;
	}
	if (sub_state_code != SUB_STATE_READY)
	{
		subscription_ready_pending_cancel();
		return;
	}
	if ((page == WIFI_PAGE_BOOT_CHECK) || (page == WIFI_PAGE_CONNECTING))
	{
		return;
	}

	nowSec = p63_now_sec();
	if ((uint32_t)(nowSec - sub_ready_pending_sec) < SUB_READY_GRACE_SEC)
	{
		return;
	}

	subscription_ready_pending_cancel();
	sub_state_seen = 1U;
	sub_state_code = SUB_STATE_EXPIRED;
	subscription_enter_lock_page(WIFI_PAGE_SUB_EXPIRED);
}

static void subscription_show_connected_page(void)
{
	if (dwin_page_now == WIFI_PAGE_BOOT_CHECK)
	{
		return;
	}
	if (dwin_page_now != WIFI_PAGE_CONNECTED)
	{
		pageChange(WIFI_PAGE_CONNECTED);
	}
	p63_wifi_page_last_sent = WIFI_PAGE_CONNECTED;
	p63_boot_resume_page = WIFI_PAGE_CONNECTED;
	p63_boot_waiting_status = 0;
}

static void registration_restore_registered_page(void)
{
	if (dwin_page_now == WIFI_PAGE_REGISTER_WAIT)
	{
		wifi_reboot_for_connected_state();
		return;
	}
	if ((dwin_page_now == 0) || (dwin_page_now == 0xFF))
	{
		subscription_show_connected_page();
	}
}

static void subscription_restore_ready_page(void)
{
	U08 targetPage = WIFI_PAGE_CONNECTED;
	U08 wifiConnected = (p63_wifi_status_seen && (p63_wifi_connected_state == 1U)) ? 1U : 0U;

	if ((dwin_page_now == WIFI_PAGE_LIST) && p63_boot_waiting_status && wifiConnected)
	{
		if (subscription_resolve_connected_target_page(p63_boot_resume_page, &targetPage))
		{
			if (targetPage == WIFI_PAGE_CONNECTED)
			{
				subscription_show_connected_page();
			}
			else
			{
				subscription_enter_lock_page(targetPage);
			}
			return;
		}
	}

	if ((dwin_page_now == WIFI_PAGE_SUB_EXPIRED) || (dwin_page_now == WIFI_PAGE_SUB_OFFLINE))
	{
		if (!wifiConnected)
		{
			return;
		}
		if (subscription_resolve_connected_target_page(p63_boot_resume_page, &targetPage))
		{
			if (targetPage == WIFI_PAGE_CONNECTED)
			{
				subscription_show_connected_page();
			}
			else
			{
				subscription_enter_lock_page(targetPage);
			}
		}
		return;
	}
	registration_restore_registered_page();
}

static void subscription_enter_lock_page(U08 page)
{
	// OTA confirmation page(74) must remain stable until user presses accept/skip.
	// Without this guard, SUB state updates can force page59/20/73 and create
	// a 74 <-> lock-page bounce loop.
	if ((ota_prompt_flags & OTA_PROMPT_FLAG_ACTIVE) && (page != OTA_PAGE_FIRMWARE_UPDATE))
	{
		return;
	}

	if (dwin_page_now == WIFI_PAGE_BOOT_CHECK)
	{
		return;
	}
	if (dwin_page_now != page)
	{
		pageChange(page);
	}
	p63_wifi_page_last_sent = page;
	p63_boot_waiting_status = 0;
}

static U08 subscription_resolve_connected_target_page(U08 resumePage, U08 *targetPage)
{
	U08 target = resumePage;

	if (targetPage == 0)
	{
		return 0U;
	}

	if ((target == 0) || (target == 0xFF))
	{
		target = WIFI_PAGE_CONNECTED;
	}

	if (!reg_gate_status_seen)
	{
		return 0U;
	}

	if (!reg_gate_registered)
	{
		*targetPage = WIFI_PAGE_REGISTER_WAIT;
		return 1U;
	}

	if (!sub_state_seen)
	{
		return 0U;
	}

	switch (sub_state_code)
	{
		case SUB_STATE_ACTIVE:
			if (!energy_sync_ready())
			{
				return 0U;
			}
			if ((g_energy_assigned_j == 0U) || g_energy_local_expired_lock || energy_subscription_exhausted())
			{
				*targetPage = WIFI_PAGE_SUB_EXPIRED;
				return 1U;
			}
			*targetPage = target;
			return 1U;

		case SUB_STATE_READY:
			*targetPage = WIFI_PAGE_SUB_EXPIRED;
			return 1U;

		case SUB_STATE_EXPIRED:
			*targetPage = WIFI_PAGE_SUB_EXPIRED;
			return 1U;

		case SUB_STATE_UNREGISTERED:
			*targetPage = WIFI_PAGE_REGISTER_WAIT;
			return 1U;

		case SUB_STATE_OFFLINE:
			*targetPage = WIFI_PAGE_SUB_OFFLINE;
			return 1U;

		default:
			break;
	}

	return 0U;
}

static uint8_t sub_token_equals_ci(const char *tok, uint8_t tokLen, const char *ref)
{
	uint8_t i = 0;
	if ((tok == 0) || (ref == 0))
	{
		return 0;
	}

	while (i < tokLen)
	{
		char c = tok[i];
		char r = ref[i];
		if (r == 0)
		{
			return 0;
		}
		if ((c >= 'a') && (c <= 'z'))
		{
			c = (char)(c - 'a' + 'A');
		}
		if ((r >= 'a') && (r <= 'z'))
		{
			r = (char)(r - 'a' + 'A');
		}
		if (c != r)
		{
			return 0;
		}
		i++;
	}
	return (ref[i] == 0) ? 1U : 0U;
}

static uint8_t sub_extract_kv_field(const char *line, const char *key, char *out, uint8_t outSz)
{
	const char *p;
	uint8_t keyLen;
	char quote = 0;
	uint8_t i = 0;

	if ((line == 0) || (key == 0) || (out == 0) || (outSz == 0))
	{
		return 0;
	}
	out[0] = 0;

	keyLen = (uint8_t)strlen(key);
	p = strstr(line, key);
	if (p == 0)
	{
		return 0;
	}
	p += keyLen;

	while ((*p == ' ') || (*p == '\t'))
	{
		p++;
	}
	if ((*p == '\'') || (*p == '"'))
	{
		quote = *p;
		p++;
	}

	while ((*p != 0) && (i + 1 < outSz))
	{
		if (quote != 0)
		{
			if (*p == quote)
			{
				break;
			}
		}
		else if ((*p == ' ') || (*p == '\t'))
		{
			break;
		}
		out[i++] = *p;
		p++;
	}
	out[i] = 0;
	return (i > 0) ? 1U : 0U;
}

static uint8_t sub_extract_kv_int(const char *line, const char *key, int *outVal)
{
	const char *p;
	uint8_t keyLen;
	int sign = 1;
	int value = 0;
	uint8_t hasDigit = 0;

	if ((line == 0) || (key == 0) || (outVal == 0))
	{
		return 0;
	}

	keyLen = (uint8_t)strlen(key);
	p = strstr(line, key);
	if (p == 0)
	{
		return 0;
	}
	p += keyLen;

	while ((*p == ' ') || (*p == '\t'))
	{
		p++;
	}
	if ((*p == '\'') || (*p == '"'))
	{
		p++;
	}
	if (*p == '-')
	{
		sign = -1;
		p++;
	}
	while ((*p >= '0') && (*p <= '9'))
	{
		value = (value * 10) + (int)(*p - '0');
		hasDigit = 1;
		p++;
	}
	if (!hasDigit)
	{
		return 0;
	}

	*outVal = value * sign;
	return 1U;
}

static void sub_parse_line(char *line)
{
	char *tok;
	char *savep = 0;
	char *planTok;
	char *rangeTok;
	char *remainTok;
	int remain;

	if (line == 0)
	{
		return;
	}

	tok = strtok_r(line, "|", &savep);
	if ((tok == 0) || (strcmp(tok, "SUB") != 0))
	{
		return;
	}

	tok = strtok_r(0, "|", &savep);
	if (tok == 0)
	{
		return;
	}

	if ((strcmp(tok, "A") == 0) || (strcmp(tok, "ACTIVE") == 0))
	{
		if (g_energy_local_expired_lock)
		{
			sub_clear_state();
			sub_state_seen = 1U;
			sub_state_code = SUB_STATE_EXPIRED;
			subscription_enter_lock_page(WIFI_PAGE_SUB_EXPIRED);
			return;
		}
		planTok = strtok_r(0, "|", &savep);
		rangeTok = strtok_r(0, "|", &savep);
		remainTok = strtok_r(0, "|", &savep);

		if ((planTok == 0) || (rangeTok == 0) || (remainTok == 0))
		{
			return;
		}

		remain = atoi(remainTok);
		sub_apply_active(planTok, rangeTok, remain);
		if (dwin_page_now == WIFI_PAGE_CONNECTING)
		{
			return;
		}
		subscription_restore_ready_page();
		return;
	}

	sub_clear_state();
	if (dwin_page_now == WIFI_PAGE_CONNECTING)
	{
		return;
	}

	if ((strcmp(tok, "R") == 0) || (strcmp(tok, "READY") == 0) || (strcmp(tok, "REGISTERED") == 0))
	{
		if (g_energy_local_expired_lock)
		{
			sub_state_seen = 1U;
			sub_state_code = SUB_STATE_EXPIRED;
			subscription_enter_lock_page(WIFI_PAGE_SUB_EXPIRED);
			return;
		}
		// READY is only a provisional boot state. Clear local mirrors so revoked/no-plan
		// boots do not reuse stale usage/plan figures from a previous session.
		energy_clear_subscription_snapshot();
		sub_state_seen = 1U;
		sub_state_code = SUB_STATE_READY;
		subscription_ready_pending_arm();
		subscription_restore_ready_page();
		return;
	}

	if ((strcmp(tok, "U") == 0) || (strcmp(tok, "UNREGISTERED") == 0))
	{
		subscription_ready_pending_cancel();
		sub_state_seen = 1U;
		sub_state_code = SUB_STATE_UNREGISTERED;
		if (reg_gate_status_seen && reg_gate_registered)
		{
			subscription_restore_ready_page();
			return;
		}
		subscription_enter_lock_page(WIFI_PAGE_REGISTER_WAIT);
		return;
	}

	if ((strcmp(tok, "E") == 0) || (strcmp(tok, "EXPIRED") == 0) || (strcmp(tok, "RESTRICTED") == 0))
	{
		subscription_ready_pending_cancel();
		sub_state_seen = 1U;
		sub_state_code = SUB_STATE_EXPIRED;
		subscription_enter_lock_page(WIFI_PAGE_SUB_EXPIRED);
		return;
	}

	if ((strcmp(tok, "O") == 0) || (strcmp(tok, "OFFLINE") == 0))
	{
		subscription_ready_pending_cancel();
		sub_state_seen = 1U;
		sub_state_code = SUB_STATE_OFFLINE;
		subscription_enter_lock_page(WIFI_PAGE_SUB_OFFLINE);
	}
}

static void sub_parse_log_line(const char *line)
{
	const char *p;
	const char *statusTok;
	uint8_t statusLen = 0;
	char planTok[sizeof(sub_plan_text)];
	char rangeTok[sizeof(sub_range_text)];
	int remain = 0;
	uint8_t hasPlan;
	uint8_t hasRange;
	uint8_t hasRemain;

	if (line == 0)
	{
		return;
	}
	if (strncmp(line, "[SUB]", 5) != 0)
	{
		return;
	}

	p = line + 5;
	while ((*p == ' ') || (*p == '\t'))
	{
		p++;
	}
	statusTok = p;
	while ((*p != 0) && (*p != ' ') && (*p != '\t'))
	{
		if (statusLen < 0xFF)
		{
			statusLen++;
		}
		p++;
	}

	if ((!sub_token_equals_ci(statusTok, statusLen, "A")) &&
	    (!sub_token_equals_ci(statusTok, statusLen, "ACTIVE")))
	{
		// Keep behavior aligned with SUB|... parser.
		sub_active = 0;
		sub_dirty = 0;
		return;
	}

	if (g_energy_local_expired_lock)
	{
		sub_clear_state();
		sub_state_seen = 1U;
		sub_state_code = SUB_STATE_EXPIRED;
		subscription_enter_lock_page(WIFI_PAGE_SUB_EXPIRED);
		return;
	}

	hasPlan = sub_extract_kv_field(line, "plan=", planTok, sizeof(planTok));
	hasRange = sub_extract_kv_field(line, "period=", rangeTok, sizeof(rangeTok));
	if (!hasRange)
	{
		hasRange = sub_extract_kv_field(line, "range=", rangeTok, sizeof(rangeTok));
	}
	hasRemain = sub_extract_kv_int(line, "remain=", &remain);

	if ((!hasPlan) || (!hasRange) || (!hasRemain))
	{
		return;
	}

	sub_apply_active(planTok, rangeTok, remain);
}

// [NEW FEATURE] Parse integer metric token from ESP line payload.
static uint32_t energy_parse_u32_token(const char *tok, uint32_t fallback)
{
	char *endp = 0;
	unsigned long v;
	if (tok == 0)
	{
		return fallback;
	}
	v = strtoul(tok, &endp, 10);
	if ((endp == 0) || (endp == tok))
	{
		return fallback;
	}
	return (uint32_t)v;
}

static U08 energy_subscription_exhausted(void)
{
	if (g_energy_assigned_j == 0U)
	{
		return 0U;
	}
	return (g_energy_used_j >= g_energy_assigned_j) ? 1U : 0U;
}

static void energy_apply_local_expired_lock(void)
{
	if (!energy_subscription_exhausted())
	{
		g_energy_local_expired_lock = 0U;
		return;
	}

	g_energy_local_expired_lock = 1U;
	sub_clear_state();
	sub_state_seen = 1U;
	sub_state_code = SUB_STATE_EXPIRED;
	subscription_enter_lock_page(WIFI_PAGE_SUB_EXPIRED);
}

// [NEW FEATURE] Page57 status icon formula (expected/included ratio).
static U08 energy_calc_status_icon(void)
{
	uint32_t used = g_energy_used_j;
	uint32_t elapsed = (g_energy_elapsed_days == 0U) ? 1U : (uint32_t)g_energy_elapsed_days;
	uint32_t remain = (uint32_t)g_energy_remaining_days;
	uint32_t included = g_energy_assigned_j;
	uint64_t expectedScaled;
	uint64_t includedScaled;

	if (included == 0U)
	{
		return 2U;
	}

	// [NEW FEATURE] Compare ratio without truncating avg_day early.
	expectedScaled = (uint64_t)used * (uint64_t)(elapsed + remain);
	includedScaled = (uint64_t)included * (uint64_t)elapsed;

	if (expectedScaled <= includedScaled)
	{
		return 0U;
	}
	if (expectedScaled * 100ULL <= (includedScaled * 110ULL))
	{
		return 1U;
	}
	return 2U;
}

// [NEW FEATURE] Remaining included energy percentage for page57 (clamped 0..100).
static uint32_t energy_calc_remaining_percent(void)
{
	uint32_t included = g_energy_assigned_j;
	uint32_t used = g_energy_used_j;
	uint32_t remain;

	if (included == 0U)
	{
		return 0U;
	}

	if (used >= included)
	{
		return 0U;
	}

	remain = included - used;
	return (uint32_t)(((uint64_t)remain * 100ULL) / (uint64_t)included);
}

// [NEW FEATURE] Page57 remaining-energy icon selector for VAR ICON 0xDB01.
static uint16_t energy_calc_remaining_icon(uint32_t remainPercent)
{
	if (remainPercent >= 100U) return 23U;
	if (remainPercent >= 95U) return 22U;
	if (remainPercent >= 90U) return 21U;
	if (remainPercent >= 85U) return 20U;
	if (remainPercent >= 80U) return 19U;
	if (remainPercent >= 75U) return 18U;
	if (remainPercent >= 70U) return 17U;
	if (remainPercent >= 65U) return 16U;
	if (remainPercent >= 60U) return 15U;
	if (remainPercent >= 55U) return 14U;
	if (remainPercent >= 50U) return 13U;
	if (remainPercent >= 45U) return 12U;
	if (remainPercent >= 40U) return 11U;
	if (remainPercent >= 35U) return 10U;
	if (remainPercent >= 30U) return 9U;
	if (remainPercent >= 25U) return 8U;
	if (remainPercent >= 20U) return 7U;
	if (remainPercent >= 15U) return 6U;
	if (remainPercent >= 10U) return 5U;
	if (remainPercent >= 7U) return 4U;
	if (remainPercent >= 5U) return 3U;
	if (remainPercent >= 3U) return 2U;
	if (remainPercent >= 1U) return 1U;
	return 0U;
}

// [NEW FEATURE] Render page57 energy texts + status icon using existing DWIN writers.
static void energy_render_page57(void)
{
	char buf[24];
	uint32_t remainPercent = energy_calc_remaining_percent();
	snprintf(buf, sizeof(buf), "%lu", (unsigned long)g_energy_assigned_j);
	dwin_write_text(0xA100, buf, 20);
	snprintf(buf, sizeof(buf), "%lu", (unsigned long)g_energy_used_j);
	dwin_write_text(0xA200, buf, 20);
	snprintf(buf, sizeof(buf), "%lu", (unsigned long)g_energy_daily_avg_j);
	dwin_write_text(0xA300, buf, 20);
	snprintf(buf, sizeof(buf), "%lu", (unsigned long)g_energy_monthly_avg_j);
	dwin_write_text(0xA400, buf, 20);
	snprintf(buf, sizeof(buf), "%lu", (unsigned long)g_energy_projected_j);
	dwin_write_text(0xA500, buf, 20);
	snprintf(buf, sizeof(buf), "%lu%%", (unsigned long)remainPercent);
	dwin_write_text(0xDA10, buf, 4);
	varIconInt(0xDB01, energy_calc_remaining_icon(remainPercent));
	varIconInt(0xBB22, (uint16_t)energy_calc_status_icon());
}

// [NEW FEATURE] Render page71 energy texts using existing DWIN writers.
static void energy_render_page71(void)
{
	char buf[24];
	snprintf(buf, sizeof(buf), "%lu", (unsigned long)g_energy_used_j);
	dwin_write_text(0xB100, buf, 20);
	dwin_write_text(0xB200, "10", 2);
	dwin_write_text(0xB300, "20", 2);
}

// [NEW FEATURE] Parse ESP metrics line: ENG|<A/U/D/M/P/E/R>|<value>.
static void energy_parse_line(char *line)
{
	char *tok;
	char *savep = 0;
	char *cmdTok;
	char *valTok;
	uint32_t val;

	if (line == 0)
	{
		return;
	}

	tok = strtok_r(line, "|", &savep);
	if ((tok == 0) || (strcmp(tok, "ENG") != 0))
	{
		return;
	}

	cmdTok = strtok_r(0, "|", &savep);
	valTok = strtok_r(0, "|", &savep);
	if ((cmdTok == 0) || (valTok == 0))
	{
		return;
	}

	val = energy_parse_u32_token(valTok, 0U);
	if ((cmdTok[0] == 'A') && (cmdTok[1] == 0))
	{
		g_energy_assigned_j = val;
		g_energy_sync_seen_mask |= ENERGY_SYNC_SEEN_ASSIGNED;
	}
	else if ((cmdTok[0] == 'U') && (cmdTok[1] == 0))
	{
		g_energy_used_j = val;
		g_energy_sync_seen_mask |= ENERGY_SYNC_SEEN_USED;
	}
	else if ((cmdTok[0] == 'D') && (cmdTok[1] == 0))
	{
		g_energy_daily_avg_j = val;
	}
	else if ((cmdTok[0] == 'M') && (cmdTok[1] == 0))
	{
		g_energy_monthly_avg_j = val;
	}
	else if ((cmdTok[0] == 'P') && (cmdTok[1] == 0))
	{
		g_energy_projected_j = val;
	}
	else if ((cmdTok[0] == 'E') && (cmdTok[1] == 0))
	{
		g_energy_elapsed_days = (uint16_t)val;
	}
	else if ((cmdTok[0] == 'R') && (cmdTok[1] == 0))
	{
		g_energy_remaining_days = (uint16_t)val;
	}
	else
	{
		return;
	}

	g_energy_dirty = 1;
	energy_apply_local_expired_lock();
	if ((dwin_page_now != WIFI_PAGE_CONNECTING) &&
	    sub_state_seen &&
	    ((sub_state_code == SUB_STATE_ACTIVE) || (sub_state_code == SUB_STATE_READY)))
	{
		subscription_restore_ready_page();
	}
}

// [NEW FEATURE] Local ATmega fail-safe: exhausted plan energy forces expired page on run key.
U08 energy_subscription_run_key_guard(void)
{
	U08 wasRunning;

	if (!energy_subscription_exhausted())
	{
		return 0U;
	}

	g_energy_local_expired_lock = 1U;
	wasRunning = (opPage & 0x02) ? 1U : 0U;
	if (wasRunning)
	{
		setStandby();
		opPage = 1;
		old_totalEnergy = totalEnergy;
		energy_uart_publish_run_event(0U, totalEnergy);
	}

	sub_clear_state();
	sub_state_seen = 1U;
	sub_state_code = SUB_STATE_EXPIRED;
	subscription_enter_lock_page(WIFI_PAGE_SUB_EXPIRED);
	return 1U;
}

// [NEW FEATURE] Refresh page57/page71 energy widgets on page enter and periodic refresh.
static void energy_ui_tick(void)
{
	static U08 prev_page = 0xFF;
	static uint32_t last_refresh_sec = 0;
	uint32_t nowSec;
	U08 page = dwin_page_now;
	U08 doRender = 0;

	if (prev_page != page)
	{
		prev_page = page;
		if ((page == 57) || (page == 71))
		{
			g_energy_dirty = 1;
		}
	}

	if (!((page == 57) || (page == 71)))
	{
		return;
	}

	cli();
	nowSec = ckTime;
	sei();
	if (g_energy_dirty || (nowSec != last_refresh_sec))
	{
		doRender = 1;
		last_refresh_sec = nowSec;
	}
	if (!doRender)
	{
		return;
	}

	if (page == 57)
	{
		energy_render_page57();
	}
	else if (page == 71)
	{
		energy_render_page71();
	}
	g_energy_dirty = 0;
}

static void p63_parse_line(char *line)
{
	char *tok;
	char *savep = 0;
	char *cmdTok;
	char *slotTok;
	char *lockTok;
	char *ssidTok;
	int slot;
	int lock;
	char ssid[64];

	if (line == 0)
	{
		return;
	}

	tok = strtok_r(line, "|", &savep);
	if ((tok == 0) || (strcmp(tok, "P63") != 0))
	{
		return;
	}

	cmdTok = strtok_r(0, "|", &savep);
	if (cmdTok == 0)
	{
		return;
	}

	if (strcmp(cmdTok, "C") == 0)
	{
		p63_slot_clear_all();
		PAGE63_ClearAll();
		p63_set_anim(0);
		return;
	}

	if (strcmp(cmdTok, "A") == 0)
	{
		char *onTok = strtok_r(0, "|", &savep);
		if ((onTok != 0) && (atoi(onTok) != 0))
		{
			p63_set_anim(1);
		}
		else
		{
			// Page62 shares 0x3001~0x3003; avoid off-page animation writes.
			if (dwin_page_now == WIFI_PAGE_LIST)
			{
				p63_set_anim(0);
			}
			else
			{
				p63_anim_on = 0;
				p63_anim_visible = 0;
				p63_anim_frame = 0;
				p63_anim_ms = 0;
				p63_anim_last_ms = 0;
			}
		}
		return;
	}

	if (strcmp(cmdTok, "W") == 0)
	{
		char *connTok = strtok_r(0, "|", &savep);
		if (connTok != 0)
		{
			p63_wifi_status_set((atoi(connTok) != 0) ? 1U : 0U);
		}
		return;
	}

	if (strcmp(cmdTok, "B") == 0)
	{
		char *busyTok = strtok_r(0, "|", &savep);
		uint32_t nowSec = p63_now_sec();
		if ((busyTok != 0) && (atoi(busyTok) != 0))
		{
			p63_scan_busy = 1;
			p63_scan_busy_until_sec = nowSec + P63_SCAN_BUSY_HOLD_SEC;
		}
		else
		{
			// Do not clear immediately at scan end; give heartbeat recovery window.
			p63_scan_busy = 1;
			p63_scan_busy_until_sec = nowSec + P63_WIFI_STATUS_NO_SIGNAL_SEC + 1;
		}
		p63_wifi_last_no_signal_sec = nowSec;
		if (p63_wifi_status_seen)
		{
			p63_wifi_last_seen_sec = nowSec;
		}
		return;
	}

	if (strcmp(cmdTok, "S") != 0)
	{
		return;
	}

	slotTok = strtok_r(0, "|", &savep);
	lockTok = strtok_r(0, "|", &savep);
	ssidTok = strtok_r(0, "|", &savep);

	if ((slotTok == 0) || (lockTok == 0))
	{
		return;
	}

	slot = atoi(slotTok);
	if ((slot < 1) || (slot > 5))
	{
		return;
	}

	if ((lockTok[0] == '0') && (lockTok[1] == 0))
	{
		lock = 0;
	}
	else if ((lockTok[0] == '1') && (lockTok[1] == 0))
	{
		lock = 1;
	}
	else if ((((lockTok[0] == 'O') || (lockTok[0] == 'o')) &&
	          ((lockTok[1] == 'P') || (lockTok[1] == 'p')) &&
	          ((lockTok[2] == 'E') || (lockTok[2] == 'e')) &&
	          ((lockTok[3] == 'N') || (lockTok[3] == 'n')) &&
	          (lockTok[4] == 0)))
	{
		lock = 0;
	}
	else
	{
		// Security label mode (WPA/WPA2/WPA3/SEC...) => lock icon ON
		lock = 1;
	}
	if (ssidTok == 0)
	{
		ssidTok = "";
	}

	// Safety net: if list slot frames are arriving, scan animation must be off.
	// This also recovers when '@P63|A|0' is dropped or delayed on UART.
	if (p63_anim_on || p63_anim_visible)
	{
		p63_set_anim(0);
	}

	wifi_copy_field(ssid, sizeof(ssid), ssidTok);
	p63_slot_set((U08)(slot - 1), ssid, (lock != 0) ? 1U : 0U);
	PAGE63_RenderSlot((U08)(slot - 1), ssid, (lock != 0) ? 1 : 0);
}

static void wifi_parse_line(char *line)
{
	char *tok;
	char *savep = 0;
	char *cmdTok;
	char *resultTok;

	if (line == 0)
	{
		return;
	}

	tok = strtok_r(line, "|", &savep);
	if ((tok == 0) || (strcmp(tok, "WIFI") != 0))
	{
		return;
	}

	cmdTok = strtok_r(0, "|", &savep);
	if (cmdTok == 0)
	{
		return;
	}

	if (strcmp(cmdTok, "R") != 0)
	{
		return;
	}

	resultTok = strtok_r(0, "|", &savep);
	if (resultTok == 0)
	{
		return;
	}

	wifi_apply_connect_result((atoi(resultTok) != 0) ? 1U : 0U);
}

static void registration_parse_line(char *line)
{
	char *tok;
	char *savep = 0;
	char *stateTok;
	U08 wifiConnected;

	if (line == 0)
	{
		return;
	}

	tok = strtok_r(line, "|", &savep);
	if ((tok == 0) || (strcmp(tok, "REG") != 0))
	{
		return;
	}

	stateTok = strtok_r(0, "|", &savep);
	if (stateTok == 0)
	{
		return;
	}

	reg_gate_status_seen = 1U;
	reg_gate_registered = (atoi(stateTok) != 0) ? 1U : 0U;

	if (reg_gate_registered && (dwin_page_now == WIFI_PAGE_REGISTER_WAIT))
	{
		registration_restore_registered_page();
		return;
	}

	wifiConnected = (p63_wifi_status_seen && (p63_wifi_connected_state == 1U)) ? 1U : 0U;
	if (!wifiConnected)
	{
		return;
	}

	if (dwin_page_now == WIFI_PAGE_CONNECTING)
	{
		return;
	}

	if (reg_gate_registered)
	{
		registration_restore_registered_page();
	}
	else
	{
		subscription_enter_lock_page(WIFI_PAGE_REGISTER_WAIT);
	}
}

static void page_parse_line(char *line)
{
	char *tok;
	char *savep = 0;
	char *pageTok;
	int pageNum;

	if (line == 0)
	{
		return;
	}

	tok = strtok_r(line, "|", &savep);
	if ((tok == 0) || (strcmp(tok, "PAGE") != 0))
	{
		return;
	}

	pageTok = strtok_r(0, "|", &savep);
	if (pageTok == 0)
	{
		return;
	}

	pageNum = atoi(pageTok);
	if (pageNum < 0)
	{
		pageNum = 0;
	}
	if (pageNum > 255)
	{
		pageNum = 255;
	}

	pageChange((U08)pageNum);
	p63_wifi_page_last_sent = (U08)pageNum;
	p63_boot_waiting_status = 0;
}

static void ota_parse_line(char *line)
{
	char *tok;
	char *savep = 0;
	char *cmdTok;
	char *currentTok;
	char *targetTok;

	if (line == 0)
	{
		return;
	}

	tok = strtok_r(line, "|", &savep);
	if ((tok == 0) || (strcmp(tok, "OTA") != 0))
	{
		return;
	}

	cmdTok = strtok_r(0, "|", &savep);
	if (cmdTok == 0)
	{
		return;
	}

	if ((strcmp(cmdTok, "RST") == 0) || (strcmp(cmdTok, "RESET") == 0))
	{
		if ((ota_prompt_flags & OTA_PROMPT_FLAG_ACTIVE) && (dwin_page_now == OTA_PAGE_FIRMWARE_UPDATE))
		{
			if ((ota_prev_page != 0) && (ota_prev_page != OTA_PAGE_FIRMWARE_UPDATE))
			{
				pageChange(ota_prev_page);
			}
		}
		ota_prompt_flags = 0;
		ota_prev_page = 0;
		ota_progress_reset();
		return;
	}

	if ((strcmp(cmdTok, "Q") == 0) || (strcmp(cmdTok, "PROMPT") == 0))
	{
		currentTok = strtok_r(0, "|", &savep);
		targetTok = strtok_r(0, "|", &savep);
		if (currentTok == 0)
		{
			currentTok = "";
		}
		if (targetTok == 0)
		{
			targetTok = "";
		}
		ota_enter_prompt(currentTok, targetTok);
	}
}

static void subscription_uart_pump_lines(void)
{
	U08 hasLine = 0;
	char line[SUB_UART_LINE_MAX];

	for (;;)
	{
		hasLine = 0;
		line[0] = 0;

		cli();
		if (sub_uart_q_count > 0)
		{
			strncpy(line, sub_uart_queue[sub_uart_q_tail], sizeof(line) - 1);
			line[sizeof(line) - 1] = 0;
			sub_uart_q_tail = (U08)((sub_uart_q_tail + 1) % SUB_UART_Q_DEPTH);
			sub_uart_q_count--;
			sub_uart_ready = (sub_uart_q_count > 0) ? 1U : 0U;
			hasLine = 1;
		}
		sei();

		if (!hasLine)
		{
			break;
		}

			if (strncmp(line, "SUB|", 4) == 0)
			{
				sub_parse_line(line);
			}
			else if (strncmp(line, "[SUB]", 5) == 0)
			{
				sub_parse_log_line(line);
			}
				else if (strncmp(line, "P63|", 4) == 0)
				{
					p63_parse_line(line);
				}
				else if (strncmp(line, "ENG|", 4) == 0)
				{
					// [NEW FEATURE] Energy metrics stream from ESP for page57/page71.
					energy_parse_line(line);
				}
				else if (strncmp(line, "REG|", 4) == 0)
				{
					registration_parse_line(line);
				}
				else if (strncmp(line, "PAGE|", 5) == 0)
				{
					page_parse_line(line);
				}
				else if (strncmp(line, "OTA|", 4) == 0)
				{
					ota_parse_line(line);
				}
				else if ((strncmp(line, "WIFI|", 5) == 0) && (dwin_page_now != WIFI_PAGE_BOOT_CHECK))
				{
					wifi_parse_line(line);
				}
	}
}

static void page68_boot_step_wait_ms(uint16_t holdMs)
{
	uint16_t remain = holdMs;

	while (remain >= 10)
	{
		asm("wdr");
		subscription_uart_pump_lines();
		_delay_ms(10);
		remain = (uint16_t)(remain - 10);
	}

	while (remain > 0)
	{
		asm("wdr");
		subscription_uart_pump_lines();
		_delay_ms(1);
		remain--;
	}
}

static void page68_set_step(U08 step)
{
	char textBuf[PAGE68_TEXT_LEN + 1];

	if (step >= PAGE68_CHECK_COUNT)
	{
		return;
	}

	textBuf[0] = 0;
	switch (step)
	{
		case 0: strcpy_P(textBuf, PSTR("Checking Power Enable...")); break;
		case 1: strcpy_P(textBuf, PSTR("Checking ATmega UART2...")); break;
		case 2: strcpy_P(textBuf, PSTR("Checking DWIN UART1...")); break;
		case 3: strcpy_P(textBuf, PSTR("Checking Bridge Task...")); break;
		case 4: strcpy_P(textBuf, PSTR("Checking DWIN Link...")); break;
		case 5: strcpy_P(textBuf, PSTR("Checking SD Card...")); break;
		case 6: strcpy_P(textBuf, PSTR("Checking NVS Credentials...")); break;
		case 7: strcpy_P(textBuf, PSTR("Checking ESP WiFi Link...")); break;
		case 8: strcpy_P(textBuf, PSTR("Checking Portal Fallback...")); break;
		case 9: strcpy_P(textBuf, PSTR("Checking Network Services...")); break;
		default: strcpy_P(textBuf, PSTR("Checking System...")); break;
	}

	SetVarIcon(PAGE68_ICON_VP, (uint16_t)(PAGE68_ICON_INDEX_BASE + step));
	dwin_write_text(PAGE68_TEXT_VP, textBuf, PAGE68_TEXT_LEN);
}

static U08 subscription_isolation_page_active(void)
{
	U08 page = dwin_page_now;
	if ((page == WIFI_PAGE_SUB_EXPIRED) || (page == WIFI_PAGE_SUB_OFFLINE))
	{
		return 1U;
	}
	return wifi_is_guard_page(page);
}

static U08 subscription_hw_safe_page_active(void)
{
	U08 page = dwin_page_now;
	// BUGFIX: keep runtime outputs OFF on 7/61/63~68/73 safety pages.
	// Treat unknown page state as safety state during boot/noise windows.
	if ((page == 0) || (page == 0xFF))
	{
		return 1;
	}
	if ((page == WIFI_PAGE_SUB_EXPIRED) || (page == WIFI_PAGE_SUB_OFFLINE))
	{
		return 1;
	}
	if ((page == 7) || (page == WIFI_PAGE_CONNECTED) || (page == WIFI_PAGE_BOOT_CHECK))
	{
		return 1;
	}
	return wifi_is_guard_page(page);
}

static U08 subscription_hw_block_page_active(void)
{
	U08 page = dwin_page_now;
	// BUGFIX: block mode-loop runtime logic on pages that do not need mode touch parsing.
	// Keep runtime blocked while page state is unknown at boot.
	if ((page == 0) || (page == 0xFF))
	{
		return 1;
	}
	if ((page == WIFI_PAGE_SUB_EXPIRED) || (page == WIFI_PAGE_SUB_OFFLINE))
	{
		return 1;
	}
	if ((page == 7) || (page == WIFI_PAGE_BOOT_CHECK))
	{
		return 1;
	}
	return wifi_is_guard_page(page);
}

static void subscription_force_hw_isolation(void)
{
	// Keep runtime hardware outputs inactive while isolation pages are visible.
	// BUGFIX: keep AC(power-hold) ON in safety pages, but force all runtime outputs OFF.
	// Re-assert critical pin directions to survive noisy simultaneous-boot windows.
	DDRA |= (_BV(6) | _BV(7));
	DDRB |= _BV(4);
	DDRD |= (_BV(6) | _BV(7));
	g_hw_output_lock = 1;
	TIME_STOP;
	AC_ON;
	FAN_OFF;
	TEC_OFF;
	COOL_FAN_OFF;
	W_PUMP_OFF;
	H_LED_OFF;
	BRF_DISABLE;
	OUT_OFF;
	TC1_PWM_OFF;
}

static void page68_enter_hw_isolation(void)
{
	subscription_force_hw_isolation();
}

static void page68_leave_hw_isolation(void)
{
	// Keep power-hold stable across page68 -> target page transition.
	AC_ON;
}

U08 subscription_hw_isolation_tick(void)
{
	static U08 wasIsolated = 0;
	U08 safePage = subscription_hw_safe_page_active();

	if (safePage)
	{
		subscription_force_hw_isolation();
		wasIsolated = 1;
		// 61 page must keep touch handling alive; other safety pages are loop-blocked.
		return subscription_hw_block_page_active();
	}

	if (wasIsolated)
	{
		// Leaving isolation pages restores runtime timer gate.
		g_hw_output_lock = 0;
		TIME_START;
		AC_ON;
		wasIsolated = 0;
	}

	return 0;
}

static U08 page68_check_step_pass(U08 step, char *errCode, U08 errSz)
{
	if ((errCode != 0) && (errSz > 0))
	{
		errCode[0] = 0;
	}

	switch (step)
	{
		case 0:
			// Must stay on page68 after transition.
			if (dwin_page_now != WIFI_PAGE_BOOT_CHECK)
			{
				if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-01");
				return 0;
			}
			break;
		case 1:
			// Registration gate should already be completed.
			if (init_boot == 0)
			{
				if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-02");
				return 0;
			}
			break;
		case 2:
			// UART frame parser state must remain valid.
			if (p63_rx_state > 3)
			{
				if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-03");
				return 0;
			}
			break;
		case 3:
			// Bridge queue overflow on boot path indicates communication issue.
			if (sub_uart_drop)
			{
				if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-04");
				return 0;
			}
			break;
		case 4:
			// DWIN page tracker must stay valid.
			if ((dwin_page_now == 0) || (dwin_page_now == 0xFF))
			{
				if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-05");
				return 0;
			}
			break;
		case 5:
			// Internal Wi-Fi parser state sanity.
			if ((p63_wifi_connected_state != 0xFF) &&
			    (p63_wifi_connected_state != 0U) &&
			    (p63_wifi_connected_state != 1U))
			{
				if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-06");
				return 0;
			}
			break;
		case 6:
			// Runtime start page must be resolvable.
			if (startPage == 0)
			{
				if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-07");
				return 0;
			}
			break;
		case 7:
			// Queue integrity sanity check.
			if (sub_uart_q_count > SUB_UART_Q_DEPTH)
			{
				if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-08");
				return 0;
			}
			break;
		case 8:
			// No explicit fail condition; Wi-Fi disconnected is handled by page63 branch.
			break;
		case 9:
			// Final sanity: parser still valid.
			if (p63_rx_state > 3)
			{
				if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-10");
				return 0;
			}
			break;
		default:
			if ((errCode != 0) && (errSz > 0)) snprintf(errCode, errSz, "ERR68-XX");
			return 0;
	}

	return 1;
}

static void page68_fail_to_page10(const char *errCode)
{
	const char *code = (errCode != 0 && errCode[0] != 0) ? errCode : "ERR68-00";
	subscription_force_hw_isolation();
	pageChange(PAGE68_FAIL_PAGE);
	dwin_write_text(PAGE68_ERROR_VP, code, PAGE68_ERROR_TEXT_LEN);
}

static U08 page68_run_boot_checks(U08 resumePage)
{
	U08 step;
	U08 wifiConnected;
	uint16_t regWaitMs;
	uint16_t subWaitMs;
	uint16_t energyWaitMs;
	uint32_t nowSec;
	char errCode[PAGE68_ERROR_TEXT_LEN + 1];

	if (resumePage == 0)
	{
		resumePage = (startPage != 0) ? startPage : 1;
	}
	p63_boot_resume_page = resumePage;

	page68_enter_hw_isolation();
	pageChange(WIFI_PAGE_BOOT_CHECK);
	// Give DGUS a brief settle time after page switch before first VP update.
	page68_boot_step_wait_ms(120);

	for (step = 0; step < PAGE68_CHECK_COUNT; step++)
	{
		page68_set_step(step);
		page68_boot_step_wait_ms(PAGE68_STEP_MIN_MS);
		subscription_uart_pump_lines();
		if (!page68_check_step_pass(step, errCode, sizeof(errCode)))
		{
			page68_fail_to_page10(errCode);
			return 0;
		}
	}

	subscription_uart_pump_lines();
	// Require a fresh status frame after boot checks to avoid stale early state.
	p63_wifi_status_seen = 0;
	p63_wifi_connected_state = 0xFF;
	p63_wifi_last_seen_sec = 0;
	sub_state_seen = 0;
	sub_state_code = SUB_STATE_UNKNOWN;
	subscription_ready_pending_cancel();
	energy_reset_sync_state();
	g_energy_local_expired_lock = 0U;
	// Grace window: give ESP heartbeat (@P63|W|1) one more chance before deciding.
	if (!p63_wifi_status_seen)
	{
		// BUGFIX: widen first-boot status wait window for simultaneous power-on races.
		uint16_t waitMs = 1800;
		while ((waitMs > 0) && (!p63_wifi_status_seen))
		{
			asm("wdr");
			subscription_uart_pump_lines();
			_delay_ms(10);
			if (waitMs >= 10)
			{
				waitMs = (uint16_t)(waitMs - 10);
			}
			else
			{
				waitMs = 0;
			}
		}
	}
	wifiConnected = (p63_wifi_status_seen && (p63_wifi_connected_state == 1U)) ? 1U : 0U;

	if (wifiConnected && !reg_gate_status_seen)
	{
		regWaitMs = PAGE68_REG_STATUS_WAIT_MS;
		while ((regWaitMs > 0) && (!reg_gate_status_seen))
		{
			asm("wdr");
			subscription_uart_pump_lines();
			_delay_ms(10);
			if (regWaitMs >= 10)
			{
				regWaitMs = (uint16_t)(regWaitMs - 10);
			}
			else
			{
				regWaitMs = 0;
			}
		}
	}

	if (wifiConnected && reg_gate_status_seen && reg_gate_registered &&
	    ((!sub_state_seen) || (sub_state_code == SUB_STATE_READY)))
	{
		subWaitMs = PAGE68_SUB_STATUS_WAIT_MS;
		while ((subWaitMs > 0) && ((!sub_state_seen) || (sub_state_code == SUB_STATE_READY)))
		{
			asm("wdr");
			subscription_uart_pump_lines();
			_delay_ms(10);
			if (subWaitMs >= 10)
			{
				subWaitMs = (uint16_t)(subWaitMs - 10);
			}
			else
			{
				subWaitMs = 0;
			}
		}
	}

	if (wifiConnected && reg_gate_status_seen && reg_gate_registered &&
	    (sub_state_seen && (sub_state_code == SUB_STATE_ACTIVE)) && !energy_sync_ready())
	{
		energyWaitMs = PAGE68_ENERGY_STATUS_WAIT_MS;
		while ((energyWaitMs > 0) && (!energy_sync_ready()))
		{
			asm("wdr");
			subscription_uart_pump_lines();
			_delay_ms(10);
			if (energyWaitMs >= 10)
			{
				energyWaitMs = (uint16_t)(energyWaitMs - 10);
			}
			else
			{
				energyWaitMs = 0;
			}
		}
	}

	// BUGFIX: give DWIN a short settle window before final page transition.
	page68_boot_step_wait_ms(120);
	page68_leave_hw_isolation();

	if (wifiConnected)
	{
		U08 targetPage = resumePage;
		if (subscription_resolve_connected_target_page(resumePage, &targetPage))
		{
			pageChange(targetPage);
			p63_wifi_page_last_sent = targetPage;
			p63_boot_waiting_status = 0;
		}
		else
		{
			pageChange(WIFI_PAGE_LIST);
			// Keep waiting on page63 until REG/SUB state is explicitly delivered from ESP32.
			page68_boot_step_wait_ms(120);
			pageChange(WIFI_PAGE_LIST);
			p63_wifi_page_last_sent = WIFI_PAGE_LIST;
			p63_boot_waiting_status = 1;
		}
	}
	else
	{
		pageChange(WIFI_PAGE_LIST);
		// BUGFIX: retry page63 transition once more for simultaneous power-on races.
		page68_boot_step_wait_ms(120);
		pageChange(WIFI_PAGE_LIST);
		p63_wifi_page_last_sent = WIFI_PAGE_LIST;
		p63_boot_waiting_status = 1;
	}

	nowSec = p63_now_sec();
	p63_wifi_last_no_signal_sec = nowSec;
	if (p63_wifi_status_seen)
	{
		p63_wifi_last_seen_sec = nowSec;
		p63_wifi_boot_sec = nowSec;
	}
	else
	{
		p63_wifi_boot_sec = nowSec;
	}

	return 1;
}

static void registration_gate_tick(void)
{
	U08 wifiConnected;

	if (!reg_gate_status_seen)
	{
		return;
	}

	if (dwin_page_now == WIFI_PAGE_CONNECTING)
	{
		return;
	}

	if (reg_gate_registered)
	{
		if (dwin_page_now == WIFI_PAGE_REGISTER_WAIT)
		{
			registration_restore_registered_page();
			return;
		}

		wifiConnected = (p63_wifi_status_seen && (p63_wifi_connected_state == 1U)) ? 1U : 0U;
		if (!wifiConnected)
		{
			return;
		}
		registration_restore_registered_page();
		return;
	}

	wifiConnected = (p63_wifi_status_seen && (p63_wifi_connected_state == 1U)) ? 1U : 0U;
	if (!wifiConnected)
	{
		return;
	}

	if (!reg_gate_registered && (dwin_page_now != WIFI_PAGE_BOOT_CHECK) &&
	    (dwin_page_now != WIFI_PAGE_REGISTER_WAIT))
	{
		subscription_enter_lock_page(WIFI_PAGE_REGISTER_WAIT);
	}
}

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


// --- ESP32 PING/PONG (UART1) minimal debug hook ---
// UART1 is used for DWIN (dwin.c uses UDR1). When DWIN is disconnected and UART1
// is wired to ESP32, receiving ASCII "ping" will reply with "pong\r\n".
// This is kept extremely small to avoid impacting normal operation.
static volatile uint8_t pp_state = 0;
static inline void UART1_TX(uint8_t b){ while(!(UCSR1A & (1<<UDRE1))); UDR1 = b; }
static inline void UART1_TX_STR(const char* s){ while(*s) UART1_TX((uint8_t)*s++); }
// [NEW FEATURE] UART0 mirror helper for UART0-routed ESP bridge variants.
static inline void UART0_TX(uint8_t b){ while(!(UCSR0A & (1<<UDRE0))); UDR0 = b; }
// [NEW FEATURE] UART0 mirror helper for UART0-routed ESP bridge variants.
static inline void UART0_TX_STR(const char* s){ while(*s) UART0_TX((uint8_t)*s++); }
// [NEW FEATURE] Emit run-key energy update to ESP logger channel.
void energy_uart_publish_run_event(U08 runActive, uint32_t totalEnergyNow)
{
	char line[40];
	snprintf(line, sizeof(line), "@ENG|R|%u|%lu\n",
	         (unsigned int)(runActive ? 1U : 0U),
	         (unsigned long)totalEnergyNow);
	UART1_TX_STR(line);
	// [NEW FEATURE] Only mirror on UART0 when ESP headers were actually seen there.
	if (esp_bridge_uart0_seen)
	{
		UART0_TX_STR(line);
	}
}
static inline void subscription_uart_reset_line(void)
{
	sub_uart_active = 0;
	sub_uart_len = 0;
	sub_uart_drop = 0;
	sub_uart_bracket_mode = 0;
}

static inline U08 subscription_uart_is_text_char(uint8_t c)
{
	return ((c >= 0x20) && (c <= 0x7E)) ? 1U : 0U;
}

static inline void subscription_uart_isr_feed(uint8_t c)
{
	// Command lines from ESP32:
	//   @SUB|A|<PLAN>|<YYYY.MM.DD~YYYY.MM.DD>|<remain>\n
	//   [SUB] ACTIVE plan='<PLAN>' remain=<N> period='<YYYY.MM.DD~YYYY.MM.DD>'\n
	//   @P63|S|<slot:1-5>|<sec_or_lock>|<ascii_ssid>\n
	//   @P63|A|<0|1>\n
	//   @P63|B|<0|1>\n
	//   @P63|C\n
	//   @WIFI|S|<ssid>\n
	//   @WIFI|P|<password>\n
	//   @WIFI|G\n
	//   @WIFI|R|<0|1>\n
	//   @REG|<0|1>\n
	//   @ENG|A|<assigned_j>, @ENG|U|<used_j>, ... @ENG|R|<remaining_days>\n
	//   @OTA|Q|<current_version>|<target_version>\n
	//   @OTA|RST\n
	if (!sub_uart_active)
	{
		if (c == '@')
		{
			sub_uart_active = 1;
			sub_uart_len = 0;
			sub_uart_drop = 0;
			sub_uart_bracket_mode = 0;
		}
		else if (c == '[')
		{
			sub_uart_active = 1;
			sub_uart_len = 1;
			sub_uart_drop = 0;
			sub_uart_bracket_mode = 1;
			sub_uart_line[0] = '[';
		}
		return;
	}

	if ((c == '\r') || (c == '\n'))
	{
		if ((!sub_uart_drop) && (sub_uart_len > 0))
		{
			U08 copyLen;
			sub_uart_line[sub_uart_len] = 0;
			if (sub_uart_q_count < SUB_UART_Q_DEPTH)
			{
				copyLen = sub_uart_len;
				if (copyLen >= sizeof(sub_uart_queue[0]))
				{
					copyLen = sizeof(sub_uart_queue[0]) - 1;
				}
				memcpy(sub_uart_queue[sub_uart_q_head], sub_uart_line, copyLen);
				sub_uart_queue[sub_uart_q_head][copyLen] = 0;
				sub_uart_q_head = (U08)((sub_uart_q_head + 1) % SUB_UART_Q_DEPTH);
				sub_uart_q_count++;
				sub_uart_ready = 1;
			}
		}
		subscription_uart_reset_line();
		return;
	}

	// UART1 can carry DWIN binary frames. Reject non-ASCII bytes immediately.
	if (!subscription_uart_is_text_char(c))
	{
		subscription_uart_reset_line();
		return;
	}

	if (!sub_uart_drop)
	{
		U08 idx = 0;
		if (sub_uart_len + 1 < sizeof(sub_uart_line))
		{
			sub_uart_line[sub_uart_len++] = (char)c;
			idx = (U08)(sub_uart_len - 1);

			if (sub_uart_bracket_mode == 1)
			{
				if ((idx == 1) && (sub_uart_line[idx] != 'S'))
				{
					subscription_uart_reset_line();
				}
				else if ((idx == 2) && (sub_uart_line[idx] != 'U'))
				{
					subscription_uart_reset_line();
				}
				else if ((idx == 3) && (sub_uart_line[idx] != 'B'))
				{
					subscription_uart_reset_line();
				}
				else if ((idx == 4) && (sub_uart_line[idx] != ']'))
				{
					subscription_uart_reset_line();
				}
				else if (idx >= 4)
				{
					sub_uart_bracket_mode = 0;
				}
			}
			else
			{
					// Prefix gate for '@' commands:
						//   SUB|..., P63|..., WIFI|..., REG|..., ENG|..., OTA|...
						if (idx == 0)
						{
							if ((sub_uart_line[0] != 'S') &&
							    (sub_uart_line[0] != 'P') &&
							    (sub_uart_line[0] != 'W') &&
							    (sub_uart_line[0] != 'R') &&
							    (sub_uart_line[0] != 'E') &&
							    (sub_uart_line[0] != 'O'))
							{
								subscription_uart_reset_line();
							}
						}
				else if (sub_uart_line[0] == 'S')
				{
					if ((idx == 1) && (sub_uart_line[idx] != 'U'))
					{
						subscription_uart_reset_line();
					}
					else if ((idx == 2) && (sub_uart_line[idx] != 'B'))
					{
						subscription_uart_reset_line();
					}
					else if ((idx == 3) && (sub_uart_line[idx] != '|'))
					{
						subscription_uart_reset_line();
					}
				}
				else if (sub_uart_line[0] == 'P')
				{
					if ((idx == 1) && (sub_uart_line[idx] != '6'))
					{
						subscription_uart_reset_line();
					}
					else if ((idx == 2) && (sub_uart_line[idx] != '3'))
					{
						subscription_uart_reset_line();
					}
					else if ((idx == 3) && (sub_uart_line[idx] != '|'))
					{
						subscription_uart_reset_line();
					}
				}
					else if (sub_uart_line[0] == 'W')
					{
						if ((idx == 1) && (sub_uart_line[idx] != 'I'))
					{
						subscription_uart_reset_line();
					}
					else if ((idx == 2) && (sub_uart_line[idx] != 'F'))
					{
						subscription_uart_reset_line();
					}
					else if ((idx == 3) && (sub_uart_line[idx] != 'I'))
					{
						subscription_uart_reset_line();
					}
						else if ((idx == 4) && (sub_uart_line[idx] != '|'))
						{
							subscription_uart_reset_line();
						}
					}
					else if (sub_uart_line[0] == 'E')
					{
						if ((idx == 1) && (sub_uart_line[idx] != 'N'))
						{
							subscription_uart_reset_line();
						}
						else if ((idx == 2) && (sub_uart_line[idx] != 'G'))
						{
							subscription_uart_reset_line();
						}
						else if ((idx == 3) && (sub_uart_line[idx] != '|'))
						{
							subscription_uart_reset_line();
						}
					}
						else if (sub_uart_line[0] == 'R')
						{
						if ((idx == 1) && (sub_uart_line[idx] != 'E'))
						{
							subscription_uart_reset_line();
						}
						else if ((idx == 2) && (sub_uart_line[idx] != 'G'))
						{
							subscription_uart_reset_line();
						}
						else if ((idx == 3) && (sub_uart_line[idx] != '|'))
						{
							subscription_uart_reset_line();
							}
						}
						else if (sub_uart_line[0] == 'O')
						{
							if ((idx == 1) && (sub_uart_line[idx] != 'T'))
							{
								subscription_uart_reset_line();
							}
							else if ((idx == 2) && (sub_uart_line[idx] != 'A'))
							{
								subscription_uart_reset_line();
							}
							else if ((idx == 3) && (sub_uart_line[idx] != '|'))
							{
								subscription_uart_reset_line();
							}
						}
					}
		}
		else
		{
			// Oversized or malformed line: reset and wait for next header.
			subscription_uart_reset_line();
		}
	}
}
SIGNAL(USART0_RX_vect)
{
	uint8_t c = UDR0;
	rx0buf[write0Cnt++] = c;
	// [NEW FEATURE] Detect UART0-routed ESP bridge by command header bytes.
	if ((c == '@') || (c == '['))
	{
		esp_bridge_uart0_seen = 1;
	}
	// Some hardware revisions route ESP bridge text on UART0.
	subscription_uart_isr_feed(c);
}
SIGNAL(USART1_RX_vect)
{
	uint8_t c = UDR1;
	rxbuf[writeCnt++] = c;
	p63_isr_feed(c);
	// Some boards route ESP text bridge on UART1. Parser is prefix-gated and ASCII-filtered.
	if ((c == '@') || (c == '[') || (c == '\r') || (c == '\n') || ((c >= 0x20) && (c <= 0x7E)))
	{
		subscription_uart_isr_feed(c);
	}

	// PING/PONG detector: match p i n g (case-insensitive) on UART1
	switch(pp_state){
		case 0: pp_state = (c=='p' || c=='P') ? 1 : 0; break;
		case 1: pp_state = (c=='i' || c=='I') ? 2 : ((c=='p' || c=='P') ? 1 : 0); break;
		case 2: pp_state = (c=='n' || c=='N') ? 3 : 0; break;
		case 3:
		if(c=='g' || c=='G'){
			// Reply immediately; keeps working even inside mode loops.
			UART1_TX_STR("pong\r\n");
		}
		pp_state = 0;
		break;
	default: pp_state = 0; break;
	}
		// UART1 carries DWIN binary traffic in normal runtime.
}

SIGNAL(TIMER0_COMP_vect)
{
	wf_state = WATER_FLOW;
	wf_cnt++;
	if (p63_anim_on)
	{
		p63_anim_ms++;
	}
	if (page67_anim_running)
	{
		page67_tick++;
	}

	if (wf_state != prv_wf_state)
	{
		prv_wf_state = wf_state;
		if (wf_state)
		{
			wf_frq = WATER_M_FRQ / wf_cnt;
			wf_cnt = 0;
		}
	}
	else
	{
		if (wf_cnt > 10000)
		{
			wf_frq = 0;
		}
	}
	TCNT0 = 0;
}
SIGNAL(TIMER3_COMPA_vect)
{
	// sec_cnt++;
	// if(sec_cnt==30)
	{
		// sec_cnt=0;
		ckTime++;
	}
}
SIGNAL(INT4_vect)
{
	AC_OFF;
	FAN_OFF;
	TEC_OFF;
	asm("jmp 0");
}

int main(void)
{
#if defined(MCUSR)
	MCUSR = 0x00;
#elif defined(MCUCSR)
	MCUCSR = 0x00;
#endif
	wdt_disable();
	
	unsigned long ttTime0 = 0;
	unsigned long ttTime1 = 0;
	unsigned long ttTime2 = 0;
	U08 ttChecksum0 = 0;
	U08 ttChecksum1 = 0;
	U08 ttChecksum2 = 0;
	U08 bootResumePage = 0;
	
	U08 actCode[6]={0x20,0x20,0x20,0x20,0x20,0x20};
	
	U16 crc=0;

	
	Init_SYSTEM();
	
	_delay_ms(500); //(10);
	
	sei();
	
	
	AC_OFF;
	FAN_OFF;
	TEC_OFF;
	
	#if NEW_BOARD
	
	if(PW_SWITCH!=0)
	{
		//		sleep_enable();
		//		set_sleep_mode(SLEEP_MODE_IDLE);
		//		sleep_cpu();
		while(PW_SWITCH!=0)
		{
			_delay_ms(100);
		}
	}
	//	sleep_disable();
	#else
	LCD_ON;
	TEMP_SIMUL=1;
	#endif

	// BUGFIX: keep power-hold asserted during boot stabilization delay.
	AC_ON;
	_delay_ms(2000); //(10);
	_delay_ms(2000); //(10);
	//_delay_ms(2000); //(10);

	WDTCR = 0x18;
	WDTCR = 0x0f;

	
	foot_op = eeprom_read_byte(&TRIG_MODE);
	cool_ui_show = eeprom_read_byte(&COOL_UI);

	for (int i = 0; i < 40; i++)
	{
		pw_data[i] = eeprom_read_byte(&PW_VALUE[i]);
	}
	
	for (int i = 0; i < 40; i++)
	{
		pw_data_face[i] = eeprom_read_byte(&PW_VALUE_FACE[i]);
	}
	EM_SOUND=eeprom_read_byte(&SOUND_MODE);
	
	
	j16mode=eeprom_read_byte(&J16_MODE);
	
	init_boot = eeprom_read_byte(&INIT_BOOT);
	if(init_boot==0)
	{
		pageChange(7);
		actCode[0]=0x20;
		actCode[1]=0x20;
		actCode[2]=0x20;
		actCode[3]=0x20;
		actCode[4]=0x20;
		actCode[5]=0x20;
		showPasskey(actCode);
		TEXT_Display_Check_Code(0);
		while(1)
		{
			asm("wdr");
			// BUGFIX: page7 must stay in DWIN-only minimal mode (all runtime outputs OFF).
			subscription_force_hw_isolation();

			_delay_ms(10); //(10);
			
			while (writeCnt != readCnt)
			{
				asm("wdr");
				if (ckHeader)
				{
					// BUGFIX: guard parser buffer against UART noise during simultaneous boot.
					if (parsCnt < 10)
					{
						parsBuf[parsCnt++] = rxbuf[readCnt];
					}
					else
					{
						ckHeader = 0;
						parsCnt = 0;
					}
					if (ckHeader && (parsBuf[0] > 10))
					{
						ckHeader = 0;
						parsCnt = 0;
					}
					else if (ckHeader && (parsBuf[0] == (parsCnt - 1)))
					{
						crc = update_crc(&parsBuf[1], parsBuf[0] - 2);

						if (((crc & 0xff) == parsBuf[parsBuf[0]]) && ((crc >> 8) == parsBuf[parsBuf[0] - 1]))
						{

							if ((parsCnt > 6) && (parsBuf[1] == 0x83))
							{
								if(parsBuf[5]==0x21)
								{
									actCode[0]=actCode[1];
									actCode[1]=actCode[2];
									actCode[2]=actCode[3];
									actCode[3]=actCode[4];
									actCode[4]=actCode[5];
									actCode[5]=parsBuf[6];
								}
								else
								{
									if(parsBuf[6]==0xF0)
									{
										actCode[0]=0x20;
										actCode[1]=0x20;
										actCode[2]=0x20;
										actCode[3]=0x20;
										actCode[4]=0x20;
										actCode[5]=0x20;
									}
										else if(parsBuf[6]==0x0d)
										{
											TEXT_Display_Check_Code(0);
											U08 code_matched = 0;
											U08 next_dev_mode = 0;
#if DEBUG
											TX0_char('\r');
											TX0_char('\n');
											TX0_char('C');
											TX0_char(':');
											for (U08 ai = 0; ai < 6; ai++)
											{
												TX0_char(actCode[ai]);
											}
											TX0_char('\r');
											TX0_char('\n');
#endif
											if (((actCode[0] == 'M') || (actCode[0] == 'm')) && ((actCode[1] == 'A') || (actCode[1] == 'a')))
											{
												if ((actCode[2] == '1') && (actCode[3] == '3') && (actCode[4] == '5') && (actCode[5] == '8'))
												{
													next_dev_mode = 0x00;
													code_matched = 1;
												}
												else if ((actCode[2] == '8') && (actCode[3] == '5') && (actCode[4] == '4') && (actCode[5] == '1'))
												{
													next_dev_mode = 0x80;
													code_matched = 1;
												}
												else if ((actCode[2] == '2') && (actCode[3] == '4') && (actCode[4] == '6') && (actCode[5] == '9'))
												{
													next_dev_mode = 0x40;
													code_matched = 1;
												}
												else if ((actCode[2] == '5') && (actCode[3] == '1') && (actCode[4] == '0') && (actCode[5] == '5'))
												{
													next_dev_mode = 0x08;
													code_matched = 1;
												}
											}
											else if (((actCode[0] == 'M') || (actCode[0] == 'm')) && ((actCode[1] == 'U') || (actCode[1] == 'u')))
											{
												if ((actCode[2] == '2') && (actCode[3] == '3') && (actCode[4] == '4') && (actCode[5] == '6'))
												{
													next_dev_mode = 0x07;
													code_matched = 1;
												}
												else if ((actCode[2] == '7') && (actCode[3] == '6') && (actCode[4] == '5') && (actCode[5] == '3'))
												{
													next_dev_mode = 0x87;
													code_matched = 1;
												}
												else if ((actCode[2] == '3') && (actCode[3] == '4') && (actCode[4] == '5') && (actCode[5] == '7'))
												{
													next_dev_mode = 0x47;
													code_matched = 1;
												}
											}
											else if (((actCode[0] == 'E') || (actCode[0] == 'e')) && ((actCode[1] == 'U') || (actCode[1] == 'u')))
											{
												if ((actCode[2] == '3') && (actCode[3] == '5') && (actCode[4] == '7') && (actCode[5] == '8'))
												{
													next_dev_mode = 0x01;
													code_matched = 1;
												}
												else if ((actCode[2] == '6') && (actCode[3] == '4') && (actCode[4] == '2') && (actCode[5] == '1'))
												{
													next_dev_mode = 0x81;
													code_matched = 1;
												}
												else if ((actCode[2] == '4') && (actCode[3] == '6') && (actCode[4] == '8') && (actCode[5] == '9'))
												{
													next_dev_mode = 0x41;
													code_matched = 1;
												}
											}
											else if (((actCode[0] == 'L') || (actCode[0] == 'l')) && ((actCode[1] == 'H') || (actCode[1] == 'h')))
											{
												if ((actCode[2] == '5') && (actCode[3] == '4') && (actCode[4] == '1') && (actCode[5] == '8'))
												{
													next_dev_mode = 0x02;
													code_matched = 1;
												}
												else if ((actCode[2] == '4') && (actCode[3] == '5') && (actCode[4] == '8') && (actCode[5] == '1'))
												{
													next_dev_mode = 0x82;
													code_matched = 1;
												}
												else if ((actCode[2] == '6') && (actCode[3] == '5') && (actCode[4] == '2') && (actCode[5] == '9'))
												{
													next_dev_mode = 0x42;
													code_matched = 1;
												}
											}
											else if (((actCode[0] == 'A') || (actCode[0] == 'a')) && ((actCode[1] == 'F') || (actCode[1] == 'f')))
											{
												if ((actCode[2] == '9') && (actCode[3] == '1') && (actCode[4] == '0') && (actCode[5] == '8'))
												{
													next_dev_mode = 0x03;
													code_matched = 1;
												}
												else if ((actCode[2] == '0') && (actCode[3] == '8') && (actCode[4] == '9') && (actCode[5] == '1'))
												{
													next_dev_mode = 0x83;
													code_matched = 1;
												}
												else if ((actCode[2] == '0') && (actCode[3] == '2') && (actCode[4] == '1') && (actCode[5] == '9'))
												{
													next_dev_mode = 0x43;
													code_matched = 1;
												}
											}
											else if (((actCode[0] == 'U') || (actCode[0] == 'u')) && ((actCode[1] == 'M') || (actCode[1] == 'm')))
											{
												if ((actCode[2] == '4') && (actCode[3] == '5') && (actCode[4] == '6') && (actCode[5] == '8'))
												{
													next_dev_mode = 0x04;
													code_matched = 1;
												}
												else if ((actCode[2] == '5') && (actCode[3] == '4') && (actCode[4] == '3') && (actCode[5] == '1'))
												{
													next_dev_mode = 0x84;
													code_matched = 1;
												}
												else if ((actCode[2] == '5') && (actCode[3] == '6') && (actCode[4] == '7') && (actCode[5] == '9'))
												{
													next_dev_mode = 0x44;
													code_matched = 1;
												}
											}
											else if (((actCode[0] == 'H') || (actCode[0] == 'h')) && ((actCode[1] == 'E') || (actCode[1] == 'e')))
											{
												if ((actCode[2] == '7') && (actCode[3] == '8') && (actCode[4] == '1') && (actCode[5] == '8'))
												{
													next_dev_mode = 0x05;
													code_matched = 1;
												}
												else if ((actCode[2] == '2') && (actCode[3] == '1') && (actCode[4] == '8') && (actCode[5] == '1'))
												{
													next_dev_mode = 0x85;
													code_matched = 1;
												}
												else if ((actCode[2] == '8') && (actCode[3] == '9') && (actCode[4] == '2') && (actCode[5] == '9'))
												{
													next_dev_mode = 0x45;
													code_matched = 1;
												}
											}
											else if (((actCode[0] == 'F') || (actCode[0] == 'f')) && ((actCode[1] == 'L') || (actCode[1] == 'l')))
											{
												if ((actCode[2] == '0') && (actCode[3] == '7') && (actCode[4] == '8') && (actCode[5] == '8'))
												{
													next_dev_mode = 0x06;
													code_matched = 1;
												}
												else if ((actCode[2] == '9') && (actCode[3] == '2') && (actCode[4] == '1') && (actCode[5] == '1'))
												{
													next_dev_mode = 0x86;
													code_matched = 1;
												}
												else if ((actCode[2] == '1') && (actCode[3] == '8') && (actCode[4] == '9') && (actCode[5] == '9'))
												{
													next_dev_mode = 0x46;
													code_matched = 1;
												}
											}

											if (code_matched)
											{
												dev_mode = next_dev_mode;
#if DEBUG
												TX0_char('M');
												TX0_char(':');
												{
													U08 hb = (dev_mode >> 4) & 0x0f;
													U08 lb = dev_mode & 0x0f;
													TX0_char((hb < 10) ? (hb + '0') : (hb - 10 + 'A'));
													TX0_char((lb < 10) ? (lb + '0') : (lb - 10 + 'A'));
												}
												TX0_char('\r');
												TX0_char('\n');
#endif
												eeprom_update_byte(&OP_MODE, dev_mode);
												eeprom_busy_wait();

												eeprom_update_byte(&OP_MODE_CK, 0x100 - dev_mode);
												eeprom_busy_wait();

												eeprom_update_byte(&INIT_BOOT, 1);
												eeprom_busy_wait();
												showPasskey_null();
												while(1);
											}
#if DEBUG
											TX0_char('M');
											TX0_char(':');
											TX0_char('N');
											TX0_char('\r');
											TX0_char('\n');
#endif
											actCode[0]=0x20;
											actCode[1]=0x20;
											actCode[2]=0x20;
										actCode[3]=0x20;
										actCode[4]=0x20;
										actCode[5]=0x20;
										
										TEXT_Display_Check_Code(1);
									}
								}
								showPasskey(actCode);
								
							}
						}
						ckHeader = 0;
					}
					else if (parsBuf[0] < 6)
					{
						ckHeader = 0;
					}
				}
				else
				{
					if ((rxbuf[readCnt] == 0xA5) && (rxbuf[readCnt - 1] == 0x5A))
					{
						ckHeader = 1;
						parsCnt = 0;
					}
				}
				readCnt++;
			}
		}
	}
	dev_mode = eeprom_read_byte(&OP_MODE);
	if (((dev_mode + eeprom_read_byte(&OP_MODE_CK)) & 0xff) != 0)
	{
		errDisp();
		TEXT_Display_ERR_CODE("ERR CODE 04", 11);
		while (1)
		{
			asm("wdr");

			_delay_ms(10); //(10);
		}
	}
	else
	{
		cooling_ui_on(cool_ui_show);
		
		switch (dev_mode & 0x3f)
		{
			case 0:
			startPage=1;
			break;
			case 1:
			startPage=11;
			break;
			case 2:
			startPage=21;
			break;
			case 3:
			startPage=31;
			break;
			case 4:
			startPage=41;
			break;
			case 5:
			startPage=45;
			break;
			case 6:
			startPage=49;
			break;
			case 7:
			startPage=53;
			break;
			case 8:
			startPage=61;
			break;
			default:
			startPage=1;
			break;
		}
			if(((dev_mode&0x3f)==6) || ((dev_mode&0x3f)==2) || ((dev_mode&0x3f)==3)  || ((dev_mode&0x3f)==5))
			{
				sound_v=eeprom_read_byte(&SOUND_VOLUME);
				if(sound_v>3)
				sound_v=3;
			}
			else
			{
				sound_v=eeprom_read_byte(&SOUND_VOLUME);
			}
			if (startPage == 0)
			{
				startPage = 1;
			}
			bootResumePage = startPage;
			if (eeprom_read_byte(&WIFI_BOOT_PAGE61_ONCE) != 0)
			{
				eeprom_update_byte(&WIFI_BOOT_PAGE61_ONCE, 0);
				eeprom_busy_wait();
				bootResumePage = WIFI_PAGE_CONNECTED;
			}

					p63_wifi_connected_state = 0xFF;
					p63_wifi_status_seen = 0;
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
				p63_scan_busy = 0;
				p63_scan_busy_until_sec = 0;
				p63_fail_safe_stop = 0;

				if (!page68_run_boot_checks(bootResumePage))
				{
					while (1)
					{
						asm("wdr");
						subscription_ui_tick();
						subscription_force_hw_isolation();
						_delay_ms(10);
					}
				}

				if(((dev_mode&0x3f)==6) || ((dev_mode&0x3f)==2) || ((dev_mode&0x3f)==3)  || ((dev_mode&0x3f)==5))
				{
				audioVolume_Set(sound_v);
			}
			else
			{
				audioVolume_10Set(sound_v);
			}
		}
	lim_time = eeprom_read_dword(&LIMIT_TIME);
	if (((lim_time + eeprom_read_dword(&LIMIT_TIME_CK)) & 0xffffff) != 0)
	{
		lim_time = 900000;
	}
	TRON_200 = eeprom_read_byte(&TRON_200_MODE);
	if (((TRON_200 + eeprom_read_byte(&TRON_200_MODE_CK)) & 0xff) != 0)
	{
		errDisp();
		TEXT_Display_ERR_CODE("ERR CODE 05", 11);
		while (1)
		{
			asm("wdr");
			_delay_ms(10); //(10);
		}
	}

	ttTime0 = eeprom_read_dword(&TT_TIME0);
	ttTime1 = eeprom_read_dword(&TT_TIME1);
	ttTime2 = eeprom_read_dword(&TT_TIME2);

	ttChecksum0 = eeprom_read_byte(&TT_TIME_CHECKSUM0);
	ttChecksum1 = eeprom_read_byte(&TT_TIME_CHECKSUM1);
	ttChecksum2 = eeprom_read_byte(&TT_TIME_CHECKSUM2);

	if (((((U08 *)(&ttTime0))[0] + ((U08 *)(&ttTime0))[1] + ((U08 *)(&ttTime0))[2] + ((U08 *)(&ttTime0))[3]) & 0xff) != ttChecksum0)
	ttTime0 = 0;
	if (((((U08 *)(&ttTime1))[0] + ((U08 *)(&ttTime1))[1] + ((U08 *)(&ttTime1))[2] + ((U08 *)(&ttTime1))[3]) & 0xff) != ttChecksum1)
	ttTime1 = 0;
	if (((((U08 *)(&ttTime2))[0] + ((U08 *)(&ttTime2))[1] + ((U08 *)(&ttTime2))[2] + ((U08 *)(&ttTime2))[3]) & 0xff) != ttChecksum2)
	ttTime2 = 0;

	if (ttTime0 > ttTime1)
	{
		if (ttTime0 > ttTime2)
		{
			total_time = ttTime0;
			eep_s_num = 0;
		}
		else
		{
			total_time = ttTime2;
			eep_s_num = 2;
		}
	}
	else
	{
		if (ttTime1 > ttTime2)
		{
			total_time = ttTime1;
			eep_s_num = 1;
		}
		else
		{
			total_time = ttTime2;
			eep_s_num = 2;
		}
	}
	
	

		MaxPower = eeprom_read_byte(&PW_MAX);

		if (temp_err)
		TEXT_Display_TEMPERATURE(999);

		// Pages 63~67 must stay in DWIN-only isolation; defer runtime HW init
		// until the UI exits Wi-Fi setup/connecting pages.
		while (subscription_isolation_page_active())
		{
			asm("wdr");
			subscription_ui_tick();
			subscription_hw_isolation_tick();
			_delay_ms(10);
		}

		ETIFR = ETIFR | _BV(4);
		g_hw_output_lock = subscription_hw_safe_page_active() ? 1U : 0U;
		if (!subscription_hw_safe_page_active())
		{
			AC_ON;
			TIME_START;
		}
		else
		{
			// BUGFIX: keep outputs OFF when boot lands on 61/63~68 safety pages.
			subscription_force_hw_isolation();
		}

	LED_WHITE(WHITE_BRI);
	
	#if !DUAL_HAND
	if((j16mode==0) && (!subscription_hw_safe_page_active()))
	W_PUMP_ON;
	#endif
	
	// audioPlay();
	
	if (!subscription_hw_safe_page_active())
	FAN_ON;
	
	if(j16mode==1)
	H_LED_OFF;
	
	twi_init();
	//ds1307_dateset(0x0b0c0d0f);
	
	ins_date = eeprom_read_dword(&D_DATE);
	ds1307_init(0,&cur_date);
	if(cur_date>ins_date)
	{
		time_err=1;
	}
	else
	time_err=0;
	
		if (((dev_mode & 0x3f) == 6) || ((dev_mode & 0x3f) == 8))
		{
			main_tron();
		}
		else if ((dev_mode & 0x80) == 0x80)
		{
			Buzzer(sound_v);
			HICmode = 1;
			_delay_ms(1000);
			main_hic();
		}
	else if((dev_mode & 0x40) == 0x40)
	{
		UCSR0A = 0x02;
		UCSR0B = 0x98;
		UCSR0C = 0x06;
		
		UBRR0H = 0;
		UBRR0L = 34;
		
		BRFmode=1;
		main_brf();
	}
	else
	{
		main_tron();
	}
}
