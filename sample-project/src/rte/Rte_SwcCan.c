#include "Rte_SwcCan.h"
#include "Com.h"

static uint8 Rte_RxTimeout_VehicleSpeed = 0u;
static uint8 Rte_RxTimeout_EngineRpm = 0u;
static uint8 Rte_RxTimeout_BrakeTorque = 0u;
static uint8 Rte_RxTimeout_AmbientTemp = 0u;

Std_ReturnType Rte_Read_VehicleSpeed(uint16* value)
{
    if (value == NULL_PTR) {
        return E_NOT_OK;
    }
    return Com_ReceiveSignal(RTE_SIG_CAN_VehicleSpeed, value);
}

Std_ReturnType Rte_Read_EngineRpm(uint16* value)
{
    if (value == NULL_PTR) {
        return E_NOT_OK;
    }
    return Com_ReceiveSignal(RTE_SIG_CAN_EngineRpm, value);
}

Std_ReturnType Rte_Read_BrakeTorque(uint16* value)
{
    if (value == NULL_PTR) {
        return E_NOT_OK;
    }
    return Com_ReceiveSignal(RTE_SIG_CAN_BrakeTorque, value);
}

Std_ReturnType Rte_Read_AmbientTemp(uint8* value)
{
    if (value == NULL_PTR) {
        return E_NOT_OK;
    }
    return Com_ReceiveSignal(RTE_SIG_CAN_AmbientTemp, value);
}

Std_ReturnType Rte_Write_DiagResponse(const uint8* data, uint8 length)
{
    if (data == NULL_PTR || length == 0u) {
        return E_NOT_OK;
    }

    return Com_SendSignal(RTE_SIG_CAN_TxDiagResponse, data);
}

void Rte_COMCbk_RxTimeout(Com_SignalIdType SignalId)
{
    switch (SignalId) {
        case RTE_SIG_CAN_VehicleSpeed:
            Rte_RxTimeout_VehicleSpeed = 1u;
            break;
        case RTE_SIG_CAN_EngineRpm:
            Rte_RxTimeout_EngineRpm = 1u;
            break;
        case RTE_SIG_CAN_BrakeTorque:
            Rte_RxTimeout_BrakeTorque = 1u;
            break;
        case RTE_SIG_CAN_AmbientTemp:
            Rte_RxTimeout_AmbientTemp = 1u;
            break;
        default:
            break;
    }

    SwcCan_RxTimeoutHandler(SignalId);
}

void Rte_COMCbk_RxIndication(Com_SignalIdType SignalId)
{

    switch (SignalId) {
        case RTE_SIG_CAN_VehicleSpeed:
            Rte_RxTimeout_VehicleSpeed = 0u;
            break;
        case RTE_SIG_CAN_EngineRpm:
            Rte_RxTimeout_EngineRpm = 0u;
            break;
        case RTE_SIG_CAN_BrakeTorque:
            Rte_RxTimeout_BrakeTorque = 0u;
            break;
        case RTE_SIG_CAN_AmbientTemp:
            Rte_RxTimeout_AmbientTemp = 0u;
            break;
        default:
            break;
    }
}
