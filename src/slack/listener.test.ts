import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseManager } from '../db/manager.ts';
import { isSlackChannelAllowed, isSlackUserAllowed, resolveSlackTokens, shouldRespondToSlackMessage, upsertSlackMessage } from './listener.ts';
import type { ForgeConfig } from '../types.ts';

test('isSlackChannelAllowed denies channels when allowlist is empty', () => {
  assert.equal(isSlackChannelAllowed('C123', []), false);
});

test('isSlackChannelAllowed permits only configured Slack channel ids', () => {
  assert.equal(isSlackChannelAllowed('C123', ['C123', 'C456']), true);
  assert.equal(isSlackChannelAllowed('C999', ['C123', 'C456']), false);
});

test('isSlackUserAllowed permits configured Slack users and admins only', () => {
  assert.equal(isSlackUserAllowed('U123', ['U123'], []), true);
  assert.equal(isSlackUserAllowed('Uadmin', [], ['Uadmin']), true);
  assert.equal(isSlackUserAllowed('U999', ['U123'], ['Uadmin']), false);
  assert.equal(isSlackUserAllowed('', ['U123'], ['Uadmin']), false);
});

test('shouldRespondToSlackMessage requires listed DM users', () => {
  const cfg = config();
  assert.equal(shouldRespondToSlackMessage({ config: cfg, channel: 'D123', text: 'hello', botUserId: 'Ubot', userId: 'U999' }), false);

  cfg.api.slack!.user_allowlist = ['U123'];
  assert.equal(shouldRespondToSlackMessage({ config: cfg, channel: 'D123', text: 'hello', botUserId: 'Ubot', userId: 'U123' }), true);
  assert.equal(shouldRespondToSlackMessage({ config: cfg, channel: 'D123', text: '/remember secret', botUserId: 'Ubot', userId: 'U999' }), false);

  cfg.api.slack!.admin_allowlist = ['Uadmin'];
  assert.equal(shouldRespondToSlackMessage({ config: cfg, channel: 'D123', text: 'hello', botUserId: 'Ubot', userId: 'Uadmin' }), true);
});

test('shouldRespondToSlackMessage requires trusted channel and listed channel users', () => {
  const cfg = config();
  cfg.api.slack!.channels = ['C123'];
  cfg.api.slack!.user_allowlist = ['U123'];

  assert.equal(shouldRespondToSlackMessage({ config: cfg, channel: 'C123', text: '<@Ubot> hello', botUserId: 'Ubot', userId: 'U999' }), false);
  assert.equal(shouldRespondToSlackMessage({ config: cfg, channel: 'C999', text: '<@Ubot> hello', botUserId: 'Ubot', userId: 'U123' }), false);
  assert.equal(shouldRespondToSlackMessage({ config: cfg, channel: 'C123', text: 'hello', botUserId: 'Ubot', userId: 'U123' }), false);
  assert.equal(shouldRespondToSlackMessage({ config: cfg, channel: 'C123', text: '<@Ubot> hello', botUserId: 'Ubot', userId: 'U123' }), true);

  cfg.api.slack!.require_mention = false;
  assert.equal(shouldRespondToSlackMessage({ config: cfg, channel: 'C123', text: 'hello', botUserId: 'Ubot', userId: 'U123' }), true);
});

test('shouldRespondToSlackMessage default-denies bot and app messages', () => {
  const cfg = config();
  cfg.api.slack!.channels = ['C123'];

  assert.equal(shouldRespondToSlackMessage({ config: cfg, channel: 'C123', text: '<@Ubot> hello', botUserId: 'Ubot', subtype: 'bot_message', botId: 'B123' }), false);
  assert.equal(shouldRespondToSlackMessage({ config: cfg, channel: 'C123', text: '<@Ubot> hello', botUserId: 'Ubot', appId: 'A123' }), false);

  cfg.api.slack!.allow_bot_messages = true;
  assert.equal(shouldRespondToSlackMessage({ config: cfg, channel: 'C123', text: '<@Ubot> hello', botUserId: 'Ubot', subtype: 'bot_message', botId: 'B123' }), true);

  cfg.api.slack!.allow_app_messages = true;
  assert.equal(shouldRespondToSlackMessage({ config: cfg, channel: 'C123', text: '<@Ubot> hello', botUserId: 'Ubot', appId: 'A123' }), true);
});

test('shouldRespondToSlackMessage gates yolo only for CLI providers', () => {
  const cfg = config();
  cfg.llm.permission_mode = 'yolo';
  cfg.api.slack!.channels = ['C123'];
  cfg.api.slack!.user_allowlist = ['U123'];

  cfg.llm.provider = 'openai-api';
  assert.equal(shouldRespondToSlackMessage({ config: cfg, channel: 'C123', text: '<@Ubot> hello', botUserId: 'Ubot', userId: 'U123' }), true);

  cfg.llm.provider = 'anthropic-api';
  assert.equal(shouldRespondToSlackMessage({ config: cfg, channel: 'C123', text: '<@Ubot> hello', botUserId: 'Ubot', userId: 'U123' }), true);

  cfg.llm.provider = 'claude-cli';
  assert.equal(shouldRespondToSlackMessage({ config: cfg, channel: 'C123', text: '<@Ubot> hello', botUserId: 'Ubot', userId: 'U123' }), false);
  cfg.api.slack!.allow_yolo = true;
  assert.equal(shouldRespondToSlackMessage({ config: cfg, channel: 'C123', text: '<@Ubot> hello', botUserId: 'Ubot', userId: 'U123' }), true);

  cfg.llm.provider = 'codex-cli';
  cfg.api.slack!.allow_yolo = false;
  assert.equal(shouldRespondToSlackMessage({ config: cfg, channel: 'C123', text: '<@Ubot> hello', botUserId: 'Ubot', userId: 'U123' }), false);
});

test('resolveSlackTokens honors configured key refs before default env names', () => {
  const cfg = config();
  const prior = {
    FORGE_SLACK_BOT: process.env.FORGE_SLACK_BOT,
    FORGE_SLACK_APP: process.env.FORGE_SLACK_APP,
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
    SLACK_APP_TOKEN: process.env.SLACK_APP_TOKEN,
  };

  try {
    process.env.FORGE_SLACK_BOT = 'configured-bot';
    process.env.FORGE_SLACK_APP = 'configured-app';
    process.env.SLACK_BOT_TOKEN = 'default-bot';
    process.env.SLACK_APP_TOKEN = 'default-app';

    assert.deepEqual(resolveSlackTokens(cfg), {
      botToken: 'configured-bot',
      appToken: 'configured-app',
    });
  } finally {
    restoreEnv(prior);
  }
});

test('upsertSlackMessage updates messages without bypassing FTS update triggers', () => {
  const dbDir = mkdtempSync(path.join(os.tmpdir(), 'forge-slack-listener-'));
  const manager = new DatabaseManager(dbDir);
  const db = manager.open('messages');

  try {
    upsertSlackMessage(db, {
      id: 'C123:1.0',
      channel: 'C123',
      channelName: 'general',
      user: 'U123',
      userName: 'Morgan',
      text: 'alpha bravo',
      ts: '1.0',
      threadTs: null,
      mentioned: 0,
      receivedAt: 1,
    });

    upsertSlackMessage(db, {
      id: 'C123:1.0',
      channel: 'C123',
      channelName: 'general',
      user: 'U123',
      userName: 'Morgan',
      text: 'charlie delta',
      ts: '1.0',
      threadTs: null,
      mentioned: 1,
      receivedAt: 2,
    });

    assert.deepEqual(searchFts(db, 'alpha'), []);
    assert.deepEqual(searchFts(db, 'charlie'), [{ id: 'C123:1.0', text: 'charlie delta' }]);
    assert.equal(countFtsRows(db), 1);
  } finally {
    manager.closeAll();
    rmSync(dbDir, { recursive: true, force: true });
  }
});

function config(): ForgeConfig {
  return {
    forge: { name: 'forge', version: '1.0.0', root: '.' },
    user: { name: 'tester' },
    api: {
      slack: {
        bot_token: { env: 'FORGE_SLACK_BOT' },
        app_token: { env: 'FORGE_SLACK_APP' },
        bot_user_id: '',
        channels: [],
        user_allowlist: [],
        admin_allowlist: [],
        allow_all_channels: false,
        require_mention: true,
        allow_yolo: false,
        allow_bot_messages: false,
        allow_app_messages: false,
      },
    },
    models: {
      default: 'claude-test',
      architect: 'claude-architect',
      sentinel: 'claude-sentinel',
    },
    llm: { provider: 'claude-cli', model: 'claude-test', permission_mode: 'default' },
    paths: { dbs: './dbs', identity: './identity', logs: './logs' },
    services: { web: { port: 6800, host: '127.0.0.1', context_window_tokens: 80000, debug_prompt_context: false }, daemon: { port: 6790 } },
    memory: { retention_days: 30, index_rebuild_interval_minutes: 15 },
    budget: { daily_limit_cents: 5000, per_job_limit_cents: 1500, warn_at_percent: 80 },
  };
}

function searchFts(db: ReturnType<DatabaseManager['open']>, term: string): Array<{ id: string; text: string }> {
  return db.prepare(`
    SELECT id, text
    FROM messages_fts
    WHERE messages_fts MATCH ?
    ORDER BY rowid
  `).all(term) as Array<{ id: string; text: string }>;
}

function countFtsRows(db: ReturnType<DatabaseManager['open']>): number {
  const row = db.prepare('SELECT count(*) AS count FROM messages_fts').get() as { count: number };
  return row.count;
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
