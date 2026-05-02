import test from 'node:test';
import assert from 'node:assert/strict';
import { isSlackChannelAllowed, resolveSlackTokens } from './listener.ts';
import type { ForgeConfig } from '../types.ts';

test('isSlackChannelAllowed permits every channel when allowlist is empty', () => {
  assert.equal(isSlackChannelAllowed('C123', []), true);
});

test('isSlackChannelAllowed permits only configured Slack channel ids', () => {
  assert.equal(isSlackChannelAllowed('C123', ['C123', 'C456']), true);
  assert.equal(isSlackChannelAllowed('C999', ['C123', 'C456']), false);
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
      },
    },
    models: {
      default: 'claude-test',
      architect: 'claude-architect',
      sentinel: 'claude-sentinel',
    },
    paths: { dbs: './dbs', identity: './identity', logs: './logs' },
    services: { web: { port: 6800, context_window_tokens: 80000 }, daemon: { port: 6790 } },
    memory: { retention_days: 30, index_rebuild_interval_minutes: 15 },
    budget: { daily_limit_cents: 5000, per_job_limit_cents: 1500, warn_at_percent: 80 },
  };
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
