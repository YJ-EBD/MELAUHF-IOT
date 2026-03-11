/*
 * crc.h
 *
 * Created: 2023-01-17 오후 8:37:04
 *  Author: impar
 */ 


#ifndef CRC_H_
#define CRC_H_

#include <stdio.h>


uint16_t Generate_CRC (uint8_t *buf_ptr, int len);
uint16_t Funct_CRC16(unsigned char * puchMsg, uint16_t DataLen);


#endif /* CRC_H_ */