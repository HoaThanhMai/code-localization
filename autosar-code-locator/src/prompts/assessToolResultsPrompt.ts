// ============ Tool Assessment Prompt ============
// Used in QueryEngine.assessToolResults() to evaluate each tool call result.

export function buildAssessToolResultsPrompt(
  query: string,
  callSummaries: string
): string {
  return `You are analyzing code search tool results for the query: "${query}"

${callSummaries}

For EACH tool call, write a brief assessment (2-4 sentences) in Vietnamese or the language of the query:
- What was found? (key symbols, files, relationships)
- How relevant is it to the query?
- What are the key takeaways?

Return JSON array of strings, one assessment per tool call:
["Assessment for tool call 1", "Assessment for tool call 2", ...]

Return ONLY the JSON array.`;
}
