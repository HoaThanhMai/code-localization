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
Perform a FORENSIC bug analysis. You must trace ALL related execution sequences and verify every suspect against actual source code evidence.

### Investigation Protocol
1. **Trace ALL sequences** — Don't just analyze the primary path. Identify and trace:
   - Normal execution path (happy path)
   - Error/failure path (what happens when E_NOT_OK is returned)
   - Initialization sequence (is the module properly initialized before use?)
   - Callback path (TxConfirmation, RxIndication — are they registered and called?)
   - MainFunction path (periodic processing — state machine progression)
   - Configuration dependency path (how *_Cfg.h / *_PBcfg.c affect runtime)
2. **Verify EVERY suspect in source code** — For each suspect point, you MUST cite:
   - Exact file path and line number
   - What the code actually does at that line
   - Why it's problematic (the mechanism, not just "could be wrong")
3. **Cross-reference configuration** — Check if runtime behavior matches configuration expectations

### AUTOSAR-Specific Bug Patterns to Check

#### Pattern 1: Return Value Propagation Gaps
- Trace Std_ReturnType from lowest layer (MCAL) up to highest (SWC)
- At EACH boundary: does the caller check E_OK/E_NOT_OK?
- What happens to the caller's logic if the callee returns E_NOT_OK?

#### Pattern 2: State Machine Issues
- Dead-end states: is there always an exit transition?
- Missing timeout/watchdog: what if the expected event never arrives?
- Race condition: can ISR and MainFunction modify the same state variable?
- Initialization state: does the module reject API calls when not initialized?

#### Pattern 3: Configuration Mismatch
- PBcfg vs Lcfg inconsistency (PDU IDs, buffer sizes, callback references)
- EB Tresos/DaVinci parameterization: are generated constants used correctly?
- Module enable/disable flags: is a feature used that's configured as disabled?

#### Pattern 4: Timing / Concurrency
- Task priority inversion: higher priority task blocked by lower priority
- Missing SchM_Enter/Exit around shared data access
- ISR context: are non-reentrant functions called from ISR?
- MainFunction period vs timeout values: is the period fast enough to catch timeouts?

#### Pattern 5: Initialization Order
- EcuM startup: are modules initialized in correct dependency order?
- Module used before Init called (e.g., Com_SendSignal before Com_Init)
- Post-build config pointer: is it NULL when module starts?

#### Pattern 6: Memory / Buffer / Boundary
- NvM block corruption: write during read, ReadAll not complete before access
- PDU buffer size vs actual data length mismatch
- Stack overflow in ISR context (nested ISR, large local variables)
- NULL pointer at API boundary — especially for configuration pointers and buffer pointers

Return JSON:
{
  "suspectPoints": [
    {
      "severity": "high|medium|low",
      "symbol": "function_name",
      "filePath": "/path/file.c",
      "line": 123,
      "reason": "MUST cite source code: 'At line 123, Can_Write() returns E_NOT_OK but CanIf_Transmit() at CanIf.c:456 ignores this return value, causing the TX request to be silently dropped'",
      "category": "error_handling|state_machine|config|return_value|timing|concurrency|boundary_check",
      "suggestedAction": "Specific action: 'Add return value check in CanIf_Transmit() at line 456: if (Can_Write(...) != E_OK) { report DET error and set CanIf channel to TX_OFFLINE }'"
    }
  ],
  "suggestions": [
    { "severity": "HIGH|MEDIUM|LOW", "text": "Concrete investigation step referencing specific file and function", "filePath": "/path/file.c", "line": 123 }
  ],
  "testChecklist": [
    "Call Can_Write() with invalid HwObject=0xFF → verify DET_REPORTERROR(CAN_E_PARAM_HANDLE) is called",
    "Trigger TX while CAN controller is in STOPPED state → verify ComM notification is sent",
    "Remove PBcfg callback entry → verify CanIf handles NULL callback pointer gracefully"
  ]
}

IMPORTANT:
- Only flag suspects that are SUPPORTED by source code evidence. Reference actual symbols, file paths, and what the code does.
- Every "reason" MUST explain the mechanism: what code does what, and why it's wrong.
- Every "suggestedAction" MUST be specific enough that a developer can implement it without further analysis.
- testChecklist items MUST reference real symbols, specific parameter values, and expected outcomes.`;
}
