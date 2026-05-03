import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, resolveConfigFilePath } from './config.ts';
import { DatabaseManager } from './db/manager.ts';
import { MemoryService } from './services/memory.ts';
import { LLMService } from './services/llm.ts';
import { EmbedService } from './services/embed.ts';
import type { ForgeConfig, ResolvedPaths, BootMode } from './types.ts';

export class Platform {
  private static instance: Platform | null = null;

  config: ForgeConfig;
  resolved: ResolvedPaths;
  mode: BootMode;
  dbManager: DatabaseManager;
  memory!: MemoryService;
  llm!: LLMService;
  embed!: EmbedService;
  identity: string = '';

  private booted = false;
  private configPath: string;

  private constructor(config: ForgeConfig, resolved: ResolvedPaths, mode: BootMode, configPath: string) {
    this.config = config;
    this.resolved = resolved;
    this.mode = mode;
    this.configPath = configPath;
    this.dbManager = new DatabaseManager(resolved.dbs);
  }

  static async boot(mode: BootMode = 'full', configPath?: string): Promise<Platform> {
    const requestedConfigPath = resolveConfigFilePath(configPath);
    if (Platform.instance?.booted) {
      if (Platform.instance.configPath !== requestedConfigPath) {
        throw new Error(
          `Platform already booted with config ${Platform.instance.configPath}; shutdown before booting ${requestedConfigPath}`,
        );
      }
      return Platform.instance;
    }

    const { config, resolved } = loadConfig(requestedConfigPath);
    const platform = new Platform(config, resolved, mode, requestedConfigPath);

    platform.initDatabases();
    platform.initServices();
    platform.refreshIdentity();

    platform.booted = true;
    Platform.instance = platform;

    console.log(`[platform] Booted in '${mode}' mode`);
    console.log(`[platform] DBs: ${platform.resolved.dbs}`);
    console.log(`[platform] Agent: ${config.forge.name}`);
    return platform;
  }

  private initDatabases(): void {
    this.dbManager.openAll();
    const health = this.dbManager.health();
    const failed = health.filter(h => !h.ok);
    if (failed.length > 0) {
      console.error('[platform] Unhealthy databases:', failed);
    }
    console.log(`[platform] ${health.length} databases opened`);
  }

  private initServices(): void {
    this.memory = new MemoryService(this.dbManager.get('memory'));
    this.embed = new EmbedService(this.config.api.openai);
    this.memory.initVec(this.embed);
    this.llm = new LLMService(this.config);
    console.log('[platform] Services initialized');
  }

  refreshIdentity(): string {
    const identityDir = this.resolved.identity;

    if (!fs.existsSync(identityDir)) {
      fs.mkdirSync(identityDir, { recursive: true, mode: 0o700 });
    }
    try { fs.chmodSync(identityDir, 0o700); } catch { /* best effort */ }

    this.scaffoldIdentity(identityDir);

    const sections: string[] = [];

    for (const file of ['IDENTITY.md', 'SOUL.md', 'USER.md']) {
      const fp = path.join(identityDir, file);
      if (fs.existsSync(fp)) {
        sections.push(fs.readFileSync(fp, 'utf-8'));
      }
    }

    this.identity = sections.join('\n\n---\n\n');
    return this.identity;
  }

  private scaffoldIdentity(identityDir: string): void {
    const name = this.config.forge.name;
    const templates: Record<string, string> = {
      'IDENTITY.md': [
        `# Identity`,
        ``,
        `You are ${name}, an AI assistant.`,
        ``,
        `<!-- FIRST RUN: This is a starter template. Update this file to define who you are.`,
        `     What is your name? What are you responsible for? What can you do?`,
        `     Example: "You are ${name}, an AI agent managing a home network and Plex server." -->`,
      ].join('\n'),
      'SOUL.md': [
        `# Soul`,
        ``,
        `You are helpful, direct, and concise.`,
        ``,
        `<!-- FIRST RUN: This defines how you behave. Your personality, tone, and values.`,
        `     Are you casual or formal? Proactive or reactive? Verbose or terse?`,
        `     Example: "You take action first and report after. You don't ask permission for routine ops." -->`,
      ].join('\n'),
      'USER.md': [
        `# User`,
        ``,
        `Your user has not introduced themselves yet.`,
        `When you first interact with them, ask who they are and what they need from you.`,
        `Update this file with what you learn.`,
        ``,
        `<!-- FIRST RUN: This is context about the person you serve.`,
        `     Their name, role, technical background, preferences, and communication style.`,
        `     The more you know, the better you can help. Ask and fill this out. -->`,
      ].join('\n'),
    };

    let created = false;
    for (const [filename, content] of Object.entries(templates)) {
      const fp = path.join(identityDir, filename);
      if (!fs.existsSync(fp)) {
        fs.writeFileSync(fp, content, { encoding: 'utf-8', mode: 0o600 });
        try { fs.chmodSync(fp, 0o600); } catch { /* best effort */ }
        created = true;
      }
    }

    if (created) {
      console.log('[platform] Generated starter identity files in', identityDir);
    }
  }

  shutdown(): void {
    console.log('[platform] Shutting down...');
    this.dbManager.closeAll();
    Platform.instance = null;
    this.booted = false;
    console.log('[platform] Shutdown complete');
  }
}
