import { resolveKey } from '../../../config.ts';
import type { ForgeConfig, LLMRequest, LLMResponse } from '../../../types.ts';
import { buildCliEnv, ensureUserMessage, extractText, isRecord, makeCommandRunner, resolveProviderModel, sanitizeProviderError, serializeTranscript } from '../shared.ts';
import type { LLMProvider, ProviderCliRunner } from '../types.ts';

export class ClaudeCliProvider implements LLMProvider {
  readonly name = 'claude-cli';
  private config: ForgeConfig;
  private runClaudeCli: ProviderCliRunner;

  constructor(config: ForgeConfig, runClaudeCli?: ProviderCliRunner) {
    this.config = config;
    this.runClaudeCli = runClaudeCli ?? makeCommandRunner(config.llm.command ?? 'claude');
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    ensureUserMessage(request);
    const model = resolveProviderModel(this.config, request, this.name);

    const args = [
      '--print',
      '--output-format',
      'json',
      '--model',
      model,
      '--no-session-persistence',
      '--system-prompt',
      request.system,
    ];

    if (this.config.llm.permission_mode === 'yolo') {
      args.push('--permission-mode', 'bypassPermissions');
    }

    const anthropicApiKey = resolveKey(this.config.api.anthropic);
    if (anthropicApiKey) {
      args.push('--bare');
    }

    const result = await this.runClaudeCli(args, {
      env: buildCliEnv({ ANTHROPIC_API_KEY: anthropicApiKey }),
      stdin: serializeTranscript(request.messages),
      cwd: this.config.llm.workdir,
    });

    if (result.code !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
      throw new Error(`Claude CLI failed: ${sanitizeProviderError(detail)}`);
    }

    return {
      ...parseClaudeJson(result.stdout),
      provider: this.name,
      model,
    };
  }
}

function parseClaudeJson(stdout: string): Pick<LLMResponse, 'content' | 'inputTokens' | 'outputTokens'> {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { content: '', inputTokens: 0, outputTokens: 0 };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { content: trimmed, inputTokens: 0, outputTokens: 0 };
  }

  const record = isRecord(parsed) ? parsed : {};
  const usage = isRecord(record.usage) ? record.usage : {};

  return {
    content: extractText(record.result) ?? extractText(record.message) ?? extractText(record.content) ?? trimmed,
    inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
    outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
  };
}
