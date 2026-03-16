/*
* nam_mode.c
*
* Created: 2024-04-03 오후 8:05:45
*  Author: imq
*/
#include "nam_mode.h"
#include "common.h"
#include "common_f.h"
#include <util/delay.h>
#include <avr/eeprom.h>
#include <string.h>
#include "dwin.h"

extern U08 f_volt[26],r_volt[26];

void main_nam()
{
	U08 factory_cnt=0;
	U16 crc;
	U16 adc_t=0,adc_f=0,adc_r=0,pw_f=0,pw_r=0,temperature=0;
	U16 f_volt_cal;
	U16 r_volt_cal;
	
	U08 pw_set_rx[26];
	
	while (1)
	{
		asm("wdr");
		//		readBTN();
		

		if (init_boot == 1)
		{
			/*if(wf_err_cnt==100)
			{
			TEST_Display(wf_frq);
			wf_err_cnt=0;
			}*/
			
			if(ADCSRA&0x10)
			{
				switch(ADMUX&0x0F)
				{
					case 1:
					adc_t=(adc_t*0.5f)+(ADC*0.5f);
					ADMUX=(ADMUX&0xf0)|0x02;
					ADCSRA=ADCSRA | 0x50;
					TX0_char(adc_t>>8);
					TX0_char(adc_t);
					break;
					case 2:
					adc_f=(adc_f*0.5f)+(ADC*0.5f);;
					ADMUX=(ADMUX&0xf0)|0x03;
					ADCSRA=ADCSRA | 0x50;
					break;
					case 3:
					adc_r=(adc_r*0.9f)+(ADC*0.1f);;
					ADMUX=(ADMUX&0xf0)|0x01;
					ADCSRA=ADCSRA | 0x50;
					break;
					default:
					ADMUX=(ADMUX&0xf0)|0x01;
					ADCSRA=ADCSRA | 0x50;
					break;
				}
				if (eng_show_mode)
				{
					f_volt_cal=(U16)((float)adc_f*0.0025*1.1*100);
					
					if(f_volt_cal<f_volt[0]+100)
					pw_f=0;
					else if(f_volt_cal<f_volt[1]+100)	//5W
					{
						pw_f=1+((float)(f_volt_cal-f_volt[0]-100))*(4.0f/(float)(f_volt[1]-f_volt[0]));
					}
					else if(f_volt_cal<f_volt[2]+100)	//10W
					{
						pw_f=5+((float)(f_volt_cal-f_volt[1]-100))*(5.0f/(float)(f_volt[2]-f_volt[1]));
					}
					else if(f_volt_cal<f_volt[3]+100)	//15W
					{
						pw_f=10+((float)(f_volt_cal-f_volt[2]-100))*(5.0f/(float)(f_volt[3]-f_volt[2]));
					}
					else if(f_volt_cal<f_volt[4]+100)	//20W
					{
						pw_f=15+((float)(f_volt_cal-f_volt[3]-100))*(5.0f/(float)(f_volt[4]-f_volt[3]));
					}
					else if(f_volt_cal<f_volt[5]+100)	//25W
					{
						pw_f=20+((float)(f_volt_cal-f_volt[4]-100))*(5.0f/(float)(f_volt[5]-f_volt[4]));
					}
					else if(f_volt_cal<f_volt[6]+100)	//30W
					{
						pw_f=25+((float)(f_volt_cal-f_volt[5]-100))*(5.0f/(float)(f_volt[6]-f_volt[5]));
					}
					else if(f_volt_cal<f_volt[7]+100)	//35W
					{
						pw_f=30+((float)(f_volt_cal-f_volt[6]-100))*(5.0f/(float)(f_volt[7]-f_volt[6]));
					}
					else if(f_volt_cal<f_volt[8]+100)	//40W
					{
						pw_f=35+((float)(f_volt_cal-f_volt[7]-100))*(5.0f/(float)(f_volt[8]-f_volt[7]));
					}
					else if(f_volt_cal<f_volt[9]+100)	//45W
					{
						pw_f=40+((float)(f_volt_cal-f_volt[8]-100))*(5.0f/(float)(f_volt[9]-f_volt[8]));
					}
					else if(f_volt_cal<f_volt[10]+100)	//50W
					{
						pw_f=45+((float)(f_volt_cal-f_volt[9]-100))*(5.0f/(float)(f_volt[10]-f_volt[9]));
					}
					else if(f_volt_cal<f_volt[11]+100)	//60W
					{
						pw_f=50+((float)(f_volt_cal-f_volt[10]-100))*(10.0f/(float)(f_volt[11]-f_volt[10]));
					}
					else if(f_volt_cal<f_volt[12]+100)	//70W
					{
						pw_f=60+((float)(f_volt_cal-f_volt[11]-100))*(10.0f/(float)(f_volt[12]-f_volt[11]));
					}
					else if(f_volt_cal<f_volt[13]+100)	//80W
					{
						pw_f=70+((float)(f_volt_cal-f_volt[12]-100))*(10.0f/(float)(f_volt[13]-f_volt[12]));
					}
					else if(f_volt_cal<f_volt[14]+100)	//90W
					{
						pw_f=80+((float)(f_volt_cal-f_volt[13]-100))*(10.0f/(float)(f_volt[14]-f_volt[13]));
					}
					else if(f_volt_cal<f_volt[15]+100)	//100W
					{
						pw_f=90+((float)(f_volt_cal-f_volt[14]-100))*(10.0f/(float)(f_volt[15]-f_volt[14]));
					}
					else if(f_volt_cal<f_volt[16]+100)	//110W
					{
						pw_f=100+((float)(f_volt_cal-f_volt[15]-100))*(10.0f/(float)(f_volt[16]-f_volt[15]));
					}
					else if(f_volt_cal<f_volt[17]+100)	//120W
					{
						pw_f=110+((float)(f_volt_cal-f_volt[16]-100))*(10.0f/(float)(f_volt[17]-f_volt[16]));
					}
					else if(f_volt_cal<f_volt[18]+100)	//130W
					{
						pw_f=120+((float)(f_volt_cal-f_volt[17]-100))*(10.0f/(float)(f_volt[18]-f_volt[17]));
					}
					else if(f_volt_cal<f_volt[19]+100)	//140W
					{
						pw_f=130+((float)(f_volt_cal-f_volt[18]-100))*(10.0f/(float)(f_volt[19]-f_volt[18]));
					}
					else if(f_volt_cal<f_volt[20]+100)	//150W
					{
						pw_f=140+((float)(f_volt_cal-f_volt[19]-100))*(10.0f/(float)(f_volt[20]-f_volt[19]));
					}
					else if(f_volt_cal<f_volt[21]+100)	//160W
					{
						pw_f=150+((float)(f_volt_cal-f_volt[20]-100))*(10.0f/(float)(f_volt[21]-f_volt[20]));
					}
					else if(f_volt_cal<f_volt[22]+100)	//170W
					{
						pw_f=160+((float)(f_volt_cal-f_volt[21]-100))*(10.0f/(float)(f_volt[22]-f_volt[21]));
					}
					else if(f_volt_cal<f_volt[23]+100)	//180W
					{
						pw_f=170+((float)(f_volt_cal-f_volt[22]-100))*(10.0f/(float)(f_volt[23]-f_volt[22]));
					}
					else if(f_volt_cal<f_volt[24]+100)	//190W
					{
						pw_f=180+((float)(f_volt_cal-f_volt[23]-100))*(10.0f/(float)(f_volt[24]-f_volt[23]));
					}
					else if(f_volt_cal<f_volt[25]+100)	//200W
					{
						pw_f=190+((float)(f_volt_cal-f_volt[24]-100))*(10.0f/(float)(f_volt[25]-f_volt[24]));
					}
					else
					pw_f=200;
					
					r_volt_cal=(U16)((float)adc_r*0.0025*100);
					
					if(r_volt_cal<r_volt[0])
					pw_r=0;
					else if(r_volt_cal<r_volt[1])	//5W
					{
						pw_r=1+((float)(r_volt_cal-r_volt[0]))*(4.0f/(float)(r_volt[1]-r_volt[0]));
					}
					else if(r_volt_cal<r_volt[2])	//10W
					{
						pw_r=5+((float)(r_volt_cal-r_volt[1]))*(5.0f/(float)(r_volt[2]-r_volt[1]));
					}
					else if(r_volt_cal<r_volt[3])	//15W
					{
						pw_r=10+((float)(r_volt_cal-r_volt[2]))*(5.0f/(float)(r_volt[3]-r_volt[2]));
					}
					else if(r_volt_cal<r_volt[4])	//20W
					{
						pw_r=15+((float)(r_volt_cal-r_volt[3]))*(5.0f/(float)(r_volt[4]-r_volt[3]));
					}
					else if(r_volt_cal<r_volt[5])	//25W
					{
						pw_r=20+((float)(r_volt_cal-r_volt[4]))*(5.0f/(float)(r_volt[5]-r_volt[4]));
					}
					else if(r_volt_cal<r_volt[6])	//30W
					{
						pw_r=25+((float)(r_volt_cal-r_volt[5]))*(5.0f/(float)(r_volt[6]-r_volt[5]));
					}
					else if(r_volt_cal<r_volt[7])	//35W
					{
						pw_r=30+((float)(r_volt_cal-r_volt[6]))*(5.0f/(float)(r_volt[7]-r_volt[6]));
					}
					else if(r_volt_cal<r_volt[8])	//40W
					{
						pw_r=35+((float)(r_volt_cal-r_volt[7]))*(5.0f/(float)(r_volt[8]-r_volt[7]));
					}
					else if(r_volt_cal<r_volt[9])	//45W
					{
						pw_r=40+((float)(r_volt_cal-r_volt[8]))*(5.0f/(float)(r_volt[9]-r_volt[8]));
					}
					else if(r_volt_cal<r_volt[10])	//50W
					{
						pw_r=45+((float)(r_volt_cal-r_volt[9]))*(5.0f/(float)(r_volt[10]-r_volt[9]));
					}
					else if(r_volt_cal<r_volt[11])	//60W
					{
						pw_r=50+((float)(r_volt_cal-r_volt[10]))*(10.0f/(float)(r_volt[11]-r_volt[10]));
					}
					else if(r_volt_cal<r_volt[12])	//70W
					{
						pw_r=60+((float)(r_volt_cal-r_volt[11]))*(10.0f/(float)(r_volt[12]-r_volt[11]));
					}
					else if(r_volt_cal<r_volt[13])	//80W
					{
						pw_r=70+((float)(r_volt_cal-r_volt[12]))*(10.0f/(float)(r_volt[13]-r_volt[12]));
					}
					else if(r_volt_cal<r_volt[14])	//90W
					{
						pw_r=80+((float)(r_volt_cal-r_volt[13]))*(10.0f/(float)(r_volt[14]-r_volt[13]));
					}
					else if(r_volt_cal<r_volt[15])	//100W
					{
						pw_r=90+((float)(r_volt_cal-r_volt[14]))*(10.0f/(float)(r_volt[15]-r_volt[14]));
					}
					else if(r_volt_cal<r_volt[16])	//110W
					{
						pw_r=100+((float)(r_volt_cal-r_volt[15]))*(10.0f/(float)(r_volt[16]-r_volt[15]));
					}
					else if(r_volt_cal<r_volt[17])	//120W
					{
						pw_r=110+((float)(r_volt_cal-r_volt[16]))*(10.0f/(float)(r_volt[17]-r_volt[16]));
					}
					else if(r_volt_cal<r_volt[18])	//130W
					{
						pw_r=120+((float)(r_volt_cal-r_volt[17]))*(10.0f/(float)(r_volt[18]-r_volt[17]));
					}
					else if(r_volt_cal<r_volt[19])	//140W
					{
						pw_r=130+((float)(r_volt_cal-r_volt[18]))*(10.0f/(float)(r_volt[19]-r_volt[18]));
					}
					else if(r_volt_cal<r_volt[20])	//150W
					{
						pw_r=140+((float)(r_volt_cal-r_volt[19]))*(10.0f/(float)(r_volt[20]-r_volt[19]));
					}
					else if(r_volt_cal<r_volt[21])	//160W
					{
						pw_r=150+((float)(r_volt_cal-r_volt[20]))*(10.0f/(float)(r_volt[21]-r_volt[20]));
					}
					else if(r_volt_cal<r_volt[22])	//170W
					{
						pw_r=160+((float)(r_volt_cal-r_volt[21]))*(10.0f/(float)(r_volt[22]-r_volt[21]));
					}
					else if(r_volt_cal<r_volt[23])	//180W
					{
						pw_r=170+((float)(r_volt_cal-r_volt[22]))*(10.0f/(float)(r_volt[23]-r_volt[22]));
					}
					else if(r_volt_cal<r_volt[24])	//190W
					{
						pw_r=180+((float)(r_volt_cal-r_volt[23]))*(10.0f/(float)(r_volt[24]-r_volt[23]));
					}
					else if(r_volt_cal<r_volt[25])	//200W
					{
						pw_r=190+((float)(r_volt_cal-r_volt[24]))*(10.0f/(float)(r_volt[25]-r_volt[24]));
					}
					else
					pw_r=200;
					
					if(adc_t<205)
					temperature=0;
					else
					temperature=(((2500*(uint32_t)adc_t)/1024)-500)/10;
					
					
					if(temperature>99)
					temperature=99;
					
					TEXT_Display_NAM_PW(temperature,pw_f, pw_r);
				}
			}
			
			if(temperature>60)//temp 60
			{
				temp_err_cnt++;
				if(temp_err_cnt>100)
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
					TEXT_Display_ERR_CODE("ERR CODE 07", 11);
					while (1)
					{
						asm("wdr");
						_delay_ms(10);
					}
				}
			}
			else
			{
				temp_err_cnt=0;
			}
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
		//if ((temp_err == 0) && (peltier_op == 0)) // && (opPage==2)) // 0:on, 1:off
		if ((((opPage & 0x04) == 0x04) && (foot_op)) || (((opPage & 0x02) == 0x02) && (!foot_op)))
		{
			TEC_ON;
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

			if (temp_err == 0)
			{
				read_temp();
				TEXT_Display_TEMPERATURE(ntc_t);
			}
			else
			{
				// TE_Display(9);
			}
		}
		
		while (write0Cnt != read0Cnt)
		{
			asm("wdr");
			
			if(ck0Header)
			{
				
				pars0Buf[pars0Cnt++]=rx0buf[read0Cnt];
				
				if(pars0Buf[0] == (pars0Cnt-1))
				{
					crc = update_crc(&pars0Buf[1], pars0Buf[0] - 2);

					if (((crc & 0xff) == pars0Buf[pars0Buf[0]]) && ((crc >> 8) == pars0Buf[pars0Buf[0] - 1]))
					{
						switch(pars0Buf[1])
						{
							case 0x57:
							for(int i=0;i<26;i++)
							{
								pw_set_rx[i]=pars0Buf[2+i];
								f_volt[i]=pars0Buf[28+i];
								r_volt[i]=pars0Buf[54+i];
								eeprom_update_byte(&F_PW_VOLT[i], f_volt[i]);
								eeprom_busy_wait();
								eeprom_update_byte(&R_PW_VOLT[i], r_volt[i]);
								eeprom_busy_wait();
							}
							
							//TX0_char((f_volt[0]));
							
							pw_data[0]=pw_set_rx[1];
							pw_data[1]=pw_set_rx[2];
							pw_data[2]=pw_set_rx[3];
							pw_data[3]=pw_set_rx[4];
							pw_data[4]=pw_set_rx[5];
							pw_data[5]=pw_set_rx[6];
							pw_data[6]=pw_set_rx[7];
							pw_data[7]=pw_set_rx[8];
							pw_data[8]=pw_set_rx[9];
							pw_data[9]=pw_set_rx[10];
							
							for(int i=0;i<14;i++)
							{
								pw_data[10+(i*2)]=pw_set_rx[10+i]+(pw_set_rx[11+i]-pw_set_rx[10+i])/2;
								pw_data[10+(i*2)+1]=pw_set_rx[11+i];
							}
							
							//pw_auto_cal();
							
							for(int i=0;i<40;i++)
							{
								eeprom_update_byte(&PW_VALUE[i], pw_data[i]);
								eeprom_busy_wait();
							}
							
							for(int i=0;i<40;i++)
							{
								pw_data_face[i]=pw_data[i];
								eeprom_update_byte(&PW_VALUE_FACE[i], pw_data_face[i]);
								eeprom_busy_wait();
							}
							
							pars0Buf[0]=0x53;
							pars0Buf[1]=0xff;
							pars0Buf[2]=4;
							pars0Buf[3]=0x43;
							pars0Buf[4]=0;						
							
							crc = update_crc(&pars0Buf[3], 2);
							pars0Buf[5]=crc>>8;
							pars0Buf[6]=crc;
							
							
							for(int i=0;i<7;i++)
							TX0_char(pars0Buf[i]);
							
							
							break;
							
							case 0x52:
							pars0Buf[0]=0x53;
							pars0Buf[1]=0xff;
							pars0Buf[2]=81;
							pars0Buf[3]=0x52;
							pars0Buf[4]=0;
							//pars0Buf[5]=pw_data[0];							
							memcpy(&pars0Buf[5],pw_data,10);
							pars0Buf[15]=pw_data[11];
							pars0Buf[16]=pw_data[13];
							pars0Buf[17]=pw_data[15];
							pars0Buf[18]=pw_data[17];
							pars0Buf[19]=pw_data[19];
							pars0Buf[20]=pw_data[21];
							pars0Buf[21]=pw_data[23];
							pars0Buf[22]=pw_data[25];
							pars0Buf[23]=pw_data[27];
							pars0Buf[24]=pw_data[29];
							pars0Buf[25]=pw_data[31];
							pars0Buf[26]=pw_data[33];
							pars0Buf[27]=pw_data[35];
							pars0Buf[28]=pw_data[37];
							pars0Buf[29]=pw_data[39];
														
							
							memcpy(&pars0Buf[30],f_volt,26);
							memcpy(&pars0Buf[56],r_volt,26);
							
							crc = update_crc(&pars0Buf[3], 79);
							pars0Buf[82]=crc>>8;
							pars0Buf[83]=crc;													
							
							
							for(int i=0;i<84;i++)
							TX0_char(pars0Buf[i]);
							
							break;
						}
					}
					ck0Header = 0;
				}
			}
			else
			{
				if ((rx0buf[read0Cnt] == 0xff) && (rx0buf[read0Cnt - 1] == 0x53))
				{
					ck0Header = 1;
					pars0Cnt = 0;
				}
			}
			read0Cnt++;
		}
		// clearBTN();
		while (writeCnt != readCnt)
		{
			//TX0_char(rxbuf[readCnt]);
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

							if ((parsBuf[2] == 0x30) && (parsBuf[3] == 0x00) && (parsBuf[5] == 0x80))
							{
								//clearBTN();
								if (init_boot == 0)
								{
									
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
									// #if TRON_200_MODE
									
								}
								else
								{
									switch (parsBuf[6])
									{
										case 0x01:
										if (opower < MaxPower)
										opower += MinPower;
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
										body_face=1;
										setModeBtn(body_face);
										break;
										case 0x09:
										body_face=0;
										setModeBtn(body_face);
										break;
										case 0x10:
										opower = ((unsigned int)((MaxPower / 5) / 5)) * 5; //(&DE_POWER[0]);
										otime = 20 * 60;
										settime = otime;
										selectMem = 1;
										MEM_Display(selectMem);
										pwDisp(opower);
										timeDisp(otime);
										
										break;
										case 0x11:
										opower = ((unsigned int)((MaxPower / 5) / 5)) * 5 * 2; // eeprom_read_byte(&DE_POWER[1]);
										otime = 18 * 60;
										settime = otime;
										selectMem = 2;
										MEM_Display(selectMem);
										pwDisp(opower);
										timeDisp(otime);
										
										break;
										case 0x12:
										opower = ((unsigned int)((MaxPower / 5) / 5)) * 5 * 3; // eeprom_read_byte(&DE_POWER[2]);
										otime = 15 * 60;
										settime = otime;
										selectMem = 3;
										MEM_Display(selectMem);
										pwDisp(opower);
										timeDisp(otime);
										
										break;
										case 0x13:
										opower = ((unsigned int)((MaxPower / 5) / 5)) * 5 * 4; // eeprom_read_byte(&DE_POWER[3]);
										otime = 12 * 60;
										settime = otime;
										selectMem = 4;
										MEM_Display(selectMem);
										pwDisp(opower);
										timeDisp(otime);
										
										break;
										case 0x14:
										opower = MaxPower; // eeprom_read_byte(&DE_POWER[4]);
										otime = 10 * 60;
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
										if(cool_ui_show)
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

										default:
										break;
									}
								}
							}
							else if ((parsBuf[2] == 0x30) && (parsBuf[3] == 0x00) && (parsBuf[5] == 0x81)) /// eng mode
							{
								//clearBTN();
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
										if (moving_sensing == 0)
										{
											moving_sensing = 1;
										}
										else
										{
											moving_sensing = 0;
										}
										eeprom_update_byte(&MW_SENSOR, moving_sensing);
										eeprom_busy_wait();
										TEXT_Display_eng_MOVING_SENSOR(moving_sensing);
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
										switch (dev_mode & 0x3f)
										{
											case 0:
											dev_mode = (dev_mode & 0xC0) + 1;
											break;
											case 1:
											dev_mode = (dev_mode & 0xC0) + 2;
											break;
											case 2:
											dev_mode = (dev_mode & 0xC0) + 3;
											break;
											case 3:
											dev_mode = (dev_mode & 0xC0) + 4;
											break;
											case 4:
											dev_mode = (dev_mode & 0xC0) + 5;
											break;
											case 5:
											if ((dev_mode & 0xC0)==0x40)
											dev_mode = 0;
											else if((dev_mode & 0xC0)==0x80)
											dev_mode = 0x40;
											else
											dev_mode = 0x80;
											break;
											default:
											dev_mode = 0;
											break;
										}
										eeprom_update_byte(&OP_MODE, dev_mode);
										eeprom_busy_wait();

										eeprom_update_byte(&OP_MODE_CK, 0x100 - dev_mode);
										eeprom_busy_wait();

										TEXT_Display_DEV_mode(dev_mode);
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
										if (TRON_200)
										{
											TRON_200 = 0;
										}
										else
										{
											TRON_200 = 1;
										}
										eeprom_update_byte(&TRON_200_MODE, TRON_200);
										eeprom_busy_wait();

										eeprom_update_byte(&TRON_200_MODE_CK, 0x100 - TRON_200);
										eeprom_busy_wait();

										TEXT_Display_TRON_mode(TRON_200);
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
										if(body_face==0)
										{
											if(pw_data[(parsBuf[6]-0x14)*5-1]<pw_data[(parsBuf[6]-0x13)*5-1])
												pw_data[(parsBuf[6]-0x13)*5-1]-=1;
											setPwValue(parsBuf[6]-0x13,pw_data[(parsBuf[6]-0x13)*5-1]);
										}
										else
										{
											if(pw_data_face[(parsBuf[6]-0x14)*5-1]<pw_data_face[(parsBuf[6]-0x13)*5-1])
												pw_data_face[(parsBuf[6]-0x13)*5-1]-=1;
											setPwValue(parsBuf[6]-0x13,pw_data_face[(parsBuf[6]-0x13)*5-1]);
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
										if(body_face==0)
										{
											if(pw_data[(parsBuf[6]-0x1c)*5-1]<pw_data[(parsBuf[6]-0x1b)*5-1])
											pw_data[(parsBuf[6]-0x1c)*5-1]+=1;
											setPwValue(parsBuf[6]-0x1c,pw_data[(parsBuf[6]-0x1c)*5-1]);
										}
										else
										{
											if(pw_data_face[(parsBuf[6]-0x1c)*5-1]<pw_data_face[(parsBuf[6]-0x1b)*5-1])
											pw_data_face[(parsBuf[6]-0x1c)*5-1]+=1;
											setPwValue((parsBuf[6]-0x1c),pw_data_face[(parsBuf[6]-0x1c)*5-1]);
										}
										break;										
										case 0x24:
										if(body_face==0)
										{
											if(pw_data[39]<200)
											pw_data[39]+=1;
											setPwValue(8,pw_data[39]);
										}
										else
										{
											if(pw_data_face[39]<200)
											pw_data_face[39]+=1;
											setPwValue(8,pw_data_face[39]);
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
											setPower((parsBuf[6]-0x25)*25);
										}
										TC1_PWM_ON;

										OUT_ON;
										RIM_pause = 0;
										
										TCNT3 = 0;
										engTestBtnShow(parsBuf[6]-0x25,1);
										if(j16mode==1)
										{
											W_PUMP_ON;
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
												pw_data[i]=(i+1)*5;
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
										if(cool_ui_show)
										{
											cool_ui_show=0;
										}
										else
										{
											cool_ui_show=1;
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
										setEngMode_Factory(0);
										break;
										case 0x34:
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
	}
}
