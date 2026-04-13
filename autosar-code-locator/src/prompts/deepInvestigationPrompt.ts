// ============ Deep Investigation Prompt ============
// Used in QueryEngine.investigateDeeper() for focused analysis on a suspect symbol.

export function buildDeepInvestigationPrompt(
  suspectSymbol: string,
  evidenceSummary: string
): string {
  return `Perform a deep investigation of this suspect function in an AUTOSAR codebase.

## Suspect Symbol
${suspectSymbol}

## All Evidence
${evidenceSummary}

## Task
1. Trace all callers and callees
2. Identify state machine transitions involving this function
3. Check configuration dependencies (PBcfg, Lcfg)
4. Identify concurrency risks (SchM, ISR context)
5. Check error propagation paths

Return JSON:
{
  "suspectPoints": [...],
  "suggestions": [...],
  "testChecklist": [...]
}

Reference ACTUAL symbols and file paths from evidence only.`;
}
