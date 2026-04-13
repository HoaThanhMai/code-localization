// ============ Narrative Answer Prompts ============
// Used in QueryEngine.generateNarrativeAnswer() — two variants based on queryType.

export function buildNarrativeAnswerPrompt(params: {
  query: string;
  queryType: string;
  seqSummary: string;
  symSummary: string;
  evidenceSummary: string;
}): string {
  const { query, queryType, seqSummary, symSummary, evidenceSummary } = params;

  if (queryType === 'bug_analysis') {
    return buildBugAnalysisNarrativePrompt(query, seqSummary, symSummary, evidenceSummary);
  }
  return buildSearchNarrativePrompt(query, seqSummary, symSummary, evidenceSummary);
}

function buildBugAnalysisNarrativePrompt(
  query: string,
  seqSummary: string,
  symSummary: string,
  evidenceSummary: string
): string {
  return `You are an AUTOSAR expert. The user reported a bug/issue. Based on ALL evidence, write a clear analysis in Vietnamese or the language of the query.

## Bug Report
"${query}"

## Discovered Execution Sequences
${seqSummary || 'None found'}

## Key Symbols Found
${symSummary || 'None found'}

## All Evidence
${evidenceSummary}

## Instructions
Write a comprehensive bug analysis answer:
1. **Tóm tắt vấn đề**: Briefly restate what the user is looking for
2. **Phân tích luồng thực thi**: For each execution sequence found, explain step-by-step what happens and where the bug could occur. Reference specific files, functions, and line numbers.
3. **Khoanh vùng nguyên nhân**: Pinpoint the most likely code areas causing the bug, explain WHY based on the execution flow evidence
4. **Giải thích chi tiết**: For each suspect area, explain the mechanism (e.g., "In sequence X, step 3 calls Y() at file.c:123 which does not check return value, causing Z")
5. **Đề xuất hướng xử lý**: Concrete suggestions

Format as readable text with markdown. Reference actual file paths and line numbers from evidence. Do NOT output JSON.
Do NOT use LaTeX or math notation (e.g. $x$, \text{}, \frac{}). Use plain text only.`;
}

function buildSearchNarrativePrompt(
  query: string,
  seqSummary: string,
  symSummary: string,
  evidenceSummary: string
): string {
  return `You are an AUTOSAR expert. Based on ALL evidence gathered, write a clear and comprehensive answer to the user's query in Vietnamese or the language of the query.

## User Query
"${query}"

## Discovered Execution Sequences
${seqSummary || 'None found'}

## Key Symbols Found
${symSummary || 'None found'}

## All Evidence
${evidenceSummary}

## Instructions
Write a comprehensive answer:
1. **Tóm tắt**: Briefly explain what was found in relation to the query
2. **Giải thích từng kết quả**: For each execution sequence, explain what it does, the flow of execution step-by-step, and why it's relevant to the query. Reference specific functions, files, and line numbers.
3. **Các symbol quan trọng**: Explain each key symbol — what it does, where it sits in the architecture, and its role in the execution flow
4. **Mối liên hệ giữa các thành phần**: How the found code pieces relate to each other (caller/callee, data flow, module boundaries)
5. **Tổng kết**: Summary and any additional insights

Format as readable text with markdown. Reference actual file paths and line numbers from evidence. Do NOT output JSON.
Do NOT use LaTeX or math notation (e.g. $x$, \\text{}, \\frac{}). Use plain text only.`;
}
