import assert from 'node:assert/strict';
import test from 'node:test';
import { LLMService } from './llm.ts';
import { makeCommandRunner, sanitizeProviderError } from './llm/shared.ts';
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
        { role: 'user', content: 'first', timestamp: '2026-05-01T10:00:00.000Z' },
        { role: 'assistant', content: 'middle', name: 'forge' },
        { role: 'user', content: 'last' },
      ],
    });

    assert.deepEqual(response, {
      content: 'hello from claude',
      provider: 'claude-cli',
      model: 'claude-test',
      inputTokens: 12,
      outputTokens: 5,
    });
    const run = expectCaptured(captured);
    assert.equal(
      run.stdin,
      JSON.stringify([
        { role: 'user', content: 'first', timestamp: '2026-05-01T10:00:00.000Z' },
        { role: 'assistant', content: 'middle', name: 'forge' },
        { role: 'user', content: 'last' },
      ], null, 2),
    );
    assert.deepEqual(run.args.slice(0, 5), [
      '--print',
      '--output-format',
      'json',
      '--model',
      'claude-test',
    ]);
    assert.equal(run.args.includes('--permission-mode'), false);
    assert.equal(run.args.includes('bypassPermissions'), false);
    assert.ok(run.args.includes('--no-session-persistence'));
    assert.equal(run.args[run.args.indexOf('--system-prompt') + 1], 'system prompt');
    assert.ok(run.args.includes('--bare'));
    assert.equal(run.env.ANTHROPIC_API_KEY, 'configured-anthropic-key');
    assert.equal(run.env.FORGE_EMBER, undefined);
    assert.equal(run.env.OPENAI_API_KEY, undefined);
  } finally {
    restoreEnv(prior);
  }
});

test('Claude CLI provider maps yolo permission mode explicitly', async () => {
  let captured: { args: string[]; stdin: string } | null = null;
  const service = new LLMService(config({
    llm: { provider: 'claude-cli', model: 'claude-test', permission_mode: 'yolo' },
  }), {
    runClaudeCli: async (args, options) => {
      captured = { args, stdin: options.stdin };
      return {
        code: 0,
        stderr: '',
        stdout: JSON.stringify({ result: 'ok', usage: { input_tokens: 1, output_tokens: 2 } }),
      };
    },
  });

  const response = await service.complete({
    system: 'system prompt',
    messages: [{ role: 'user', content: 'hello' }],
  });

  assert.equal(response.provider, 'claude-cli');
  const run = expectCaptured(captured);
  assert.equal(run.args.includes('--permission-mode'), true);
  assert.equal(run.args[run.args.indexOf('--permission-mode') + 1], 'bypassPermissions');
});

test('Codex CLI provider receives normalized prompt and yolo flags', async () => {
  let captured:
    | { args: string[]; env: Record<string, string>; stdin: string; cwd?: string }
    | null = null;

  const service = new LLMService(config({
    api: {
      openai: { value: 'configured-openai-key' },
    },
    llm: {
      provider: 'codex-cli',
      model: 'gpt-test',
      permission_mode: 'yolo',
      workdir: '/tmp/forge-work',
    },
  }), {
    runCodexCli: async (args, options) => {
      captured = { args, env: options.env, stdin: options.stdin, cwd: options.cwd };
      return { code: 0, stderr: '', stdout: 'hello from codex\n' };
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

  assert.equal(response.content, 'hello from codex');
  assert.equal(response.provider, 'codex-cli');
  assert.equal(response.model, 'gpt-test');
  assert.ok(response.inputTokens > 0);
  assert.ok(response.outputTokens > 0);
  const run = expectCaptured(captured);
  assert.deepEqual(run.args, [
    'exec',
    '--model',
    'gpt-test',
    '--ephemeral',
    '--color',
    'never',
    '--cd',
    '/tmp/forge-work',
    '--dangerously-bypass-approvals-and-sandbox',
    '-',
  ]);
  assert.equal(run.cwd, '/tmp/forge-work');
  assert.equal(run.env.OPENAI_API_KEY, 'configured-openai-key');
  assert.equal(
    run.stdin,
    JSON.stringify({
      system: 'system prompt',
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'middle' },
        { role: 'user', content: 'last' },
      ],
    }, null, 2),
  );
});

test('OpenAI API provider sends structured role-preserving Responses input', async () => {
  let captured: any = null;
  const service = new LLMService(config({
    llm: { provider: 'openai-api', permission_mode: 'default' },
  }), {
    openAIClient: {
      responses: {
        create: async (params) => {
          captured = params;
          return { output_text: 'hello from openai', usage: { input_tokens: 21, output_tokens: 8 } };
        },
      },
    },
  });

  const response = await service.complete({
    system: 'system prompt',
    messages: [
      { role: 'system', content: 'inline system' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ],
  });

  assert.deepEqual(response, {
    content: 'hello from openai',
    provider: 'openai-api',
    model: 'gpt-5.2',
    inputTokens: 21,
    outputTokens: 8,
  });
  assert.deepEqual(captured, {
    model: 'gpt-5.2',
    instructions: 'system prompt',
    input: [
      { type: 'message', role: 'system', content: 'inline system' },
      { type: 'message', role: 'user', content: 'hello' },
      { type: 'message', role: 'assistant', content: 'hi' },
    ],
  });
});

test('OpenAI API provider rejects incompatible configured Claude model', () => {
  assert.throws(
    () => new LLMService(config({
      llm: { provider: 'openai-api', model: 'claude-sonnet-4-6', permission_mode: 'default' },
    }), {
      openAIClient: {
        responses: {
          create: async () => ({ output_text: 'unused' }),
        },
      },
    }),
    /configured llm\.model "claude-sonnet-4-6" is not compatible with OpenAI API/,
  );
});

test('OpenAI API provider requires auth when no client is injected', async () => {
  const prior = { OPENAI_API_KEY: process.env.OPENAI_API_KEY };
  try {
    delete process.env.OPENAI_API_KEY;
    const service = new LLMService(config({
      api: {},
      llm: { provider: 'openai-api', model: 'gpt-test', permission_mode: 'default' },
    }));

    await assert.rejects(
      service.complete({ system: 'system', messages: [{ role: 'user', content: 'hello' }] }),
      /OpenAI API provider requires OPENAI_API_KEY or api\.openai/,
    );
  } finally {
    restoreEnv(prior);
  }
});

test('OpenAI API provider sanitizes client errors', async () => {
  const service = new LLMService(config({
    llm: { provider: 'openai-api', model: 'gpt-test', permission_mode: 'default' },
  }), {
    openAIClient: {
      responses: {
        create: async () => {
          throw new Error('request failed with api_key=sk-proj-1234567890abcdef and bearer sk-1234567890abcdef');
        },
      },
    },
  });

  await assert.rejects(
    service.complete({ system: 'system', messages: [{ role: 'user', content: 'hello' }] }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /OpenAI API failed:/);
      assert.doesNotMatch(err.message, /1234567890abcdef/);
      assert.match(err.message, /\[redacted\]/);
      return true;
    },
  );
});

test('Anthropic API provider sends model, system, role messages, and parses usage', async () => {
  const priorFetch = globalThis.fetch;
  let captured: { url: string; init: RequestInit } | null = null;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), init: init ?? {} };
    return new Response(JSON.stringify({
      content: [{ type: 'text', text: 'hello from anthropic' }],
      usage: { input_tokens: 13, output_tokens: 7 },
    }), { status: 200 });
  };

  try {
    const service = new LLMService(config({
      llm: { provider: 'anthropic-api', permission_mode: 'default' },
    }));

    const response = await service.complete({
      system: 'root system',
      messages: [
        { role: 'system', content: 'inline system' },
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ],
    });

    assert.deepEqual(response, {
      content: 'hello from anthropic',
      provider: 'anthropic-api',
      model: 'claude-sonnet-4-6',
      inputTokens: 13,
      outputTokens: 7,
    });
    const request = expectCaptured(captured);
    assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
    const body = JSON.parse(String(request.init.body));
    assert.equal(body.model, 'claude-sonnet-4-6');
    assert.equal(body.system, 'root system\n\ninline system');
    assert.deepEqual(body.messages, [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]);
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test('Anthropic API provider sanitizes response errors', async () => {
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('bad key sk-ant-1234567890abcdef token=secret-value', {
    status: 401,
    statusText: 'Unauthorized',
  });

  try {
    const service = new LLMService(config({
      llm: { provider: 'anthropic-api', model: 'claude-test', permission_mode: 'default' },
    }));

    await assert.rejects(
      service.complete({ system: 'system', messages: [{ role: 'user', content: 'hello' }] }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /Anthropic API failed:/);
        assert.doesNotMatch(err.message, /1234567890abcdef/);
        assert.doesNotMatch(err.message, /secret-value/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test('Anthropic API provider requires auth and rejects incompatible request model', async () => {
  const prior = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY };
  try {
    delete process.env.ANTHROPIC_API_KEY;
    const noKey = config({
      api: { openai: { env: 'OPENAI_API_KEY' } },
      llm: { provider: 'anthropic-api', permission_mode: 'default' },
    });
    const service = new LLMService(noKey);

    await assert.rejects(
      service.complete({ system: 'system', messages: [{ role: 'user', content: 'hello' }] }),
      /Anthropic API provider requires ANTHROPIC_API_KEY or api\.anthropic/,
    );

    const withKey = new LLMService(config({
      llm: { provider: 'anthropic-api', permission_mode: 'default' },
    }));
    await assert.rejects(
      withKey.complete({
        system: 'system',
        model: 'gpt-5.2',
        messages: [{ role: 'user', content: 'hello' }],
      }),
      /request model "gpt-5.2" is not compatible with Anthropic API/,
    );
  } finally {
    restoreEnv(prior);
  }
});

test('CLI command runner truncates output and kills subprocess on overflow', async () => {
  const runner = makeCommandRunner(process.execPath);
  const result = await runner([
    '-e',
    'process.stdout.write("abcdefghijklmnopqrstuvwxyz"); setTimeout(() => {}, 10000);',
  ], {
    env: { PATH: process.env.PATH ?? '' },
    stdin: '',
    maxOutputBytes: 10,
  });

  assert.equal(result.stdout, 'abcdefghij');
  assert.equal(result.code, null);
  assert.match(result.stderr, /stdout exceeded 10 bytes/);
});

test('Codex CLI provider parses JSON usage when available', async () => {
  const service = new LLMService(config({
    api: { openai: { value: 'configured-openai-key' } },
    llm: { provider: 'codex-cli', model: 'gpt-test', permission_mode: 'default' },
  }), {
    runCodexCli: async () => ({
      code: 0,
      stderr: '',
      stdout: JSON.stringify({ result: 'json codex', usage: { input_tokens: 9, output_tokens: 4 } }),
    }),
  });

  const response = await service.complete({
    system: 'system prompt',
    messages: [{ role: 'user', content: 'hello' }],
  });

  assert.equal(response.content, 'json codex');
  assert.equal(response.inputTokens, 9);
  assert.equal(response.outputTokens, 4);
});

test('provider error sanitizer redacts common API key shapes', () => {
  const sanitized = sanitizeProviderError('api_key=sk-proj-1234567890abcdef token=xoxb-1234567890-secret');
  assert.doesNotMatch(sanitized, /1234567890/);
  assert.match(sanitized, /\[redacted\]/);
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

function expectCaptured(captured: unknown): any {
  assert.ok(captured);
  return captured;
}
