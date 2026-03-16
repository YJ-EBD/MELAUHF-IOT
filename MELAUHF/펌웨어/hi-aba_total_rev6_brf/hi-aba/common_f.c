/*
* common.c
*
* Created: 2024-04-03 오후 7:23:40
*  Author: imq
*/
#include "common_f.h"
#include "tron_mode.h"
#include "dwin.h"
#include "IOT_mode.h"
#include <avr/io.h>
#include <avr/eeprom.h>
#include "crc.h"
#include <math.h>
#include <stdlib.h>
#include "ds1307.h"

void TX0_char(unsigned char data)
{
	while ((UCSR0A & 0x20) == 0x00)
	;
	UDR0 = data;
}
void BRF_READ(U08 d)
{
	
}
void BRF_RUN(U08 d)
{
	U08 tbuf[8];
	U16 crc;
	
	tbuf[0]=0x26;
	tbuf[1]=0x06;
	
	tbuf[2]=0x00;
	tbuf[3]=0x00;
	
	tbuf[4]=0x00;
	tbuf[5]=d;
	
	crc=Generate_CRC(tbuf, 6);
	
	tbuf[6]=crc;
	tbuf[7]=crc>>8;	
}
void writeRIM(U08 cmd, U16 len, U08 *data)
{
	U08 frame[4 + 1 + 1 + 1 + 2 + 26 + 2 + 1];
	U08 tx_len = 0, cnt = 0;
	U16 crc;
	frame[tx_len++] = 0x16;
	frame[tx_len++] = 0x16;
	frame[tx_len++] = 0x16;
	frame[tx_len++] = 0x16;
	frame[tx_len++] = 0xA0;
	frame[tx_len++] = 0x21;
	frame[tx_len++] = cmd;
	frame[tx_len++] = len >> 8;
	frame[tx_len++] = len;
	for (cnt = 0; cnt < len; cnt++)
	{
		frame[tx_len++] = data[cnt];
	}
	crc = Generate_CRC(&frame[4], len + 5);
	frame[tx_len++] = crc >> 8;
	frame[tx_len++] = crc;
	frame[tx_len++] = 0xf5;

	cnt = 0;
	while (tx_len--)
	{
		TX0_char(frame[cnt++]);
	}
}
void writeRIM_STATE()
{
	RIM_CK = 0;
	writeRIM(0x11, 0, 0);
}
void writeRIM_Power(U16 p)
{
	U08 data[26];

	data[0] = 0x02;
	data[1] = 0;
	data[2] = 0;
	data[3] = p >> 8;
	data[4] = p;
	for (int i = 0; i < 21; i++)
	data[5 + i] = 0;
	writeRIM(0x51, 26, data);

	//	_delay_ms((500));
}
void writeRIM_ON()
{
	writeRIM(0x22, 0, 0);
}
void writeRIM_OFF()
{
	writeRIM(0x23, 0, 0);
}

void LED_WHITE(U08 bri)
{	
	LED_Display(2);
}
void LED_RED(U08 bri)
{
	
	LED_Display(1);
}
void LED_GREEN(U08 bri)
{
	
	LED_Display(5);
}
void LED_YELLOW(U08 bri)
{
	
	LED_Display(3);
}
void LED_ORANGE(U08 bri)
{
	
	LED_Display(2);
}
void LED_OFF()
{
	
	LED_Display(0);
}
void setPower(uint32_t p)
{
	int temp_pw=0;
	

	#if NEW_BOARD
	if(body_face==0)
	{
		//if(dev_mode&0x40)
		//temp_pw = pw_data[p / 5 - 1];
		//else
		temp_pw = pw_data[p / 5 - 1]/5*pw_data[p / 5 - 1]/5-pw_data[p / 5 - 1]+20;
	}
	else
	{
		//if(dev_mode&0x40)
		//temp_pw = pw_data_face[p / 5 - 1];
		//else
		temp_pw = pw_data_face[p / 5 - 1]/5*pw_data_face[p / 5 - 1]/5-pw_data_face[p / 5 - 1]+20;
	}		
		
	#else
	if(body_face==0)
	temp_pw = pw_data[p / 5 - 1] * 85 - 400;
	else
	temp_pw = pw_data_face[p / 5 - 1] * 85 - 400;
		
	#endif
		
	if (temp_pw < 0)
	OCR1A = 0;
	else
	OCR1A = temp_pw;
	
	
}
void setReady()
{	
	if(time_err==1)
	{
		errDisp();

		TEXT_Display_ERR_CODE("ERR CODE 12", 11);
		while (1)
		{
			asm("wdr");
		}
	}
	else if(time_err==2)
	{
		errDisp();
		TEXT_Display_ERR_CODE("ERR CODE 13", 11);
		while (1)
		{
			asm("wdr");
		}
	}
	if (!foot_op)
	{
		LED_RED(RED_BRI);
	}

	//save_time = eeprom_read_dword(&PW_TIME[opower / 5 - 1]);
	pageChange(startPage+1);

	/*	if(opower<=40)
	{
	OCR1A = (opower * 1.25);
	}
	else
	{
	OCR1A = 50+((opower -40)*3.8);
	}*/
	
	setPower(opower);		

	if (!foot_op)
	{

		TC1_PWM_ON;
		OUT_ON;
		RIM_pause = 0;
	}
	TCNT3 = 0;
	sec_cnt = 0;

	hand_moving = 1;
	old_hand_moving = 0;
	off_cnt = 0;
	if(j16mode==1)
	H_LED_ON;	
	if (HICmode)
	{
		writeRIM_ON();
	}	
}

void setStandby()
{
	//eeprom_update_dword(&PW_TIME[opower / 5 - 1], save_time);
	eeprom_busy_wait();
	eep_s_num++;

	switch (eep_s_num)
	{
		case 1:
		eeprom_update_dword(&TT_TIME1, total_time);
		eeprom_busy_wait();
		checksum = (((U08 *)(&total_time))[0] + ((U08 *)(&total_time))[1] + ((U08 *)(&total_time))[2] + ((U08 *)(&total_time))[3]) & 0xff;
		eeprom_update_byte(&TT_TIME_CHECKSUM1, checksum);
		eeprom_busy_wait();
		break;
		case 2:
		eeprom_update_dword(&TT_TIME2, total_time);
		eeprom_busy_wait();
		checksum = (((U08 *)(&total_time))[0] + ((U08 *)(&total_time))[1] + ((U08 *)(&total_time))[2] + ((U08 *)(&total_time))[3]) & 0xff;
		eeprom_update_byte(&TT_TIME_CHECKSUM2, checksum);
		eeprom_busy_wait();
		break;
		default:
		eep_s_num = 0;
		eeprom_update_dword(&TT_TIME0, total_time);
		eeprom_busy_wait();
		checksum = (((U08 *)(&total_time))[0] + ((U08 *)(&total_time))[1] + ((U08 *)(&total_time))[2] + ((U08 *)(&total_time))[3]) & 0xff;
		eeprom_update_byte(&TT_TIME_CHECKSUM0, checksum);
		eeprom_busy_wait();
		break;
	}

	pageChange(IOT_mode_runtime_page(startPage));

	if (HICmode)
	{
		writeRIM_OFF();
		writeRIM_Power(0);
	}

	OCR1A = 0;
	TC1_PWM_OFF;
	OUT_OFF;
	RIM_pause = 1;
	TCNT3 = 0;
	sec_cnt = 0;

	
	if(j16mode==1)
	H_LED_OFF;

	LED_WHITE(WHITE_BRI);
	
	moving_temp_on = 0;
}

void errDisp()
{
	opPage = 0x80;
	pageChange(10);

	OCR1A = 0;
	OUT_OFF;
	RIM_pause = 1;
	TCNT3 = 0;
	sec_cnt = 0;
}
void setEngMode()
{
	if(startPage==61)
	{
		pageChange(69);
		sound_mode_ui(EM_SOUND);
	}
	else
	pageChange(8);

	OCR1A = 0;
	OUT_OFF;
	RIM_pause = 1;
	TCNT3 = 0;
	sec_cnt = 0;
	eng_show = 1;
	eng_emi=0;
	
	if(body_face==0)
	{
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
	
	TEXT_Display_COOL_UI_mode(cool_ui_show);
	
	TEXT_Display_TRIG_mode(foot_op);
	setMAXPower(MaxPower);
	j16mode_ui(j16mode);//0 : pump , 1: led
	engShowBtn();
	
	if((startPage != 21 ))
	{
		setEngModeDis(body_face);
	}
	else
	{
		setEngModeDis(99);
	}
	
	if((dev_mode & 0xC0)!=0)
	eng_show_mode=1;
	TEXT_Display_eng_testmode(eng_show_mode);
	if(startPage==61)
	{
		ma5105_page69_sync_entry();
	}
}
void setEngMode_Factory(uint8_t s)
{
	if(s==0)
	pageChange(9);
	else
	{
		pageChange(63);
		reflashI_Date(ins_date);
	}

	OCR1A = 0;
	OUT_OFF;
	RIM_pause = 1;
	TCNT3 = 0;
	sec_cnt = 0;
	eng_show = 2;
	eng_emi=0;

	if(body_face==0)
	{
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

	TEXT_Display_COOL_UI_mode(cool_ui_show);

	setTotalTime(40, total_time);
	setMAXPower(MaxPower);

	TEXT_Display_eng_MOVING_SENSOR(moving_sensing);

	TEXT_Display_eng_testmode(eng_show_mode);
	TEXT_Display_DEV_mode(dev_mode);
//	TEXT_Display_TRON_mode(TRON_200);
	TEXT_Display_TRIG_mode(foot_op);
	j16mode_ui(j16mode);//0 : pump , 1: led
	sound_mode_ui(EM_SOUND);

	TEXT_Display_LIMIT_Time(lim_time);
	
	engShowBtn();
	
	if((startPage != 21 ))
	{
		setEngModeDis(body_face);
	}
	else
	{
		setEngModeDis(99);
	}
}
void exitEngMode()
{			
	AC_OFF;
	
	pageChange(startPage+2);

	OCR1A = 0;
	OUT_OFF;
	RIM_pause = 1;
	TCNT3 = 0;
	sec_cnt = 0;
	eng_show = 0;
		
	TE_Display(old_totalEnergy);	
}
void setDateMode()////////////////////edit
{
	pageChange(6);
	
	OCR1A = 0;
	OUT_OFF;
	RIM_pause = 1;
	TCNT3 = 0;
	sec_cnt = 0;
	eng_show = 3;
	eng_emi=0;	
	
	setSelectDate(0);
	ds1307_init(0,&cur_date);
	reflashD_Date(cur_date);
	reflashI_Date(ins_date);
	
	
}
void Buzzer_ONOFF()
{
	if(sound_v>3)
		sound_v=3;
	if(sound_v>0)
	sound_v--;
	else
	sound_v=3;
	

	
	audioVolume_Set(sound_v);

	
	eeprom_update_byte(&SOUND_VOLUME, sound_v);
	eeprom_busy_wait();
}
void Audio_Set(uint8_t s)
{	
	audioVolume_10Set(s);
	
	eeprom_update_byte(&SOUND_VOLUME, s);
	eeprom_busy_wait();
}
void hexToString(U08 *in, U08 *out, U08 len)
{
	U08 h_b, h_l;
	for (int i = 0; i < len; i++)
	{
		h_b = (in[i] >> 4) & 0x0f;
		h_l = (in[i] & 0x0f);

		if (h_b >= 10)
		{
			out[i * 2] = h_b - 10 + 'A';
		}
		else
		{
			out[i * 2] = h_b + '0';
		}
		if (h_l >= 10)
		{
			out[i * 2 + 1] = h_l - 10 + 'A';
		}
		else
		{
			out[i * 2 + 1] = h_l + '0';
		}
	}
}
void read_temp()
{
	U16 adc_raw;
	double ntc_r = 0, ntc_raw;
	int16_t prv_ntc_t = 0;
	
		if (TEC_STATE)
		{
			if (((foot_op) && (opPage & 0x04)) || ((!foot_op) && (opPage & 0x02)))
			{
				if (ntc_t < 10)
				{
					ntc_t = ntc_t + (rand() % 5);
				}
				else if (ntc_t < 30)
				{
					ntc_t = ntc_t + (5 - rand() % 12);
				}
				else
				{
					ntc_t = ntc_t - (rand() % 10);
				}
			}
			else
			{
				if (ntc_t < (-50))
				{
					ntc_t = ntc_t + (rand() % 10);
				}
				else if (ntc_t < -20)
				{
					ntc_t = ntc_t + (5 - rand() % 12);
				}
				else if (ntc_t < 0)
				{
					ntc_t = ntc_t - (rand() % 5);
				}
				else if (ntc_t > 50)
				{
					ntc_t = ntc_t - (rand() % 30);
				}
				else
				{
					ntc_t = ntc_t - (rand() % 10);
				}
			}
		}
		else
		{
			if (((foot_op) && (opPage & 0x04)) || ((!foot_op) && (opPage & 0x02)))
			{
				if (ntc_t < 240)
				{
					ntc_t = ntc_t + (rand() % 10);
				}
				else if (ntc_t < 260)
				{
					ntc_t = ntc_t + (5 - rand() % 12);
				}
				else
				{
					ntc_t = ntc_t - (rand() % 10);
				}
			}
			else
			{
				if (ntc_t < 200)
				{
					ntc_t = ntc_t + (rand() % 10);
				}
				else if (ntc_t < 220)
				{
					ntc_t = ntc_t + (5 - rand() % 12);
				}
				else
				{
					ntc_t = ntc_t - (rand() % 10);
				}
			}
		}
		
}
void pw_auto_cal()
{
	float uni=0;
	if(body_face==0)
	{
		uni=(pw_data[4]-pw_data[0])/4.0f;
		for(int i=1;i<4;i++)
		{
			pw_data[i]=pw_data[0]+(uni*i);
		}
		
		for(int j=0;j<7;j++)
		{
			uni=(pw_data[4+((j+1)*5)]-pw_data[4+(j*5)])/5.0f;
			for(int i=(j+1)*5;i<(j+1)*5+4;i++)
			{
				pw_data[i]=pw_data[4+(j*5)]+(uni*(i-((j+1)*5-1)));
			}
		}		
	}
	else
	{
		uni=(pw_data_face[4]-pw_data_face[0])/4.0f;
		for(int i=1;i<4;i++)
		{
			pw_data_face[i]=pw_data_face[0]+(uni*i);
		}
		
		for(int j=0;j<7;j++)
		{
			uni=(pw_data_face[4+((j+1)*5)]-pw_data_face[4+(j*5)])/5.0f;
			for(int i=(j+1)*5;i<(j+1)*5+4;i++)
			{
				pw_data_face[i]=pw_data_face[4+(j*5)]+(uni*(i-((j+1)*5-1)));
			}
		}
	}
	
}
void readBRF(U16 reg, U08 cnt)
{
	U08 frame[8];
	U08 tx_len = 0;
	U16 crc;
	
	frame[0]=0x26;
	frame[1]=0x03;
	frame[2]=0x00;
	frame[3]=reg;
	frame[4]=0x00;
	frame[5]=cnt;
			
	crc = Funct_CRC16(frame, 6);
	frame[7] = crc >> 8;
	frame[6] = crc;
	
	cnt = 0;
	for(int i=0;i<8;i++)
		TX0_char(frame[i]);
	
}
void readBRF_STATE()
{
	RIM_CK = 0;
	readBRF(0x00, 16);
}
static void writeBRF(U08 reg, U08 d)
{
	U08 data[8];
	U16 crc;

	data[0] = 0x26;
	data[1] = 0x06;
	data[2] = 0x00;
	data[3] = reg;
	data[4] = 0x00;
	data[5] = d;
	
	crc = Funct_CRC16(data, 6);
	
	data[6] = crc;
	data[7] = crc >> 8;
	
	for(int i=0;i<8;i++)
	TX0_char(data[i]);
}
void writeBRF_Power(U08 p)
{
	writeBRF(0x05,p);
}
void writeBRF_Off()
{
	writeBRF(0x00,0);
}
void writeBRF_On()
{
	writeBRF(0x00,1);
}
void writeBRF_Channel(U08 d)
{
	writeBRF(0x04,d);
}
