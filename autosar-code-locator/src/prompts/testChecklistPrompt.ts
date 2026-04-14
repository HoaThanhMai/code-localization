// ============ Test Checklist Prompt ============
// Used in QueryEngine.generateTestChecklist().

export function buildTestChecklistPrompt(params: {
  suspectPoints: string;
  executionSteps: string;
  blastRadiusAffected: string;
}): string {
  const { suspectPoints, executionSteps, blastRadiusAffected } = params;

  return `Given this bug investigation in an AUTOSAR codebase, generate a comprehensive and ACTIONABLE test checklist. Every test item must be specific enough that a test engineer can execute it without further analysis.

## Suspect Points
${suspectPoints}

## Execution Path
${executionSteps}

## Blast Radius (affected symbols)
${blastRadiusAffected}

Generate a numbered test checklist covering ALL of these categories:

### 1. Direct Bug Reproduction
- Exact steps to trigger the reported bug
- Specific input values, preconditions, and expected vs actual behavior
- Include module state (initialized, running, error) for each test

### 2. Return Value Propagation Tests
- For each suspect function: call with conditions that produce E_NOT_OK
- Verify the error propagates up the entire call chain
- Check that the top-level caller (SWC) receives the error notification

### 3. Boundary Value Tests
- Test with minimum and maximum valid parameter values
- Test with zero, NULL, 0xFF / 0xFFFF for each parameter
- Test buffer boundaries: exact size, size+1, size-1

### 4. Error Path / Negative Tests
- Call each suspect function when module is NOT initialized → verify DET error
- Call with invalid parameters → verify DET error and safe behavior
- Simulate hardware failure (CAN bus off, NvM read failure) → verify error handling

### 5. State Machine Tests
- Test each state transition in the suspect module
- Verify no dead-end states (force every state and check for exit transition)
- Test timeout scenarios: disable expected events and verify recovery

### 6. Concurrency / Reentrancy Tests
- Trigger suspect function from multiple tasks simultaneously
- Interrupt suspect function with ISR that accesses same module
- Verify SchM protection prevents data corruption

### 7. Configuration Validation Tests
- Modify PBcfg parameters (PDU IDs, buffer sizes, callback pointers) to invalid values
- Verify runtime code detects and handles misconfiguration gracefully
- Test with callback pointer set to NULL

### 8. Regression Tests for Blast Radius
- For EACH symbol in the blast radius: verify it still works correctly after the fix
- Test cross-module interactions (caller → callee across module boundary)

For EACH test item, use this format:
"[Category] Call X() with Y=Z while module in STATE → verify EXPECTED_OUTCOME (file.c:LINE)"

Return JSON: { "testChecklist": ["item1", ...] }`;
}
