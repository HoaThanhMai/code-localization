import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

export interface GitNexusStats {
  files: number;
  symbols: number;
  processes: number;
  communities: number;
  edges: number;
  lastCommit: string;
  lastIndexedAt: string;
}

export interface GitNexusStatus {
  state: 'not_indexed' | 'indexing' | 'indexed' | 'stale' | 'error';
  stats?: GitNexusStats;
  progress?: {
    phase: string;
    percent: number;
    currentFile?: string;
  };
  error?: string;
}

export class GitNexusService {
  private _mcpClient: Client | null = null;
  private _mcpTransport: StdioClientTransport | null = null;
  private _connectPromise: Promise<void> | null = null;
  private status: GitNexusStatus = { state: 'not_indexed' };
  private cliPath: string;
  private workspacePath: string;
  private repoName: string;

  public getWorkspacePath(): string {
    return this.workspacePath;
  }

  private readonly _onStatusChanged = new vscode.EventEmitter<GitNexusStatus>();
  public readonly onStatusChanged = this._onStatusChanged.event;

  constructor(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('autosarLocator');
    const configuredPath = config.get<string>('gitnexusPath', 'gitnexus');
    this.cliPath = this.resolveCliPath(configuredPath);
    this.workspacePath =
      config.get<string>('codebasePath', '') ||
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
      '';
    this.repoName = config.get<string>('repoName', '') ||
      (this.workspacePath ? this.workspacePath.split('/').pop()! : 'ai-contest');
  }

  getStatus(): GitNexusStatus {
    return this.status;
  }

  /**
   * Ensure the MCP client is connected. Spawns `gitnexus mcp` once and reuses
   * the persistent connection for all subsequent tool calls.
   */
  private async ensureConnected(): Promise<Client> {
    if (this._mcpClient) return this._mcpClient;

    // Deduplicate concurrent connect attempts
    if (!this._connectPromise) {
      this._connectPromise = this._connect();
    }
    await this._connectPromise;
    return this._mcpClient!;
  }

  private async _connect(): Promise<void> {
    const transport = new StdioClientTransport({
      command: this.cliPath,
      args: ['mcp'],
      cwd: this.workspacePath,
      env: { ...process.env } as Record<string, string>,
      stderr: 'pipe',
    });

    const client = new Client({ name: 'autosar-code-locator', version: '0.1.0' });

    client.onerror = (err) => {
      console.error('[GitNexus MCP] Transport error:', err);
    };

    client.onclose = () => {
      console.log('[GitNexus MCP] Connection closed');
      this._mcpClient = null;
      this._mcpTransport = null;
      this._connectPromise = null;
    };

    await client.connect(transport);
    console.log('[GitNexus MCP] Connected');

    this._mcpClient = client;
    this._mcpTransport = transport;
  }

  async checkStatus(): Promise<GitNexusStatus> {
    try {
      // Read stats from .gitnexus/meta.json — the single source of truth.
      // IMPORTANT: Do NOT spawn MCP or CLI here — LadybugDB does not support
      // concurrent access and `gitnexus mcp` loads ALL registered repos,
      // which can crash if any has a corrupt lock.
      const stats = this.readMetaStats();

      if (!stats) {
        this.updateStatus({ state: 'not_indexed' });
        return this.status;
      }

      // Check staleness by comparing indexed commit (from meta.json)
      // with current HEAD using plain git — no LadybugDB involvement.
      let isStale = false;
      try {
        const head = execSync('git rev-parse HEAD', {
          cwd: this.workspacePath,
          encoding: 'utf-8',
          timeout: 5000,
        }).trim();
        const metaPath = path.join(this.workspacePath, '.gitnexus', 'meta.json');
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        const indexedCommit = String(meta.lastCommit || '');
        isStale = !!head && !indexedCommit.startsWith(head) && !head.startsWith(indexedCommit);
      } catch {
        // No git or can't read — assume up to date
      }

      this.updateStatus({
        state: isStale ? 'stale' : 'indexed',
        stats,
      });
    } catch {
      this.updateStatus({
        state: 'error',
        error: 'GitNexus not available. Run: npm install -g gitnexus',
      });
    }
    return this.status;
  }

  /**
   * Read index stats directly from .gitnexus/meta.json.
   */
  private readMetaStats(): GitNexusStats | undefined {
    try {
      const metaPath = path.join(this.workspacePath, '.gitnexus', 'meta.json');
      const raw = fs.readFileSync(metaPath, 'utf-8');
      const meta = JSON.parse(raw);
      return {
        files: meta.stats?.files ?? 0,
        symbols: meta.stats?.nodes ?? 0,
        processes: meta.stats?.processes ?? 0,
        communities: meta.stats?.communities ?? 0,
        edges: meta.stats?.edges ?? 0,
        lastCommit: meta.lastCommit ? String(meta.lastCommit).slice(0, 7) : '',
        lastIndexedAt: meta.indexedAt
          ? new Date(meta.indexedAt).toLocaleString()
          : '',
      };
    } catch {
      return undefined;
    }
  }

  async buildIndex(options: {
    force?: boolean;
    withEmbeddings?: boolean;
    onProgress?: (phase: string, percent: number, detail: string) => void;
    onLog?: (line: string) => void;
  }): Promise<void> {
    this.updateStatus({
      state: 'indexing',
      progress: { phase: 'starting', percent: 0 },
    });

    // buildIndex still uses CLI streaming because `analyze` is a long-running
    // command that emits progress lines to stderr, which MCP tool calls don't
    // support well (they return a single result).
    const args = ['analyze'];
    args.push('--skip-git');
    if (options.withEmbeddings) args.push('--embeddings');
    if (options.force) args.push('--force');

    try {
      // MUST disconnect MCP before spawning analyze — LadybugDB does not
      // support concurrent access and the MCP server holds the DB open.
      await this.disconnectMCP();

      await this.runCliStreaming(args, this.workspacePath, (line) => {
        // Forward every raw line to the caller for log display
        options.onLog?.(line);

        const progress = this.parseProgress(line);
        if (progress) {
          this.updateStatus({
            state: 'indexing',
            progress,
          });
          options.onProgress?.(progress.phase, progress.percent, progress.currentFile ?? '');
        }
      });
      // Reconnect MCP after index rebuild (the DB changed)
      await this.checkStatus();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.updateStatus({ state: 'error', error: msg });
      throw e;
    }
  }

  async callTool(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const client = await this.ensureConnected();
    const result = await client.callTool(
      { name: tool, arguments: { repo: this.repoName, ...args } },
      undefined,
      { timeout: 60_000 }
    );

    if (result.isError) {
      const errText = this.extractText(result);
      throw new Error(`GitNexus tool "${tool}" failed: ${errText}`);
    }

    // Try to parse structured JSON from the text content
    const text = this.extractText(result);
    return this.tryParseJson(text);
  }

  async listAvailableTools(): Promise<string[]> {
    const client = await this.ensureConnected();
    const { tools } = await client.listTools();
    return tools.map((t) => t.name);
  }

  private async disconnectMCP(): Promise<void> {
    if (this._mcpClient) {
      try {
        await this._mcpClient.close();
      } catch {
        // ignore close errors
      }
    }
    this._mcpClient = null;
    this._mcpTransport = null;
    this._connectPromise = null;
  }

  dispose(): void {
    void this.disconnectMCP();
    this._onStatusChanged.dispose();
  }

  // ---- private helpers ----

  /**
   * Extract text content from an MCP callTool result.
   */
  private extractText(result: { content?: unknown; [key: string]: unknown }): string {
    const content = result.content;
    if (!Array.isArray(content)) return JSON.stringify(result);
    return content
      .filter((c: { type: string }) => c.type === 'text')
      .map((c: { text: string }) => c.text)
      .join('\n');
  }

  /**
   * Try to parse a JSON payload from text, returning parsed object or raw text.
   */
  private tryParseJson(text: string): unknown {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        // not valid JSON, return as-is
      }
    }
    return text;
  }

  private updateStatus(status: GitNexusStatus): void {
    this.status = status;
    this._onStatusChanged.fire(status);
  }

  /**
   * Resolve the gitnexus binary to an absolute path.
   */
  private resolveCliPath(configuredPath: string): string {
    if (configuredPath.startsWith('/') || configuredPath.includes('/')) {
      return configuredPath;
    }
    try {
      const resolved = execSync(`which ${configuredPath}`, {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      if (resolved) {
        console.log(`[GitNexus] Resolved CLI path: ${resolved}`);
        return resolved;
      }
    } catch {
      // which failed — fall back to configured path
    }
    return configuredPath;
  }

  /**
   * Run a CLI command with streaming output (used only for `analyze`/buildIndex).
   */
  private runCliStreaming(
    args: string[],
    cwd: string,
    onLine: (line: string) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.cliPath, args, {
        cwd,
        shell: false,
        env: { ...process.env },
      });
      let stderr = '';

      const handleData = (data: Buffer) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.trim()) onLine(line);
        }
      };

      proc.stdout.on('data', handleData);
      proc.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
        handleData(d);
      });

      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr || `gitnexus exited with code ${code}`));
      });
      proc.on('error', reject);
    });
  }

  private parseStats(output: string): GitNexusStats {
    const num = (pattern: RegExp): number => {
      const m = output.match(pattern);
      return m ? parseInt(m[1], 10) : 0;
    };
    const str = (pattern: RegExp): string => {
      const m = output.match(pattern);
      return m ? m[1] : '';
    };
    return {
      files: num(/files?:\s*(\d+)/i),
      symbols: num(/symbols?:\s*(\d+)/i),
      processes: num(/process(?:es)?:\s*(\d+)/i),
      communities: num(/communit(?:y|ies):\s*(\d+)/i),
      edges: num(/edges?:\s*(\d+)/i),
      lastCommit: str(/commit:\s*([a-f0-9]+)/i),
      lastIndexedAt: str(/indexed.*?:\s*(.+)/i),
    };
  }

  private parseProgress(line: string): GitNexusStatus['progress'] | null {
    const m1 = line.match(/\[(\w+)]\s*(\d+)%\s*(.*)/);
    if (m1) {
      return { phase: m1[1], percent: parseInt(m1[2], 10), currentFile: m1[3] };
    }
    const m2 = line.match(/phase:\s*(\w+).*?(\d+)%/i);
    if (m2) {
      return { phase: m2[1], percent: parseInt(m2[2], 10) };
    }
    for (const phase of ['parsing', 'resolving', 'clustering', 'embedding', 'processes']) {
      if (line.toLowerCase().includes(phase)) {
        return { phase, percent: -1 };
      }
    }
    return null;
  }
}
