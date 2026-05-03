import { spawn } from 'node:child_process';
import path from 'node:path';
import type { ChatMessage, ForgeConfig, LLMRequest } from '../../types.ts';
import type { CliRunOptions, CliRunResult, ProviderCliRunner } from './types.ts';

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
type LLMProviderId = ForgeConfig['llm']['provider'];
type ModelSource = 'configured llm.model' | 'request model' | 'fallback model';

export type ProviderAuthRequirement = 'anthropic-api-key' | 'openai-api-key' | 'claude-oauth-or-anthropic-key' | 'none';

export interface LLMProviderRequirement {
  provider: LLMProviderId;
  label: string;
  auth: ProviderAuthRequirement;
  defaultModel: string;
  configuredModel: string | null;
  effectiveModel: string;
  modelCompatible: boolean;
}

const PROVIDERS: Record<LLMProviderId, Omit<LLMProviderRequirement, 'provider' | 'configuredModel' | 'effectiveModel' | 'modelCompatible'>> = {
  'claude-cli': {
    label: 'Claude CLI',
    auth: 'claude-oauth-or-anthropic-key',
    defaultModel: 'claude-sonnet-4-6',
  },
  'codex-cli': {
    label: 'Codex CLI',
    auth: 'openai-api-key',
    defaultModel: 'gpt-5.2',
  },
  'openai-api': {
    label: 'OpenAI API',
    auth: 'openai-api-key',
    defaultModel: 'gpt-5.2',
  },
  'anthropic-api': {
    label: 'Anthropic API',
    auth: 'anthropic-api-key',
    defaultModel: 'claude-sonnet-4-6',
  },
};

export function serializeTranscript(messages: ChatMessage[]): string {
  return JSON.stringify(messages, null, 2);
}

export function serializePromptWithSystem(request: LLMRequest): string {
  return JSON.stringify({
    system: request.system,
    messages: request.messages,
  }, null, 2);
}

export function ensureUserMessage(request: LLMRequest): void {
  if (!request.messages.some(m => m.role === 'user')) {
    throw new Error('No user message in request');
  }
}

export function resolveModel(config: ForgeConfig, request: LLMRequest, fallback: string): string {
  return request.model ?? config.llm.model ?? fallback;
}

export function resolveProviderModel(config: ForgeConfig, request: LLMRequest, provider: LLMProviderId): string {
  const source: ModelSource = request.model
    ? 'request model'
    : config.llm.model
      ? 'configured llm.model'
      : 'fallback model';
  const model = request.model ?? config.llm.model ?? providerDefaultModel(provider);
  validateProviderModel(provider, model, source);
  return model;
}

export function providerDefaultModel(provider: LLMProviderId): string {
  return PROVIDERS[provider].defaultModel;
}

export function validateConfiguredLLMModel(config: ForgeConfig): void {
  if (config.llm.model) {
    validateProviderModel(config.llm.provider, config.llm.model, 'configured llm.model');
  }
}

export function validateProviderModel(provider: LLMProviderId, model: string, source: ModelSource = 'request model'): void {
  const normalized = model.trim().toLowerCase();
  if (!normalized) {
    throw new Error(`${source} must not be empty`);
  }

  const expectsClaude = provider === 'claude-cli' || provider === 'anthropic-api';
  const looksClaude = normalized.startsWith('claude-');
  const looksOpenAI = normalized.startsWith('gpt-')
    || normalized.startsWith('o1')
    || normalized.startsWith('o3')
    || normalized.startsWith('o4')
    || normalized.startsWith('o5')
    || normalized.startsWith('chatgpt-')
    || normalized.startsWith('codex-')
    || normalized.startsWith('computer-use-');

  if (expectsClaude && looksOpenAI) {
    throw incompatibleModelError(provider, model, source, 'Claude/Anthropic');
  }
  if (!expectsClaude && looksClaude) {
    throw incompatibleModelError(provider, model, source, 'OpenAI/Codex');
  }
}

function incompatibleModelError(provider: LLMProviderId, model: string, source: ModelSource, expected: string): Error {
  return new Error(
    `${source} "${model}" is not compatible with ${PROVIDERS[provider].label}; expected a ${expected} model. `
    + 'Set llm.model for this provider or remove it to use the provider default.',
  );
}

export function getLLMProviderRequirements(config: ForgeConfig): {
  selectedProvider: LLMProviderId;
  providers: LLMProviderRequirement[];
} {
  const providers = (Object.keys(PROVIDERS) as LLMProviderId[]).map((provider) => {
    const configuredModel = config.llm.provider === provider ? config.llm.model ?? null : null;
    const effectiveModel = configuredModel ?? providerDefaultModel(provider);
    let modelCompatible = true;
    try {
      validateProviderModel(provider, effectiveModel, configuredModel ? 'configured llm.model' : 'fallback model');
    } catch {
      modelCompatible = false;
    }
    return {
      provider,
      ...PROVIDERS[provider],
      configuredModel,
      effectiveModel,
      modelCompatible,
    };
  });

  return {
    selectedProvider: config.llm.provider,
    providers,
  };
}

export function buildCliEnv(extra: Record<string, string | null | undefined> = {}): Record<string, string> {
  const allowed = [
    'CODEX_HOME',
    'HOME',
    'PATH',
    'SHELL',
    'TERM',
    'TMPDIR',
    'USER',
    'XDG_CONFIG_HOME',
    'XDG_CACHE_HOME',
    'XDG_DATA_HOME',
  ];
  const env: Record<string, string> = {};
  for (const key of allowed) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }
  env.PATH = [path.join(process.cwd(), 'node_modules', '.bin'), env.PATH].filter(Boolean).join(path.delimiter);
  for (const [key, val] of Object.entries(extra)) {
    if (val !== undefined && val !== null) env[key] = val;
  }
  return env;
}

export function makeCommandRunner(command: string): ProviderCliRunner {
  return (args, options) => runCommand(command, args, options);
}

function runCommand(command: string, args: string[], options: CliRunOptions): Promise<CliRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflow: 'stdout' | 'stderr' | null = null;
    const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

    child.stdout?.on('data', (chunk: Buffer) => {
      const next = appendLimited(stdout, stdoutBytes, chunk, maxOutputBytes);
      stdout = next.value;
      stdoutBytes = next.bytes;
      if (next.overflow) killForOverflow('stdout');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const next = appendLimited(stderr, stderrBytes, chunk, maxOutputBytes);
      stderr = next.value;
      stderrBytes = next.bytes;
      if (next.overflow) killForOverflow('stderr');
    });
    child.on('error', reject);
    child.on('close', code => {
      if (overflow) {
        const message = `[forge] ${overflow} exceeded ${maxOutputBytes} bytes; subprocess killed and output truncated`;
        stderr = stderr ? `${stderr.trimEnd()}\n${message}\n` : `${message}\n`;
      }
      resolve({ stdout, stderr, code: overflow ? null : code });
    });

    child.stdin.end(options.stdin);

    function killForOverflow(stream: 'stdout' | 'stderr'): void {
      if (overflow) return;
      overflow = stream;
      child.kill('SIGTERM');
    }
  });
}

function appendLimited(
  value: string,
  currentBytes: number,
  chunk: Buffer,
  maxBytes: number,
): { value: string; bytes: number; overflow: boolean } {
  if (currentBytes >= maxBytes) {
    return { value, bytes: currentBytes, overflow: true };
  }

  const remaining = maxBytes - currentBytes;
  if (chunk.byteLength <= remaining) {
    return { value: value + chunk.toString('utf-8'), bytes: currentBytes + chunk.byteLength, overflow: false };
  }

  return {
    value: value + chunk.subarray(0, remaining).toString('utf-8'),
    bytes: maxBytes,
    overflow: true,
  };
}

export function sanitizeProviderError(error: unknown, fallback = 'Provider request failed'): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const cleaned = raw
    .replace(/\bsk-ant-[A-Za-z0-9_-]{8,}\b/g, 'sk-ant-[redacted]')
    .replace(/\bsk-proj-[A-Za-z0-9_-]{8,}\b/g, 'sk-proj-[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[redacted]')
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{8,}\b/g, 'xox[redacted]')
    .replace(/\b(bearer|authorization|api[_-]?key|token|password|secret)(["'\s:=]+)(["']?)[^"',}\s]+/gi, '$1$2$3[redacted]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ')
    .trim();

  return (cleaned || fallback).slice(0, 500);
}

export function formatProviderError(provider: string, error: unknown, fallback = 'request failed'): string {
  return `${provider} ${sanitizeProviderError(error, fallback)}`;
}

export function extractText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const parts = value.map(extractText).filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join('') : null;
  }
  if (!isRecord(value)) return null;

  if (typeof value.text === 'string') return value.text;
  if (Array.isArray(value.content)) return extractText(value.content);
  return null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
