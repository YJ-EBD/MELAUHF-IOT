/*
* brf_mode.c
*
* Created: 2024-04-03 오후 8:05:36
*  Author: imq
*/
#include "brf_mode.h"
#include "common.h"
#include "common_f.h"
#include "ads1115.h"
#include <util/delay.h>
#include <avr/eeprom.h>
#include "dwin.h"
#include "crc.h"
#include "ds1307.h"

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
void main_brf()
{
	U16 resCRC = 0;
	U08 dbgString[100];
	U16 crc;
	U08 factory_cnt=0;
	
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
	
	U08 stateRun=0,stateChannel=1;
	U08 statePower=0;
	U08 moduleError=0;
	char tMessage[16];
	
	U08 trig_ck=0;
	
	U08 select_date=0;
	
	sFace_pw=opower;
	sBody_pw=opower;	

	if((startPage != 21 ) && (startPage != 49 ) && (startPage != 45 ) && (startPage != 61 ))
	{
		for(int i=0;i<10;i++)
		{
			varIconInt(0x1000,i);
			asm("wdr");
			_delay_ms(200);
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
		#if !DUAL_HAND
		if(j16mode==1)
		H_LED_OFF;
		#endif
		COOL_FAN_ON;
		writeCnt=0;
	}
	opPage=1;
	
	while (1)
	{
			asm("wdr");
			//readBTN();
			_delay_ms(10); //(10);
			subscription_ui_tick();
			if (subscription_hw_isolation_tick())
			{
				continue;
			}
			
			#if NEW_BOARD
		
		if(adc_ok)
		{
			adc_ok=0;
			if(adc_read(temp_raw)==0)
			{
				#if DUAL_HAND
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
				if(temp_r>1400)
				{
					temp_cal=990;
				}
				else if(temp_r<800)
				{
					temp_cal=-500;
				}
				else
				{
					temp_cal=(int)((float)(temp_r-1000)*0.2564*10);
					
				}
				TEXT_Display_TEMPERATURE(temp_cal);
				#else
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
				#endif
				
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
					#if !DUAL_HAND
					if(j16mode==0)
					W_PUMP_OFF;
					TEC_OFF;
					#else
					TEC_OFF;
					TEC_F_OFF;
					#endif
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
				if (wf_frq > 10)
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
						#if !DUAL_HAND
						if(j16mode==0)
						W_PUMP_OFF;
						TEC_OFF;
						#else
						TEC_OFF;
						TEC_F_OFF;
						#endif
						errDisp();
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

		if(peltier_op==0)
		{
			if((cool_ui_show==1) || ((cool_ui_show==2)&&((((opPage & 0x04) == 0x04) && (foot_op)) || (((opPage & 0x02) == 0x02) && (!foot_op)))))
			{
				if(TEMP_SIMUL)
				{
					#if !DUAL_HAND
					TEC_ON;
					#else
					if(body_face==0)
					{
						TEC_ON;
						TEC_F_OFF;
					}
					else
					{
						TEC_F_ON;
						TEC_OFF;
					}
					#endif
				}
				else
				{
					if(temp_cal>50)
					{
						#if !DUAL_HAND
						TEC_ON;
						#else
						if(body_face==0)
						{
							TEC_ON;
							TEC_F_OFF;
						}
						else
						{
							TEC_F_ON;
							TEC_OFF;
						}
						#endif
					}
					else if(temp_cal<10)
					{
						#if !DUAL_HAND
						TEC_OFF;
						#else
						TEC_OFF;
						TEC_F_OFF;
						#endif

					}
				}
			}
			else
			{
				#if !DUAL_HAND
				TEC_OFF;
				#else
				TEC_OFF;
				TEC_F_OFF;
				#endif
			}
		}
		else
		{
			#if !DUAL_HAND
			TEC_OFF;
			#else
			TEC_OFF;
			TEC_F_OFF;
			#endif
		}
		
		if ((totalEnergy) != old_totalEnergy)
		{
			old_totalEnergy = (totalEnergy);
			TE_Display(old_totalEnergy);
		}
		

		RIM_RQ_cnt++;
		if (RIM_RQ_cnt == 20)
		{
			if (RIM_CK == 0)
			{
				#if DEBUG
				#else
				if (eng_show == 0)
				RIM_ERR_CNT++;
				#endif
				if (RIM_ERR_CNT > 5)
				{
					if (opPage & 0x02)
					setStandby();
					// TEXT_Display_RIM_ERR();
					#if !DUAL_HAND
					if(j16mode==0)
					W_PUMP_OFF;
					TEC_OFF;
					#else
					TEC_OFF;
					TEC_F_OFF;
					#endif

					errDisp();
					TEXT_Display_ERR_CODE("ERR CODE 01", 11);
					while (1)
					{
						asm("wdr");
					}
				}
			}
			else
			{
				RIM_ERR_CNT = 0;
			}
			readBRF_STATE();
			RIM_RQ_cnt = 0;
		}

		if (foot_op)
		{
#if !DUAL_HAND
			trig_ck=RF_TRIGER;
#else
			if(body_face==0)
				trig_ck=RF_TRIGER;
			else
				trig_ck=RF_F_TRIGER;
#endif
			if (trig_ck != old_triger)
			{
				triger_cnt++;
				if (triger_cnt > TRIG_PUSH_CNT)
				{
					old_triger = trig_ck;
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
		
		//	totalEnergy = opower * otime;
		
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
				#if DUAL_HAND
				if (ads1115_readADC_SingleEnded(body_face, temp_raw, ADS1115_DR_860SPS, ADS1115_PGA_6_144) == 0)
				#else
				if (ads1115_readADC_SingleEnded(0, temp_raw, ADS1115_DR_860SPS, ADS1115_PGA_6_144) == 0)
				#endif
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
		while (write0Cnt != read0Cnt)
		{
			if (ck0Header)
			{
				pars0Buf[pars0Cnt++] = rx0buf[read0Cnt];
				if(pars0Buf[1]==0x06)
				{
					if(pars0Cnt==8)
					{
						ck0Header = 0;
						pars0Cnt = 0;
					}
				}
				else if(pars0Buf[1]==0x03)
				{
					if(pars0Cnt==37)
					{
						resCRC = Funct_CRC16(pars0Buf, 35);
						if (resCRC == (((U16)pars0Buf[36]) << 8) + pars0Buf[35])
						{
							RIM_CK = 1;
							stateRun=pars0Buf[4];
							stateChannel=pars0Buf[12];
							statePower=pars0Buf[14];
							RIM_forwar_p=pars0Buf[18];
							RIM_reverse_p=pars0Buf[20];
							RIM_temp=pars0Buf[22];
							tMessage[0]=(RIM_temp/10)+0x30;
							tMessage[1]=(RIM_temp%10)+0x30;
							tMessage[2]=0x20;;
							
							tMessage[3]=(statePower/10)+0x30;
							tMessage[4]=(statePower%10)+0x30;
							tMessage[5]=0x20;
							
							tMessage[6]=(RIM_forwar_p/10)+0x30;
							tMessage[7]=(RIM_forwar_p%10)+0x30;
							tMessage[8]=0x20;;
							
							tMessage[9]=(RIM_reverse_p/10)+0x30;
							tMessage[10]=(RIM_reverse_p%10)+0x30;
							tMessage[11]=0x20;;
							
							tMessage[12]=(stateRun)+0x30;
							tMessage[13]=0x20;
							tMessage[14]=(stateChannel)+0x30;
							#if DEBUG
							TEXT_Display_Message(tMessage,15);
							#endif
							
							moduleError=pars0Buf[26] | (pars0Buf[28]<<1) | (pars0Buf[30]<<2) | (pars0Buf[32]<<3) | (pars0Buf[34]<<4);
							
							if(moduleError!=0)
							{
								writeBRF_Off();
								writeBRF_Power(0);
								
								errDisp();
								
								if(moduleError&0x01)
								TEXT_Display_ERR_CODE("ERR CODE 07", 11);	//temp
								if(moduleError&0x02)
								TEXT_Display_ERR_CODE("ERR CODE 08", 11);   // pa
								if(moduleError&0x04)
								TEXT_Display_ERR_CODE("ERR CODE 09", 11);  // forware
								if(moduleError&0x08)
								TEXT_Display_ERR_CODE("ERR CODE 10", 11); //reverse
								if(moduleError&0x10)
								TEXT_Display_ERR_CODE("ERR CODE 11", 11); //voltage
								
								while (1)
								{
									asm("wdr");
								}
							}
							
							if (eng_show_mode)
							{
								TEXT_Display_BRF_PW(RIM_forwar_p, RIM_reverse_p);
							}
							if (opPage & 0x02)
							{
								if (RIM_pause == 1)
								{
									if (stateRun == 0x01)
									{
										writeBRF_Off();
									}
									else if ((statePower) != 0)
									{
										writeBRF_Power(0);
									}
									else if(body_face!=(stateChannel-1))
									{
										writeBRF_Channel(body_face+1);
									}
								}
								else
								{
									if(body_face==0)
									{
										if (statePower != pw_data[opower / 5 - 1])
										{
											writeBRF_Power(pw_data[opower / 5 - 1]);
										}
										else if(body_face!=(stateChannel-1))
										{
											writeBRF_Channel(body_face+1);
										}
										else if (stateRun == 0x00)
										{
											writeBRF_On();
										}
									}
									else
									{
										if (statePower != pw_data_face[opower / 5 - 1])
										{
											writeBRF_Power(pw_data_face[opower / 5 - 1]);
										}
										else if(body_face!=(stateChannel-1))
										{
											writeBRF_Channel(body_face+1);
										}
										else if (stateRun == 0x00)
										{
											writeBRF_On();
										}
									}
									
								}
							}
							else if (opPage & 0x01)
							{
								if (stateRun == 0x01)
								{
									writeBRF_Off();
								}
								else if (statePower != 0)
								{
									writeBRF_Power(0);
								}
								else if(body_face!=(stateChannel-1))
								{
									writeBRF_Channel(body_face+1);
								}
							}
						}
						else
						{
							//TEXT_Display_Message("ok", 2);
						}
						ck0Header = 0;
						pars0Cnt = 0;
					}
				}
				/*	if (pars0Cnt == resLen + 3 + 2 + 2 + 1)
				{
				if (pars0Buf[resLen + 3 + 2 + 2] == 0xF5) // end byte
				{

				resCRC = Generate_CRC(pars0Buf, resLen + 3 + 2);

				if (resCRC == (((U16)pars0Buf[resLen + 3 + 2]) << 8) + pars0Buf[resLen + 3 + 2 + 1])
				{
				switch (pars0Buf[2])
				{
				case 0x11:
				hexToString(&pars0Buf[4], dbgString, 45);
				// TEXT_Display(dbgString,90);
				RIM_temp = pars0Buf[7];
				RIM_forwar_p = (((U16)(pars0Buf[13])) << 8) + pars0Buf[14];
				RIM_reverse_p = (((U16)(pars0Buf[15])) << 8) + pars0Buf[16];
				RIM_set_p = (((U16)(pars0Buf[27])) << 8) + pars0Buf[28];
				RIM_CK = 1;
				//	TEXT_Display_U16(RIM_set_p);
				if (eng_show_mode)
				{
				TEXT_Display_RIM_PW(RIM_forwar_p, RIM_reverse_p);
				}

				if (opPage & 0x02)
				{
				if (RIM_pause == 1)
				{
				if ((RIM_set_p) != 0)
				{
				writeRIM_Power(0);
				}
				if (pars0Buf[5] == 0x00)
				{
				writeRIM_OFF();
				}
				}
				else
				{
				if(body_face==0)
				{
				if ((RIM_set_p / 100) != pw_data[opower / 5 - 1])
				{
				writeRIM_Power(pw_data[opower / 5 - 1]);
				}
				if (pars0Buf[5] == 0x01)
				{
				writeRIM_ON();
				}
				}
				else
				{
				if ((RIM_set_p / 100) != pw_data_face[opower / 5 - 1])
				{
				writeRIM_Power(pw_data_face[opower / 5 - 1]);
				}
				if (pars0Buf[5] == 0x01)
				{
				writeRIM_ON();
				}
				}
				
				}
				}
				else if (opPage & 0x01)
				{
				if (pars0Buf[5] == 0x00)
				{
				writeRIM_OFF();
				}
				if ((RIM_set_p) != 0)
				{
				writeRIM_Power(0);
				}
				}
				break;
				}
				}
				}
				ck0Header = 0;
				pars0Cnt = 0;
				}*/
			}
			else
			{
				//				if ((rx0buf[read0Cnt - 1] == 0xA0) & (rx0buf[read0Cnt - 2] == 0x21) && (rx0buf[read0Cnt - 3] == 0x16) && (rx0buf[read0Cnt - 4] == 0x16) && (rx0buf[read0Cnt - 5] == 0x16) && (rx0buf[read0Cnt - 6] == 0x16))
				if (rx0buf[read0Cnt] == 0x26)
				{
					pars0Buf[0] = rx0buf[read0Cnt];
					
					ck0Header = 1;
					
					pars0Cnt = 1;
				}
			}
			read0Cnt++;
		}

		while (writeCnt != readCnt)
		{
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
									#if !DUAL_HAND
									if(j16mode==1)
									H_LED_OFF;
									#endif
									
									COOL_FAN_ON;
									// #if TRON_200_MODE

									// #endif
									// TEXT_Display_TEMPERATURE(50);
									
								}
								else
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
												if (statePower == 0)
												{
													//	while(1);
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
											LED_Display(2);
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
											LED_Display(2);
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
											break;

										default:
										break;
									}
								}
							}
							else if ((parsBuf[2] == 0x30) && (parsBuf[3] == 0x00) && (parsBuf[5] == 0x50) && (parsBuf[6] == 0x01))
							{
								pageChange(62);
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
								//clearBTN();
								
								if(eng_emi)
								{
									eng_emi=0;
									TC1_PWM_OFF;

									OUT_OFF;
									RIM_pause = 1;
									
									TCNT3 = 0;
									
									opPage=0;
									
									writeBRF_Off();
									_delay_ms(10);
									writeBRF_Power(0);
									
									for(int i=0;i<9;i++)
									{
										engTestBtnShow(i,0);
									}
									#if !DUAL_HAND
									if(j16mode==1)
									H_LED_OFF;
									#endif
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
										
										#if !DUAL_HAND
										if(j16mode==1)
										H_LED_ON;
										#endif
										
										if(parsBuf[6]==0x25)
										{
											opower=5;
										}
										else
										{
										//	if((body_face==0) || (parsBuf[6]<0x2a))
											{
												opower=(parsBuf[6]-0x25)*25;
											}
										}
										
									//	if((body_face==0) || (parsBuf[6]<0x2a))
										{
											opPage=2;
											RIM_pause = 0;
											OUT_ON;
											
											engTestBtnShow(parsBuf[6]-0x25,1);
											
											writeBRF_On();
											#if !DUAL_HAND
											if(j16mode==1)
											{
												W_PUMP_ON;
											}
											#endif
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
		// BUGFIX: re-apply safety isolation at loop tail to override same-loop ON writes.
		subscription_hw_isolation_tick();
	}
}
