// ============ Tool Assessment Prompt ============
// Used in QueryEngine.assessToolResults() to evaluate each tool call result.

export function buildAssessToolResultsPrompt(
  query: string,
  callSummaries: string
): string {
  return `You are analyzing code search tool results for the query: "${query}"

${callSummaries}

For EACH tool call, write a brief but insightful assessment (3-5 sentences) in Vietnamese or the language of the query:
- **What was found?** Key symbols, files, relationships, execution flows discovered
- **How relevant is it?** Directly related, supporting context, or tangential to the query
- **Suspect indicators?** Any red flags: missing return value checks, unprotected shared data, missing null checks, state machine gaps, config mismatches
- **What to investigate next?** Based on this result, what specific file/function should be read or traced further?

Focus on identifying ACTIONABLE leads for the next investigation step. Highlight any source code evidence that confirms or contradicts the bug hypothesis.

Return JSON array of strings, one assessment per tool call:
["Assessment for tool call 1", "Assessment for tool call 2", ...]

Return ONLY the JSON array.`;
}
