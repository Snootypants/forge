import type { ForgeConfig, LLMRequest, LLMResponse } from '../../types.ts';
import { createLLMProvider } from './factory.ts';
import type { LLMProvider, LLMServiceOptions } from './types.ts';

export class LLMService {
  private config: ForgeConfig;
  private options: LLMServiceOptions;
  private provider: LLMProvider;

  constructor(config: ForgeConfig, options: LLMServiceOptions = {}) {
    this.config = config;
    this.options = options;
    this.provider = options.provider ?? createLLMProvider(config, options);
  }

  get providerName(): string {
    return this.provider.name;
  }

  complete(request: LLMRequest): Promise<LLMResponse> {
    const provider = this.providerForRequest(request);
    return provider.complete(request);
  }

  private providerForRequest(request: LLMRequest): LLMProvider {
    if (!request.provider || request.provider === this.config.llm.provider) {
      return this.provider;
    }

    const config: ForgeConfig = {
      ...this.config,
      llm: {
        ...this.config.llm,
        provider: request.provider,
        model: undefined,
        command: undefined,
      },
    };
    return createLLMProvider(config, this.options);
  }
}
