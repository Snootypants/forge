import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { ForgeConfigSchema, type ForgeConfig, type KeyRef, type ResolvedPaths } from './types.ts';

let _cached: { config: ForgeConfig; resolved: ResolvedPaths } | null = null;

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

export function loadConfig(configPath?: string): { config: ForgeConfig; resolved: ResolvedPaths } {
  if (_cached) return _cached;

  const searchPath = configPath ?? path.join(process.cwd(), 'forge.config.yaml');
  if (!fs.existsSync(searchPath)) {
    throw new Error(`Config not found: ${searchPath}`);
  }

  const raw = fs.readFileSync(searchPath, 'utf-8');
  const parsed = resolveEnvVars(yaml.load(raw));
  const config = ForgeConfigSchema.parse(parsed);

  const root = resolveTilde(config.forge.root);
  const resolvePath = (p: string): string => {
    const expanded = resolveTilde(p);
    return path.isAbsolute(expanded) ? expanded : path.resolve(root, expanded);
  };

  const resolved: ResolvedPaths = {
    root,
    dbs: resolvePath(config.paths.dbs),
    identity: resolvePath(config.paths.identity),
    logs: resolvePath(config.paths.logs),
  };

  for (const dir of [resolved.dbs, resolved.logs]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  _cached = { config, resolved };
  return _cached;
}

export function loadEnvFile(envPath?: string): void {
  const p = envPath ?? path.join(process.cwd(), '.env');
  if (!fs.existsSync(p)) return;

  const lines = fs.readFileSync(p, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

export function saveEnvValue(key: string, value: string, envPath?: string): void {
  const p = envPath ?? path.join(process.cwd(), '.env');
  let content = '';
  if (fs.existsSync(p)) {
    content = fs.readFileSync(p, 'utf-8');
  }

  const lines = content.split('\n');
  let found = false;
  const updated = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith(`${key}=`)) {
      found = true;
      return `${key}="${value}"`;
    }
    return line;
  });

  if (!found) {
    updated.push(`${key}="${value}"`);
  }

  fs.writeFileSync(p, updated.join('\n'), { mode: 0o600 });
}

export function clearConfigCache(): void {
  _cached = null;
}
