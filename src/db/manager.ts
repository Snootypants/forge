import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const SCHEMA_DIR = fileURLToPath(new URL('./schemas/', import.meta.url));
const CURRENT_SCHEMA_VERSION = 2;

export type DbName =
  | 'memory'
  | 'messages'
  | 'all'
  | 'anvil'
  | 'agent-events'
  | 'chat-history'
  | 'knowledge'
  | 'notepad'
  | 'logs';

export const CORE_DBS: DbName[] = [
  'memory',
  'messages',
  'all',
  'chat-history',
  'notepad',
  'logs',
];

interface DbHandle {
  db: Database.Database;
  name: DbName;
  path: string;
}

export class DatabaseManager {
  private handles = new Map<DbName, DbHandle>();
  private dbDir: string;

  constructor(dbDir: string) {
    this.dbDir = dbDir;
    fs.mkdirSync(dbDir, { recursive: true });
  }

  open(name: DbName): Database.Database {
    const existing = this.handles.get(name);
    if (existing) return existing.db;

    const dbPath = path.join(this.dbDir, `${name}.db`);
    const db = new Database(dbPath);

    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');

    this.applySchema(db, name);

    const handle: DbHandle = { db, name, path: dbPath };
    this.handles.set(name, handle);
    return db;
  }

  get(name: DbName): Database.Database {
    const handle = this.handles.get(name);
    if (!handle) throw new Error(`Database '${name}' not opened. Call open() first.`);
    return handle.db;
  }

  openAll(): void {
    for (const name of CORE_DBS) {
      this.open(name);
    }
  }

  private applySchema(db: Database.Database, name: DbName): void {
    const schemaPath = path.join(SCHEMA_DIR, `${name}.sql`);
    if (!fs.existsSync(schemaPath)) {
      if (CORE_DBS.includes(name)) {
        throw new Error(`[db] Missing core schema file for ${name}: ${schemaPath}`);
      }
      console.warn(`[db] No schema file for ${name}`);
      return;
    }
    const sql = fs.readFileSync(schemaPath, 'utf-8');

    try {
      const version = db.pragma('user_version', { simple: true }) as number;
      if (version > CURRENT_SCHEMA_VERSION) {
        throw new Error(
          `database user_version ${version} is newer than supported ${CURRENT_SCHEMA_VERSION}`,
        );
      }

      const migrate = db.transaction(() => {
        this.runMigrations(db, name, version);
        db.exec(sql);
        this.backfillIndexes(db, name);
        db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
      });
      migrate();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[db] Schema error in ${name}: ${msg}`);
    }
  }

  private runMigrations(db: Database.Database, name: DbName, version: number): void {
    if (version < 1) {
      // Version 1 was the original bootstrap. New DBs are created by the schema
      // replay below; existing v0 DBs continue through current fixups.
    }

    if (version < 2) {
      this.migrateLegacyCurrentSchema(db, name);
    }
  }

  private migrateLegacyCurrentSchema(db: Database.Database, name: DbName): void {
    if (name === 'messages') {
      this.ensureColumn(db, 'messages', 'channelName', 'TEXT');
      this.ensureColumn(db, 'messages', 'userName', 'TEXT');
      this.ensureColumn(db, 'messages', 'threadTs', 'TEXT');
      this.ensureColumn(db, 'messages', 'mentioned', 'INTEGER DEFAULT 0 CHECK(mentioned IN (0, 1))');
      this.ensureColumn(db, 'messages', 'prompt_context', 'TEXT');
      this.ensureColumn(db, 'messages', 'llm_metadata', 'TEXT');
      this.ensureColumn(db, 'messages', 'subtype', 'TEXT');
    }

    if (name === 'all') {
      this.ensureColumn(db, 'documents', 'metadata', 'JSON');
      this.ensureColumn(db, 'documents', 'updated_at', 'TEXT');
      this.ensureColumn(db, 'documents', 'created_at', 'TEXT');
      if (this.tableExists(db, 'documents')) {
        db.prepare(`
          UPDATE documents
          SET updated_at = COALESCE(updated_at, datetime('now'))
        `).run();
      }
    }

    if (name === 'memory') {
      this.ensureColumn(db, 'memories', 'tags', "TEXT NOT NULL DEFAULT '[]'");
      this.ensureColumn(db, 'memories', 'status', "TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'superseded', 'archived'))");
      this.ensureColumn(db, 'memories', 'confidence', 'REAL NOT NULL DEFAULT 1.0 CHECK(confidence >= 0.0 AND confidence <= 1.0)');
      this.ensureColumn(db, 'memories', 'importance', 'REAL NOT NULL DEFAULT 0.5 CHECK(importance >= 0.0 AND importance <= 1.0)');
      this.ensureColumn(db, 'memories', 'accessCount', 'INTEGER NOT NULL DEFAULT 0');
      this.ensureColumn(db, 'memories', 'updated', 'TEXT');
      this.ensureColumn(db, 'memories', 'supersededBy', 'TEXT');
      if (this.tableExists(db, 'memories')) {
        db.prepare(`
          UPDATE memories
          SET updated = COALESCE(updated, created, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        `).run();
      }
    }
  }

  private backfillIndexes(db: Database.Database, name: DbName): void {
    if (name === 'memory') {
      db.exec(`
        DELETE FROM memories_fts;
        INSERT INTO memories_fts(id, content, tags)
        SELECT m.id, m.content, m.tags
        FROM memories m;
      `);
    }

    if (name === 'messages') {
      db.exec(`
        DELETE FROM messages_fts;
        INSERT INTO messages_fts(text, userName, channelName, id, channel, ts, receivedAt)
        SELECT m.text, m.userName, m.channelName, m.id, m.channel, m.ts, m.receivedAt
        FROM messages m;
      `);
    }

    if (name === 'all') {
      db.exec(`
        DELETE FROM documents_fts;
        INSERT INTO documents_fts(rowid, source, content, source_id)
        SELECT d.id, d.source, d.content, d.source_id
        FROM documents d;
      `);
    }
  }

  private tableExists(db: Database.Database, table: string): boolean {
    const row = db.prepare(`
      SELECT 1 AS found
      FROM sqlite_master
      WHERE type IN ('table', 'view') AND name = ?
    `).get(table);
    return Boolean(row);
  }

  private ensureColumn(db: Database.Database, table: string, column: string, definition: string): void {
    if (!this.tableExists(db, table)) return;
    if (this.columnNames(db, table).has(column)) return;

    db.exec(`ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${quoteIdent(column)} ${definition}`);
  }

  private columnNames(db: Database.Database, table: string): Set<string> {
    const rows = db.prepare(`PRAGMA table_info(${quoteString(table)})`).all() as Array<{ name: string }>;
    return new Set(rows.map(row => row.name));
  }

  close(name: DbName): void {
    const handle = this.handles.get(name);
    if (handle) {
      handle.db.close();
      this.handles.delete(name);
    }
  }

  closeAll(): void {
    for (const [name] of this.handles) {
      this.close(name);
    }
  }

  health(): Array<{ name: DbName; ok: boolean; error?: string }> {
    const results: Array<{ name: DbName; ok: boolean; error?: string }> = [];
    for (const [name, handle] of this.handles) {
      try {
        handle.db.prepare('SELECT 1').get();
        results.push({ name, ok: true });
      } catch (err) {
        results.push({
          name,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return results;
  }

  isOpen(name: DbName): boolean {
    return this.handles.has(name);
  }

  getPath(name: DbName): string {
    return path.join(this.dbDir, `${name}.db`);
  }
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
