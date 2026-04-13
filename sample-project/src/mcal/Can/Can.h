#ifndef CAN_H
#define CAN_H

#include "Std_Types.h"

#define CAN_MODULE_ID          80u
#define CAN_INSTANCE_ID        0u

#define CAN_SID_INIT                 0x00u
#define CAN_SID_WRITE                0x06u
#define CAN_SID_MAINFUNCTION_WRITE   0x01u
#define CAN_SID_MAINFUNCTION_READ    0x08u

#define CAN_E_PARAM_POINTER    0x01u
#define CAN_E_UNINIT           0x02u
#define CAN_E_TRANSITION       0x04u

typedef enum {
    CAN_CS_UNINIT  = 0,
    CAN_CS_STOPPED = 1,
    CAN_CS_STARTED = 2,
    CAN_CS_SLEEP   = 3
} Can_ControllerStateType;

typedef struct {
    uint32 id;
    uint8  length;
    uint8* sdu;
} Can_PduType;

typedef uint16 Can_HwHandleType;

typedef struct {
    uint8   controllerId;
    uint32  baudrate;
    uint16  txBufferCount;
    uint16  rxBufferCount;
} Can_ConfigType;

void            Can_Init(const Can_ConfigType* Config);
Std_ReturnType  Can_Write(Can_HwHandleType Hth, const Can_PduType* PduInfo);
void            Can_MainFunction_Write(void);
void            Can_MainFunction_Read(void);

#endif 
