import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DatabaseManager } from './manager.ts';

interface FtsRow {
  rowid: number;
  source: string;
  source_id: string;
  content: string;
}

interface CountRow {
  count: number;
}

test('documents FTS triggers track inserts, updates, and deletes', () => {
  const dbDir = mkdtempSync(path.join(tmpdir(), 'forge-documents-fts-'));
  const manager = new DatabaseManager(dbDir);

  try {
    const db = manager.open('all');

    const insert = db.prepare(`
      INSERT INTO documents(source, source_id, content)
      VALUES (?, ?, ?)
    `);

    const first = insert.run('notes', 'doc-1', 'alpha original text');
    const second = insert.run('notes', 'doc-2', 'charlie retained text');

    assert.deepEqual(search(db, 'alpha'), [
      {
        rowid: Number(first.lastInsertRowid),
        source: 'notes',
        source_id: 'doc-1',
        content: 'alpha original text',
      },
    ]);
    assert.deepEqual(search(db, 'charlie'), [
      {
        rowid: Number(second.lastInsertRowid),
        source: 'notes',
        source_id: 'doc-2',
        content: 'charlie retained text',
      },
    ]);

    db.prepare(`
      UPDATE documents
      SET source = ?, source_id = ?, content = ?
      WHERE id = ?
    `).run('wiki', 'doc-1-renamed', 'bravo revised text', first.lastInsertRowid);

    assert.deepEqual(search(db, 'alpha'), []);
    assert.deepEqual(search(db, 'bravo'), [
      {
        rowid: Number(first.lastInsertRowid),
        source: 'wiki',
        source_id: 'doc-1-renamed',
        content: 'bravo revised text',
      },
    ]);

    db.prepare('DELETE FROM documents WHERE id = ?').run(first.lastInsertRowid);

    assert.deepEqual(search(db, 'bravo'), []);
    assert.deepEqual(search(db, 'charlie'), [
      {
        rowid: Number(second.lastInsertRowid),
        source: 'notes',
        source_id: 'doc-2',
        content: 'charlie retained text',
      },
    ]);
    assert.equal(countFtsRows(db), 1);
  } finally {
    manager.closeAll();
    rmSync(dbDir, { recursive: true, force: true });
  }
});

function search(db: ReturnType<DatabaseManager['open']>, term: string): FtsRow[] {
  return db.prepare(`
    SELECT rowid, source, source_id, content
    FROM documents_fts
    WHERE documents_fts MATCH ?
    ORDER BY rowid
  `).all(term) as FtsRow[];
}

function countFtsRows(db: ReturnType<DatabaseManager['open']>): number {
  const row = db.prepare('SELECT count(*) AS count FROM documents_fts').get() as CountRow;
  return row.count;
}
