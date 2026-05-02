import assert from 'node:assert/strict';
import test from 'node:test';
import { LLMService } from './llm.ts';
import type { ForgeConfig } from '../types.ts';

function config(overrides: Partial<ForgeConfig> = {}): ForgeConfig {
  return {
    forge: { name: 'forge', version: '1.0.0', root: '.' },
    user: { name: 'tester' },
    api: {
      anthropic: { value: 'configured-anthropic-key' },
      openai: { env: 'OPENAI_API_KEY' },
      slack: {
        bot_token: { env: 'SLACK_BOT_TOKEN' },
        app_token: { env: 'SLACK_APP_TOKEN' },
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
    ...overrides,
  };
}

test('LLMService runs Claude CLI with configured Anthropic key and sanitized env', async () => {
  const prior = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    FORGE_EMBER: process.env.FORGE_EMBER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };

  try {
    process.env.ANTHROPIC_API_KEY = 'ambient-anthropic-key';
    process.env.FORGE_EMBER = 'legacy-name';
    process.env.OPENAI_API_KEY = 'openai-secret';

    let captured:
      | { args: string[]; env: Record<string, string>; stdin: string }
      | null = null;

    const service = new LLMService(config(), {
      runClaudeCli: async (args, options) => {
        captured = { args, env: options.env, stdin: options.stdin };
        return {
          code: 0,
          stderr: '',
          stdout: JSON.stringify({
            type: 'result',
            subtype: 'success',
            result: 'hello from claude',
            usage: { input_tokens: 12, output_tokens: 5 },
          }),
        };
      },
    });

    const response = await service.complete({
      system: 'system prompt',
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'middle' },
        { role: 'user', content: 'last' },
      ],
    });

    assert.deepEqual(response, {
      content: 'hello from claude',
      model: 'claude-test',
      inputTokens: 12,
      outputTokens: 5,
    });
    const run = expectCaptured(captured);
    assert.equal(run.stdin, 'last');
    assert.deepEqual(run.args.slice(0, 7), [
      '--print',
      '--output-format',
      'json',
      '--model',
      'claude-test',
      '--permission-mode',
      'bypassPermissions',
    ]);
    assert.ok(run.args.includes('--no-session-persistence'));
    assert.ok(run.args.includes('--bare'));
    assert.equal(run.env.ANTHROPIC_API_KEY, 'configured-anthropic-key');
    assert.equal(run.env.FORGE_EMBER, undefined);
    assert.equal(run.env.OPENAI_API_KEY, undefined);
  } finally {
    restoreEnv(prior);
  }
});

test('LLMService rejects requests without a user message', async () => {
  const service = new LLMService(config(), {
    runClaudeCli: async () => {
      throw new Error('should not run');
    },
  });

  await assert.rejects(
    service.complete({
      system: 'system prompt',
      messages: [{ role: 'assistant', content: 'hello' }],
    }),
    /No user message/,
  );
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

function expectCaptured(
  captured: { args: string[]; env: Record<string, string>; stdin: string } | null,
): { args: string[]; env: Record<string, string>; stdin: string } {
  assert.ok(captured);
  return captured;
}
