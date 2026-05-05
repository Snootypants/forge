import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DatabaseManager } from './manager.ts';

interface FtsRow {
  id: string;
  content: string;
}

test('memory FTS triggers track inserts, content updates, tag updates, and deletes', () => {
  const dbDir = mkdtempSync(path.join(tmpdir(), 'forge-memory-fts-'));
  const manager = new DatabaseManager(dbDir);

  try {
    const db = manager.open('memory');

    db.prepare(`
      INSERT INTO memories (id, type, content, tags, created, updated)
      VALUES ('mem-1', 'preference', 'alpha original', '["first"]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    `).run();
    assert.deepEqual(search(db, 'alpha'), [{ id: 'mem-1', content: 'alpha original' }]);
    assert.deepEqual(search(db, 'first'), [{ id: 'mem-1', content: 'alpha original' }]);

    db.prepare("UPDATE memories SET content = 'bravo revised' WHERE id = 'mem-1'").run();
    assert.deepEqual(search(db, 'alpha'), []);
    assert.deepEqual(search(db, 'bravo'), [{ id: 'mem-1', content: 'bravo revised' }]);

    db.prepare("UPDATE memories SET tags = '[\"second\"]' WHERE id = 'mem-1'").run();
    assert.deepEqual(search(db, 'first'), []);
    assert.deepEqual(search(db, 'second'), [{ id: 'mem-1', content: 'bravo revised' }]);

    db.prepare("DELETE FROM memories WHERE id = 'mem-1'").run();
    assert.deepEqual(search(db, 'bravo'), []);
    assert.equal(countFtsRows(db), 0);
  } finally {
    manager.closeAll();
    rmSync(dbDir, { recursive: true, force: true });
  }
});

function search(db: ReturnType<DatabaseManager['open']>, term: string): FtsRow[] {
  return db.prepare(`
    SELECT id, content
    FROM memories_fts
    WHERE memories_fts MATCH ?
    ORDER BY rowid
  `).all(term) as FtsRow[];
}

function countFtsRows(db: ReturnType<DatabaseManager['open']>): number {
  const row = db.prepare('SELECT count(*) AS count FROM memories_fts').get() as { count: number };
  return row.count;
}
