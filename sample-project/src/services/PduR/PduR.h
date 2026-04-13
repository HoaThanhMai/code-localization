#ifndef PDUR_H
#define PDUR_H

#include "Std_Types.h"
#include "CanIf.h"

#define PDUR_MODULE_ID              51u
#define PDUR_INSTANCE_ID            0u

typedef struct {
    PduIdType  srcPduId;
    PduIdType  destPduId;
    uint8      direction;    
} PduR_RoutingPathType;

typedef struct {
    const PduR_RoutingPathType* routingPaths;
    uint16                      numPaths;
} PduR_ConfigType;

void            PduR_Init(const PduR_ConfigType* ConfigPtr);
Std_ReturnType  PduR_Transmit(PduIdType TxPduId, const PduInfoType* PduInfoPtr);

void PduR_CanIfRxIndication(PduIdType RxPduId, const PduInfoType* PduInfoPtr);
void PduR_CanIfTxConfirmation(PduIdType TxPduId);

#endif 
