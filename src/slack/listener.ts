import { App } from '@slack/bolt';
import type Database from 'better-sqlite3';
import type { LLMService } from '../services/llm.ts';
import type { MemoryService } from '../services/memory.ts';
import type { ForgeConfig } from '../types.ts';
import { buildContext } from './context.ts';

interface SlackDeps {
  config: ForgeConfig;
  messagesDb: Database.Database;
  llm: LLMService;
  memory: MemoryService;
  identity: string;
}

const seen = new Set<string>();
const DEDUP_TTL = 60_000;

interface ThreadTask {
  fn: () => Promise<void>;
}
const threadQueues = new Map<string, ThreadTask[]>();
const threadRunning = new Set<string>();

async function drainThread(key: string): Promise<void> {
  if (threadRunning.has(key)) return;
  threadRunning.add(key);

  const queue = threadQueues.get(key);
  while (queue && queue.length > 0) {
    const task = queue.shift()!;
    try { await task.fn(); }
    catch (err) { console.error(`[slack] Thread ${key} error:`, err); }
  }

  threadRunning.delete(key);
  threadQueues.delete(key);
}

function enqueueThread(key: string, fn: () => Promise<void>): void {
  if (!threadQueues.has(key)) threadQueues.set(key, []);
  threadQueues.get(key)!.push({ fn });
  drainThread(key);
}

export async function startSlackListener(deps: SlackDeps): Promise<App> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const appToken = process.env.SLACK_APP_TOKEN;
  if (!botToken || !appToken) {
    throw new Error('SLACK_BOT_TOKEN and SLACK_APP_TOKEN required');
  }

  const app = new App({
    token: botToken,
    appToken,
    socketMode: true,
  });

  const authResult = await app.client.auth.test({ token: botToken });
  const botUserId = authResult.user_id ?? '';
  console.log(`[slack] Connected as ${authResult.user} (${botUserId})`);

  app.event('message', async ({ event, client }) => {
    const msg = event as unknown as Record<string, unknown>;
    const text = (msg.text as string) ?? '';
    const userId = (msg.user as string) ?? '';
    const channel = (msg.channel as string) ?? '';
    const ts = (msg.ts as string) ?? '';
    const threadTs = (msg.thread_ts as string) ?? null;
    const subtype = (msg.subtype as string) ?? null;
    const clientMsgId = (msg.client_msg_id as string) ?? ts;

    if (userId === botUserId) return;
    if (subtype === 'message_deleted' || subtype === 'message_changed') return;
    if (!text.trim()) return;

    if (seen.has(clientMsgId)) return;
    seen.add(clientMsgId);
    setTimeout(() => seen.delete(clientMsgId), DEDUP_TTL);

    let userName = userId;
    try {
      const info = await client.users.info({ user: userId });
      userName = info.user?.real_name ?? info.user?.name ?? userId;
    } catch { /* use userId */ }

    let channelName = channel;
    try {
      const info = await client.conversations.info({ channel });
      channelName = info.channel?.name ?? channel;
    } catch { /* use channel id */ }

    const msgId = `${channel}:${ts}`;
    deps.messagesDb.prepare(`
      INSERT OR REPLACE INTO messages (id, channel, channelName, user, userName, text, ts, threadTs, mentioned, receivedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(msgId, channel, channelName, userId, userName, text, ts, threadTs, text.includes(botUserId) ? 1 : 0, Date.now());

    const threadKey = threadTs ?? ts;
    enqueueThread(`${channel}:${threadKey}`, async () => {
      try {
        await client.reactions.add({ channel, timestamp: ts, name: 'speech_balloon' });
      } catch { /* reaction may already exist */ }

      try {
        const context = buildContext({
          messagesDb: deps.messagesDb,
          memory: deps.memory,
          identity: deps.identity,
          channel,
          threadTs: threadTs ?? ts,
          currentMessage: text,
          userName,
        });

        const response = await deps.llm.complete({
          system: context.system,
          messages: context.messages,
        });

        const replyResult = await client.chat.postMessage({
          channel,
          text: response.content,
          thread_ts: threadTs ?? ts,
        });

        const replyTs = replyResult.ts ?? '';
        const replyId = `${channel}:${replyTs}`;
        deps.messagesDb.prepare(`
          INSERT OR REPLACE INTO messages (id, channel, channelName, user, userName, text, ts, threadTs, mentioned, receivedAt, llm_metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        `).run(
          replyId, channel, channelName, botUserId, 'forge-zima', response.content,
          replyTs, threadTs ?? ts, Date.now(),
          JSON.stringify({ model: response.model, inputTokens: response.inputTokens, outputTokens: response.outputTokens }),
        );
      } catch (err) {
        console.error('[slack] Auto-reply error:', err);
      }

      try {
        await client.reactions.remove({ channel, timestamp: ts, name: 'speech_balloon' });
      } catch { /* may not exist */ }
    });
  });

  await app.start();
  console.log('[slack] Socket Mode listener started');
  return app;
}
