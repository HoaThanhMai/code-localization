#ifndef CAN_CFG_H
#define CAN_CFG_H

#include "Std_Types.h"

#define CAN_DEV_ERROR_DETECT     STD_ON
#define DET_ENABLED              STD_ON

#define CAN_MODULE_ID            80u
#define CAN_INSTANCE_ID          0u

#define CAN_SID_INIT                     0x00u
#define CAN_SID_WRITE                    0x06u
#define CAN_SID_MAINFUNCTION_WRITE       0x01u
#define CAN_SID_MAINFUNCTION_READ        0x08u

#define CAN_E_PARAM_POINTER              0x01u
#define CAN_E_UNINIT                     0x02u
#define CAN_E_TRANSITION                 0x03u

#define CAN_CONTROLLER_ID_0      0u
#define CAN_BAUDRATE_500KBPS     500u

#define CAN_NUM_TX_BUFFERS       8u
#define CAN_NUM_RX_BUFFERS       4u

#endif 
