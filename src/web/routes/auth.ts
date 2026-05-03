import { Router } from 'express';
import type { WebContext } from '../server.ts';
import { getAuthState, startClaudeOAuth, saveSlackTokens, saveOpenAIKey, saveAnthropicKey } from '../../auth/oauth.ts';
import { sanitizeProviderError } from '../../services/llm.ts';

export function authRoutes(ctx: WebContext): Router {
  const router = Router();

  router.get('/status', (_req, res) => {
    res.json(getAuthState(ctx.config));
  });

  router.post('/claude/login', async (_req, res) => {
    res.json({ status: 'started', message: 'OAuth flow started — check the browser on the server machine' });
    const result = await startClaudeOAuth();
    if (!result.success) {
      console.error('[auth] Claude OAuth failed:', result.error);
    }
  });

  router.post('/slack/tokens', (req, res) => {
    const { botToken, appToken } = req.body;
    if (!botToken || !appToken) {
      res.status(400).json({ error: 'botToken and appToken required' });
      return;
    }
    try {
      saveSlackTokens(botToken, appToken, undefined, ctx.config);
      res.json({ ok: true, status: 'saved' });
    } catch (err) {
      res.status(500).json({ error: sanitizeProviderError(err, 'failed to save Slack tokens') });
    }
  });

  router.post('/openai/key', (req, res) => {
    const { apiKey } = req.body;
    if (!apiKey) {
      res.status(400).json({ error: 'apiKey required' });
      return;
    }
    try {
      saveOpenAIKey(apiKey, undefined, ctx.config);
      res.json({ ok: true, status: 'saved' });
    } catch (err) {
      res.status(500).json({ error: sanitizeProviderError(err, 'failed to save OpenAI API key') });
    }
  });

  router.post('/anthropic/key', (req, res) => {
    const { apiKey } = req.body;
    if (!apiKey) {
      res.status(400).json({ error: 'apiKey required' });
      return;
    }
    try {
      saveAnthropicKey(apiKey, undefined, ctx.config);
      res.json({ ok: true, status: 'saved' });
    } catch (err) {
      res.status(500).json({ error: sanitizeProviderError(err, 'failed to save Anthropic API key') });
    }
  });

  return router;
}
