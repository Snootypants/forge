import { Router } from 'express';
import type { WebContext } from '../server.ts';
import { handleMemoryCommand } from '../../slack/context.ts';

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

    res.json({ messages: rows, agentName: ctx.config.forge.name });
  });

  router.post('/', async (req, res) => {
    const { content } = req.body;
    if (!content) {
      res.status(400).json({ error: 'content required' });
      return;
    }

    const db = ctx.dbManager.get('messages');
    const ts = Date.now().toString();

    db.prepare(`
      INSERT INTO messages (id, channel, channelName, user, userName, text, ts, receivedAt)
      VALUES (?, 'web', 'web', 'user', ?, ?, ?, ?)
    `).run(`web:user:${ts}`, ctx.config.user.name, content, ts, Date.now());

    try {
      const command = await handleMemoryCommand(ctx.memory, content);
      if (command) {
        const replyTs = (Date.now() + 1).toString();
        db.prepare(`
          INSERT INTO messages (id, channel, channelName, user, userName, text, ts, threadTs, receivedAt)
          VALUES (?, 'web', 'web', 'assistant', ?, ?, ?, ?, ?)
        `).run(
          `web:assistant:${replyTs}`,
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

      const context = buildSimpleContext(ctx, content);
      const response = await ctx.llm.complete({
        system: context.system,
        messages: [{ role: 'user', content }],
      });

      const replyTs = (Date.now() + 1).toString();
      const promptContext = JSON.stringify({
        system: context.system,
        messages: [{ role: 'user', content }],
      });
      db.prepare(`
        INSERT INTO messages (id, channel, channelName, user, userName, text, ts, threadTs, receivedAt, llm_metadata, prompt_context)
        VALUES (?, 'web', 'web', 'assistant', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `web:assistant:${replyTs}`,
        ctx.config.forge.name,
        response.content,
        replyTs,
        ts,
        Date.now(),
        JSON.stringify({ model: response.model, inputTokens: response.inputTokens, outputTokens: response.outputTokens }),
        promptContext,
      );

      res.json({
        reply: response.content,
        model: response.model,
        ts: replyTs,
        agentName: ctx.config.forge.name,
        usage: { input: response.inputTokens, output: response.outputTokens },
        prompt_context: promptContext,
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
