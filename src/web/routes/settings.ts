import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { WebContext } from '../server.ts';
import { getLLMProviderRequirements, sanitizeProviderError } from '../../services/llm.ts';

const StoredSettingsSchema = z.object({
  dailyBudget: z.number().finite().nonnegative(),
  perJobBudget: z.number().finite().nonnegative(),
  warningThreshold: z.number().finite().min(0).max(100),
  maxConcurrentJobs: z.number().int().positive(),
});

const SettingsPatchSchema = StoredSettingsSchema.partial();

type StoredSettings = z.infer<typeof StoredSettingsSchema>;

interface MemoryPolicy {
  retentionDays: number;
  contextWindowTokens: number;
  indexRebuildIntervalMinutes: number;
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
  };
}

function memoryPolicy(ctx: WebContext): MemoryPolicy {
  return {
    retentionDays: ctx.config.memory.retention_days,
    contextWindowTokens: ctx.config.services.web.context_window_tokens,
    indexRebuildIntervalMinutes: ctx.config.memory.index_rebuild_interval_minutes,
  };
}

function readSettings(ctx: WebContext): StoredSettings {
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

function writeSettings(ctx: WebContext, settings: StoredSettings): void {
  const p = settingsPath(ctx);
  fs.writeFileSync(p, JSON.stringify(settings, null, 2), { mode: 0o600 });
  try { fs.chmodSync(p, 0o600); } catch { /* best effort */ }
}

export function settingsRoutes(ctx: WebContext): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const settings = readSettings(ctx);
    const dbHealth = ctx.dbManager.health();

    res.json({
      settings,
      info: {
        name: ctx.config.forge.name,
        version: ctx.config.forge.version,
        root: ctx.config.forge.root,
        models: ctx.config.models,
        llm: ctx.config.llm,
        llmProviderRequirements: getLLMProviderRequirements(ctx.config),
        memory: memoryPolicy(ctx),
        databases: dbHealth,
      },
    });
  });

  router.put('/', (req, res) => {
    const current = readSettings(ctx);
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
    };

    try {
      writeSettings(ctx, updated);
      res.json({ saved: true, settings: updated });
    } catch (err) {
      res.status(500).json({ error: sanitizeProviderError(err, 'failed to save settings') });
    }
  });

  return router;
}
