import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

import { DatabaseManager } from './manager.ts';

test('messages migration adds legacy prompt and metadata columns before advancing user_version', () => {
  const dbDir = mkdtempSync(path.join(tmpdir(), 'forge-messages-migrate-'));
  const dbPath = path.join(dbDir, 'messages.db');

  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      user TEXT,
      text TEXT NOT NULL DEFAULT '',
      ts TEXT NOT NULL,
      receivedAt INTEGER NOT NULL
    );
    INSERT INTO messages (id, channel, user, text, ts, receivedAt)
    VALUES ('legacy-1', 'C1', 'U1', 'alpha legacy text', '1', 1);
    PRAGMA user_version = 1;
  `);
  legacy.close();

  const manager = new DatabaseManager(dbDir);

  try {
    const db = manager.open('messages');
    const columns = columnNames(db, 'messages');

    assert.equal(db.pragma('user_version', { simple: true }), 2);
    assert.ok(columns.has('prompt_context'));
    assert.ok(columns.has('llm_metadata'));
    assert.ok(columns.has('subtype'));
    assert.ok(columns.has('mentioned'));

    const row = db.prepare(`
      SELECT id, text
      FROM messages_fts
      WHERE messages_fts MATCH 'alpha'
    `).get() as { id: string; text: string };
    assert.deepEqual(row, { id: 'legacy-1', text: 'alpha legacy text' });

    db.prepare(`
      INSERT INTO messages (
        id, channel, channelName, user, userName, text, ts, receivedAt,
        prompt_context, llm_metadata, subtype
      )
      VALUES ('new-1', 'C1', 'general', 'U1', 'Caleb', 'bravo metadata', '2', 2, '{}', '{}', 'bot_message')
    `).run();

    assert.deepEqual(
      db.prepare(`
        SELECT id, text
        FROM messages_fts
        WHERE messages_fts MATCH 'bravo'
      `).get(),
      { id: 'new-1', text: 'bravo metadata' },
    );
  } finally {
    manager.closeAll();
    rmSync(dbDir, { recursive: true, force: true });
  }
});

test('all database migration backfills existing documents into documents_fts', () => {
  const dbDir = mkdtempSync(path.join(tmpdir(), 'forge-all-migrate-'));
  const dbPath = path.join(dbDir, 'all.db');

  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      content TEXT NOT NULL,
      UNIQUE(source, source_id)
    );
    INSERT INTO documents(source, source_id, content)
    VALUES ('notes', 'doc-1', 'alpha document body');
    PRAGMA user_version = 1;
  `);
  legacy.close();

  const manager = new DatabaseManager(dbDir);

  try {
    const db = manager.open('all');
    assert.equal(db.pragma('user_version', { simple: true }), 2);
    assert.deepEqual(
      db.prepare(`
        SELECT rowid, source, source_id, content
        FROM documents_fts
        WHERE documents_fts MATCH 'alpha'
      `).get(),
      {
        rowid: 1,
        source: 'notes',
        source_id: 'doc-1',
        content: 'alpha document body',
      },
    );
  } finally {
    manager.closeAll();
    rmSync(dbDir, { recursive: true, force: true });
  }
});

function columnNames(db: ReturnType<DatabaseManager['open']>, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>;
  return new Set(rows.map(row => row.name));
}
