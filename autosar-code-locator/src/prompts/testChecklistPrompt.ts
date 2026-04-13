// ============ Test Checklist Prompt ============
// Used in QueryEngine.generateTestChecklist().

export function buildTestChecklistPrompt(params: {
  suspectPoints: string;
  executionSteps: string;
  blastRadiusAffected: string;
}): string {
  const { suspectPoints, executionSteps, blastRadiusAffected } = params;

  return `Given this bug investigation in an AUTOSAR codebase, generate a comprehensive test checklist.

## Suspect Points
${suspectPoints}

## Execution Path
${executionSteps}

## Blast Radius (affected symbols)
${blastRadiusAffected}

Generate a numbered test checklist covering:
1. Direct bug reproduction steps
2. Boundary value tests
3. Error path tests
4. Regression tests for affected symbols
5. Multi-core timing tests (if applicable)

Return JSON: { "testChecklist": ["item1", ...] }`;
}
