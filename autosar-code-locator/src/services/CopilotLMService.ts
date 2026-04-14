import * as vscode from 'vscode';

export interface ModelInfo {
  id: string;
  name: string;
  vendor: string;
}

export class CopilotLMService {
  private selectedModel: vscode.LanguageModelChat | null = null;
  private availableModels: vscode.LanguageModelChat[] = [];
  private _cancelTokenSource: vscode.CancellationTokenSource | null = null;

  async getAvailableModels(): Promise<ModelInfo[]> {
    if (!vscode.lm?.selectChatModels) {
      console.warn('[CopilotLM] vscode.lm.selectChatModels not available');
      return [];
    }
    // Use empty selector {} to get ALL available models — vendor filter can be too restrictive
    this.availableModels = await vscode.lm.selectChatModels({vendor: 'copilot'});
    if (!this.availableModels || this.availableModels.length === 0) {
      console.warn('[CopilotLM] selectChatModels returned empty list');
      return [];
    }
    console.log('[CopilotLM] Found', this.availableModels.length, 'models:',
      this.availableModels.map(m => `${m.id} (${m.vendor})`).join(', '));
    return this.availableModels.map((m) => ({
      id: m.id,
      name: m.name,
      vendor: m.vendor,
    }));
  }

  async selectModel(modelId: string): Promise<void> {
    if (this.availableModels.length === 0) {
      await this.getAvailableModels();
    }
    this.selectedModel =
      this.availableModels.find((m) => m.id === modelId) ??
      this.availableModels[0] ??
      null;
  }

  getSelectedModelId(): string {
    return this.selectedModel?.id ?? 'unknown';
  }

  /**
   * Returns the model's max input token count (e.g. 160000 for claude-sonnet, 128000 for gpt-4o).
   * Used by QueryEngine to compute dynamic context/evidence limits at runtime.
   */
  getModelContextWindow(): number {
    return this.selectedModel?.maxInputTokens ?? 32_768;
  }

  /** Cancel any in-flight LLM request (e.g. when user closes panel or presses Stop). */
  cancelCurrentRequest(): void {
    this._cancelTokenSource?.cancel();
    this._cancelTokenSource?.dispose();
    this._cancelTokenSource = null;
  }

  /**
   * Stream a single-turn response token-by-token.
   * Calls onChunk for each piece of text as it arrives, and returns the full text when done.
   * Designed for the narrative answer phase so the UI shows progress immediately.
   */
  async chatStream(
    systemPrompt: string,
    userMessage: string,
    onChunk: (chunk: string) => void,
  ): Promise<string> {
    if (!this.selectedModel) {
      await this.selectModelFromConfig();
    }
    if (!this.selectedModel) {
      throw new Error('No Copilot language model available. Is GitHub Copilot Chat installed?');
    }

    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(`${systemPrompt}\n\n${userMessage}`),
    ];

    const totalLength = systemPrompt.length + userMessage.length;
    console.log(`[CopilotLM] chatStream to ${this.selectedModel.id}, prompt size: ~${(totalLength / 1000).toFixed(1)}K chars`);

    this._cancelTokenSource?.dispose();
    this._cancelTokenSource = new vscode.CancellationTokenSource();

    let response;
    try {
      response = await this.selectedModel.sendRequest(messages, {}, this._cancelTokenSource.token);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[CopilotLM] chatStream sendRequest failed:', msg);
      if (msg.includes('too many tokens') || msg.includes('context_length') || msg.includes('max_tokens') || msg.includes('length')) {
        throw new Error(`Prompt too large (~${(totalLength / 1000).toFixed(0)}K chars). Try a shorter query.`);
      }
      throw e;
    }

    let full = '';
    for await (const chunk of response.text) {
      full += chunk;
      onChunk(chunk);
    }

    if (!full || full.trim().length === 0) {
      throw new Error('Model returned empty response in stream mode.');
    }
    console.log(`[CopilotLM] chatStream done: ${full.length} chars`);
    return full;
  }

  async chat(systemPrompt: string, userMessage: string): Promise<string> {
    if (!this.selectedModel) {
      await this.selectModelFromConfig();
    }
    if (!this.selectedModel) {
      throw new Error('No Copilot language model available. Is GitHub Copilot Chat installed?');
    }

    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(`${systemPrompt}\n\n${userMessage}`),
    ];

    const totalLength = systemPrompt.length + userMessage.length;
    console.log(`[CopilotLM] Sending request to ${this.selectedModel.id}, prompt size: ~${(totalLength / 1000).toFixed(1)}K chars`);

    this._cancelTokenSource?.dispose();
    this._cancelTokenSource = new vscode.CancellationTokenSource();
    let response;
    try {
      response = await this.selectedModel.sendRequest(messages, {}, this._cancelTokenSource.token);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[CopilotLM] sendRequest failed:`, msg);
      // If it's a token limit error, provide a clearer message
      if (msg.includes('too many tokens') || msg.includes('context_length') || msg.includes('max_tokens') || msg.includes('length')) {
        throw new Error(`Prompt too large (~${(totalLength / 1000).toFixed(0)}K chars). Try a shorter query or reduce evidence.`);
      }
      throw e;
    }

    let result = '';
    for await (const chunk of response.text) {
      result += chunk;
    }

    if (!result || result.trim().length === 0) {
      console.warn(`[CopilotLM] Model returned empty response (prompt was ~${(totalLength / 1000).toFixed(1)}K chars)`);
      throw new Error(`Model returned empty response. Prompt may be too large (~${(totalLength / 1000).toFixed(0)}K chars).`);
    }

    console.log(`[CopilotLM] Response received: ${result.length} chars`);
    return result;
  }

  /**
   * Multi-turn conversation. Each turn is { role, content }.
   * The LLM sees the full conversation history, maintaining context across turns.
   */
  async chatMultiTurn(turns: Array<{ role: 'user' | 'assistant'; content: string }>, systemPrompt?: string): Promise<string> {
    if (!this.selectedModel) {
      await this.selectModelFromConfig();
    }
    if (!this.selectedModel) {
      throw new Error('No Copilot language model available. Is GitHub Copilot Chat installed?');
    }

    // Merge system prompt into the first user message (VS Code LM API pre-1.97 compatibility).
    // This keeps instructions at the top of the conversation and ensures the model sees them
    // as high-priority context regardless of which turn we're on.
    const messagesWithSystem = systemPrompt && turns.length > 0 && turns[0].role === 'user'
      ? [{ role: 'user' as const, content: `${systemPrompt}\n\n${turns[0].content}` }, ...turns.slice(1)]
      : turns;

    const messages: vscode.LanguageModelChatMessage[] = messagesWithSystem.map(t =>
      t.role === 'user'
        ? vscode.LanguageModelChatMessage.User(t.content)
        : vscode.LanguageModelChatMessage.Assistant(t.content)
    );

    const totalLength = turns.reduce((s, t) => s + t.content.length, 0);
    console.log(`[CopilotLM] Multi-turn: ${turns.length} messages, ~${(totalLength / 1000).toFixed(1)}K chars`);

    this._cancelTokenSource?.dispose();
    this._cancelTokenSource = new vscode.CancellationTokenSource();
    let response;
    try {
      response = await this.selectedModel.sendRequest(messages, {}, this._cancelTokenSource.token);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[CopilotLM] sendRequest failed:`, msg);
      if (msg.includes('too many tokens') || msg.includes('context_length') || msg.includes('max_tokens') || msg.includes('length')) {
        throw new Error(`Prompt too large (~${(totalLength / 1000).toFixed(0)}K chars). Try a shorter query or reduce evidence.`);
      }
      throw e;
    }

    let result = '';
    for await (const chunk of response.text) {
      result += chunk;
    }

    if (!result || result.trim().length === 0) {
      console.warn(`[CopilotLM] Multi-turn returned empty response`);
      throw new Error(`Model returned empty response in multi-turn conversation.`);
    }

    console.log(`[CopilotLM] Response: ${result.length} chars`);
    return result;
  }

  private async selectModelFromConfig(): Promise<void> {
    const config = vscode.workspace.getConfiguration('autosarLocator');
    const preferred = config.get<string>('defaultModel', 'gpt-4o');
    await this.getAvailableModels();

    this.selectedModel =
      this.availableModels.find((m) => m.id.includes(preferred)) ??
      this.availableModels[0] ??
      null;
  }
}
