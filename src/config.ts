import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { ForgeConfigSchema, type ForgeConfig, type KeyRef, type ResolvedPaths } from './types.ts';
import { atomicWriteFileSync } from './utils/atomic-write.ts';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUTH_TOKEN_FILENAME = 'web-auth-token';
const envValuesLoadedFromFiles = new Map<string, string>();

function resolveTilde(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(process.env.HOME ?? '/root', p.slice(1));
  }
  return p;
}

function resolveEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] ?? '');
  }
  if (Array.isArray(obj)) return obj.map(resolveEnvVars);
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = resolveEnvVars(v);
    }
    return result;
  }
  return obj;
}

export function resolveKey(ref: KeyRef | undefined): string | null {
  if (!ref) return null;
  if (ref.value && ref.value.trim().length > 0) return ref.value.trim();
  if (ref.env && process.env[ref.env]) return process.env[ref.env]!;
  return null;
}

function resolveInputPath(p: string, baseDir: string): string {
  const expanded = resolveTilde(p);
  return path.isAbsolute(expanded) ? expanded : path.resolve(baseDir, expanded);
}

function defaultAppPath(filename: string): string {
  return path.join(APP_ROOT, filename);
}

export function resolveConfigFilePath(configPath?: string): string {
  return configPath ? resolveInputPath(configPath, process.cwd()) : defaultAppPath('forge.config.yaml');
}

export function loadConfig(configPath?: string): { config: ForgeConfig; resolved: ResolvedPaths } {
  const searchPath = resolveConfigFilePath(configPath);
  if (!fs.existsSync(searchPath)) {
    throw new Error(`Config not found: ${searchPath}`);
  }

  const configDir = path.dirname(searchPath);
  loadEnvFile(path.join(configDir, '.env'), { overrideLoaded: true });

  const raw = fs.readFileSync(searchPath, 'utf-8');
  const parsed = resolveEnvVars(yaml.load(raw));
  const config = ForgeConfigSchema.parse(parsed);
  applyEnvOverrides(config);

  const root = resolveInputPath(config.forge.root, configDir);
  const resolvePath = (p: string): string => {
    const expanded = resolveTilde(p);
    return path.isAbsolute(expanded) ? expanded : path.resolve(root, expanded);
  };

  const resolved: ResolvedPaths = {
    configDir,
    envPath: path.join(configDir, '.env'),
    root,
    dbs: resolvePath(config.paths.dbs),
    identity: resolvePath(config.paths.identity),
    logs: resolvePath(config.paths.logs),
  };

  if (config.llm.workdir) {
    config.llm.workdir = resolveInputPath(config.llm.workdir, configDir);
  }

  for (const dir of [resolved.dbs, resolved.logs]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(dir, 0o700); } catch { /* best effort on shared filesystems */ }
  }

  return { config, resolved };
}

export function loadEnvFile(envPath?: string, options: { overrideLoaded?: boolean } = {}): void {
  const p = envPath ? resolveInputPath(envPath, process.cwd()) : defaultAppPath('.env');
  if (!fs.existsSync(p)) return;

  const lines = fs.readFileSync(p, 'utf-8').split('\n');
  for (const line of lines) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;

    const current = process.env[parsed.key];
    if (current === undefined) {
      process.env[parsed.key] = parsed.value;
      envValuesLoadedFromFiles.set(parsed.key, parsed.value);
    } else if (
      options.overrideLoaded &&
      envValuesLoadedFromFiles.get(parsed.key) === current
    ) {
      process.env[parsed.key] = parsed.value;
      envValuesLoadedFromFiles.set(parsed.key, parsed.value);
    }
  }
}

export function saveEnvValue(key: string, value: string, envPath?: string): void {
  const p = envPath ? resolveInputPath(envPath, process.cwd()) : defaultAppPath('.env');
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  let content = '';
  if (fs.existsSync(p)) {
    content = fs.readFileSync(p, 'utf-8');
  }

  const lines = content.split('\n');
  let found = false;
  const updated = lines.map(line => {
    const parsed = parseEnvLine(line);
    if (parsed?.key === key) {
      found = true;
      return formatEnvLine(key, value);
    }
    return line;
  });

  if (!found) {
    updated.push(formatEnvLine(key, value));
  }

  atomicWriteFileSync(p, updated.join('\n'), { mode: 0o600 });
}

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trimStart() : trimmed;
  const eqIdx = normalized.indexOf('=');
  if (eqIdx === -1) return null;

  const key = normalized.slice(0, eqIdx).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;

  let value = normalized.slice(eqIdx + 1).trim();
  if (value.startsWith('"')) {
    const end = findClosingQuote(value, '"');
    value = unescapeDoubleQuoted(end >= 0 ? value.slice(1, end) : value.slice(1));
  } else if (value.startsWith("'")) {
    const end = findClosingQuote(value, "'");
    value = end >= 0 ? value.slice(1, end) : value.slice(1);
  } else {
    const hash = value.indexOf('#');
    if (hash >= 0) value = value.slice(0, hash).trimEnd();
  }

  return { key, value };
}

function findClosingQuote(value: string, quote: '"' | "'"): number {
  for (let i = 1; i < value.length; i++) {
    if (value[i] === quote && value[i - 1] !== '\\') return i;
  }
  return -1;
}

function unescapeDoubleQuoted(value: string): string {
  return value.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function formatEnvLine(key: string, value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(`Invalid env key: ${key}`);
  }
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"');
  return `${key}="${escaped}"`;
}

export function resolveWebAuthToken(
  config: ForgeConfig,
  resolved: ResolvedPaths,
): { token: string; source: 'env' | 'config' | 'file' | 'generated'; path?: string } {
  const envToken = process.env.FORGE_AUTH_TOKEN?.trim();
  if (envToken) return { token: envToken, source: 'env' };

  const configToken = config.services.web.auth_token?.trim();
  if (configToken) return { token: configToken, source: 'config' };

  const tokenPath = path.join(resolved.logs, AUTH_TOKEN_FILENAME);
  if (fs.existsSync(tokenPath)) {
    const token = fs.readFileSync(tokenPath, 'utf-8').trim();
    if (token) return { token, source: 'file', path: tokenPath };
  }

  fs.mkdirSync(resolved.logs, { recursive: true });
  try { fs.chmodSync(resolved.logs, 0o700); } catch { /* best effort */ }
  const token = crypto.randomBytes(32).toString('hex');
  atomicWriteFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
  return { token, source: 'generated', path: tokenPath };
}

export function clearConfigCache(): void {
  // Config loading is intentionally uncached so --config boots cannot reuse
  // paths, env files, or env overrides from an earlier selection.
}

function applyEnvOverrides(config: ForgeConfig): void {
  const host = process.env.FORGE_WEB_HOST?.trim();
  if (host) config.services.web.host = host;

  const port = process.env.FORGE_WEB_PORT?.trim();
  if (port) {
    const parsed = Number(port);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
      throw new Error(`Invalid FORGE_WEB_PORT: ${port}`);
    }
    config.services.web.port = parsed;
  }

  const authRequired = process.env.FORGE_WEB_AUTH_REQUIRED?.trim();
  if (authRequired && parseEnvBoolean(authRequired)) {
    config.services.web.auth_required = true;
  }

  const allowedHosts = process.env.FORGE_WEB_ALLOWED_HOSTS?.trim();
  if (allowedHosts) {
    config.services.web.allowed_hosts = allowedHosts
      .split(',')
      .map(host => host.trim())
      .filter(Boolean);
  }
}

function parseEnvBoolean(value: string): boolean {
  const normalized = value.toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`Invalid FORGE_WEB_AUTH_REQUIRED: ${value}`);
}
