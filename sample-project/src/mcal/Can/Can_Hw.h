#ifndef CAN_HW_H
#define CAN_HW_H

#include "Std_Types.h"
#include "Can.h"

Std_ReturnType Can_Hw_Write(Can_HwHandleType Hth, const Can_PduType* PduInfo);
Std_ReturnType Can_Hw_CheckTxStatus(Can_HwHandleType Hth);
void           Can_Hw_ReadMailbox(Can_HwHandleType Hrh, Can_PduType* PduInfo);
uint8          Can_Hw_GetErrorState(void);

#define CAN_HW_ERROR_NONE     0x00u
#define CAN_HW_ERROR_BUS_OFF  0x01u
#define CAN_HW_ERROR_PASSIVE  0x02u

#endif 
