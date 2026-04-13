#ifndef RTE_SWCCAN_H
#define RTE_SWCCAN_H

#include "Std_Types.h"
#include "Com.h"

#define RTE_SIG_CAN_VehicleSpeed       0u
#define RTE_SIG_CAN_EngineRpm          1u
#define RTE_SIG_CAN_BrakeTorque        2u
#define RTE_SIG_CAN_AmbientTemp        3u
#define RTE_SIG_CAN_TxDiagResponse     4u

Std_ReturnType Rte_Read_VehicleSpeed(uint16* value);
Std_ReturnType Rte_Read_EngineRpm(uint16* value);
Std_ReturnType Rte_Read_BrakeTorque(uint16* value);
Std_ReturnType Rte_Read_AmbientTemp(uint8* value);
Std_ReturnType Rte_Write_DiagResponse(const uint8* data, uint8 length);

void Rte_COMCbk_RxTimeout(Com_SignalIdType SignalId);
void Rte_COMCbk_RxIndication(Com_SignalIdType SignalId);

void SwcCan_Init(void);
void SwcCan_MainFunction(void);
void SwcCan_RxTimeoutHandler(Com_SignalIdType SignalId);

#endif 
