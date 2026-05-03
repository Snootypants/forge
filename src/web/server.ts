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
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface WebContext {
  config: ForgeConfig;
  dbManager: DatabaseManager;
  memory: MemoryService;
  llm: LLMService;
  authToken: string;
  identity: string;
  identityDir: string;
  readIdentity: () => string;
  resolved: ResolvedPaths;
}

type AuthCredential = {
  token: string;
  source: 'authorization' | 'cookie';
};

function extractToken(req: express.Request): AuthCredential | null {
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return { token: authHeader.slice(7), source: 'authorization' };
  }
  const cookies = parseCookies(req.headers.cookie ?? '');
  const token = cookies[COOKIE_NAME];
  return token ? { token, source: 'cookie' } : null;
}

function parseCookies(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const [key, ...vals] = pair.trim().split('=');
    if (!key) continue;
    try {
      cookies[key.trim()] = decodeURIComponent(vals.join('='));
    } catch {
      continue;
    }
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

function isSameOriginRequest(req: express.Request): boolean {
  const origin = req.headers.origin;
  if (typeof origin === 'string') {
    return isAllowedRequestOrigin(origin, req);
  }

  const referer = req.headers.referer;
  if (typeof referer === 'string') {
    return isAllowedRequestOrigin(referer, req);
  }

  return false;
}

function isAllowedRequestOrigin(rawOrigin: string, req: express.Request): boolean {
  let url: URL;
  try {
    url = new URL(rawOrigin);
  } catch {
    return false;
  }

  const host = req.get('host');
  if (!host) return false;

  const protocol = requestProtocol(req);
  return url.protocol.replace(':', '') === protocol && url.host === host;
}

function requestProtocol(req: express.Request): string {
  const forwarded = req.headers['x-forwarded-proto'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.protocol;
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

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/readyz', (_req, res) => {
    const databases = ctx.dbManager.health();
    const ok = databases.every(db => db.ok);
    res.status(ok ? 200 : 503).json({ ok });
  });

  const authMiddleware: express.RequestHandler = (req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      return next();
    }
    if (req.path === '/api/auth/login') return next();

    const credential = extractToken(req);
    if (!isTokenValid(credential?.token ?? null, ctx.authToken)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (
      credential?.source === 'cookie'
      && MUTATING_METHODS.has(req.method)
      && !isSameOriginRequest(req)
    ) {
      res.status(403).json({ error: 'Forbidden' });
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
  app.use('/api/identity', identityRoutes(ctx.identityDir, () => {
    ctx.identity = ctx.readIdentity();
  }));

  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  return app;
}
