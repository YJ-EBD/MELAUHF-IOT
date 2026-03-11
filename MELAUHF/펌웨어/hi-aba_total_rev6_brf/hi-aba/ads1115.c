/*
 * ads1115.c
 *
 * Created: 2023-04-14 오후 2:39:17
 *  Author: impar
 */
#include "ads1115.h"

uint8_t ads1115_readADC_SingleEnded(uint8_t channel, uint8_t *value , ads1115_datarate dr, ads1115_fsr_gain gain)
{
	uint8_t data[3];
	uint8_t rst;
	// Check channel number
	if(channel > 3)
	{
		return 0;
	}
	
	uint16_t adc_config = ADS1115_COMP_QUE_DIS	|
	ADS1115_COMP_LAT_NonLatching |
	ADS1115_COMP_POL_3_ACTIVELOW |
	ADS1115_COMP_MODE_TRADITIONAL |
	dr |
	//DR_128SPS |
	ADS1115_MODE_SINGLE |
	gain;
	//FSR_6_144;
	
	if(channel == 0)
	{
		adc_config |= ADS1115_MUX_AIN0_AIN1;
	}
	else if(channel == 1)
	{
		adc_config |= ADS1115_MUX_AIN2_AIN3;
	}
	else if(channel == 2)
	{
		adc_config |= ADS1115_MUX_AIN2_GND;
	}
	else if(channel == 3)
	{
		adc_config |= ADS1115_MUX_AIN3_GND;
	}
	
	adc_config |= ADS1115_OS_SINGLE;
	
	data[0]=ADS1115_REG_CONFIG;
	data[1]=adc_config>>8;
	data[2]=adc_config&0xff;
		
	rst=twi_writeTo(ADS1115_ADDR_GND,data,3,1,1);
	//_delay_ms(8);
	
//	rst=read_reg_event(ADS1115_ADDR_GND,ADS1115_REG_CONVERSION,value,2);
	return rst;
}
