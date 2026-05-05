import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DatabaseManager } from './manager.ts';

test('document chunks are removed when their document is deleted', () => {
  const dbDir = mkdtempSync(path.join(tmpdir(), 'forge-document-chunks-'));
  const manager = new DatabaseManager(dbDir);

  try {
    const db = manager.open('all');
    const document = db.prepare(`
      INSERT INTO documents(source, source_id, content)
      VALUES ('notes', 'doc-1', 'document body')
    `).run();
    db.prepare(`
      INSERT INTO document_chunks(document_id, chunk_index, content, start_char, end_char)
      VALUES (?, 0, 'document body', 0, 13)
    `).run(document.lastInsertRowid);

    db.prepare('DELETE FROM documents WHERE id = ?').run(document.lastInsertRowid);

    assert.equal(countRows(db, 'document_chunks'), 0);
  } finally {
    manager.closeAll();
    rmSync(dbDir, { recursive: true, force: true });
  }
});

test('chat history chunks are removed when their conversation is deleted', () => {
  const dbDir = mkdtempSync(path.join(tmpdir(), 'forge-chat-chunks-'));
  const manager = new DatabaseManager(dbDir);

  try {
    const db = manager.open('chat-history');
    db.prepare(`
      INSERT INTO conversations(uuid, name)
      VALUES ('conv-1', 'Conversation')
    `).run();
    db.prepare(`
      INSERT INTO chunks(conversation_uuid, chunk_text)
      VALUES ('conv-1', 'chunk body')
    `).run();

    db.prepare("DELETE FROM conversations WHERE uuid = 'conv-1'").run();

    assert.equal(countRows(db, 'chunks'), 0);
  } finally {
    manager.closeAll();
    rmSync(dbDir, { recursive: true, force: true });
  }
});

function countRows(db: ReturnType<DatabaseManager['open']>, table: string): number {
  const row = db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}
