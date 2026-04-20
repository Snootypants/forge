import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, loadEnvFile } from './config.ts';
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

  private constructor(config: ForgeConfig, resolved: ResolvedPaths, mode: BootMode) {
    this.config = config;
    this.resolved = resolved;
    this.mode = mode;
    this.dbManager = new DatabaseManager(resolved.dbs);
  }

  static async boot(mode: BootMode = 'full', configPath?: string): Promise<Platform> {
    if (Platform.instance?.booted) return Platform.instance;

    loadEnvFile();
    const { config, resolved } = loadConfig(configPath);
    const platform = new Platform(config, resolved, mode);

    platform.initDatabases();
    platform.initServices();
    platform.loadIdentity();

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
    this.embed = new EmbedService();
    this.memory.initVec(this.embed);
    this.llm = new LLMService(this.config);
    console.log('[platform] Services initialized');
  }

  private loadIdentity(): void {
    const identityDir = this.resolved.identity;
    const sections: string[] = [];

    const identityFile = path.join(identityDir, 'IDENTITY.md');
    if (fs.existsSync(identityFile)) {
      sections.push(fs.readFileSync(identityFile, 'utf-8'));
    }

    const userFile = path.join(identityDir, 'USER.md');
    if (fs.existsSync(userFile)) {
      sections.push(fs.readFileSync(userFile, 'utf-8'));
    }

    this.identity = sections.join('\n\n---\n\n');
    if (!this.identity) {
      this.identity = `You are ${this.config.forge.name}, an AI assistant.`;
      console.warn('[platform] No identity files found — using default');
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
