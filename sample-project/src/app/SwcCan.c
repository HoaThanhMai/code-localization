#include "Rte_SwcCan.h"
#include "NvM.h"
#include "Det.h"

#define SWCCAN_MODULE_ID     200u
#define SWCCAN_INSTANCE_ID   0u

#define SWCCAN_NVM_BLOCK_ID  1u

typedef struct {
    uint16  vehicleSpeed;
    uint16  engineRpm;
    uint16  brakeTorque;
    uint8   ambientTemp;
    uint8   safeState;           
    uint32  operationCounter;    
} SwcCan_DataType;

static SwcCan_DataType SwcCan_Data;

#define SWCCAN_NVM_WRITE_PERIOD  1000u   
static uint32 SwcCan_NvmWriteCounter = 0u;

void SwcCan_Init(void)
{
    SwcCan_Data.vehicleSpeed     = 0u;
    SwcCan_Data.engineRpm        = 0u;
    SwcCan_Data.brakeTorque      = 0u;
    SwcCan_Data.ambientTemp      = 25u;  
    SwcCan_Data.safeState        = 0u;
    SwcCan_Data.operationCounter = 0u;
    SwcCan_NvmWriteCounter       = 0u;

    NvM_ReadBlock(SWCCAN_NVM_BLOCK_ID, (uint8*)&SwcCan_Data);
}

void SwcCan_MainFunction(void)
{
    SwcCan_Data.operationCounter++;

    Rte_Read_VehicleSpeed(&SwcCan_Data.vehicleSpeed);
    Rte_Read_EngineRpm(&SwcCan_Data.engineRpm);
    Rte_Read_BrakeTorque(&SwcCan_Data.brakeTorque);
    Rte_Read_AmbientTemp(&SwcCan_Data.ambientTemp);

    if (SwcCan_Data.safeState == 0u) {

        if (SwcCan_Data.vehicleSpeed > 0u &&
            SwcCan_Data.brakeTorque > 500u) {

        }

        if (SwcCan_Data.engineRpm > 6000u) {

        }
    }

    SwcCan_NvmWriteCounter++;
    if (SwcCan_NvmWriteCounter >= SWCCAN_NVM_WRITE_PERIOD) {
        SwcCan_NvmWriteCounter = 0u;

        NvM_WriteBlock(SWCCAN_NVM_BLOCK_ID, (const uint8*)&SwcCan_Data);
    }
}

void SwcCan_RxTimeoutHandler(Com_SignalIdType SignalId)
{
    switch (SignalId) {
        case RTE_SIG_CAN_VehicleSpeed:

            SwcCan_Data.safeState = 1u;
            SwcCan_Data.vehicleSpeed = 0u;   
            break;

        case RTE_SIG_CAN_EngineRpm:

            SwcCan_Data.safeState = 1u;
            SwcCan_Data.engineRpm = 0u;
            break;

        case RTE_SIG_CAN_BrakeTorque:

            SwcCan_Data.safeState = 1u;
            SwcCan_Data.brakeTorque = 0u;
#if (DET_ENABLED == STD_ON)
            Det_ReportRuntimeError(SWCCAN_MODULE_ID, SWCCAN_INSTANCE_ID,
                                   0xFFu, 0x01u);
#endif
            break;

        case RTE_SIG_CAN_AmbientTemp:

            break;

        default:
            break;
    }
}
