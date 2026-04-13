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

## Strategy
- Use **query/context/impact** to NAVIGATE: find relevant symbols, execution flows, dependencies.
- Use **read_file** to ANALYZE: once you know which file to examine, read the actual source code.${isBug ? `
- For bug analysis: ALWAYS read_file on suspect files. The graph tells WHERE to look — source code reveals the actual bug.` : ''}
- Be efficient: pick the most relevant symbols, don't exhaustively explore everything.

## Response Format

**To investigate further** (you need more data):
\`\`\`json
{
  "reasoning": "What I know so far and what I need to find next",
  "toolCalls": [
    { "tool": "context", "args": { "name": "Can_Write" }, "reason": "Check callers" },
    { "tool": "read_file", "args": { "filePath": "src/mcal/Can/Can.c", "startLine": 50, "endLine": 110 }, "reason": "Check error handling" }
  ],
  "done": false
}
\`\`\`

**To produce final analysis** (you have enough evidence):
\`\`\`json
{
  "reasoning": "Summary of investigation and conclusions",
  "done": true,
  "sequences": [
    {
      "name": "Execution flow name",
      "priority": 1,
      "processType": "within_community",
      "communities": ["ModuleA", "ModuleB"],
      "confidence": 0.9,
      "steps": [
        { "symbol": "func_name", "filePath": "path/file.c", "line": 123, "stepIndex": 0, "description": "What this step does" }
      ]
    }
  ],
  "symbols": [
    { "symbolName": "func_name", "filePath": "path/file.c", "line": 123, "score": 0.9, "snippet": "context", "providerSource": "gitnexus" }
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
      "reason": "Why suspicious — cite evidence and source code",
      "category": "error_handling|state_machine|config|return_value|timing|concurrency|boundary_check",
      "suggestedAction": "Specific fix/verification action"
    }
  ],
  "suggestions": [
    { "severity": "HIGH", "text": "Investigation suggestion", "filePath": "path/file.c", "line": 123 }
  ],
  "testChecklist": ["Specific test case referencing real symbols and files"]` : ''}
}
\`\`\`

## Turn Budget
This is turn 1 of up to ${maxTurns}. Based on the query complexity and initial evidence, estimate how many turns you'll actually need:
- Simple lookup / single symbol → 1-2
- Multi-symbol search / moderate complexity → 2-3
- Complex bug analysis / cross-module tracing → 3-5
- Deep architectural investigation → 5-8
Include **"estimatedTurns"** in your first response.

## Rules
- Use your turns wisely. If initial evidence already answers the query, set "done": true immediately.
- NEVER repeat a tool call with identical arguments.
- Only flag suspects SUPPORTED by evidence. Use actual file paths and line numbers.
- Do NOT use LaTeX. Use plain text only.`;
}

/**
 * Prompt appended to tool results to tell the LLM this is the final turn.
 */
export function buildFinalTurnInstruction(queryType: string): string {
  const isBug = queryType === 'bug_analysis';
  return `\n\n**⚠️ FINAL TURN — produce your complete analysis now.**
Set "done": true and include: sequences, symbols, clusters${isBug ? ', suspectPoints, suggestions, testChecklist' : ''}.
Base your analysis on ALL evidence gathered across the conversation.`;
}
