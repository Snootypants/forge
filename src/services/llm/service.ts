import type { ForgeConfig, LLMRequest, LLMResponse } from '../../types.ts';
import { createLLMProvider } from './factory.ts';
import type { LLMProvider, LLMServiceOptions } from './types.ts';

export class LLMService {
  private provider: LLMProvider;

  constructor(config: ForgeConfig, options: LLMServiceOptions = {}) {
    this.provider = options.provider ?? createLLMProvider(config, options);
  }

  get providerName(): string {
    return this.provider.name;
  }

  complete(request: LLMRequest): Promise<LLMResponse> {
    return this.provider.complete(request);
  }
}
