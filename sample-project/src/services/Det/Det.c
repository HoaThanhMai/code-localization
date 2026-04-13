#include "Det.h"

static uint32 Det_ErrorCount = 0u;
static uint16 Det_LastModuleId = 0u;
static uint8  Det_LastApiId = 0u;
static uint8  Det_LastErrorId = 0u;

Std_ReturnType Det_ReportError(uint16 ModuleId, uint8 InstanceId,
                               uint8 ApiId, uint8 ErrorId)
{
    Det_ErrorCount++;
    Det_LastModuleId = ModuleId;
    Det_LastApiId = ApiId;
    Det_LastErrorId = ErrorId;

    return E_OK;
}

Std_ReturnType Det_ReportRuntimeError(uint16 ModuleId, uint8 InstanceId,
                                      uint8 ApiId, uint8 ErrorId)
{
    return Det_ReportError(ModuleId, InstanceId, ApiId, ErrorId);
}
