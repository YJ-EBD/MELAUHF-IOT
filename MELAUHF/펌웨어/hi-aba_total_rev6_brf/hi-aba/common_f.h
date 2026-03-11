/*
 * common_f.h
 *
 * Created: 2024-04-03 오후 7:40:41
 *  Author: imq
 */ 


#ifndef COMMON_F_H_
#define COMMON_F_H_

#include "common.h"

void TX0_char(unsigned char data);
void writeRIM(U08 cmd, U16 len, U08 *data);
void writeRIM_STATE();
void writeRIM_Power(U16 p);
void writeRIM_ON();
void writeRIM_OFF();

void LED_WHITE(U08 bri);
void LED_RED(U08 bri);
void LED_GREEN(U08 bri);
void LED_YELLOW(U08 bri);
void LED_ORANGE(U08 bri);
void LED_OFF();
void setReady();

void setStandby();

void errDisp();
void setEngMode();
void setEngMode_Factory();
void exitEngMode();
void Buzzer_ONOFF();
void hexToString(U08 *in, U08 *out, U08 len);
void read_temp();
void pw_auto_cal();
void setPower(uint32_t p);
void Audio_Set(uint8_t s);

void writeBRF_Off();
void writeBRF_On();
void writeBRF_Power(U08 p);
void writeBRF_Channel(U08 d);
void readBRF_STATE(void);

void setDateMode();

#endif /* COMMON_F_H_ */
