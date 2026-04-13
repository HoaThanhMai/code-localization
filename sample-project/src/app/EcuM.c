#include "Std_Types.h"
#include "Det.h"
#include "Can.h"
#include "CanIf.h"
#include "PduR.h"
#include "Com.h"
#include "NvM.h"
#include "Rte_SwcCan.h"

extern const Can_ConfigType    Can_Config;
extern const CanIf_ConfigType  CanIf_Config;
extern const PduR_ConfigType   PduR_Config;
extern const Com_ConfigType    Com_Config;
extern const NvM_ConfigType    NvM_Config;

void EcuM_Init(void)
{

    Det_Init();

    NvM_Init(&NvM_Config);

    Can_Init(&Can_Config);
    CanIf_Init(&CanIf_Config);
    PduR_Init(&PduR_Config);
    Com_Init(&Com_Config);

    SwcCan_Init();
}

void EcuM_MainFunction(void)
{

    Can_MainFunction_Write();
    Can_MainFunction_Read();

    Com_MainFunctionRx();
    Com_MainFunctionTx();

    NvM_MainFunction();

    SwcCan_MainFunction();
}
