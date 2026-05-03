import type Database from 'better-sqlite3';
import type { MemoryService } from './memory.ts';
import type { ChatMessage } from '../types.ts';

interface ChatContextInput {
  messagesDb?: Database.Database;
  memory: Pick<MemoryService, 'search'>;
  identity: string;
  assistantName: string;
  currentMessage: string;
  userName: string;
  channel: string;
  threadTs?: string;
  interfaceName?: string;
  now?: Date;
}

interface BuiltChatContext {
  system: string;
  messages: ChatMessage[];
}

export interface MemoryCommandResult {
  reply: string;
  memoryId?: string;
}

export async function handleMemoryCommand(
  memory: Pick<MemoryService, 'save' | 'remove'>,
  text: string,
): Promise<MemoryCommandResult | null> {
  const trimmed = text.trim();
  const remember = trimmed.match(/^\/remember(?:\s+([\s\S]+))?$/i);
  if (remember) {
    const content = remember[1]?.trim();
    if (!content) {
      return { reply: 'Usage: /remember <text to save>' };
    }

    const id = await memory.save({
      type: 'chat',
      content,
      tags: ['chat', 'explicit'],
      confidence: 1.0,
      importance: 0.7,
    });

    return { reply: `Remembered. Memory ID: ${id}`, memoryId: id };
  }

  const forget = trimmed.match(/^\/forget(?:\s+(\S+))?$/i);
  if (forget) {
    const id = forget[1]?.trim();
    if (!id) {
      return { reply: 'Usage: /forget <memory-id>' };
    }

    return {
      reply: memory.remove(id) ? `Forgot memory ${id}.` : `No memory found for ID: ${id}`,
      memoryId: id,
    };
  }

  return null;
}

export function buildChatContext(input: ChatContextInput): BuiltChatContext {
  const sections: string[] = [input.identity];

  const memories = input.memory.search(input.currentMessage, 5);
  if (memories.length > 0) {
    sections.push('## Relevant Memories');
    for (const mem of memories) {
      sections.push(`- [${mem.type}] ${mem.content}`);
    }
  }

  sections.push('## Current Context');
  sections.push(`User: ${input.userName}`);
  sections.push(`Channel: ${input.channel}`);
  if (input.interfaceName) sections.push(`Interface: ${input.interfaceName}`);
  sections.push(`Time: ${(input.now ?? new Date()).toISOString()}`);

  const messages = buildContextMessages(input);
  addRecentChannelActivity(sections, input);

  return {
    system: sections.join('\n'),
    messages,
  };
}

function buildContextMessages(input: ChatContextInput): ChatMessage[] {
  const threadMessages = input.threadTs ? readThreadMessages(input) : [];
  if (threadMessages.length > 1) {
    return [
      ...threadMessages.slice(0, -1).map(rowToChatMessage(input.assistantName)),
      { role: 'user', content: input.currentMessage, name: input.userName },
    ];
  }

  const recentMessages = readRecentMessages(input);
  if (recentMessages.length > 0) {
    return recentMessages.map(rowToChatMessage(input.assistantName));
  }

  return [{ role: 'user', content: input.currentMessage, name: input.userName }];
}

function addRecentChannelActivity(sections: string[], input: ChatContextInput): void {
  if (!input.messagesDb) return;

  const recentChannel = readRecentChannelActivity(input);

  if (recentChannel.length === 0) return;

  sections.push('## Recent Channel Activity');
  for (const msg of recentChannel.reverse()) {
    sections.push(`${msg.userName ?? 'unknown'}: ${msg.text}`);
  }
}

function readThreadMessages(input: ChatContextInput): MessageRow[] {
  if (!input.messagesDb || !input.threadTs) return [];

  try {
    return input.messagesDb.prepare(`
      SELECT userName, text, ts FROM messages
      WHERE (threadTs = ? OR ts = ?) AND channel = ?
      ORDER BY ts ASC
      LIMIT 50
    `).all(input.threadTs, input.threadTs, input.channel) as MessageRow[];
  } catch {
    return [];
  }
}

function readRecentMessages(input: ChatContextInput): MessageRow[] {
  if (!input.messagesDb) return [];

  try {
    return (input.messagesDb.prepare(`
      SELECT user, userName, text, receivedAt FROM messages
      WHERE channel = ?
      ORDER BY receivedAt DESC
      LIMIT 20
    `).all(input.channel) as MessageRow[]).reverse();
  } catch {
    return [];
  }
}

function readRecentChannelActivity(input: ChatContextInput): MessageRow[] {
  if (!input.messagesDb) return [];

  try {
    return input.messagesDb.prepare(`
      SELECT userName, text, ts FROM messages
      WHERE channel = ? AND threadTs IS NULL
      ORDER BY receivedAt DESC
      LIMIT 20
    `).all(input.channel) as MessageRow[];
  } catch {
    return [];
  }
}

function rowToChatMessage(assistantName: string): (row: MessageRow) => ChatMessage {
  return row => ({
    role: row.user === 'assistant' || row.userName === assistantName ? 'assistant' : 'user',
    content: row.text,
    name: row.userName ?? undefined,
    ...(row.receivedAt ? { timestamp: new Date(row.receivedAt).toISOString() } : {}),
  });
}

interface MessageRow {
  user?: string | null;
  userName?: string | null;
  text: string;
  ts?: string;
  receivedAt?: number;
}
