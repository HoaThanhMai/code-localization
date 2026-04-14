// ============ Synthesis Prompt ============
// Used in QueryEngine.agentSynthesize() to combine all evidence into structured results.

export function buildSynthesizePrompt(params: {
  query: string;
  queryType: string;
  reasoningTrace: string;
  evidenceSummary: string;
}): string {
  const { query, queryType, reasoningTrace, evidenceSummary } = params;

  return `You are an AUTOSAR expert synthesizing code search results into a comprehensive structured answer. Your synthesis must be thorough — capture ALL execution sequences discovered, not just the primary one.

## User Query
"${query}" (type: ${queryType})

## Agent Reasoning Trace
${reasoningTrace}

## All Evidence
${evidenceSummary}

## Task
Synthesize ALL evidence into a complete picture. You MUST capture every execution sequence that was traced during investigation.

{
  "sequences": [
    {
      "name": "Specific descriptive name (e.g., 'CAN TX Path: SwcCan → Com → PduR → CanIf → Can')",
      "priority": 1,
      "processType": "within_community|cross_community",
      "communities": ["ModuleA", "ModuleB"],
      "confidence": 0.95,
      "steps": [
        { "symbol": "func_name", "filePath": "/path/to/file.c", "line": 123, "stepIndex": 0, "description": "What this step does, return value handling, and potential issues" }
      ]
    }
  ],
  "symbols": [
    { "symbolName": "func_name", "filePath": "/path/to/file.c", "line": 123, "score": 0.9, "snippet": "actual code context from evidence", "providerSource": "gitnexus" }
  ],
  "clusters": [
    { "name": "Related Module", "cohesion": 0.8, "symbols": ["sym1", "sym2"] }
  ]
}

## Sequence Identification Rules
You MUST identify ALL of these sequence types (when applicable to the query):
1. **Normal execution path** — Happy path from trigger to completion
2. **Error/failure path** — What happens when a step returns E_NOT_OK
3. **Initialization sequence** — Module_Init calls and dependency order
4. **Callback/notification path** — TxConfirmation, RxIndication, etc.
5. **MainFunction/periodic path** — Cyclic processing driving state machines
6. **Configuration dependency** — How *_Cfg.h/*_PBcfg.c affect runtime

## Quality Rules
1. Execution sequences must show REAL execution flow from evidence (NEVER invented)
2. Steps MUST use actual file paths and line numbers from evidence
3. Each step description should note: what happens, return value produced, error handling
4. Symbols ranked by relevance, with snippets from actual code evidence
5. AUTOSAR lifecycle patterns: Init → MainFunction → Callback → Indication
6. Cross-community (cross-module) flows are HIGHER priority than within-community
7. Confidence based on source code evidence: read_file evidence > graph-only evidence
8. Include ALL sequences found, even low-confidence ones — completeness over brevity

Return ONLY the JSON.`;
}
