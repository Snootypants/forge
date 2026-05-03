import OpenAI from 'openai';
import { resolveKey } from '../../../config.ts';
import type { ChatMessage, ForgeConfig, LLMRequest, LLMResponse } from '../../../types.ts';
import { ensureUserMessage, formatProviderError, resolveProviderModel } from '../shared.ts';
import type { LLMProvider, OpenAIResponsesClient } from '../types.ts';

export class OpenAIApiProvider implements LLMProvider {
  readonly name = 'openai-api';
  private config: ForgeConfig;
  private client: OpenAIResponsesClient | null = null;

  constructor(config: ForgeConfig, client?: OpenAIResponsesClient) {
    this.config = config;
    this.client = client ?? null;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    ensureUserMessage(request);
    const model = resolveProviderModel(this.config, request, this.name);
    let response;
    try {
      response = await this.getClient().responses.create({
        model,
        instructions: request.system,
        input: toOpenAIInput(request.messages),
      });
    } catch (err) {
      throw new Error(formatProviderError('OpenAI API failed:', err));
    }

    return {
      content: response.output_text ?? '',
      provider: this.name,
      model,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    };
  }

  private getClient(): OpenAIResponsesClient {
    if (this.client) return this.client;
    const apiKey = resolveKey(this.config.api.openai) ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API provider requires OPENAI_API_KEY or api.openai');
    }
    this.client = new OpenAI({ apiKey }) as OpenAIResponsesClient;
    return this.client;
  }
}

function toOpenAIInput(messages: ChatMessage[]): Array<{ type: 'message'; role: 'user' | 'assistant' | 'system'; content: string }> {
  return messages.map(message => ({
    type: 'message',
    role: message.role,
    content: message.content,
  }));
}
