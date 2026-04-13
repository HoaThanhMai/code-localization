/**
 * AUTOSAR domain knowledge: module names, layers, naming patterns, macro mappings.
 * Used for query extraction and result categorization.
 */

export const AUTOSAR_LAYERS = ['MCAL', 'ECUAL', 'BSW', 'RTE', 'SWC', 'CDD'] as const;
export type AutosarLayer = (typeof AUTOSAR_LAYERS)[number];

export const AUTOSAR_MODULES: Record<AutosarLayer, string[]> = {
  MCAL: [
    'Adc', 'Can', 'Dio', 'Eth', 'Fls', 'Gpt', 'Icu', 'Lin', 'Mcu', 'Ocu',
    'Port', 'Pwm', 'Spi', 'Wdg', 'Crypto',
  ],
  ECUAL: [
    'CanIf', 'ComStack', 'EthIf', 'LinIf', 'LinTrcv', 'CanTrcv', 'EthTrcv',
  ],
  BSW: [
    'BswM', 'Com', 'ComM', 'Dcm', 'Dem', 'Det', 'EcuM', 'Fee', 'FiM',
    'MemIf', 'NvM', 'Os', 'PduR', 'SchM', 'CanSM', 'ComSM', 'LinSM',
    'EthSM', 'Nm', 'CanNm', 'UdpNm', 'CanTp', 'DoIP', 'SoAd',
    'StbM', 'WdgM', 'Xcp',
  ],
  RTE: ['Rte'],
  SWC: [],
  CDD: [],
};

/** Common AUTOSAR naming pattern prefixes */
export const AUTOSAR_API_PATTERNS = [
  '{Module}_Init',
  '{Module}_DeInit',
  '{Module}_MainFunction',
  '{Module}_GetVersionInfo',
  '{Module}_SetMode',
  '{Module}_GetMode',
  'Rte_Call_{Port}_{Operation}',
  'Rte_Read_{Port}_{DataElement}',
  'Rte_Write_{Port}_{DataElement}',
  'Rte_IRead_{Runnable}_{Port}_{DataElement}',
  'Rte_IWrite_{Runnable}_{Port}_{DataElement}',
  'SchM_Enter_{Module}_{Area}',
  'SchM_Exit_{Module}_{Area}',
] as const;

/**
 * AUTOSAR macros that wrap C declarations and break standard parsers.
 * Used by the macro normalizer preprocessor.
 */
export const AUTOSAR_MACROS: Record<string, string> = {
  // Function declaration macros
  'FUNC(rettype, memclass)': 'rettype',
  'FUNC_P2CONST(rettype, ptrclass, memclass)': 'const rettype*',
  'FUNC_P2VAR(rettype, ptrclass, memclass)': 'rettype*',
  // Pointer macros
  'P2VAR(ptrtype, memclass, ptrclass)': 'ptrtype*',
  'P2CONST(ptrtype, memclass, ptrclass)': 'const ptrtype*',
  'CONSTP2VAR(ptrtype, memclass, ptrclass)': 'ptrtype* const',
  'CONSTP2CONST(ptrtype, memclass, ptrclass)': 'const ptrtype* const',
  'P2FUNC(rettype, ptrclass, fctname)': 'rettype (*fctname)',
  // Variable macros
  'VAR(vartype, memclass)': 'vartype',
  'CONST(consttype, memclass)': 'const consttype',
  // Inline / local
  'STATIC': 'static',
  'LOCAL_INLINE': 'static inline',
  'INLINE': 'inline',
};

/** Target cores for multi-core AUTOSAR */
export const TARGET_CORES = ['R5', 'A53', 'A7'] as const;
export type TargetCore = (typeof TARGET_CORES)[number];

/**
 * Try to detect which AUTOSAR module a symbol belongs to, based on naming convention.
 */
export function detectModule(symbolName: string): { module: string; layer: AutosarLayer } | null {
  // Match prefix: Can_Init -> module=Can, CanIf_Transmit -> module=CanIf
  for (const [layer, modules] of Object.entries(AUTOSAR_MODULES) as [AutosarLayer, string[]][]) {
    for (const mod of modules) {
      if (symbolName.startsWith(mod + '_') || symbolName.startsWith(mod + '.')) {
        return { module: mod, layer };
      }
    }
  }

  // Rte patterns
  if (symbolName.startsWith('Rte_')) {
    return { module: 'Rte', layer: 'RTE' };
  }
  if (symbolName.startsWith('SchM_')) {
    return { module: 'SchM', layer: 'BSW' };
  }

  return null;
}

/**
 * Detect the layer of a file path based on directory naming conventions.
 */
export function detectLayerFromPath(filePath: string): AutosarLayer | null {
  const lower = filePath.toLowerCase().replace(/\\/g, '/');

  if (lower.includes('/mcal/') || lower.includes('/mcal_')) { return 'MCAL'; }
  if (lower.includes('/ecual/') || lower.includes('/ecu_abstraction/')) { return 'ECUAL'; }
  if (lower.includes('/bsw/') || lower.includes('/services/')) { return 'BSW'; }
  if (lower.includes('/rte/') || lower.includes('/rte_')) { return 'RTE'; }
  if (lower.includes('/swc/') || lower.includes('/application/')) { return 'SWC'; }
  if (lower.includes('/cdd/') || lower.includes('/complex_driver/')) { return 'CDD'; }

  return null;
}

/**
 * Generate function patterns for a given module.
 * E.g., for "Can" -> ["Can_Init", "Can_DeInit", "Can_MainFunction*", ...]
 */
export function generateModulePatterns(moduleName: string): string[] {
  return [
    `${moduleName}_Init`,
    `${moduleName}_DeInit`,
    `${moduleName}_MainFunction*`,
    `${moduleName}_GetVersionInfo`,
    `${moduleName}_*`,
  ];
}

/**
 * Check whether a symbol likely represents a configuration constant/struct.
 */
export function isConfigSymbol(symbolName: string): boolean {
  return /(?:_Cfg|_PBcfg|_Lcfg|Config|_ConfigType|CONST_)/.test(symbolName);
}
