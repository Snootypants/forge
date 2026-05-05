import { Router } from 'express';
import crypto from 'node:crypto';
import type { WebContext } from '../server.ts';
import { buildChatContextAsync, handleMemoryCommand } from '../../services/chat.ts';
import { getLLMModelCatalog, getLLMProviderRequirements, isCatalogProviderModel, providerDefaultModel, sanitizeProviderError } from '../../services/llm.ts';
import { LLMProviderSchema, type ForgeConfig } from '../../types.ts';
import { readStoredSettings } from './settings.ts';

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
];

function pollColumns(ctx: WebContext): string {
  const columns = [...POLL_COLUMNS];
  if (ctx.config.services.web.debug_prompt_context) {
    columns.push('prompt_context');
  }
  return columns.join(', ');
}

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
    const columns = pollColumns(ctx);
    const settings = readStoredSettings(ctx);

    let rows;
    if (since.value !== undefined) {
      rows = db.prepare(`
        SELECT ${columns} FROM messages
        WHERE receivedAt > ?
        ORDER BY receivedAt ASC
        LIMIT ?
      `).all(since.value, effectiveLimit);
    } else {
      rows = db.prepare(`
        SELECT ${columns} FROM messages
        ORDER BY receivedAt DESC
        LIMIT ?
      `).all(effectiveLimit).reverse();
    }

    res.json({
      messages: rows,
      agentName: ctx.config.forge.name,
      ui: {
        contextWindowTokens: ctx.config.services.web.context_window_tokens,
        debugPromptContext: ctx.config.services.web.debug_prompt_context,
        models: ctx.config.models,
        llm: {
          provider: settings.chatProvider ?? ctx.config.llm.provider,
          model: settings.chatModel ?? ctx.config.llm.model,
          permission_mode: settings.permissionMode ?? ctx.config.llm.permission_mode,
        },
        llmProviderRequirements: getLLMProviderRequirements(ctx.config),
        llmModelCatalog: getLLMModelCatalog(ctx.config),
      },
    });
  });

  router.post('/', async (req, res) => {
    const settings = readStoredSettings(ctx);
    const { content, provider, model } = req.body;
    if (typeof content !== 'string' || content.trim().length === 0) {
      res.status(400).json({ error: 'content must be a non-empty string' });
      return;
    }
    const requestedProvider = parseOptionalProvider(provider);
    if (!requestedProvider.ok) {
      res.status(400).json({ error: requestedProvider.error });
      return;
    }
    const requestedModel = parseOptionalModel(model);
    if (!requestedModel.ok) {
      res.status(400).json({ error: requestedModel.error });
      return;
    }
    const requestedLLM = resolveRequestedLLM(ctx.config, settings, requestedProvider.value, requestedModel.value);
    if (!requestedLLM.ok) {
      res.status(400).json({ error: requestedLLM.error });
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

      const context = await buildChatContextAsync({
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
        provider: requestedLLM.provider,
        model: requestedLLM.model,
        permissionMode: settings.permissionMode ?? ctx.config.llm.permission_mode,
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

type ParsedOptionalProvider =
  | { ok: true; value: ForgeConfig['llm']['provider'] | undefined }
  | { ok: false; error: string };

function parseOptionalProvider(value: unknown): ParsedOptionalProvider {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: undefined };
  }
  const parsed = LLMProviderSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: 'provider must be claude-cli, codex-cli, openai-api, or anthropic-api' };
  }
  return { ok: true, value: parsed.data };
}

type ResolvedRequestedLLM =
  | { ok: true; provider: ForgeConfig['llm']['provider']; model: string }
  | { ok: false; error: string };

function resolveRequestedLLM(
  config: ForgeConfig,
  settings: { chatProvider?: ForgeConfig['llm']['provider']; chatModel?: string },
  requestedProvider: ForgeConfig['llm']['provider'] | undefined,
  requestedModel: string | undefined,
): ResolvedRequestedLLM {
  const inheritedProvider = settings.chatProvider ?? config.llm.provider;
  const provider = requestedProvider ?? inheritedProvider;
  const model = requestedModel
    ?? (requestedProvider && requestedProvider !== inheritedProvider
      ? providerDefaultModel(provider)
      : settings.chatModel ?? config.llm.model ?? providerDefaultModel(provider));

  if (!isCatalogProviderModel(config, provider, model)) {
    return { ok: false, error: `model "${model}" is not available for provider "${provider}"` };
  }

  return { ok: true, provider, model };
}

type ParsedOptionalModel =
  | { ok: true; value: string | undefined }
  | { ok: false; error: string };

function parseOptionalModel(value: unknown): ParsedOptionalModel {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: undefined };
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, error: 'model must be a non-empty string when provided' };
  }
  const trimmed = value.trim();
  if (trimmed.length > 160) {
    return { ok: false, error: 'model is too long' };
  }
  return { ok: true, value: trimmed };
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
