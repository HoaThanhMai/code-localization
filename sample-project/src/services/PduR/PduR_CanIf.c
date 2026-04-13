#include "PduR.h"
#include "CanIf.h"
#include "Det.h"

extern void Com_RxIndication(PduIdType RxPduId, const PduInfoType* PduInfoPtr);
extern void Com_TxConfirmation(PduIdType TxPduId);

static uint8 PduR_Initialized = 0u;
static const PduR_ConfigType* PduR_ConfigPtr = NULL_PTR;

void PduR_Init(const PduR_ConfigType* ConfigPtr)
{
    if (ConfigPtr == NULL_PTR) {
        return;
    }
    PduR_ConfigPtr = ConfigPtr;
    PduR_Initialized = 1u;
}

Std_ReturnType PduR_Transmit(PduIdType TxPduId, const PduInfoType* PduInfoPtr)
{
    if (PduR_Initialized == 0u || PduInfoPtr == NULL_PTR) {
        return E_NOT_OK;
    }

    for (uint16 i = 0u; i < PduR_ConfigPtr->numPaths; i++) {
        if (PduR_ConfigPtr->routingPaths[i].srcPduId == TxPduId &&
            PduR_ConfigPtr->routingPaths[i].direction == 0u) {

            PduIdType destPdu = PduR_ConfigPtr->routingPaths[i].destPduId;
            return CanIf_Transmit(destPdu, PduInfoPtr);
        }
    }

    return E_NOT_OK;    
}

void PduR_CanIfRxIndication(PduIdType RxPduId, const PduInfoType* PduInfoPtr)
{
    if (PduR_Initialized == 0u || PduInfoPtr == NULL_PTR) {
        return;
    }

    for (uint16 i = 0u; i < PduR_ConfigPtr->numPaths; i++) {
        if (PduR_ConfigPtr->routingPaths[i].srcPduId == RxPduId &&
            PduR_ConfigPtr->routingPaths[i].direction == 1u) {

            PduIdType destPdu = PduR_ConfigPtr->routingPaths[i].destPduId;
            Com_RxIndication(destPdu, PduInfoPtr);
            return;
        }
    }
}

void PduR_CanIfTxConfirmation(PduIdType TxPduId)
{
    if (PduR_Initialized == 0u) {
        return;
    }

    Com_TxConfirmation(TxPduId);
}
