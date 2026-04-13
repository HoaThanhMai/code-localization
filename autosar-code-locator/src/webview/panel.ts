import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GitNexusService, GitNexusStatus } from '../services/GitNexusService';
import { CopilotLMService } from '../services/CopilotLMService';
import { QueryEngine, SearchResult } from '../services/QueryEngine';

export class CodeLocatorPanel {
  public static currentPanel: CodeLocatorPanel | undefined;
  private static readonly viewType = 'autosarCodeLocator';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _disposed = false;

  private _gitnexus: GitNexusService;
  private _copilot: CopilotLMService;
  private _queryEngine: QueryEngine;

  public static createOrShow(
    extensionUri: vscode.Uri,
    gitnexus: GitNexusService,
    copilot: CopilotLMService,
    queryEngine: QueryEngine
  ) {
    const column = vscode.ViewColumn.Beside;

    if (CodeLocatorPanel.currentPanel) {
      CodeLocatorPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      CodeLocatorPanel.viewType,
      'AUTOSAR Code Locator',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'src', 'webview', 'webview-ui')]
      }
    );

    CodeLocatorPanel.currentPanel = new CodeLocatorPanel(
      panel, extensionUri, gitnexus, copilot, queryEngine
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    gitnexus: GitNexusService,
    copilot: CopilotLMService,
    queryEngine: QueryEngine
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._gitnexus = gitnexus;
    this._copilot = copilot;
    this._queryEngine = queryEngine;

    this._panel.webview.html = this._getHtmlContent();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Listen for messages from WebView
    this._panel.webview.onDidReceiveMessage(
      (msg) => this._handleMessage(msg),
      null,
      this._disposables
    );

    // Forward GitNexus status changes
    this._gitnexus.onStatusChanged((status) => {
      this._postMessage({ type: 'statusUpdate', status });
    });

    // Listen for model availability changes (models may load after extension activation)
    if (vscode.lm?.onDidChangeChatModels) {
      vscode.lm.onDidChangeChatModels(() => {
        this._loadModels();
      }, null, this._disposables);
    }
  }

  private async _loadModels() {
    try {
      const models = await this._copilot.getAvailableModels();
      this._postMessage({ type: 'modelsLoaded', models: Array.isArray(models) ? models : [] });
    } catch (e: any) {
      console.error('[AUTOSAR Locator] Failed to load models:', e?.message ?? e);
      try {
        this._postMessage({ type: 'modelsLoaded', models: [] });
      } catch {
        // Panel may be disposed — ignore
      }
    }
  }

  private async _handleMessage(msg: any) {
    switch (msg.type) {
      case 'checkStatus': {
        // Run both independently — one failing must not block the other
        const statusPromise = this._checkStatus().catch(() => {});
        const modelsPromise = this._loadModels().catch(() => {});
        await Promise.allSettled([statusPromise, modelsPromise]);
        break;
      }

      case 'buildIndex':
        await this._buildIndex(msg.force, msg.withEmbeddings);
        break;

      case 'search':
        await this._search(msg.query, msg.queryType);
        break;

      case 'selectModel':
        this._copilot.selectModel(msg.modelId);
        break;

      case 'openFile':
        await this._openFile(msg.filePath, msg.line);
        break;

      case 'importQueries':
        await this._importQueries();
        break;

      case 'exportResults':
        await this._exportResults();
        break;

      case 'runBatch':
        await this._runBatch();
        break;

      case 'investigateDeeper':
        await this._investigateDeeper(msg.suspectId);
        break;

      case 'generateTestChecklist':
        await this._generateTestChecklist();
        break;
    }
  }

  private async _checkStatus() {
    const status = await this._gitnexus.checkStatus();
    this._postMessage({ type: 'statusUpdate', status });
  }

  private async _buildIndex(force: boolean, withEmbeddings: boolean) {
    this._postMessage({
      type: 'statusUpdate',
      status: { state: 'indexing', progress: { phase: 'Starting', percent: 0 } }
    });
    // Clear previous log and show console
    this._postMessage({ type: 'indexLogClear' });

    try {
      await this._gitnexus.buildIndex({
        force,
        withEmbeddings,
        onProgress: (phase, percent, detail) => {
          this._postMessage({
            type: 'indexProgress', phase, percent, detail
          });
        },
        onLog: (line) => {
          this._postMessage({ type: 'indexLog', line });
        }
      });
      await this._checkStatus();
    } catch (e: any) {
      this._postMessage({
        type: 'statusUpdate',
        status: { state: 'error', error: e.message }
      });
    }
  }

  private async _search(query: string, queryType: string) {
    this._postMessage({ type: 'searchStarted' });

    try {
      const results = await this._queryEngine.search(query, queryType, {
        onProgress: (phase, detail) => {
          this._postMessage({ type: 'searchProgress', phase, detail });
        }
      });
      this._postMessage({ type: 'searchResults', results });
    } catch (e: any) {
      this._postMessage({ type: 'error', message: e.message });
    }
  }

  private async _openFile(filePath: string, line: number) {
    try {
      // Resolve relative paths against workspace root
      let resolved = filePath;
      if (!path.isAbsolute(filePath)) {
        const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (wsFolder) {
          resolved = path.join(wsFolder, filePath);
        }
      }
      const uri = vscode.Uri.file(resolved);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc, {
        selection: new vscode.Range(
          Math.max(0, line - 1), 0,
          Math.max(0, line - 1), 0
        ),
        preserveFocus: false
      });
      // Highlight the line
      const range = new vscode.Range(line - 1, 0, line - 1, Number.MAX_SAFE_INTEGER);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    } catch (e: any) {
      vscode.window.showErrorMessage(`Cannot open file: ${filePath} — ${e.message}`);
    }
  }

  private async _importQueries() {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: {
        'Query files': ['json', 'csv'],
        'All files': ['*']
      },
      title: 'Import Queries'
    });
    if (!uris || uris.length === 0) { return; }

    const content = await fs.promises.readFile(uris[0].fsPath, 'utf-8');
    let queries: Array<{ id: number; description: string; queryType?: string }> = [];

    if (uris[0].fsPath.endsWith('.json')) {
      const parsed = JSON.parse(content);
      queries = Array.isArray(parsed) ? parsed : (parsed.queries || []);
    } else if (uris[0].fsPath.endsWith('.csv')) {
      const lines = content.split('\n').filter(l => l.trim());
      // Skip header if present
      const start = lines[0].toLowerCase().includes('description') ? 1 : 0;
      queries = lines.slice(start).map((line, i) => {
        const parts = line.split(',');
        return {
          id: i + 1,
          description: parts[0]?.trim().replace(/^"|"$/g, '') || '',
          queryType: parts[1]?.trim() || 'search'
        };
      });
    }

    const queue = queries.map(q => ({
      ...q,
      status: 'pending' as string
    }));

    this._postMessage({ type: 'batchQueueUpdate', queue });
  }

  private async _exportResults() {
    const uri = await vscode.window.showSaveDialog({
      filters: { 'JSON': ['json'], 'Markdown': ['md'] },
      title: 'Export Results'
    });
    if (!uri) { return; }

    // QueryEngine stores last results
    const results = this._queryEngine.getLastResults();
    if (!results) {
      vscode.window.showWarningMessage('No results to export');
      return;
    }

    if (uri.fsPath.endsWith('.md')) {
      const md = this._queryEngine.formatResultsAsMarkdown(results);
      await fs.promises.writeFile(uri.fsPath, md, 'utf-8');
    } else {
      await fs.promises.writeFile(uri.fsPath, JSON.stringify(results, null, 2), 'utf-8');
    }
    vscode.window.showInformationMessage('Results exported to ' + path.basename(uri.fsPath));
  }

  private async _runBatch() {
    await this._queryEngine.runBatch({
      onProgress: (completed, total, currentQuery) => {
        this._postMessage({ type: 'batchProgress', completed, total, currentQuery });
      },
      onComplete: (results) => {
        this._postMessage({ type: 'searchResults', results: results[results.length - 1] });
      }
    });
  }

  private async _investigateDeeper(suspectId: string) {
    this._postMessage({ type: 'searchStarted' });
    try {
      const results = await this._queryEngine.investigateDeeper(suspectId, {
        onProgress: (phase, detail) => {
          this._postMessage({ type: 'searchProgress', phase, detail });
        }
      });
      this._postMessage({ type: 'searchResults', results });
    } catch (e: any) {
      this._postMessage({ type: 'error', message: e.message });
    }
  }

  private async _generateTestChecklist() {
    this._postMessage({ type: 'searchStarted' });
    try {
      const results = await this._queryEngine.generateTestChecklist({
        onProgress: (phase, detail) => {
          this._postMessage({ type: 'searchProgress', phase, detail });
        }
      });
      this._postMessage({ type: 'searchResults', results });
    } catch (e: any) {
      this._postMessage({ type: 'error', message: e.message });
    }
  }

  private _postMessage(msg: any) {
    if (this._disposed) {
      return;
    }
    this._panel.webview.postMessage(msg);
  }

  private _getHtmlContent(): string {
    const htmlPath = path.join(
      this._extensionUri.fsPath, 'src', 'webview', 'webview-ui', 'index.html'
    );
    let html = fs.readFileSync(htmlPath, 'utf-8');

    const nonce = getNonce();
    const cspSource = this._panel.webview.cspSource;

    html = html.replace(/\$\{nonce\}/g, nonce);
    html = html.replace(/\$\{cspSource\}/g, cspSource);

    return html;
  }

  public dispose() {
    this._disposed = true;
    CodeLocatorPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) { d.dispose(); }
    }
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
