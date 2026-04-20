import type { LLMRequest, LLMResponse, ForgeConfig } from '../types.ts';

const DEFAULT_MAX_TURNS = 30;

export class LLMService {
  private config: ForgeConfig;

  constructor(config: ForgeConfig) {
    this.config = config;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const { query } = await import('@anthropic-ai/claude-code');

    const model = request.model ?? this.config.models.default;
    const maxTurns = request.maxTurns ?? DEFAULT_MAX_TURNS;

    const sdkEnv: Record<string, string> = {};
    for (const [key, val] of Object.entries(process.env)) {
      if (key === 'ANTHROPIC_API_KEY') continue;
      if (key === 'FORGE_EMBER') continue;
      if (val !== undefined) sdkEnv[key] = val;
    }

    const lastUserMsg = request.messages.findLast(m => m.role === 'user');
    if (!lastUserMsg) {
      throw new Error('No user message in request');
    }

    let fullResponse = '';
    let inputTokens = 0;
    let outputTokens = 0;

    const result = query({
      prompt: lastUserMsg.content,
      options: {
        model,
        customSystemPrompt: request.system,
        maxTurns,
        permissionMode: 'bypassPermissions',
        env: sdkEnv,
      },
    });

    for await (const event of result) {
      if (event.type === 'assistant' && event.message) {
        for (const block of event.message.content) {
          if (block.type === 'text') {
            fullResponse += block.text;
          }
        }
      }
      if (event.type === 'result') {
        if (event.subtype === 'success') {
          inputTokens = event.usage?.input_tokens ?? 0;
          outputTokens = event.usage?.output_tokens ?? 0;
          fullResponse = typeof event.result === 'string'
            ? event.result
            : JSON.stringify(event.result);
        }
      }
    }

    return {
      content: fullResponse,
      model,
      inputTokens,
      outputTokens,
    };
  }
}
