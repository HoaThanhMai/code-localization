#ifndef NVM_H
#define NVM_H

#include "Std_Types.h"

#define NVM_MODULE_ID              20u
#define NVM_INSTANCE_ID            0u
#define NVM_SID_INIT                0x00u
#define NVM_SID_READ_BLOCK          0x06u
#define NVM_SID_WRITE_BLOCK         0x07u
#define NVM_SID_CANCEL              0x10u
#define NVM_SID_MAIN_FUNCTION       0x0Eu

#define NVM_E_PARAM_BLOCK_ID       0x0Au
#define NVM_E_PARAM_POINTER        0x0Bu
#define NVM_E_NOT_INITIALIZED      0x14u
#define NVM_E_BLOCK_PENDING        0x15u

typedef uint16 NvM_BlockIdType;

typedef enum {
    NVM_REQ_OK           = 0,
    NVM_REQ_NOT_OK       = 1,
    NVM_REQ_PENDING      = 2,
    NVM_REQ_INTEGRITY_FAILED = 3,
    NVM_REQ_BLOCK_SKIPPED    = 4,
    NVM_REQ_CANCELED         = 5
} NvM_RequestResultType;

typedef enum {
    NVM_STATE_IDLE        = 0,
    NVM_STATE_READ        = 1,
    NVM_STATE_WRITE       = 2,
    NVM_STATE_CANCEL      = 3,
    NVM_STATE_WRITE_VERIFY = 4
} NvM_StateType;

#define NVM_MAX_BLOCKS     16u
#define NVM_MAX_BLOCK_SIZE 64u

typedef struct {
    NvM_BlockIdType blockId;
    uint16          blockSize;      
    uint8           writeProtect;   
    uint8           useCrc;         
} NvM_BlockConfigType;

typedef struct {
    const NvM_BlockConfigType* blocks;
    uint16                     numBlocks;
} NvM_ConfigType;

void                 NvM_Init(const NvM_ConfigType* ConfigPtr);
Std_ReturnType       NvM_ReadBlock(NvM_BlockIdType BlockId, uint8* DstPtr);
Std_ReturnType       NvM_WriteBlock(NvM_BlockIdType BlockId, const uint8* SrcPtr);
Std_ReturnType       NvM_CancelJobs(NvM_BlockIdType BlockId);
NvM_RequestResultType NvM_GetErrorStatus(NvM_BlockIdType BlockId);
void                 NvM_MainFunction(void);

#endif 
