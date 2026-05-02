import type Database from 'better-sqlite3';
import type { MemoryService } from '../services/memory.ts';
import type { ChatMessage } from '../types.ts';

interface ContextInput {
  messagesDb: Database.Database;
  memory: MemoryService;
  identity: string;
  assistantName: string;
  channel: string;
  threadTs: string;
  currentMessage: string;
  userName: string;
}

interface BuiltContext {
  system: string;
  messages: ChatMessage[];
}

export interface MemoryCommandResult {
  reply: string;
  memoryId?: string;
}

export async function handleMemoryCommand(memory: MemoryService, text: string): Promise<MemoryCommandResult | null> {
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

export function buildContext(input: ContextInput): BuiltContext {
  const sections: string[] = [];

  sections.push(input.identity);

  const memories = input.memory.search(input.currentMessage, 5);
  if (memories.length > 0) {
    sections.push('## Relevant Memories');
    for (const mem of memories) {
      sections.push(`- [${mem.type}] ${mem.content}`);
    }
  }

  sections.push(`## Current Context`);
  sections.push(`User: ${input.userName}`);
  sections.push(`Channel: ${input.channel}`);
  sections.push(`Time: ${new Date().toISOString()}`);

  const threadMessages = input.messagesDb.prepare(`
    SELECT userName, text, ts FROM messages
    WHERE (threadTs = ? OR ts = ?) AND channel = ?
    ORDER BY ts ASC
    LIMIT 50
  `).all(input.threadTs, input.threadTs, input.channel) as Array<{
    userName: string;
    text: string;
    ts: string;
  }>;

  const recentChannel = input.messagesDb.prepare(`
    SELECT userName, text, ts FROM messages
    WHERE channel = ? AND threadTs IS NULL
    ORDER BY receivedAt DESC
    LIMIT 20
  `).all(input.channel) as Array<{
    userName: string;
    text: string;
    ts: string;
  }>;

  if (recentChannel.length > 0) {
    sections.push('\n## Recent Channel Activity');
    for (const msg of recentChannel.reverse()) {
      sections.push(`${msg.userName}: ${msg.text}`);
    }
  }

  const system = sections.join('\n');

  const messages: ChatMessage[] = [];
  if (threadMessages.length > 1) {
    for (const msg of threadMessages.slice(0, -1)) {
      const role = msg.userName === input.assistantName ? 'assistant' : 'user';
      messages.push({ role, content: msg.text, name: msg.userName });
    }
  }
  messages.push({ role: 'user', content: input.currentMessage, name: input.userName });

  return { system, messages };
}
