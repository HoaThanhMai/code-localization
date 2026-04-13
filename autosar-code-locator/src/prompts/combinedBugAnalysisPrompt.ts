// ============ Combined Bug Analysis Prompt ============
// Merges Phase 3 (synthesis) + Phase 4 (bug analysis + narrative) into a single LLM call
// to reduce latency from 3 sequential calls to 1.

export function buildCombinedBugAnalysisPrompt(params: {
  query: string;
  reasoningTrace: string;
  evidenceSummary: string;
}): string {
  const { query, reasoningTrace, evidenceSummary } = params;

  return `You are an expert embedded software engineer analyzing a bug report. Based on ALL evidence, produce a comprehensive analysis.

## Bug Report
"${query}"

## Agent Reasoning Trace
${reasoningTrace}

## All Evidence
${evidenceSummary}

## Task
Produce a SINGLE JSON response with ALL of the following sections:

{
  "sequences": [
    {
      "name": "Descriptive name of execution flow",
      "priority": 1,
      "processType": "within_community",
      "communities": ["ModuleA", "ModuleB"],
      "confidence": 0.95,
      "steps": [
        { "symbol": "func_name", "filePath": "path/to/file.c", "line": 123, "stepIndex": 0, "description": "What this step does" }
      ]
    }
  ],
  "symbols": [
    { "symbolName": "func_name", "filePath": "path/to/file.c", "line": 123, "score": 0.9, "snippet": "brief context", "providerSource": "gitnexus" }
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
      "reason": "why suspicious — reference specific evidence and source code",
      "category": "error_handling|state_machine|config|return_value|timing|concurrency|boundary_check",
      "suggestedAction": "specific action to verify/fix"
    }
  ],
  "suggestions": [
    { "severity": "HIGH|MEDIUM|LOW", "text": "investigation suggestion", "filePath": "path/file.c", "line": 123 }
  ],
  "testChecklist": ["Specific test item referencing real symbols and files"]
}

## Analysis Guidelines
- Prioritize error handling gaps and state machine issues
- Check if return values are propagated correctly
- Look for configuration vs runtime mismatches
- Consider concurrency issues (missing critical sections, race conditions)
- Check null pointer handling at API boundaries
- The "answer" field should be a complete narrative — this is what the user reads
- Only flag suspects SUPPORTED by evidence. Reference actual source code when available.
- Use actual file paths and line numbers from evidence.
Do NOT use LaTeX or math notation. Use plain text only.`;
}
