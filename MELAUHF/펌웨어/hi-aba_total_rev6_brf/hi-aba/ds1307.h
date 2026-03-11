
#ifndef DS1307_H_
#define DS1307_H_

#include <stdio.h>

enum { kDS1307Mode12HR, kDS1307Mode24HR};

//! Initialize the DS1307 device with hour mode
void ds1307_init(uint8_t mode,uint32_t *d);

//! Read the seconds register
uint8_t ds1307_seconds();

//! Read the minutes register
uint8_t ds1307_minutes(void);

//! Read the hours register
uint8_t ds1307_hours(void);

//! Read the date register
uint8_t ds1307_date(void);

uint8_t ds1307_month(void);

uint8_t ds1307_year(void);

//! Set the seconds
void ds1307_set_seconds(uint8_t seconds);

//! Set the minutes
void ds1307_set_minutes(uint8_t minutes);

//! Set the hours
void ds1307_set_hours(uint8_t hours);

void ds1307_set_date(uint8_t date);
void ds1307_set_month(uint8_t month);
void ds1307_set_year(uint8_t year);
//! Set the year
void ds1307_set_year(uint8_t year);

void ds1307_dateset(uint32_t d);

#endif /* DS1307_H_ */