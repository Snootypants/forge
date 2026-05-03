import http from 'node:http';
import { Platform } from './platform.ts';
import { resolveWebAuthToken } from './config.ts';
import { createWebServer } from './web/server.ts';
import { resolveSlackTokens, startSlackListener } from './slack/listener.ts';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const platform = await Platform.boot(args.mode, args.configPath);
  let webServer: http.Server | null = null;

  try {
    const auth = resolveWebAuthToken(platform.config, platform.resolved);
    if (auth.source === 'generated') {
      console.log(`\n[auth] Generated web auth token and saved it to ${auth.path}`);
      console.log('[auth] Token redacted; read the saved token file on the host to log in.\n');
    } else if (auth.source === 'file') {
      console.log(`[auth] Loaded web auth token from ${auth.path}`);
    } else {
      console.log(`[auth] Loaded web auth token from ${auth.source}`);
    }

    if (args.mode === 'full' || args.mode === 'web') {
      const ctx = {
        config: platform.config,
        dbManager: platform.dbManager,
        memory: platform.memory,
        llm: platform.llm,
        authToken: auth.token,
        identity: platform.identity,
        identityDir: platform.resolved.identity,
        readIdentity: () => platform.refreshIdentity(),
        resolved: platform.resolved,
      };

      const app = createWebServer(ctx);
      const port = platform.config.services.web.port;
      const host = platform.config.services.web.host;
      webServer = await listen(app, port, host);
    }

    if (args.mode === 'full' || args.mode === 'daemon') {
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

    console.log(`\n[forge] Ready — mode: ${args.mode}`);
  } catch (err) {
    webServer?.close();
    platform.shutdown();
    throw err;
  }
}

function parseArgs(argv: string[]): { mode: 'daemon' | 'web' | 'full'; configPath?: string } {
  let mode: 'daemon' | 'web' | 'full' = 'full';
  let configPath = process.env.FORGE_CONFIG;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--config') {
      configPath = argv[++i];
      if (!configPath) throw new Error('--config requires a path');
      continue;
    }
    if (arg.startsWith('--config=')) {
      configPath = arg.slice('--config='.length);
      continue;
    }
    if (arg === 'daemon' || arg === 'web' || arg === 'full') {
      mode = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { mode, configPath };
}

function listen(app: http.RequestListener, port: number, host: string): Promise<http.Server> {
  const server = http.createServer(app);

  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      reject(new Error(formatListenError(err, port, host)));
    };
    const onListening = () => {
      server.off('error', onError);
      server.on('error', err => {
        console.error('[web] Server error:', err);
      });
      console.log(`[web] Server listening on http://${host}:${port}`);
      resolve(server);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function formatListenError(err: NodeJS.ErrnoException, port: number, host: string): string {
  if (err.code === 'EADDRINUSE') {
    return `[web] ${host}:${port} is already in use. Set services.web.port/services.web.host in forge.config.yaml or stop the other process.`;
  }
  if (err.code === 'EACCES') {
    return `[web] Permission denied while binding ${host}:${port}. Choose a different services.web.port/services.web.host.`;
  }
  return `[web] Failed to listen on ${host}:${port}: ${err.message}`;
}

main().catch(err => {
  console.error('[forge] Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
