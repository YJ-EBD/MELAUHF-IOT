/*
 * i2c.h
 *
 * Created: 2024-06-26 오전 3:27:33
 *  Author: imq
 */ 


#ifndef I2C_H_
#define I2C_H_

#include <inttypes.h>

//#define ATMEGA8

#ifndef TWI_FREQ
#define TWI_FREQ 100000L
#endif

#ifndef TWI_BUFFER_LENGTH
#define TWI_BUFFER_LENGTH 32
#endif

#define TWI_READY 0
#define TWI_MRX   1
#define TWI_MTX   2
#define TWI_SRX   3
#define TWI_STX   4

void twi_init(void);
void twi_disable(void);
void twi_setAddress(uint8_t);
void twi_setFrequency(uint32_t);
uint8_t twi_readFrom(uint8_t, uint8_t*, uint8_t, uint8_t);
uint8_t twi_writeTo(uint8_t, uint8_t*, uint8_t, uint8_t, uint8_t);
uint8_t twi_transmit(const uint8_t*, uint8_t);
void twi_attachSlaveRxEvent( void (*)(uint8_t*, int) );
void twi_attachSlaveTxEvent( void (*)(void) );
void twi_reply(uint8_t);
void twi_stop(void);
void twi_releaseBus(void);
uint8_t twi_timeout(uint8_t);

uint8_t adc_init();
uint8_t adc_read(uint8_t *);
uint8_t gpio_out(uint8_t d);
uint8_t gpio_config(uint8_t d);
uint8_t gpio_init();


#endif /* I2C_H_ */