import assert from 'node:assert/strict';
import test from 'node:test';
import { EmbedService } from './embed.ts';

test('EmbedService honors configured OpenAI env key refs', () => {
  const prior = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    FORGE_OPENAI_KEY: process.env.FORGE_OPENAI_KEY,
  };

  try {
    delete process.env.OPENAI_API_KEY;
    process.env.FORGE_OPENAI_KEY = 'configured-openai-key';

    const service = new EmbedService({ env: 'FORGE_OPENAI_KEY' });
    assert.equal(service.available, true);
  } finally {
    restoreEnv(prior);
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
