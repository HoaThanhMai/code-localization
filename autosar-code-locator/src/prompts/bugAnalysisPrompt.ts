// ============ Bug Analysis Prompt ============
// Used in QueryEngine.agentBugAnalysis() for detailed bug investigation.

export function buildBugAnalysisPrompt(params: {
  query: string;
  executionSteps: string;
  investigationTrace: string;
  contextEntries: string;
  impactEntries: string;
}): string {
  const { query, executionSteps, investigationTrace, contextEntries, impactEntries } = params;

  return `## Bug Report
${query}

## Execution Sequence (most likely path)
${executionSteps}

## Agent Investigation Trace
${investigationTrace}

## Symbol Contexts (all gathered)
${contextEntries}

## Impact Analysis (all gathered)
${impactEntries}

## Task
Based on ALL gathered evidence, perform a thorough bug analysis considering these AUTOSAR-specific scenarios:

### Scenario 1: Error Handling Gaps
- Unchecked Std_ReturnType propagation
- DET disabled in production
- Silent failures in BSW callbacks

### Scenario 2: State Machine Issues
- Dead-end states (no exit transition)
- Missing timer expiry handling
- Race between MainFunction and ISR

### Scenario 3: Configuration Mismatch
- PBcfg vs Lcfg inconsistency
- EB Tresos/DaVinci parameterization errors
- Module enable/disable flags

### Scenario 4: Timing / Concurrency
- Task priority inversion
- Unprotected shared resources
- SchM enter/exit mismatch

### Scenario 5: Memory / Boundary
- NvM block corruption patterns
- Stack overflow in ISR context
- Missing null pointer checks at API boundary

Return JSON:
{
  "suspectPoints": [
    {
      "severity": "high|medium|low",
      "symbol": "function_name",
      "filePath": "/path/file.c",
      "line": 123,
      "reason": "why suspicious — reference specific evidence",
      "category": "error_handling|state_machine|config|return_value|timing|concurrency|boundary_check",
      "suggestedAction": "specific action to verify/fix"
    }
  ],
  "suggestions": [
    { "severity": "HIGH|MEDIUM|LOW", "text": "investigation suggestion", "filePath": "/path/file.c", "line": 123 }
  ],
  "testChecklist": ["Specific test item referencing real symbols and files"]
}

IMPORTANT: Only flag suspects that are SUPPORTED by evidence. Reference actual symbols and file paths.`;
}
