import { Router } from 'express';
import crypto from 'node:crypto';
import type { WebContext } from '../server.ts';
import { buildChatContext, handleMemoryCommand } from '../../services/chat.ts';
import { sanitizeProviderError } from '../../services/llm.ts';

const DEFAULT_POLL_LIMIT = 200;
const MAX_POLL_LIMIT = 500;

const POLL_COLUMNS = [
  'id',
  'channel',
  'channelName',
  'user',
  'userName',
  'text',
  'ts',
  'threadTs',
  'mentioned',
  'receivedAt',
  'llm_metadata',
  'subtype',
].join(', ');

export function messagesRoutes(ctx: WebContext): Router {
  const router = Router();

  router.get('/poll', (req, res) => {
    const since = parsePollInteger(req.query.since, 'since');
    if (!since.ok) {
      res.status(400).json({ error: since.error });
      return;
    }

    const limit = parsePollInteger(req.query.limit, 'limit');
    if (!limit.ok) {
      res.status(400).json({ error: limit.error });
      return;
    }

    const effectiveLimit = clamp(limit.value ?? DEFAULT_POLL_LIMIT, 1, MAX_POLL_LIMIT);
    const db = ctx.dbManager.get('messages');

    let rows;
    if (since.value !== undefined) {
      rows = db.prepare(`
        SELECT ${POLL_COLUMNS} FROM messages
        WHERE receivedAt > ?
        ORDER BY receivedAt ASC
        LIMIT ?
      `).all(since.value, effectiveLimit);
    } else {
      rows = db.prepare(`
        SELECT ${POLL_COLUMNS} FROM messages
        ORDER BY receivedAt DESC
        LIMIT ?
      `).all(effectiveLimit).reverse();
    }

    res.json({
      messages: rows,
      agentName: ctx.config.forge.name,
      ui: {
        contextWindowTokens: ctx.config.services.web.context_window_tokens,
      },
    });
  });

  router.post('/', async (req, res) => {
    const { content } = req.body;
    if (typeof content !== 'string' || content.trim().length === 0) {
      res.status(400).json({ error: 'content must be a non-empty string' });
      return;
    }

    try {
      const db = ctx.dbManager.get('messages');
      const ts = Date.now().toString();
      const userId = `web:user:${crypto.randomUUID()}`;

      db.prepare(`
        INSERT INTO messages (id, channel, channelName, user, userName, text, ts, receivedAt)
        VALUES (?, 'web', 'web', 'user', ?, ?, ?, ?)
      `).run(userId, ctx.config.user.name, content, ts, Date.now());

      const command = await handleMemoryCommand(ctx.memory, content);
      if (command) {
        const replyTs = (Date.now() + 1).toString();
        const replyId = `web:assistant:${crypto.randomUUID()}`;
        db.prepare(`
          INSERT INTO messages (id, channel, channelName, user, userName, text, ts, threadTs, receivedAt)
          VALUES (?, 'web', 'web', 'assistant', ?, ?, ?, ?, ?)
        `).run(
          replyId,
          ctx.config.forge.name,
          command.reply,
          replyTs,
          ts,
          Date.now(),
        );

        res.json({
          reply: command.reply,
          ts: replyTs,
          agentName: ctx.config.forge.name,
          memoryId: command.memoryId,
        });
        return;
      }

      const context = buildChatContext({
        messagesDb: ctx.dbManager.get('messages'),
        memory: ctx.memory,
        identity: ctx.readIdentity(),
        assistantName: ctx.config.forge.name,
        currentMessage: content,
        userName: ctx.config.user.name,
        channel: 'web',
        interfaceName: 'Web Chat',
      });
      const response = await ctx.llm.complete({
        system: context.system,
        messages: context.messages,
      });

      const replyTs = (Date.now() + 1).toString();
      const replyId = `web:assistant:${crypto.randomUUID()}`;
      const promptContext = JSON.stringify({
        system: context.system,
        messages: context.messages,
      });
      db.prepare(`
        INSERT INTO messages (id, channel, channelName, user, userName, text, ts, threadTs, receivedAt, llm_metadata, prompt_context)
        VALUES (?, 'web', 'web', 'assistant', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        replyId,
        ctx.config.forge.name,
        response.content,
        replyTs,
        ts,
        Date.now(),
        JSON.stringify({ provider: response.provider, model: response.model, inputTokens: response.inputTokens, outputTokens: response.outputTokens }),
        promptContext,
      );

      res.json({
        reply: response.content,
        provider: response.provider,
        model: response.model,
        ts: replyTs,
        agentName: ctx.config.forge.name,
        usage: { input: response.inputTokens, output: response.outputTokens },
        ...(ctx.config.services.web.debug_prompt_context ? { prompt_context: promptContext } : {}),
      });
    } catch (err) {
      const msg = sanitizeProviderError(err, 'chat request failed');
      console.error('[web] Chat error:', msg);
      res.status(500).json({ error: msg });
    }
  });

  return router;
}

type ParsedPollInteger =
  | { ok: true; value: number | undefined }
  | { ok: false; error: string };

function parsePollInteger(value: unknown, name: 'since' | 'limit'): ParsedPollInteger {
  if (value === undefined) return { ok: true, value: undefined };
  if (Array.isArray(value)) return { ok: false, error: `${name} must be a single integer` };
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return { ok: false, error: `${name} must be a non-negative integer` };
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    return { ok: false, error: `${name} is too large` };
  }
  return { ok: true, value: parsed };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
