// ============ Inline Agent Prompt ============
// Used for multi-turn conversation agent loop.
// The LLM either returns tool calls (to investigate) or final analysis (when done).
// This unifies planning + synthesis + analysis in one continuous conversation.

export function buildInlineAgentPrompt(params: {
  query: string;
  queryType: string;
  evidenceSummary: string;
  maxTurns: number;
}): string {
  const { query, queryType, evidenceSummary, maxTurns } = params;

  const isBug = queryType === 'bug_analysis';

  return `## Query
"${query}"
Type: ${queryType}

## Initial Evidence (from knowledge graph search)
${evidenceSummary}

## Available Tools
1. **query** — Search knowledge graph: \`{ "query": "search text" }\`
2. **context** — 360° view of a symbol: \`{ "name": "symbolName" }\`
3. **impact** — Blast radius: \`{ "target": "symbolName", "direction": "upstream|downstream|both" }\`
4. **cypher** — Custom graph query: \`{ "query": "MATCH ..." }\`
5. **detect_changes** — Git changes: \`{ "scope": "all|staged|unstaged" }\`
6. **read_file** — Read source code: \`{ "filePath": "path/to/file.c", "startLine": 1, "endLine": 60 }\`

## Investigation Methodology
Follow this systematic approach to ensure thorough analysis:

### Phase 1: Discovery — Map ALL related sequences
- Use **query** with MULTIPLE different search terms to find all related execution paths
- Don't stop at the first result — search for TX path, RX path, error path, callback path, init sequence${isBug ? `
- For bugs: also search for the error handling path, the periodic MainFunction path, and the configuration validation path` : ''}

### Phase 2: Build Call Chains — Trace end-to-end
- Use **context** on key symbols to see callers/callees and build complete call chains
- Trace from SWC → RTE → Service → ECUAL → MCAL (or reverse direction)
- Check cross-module boundaries — this is where bugs often hide

### Phase 3: Source Code Verification — Read EVERY suspect
- Use **read_file** to read the actual implementation of every suspect function (60-100 lines)${isBug ? `
- For bug analysis: this is NON-NEGOTIABLE. The graph tells WHERE to look — source code reveals the actual bug
- Check: return value propagation, null checks, state validation, error handling branches
- Also read configuration files (*_Cfg.h, *_PBcfg.c) to cross-reference with runtime code` : ''}
- If you find something suspicious, read the CALLER and CALLEE too

### Phase 4: Impact Assessment
- Use **impact** (direction "both") on critical symbols to find all affected modules
- Verify that the blast radius is consistent with the observed symptoms

## Response Format

**To investigate further** (you need more data):
\`\`\`json
{
  "reasoning": "What I know so far, what gaps remain, and what I expect to learn next",
  "toolCalls": [
    { "tool": "context", "args": { "name": "Can_Write" }, "reason": "Check callers to build TX call chain" },
    { "tool": "read_file", "args": { "filePath": "src/mcal/Can/Can.c", "startLine": 50, "endLine": 130 }, "reason": "Read Can_Write implementation — check error handling and return value" }
  ],
  "done": false
}
\`\`\`

**To produce final analysis** (you have enough evidence AND have read source code for all suspects):
\`\`\`json
{
  "reasoning": "Summary of investigation: (1) traced N sequences, (2) read source code for M suspect functions, (3) verified configuration in K files. Conclusions...",
  "done": true,
  "sequences": [
    {
      "name": "Execution flow name — be specific (e.g., 'CAN TX: SwcCan → Com → PduR → CanIf → Can')",
      "priority": 1,
      "processType": "within_community|cross_community",
      "communities": ["ModuleA", "ModuleB"],
      "confidence": 0.9,
      "steps": [
        { "symbol": "func_name", "filePath": "path/file.c", "line": 123, "stepIndex": 0, "description": "What this step does and what to watch for" }
      ]
    }
  ],
  "symbols": [
    { "symbolName": "func_name", "filePath": "path/file.c", "line": 123, "score": 0.9, "snippet": "context from actual source code", "providerSource": "gitnexus" }
  ],
  "clusters": [
    { "name": "Module group", "cohesion": 0.8, "symbols": ["sym1", "sym2"] }
  ]${isBug ? `,
  "suspectPoints": [
    {
      "severity": "high|medium|low",
      "symbol": "function_name",
      "filePath": "path/file.c",
      "line": 123,
      "reason": "MUST cite specific source code evidence: 'At line X, the function does Y which causes Z because...'",
      "category": "error_handling|state_machine|config|return_value|timing|concurrency|boundary_check",
      "suggestedAction": "Specific fix with code reference (e.g., 'Add return value check after Can_Write() call at line 85')"
    }
  ],
  "suggestions": [
    { "severity": "HIGH", "text": "Investigation suggestion with specific file and function reference", "filePath": "path/file.c", "line": 123 }
  ],
  "testChecklist": ["Specific test case: 'Call X() with parameter Y=NULL and verify DET error reported'"]` : ''}
}
\`\`\`

## Sequence Tracing Checklist
When you set "done": true, verify you have traced ALL applicable sequence types:
1. **Normal path** — Happy path from trigger to completion
2. **Error path** — What happens when any step returns E_NOT_OK or fails
3. **Init sequence** — Module initialization order and dependencies
4. **Callback path** — Async notifications (TxConfirmation, RxIndication, etc.)
5. **MainFunction path** — Periodic processing that drives state machines
6. **Config path** — How *_Cfg.h / *_PBcfg.c parameters affect behavior

## Turn Budget
This is turn 1 of up to ${maxTurns}. Based on the query complexity and initial evidence, estimate how many turns you'll actually need:
- Simple lookup / single symbol → 1-2
- Multi-symbol search / moderate complexity → 2-3
- Complex bug analysis / cross-module tracing → 4-6
- Deep architectural investigation / multi-sequence tracing → 6-8
${isBug ? 'For bug_analysis, prefer MORE turns to ensure thorough source code verification.' : ''}
Include **"estimatedTurns"** in your first response.

## Rules
- NEVER set "done": true without having read source code for suspect functions (for bug_analysis)
- NEVER repeat a tool call with identical arguments.
- Use MULTIPLE different query strings to discover all related sequences.
- Only flag suspects SUPPORTED by source code evidence — cite file path, line number, and what the code does.
- Do NOT use LaTeX. Use plain text only.`;
}

/**
 * Prompt appended to tool results to tell the LLM this is the final turn.
 */
export function buildFinalTurnInstruction(queryType: string): string {
  const isBug = queryType === 'bug_analysis';
  return `\n\n**⚠️ FINAL TURN — produce your complete analysis now.**
Set "done": true and include: sequences, symbols, clusters${isBug ? ', suspectPoints, suggestions, testChecklist' : ''}.
Base your analysis on ALL evidence gathered across the conversation.
${isBug ? `
CRITICAL CHECKLIST before finalizing:
- Have you traced ALL relevant execution sequences (normal path, error path, init, callback, MainFunction)?
- Have you read source code for EVERY suspect function? If not, include read_file calls NOW.
- For each suspectPoint, does the "reason" field cite specific source code evidence (file, line, what the code does)?
- Are suggestedActions concrete and actionable (not vague "check this")?
` : ''}Return ONLY the JSON.`;
}
