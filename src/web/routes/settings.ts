import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { WebContext } from '../server.ts';

interface StoredSettings {
  dailyBudget: number;
  perJobBudget: number;
  warningThreshold: number;
  maxConcurrentJobs: number;
}

function settingsPath(ctx: WebContext): string {
  const logsDir = ctx.resolved.logs;
  fs.mkdirSync(logsDir, { recursive: true });
  return path.join(logsDir, 'settings.json');
}

function readSettings(ctx: WebContext): StoredSettings {
  const p = settingsPath(ctx);
  if (!fs.existsSync(p)) {
    return {
      dailyBudget: ctx.config.budget.daily_limit_cents / 100,
      perJobBudget: ctx.config.budget.per_job_limit_cents / 100,
      warningThreshold: ctx.config.budget.warn_at_percent,
      maxConcurrentJobs: 3,
    };
  }
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function writeSettings(ctx: WebContext, settings: StoredSettings): void {
  fs.writeFileSync(settingsPath(ctx), JSON.stringify(settings, null, 2));
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
        databases: dbHealth,
      },
    });
  });

  router.put('/', (req, res) => {
    const current = readSettings(ctx);
    const body = req.body;

    const updated: StoredSettings = {
      dailyBudget: body.dailyBudget ?? current.dailyBudget,
      perJobBudget: body.perJobBudget ?? current.perJobBudget,
      warningThreshold: body.warningThreshold ?? current.warningThreshold,
      maxConcurrentJobs: body.maxConcurrentJobs ?? current.maxConcurrentJobs,
    };

    writeSettings(ctx, updated);
    res.json({ saved: true, settings: updated });
  });

  return router;
}
