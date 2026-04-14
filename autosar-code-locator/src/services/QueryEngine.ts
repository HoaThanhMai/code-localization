import { GitNexusService } from './GitNexusService';
import { CopilotLMService } from './CopilotLMService';
import {
  ExecutionSequence,
  SymbolContext360,
  BlastRadiusInfo,
  CodeLocation,
} from '../providers/IIndexProvider';
import {
  AGENT_SYSTEM_PROMPT,
  AUTOSAR_BUG_ANALYSIS_PROMPT,
  buildAgentPlanPrompt,
  buildSynthesizePrompt,
  buildNarrativeAnswerPrompt,
  buildCombinedBugAnalysisPrompt,
  buildDeepInvestigationPrompt,
  buildTestChecklistPrompt,
  buildInlineAgentPrompt,
  buildFinalTurnInstruction,
} from '../prompts';
import { AGENT_CONFIG } from '../config';
import * as fs from 'fs';
import * as path from 'path';

// ============ Types ============

export interface SymbolResult {
  symbolName: string;
  filePath: string;
  line: number;
  score: number;
  snippet?: string;
  providerSource: string;
}

export interface ClusterInfo {
  name: string;
  cohesion: number;
  symbols: string[];
}

export interface SuspectPoint {
  severity: 'high' | 'medium' | 'low';
  symbol: string;
  filePath: string;
  line: number;
  reason: string;
  category:
    | 'error_handling'
    | 'state_machine'
    | 'config'
    | 'return_value'
    | 'timing'
    | 'concurrency'
    | 'boundary_check';
  suggestedAction: string;
  additionalContext?: unknown;
}

export interface InvestigationSuggestion {
  severity?: string;
  text?: string;
  description?: string;
  filePath?: string;
  line?: number;
}

export interface InvestigationReport {
  executionPath: ExecutionSequence;
  suspectPoints: SuspectPoint[];
  suggestions: InvestigationSuggestion[];
  blastRadius: BlastRadiusInfo;
  testChecklist: string[];
  summary?: string;
}

export interface SearchResult {
  query: string;
  type: 'search' | 'bug_analysis' | 'impact';
  sequences: ExecutionSequence[];
  symbols: SymbolResult[];
  clusters: ClusterInfo[];
  answer?: string;
  investigation?: InvestigationReport;
  agentTrace?: AgentStep[];
  metadata: {
    durationMs: number;
    model: string;
    providersUsed: string[];
  };
}

interface ProgressCallback {
  onProgress?: (phase: string, detail?: string) => void;
  /** Called for each token chunk during narrative answer generation (streaming). */
  onAnswerChunk?: (chunk: string) => void;
}

interface BatchCallbacks {
  onProgress?: (completed: number, total: number, currentQuery: string) => void;
  onComplete?: (results: SearchResult[]) => void;
}

// ============ Agent Types ============

/** A single tool call the agent decided to make */
interface ToolCall {
  tool: 'query' | 'context' | 'impact' | 'cypher' | 'detect_changes' | 'read_file';
  args: Record<string, unknown>;
  reason: string;
}

/** The agent's plan for the current iteration */
interface AgentPlan {
  reasoning: string;
  toolCalls: ToolCall[];
  done: boolean;
  synthesis?: string;
  /** LLM's estimate of how many iterations this query needs (only in iteration 1) */
  estimatedIterations?: number;
}

/** One step in the agent's execution trace */
export interface AgentStep {
  iteration: number;
  reasoning: string;
  toolCalls: Array<{
    tool: string;
    args: Record<string, unknown>;
    reason: string;
    result: unknown;
    assessment?: string;
  }>;
}

// ============ QueryEngine ============

const { absoluteMaxIterations: ABSOLUTE_MAX_ITERATIONS, defaultIterations: DEFAULT_ITERATIONS } = AGENT_CONFIG;

export class QueryEngine {
  private lastResults: SearchResult | null = null;
  private batchQueue: Array<{ id: number; description: string; queryType: string; status: string }> = [];

  constructor(
    private gitnexus: GitNexusService,
    private copilot: CopilotLMService
  ) {}

  // ============ Dynamic Limits (per-model context window) ============

  /**
   * Computes conversation/evidence size limits based on the currently selected model's
   * real context window (from vscode.LanguageModelChat.maxInputTokens).
   *
   * Examples at model selection time:
   *   claude-sonnet-4.x  → 160 000 tokens → usableChars ~392 000
   *   gpt-4o             → 128 000 tokens → usableChars ~313 600
   *   gpt-4-turbo        →  32 000 tokens → usableChars  ~78 400
   */
  private getDynamicLimits() {
    const ctxTokens = this.copilot.getModelContextWindow();
    const charsPerToken = 3.5; // conservative for mixed C code + English text
    const usableChars = Math.floor(ctxTokens * charsPerToken * 0.70); // 70% usable; rest for output + overhead
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
    return {
      /** Total conversation size before compaction kicks in */
      maxConversationChars: clamp(usableChars, 60_000, 600_000),
      /** Evidence summary passed to LLM prompts */
      maxEvidenceChars: clamp(Math.floor(usableChars * 0.50), 30_000, 250_000),
      /** Per tool result in conversation messages */
      toolResultTruncateChars: clamp(Math.floor(usableChars / 30), 2_000, 20_000),
      /** Per entry in summarizeEvidence() */
      evidencePerEntryChars: clamp(Math.floor(usableChars / 20), 2_000, 20_000),
      /** Chars kept per compacted turn summary */
      compactPreviewChars: clamp(Math.floor(usableChars / 100), 500, 4_000),
    };
  }

  // ============ Main Agent Loop (Inline Multi-Turn) ============

  async search(
    query: string,
    queryType: string,
    callbacks: ProgressCallback = {}
  ): Promise<SearchResult> {
    const startTime = Date.now();
    const evidence: Record<string, unknown> = {};

    // --- Phase 1: Initial broad search + auto-read source files ---
    callbacks.onProgress?.('Phase 1: Searching knowledge graph...');
    const searchRaw = await this.safeCallTool('query', { query });
    evidence['initial_search'] = searchRaw;

    // Auto-read source files from graph results so LLM has code from turn 1
    const autoFiles = this.extractFilePathsFromEvidence(
      [{ tool: 'query', args: { query }, result: searchRaw }],
      evidence
    );
    if (autoFiles.length > 0) {
      callbacks.onProgress?.(`Phase 1: Auto-reading ${autoFiles.length} source file(s)...`);
      const autoReads = await Promise.all(
        autoFiles.map(async (af) => {
          const result = await this.safeCallTool('read_file', { filePath: af.filePath, startLine: af.startLine, endLine: af.endLine });
          return { filePath: af.filePath, result };
        })
      );
      for (const r of autoReads) {
        const key = `read_file_${r.filePath.replace(/\//g, '_')}`.slice(0, 80);
        evidence[key] = r.result;
      }
    }

    // --- Phase 2: Inline agent investigation ---
    callbacks.onProgress?.('Phase 2: Agent investigation...');
    const { inlineAnalysis, trace, agentFinalReasoning } = await this.runInlineAgentLoop({
      query, queryType, evidence, callbacks,
    });

    // --- Phase 3: Narrative answer (parallel with final turn or post-hoc) ---
    let synthesized: { sequences: ExecutionSequence[]; symbols: SymbolResult[]; clusters: ClusterInfo[]; answer: string };
    let investigation: InvestigationReport | undefined;

    const finalEvidenceSummary = this.summarizeEvidence(evidence);
    const reasoningTrace = trace.map((s) =>
      `Turn ${s.iteration}: ${s.reasoning} → called ${s.toolCalls.map((tc) => tc.tool).join(', ') || 'nothing'}`
    ).join('\n');

    if (inlineAnalysis) {
      // Agent produced analysis inline — just need the narrative
      callbacks.onProgress?.('Generating narrative answer...');
      let narrative = '';
      try {
        narrative = await this.generateNarrativeAnswer(query, queryType, finalEvidenceSummary, reasoningTrace, agentFinalReasoning, callbacks);
      } catch {
        // Narrative is nice-to-have, not critical
      }

      synthesized = {
        sequences: (inlineAnalysis.sequences as ExecutionSequence[]) ?? [],
        symbols: (inlineAnalysis.symbols as SymbolResult[]) ?? [],
        clusters: (inlineAnalysis.clusters as ClusterInfo[]) ?? [],
        answer: narrative,
      };

      if (queryType === 'bug_analysis') {
        const impactEntries = Object.entries(evidence)
          .filter(([k]) => k.startsWith('impact_'))
          .map(([, v]) => v);
        const mainSeq = synthesized.sequences[0] ?? {
          name: 'unknown', priority: 0, steps: [], processType: 'within_community' as const, confidence: 0,
        };
        investigation = {
          executionPath: mainSeq,
          suspectPoints: (inlineAnalysis.suspectPoints as SuspectPoint[]) ?? [],
          suggestions: (inlineAnalysis.suggestions as InvestigationSuggestion[]) ?? [],
          blastRadius: (impactEntries[0] as BlastRadiusInfo) ?? { target: '', direction: 'both' as const, affected: [], riskLevel: 'low' as const },
          testChecklist: (inlineAnalysis.testChecklist as string[]) ?? [],
          summary: narrative,
        };
      }
    } else {
      // Agent didn't produce inline analysis — fall back to separate synthesis
      callbacks.onProgress?.('Phase 3: Synthesizing results...');
      if (queryType === 'bug_analysis') {
        const [combinedResult, narrativeResult] = await Promise.allSettled([
          this.agentCombinedBugAnalysis(query, evidence, trace),
          this.generateNarrativeAnswer(query, queryType, finalEvidenceSummary, reasoningTrace, agentFinalReasoning, callbacks),
        ]);
        const combined = combinedResult.status === 'fulfilled'
          ? combinedResult.value
          : { sequences: [] as ExecutionSequence[], symbols: [] as SymbolResult[], clusters: [] as ClusterInfo[], answer: '', investigation: { executionPath: { name: '', priority: 0, steps: [], processType: 'within_community' as const, confidence: 0 }, suspectPoints: [], suggestions: [{ text: 'Analysis failed' }], blastRadius: { target: '', direction: 'both' as const, affected: [], riskLevel: 'low' as const }, testChecklist: [] } as InvestigationReport };
        const narrative = narrativeResult.status === 'fulfilled' ? narrativeResult.value : '';
        synthesized = { sequences: combined.sequences, symbols: combined.symbols, clusters: combined.clusters, answer: narrative || combined.answer };
        investigation = combined.investigation;
        if (investigation) { investigation.summary = synthesized.answer; }
      } else {
        synthesized = await this.agentSynthesize(query, queryType, evidence, trace, callbacks);
        if (queryType === 'impact' && synthesized.symbols.length > 0) {
          investigation = await this.agentImpactAnalysis(synthesized.symbols[0].symbolName, evidence);
        }
      }
    }

    const results: SearchResult = {
      query,
      type: queryType as SearchResult['type'],
      sequences: synthesized.sequences,
      symbols: synthesized.symbols,
      clusters: synthesized.clusters,
      answer: synthesized.answer,
      investigation,
      agentTrace: trace,
      metadata: {
        durationMs: Date.now() - startTime,
        model: this.copilot.getSelectedModelId(),
        providersUsed: ['gitnexus', 'copilot-lm'],
      },
    };

    this.lastResults = results;
    return results;
  }

  // ============ Inline Agent Loop (reusable core) ============

  /**
   * Core inline multi-turn agent loop. Used by both search() and investigateDeeper().
   * The LLM drives tool calls across turns, building evidence until it produces a final analysis.
   *
   * @param params.evidence  Pre-seeded evidence (e.g. from Phase 1 search). Mutated in-place.
   * @returns inlineAnalysis — structured JSON from the agent's final turn (or null if not produced)
   *          trace          — per-turn reasoning + tool call history (for agentTrace / reasoningTrace)
   *          agentFinalReasoning — the agent's last "reasoning" string (conclusions, used for narrative)
   */
  private async runInlineAgentLoop(params: {
    query: string;
    queryType: string;
    evidence: Record<string, unknown>;
    callbacks: ProgressCallback;
    maxTurnsOverride?: number;
  }): Promise<{
    inlineAnalysis: Record<string, unknown> | null;
    trace: AgentStep[];
    agentFinalReasoning: string;
  }> {
    const { query, queryType, evidence, callbacks } = params;
    const limits = this.getDynamicLimits();
    const maxTurns = params.maxTurnsOverride ?? (DEFAULT_ITERATIONS[queryType] ?? 4);
    const systemPrompt = queryType === 'bug_analysis' ? AUTOSAR_BUG_ANALYSIS_PROMPT : AGENT_SYSTEM_PROMPT;
    const evidenceSummary = this.summarizeEvidence(evidence, limits.maxEvidenceChars);
    const initialPrompt = buildInlineAgentPrompt({ query, queryType, evidenceSummary, maxTurns });

    // System prompt is passed separately to chatMultiTurn() so it becomes a proper System message.
    const conversation: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: initialPrompt },
    ];

    const trace: AgentStep[] = [];
    let inlineAnalysis: Record<string, unknown> | null = null;
    let effectiveMaxTurns = maxTurns;
    let agentFinalReasoning = '';

    for (let turn = 1; turn <= effectiveMaxTurns; turn++) {
      callbacks.onProgress?.(`Agent turn ${turn}/${effectiveMaxTurns}...`);

      const response = await this.copilot.chatMultiTurn(conversation, systemPrompt);
      conversation.push({ role: 'assistant', content: response });

      let parsed: Record<string, unknown>;
      try {
        parsed = this.parseJson(response);
      } catch {
        // LLM returned non-JSON (e.g. plain text analysis) — treat as done
        parsed = { reasoning: response, done: true };
      }

      // On first turn, let the LLM adjust the budget based on query complexity
      if (turn === 1 && typeof parsed.estimatedTurns === 'number') {
        const clamped = Math.max(1, Math.min(parsed.estimatedTurns, ABSOLUTE_MAX_ITERATIONS));
        if (clamped !== effectiveMaxTurns) {
          console.log(`[QueryEngine] LLM estimated ${parsed.estimatedTurns} turns → clamped to ${clamped} (was ${effectiveMaxTurns})`);
          effectiveMaxTurns = clamped;
        }
      }

      const step: AgentStep = {
        iteration: turn,
        reasoning: String(parsed.reasoning ?? ''),
        toolCalls: [],
      };

      // If agent says done or this is the last turn, capture analysis
      if (parsed.done || turn === effectiveMaxTurns) {
        agentFinalReasoning = String(parsed.reasoning ?? '');
        trace.push(step);
        if (parsed.sequences || parsed.suspectPoints || parsed.symbols) {
          inlineAnalysis = parsed;
        }
        break;
      }

      // Execute tool calls
      const toolCalls = (parsed.toolCalls as Array<{ tool: string; args: Record<string, unknown>; reason: string }>) ?? [];
      if (toolCalls.length === 0) {
        // No tools and not done — force stop
        trace.push(step);
        break;
      }

      // Dedup against previous turns
      const previousCallKeys = new Set<string>();
      for (const prev of trace) {
        for (const tc of prev.toolCalls) {
          previousCallKeys.add(tc.tool + '::' + JSON.stringify(tc.args));
        }
      }
      const dedupedCalls = toolCalls.filter((tc) => {
        const key = tc.tool + '::' + JSON.stringify(tc.args);
        return !previousCallKeys.has(key);
      });

      if (dedupedCalls.length === 0) {
        step.reasoning += ' (stopped: all calls were duplicates)';
        trace.push(step);
        break;
      }

      // Execute all tool calls in parallel
      const results = await Promise.all(
        dedupedCalls.map(async (tc) => {
          callbacks.onProgress?.(`${tc.tool}: ${tc.reason}`);
          const result = await this.safeCallTool(tc.tool, tc.args);
          return { tool: tc.tool, args: tc.args, reason: tc.reason, result };
        })
      );

      for (const r of results) {
        step.toolCalls.push(r);
        const key = `${r.tool}_${Object.values(r.args).join('_')}`.slice(0, 80);
        evidence[key] = r.result;
      }

      // Auto-read source files discovered from graph results in bug_analysis mode (all turns)
      if (queryType === 'bug_analysis') {
        const autoFiles = this.extractFilePathsFromEvidence(results, evidence);
        if (autoFiles.length > 0) {
          callbacks.onProgress?.(`Auto-reading ${autoFiles.length} source file(s)...`);
          const autoReads = await Promise.all(
            autoFiles.map(async (af) => {
              const result = await this.safeCallTool('read_file', { filePath: af.filePath, startLine: af.startLine, endLine: af.endLine });
              return { tool: 'read_file', args: { filePath: af.filePath, startLine: af.startLine, endLine: af.endLine }, reason: 'Auto-read from graph', result };
            })
          );
          for (const r of autoReads) {
            step.toolCalls.push(r);
            const key = `read_file_${String(r.args.filePath).replace(/\//g, '_')}`.slice(0, 80);
            evidence[key] = r.result;
          }
        }
      }

      trace.push(step);

      // Build next user message with tool results
      const resultsSummary = results.map((r) => {
        const json = JSON.stringify(r.result, null, 2);
        const truncated = json.length > limits.toolResultTruncateChars ? json.slice(0, limits.toolResultTruncateChars) + '...(truncated)' : json;
        return `### ${r.tool}(${JSON.stringify(r.args)})\n<result>\n${truncated}\n</result>`;
      }).join('\n\n');

      let nextMsg = `## Tool Results (Turn ${turn})\n${resultsSummary}`;

      // On the penultimate turn, instruct the LLM to produce analysis on the next turn
      if (turn + 1 === effectiveMaxTurns) {
        nextMsg += buildFinalTurnInstruction(queryType);
      }

      // Context length guard: if conversation is getting too long, compact old turns
      const totalChars = conversation.reduce((s, t) => s + t.content.length, 0) + nextMsg.length;
      if (totalChars > limits.maxConversationChars && conversation.length >= 3) {
        console.warn(`[QueryEngine] Conversation too long (${(totalChars / 1000).toFixed(1)}K chars, limit ${(limits.maxConversationChars / 1000).toFixed(0)}K), compacting old turns`);
        // Keep: first user message (initial prompt) + last assistant + new user message
        const middleTurns = conversation.slice(1, -1);
        const compactSummary = middleTurns.map((t, i) => {
          const preview = t.content.slice(0, limits.compactPreviewChars).replace(/\n/g, ' ');
          return `[${t.role} ${i + 1}]: ${preview}...`;
        }).join('\n');
        const firstMsg = conversation[0];
        const lastMsg = conversation[conversation.length - 1];
        conversation.length = 0;
        conversation.push(firstMsg);
        conversation.push({ role: 'user', content: `## Compacted History (turns 1-${turn - 1})\n${compactSummary}` });
        conversation.push(lastMsg);
        console.log(`[QueryEngine] Compacted to ${(conversation.reduce((s, t) => s + t.content.length, 0) / 1000).toFixed(1)}K chars`);
      }

      conversation.push({ role: 'user', content: nextMsg });
    }

    return { inlineAnalysis, trace, agentFinalReasoning };
  }

  // ============ Agent Planning (legacy — used only internally) ============

  private async agentPlan(
    query: string,
    queryType: string,
    evidence: Record<string, unknown>,
    iteration: number,
    previousTrace: AgentStep[] = [],
    maxIterations: number = DEFAULT_ITERATIONS[queryType] ?? 4
  ): Promise<AgentPlan> {
    // Start with default evidence limit, but shrink if the full prompt is too large
    const MAX_PROMPT_CHARS = AGENT_CONFIG.maxPromptChars;
    let evidenceSummary = this.summarizeEvidence(evidence);

    // Build a history of all previous tool calls so the agent knows what was already tried
    let previousCallsSection = '';
    if (previousTrace.length > 0) {
      const callLines: string[] = [];
      for (const step of previousTrace) {
        for (const tc of step.toolCalls) {
          const argsStr = JSON.stringify(tc.args);
          const hadError = tc.result && typeof tc.result === 'object' && 'error' in (tc.result as Record<string, unknown>);
          callLines.push(`- [iter ${step.iteration}] ${tc.tool}(${argsStr}) → ${hadError ? 'ERROR' : 'OK'}${tc.reason ? ' — ' + tc.reason : ''}`);
        }
      }
      if (callLines.length > 0) {
        previousCallsSection = `\n## Previously Called Tools (DO NOT repeat these exact calls)\n${callLines.join('\n')}\n`;
      }
    }

    let prompt = buildAgentPlanPrompt({
      query,
      queryType,
      evidenceSummary,
      previousCallsSection,
      iteration,
      maxIterations,
    });

    try {
      // Guard: if the full prompt is too large, re-summarize with a tighter limit
      const totalChars = AGENT_SYSTEM_PROMPT.length + prompt.length;
      if (totalChars > MAX_PROMPT_CHARS) {
        console.warn(`[QueryEngine] agentPlan prompt too large (${(totalChars / 1000).toFixed(1)}K chars), re-summarizing evidence`);
        const targetEvidenceChars = Math.max(2000, MAX_PROMPT_CHARS - (totalChars - evidenceSummary.length));
        evidenceSummary = this.summarizeEvidence(evidence, targetEvidenceChars);
        prompt = buildAgentPlanPrompt({
          query,
          queryType,
          evidenceSummary,
          previousCallsSection,
          iteration,
          maxIterations,
        });
        console.log(`[QueryEngine] Reduced prompt: ${((AGENT_SYSTEM_PROMPT.length + prompt.length) / 1000).toFixed(1)}K chars`);
      }
      const response = await this.copilot.chat(AGENT_SYSTEM_PROMPT, prompt);
      return this.parseJson(response);
    } catch (e) {
      console.error('[QueryEngine] agentPlan failed:', e instanceof Error ? e.message : e);
      return { reasoning: `Planning failed (${e instanceof Error ? e.message : 'unknown error'}), synthesizing with current evidence`, toolCalls: [], done: true };
    }
  }

  // ============ Agent Synthesis ============

  private async agentSynthesize(
    query: string,
    queryType: string,
    evidence: Record<string, unknown>,
    trace: AgentStep[],
    callbacks: ProgressCallback = {},
  ): Promise<{
    sequences: ExecutionSequence[];
    symbols: SymbolResult[];
    clusters: ClusterInfo[];
    answer: string;
  }> {
    const evidenceSummary = this.summarizeEvidence(evidence);
    const reasoningTrace = trace.map((s) =>
      `Iteration ${s.iteration}: ${s.reasoning} → called ${s.toolCalls.map((tc) => tc.tool).join(', ') || 'nothing'}`
    ).join('\n');

    const structuredPrompt = buildSynthesizePrompt({
      query,
      queryType,
      reasoningTrace,
      evidenceSummary,
    });

    // Run structured synthesis and narrative answer in parallel to save ~3-5s
    const [structuredResult, narrativeResult] = await Promise.allSettled([
      (async () => {
        const response = await this.copilot.chat(AGENT_SYSTEM_PROMPT, structuredPrompt);
        const parsed = this.parseJson(response);
        return {
          sequences: parsed.sequences ?? [],
          symbols: parsed.symbols ?? [],
          clusters: parsed.clusters ?? [],
        };
      })(),
      this.generateNarrativeAnswer(query, queryType, evidenceSummary, reasoningTrace, '', callbacks),
    ]);

    const structured = structuredResult.status === 'fulfilled'
      ? structuredResult.value
      : this.fallbackParsing(evidence['initial_search']);

    if (structuredResult.status === 'rejected') {
      console.error('[QueryEngine] agentSynthesize failed:', structuredResult.reason);
    }

    const answer = narrativeResult.status === 'fulfilled' ? narrativeResult.value : '';
    if (narrativeResult.status === 'rejected') {
      console.error('[QueryEngine] generateNarrativeAnswer failed:', narrativeResult.reason);
    }

    return { ...structured, answer };
  }

  /**
   * Generates a human-readable narrative answer explaining the results to the user.
   * @param agentConclusions  The agent's final "reasoning" field — its own synthesis/conclusions.
   *                          Passed to the narrative prompt so the LLM builds on the agent's work
   *                          rather than starting from scratch.
   */
  private async generateNarrativeAnswer(
    query: string,
    queryType: string,
    evidenceSummary: string,
    reasoningTrace: string,
    agentConclusions: string = '',
    callbacks: ProgressCallback = {},
  ): Promise<string> {
    const answerPrompt = buildNarrativeAnswerPrompt({
      query,
      queryType,
      seqSummary: '',
      symSummary: '',
      evidenceSummary,
      agentConclusions,
    });

    try {
      if (callbacks.onAnswerChunk) {
        // Stream mode: push each token chunk to the callback
        return await this.copilot.chatStream(AGENT_SYSTEM_PROMPT, answerPrompt, callbacks.onAnswerChunk);
      }
      return await this.copilot.chat(AGENT_SYSTEM_PROMPT, answerPrompt);
    } catch (e) {
      console.error('[QueryEngine] generateNarrativeAnswer failed:', e instanceof Error ? e.message : e);
      return '';
    }
  }

  // ============ Combined Bug Analysis (fallback for when inline analysis fails) ============

  /**
   * Single LLM call that produces: structured sequences + symbols + narrative + suspect points.
   * Replaces the previous 3 sequential LLM calls (synthesize + narrative + bugAnalysis).
   */
  private async agentCombinedBugAnalysis(
    query: string,
    evidence: Record<string, unknown>,
    trace: AgentStep[]
  ): Promise<{
    sequences: ExecutionSequence[];
    symbols: SymbolResult[];
    clusters: ClusterInfo[];
    answer: string;
    investigation: InvestigationReport;
  }> {
    const evidenceSummary = this.summarizeEvidence(evidence);
    const reasoningTrace = trace.map((s) =>
      `Iteration ${s.iteration}: ${s.reasoning} → called ${s.toolCalls.map((tc) => tc.tool).join(', ') || 'nothing'}`
    ).join('\n');

    const prompt = buildCombinedBugAnalysisPrompt({
      query,
      reasoningTrace,
      evidenceSummary,
    });

    const impactEntries = Object.entries(evidence)
      .filter(([k]) => k.startsWith('impact_'))
      .map(([, v]) => v);

    try {
      const response = await this.copilot.chat(AUTOSAR_BUG_ANALYSIS_PROMPT, prompt);
      const parsed = this.parseJson(response);

      const mainSequence = (parsed.sequences ?? [])[0] ?? {
        name: 'unknown', priority: 0, steps: [], processType: 'within_community' as const, confidence: 0,
      };

      return {
        sequences: parsed.sequences ?? [],
        symbols: parsed.symbols ?? [],
        clusters: parsed.clusters ?? [],
        answer: parsed.answer ?? '',
        investigation: {
          executionPath: mainSequence,
          suspectPoints: parsed.suspectPoints ?? [],
          suggestions: parsed.suggestions ?? [],
          blastRadius: (impactEntries[0] as BlastRadiusInfo) ?? { target: '', direction: 'both' as const, affected: [], riskLevel: 'low' as const },
          testChecklist: parsed.testChecklist ?? [],
        },
      };
    } catch (e) {
      console.error('[QueryEngine] agentCombinedBugAnalysis failed:', e instanceof Error ? e.message : e);
      // Fallback: try the old sequential path
      const fallback = this.fallbackParsing(evidence['initial_search']);
      return {
        ...fallback,
        answer: '',
        investigation: {
          executionPath: fallback.sequences[0] ?? { name: '', priority: 0, steps: [], processType: 'within_community', confidence: 0 },
          suspectPoints: [],
          suggestions: [{ text: `Combined analysis failed: ${e instanceof Error ? e.message : 'unknown error'}` }],
          blastRadius: { target: '', direction: 'both', affected: [], riskLevel: 'low' },
          testChecklist: [],
        },
      };
    }
  }

  // ============ Agent Impact Analysis ============

  private async agentImpactAnalysis(
    targetSymbol: string,
    evidence: Record<string, unknown>
  ): Promise<InvestigationReport> {
    // If we don't have impact for this symbol yet, fetch it
    const impactKey = `impact_${targetSymbol}`;
    if (!evidence[impactKey]) {
      evidence[impactKey] = await this.safeCallTool('impact', {
        target: targetSymbol,
        direction: 'both',
        maxDepth: 4,
      });
    }

    const impact = evidence[impactKey] as BlastRadiusInfo ?? {
      target: targetSymbol,
      direction: 'both' as const,
      affected: [],
      riskLevel: 'low' as const,
    };

    return {
      executionPath: { name: '', priority: 0, steps: [], processType: 'within_community', confidence: 0 },
      suspectPoints: [],
      suggestions: [],
      blastRadius: impact,
      testChecklist: [],
    };
  }

  // ============ Evidence Management ============

  /**
   * Extract unique file paths + line hints from tool results that haven't been read yet.
   * Uses line metadata from GitNexus symbols to compute smart read ranges.
   */
  private extractFilePathsFromEvidence(
    recentResults: Array<{ tool: string; args: Record<string, unknown>; result: unknown }>,
    allEvidence: Record<string, unknown>
  ): Array<{ filePath: string; startLine: number; endLine: number }> {
    const alreadyRead = new Set<string>();
    // Collect file paths already read
    for (const key of Object.keys(allEvidence)) {
      if (key.startsWith('read_file_')) {
        const ev = allEvidence[key] as { filePath?: string } | undefined;
        if (ev?.filePath) alreadyRead.add(ev.filePath);
      }
    }

    // Collect {filePath, line} pairs from graph results
    const fileLineMap = new Map<string, number[]>();

    for (const r of recentResults) {
      if (r.tool === 'read_file') continue;
      const result = r.result as Record<string, unknown> | undefined;
      if (!result) continue;

      // Walk processes[].symbols[] and results[] for filePath + line
      const symbolSources: unknown[] = [];
      for (const proc of (result as any)?.processes ?? []) {
        symbolSources.push(...(proc.symbols ?? []));
        symbolSources.push(...(proc.steps ?? []));
      }
      symbolSources.push(...((result as any)?.results ?? []));
      // context tool returns callers/callees
      symbolSources.push(...((result as any)?.callers ?? []));
      symbolSources.push(...((result as any)?.callees ?? []));
      // Also check affected[] from impact
      symbolSources.push(...((result as any)?.affected ?? []));

      for (const sym of symbolSources) {
        const s = sym as Record<string, unknown>;
        const fp = String(s.filePath ?? s.file ?? '');
        const line = Number(s.line ?? 0);
        if (fp && fp.endsWith('.c') && !alreadyRead.has(fp)) {
          const existing = fileLineMap.get(fp) ?? [];
          if (line > 0) existing.push(line);
          fileLineMap.set(fp, existing);
        }
      }

      if (fileLineMap.size >= AGENT_CONFIG.maxAutoReadsPerIteration) break;
    }

    // Fallback: if structured extraction found nothing, try regex
    if (fileLineMap.size === 0) {
      const fileRegex = /[\w\/\.\-]+\.\b(?:c|h|cpp|hpp)\b/g;
      for (const r of recentResults) {
        if (r.tool === 'read_file') continue;
        const json = JSON.stringify(r.result);
        let match;
        while ((match = fileRegex.exec(json)) !== null) {
          const fp = match[0];
          if (fp.endsWith('.c') && !alreadyRead.has(fp) && !fileLineMap.has(fp)) {
            fileLineMap.set(fp, []);
          }
        }
        if (fileLineMap.size >= AGENT_CONFIG.maxAutoReadsPerIteration) break;
      }
    }

    // Convert to read ranges based on line metadata
    const readLines = AGENT_CONFIG.readFileDefaultLines;
    const entries = Array.from(fileLineMap.entries()).slice(0, AGENT_CONFIG.maxAutoReadsPerIteration);

    return entries.map(([filePath, lines]) => {
      if (lines.length === 0) {
        // No line info — read from the top
        return { filePath, startLine: 1, endLine: AGENT_CONFIG.autoReadEndLine };
      }
      // Compute range covering min..max line with padding
      const minLine = Math.min(...lines);
      const maxLine = Math.max(...lines);
      const span = maxLine - minLine;
      const padding = Math.max(30, Math.floor((readLines - span) / 2));
      const startLine = Math.max(1, minLine - padding);
      const endLine = maxLine + padding;
      return { filePath, startLine, endLine };
    });
  }

  private summarizeEvidence(evidence: Record<string, unknown>, maxChars?: number): string {
    const dynLimits = this.getDynamicLimits();
    const limit = maxChars ?? dynLimits.maxEvidenceChars;
    const perEntryLimit = Math.min(dynLimits.evidencePerEntryChars, Math.floor(limit / Math.max(Object.keys(evidence).length, 1)));
    const parts: string[] = [];
    let totalLength = 0;

    for (const [key, value] of Object.entries(evidence)) {
      if (totalLength > limit) {
        parts.push(`... (${Object.keys(evidence).length - parts.length} more evidence entries truncated)`);
        break;
      }
      const json = JSON.stringify(value, null, 2);
      const truncated = json.length > perEntryLimit ? json.slice(0, perEntryLimit) + '...(truncated)' : json;
      // Use XML-style tags instead of code fences to avoid confusing the LLM with nested fences
      parts.push(`### ${key}\n<evidence>\n${truncated}\n</evidence>`);
      totalLength += truncated.length;
    }

    return parts.join('\n\n');
  }

  // ============ Safe Tool Calling ============

  private async safeCallTool(tool: string, args: Record<string, unknown>): Promise<unknown> {
    // Handle local read_file tool (not via MCP)
    if (tool === 'read_file') {
      const result = this.readSourceFile(args);
      this.logToolCall(tool, args, result);
      return result;
    }
    try {
      const result = await this.gitnexus.callTool(tool, args);
      this.logToolCall(tool, args, result);
      return result;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const errorResult = { error: msg };
      this.logToolCall(tool, args, errorResult);
      return errorResult;
    }
  }

  /** Log each tool call + response to a file for debugging */
  private _logPath: string | null = null;
  private logToolCall(tool: string, args: Record<string, unknown>, result: unknown): void {
    try {
      if (!this._logPath) {
        const workspacePath = this.gitnexus.getWorkspacePath();
        this._logPath = path.join(workspacePath, 'gitnexus-responses.log');
        // Write header on first call
        fs.writeFileSync(this._logPath, `=== GitNexus Response Log — ${new Date().toISOString()} ===\n\n`, 'utf-8');
      }
      const timestamp = new Date().toISOString();
      const argsStr = JSON.stringify(args);
      const resultStr = JSON.stringify(result, null, 2);
      const entry = `--- [${timestamp}] ${tool}(${argsStr}) ---\n${resultStr}\n\n`;
      fs.appendFileSync(this._logPath, entry, 'utf-8');
    } catch {
      // Logging should never break the main flow
    }
  }

  // ============ Local Source Code Reading ============

  /**
   * Read actual source code from the workspace.
   * Args: { filePath: string, startLine?: number, endLine?: number }
   * Returns the source code text with line numbers, or an error.
   */
  private readSourceFile(args: Record<string, unknown>): unknown {
    const filePath = String(args.filePath ?? '');
    const startLine = Math.max(1, Number(args.startLine) || 1);
    const endLine = Number(args.endLine) || (startLine + AGENT_CONFIG.readFileDefaultLines);

    if (!filePath) {
      return { error: 'filePath is required' };
    }

    // Resolve relative paths against workspace
    const workspacePath = this.gitnexus.getWorkspacePath();
    let absPath = filePath;
    if (!path.isAbsolute(filePath)) {
      absPath = path.join(workspacePath, filePath);
    }

    // If the direct path doesn't exist, search the workspace for a matching filename
    if (!fs.existsSync(absPath)) {
      const resolved = this.findFileInWorkspace(filePath, workspacePath);
      if (resolved) {
        absPath = resolved;
      }
    }

    // Security: prevent path traversal outside workspace
    const realWorkspace = fs.realpathSync(workspacePath);
    try {
      const realFile = fs.realpathSync(absPath);
      if (!realFile.startsWith(realWorkspace)) {
        return { error: 'Access denied: file is outside workspace' };
      }
    } catch {
      return { error: `File not found: ${filePath}` };
    }

    try {
      const content = fs.readFileSync(absPath, 'utf-8');
      const allLines = content.split('\n');
      const clampedEnd = Math.min(endLine, allLines.length);
      const selectedLines = allLines.slice(startLine - 1, clampedEnd);

      // Format with line numbers for LLM context
      const numbered = selectedLines.map((line, i) =>
        `${(startLine + i).toString().padStart(4, ' ')} | ${line}`
      ).join('\n');

      return {
        filePath: filePath,
        startLine,
        endLine: clampedEnd,
        totalLines: allLines.length,
        content: numbered,
      };
    } catch (e) {
      return { error: `Failed to read file: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /**
   * Search workspace recursively for a file matching the given name or partial path.
   * Handles cases where graph returns just "Com.c" but actual path is "src/services/Com/Com.c".
   */
  private findFileInWorkspace(fileName: string, workspacePath: string): string | null {
    const basename = path.basename(fileName);
    const cache = this._fileCache;

    // Build file cache on first use (scan workspace once)
    if (!cache.size) {
      this.buildFileCache(workspacePath, workspacePath);
    }

    // Exact basename match
    const candidates = cache.get(basename);
    if (!candidates || candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    // If fileName has directory hints (e.g. "Com/Com.c"), prefer the match that contains it
    if (fileName.includes('/')) {
      const normalized = fileName.replace(/^\/+/, '');
      const best = candidates.find(c => c.includes(normalized));
      if (best) return best;
    }

    // Return the first match (shortest path = most likely the right one)
    return candidates.sort((a, b) => a.length - b.length)[0];
  }

  private _fileCache = new Map<string, string[]>();

  private buildFileCache(dir: string, workspacePath: string): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        // Skip hidden dirs, node_modules, .git, build outputs
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'out') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          this.buildFileCache(fullPath, workspacePath);
        } else if (/\.(c|h|cpp|hpp)$/i.test(entry.name)) {
          const existing = this._fileCache.get(entry.name) ?? [];
          existing.push(fullPath);
          this._fileCache.set(entry.name, existing);
        }
      }
    } catch {
      // Permission error or similar — skip this directory
    }
  }

  // ============ Investigate Deeper ============

  async investigateDeeper(
    suspectSymbol: string,
    callbacks: ProgressCallback = {}
  ): Promise<SearchResult> {
    const startTime = Date.now();
    const evidence: Record<string, unknown> = {};

    // Pre-seed evidence: run context + impact + config query in parallel
    callbacks.onProgress?.(`Pre-seeding evidence for ${suspectSymbol}...`);
    const [contextResult, impactResult, configResult] = await Promise.all([
      this.safeCallTool('context', { name: suspectSymbol }),
      this.safeCallTool('impact', { target: suspectSymbol, direction: 'both', maxDepth: 3 }),
      this.safeCallTool('query', { query: `${suspectSymbol} configuration initialization error handling` }),
    ]);
    evidence['context_target'] = contextResult;
    evidence['impact_target'] = impactResult;
    evidence['query_config'] = configResult;

    // Auto-read source files discovered from the context result
    const autoFiles = this.extractFilePathsFromEvidence(
      [{ tool: 'context', args: { name: suspectSymbol }, result: contextResult }],
      evidence
    );
    if (autoFiles.length > 0) {
      callbacks.onProgress?.(`Auto-reading ${autoFiles.length} source file(s)...`);
      const autoReads = await Promise.all(
        autoFiles.map(async (af) => {
          const result = await this.safeCallTool('read_file', { filePath: af.filePath, startLine: af.startLine, endLine: af.endLine });
          return { filePath: af.filePath, result };
        })
      );
      for (const r of autoReads) {
        const key = `read_file_${r.filePath.replace(/\//g, '_')}`.slice(0, 80);
        evidence[key] = r.result;
      }
    }

    // Run the full inline agent loop — same depth as main search, with max budget
    callbacks.onProgress?.('Deep investigation agent starting...');
    const deepQuery = `Forensic deep investigation of "${suspectSymbol}": trace ALL callers and callees, check ALL error paths and return value propagation, verify configuration dependencies in Cfg.h/PBcfg.c, identify concurrency and reentrancy risks with SchM, map state machine transitions, check initialization order`;
    const { inlineAnalysis, trace, agentFinalReasoning } = await this.runInlineAgentLoop({
      query: deepQuery,
      queryType: 'bug_analysis',
      evidence,
      callbacks,
      maxTurnsOverride: ABSOLUTE_MAX_ITERATIONS,
    });

    const finalEvidenceSummary = this.summarizeEvidence(evidence);
    const reasoningTrace = trace.map((s) =>
      `Turn ${s.iteration}: ${s.reasoning} → called ${s.toolCalls.map((tc) => tc.tool).join(', ') || 'nothing'}`
    ).join('\n');

    callbacks.onProgress?.('Generating narrative...');
    let narrative = '';
    try {
      narrative = await this.generateNarrativeAnswer(`Deep investigation: ${suspectSymbol}`, 'bug_analysis', finalEvidenceSummary, reasoningTrace, agentFinalReasoning);
    } catch { /* narrative is nice-to-have */ }

    const impactEntries = Object.entries(evidence)
      .filter(([k]) => k.startsWith('impact_'))
      .map(([, v]) => v);

    const sequences = (inlineAnalysis?.sequences as ExecutionSequence[]) ?? this.lastResults?.sequences ?? [];
    const suspectPoints = (inlineAnalysis?.suspectPoints as SuspectPoint[]) ?? [];
    const suggestions = (inlineAnalysis?.suggestions as InvestigationSuggestion[]) ?? [];
    const testChecklist = (inlineAnalysis?.testChecklist as string[]) ?? [];

    // If the agent didn't produce inline analysis, fall back to the deep investigation prompt
    if (!inlineAnalysis) {
      callbacks.onProgress?.('Running deep investigation fallback...');
      try {
        const deepPrompt = buildDeepInvestigationPrompt(suspectSymbol, finalEvidenceSummary);
        const response = await this.copilot.chat(AUTOSAR_BUG_ANALYSIS_PROMPT, deepPrompt);
        const parsed = this.parseJson(response);
        suspectPoints.push(...(parsed.suspectPoints ?? []));
        suggestions.push(...(parsed.suggestions ?? []));
        testChecklist.push(...(parsed.testChecklist ?? []));
      } catch (e) {
        console.error('[QueryEngine] investigateDeeper fallback failed:', e instanceof Error ? e.message : e);
      }
    }

    const results: SearchResult = {
      query: `Deep investigation: ${suspectSymbol}`,
      type: 'bug_analysis',
      sequences,
      symbols: (inlineAnalysis?.symbols as SymbolResult[]) ?? this.lastResults?.symbols ?? [],
      clusters: (inlineAnalysis?.clusters as ClusterInfo[]) ?? this.lastResults?.clusters ?? [],
      answer: narrative,
      agentTrace: trace,
      investigation: {
        executionPath: sequences[0] ?? {
          name: '', priority: 0, steps: [], processType: 'within_community', confidence: 0,
        },
        suspectPoints,
        suggestions,
        blastRadius: (impactEntries[0] as BlastRadiusInfo) ?? {
          target: suspectSymbol, direction: 'both' as const, affected: [], riskLevel: 'low' as const,
        },
        testChecklist,
        summary: narrative,
      },
      metadata: {
        durationMs: Date.now() - startTime,
        model: this.copilot.getSelectedModelId(),
        providersUsed: ['gitnexus', 'copilot-lm'],
      },
    };

    this.lastResults = results;
    return results;
  }

  // ============ Test Checklist Generation ============

  async generateTestChecklist(callbacks: ProgressCallback = {}): Promise<SearchResult> {
    const startTime = Date.now();
    if (!this.lastResults?.investigation) {
      throw new Error('No investigation results to generate checklist from');
    }

    callbacks.onProgress?.('Generating test checklist...');
    const inv = this.lastResults.investigation;

    const prompt = buildTestChecklistPrompt({
      suspectPoints: JSON.stringify(inv.suspectPoints, null, 2),
      executionSteps: inv.executionPath.steps.map((s, i) =>
        `${i + 1}. ${s.symbol} (${s.filePath}:${s.line})`
      ).join('\n'),
      blastRadiusAffected: inv.blastRadius.affected.map((a) => `- ${a.symbol} (depth ${a.depth})`).join('\n'),
    });

    const response = await this.copilot.chat(AUTOSAR_BUG_ANALYSIS_PROMPT, prompt);
    const parsed = this.parseJson(response);

    const results = { ...this.lastResults };
    results.investigation = {
      ...inv,
      testChecklist: parsed.testChecklist ?? [],
    };
    results.metadata = {
      ...results.metadata,
      durationMs: Date.now() - startTime,
    };
    this.lastResults = results;
    return results;
  }

  // ============ Batch Execution ============

  setBatchQueue(queue: Array<{ id: number; description: string; queryType: string; status: string }>) {
    this.batchQueue = queue;
  }

  async runBatch(callbacks: BatchCallbacks = {}): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const total = this.batchQueue.length;

    for (let i = 0; i < total; i++) {
      const item = this.batchQueue[i];
      item.status = 'running';
      callbacks.onProgress?.(i, total, item.description);

      try {
        const result = await this.search(item.description, item.queryType);
        results.push(result);
        item.status = 'done';
      } catch (e) {
        console.error('[QueryEngine] batch item failed:', e instanceof Error ? e.message : e);
        item.status = 'error';
      }
    }

    callbacks.onComplete?.(results);
    return results;
  }

  // ============ Results Access ============

  getLastResults(): SearchResult | null {
    return this.lastResults;
  }

  formatResultsAsMarkdown(results: SearchResult): string {
    const lines: string[] = [];
    lines.push(`# Search Results: "${results.query}"`);
    lines.push(`Type: ${results.type} | Model: ${results.metadata.model} | Duration: ${results.metadata.durationMs}ms`);
    lines.push('');

    // Agent trace
    if (results.agentTrace?.length) {
      lines.push('## Agent Reasoning Trace');
      for (const step of results.agentTrace) {
        lines.push(`### Iteration ${step.iteration}`);
        lines.push(`**Reasoning:** ${step.reasoning}`);
        if (step.toolCalls.length > 0) {
          lines.push(`**Tools called:** ${step.toolCalls.map((tc) => `${tc.tool}(${JSON.stringify(tc.args)})`).join(', ')}`);
        }
        lines.push('');
      }
    }

    // Sequences
    if (results.sequences.length > 0) {
      lines.push('## Execution Sequences');
      for (const seq of results.sequences) {
        lines.push(`### ${seq.name} (confidence: ${seq.confidence.toFixed(2)})`);
        lines.push(`Process type: ${seq.processType}`);
        if (seq.communities?.length) {
          lines.push(`Communities: ${seq.communities.join(' → ')}`);
        }
        for (const step of seq.steps) {
          lines.push(`${step.stepIndex + 1}. **${step.symbol}** — \`${step.filePath}:${step.line}\`${step.description ? ' — ' + step.description : ''}`);
        }
        lines.push('');
      }
    }

    // Symbols
    if (results.symbols.length > 0) {
      lines.push('## Symbols');
      lines.push('| # | Score | Symbol | File | Line |');
      lines.push('|---|-------|--------|------|------|');
      results.symbols.forEach((s, i) => {
        lines.push(`| ${i + 1} | ${s.score.toFixed(2)} | ${s.symbolName} | ${s.filePath} | ${s.line} |`);
      });
      lines.push('');
    }

    // Investigation
    if (results.investigation) {
      const inv = results.investigation;
      lines.push('## Investigation');

      if (inv.suspectPoints.length > 0) {
        lines.push('### Suspect Points');
        for (const sp of inv.suspectPoints) {
          lines.push(`- **[${sp.severity.toUpperCase()}]** ${sp.symbol} (\`${sp.filePath}:${sp.line}\`) — ${sp.reason}`);
          lines.push(`  Action: ${sp.suggestedAction}`);
        }
        lines.push('');
      }

      if (inv.suggestions.length > 0) {
        lines.push('### Suggestions');
        for (const sug of inv.suggestions) {
          lines.push(`- [${sug.severity ?? '?'}] ${sug.text ?? sug.description ?? ''}`);
        }
        lines.push('');
      }

      if (inv.testChecklist.length > 0) {
        lines.push('### Test Checklist');
        inv.testChecklist.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  // ============ Helpers ============

  private fallbackParsing(searchRaw: any): {
    sequences: ExecutionSequence[];
    symbols: SymbolResult[];
    clusters: ClusterInfo[];
  } {
    const symbols: SymbolResult[] = [];
    const sequences: ExecutionSequence[] = [];

    for (const proc of searchRaw?.processes ?? []) {
      const steps = (proc.symbols ?? []).map((sym: any, i: number) => ({
        symbol: sym.name ?? sym.symbol ?? '',
        filePath: sym.filePath ?? sym.file ?? '',
        line: sym.line ?? 0,
        stepIndex: i,
        description: sym.description ?? '',
      }));
      sequences.push({
        name: proc.name ?? 'Process',
        priority: proc.priority ?? 0,
        steps,
        processType: proc.type ?? 'within_community',
        communities: proc.communities ?? [],
        confidence: proc.confidence ?? 0.5,
      });
      for (const sym of proc.symbols ?? []) {
        symbols.push({
          symbolName: sym.name ?? sym.symbol ?? '',
          filePath: sym.filePath ?? sym.file ?? '',
          line: sym.line ?? 0,
          score: sym.score ?? 0,
          snippet: sym.snippet ?? '',
          providerSource: 'gitnexus',
        });
      }
    }

    for (const item of searchRaw?.results ?? []) {
      symbols.push({
        symbolName: item.name ?? item.symbol ?? '',
        filePath: item.filePath ?? item.file ?? '',
        line: item.line ?? 0,
        score: item.score ?? 0,
        snippet: item.snippet ?? '',
        providerSource: 'gitnexus',
      });
    }

    return {
      sequences,
      symbols,
      clusters: searchRaw?.clusters ?? [],
    };
  }

  private parseJson(response: string): any {
    let cleaned = response.trim();

    // 0. Handle empty response
    if (!cleaned) {
      throw new Error('Failed to parse JSON from LLM response: empty response');
    }

    // 1. Strip markdown code fences (```json ... ``` or ``` ... ```)
    const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) {
      cleaned = fenceMatch[1].trim();
    }

    // 2. Try direct parse first
    try {
      return JSON.parse(cleaned);
    } catch {
      // continue to fallback strategies
    }

    // 3. Find the first { or [ and last } or ] — extract JSON object/array
    const firstBrace = cleaned.search(/[\[{]/);
    const lastBrace = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const extracted = cleaned.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(extracted);
      } catch {
        // continue
      }

      // 4. Try fixing common LLM JSON issues: trailing commas, single quotes
      const fixed = extracted
        .replace(/,\s*([\]}])/g, '$1')            // trailing commas
        .replace(/(['"])?(\w+)(['"])?\s*:/g, '"$2":') // unquoted keys
        .replace(/:\s*'([^']*)'/g, ': "$1"');        // single-quoted values
      try {
        return JSON.parse(fixed);
      } catch {
        // continue
      }
    }

    // 5. Nothing worked — throw with context for debugging
    const preview = response.slice(0, 200).replace(/\n/g, '\\n');
    throw new Error(`Failed to parse JSON from LLM response. Preview: ${preview}`);
  }
}
