import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveKey, saveEnvValue } from '../config.ts';
import type { ForgeConfig, KeyRef } from '../types.ts';
import { getLLMProviderRequirements, sanitizeProviderError, type ProviderAuthRequirement } from '../services/llm/shared.ts';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export type AuthStatus = 'authenticated' | 'not_authenticated' | 'checking' | 'error';

export interface AuthState {
  claude: AuthStatus;
  anthropic: AuthStatus;
  slack: AuthStatus;
  openai: AuthStatus;
  selectedProvider: ForgeConfig['llm']['provider'];
  providers: ProviderAuthStatus[];
}

export interface ProviderAuthStatus {
  provider: ForgeConfig['llm']['provider'];
  label: string;
  requirement: ProviderAuthRequirement;
  status: AuthStatus;
}

export function checkClaudeAuth(config?: ForgeConfig): AuthStatus {
  if (resolveConfiguredKey(config?.api.anthropic, 'ANTHROPIC_API_KEY')) {
    return 'authenticated';
  }

  try {
    const result = execFileSync('claude', ['auth', 'status', '--json'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: claudeEnv(),
    });
    const status = JSON.parse(result);
    return status.loggedIn ? 'authenticated' : 'not_authenticated';
  } catch {
    return 'not_authenticated';
  }
}

export function checkSlackAuth(config?: ForgeConfig): AuthStatus {
  const botToken = resolveConfiguredKey(config?.api.slack?.bot_token, 'SLACK_BOT_TOKEN');
  const appToken = resolveConfiguredKey(config?.api.slack?.app_token, 'SLACK_APP_TOKEN');
  if (botToken && appToken) return 'authenticated';
  return 'not_authenticated';
}

export function checkAnthropicAuth(config?: ForgeConfig): AuthStatus {
  if (resolveConfiguredKey(config?.api.anthropic, 'ANTHROPIC_API_KEY')) return 'authenticated';
  return 'not_authenticated';
}

export function checkOpenAIAuth(config?: ForgeConfig): AuthStatus {
  if (resolveConfiguredKey(config?.api.openai, 'OPENAI_API_KEY')) return 'authenticated';
  return 'not_authenticated';
}

export function getAuthState(config?: ForgeConfig): AuthState {
  const claude = checkClaudeAuth(config);
  const anthropic = checkAnthropicAuth(config);
  const openai = checkOpenAIAuth(config);
  const selectedProvider = config?.llm.provider ?? 'claude-cli';
  return {
    claude,
    anthropic,
    slack: checkSlackAuth(config),
    openai,
    selectedProvider,
    providers: getProviderAuthStatuses(config, { claude, anthropic, openai }),
  };
}

export function startClaudeOAuth(): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn('claude', ['auth', 'login'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: claudeEnv(),
    });

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({ success: false, error: sanitizeProviderError(stderr || `Exit code ${code}`) });
      }
    });

    child.on('error', (err) => {
      resolve({ success: false, error: sanitizeProviderError(err) });
    });

    setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ success: false, error: 'OAuth flow timed out (5 min)' });
    }, 300_000);
  });
}

export function saveSlackTokens(botToken: string, appToken: string, envPath?: string, config?: ForgeConfig): void {
  saveToken(config?.api.slack?.bot_token?.env ?? 'SLACK_BOT_TOKEN', botToken, envPath);
  saveToken(config?.api.slack?.app_token?.env ?? 'SLACK_APP_TOKEN', appToken, envPath);
}

export function saveOpenAIKey(apiKey: string, envPath?: string, config?: ForgeConfig): void {
  saveToken(config?.api.openai?.env ?? 'OPENAI_API_KEY', apiKey, envPath);
}

export function saveAnthropicKey(apiKey: string, envPath?: string, config?: ForgeConfig): void {
  saveToken(config?.api.anthropic?.env ?? 'ANTHROPIC_API_KEY', apiKey, envPath);
}

function getProviderAuthStatuses(
  config: ForgeConfig | undefined,
  statuses: { claude: AuthStatus; anthropic: AuthStatus; openai: AuthStatus },
): ProviderAuthStatus[] {
  if (!config) {
    return [];
  }

  return getLLMProviderRequirements(config).providers.map(provider => ({
    provider: provider.provider,
    label: provider.label,
    requirement: provider.auth,
    status: statusForRequirement(provider.auth, statuses),
  }));
}

function statusForRequirement(
  requirement: ProviderAuthRequirement,
  statuses: { claude: AuthStatus; anthropic: AuthStatus; openai: AuthStatus },
): AuthStatus {
  switch (requirement) {
    case 'anthropic-api-key':
      return statuses.anthropic;
    case 'openai-api-key':
      return statuses.openai;
    case 'claude-oauth-or-anthropic-key':
      return statuses.anthropic === 'authenticated' ? statuses.anthropic : statuses.claude;
    case 'none':
      return 'authenticated';
    default:
      return 'not_authenticated';
  }
}

function resolveConfiguredKey(ref: KeyRef | undefined, fallbackEnv: string): string | null {
  return resolveKey(ref) ?? process.env[fallbackEnv] ?? null;
}

function saveToken(envName: string, value: string, envPath?: string): void {
  saveEnvValue(envName, value, envPath);
  process.env[envName] = value;
}

function claudeEnv(): NodeJS.ProcessEnv {
  const allowed = [
    'CLAUDE_CONFIG_DIR',
    'HOME',
    'PATH',
    'SHELL',
    'TERM',
    'TMPDIR',
    'USER',
    'XDG_CACHE_HOME',
    'XDG_CONFIG_HOME',
    'XDG_DATA_HOME',
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowed) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  env.PATH = [path.join(PROJECT_ROOT, 'node_modules', '.bin'), env.PATH].filter(Boolean).join(path.delimiter);
  return env;
}
