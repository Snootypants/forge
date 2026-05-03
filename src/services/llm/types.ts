import type { ForgeConfig, LLMRequest, LLMResponse } from '../../types.ts';

export interface LLMProvider {
  name: string;
  complete(request: LLMRequest): Promise<LLMResponse>;
}

export interface CliRunOptions {
  env: Record<string, string>;
  stdin: string;
  cwd?: string;
  maxOutputBytes?: number;
}

export interface CliRunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export type ProviderCliRunner = (args: string[], options: CliRunOptions) => Promise<CliRunResult>;

export interface OpenAIResponseLike {
  output_text?: string | null;
  usage?: {
    input_tokens?: number | null;
    output_tokens?: number | null;
  } | null;
}

export interface OpenAIResponsesClient {
  responses: {
    create(params: {
      model: string;
      instructions?: string;
      input: Array<{
        type: 'message';
        role: 'user' | 'assistant' | 'system';
        content: string;
      }>;
    }): Promise<OpenAIResponseLike>;
  };
}

export interface ProviderOptions {
  runClaudeCli?: ProviderCliRunner;
  runCodexCli?: ProviderCliRunner;
  openAIClient?: OpenAIResponsesClient;
}

export interface LLMServiceOptions extends ProviderOptions {
  provider?: LLMProvider;
}

export type ProviderFactory = (config: ForgeConfig, options?: ProviderOptions) => LLMProvider;
