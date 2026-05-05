import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runCli, webAuthStartupMessages } from './cli.ts';
import type { BootMode } from './types.ts';

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeConfig(
  dir: string,
  extra: string[] = [],
): string {
  const configPath = path.join(dir, 'forge.config.yaml');
  fs.writeFileSync(configPath, [
    'forge:',
    '  name: test-forge',
    '  version: "0.1.0"',
    '  root: .',
    'user:',
    '  name: tester',
    'api:',
    '  openai:',
    '    env: OPENAI_API_KEY',
    'models: {}',
    'llm:',
    '  provider: openai-api',
    'paths:',
    '  dbs: ./state/dbs',
    '  identity: ./identity',
    '  logs: ./var/logs',
    ...extra,
  ].join('\n'));
  return configPath;
}

test('forge init creates config and does not overwrite without --force', async () => {
  const tmp = tempDir('forge-cli-init-');
  const stdout: string[] = [];
  const stderr: string[] = [];

  try {
    assert.equal(await runCli(['init'], {
      cwd: tmp,
      stdout: line => stdout.push(line),
      stderr: line => stderr.push(line),
    }), 0);

    const configPath = path.join(tmp, 'forge.config.yaml');
    assert.ok(fs.existsSync(configPath));
    const first = fs.readFileSync(configPath, 'utf-8');
    assert.match(first, /debug_prompt_context: false/);
    assert.doesNotMatch(first, /debug_prompt_context: true/);

    assert.equal(await runCli(['init'], {
      cwd: tmp,
      stdout: line => stdout.push(line),
      stderr: line => stderr.push(line),
    }), 1);
    assert.equal(fs.readFileSync(configPath, 'utf-8'), first);
    assert.match(stderr.join('\n'), /already exists/);

    fs.writeFileSync(configPath, 'old-config');
    assert.equal(await runCli(['init', '--force'], {
      cwd: tmp,
      stdout: line => stdout.push(line),
      stderr: line => stderr.push(line),
    }), 0);
    assert.match(fs.readFileSync(configPath, 'utf-8'), /^forge:\n/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('startup auth messages do not print generated token values', () => {
  const output = webAuthStartupMessages({
    token: 'generated-secret-token',
    source: 'generated',
    path: '/tmp/forge/web-auth-token',
  }).join('\n');

  assert.match(output, /forge token --show/);
  assert.match(output, /web-auth-token/);
  assert.doesNotMatch(output, /generated-secret-token/);
});

test('forge start maps mode and cwd config path into runtime boot', async () => {
  const tmp = tempDir('forge-cli-start-');
  let started: { mode: BootMode; configPath?: string } | null = null;

  try {
    const configPath = writeConfig(tmp);
    assert.equal(await runCli(['start', 'web'], {
      cwd: tmp,
      startRuntime: async args => {
        started = args;
      },
    }), 0);

    assert.deepEqual(started, { mode: 'web', configPath });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('legacy start args still map to runtime boot', async () => {
  const tmp = tempDir('forge-cli-legacy-start-');
  let started: { mode: BootMode; configPath?: string } | null = null;

  try {
    const configPath = writeConfig(tmp);
    assert.equal(await runCli(['web', '--config', 'forge.config.yaml'], {
      cwd: tmp,
      startRuntime: async args => {
        started = args;
      },
    }), 0);

    assert.deepEqual(started, { mode: 'web', configPath });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('forge doctor checks config, db path, and provider auth without printing secrets', async () => {
  const tmp = tempDir('forge-cli-doctor-');
  const stdout: string[] = [];
  const originalKey = process.env.OPENAI_API_KEY;

  try {
    process.env.OPENAI_API_KEY = 'sk-test-secret';
    const configPath = writeConfig(tmp);

    const code = await runCli(['doctor', '--config', configPath], {
      stdout: line => stdout.push(line),
      nodeVersion: '22.6.0',
    });
    const output = stdout.join('\n');

    assert.equal(code, 0);
    assert.match(output, /\[ok\] node:/);
    assert.match(output, /\[ok\] config:/);
    assert.match(output, /\[ok\] db path:/);
    assert.match(output, /\[ok\] provider:/);
    assert.doesNotMatch(output, /sk-test-secret/);
  } finally {
    if (originalKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalKey;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('forge token reports token locations and never prints token values', async () => {
  const tmp = tempDir('forge-cli-token-');
  const stdout: string[] = [];

  try {
    const configPath = writeConfig(tmp, [
      'services:',
      '  web:',
      '    auth_token: config-secret-token',
    ]);
    const tokenDir = path.join(tmp, 'var/logs');
    fs.mkdirSync(tokenDir, { recursive: true });
    fs.writeFileSync(path.join(tokenDir, 'web-auth-token'), 'file-secret-token\n');

    const code = await runCli(['token', '--config', configPath], {
      stdout: line => stdout.push(line),
    });
    const output = stdout.join('\n');

    assert.equal(code, 0);
    assert.match(output, /services\.web\.auth_token is set/);
    assert.match(output, /web-auth-token exists/);
    assert.match(output, /value: hidden; rerun with --show/);
    assert.doesNotMatch(output, /config-secret-token/);
    assert.doesNotMatch(output, /file-secret-token/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('forge token --show prints the selected token value explicitly', async () => {
  const tmp = tempDir('forge-cli-token-show-');
  const stdout: string[] = [];

  try {
    const configPath = writeConfig(tmp);
    const tokenDir = path.join(tmp, 'var/logs');
    fs.mkdirSync(tokenDir, { recursive: true });
    fs.writeFileSync(path.join(tokenDir, 'web-auth-token'), 'file-secret-token\n');

    const code = await runCli(['token', '--show', '--config', configPath], {
      stdout: line => stdout.push(line),
    });
    const output = stdout.join('\n');

    assert.equal(code, 0);
    assert.match(output, /web-auth-token exists/);
    assert.match(output, /value: file-secret-token/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
