// ============ Combined Bug Analysis Prompt ============
// Merges Phase 3 (synthesis) + Phase 4 (bug analysis + narrative) into a single LLM call
// to reduce latency from 3 sequential calls to 1.

export function buildCombinedBugAnalysisPrompt(params: {
  query: string;
  reasoningTrace: string;
  evidenceSummary: string;
}): string {
  const { query, reasoningTrace, evidenceSummary } = params;

  return `You are an expert embedded software engineer performing forensic bug analysis. Based on ALL evidence, produce a comprehensive analysis with full traceability to source code.

## Bug Report
"${query}"

## Agent Reasoning Trace
${reasoningTrace}

## All Evidence
${evidenceSummary}

## Task
Produce a SINGLE JSON response with ALL of the following sections. Every claim MUST be backed by source code evidence.

{
  "sequences": [
    {
      "name": "Descriptive name — be specific (e.g., 'CAN TX Error Path: SwcCan → Com → PduR → CanIf → Can_Write fails')",
      "priority": 1,
      "processType": "within_community|cross_community",
      "communities": ["ModuleA", "ModuleB"],
      "confidence": 0.95,
      "steps": [
        { "symbol": "func_name", "filePath": "path/to/file.c", "line": 123, "stepIndex": 0, "description": "What this step does AND what to watch for (error handling, state check, etc.)" }
      ]
    }
  ],
  "symbols": [
    { "symbolName": "func_name", "filePath": "path/to/file.c", "line": 123, "score": 0.9, "snippet": "actual code snippet from evidence", "providerSource": "gitnexus" }
  ],
  "clusters": [
    { "name": "Related Module", "cohesion": 0.8, "symbols": ["sym1", "sym2"] }
  ],
  "suspectPoints": [
    {
      "severity": "high|medium|low",
      "symbol": "function_name",
      "filePath": "path/file.c",
      "line": 123,
      "reason": "MUST cite source code: 'At path/file.c:123, function X does Y which causes Z because...'",
      "category": "error_handling|state_machine|config|return_value|timing|concurrency|boundary_check",
      "suggestedAction": "Specific action with code reference: 'Add check at line 125: if (retVal != E_OK) { Det_ReportError(...); return E_NOT_OK; }'"
    }
  ],
  "suggestions": [
    { "severity": "HIGH|MEDIUM|LOW", "text": "Concrete investigation step with file and function reference", "filePath": "path/file.c", "line": 123 }
  ],
  "testChecklist": [
    "Call Module_Function() with invalid parameter X=0xFF → verify DET error CAN_E_PARAM_HANDLE reported",
    "Trigger operation while module is in UNINIT state → verify E_NOT_OK returned and no side effects",
    "Check PBcfg callback pointer for Module_Callback → verify it's non-NULL and correctly mapped"
  ]
}

## Sequence Tracing Requirements
You MUST identify and trace ALL applicable sequence types:
1. **Normal execution path** — Happy path from trigger to completion
2. **Error/failure path** — What happens when a step returns E_NOT_OK or fails
3. **Initialization sequence** — Module_Init calls and their dependency order
4. **Callback/notification path** — Async notifications (TxConfirmation, RxIndication)
5. **MainFunction/periodic path** — Cyclic processing driving state machines
6. **Configuration dependency** — How *_Cfg.h/*_PBcfg.c parameters affect behavior

## Analysis Depth Requirements
- For EACH execution sequence step: verify return value is checked by caller
- At EACH module boundary: check parameter validation, null pointer check, state check
- For state machines: verify no dead-end states, check timeout handling, check ISR vs task race
- Cross-reference configuration files with runtime code: do PDU IDs match? Are buffer sizes sufficient? Are callbacks registered?
- Check initialization order: is every module initialized before first use?
- Check concurrency: are SchM_Enter/Exit used around shared resources?

## Quality Rules
- Only flag suspects SUPPORTED by source code evidence — cite file, line, and what the code does
- Every "reason" must explain the MECHANISM: what code does what, and why it causes the bug
- Every "suggestedAction" must be specific enough for a developer to implement directly
- testChecklist items must reference real symbols, specific inputs, and expected outcomes
- Use actual file paths and line numbers from evidence — NEVER invent them
Do NOT use LaTeX or math notation. Use plain text only.`;
}
