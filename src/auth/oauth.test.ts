import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  checkAnthropicAuth,
  checkOpenAIAuth,
  checkSlackAuth,
  getAuthState,
  saveAnthropicKey,
  saveOpenAIKey,
  saveSlackTokens,
} from './oauth.ts';
import type { ForgeConfig } from '../types.ts';

function config(): ForgeConfig {
  return {
    forge: { name: 'forge', version: '1.0.0', root: '.' },
    user: { name: 'tester' },
    api: {
      anthropic: { value: 'anthropic-key' },
      openai: { env: 'FORGE_OPENAI_KEY' },
      slack: {
        bot_token: { env: 'FORGE_SLACK_BOT' },
        app_token: { env: 'FORGE_SLACK_APP' },
        bot_user_id: '',
        channels: [],
        allow_all_channels: false,
        require_mention: true,
        allow_yolo: false,
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

test('auth checks resolve configured env key refs', () => {
  const cfg = config();
  const prior = {
    FORGE_OPENAI_KEY: process.env.FORGE_OPENAI_KEY,
    FORGE_SLACK_BOT: process.env.FORGE_SLACK_BOT,
    FORGE_SLACK_APP: process.env.FORGE_SLACK_APP,
  };

  try {
    process.env.FORGE_OPENAI_KEY = 'openai-key';
    process.env.FORGE_SLACK_BOT = 'bot-token';
    process.env.FORGE_SLACK_APP = 'app-token';

    assert.equal(checkAnthropicAuth(cfg), 'authenticated');
    assert.equal(checkOpenAIAuth(cfg), 'authenticated');
    assert.equal(checkSlackAuth(cfg), 'authenticated');
    const auth = getAuthState(cfg);
    assert.equal(auth.claude, 'authenticated');
    assert.equal(auth.anthropic, 'authenticated');
    assert.equal(auth.slack, 'authenticated');
    assert.equal(auth.openai, 'authenticated');
    assert.equal(auth.selectedProvider, 'claude-cli');
    assert.deepEqual(auth.providers.map(p => [p.provider, p.requirement, p.status]), [
      ['claude-cli', 'claude-oauth-or-anthropic-key', 'authenticated'],
      ['codex-cli', 'openai-api-key', 'authenticated'],
      ['openai-api', 'openai-api-key', 'authenticated'],
      ['anthropic-api', 'anthropic-api-key', 'authenticated'],
    ]);
  } finally {
    restoreEnv(prior);
  }
});

test('save helpers write configured env names and update process env', () => {
  const cfg = config();
  const prior = {
    FORGE_OPENAI_KEY: process.env.FORGE_OPENAI_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    FORGE_SLACK_BOT: process.env.FORGE_SLACK_BOT,
    FORGE_SLACK_APP: process.env.FORGE_SLACK_APP,
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-oauth-'));
  const envPath = path.join(dir, '.env');

  try {
    saveOpenAIKey('saved-openai', envPath, cfg);
    saveAnthropicKey('saved-anthropic', envPath, cfg);
    saveSlackTokens('saved-bot', 'saved-app', envPath, cfg);

    const saved = fs.readFileSync(envPath, 'utf-8');
    assert.match(saved, /FORGE_OPENAI_KEY="saved-openai"/);
    assert.match(saved, /ANTHROPIC_API_KEY="saved-anthropic"/);
    assert.match(saved, /FORGE_SLACK_BOT="saved-bot"/);
    assert.match(saved, /FORGE_SLACK_APP="saved-app"/);
    assert.equal(process.env.FORGE_OPENAI_KEY, 'saved-openai');
    assert.equal(process.env.ANTHROPIC_API_KEY, 'saved-anthropic');
    assert.equal(process.env.FORGE_SLACK_BOT, 'saved-bot');
    assert.equal(process.env.FORGE_SLACK_APP, 'saved-app');
  } finally {
    restoreEnv(prior);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function restoreEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
