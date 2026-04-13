// ============ Agent Configuration ============
// Centralized config for easy tuning. All limits in one place.

export const AGENT_CONFIG = {
  /** Hard ceiling — never exceed this regardless of LLM estimate */
  absoluteMaxIterations: 8,

  /** Default turn budgets per query type when LLM doesn't provide an estimate */
  defaultIterations: {
    search: 3,
    bug_analysis: 5,
    impact: 6,
  } as Record<string, number>,

  /** Max evidence tokens for summarization (chars = tokens * 4) */
  maxEvidenceTokens: 12000,

  /** Max chars per tool result when building conversation messages */
  toolResultTruncateChars: 4000,

  /** Max chars per evidence entry in summarizeEvidence */
  evidencePerEntryChars: 4000,

  /** Total conversation size before compaction kicks in */
  maxConversationChars: 100000,

  /** Chars kept per compacted turn summary */
  compactTurnPreviewChars: 300,

  /** Max chars for agentPlan prompt (system + user) */
  maxPromptChars: 16000,

  /** How many lines to auto-read from source files discovered in graph results */
  autoReadEndLine: 200,

  /** Default lines to read when LLM calls read_file without specifying endLine */
  readFileDefaultLines: 150,

  /** Max source files to auto-read per iteration */
  maxAutoReadsPerIteration: 3,

  /** Auto-read only in the first N turns of bug_analysis */
  autoReadMaxTurn: 2,
};
