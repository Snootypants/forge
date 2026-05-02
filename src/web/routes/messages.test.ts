import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { messagesRoutes } from './messages.ts';

function makeDb() {
  const runs: unknown[][] = [];
  return {
    runs,
    prepare(sql: string) {
      return {
        all() {
          return sql.includes('SELECT * FROM messages') ? [] : [];
        },
        run(...args: unknown[]) {
          runs.push(args);
        },
      };
    },
  };
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
  app.use('/api/messages', messagesRoutes({
    config: {
      forge: { name: 'forge', version: '1.0.0', root: '.' },
      user: { name: 'Caleb' },
      api: {},
      models: { default: 'test', architect: 'test', sentinel: 'test' },
      paths: { dbs: './dbs', identity: './identity', logs: './logs' },
      services: { web: { port: 6800 }, daemon: { port: 6790 } },
      budget: { daily_limit_cents: 1, per_job_limit_cents: 1, warn_at_percent: 80 },
    },
    dbManager: { get: () => db },
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
        return { content: 'should not happen', model: 'test', inputTokens: 0, outputTokens: 0 };
      },
    },
    authToken: 'test',
    identity: 'You are forge.',
    identityDir: '.',
  } as never));

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
