import { z } from 'zod';

export const KeyRefSchema = z.object({
  env: z.string().optional(),
  value: z.string().optional(),
});

export const ForgeConfigSchema = z.object({
  forge: z.object({
    name: z.string(),
    version: z.string(),
    root: z.string(),
  }),
  user: z.object({
    name: z.string(),
  }),
  api: z.object({
    anthropic: KeyRefSchema.optional(),
    openai: KeyRefSchema.optional(),
    slack: z.object({
      bot_token: KeyRefSchema,
      app_token: KeyRefSchema,
      bot_user_id: z.string().default(''),
      channels: z.array(z.string()).default([]),
    }).optional(),
  }),
  models: z.object({
    default: z.string().default('claude-sonnet-4-6'),
    architect: z.string().default('claude-opus-4-6'),
    sentinel: z.string().default('claude-haiku-4-5'),
  }),
  paths: z.object({
    dbs: z.string().default('./dbs'),
    identity: z.string().default('./identity'),
    logs: z.string().default('./logs'),
  }),
  services: z.object({
    web: z.object({
      port: z.number().default(6800),
      auth_token: z.string().optional(),
    }).default({}),
    daemon: z.object({
      port: z.number().default(6790),
    }).default({}),
  }).default({}),
  budget: z.object({
    daily_limit_cents: z.number().default(5000),
    per_job_limit_cents: z.number().default(1500),
    warn_at_percent: z.number().default(80),
  }).default({}),
});

export type ForgeConfig = z.infer<typeof ForgeConfigSchema>;
export type KeyRef = z.infer<typeof KeyRefSchema>;

export interface ResolvedPaths {
  root: string;
  dbs: string;
  identity: string;
  logs: string;
}

export interface MemoryRecord {
  id: string;
  type: string;
  content: string;
  tags: string[];
  status: 'active' | 'superseded' | 'archived';
  confidence: number;
  importance: number;
  accessCount: number;
  created: string;
  updated: string;
  supersededBy: string | null;
}

export interface MemoryHistoryEntry {
  id: number;
  memoryId: string;
  changeType: string;
  oldContent: string | null;
  oldStatus: string | null;
  oldConfidence: number | null;
  oldTags: string | null;
  newContent: string | null;
  newStatus: string | null;
  changedAt: string;
  changedBy: string;
  reason: string | null;
}

export interface SlackMessage {
  id: string;
  channel: string;
  channelName: string | null;
  user: string | null;
  userName: string | null;
  text: string;
  ts: string;
  threadTs: string | null;
  isBot: boolean;
  createdAt: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  name?: string;
  timestamp?: string;
}

export interface LLMRequest {
  system: string;
  messages: ChatMessage[];
  model?: string;
  maxTurns?: number;
}

export interface LLMResponse {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export type BootMode = 'daemon' | 'web' | 'full';
