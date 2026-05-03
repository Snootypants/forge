import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { clearConfigCache, loadConfig, loadEnvFile, resolveWebAuthToken, saveEnvValue } from '../config.ts';
import { Platform } from '../platform.ts';

function writeConfig(
  dir: string,
  extra: string[] = [],
  options: { userName?: string } = {},
): string {
  const configPath = path.join(dir, 'forge.config.yaml');
  fs.writeFileSync(configPath, [
    'forge:',
    '  name: test-forge',
    '  version: "1.0.0"',
    '  root: .',
    'user:',
    `  name: ${options.userName ?? 'tester'}`,
    'api: {}',
    'models: {}',
    'paths:',
    '  dbs: ./state/dbs',
    '  identity: ./identity',
    '  logs: ./var/logs',
    ...extra,
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

test('selected config .env is loaded before interpolation and env overrides', () => {
  clearConfigCache();
  const priorName = process.env.FORGE_TEST_CONFIG_USER;
  const priorPort = process.env.FORGE_WEB_PORT;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-config-env-'));

  try {
    delete process.env.FORGE_TEST_CONFIG_USER;
    delete process.env.FORGE_WEB_PORT;
    fs.writeFileSync(path.join(tmp, '.env'), [
      'FORGE_TEST_CONFIG_USER=env-file-user',
      'FORGE_WEB_PORT=6901',
    ].join('\n'));

    const configPath = writeConfig(tmp, [
      'services:',
      '  web:',
      '    port: 6800',
    ], { userName: '${FORGE_TEST_CONFIG_USER}' });

    const { config } = loadConfig(configPath);
    assert.equal(config.user.name, 'env-file-user');
    assert.equal(config.services.web.port, 6901);

    process.env.FORGE_WEB_PORT = '6902';
    assert.equal(loadConfig(configPath).config.services.web.port, 6902);
  } finally {
    if (priorName === undefined) {
      delete process.env.FORGE_TEST_CONFIG_USER;
    } else {
      process.env.FORGE_TEST_CONFIG_USER = priorName;
    }
    if (priorPort === undefined) {
      delete process.env.FORGE_WEB_PORT;
    } else {
      process.env.FORGE_WEB_PORT = priorPort;
    }
    clearConfigCache();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('relative llm workdir resolves from the config file root', () => {
  clearConfigCache();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-config-workdir-'));

  try {
    const configPath = writeConfig(tmp, [
      'llm:',
      '  provider: claude-cli',
      '  workdir: ./workspace',
    ]);

    const { config } = loadConfig(configPath);
    assert.equal(config.llm.workdir, path.join(tmp, 'workspace'));
  } finally {
    clearConfigCache();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('platform boot rejects a different config path while booted', async () => {
  clearConfigCache();
  const firstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-platform-first-'));
  const secondDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-platform-second-'));
  let platform: Platform | null = null;

  try {
    const firstConfig = writeConfig(firstDir);
    const secondConfig = writeConfig(secondDir);

    platform = await Platform.boot('web', firstConfig);
    assert.equal(await Platform.boot('web', firstConfig), platform);
    await assert.rejects(
      () => Platform.boot('web', secondConfig),
      /Platform already booted with config/,
    );
  } finally {
    platform?.shutdown();
    clearConfigCache();
    fs.rmSync(firstDir, { recursive: true, force: true });
    fs.rmSync(secondDir, { recursive: true, force: true });
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

test('env file save/load escapes quoted values safely', () => {
  const prior = process.env.FORGE_COMPLEX_VALUE;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-env-file-'));
  const envPath = path.join(tmp, '.env');

  try {
    saveEnvValue('FORGE_COMPLEX_VALUE', 'quote " slash \\ newline\nend', envPath);
    delete process.env.FORGE_COMPLEX_VALUE;
    loadEnvFile(envPath);

    assert.equal(process.env.FORGE_COMPLEX_VALUE, 'quote " slash \\ newline\nend');
    assert.match(fs.readFileSync(envPath, 'utf-8'), /FORGE_COMPLEX_VALUE="quote \\" slash \\\\ newline\\nend"/);
  } finally {
    if (prior === undefined) {
      delete process.env.FORGE_COMPLEX_VALUE;
    } else {
      process.env.FORGE_COMPLEX_VALUE = prior;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
