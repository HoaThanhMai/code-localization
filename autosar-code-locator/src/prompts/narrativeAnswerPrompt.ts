// ============ Narrative Answer Prompts ============
// Used in QueryEngine.generateNarrativeAnswer() — two variants based on queryType.

export function buildNarrativeAnswerPrompt(params: {
  query: string;
  queryType: string;
  seqSummary: string;
  symSummary: string;
  evidenceSummary: string;
  agentConclusions?: string;
}): string {
  const { query, queryType, seqSummary, symSummary, evidenceSummary, agentConclusions } = params;

  if (queryType === 'bug_analysis') {
    return buildBugAnalysisNarrativePrompt(query, seqSummary, symSummary, evidenceSummary, agentConclusions ?? '');
  }
  return buildSearchNarrativePrompt(query, seqSummary, symSummary, evidenceSummary, agentConclusions ?? '');
}

function buildBugAnalysisNarrativePrompt(
  query: string,
  seqSummary: string,
  symSummary: string,
  evidenceSummary: string,
  agentConclusions: string,
): string {
  return `You are an AUTOSAR expert performing forensic bug analysis. The user reported a bug/issue. Based on ALL evidence (especially source code evidence), write an exhaustive analysis in Vietnamese or the language of the query.

## Bug Report
"${query}"

## Agent's Investigation Conclusions
${agentConclusions || 'Not available — derive conclusions from evidence below'}

## Discovered Execution Sequences
${seqSummary || 'None found'}

## Key Symbols Found
${symSummary || 'None found'}

## All Evidence
${evidenceSummary}

## Instructions
Write a THOROUGH bug analysis answer that traces ALL sequences and cites source code evidence:

1. **Tóm tắt vấn đề**: Briefly restate the bug/issue and its expected vs actual behavior

2. **Bản đồ luồng thực thi**: List ALL execution sequences discovered:
   - Normal path (happy path from trigger to completion)
   - Error path (what happens when a step fails)
   - Callback path (async notifications)
   - Init sequence (module startup order)
   - MainFunction path (periodic processing)
   For EACH sequence, explain step-by-step what happens. At EACH step, note:
   - Which function calls which (with file:line references)
   - Whether the return value is checked
   - What happens if this step fails

3. **Khoanh vùng nguyên nhân gốc**: Pinpoint the SPECIFIC code areas causing the bug:
   - Cite exact file path and line number
   - Quote or describe what the source code actually does at that line
   - Explain the MECHANISM: why this code causes the observed bug
   - Example: "Tại file CanIf.c dòng 145, hàm CanIf_Transmit() gọi Can_Write() nhưng KHÔNG kiểm tra giá trị trả về. Nếu Can_Write() trả về CAN_BUSY, request TX sẽ bị mất hoàn toàn mà không có retry hoặc báo lỗi."

4. **Phân tích chéo (Cross-reference analysis)**:
   - Configuration vs Runtime: Do config parameters (*_Cfg.h, *_PBcfg.c) match expectations?
   - Init order: Are modules initialized before first use?
   - Concurrency: Are shared resources protected by SchM_Enter/Exit?
   - State machines: Any dead-end states or missing timeouts?

5. **Đề xuất hướng xử lý**: For EACH suspect point, provide:
   - Specific code change needed (which file, which line, what to add/modify)
   - Why this change fixes the root cause
   - Any regression risks of the change

6. **Các điểm cần kiểm tra thêm**: List any areas that need further investigation with specific file/function references

Format as readable text with markdown. Reference actual file paths and line numbers from evidence throughout. Do NOT output JSON.
Do NOT use LaTeX or math notation (e.g. $x$, \\text{}, \\frac{}). Use plain text only.

## Markdown Formatting Rules (CRITICAL — follow exactly)

**Lists:**
- ALWAYS place a blank line before the FIRST item of any list and after the LAST item.
- If a bullet point ends with ":", the sub-list MUST be on new lines each preceded by that blank line, NOT directly after the colon on the same or next line without spacing.
- Nested list items must be indented with exactly 2 spaces per level (e.g. "  - child item").
- Do NOT mix bullet styles: use "-" consistently; never use "•" (bullet character).

**Sub-section headers:**
- Use markdown headings (###, ####) for named sub-sections such as "A. Init sequence", "B. MainFunction path". Write them as: "### A. Init sequence", NOT as a plain bold or plain text line.
- Every heading must be preceded and followed by a blank line.

**Separators:**
- Do NOT use "---" as a section separator. Use a heading instead.

**Code blocks:**
- Always place a blank line before and after a fenced code block (${ '```' }c ... ${ '```' }).

**Links:**
- When referencing files, use markdown links: [src/app/EcuM.c](src/app/EcuM.c#L16-L29).

**General:**
- Do NOT use inline HTML or angle-bracket tags.
- Keep lines under ~120 chars.

Return the narrative as plain markdown text only.`;
}

function buildSearchNarrativePrompt(
  query: string,
  seqSummary: string,
  symSummary: string,
  evidenceSummary: string,
  agentConclusions: string,
): string {
  return `You are an AUTOSAR expert. Based on ALL evidence gathered, write a clear and comprehensive answer to the user's query in Vietnamese or the language of the query.

## User Query
"${query}"

## Agent's Summary
${agentConclusions || 'Not available — derive summary from evidence below'}

## Discovered Execution Sequences
${seqSummary || 'None found'}

## Key Symbols Found
${symSummary || 'None found'}

## All Evidence
${evidenceSummary}

## Instructions
Write a comprehensive answer that traces ALL discovered sequences:

1. **Tóm tắt**: Briefly explain what was found in relation to the query

2. **Giải thích từng luồng thực thi**: For EACH execution sequence:
   - Explain the complete flow step-by-step
   - At each step, reference the specific function, file, and line number
   - Explain what each function does (based on source code evidence if available)
   - Note module boundaries: where control passes from one module to another
   - Highlight any interesting patterns (error handling, state checks, callbacks)

3. **Các symbol quan trọng**: For each key symbol:
   - What it does (based on source code, not just name)
   - Where it sits in the AUTOSAR architecture (MCAL/ECUAL/BSW/RTE/SWC)
   - Who calls it and what it calls
   - Its role in the execution flow

4. **Mối liên hệ giữa các thành phần**: Architecture view:
   - Caller/callee relationships across modules
   - Data flow: how data moves through the stack
   - Configuration dependencies: which config files control which behavior
   - Module boundaries and their interfaces

5. **Tổng kết**: Summary, additional insights, and areas worth investigating further

Format as readable text with markdown. Reference actual file paths and line numbers from evidence throughout. Do NOT output JSON.
Do NOT use LaTeX or math notation (e.g. $x$, \\text{}, \\frac{}). Use plain text only.

## Markdown Formatting Rules (CRITICAL — follow exactly)

**Lists:**
- ALWAYS place a blank line before the FIRST item of any list and after the LAST item.
- If a bullet point ends with ":", the sub-list MUST be on new lines each preceded by that blank line, NOT directly after the colon on the same or next line without spacing.
- Nested list items must be indented with exactly 2 spaces per level (e.g. "  - child item").
- Do NOT mix bullet styles: use "-" consistently; never use "•" (bullet character).

**Sub-section headers:**
- Use markdown headings (###, ####) for named sub-sections such as "A. Init sequence", "B. MainFunction path". Write them as: "### A. Init sequence", NOT as a plain bold or plain text line.
- Every heading must be preceded and followed by a blank line.

**Separators:**
- Do NOT use "---" as a section separator. Use a heading instead.

**Code blocks:**
- Always place a blank line before and after a fenced code block (${ '```' }c ... ${ '```' }).

**Links:**
- When referencing files, use markdown links: [src/app/EcuM.c](src/app/EcuM.c#L16-L29).

**General:**
- Do NOT use inline HTML or angle-bracket tags.
- Keep lines under ~120 chars.

Return the narrative as plain markdown text only.`;
}
