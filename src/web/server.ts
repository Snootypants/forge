import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import type { ForgeConfig, ResolvedPaths } from '../types.ts';
import type { DatabaseManager } from '../db/manager.ts';
import type { MemoryService } from '../services/memory.ts';
import type { LLMService } from '../services/llm.ts';
import { settingsRoutes } from './routes/settings.ts';
import { messagesRoutes } from './routes/messages.ts';
import { authRoutes } from './routes/auth.ts';
import { identityRoutes } from './routes/identity.ts';

const COOKIE_NAME = 'forge_session';

export interface WebContext {
  config: ForgeConfig;
  dbManager: DatabaseManager;
  memory: MemoryService;
  llm: LLMService;
  authToken: string;
  identity: string;
  identityDir: string;
  resolved: ResolvedPaths;
}

function extractToken(req: express.Request): string | null {
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  const cookies = parseCookies(req.headers.cookie ?? '');
  return cookies[COOKIE_NAME] ?? null;
}

function parseCookies(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const [key, ...vals] = pair.trim().split('=');
    if (key) cookies[key.trim()] = decodeURIComponent(vals.join('='));
  }
  return cookies;
}

function isTokenValid(supplied: string | null, expected: string): boolean {
  if (!supplied) return false;
  const a = Buffer.from(supplied, 'utf-8');
  const b = Buffer.from(expected, 'utf-8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function createWebServer(ctx: WebContext): express.Express {
  const app = express();
  app.use(express.json());

  const publicDir = new URL('./public/', import.meta.url).pathname;
  app.use(express.static(publicDir));

  app.get('/api/public/info', (_req, res) => {
    res.json({
      name: ctx.config.forge.name,
      version: ctx.config.forge.version,
      memory: {
        retentionDays: ctx.config.memory.retention_days,
        contextWindowTokens: ctx.config.services.web.context_window_tokens,
        indexRebuildIntervalMinutes: ctx.config.memory.index_rebuild_interval_minutes,
      },
    });
  });

  const authMiddleware: express.RequestHandler = (req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      return next();
    }
    if (req.path === '/api/auth/login') return next();

    const token = extractToken(req);
    if (!isTokenValid(token, ctx.authToken)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };

  app.use(authMiddleware);

  app.post('/api/auth/login', (req, res) => {
    const { token } = req.body;
    if (!isTokenValid(token, ctx.authToken)) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const attrs = [
      `${COOKIE_NAME}=${encodeURIComponent(token)}`,
      'HttpOnly', 'Path=/', 'SameSite=Strict', 'Max-Age=31536000',
    ];
    if (isSecure) attrs.push('Secure');
    res.setHeader('Set-Cookie', attrs.join('; '));
    res.json({ ok: true });
  });

  app.use('/api/settings', settingsRoutes(ctx));
  app.use('/api/messages', messagesRoutes(ctx));
  app.use('/api/auth', authRoutes(ctx));
  app.use('/api/identity', identityRoutes(ctx.identityDir));

  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  return app;
}
