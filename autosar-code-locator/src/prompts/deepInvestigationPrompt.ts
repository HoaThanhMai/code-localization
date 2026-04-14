// ============ Deep Investigation Prompt ============
// Used in QueryEngine.investigateDeeper() for focused analysis on a suspect symbol.

export function buildDeepInvestigationPrompt(
  suspectSymbol: string,
  evidenceSummary: string
): string {
  return `Perform a forensic deep investigation of this suspect function in an AUTOSAR codebase. Leave no stone unturned — trace every path, read every relevant file, verify every assumption.

## Suspect Symbol
${suspectSymbol}

## All Evidence
${evidenceSummary}

## Task — Exhaustive Investigation Protocol

### 1. Complete Call Chain Analysis
- Trace ALL callers of this function (direct and indirect up to 3 levels)
- Trace ALL callees of this function (direct and indirect up to 3 levels)
- For each caller: does it check the return value? Does it handle errors?
- For each callee: can it fail? What happens when it does?
- Build the complete call chain diagram: who triggers this function and what gets triggered

### 2. State Machine Analysis
- Identify ALL state variables this function reads or modifies
- Map the state transitions: which states lead into this function? Which states lead out?
- Check for dead-end states (no exit transition) or missing timeout recovery
- Check for race conditions: can an ISR modify the state while MainFunction is reading it?
- Verify initialization: is the state properly set during Module_Init?

### 3. Configuration Dependency Verification
- Identify ALL configuration parameters this function depends on (from *_Cfg.h, *_PBcfg.c, *_Lcfg.c)
- For each config parameter: is it used correctly? Are bounds checked? Can it be zero/null?
- Check if callback function pointers in PBcfg are valid (non-NULL, correct signature)
- Verify PDU IDs, buffer sizes, and timing parameters match between modules

### 4. Concurrency and Reentrancy Analysis
- Is this function called from ISR context? From multiple OS tasks?
- Are shared resources (global variables, hardware registers) protected by SchM_Enter/Exit?
- Check for SchM_Enter/Exit mismatch (enter without exit, or wrong exclusive area ID)
- Can this function be interrupted by a higher-priority ISR that calls the same module?

### 5. Error Propagation Path Analysis
- What error codes can this function return?
- Trace EACH error code UP the call chain: is it propagated or swallowed?
- What DET errors should be reported? Is DET actually enabled?
- What happens to the system if this function fails silently?

### 6. Initialization and Lifecycle
- When is this function first callable? (After which Init function?)
- What happens if called before initialization? (Guard check or undefined behavior?)
- Is there a proper shutdown/deinitialization path?

Return JSON:
{
  "suspectPoints": [
    {
      "severity": "high|medium|low",
      "symbol": "function_name",
      "filePath": "/path/file.c",
      "line": 123,
      "reason": "Source-code-backed explanation: 'At file.c:123, the function does X which causes Y because Z'",
      "category": "error_handling|state_machine|config|return_value|timing|concurrency|boundary_check",
      "suggestedAction": "Specific fix: 'Add SchM_Enter_Can_CAN_EXCLUSIVE_AREA_0() before accessing Can_ControllerState at line 125'"
    }
  ],
  "suggestions": [
    { "severity": "HIGH|MEDIUM|LOW", "text": "Concrete next step with file/function reference", "filePath": "/path/file.c", "line": 123 }
  ],
  "testChecklist": [
    "Call function while module is UNINIT → verify DET error and E_NOT_OK return",
    "Trigger concurrent access from Task and ISR → verify SchM protection prevents corruption",
    "Set config parameter to boundary value (0, MAX) → verify no buffer overflow or divide-by-zero"
  ],
  "callChain": {
    "callers": ["caller1() at file1.c:10", "caller2() at file2.c:20"],
    "callees": ["callee1() at file3.c:30", "callee2() at file4.c:40"]
  },
  "stateVariables": ["varName at file.c:5 — tracks module state, modified by Init/MainFunction/ISR"]
}

IMPORTANT: Reference ACTUAL symbols and file paths from evidence only. Every claim must be traceable to source code.`;
}
