/*
* tron_mode.c
*
* Created: 2024-04-03 오후 8:04:33
*  Author: imq
*/
#include "tron_mode.h"
#include "common.h"
#include "common_f.h"
#include "ads1115.h"
#include <util/delay.h>
#include <avr/eeprom.h>
#include "dwin.h"
#include "i2c.h"
#include "ds1307.h"

#define HSW_GL	3
#define MA5105_ICON_FORCE 1
#define MA5105_PAGE62_SECRET_KEY_A 0x8510
#define MA5105_PAGE62_SECRET_KEY_B 0x8511
#define MA5105_PAGE69_KEY_RETURN  0x2222
#define MA5105_PAGE69_KEY_ICON0   0x2201
#define MA5105_PAGE69_KEY_ICON1   0x2202
#define MA5105_PAGE69_KEY_ICON2   0x2203
#define MA5105_PAGE69_KEY_ICON3   0x2204
#define MA5105_PAGE69_KEY_ICON1000_SET0 0x1001
#define MA5105_PAGE69_KEY_ICON1000_SET1 0x1002
#define MA5105_PAGE69_KEY_MAX_POWER_DEC 0x2300
#define MA5105_PAGE69_KEY_MAX_POWER_INC 0x2301
#define MA5105_PAGE69_KEY_RESET 0x4019
#define MA5105_PAGE69_KEY_SAVE  0x4020
#define MA5105_PAGE69_KEY_PAGE70_HOLD 0xDDAA
#define MA5105_PAGE69_ICON2301_HIDE 1
#define MA5105_PAGE69_MIN_W 5
#define MA5105_PAGE69_MAX_W 200
#define MA5105_PAGE69_STEP_W 5
#define MA5105_PAGE69_SLOT_COUNT 9
#define MA5105_PAGE69_MAX_POWER_MIN 50
#define MA5105_PAGE69_MAX_POWER_MAX 200
#define MA5105_PAGE69_MAX_POWER_STEP 10

// [PAGE70 FEATURE] page IDs and key-map definitions.
#define MA5105_PAGE69_ID 69
#define MA5105_PAGE70_ID 70
#define MA5105_PAGE71_ID 71
#define MA5105_PAGE71_KEY_RETURN_TO_69 0xD311
#define MA5105_PAGE70_ICON_BASE 0xAA00
#define MA5105_PAGE70_ICON_FIRST 0xAA01
#define MA5105_PAGE70_ICON_LAST 0xAA06
#define MA5105_PAGE70_KEY_DIGIT_FIRST 0xBB00
#define MA5105_PAGE70_KEY_DIGIT_LAST  0xBB09
#define MA5105_PAGE70_KEY_ENTER 0xABCD
#define MA5105_PAGE70_KEY_BACKSPACE 0xDD00
#define MA5105_PAGE70_KEY_CLOSE 0xCC00
#define MA5105_PAGE70_PW_LEN 6
#define MA5105_PAGE70_HOLD_TICKS 100U

typedef struct
{
	U16 plus_key;
	U16 minus_key;
	U16 test_key;
	U16 icon_hundreds;
	U16 icon_tens;
	U16 icon_ones;
	U16 init_w;
} MA5105Page69Slot;

static const MA5105Page69Slot ma5105_page69_slots[MA5105_PAGE69_SLOT_COUNT] =
{
	{0x4001, 0x4002, 0x4101, 0x3301, 0x3302, 0x3303,   5},
	{0x4007, 0x4008, 0x4104, 0x3310, 0x3311, 0x3312,  25},
	{0x4013, 0x4014, 0x4107, 0x3319, 0x3320, 0x3321,  50},
	{0x4003, 0x4004, 0x4102, 0x3304, 0x3305, 0x3306,  75},
	{0x4009, 0x4010, 0x4105, 0x3313, 0x3314, 0x3315, 100},
	{0x4015, 0x4016, 0x4108, 0x3322, 0x3323, 0x3324, 125},
	{0x4005, 0x4006, 0x4103, 0x3307, 0x3308, 0x3309, 150},
	{0x4011, 0x4012, 0x4106, 0x3316, 0x3317, 0x3318, 175},
	{0x4017, 0x4018, 0x4109, 0x3325, 0x3326, 0x3327, 200}
};

U08 temp_date_buf[8];
U32 temp_date;

static void temp_date_clear()
{
	temp_date=0;
	temp_date_buf[0]=0;
	temp_date_buf[1]=0;
	temp_date_buf[2]=0;
	temp_date_buf[3]=0;
	temp_date_buf[4]=0;
	temp_date_buf[5]=0;
	temp_date_buf[6]=0;
	temp_date_buf[7]=0;
}

static U08 ma5105_mode(void)
{
	return (startPage == 61);
}

static U08 ma5105_page62_secret_cnt = 0;
static U08 ma5105_page69_icon0 = 0;
static U08 ma5105_page69_icon1 = 0;
static U08 ma5105_page69_icon2 = 0;
static U08 ma5105_page69_icon3 = 0;
static U08 ma5105_page69_icon1000 = 0;
static U08 ma5105_page69_icon2301 = MA5105_PAGE69_ICON2301_HIDE;
static U16 ma5105_page69_values[MA5105_PAGE69_SLOT_COUNT];
static U16 ma5105_page69_values_body[MA5105_PAGE69_SLOT_COUNT];
static U16 ma5105_page69_values_face[MA5105_PAGE69_SLOT_COUNT];
static const U08 ma5105_page69_curve_points[MA5105_PAGE69_SLOT_COUNT] = {0, 4, 9, 14, 19, 24, 29, 34, 39};
static U08 ma5105_page69_profiles_ready = 0;
static U08 ma5105_page69_test_on = 0;
static U08 ma5105_page69_test_slot = 0xFF;
static U08 ma5105_page69_prev_eng_show = 0;
static void ma5105_page69_profiles_load_once(void);
// [PAGE70 FEATURE] local state for hold-to-enter and numeric password input.
static U08 ma5105_page70_hold_active = 0;
static U16 ma5105_page70_hold_ticks = 0;
static U08 ma5105_page70_digits[MA5105_PAGE70_PW_LEN];
static U08 ma5105_page70_len = 0;
static U08 ma5105_page70_prev_page = 0xFF;
static void ma5105_page70_reset_state(void);
static void ma5105_page70_tick_10ms(void);
static U08 ma5105_page70_handle_hold_key(U16 keyCode);
static U08 ma5105_page70_handle_key(U16 keyCode);

// Sequence copy of legacy hidden key logic: A, A, B, B, A, A.
static U08 ma5105_page62_secret_step(U16 keyCode)
{
	if (keyCode == MA5105_PAGE62_SECRET_KEY_A)
	{
		if (ma5105_page62_secret_cnt < 2)
		{
			ma5105_page62_secret_cnt++;
		}
		else if (ma5105_page62_secret_cnt > 3)
		{
			ma5105_page62_secret_cnt++;
			if (ma5105_page62_secret_cnt == 6)
			{
				ma5105_page62_secret_cnt = 0;
				return 1;
			}
		}
		else
		{
			ma5105_page62_secret_cnt = 0;
		}
	}
	else if (keyCode == MA5105_PAGE62_SECRET_KEY_B)
	{
		if (ma5105_page62_secret_cnt > 1)
		{
			if (ma5105_page62_secret_cnt < 4)
			{
				ma5105_page62_secret_cnt++;
			}
			else
			{
				ma5105_page62_secret_cnt = 0;
			}
		}
		else
		{
			ma5105_page62_secret_cnt = 0;
		}
	}
	return 0;
}

static void ma5105_set_mode_icon(void)
{
	if (!ma5105_mode() || (MA5105_ICON_FORCE == 0))
	return;
	// 0x3006: 0->409, 1->410
	varIconInt(0x3006, body_face ? 1 : 0);
}

static void ma5105_set_sound_icon(void)
{
	U08 s;
	if (!ma5105_mode() || (MA5105_ICON_FORCE == 0))
	return;
	s = sound_v;
	if (s > 3)
	s = 3;
	// 0x3007: 0..3 -> 451..454
	varIconInt(0x3007, s);
}

static void ma5105_set_cool_icon(void)
{
	if (!ma5105_mode() || (MA5105_ICON_FORCE == 0))
	return;
	// 0x3008: 0->407(off), 1->408(on)
	varIconInt(0x3008, (peltier_op == 0) ? 1 : 0);
}

static void ma5105_set_run_icon(void)
{
	if (!ma5105_mode() || (MA5105_ICON_FORCE == 0))
	return;
	// 0x5001: 0->405(start), 1->406(stop)
	varIconInt(0x5001, (opPage & 0x02) ? 1 : 0);
}

static void ma5105_set_preset_default_icons(void)
{
	if (!ma5105_mode() || (MA5105_ICON_FORCE == 0))
	return;
	if (dwin_page_now == 63)
	return;
	varIconInt(0x3001, 0);
	varIconInt(0x3002, 0);
	varIconInt(0x3003, 0);
	varIconInt(0x3004, 0);
	varIconInt(0x3005, 0);
}

static void ma5105_set_preset_icons(U08 key)
{
	if (!ma5105_mode() || (MA5105_ICON_FORCE == 0))
	return;
	if (dwin_page_now == 63)
	return;
	// Keep sync-path compatibility: selectMem path uses 0x0A~0x0D for presets 2~5.
	if ((key >= 0x0A) && (key <= 0x0D))
	key = (U08)(key + 0x06);
	switch (key)
	{
		case 0x09:
		varIconInt(0x3001, 1);
		varIconInt(0x3002, 0);
		varIconInt(0x3003, 0);
		varIconInt(0x3004, 0);
		varIconInt(0x3005, 0);
		break;
		case 0x10:
		varIconInt(0x3001, 0);
		varIconInt(0x3002, 1);
		varIconInt(0x3003, 0);
		varIconInt(0x3004, 0);
		varIconInt(0x3005, 0);
		break;
		case 0x11:
		varIconInt(0x3001, 0);
		varIconInt(0x3002, 0);
		varIconInt(0x3003, 1);
		varIconInt(0x3004, 0);
		varIconInt(0x3005, 0);
		break;
		case 0x12:
		varIconInt(0x3001, 0);
		varIconInt(0x3002, 0);
		varIconInt(0x3003, 0);
		varIconInt(0x3004, 1);
		varIconInt(0x3005, 0);
		break;
		case 0x13:
		varIconInt(0x3001, 0);
		varIconInt(0x3002, 0);
		varIconInt(0x3003, 0);
		varIconInt(0x3004, 0);
		varIconInt(0x3005, 1);
		break;
		default:
		ma5105_set_preset_default_icons();
		break;
	}
}

static void ma5105_sync_page62_ui(void)
{
	if (!ma5105_mode())
	return;
	if (dwin_page_now == 63)
	return;
	pwDisp(opower);
	timeDisp(otime);
	TE_Display(old_totalEnergy);
	ma5105_set_mode_icon();
	ma5105_set_sound_icon();
	ma5105_set_cool_icon();
	ma5105_set_run_icon();
	if ((selectMem >= 1) && (selectMem <= 5))
	{
		ma5105_set_preset_icons(0x08 + selectMem);
	}
	else
	{
		ma5105_set_preset_default_icons();
	}
	TEXT_Display_TEMPERATURE(ntc_t);
}

// [PAGE70 FEATURE] clear six password VAR ICON slots (0xAA01~0xAA06).
static void ma5105_page70_clear_icons(void)
{
	U16 vp;
	for (vp = MA5105_PAGE70_ICON_FIRST; vp <= MA5105_PAGE70_ICON_LAST; vp++)
	{
		varIconInt(vp, 0);
	}
}

// [PAGE70 FEATURE] reset input buffer and icon state.
static void ma5105_page70_reset_state(void)
{
	U08 i;
	ma5105_page70_len = 0;
	for (i = 0; i < MA5105_PAGE70_PW_LEN; i++)
	{
		ma5105_page70_digits[i] = 0;
	}
	ma5105_page70_clear_icons();
}

// [PAGE70 FEATURE] arm 3-second hold timer for 0xDDAA on page69.
static void ma5105_page70_start_hold(void)
{
	ma5105_page70_hold_active = 1;
	ma5105_page70_hold_ticks = 0;
}

// [PAGE70 FEATURE] cancel pending hold timer.
static void ma5105_page70_cancel_hold(void)
{
	ma5105_page70_hold_active = 0;
	ma5105_page70_hold_ticks = 0;
}

// [PAGE70 FEATURE] detect page entry and initialize local page70 state.
static void ma5105_page70_entry_sync_if_needed(void)
{
	U08 pageNow = dwin_page_now;
	if (pageNow == ma5105_page70_prev_page)
	return;
	ma5105_page70_prev_page = pageNow;
	if (pageNow == MA5105_PAGE70_ID)
	{
		ma5105_page70_reset_state();
	}
	if (pageNow != MA5105_PAGE69_ID)
	{
		ma5105_page70_cancel_hold();
	}
}

// [PAGE70 FEATURE] reuse existing 10ms main loop tick for hold-time accumulation.
static void ma5105_page70_tick_10ms(void)
{
	ma5105_page70_entry_sync_if_needed();
	if (!ma5105_page70_hold_active)
	return;
	if (dwin_page_now != MA5105_PAGE69_ID)
	{
		ma5105_page70_cancel_hold();
		return;
	}
	if (ma5105_page70_hold_ticks < MA5105_PAGE70_HOLD_TICKS)
	{
		ma5105_page70_hold_ticks++;
	}
	if (ma5105_page70_hold_ticks >= MA5105_PAGE70_HOLD_TICKS)
	{
		ma5105_page70_cancel_hold();
		pageChange(MA5105_PAGE70_ID);
		ma5105_page70_reset_state();
	}
}

// [PAGE70 FEATURE] verify against existing numeric engineering code semantics.
static U08 ma5105_page70_password_ok(void)
{
	U08 i;
	static const U08 obf_ascii[MA5105_PAGE70_PW_LEN] = {
		0x68, 0x68, 0x69, 0x6B, 0x6E, 0x6F
	}; // ('2','2','3','1','4','5') ^ 0x5A

	if (ma5105_page70_len != MA5105_PAGE70_PW_LEN)
	return 0;
	for (i = 0; i < MA5105_PAGE70_PW_LEN; i++)
	{
		U08 expected = (U08)(obf_ascii[i] ^ 0x5A);
		if ((U08)(ma5105_page70_digits[i] + 0x30) != expected)
		return 0;
	}
	return 1;
}

// [PAGE70 FEATURE] page69 hold key handling (press/release).
static U08 ma5105_page70_handle_hold_key(U16 keyCode)
{
	if (keyCode == MA5105_PAGE69_KEY_PAGE70_HOLD)
	{
		ma5105_page70_start_hold();
		return 1;
	}
	// Some projects emit 0x0000 as release; treat any 0x00xx/0xDDxx as hold cancel.
	if (((keyCode & 0xFF00) == 0x0000) || ((keyCode & 0xFF00) == 0xDD00))
	{
		ma5105_page70_cancel_hold();
		return 1;
	}
	return 0;
}

// [PAGE70 FEATURE] page70 keypad/input/confirm/close logic.
static U08 ma5105_page70_handle_key(U16 keyCode)
{
	if (keyCode == MA5105_PAGE70_KEY_CLOSE)
	{
		ma5105_page70_reset_state();
		pageChange(MA5105_PAGE69_ID);
		return 1;
	}

	if (keyCode == MA5105_PAGE70_KEY_BACKSPACE)
	{
		if (ma5105_page70_len > 0)
		{
			varIconInt((U16)(MA5105_PAGE70_ICON_BASE + ma5105_page70_len), 0);
			ma5105_page70_len--;
			ma5105_page70_digits[ma5105_page70_len] = 0;
		}
		return 1;
	}

	if ((keyCode >= MA5105_PAGE70_KEY_DIGIT_FIRST) && (keyCode <= MA5105_PAGE70_KEY_DIGIT_LAST))
	{
		if (ma5105_page70_len < MA5105_PAGE70_PW_LEN)
		{
			U08 digit = (U08)(keyCode - MA5105_PAGE70_KEY_DIGIT_FIRST);
			ma5105_page70_digits[ma5105_page70_len] = digit;
			ma5105_page70_len++;
			varIconInt((U16)(MA5105_PAGE70_ICON_BASE + ma5105_page70_len), 1);
		}
		return 1;
	}

	if (keyCode == MA5105_PAGE70_KEY_ENTER)
	{
		if (ma5105_page70_password_ok())
		{
			pageChange(MA5105_PAGE71_ID);
		}
		else
		{
			ma5105_page70_reset_state();
		}
		return 1;
	}
	return 0;
}

static void ma5105_page69_write_value(U08 slot)
{
	U16 value;
	value = ma5105_page69_values[slot];
	varIconInt(ma5105_page69_slots[slot].icon_hundreds, (value / 100) % 10);
	varIconInt(ma5105_page69_slots[slot].icon_tens, (value / 10) % 10);
	varIconInt(ma5105_page69_slots[slot].icon_ones, value % 10);
}

static U16 ma5105_page69_sanitize_value(U16 value, U08 slot)
{
	if (value < MA5105_PAGE69_MIN_W)
	return ma5105_page69_slots[slot].init_w;
	if (value > MA5105_PAGE69_MAX_W)
	return ma5105_page69_slots[slot].init_w;
	if ((value % MA5105_PAGE69_STEP_W) != 0)
	return ma5105_page69_slots[slot].init_w;
	return value;
}

static void ma5105_page69_sync_curve_from_values(U08 face_mode, U16 *src)
{
	int start_v;
	int end_v;
	int diff;
	int value;
	U08 seg;
	U08 step;
	U08 i;
	U08 *curve;

	curve = face_mode ? pw_data_face : pw_data;
	for (i = 0; i < MA5105_PAGE69_SLOT_COUNT; i++)
	{
		U08 idx = ma5105_page69_curve_points[i];
		curve[idx] = (U08)ma5105_page69_sanitize_value(src[i], i);
	}
	// Keep interpolation local to avoid calling pw_auto_cal() on page69 key path.
	start_v = curve[0];
	end_v = curve[4];
	diff = end_v - start_v;
	for (i = 1; i < 4; i++)
	{
		value = start_v + ((diff * i + ((diff >= 0) ? 2 : -2)) / 4);
		if (value < 0)
		value = 0;
		else if (value > 255)
		value = 255;
		curve[i] = (U08)value;
	}
	for (seg = 0; seg < 7; seg++)
	{
		U08 seg_start_idx = 4 + (seg * 5);
		U08 seg_end_idx = seg_start_idx + 5;
		start_v = curve[seg_start_idx];
		end_v = curve[seg_end_idx];
		diff = end_v - start_v;
		for (step = 1; step < 5; step++)
		{
			value = start_v + ((diff * step + ((diff >= 0) ? 2 : -2)) / 5);
			if (value < 0)
			value = 0;
			else if (value > 255)
			value = 255;
			curve[seg_start_idx + step] = (U08)value;
		}
		asm("wdr");
	}
}

static void ma5105_page69_persist_curve_eeprom(U08 face_mode)
{
	U08 i;
	U08 *curve;

	curve = face_mode ? pw_data_face : pw_data;
	for (i = 0; i < 40; i++)
	{
		if (face_mode)
		eeprom_update_byte(&PW_VALUE_FACE[i], curve[i]);
		else
		eeprom_update_byte(&PW_VALUE[i], curve[i]);
		eeprom_busy_wait();
		if ((i & 0x07) == 0)
		asm("wdr");
	}
}

static void ma5105_page69_load_profile_from_eeprom(U08 face_mode, U16 *dst)
{
	U08 i;
	U08 *curve;
	curve = face_mode ? pw_data_face : pw_data;
	for (i = 0; i < MA5105_PAGE69_SLOT_COUNT; i++)
	{
		U08 idx = ma5105_page69_curve_points[i];
		U08 raw = curve[idx];
		dst[i] = ma5105_page69_sanitize_value((U16)raw, i);
	}
}

static void ma5105_page69_save_profile_to_eeprom(U08 face_mode, U16 *src)
{
	U08 i;
	for (i = 0; i < MA5105_PAGE69_SLOT_COUNT; i++)
	{
		U08 idx = ma5105_page69_curve_points[i];
		U16 value = ma5105_page69_sanitize_value(src[i], i);
		if (face_mode)
		eeprom_update_byte(&PW_VALUE_FACE[idx], (U08)value);
		else
		eeprom_update_byte(&PW_VALUE[idx], (U08)value);
		eeprom_busy_wait();
		asm("wdr");
	}
}

static void ma5105_page69_profiles_load_once(void)
{
	if (ma5105_page69_profiles_ready)
	return;
	ma5105_page69_load_profile_from_eeprom(0, ma5105_page69_values_body);
	ma5105_page69_load_profile_from_eeprom(1, ma5105_page69_values_face);
	ma5105_page69_profiles_ready = 1;
}

static void ma5105_page69_store_active_to_runtime_values_only(void)
{
	U08 i;
	U16 *dst;
	ma5105_page69_profiles_load_once();
	dst = body_face ? ma5105_page69_values_face : ma5105_page69_values_body;
	for (i = 0; i < MA5105_PAGE69_SLOT_COUNT; i++)
	{
		dst[i] = ma5105_page69_sanitize_value(ma5105_page69_values[i], i);
		asm("wdr");
	}
}

static void ma5105_page69_store_active_to_runtime(void)
{
	ma5105_page69_store_active_to_runtime_values_only();
	ma5105_page69_sync_curve_from_values(body_face ? 1 : 0,
		body_face ? ma5105_page69_values_face : ma5105_page69_values_body);
}

static void ma5105_page69_apply_runtime_for_mode(U08 face_mode)
{
	U08 i;
	U16 *src;
	ma5105_page69_profiles_load_once();
	src = face_mode ? ma5105_page69_values_face : ma5105_page69_values_body;
	for (i = 0; i < MA5105_PAGE69_SLOT_COUNT; i++)
	{
		ma5105_page69_values[i] = ma5105_page69_sanitize_value(src[i], i);
		ma5105_page69_write_value(i);
	}
}

static void ma5105_page69_reset_active_profile(void)
{
	U08 i;
	U08 face_mode;
	U16 *dst;

	ma5105_page69_profiles_load_once();
	face_mode = body_face ? 1 : 0;
	dst = face_mode ? ma5105_page69_values_face : ma5105_page69_values_body;
	for (i = 0; i < MA5105_PAGE69_SLOT_COUNT; i++)
	{
		dst[i] = ma5105_page69_slots[i].init_w;
		ma5105_page69_values[i] = dst[i];
		ma5105_page69_write_value(i);
		asm("wdr");
	}
	// Match page9 reset semantics (0x812E): reset + immediate EEPROM persist.
	ma5105_page69_save_profile_to_eeprom(face_mode, dst);
}

static void ma5105_page69_save_active_profile(void)
{
	U08 face_mode;
	U16 *src;
	ma5105_page69_profiles_load_once();
	ma5105_page69_store_active_to_runtime();
	face_mode = body_face ? 1 : 0;
	src = face_mode ? ma5105_page69_values_face : ma5105_page69_values_body;
	// Match page9 save semantics (0x812F): persist current side only.
	ma5105_page69_save_profile_to_eeprom(face_mode, src);
	ma5105_page69_persist_curve_eeprom(face_mode);
}

static void ma5105_page69_normalize_body_face(void)
{
	if (body_face > 1)
	body_face = 0;
}

static void ma5105_page69_sync_cool_mode_icon(void)
{
	if (cool_ui_show > 2)
	cool_ui_show = 0;
	ma5105_page69_icon0 = cool_ui_show;
	varIconInt(0x2000, ma5105_page69_icon0);
}

static void ma5105_page69_sync_foot_switch_icon(void)
{
	if (foot_op > 1)
	foot_op = 0;
	ma5105_page69_icon1 = foot_op;
	varIconInt(0x2001, ma5105_page69_icon1);
}

static void ma5105_page69_sync_j16_pump_icon(void)
{
	if (j16mode > 1)
	j16mode = 0;
	// Requested mapping: 0 -> LED, 1 -> PUMP.
	ma5105_page69_icon2 = (j16mode == 0) ? 1 : 0;
	varIconInt(0x2002, ma5105_page69_icon2);
}

static void ma5105_page69_sync_sound_icon(void)
{
	if (EM_SOUND > 1)
	EM_SOUND = 1;
	// Requested mapping: 0 -> Buzzer, 1 -> audioPlay.
	ma5105_page69_icon3 = EM_SOUND;
	varIconInt(0x2003, ma5105_page69_icon3);
}

static void ma5105_page69_sync_body_face_icon(void)
{
	ma5105_page69_normalize_body_face();
	ma5105_page69_icon1000 = body_face ? 1 : 0;
	varIconInt(0x1000, ma5105_page69_icon1000);
}

static void ma5105_page69_sync_max_power_icons(void)
{
	U16 value = MaxPower;
	if (value < MA5105_PAGE69_MAX_POWER_MIN)
	value = MA5105_PAGE69_MAX_POWER_MIN;
	else if (value > MA5105_PAGE69_MAX_POWER_MAX)
	value = MA5105_PAGE69_MAX_POWER_MAX;
	MaxPower = (U08)value;
	varIconInt(0x5001, (value / 100) % 10);
	varIconInt(0x5002, (value / 10) % 10);
	varIconInt(0x5003, value % 10);
}

static void ma5105_page69_toggle_cool_mode(void)
{
	if (cool_ui_show == 0)
	{
		cool_ui_show = 1;
	}
	else if (cool_ui_show == 1)
	{
		cool_ui_show = 2;
	}
	else
	{
		cool_ui_show = 0;
	}
	eeprom_update_byte(&COOL_UI, cool_ui_show);
	eeprom_busy_wait();
	TEXT_Display_COOL_UI_mode(cool_ui_show);
	ma5105_page69_sync_cool_mode_icon();
}

static void ma5105_page69_toggle_foot_switch(void)
{
	if (foot_op)
	{
		foot_op = 0;
	}
	else
	{
		foot_op = 1;
	}
	eeprom_update_byte(&TRIG_MODE, foot_op);
	eeprom_busy_wait();
	TEXT_Display_TRIG_mode(foot_op);
	ma5105_page69_sync_foot_switch_icon();
}

static void ma5105_page69_toggle_j16_mode(void)
{
	if (j16mode == 0)
	j16mode = 1;
	else
	j16mode = 0;
	eeprom_update_byte(&J16_MODE, j16mode);
	eeprom_busy_wait();
	j16mode_ui(j16mode);//0 : pump , 1: led
	ma5105_page69_sync_j16_pump_icon();
}

static void ma5105_page69_toggle_sound_mode(void)
{
	if (EM_SOUND == 0)
	EM_SOUND = 1;
	else
	EM_SOUND = 0;
	eeprom_update_byte(&SOUND_MODE, EM_SOUND);
	eeprom_busy_wait();
	sound_mode_ui(EM_SOUND);//0 : buzzer , 1 : speaker(audioPlay)
	ma5105_page69_sync_sound_icon();
}

static void ma5105_page69_select_body_face(U08 face_mode)
{
	ma5105_page69_normalize_body_face();
	if (face_mode)
	{
		if (body_face == 0)
		{
			sBody_pw = opower;
			opower = sFace_pw;
		}
		body_face = 1;
		if (opower > 80)
		opower = 80;
	}
	else
	{
		if (body_face == 1)
		{
			sFace_pw = opower;
			opower = sBody_pw;
		}
		body_face = 0;
	}

	if (selectMem != 0)
	{
		selectMem = 0;
		MEM_Display(selectMem);
	}
	ma5105_page69_sync_body_face_icon();
}

static void ma5105_page69_adjust_max_power(U08 increase)
{
	U16 value = MaxPower;
	if (increase)
	{
		if (value <= (MA5105_PAGE69_MAX_POWER_MAX - MA5105_PAGE69_MAX_POWER_STEP))
		value += MA5105_PAGE69_MAX_POWER_STEP;
		else
		value = MA5105_PAGE69_MAX_POWER_MAX;
	}
	else
	{
		if (value >= (MA5105_PAGE69_MAX_POWER_MIN + MA5105_PAGE69_MAX_POWER_STEP))
		value -= MA5105_PAGE69_MAX_POWER_STEP;
		else
		value = MA5105_PAGE69_MAX_POWER_MIN;
	}
	MaxPower = (U08)value;
	setMAXPower(MaxPower);
	eeprom_update_byte(&PW_MAX, MaxPower);
	eeprom_busy_wait();
	ma5105_page69_sync_max_power_icons();
}

static void ma5105_page69_force_visible(void)
{
	// 0x2301 group must stay shown so 0x3301 is always visible.
	ma5105_page69_icon2301 = 0;
	varIconInt(0x2301, ma5105_page69_icon2301);
	ma5105_page69_sync_cool_mode_icon();
	ma5105_page69_sync_foot_switch_icon();
	ma5105_page69_sync_j16_pump_icon();
	ma5105_page69_sync_sound_icon();
	ma5105_page69_sync_body_face_icon();
	ma5105_page69_sync_max_power_icons();
	varIconInt(0x3301, (ma5105_page69_values[0] / 100) % 10);
	varIconInt(0x3302, (ma5105_page69_values[0] / 10) % 10);
	varIconInt(0x3303, ma5105_page69_values[0] % 10);
}

static void ma5105_page69_stop_test(void)
{
	if (ma5105_page69_test_on == 0)
	return;
	ma5105_page69_test_on = 0;
	ma5105_page69_test_slot = 0xFF;
	eng_emi = 0;
	eng_show = ma5105_page69_prev_eng_show;
	TC1_PWM_OFF;
	OUT_OFF;
	RIM_pause = 1;
	TCNT3 = 0;
	if (j16mode == 1)
	H_LED_OFF;
	ma5105_page69_force_visible();
}

static void ma5105_page69_start_test(U08 slot)
{
	U16 value;
	if (ma5105_page69_test_on == 0)
	{
		ma5105_page69_prev_eng_show = eng_show;
	}
	value = ma5105_page69_values[slot];
	if (value < MA5105_PAGE69_MIN_W)
	value = MA5105_PAGE69_MIN_W;
	else if (value > MA5105_PAGE69_MAX_W)
	value = MA5105_PAGE69_MAX_W;
	ma5105_page69_values[slot] = value;
	eng_show = 1;
	eng_emi = 1;
	setPower(value);
	TC1_PWM_ON;
	OUT_ON;
	RIM_pause = 0;
	TCNT3 = 0;
	if (j16mode == 1)
	W_PUMP_ON;
	ma5105_page69_test_on = 1;
	ma5105_page69_test_slot = slot;
	ma5105_page69_force_visible();
}

static void ma5105_page69_reset_icons(void)
{
	ma5105_page69_stop_test();
	ma5105_page69_apply_runtime_for_mode(body_face ? 1 : 0);
	ma5105_page69_sync_max_power_icons();
	setMAXPower(MaxPower);
	ma5105_page69_force_visible();
}

static void ma5105_page69_reboot_now(void)
{
	eeprom_busy_wait();
	_delay_ms(20);
	asm("jmp 0");
}

static U08 ma5105_page69_handle_key(U16 keyCode)
{
	U08 i;
	ma5105_page69_force_visible();
	if (keyCode == MA5105_PAGE69_KEY_RETURN)
	{
		ma5105_page69_store_active_to_runtime();
		ma5105_page69_stop_test();
		pageChange(62);
		_delay_ms(80);
		ma5105_sync_page62_ui();
		return 1;
	}
	if (keyCode == MA5105_PAGE69_KEY_RESET)
	{
		ma5105_page69_reset_active_profile();
		if ((ma5105_page69_test_on != 0) && (ma5105_page69_test_slot < MA5105_PAGE69_SLOT_COUNT))
		{
			ma5105_page69_start_test(ma5105_page69_test_slot);
		}
		ma5105_page69_force_visible();
		return 1;
	}
	if (keyCode == MA5105_PAGE69_KEY_SAVE)
	{
		ma5105_page69_save_active_profile();
		ma5105_page69_stop_test();
		ma5105_page69_reboot_now();
		return 1;
	}

	for (i = 0; i < MA5105_PAGE69_SLOT_COUNT; i++)
	{
		U16 value;
			if (keyCode == ma5105_page69_slots[i].plus_key)
			{
				value = ma5105_page69_values[i];
				if (value <= (MA5105_PAGE69_MAX_W - MA5105_PAGE69_STEP_W))
				value += MA5105_PAGE69_STEP_W;
				else
					value = MA5105_PAGE69_MAX_W;
					ma5105_page69_values[i] = value;
					ma5105_page69_write_value(i);
					if ((ma5105_page69_test_on != 0) && (ma5105_page69_test_slot == i))
					{
						ma5105_page69_start_test(i);
					}
			return 1;
		}
			if (keyCode == ma5105_page69_slots[i].minus_key)
			{
				value = ma5105_page69_values[i];
				if (value >= (MA5105_PAGE69_MIN_W + MA5105_PAGE69_STEP_W))
				value -= MA5105_PAGE69_STEP_W;
				else
					value = MA5105_PAGE69_MIN_W;
					ma5105_page69_values[i] = value;
					ma5105_page69_write_value(i);
					if ((ma5105_page69_test_on != 0) && (ma5105_page69_test_slot == i))
					{
						ma5105_page69_start_test(i);
					}
			return 1;
		}
		if (keyCode == ma5105_page69_slots[i].test_key)
		{
			if ((ma5105_page69_test_on != 0) && (ma5105_page69_test_slot == i))
			{
				ma5105_page69_stop_test();
			}
			else
			{
				ma5105_page69_stop_test();
				ma5105_page69_start_test(i);
			}
			return 1;
		}
	}

	// Legacy hidden keys are consumed as no-op to avoid overwriting page69 numeric VPs.
	switch (keyCode)
	{
		case MA5105_PAGE69_KEY_ICON0:
		ma5105_page69_toggle_cool_mode();
		ma5105_page69_force_visible();
		return 1;
		case MA5105_PAGE69_KEY_ICON1:
		ma5105_page69_toggle_foot_switch();
		ma5105_page69_force_visible();
		return 1;
		case MA5105_PAGE69_KEY_ICON2:
		ma5105_page69_toggle_j16_mode();
		ma5105_page69_force_visible();
		return 1;
		case MA5105_PAGE69_KEY_ICON3:
		ma5105_page69_toggle_sound_mode();
		ma5105_page69_force_visible();
		return 1;
			case MA5105_PAGE69_KEY_ICON1000_SET0:
			// 0x1001: Face select button
			ma5105_page69_store_active_to_runtime_values_only();
			ma5105_page69_select_body_face(1);
			ma5105_page69_apply_runtime_for_mode(body_face ? 1 : 0);
			if ((ma5105_page69_test_on != 0) && (ma5105_page69_test_slot < MA5105_PAGE69_SLOT_COUNT))
			{
				ma5105_page69_start_test(ma5105_page69_test_slot);
			}
		ma5105_page69_force_visible();
		return 1;
			case MA5105_PAGE69_KEY_ICON1000_SET1:
			// 0x1002: Body select button
			ma5105_page69_store_active_to_runtime_values_only();
			ma5105_page69_select_body_face(0);
			ma5105_page69_apply_runtime_for_mode(body_face ? 1 : 0);
			if ((ma5105_page69_test_on != 0) && (ma5105_page69_test_slot < MA5105_PAGE69_SLOT_COUNT))
			{
				ma5105_page69_start_test(ma5105_page69_test_slot);
			}
		ma5105_page69_force_visible();
		return 1;
		case MA5105_PAGE69_KEY_MAX_POWER_DEC:
		ma5105_page69_adjust_max_power(0);
		ma5105_page69_force_visible();
		return 1;
		case MA5105_PAGE69_KEY_MAX_POWER_INC:
		ma5105_page69_adjust_max_power(1);
		ma5105_page69_force_visible();
		return 1;
		default:
		return 0;
	}
}

void main_tron()
{
	U08 factory_cnt=0;
	U16 crc;
	U08 adc_buf[2];
	U16 temp_adc=0;
	U32 temp_volt=1700;
	int temp_r=0;
	int temp_cal=0;
	U08 adc_ok=0;

	U08 adc_read_err_cnt=0;
	U08 btn_state=0;
	U08 hand_sw_push_cnt=0;
	U08 hand_sw_release_cnt=0;
	U08 temp_raw[2];
	U08 adc_fail=0;
	U08 ma5105_sync_div = 0;
	U08 ma5105_page69_init_done = 0;
	
	U08 select_date=0;
	
	sFace_pw=opower;
	sBody_pw=opower;	
	
	

	if((startPage != 21 ) && (startPage != 49 ) && (startPage != 45 ) && (startPage != 61 ))
	{
		for(int i=0;i<10;i++)
		{
			varIconInt(0x1000,i);
			asm("wdr");
			_delay_ms(300);
		}
		audioPlay(2 + (dev_mode & 0x3f));
		
		pageChange(startPage+2);
		setModeBtn(body_face);
		_delay_ms(100);
		init_boot = 1;
		peltier_op = 0;
		pwDisp(opower);
		timeDisp(otime);

		LED_Display(2);
		if(j16mode==1)
		H_LED_OFF;
		COOL_FAN_ON;
		writeCnt=0;
		}
	//	setDateMode();
		//ADMUX=(ADMUX&0xf0)|0x01;
		//ADCSRA=ADCSRA | 0x50;

	if (ma5105_mode())
	{
		// Keep runtime state initialized, but do not write runtime VP values on page 61.
		init_boot = 1;
		peltier_op = 0;
			if (j16mode == 1)
			H_LED_OFF;
			// BUGFIX: keep cooling fan OFF while MA5105 safety page(61) is active.
			COOL_FAN_OFF;
		}
		
		while (1)
		{
			asm("wdr");
			//		readBTN();
			_delay_ms(10); //(10);
			subscription_ui_tick();
			if (subscription_hw_isolation_tick())
			{
				continue;
			}
			if (ma5105_mode())
			{
				// [PAGE70 FEATURE] hold-to-enter timer tick on existing 10ms main loop.
				ma5105_page70_tick_10ms();
				if (dwin_page_now == 69)
				{
					if (ma5105_page69_init_done == 0)
						{
							ma5105_page69_reset_icons();
							ma5105_page69_init_done = 1;
						}
						ma5105_page69_force_visible();
						ma5105_sync_div = 0;
					}
					else if (dwin_page_now == 62)
					{
						ma5105_page69_init_done = 0;
						if (++ma5105_sync_div >= 20)
						{
							ma5105_sync_div = 0;
							ma5105_sync_page62_ui();
						}
					}
					else
					{
						ma5105_page69_init_done = 0;
						ma5105_sync_div = 0;
					}
				}
					
			#if NEW_BOARD
		
		if(adc_ok)
		{
			adc_ok=0;
			if(adc_read(temp_raw)==0)
			{
				if(temp_raw[0]&0x80)
				{
					temp_adc=0x1000-(((U16)temp_raw[0]<<4)+(temp_raw[1]>>4));
				}
				else
				{
					temp_adc=(((U16)temp_raw[0]<<4)+(temp_raw[1]>>4));
				}
				temp_volt = (double)(temp_adc * 0.002998*1000);
				temp_r=(2200*temp_volt)/(5000-temp_volt)-5;//PT1000
				if((temp_r<1300) && (temp_r>500))
				{
					temp_cal=(int)((float)(temp_r-1000)*0.2564*10);
					TEXT_Display_TEMPERATURE(temp_cal);
				}
				else
				{
					TEMP_SIMUL=1;
					temp_cal=0;
				}
				
				//if(init_boot==1)
				
			}
			
		}
		#endif
		if (init_boot == 1)
		{
			/*if(wf_err_cnt==100)
			{
			TEST_Display(wf_frq);
			wf_err_cnt=0;
			}*/
			if (WATER_LEVEL)
			{
				wl_err_cnt++;
				
				if(wl_err_cnt>100)
				{
					
					
					OUT_OFF;
					RIM_pause = 1;
					on_cnt = 0;
					off_cnt = 0;
					setStandby();
					opPage = 1;
					errDisp();
					if(j16mode==0)
					W_PUMP_OFF;
					TEC_OFF;
					TEXT_Display_ERR_CODE("EMERGENCY  ", 11);
					while (1)
					{
						if(WATER_LEVEL)
						{
							asm("wdr");
						}
						_delay_ms(10);
					}
				}
			}
			else
			{
				wl_err_cnt=0;
				//	TEST_Display(wf_frq);
				if (wf_frq > 1)
				{
					wf_err_cnt = 0;
				}
				else
				{
					if (wf_err_cnt > 1000)
					{
						OUT_OFF;
						RIM_pause = 1;
						on_cnt = 0;
						off_cnt = 0;
						setStandby();
						opPage = 1;
						errDisp();
						if(j16mode==0)
						W_PUMP_OFF;
						TEC_OFF;
						TEXT_Display_ERR_CODE("ERR CODE 06", 11);
						while (1)
						{
							asm("wdr");
						}
					}
					else
					{
						#if FLOW_ON
						if ((eng_show == 0) && (j16mode==0))
						wf_err_cnt++;
						#endif
					}
				}
			}
		}		
	//	if(peltier_op == 0) // && (opPage==2)) // 0:on, 1:off
	//	if (((((opPage & 0x04) == 0x04) && (foot_op)) || (((opPage & 0x02) == 0x02) && (!foot_op))) && (peltier_op==0))		
		if(peltier_op==0)
		{
			if((cool_ui_show==1) || ((cool_ui_show==2)&&((((opPage & 0x04) == 0x04) && (foot_op)) || (((opPage & 0x02) == 0x02) && (!foot_op)))))
			{			
				if(TEMP_SIMUL)
				{
					TEC_ON;
				}
				else
				{
					if(temp_cal>50)
					{
						TEC_ON;
					}
					else if(temp_cal<10)
					{
						TEC_OFF;
					}
				}			
			}
			else
			{
				TEC_OFF;
			}
		}
		else
		{
			TEC_OFF;
		}
		
		if ((totalEnergy) != old_totalEnergy)
		{
			old_totalEnergy = (totalEnergy);
			TE_Display(old_totalEnergy);
		}
		

		if (foot_op)
		{
			if (RF_TRIGER != old_triger)
			{
				triger_cnt++;
				if (triger_cnt > TRIG_PUSH_CNT)
				{
					old_triger = RF_TRIGER;
					if (old_triger != 0)
					{
						if (opPage & 0x02)
						{
							if (opPage & 0x04)
							{
								opPage = opPage & ~_BV(2);

								TC1_PWM_OFF;
								OUT_OFF;
								RIM_pause = 1;
								LED_WHITE(WHITE_BRI);
								
							}
							else
							{
								LED_RED(RED_BRI);
								opPage = opPage | _BV(2);
								OUT_ON;
								RIM_pause = 0;
								TC1_PWM_ON;
							}
						}
					}
				}
			}
			else
			{
				triger_cnt = 0;
			}
		}
		
		//totalEnergy = opower * otime;

		if (ck_oldtime != ckTime)
		{
			ck_oldtime = ckTime;

			if ((((opPage & 0x04) == 0x04) && (foot_op)) || (((opPage & 0x02) == 0x02) && (!foot_op)))
			{
				otime--;				
				
				totalEnergy += opower;
				

				if ((otime % 60) == 0)
				{
					total_time++;
				}				
					if (otime == 0)
					{
						setStandby();
						otime = settime;
						opPage = 1;
						timeDisp(otime);
						ma5105_set_run_icon();
					}
				else
				{
					timeDisp(otime);
					if(EM_SOUND)
					{
						if (otime % 2)
						audioPlay(EMSOUND_WAE);
					}
					else
					Buzzer(sound_v);					
				}				
			}
			else
			{
				if(eng_show==0)
				OUT_OFF;
				RIM_pause = 1;
			}
			#if NEW_BOARD
			if(TEMP_SIMUL)
			{
				read_temp();
				TEXT_Display_TEMPERATURE(ntc_t);
			}
			else
			{
				if (ads1115_readADC_SingleEnded(0, temp_raw, ADS1115_DR_860SPS, ADS1115_PGA_6_144) == 0)
				{
					adc_ok=1;
				}
				else
				{
					adc_fail++;
					if(adc_fail>3)
					TEMP_SIMUL=1;
				}
			}
			#else
			
			read_temp();
			TEXT_Display_TEMPERATURE(ntc_t);
			
			#endif
		}


		// clearBTN();
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
								// [PAGE70 FEATURE] include page69 hold key group(0xDD/0x00) and page70 keypad groups.
												if ((((parsBuf[2] == 0x30) || (parsBuf[2] == 0x50)) && (parsBuf[3] == 0x00) && (parsBuf[5] == 0x80)) ||
													(ma5105_mode() &&
													(((parsBuf[5] == 0x80) ||
												((parsBuf[5] == 0x81) && (parsBuf[6] >= 0x09) && (parsBuf[6] <= 0x13)) ||
												((parsBuf[5] == 0x85) && ((parsBuf[6] == 0x10) || (parsBuf[6] == 0x11))) ||
												(parsBuf[5] == 0x50) || (parsBuf[5] == 0x20) || (parsBuf[5] == 0x22) ||
												(parsBuf[5] == 0x10) || (parsBuf[5] == 0x23) ||
												((dwin_page_now == MA5105_PAGE69_ID) &&
												((parsBuf[5] == 0x40) || (parsBuf[5] == 0x41) ||
												(parsBuf[5] == 0xDD) || (parsBuf[5] == 0x00))) ||
													((dwin_page_now == MA5105_PAGE70_ID) &&
													((parsBuf[5] == 0xBB) || (parsBuf[5] == 0xAB) ||
													(parsBuf[5] == 0xDD) || (parsBuf[5] == 0xCC))) ||
													((dwin_page_now == MA5105_PAGE71_ID) &&
													(parsBuf[5] == 0xD3) && (parsBuf[6] == 0x11))) &&
													!((parsBuf[5] == 0x50) && (parsBuf[6] == 0x01)))))
								{
								//clearBTN();
									if (init_boot == 0)
									{
										
										audioPlay(2 + (dev_mode & 0x3f));
										if (ma5105_mode())
										{
											pageChange(62);
										}
										else
										{
											pageChange(startPage+2);
										}
										if (!ma5105_mode())
										setModeBtn(body_face);
										_delay_ms(100);
										init_boot = 1;
										peltier_op = 0;
										pwDisp(opower);
										timeDisp(otime);

									LED_Display(2);
										if(j16mode==1)
										H_LED_OFF;
										COOL_FAN_ON;
										ma5105_sync_page62_ui();
										// #if TRON_200_MODE
										
									}
								else
										{
											U08 ma_handled = 0;
											if (ma5105_mode())
											{
												if ((dwin_page_now == 62) && (parsBuf[5] == 0x85))
													{
														U16 keyCode = ((U16)parsBuf[5] << 8) | (U16)parsBuf[6];
														if (ma5105_page62_secret_step(keyCode))
														{
															pageChange(69);
															ma5105_page69_reset_icons();
														}
														ma_handled = 1;
													}
															// [PAGE70 FEATURE] page69 -> page70 hold key path.
															else if ((dwin_page_now == MA5105_PAGE69_ID) &&
																((parsBuf[5] == 0xDD) || (parsBuf[5] == 0x00)))
													{
														U16 keyCode = ((U16)parsBuf[5] << 8) | (U16)parsBuf[6];
														ma_handled = ma5105_page70_handle_hold_key(keyCode);
													}
															else if ((dwin_page_now == 69) &&
																((parsBuf[5] == 0x22) || (parsBuf[5] == 0x10) || (parsBuf[5] == 0x23) ||
																(parsBuf[5] == 0x40) || (parsBuf[5] == 0x41)))
													{
														U16 keyCode = ((U16)parsBuf[5] << 8) | (U16)parsBuf[6];
														ma_handled = ma5105_page69_handle_key(keyCode);
													}
															// [PAGE70 FEATURE] page70 password keypad path.
															else if ((dwin_page_now == MA5105_PAGE70_ID) &&
																((parsBuf[5] == 0xBB) || (parsBuf[5] == 0xAB) ||
																(parsBuf[5] == 0xDD) || (parsBuf[5] == 0xCC)))
													{
														U16 keyCode = ((U16)parsBuf[5] << 8) | (U16)parsBuf[6];
														ma_handled = ma5105_page70_handle_key(keyCode);
													}
															else if ((dwin_page_now == MA5105_PAGE71_ID) &&
																(parsBuf[5] == 0xD3) && (parsBuf[6] == 0x11))
													{
														U16 keyCode = ((U16)parsBuf[5] << 8) | (U16)parsBuf[6];
														if (keyCode == MA5105_PAGE71_KEY_RETURN_TO_69)
														{
															pageChange(MA5105_PAGE69_ID);
															ma_handled = 1;
														}
													}
														else
														{
													U08 ma_key = parsBuf[6];
													// Some MA5105 touch objects emit 0x0A~0x0D for preset 2~5.
													if ((ma_key >= 0x0A) && (ma_key <= 0x0D))
													ma_key = (U08)(ma_key + 0x06);
													if ((dwin_page_now == 62) && (opPage & 0x02) && (ma_key != 0x01))
													{
														ma_handled = 1;
													}
													else
													if ((parsBuf[5] == 0x20) && (parsBuf[6] == 0x00))
													{
														pageChange(58);
														ma_handled = 1;
													}
													else
													switch (ma_key)
														{
														case 0x01:
												if (energy_subscription_run_key_guard())
												{
													ma5105_set_run_icon();
													ma_handled = 1;
													break;
												}
												// MA5105 start/stop button (same logic as FL0788 0x06)
												if (opPage & 0x02)
												{
												setStandby();
												opPage = 1;
											}
											else
											{
												if (total_time >= lim_time)
												{
													errDisp();
													TEXT_Display_ERR_CODE("ERR CODE 02", 11);
												}
												else
												{
													if ((lsm6d_fail == 1) && (moving_sensing == 1))
													{
														errDisp();
														TEXT_Display_ERR_CODE("ERR CODE 03", 11);
													}
													else
													{
														setReady();
														opPage = 2;
													}
												}
											}
											ma5105_set_run_icon();
												// [NEW FEATURE] Page62 run-key post action:
												// keep display/UART in sync without adding button-edge energy.
												old_totalEnergy = totalEnergy;
												TE_Display(old_totalEnergy);
												energy_uart_publish_run_event((opPage & 0x02) ? 1U : 0U, totalEnergy);
											ma_handled = 1;
											break;
											case 0x02:
											// MA5105 reset button (same logic as FL0788 0x07)
											totalEnergy = 0;
											old_totalEnergy = 0;
											TE_Display(old_totalEnergy);
											ma_handled = 1;
											break;
												case 0x03:
												// MA5105 power up
												if(body_face)
												{
													if (opower < 80)
														opower += MinPower;
												}
												else
												{
													if (opower < MaxPower)
														opower += MinPower;
												}
												if (selectMem != 0)
												{
													selectMem = 0;
													MEM_Display(selectMem);
												}
												pwDisp(opower);
												ma5105_set_preset_default_icons();
												ma_handled = 1;
												break;
												case 0x04:
												// MA5105 power down
												if (opower > MinPower)
													opower -= MinPower;
												if (selectMem != 0)
												{
													selectMem = 0;
													MEM_Display(selectMem);
												}
												pwDisp(opower);
												ma5105_set_preset_default_icons();
												ma_handled = 1;
												break;
												case 0x05:
												// MA5105 time up (FL0788 0x03 mapping)
												if ((otime % 60) != 0)
													otime = (otime - (otime % 60));
												if (otime < (90 * 60))
													otime += 60;
												settime = otime;
												if (selectMem != 0)
												{
													selectMem = 0;
													MEM_Display(selectMem);
												}
												timeDisp(otime);
												ma5105_set_preset_default_icons();
												ma_handled = 1;
												break;
												case 0x06:
												// MA5105 time down (FL0788 0x04 mapping)
												if ((otime % 60) != 0)
												{
													otime = (otime - (otime % 60));
													if (otime < 60)
													otime = 60;
											}
											else
											{
												if (otime > 60)
													otime -= 60;
											}
											settime = otime;
											if (selectMem != 0)
												{
													selectMem = 0;
													MEM_Display(selectMem);
												}
												timeDisp(otime);
												ma5105_set_preset_default_icons();
												ma_handled = 1;
												break;
											case 0x07:
											// MA5105 sound button (same logic as FL0788 0x05)
											Buzzer_ONOFF();
											ma5105_set_sound_icon();
											ma_handled = 1;
											break;
											case 0x08:
											// MA5105 mode button A (same logic as FL0788 0x08)
											if(body_face==0)
											{
												sBody_pw=opower;
												opower=sFace_pw;
												body_face=1;
												// MA5105 uses 0x3006 mode icon instead of 0x100C/0x100D.
												pwDisp(opower);
												if (selectMem != 0)
												{
													selectMem = 0;
													MEM_Display(selectMem);
												}
											}
											ma5105_set_mode_icon();
											ma5105_set_preset_default_icons();
											ma_handled = 1;
											break;
												case 0x09:
												case 0x10:
												case 0x11:
												case 0x12:
												case 0x13:
												{
													// MA5105 preset buttons (same logic as FL0788 0x10~0x14)
													U08 preset = 5;
													if (ma_key == 0x09) preset = 1;
													else if (ma_key == 0x10) preset = 2;
													else if (ma_key == 0x11) preset = 3;
													else if (ma_key == 0x12) preset = 4;
												if (preset == 1)
												{
													if(body_face)
													{
														opower=30;
														otime = 10 * 60;
													}
													else
													{
														opower=110;
														otime = 15 * 60;
													}
												}
												else if (preset == 2)
												{
													if(body_face)
													{
														opower=40;
														otime = 10 * 60;
													}
													else
													{
														opower=120;
														otime = 15 * 60;
													}
												}
												else if (preset == 3)
												{
													if(body_face)
													{
														opower=50;
														otime = 10 * 60;
													}
													else
													{
														opower=130;
														otime = 15 * 60;
													}
												}
												else if (preset == 4)
												{
													if(body_face)
													{
														opower=60;
														otime = 10 * 60;
													}
													else
													{
														opower=140;
														otime = 15 * 60;
													}
												}
												else
												{
													if(body_face)
													{
														opower=80;
														otime = 10 * 60;
													}
													else
													{
														opower=150;
														otime = 15 * 60;
													}
												}
												settime = otime;
												selectMem = preset;
												MEM_Display(selectMem);
												pwDisp(opower);
												timeDisp(otime);
													ma5105_set_preset_icons(ma_key);
												ma_handled = 1;
												break;
											}
											case 0x14:
											// MA5105 service button (same logic as FL0788 0x57)
											pageChange(57);
											ma_handled = 1;
											break;
											case 0x15:
											// MA5105 mode button B (same logic as FL0788 0x09)
											if(body_face==1)
											{
												sFace_pw=opower;
												opower=sBody_pw;
												body_face=0;
												// MA5105 uses 0x3006 mode icon instead of 0x100C/0x100D.
												pwDisp(opower);
												if (selectMem != 0)
												{
													selectMem = 0;
													MEM_Display(selectMem);
												}
											}
											ma5105_set_mode_icon();
											ma5105_set_preset_default_icons();
											ma_handled = 1;
											break;
												case 0x16:
												// MA5105 cooling button (same logic as FL0788 0x17)
													if(cool_ui_show!=0)
												{
													if (peltier_op == 0) // 0:on 1:off
													{
													peltier_op = 1;
													Peltier_OFF(1);
												}
												else
												{
													peltier_op = 0;
													Peltier_OFF(0);
												}
											}
												ma5105_set_cool_icon();
												TEXT_Display_TEMPERATURE(ntc_t);
												ma_handled = 1;
												break;
												case 0x18:
												if(sound_v<9)
												sound_v++;
												Audio_Set(sound_v);
												ma_handled = 1;
												break;
												case 0x19:
												if(sound_v>0)
												sound_v--;
												Audio_Set(sound_v);
												ma_handled = 1;
												break;
												case 0x1A:
												case 0x1B:
												case 0x1C:
												case 0x1D:
												case 0x1E:
												case 0x1F:
												case 0x20:
												case 0x21:
												case 0x22:
												case 0x23:
												sound_v=parsBuf[6]-0x1a;
												Audio_Set(sound_v);
												ma_handled = 1;
												break;
													case 0x58:
													pageChange(62);
													_delay_ms(80);
														ma5105_sync_page62_ui();
														ma_handled = 1;
														break;
													default:
													break;
													}
												}
											}
									if (!ma_handled && !ma5105_mode())
									{
									switch (parsBuf[6])
									{
											case 0x00:
											if (parsBuf[5] == 0x20)
											{
												pageChange(58);
											}
											break;
											case 0x01:
										if(body_face)
										{
											if(startPage==41)
											{
												if (opower < MaxPower)
												opower += MinPower;
											}
											else
											{
												if (opower < 80)
													opower += MinPower;	
											}
										}
										else
										{
											if (opower < MaxPower)
											opower += MinPower;
										}
										if (selectMem != 0)
										{
											selectMem = 0;
											MEM_Display(selectMem);
										}
										pwDisp(opower);
										
										break;
										case 0x02:
										if (opower > MinPower)
										opower -= MinPower;
										if (selectMem != 0)
										{
											selectMem = 0;
											MEM_Display(selectMem);
										}
										pwDisp(opower);
										
										break;
										case 0x03:
										if ((otime % 60) != 0)
										otime = (otime - (otime % 60));
										if (otime < (90 * 60))
										otime += 60;
										settime = otime;
										if (selectMem != 0)
										{
											selectMem = 0;
											MEM_Display(selectMem);
										}
										timeDisp(otime);
										
										break;
										case 0x04:
										if ((otime % 60) != 0)
										{
											otime = (otime - (otime % 60));
											if (otime < 60)
											otime = 60;
										}
										else
										{
											if (otime > 60)
											otime -= 60;
										}
										settime = otime;
										if (selectMem != 0)
										{
											selectMem = 0;
											MEM_Display(selectMem);
										}
										timeDisp(otime);
										
											break;
											case 0x05:
											Buzzer_ONOFF();
											break;
												case 0x06:										
												if (energy_subscription_run_key_guard())
												{
													break;
												}
												if (opPage & 0x02)
												{
													setStandby();
													opPage = 1;
											}
										else
										{
											if (total_time >= lim_time)
											{
												errDisp();
												TEXT_Display_ERR_CODE("ERR CODE 02", 11);
											}
											else
											{
												if ((lsm6d_fail == 1) && (moving_sensing == 1))
												{

													errDisp();

													TEXT_Display_ERR_CODE("ERR CODE 03", 11);
												}
												else
												{																	
													setReady();													
													opPage = 2;
													}
												}
											}										
												// [NEW FEATURE] Legacy run-key post action:
												// keep display/UART in sync without adding button-edge energy.
												old_totalEnergy = totalEnergy;
												TE_Display(old_totalEnergy);
												energy_uart_publish_run_event((opPage & 0x02) ? 1U : 0U, totalEnergy);
											break;
											case 0x07:
											
											//otime=settime;
											//timeDisp(otime);
											totalEnergy = 0;
											// [NEW FEATURE] Keep total-energy icon and ESP side synchronized after reset.
											old_totalEnergy = 0;
											TE_Display(old_totalEnergy);
											energy_uart_publish_run_event((opPage & 0x02) ? 1U : 0U, totalEnergy);
											break;
										case 0x08:
										if(body_face==0)
										{
											sBody_pw=opower;
											opower=sFace_pw;
											body_face=1;
											setModeBtn(body_face);
											pwDisp(opower);
											
											if (selectMem != 0)
											{
												selectMem = 0;
												MEM_Display(selectMem);
											}
										}
										break;
										case 0x09:
										if(body_face==1)
										{
											sFace_pw=opower;											
											opower=sBody_pw;
											body_face=0;
											setModeBtn(body_face);
											pwDisp(opower);
											
											if (selectMem != 0)
											{
												selectMem = 0;
												MEM_Display(selectMem);
											}
										}
										break;
										case 0x10:										
									
											if(body_face)											
											{
												opower=30;
												otime = 10 * 60;
											}
											else
											{
												opower=100;
												otime = 15 * 60;
											}
										
										settime = otime;
										selectMem = 1;
										MEM_Display(selectMem);
										pwDisp(opower);
										timeDisp(otime);
										
										break;
										case 0x11:										
										
											if(body_face)
											{
												opower=40;
												otime = 10 * 60;
											}
											else
											{
												opower=110;
												otime = 15 * 60;
											}
										
										
										
										settime = otime;
										selectMem = 2;
										MEM_Display(selectMem);
										pwDisp(opower);
										timeDisp(otime);
										
										break;
										case 0x12:
										
										
											if(body_face)
											{
												opower=50;
												otime = 10 * 60;
											}
											else
											{
												opower=120;
												otime = 15 * 60;
											}
										
										
										settime = otime;
										selectMem = 3;
										MEM_Display(selectMem);
										pwDisp(opower);
										timeDisp(otime);
										
										break;
										case 0x13:
										
										
											if(body_face)
											{
												opower=60;
												otime = 10 * 60;
											}
											else
											{
												opower=130;
												otime = 15 * 60;
											}
																	
										
										settime = otime;
										selectMem = 4;
										MEM_Display(selectMem);
										pwDisp(opower);
										timeDisp(otime);
										
										break;
										case 0x14:										
										
											if(body_face)
											{
												opower=80;
												otime = 10 * 60;
											}
											else
											{
												opower=150;
												otime = 15 * 60;
											}
										
									
										settime = otime;
										selectMem = 5;
										MEM_Display(selectMem);
										pwDisp(opower);
										timeDisp(otime);
										
										break;
										case 0x15:
										if (enc_cnt < 2)
										enc_cnt++;
										else if (enc_cnt > 3)
										{
											enc_cnt++;
											if (enc_cnt == 6)
											{
												enc_cnt = 0;
												setEngMode();
											}
										}
										else
										{
											enc_cnt = 0;
										}
										break;
										case 0x16:
										if (enc_cnt > 1)
										{
											if (enc_cnt < 4)
											enc_cnt++;
											else
											enc_cnt = 0;
										}
										else
										enc_cnt = 0;
										break;
										case 0x17:
										if(cool_ui_show!=0)
										{
											if (peltier_op == 0) // 0:on 1:off
											{
												peltier_op = 1;
												Peltier_OFF(1);
											}
											else
											{
												peltier_op = 0;
												Peltier_OFF(0);
											}
										}
										break;
										case 0x18:
										if(sound_v<9)
										sound_v++;
										Audio_Set(sound_v);
										break;
										case 0x19:
										if(sound_v>0)
										sound_v--;
										Audio_Set(sound_v);
										break;
										case 0x1A:
										case 0x1B:
										case 0x1C:
										case 0x1D:
										case 0x1E:
										case 0x1F:
										case 0x20:
										case 0x21:
										case 0x22:
										case 0x23:
										sound_v=parsBuf[6]-0x1a;
										Audio_Set(sound_v);
										break;
										case 0x57:
										pageChange(57);
										break;
											case 0x58:
											pageChange(62);
											_delay_ms(80);
											ma5105_sync_page62_ui();
											break;

											default:
											break;
										}
									}
									}
								}
									else if ((((parsBuf[2] == 0x30) || (parsBuf[2] == 0x50)) && (parsBuf[3] == 0x00) && (parsBuf[5] == 0x50) && (parsBuf[6] == 0x01)) ||
										(ma5105_mode() && (parsBuf[5] == 0x50) && (parsBuf[6] == 0x01)))
									{
										pageChange(62);
										_delay_ms(80);
										if (ma5105_mode())
										{
											init_boot = 1;
										peltier_op = 0;
										// MA5105 uses 0x3006 mode icon instead of 0x100C/0x100D.
										pwDisp(opower);
										timeDisp(otime);
										LED_Display(2);
										if (j16mode == 1)
										H_LED_OFF;
										COOL_FAN_ON;
									}
									ma5105_sync_page62_ui();
								}
							else if ((parsBuf[2] == 0x31) && (parsBuf[3] == 0x00)) /// pass mode
							{
								if(passmode)
								{
									if(parsBuf[5]==0x21)
									{
										engPass[0]=engPass[1];
										engPass[1]=engPass[2];
										engPass[2]=engPass[3];
										engPass[3]=engPass[4];
										engPass[4]=engPass[5];
										engPass[5]=parsBuf[6];
									}
									else
									{
										switch(parsBuf[6])
										{
											case 0xF0:
											showKeypad(0);
											passmode=0;
											engPass[0]=0x20;
											engPass[1]=0x20;
											engPass[2]=0x20;
											engPass[3]=0x20;
											engPass[4]=0x20;
											engPass[5]=0x20;
											break;
											case 0x0d:
											if((((engPass[0]==0x4d)||(engPass[0]==0x6d))&&
											((engPass[1]==0x41)||(engPass[1]==0x61))&&
											(engPass[2]==0x35)&&
											(engPass[3]==0x31)&&
											(engPass[4]==0x30)&&
											(engPass[5]==0x35)))
											{
												showKeypad(0);
												passmode=0;
												engPass[0]=0x20;
												engPass[1]=0x20;
												engPass[2]=0x20;
												engPass[3]=0x20;
												engPass[4]=0x20;
												engPass[5]=0x20;
												pageChange(61);
											}
											else
											{
											if((engPass[0]==0x32)&&
											(engPass[1]==0x32)&&
											(engPass[2]==0x33)&&
											(engPass[3]==0x31)&&
											(engPass[4]==0x34)&&
											(engPass[5]==0x35))
											{
												showKeypad(0);
												setEngMode_Factory();
												passmode=0;
											}
											else
											{
												if((engPass[0]==0x32)&&
												(engPass[1]==0x32)&&
												(engPass[2]==0x33)&&
												(engPass[3]==0x31)&&
												(engPass[4]==0x34)&&
												(engPass[5]==0x36))
												{
													showKeypad(0);
													setDateMode();
													passmode=0;
												}
												else
												{
													engPass[0]=0x20;
													engPass[1]=0x20;
													engPass[2]=0x20;
													engPass[3]=0x20;
													engPass[4]=0x20;
													engPass[5]=0x20;												
												}																						
											}
											}
											break;
										}
									}
									showPasskey(engPass);
								}
								else
								{
									if(parsBuf[5]==0x21)//number
										{
											engPass[0]=engPass[1];
											engPass[1]=engPass[2];
											engPass[2]=engPass[3];
											engPass[3]=engPass[4];
											engPass[4]=engPass[5];
											engPass[5]=parsBuf[6];
										if(select_date!=0)
										{											
											temp_date_buf[5]=temp_date_buf[4];
											temp_date_buf[4]=temp_date_buf[3];
											temp_date_buf[3]=temp_date_buf[2];
											temp_date_buf[2]=temp_date_buf[1];
											temp_date_buf[1]=temp_date_buf[0];
											temp_date_buf[0]=parsBuf[6]-0x30;
											
											temp_date=(temp_date_buf[5])*10+(temp_date_buf[4]);
											temp_date=(temp_date<<8)+(temp_date_buf[3])*10+(temp_date_buf[2]);
											temp_date=(temp_date<<8)+(temp_date_buf[1])*10+(temp_date_buf[0]);
											
											if(select_date==1)
												reflashD_Date(temp_date);
											else if(select_date==2)
												reflashI_Date(temp_date);
																							
										}
									}
									else
									{
										switch(parsBuf[6])
										{
											case 0xff:
											while(1);
											break;
											case 0xf0:
												select_date=0;
												setSelectDate(0);
												reflashD_Date(cur_date);
												reflashI_Date(ins_date);
												temp_date_clear();
											break;
											case 0x0d:
											if((((engPass[0]==0x4d)||(engPass[0]==0x6d))&&
											((engPass[1]==0x41)||(engPass[1]==0x61))&&
											(engPass[2]==0x35)&&
											(engPass[3]==0x31)&&
											(engPass[4]==0x30)&&
											(engPass[5]==0x35)))
											{
												engPass[0]=0x20;
												engPass[1]=0x20;
												engPass[2]=0x20;
												engPass[3]=0x20;
												engPass[4]=0x20;
												engPass[5]=0x20;
												pageChange(61);
												break;
											}
											if(select_date==1)
												{
													if((((temp_date>>8)&0xff)>0)&&(((temp_date>>8)&0xff)<13))
													{
														if((((temp_date)&0xff)>0)&&(((temp_date)&0xff)<32))
														{
															
																cur_date=temp_date;
																ds1307_dateset(cur_date);
															
														}
													}
												}
												else if(select_date==2)
												{
													if((((temp_date>>8)&0xff)>0)&&(((temp_date>>8)&0xff)<13))
													{
														if((((temp_date)&0xff)>0)&&(((temp_date)&0xff)<32))
														{
															
																ins_date=temp_date;
																//ds1307_dateset(cur_date);
																eeprom_update_dword(&D_DATE, ins_date);
																eeprom_busy_wait();														
														}
													}
												}
												
												temp_date_clear();

												select_date=0;
												setSelectDate(0);
												reflashD_Date(cur_date);
												reflashI_Date(ins_date);
											break;
											case 0x01:											
											select_date=1;
											setSelectDate(1);
											temp_date=0;
											reflashD_Date(0);
											temp_date_clear();
											break;
											case 0x02:
											select_date=2;
											setSelectDate(2);
											temp_date=0;
											reflashI_Date(0);
											temp_date_clear();
											break;
										}
									}
								}
							}
							else if ((parsBuf[2] == 0x30) && (parsBuf[3] == 0x00) && (parsBuf[5] == 0x81)) /// eng mode
							{
								if(eng_emi)
								{
									eng_emi=0;
									TC1_PWM_OFF;

									OUT_OFF;
									RIM_pause = 1;
									
									TCNT3 = 0;
									
									for(int i=0;i<9;i++)
									{
										engTestBtnShow(i,0);
									}
									
									if(j16mode==1)
									H_LED_OFF;
								}
								else
								{
									if(factory_cnt!=0)
									{
										if(parsBuf[6]!=0x33)
										factory_cnt=0;
									}
									switch (parsBuf[6])
									{
										case 0x00:
										if (parsBuf[5] == 0x20)
										{
											pageChange(58);
										}
										break;
										case 10:
										eeprom_update_dword(&TT_TIME0, 0);
										eeprom_busy_wait();
										eeprom_update_dword(&TT_TIME1, 0);
										eeprom_busy_wait();
										eeprom_update_dword(&TT_TIME2, 0);
										eeprom_busy_wait();
										eeprom_update_byte(&TT_TIME_CHECKSUM0, 0);
										eeprom_busy_wait();
										eeprom_update_byte(&TT_TIME_CHECKSUM1, 0);
										eeprom_busy_wait();
										eeprom_update_byte(&TT_TIME_CHECKSUM2, 0);
										eeprom_busy_wait();
										total_time = 0;
										setEngMode();
										break;
										case 0x0B:
										if (MaxPower == 200)
										{
											MaxPower = 50;
											setMAXPower(MaxPower);
											eeprom_update_byte(&PW_MAX, MaxPower);
											eeprom_busy_wait();
										}
										else // if (MaxPower == 100)
										{
											MaxPower += 10;
											setMAXPower(MaxPower);
											eeprom_update_byte(&PW_MAX, MaxPower);
											eeprom_busy_wait();
										}
										break;
										case 0x0C:
										
										break;
										case 0x0D:
										if (eng_show_mode == 0)
										{
											eng_show_mode = 1;
										}
										else
										{
											eng_show_mode = 0;
										}
										TEXT_Display_eng_testmode(eng_show_mode);
										break;
										case 0x0E:
										eeprom_update_byte(&INIT_BOOT, 0);
										eeprom_busy_wait();
										showPasskey_null();
										while(1);
										break;
										case 0x0f:
										if (lim_time < 600000)
										lim_time += 30000;
										else
										lim_time = 90000;

										eeprom_update_dword(&LIMIT_TIME, lim_time);
										eeprom_busy_wait();

										eeprom_update_dword(&LIMIT_TIME_CK, 0x1000000 - lim_time);
										eeprom_busy_wait();
										TEXT_Display_LIMIT_Time(lim_time);
										break;
										case 0x10:
										
										break;
										case 0x11:
										exitEngMode();
										init_boot=0;
										LCD_OFF;
										while(1);
										break;
										case 0x12:
										if (foot_op)
										{
											foot_op = 0;
										}
										else
										foot_op = 1;

										eeprom_update_byte(&TRIG_MODE, foot_op);
										eeprom_busy_wait();
										TEXT_Display_TRIG_mode(foot_op);
										break;
										case 0x13:
										if(body_face==0)
										{
											if(pw_data[0]>1)
											pw_data[0]-=1;
											setPwValue(0,pw_data[0]);
										}
										else
										{
											if(pw_data_face[0]>1)
											pw_data_face[0]-=1;
											setPwValue(0,pw_data_face[0]);
										}
										break;
										case 0x14:
										if(body_face==0)
										{
											if(pw_data[0]<pw_data[4])
											pw_data[4]-=1;
											setPwValue(1,pw_data[4]);
										}
										else
										{
											if(pw_data_face[0]<pw_data_face[4])
											pw_data_face[4]-=1;
											setPwValue(1,pw_data_face[4]);
										}
										break;
										case 0x15:
										case 0x16:
										case 0x17:																
										case 0x18:
										case 0x19:
										case 0x1a:
										case 0x1b:
										if(body_face==1)
										{
											if(pw_data_face[(parsBuf[6]-0x14)*5-1]<pw_data_face[(parsBuf[6]-0x13)*5-1])
											pw_data_face[(parsBuf[6]-0x13)*5-1]-=1;
											setPwValue(parsBuf[6]-0x13,pw_data_face[(parsBuf[6]-0x13)*5-1]);
										}
										else
										{
											if(pw_data[(parsBuf[6]-0x14)*5-1]<pw_data[(parsBuf[6]-0x13)*5-1])
											pw_data[(parsBuf[6]-0x13)*5-1]-=1;
											setPwValue(parsBuf[6]-0x13,pw_data[(parsBuf[6]-0x13)*5-1]);
										}
										
										break;
										case 0x1c:
										if(body_face==0)
										{
											if(pw_data[0]<pw_data[4])
											pw_data[0]+=1;
											setPwValue(0,pw_data[0]);
										}
										else
										{
											if(pw_data_face[0]<pw_data_face[4])
											pw_data_face[0]+=1;
											setPwValue(0,pw_data_face[0]);
										}
										break;
										case 0x1d:
										case 0x1e:
										case 0x1f:
										case 0x20:
										case 0x21:
										case 0x22:
										case 0x23:
										if(body_face==1)
										{
											if(pw_data_face[(parsBuf[6]-0x1c)*5-1]<pw_data_face[(parsBuf[6]-0x1b)*5-1])
											pw_data_face[(parsBuf[6]-0x1c)*5-1]+=1;
											setPwValue((parsBuf[6]-0x1c),pw_data_face[(parsBuf[6]-0x1c)*5-1]);
											break;
										}
										else
										{
											if(pw_data[(parsBuf[6]-0x1c)*5-1]<pw_data[(parsBuf[6]-0x1b)*5-1])
											pw_data[(parsBuf[6]-0x1c)*5-1]+=1;
											setPwValue(parsBuf[6]-0x1c,pw_data[(parsBuf[6]-0x1c)*5-1]);
										}										
										break;
										case 0x24:
										if(body_face==1)
										{
											if(pw_data_face[(parsBuf[6]-0x1c)*5-1]<200)
											pw_data_face[(parsBuf[6]-0x1c)*5-1]+=1;
											setPwValue((parsBuf[6]-0x1c),pw_data_face[(parsBuf[6]-0x1c)*5-1]);
											break;
										}
										else
										{
											if(pw_data[39]<200)
											pw_data[39]+=1;
											setPwValue(8,pw_data[39]);
										}						
										break;
										case 0x25:
										case 0x26:
										case 0x27:
										case 0x28:
										case 0x29:
										case 0x2a:
										case 0x2b:
										case 0x2c:
										case 0x2d:
										eng_emi=1;
										if(parsBuf[6]==0x25)
										{
											setPower(5);
										}
										else
										{
										//	if((body_face==0) || (parsBuf[6]<0x2a))
											{
												setPower((parsBuf[6]-0x25)*25);
											}
										}

										//if((body_face==0) || (parsBuf[6]<0x2a))
										{	
											TC1_PWM_ON;

											OUT_ON;
											RIM_pause = 0;
											
											TCNT3 = 0;
											engTestBtnShow(parsBuf[6]-0x25,1);
											if(j16mode==1)
											{
												W_PUMP_ON;
											}
										}
										break;
										case 0x2e:
										if(body_face==0)
										{
											for(int i=0;i<40;i++)
											{
												pw_data[i]=(i+1)*5;
												eeprom_update_byte(&PW_VALUE[i], pw_data[i]);
												eeprom_busy_wait();
											}
											setPwValue(0, pw_data[0]);
											setPwValue(1, pw_data[4]);
											setPwValue(2, pw_data[9]);
											setPwValue(3, pw_data[14]);
											setPwValue(4, pw_data[19]);
											setPwValue(5, pw_data[24]);
											setPwValue(6, pw_data[29]);
											setPwValue(7, pw_data[34]);
											setPwValue(8, pw_data[39]);
										}
										else
										{
											for(int i=0;i<40;i++)
											{
												pw_data_face[i]=(i+1)*5;
												eeprom_update_byte(&PW_VALUE_FACE[i], pw_data_face[i]);
												eeprom_busy_wait();
											}
											setPwValue(0, pw_data_face[0]);
											setPwValue(1, pw_data_face[4]);
											setPwValue(2, pw_data_face[9]);
											setPwValue(3, pw_data_face[14]);
											setPwValue(4, pw_data_face[19]);
											setPwValue(5, pw_data_face[24]);
											setPwValue(6, pw_data_face[29]);
											setPwValue(7, pw_data_face[34]);
											setPwValue(8, pw_data_face[39]);
										}
										break;
										case 0x2f:
										pw_auto_cal();
										if(body_face==0)
										{
											for(int i=0;i<40;i++)
											{
												eeprom_update_byte(&PW_VALUE[i], pw_data[i]);
												eeprom_busy_wait();
											}
										}
										else
										{
											for(int i=0;i<40;i++)
											{
												eeprom_update_byte(&PW_VALUE_FACE[i], pw_data_face[i]);
												eeprom_busy_wait();
											}
										}
										
										
										break;
										case 0x30:
										if(cool_ui_show==0)
										{
											cool_ui_show=1;
										}
										else if(cool_ui_show==1)
										{
											cool_ui_show=2;
										}
										else
										{
											cool_ui_show=0;
										}
										eeprom_update_byte(&COOL_UI, cool_ui_show);
										eeprom_busy_wait();
										TEXT_Display_COOL_UI_mode(cool_ui_show);
										break;
										case 0x31:
										if(j16mode==0)
										j16mode=1;
										else
										j16mode=0;
										eeprom_update_byte(&J16_MODE, j16mode);
										eeprom_busy_wait();
										j16mode_ui(j16mode);//0 : pump , 1: led
										break;
										case 0x32:
										if(EM_SOUND==0)
										EM_SOUND=1;
										else
										EM_SOUND=0;
										eeprom_update_byte(&SOUND_MODE, EM_SOUND);
										eeprom_busy_wait();
										sound_mode_ui(EM_SOUND);//0 : pump , 1: led
										break;
										case 0x33:
										factory_cnt++;
										if(factory_cnt>4)
										{
											showPasskey_null();
											factory_cnt=0;
											showKeypad(1);
											passmode=1;
										}
										//	setEngMode_Factory();
										break;
										case 0x34://mode btn
										if(body_face==0)
										body_face=1;
										else
										body_face=0;
										if(eng_show==2)
										setEngMode_Factory();
										else
										setEngMode();
										break;
										
									}
								}
							}
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
		// BUGFIX: re-apply safety isolation at loop tail to override same-loop ON writes.
		subscription_hw_isolation_tick();
	}
}
