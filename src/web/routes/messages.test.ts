import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { messagesRoutes } from './messages.ts';
import { createWebServer, type WebContext } from '../server.ts';

function makeDb(rows: unknown[] = []) {
  const runs: unknown[][] = [];
  const allCalls: { sql: string; args: unknown[] }[] = [];
  return {
    runs,
    allCalls,
    prepare(sql: string) {
      return {
        all(...args: unknown[]) {
          allCalls.push({ sql, args });
          return rows;
        },
        run(...args: unknown[]) {
          runs.push(args);
        },
      };
    },
  };
}

function makeCtx(db = makeDb(), overrides: Partial<Record<keyof WebContext, unknown>> = {}): WebContext {
  return {
    config: {
      forge: { name: 'forge', version: '1.0.0', root: '.' },
      user: { name: 'Caleb' },
      api: {},
      models: { default: 'test', architect: 'test', sentinel: 'test' },
      llm: { provider: 'claude-cli', model: 'test', permission_mode: 'default' },
      paths: { dbs: './dbs', identity: './identity', logs: './logs' },
      services: { web: { port: 6800, host: '127.0.0.1', context_window_tokens: 80000, debug_prompt_context: false }, daemon: { port: 6790 } },
      memory: { retention_days: 30, index_rebuild_interval_minutes: 15 },
      budget: { daily_limit_cents: 1, per_job_limit_cents: 1, warn_at_percent: 80 },
    },
    dbManager: { get: () => db, health: () => [{ name: 'messages', ok: true }] },
    memory: {
      async save() {
        return 'mem-1';
      },
      remove() {
        return false;
      },
      search() {
        return [];
      },
    },
    llm: {
      async complete() {
        return { content: 'ok', provider: 'test', model: 'test', inputTokens: 0, outputTokens: 0 };
      },
    },
    authToken: 'test',
    identity: 'You are forge.',
    identityDir: '.',
    readIdentity: () => 'You are forge.',
    resolved: { root: '.', dbs: '.', identity: '.', logs: '.' },
    ...overrides,
  } as unknown as WebContext;
}

async function withServer(app: express.Express, fn: (url: string) => Promise<void>): Promise<void> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.notEqual(address, null);
  assert.notEqual(typeof address, 'string');
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

  try {
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
}

test('POST /api/messages handles /remember without calling the LLM', async () => {
  const db = makeDb();
  let llmCalls = 0;
  const saved: unknown[] = [];
  const app = express();
  app.use(express.json());
  app.use('/api/messages', messagesRoutes(makeCtx(db, {
    memory: {
      async save(input: unknown) {
        saved.push(input);
        return 'mem-1';
      },
      remove() {
        return false;
      },
      search() {
        return [];
      },
    },
    llm: {
      async complete() {
        llmCalls += 1;
        return { content: 'should not happen', provider: 'test', model: 'test', inputTokens: 0, outputTokens: 0 };
      },
    },
    authToken: 'test',
  })));

  await withServer(app, async (url) => {
    const response = await fetch(`${url}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '/remember Use configured names' }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();

    assert.equal(body.reply, 'Remembered. Memory ID: mem-1');
    assert.equal(body.agentName, 'forge');
    assert.equal(body.memoryId, 'mem-1');
  });

  assert.equal(llmCalls, 0);
  assert.deepEqual(saved, [{
    type: 'chat',
    content: 'Use configured names',
    tags: ['chat', 'explicit'],
    confidence: 1.0,
    importance: 0.7,
  }]);
  assert.equal(db.runs.length, 2);
});

test('POST /api/messages rejects non-string content before DB writes', async () => {
  const db = makeDb();
  const app = express();
  app.use(express.json());
  app.use('/api/messages', messagesRoutes(makeCtx(db, {
    memory: { search: () => [] },
    llm: { async complete() { throw new Error('should not run'); } },
  })));

  await withServer(app, async (url) => {
    const response = await fetch(`${url}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { bad: true } }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'content must be a non-empty string' });
  });

  assert.equal(db.runs.length, 0);
});

test('GET /api/messages/poll selects explicit safe columns and clamps limit', async () => {
  const db = makeDb([
    { id: '1', text: 'hello', receivedAt: 10 },
  ]);
  const app = express();
  app.use('/api/messages', messagesRoutes(makeCtx(db)));

  await withServer(app, async (url) => {
    const response = await fetch(`${url}/api/messages/poll?since=5&limit=999999`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.messages, [{ id: '1', text: 'hello', receivedAt: 10 }]);
  });

  assert.equal(db.allCalls.length, 1);
  assert.equal(db.allCalls[0].sql.includes('SELECT *'), false);
  assert.equal(db.allCalls[0].sql.includes('prompt_context'), false);
  assert.deepEqual(db.allCalls[0].args, [5, 500]);
});

test('GET /api/messages/poll rejects malformed query integers', async () => {
  const db = makeDb();
  const app = express();
  app.use('/api/messages', messagesRoutes(makeCtx(db)));

  await withServer(app, async (url) => {
    const response = await fetch(`${url}/api/messages/poll?since=abc&limit=50`);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'since must be a non-negative integer' });
  });

  assert.equal(db.allCalls.length, 0);
});

test('cookie-authenticated mutating API requests require same-origin headers', async () => {
  const db = makeDb();
  const app = createWebServer(makeCtx(db));

  await withServer(app, async (url) => {
    const login = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'test' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie');
    assert.ok(cookie);

    const blocked = await fetch(`${url}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ content: 'hello' }),
    });
    assert.equal(blocked.status, 403);
    assert.deepEqual(await blocked.json(), { error: 'Forbidden' });

    const allowed = await fetch(`${url}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: url },
      body: JSON.stringify({ content: { bad: true } }),
    });
    assert.equal(allowed.status, 400);
  });

  assert.equal(db.runs.length, 0);
});

test('health and readiness endpoints are available without auth', async () => {
  const app = createWebServer(makeCtx());

  await withServer(app, async (url) => {
    const health = await fetch(`${url}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });

    const ready = await fetch(`${url}/readyz`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { ok: true });
  });
});

test('malformed cookies are ignored instead of throwing', async () => {
  const app = createWebServer(makeCtx());

  await withServer(app, async (url) => {
    const response = await fetch(`${url}/api/messages/poll`, {
      headers: { Cookie: 'forge_session=%E0%A4%A' },
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Unauthorized' });
  });
});
