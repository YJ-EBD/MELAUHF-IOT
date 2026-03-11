#ifndef DEFINE_H_
#define DEFINE_H_

#define U08 unsigned char
#define U16 uint16_t
#define U32 uint32_t
extern volatile U08 g_hw_output_lock;
#define HW_OUTPUT_ALLOWED() (g_hw_output_lock == 0)

#define ON                  1
#define OFF                 0

#define TRUE				1
#define FALSE				0
#define VERSION 			10

#define readPage 			0

#define MinPower			5

#define WHITE_BRI			255
#define RED_BRI			255
#define GREEN_BRI			255
#define YELLOW_BRI			255
#define ORANGE_BRI			255

#ifndef DEBUG
#define DEBUG	0
#endif

#define DUAL_HAND		1

#define FACE_MAX_POWER		80
/************************************************************/

#define TARGET_TEMP		-20  //T5 => 22.27kohm => 3.3V * 22.27/32.27 = 2.277378 / 0.000125V = 18219
#define TEMP_HYSTERESIS	20 // hysteresis 2deg , 1deg=700

#define OUT_ON			do { if (HW_OUTPUT_ALLOWED()) PORTB = PORTB | _BV(4); } while (0)
#define OUT_OFF			PORTB = PORTB & ~_BV(4)

#define BRF_ENABLE		do { if (HW_OUTPUT_ALLOWED()) PORTB = PORTB | _BV(4); } while (0)
#define BRF_DISABLE		PORTB = PORTB & ~_BV(4)

#define TC1_PWM_OFF		TCCR1A = TCCR1A & ~_BV(7)
#define TC1_PWM_ON		do { if (HW_OUTPUT_ALLOWED()) TCCR1A = TCCR1A | _BV(7); } while (0)

#define TEC_ON			do { if (HW_OUTPUT_ALLOWED()) PORTA = PORTA | _BV(6); } while (0)// | _BV(7)
#define TEC_OFF			PORTA = (PORTA & ~_BV(6))//& ~_BV(7)

#define COOL_FAN_ON		do { if (HW_OUTPUT_ALLOWED()) PORTD = PORTD | _BV(7); } while (0)// | _BV(7)
#define COOL_FAN_OFF			PORTD = (PORTD & ~_BV(7))//& ~_BV(7)

#define AC_ON		PORTD = PORTD | _BV(6)// | _BV(7)
#define AC_OFF			PORTD = (PORTD & ~_BV(6))//& ~_BV(7)

#define W_PUMP_ON		do { if (HW_OUTPUT_ALLOWED()) PORTA = PORTA | _BV(7); } while (0)
#define W_PUMP_OFF		PORTA = PORTA & ~_BV(7);


#define LED_S_H			PORTF = PORTF | _BV(0)
#define LED_S_L			PORTF = PORTF & ~_BV(0)

#define TIME_START		do { if (HW_OUTPUT_ALLOWED()) ETIMSK = ETIMSK | _BV(4); } while (0)
#define TIME_STOP		ETIMSK = ETIMSK & ~_BV(4)

#define H_LED_ON			do { if (HW_OUTPUT_ALLOWED()) PORTA = PORTA | _BV(7); } while (0)
#define H_LED_OFF			PORTA = PORTA & ~_BV(7)

#define TEC_F_ON			do { if (HW_OUTPUT_ALLOWED()) PORTA = PORTA | _BV(7); } while (0)
#define TEC_F_OFF			PORTA = (PORTA & ~_BV(7))

#define LCD_ON		PORTC = PORTC | _BV(5);
#define LCD_OFF		PORTC = PORTC & ~_BV(5);

#define FAN_ON		do { if (HW_OUTPUT_ALLOWED()) PORTD = PORTD | _BV(7); } while (0)
#define FAN_OFF		PORTD = PORTD & ~_BV(7);

#define WATER_M_FRQ		5000

#define WATER_LEVEL		(PINC&0x08)>>3
#define WATER_FLOW		(PINC&0x04)>>2
#define EMER_SW		(PINC&0x08)>>3

#define RF_TRIGER		((PINC&0x10) & (PIND&0x10))

#define RF_F_TRIGER		(((PINC&0x10)>>4) & (PINC&0x01))


#define PW_SWITCH		(PINE&0x10)

#define TEC_STATE		(PORTA & _BV(6))>>6

#define ADS1115_CH		0

#define LED_R_ON	PORTA = PORTA | _BV(3);
#define LED_G_ON	PORTA = PORTA | _BV(4);
#define LED_B_ON	PORTA = PORTA | _BV(5);
#define LED_A_OFF	PORTA = PORTA & 0xC7;

#define LED_F_R_ON	PORTD = PORTD | _BV(5);
#define LED_F_G_ON	PORTG = PORTG | _BV(0);
#define LED_F_B_ON	PORTG = PORTG | _BV(1);
#define LED_F_A_OFF	PORTD = PORTD & ~_BV(5); PORTG = PORTG & 0xfc;


#define TRIG_PUSH_CNT	20

#define EMSOUND_WAE		10
#define NEW_BOARD		1

#define ADC_ERR_MAX		5

#if DEBUG
#define FLOW_ON 0
#else
#define FLOW_ON 1
#endif



#endif /* DEFINE_H_ */
