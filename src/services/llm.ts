import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveKey } from '../config.ts';
import type { LLMRequest, LLMResponse, ForgeConfig } from '../types.ts';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export interface ClaudeCliRunOptions {
  env: Record<string, string>;
  stdin: string;
}

export interface ClaudeCliRunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export type ClaudeCliRunner = (args: string[], options: ClaudeCliRunOptions) => Promise<ClaudeCliRunResult>;

export interface LLMServiceOptions {
  runClaudeCli?: ClaudeCliRunner;
}

export class LLMService {
  private config: ForgeConfig;
  private runClaudeCli: ClaudeCliRunner;

  constructor(config: ForgeConfig, options: LLMServiceOptions = {}) {
    this.config = config;
    this.runClaudeCli = options.runClaudeCli ?? runClaudeCli;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model ?? this.config.models.default;

    const lastUserMsg = request.messages.findLast(m => m.role === 'user');
    if (!lastUserMsg) {
      throw new Error('No user message in request');
    }

    const args = [
      '--print',
      '--output-format',
      'json',
      '--model',
      model,
      '--permission-mode',
      'bypassPermissions',
      '--no-session-persistence',
      '--system-prompt',
      request.system,
    ];

    const anthropicApiKey = resolveKey(this.config.api.anthropic);
    if (anthropicApiKey) {
      args.push('--bare');
    }

    const result = await this.runClaudeCli(args, {
      env: buildClaudeEnv(anthropicApiKey),
      stdin: lastUserMsg.content,
    });

    if (result.code !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
      throw new Error(`Claude CLI failed: ${detail}`);
    }

    return {
      ...parseClaudeJson(result.stdout),
      model,
    };
  }
}

function runClaudeCli(args: string[], options: ClaudeCliRunOptions): Promise<ClaudeCliRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', code => resolve({ stdout, stderr, code }));

    child.stdin.end(options.stdin);
  });
}

function buildClaudeEnv(anthropicApiKey: string | null): Record<string, string> {
  const allowed = [
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
  env.PATH = [path.join(PROJECT_ROOT, 'node_modules', '.bin'), env.PATH].filter(Boolean).join(path.delimiter);
  if (anthropicApiKey) {
    env.ANTHROPIC_API_KEY = anthropicApiKey;
  }
  return env;
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

function extractText(value: unknown): string | null {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
