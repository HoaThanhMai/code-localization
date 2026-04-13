/**
 * IIndexProvider — LOCKED interface.
 * All search providers (GitNexus, Ripgrep, Clangd, etc.) must implement this.
 * Do NOT modify after initial commit.
 */

export interface CodeLocation {
  filePath: string;
  line: number;
  column?: number;
  symbolName: string;
  symbolType: 'function' | 'class' | 'method' | 'variable' | 'type' | 'macro' | 'file' | 'unknown';
  snippet?: string;
  score?: number;
  providerSource: string;
}

export interface CodeSnippet {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  language: string;
  score?: number;
  providerSource: string;
}

export interface SearchOptions {
  maxResults?: number;
  includePatterns?: string[];
  excludePatterns?: string[];
  caseSensitive?: boolean;
  targetCore?: 'R5' | 'A53' | 'A7' | 'any';
}

export interface ExecutionStep {
  symbol: string;
  filePath: string;
  line: number;
  stepIndex: number;
  description?: string;
  callers?: string[];
  callees?: string[];
}

export interface ExecutionSequence {
  name: string;
  priority: number;
  steps: ExecutionStep[];
  processType: 'within_community' | 'cross_community';
  communities?: string[];
  confidence: number;
}

export interface SymbolContext360 {
  symbol: CodeLocation;
  incoming: { calls: string[]; imports: string[] };
  outgoing: { calls: string[]; imports: string[] };
  processes: Array<{ name: string; stepIndex: number; totalSteps: number }>;
  cluster?: { name: string; cohesion: number };
}

export interface BlastRadiusInfo {
  target: string;
  direction: 'upstream' | 'downstream' | 'both';
  affected: Array<{
    symbol: string;
    filePath: string;
    line: number;
    depth: number;
    confidence: number;
    relationType: string;
  }>;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface IIndexProvider {
  readonly name: string;
  readonly reliability: 'heuristic' | 'precise';
  readonly requiresBuildEnv: boolean;

  findDefinitions(symbolHints: string[]): Promise<CodeLocation[]>;
  searchText(patterns: string[], options: SearchOptions): Promise<CodeSnippet[]>;
  expandContext(location: CodeLocation, depth: number): Promise<CodeLocation[]>;
}
