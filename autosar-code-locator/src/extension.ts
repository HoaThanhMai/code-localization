import * as vscode from 'vscode';
import { GitNexusService } from './services/GitNexusService';
import { CopilotLMService } from './services/CopilotLMService';
import { QueryEngine } from './services/QueryEngine';
import { CodeLocatorPanel } from './webview/panel';

let gitnexus: GitNexusService;
let copilot: CopilotLMService;
let queryEngine: QueryEngine;

export function activate(context: vscode.ExtensionContext) {
  // Initialize services
  gitnexus = new GitNexusService(context);
  copilot = new CopilotLMService();
  queryEngine = new QueryEngine(gitnexus, copilot);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('autosarLocator.openPanel', () => {
      CodeLocatorPanel.createOrShow(
        context.extensionUri,
        gitnexus,
        copilot,
        queryEngine
      );
    }),

    vscode.commands.registerCommand('autosarLocator.buildIndex', async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Building GitNexus index...',
          cancellable: false,
        },
        async (progress) => {
          await gitnexus.buildIndex({
            force: false,
            withEmbeddings: true,
            onProgress: (phase, percent) => {
              progress.report({
                message: `${phase} ${percent >= 0 ? percent + '%' : ''}`,
                increment: percent >= 0 ? percent : undefined,
              });
            },
          });
        }
      );
      vscode.window.showInformationMessage('GitNexus index built successfully.');
    }),

    vscode.commands.registerCommand('autosarLocator.searchFromSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }

      const selection = editor.document.getText(editor.selection);
      if (!selection.trim()) {
        vscode.window.showWarningMessage('Select some text first');
        return;
      }

      // Open panel with the selection pre-filled
      CodeLocatorPanel.createOrShow(
        context.extensionUri,
        gitnexus,
        copilot,
        queryEngine
      );

      // Small delay to let WebView initialize, then send prefill message
      setTimeout(() => {
        CodeLocatorPanel.currentPanel?.['_postMessage']({
          type: 'prefillQuery',
          query: selection.trim(),
        });
      }, 500);
    })
  );

  // Status bar item
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.command = 'autosarLocator.openPanel';
  statusBarItem.text = '$(search) AUTOSAR Locator';
  statusBarItem.tooltip = 'Open AUTOSAR Code Locator';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Check GitNexus status on activation
  gitnexus.checkStatus().then((status) => {
    if (status.state === 'indexed') {
      statusBarItem.text = '$(search) AUTOSAR Locator $(check)';
    } else if (status.state === 'error') {
      statusBarItem.text = '$(search) AUTOSAR Locator $(warning)';
    }
  });

  // Clean up on deactivation
  context.subscriptions.push({
    dispose: () => {
      gitnexus.dispose();
    },
  });
}

export function deactivate() {
  gitnexus?.dispose();
}
