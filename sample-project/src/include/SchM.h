#ifndef SCHM_H
#define SCHM_H

#include "Std_Types.h"

void SchM_Enter_Can_CAN_EXCLUSIVE_AREA_0(void);
void SchM_Exit_Can_CAN_EXCLUSIVE_AREA_0(void);

void SchM_Enter_NvM_NVM_EXCLUSIVE_AREA_0(void);
void SchM_Exit_NvM_NVM_EXCLUSIVE_AREA_0(void);

void SchM_Enter_Com_COM_EXCLUSIVE_AREA_0(void);
void SchM_Exit_Com_COM_EXCLUSIVE_AREA_0(void);

#endif 
