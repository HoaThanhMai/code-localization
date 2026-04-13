#include "Can_Hw.h"
#include "Can.h"

typedef struct {
    uint8  busy;         
    uint32 canId;
    uint8  data[8];
    uint8  dlc;
} Can_Hw_TxMailbox;

typedef struct {
    uint8  hasData;      
    uint32 canId;
    uint8  data[8];
    uint8  dlc;
} Can_Hw_RxMailbox;

#define CAN_HW_MAX_TX_MB   16u
#define CAN_HW_MAX_RX_MB    8u

static Can_Hw_TxMailbox Can_Hw_TxMB[CAN_HW_MAX_TX_MB];
static Can_Hw_RxMailbox Can_Hw_RxMB[CAN_HW_MAX_RX_MB];
static uint8 Can_Hw_ErrorState = CAN_HW_ERROR_NONE;

Std_ReturnType Can_Hw_Write(Can_HwHandleType Hth, const Can_PduType* PduInfo)
{
    if (Hth >= CAN_HW_MAX_TX_MB) {
        return E_NOT_OK;
    }

    if (Can_Hw_ErrorState == CAN_HW_ERROR_BUS_OFF) {
        return E_NOT_OK;    
    }

    if (Can_Hw_TxMB[Hth].busy != 0u) {
        return E_NOT_OK;    
    }

    Can_Hw_TxMB[Hth].canId = PduInfo->id;
    Can_Hw_TxMB[Hth].dlc = PduInfo->length;

    for (uint8 i = 0u; i < PduInfo->length && i < 8u; i++) {
        Can_Hw_TxMB[Hth].data[i] = PduInfo->sdu[i];
    }

    Can_Hw_TxMB[Hth].busy = 1u;

    return E_OK;
}

Std_ReturnType Can_Hw_CheckTxStatus(Can_HwHandleType Hth)
{
    if (Hth >= CAN_HW_MAX_TX_MB) {
        return E_NOT_OK;
    }

    if (Can_Hw_TxMB[Hth].busy == 0u) {
        return E_OK;    
    }

    return E_NOT_OK;    
}

void Can_Hw_ReadMailbox(Can_HwHandleType Hrh, Can_PduType* PduInfo)
{
    if (Hrh >= CAN_HW_MAX_RX_MB || PduInfo == NULL_PTR) {
        PduInfo->length = 0u;
        return;
    }

    if (Can_Hw_RxMB[Hrh].hasData != 0u) {
        PduInfo->id = Can_Hw_RxMB[Hrh].canId;
        PduInfo->length = Can_Hw_RxMB[Hrh].dlc;

        for (uint8 i = 0u; i < Can_Hw_RxMB[Hrh].dlc && i < 8u; i++) {
            PduInfo->sdu[i] = Can_Hw_RxMB[Hrh].data[i];
        }

        Can_Hw_RxMB[Hrh].hasData = 0u;
    } else {
        PduInfo->length = 0u;
    }
}
