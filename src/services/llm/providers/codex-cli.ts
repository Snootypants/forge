import { resolveKey } from '../../../config.ts';
import type { ForgeConfig, LLMRequest, LLMResponse } from '../../../types.ts';
import { buildCliEnv, ensureUserMessage, extractText, isRecord, makeCommandRunner, resolveProviderCommand, resolveProviderModel, sanitizeProviderError, serializePromptWithSystem } from '../shared.ts';
import type { LLMProvider, ProviderCliRunner } from '../types.ts';

export class CodexCliProvider implements LLMProvider {
  readonly name = 'codex-cli';
  private config: ForgeConfig;
  private runCodexCli: ProviderCliRunner;

  constructor(config: ForgeConfig, runCodexCli?: ProviderCliRunner) {
    this.config = config;
    this.runCodexCli = runCodexCli ?? makeCommandRunner(resolveProviderCommand(config, this.name));
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    ensureUserMessage(request);
    const model = resolveProviderModel(this.config, request, this.name);
    const prompt = serializePromptWithSystem(request);

    const args = [
      'exec',
      '--model',
      model,
      '--ephemeral',
      '--color',
      'never',
      '-',
    ];

    if (this.config.llm.workdir) {
      args.splice(args.length - 1, 0, '--cd', this.config.llm.workdir);
    }

    if ((request.permissionMode ?? this.config.llm.permission_mode) === 'yolo') {
      args.splice(args.length - 1, 0, '--dangerously-bypass-approvals-and-sandbox');
    }

    const openaiApiKey = resolveKey(this.config.api.openai);
    const result = await this.runCodexCli(args, {
      env: buildCliEnv({ OPENAI_API_KEY: openaiApiKey }),
      stdin: prompt,
      cwd: this.config.llm.workdir,
    });

    if (result.code !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
      throw new Error(`Codex CLI failed: ${sanitizeProviderError(detail)}`);
    }

    const parsed = parseCodexOutput(result.stdout);
    return {
      content: parsed.content,
      provider: this.name,
      model,
      inputTokens: parsed.inputTokens ?? estimateTokens(prompt),
      outputTokens: parsed.outputTokens ?? estimateTokens(parsed.content),
    };
  }
}

function parseCodexOutput(stdout: string): { content: string; inputTokens?: number; outputTokens?: number } {
  const trimmed = stdout.trim();
  if (!trimmed) return { content: '' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { content: trimmed };
  }

  const record = isRecord(parsed) ? parsed : {};
  const usage = isRecord(record.usage) ? record.usage : {};
  return {
    content: extractText(record.output_text) ?? extractText(record.result) ?? extractText(record.message) ?? extractText(record.content) ?? trimmed,
    inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined,
    outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined,
  };
}

function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}
