import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { settingsRoutes } from './settings.ts';
import { authRoutes } from './auth.ts';
import { createWebServer } from '../server.ts';

async function withServer(app: express.Express, fn: (url: string) => Promise<void>): Promise<void> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

  try {
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
}

async function getStatusWithHeaders(rawUrl: string, headers: Record<string, string>): Promise<number> {
  const url = new URL(rawUrl);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers,
    }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end();
  });
}

test('settings route falls back to defaults for corrupt settings JSON', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-settings-route-'));
  const logs = path.join(tmp, 'logs');
  fs.mkdirSync(logs);
  fs.writeFileSync(path.join(logs, 'settings.json'), '{bad json');

  const app = express();
  app.use(express.json());
  app.use('/api/settings', settingsRoutes(context(logs) as never));

  try {
    await withServer(app, async (url) => {
      const response = await fetch(`${url}/api/settings`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.settings.dailyBudget, 50);
      assert.equal(body.settings.effectiveWebAuthRequired, true);
      assert.equal(body.settings.effectiveWebAuthReason, 'settings');
      assert.equal(body.info.memory.contextWindowTokens, 80000);
      assert.equal(body.info.memory.hybridSearchActive, false);
      assert.equal(body.info.embedding.hybridSearchActive, false);
      assert.equal(body.info.llmProviderRequirements.selectedProvider, 'claude-cli');
      assert.deepEqual(
        body.info.llmProviderRequirements.providers.map((p: any) => [p.provider, p.auth, p.effectiveModel, p.modelCompatible]),
        [
          ['claude-cli', 'claude-oauth-or-anthropic-key', 'test', true],
          ['codex-cli', 'codex-login-or-openai-api-key', 'gpt-5.2-codex', true],
          ['openai-api', 'openai-api-key', 'gpt-5.2', true],
          ['anthropic-api', 'anthropic-api-key', 'claude-sonnet-4-6', true],
        ],
      );
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('settings route rejects invalid patches', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-settings-route-'));
  const logs = path.join(tmp, 'logs');

  const app = express();
  app.use(express.json());
  app.use('/api/settings', settingsRoutes(context(logs) as never));

  try {
    await withServer(app, async (url) => {
      const response = await fetch(`${url}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warningThreshold: 200 }),
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error, 'invalid settings');
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('settings route persists web auth toggle', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-settings-route-'));
  const logs = path.join(tmp, 'logs');

  const app = express();
  app.use(express.json());
  app.use('/api/settings', settingsRoutes(context(logs) as never));

  try {
    await withServer(app, async (url) => {
      const save = await fetch(`${url}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webAuthRequired: false }),
      });
      assert.equal(save.status, 200);
      const saved = await save.json();
      assert.equal(saved.settings.webAuthRequired, false);
      assert.equal(saved.settings.effectiveWebAuthRequired, false);
      assert.equal(saved.settings.effectiveWebAuthReason, 'settings');
      assert.equal((fs.statSync(path.join(logs, 'settings.json')).mode & 0o777), 0o600);

      const response = await fetch(`${url}/api/settings`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.settings.webAuthRequired, false);
      assert.equal(body.settings.effectiveWebAuthRequired, false);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('web auth disable is ignored on non-loopback hosts', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-settings-route-'));
  const logs = path.join(tmp, 'logs');
  fs.mkdirSync(logs, { recursive: true });
  writeStoredSettings(logs, { webAuthRequired: false });

  try {
    const app = createWebServer(context(logs, { host: '0.0.0.0' }) as never);

    await withServer(app, async (url) => {
      const unauthenticated = await fetch(`${url}/api/settings`);
      assert.equal(unauthenticated.status, 401);

      const authenticated = await fetch(`${url}/api/settings`, {
        headers: { Authorization: 'Bearer test-token' },
      });
      assert.equal(authenticated.status, 200);
      const body = await authenticated.json();
      assert.equal(body.settings.webAuthRequired, false);
      assert.equal(body.settings.effectiveWebAuthRequired, true);
      assert.equal(body.settings.effectiveWebAuthReason, 'bind-host');
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('web auth disable works on loopback hosts', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-settings-route-'));
  const logs = path.join(tmp, 'logs');
  fs.mkdirSync(logs, { recursive: true });
  writeStoredSettings(logs, { webAuthRequired: false });

  try {
    const app = createWebServer(context(logs, { host: '127.0.0.1' }) as never);

    await withServer(app, async (url) => {
      const response = await fetch(`${url}/api/settings`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).settings.webAuthRequired, false);

      const crossOrigin = await fetch(`${url}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' },
        body: JSON.stringify({ dailyBudget: 51 }),
      });
      assert.equal(crossOrigin.status, 403);

      const save = await fetch(`${url}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: url },
        body: JSON.stringify({ dailyBudget: 51 }),
      });
      assert.equal(save.status, 200);
      assert.equal((await save.json()).settings.dailyBudget, 51);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('auth-disabled api rejects dns rebinding host even when origin matches host', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-settings-route-'));
  const logs = path.join(tmp, 'logs');
  fs.mkdirSync(logs, { recursive: true });
  writeStoredSettings(logs, { webAuthRequired: false });

  try {
    const app = createWebServer(context(logs, { host: '127.0.0.1' }) as never);

    await withServer(app, async (url) => {
      const status = await getStatusWithHeaders(`${url}/api/settings`, {
        Host: 'evil.test',
        Origin: 'http://evil.test',
      });
      assert.equal(status, 403);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('auth-disabled api allows configured host allowlist entries', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-settings-route-'));
  const logs = path.join(tmp, 'logs');
  fs.mkdirSync(logs, { recursive: true });
  writeStoredSettings(logs, { webAuthRequired: false });

  try {
    const app = createWebServer(context(logs, { host: '127.0.0.1', allowedHosts: ['evil.test'] }) as never);

    await withServer(app, async (url) => {
      const status = await getStatusWithHeaders(`${url}/api/settings`, {
        Host: 'evil.test',
        Origin: 'http://evil.test',
      });
      assert.equal(status, 200);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('settings route reports memory runtime status aliases', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-settings-route-'));
  const logs = path.join(tmp, 'logs');

  const app = express();
  app.use(express.json());
  app.use('/api/settings', settingsRoutes(context(logs, {
    memory: {
      runtimeStatus: () => ({
        vectorTableAvailable: true,
        embeddingAvailable: true,
        hybridSearchActive: true,
      }),
    },
  }) as never));

  try {
    await withServer(app, async (url) => {
      const response = await fetch(`${url}/api/settings`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.info.memory.vectorTableAvailable, true);
      assert.equal(body.info.memory.embeddingAvailable, true);
      assert.equal(body.info.memory.hybridSearchActive, true);
      assert.equal(body.info.embedding.vectorTableAvailable, true);
      assert.equal(body.info.embedding.embeddingAvailable, true);
      assert.equal(body.info.embedding.hybridSearchActive, true);
      assert.equal(body.info.embedding.vectorLive, true);
      assert.equal(body.info.embedding.sqliteVecLoaded, true);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('auth route credential saves use resolved config env path', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-settings-route-'));
  const logs = path.join(tmp, 'logs');
  const envPath = path.join(tmp, 'config', '.env');
  const prior = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
    SLACK_APP_TOKEN: process.env.SLACK_APP_TOKEN,
  };

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes(context(logs, { envPath }) as never));

  try {
    await withServer(app, async (url) => {
      const openai = await fetch(`${url}/api/auth/openai/key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: 'saved-openai' }),
      });
      assert.equal(openai.status, 200);

      const anthropic = await fetch(`${url}/api/auth/anthropic/key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: 'saved-anthropic' }),
      });
      assert.equal(anthropic.status, 200);

      const slack = await fetch(`${url}/api/auth/slack/tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken: 'saved-bot', appToken: 'saved-app' }),
      });
      assert.equal(slack.status, 200);
    });

    const saved = fs.readFileSync(envPath, 'utf-8');
    assert.match(saved, /OPENAI_API_KEY="saved-openai"/);
    assert.match(saved, /ANTHROPIC_API_KEY="saved-anthropic"/);
    assert.match(saved, /SLACK_BOT_TOKEN="saved-bot"/);
    assert.match(saved, /SLACK_APP_TOKEN="saved-app"/);
    assert.equal((fs.statSync(envPath).mode & 0o777), 0o600);
    assert.equal(process.env.OPENAI_API_KEY, 'saved-openai');
    assert.equal(process.env.ANTHROPIC_API_KEY, 'saved-anthropic');
    assert.equal(process.env.SLACK_BOT_TOKEN, 'saved-bot');
    assert.equal(process.env.SLACK_APP_TOKEN, 'saved-app');
  } finally {
    restoreEnv(prior);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

function context(logs: string, options: {
  host?: string;
  envPath?: string;
  allowedHosts?: string[];
  authRequired?: boolean;
  memory?: Record<string, unknown>;
} = {}) {
  const root = path.dirname(logs);
  const envPath = options.envPath ?? path.join(root, '.env');
  return {
    config: {
      forge: { name: 'forge', version: '1.0.0', root: '.' },
      user: { name: 'tester' },
      api: {},
      models: { default: 'test', architect: 'test', sentinel: 'test' },
      llm: { provider: 'claude-cli', model: 'test', permission_mode: 'default' },
      paths: { dbs: './dbs', identity: './identity', logs: './logs' },
      services: { web: { port: 6800, host: options.host ?? '127.0.0.1', allowed_hosts: options.allowedHosts ?? [], auth_required: options.authRequired ?? false, context_window_tokens: 80000, debug_prompt_context: false }, daemon: { port: 6790 } },
      memory: { retention_days: 30, index_rebuild_interval_minutes: 15 },
      budget: { daily_limit_cents: 5000, per_job_limit_cents: 1500, warn_at_percent: 80 },
    },
    resolved: { configDir: path.dirname(envPath), envPath, root, dbs: '.', identity: root, logs },
    dbManager: { get: () => ({ prepare: () => ({ all: () => [], run: () => undefined }) }), health: () => [] },
    memory: options.memory ?? {},
    llm: {},
    authToken: 'test-token',
    identity: 'You are forge.',
    identityDir: root,
    readIdentity: () => 'You are forge.',
  };
}

function writeStoredSettings(logs: string, overrides: Record<string, unknown>): void {
  fs.writeFileSync(path.join(logs, 'settings.json'), JSON.stringify({
    dailyBudget: 50,
    perJobBudget: 15,
    warningThreshold: 80,
    maxConcurrentJobs: 3,
    webAuthRequired: true,
    chatProvider: 'claude-cli',
    chatModel: 'test',
    permissionMode: 'default',
    ...overrides,
  }));
}

function restoreEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
