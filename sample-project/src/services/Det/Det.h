#ifndef DET_H
#define DET_H

#include "Std_Types.h"

#define DET_ENABLED  STD_ON

Std_ReturnType Det_ReportError(uint16 ModuleId, uint8 InstanceId,
                               uint8 ApiId, uint8 ErrorId);

Std_ReturnType Det_ReportRuntimeError(uint16 ModuleId, uint8 InstanceId,
                                      uint8 ApiId, uint8 ErrorId);

#endif 
