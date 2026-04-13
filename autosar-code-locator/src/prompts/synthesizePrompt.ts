// ============ Synthesis Prompt ============
// Used in QueryEngine.agentSynthesize() to combine all evidence into structured results.

export function buildSynthesizePrompt(params: {
  query: string;
  queryType: string;
  reasoningTrace: string;
  evidenceSummary: string;
}): string {
  const { query, queryType, reasoningTrace, evidenceSummary } = params;

  return `You are an AUTOSAR expert synthesizing code search results into a structured answer.

## User Query
"${query}" (type: ${queryType})

## Agent Reasoning Trace
${reasoningTrace}

## All Evidence
${evidenceSummary}

## Task
Synthesize ALL evidence into:
{
  "sequences": [
    {
      "name": "Descriptive name of execution flow",
      "priority": 1,
      "processType": "within_community|cross_community",
      "communities": ["ModuleA", "ModuleB"],
      "confidence": 0.95,
      "steps": [
        { "symbol": "func_name", "filePath": "/path/to/file.c", "line": 123, "stepIndex": 0, "description": "What this step does" }
      ]
    }
  ],
  "symbols": [
    { "symbolName": "func_name", "filePath": "/path/to/file.c", "line": 123, "score": 0.9, "snippet": "brief context", "providerSource": "gitnexus" }
  ],
  "clusters": [
    { "name": "Related Module", "cohesion": 0.8, "symbols": ["sym1", "sym2"] }
  ]
}

Rules:
1. Execution sequences must show REAL execution flow from evidence (not invented)
2. Steps MUST use actual file paths and line numbers from evidence
3. Symbols ranked by relevance to the query, using context/impact data for scoring
4. AUTOSAR patterns: Init → MainFunction → Callback → Indication
5. Cross-community flows are higher priority than within-community
6. Include confidence based on how much evidence supports each sequence

Return ONLY the JSON.`;
}
