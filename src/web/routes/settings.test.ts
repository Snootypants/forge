import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { settingsRoutes } from './settings.ts';

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
      assert.equal(body.info.memory.contextWindowTokens, 80000);
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

function context(logs: string) {
  return {
    config: {
      forge: { name: 'forge', version: '1.0.0', root: '.' },
      user: { name: 'tester' },
      api: {},
      models: { default: 'test', architect: 'test', sentinel: 'test' },
      paths: { dbs: './dbs', identity: './identity', logs: './logs' },
      services: { web: { port: 6800, context_window_tokens: 80000 }, daemon: { port: 6790 } },
      memory: { retention_days: 30, index_rebuild_interval_minutes: 15 },
      budget: { daily_limit_cents: 5000, per_job_limit_cents: 1500, warn_at_percent: 80 },
    },
    resolved: { root: '.', dbs: '.', identity: '.', logs },
    dbManager: { health: () => [] },
  };
}
