/*
 * dwin.h
 *
 * Created: 2023-04-14 오후 4:10:32
 *  Author: impar
 */ 


#ifndef DWIN_H_
#define DWIN_H_

#include <stdio.h>
#include "Define.h"

void pageChange(uint8_t p);

void varIconInt(uint16_t add, uint16_t c);

void Buzzer(U08 time);

void pwDisp(uint32_t d);

void timeDisp(uint32_t d);

void TEST_Display(uint16_t data);

void TE_Display(uint32_t data);

void setTotalTime(unsigned char uni, unsigned long value);

void setMAXPower(U08 p);

void TEXT_Display_TEMPERATURE(int16_t tem);

void TEXT_Display_Message(char *s, uint8_t len);

void readBTN();

void clearBTN();

void MEM_Display(U08 d);

void LED_Display(U08 color);

void TEXT_Display_ERR_CODE(char *cdata,U08 len);

void TEXT_Display_eng_pw(uint32_t d);

void TEXT_Display_eng_MOVING_SENSOR(U08 d);

void TEXT_Display_eng_testmode(U08 d);

void Peltier_OFF(uint8_t on_off);//0 : on , 1: off

void dwin_buzzer_onoff(U08 d);

void TEXT_Display_RIM_PW(U16 f_p,U16 r_p);
void TEXT_Display_BRF_PW(U08 f_p,U08 r_p);

void audioPlay(uint8_t num);

void TEXT_Display_DEV_mode(U08 d);

void TEXT_Display_TRON_mode(U08 d);

void TEXT_Display_LIMIT_Time(unsigned long d);

void TEXT_Display_TRIG_mode(U08 d);

unsigned short update_crc(unsigned char *data_blk_ptr, unsigned short data_blk_size);

void setPwValue(unsigned char uni, uint16_t value);

void TEXT_Display_COOL_UI_mode(U08 d);

void cooling_ui_on(uint8_t on_off);//0 : off , 1: on

void j16mode_ui(uint8_t on_off);//0 : pump , 1: led

void dwin_buzzer_mode();

void sound_mode_ui(uint8_t on_off);

void audioVolume_Set(uint8_t d);

void audioVolume_10Set(uint8_t d);

void engTestBtnShow(uint8_t b,uint8_t d);

void engShowBtn();
void setModeBtn(uint8_t mode);

void setEngModeDis(uint8_t mode);

void TEXT_Display_NAM_PW(U16 t ,U16 f_p,U16 r_p);

void showKeypad(U08 b);
void showPasskey(U08 *k);

void TEXT_Display_Check_Code(U08 d);

void showPasskey_null();

void reflashD_Date(uint32_t d);

void reflashI_Date(uint32_t d);

void setSelectDate(uint8_t d);
void SUBSCRIPTION_Render57(const char *plan, const char *range, const char *dday, int remainDays);
void PAGE63_RenderSlot(uint8_t slot, const char *ssid, uint8_t locked);
void PAGE63_ClearAll(void);
void dwin_write_text(uint16_t vp_addr, const char* text, uint8_t max_display_len);
void dwin_switch_page(uint8_t page_id);
#endif /* DWIN_H_ */

