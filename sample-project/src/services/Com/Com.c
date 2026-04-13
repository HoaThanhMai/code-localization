#include "Com.h"
#include "PduR.h"
#include "Det.h"
#include "SchM.h"

static uint8 Com_Initialized = 0u;
static const Com_ConfigType* Com_ConfigPtr = NULL_PTR;

static uint8  Com_SignalBuffer[COM_MAX_SIGNALS][COM_MAX_SIGNAL_SIZE];
static uint8  Com_SignalUpdated[COM_MAX_SIGNALS];   

#define COM_MAX_TX_PDUS   16u
static uint8 Com_TxPending[COM_MAX_TX_PDUS];
static uint8 Com_TxConfirmed[COM_MAX_TX_PDUS];

static uint16 Com_RxTimeoutCounter[COM_MAX_SIGNALS];
static uint8  Com_RxTimedOut[COM_MAX_SIGNALS];

#define COM_RX_TIMEOUT_DEFAULT  500u    

extern void Rte_COMCbk_RxTimeout(Com_SignalIdType SignalId);
extern void Rte_COMCbk_RxIndication(Com_SignalIdType SignalId);

void Com_Init(const Com_ConfigType* ConfigPtr)
{
    if (ConfigPtr == NULL_PTR) {
#if (DET_ENABLED == STD_ON)
        Det_ReportError(COM_MODULE_ID, COM_INSTANCE_ID,
                        COM_SID_INIT, COM_E_PARAM_POINTER);
#endif
        return;
    }

    Com_ConfigPtr = ConfigPtr;

    for (uint16 i = 0u; i < COM_MAX_SIGNALS; i++) {
        Com_SignalUpdated[i] = 0u;
        Com_RxTimeoutCounter[i] = 0u;
        Com_RxTimedOut[i] = 0u;

        for (uint8 j = 0u; j < COM_MAX_SIGNAL_SIZE; j++) {
            Com_SignalBuffer[i][j] = 0u;
        }
    }

    for (uint16 i = 0u; i < COM_MAX_TX_PDUS; i++) {
        Com_TxPending[i] = 0u;
        Com_TxConfirmed[i] = 0u;
    }

    Com_Initialized = 1u;
}

Std_ReturnType Com_SendSignal(Com_SignalIdType SignalId, const void* SignalDataPtr)
{
    if (Com_Initialized == 0u) {
        return E_NOT_OK;
    }

    if (SignalDataPtr == NULL_PTR || SignalId >= Com_ConfigPtr->numSignals) {
        return E_NOT_OK;
    }

    const Com_SignalConfigType* sigCfg = &Com_ConfigPtr->signals[SignalId];
    uint8 byteSize = (sigCfg->bitSize + 7u) / 8u;

    SchM_Enter_Com_COM_EXCLUSIVE_AREA_0();

    const uint8* src = (const uint8*)SignalDataPtr;
    for (uint8 i = 0u; i < byteSize && i < COM_MAX_SIGNAL_SIZE; i++) {
        Com_SignalBuffer[SignalId][i] = src[i];
    }

    if (sigCfg->pduId < COM_MAX_TX_PDUS) {
        Com_TxPending[sigCfg->pduId] = 1u;
    }

    SchM_Exit_Com_COM_EXCLUSIVE_AREA_0();

    return E_OK;
}

Std_ReturnType Com_ReceiveSignal(Com_SignalIdType SignalId, void* SignalDataPtr)
{
    if (Com_Initialized == 0u || SignalDataPtr == NULL_PTR) {
        return E_NOT_OK;
    }

    if (SignalId >= Com_ConfigPtr->numSignals) {
        return E_NOT_OK;
    }

    const Com_SignalConfigType* sigCfg = &Com_ConfigPtr->signals[SignalId];
    uint8 byteSize = (sigCfg->bitSize + 7u) / 8u;

    uint8* dest = (uint8*)SignalDataPtr;
    for (uint8 i = 0u; i < byteSize && i < COM_MAX_SIGNAL_SIZE; i++) {
        dest[i] = Com_SignalBuffer[SignalId][i];
    }

    return E_OK;
}

void Com_MainFunctionRx(void)
{
    if (Com_Initialized == 0u) {
        return;
    }

    for (uint16 i = 0u; i < Com_ConfigPtr->numSignals; i++) {
        const Com_SignalConfigType* sigCfg = &Com_ConfigPtr->signals[i];

        if (Com_SignalUpdated[i] != 0u) {

            Com_RxTimeoutCounter[i] = 0u;
            Com_RxTimedOut[i] = 0u;
            Com_SignalUpdated[i] = 0u;

            Rte_COMCbk_RxIndication(sigCfg->signalId);
        } else {

            Com_RxTimeoutCounter[i]++;

            if (Com_RxTimeoutCounter[i] >= COM_RX_TIMEOUT_DEFAULT) {
                if (Com_RxTimedOut[i] == 0u) {
                    Com_RxTimedOut[i] = 1u;
                    Rte_COMCbk_RxTimeout(sigCfg->signalId);
                }
            }
        }
    }
}

void Com_MainFunctionTx(void)
{
    PduInfoType pduInfo;
    uint8 txBuffer[8u];

    if (Com_Initialized == 0u) {
        return;
    }

    for (uint16 pduIdx = 0u; pduIdx < Com_ConfigPtr->numTxPdus; pduIdx++) {
        if (Com_TxPending[pduIdx] != 0u) {

            for (uint8 k = 0u; k < 8u; k++) {
                txBuffer[k] = 0u;
            }

            for (uint16 s = 0u; s < Com_ConfigPtr->numSignals; s++) {
                if (Com_ConfigPtr->signals[s].pduId == (PduIdType)pduIdx) {
                    uint8 offset = Com_ConfigPtr->signals[s].byteOffset;
                    uint8 size = (Com_ConfigPtr->signals[s].bitSize + 7u) / 8u;

                    for (uint8 b = 0u; b < size && (offset + b) < 8u; b++) {
                        txBuffer[offset + b] = Com_SignalBuffer[s][b];
                    }
                }
            }

            pduInfo.SduDataPtr = txBuffer;
            pduInfo.SduLength  = 8u;

            if (PduR_Transmit((PduIdType)pduIdx, &pduInfo) == E_OK) {
                Com_TxPending[pduIdx] = 0u;
            }
        }
    }
}

void Com_RxIndication(PduIdType RxPduId, const PduInfoType* PduInfoPtr)
{
    if (Com_Initialized == 0u || PduInfoPtr == NULL_PTR) {
        return;
    }

    for (uint16 s = 0u; s < Com_ConfigPtr->numSignals; s++) {
        if (Com_ConfigPtr->signals[s].pduId == RxPduId) {
            uint8 offset = Com_ConfigPtr->signals[s].byteOffset;
            uint8 size = (Com_ConfigPtr->signals[s].bitSize + 7u) / 8u;

            SchM_Enter_Com_COM_EXCLUSIVE_AREA_0();

            for (uint8 b = 0u; b < size && (offset + b) < PduInfoPtr->SduLength; b++) {
                Com_SignalBuffer[s][b] = PduInfoPtr->SduDataPtr[offset + b];
            }
            Com_SignalUpdated[s] = 1u;

            SchM_Exit_Com_COM_EXCLUSIVE_AREA_0();
        }
    }
}

void Com_TxConfirmation(PduIdType TxPduId)
{
    if (Com_Initialized == 0u) {
        return;
    }

    if (TxPduId < COM_MAX_TX_PDUS) {
        Com_TxConfirmed[TxPduId] = 1u;
    }
}
