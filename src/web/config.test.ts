import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { clearConfigCache, loadConfig, resolveWebAuthToken } from '../config.ts';

function writeConfig(dir: string): string {
  const configPath = path.join(dir, 'forge.config.yaml');
  fs.writeFileSync(configPath, [
    'forge:',
    '  name: test-forge',
    '  version: "1.0.0"',
    '  root: .',
    'user:',
    '  name: tester',
    'api: {}',
    'models: {}',
    'paths:',
    '  dbs: ./state/dbs',
    '  identity: ./identity',
    '  logs: ./var/logs',
  ].join('\n'));
  return configPath;
}

test('default config loading is independent of process.cwd()', () => {
  clearConfigCache();
  const originalCwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-config-cwd-'));

  try {
    process.chdir(tmp);
    const { resolved } = loadConfig();
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

    assert.equal(resolved.root, repoRoot);
    assert.equal(resolved.logs, path.join(repoRoot, 'logs'));
  } finally {
    process.chdir(originalCwd);
    clearConfigCache();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('relative config paths resolve from the config file root', () => {
  clearConfigCache();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-config-paths-'));

  try {
    const configPath = writeConfig(tmp);
    const { resolved } = loadConfig(configPath);

    assert.equal(resolved.root, tmp);
    assert.equal(resolved.dbs, path.join(tmp, 'state/dbs'));
    assert.equal(resolved.identity, path.join(tmp, 'identity'));
    assert.equal(resolved.logs, path.join(tmp, 'var/logs'));
  } finally {
    clearConfigCache();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('web auth token is configured, persisted, and reused', () => {
  clearConfigCache();
  const originalToken = process.env.FORGE_AUTH_TOKEN;
  delete process.env.FORGE_AUTH_TOKEN;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-auth-token-'));

  try {
    const configPath = writeConfig(tmp);
    const { config, resolved } = loadConfig(configPath);

    const generated = resolveWebAuthToken(config, resolved);
    assert.equal(generated.source, 'generated');
    assert.ok(generated.path);
    assert.equal(fs.readFileSync(generated.path, 'utf-8').trim(), generated.token);

    const reused = resolveWebAuthToken(config, resolved);
    assert.deepEqual(reused, { token: generated.token, source: 'file', path: generated.path });

    config.services.web.auth_token = 'configured-token';
    assert.deepEqual(resolveWebAuthToken(config, resolved), { token: 'configured-token', source: 'config' });

    process.env.FORGE_AUTH_TOKEN = 'env-token';
    assert.deepEqual(resolveWebAuthToken(config, resolved), { token: 'env-token', source: 'env' });
  } finally {
    if (originalToken === undefined) {
      delete process.env.FORGE_AUTH_TOKEN;
    } else {
      process.env.FORGE_AUTH_TOKEN = originalToken;
    }
    clearConfigCache();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
