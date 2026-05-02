import { Router } from 'express';
import type { WebContext } from '../server.ts';
import { getAuthState, startClaudeOAuth, saveSlackTokens, saveOpenAIKey } from '../../auth/oauth.ts';

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
    saveSlackTokens(botToken, appToken, undefined, ctx.config);
    res.json({ ok: true, status: 'saved' });
  });

  router.post('/openai/key', (req, res) => {
    const { apiKey } = req.body;
    if (!apiKey) {
      res.status(400).json({ error: 'apiKey required' });
      return;
    }
    saveOpenAIKey(apiKey, undefined, ctx.config);
    res.json({ ok: true, status: 'saved' });
  });

  return router;
}
