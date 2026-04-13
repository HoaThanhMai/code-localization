#ifndef CANIF_H
#define CANIF_H

#include "Std_Types.h"

#define CANIF_MODULE_ID               60u
#define CANIF_INSTANCE_ID             0u
#define CANIF_SID_INIT                0x01u
#define CANIF_SID_TRANSMIT            0x05u
#define CANIF_SID_RX_INDICATION       0x14u
#define CANIF_SID_TX_CONFIRMATION     0x13u

#define CANIF_E_PARAM_POINTER         20u
#define CANIF_E_UNINIT                30u
#define CANIF_E_INVALID_TXPDUID       50u
#define CANIF_E_INVALID_RXPDUID       60u

typedef uint16 PduIdType;

typedef struct {
    uint8* SduDataPtr;
    uint16 SduLength;
} PduInfoType;

typedef void (*CanIf_RxIndicationCbk)(PduIdType RxPduId, const PduInfoType* PduInfoPtr);
typedef void (*CanIf_TxConfirmationCbk)(PduIdType TxPduId);

typedef struct {
    uint16                   numTxPdus;
    uint16                   numRxPdus;
    CanIf_RxIndicationCbk    rxIndicationCbk;
    CanIf_TxConfirmationCbk  txConfirmationCbk;
} CanIf_ConfigType;

void            CanIf_Init(const CanIf_ConfigType* ConfigPtr);
Std_ReturnType  CanIf_Transmit(PduIdType TxPduId, const PduInfoType* PduInfoPtr);

void CanIf_TxConfirmation(uint16 Hth);
void CanIf_RxIndication(uint16 Hrh, const void* PduInfo);

#endif 
