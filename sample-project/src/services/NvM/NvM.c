#include "NvM.h"
#include "Det.h"
#include "SchM.h"

static uint8 NvM_Initialized = 0u;
static const NvM_ConfigType* NvM_ConfigPtr = NULL_PTR;

typedef struct {
    NvM_StateType          state;
    NvM_RequestResultType  result;
    uint8*                 ramPtr;
    const uint8*           srcPtr;     
    uint16                 pendingBytes;
    uint8                  ramMirror[NVM_MAX_BLOCK_SIZE];
} NvM_BlockRuntimeType;

static NvM_BlockRuntimeType NvM_BlockRuntime[NVM_MAX_BLOCKS];

static uint8 NvM_NvStorage[NVM_MAX_BLOCKS][NVM_MAX_BLOCK_SIZE];

void NvM_Init(const NvM_ConfigType* ConfigPtr)
{
    if (ConfigPtr == NULL_PTR) {
#if (DET_ENABLED == STD_ON)
        Det_ReportError(NVM_MODULE_ID, NVM_INSTANCE_ID,
                        NVM_SID_INIT, NVM_E_PARAM_POINTER);
#endif
        return;
    }

    NvM_ConfigPtr = ConfigPtr;

    for (uint16 i = 0u; i < NVM_MAX_BLOCKS; i++) {
        NvM_BlockRuntime[i].state   = NVM_STATE_IDLE;
        NvM_BlockRuntime[i].result  = NVM_REQ_OK;
        NvM_BlockRuntime[i].ramPtr  = NULL_PTR;
        NvM_BlockRuntime[i].srcPtr  = NULL_PTR;
        NvM_BlockRuntime[i].pendingBytes = 0u;
    }

    NvM_Initialized = 1u;
}

Std_ReturnType NvM_ReadBlock(NvM_BlockIdType BlockId, uint8* DstPtr)
{
    if (NvM_Initialized == 0u) {
#if (DET_ENABLED == STD_ON)
        Det_ReportError(NVM_MODULE_ID, NVM_INSTANCE_ID,
                        NVM_SID_READ_BLOCK, NVM_E_NOT_INITIALIZED);
#endif
        return E_NOT_OK;
    }

    if (BlockId >= NvM_ConfigPtr->numBlocks || DstPtr == NULL_PTR) {
        return E_NOT_OK;
    }

    if (NvM_BlockRuntime[BlockId].state != NVM_STATE_IDLE) {
        return E_NOT_OK;    
    }

    SchM_Enter_NvM_NVM_EXCLUSIVE_AREA_0();

    NvM_BlockRuntime[BlockId].ramPtr = DstPtr;
    NvM_BlockRuntime[BlockId].state  = NVM_STATE_READ;
    NvM_BlockRuntime[BlockId].result = NVM_REQ_PENDING;
    NvM_BlockRuntime[BlockId].pendingBytes = NvM_ConfigPtr->blocks[BlockId].blockSize;

    SchM_Exit_NvM_NVM_EXCLUSIVE_AREA_0();

    return E_OK;
}

Std_ReturnType NvM_WriteBlock(NvM_BlockIdType BlockId, const uint8* SrcPtr)
{
    if (NvM_Initialized == 0u) {
#if (DET_ENABLED == STD_ON)
        Det_ReportError(NVM_MODULE_ID, NVM_INSTANCE_ID,
                        NVM_SID_WRITE_BLOCK, NVM_E_NOT_INITIALIZED);
#endif
        return E_NOT_OK;
    }

    if (BlockId >= NvM_ConfigPtr->numBlocks || SrcPtr == NULL_PTR) {
        return E_NOT_OK;
    }

    if (NvM_BlockRuntime[BlockId].state != NVM_STATE_IDLE) {
#if (DET_ENABLED == STD_ON)
        Det_ReportError(NVM_MODULE_ID, NVM_INSTANCE_ID,
                        NVM_SID_WRITE_BLOCK, NVM_E_BLOCK_PENDING);
#endif
        return E_NOT_OK;
    }

    if (NvM_ConfigPtr->blocks[BlockId].writeProtect != 0u) {
        return E_NOT_OK;
    }

    uint16 blockSize = NvM_ConfigPtr->blocks[BlockId].blockSize;
    for (uint16 i = 0u; i < blockSize && i < NVM_MAX_BLOCK_SIZE; i++) {
        NvM_BlockRuntime[BlockId].ramMirror[i] = SrcPtr[i];
    }

    NvM_BlockRuntime[BlockId].state  = NVM_STATE_WRITE;
    NvM_BlockRuntime[BlockId].result = NVM_REQ_PENDING;
    NvM_BlockRuntime[BlockId].pendingBytes = blockSize;

    return E_OK;
}

Std_ReturnType NvM_CancelJobs(NvM_BlockIdType BlockId)
{
    if (NvM_Initialized == 0u || BlockId >= NvM_ConfigPtr->numBlocks) {
        return E_NOT_OK;
    }

    SchM_Enter_NvM_NVM_EXCLUSIVE_AREA_0();

    if (NvM_BlockRuntime[BlockId].state != NVM_STATE_IDLE) {
        NvM_BlockRuntime[BlockId].state  = NVM_STATE_CANCEL;
        NvM_BlockRuntime[BlockId].result = NVM_REQ_CANCELED;
    }

    SchM_Exit_NvM_NVM_EXCLUSIVE_AREA_0();

    return E_OK;
}

NvM_RequestResultType NvM_GetErrorStatus(NvM_BlockIdType BlockId)
{
    if (BlockId >= NVM_MAX_BLOCKS) {
        return NVM_REQ_NOT_OK;
    }
    return NvM_BlockRuntime[BlockId].result;
}

void NvM_MainFunction(void)
{
    if (NvM_Initialized == 0u) {
        return;
    }

    for (uint16 blockIdx = 0u; blockIdx < NvM_ConfigPtr->numBlocks; blockIdx++) {
        switch (NvM_BlockRuntime[blockIdx].state) {

            case NVM_STATE_IDLE:

                break;

            case NVM_STATE_READ:
            {

                SchM_Enter_NvM_NVM_EXCLUSIVE_AREA_0();

                uint16 size = NvM_BlockRuntime[blockIdx].pendingBytes;
                uint8* dst  = NvM_BlockRuntime[blockIdx].ramPtr;

                for (uint16 i = 0u; i < size && i < NVM_MAX_BLOCK_SIZE; i++) {
                    dst[i] = NvM_NvStorage[blockIdx][i];
                }

                NvM_BlockRuntime[blockIdx].state  = NVM_STATE_IDLE;
                NvM_BlockRuntime[blockIdx].result = NVM_REQ_OK;

                SchM_Exit_NvM_NVM_EXCLUSIVE_AREA_0();
                break;
            }

            case NVM_STATE_WRITE:
            {

                SchM_Enter_NvM_NVM_EXCLUSIVE_AREA_0();

                uint16 size = NvM_BlockRuntime[blockIdx].pendingBytes;

                for (uint16 i = 0u; i < size && i < NVM_MAX_BLOCK_SIZE; i++) {
                    NvM_NvStorage[blockIdx][i] =
                        NvM_BlockRuntime[blockIdx].ramMirror[i];
                }

                NvM_BlockRuntime[blockIdx].state  = NVM_STATE_IDLE;
                NvM_BlockRuntime[blockIdx].result = NVM_REQ_OK;

                SchM_Exit_NvM_NVM_EXCLUSIVE_AREA_0();
                break;
            }

            default:

#if (DET_ENABLED == STD_ON)
                Det_ReportRuntimeError(NVM_MODULE_ID, NVM_INSTANCE_ID,
                                       NVM_SID_MAIN_FUNCTION, NVM_E_PARAM_BLOCK_ID);
#endif
                break;
        }
    }
}
