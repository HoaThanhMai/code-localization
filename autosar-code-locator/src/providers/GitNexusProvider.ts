import { GitNexusService } from '../services/GitNexusService';
import { PathMapper } from '../utils/pathMapper';
import {
  IIndexProvider,
  CodeLocation,
  CodeSnippet,
  SearchOptions,
} from './IIndexProvider';

/**
 * GitNexusProvider — implements IIndexProvider using GitNexus knowledge graph.
 * This is the primary provider, replacing ctags + Tree-sitter + vector embedding.
 */
export class GitNexusProvider implements IIndexProvider {
  readonly name = 'gitnexus';
  readonly reliability = 'precise' as const;
  readonly requiresBuildEnv = false;

  constructor(
    private gitnexus: GitNexusService,
    private pathMapper: PathMapper
  ) {}

  async findDefinitions(symbolHints: string[]): Promise<CodeLocation[]> {
    const results: CodeLocation[] = [];

    for (const hint of symbolHints) {
      try {
        const ctx = (await this.gitnexus.callTool('context', { name: hint })) as any;
        if (ctx?.symbol) {
          results.push({
            filePath: this.pathMapper.resolve(ctx.symbol.filePath ?? ctx.symbol.file ?? ''),
            line: ctx.symbol.line ?? 0,
            column: ctx.symbol.column,
            symbolName: ctx.symbol.name ?? hint,
            symbolType: this.mapSymbolType(ctx.symbol.type ?? ctx.symbol.kind),
            snippet: ctx.symbol.snippet ?? '',
            score: 1.0,
            providerSource: this.name,
          });
        }
      } catch {
        // Symbol not found in graph — skip
      }
    }

    return results;
  }

  async searchText(patterns: string[], options: SearchOptions): Promise<CodeSnippet[]> {
    const results: CodeSnippet[] = [];

    for (const pattern of patterns) {
      try {
        const raw = (await this.gitnexus.callTool('query', { query: pattern })) as any;

        // Process-grouped results
        for (const proc of raw?.processes ?? []) {
          for (const sym of proc.symbols ?? []) {
            results.push(this.toSnippet(sym));
          }
        }

        // Flat results
        for (const item of raw?.results ?? []) {
          results.push(this.toSnippet(item));
        }
      } catch {
        // Query failed
      }
    }

    // Apply limits
    const max = options.maxResults ?? 50;
    return results.slice(0, max);
  }

  async expandContext(location: CodeLocation, depth: number): Promise<CodeLocation[]> {
    const results: CodeLocation[] = [];

    try {
      // Get callers + callees
      const ctx = (await this.gitnexus.callTool('context', {
        name: location.symbolName,
      })) as any;

      const relatedSymbols = [
        ...(ctx?.incoming?.calls ?? []),
        ...(ctx?.outgoing?.calls ?? []),
      ];

      // If depth > 1, also get impact graph
      if (depth > 1) {
        const impact = (await this.gitnexus.callTool('impact', {
          target: location.symbolName,
          direction: 'both',
          maxDepth: depth,
        })) as any;

        for (const affected of impact?.affected ?? []) {
          results.push({
            filePath: this.pathMapper.resolve(affected.filePath ?? affected.file ?? ''),
            line: affected.line ?? 0,
            symbolName: affected.symbol ?? affected.name ?? '',
            symbolType: 'function',
            score: affected.confidence ?? 0.5,
            providerSource: this.name,
          });
        }
      }

      // Resolve ctx callers/callees as locations
      for (const symName of relatedSymbols) {
        try {
          const symCtx = (await this.gitnexus.callTool('context', { name: symName })) as any;
          if (symCtx?.symbol) {
            results.push({
              filePath: this.pathMapper.resolve(symCtx.symbol.filePath ?? symCtx.symbol.file ?? ''),
              line: symCtx.symbol.line ?? 0,
              symbolName: symCtx.symbol.name ?? symName,
              symbolType: this.mapSymbolType(symCtx.symbol.type ?? symCtx.symbol.kind),
              score: 0.7,
              providerSource: this.name,
            });
          }
        } catch {
          // Skip unresolvable symbols
        }
      }
    } catch {
      // Context expansion failed
    }

    return results;
  }

  private toSnippet(item: any): CodeSnippet {
    return {
      filePath: this.pathMapper.resolve(item.filePath ?? item.file ?? ''),
      startLine: item.line ?? item.startLine ?? 0,
      endLine: item.endLine ?? (item.line ? item.line + 10 : 10),
      content: item.snippet ?? item.content ?? '',
      language: 'c',
      score: item.score ?? 0,
      providerSource: this.name,
    };
  }

  private mapSymbolType(kind: string | undefined): CodeLocation['symbolType'] {
    if (!kind) { return 'unknown'; }
    const k = kind.toLowerCase();
    if (k.includes('func') || k.includes('method')) { return 'function'; }
    if (k.includes('class') || k.includes('struct')) { return 'class'; }
    if (k.includes('var')) { return 'variable'; }
    if (k.includes('type') || k.includes('typedef')) { return 'type'; }
    if (k.includes('macro') || k.includes('define')) { return 'macro'; }
    return 'unknown';
  }
}
