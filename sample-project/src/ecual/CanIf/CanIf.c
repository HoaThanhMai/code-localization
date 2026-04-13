#include "CanIf.h"
#include "Det.h"
#include "Can.h"

static uint8 CanIf_Initialized = 0u;
static const CanIf_ConfigType* CanIf_ConfigPtr = NULL_PTR;

void CanIf_Init(const CanIf_ConfigType* ConfigPtr)
{
    if (ConfigPtr == NULL_PTR) {
#if (DET_ENABLED == STD_ON)
        Det_ReportError(CANIF_MODULE_ID, CANIF_INSTANCE_ID,
                        CANIF_SID_INIT, CANIF_E_PARAM_POINTER);
#endif
        return;
    }

    CanIf_ConfigPtr = ConfigPtr;
    CanIf_Initialized = 1u;
}

Std_ReturnType CanIf_Transmit(PduIdType TxPduId, const PduInfoType* PduInfoPtr)
{
    Can_PduType canPdu;

    if (CanIf_Initialized == 0u) {
#if (DET_ENABLED == STD_ON)
        Det_ReportError(CANIF_MODULE_ID, CANIF_INSTANCE_ID,
                        CANIF_SID_TRANSMIT, CANIF_E_UNINIT);
#endif
        return E_NOT_OK;
    }

    if (PduInfoPtr == NULL_PTR) {
#if (DET_ENABLED == STD_ON)
        Det_ReportError(CANIF_MODULE_ID, CANIF_INSTANCE_ID,
                        CANIF_SID_TRANSMIT, CANIF_E_PARAM_POINTER);
#endif
        return E_NOT_OK;
    }

    if (TxPduId >= CanIf_ConfigPtr->numTxPdus) {
#if (DET_ENABLED == STD_ON)
        Det_ReportError(CANIF_MODULE_ID, CANIF_INSTANCE_ID,
                        CANIF_SID_TRANSMIT, CANIF_E_INVALID_TXPDUID);
#endif
        return E_NOT_OK;
    }

    canPdu.id     = (uint32)TxPduId;     
    canPdu.length = (uint8)PduInfoPtr->SduLength;
    canPdu.sdu    = PduInfoPtr->SduDataPtr;

    Can_HwHandleType hth = (Can_HwHandleType)(TxPduId % 8u);
    return Can_Write(hth, &canPdu);
}

void CanIf_TxConfirmation(uint16 Hth)
{
    if (CanIf_Initialized == 0u) {
        return;
    }

    PduIdType txPduId = (PduIdType)Hth;  

    if (CanIf_ConfigPtr->txConfirmationCbk != NULL_PTR) {
        CanIf_ConfigPtr->txConfirmationCbk(txPduId);
    }
}

void CanIf_RxIndication(uint16 Hrh, const void* PduInfo)
{

    const Can_PduType* canPdu = (const Can_PduType*)PduInfo;

    if (CanIf_Initialized == 0u) {
        return;
    }

    PduIdType rxPduId = (PduIdType)Hrh;  
    PduInfoType pduInfo;

    pduInfo.SduDataPtr = canPdu->sdu;
    pduInfo.SduLength  = (uint16)canPdu->length;

    if (CanIf_ConfigPtr->rxIndicationCbk != NULL_PTR) {
        CanIf_ConfigPtr->rxIndicationCbk(rxPduId, &pduInfo);
    }
}
