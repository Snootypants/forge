import http from 'node:http';
import crypto from 'node:crypto';
import { Platform } from './platform.ts';
import { createWebServer } from './web/server.ts';
import { startSlackListener } from './slack/listener.ts';

async function main(): Promise<void> {
  const mode = (process.argv[2] ?? 'full') as 'daemon' | 'web' | 'full';
  const platform = await Platform.boot(mode);

  const authToken = process.env.FORGE_AUTH_TOKEN ?? crypto.randomBytes(32).toString('hex');
  if (!process.env.FORGE_AUTH_TOKEN) {
    console.log(`\n[auth] Generated auth token (save this): ${authToken}\n`);
  }

  if (mode === 'full' || mode === 'web') {
    const ctx = {
      config: platform.config,
      dbManager: platform.dbManager,
      memory: platform.memory,
      llm: platform.llm,
      authToken,
      identity: platform.identity,
      identityDir: platform.resolved.identity,
    };

    const app = createWebServer(ctx);
    const port = platform.config.services.web.port;
    const server = http.createServer(app);

    server.listen(port, '0.0.0.0', () => {
      console.log(`[web] Server listening on http://0.0.0.0:${port}`);
    });
  }

  if (mode === 'full' || mode === 'daemon') {
    if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN) {
      try {
        await startSlackListener({
          config: platform.config,
          messagesDb: platform.dbManager.get('messages'),
          llm: platform.llm,
          memory: platform.memory,
          identity: platform.identity,
        });
      } catch (err) {
        console.error('[slack] Failed to start listener:', err);
        console.log('[slack] Continuing without Slack — configure tokens in settings');
      }
    } else {
      console.log('[slack] No Slack tokens found — configure in settings UI');
    }
  }

  const shutdown = () => {
    platform.shutdown();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  console.log(`\n[forge-zima] Ready — mode: ${mode}`);
}

main().catch(err => {
  console.error('[forge-zima] Fatal:', err);
  process.exit(1);
});
