#ifndef COM_H
#define COM_H

#include "Std_Types.h"
#include "CanIf.h"    

#define COM_MODULE_ID              50u
#define COM_INSTANCE_ID            0u
#define COM_SID_INIT               0x01u
#define COM_SID_SEND_SIGNAL        0x0Au
#define COM_SID_RECEIVE_SIGNAL     0x0Bu
#define COM_SID_MAIN_FUNCTION_TX   0x19u
#define COM_SID_MAIN_FUNCTION_RX   0x18u

#define COM_E_PARAM_POINTER        20u
#define COM_E_UNINIT               30u

typedef uint16 Com_SignalIdType;

#define COM_MAX_SIGNALS            32u
#define COM_MAX_SIGNAL_SIZE         8u  

typedef struct {
    Com_SignalIdType signalId;
    PduIdType        pduId;
    uint8            byteOffset;
    uint8            bitSize;
    uint16           timeoutTicks;    
} Com_SignalConfigType;

typedef struct {
    const Com_SignalConfigType* signals;
    uint16                      numSignals;
    uint16                      numTxPdus;
    uint16                      numRxPdus;
} Com_ConfigType;

void            Com_Init(const Com_ConfigType* ConfigPtr);
Std_ReturnType  Com_SendSignal(Com_SignalIdType SignalId, const void* SignalDataPtr);
Std_ReturnType  Com_ReceiveSignal(Com_SignalIdType SignalId, void* SignalDataPtr);
void            Com_MainFunctionTx(void);
void            Com_MainFunctionRx(void);

void Com_RxIndication(PduIdType RxPduId, const PduInfoType* PduInfoPtr);
void Com_TxConfirmation(PduIdType TxPduId);

#endif 
