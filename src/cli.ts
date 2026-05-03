#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Platform } from './platform.ts';
import { loadConfig, resolveKey, resolveWebAuthToken } from './config.ts';
import { createWebServer } from './web/server.ts';
import { resolveSlackTokens, startSlackListener } from './slack/listener.ts';
import type { BootMode, ForgeConfig, ResolvedPaths } from './types.ts';

const DEFAULT_CONFIG_FILENAME = 'forge.config.yaml';
const AUTH_TOKEN_FILENAME = 'web-auth-token';
const MIN_NODE_VERSION = [22, 6, 0] as const;

type CliCommand = 'init' | 'start' | 'doctor' | 'token' | 'help';
type Status = 'ok' | 'warn' | 'fail';

interface CliOptions {
  cwd?: string;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  startRuntime?: (args: { mode: BootMode; configPath?: string }) => Promise<void>;
  nodeVersion?: string;
}

interface ParsedArgs {
  command: CliCommand;
  mode: BootMode;
  configPath?: string;
  force: boolean;
}

interface Check {
  status: Status;
  label: string;
  message: string;
}

export async function runCli(argv: string[], options: CliOptions = {}): Promise<number> {
  const parsed = parseCliArgs(argv);
  const cwd = options.cwd ?? process.cwd();
  const out = options.stdout ?? console.log;
  const err = options.stderr ?? console.error;

  switch (parsed.command) {
    case 'init':
      return initConfig(cwd, parsed.force, out, err);
    case 'start':
      await (options.startRuntime ?? startRuntime)({
        mode: parsed.mode,
        configPath: selectConfigPath(parsed.configPath, cwd),
      });
      return 0;
    case 'doctor':
      return doctor(selectConfigPath(parsed.configPath, cwd), out, options.nodeVersion);
    case 'token':
      return tokenStatus(selectConfigPath(parsed.configPath, cwd), out);
    case 'help':
      printHelp(out);
      return 0;
  }
}

export function parseCliArgs(argv: string[]): ParsedArgs {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { command: 'help', mode: 'full', force: false };
  }

  const first = argv[0];
  const legacyStart = first === undefined || isMode(first) || isConfigFlag(first);
  const command = legacyStart ? 'start' : toCommand(first);
  const args = legacyStart ? argv : argv.slice(1);
  let mode: BootMode = 'full';
  let configPath = process.env.FORGE_CONFIG;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--config') {
      configPath = args[++i];
      if (!configPath) throw new Error('--config requires a path');
      continue;
    }
    if (arg.startsWith('--config=')) {
      configPath = arg.slice('--config='.length);
      if (!configPath) throw new Error('--config requires a path');
      continue;
    }
    if (arg === '--force') {
      force = true;
      continue;
    }
    if (isMode(arg) && command === 'start') {
      mode = arg;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (command !== 'init' && force) {
    throw new Error('--force is only supported by forge init');
  }

  return { command, mode, configPath, force };
}

export async function startRuntime(args: { mode: BootMode; configPath?: string }): Promise<void> {
  const platform = await Platform.boot(args.mode, args.configPath);
  let webServer: http.Server | null = null;

  try {
    const auth = resolveWebAuthToken(platform.config, platform.resolved);
    if (auth.source === 'generated') {
      console.log(`\n[auth] Generated web auth token and saved it to ${auth.path}`);
      console.log('[auth] Token redacted; read the saved token file on the host to log in.\n');
    } else if (auth.source === 'file') {
      console.log(`[auth] Loaded web auth token from ${auth.path}`);
    } else {
      console.log(`[auth] Loaded web auth token from ${auth.source}`);
    }

    if (args.mode === 'full' || args.mode === 'web') {
      const ctx = {
        config: platform.config,
        dbManager: platform.dbManager,
        memory: platform.memory,
        llm: platform.llm,
        authToken: auth.token,
        identity: platform.identity,
        identityDir: platform.resolved.identity,
        readIdentity: () => platform.refreshIdentity(),
        resolved: platform.resolved,
      };

      const app = createWebServer(ctx);
      const port = platform.config.services.web.port;
      const host = platform.config.services.web.host;
      webServer = await listen(app, port, host);
    }

    if (args.mode === 'full' || args.mode === 'daemon') {
      const slackTokens = resolveSlackTokens(platform.config);
      if (slackTokens.botToken && slackTokens.appToken) {
        try {
          await startSlackListener({
            config: platform.config,
            messagesDb: platform.dbManager.get('messages'),
            llm: platform.llm,
            memory: platform.memory,
            identity: platform.identity,
          });
        } catch (err) {
          console.error('[slack] Failed to start listener:', err);
          console.log('[slack] Continuing without Slack - configure tokens in settings');
        }
      } else {
        console.log('[slack] No Slack tokens found - configure in settings UI');
      }
    }

    const shutdown = () => {
      webServer?.close();
      platform.shutdown();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    console.log(`\n[forge] Ready - mode: ${args.mode}`);
  } catch (err) {
    webServer?.close();
    platform.shutdown();
    throw err;
  }
}

function initConfig(
  cwd: string,
  force: boolean,
  out: (line: string) => void,
  err: (line: string) => void,
): number {
  const configPath = path.join(cwd, DEFAULT_CONFIG_FILENAME);
  if (fs.existsSync(configPath) && !force) {
    err(`[init] ${DEFAULT_CONFIG_FILENAME} already exists. Re-run with --force to overwrite.`);
    return 1;
  }

  fs.writeFileSync(configPath, defaultConfigTemplate(), {
    encoding: 'utf-8',
    mode: 0o600,
    flag: force ? 'w' : 'wx',
  });
  try { fs.chmodSync(configPath, 0o600); } catch { /* best effort */ }

  out(`[init] Wrote ${configPath}`);
  out('[init] Edit provider credentials in .env or forge.config.yaml before starting API-backed providers.');
  return 0;
}

function doctor(
  configPath: string | undefined,
  out: (line: string) => void,
  nodeVersion = process.versions.node,
): number {
  const checks: Check[] = [checkNodeVersion(nodeVersion)];
  let loaded: { config: ForgeConfig; resolved: ResolvedPaths } | null = null;

  try {
    loaded = loadConfig(configPath);
    checks.push({
      status: 'ok',
      label: 'config',
      message: `parsed ${configPath ?? 'default config'}`,
    });
  } catch (err) {
    checks.push({
      status: 'fail',
      label: 'config',
      message: `${formatError(err)}. Run "forge init" or pass --config /path/to/forge.config.yaml.`,
    });
  }

  if (loaded) {
    checks.push(checkDbWritability(loaded.resolved.dbs));
    checks.push(checkProviderAuth(loaded.config));
    checks.push(checkSlackReadiness(loaded.config));
  }

  for (const check of checks) {
    out(`[${check.status}] ${check.label}: ${check.message}`);
  }

  return checks.some(check => check.status === 'fail') ? 1 : 0;
}

function tokenStatus(configPath: string | undefined, out: (line: string) => void): number {
  let loaded: { config: ForgeConfig; resolved: ResolvedPaths };
  try {
    loaded = loadConfig(configPath);
  } catch (err) {
    out(`[fail] config: ${formatError(err)}. Run "forge init" or pass --config /path/to/forge.config.yaml.`);
    return 1;
  }

  const envExists = Boolean(process.env.FORGE_AUTH_TOKEN?.trim());
  const configExists = Boolean(loaded.config.services.web.auth_token?.trim());
  const tokenPath = path.join(loaded.resolved.logs, AUTH_TOKEN_FILENAME);
  const fileExists = fileHasContent(tokenPath);

  out(`[token] env: FORGE_AUTH_TOKEN ${envExists ? 'is set' : 'is not set'}`);
  out(`[token] config: services.web.auth_token ${configExists ? 'is set' : 'is not set'}`);
  out(`[token] file: ${tokenPath} ${fileExists ? 'exists' : 'does not exist'}`);

  if (!envExists && !configExists && !fileExists) {
    out('[token] no token exists yet; forge start will generate one in the file path above.');
  }

  return 0;
}

function checkNodeVersion(nodeVersion: string): Check {
  const ok = compareVersions(nodeVersion, MIN_NODE_VERSION) >= 0;
  return {
    status: ok ? 'ok' : 'fail',
    label: 'node',
    message: ok
      ? `v${nodeVersion} satisfies >=${MIN_NODE_VERSION.join('.')}`
      : `v${nodeVersion} is too old; install Node >=${MIN_NODE_VERSION.join('.')}`,
  };
}

function checkDbWritability(dbPath: string): Check {
  try {
    fs.mkdirSync(dbPath, { recursive: true, mode: 0o700 });
    const probe = path.join(dbPath, `.forge-doctor-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, 'ok', { flag: 'wx', mode: 0o600 });
    fs.rmSync(probe, { force: true });
    return {
      status: 'ok',
      label: 'db path',
      message: `writable at ${dbPath}`,
    };
  } catch (err) {
    return {
      status: 'fail',
      label: 'db path',
      message: `not writable at ${dbPath}: ${formatError(err)}`,
    };
  }
}

function checkProviderAuth(config: ForgeConfig): Check {
  switch (config.llm.provider) {
    case 'openai-api': {
      const configured = Boolean(resolveKey(config.api.openai) ?? process.env.OPENAI_API_KEY?.trim());
      return {
        status: configured ? 'ok' : 'fail',
        label: 'provider',
        message: configured
          ? 'openai-api credential is configured (value redacted)'
          : 'openai-api requires OPENAI_API_KEY or api.openai',
      };
    }
    case 'anthropic-api': {
      const configured = Boolean(resolveKey(config.api.anthropic) ?? process.env.ANTHROPIC_API_KEY?.trim());
      return {
        status: configured ? 'ok' : 'fail',
        label: 'provider',
        message: configured
          ? 'anthropic-api credential is configured (value redacted)'
          : 'anthropic-api requires ANTHROPIC_API_KEY or api.anthropic',
      };
    }
    case 'claude-cli':
      return checkCliProvider('provider', config.llm.command ?? 'claude', 'Claude CLI auth is managed by the Claude CLI');
    case 'codex-cli':
      return checkCliProvider('provider', config.llm.command ?? 'codex', 'Codex CLI auth is managed by Codex');
  }
}

function checkCliProvider(label: string, command: string, authMessage: string): Check {
  const executable = findExecutable(command);
  return {
    status: executable ? 'ok' : 'fail',
    label,
    message: executable
      ? `${command} found at ${executable}; ${authMessage}`
      : `${command} was not found on PATH; install it and complete its login flow`,
  };
}

function checkSlackReadiness(config: ForgeConfig): Check {
  const tokens = resolveSlackTokens(config);
  if (tokens.botToken && tokens.appToken) {
    return {
      status: 'ok',
      label: 'slack',
      message: 'bot and app tokens are configured (values redacted)',
    };
  }
  if (!config.api.slack) {
    return {
      status: 'warn',
      label: 'slack',
      message: 'not configured; daemon Slack listener will stay disabled',
    };
  }
  return {
    status: 'warn',
    label: 'slack',
    message: 'missing bot token or app token; configure SLACK_BOT_TOKEN and SLACK_APP_TOKEN',
  };
}

function selectConfigPath(configPath: string | undefined, cwd: string): string | undefined {
  if (configPath) return normalizeInputPath(configPath, cwd);
  const cwdConfig = path.join(cwd, DEFAULT_CONFIG_FILENAME);
  return fs.existsSync(cwdConfig) ? cwdConfig : undefined;
}

function normalizeInputPath(inputPath: string, cwd: string): string {
  if (path.isAbsolute(inputPath) || inputPath === '~' || inputPath.startsWith('~/')) {
    return inputPath;
  }
  return path.resolve(cwd, inputPath);
}

function toCommand(arg: string | undefined): CliCommand {
  if (arg === 'init' || arg === 'start' || arg === 'doctor' || arg === 'token' || arg === 'help') {
    return arg;
  }
  throw new Error(`Unknown command: ${arg}`);
}

function isMode(arg: string | undefined): arg is BootMode {
  return arg === 'daemon' || arg === 'web' || arg === 'full';
}

function isConfigFlag(arg: string | undefined): boolean {
  return arg === '--config' || Boolean(arg?.startsWith('--config='));
}

function compareVersions(version: string, min: readonly [number, number, number]): number {
  const parts = version.split('.').map(part => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < min.length; i++) {
    const current = parts[i] ?? 0;
    if (current > min[i]) return 1;
    if (current < min[i]) return -1;
  }
  return 0;
}

function findExecutable(command: string): string | null {
  if (command.includes(path.sep)) {
    return canExecute(command) ? command : null;
  }

  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, command);
    if (canExecute(candidate)) return candidate;
  }
  return null;
}

function canExecute(candidate: string): boolean {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function fileHasContent(filePath: string): boolean {
  try {
    return fs.readFileSync(filePath, 'utf-8').trim().length > 0;
  } catch {
    return false;
  }
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function defaultConfigTemplate(): string {
  const username = os.userInfo().username || 'your-name';
  return [
    'forge:',
    '  name: forge',
    '  version: "1.0.0"',
    '  root: .',
    '',
    'user:',
    `  name: ${username}`,
    '',
    'api:',
    '  anthropic:',
    '    env: ANTHROPIC_API_KEY',
    '  openai:',
    '    env: OPENAI_API_KEY',
    '  slack:',
    '    bot_token:',
    '      env: SLACK_BOT_TOKEN',
    '    app_token:',
    '      env: SLACK_APP_TOKEN',
    '    bot_user_id: ""',
    '    channels: []',
    '    allow_all_channels: false',
    '    require_mention: true',
    '    allow_yolo: false',
    '',
    'models:',
    '  default: claude-sonnet-4-6',
    '  architect: claude-opus-4-6',
    '  sentinel: claude-haiku-4-5',
    '',
    'llm:',
    '  provider: claude-cli',
    '  model: claude-sonnet-4-6',
    '  permission_mode: default',
    '',
    'paths:',
    '  dbs: ./dbs',
    '  identity: ./identity',
    '  logs: ./logs',
    '',
    'services:',
    '  web:',
    '    port: 6800',
    '    host: 127.0.0.1',
    '    context_window_tokens: 80000',
    '    debug_prompt_context: false',
    '  daemon:',
    '    port: 6790',
    '',
    'memory:',
    '  retention_days: 30',
    '  index_rebuild_interval_minutes: 15',
    '',
    'budget:',
    '  daily_limit_cents: 5000',
    '  per_job_limit_cents: 1500',
    '  warn_at_percent: 80',
    '',
  ].join('\n');
}

function printHelp(out: (line: string) => void): void {
  out([
    'Usage:',
    '  forge init [--force]',
    '  forge start [daemon|web|full] [--config path]',
    '  forge doctor [--config path]',
    '  forge token [--config path]',
    '',
    'Legacy start form is also accepted:',
    '  forge [daemon|web|full] [--config path]',
  ].join('\n'));
}

function listen(app: http.RequestListener, port: number, host: string): Promise<http.Server> {
  const server = http.createServer(app);

  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      reject(new Error(formatListenError(err, port, host)));
    };
    const onListening = () => {
      server.off('error', onError);
      server.on('error', err => {
        console.error('[web] Server error:', err);
      });
      console.log(`[web] Server listening on http://${host}:${port}`);
      resolve(server);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function formatListenError(err: NodeJS.ErrnoException, port: number, host: string): string {
  if (err.code === 'EADDRINUSE') {
    return `[web] ${host}:${port} is already in use. Set services.web.port/services.web.host in forge.config.yaml or stop the other process.`;
  }
  if (err.code === 'EACCES') {
    return `[web] Permission denied while binding ${host}:${port}. Choose a different services.web.port/services.web.host.`;
  }
  return `[web] Failed to listen on ${host}:${port}: ${err.message}`;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return Boolean(entry && path.resolve(entry) === fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  runCli(process.argv.slice(2)).then(code => {
    if (code !== 0) process.exit(code);
  }).catch(err => {
    console.error('[forge] Fatal:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
