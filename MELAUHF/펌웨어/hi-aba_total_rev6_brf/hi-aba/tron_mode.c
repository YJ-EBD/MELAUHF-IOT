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
#define MA5105_PAGE69_MIN_W 5
#define MA5105_PAGE69_MAX_W 200
#define MA5105_PAGE69_STEP_W 5
#define MA5105_PAGE69_SLOT_COUNT 9
#define MA5105_PAGE69_MAX_POWER_MIN 50
#define MA5105_PAGE69_MAX_POWER_MAX 200
#define MA5105_PAGE69_MAX_POWER_STEP 10
#define MA5105_PAGE69_VALUE_STEP 5
#define MA5105_PAGE69_CONSOLE_VP 0xA1B1
#define MA5105_PAGE62_CONSOLE_VP 0xC2D2
#define MA5105_CONSOLE_TEXT_LEN 31
#define MA5105_PAGE69_DEBUG_VP 0xCCCC
#define MA5105_PAGE69_DEBUG_TEXT_LEN 39

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

static U08 ma5105_page62_visible(void)
{
	return (ma5105_mode() && (dwin_page_now == 62));
}

static U08 ma5105_page62_status_visible(void)
{
	return (ma5105_mode() && ((dwin_page_now == 62) || (dwin_page_now == 63)));
}

static U08 ma5105_page69_icon0 = 0;
static U08 ma5105_page69_icon1 = 0;
static U08 ma5105_page69_icon2 = 0;
static U08 ma5105_page69_icon3 = 0;
static U08 ma5105_page69_icon1000 = 0;
static const U08 ma5105_page69_curve_points[MA5105_PAGE69_SLOT_COUNT] = {0, 4, 9, 14, 19, 24, 29, 34, 39};
static U08 ma5105_page69_anchor_body[MA5105_PAGE69_SLOT_COUNT];
static U08 ma5105_page69_anchor_face[MA5105_PAGE69_SLOT_COUNT];
static U08 ma5105_page69_dirty = 0;
static U08 ma5105_page69_enter_pending = 0;
static U08 ma5105_page69_test_on = 0;
static U08 ma5105_page69_test_slot = 0xFF;
static U08 ma5105_page69_prev_eng_show = 0;
static U16 ma5105_page62_last_key = 0;
static U16 ma5105_page69_last_key = 0;
static void ma5105_set_mode_icon(void);
static void ma5105_set_sound_icon(void);
static void ma5105_toggle_page62_cool_state(void);
static void ma5105_set_run_icon(void);
static void ma5105_set_preset_default_icons(void);
static void ma5105_set_preset_icons(U08 key);
static void ma5105_sync_page62_ui(void);
static void ma5105_page69_tick(void);
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

static U08 *ma5105_page69_curve_ptr(U08 face_mode)
{
	if (face_mode)
	return pw_data_face;
	return pw_data;
}

static U08 *ma5105_page69_anchor_ptr(U08 face_mode)
{
	if (face_mode)
	return ma5105_page69_anchor_face;
	return ma5105_page69_anchor_body;
}

static U08 ma5105_curve_value_for_power(uint32_t power_w)
{
	U08 idx;

	if (power_w < 5U)
	{
		power_w = 5U;
	}
	else if (power_w > 200U)
	{
		power_w = 200U;
	}

	power_w -= (power_w % 5U);
	if (power_w < 5U)
	{
		power_w = 5U;
	}

	idx = (U08)((power_w / 5U) - 1U);
	return body_face ? pw_data_face[idx] : pw_data[idx];
}

static void ma5105_console_push(char *line, U08 *pos, char c)
{
	if (*pos < MA5105_CONSOLE_TEXT_LEN)
	{
		line[(*pos)++] = c;
	}
}

static void ma5105_console_append_text(char *line, U08 *pos, const char *text)
{
	while ((text != 0) && (*text != '\0'))
	{
		ma5105_console_push(line, pos, *text++);
	}
}

static void ma5105_console_append_dec1(char *line, U08 *pos, U08 value)
{
	ma5105_console_push(line, pos, (char)('0' + (value % 10U)));
}

static void ma5105_console_append_dec3(char *line, U08 *pos, U16 value)
{
	ma5105_console_push(line, pos, (char)('0' + ((value / 100U) % 10U)));
	ma5105_console_push(line, pos, (char)('0' + ((value / 10U) % 10U)));
	ma5105_console_push(line, pos, (char)('0' + (value % 10U)));
}

static void ma5105_console_append_dec4(char *line, U08 *pos, U16 value)
{
	ma5105_console_push(line, pos, (char)('0' + ((value / 1000U) % 10U)));
	ma5105_console_push(line, pos, (char)('0' + ((value / 100U) % 10U)));
	ma5105_console_push(line, pos, (char)('0' + ((value / 10U) % 10U)));
	ma5105_console_push(line, pos, (char)('0' + (value % 10U)));
}

static void ma5105_page62_write_console_text(void)
{
	char line[MA5105_CONSOLE_TEXT_LEN + 1];
	U08 pos = 0;
	U16 cal = ma5105_curve_value_for_power(opower);

	ma5105_console_append_text(line, &pos, "P");
	ma5105_console_append_dec3(line, &pos, (U16)opower);
	ma5105_console_append_text(line, &pos, ",C");
	ma5105_console_append_dec3(line, &pos, cal);
	ma5105_console_append_text(line, &pos, ",O");
	ma5105_console_append_dec4(line, &pos, OCR1A);
	ma5105_console_append_text(line, &pos, ",R");
	ma5105_console_append_dec1(line, &pos, opPage);
	ma5105_console_append_text(line, &pos, ",L");
	ma5105_console_append_dec1(line, &pos, g_hw_output_lock);
	ma5105_console_append_text(line, &pos, ",F");
	ma5105_console_append_dec1(line, &pos, body_face);
	line[pos] = '\0';
	/* Disabled for now: hide page62 text display (0xC2D2) without removing
	   the formatting logic so it can be restored later if needed. */
	/* dwin_write_text(MA5105_PAGE62_CONSOLE_VP, line, MA5105_CONSOLE_TEXT_LEN); */
}

static void ma5105_page69_write_console_text(void)
{
	char line[MA5105_CONSOLE_TEXT_LEN + 1];
	U08 pos = 0;
	U16 watt = 0;
	U16 cal = 0;

	if ((ma5105_page69_test_on != 0) && (ma5105_page69_test_slot < MA5105_PAGE69_SLOT_COUNT))
	{
		watt = ma5105_page69_slots[ma5105_page69_test_slot].init_w;
		cal = ma5105_curve_value_for_power(watt);
	}

	ma5105_console_append_text(line, &pos, "W");
	ma5105_console_append_dec3(line, &pos, watt);
	ma5105_console_append_text(line, &pos, ",C");
	ma5105_console_append_dec3(line, &pos, cal);
	ma5105_console_append_text(line, &pos, ",O");
	ma5105_console_append_dec4(line, &pos, OCR1A);
	ma5105_console_append_text(line, &pos, ",T");
	ma5105_console_append_dec1(line, &pos, ma5105_page69_test_on);
	ma5105_console_append_text(line, &pos, ",L");
	ma5105_console_append_dec1(line, &pos, g_hw_output_lock);
	ma5105_console_append_text(line, &pos, ",F");
	ma5105_console_append_dec1(line, &pos, body_face);
	line[pos] = '\0';
	/* Disabled for now: hide page69 text display (0xA1B1) without removing
	   the formatting logic so it can be restored later if needed. */
	/* dwin_write_text(MA5105_PAGE69_CONSOLE_VP, line, MA5105_CONSOLE_TEXT_LEN); */
}

static void ma5105_page69_restore_default_anchors(U08 face_mode)
{
	U08 *anchors = ma5105_page69_anchor_ptr(face_mode);
	U08 i;

	for (i = 0; i < MA5105_PAGE69_SLOT_COUNT; i++)
	{
		anchors[i] = ma5105_page69_slots[i].init_w;
	}
}

static U08 ma5105_page69_anchor_is_sane(const U08 *anchors)
{
	U08 prev = 0;
	U08 i;

	for (i = 0; i < MA5105_PAGE69_SLOT_COUNT; i++)
	{
		U08 value = anchors[i];

		if ((value < 1) || (value > 200))
		{
			return 0;
		}
		if ((i != 0) && (value < prev))
		{
			return 0;
		}
		prev = value;
	}

	return 1;
}

static void ma5105_page69_load_anchors_from_eeprom(U08 face_mode)
{
	U08 *anchors = ma5105_page69_anchor_ptr(face_mode);
	uint8_t *eep_profile = face_mode ? PW_VALUE_FACE : PW_VALUE;
	U08 i;

	for (i = 0; i < MA5105_PAGE69_SLOT_COUNT; i++)
	{
		anchors[i] = eeprom_read_byte(&eep_profile[ma5105_page69_curve_points[i]]);
	}
	if (!ma5105_page69_anchor_is_sane(anchors))
	{
		ma5105_page69_restore_default_anchors(face_mode);
	}
}

static void ma5105_page69_load_shadow_profiles(void)
{
	ma5105_page69_load_anchors_from_eeprom(0);
	ma5105_page69_load_anchors_from_eeprom(1);
}

static void ma5105_page69_expand_shadow_to_runtime(U08 face_mode)
{
	U08 *curve = ma5105_page69_curve_ptr(face_mode);
	U08 *anchors = ma5105_page69_anchor_ptr(face_mode);
	U08 i;
	U08 start_idx = 0;

	for (i = 0; i < MA5105_PAGE69_SLOT_COUNT; i++)
	{
		U08 end_idx = ma5105_page69_curve_points[i];
		U08 start_value = anchors[i];
		U08 end_value = anchors[i];
		U08 j;

		if (i != 0)
		{
			start_value = anchors[i - 1];
		}
		if (end_idx == start_idx)
		{
			curve[end_idx] = end_value;
		}
		else
		{
			for (j = start_idx; j <= end_idx; j++)
			{
				U16 numerator = (U16)(j - start_idx) * (U16)(end_value - start_value);
				U16 denominator = (U16)(end_idx - start_idx);

				curve[j] = (U08)(start_value + (U08)(numerator / denominator));
			}
		}
		start_idx = (U08)(end_idx + 1);
	}
}

static void ma5105_page69_apply_active_shadow_to_runtime(void)
{
	ma5105_page69_expand_shadow_to_runtime(body_face ? 1 : 0);
}

void ma5105_profile_boot_sync(void)
{
	/*
	 * Align MA5105 runtime output with the same 9-point engineering anchors
	 * shown on page69 so page62 does not inherit stale/intermediate EEPROM
	 * bytes from older firmware builds.
	 */
	ma5105_page69_load_shadow_profiles();
	ma5105_page69_expand_shadow_to_runtime(0);
	ma5105_page69_expand_shadow_to_runtime(1);
}

static void ma5105_page69_save_runtime_to_eeprom(U08 face_mode)
{
	U08 *curve = ma5105_page69_curve_ptr(face_mode);
	uint8_t *eep_profile = face_mode ? PW_VALUE_FACE : PW_VALUE;
	U08 i;

	for (i = 0; i < 40; i++)
	{
		eeprom_update_byte(&eep_profile[i], curve[i]);
		eeprom_busy_wait();
	}
}

static U08 ma5105_page69_curve_value(U08 face_mode, U08 slot)
{
	return ma5105_page69_anchor_ptr(face_mode)[slot];
}

static U08 ma5105_page62_action_from_key(U16 keyCode, U08 *action)
{
	if (keyCode == MA5105_PAGE62_SECRET_KEY_A)
	{
		*action = 0x15;
		return 1;
	}
	else if (keyCode == MA5105_PAGE62_SECRET_KEY_B)
	{
		*action = 0x16;
		return 1;
	}

	switch ((U08)keyCode)
	{
		case 0x01:
		*action = 0x06;
		return 1;
		case 0x02:
		*action = 0x07;
		return 1;
		case 0x03:
		*action = 0x01;
		return 1;
		case 0x04:
		*action = 0x02;
		return 1;
		case 0x05:
		*action = 0x03;
		return 1;
		case 0x06:
		*action = 0x04;
		return 1;
		case 0x07:
		*action = 0x05;
		return 1;
		case 0x08:
		*action = 0x08;
		return 1;
		case 0x09:
		*action = 0x10;
		return 1;
		case 0x0A:
		case 0x10:
		*action = 0x11;
		return 1;
		case 0x0B:
		case 0x11:
		*action = 0x12;
		return 1;
		case 0x0C:
		case 0x12:
		*action = 0x13;
		return 1;
		case 0x0D:
		case 0x13:
		*action = 0x14;
		return 1;
		case 0x14:
		*action = 0x24;
		return 1;
		case 0x15:
		*action = 0x09;
		return 1;
		case 0x16:
		*action = 0x17;
		return 1;
		case 0x18:
		case 0x19:
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
		*action = (U08)keyCode;
		return 1;
		case 0x58:
		*action = 0x58;
		return 1;
		default:
		break;
	}
	return 0;
}

static U08 ma5105_page62_handle_action(U08 action)
{
	switch (action)
	{
		case 0x01:
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
		ma5105_set_preset_default_icons();
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
		ma5105_set_preset_default_icons();
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
		ma5105_set_preset_default_icons();
		break;
		case 0x05:
		Buzzer_ONOFF();
		ma5105_set_sound_icon();
		break;
		case 0x06:
		if (energy_subscription_run_key_guard())
		{
			ma5105_set_run_icon();
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
		ma5105_set_run_icon();
		old_totalEnergy = totalEnergy;
		TE_Display(old_totalEnergy);
		energy_uart_publish_run_event((opPage & 0x02) ? 1U : 0U, totalEnergy);
		energy_subscription_note_run_state((opPage & 0x02) ? 1U : 0U, totalEnergy);
		break;
		case 0x07:
		totalEnergy = 0;
		old_totalEnergy = 0;
		TE_Display(old_totalEnergy);
		energy_subscription_note_run_state((opPage & 0x02) ? 1U : 0U, totalEnergy);
		break;
		case 0x08:
		if(body_face==0)
		{
			sBody_pw=opower;
			opower=sFace_pw;
			body_face=1;
			pwDisp(opower);
			if (selectMem != 0)
			{
				selectMem = 0;
				MEM_Display(selectMem);
			}
		}
		ma5105_set_mode_icon();
		ma5105_set_preset_default_icons();
		break;
		case 0x09:
		if(body_face==1)
		{
			sFace_pw=opower;
			opower=sBody_pw;
			body_face=0;
			pwDisp(opower);
			if (selectMem != 0)
			{
				selectMem = 0;
				MEM_Display(selectMem);
			}
		}
		ma5105_set_mode_icon();
		ma5105_set_preset_default_icons();
		break;
		case 0x10:
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
		settime = otime;
		selectMem = 1;
		MEM_Display(selectMem);
		pwDisp(opower);
		timeDisp(otime);
		ma5105_set_preset_icons(0x09);
		break;
		case 0x11:
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
		settime = otime;
		selectMem = 2;
		MEM_Display(selectMem);
		pwDisp(opower);
		timeDisp(otime);
		ma5105_set_preset_icons(0x10);
		break;
		case 0x12:
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
		settime = otime;
		selectMem = 3;
		MEM_Display(selectMem);
		pwDisp(opower);
		timeDisp(otime);
		ma5105_set_preset_icons(0x11);
		break;
		case 0x13:
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
		settime = otime;
		selectMem = 4;
		MEM_Display(selectMem);
		pwDisp(opower);
		timeDisp(otime);
		ma5105_set_preset_icons(0x12);
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
		ma5105_set_preset_icons(0x13);
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
		ma5105_toggle_page62_cool_state();
		break;
		case 0x18:
		if(sound_v<9)
		sound_v++;
		Audio_Set(sound_v);
		ma5105_set_sound_icon();
		break;
		case 0x19:
		if(sound_v>0)
		sound_v--;
		Audio_Set(sound_v);
		ma5105_set_sound_icon();
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
		sound_v = action - 0x1a;
		Audio_Set(sound_v);
		ma5105_set_sound_icon();
		break;
		case 0x24:
		pageChange(57);
		break;
		case 0x58:
		pageChange(62);
		_delay_ms(80);
		ma5105_sync_page62_ui();
		break;
		default:
		return 0;
	}

	return 1;
}

static void ma5105_set_mode_icon(void)
{
	if (!ma5105_page62_visible() || (MA5105_ICON_FORCE == 0))
	return;
	// 0x3006: 0->409, 1->410
	varIconInt(0x3006, body_face ? 1 : 0);
}

static void ma5105_set_sound_icon(void)
{
	U08 s;
	if (!ma5105_page62_visible() || (MA5105_ICON_FORCE == 0))
	return;
	s = sound_v;
	if (s > 3)
	s = 3;
	// 0x3007: 0..3 -> 451..454
	varIconInt(0x3007, s);
}

static void ma5105_set_cool_icon(void)
{
	if (!ma5105_page62_visible() || (MA5105_ICON_FORCE == 0))
	return;
	// 0x3008: 0->407(off), 1->408(on)
	varIconInt(0x3008, (peltier_op == 0) ? 1 : 0);
}

static void ma5105_refresh_page62_cool_ui(void)
{
	ma5105_set_cool_icon();
	TEXT_Display_TEMPERATURE(ntc_t);
}

static void ma5105_toggle_page62_cool_state(void)
{
	/*
	 * Page62 0x8016 is a direct cool on/off button.
	 * Keep the visible state tied to peltier_op even when the
	 * page69 cooling policy (cool_ui_show) is disabled.
	 */
	if (peltier_op == 0)
	{
		peltier_op = 1;
		Peltier_OFF(1);
	}
	else
	{
		peltier_op = 0;
		Peltier_OFF(0);
	}

	ma5105_refresh_page62_cool_ui();
}

static void ma5105_set_run_icon(void)
{
	if (!ma5105_page62_visible() || (MA5105_ICON_FORCE == 0))
	return;
	// 0x5001: 0->405(start), 1->406(stop)
	varIconInt(0x5001, (opPage & 0x02) ? 1 : 0);
}

static void ma5105_set_preset_default_icons(void)
{
	if (!ma5105_page62_visible() || (MA5105_ICON_FORCE == 0))
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
	if (!ma5105_page62_visible() || (MA5105_ICON_FORCE == 0))
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
	if (!ma5105_page62_status_visible())
	return;
	if (dwin_page_now == 63)
	{
		ma5105_page62_write_console_text();
	return;
	}
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
	ma5105_page62_write_console_text();
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
		ma5105_page69_sync_entry();
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

static void UpdateVarIcon3Digit(U16 addr_100s, U16 addr_10s, U16 addr_1s, U16 value)
{
	if (value > 999)
	value = 999;
	varIconInt(addr_100s, (value / 100) % 10);
	varIconInt(addr_10s, (value / 10) % 10);
	varIconInt(addr_1s, value % 10);
}

static void ma5105_page69_write_legacy_value(U08 slot, U16 value)
{
	(void)slot;
	(void)value;
}

static void ma5105_page69_append_3digit(char *line, U08 *pos, U08 value)
{
	line[(*pos)++] = (char)('0' + ((value / 100) % 10));
	line[(*pos)++] = (char)('0' + ((value / 10) % 10));
	line[(*pos)++] = (char)('0' + (value % 10));
}

static void ma5105_page69_write_debug_text(void)
{
	char line[MA5105_PAGE69_DEBUG_TEXT_LEN + 1];
	U08 anchors_face = body_face ? 1 : 0;
	U08 pos = 0;
	U08 i;

	line[pos++] = anchors_face ? 'F' : 'B';
	line[pos++] = ' ';
	for (i = 0; i < MA5105_PAGE69_SLOT_COUNT; i++)
	{
		ma5105_page69_append_3digit(line, &pos, ma5105_page69_curve_value(anchors_face, i));
		if (i + 1U < MA5105_PAGE69_SLOT_COUNT)
		{
			line[pos++] = ' ';
		}
	}
	line[pos] = '\0';
	/* Disabled for now: hide page69 debug text display (0xCCCC) while keeping
	   the value-build logic available for later reuse. */
	/* dwin_write_text(MA5105_PAGE69_DEBUG_VP, line, pos); */
}

static void ma5105_page69_write_value(U08 slot)
{
	U16 value = ma5105_page69_curve_value(body_face ? 1 : 0, slot);
	ma5105_page69_write_legacy_value(slot, value);
	UpdateVarIcon3Digit(
		ma5105_page69_slots[slot].icon_hundreds,
		ma5105_page69_slots[slot].icon_tens,
		ma5105_page69_slots[slot].icon_ones,
		value);
}

static void ma5105_page69_reset_active_profile(void)
{
	ma5105_page69_restore_default_anchors(body_face ? 1 : 0);
	ma5105_page69_apply_active_shadow_to_runtime();
	ma5105_page69_save_runtime_to_eeprom(body_face ? 1 : 0);
	ma5105_page69_dirty = 1;
}

static void ma5105_page69_save_active_profile(void)
{
	ma5105_page69_apply_active_shadow_to_runtime();
	ma5105_page69_save_runtime_to_eeprom(body_face ? 1 : 0);
	ma5105_page69_dirty = 1;
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
	UpdateVarIcon3Digit(0x5001, 0x5002, 0x5003, value);
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
	ma5105_page69_dirty = 1;
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
	ma5105_page69_dirty = 1;
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
	ma5105_page69_dirty = 1;
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
	ma5105_page69_dirty = 1;
}

static void ma5105_page69_select_body_face(U08 face_mode)
{
	body_face = face_mode ? 1 : 0;
	ma5105_page69_apply_active_shadow_to_runtime();
	ma5105_page69_dirty = 1;
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
	ma5105_page69_dirty = 1;
}

static void ma5105_page69_force_visible(void)
{
	U08 i;
	ma5105_page69_sync_cool_mode_icon();
	ma5105_page69_sync_foot_switch_icon();
	ma5105_page69_sync_j16_pump_icon();
	ma5105_page69_sync_sound_icon();
	ma5105_page69_sync_body_face_icon();
	ma5105_page69_sync_max_power_icons();
	for (i = 0; i < MA5105_PAGE69_SLOT_COUNT; i++)
	{
		ma5105_page69_write_value(i);
	}
	ma5105_page69_write_debug_text();
	ma5105_page69_write_console_text();
	ma5105_page69_dirty = 0;
	ma5105_page69_enter_pending = 0;
}

static void ma5105_page69_stop_test(void)
{
	U08 i;
	if (ma5105_page69_test_on == 0)
	return;
	ma5105_page69_test_on = 0;
	ma5105_page69_test_slot = 0xFF;
	eng_emi = 0;
	eng_show = ma5105_page69_prev_eng_show;
	OCR1A = 0;
	TC1_PWM_OFF;
	OUT_OFF;
	RIM_pause = 1;
	TCNT3 = 0;
	if (j16mode == 1)
	W_PUMP_OFF;
	for (i = 0; i < MA5105_PAGE69_SLOT_COUNT; i++)
	{
		engTestBtnShow(i,0);
	}
	ma5105_page69_force_visible();
}

static void ma5105_page69_start_test(U08 slot)
{
	if (ma5105_page69_test_on == 0)
	{
		ma5105_page69_prev_eng_show = eng_show;
	}
	eng_show = 1;
	eng_emi = 1;
	if (slot == 0)
	setPower(5);
	else
	setPower((U16)slot * 25);
	TC1_PWM_ON;
	OUT_ON;
	RIM_pause = 0;
	TCNT3 = 0;
	if (j16mode == 1)
	W_PUMP_ON;
	engTestBtnShow(slot,1);
	ma5105_page69_test_on = 1;
	ma5105_page69_test_slot = slot;
	ma5105_page69_dirty = 1;
}

void ma5105_page69_sync_entry(void)
{
	ma5105_page69_normalize_body_face();
	ma5105_page69_load_shadow_profiles();
	ma5105_page69_dirty = 1;
	ma5105_page69_enter_pending = 1;
}

static void ma5105_page69_adjust_value(U08 slot, U08 increase)
{
	U08 *anchors = ma5105_page69_anchor_ptr(body_face ? 1 : 0);
	U08 idx = slot;

	if (increase)
	{
		if (slot == 0)
		{
			if ((U16)anchors[0] + MA5105_PAGE69_VALUE_STEP <= anchors[1])
			{
				anchors[0] = (U08)(anchors[0] + MA5105_PAGE69_VALUE_STEP);
			}
		}
		else if (slot == 8)
		{
			if ((U16)anchors[8] + MA5105_PAGE69_VALUE_STEP <= 200)
			{
				anchors[8] = (U08)(anchors[8] + MA5105_PAGE69_VALUE_STEP);
			}
		}
		else
		{
			if ((U16)anchors[idx] + MA5105_PAGE69_VALUE_STEP <= anchors[idx + 1])
			{
				anchors[idx] = (U08)(anchors[idx] + MA5105_PAGE69_VALUE_STEP);
			}
		}
	}
	else
	{
		if (slot == 0)
		{
			if (anchors[0] > MA5105_PAGE69_VALUE_STEP)
			{
				anchors[0] = (U08)(anchors[0] - MA5105_PAGE69_VALUE_STEP);
			}
		}
		else
		{
			if (anchors[idx] >= (U16)(anchors[idx - 1] + MA5105_PAGE69_VALUE_STEP))
			{
				anchors[idx] = (U08)(anchors[idx] - MA5105_PAGE69_VALUE_STEP);
			}
		}
	}

	ma5105_page69_apply_active_shadow_to_runtime();
	ma5105_page69_dirty = 1;

	if ((ma5105_page69_test_on != 0) && (ma5105_page69_test_slot == slot))
	{
		ma5105_page69_start_test(slot);
	}
}

static U08 ma5105_page69_action_from_key(U16 keyCode, U08 *action)
{
	U08 i;

	switch (keyCode)
	{
		case MA5105_PAGE69_KEY_RETURN:
		*action = 0x00;
		return 1;
		case MA5105_PAGE69_KEY_MAX_POWER_INC:
		*action = 0x0B;
		return 1;
		case MA5105_PAGE69_KEY_MAX_POWER_DEC:
		*action = 0x0C;
		return 1;
		case MA5105_PAGE69_KEY_ICON1:
		*action = 0x12;
		return 1;
		case MA5105_PAGE69_KEY_RESET:
		*action = 0x2E;
		return 1;
		case MA5105_PAGE69_KEY_SAVE:
		*action = 0x2F;
		return 1;
		case MA5105_PAGE69_KEY_ICON0:
		*action = 0x30;
		return 1;
		case MA5105_PAGE69_KEY_ICON2:
		*action = 0x31;
		return 1;
		case MA5105_PAGE69_KEY_ICON3:
		*action = 0x32;
		return 1;
		case MA5105_PAGE69_KEY_ICON1000_SET0:
		*action = 0x34;
		return 1;
		case MA5105_PAGE69_KEY_ICON1000_SET1:
		*action = 0x35;
		return 1;
		default:
		break;
	}

	for (i = 0; i < MA5105_PAGE69_SLOT_COUNT; i++)
	{
		if (keyCode == ma5105_page69_slots[i].minus_key)
		{
			*action = (U08)(0x13 + i);
			return 1;
		}
		if (keyCode == ma5105_page69_slots[i].plus_key)
		{
			*action = (U08)(0x1C + i);
			return 1;
		}
		if (keyCode == ma5105_page69_slots[i].test_key)
		{
			*action = (U08)(0x25 + i);
			return 1;
		}
	}

	return 0;
}

static U08 ma5105_page69_handle_action(U08 action, U08 *factory_cnt)
{
	if ((*factory_cnt != 0) && (action != 0x33))
	{
		*factory_cnt = 0;
	}

	switch (action)
	{
		case 0x00:
		ma5105_page69_stop_test();
		pageChange(62);
		_delay_ms(80);
		ma5105_sync_page62_ui();
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
		ma5105_page69_adjust_max_power(1);
		break;
		case 0x0C:
		ma5105_page69_adjust_max_power(0);
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
		ma5105_page69_toggle_foot_switch();
		break;
		case 0x13:
		case 0x14:
		case 0x15:
		case 0x16:
		case 0x17:
		case 0x18:
		case 0x19:
		case 0x1a:
		case 0x1b:
		ma5105_page69_adjust_value((U08)(action - 0x13), 0);
		break;
		case 0x1c:
		case 0x1d:
		case 0x1e:
		case 0x1f:
		case 0x20:
		case 0x21:
		case 0x22:
		case 0x23:
		case 0x24:
		ma5105_page69_adjust_value((U08)(action - 0x1c), 1);
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
		ma5105_page69_start_test((U08)(action - 0x25));
		break;
		case 0x2e:
		ma5105_page69_reset_active_profile();
		break;
		case 0x2f:
		ma5105_page69_save_active_profile();
		break;
		case 0x30:
		ma5105_page69_toggle_cool_mode();
		break;
		case 0x31:
		ma5105_page69_toggle_j16_mode();
		break;
		case 0x32:
		ma5105_page69_toggle_sound_mode();
		break;
		case 0x33:
		(*factory_cnt)++;
		if (*factory_cnt > 4)
		{
			showPasskey_null();
			*factory_cnt = 0;
			showKeypad(1);
			passmode=1;
		}
		break;
		case 0x34:
		ma5105_page69_select_body_face(1);
		break;
		case 0x35:
		ma5105_page69_select_body_face(0);
		break;
		default:
		return 0;
	}
	return 1;
}

static U08 ma5105_page69_handle_key(U16 keyCode, U08 *factory_cnt)
{
	U08 action;

	ma5105_page69_last_key = keyCode;

	if (!ma5105_page69_action_from_key(keyCode, &action))
	return 0;

	if (ma5105_page69_test_on != 0)
	{
		if ((action >= 0x25) && (action <= 0x2d))
		{
			U08 slot = (U08)(action - 0x25);

			// Match the legacy engineering-page behavior:
			// same test key toggles the output off, another test key switches
			// to the new slot in the same pass.
			if (slot == ma5105_page69_test_slot)
			{
				ma5105_page69_stop_test();
				if (dwin_page_now == MA5105_PAGE69_ID)
				{
					ma5105_page69_tick();
				}
				return 1;
			}
		}

		ma5105_page69_stop_test();
	}

	if (!ma5105_page69_handle_action(action, factory_cnt))
	return 0;

	if (dwin_page_now == MA5105_PAGE69_ID)
	{
		ma5105_page69_tick();
	}

	return 1;
}

static void ma5105_page69_tick(void)
{
	if (dwin_page_now != MA5105_PAGE69_ID)
	return;
	if ((ma5105_page69_dirty == 0) && (ma5105_page69_enter_pending == 0))
	return;
	ma5105_page69_force_visible();
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
					ma5105_page69_tick();
					ma5105_sync_div = 0;
				}
				else if ((dwin_page_now == 62) || (dwin_page_now == 63))
				{
					if (++ma5105_sync_div >= 20)
					{
						ma5105_sync_div = 0;
						ma5105_sync_page62_ui();
					}
				}
				else
				{
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
				if (energy_subscription_runtime_guard(totalEnergy))
				{
					ma5105_set_run_icon();
				}
				else if (otime == 0)
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
				if (parsCnt < PARSBUF_CAPACITY)
				{
					parsBuf[parsCnt++] = rxbuf[readCnt];
				}
				else
				{
					ckHeader = 0;
					parsCnt = 0;
				}
				if (ckHeader && (parsBuf[0] > PARSBUF_MAX_FRAME_LEN))
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
													U16 keyCode = ((U16)parsBuf[5] << 8) | (U16)parsBuf[6];

													if ((dwin_page_now == MA5105_PAGE69_ID) &&
														((parsBuf[5] == 0xDD) || (parsBuf[5] == 0x00)))
													{
														ma_handled = ma5105_page70_handle_hold_key(keyCode);
													}
													else if ((dwin_page_now == MA5105_PAGE69_ID) &&
														((parsBuf[5] == 0x22) || (parsBuf[5] == 0x10) || (parsBuf[5] == 0x23) ||
														(parsBuf[5] == 0x40) || (parsBuf[5] == 0x41)))
													{
														ma_handled = ma5105_page69_handle_key(keyCode, &factory_cnt);
													}
													else if ((dwin_page_now == MA5105_PAGE70_ID) &&
														((parsBuf[5] == 0xBB) || (parsBuf[5] == 0xAB) ||
														(parsBuf[5] == 0xDD) || (parsBuf[5] == 0xCC)))
													{
														ma_handled = ma5105_page70_handle_key(keyCode);
													}
													else if ((dwin_page_now == MA5105_PAGE71_ID) &&
														(parsBuf[5] == 0xD3) && (parsBuf[6] == 0x11))
													{
														if (keyCode == MA5105_PAGE71_KEY_RETURN_TO_69)
														{
															pageChange(MA5105_PAGE69_ID);
															ma5105_page69_sync_entry();
															ma_handled = 1;
														}
													}
													else
													{
														U08 ma_action = 0;

														if ((dwin_page_now == 62) && (opPage & 0x02) && (parsBuf[6] != 0x01))
														{
															ma_handled = 1;
														}
														else if ((dwin_page_now == 57) && (parsBuf[6] == 0x58))
														{
															pageChange(62);
															_delay_ms(80);
															ma5105_sync_page62_ui();
															ma_handled = 1;
														}
														else if ((parsBuf[5] == 0x20) && (parsBuf[6] == 0x00))
														{
															pageChange(58);
															ma_handled = 1;
														}
															else if ((dwin_page_now == 62) && ma5105_page62_action_from_key(keyCode, &ma_action))
															{
																ma5105_page62_last_key = keyCode;
																ma_handled = ma5105_page62_handle_action(ma_action);
																if ((ma_handled != 0) && (dwin_page_now == 69))
																{
																ma5105_page69_sync_entry();
															}
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
												energy_subscription_note_run_state((opPage & 0x02) ? 1U : 0U, totalEnergy);
											break;
											case 0x07:
											
											//otime=settime;
											//timeDisp(otime);
											totalEnergy = 0;
											// [NEW FEATURE] Keep total-energy icon and ESP side synchronized after reset.
											old_totalEnergy = 0;
											TE_Display(old_totalEnergy);
											energy_uart_publish_run_event((opPage & 0x02) ? 1U : 0U, totalEnergy);
											energy_subscription_note_run_state((opPage & 0x02) ? 1U : 0U, totalEnergy);
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
												setEngMode_Factory(0);
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
									if (ma5105_mode())
									{
										if (dwin_page_now == MA5105_PAGE69_ID)
										{
											// MA5105 page69 is driven only by the page's
											// Return Key Codes. Ignore legacy 0x81 action
											// packets here to avoid duplicate/conflicting
											// profile edits versus the raw key handler.
										}
									}
									else if(eng_emi)
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
										setEngMode_Factory(0);
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
