/*
 * common.h
 *
 * Created: 2024-04-03 오후 7:22:59
 *  Author: imq
 */ 


#ifndef COMMON_H_
#define COMMON_H_

#include <avr/io.h>
#include "Define.h"
#include <stdio.h>

#define PARSBUF_MAX_FRAME_LEN 10U
#define PARSBUF_CAPACITY (PARSBUF_MAX_FRAME_LEN + 1U)

extern unsigned char OP_MODE, OP_MODE_CK;
extern unsigned long LIMIT_TIME, LIMIT_TIME_CK;
extern unsigned char TRON_200_MODE, TRON_200_MODE_CK;

extern unsigned char J16_MODE;

extern uint32_t EEP_DUMY[];
extern uint32_t PW_TIME[];
extern uint32_t TT_TIME0;
extern uint32_t TT_TIME1;
extern uint32_t TT_TIME2;
extern unsigned char TT_TIME_CHECKSUM0;
extern unsigned char TT_TIME_CHECKSUM1;
extern unsigned char TT_TIME_CHECKSUM2;
extern unsigned char PW_MAX;
extern unsigned char MW_SENSOR;
extern unsigned char TRIG_MODE;
extern unsigned char COOL_UI;
extern unsigned char SOUND_MODE;
extern unsigned char SOUND_VOLUME;
extern unsigned char INIT_BOOT;
extern unsigned char WIFI_BOOT_PAGE61_ONCE;
extern uint32_t D_DATE;

extern uint8_t PW_VALUE[];

extern uint8_t PW_VALUE_FACE[];

extern uint8_t F_PW_VOLT[];
extern uint8_t R_PW_VOLT[];

extern U08 cool_ui_show;
extern U08 EM_SOUND;

extern U08 pw_data[];
extern U08 pw_data_face[];
extern U08 MaxPower;
extern U08 HICmode;
extern U08 TRON_200;
extern U08 sound_v;

extern U08 RIM_pause;

extern U08 rxbuf[], parsBuf[], ckHeader, txBuf[], eep_s_num;
extern U08 rx0buf[], pars0Buf[], write0Cnt, read0Cnt, pars0Cnt, ck0Header, resCMD, resLen;
extern U08 writeCnt, readCnt, parsCnt, init_boot;

extern U08 selectMem, opPage, txWriteCnt, txReadCnt, enc_cnt, checksum;
extern uint32_t sec_cnt, total_time;
extern uint32_t opower, settime, otime;
extern uint32_t totalEnergy, old_totalEnergy;

extern U08 old_triger, triger_cnt;

extern U08 foot_op, eng_show;

extern uint32_t ckTime, ck_oldtime, ck_hand_time;

extern uint8_t lsm6d_fail, RIM_CK, RIM_ERR_CNT;
extern int16_t off_cnt, on_cnt;
extern int32_t hand_moving, old_hand_moving, diff_moving;

extern U08 RIM_RQ_cnt;

extern U16 RIM_temp, RIM_forwar_p, RIM_set_p, RIM_reverse_p;

extern U08 moving_sensing, eng_show_mode, peltier_op, temp_err;
extern int16_t ntc_t;
extern unsigned long lim_time;

extern uint8_t wf_state, prv_wf_state, fail_temp_ck;

extern uint16_t wf_cnt, wf_frq, wf_err_cnt,wl_err_cnt,temp_err_cnt;
extern uint8_t eng_emi,j16mode;

extern U08 dev_mode, moving_temp_on,body_face,startPage,passmode;
extern U08 engPass[];

extern U08 sFace_pw,sBody_pw;

extern U08 TEMP_SIMUL;

extern U08 BRFmode;

extern U08 time_err;

extern uint32_t ins_date;
extern uint32_t cur_date;

extern volatile U08 dwin_page_now;
void subscription_ui_tick(void);
U08 subscription_hw_isolation_tick(void);
void subscription_mark_page_change(U08 page);
extern volatile U08 sub_active;
extern volatile U08 sub_dirty;
extern int16_t sub_remain_days;
extern char sub_plan_text[];
extern char sub_range_text[];
extern char sub_dday_text[];
// [NEW FEATURE] Notify ESP about page62 run-key energy updates.
void energy_uart_publish_run_event(U08 runActive, uint32_t totalEnergyNow);
// [NEW FEATURE] Guard runtime start/stop key when assigned plan energy is exhausted.
U08 energy_subscription_run_key_guard(void);

#endif /* COMMON_H_ */
