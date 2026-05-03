import type { ForgeConfig } from '../../types.ts';
import { AnthropicApiProvider } from './providers/anthropic-api.ts';
import { ClaudeCliProvider } from './providers/claude-cli.ts';
import { CodexCliProvider } from './providers/codex-cli.ts';
import { OpenAIApiProvider } from './providers/openai-api.ts';
import { validateConfiguredLLMModel } from './shared.ts';
import type { LLMProvider, ProviderOptions } from './types.ts';

export function createLLMProvider(config: ForgeConfig, options: ProviderOptions = {}): LLMProvider {
  validateConfiguredLLMModel(config);
  switch (config.llm.provider) {
    case 'claude-cli':
      return new ClaudeCliProvider(config, options.runClaudeCli);
    case 'codex-cli':
      return new CodexCliProvider(config, options.runCodexCli);
    case 'openai-api':
      return new OpenAIApiProvider(config, options.openAIClient);
    case 'anthropic-api':
      return new AnthropicApiProvider(config);
    default:
      return assertNever(config.llm.provider);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported LLM provider: ${value}`);
}
