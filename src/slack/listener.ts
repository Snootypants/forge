import { App } from '@slack/bolt';
import type Database from 'better-sqlite3';
import type { LLMService } from '../services/llm.ts';
import type { MemoryService } from '../services/memory.ts';
import type { ForgeConfig } from '../types.ts';
import { resolveKey } from '../config.ts';
import { buildChatContext, handleMemoryCommand } from '../services/chat.ts';

interface SlackDeps {
  config: ForgeConfig;
  messagesDb: Database.Database;
  llm: LLMService;
  memory: MemoryService;
  identity: string;
}

export interface SlackMessageRow {
  id: string;
  channel: string;
  channelName: string | null;
  user: string | null;
  userName: string | null;
  text: string;
  ts: string;
  threadTs: string | null;
  mentioned: number;
  receivedAt: number;
  llmMetadata?: string | null;
  promptContext?: string | null;
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

export function isSlackChannelAllowed(channel: string, allowedChannels: string[] = []): boolean {
  if (allowedChannels.length === 0) return false;
  return allowedChannels.includes(channel);
}

export function isSlackUserAllowed(userId: string, userAllowlist: string[] = [], adminAllowlist: string[] = []): boolean {
  if (!userId) return false;
  return userAllowlist.includes(userId) || adminAllowlist.includes(userId);
}

function isCliProvider(provider: string): boolean {
  return provider === 'claude-cli' || provider === 'codex-cli';
}

export function shouldRespondToSlackMessage(params: {
  config: ForgeConfig;
  channel: string;
  text: string;
  botUserId: string;
  userId?: string;
  subtype?: string | null;
  botId?: string | null;
  appId?: string | null;
}): boolean {
  const slack = params.config.api.slack;
  if (!slack) return false;

  const fromBot = params.subtype === 'bot_message' || Boolean(params.botId);
  const fromApp = Boolean(params.appId);
  if (fromBot && !slack.allow_bot_messages) return false;
  if (fromApp && !slack.allow_app_messages) return false;

  if (!fromBot && !fromApp && !isSlackUserAllowed(params.userId ?? '', slack.user_allowlist, slack.admin_allowlist)) {
    return false;
  }

  const inDirectMessage = params.channel.startsWith('D');
  const mentioned = params.botUserId ? params.text.includes(params.botUserId) : false;
  const allowedChannel = slack.allow_all_channels || isSlackChannelAllowed(params.channel, slack.channels);

  if (isCliProvider(params.config.llm.provider) && params.config.llm.permission_mode === 'yolo' && !slack.allow_yolo) {
    return false;
  }

  if (inDirectMessage) return true;
  if (!allowedChannel) return false;
  return slack.require_mention ? mentioned : true;
}

export function resolveSlackTokens(config: ForgeConfig): { botToken: string | null; appToken: string | null } {
  return {
    botToken: resolveKey(config.api.slack?.bot_token) ?? process.env.SLACK_BOT_TOKEN ?? null,
    appToken: resolveKey(config.api.slack?.app_token) ?? process.env.SLACK_APP_TOKEN ?? null,
  };
}

export function upsertSlackMessage(db: Database.Database, message: SlackMessageRow): void {
  db.prepare(`
    INSERT INTO messages (id, channel, channelName, user, userName, text, ts, threadTs, mentioned, receivedAt, llm_metadata, prompt_context)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      channel = excluded.channel,
      channelName = excluded.channelName,
      user = excluded.user,
      userName = excluded.userName,
      text = excluded.text,
      ts = excluded.ts,
      threadTs = excluded.threadTs,
      mentioned = excluded.mentioned,
      receivedAt = excluded.receivedAt,
      llm_metadata = excluded.llm_metadata,
      prompt_context = excluded.prompt_context
  `).run(
    message.id,
    message.channel,
    message.channelName,
    message.user,
    message.userName,
    message.text,
    message.ts,
    message.threadTs,
    message.mentioned,
    message.receivedAt,
    message.llmMetadata ?? null,
    message.promptContext ?? null,
  );
}

export async function startSlackListener(deps: SlackDeps): Promise<App> {
  const { botToken, appToken } = resolveSlackTokens(deps.config);
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
    const botId = (msg.bot_id as string) ?? null;
    const appId = (msg.app_id as string) ?? null;
    const clientMsgId = (msg.client_msg_id as string) ?? ts;

    if (userId === botUserId) return;
    if (subtype === 'message_deleted' || subtype === 'message_changed') return;
    if (!text.trim()) return;
    if (!shouldRespondToSlackMessage({ config: deps.config, channel, text, botUserId, userId, subtype, botId, appId })) return;

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
    upsertSlackMessage(deps.messagesDb, {
      id: msgId,
      channel,
      channelName,
      user: userId,
      userName,
      text,
      ts,
      threadTs,
      mentioned: text.includes(botUserId) ? 1 : 0,
      receivedAt: Date.now(),
    });

    const threadKey = threadTs ?? ts;
    enqueueThread(`${channel}:${threadKey}`, async () => {
      const assistantName = deps.config.forge.name;
      const saveAssistantReply = (replyTs: string, replyText: string, promptContext: string | null, metadata: string | null) => {
        const replyId = `${channel}:${replyTs}`;
        upsertSlackMessage(deps.messagesDb, {
          id: replyId,
          channel,
          channelName,
          user: botUserId,
          userName: assistantName,
          text: replyText,
          ts: replyTs,
          threadTs: threadTs ?? ts,
          mentioned: 0,
          receivedAt: Date.now(),
          llmMetadata: metadata,
          promptContext,
        });
      };

      try {
        await client.reactions.add({ channel, timestamp: ts, name: 'speech_balloon' });
      } catch { /* reaction may already exist */ }

      try {
        const command = await handleMemoryCommand(deps.memory, text);
        if (command) {
          const replyResult = await client.chat.postMessage({
            channel,
            text: command.reply,
            thread_ts: threadTs ?? ts,
          });
          saveAssistantReply(replyResult.ts ?? '', command.reply, null, null);
        } else {
          const context = buildChatContext({
            messagesDb: deps.messagesDb,
            memory: deps.memory,
            identity: deps.identity,
            assistantName,
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
          const promptContext = JSON.stringify({
            system: context.system,
            messages: context.messages,
          });
          saveAssistantReply(
            replyTs,
            response.content,
            promptContext,
            JSON.stringify({ provider: response.provider, model: response.model, inputTokens: response.inputTokens, outputTokens: response.outputTokens }),
          );
        }
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
