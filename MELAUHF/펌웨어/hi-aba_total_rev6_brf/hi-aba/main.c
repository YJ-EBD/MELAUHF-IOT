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
#include "Init.h"
#include <avr/eeprom.h>
#include "dwin.h"
#include "common_f.h"
#include "crc.h"
#include "tron_mode.h"
#include "hic_mode.h"
#include "brf_mode.h"
#include "ds1307.h"
#include "i2c.h"
#include "IOT_mode.h"


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
EEMEM uint32_t MA5105_FW_BOOT_MARK = 0;

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
U08 rxbuf[256], parsBuf[PARSBUF_CAPACITY], ckHeader = 0, txBuf[256], eep_s_num = 0;
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

#define PW_PROFILE_LEN 40U
#define PW_PROFILE_MIN 1U
#define PW_PROFILE_MAX 200U
#define PAGE7_CODE_LEN 6U

#define MA5105_FW_BOOT_MARK_EXPECTED \
	(0x51050000UL ^ \
	 ((uint32_t)(__DATE__[4]) << 24) ^ \
	 ((uint32_t)(__DATE__[5]) << 16) ^ \
	 ((uint32_t)(__TIME__[0]) << 12) ^ \
	 ((uint32_t)(__TIME__[1]) << 8) ^ \
	 ((uint32_t)(__TIME__[3]) << 4) ^ \
	 ((uint32_t)(__TIME__[4])))

static U08 pw_profile_is_sane(const U08 *profile)
{
	U08 prev = 0;
	U08 i;

	for (i = 0; i < PW_PROFILE_LEN; i++)
	{
		U08 value = profile[i];

		if ((value < PW_PROFILE_MIN) || (value > PW_PROFILE_MAX))
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

static void pw_profile_restore_default(U08 *profile, uint8_t *eep_profile)
{
	U08 i;

	for (i = 0; i < PW_PROFILE_LEN; i++)
	{
		U08 value = (U08)((i + 1U) * 5U);

		profile[i] = value;
		eeprom_update_byte(&eep_profile[i], value);
		eeprom_busy_wait();
	}
}

static void pw_profile_boot_sanitize(U08 *profile, uint8_t *eep_profile)
{
	if (!pw_profile_is_sane(profile))
	{
		pw_profile_restore_default(profile, eep_profile);
	}
}

static void page7_reset_code(U08 *code)
{
	U08 i;

	for (i = 0; i < PAGE7_CODE_LEN; i++)
	{
		code[i] = 0x20;
	}
}

static void page7_reset_uart_parser(void)
{
	cli();
	readCnt = writeCnt;
	parsCnt = 0;
	ckHeader = 0;
	sei();
}

static U08 page7_match_dev_mode(const U08 *code, U08 *next_dev_mode)
{
	if (((code[0] == 'M') || (code[0] == 'm')) && ((code[1] == 'A') || (code[1] == 'a')))
	{
		if ((code[2] == '1') && (code[3] == '3') && (code[4] == '5') && (code[5] == '8'))
		{
			*next_dev_mode = 0x00;
			return 1;
		}
		if ((code[2] == '8') && (code[3] == '5') && (code[4] == '4') && (code[5] == '1'))
		{
			*next_dev_mode = 0x80;
			return 1;
		}
		if ((code[2] == '2') && (code[3] == '4') && (code[4] == '6') && (code[5] == '9'))
		{
			*next_dev_mode = 0x40;
			return 1;
		}
		if ((code[2] == '5') && (code[3] == '1') && (code[4] == '0') && (code[5] == '5'))
		{
			*next_dev_mode = 0x08;
			return 1;
		}
	}
	else if (((code[0] == 'M') || (code[0] == 'm')) && ((code[1] == 'U') || (code[1] == 'u')))
	{
		if ((code[2] == '2') && (code[3] == '3') && (code[4] == '4') && (code[5] == '6'))
		{
			*next_dev_mode = 0x07;
			return 1;
		}
		if ((code[2] == '7') && (code[3] == '6') && (code[4] == '5') && (code[5] == '3'))
		{
			*next_dev_mode = 0x87;
			return 1;
		}
		if ((code[2] == '3') && (code[3] == '4') && (code[4] == '5') && (code[5] == '7'))
		{
			*next_dev_mode = 0x47;
			return 1;
		}
	}
	else if (((code[0] == 'E') || (code[0] == 'e')) && ((code[1] == 'U') || (code[1] == 'u')))
	{
		if ((code[2] == '3') && (code[3] == '5') && (code[4] == '7') && (code[5] == '8'))
		{
			*next_dev_mode = 0x01;
			return 1;
		}
		if ((code[2] == '6') && (code[3] == '4') && (code[4] == '2') && (code[5] == '1'))
		{
			*next_dev_mode = 0x81;
			return 1;
		}
		if ((code[2] == '4') && (code[3] == '6') && (code[4] == '8') && (code[5] == '9'))
		{
			*next_dev_mode = 0x41;
			return 1;
		}
	}
	else if (((code[0] == 'L') || (code[0] == 'l')) && ((code[1] == 'H') || (code[1] == 'h')))
	{
		if ((code[2] == '5') && (code[3] == '4') && (code[4] == '1') && (code[5] == '8'))
		{
			*next_dev_mode = 0x02;
			return 1;
		}
		if ((code[2] == '4') && (code[3] == '5') && (code[4] == '8') && (code[5] == '1'))
		{
			*next_dev_mode = 0x82;
			return 1;
		}
		if ((code[2] == '6') && (code[3] == '5') && (code[4] == '2') && (code[5] == '9'))
		{
			*next_dev_mode = 0x42;
			return 1;
		}
	}
	else if (((code[0] == 'A') || (code[0] == 'a')) && ((code[1] == 'F') || (code[1] == 'f')))
	{
		if ((code[2] == '9') && (code[3] == '1') && (code[4] == '0') && (code[5] == '8'))
		{
			*next_dev_mode = 0x03;
			return 1;
		}
		if ((code[2] == '0') && (code[3] == '8') && (code[4] == '9') && (code[5] == '1'))
		{
			*next_dev_mode = 0x83;
			return 1;
		}
		if ((code[2] == '0') && (code[3] == '2') && (code[4] == '1') && (code[5] == '9'))
		{
			*next_dev_mode = 0x43;
			return 1;
		}
	}
	else if (((code[0] == 'U') || (code[0] == 'u')) && ((code[1] == 'M') || (code[1] == 'm')))
	{
		if ((code[2] == '4') && (code[3] == '5') && (code[4] == '6') && (code[5] == '8'))
		{
			*next_dev_mode = 0x04;
			return 1;
		}
		if ((code[2] == '5') && (code[3] == '4') && (code[4] == '3') && (code[5] == '1'))
		{
			*next_dev_mode = 0x84;
			return 1;
		}
		if ((code[2] == '5') && (code[3] == '6') && (code[4] == '7') && (code[5] == '9'))
		{
			*next_dev_mode = 0x44;
			return 1;
		}
	}
	else if (((code[0] == 'H') || (code[0] == 'h')) && ((code[1] == 'E') || (code[1] == 'e')))
	{
		if ((code[2] == '7') && (code[3] == '8') && (code[4] == '1') && (code[5] == '8'))
		{
			*next_dev_mode = 0x05;
			return 1;
		}
		if ((code[2] == '2') && (code[3] == '1') && (code[4] == '8') && (code[5] == '1'))
		{
			*next_dev_mode = 0x85;
			return 1;
		}
		if ((code[2] == '8') && (code[3] == '9') && (code[4] == '2') && (code[5] == '9'))
		{
			*next_dev_mode = 0x45;
			return 1;
		}
	}
	else if (((code[0] == 'F') || (code[0] == 'f')) && ((code[1] == 'L') || (code[1] == 'l')))
	{
		if ((code[2] == '0') && (code[3] == '7') && (code[4] == '8') && (code[5] == '8'))
		{
			*next_dev_mode = 0x06;
			return 1;
		}
		if ((code[2] == '9') && (code[3] == '2') && (code[4] == '1') && (code[5] == '1'))
		{
			*next_dev_mode = 0x86;
			return 1;
		}
		if ((code[2] == '1') && (code[3] == '8') && (code[4] == '9') && (code[5] == '9'))
		{
			*next_dev_mode = 0x46;
			return 1;
		}
	}

	return 0;
}

static void page7_commit_dev_mode(U08 next_dev_mode)
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

	if ((dev_mode & 0x3f) == 8)
	{
		eeprom_update_dword(&MA5105_FW_BOOT_MARK, MA5105_FW_BOOT_MARK_EXPECTED);
		eeprom_busy_wait();
	}

	init_boot = 1;
	page7_reset_uart_parser();
	showPasskey_null();
	asm("jmp 0");
}

static void page7_submit_code(U08 *code)
{
	U08 next_dev_mode = 0;

	TEXT_Display_Check_Code(0);
#if DEBUG
	TX0_char('\r');
	TX0_char('\n');
	TX0_char('C');
	TX0_char(':');
	for (U08 ai = 0; ai < PAGE7_CODE_LEN; ai++)
	{
		TX0_char(code[ai]);
	}
	TX0_char('\r');
	TX0_char('\n');
#endif

	if (page7_match_dev_mode(code, &next_dev_mode))
	{
		page7_commit_dev_mode(next_dev_mode);
	}

#if DEBUG
	TX0_char('M');
	TX0_char(':');
	TX0_char('N');
	TX0_char('\r');
	TX0_char('\n');
#endif
	page7_reset_code(code);
	TEXT_Display_Check_Code(1);
}

static U08 ma5105_eeprom_mode_selected(void)
{
	U08 storedMode = eeprom_read_byte(&OP_MODE);
	U08 storedModeCk = eeprom_read_byte(&OP_MODE_CK);

	if (((storedMode + storedModeCk) & 0xff) != 0)
	{
		return 0;
	}

	return (((storedMode & 0x3f) == 8) ? 1 : 0);
}

static void ma5105_force_boot_page7_after_new_firmware(void)
{
	uint32_t storedMark;

	if (!ma5105_eeprom_mode_selected())
	{
		return;
	}

	storedMark = eeprom_read_dword(&MA5105_FW_BOOT_MARK);
	if (storedMark == MA5105_FW_BOOT_MARK_EXPECTED)
	{
		return;
	}

	// Each newly built firmware image gets a different boot marker.
	// On the first boot after flashing that image, keep the existing
	// calibration curves and only force the registration/page7 flow once.
	// Invalid EEPROM profiles are still repaired later during boot
	// by pw_profile_boot_sanitize() after the curves are loaded.
	eeprom_update_dword(&MA5105_FW_BOOT_MARK, MA5105_FW_BOOT_MARK_EXPECTED);
	eeprom_busy_wait();
	eeprom_update_byte(&WIFI_BOOT_PAGE61_ONCE, 0);
	eeprom_busy_wait();
	eeprom_update_byte(&INIT_BOOT, 0);
	eeprom_busy_wait();
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
	if ((init_boot == 0) || (dwin_page_now == 7))
	{
		AC_ON;
		EIFR = _BV(4);
		return;
	}
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
	U08 runtimeOutputsEnabled = 0;
	
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

	ma5105_force_boot_page7_after_new_firmware();

	
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
	pw_profile_boot_sanitize(pw_data, PW_VALUE);
	pw_profile_boot_sanitize(pw_data_face, PW_VALUE_FACE);
	EM_SOUND=eeprom_read_byte(&SOUND_MODE);
	
	
	j16mode=eeprom_read_byte(&J16_MODE);
	
	init_boot = eeprom_read_byte(&INIT_BOOT);
	if(init_boot==0)
	{
		EIMSK &= (uint8_t)~_BV(4);
		EIFR = _BV(4);
		pageChange(7);
		page7_reset_code(actCode);
		clearPasskeyDisplay();
		showPasskey(actCode);
		TEXT_Display_Check_Code(0);
		_delay_ms(80);
		page7_reset_uart_parser();
		while(1)
		{
			asm("wdr");
			_delay_ms(10); //(10);
			
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
								if(parsBuf[6]==0xF0)
								{
									page7_reset_code(actCode);
									TEXT_Display_Check_Code(0);
								}
								else if(parsBuf[6]==0x0d)
								{
									page7_submit_code(actCode);
								}
								else if(parsBuf[5]==0x21)
								{
									TEXT_Display_Check_Code(0);
									actCode[0]=actCode[1];
									actCode[1]=actCode[2];
									actCode[2]=actCode[3];
									actCode[3]=actCode[4];
									actCode[4]=actCode[5];
									actCode[5]=parsBuf[6];
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
			if (startPage == 61)
			{
				// Rebuild the MA5105 runtime curve from the 9 engineering
				// anchors so page62 uses the same calibration model as page69.
				ma5105_profile_boot_sync();
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
			bootResumePage = IOT_mode_prepare_boot_resume_page(startPage);

				if (!IOT_mode_run_boot_checks(bootResumePage))
				{
					while (1)
					{
						asm("wdr");
						subscription_ui_tick();
						IOT_mode_force_hw_isolation();
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

		IOT_mode_wait_for_runtime_ready();
		ETIFR = ETIFR | _BV(4);
		IOT_mode_apply_runtime_hw_gate();
		runtimeOutputsEnabled = IOT_mode_runtime_outputs_enabled();

	LED_WHITE(WHITE_BRI);
	
	#if !DUAL_HAND
	if((j16mode==0) && runtimeOutputsEnabled)
	W_PUMP_ON;
	#endif
	
	// audioPlay();
	
	if (runtimeOutputsEnabled)
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
