import { resolveKey } from '../../../config.ts';
import type { ChatMessage, ForgeConfig, LLMRequest, LLMResponse } from '../../../types.ts';
import { ensureUserMessage, extractText, formatProviderError, isRecord, resolveProviderModel, sanitizeProviderError } from '../shared.ts';
import type { LLMProvider } from '../types.ts';

export class AnthropicApiProvider implements LLMProvider {
  readonly name = 'anthropic-api';
  private config: ForgeConfig;

  constructor(config: ForgeConfig) {
    this.config = config;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    ensureUserMessage(request);
    const apiKey = resolveKey(this.config.api.anthropic) ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('Anthropic API provider requires ANTHROPIC_API_KEY or api.anthropic');
    }

    const model = resolveProviderModel(this.config, request, this.name);
    let response: Response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          system: toAnthropicSystem(request.system, request.messages),
          max_tokens: 4096,
          messages: toAnthropicMessages(request.messages),
        }),
      });
    } catch (err) {
      throw new Error(formatProviderError('Anthropic API failed:', err));
    }

    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Anthropic API failed: ${sanitizeProviderError(body || response.statusText)}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = {};
    }

    const record = isRecord(parsed) ? parsed : {};
    const usage = isRecord(record.usage) ? record.usage : {};
    return {
      content: extractText(record.content) ?? '',
      provider: this.name,
      model,
      inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
      outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
    };
  }
}

function toAnthropicMessages(messages: ChatMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages
    .filter(message => message.role !== 'system')
    .map(message => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
    }));
}

function toAnthropicSystem(system: string, messages: ChatMessage[]): string {
  const inlineSystem = messages
    .filter(message => message.role === 'system')
    .map(message => message.content.trim())
    .filter(Boolean);
  return [system.trim(), ...inlineSystem].filter(Boolean).join('\n\n');
}
