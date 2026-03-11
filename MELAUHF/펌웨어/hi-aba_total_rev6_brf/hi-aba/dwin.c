/*
* dwin.c
*
* Created: 2023-04-14 오후 4:10:44
*  Author: impar
*/
#include "dwin.h"
#include <avr/io.h>
#include <string.h>
#include "common.h"

static U08 buz_on=1;
#if DEBUG
static U08 volume=0x05;
#else
static U08 volume=0x40;
#endif
extern U08 dev_mode;
extern U08 cool_ui_show;
extern U08 startPage;

extern U08 EM_SOUND;

static U08 temp_buf[96];

static unsigned short crc_table[256] = {
	0x0000,0xc0c1,0xc181,0x0140,0xc301,0x03c0,0x0280,0xc241,
	0xc601,0x06c0,0x0780,0xc741,0x0500,0xc5c1,0xc481,0x0440,
	0xcc01,0x0cc0,0x0d80,0xcd41,0x0f00,0xcfc1,0xce81,0x0e40,
	0x0a00,0xcac1,0xcb81,0x0b40,0xc901,0x09c0,0x0880,0xc841,
	0xd801,0x18c0,0x1980,0xd941,0x1b00,0xdbc1,0xda81,0x1a40,
	0x1e00,0xdec1,0xdf81,0x1f40,0xdd01,0x1dc0,0x1c80,0xdc41,
	0x1400,0xd4c1,0xd581,0x1540,0xd701,0x17c0,0x1680,0xd641,
	0xd201,0x12c0,0x1380,0xd341,0x1100,0xd1c1,0xd081,0x1040,
	0xf001,0x30c0,0x3180,0xf141,0x3300,0xf3c1,0xf281,0x3240,
	0x3600,0xf6c1,0xf781,0x3740,0xf501,0x35c0,0x3480,0xf441,
	0x3c00,0xfcc1,0xfd81,0x3d40,0xff01,0x3fc0,0x3e80,0xfe41,
	0xfa01,0x3ac0,0x3b80,0xfb41,0x3900,0xf9c1,0xf881,0x3840,
	0x2800,0xe8c1,0xe981,0x2940,0xeb01,0x2bc0,0x2a80,0xea41,
	0xee01,0x2ec0,0x2f80,0xef41,0x2d00,0xedc1,0xec81,0x2c40,
	0xe401,0x24c0,0x2580,0xe541,0x2700,0xe7c1,0xe681,0x2640,
	0x2200,0xe2c1,0xe381,0x2340,0xe101,0x21c0,0x2080,0xe041,
	0xa001,0x60c0,0x6180,0xa141,0x6300,0xa3c1,0xa281,0x6240,
	0x6600,0xa6c1,0xa781,0x6740,0xa501,0x65c0,0x6480,0xa441,
	0x6c00,0xacc1,0xad81,0x6d40,0xaf01,0x6fc0,0x6e80,0xae41,
	0xaa01,0x6ac0,0x6b80,0xab41,0x6900,0xa9c1,0xa881,0x6840,
	0x7800,0xb8c1,0xb981,0x7940,0xbb01,0x7bc0,0x7a80,0xba41,
	0xbe01,0x7ec0,0x7f80,0xbf41,0x7d00,0xbdc1,0xbc81,0x7c40,
	0xb401,0x74c0,0x7580,0xb541,0x7700,0xb7c1,0xb681,0x7640,
	0x7200,0xb2c1,0xb381,0x7340,0xb101,0x71c0,0x7080,0xb041,
	0x5000,0x90c1,0x9181,0x5140,0x9301,0x53c0,0x5280,0x9241,
	0x9601,0x56c0,0x5780,0x9741,0x5500,0x95c1,0x9481,0x5440,
	0x9c01,0x5cc0,0x5d80,0x9d41,0x5f00,0x9fc1,0x9e81,0x5e40,
	0x5a00,0x9ac1,0x9b81,0x5b40,0x9901,0x59c0,0x5880,0x9841,
	0x8801,0x48c0,0x4980,0x8941,0x4b00,0x8bc1,0x8a81,0x4a40,
	0x4e00,0x8ec1,0x8f81,0x4f40,0x8d01,0x4dc0,0x4c80,0x8c41,
	0x4400,0x84c1,0x8581,0x4540,0x8701,0x47c0,0x4680,0x8641,
	0x8201,0x42c0,0x4380,0x8341,0x4100,0x81c1,0x8081,0x4040
};

unsigned short update_crc(unsigned char *data_blk_ptr, unsigned short data_blk_size)
{
	unsigned short i, j;
	unsigned short crc_accum=0xFFFF;

	for(j = 0; j < data_blk_size; j++)
	{
		i = crc_table[((unsigned short)(crc_accum >> 8) ^ data_blk_ptr[j]) & 0xFF];
		
		crc_accum=(((i&0xff)^(crc_accum&0xff))<<8)+(i>>8);
		
		//crc_accum = (crc_accum << 8) ^ crc_table[i];
	}

	return crc_accum;
}

static void TX1_char(unsigned char data)
{
	while ((UCSR1A & 0x20) == 0x00)
	;
	UDR1 = data;
}
static void DWN_TX(uint8_t *data,uint8_t length)
{
	unsigned short crc;
	uint8_t buf[96];
	if (length > (uint8_t)(sizeof(buf) - 5))
	{
		length = (uint8_t)(sizeof(buf) - 5);
	}
	crc=update_crc(data,length);
	buf[0]=0x5a;
	buf[1]=0xa5;
	buf[2]=length+2;
	memcpy(&buf[3],data,length);
	buf[2+length+1]=(crc>>8)&0xff;
	buf[2+length+2]=(crc)&0xff;
	
	
	for (uint8_t i = 0; i < (uint8_t)(length + 5); i++)
	{
		TX1_char(buf[i]);
	}
}
void audioPlay(uint8_t num)
{
	temp_buf[0]=0x82;
	temp_buf[1]=0x00;
	temp_buf[2]=0xA0;
	temp_buf[3]=num;
	temp_buf[4]=0x01;
	temp_buf[5]=volume;
	temp_buf[6]=0x00;
	
	DWN_TX(temp_buf,7);
}
void audioVolume_Set(uint8_t d)
{
	volume=21*d;
	audioPlay(0);
	
	temp_buf[0]=0x82;
	temp_buf[1]=0x10;
	temp_buf[2]=0x08;
	temp_buf[3]=0x00;
	temp_buf[4]=d;
	
	DWN_TX(temp_buf,5);
}
void audioVolume_10Set(uint8_t d)
{
	volume=7*d;
	audioPlay(0);
	
	temp_buf[0]=0x82;
	temp_buf[1]=0x10;
	temp_buf[2]=0x08;
	temp_buf[3]=0x00;
	temp_buf[4]=d;
	
	DWN_TX(temp_buf,5);
}
void varIconInt(uint16_t add, uint16_t c)
{
	temp_buf[0]=0x82;
	temp_buf[1]=add>>8;
	temp_buf[2]=add&0xff;
	temp_buf[3]=(c>>8)&0xff;
	temp_buf[4]=c&0xff;
	
	
	DWN_TX(temp_buf,5);
	
	
}
static void setDataView(uint16_t add, uint16_t d)
{
	temp_buf[0]=0x82;
	temp_buf[1]=add>>8;
	temp_buf[2]=add&0xff;
	temp_buf[3]=(d>>8)&0xff;
	temp_buf[4]=d&0xff;
	
	DWN_TX(temp_buf,5);
	
	
}
static void setTextView(uint16_t add, char *d, uint8_t len)
{
	
	temp_buf[0]=0x82;
	temp_buf[1]=add>>8;
	temp_buf[2]=add&0xff;
	
	memcpy(&temp_buf[3],d,len);
	
	DWN_TX(temp_buf,3+len);

}
static void setTextViewFixed(uint16_t add, const char *d, uint8_t len)
{
	char local[40];
	uint8_t i;
	if (len > sizeof(local))
	len = sizeof(local);
	for (i = 0; i < len; i++)
	{
		local[i] = ' ';
	}
	if (d != 0)
	{
		for (i = 0; (i < len) && (d[i] != 0); i++)
		{
			local[i] = d[i];
		}
	}
	setTextView(add, local, len);
}
static void setPasskeyView(uint16_t add, const U08 *d)
{
	U08 local[12];
	uint8_t i;
	uint8_t si = 0;
	uint8_t di = 0;

	for (i = 0; i < sizeof(local); i++)
	{
		local[i] = 0x00;
	}

	if (d != 0)
	{
		while ((si < 6) && (d[si] == 0x20))
		{
			si++;
		}
		while ((si < 6) && (di < sizeof(local)))
		{
			if (d[si] == 0x00)
			break;
			if (d[si] != 0x20)
			{
				local[di++] = d[si];
			}
			si++;
		}
	}

	setTextView(add, (char *)local, sizeof(local));
}
static void setTextColor(uint16_t add, uint16_t color)
{
	temp_buf[0]=0x82;
	temp_buf[1]=add>>8;
	temp_buf[2]=add&0xff;	
	temp_buf[3]=color>>8;
	temp_buf[4]=color&0xff;
	
	DWN_TX(temp_buf,5);
}

static uint16_t subscription_plan_icon_id(const char *plan)
{
	char packed[16];
	uint8_t pi = 0;
	uint8_t i = 0;
	// DGUS Variable Icon(0x2200): value 0..4 maps to icon IDs 459..463.

	if (plan == 0)
	{
		return 0;
	}

	while ((plan[i] != 0) && (pi + 1 < sizeof(packed)))
	{
		char c = plan[i++];
		if ((c == ' ') || (c == '\t') || (c == '-') || (c == '_'))
		{
			continue;
		}
		if ((c >= 'a') && (c <= 'z'))
		{
			c = (char)(c - ('a' - 'A'));
		}
		packed[pi++] = c;
	}
	packed[pi] = 0;

	if ((strcmp(packed, "BASIC1M") == 0) || (strcmp(packed, "1M") == 0))
	{
		return 0;
	}
	if ((strcmp(packed, "BASIC3M") == 0) || (strcmp(packed, "3M") == 0))
	{
		return 1;
	}
	if ((strcmp(packed, "BASIC6M") == 0) || (strcmp(packed, "6M") == 0))
	{
		return 2;
	}
	if ((strcmp(packed, "BASIC9M") == 0) || (strcmp(packed, "9M") == 0))
	{
		return 3;
	}
	if ((strcmp(packed, "BASIC1Y") == 0) || (strcmp(packed, "1Y") == 0))
	{
		return 4;
	}

	return 0;
}

void pageChange(uint8_t p)
{
	U08 prev_page = dwin_page_now;
	// Guard against invalid page 0 fallback at runtime.
	// First-boot page7 flow is unaffected because p is 7 in that path.
	if (p == 0)
	{
		p = (startPage != 0) ? startPage : 1;
	}
	temp_buf[0]=0x82;
	temp_buf[1]=0;
	temp_buf[2]=0x84;
	temp_buf[3]=0x5a;
	temp_buf[4]=0x01;
	temp_buf[5]=0x00;
	temp_buf[6]=p;
	
	DWN_TX(temp_buf,7);
	subscription_mark_page_change(p);
	// Page 57 overlays 0x1000 with subscription icon. Restore power/time digits
	// immediately when leaving that page so digits do not stay stale until next +/-.
	if ((prev_page == 57) && (p != 57))
	{
		pwDisp(opower);
		timeDisp(otime);
	}
	
	
}
void SUBSCRIPTION_Render57(const char *plan, const char *range, const char *dday, int remainDays)
{
	uint16_t statusIconVal = 0;
	uint16_t planIconId = subscription_plan_icon_id(plan);
	char remainBuf[6];
	(void)dday;
	if (remainDays < 0)
	{
		remainDays = 0;
	}
	if (remainDays <= 7)
	{
		statusIconVal = 2;
	}
	else if (remainDays <= 30)
	{
		statusIconVal = 1;
	}
	// Page57 subscription text mapping:
	// - period   : VP 0x3100
	// - remain N : VP 0x3300
	// Use same text-display write path as page63 rendering.
	dwin_write_text(0x3100, range, 21);
	snprintf(remainBuf, sizeof(remainBuf), "%d", (int)remainDays);
	dwin_write_text(0x3300, remainBuf, 3);
	// Keep icon writes page-scoped so runtime pages do not get overwritten.
	if (dwin_page_now != 57)
	{
		return;
	}
	// Plan icon remains on 0x2200 (value index 0..4).
	varIconInt(0x2200, planIconId);
	// Remaining-days status icon on 0x1000 is configured as selector index.
	// 0=normal, 1=warning (<=30d), 2=urgent (<=7d)
	varIconInt(0x1000, statusIconVal);
}

void PAGE63_RenderSlot(uint8_t slot, const char *ssid, uint8_t locked)
{
	static const uint16_t kSsidVp[5] = {0x4410, 0x4530, 0x4650, 0x4770, 0x4890};
	static const uint16_t kLockVp[5] = {0x4401, 0x4402, 0x4403, 0x4404, 0x4405};
	// Same strategy as page57 text fields: always write full object width to clear tails.
	static const uint8_t kSsidLen = 32;
	uint8_t hasText;
	const char *safeSsid = (ssid == 0) ? "" : ssid;

	if (slot >= 5)
	{
		return;
	}

	hasText = (safeSsid[0] != 0);
	setTextViewFixed(kSsidVp[slot], safeSsid, kSsidLen);
	// Lock icon object is configured as 2-state selector (0=lock shown, 1=hidden).
	varIconInt(kLockVp[slot], (hasText && locked) ? 0 : 1);
}

void PAGE63_ClearAll(void)
{
	uint8_t i;
	for (i = 0; i < 5; i++)
	{
		PAGE63_RenderSlot(i, "", 0);
	}
}

void dwin_write_text(uint16_t vp_addr, const char* text, uint8_t max_display_len)
{
	// Writes fixed-width text to clear stale tail characters on the DWIN object.
	setTextViewFixed(vp_addr, text, max_display_len);
}

void dwin_switch_page(uint8_t page_id)
{
	pageChange(page_id);
}

void Buzzer(U08 time)
{
	//if (buz_on == 0)
	{
		//if(EM_SOUND)
		audioPlay(0);
		/*else if(time!=0)
		{
		temp_buf[0]=0x82;
		temp_buf[1]=0;
		temp_buf[2]=0x9b;
		temp_buf[3]=5A;
		temp_buf[4]=time;
		
		DWN_TX(temp_buf,5);
		}*/
	}
}
void pwDisp(uint32_t d)
{
	// Page 57 is reserved for subscription visuals (0x1000/0x2200/0x3100/0x3300).
	// Do not let runtime power digits overwrite those VPs.
	if (dwin_page_now == 57)
	{
		return;
	}

	varIconInt(0x1000,d/100);
	varIconInt(0x1001,(d%100)/10);
	varIconInt(0x1002,(d%10));
	if((startPage != 21 ) && (startPage != 49 ))
	{
		varIconInt(0x1400,((d-1)*10/MaxPower)+1);
		if(body_face==1)//face
		{
			varIconInt(0x1010,d/100+10);
			varIconInt(0x1011,(d%100)/10+10);
			varIconInt(0x1012,(d%10)+10);
			varIconInt(0x1013,sBody_pw/100);
			varIconInt(0x1014,(sBody_pw%100)/10);
			varIconInt(0x1015,sBody_pw%10);
		}
		else
		{
			varIconInt(0x1013,d/100+10);
			varIconInt(0x1014,(d%100)/10+10);
			varIconInt(0x1015,(d%10)+10);
			varIconInt(0x1010,sFace_pw/100);
			varIconInt(0x1011,(sFace_pw%100)/10);
			varIconInt(0x1012,sFace_pw%10);
		}
	}
}

void timeDisp(uint32_t d)
{
	if(d==0)
	{
		
		varIconInt(0x1003,0);
		varIconInt(0x1004,0);
		varIconInt(0x1005,0);
		varIconInt(0x1006,0);
		
		if((startPage != 21 ) && (startPage != 49 ))
		{
			varIconInt(0x1401,0);
		}
	}
	else
	{
		varIconInt(0x1003,(d/60)/10);
		varIconInt(0x1004,(d/60)%10);
		varIconInt(0x1005,(d%60)/10);
		varIconInt(0x1006,(d%60)%10);
		
		if((startPage != 21 ) && (startPage != 49 ))
		{
			varIconInt(0x1401,((d-1)*10/5400)+1);
		}		
	}
	
}

void TEST_Display(uint16_t data)
{
	
	varIconInt(0x2000,data/1000000);
	varIconInt(0x2001,(data%1000000)/100000);
	varIconInt(0x2002,(data%100000)/10000);
	varIconInt(0x2003,(data%10000)/1000);
	varIconInt(0x2004,(data%1000)/100);
	varIconInt(0x2005,(data%100)/10);
	varIconInt(0x2006,(data%10));
}
void TE_Display(uint32_t data)
{
	/*if(dev_mode==0)
	{
	varIconInt(0x2001,(data%1000000)/100000);
	varIconInt(0x2002,(data%100000)/10000);
	varIconInt(0x2003,(data%10000)/1000);
	varIconInt(0x2004,(data%1000)/100);
	varIconInt(0x2005,(data%100)/10);
	varIconInt(0x2006,(data%10));
	}
	else*/
	{
		varIconInt(0x2001,data/10000000);
		varIconInt(0x2002,(data%10000000)/1000000);
		varIconInt(0x2003,(data%1000000)/100000);
		varIconInt(0x2004,(data%100000)/10000);
		varIconInt(0x2005,(data%10000)/1000);
		varIconInt(0x2006,(data%1000)/100);
		varIconInt(0x2007,(data%100)/10);
		varIconInt(0x2008,(data%10));
	}
	
}
void setPwValue(unsigned char uni, uint16_t value)
{
	setDataView(0x1f00+(uni*2), value);
}

void setTotalTime(unsigned char uni, unsigned long value)
{
	unsigned int min = 0;
	unsigned int sec = 0;

	min = value / 60;
	sec = value % 60;
	
	setDataView(0x1f00+(uni*4), min);
	setDataView(0x1f00+(uni*4+2), sec);
}
void setMAXPower(U08 p)
{
	setDataView(0x1240, (U16)p);
}


void TEXT_Display_TEMPERATURE(int16_t tem)
{
	char buf[7];
	uint16_t tt;
	if(startPage==61)
	{
		// Page 57 is reserved for subscription overlay (0x1000/0x2200/0x3100/0x3300).
		// Do not overwrite its text fields with MA5105 temperature values.
		if (dwin_page_now == 57)
		{
			return;
		}
		char full_buf[8];
		uint16_t abs_tem;
		uint16_t int_abs;
		uint16_t frac_part;
		full_buf[0]=0;

		// MA5105: icon 407 (cool off) -> hide temperature text.
		if (peltier_op != 0)
		{
			setTextViewFixed(0x1310, "", 6);
			return;
		}

		abs_tem = (tem < 0) ? (uint16_t)(-tem) : (uint16_t)tem;
		int_abs = abs_tem / 10;
		frac_part = abs_tem % 10;
		if (tem < 0)
		snprintf(full_buf, sizeof(full_buf), "-%u.%u", (unsigned int)int_abs, (unsigned int)frac_part);
		else
		snprintf(full_buf, sizeof(full_buf), "%u.%u", (unsigned int)int_abs, (unsigned int)frac_part);
		setTextViewFixed(0x1310, full_buf, 6);
		return;
	}

	if(cool_ui_show!=0)
	{
		if(tem>=0)
		{
			if(tem<100)
			{
				buf[0]=' ';
				buf[1]=' ';
				buf[2]=' ';
				buf[3]=(tem/10)+0x30;
				buf[4]='.';
				buf[5]=(tem%10)+0x30;;
			}
			else
			{
				buf[0]=' ';
				buf[1]=' ';
				buf[2]=(tem/100)+0x30;;
				buf[3]=((tem%100)/10)+0x30;
				buf[4]='.';
				buf[5]=(tem%10)+0x30;;
			}
		}
		else
		{
			tt=tem*(-1);

			if(tt<100)
			{
				buf[0]=' ';
				buf[1]=' ';
				buf[2]='-';
				buf[3]=(tt/10)+0x30;
				buf[4]='.';
				buf[5]=(tt%10)+0x30;;
			}
			else
			{
				buf[0]=' ';
				buf[1]='-';
				buf[2]=(tt/100)+0x30;;
				buf[3]=((tt%100)/10)+0x30;
				buf[4]='.';
				buf[5]=(tt%10)+0x30;;
			}
		}
		setTextView(0x1111,buf,6);
	}
	
}
void TEXT_Display_Message(char *s, uint8_t len)
{	
	setTextView(0x1120,s,len);
}

void readBTN()
{
	temp_buf[0]=0x83;
	temp_buf[1]=0x30;
	temp_buf[2]=0;
	temp_buf[3]=0x01;
	
	DWN_TX(temp_buf,4);
	
}
void clearBTN()
{
	temp_buf[0]=0x82;
	temp_buf[1]=0x30;
	temp_buf[2]=0;
	temp_buf[3]=0x00;
	temp_buf[4]=0x00;
	
	DWN_TX(temp_buf,5);
}
void MEM_Display(U08 d)
{
	
	temp_buf[0]=0x82;
	temp_buf[1]=0x10;
	temp_buf[2]=0x07;
	temp_buf[3]=0x00;
	temp_buf[4]=d;
	
	DWN_TX(temp_buf,5);
	
	
}
void LED_Display(U08 color)
{
	temp_buf[0]=0x82;
	temp_buf[1]=0x10;
	temp_buf[2]=0x0A;
	temp_buf[3]=0x00;
	temp_buf[4]=color;
	
	DWN_TX(temp_buf,5);
	
	LED_A_OFF;
	LED_F_A_OFF;
#if !DUAL_HAND	
	if(color==2)
	{
		LED_B_ON;
	}
	else if(color==1)
	{
		LED_R_ON;
	}
#else
	if(body_face==0)
	{
	if(color==2)
	{
		LED_B_ON;
	}
	else if(color==1)
	{
		LED_R_ON;
	}
	}
	else
	{
		if(color==2)
		{
			LED_F_B_ON;
		}
		else if(color==1)
		{
			LED_F_R_ON;
		}
	}
#endif
}
void TEXT_Display_ERR_CODE(char *cdata,U08 len)
{
	temp_buf[0]=0x82;
	temp_buf[1]=0x12;
	temp_buf[2]=0x00;
	
	memcpy(&temp_buf[3],cdata,len);
	
	DWN_TX(temp_buf,3+len);
}

void TEXT_Display_Check_Code(U08 d)
{
	char cm[]="Invalid Code";
	temp_buf[0]=0x82;
	temp_buf[1]=0x13;
	temp_buf[2]=0x70;
	
	if(d==0)
	{
		memset(&temp_buf[3],0x00,12);
	}
	else
	{
		memcpy(&temp_buf[3],cm,12);
	}
	
	
	DWN_TX(temp_buf,15);
}

void TEXT_Display_eng_pw(uint32_t d)
{
	temp_buf[0]=0x82;
	temp_buf[1]=0x12;
	temp_buf[2]=0x10;
	temp_buf[3]=d/100+0x30;
	temp_buf[4]=((d%100)/10+0x30);
	temp_buf[5]=(d%10)+0x30;
	
	DWN_TX(temp_buf,6);
}
void TEXT_Display_eng_MOVING_SENSOR(U08 d)
{
	char buf[3];
	
	if((d==0))
	{
		buf[0]='O';
		buf[1]='F';
		buf[2]='F';
		setTextView(0x1220,buf,3);
	}
	else
	{
		buf[0]='O';
		buf[1]='N';
		buf[2]=' ';
		setTextView(0x1220,buf,3);
	}
	
}
void TEXT_Display_eng_testmode(U08 d)
{
	char buf[3];
	
	if((d==0))
	{
		buf[0]='O';
		buf[1]='F';
		buf[2]='F';
		setTextView(0x1230,buf,3);
	}
	else
	{
		buf[0]='O';
		buf[1]='N';
		buf[2]=' ';
		setTextView(0x1230,buf,3);
	}
	
}
void TEXT_Display_LIMIT_Time(unsigned long d)
{
	char buf[7];
	unsigned long hour;
	hour=d/60;
	
	if(hour<100000)
	{
		buf[0]=' ';
	}
	else
	{
		buf[0]=(hour%1000000)/100000+0x30;
	}
	
	buf[1]=(hour%100000)/10000+0x30;
	buf[2]=(hour%10000)/1000+0x30;
	buf[3]=(hour%1000)/100+0x30;
	buf[4]=(hour%100)/10+0x30;
	buf[5]=(hour%10)+0x30;
	
	setTextView(0x1270,buf,6);
}
void TEXT_Display_TRIG_mode(U08 d)
{
	char buf[7];
	
	if(d==0)
	{
		buf[0]='O';
		buf[1]='F';
		buf[2]='F';
	}
	else
	{
		buf[0]='O';
		buf[1]='N';
		buf[2]=' ';
	}
	setTextView(0x1280,buf,3);
}
void TEXT_Display_DEV_mode(U08 d)
{
	char buf[7];
	
	if(d&0x80)
	buf[0]='H';
	else if(d&0x40)
	buf[0]='N';
	else
	buf[0]=' ';
	
	switch(d&0x3f)
	{
		case 0:
		buf[1]=' ';
		buf[2]='R';
		buf[3]='E';
		buf[4]='V';
		buf[5]='I';
		buf[6]='V';
		break;
		case 1:
		buf[1]=' ';
		buf[2]=' ';
		buf[3]='H';
		buf[4]='I';
		buf[5]=' ';
		buf[6]=' ';
		break;
		case 2:
		buf[1]=' ';
		buf[2]='b';
		buf[3]='e';
		buf[4]='R';
		buf[5]='e';
		buf[6]=' ';
		break;
		case 3:
		buf[1]=' ';
		buf[2]='S';
		buf[3]='L';
		buf[4]='I';
		buf[5]='M';
		buf[6]=' ';
		break;
		case 4:
		buf[1]=' ';
		buf[2]='S';
		buf[3]='M';
		buf[4]='A';
		buf[5]='L';
		buf[6]='T';
		break;
		case 5:
		buf[1]=' ';
		buf[2]='M';
		buf[3]='A';
		buf[4]='X';
		buf[5]=' ';
		buf[6]=' ';
		break;
		case 6:
		buf[1]=' ';
		buf[2]='M';
		buf[3]='E';
		buf[4]='L';
		buf[5]='A';
		buf[6]=' ';
		break;
		
	}	
	
	setTextView(0x1250,buf,7);
}
void TEXT_Display_TRON_mode(U08 d)
{
	char buf[3];
	
	if(d==0)
	{
		buf[0]='1';
		buf[1]='0';
		buf[2]='0';
		
	}
	else if(d==1)
	{
		buf[0]='2';
		buf[1]='0';
		buf[2]='0';
		
	}
	setTextView(0x1260,buf,3);
}
void TEXT_Display_COOL_UI_mode(U08 d)
{
	char buf[9];
	
	if(d==0)
	{
		buf[0]=' ';
		buf[1]=' ';
		buf[2]=' ';
		buf[3]='O';
		buf[4]='F';
		buf[5]='F';
		buf[6]=' ';
		buf[7]=' ';
		buf[8]=' ';
		
	}
	else if(d==1)
	{
		buf[0]='A';
		buf[1]='L';
		buf[2]='W';
		buf[3]='A';
		buf[4]='Y';
		buf[5]='S';
		buf[6]=' ';
		buf[7]='O';
		buf[8]='N';		
	}
	else if(d==2)
	{
		buf[0]='R';
		buf[1]='E';
		buf[2]='A';
		buf[3]='D';
		buf[4]='Y';
		buf[5]=' ';
		buf[6]='O';
		buf[7]='N';
		buf[8]=' ';
	}
	setTextView(0x1290,buf,9);
}
void Peltier_OFF(uint8_t on_off)//0 : on , 1: off
{
	temp_buf[0]=0x82;
	temp_buf[1]=0x10;
	temp_buf[2]=0x09;
	temp_buf[3]=0x00;
	temp_buf[4]=on_off;
	
	DWN_TX(temp_buf,5);
}
void dwin_buzzer_mode()
{
	temp_buf[0]=0x82;
	temp_buf[1]=0x00;
	temp_buf[2]=0x80;
	temp_buf[3]=0x5a;
	temp_buf[4]=0x00;
	temp_buf[5]=0x00;
	temp_buf[6]=0xF8;

	DWN_TX(temp_buf,7);
}
void dwin_buzzer_onoff(U08 d)//0:on 1:off
{
	temp_buf[0]=0x82;
	temp_buf[1]=0x10;
	temp_buf[2]=0x08;
	temp_buf[3]=0x00;
	temp_buf[4]=d;
	
	DWN_TX(temp_buf,5);
	
	/*temp_buf[0]=0x82;
	temp_buf[1]=0x00;
	temp_buf[2]=0x80;
	temp_buf[3]=0x5a;
	temp_buf[4]=0x00;
	temp_buf[5]=0x00;
	if(d==0)
	temp_buf[6]=0x30;
	else
	temp_buf[6]=0x38;*/

	buz_on=d;

	DWN_TX(temp_buf,7);


}
void TEXT_Display_RIM_PW(U16 f_p,U16 r_p)
{
	temp_buf[0]=0x82;
	temp_buf[1]=0x11;
	temp_buf[2]=0x20;
	
	temp_buf[3]=('F');
	temp_buf[4]=('W');
	temp_buf[5]=(':');
	temp_buf[6]=((f_p/100)/100+0x30);
	temp_buf[7]=(((f_p/100)%100)/10+0x30);
	temp_buf[8]=(((f_p/100)%10)+0x30);
	
	temp_buf[9]=(' ');
	temp_buf[10]=('R');
	temp_buf[11]=('V');
	temp_buf[12]=(':');
	temp_buf[13]=((r_p/100)/100+0x30);
	temp_buf[14]=(((r_p/100)%100)/10+0x30);
	temp_buf[15]=(((r_p/100)%10)+0x30);
	
	DWN_TX(temp_buf,16);
}
void TEXT_Display_BRF_PW(U08 f_p,U08 r_p)
{
	temp_buf[0]=0x82;
	temp_buf[1]=0x11;
	temp_buf[2]=0x20;
	
	temp_buf[3]=('F');
	temp_buf[4]=('W');
	temp_buf[5]=(':');
	temp_buf[6]=(f_p/100+0x30);
	temp_buf[7]=((f_p%100)/10+0x30);
	temp_buf[8]=((f_p%10)+0x30);
	
	temp_buf[9]=(' ');
	temp_buf[10]=('R');
	temp_buf[11]=('V');
	temp_buf[12]=(':');
	temp_buf[13]=(r_p/100+0x30);
	temp_buf[14]=((r_p%100)/10+0x30);
	temp_buf[15]=((r_p%10)+0x30);
	
	DWN_TX(temp_buf,16);
}
void TEXT_Display_NAM_PW(U16 t ,U16 f_p,U16 r_p)
{
	temp_buf[0]=0x82;
	temp_buf[1]=0x11;
	temp_buf[2]=0x20;
	
	temp_buf[3]=('F');
	temp_buf[4]=('W');
	temp_buf[5]=(':');
	temp_buf[6]=((f_p/100)+0x30);
	temp_buf[7]=((f_p%100)/10+0x30);
	temp_buf[8]=((f_p%10)+0x30);
	
	temp_buf[9]=(' ');
	temp_buf[10]=('R');
	temp_buf[11]=('V');
	temp_buf[12]=(':');
	temp_buf[13]=((r_p/100)+0x30);
	temp_buf[14]=((r_p%100)/10+0x30);
	temp_buf[15]=((r_p%10)+0x30);
	
	temp_buf[16]=(' ');
	temp_buf[17]=('T');
	temp_buf[18]=(':');
	temp_buf[19]=((t/10)+0x30);
	temp_buf[20]=((t%10)+0x30);
	
	DWN_TX(temp_buf,21);
}
void cooling_ui_on(uint8_t on_off)//0 : off , 1: on
{
	char buf[7];
	if(on_off==0)
	{
		temp_buf[0]=0x82;
		temp_buf[1]=0x10;
		temp_buf[2]=0x09;
		temp_buf[3]=0x00;
		temp_buf[4]=2;
		
		DWN_TX(temp_buf,5);
		
		temp_buf[0]=0x82;
		temp_buf[1]=0x10;
		temp_buf[2]=0x0b;
		temp_buf[3]=0x00;
		temp_buf[4]=1;
		
		DWN_TX(temp_buf,5);
		
		
		buf[0]=' ';
		buf[1]=' ';
		buf[2]=' ';
		buf[3]=' ';
		buf[4]=' ';
		buf[5]=' ';
		buf[6]=' ';
		
		setTextView(0x1111,buf,7);
		
	}
	else
	{
		temp_buf[0]=0x82;
		temp_buf[1]=0x10;
		temp_buf[2]=0x09;
		temp_buf[3]=0x00;
		temp_buf[4]=0;
		
		DWN_TX(temp_buf,5);
		
		temp_buf[0]=0x82;
		temp_buf[1]=0x10;
		temp_buf[2]=0x0b;
		temp_buf[3]=0x00;
		temp_buf[4]=0;
		
		DWN_TX(temp_buf,5);
	}
}

void j16mode_ui(uint8_t on_off)//0 : pump , 1: led
{
	char buf[4];
	
	if(on_off==0)
	{
		buf[0]='P';
		buf[1]='U';
		buf[2]='M';
		buf[3]='P';
		
	}
	else
	{
		buf[0]='L';
		buf[1]='E';
		buf[2]='D';
		buf[3]=' ';
		
	}
	setTextView(0x12A0,buf,4);
	
}
void sound_mode_ui(uint8_t on_off)//0 : buzzer , 1: speaker
{
	char buf[7];
	
	if(on_off==0)
	{
		buf[0]='B';
		buf[1]='U';
		buf[2]='Z';
		buf[3]='Z';
		buf[4]='E';
		buf[5]='R';
		buf[6]=' ';
		
	}
	else
	{
		buf[0]='S';
		buf[1]='P';
		buf[2]='E';
		buf[3]='A';
		buf[4]='K';
		buf[5]='E';
		buf[6]='R';
		
	}
	setTextView(0x12B0,buf,7);
	
}
void engTestBtnShow(uint8_t b,uint8_t d)
{
	temp_buf[0]=0x82;
	temp_buf[1]=0x12;
	temp_buf[2]=0xC0+b;
	temp_buf[3]=0x00;
	temp_buf[4]=d;
	
	DWN_TX(temp_buf,5);
}
void engShowBtn()
{
	char buf[8];
	
	buf[0]='5';
	buf[1]='W';
	buf[2]=' ';
	setTextView(0x12D0,buf,3);
	buf[0]='2';
	buf[1]='5';
	buf[2]='W';
	setTextView(0x12E0,buf,3);
	buf[0]='5';
	buf[1]='0';
	buf[2]='W';
	setTextView(0x12F0,buf,3);
	buf[0]='7';
	buf[1]='5';
	buf[2]='W';
	setTextView(0x1300,buf,3);
	buf[0]='1';
	buf[1]='0';
	buf[2]='0';
	buf[3]='W';
	setTextView(0x1310,buf,4);

	buf[0]='1';
	buf[1]='2';
	buf[2]='5';
	buf[3]='W';
	setTextView(0x1320,buf,4);
	buf[0]='1';
	buf[1]='5';
	buf[2]='0';
	buf[3]='W';
	setTextView(0x1330,buf,4);
	buf[0]='1';
	buf[1]='7';
	buf[2]='5';
	buf[3]='W';
	setTextView(0x1340,buf,4);
	buf[0]='2';
	buf[1]='0';
	buf[2]='0';
	buf[3]='W';	
	setTextView(0x1350,buf,4);

}
void setModeBtn(uint8_t mode)
{
	if(mode==0)
	{
		varIconInt(0x100C,0);
		varIconInt(0x100D,1);
	}
	else
	{
		varIconInt(0x100C,1);
		varIconInt(0x100D,0);
	}
}
void setEngModeDis(uint8_t mode)
{
	if(mode==0)
	varIconInt(0x100E,1);
	else if(mode==1)
	varIconInt(0x100E,2);
	else
	varIconInt(0x100E,0);
}
void showKeypad(U08 b)
{
	varIconInt(0x1402,b);
}
void showPasskey(U08 *k)
{	
	setPasskeyView(0x1360,k);
}
void reflashD_Date(uint32_t d)
{
	U08 dd[11];	
	dd[0]=((d&0x00ff0000)>>16)/10+0x30;
	dd[1]=((d&0x00ff0000)>>16)%10+0x30;
	dd[2]=0x2f;
	dd[3]=((d&0x0000ff00)>>8)/10+0x30;
	dd[4]=((d&0x0000ff00)>>8)%10+0x30;
	dd[5]=0x2f;
	dd[6]=((d&0x000000ff))/10+0x30;
	dd[7]=((d&0x000000ff))%10+0x30;
	
	setTextViewFixed(0x1380,(const char *)dd,8);	
}
void reflashI_Date(uint32_t d)
{
	U08 dd[11];	
	dd[0]=((d&0x00ff0000)>>16)/10+0x30;
	dd[1]=((d&0x00ff0000)>>16)%10+0x30;
	dd[2]=0x2f;
	dd[3]=((d&0x0000ff00)>>8)/10+0x30;
	dd[4]=((d&0x0000ff00)>>8)%10+0x30;
	dd[5]=0x2f;
	dd[6]=((d&0x000000ff))/10+0x30;
	dd[7]=((d&0x000000ff))%10+0x30;
	
	setTextViewFixed(0x1390,(const char *)dd,8);
}
void showPasskey_null()
{
	engPass[0]=0x20;
	engPass[1]=0x20;
	engPass[2]=0x20;
	engPass[3]=0x20;
	engPass[4]=0x20;
	engPass[5]=0x20;
	setPasskeyView(0x1360,engPass);
}
void setSelectDate(uint8_t d)
{
	if(d==1)
	{
		setTextColor(0x8003,0xf800);
		setTextColor(0x9003,0x0000);	
	}
	else if(d==2)
	{
		setTextColor(0x8003,0x0000);
		setTextColor(0x9003,0xf800);
	}
	else
	{
		setTextColor(0x8003,0x0000);
		setTextColor(0x9003,0x0000);
	}
	
}
