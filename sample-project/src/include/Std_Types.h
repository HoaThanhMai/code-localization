#ifndef STD_TYPES_H
#define STD_TYPES_H

typedef unsigned char      uint8;
typedef unsigned short     uint16;
typedef unsigned int       uint32;
typedef signed char        sint8;
typedef signed short       sint16;
typedef signed int         sint32;

typedef uint8 Std_ReturnType;
#define E_OK       ((Std_ReturnType)0x00u)
#define E_NOT_OK   ((Std_ReturnType)0x01u)

typedef struct {
    uint16 vendorID;
    uint16 moduleID;
    uint8  sw_major_version;
    uint8  sw_minor_version;
    uint8  sw_patch_version;
} Std_VersionInfoType;

#ifndef NULL_PTR
#define NULL_PTR ((void *)0)
#endif

#define STD_ON  1u
#define STD_OFF 0u

#endif 
