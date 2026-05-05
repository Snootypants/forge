import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatMessage, ForgeConfig, LLMRequest } from '../../types.ts';
import type { CliRunOptions, CliRunResult, ProviderCliRunner } from './types.ts';

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_WINDOWS_PATHEXT = ['.com', '.exe', '.bat', '.cmd'];
const WINDOWS_BATCH_EXTENSIONS = new Set(['.bat', '.cmd']);
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
type LLMProviderId = ForgeConfig['llm']['provider'];
type ModelSource = 'configured llm.model' | 'request model' | 'fallback model';

export type ProviderAuthRequirement =
  | 'anthropic-api-key'
  | 'openai-api-key'
  | 'claude-oauth-or-anthropic-key'
  | 'codex-login-or-openai-api-key'
  | 'none';

export interface LLMProviderRequirement {
  provider: LLMProviderId;
  label: string;
  auth: ProviderAuthRequirement;
  defaultModel: string;
  configuredModel: string | null;
  effectiveModel: string;
  modelCompatible: boolean;
}

export interface LLMModelOption {
  id: string;
  label: string;
  family: 'configured' | 'claude' | 'openai' | 'codex' | 'legacy';
}

export interface ResolvedCliSpawn {
  file: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

export interface ResolveCliSpawnOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fileExists?: (file: string) => boolean;
  pathDelimiter?: string;
  platform?: NodeJS.Platform;
}

const PROVIDERS: Record<LLMProviderId, Omit<LLMProviderRequirement, 'provider' | 'configuredModel' | 'effectiveModel' | 'modelCompatible'>> = {
  'claude-cli': {
    label: 'Claude CLI',
    auth: 'claude-oauth-or-anthropic-key',
    defaultModel: 'default',
  },
  'codex-cli': {
    label: 'Codex CLI',
    auth: 'codex-login-or-openai-api-key',
    defaultModel: 'gpt-5.2-codex',
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

const CLAUDE_CLI_MODELS: LLMModelOption[] = [
  { id: 'default', label: 'Default', family: 'claude' },
  { id: 'best', label: 'Best', family: 'claude' },
  { id: 'opus', label: 'Opus', family: 'claude' },
  { id: 'opus[1m]', label: 'Opus 1M', family: 'claude' },
  { id: 'sonnet', label: 'Sonnet', family: 'claude' },
  { id: 'sonnet[1m]', label: 'Sonnet 1M', family: 'claude' },
  { id: 'haiku', label: 'Haiku', family: 'claude' },
  { id: 'opusplan', label: 'Opus Plan', family: 'claude' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7', family: 'claude' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', family: 'claude' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', family: 'claude' },
];

const ANTHROPIC_API_MODELS: LLMModelOption[] = [
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', family: 'claude' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', family: 'claude' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', family: 'claude' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 Snapshot', family: 'claude' },
  { id: 'claude-opus-4-1-20250805', label: 'Claude Opus 4.1', family: 'claude' },
  { id: 'claude-opus-4-20250514', label: 'Claude Opus 4', family: 'claude' },
  { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', family: 'claude' },
  { id: 'claude-3-7-sonnet-20250219', label: 'Claude Sonnet 3.7', family: 'legacy' },
  { id: 'claude-3-5-sonnet-20241022', label: 'Claude Sonnet 3.5', family: 'legacy' },
  { id: 'claude-3-5-haiku-20241022', label: 'Claude Haiku 3.5', family: 'legacy' },
];

const OPENAI_MODELS: LLMModelOption[] = [
  { id: 'gpt-5.2', label: 'GPT-5.2', family: 'openai' },
  { id: 'gpt-5.2-pro', label: 'GPT-5.2 Pro', family: 'openai' },
  { id: 'gpt-5.2-chat-latest', label: 'GPT-5.2 Chat Latest', family: 'openai' },
  { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex', family: 'codex' },
  { id: 'gpt-5-mini', label: 'GPT-5 Mini', family: 'openai' },
  { id: 'gpt-5-nano', label: 'GPT-5 Nano', family: 'openai' },
  { id: 'gpt-4.1', label: 'GPT-4.1', family: 'openai' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', family: 'openai' },
  { id: 'gpt-4o', label: 'GPT-4o', family: 'legacy' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', family: 'legacy' },
];

const CODEX_CLI_MODELS: LLMModelOption[] = [
  { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex', family: 'codex' },
  { id: 'gpt-5.2', label: 'GPT-5.2', family: 'openai' },
  { id: 'gpt-5.2-chat-latest', label: 'GPT-5.2 Chat Latest', family: 'openai' },
  { id: 'gpt-5-mini', label: 'GPT-5 Mini', family: 'openai' },
  { id: 'gpt-5-nano', label: 'GPT-5 Nano', family: 'openai' },
  { id: 'gpt-4.1', label: 'GPT-4.1', family: 'openai' },
];

const DEFAULT_COMMANDS: Record<Extract<LLMProviderId, 'claude-cli' | 'codex-cli'>, string> = {
  'claude-cli': 'claude',
  'codex-cli': 'codex',
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
  validateCatalogProviderModel(config, provider, model, source);
  return model;
}

export function providerDefaultModel(provider: LLMProviderId): string {
  return PROVIDERS[provider].defaultModel;
}

export function providerDefaultCommand(provider: Extract<LLMProviderId, 'claude-cli' | 'codex-cli'>): string {
  return DEFAULT_COMMANDS[provider];
}

export function resolveProviderCommand(config: ForgeConfig, provider: Extract<LLMProviderId, 'claude-cli' | 'codex-cli'>): string {
  return config.llm.provider === provider
    ? config.llm.command ?? providerDefaultCommand(provider)
    : providerDefaultCommand(provider);
}

export function getLLMModelCatalog(config: ForgeConfig): Record<LLMProviderId, LLMModelOption[]> {
  const configuredActiveModel = (provider: LLMProviderId): LLMModelOption[] => (
    config.llm.model && isConfiguredModelAllowedForProvider(provider, config.llm.model)
      ? [{ id: config.llm.model, label: 'Configured active model', family: 'configured' as const }]
      : []
  );
  const roleModels: LLMModelOption[] = [
    { id: config.llm.model, label: 'Configured active model', family: 'configured' as const },
    { id: config.models.default, label: 'Role: default', family: 'configured' as const },
    { id: config.models.architect, label: 'Role: architect', family: 'configured' as const },
    { id: config.models.sentinel, label: 'Role: sentinel', family: 'configured' as const },
  ].flatMap(item => item.id ? [{ ...item, id: item.id }] : []);

  return {
    'claude-cli': uniqueModels([
      ...(config.llm.provider === 'claude-cli' ? configuredActiveModel('claude-cli') : []),
      ...roleModels.filter(item => isKnownProviderModel('claude-cli', item.id)),
      ...CLAUDE_CLI_MODELS,
    ]),
    'anthropic-api': uniqueModels([
      ...(config.llm.provider === 'anthropic-api' ? configuredActiveModel('anthropic-api') : []),
      ...roleModels.filter(item => isKnownProviderModel('anthropic-api', item.id)),
      ...ANTHROPIC_API_MODELS,
    ]),
    'codex-cli': uniqueModels([
      ...(config.llm.provider === 'codex-cli' ? configuredActiveModel('codex-cli') : []),
      ...roleModels.filter(item => isKnownProviderModel('codex-cli', item.id)),
      ...CODEX_CLI_MODELS,
    ]),
    'openai-api': uniqueModels([
      ...(config.llm.provider === 'openai-api' ? configuredActiveModel('openai-api') : []),
      ...roleModels.filter(item => isKnownProviderModel('openai-api', item.id)),
      ...OPENAI_MODELS,
    ]),
  };
}

export function isCatalogProviderModel(config: ForgeConfig, provider: LLMProviderId, model: string): boolean {
  const normalized = model.trim();
  if (!normalized) return false;
  return getLLMModelCatalog(config)[provider].some(option => option.id === normalized);
}

export function validateConfiguredLLMModel(config: ForgeConfig): void {
  if (config.llm.model) {
    validateCatalogProviderModel(config, config.llm.provider, config.llm.model, 'configured llm.model');
  }
}

export function validateProviderModel(provider: LLMProviderId, model: string, source: ModelSource = 'request model'): void {
  const normalized = model.trim();
  if (!normalized) {
    throw new Error(`${source} must not be empty`);
  }

  if (!isKnownProviderModel(provider, normalized)) {
    throw unavailableModelError(provider, model, source);
  }
}

function validateCatalogProviderModel(config: ForgeConfig, provider: LLMProviderId, model: string, source: ModelSource): void {
  const normalized = model.trim();
  if (!normalized) {
    throw new Error(`${source} must not be empty`);
  }
  if (!isCatalogProviderModel(config, provider, normalized)) {
    throw unavailableModelError(provider, model, source);
  }
}

function isKnownProviderModel(provider: LLMProviderId, model: string): boolean {
  const normalized = model.trim();
  if (!normalized) return false;
  return baseProviderModels(provider).some(option => option.id === normalized);
}

function isConfiguredModelAllowedForProvider(provider: LLMProviderId, model: string): boolean {
  if (isKnownProviderModel(provider, model)) return true;
  return !(Object.keys(PROVIDERS) as LLMProviderId[])
    .some(otherProvider => otherProvider !== provider && isKnownProviderModel(otherProvider, model));
}

function baseProviderModels(provider: LLMProviderId): LLMModelOption[] {
  switch (provider) {
    case 'claude-cli':
      return CLAUDE_CLI_MODELS;
    case 'anthropic-api':
      return ANTHROPIC_API_MODELS;
    case 'codex-cli':
      return CODEX_CLI_MODELS;
    case 'openai-api':
      return OPENAI_MODELS;
    default:
      return assertNeverProvider(provider);
  }
}

function uniqueModels(models: LLMModelOption[]): LLMModelOption[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

function unavailableModelError(provider: LLMProviderId, model: string, source: ModelSource): Error {
  return new Error(
    `${source} "${model}" is not available for ${PROVIDERS[provider].label}. `
    + 'Select a catalog model for this provider or set llm.model explicitly for the selected provider.',
  );
}

function assertNeverProvider(provider: never): never {
  throw new Error(`Unsupported LLM provider: ${provider}`);
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
      validateCatalogProviderModel(config, provider, effectiveModel, configuredModel ? 'configured llm.model' : 'fallback model');
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

export function buildCliEnv(
  extra: Record<string, string | null | undefined> = {},
  options: { binRoot?: string } = {},
): Record<string, string> {
  const allowed = [
    'APPDATA',
    'CLAUDE_CONFIG_DIR',
    'CODEX_HOME',
    'ComSpec',
    'HOME',
    'LOCALAPPDATA',
    'PATH',
    'PATHEXT',
    'ProgramData',
    'SHELL',
    'SystemDrive',
    'SystemRoot',
    'TERM',
    'TEMP',
    'TMP',
    'TMPDIR',
    'USER',
    'USERPROFILE',
    'WINDIR',
    'XDG_CONFIG_HOME',
    'XDG_CACHE_HOME',
    'XDG_DATA_HOME',
  ];
  const env: Record<string, string> = {};
  for (const key of allowed) {
    const val = readEnv(process.env, key);
    if (val !== undefined) env[key] = val;
  }
  env.PATH = [path.join(options.binRoot ?? PACKAGE_ROOT, 'node_modules', '.bin'), env.PATH].filter(Boolean).join(path.delimiter);
  for (const [key, val] of Object.entries(extra)) {
    if (val !== undefined && val !== null) env[key] = val;
  }
  return env;
}

export function makeCommandRunner(command: string): ProviderCliRunner {
  return (args, options) => runCommand(command, args, options);
}

export function resolveCliSpawn(
  command: string,
  args: string[],
  options: ResolveCliSpawnOptions = {},
): ResolvedCliSpawn {
  const platform = options.platform ?? process.platform;
  const normalizedCommand = normalizeCommand(command);
  if (!normalizedCommand) {
    throw new Error('CLI command must not be empty');
  }

  if (platform !== 'win32') {
    return { file: normalizedCommand, args: [...args] };
  }

  const resolvedFile = resolveWindowsCommand(normalizedCommand, options);
  const ext = path.win32.extname(resolvedFile).toLowerCase();
  if (!WINDOWS_BATCH_EXTENSIONS.has(ext)) {
    return { file: resolvedFile, args: [...args] };
  }

  const env = options.env ?? process.env;
  const shell = readEnv(env, 'ComSpec') ?? readEnv(env, 'COMSPEC') ?? 'cmd.exe';
  const commandLine = [resolvedFile, ...args].map(quoteWindowsCmdArg).join(' ');
  return {
    file: shell,
    args: ['/d', '/s', '/c', commandLine],
    windowsVerbatimArguments: true,
  };
}

function runCommand(command: string, args: string[], options: CliRunOptions): Promise<CliRunResult> {
  return new Promise((resolve, reject) => {
    const resolved = resolveCliSpawn(command, args, { env: options.env });
    const child = spawn(resolved.file, resolved.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsVerbatimArguments: resolved.windowsVerbatimArguments,
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

function normalizeCommand(command: string): string {
  const trimmed = command.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function resolveWindowsCommand(command: string, options: ResolveCliSpawnOptions): string {
  const fileExists = options.fileExists ?? fs.existsSync;
  const env = options.env ?? process.env;
  const pathDelimiter = options.pathDelimiter ?? ';';
  const pathExts = windowsPathExts(env);
  const hasPath = /[\\/]/.test(command);
  const roots = hasPath
    ? ['']
    : (readEnv(env, 'PATH') ?? '').split(pathDelimiter).filter(Boolean);

  for (const root of roots) {
    const base = root ? path.win32.join(root, command) : command;
    for (const candidate of windowsCommandCandidates(base, pathExts)) {
      if (fileExists(candidate)) return candidate;
    }
  }

  return command;
}

function windowsCommandCandidates(command: string, pathExts: string[]): string[] {
  if (path.win32.extname(command)) {
    return [command];
  }
  return pathExts.map(ext => `${command}${ext}`);
}

function windowsPathExts(env: NodeJS.ProcessEnv | Record<string, string | undefined>): string[] {
  const configured = readEnv(env, 'PATHEXT');
  const values = configured
    ? configured.split(';').map(ext => ext.trim()).filter(Boolean)
    : DEFAULT_WINDOWS_PATHEXT;
  return values.map(ext => (ext.startsWith('.') ? ext : `.${ext}`).toLowerCase());
}

function quoteWindowsCmdArg(arg: string): string {
  return `"${arg.replace(/([()%!^"<>&|])/g, '^$1')}"`;
}

function readEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>, key: string): string | undefined {
  const exact = env[key];
  if (exact !== undefined) return exact;
  const lower = key.toLowerCase();
  const match = Object.keys(env).find(envKey => envKey.toLowerCase() === lower);
  return match ? env[match] : undefined;
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
    .replace(/\bxapp-[A-Za-z0-9-]{8,}\b/g, 'xapp-[redacted]')
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
