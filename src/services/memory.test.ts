import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseManager } from '../db/manager.ts';
import { MemoryService } from './memory.ts';
import type { EmbedService } from './embed.ts';

test('memory update rolls back base row, FTS, and history when a constraint fails', () => {
  const dbDir = mkdtempSync(path.join(os.tmpdir(), 'forge-memory-service-'));
  const manager = new DatabaseManager(dbDir);
  const db = manager.open('memory');
  const memory = new MemoryService(db);

  try {
    const id = memory.saveSync({
      type: 'preference',
      content: 'alpha bravo',
      tags: ['original'],
      confidence: 0.9,
    });

    assert.throws(() => {
      memory.update(id, {
        content: 'charlie delta',
        tags: ['updated'],
        confidence: 2,
      });
    }, /CHECK constraint failed/);

    assert.equal(memory.get(id)?.content, 'alpha bravo');
    assert.deepEqual(searchFts(db, 'alpha'), [{ id, content: 'alpha bravo' }]);
    assert.deepEqual(searchFts(db, 'charlie'), []);
    assert.deepEqual(memory.history(id).map(row => row.changeType), ['create']);
  } finally {
    manager.closeAll();
    rmSync(dbDir, { recursive: true, force: true });
  }
});

test('memory supersede does not create a replacement for a missing memory', () => {
  const dbDir = mkdtempSync(path.join(os.tmpdir(), 'forge-memory-service-'));
  const manager = new DatabaseManager(dbDir);
  const db = manager.open('memory');
  const memory = new MemoryService(db);

  try {
    assert.throws(() => {
      memory.supersede('missing', {
        type: 'preference',
        content: 'replacement',
      });
    }, /Memory not found: missing/);

    const row = db.prepare('SELECT count(*) AS count FROM memories').get() as { count: number };
    assert.equal(row.count, 0);
  } finally {
    manager.closeAll();
    rmSync(dbDir, { recursive: true, force: true });
  }
});

test('memory vector lifecycle indexes active sync writes and removes stale vectors', async () => {
  const dbDir = mkdtempSync(path.join(os.tmpdir(), 'forge-memory-service-'));
  const manager = new DatabaseManager(dbDir);
  const db = manager.open('memory');
  const memory = new MemoryService(db);
  const embed = new FakeEmbedService();
  enableFakeVectors(memory, db, embed);

  try {
    const id = memory.saveSync({
      type: 'preference',
      content: 'alpha bravo',
      tags: ['original'],
      confidence: 0.9,
    });
    await memory.flushVectorIndexQueue();

    assert.deepEqual(embed.calls, ['alpha bravo']);
    assert.deepEqual(vectorIds(db), [id]);
    assert.deepEqual(vectorValues(db, id), [11, 12]);

    assert.equal(memory.update(id, { content: 'charlie delta' }), true);
    assert.deepEqual(vectorIds(db), []);
    await memory.flushVectorIndexQueue();

    assert.deepEqual(embed.calls, ['alpha bravo', 'charlie delta']);
    assert.deepEqual(vectorIds(db), [id]);
    assert.deepEqual(vectorValues(db, id), [13, 14]);

    assert.equal(memory.update(id, { status: 'archived' }), true);
    assert.deepEqual(vectorIds(db), []);
    await memory.flushVectorIndexQueue();
    assert.deepEqual(vectorIds(db), []);

    assert.equal(memory.update(id, { status: 'active' }), true);
    await memory.flushVectorIndexQueue();
    assert.deepEqual(embed.calls, ['alpha bravo', 'charlie delta', 'charlie delta']);
    assert.deepEqual(vectorIds(db), [id]);

    assert.equal(memory.remove(id), true);
    assert.deepEqual(vectorIds(db), []);
  } finally {
    manager.closeAll();
    rmSync(dbDir, { recursive: true, force: true });
  }
});

test('memory supersede indexes replacement and deletes old vector', async () => {
  const dbDir = mkdtempSync(path.join(os.tmpdir(), 'forge-memory-service-'));
  const manager = new DatabaseManager(dbDir);
  const db = manager.open('memory');
  const memory = new MemoryService(db);
  const embed = new FakeEmbedService();
  enableFakeVectors(memory, db, embed);

  try {
    const oldId = memory.saveSync({
      type: 'preference',
      content: 'old content',
    });
    await memory.flushVectorIndexQueue();
    assert.deepEqual(vectorIds(db), [oldId]);

    const newId = memory.supersede(oldId, {
      type: 'preference',
      content: 'new replacement',
    });

    assert.deepEqual(vectorIds(db), []);
    await memory.flushVectorIndexQueue();

    assert.deepEqual(embed.calls, ['old content', 'new replacement']);
    assert.deepEqual(vectorIds(db), [newId]);
    assert.deepEqual(vectorValues(db, newId), [15, 16]);
  } finally {
    manager.closeAll();
    rmSync(dbDir, { recursive: true, force: true });
  }
});

function searchFts(db: ReturnType<DatabaseManager['open']>, term: string): Array<{ id: string; content: string }> {
  return db.prepare(`
    SELECT id, content
    FROM memories_fts
    WHERE memories_fts MATCH ?
    ORDER BY rowid
  `).all(term) as Array<{ id: string; content: string }>;
}

class FakeEmbedService {
  calls: string[] = [];

  get available(): boolean {
    return true;
  }

  async embed(text: string): Promise<number[]> {
    this.calls.push(text);
    return [text.length, text.length + 1];
  }
}

function enableFakeVectors(
  memory: MemoryService,
  db: ReturnType<DatabaseManager['open']>,
  embed: FakeEmbedService,
): void {
  db.exec('CREATE TABLE memories_vec (id TEXT PRIMARY KEY, embedding BLOB NOT NULL)');
  const internals = memory as unknown as {
    embedService: EmbedService;
    vecAvailable: boolean;
  };
  internals.embedService = embed as unknown as EmbedService;
  internals.vecAvailable = true;
}

function vectorIds(db: ReturnType<DatabaseManager['open']>): string[] {
  const rows = db.prepare('SELECT id FROM memories_vec ORDER BY id').all() as Array<{ id: string }>;
  return rows.map(row => row.id);
}

function vectorValues(db: ReturnType<DatabaseManager['open']>, id: string): number[] {
  const row = db.prepare('SELECT embedding FROM memories_vec WHERE id = ?').get(id) as { embedding: Buffer };
  return Array.from(new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4));
}
