#include <avr/io.h>
#include "Define.h"

void Init_PORT()
{
	//DDRA  = 0b10000000;
	//PORTA = 0b00000000;

	DDRA  = 0b11111011;
	PORTA = 0b00000000;
	
	DDRB  = 0b00110000;
	PORTB = 0b00000000;
	
	DDRC  = 0b00100000;
	PORTC = 0b00010000;
	
	DDRD  = 0b11101000;
	PORTD = 0b00010000;

	DDRE  = 0b00000000;	
	PORTE = 0b00010000;	

	DDRF  = 0b00000000;
	PORTF = 0b00000000;
	
	DDRG  = 0b00000011;
	PORTG = 0b00000000;
}
void Init_UART0()
{
	UCSR0A = 0x02;
	UCSR0B = 0x98;
	UCSR0C = 0x06;
	
	UBRR0H = 0;
	UBRR0L = 16;
}
void Init_UART1()
{
	UCSR1A = 0x02;
	UCSR1B = 0x98;
	UCSR1C = 0x06;
	
	UBRR1H = 0;
	UBRR1L = 16;
}
void Init_Timer0()
{
	TCCR0=0b01000100;
	OCR0=50;//1khz
	TIMSK=0x02;
	
}
void Init_Timer2()
{
	TCCR2=0b01000101;	
}
void Init_Timer1()
{	
	TCCR1A = 0b00000010;
	TCCR1B = 0b00011001;
	TCCR1C=0;
	
	
	OCR1A = 0;	
	OCR1B = 0;	
	OCR1C = 0;
#if NEW_BOARD	
	ICR1=3000;
#else
	ICR1=50000;
#endif
}

void Init_Timer3()
{
	TCCR3A = 0b00000000;
	TCCR3B = 0b00001101;	
	
	OCR3A=15624;//15625
}
void Init_ADC()
{
	ADMUX=0b11000001;
	ADCSRA=0b11010111;
}
void Init_TWI()
{
	TWSR=0x01; //set presca1er bits to zero
	TWBR=150; //SCL frequency is 50K for 16Mhz
	TWCR=0x04; //enab1e TWI mod
}
void Init_SYSTEM()
{
	Init_PORT();
	Init_UART0();
	Init_UART1();
	
	Init_Timer0();
//	Init_Timer2();
	Init_Timer1();
	
	Init_Timer3();
	Init_TWI();
	//WDTCR =0x18;
	//WDTCR =0x0f;	
	
#if NEW_BOARD	
	EIMSK=0x10;
	EICRB=0x01;
	EIFR=0xff;
#endif

	Init_ADC();	
}

