#include "Can.h"
#include "Can_Hw.h"
#include "Det.h"
#include "SchM.h"

extern void CanIf_TxConfirmation(Can_HwHandleType Hth);
extern void CanIf_RxIndication(Can_HwHandleType Hrh, const Can_PduType* PduInfo);

static Can_ControllerStateType Can_ControllerState = CAN_CS_UNINIT;
static const Can_ConfigType*   Can_ConfigPtr = NULL_PTR;

#define CAN_MAX_TX_BUFFERS 16u
static uint8 Can_TxPending[CAN_MAX_TX_BUFFERS];
static uint8 Can_TxPendingCount = 0u;

#define CAN_TX_TIMEOUT_COUNT  100u   
static uint16 Can_TxTimeoutCounter[CAN_MAX_TX_BUFFERS];

void Can_Init(const Can_ConfigType* Config)
{
    if (Config == NULL_PTR) {
#if (DET_ENABLED == STD_ON)
        Det_ReportError(CAN_MODULE_ID, CAN_INSTANCE_ID,
                        CAN_SID_INIT, CAN_E_PARAM_POINTER);
#endif
        return;
    }

    Can_ConfigPtr = Config;
    Can_TxPendingCount = 0u;

    for (uint8 i = 0u; i < CAN_MAX_TX_BUFFERS; i++) {
        Can_TxPending[i] = 0u;
        Can_TxTimeoutCounter[i] = 0u;
    }

    Can_ControllerState = CAN_CS_STOPPED;
}

Std_ReturnType Can_Write(Can_HwHandleType Hth, const Can_PduType* PduInfo)
{

    if (Can_ControllerState == CAN_CS_UNINIT) {
#if (DET_ENABLED == STD_ON)
        Det_ReportError(CAN_MODULE_ID, CAN_INSTANCE_ID,
                        CAN_SID_WRITE, CAN_E_UNINIT);
#endif
        return E_NOT_OK;
    }

    if (PduInfo == NULL_PTR || PduInfo->sdu == NULL_PTR) {
#if (DET_ENABLED == STD_ON)
        Det_ReportError(CAN_MODULE_ID, CAN_INSTANCE_ID,
                        CAN_SID_WRITE, CAN_E_PARAM_POINTER);
#endif
        return E_NOT_OK;
    }

    SchM_Enter_Can_CAN_EXCLUSIVE_AREA_0();

    Can_Hw_Write(Hth, PduInfo);     

    if (Hth < CAN_MAX_TX_BUFFERS) {
        Can_TxPending[Hth] = 1u;
        Can_TxTimeoutCounter[Hth] = 0u;
        Can_TxPendingCount++;
    }

    SchM_Exit_Can_CAN_EXCLUSIVE_AREA_0();

    return E_OK;    
}

void Can_MainFunction_Write(void)
{
    if (Can_ControllerState != CAN_CS_STARTED) {
        return;
    }

    for (uint8 i = 0u; i < CAN_MAX_TX_BUFFERS; i++) {
        if (Can_TxPending[i] != 0u) {
            Std_ReturnType hwStatus = Can_Hw_CheckTxStatus((Can_HwHandleType)i);

            if (hwStatus == E_OK) {

                Can_TxPending[i] = 0u;
                Can_TxTimeoutCounter[i] = 0u;
                Can_TxPendingCount--;

                CanIf_TxConfirmation((Can_HwHandleType)i);
            } else {

                Can_TxTimeoutCounter[i]++;

                if (Can_TxTimeoutCounter[i] >= CAN_TX_TIMEOUT_COUNT) {

                    Can_TxPending[i] = 0u;
                    Can_TxTimeoutCounter[i] = 0u;
                    Can_TxPendingCount--;

#if (DET_ENABLED == STD_ON)
                    Det_ReportRuntimeError(CAN_MODULE_ID, CAN_INSTANCE_ID,
                                           CAN_SID_MAINFUNCTION_WRITE, CAN_E_TRANSITION);
#endif
                }
            }
        }
    }
}

void Can_MainFunction_Read(void)
{
    Can_PduType rxPdu;
    uint8 rxData[8u];
    rxPdu.sdu = rxData;

    if (Can_ControllerState != CAN_CS_STARTED) {
        return;
    }

    for (Can_HwHandleType hrh = 0u; hrh < Can_ConfigPtr->rxBufferCount; hrh++) {
        Can_Hw_ReadMailbox(hrh, &rxPdu);

        if (rxPdu.length > 0u) {

            CanIf_RxIndication(hrh, &rxPdu);
        }
    }
}
