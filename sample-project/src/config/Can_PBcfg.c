#include "Can.h"
#include "Can_Cfg.h"

const Can_ConfigType Can_Config = {
    .controllerId = CAN_CONTROLLER_ID_0,
    .baudrate     = CAN_BAUDRATE_500KBPS,
    .txBufferCount = CAN_NUM_TX_BUFFERS,
    .rxBufferCount = CAN_NUM_RX_BUFFERS
};

#include "Com.h"

static const Com_SignalConfigType Com_SignalConfigs[] = {

    {  0u,       0u,    0u,         16u,     60u   },  
    {  1u,       0u,    2u,         16u,     60u   },  
    {  2u,       1u,    0u,         16u,     30u   },  
    {  3u,       1u,    2u,          8u,     3000u },  
    {  4u,       2u,    0u,         64u,     0u    },  
};

const Com_ConfigType Com_Config = {
    .signals    = Com_SignalConfigs,
    .numSignals = 5u,
    .numTxPdus  = 3u,
    .numRxPdus  = 2u
};

#include "NvM.h"

static const NvM_BlockConfigType NvM_BlockConfigs[] = {

    {  0u,      32u,       1u,           1u  },  
    {  1u,      sizeof(uint8)*20,  0u,   1u  },  
    {  2u,      16u,       0u,           0u  },  
};

const NvM_ConfigType NvM_Config = {
    .blocks    = NvM_BlockConfigs,
    .numBlocks = 3u
};

#include "PduR.h"

static const PduR_RoutingPathType PduR_RoutingPaths[] = {

    {  0u,       0u,        0u  },  
    {  1u,       1u,        0u  },  
    {  2u,       2u,        0u  },  
    {  0u,       0u,        1u  },  
    {  1u,       1u,        1u  },  
};

const PduR_ConfigType PduR_Config = {
    .routingPaths = PduR_RoutingPaths,
    .numPaths     = 5u
};

#include "CanIf.h"

extern void PduR_CanIfRxIndication(PduIdType RxPduId, const PduInfoType* PduInfoPtr);
extern void PduR_CanIfTxConfirmation(PduIdType TxPduId);

const CanIf_ConfigType CanIf_Config = {
    .numTxPdus          = 3u,
    .numRxPdus          = 2u,
    .rxIndicationCbk    = PduR_CanIfRxIndication,
    .txConfirmationCbk  = PduR_CanIfTxConfirmation
};
