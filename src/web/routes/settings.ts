import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { WebContext } from '../server.ts';
import { getLLMModelCatalog, getLLMProviderRequirements, sanitizeProviderError } from '../../services/llm.ts';
import { resolveKey } from '../../config.ts';
import { atomicWriteFileSync } from '../../utils/atomic-write.ts';

const StoredSettingsSchema = z.object({
  dailyBudget: z.number().finite().nonnegative(),
  perJobBudget: z.number().finite().nonnegative(),
  warningThreshold: z.number().finite().min(0).max(100),
  maxConcurrentJobs: z.number().int().positive(),
  webAuthRequired: z.boolean().default(true),
  chatProvider: z.enum(['claude-cli', 'codex-cli', 'openai-api', 'anthropic-api']).optional(),
  chatModel: z.string().optional(),
  permissionMode: z.enum(['default', 'yolo']).optional(),
});

const SettingsPatchSchema = StoredSettingsSchema.partial();

type StoredSettings = z.infer<typeof StoredSettingsSchema>;
type EffectiveWebAuthReason = 'env' | 'config' | 'bind-host' | 'settings';

interface MemoryPolicy {
  retentionDays: number;
  contextWindowTokens: number;
  indexRebuildIntervalMinutes: number;
  vectorTableAvailable: boolean;
  embeddingAvailable: boolean;
  hybridSearchActive: boolean;
  vecEnabled: boolean;
}

function settingsPath(ctx: WebContext): string {
  const logsDir = ctx.resolved.logs;
  fs.mkdirSync(logsDir, { recursive: true });
  return path.join(logsDir, 'settings.json');
}

function defaultSettings(ctx: WebContext): StoredSettings {
  return {
    dailyBudget: ctx.config.budget.daily_limit_cents / 100,
    perJobBudget: ctx.config.budget.per_job_limit_cents / 100,
    warningThreshold: ctx.config.budget.warn_at_percent,
    maxConcurrentJobs: 3,
    webAuthRequired: true,
    chatProvider: ctx.config.llm.provider,
    chatModel: ctx.config.llm.model,
    permissionMode: ctx.config.llm.permission_mode,
  };
}

function memoryPolicy(ctx: WebContext): MemoryPolicy {
  const runtime = memoryRuntimeStatus(ctx);
  return {
    retentionDays: ctx.config.memory.retention_days,
    contextWindowTokens: ctx.config.services.web.context_window_tokens,
    indexRebuildIntervalMinutes: ctx.config.memory.index_rebuild_interval_minutes,
    vectorTableAvailable: runtime.vectorTableAvailable,
    embeddingAvailable: runtime.embeddingAvailable,
    hybridSearchActive: runtime.hybridSearchActive,
    vecEnabled: runtime.vectorTableAvailable,
  };
}

function embeddingInfo(ctx: WebContext): {
  provider: 'openai';
  model: 'text-embedding-3-small';
  enabled: boolean;
  dimension: 1536;
  vectorTableAvailable: boolean;
  embeddingAvailable: boolean;
  hybridSearchActive: boolean;
  live: boolean;
  vectorLive: boolean;
  sqliteVecLoaded: boolean;
  vecEnabled: boolean;
} {
  const runtime = memoryRuntimeStatus(ctx);
  return {
    provider: 'openai',
    model: 'text-embedding-3-small',
    enabled: runtime.embeddingAvailable || Boolean(resolveKey(ctx.config.api.openai) ?? process.env.OPENAI_API_KEY?.trim()),
    dimension: 1536,
    vectorTableAvailable: runtime.vectorTableAvailable,
    embeddingAvailable: runtime.embeddingAvailable,
    hybridSearchActive: runtime.hybridSearchActive,
    live: runtime.hybridSearchActive,
    vectorLive: runtime.hybridSearchActive,
    sqliteVecLoaded: runtime.vectorTableAvailable,
    vecEnabled: runtime.vectorTableAvailable,
  };
}

function memoryRuntimeStatus(ctx: WebContext): {
  vectorTableAvailable: boolean;
  embeddingAvailable: boolean;
  hybridSearchActive: boolean;
} {
  const runtimeStatus = (ctx.memory as { runtimeStatus?: () => unknown }).runtimeStatus;
  if (typeof runtimeStatus !== 'function') {
    return { vectorTableAvailable: false, embeddingAvailable: false, hybridSearchActive: false };
  }
  const status = runtimeStatus.call(ctx.memory) as Partial<{
    vectorTableAvailable: boolean;
    embeddingAvailable: boolean;
    hybridSearchActive: boolean;
  }>;
  return {
    vectorTableAvailable: status.vectorTableAvailable === true,
    embeddingAvailable: status.embeddingAvailable === true,
    hybridSearchActive: status.hybridSearchActive === true,
  };
}

export function readStoredSettings(ctx: WebContext): StoredSettings {
  const p = settingsPath(ctx);
  if (!fs.existsSync(p)) {
    return defaultSettings(ctx);
  }
  try {
    return StoredSettingsSchema.parse(JSON.parse(fs.readFileSync(p, 'utf-8')));
  } catch (err) {
    console.error('[settings] Invalid settings file, using config defaults:', err instanceof Error ? err.message : err);
    return defaultSettings(ctx);
  }
}

export function isWebAuthRequired(ctx: WebContext): boolean {
  return resolveEffectiveWebAuth(ctx).effectiveWebAuthRequired;
}

export function resolveEffectiveWebAuth(ctx: WebContext): {
  effectiveWebAuthRequired: boolean;
  effectiveWebAuthReason: EffectiveWebAuthReason;
} {
  if (envForcesWebAuth()) {
    return { effectiveWebAuthRequired: true, effectiveWebAuthReason: 'env' };
  }
  if (ctx.config.services.web.auth_required) {
    return { effectiveWebAuthRequired: true, effectiveWebAuthReason: 'config' };
  }
  if (!isLoopbackHost(ctx.config.services.web.host)) {
    return { effectiveWebAuthRequired: true, effectiveWebAuthReason: 'bind-host' };
  }
  return {
    effectiveWebAuthRequired: readStoredSettings(ctx).webAuthRequired,
    effectiveWebAuthReason: 'settings',
  };
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
  return normalized === 'localhost'
    || normalized === '::1'
    || normalized === '0:0:0:0:0:0:0:1'
    || isLoopbackIpv4Host(normalized);
}

function isLoopbackIpv4Host(host: string): boolean {
  const octets = host.split('.');
  return octets.length === 4
    && octets[0] === '127'
    && octets.every(octet => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
}

function writeSettings(ctx: WebContext, settings: StoredSettings): void {
  const p = settingsPath(ctx);
  atomicWriteFileSync(p, JSON.stringify(settings, null, 2), { mode: 0o600 });
}

function responseSettings(ctx: WebContext, settings: StoredSettings): StoredSettings & ReturnType<typeof resolveEffectiveWebAuth> {
  return {
    ...settings,
    ...resolveEffectiveWebAuth(ctx),
  };
}

function envForcesWebAuth(): boolean {
  const value = process.env.FORGE_WEB_AUTH_REQUIRED?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

export function settingsRoutes(ctx: WebContext): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const settings = readStoredSettings(ctx);
    const dbHealth = ctx.dbManager.health();

    res.json({
      settings: responseSettings(ctx, settings),
      info: {
        name: ctx.config.forge.name,
        version: ctx.config.forge.version,
        root: ctx.config.forge.root,
        auth: {
          webAuthRequired: settings.webAuthRequired,
          allowedHosts: ctx.config.services.web.allowed_hosts ?? [],
          ...resolveEffectiveWebAuth(ctx),
        },
        models: ctx.config.models,
        llm: ctx.config.llm,
        llmProviderRequirements: getLLMProviderRequirements(ctx.config),
        llmModelCatalog: getLLMModelCatalog(ctx.config),
        memory: memoryPolicy(ctx),
        embedding: embeddingInfo(ctx),
        databases: dbHealth,
      },
    });
  });

  router.put('/', (req, res) => {
    const current = readStoredSettings(ctx);
    const parsed = SettingsPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid settings', details: parsed.error.flatten() });
      return;
    }
    const body = parsed.data;

    const updated: StoredSettings = {
      dailyBudget: body.dailyBudget ?? current.dailyBudget,
      perJobBudget: body.perJobBudget ?? current.perJobBudget,
      warningThreshold: body.warningThreshold ?? current.warningThreshold,
      maxConcurrentJobs: body.maxConcurrentJobs ?? current.maxConcurrentJobs,
      webAuthRequired: body.webAuthRequired ?? current.webAuthRequired,
      chatProvider: body.chatProvider ?? current.chatProvider,
      chatModel: body.chatModel ?? current.chatModel,
      permissionMode: body.permissionMode ?? current.permissionMode,
    };

    try {
      writeSettings(ctx, updated);
      res.json({ saved: true, settings: responseSettings(ctx, updated) });
    } catch (err) {
      res.status(500).json({ error: sanitizeProviderError(err, 'failed to save settings') });
    }
  });

  return router;
}
