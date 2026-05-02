import http from 'node:http';
import { Platform } from './platform.ts';
import { resolveWebAuthToken } from './config.ts';
import { createWebServer } from './web/server.ts';
import { resolveSlackTokens, startSlackListener } from './slack/listener.ts';

async function main(): Promise<void> {
  const mode = (process.argv[2] ?? 'full') as 'daemon' | 'web' | 'full';
  const platform = await Platform.boot(mode);
  let webServer: http.Server | null = null;

  try {
    const auth = resolveWebAuthToken(platform.config, platform.resolved);
    if (auth.source === 'generated') {
      console.log(`\n[auth] Generated web auth token and saved it to ${auth.path}`);
      console.log(`[auth] Token: ${auth.token}\n`);
    } else if (auth.source === 'file') {
      console.log(`[auth] Loaded web auth token from ${auth.path}`);
    } else {
      console.log(`[auth] Loaded web auth token from ${auth.source}`);
    }

    if (mode === 'full' || mode === 'web') {
      const ctx = {
        config: platform.config,
        dbManager: platform.dbManager,
        memory: platform.memory,
        llm: platform.llm,
        authToken: auth.token,
        identity: platform.identity,
        identityDir: platform.resolved.identity,
        resolved: platform.resolved,
      };

      const app = createWebServer(ctx);
      const port = platform.config.services.web.port;
      webServer = await listen(app, port);
    }

    if (mode === 'full' || mode === 'daemon') {
      const slackTokens = resolveSlackTokens(platform.config);
      if (slackTokens.botToken && slackTokens.appToken) {
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
      webServer?.close();
      platform.shutdown();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    console.log(`\n[forge] Ready — mode: ${mode}`);
  } catch (err) {
    webServer?.close();
    platform.shutdown();
    throw err;
  }
}

function listen(app: http.RequestListener, port: number): Promise<http.Server> {
  const server = http.createServer(app);

  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      reject(new Error(formatListenError(err, port)));
    };
    const onListening = () => {
      server.off('error', onError);
      server.on('error', err => {
        console.error('[web] Server error:', err);
      });
      console.log(`[web] Server listening on http://0.0.0.0:${port}`);
      resolve(server);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '0.0.0.0');
  });
}

function formatListenError(err: NodeJS.ErrnoException, port: number): string {
  if (err.code === 'EADDRINUSE') {
    return `[web] Port ${port} is already in use. Set services.web.port in forge.config.yaml or stop the other process.`;
  }
  if (err.code === 'EACCES') {
    return `[web] Permission denied while binding port ${port}. Choose a different services.web.port.`;
  }
  return `[web] Failed to listen on port ${port}: ${err.message}`;
}

main().catch(err => {
  console.error('[forge] Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
