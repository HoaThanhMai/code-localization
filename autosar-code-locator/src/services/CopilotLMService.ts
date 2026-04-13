import * as vscode from 'vscode';

export interface ModelInfo {
  id: string;
  name: string;
  vendor: string;
}

export class CopilotLMService {
  private selectedModel: vscode.LanguageModelChat | null = null;
  private availableModels: vscode.LanguageModelChat[] = [];

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

  async chat(systemPrompt: string, userMessage: string): Promise<string> {
    if (!this.selectedModel) {
      await this.selectModelFromConfig();
    }
    if (!this.selectedModel) {
      throw new Error('No Copilot language model available. Is GitHub Copilot Chat installed?');
    }

    const messages = [
      vscode.LanguageModelChatMessage.User(`${systemPrompt}\n\n${userMessage}`),
    ];

    const totalLength = systemPrompt.length + userMessage.length;
    console.log(`[CopilotLM] Sending request to ${this.selectedModel.id}, prompt size: ~${(totalLength / 1000).toFixed(1)}K chars`);

    let response;
    try {
      response = await this.selectedModel.sendRequest(messages, {});
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
  async chatMultiTurn(turns: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<string> {
    if (!this.selectedModel) {
      await this.selectModelFromConfig();
    }
    if (!this.selectedModel) {
      throw new Error('No Copilot language model available. Is GitHub Copilot Chat installed?');
    }

    const messages = turns.map(t =>
      t.role === 'user'
        ? vscode.LanguageModelChatMessage.User(t.content)
        : vscode.LanguageModelChatMessage.Assistant(t.content)
    );

    const totalLength = turns.reduce((s, t) => s + t.content.length, 0);
    console.log(`[CopilotLM] Multi-turn: ${turns.length} messages, ~${(totalLength / 1000).toFixed(1)}K chars`);

    let response;
    try {
      response = await this.selectedModel.sendRequest(messages, {});
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
