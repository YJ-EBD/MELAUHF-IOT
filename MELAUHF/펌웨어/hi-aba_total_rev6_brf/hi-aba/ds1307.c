#include "ds1307.h"
#include "i2c.h"

/*  base hardware address of the device */
#define DS1307_BASE_ADDRESS 0x68


/*  register addresses  */
#define DS1307_SECONDS_ADDR		0x00
#define DS1307_MINUTES_ADDR		0x01
#define DS1307_HOURS_ADDR		0x02
#define DS1307_DAY_ADDR			0x03
#define DS1307_DATE_ADDR		0x04
#define DS1307_MONTH_ADDR		0x05
#define DS1307_YEAR_ADDR		0x06
#define DS1307_CONTROL_ADDR		0x07

/*  control bits    */
#define CH (1<<7)
#define HR (1<<6)

/*  private function prototypes     */
uint8_t ds1307_read_register(uint8_t reg);
void  ds1307_write_register(uint8_t reg,uint8_t data);

static unsigned int uint2bcd(unsigned int ival)
{
	return ((ival / 10) << 4) | (ival % 10);
}


uint8_t ds1307_seconds()
{
	uint8_t seconds_h,seconds_l;
	uint8_t seconds = ds1307_read_register(DS1307_SECONDS_ADDR);
	/*	mask the CH bit */
	seconds &= ~CH;
	/*	get the rest of the high nibble */
	seconds_h = seconds >> 4;
	seconds_l = seconds & 0b00001111;
	return seconds_h * 10 + seconds_l;
}

uint8_t ds1307_minutes(void)
{
	uint8_t minutes_h,minutes_l;
	uint8_t minutes = ds1307_read_register(DS1307_MINUTES_ADDR);
	minutes_h = minutes >> 4;
	minutes_l = minutes & 0b00001111;
	return minutes_h * 10 + minutes_l;
}

uint8_t ds1307_hours(void)
{
	uint8_t hours_h, hours_l;
	uint8_t hours = ds1307_read_register(DS1307_HOURS_ADDR);
	if( hours & HR )
	{
		/*	24 hour mode, so mask the two upper bits */
		hours &= ~(0b11000000);	
	}
	else
	{
		/* 12 hour mode so mask the upper three bits */
		hours &= ~(0b11100000);
	}
	hours_h = hours >> 4;
	hours_l = hours & 0b00001111;
	return hours_h * 10 + hours_l;
}

uint8_t ds1307_date(void)
{
	uint8_t date_h,date_l;
	uint8_t date = ds1307_read_register(DS1307_DATE_ADDR);
	/*	mask the uppermost two bits */
	date &= ~(0b11000000);
	date_h = date >> 4;
	date_l = date & 0b00001111;
	return date_h * 10 + date_l;
}
uint8_t ds1307_month(void)
{
	uint8_t date_h,date_l;
	uint8_t date = ds1307_read_register(DS1307_MONTH_ADDR);
	/*	mask the uppermost two bits */
	date &= ~(0b11100000);
	date_h = date >> 4;
	date_l = date & 0b00001111;
	return date_h * 10 + date_l;
}
uint8_t ds1307_year(void)
{
	uint8_t date_h,date_l;
	uint8_t date = ds1307_read_register(DS1307_YEAR_ADDR);
	/*	mask the uppermost two bits */	
	date_h = date >> 4;
	date_l = date & 0b00001111;
	return date_h * 10 + date_l;
}
void ds1307_set_seconds(uint8_t seconds)
{
	uint8_t bcd_seconds = uint2bcd(seconds);
	/* make sure CH bit is clear */
	bcd_seconds &= ~CH;
	ds1307_write_register(DS1307_SECONDS_ADDR,bcd_seconds);
}

void ds1307_set_minutes(uint8_t minutes)
{
	uint8_t bcd_minutes = uint2bcd(minutes);
	/*	make sure upper bit is clear */
	bcd_minutes &= ~(1<<7);
	ds1307_write_register(DS1307_MINUTES_ADDR,bcd_minutes);
}

void ds1307_set_hours(uint8_t hours)
{
	uint8_t bcd_hours = uint2bcd(hours);
	/*	make sure upper bit is clear */
	bcd_hours &= ~(1<<7);
	if( hours & HR )
	{
		/*	24 hour mode so set the HR bit in bcd_hours */
		bcd_hours |= HR;
	}
	else
	{
		/* 12 hour mode so clear the HR bit in bcd_hours */
		bcd_hours &= ~HR;
	}
	ds1307_write_register(DS1307_HOURS_ADDR,bcd_hours);
}

void ds1307_set_date(uint8_t date)
{
	uint8_t bcd_date = uint2bcd(date);
	ds1307_write_register(DS1307_DATE_ADDR,bcd_date);
}
void ds1307_set_month(uint8_t month)
{
	uint8_t bcd_month = uint2bcd(month);
	ds1307_write_register(DS1307_MONTH_ADDR,bcd_month);
}

void ds1307_set_year(uint8_t year)
{
	 uint8_t bcd_year = uint2bcd(year);
	 ds1307_write_register(DS1307_YEAR_ADDR,bcd_year);
}

void  ds1307_write_register(uint8_t reg,uint8_t data)
{
	uint8_t device_data[2];
	
	device_data[0] = reg;
	device_data[1] = data;
	
	twi_writeTo(DS1307_BASE_ADDRESS,device_data,2,1,1);
}

uint8_t ds1307_read_register(uint8_t reg)
{
	uint8_t regadd=reg;
	
	if(twi_writeTo(DS1307_BASE_ADDRESS,&regadd,1,1,1)==0)
	{
		if(twi_readFrom(DS1307_BASE_ADDRESS, &regadd, 1, 1)==1)
		{
			return regadd;
		}
	}
	
	return 0;
}
void ds1307_init(uint8_t mode,uint32_t *d)
{
	uint32_t year,month,date,hour,seconds;
	/*	To start the oscillator, we need to write CH = 0 (bit 7/reg 0) */
	seconds = ds1307_read_register(DS1307_SECONDS_ADDR);
	if ((seconds & 0x80) == 0x80)
	{
		seconds &= 0x7F;
		ds1307_write_register(DS1307_SECONDS_ADDR,seconds);
	}
	
	/*	set the mode */
	hour = ds1307_read_register(DS1307_HOURS_ADDR);
	if((hour & 0x40)==0x40)
	{
		hour &= ~HR;
		ds1307_write_register(DS1307_HOURS_ADDR, hour);
	}
	
	hour=ds1307_hours();
	date=ds1307_date();
	month=ds1307_month();
	year=ds1307_year();
	
	*d=(year<<16)+(month<<8)+(date);
}
void ds1307_dateset(uint32_t d)
{
	uint8_t year,month,date;
	year=(d>>16)&0xff;
	month=(d>>8)&0xff;	
	date=(d)&0xff;

	
	ds1307_set_year(year);
	ds1307_set_month(month);
	ds1307_set_date(date);

}
