import { Router } from 'express';
import type { WebContext } from '../server.ts';

export function messagesRoutes(ctx: WebContext): Router {
  const router = Router();

  router.get('/poll', (req, res) => {
    const since = req.query.since as string | undefined;
    const limit = parseInt(req.query.limit as string) || 200;
    const db = ctx.dbManager.get('messages');

    let rows;
    if (since) {
      rows = db.prepare(`
        SELECT * FROM messages
        WHERE receivedAt > ?
        ORDER BY receivedAt ASC
        LIMIT ?
      `).all(parseInt(since), limit);
    } else {
      rows = db.prepare(`
        SELECT * FROM messages
        ORDER BY receivedAt DESC
        LIMIT ?
      `).all(limit).reverse();
    }

    res.json({ messages: rows });
  });

  router.post('/', async (req, res) => {
    const { content, agent } = req.body;
    if (!content) {
      res.status(400).json({ error: 'content required' });
      return;
    }

    const context = buildSimpleContext(ctx, content);

    try {
      const response = await ctx.llm.complete({
        system: context.system,
        messages: [{ role: 'user', content }],
      });

      const ts = Date.now().toString();
      const db = ctx.dbManager.get('messages');

      db.prepare(`
        INSERT INTO messages (id, channel, channelName, user, userName, text, ts, receivedAt)
        VALUES (?, 'web', 'web', 'user', ?, ?, ?, ?)
      `).run(`web:user:${ts}`, ctx.config.user.name, content, ts, Date.now());

      const replyTs = (Date.now() + 1).toString();
      db.prepare(`
        INSERT INTO messages (id, channel, channelName, user, userName, text, ts, threadTs, receivedAt, llm_metadata)
        VALUES (?, 'web', 'web', 'assistant', ?, ?, ?, ?, ?, ?)
      `).run(
        `web:assistant:${replyTs}`,
        agent ?? 'forge-zima',
        response.content,
        replyTs,
        ts,
        Date.now(),
        JSON.stringify({ model: response.model, inputTokens: response.inputTokens, outputTokens: response.outputTokens }),
      );

      res.json({
        reply: response.content,
        model: response.model,
        ts: replyTs,
        usage: { input: response.inputTokens, output: response.outputTokens },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[web] Chat error:', msg);
      res.status(500).json({ error: msg });
    }
  });

  return router;
}

function buildSimpleContext(ctx: WebContext, message: string): { system: string } {
  const sections: string[] = [ctx.identity];

  const memories = ctx.memory.search(message, 5);
  if (memories.length > 0) {
    sections.push('\n## Relevant Memories');
    for (const mem of memories) {
      sections.push(`- [${mem.type}] ${mem.content}`);
    }
  }

  sections.push(`\n## Context`);
  sections.push(`User: ${ctx.config.user.name}`);
  sections.push(`Time: ${new Date().toISOString()}`);
  sections.push(`Interface: Web Chat`);

  return { system: sections.join('\n') };
}
