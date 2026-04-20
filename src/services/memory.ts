import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import type Database from 'better-sqlite3';
import type { MemoryRecord } from '../types.ts';
import type { EmbedService } from './embed.ts';

const moduleRequire = createRequire(import.meta.url);

function genId(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

export interface SaveMemoryInput {
  type: string;
  content: string;
  tags?: string[];
  confidence?: number;
  importance?: number;
}

export interface SearchResult extends MemoryRecord {
  rank?: number;
  score?: number;
  snippet?: string;
}

export class MemoryService {
  private db: Database.Database;
  private embedService: EmbedService | null = null;
  private vecAvailable = false;

  constructor(db: Database.Database) {
    this.db = db;
  }

  initVec(embedService: EmbedService): boolean {
    this.embedService = embedService;
    try {
      const sqliteVec = moduleRequire('sqlite-vec') as { load: (db: Database.Database) => void };
      sqliteVec.load(this.db);
      this.vecAvailable = true;
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(
          id TEXT PRIMARY KEY,
          embedding float[1536]
        );
      `);
      console.log('[memory] sqlite-vec loaded — hybrid search enabled');
      return true;
    } catch (err) {
      console.warn('[memory] sqlite-vec not available — FTS5 only');
      this.vecAvailable = false;
      return false;
    }
  }

  async save(input: SaveMemoryInput): Promise<string> {
    const id = genId();
    const timestamp = now();
    const tags = JSON.stringify(input.tags ?? []);

    this.db.prepare(`
      INSERT INTO memories (id, type, content, tags, confidence, importance, created, updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.type, input.content, tags, input.confidence ?? 1.0, input.importance ?? 0.5, timestamp, timestamp);

    this.db.prepare(`
      INSERT INTO memories_fts (id, content, tags)
      VALUES (?, ?, ?)
    `).run(id, input.content, tags);

    if (this.vecAvailable && this.embedService?.available) {
      const embedding = await this.embedService.embed(input.content);
      if (embedding) {
        this.storeVector(id, embedding);
      }
    }

    this.recordHistory(id, 'create', { newContent: input.content, newStatus: 'active' });
    return id;
  }

  saveSync(input: SaveMemoryInput): string {
    const id = genId();
    const timestamp = now();
    const tags = JSON.stringify(input.tags ?? []);

    this.db.prepare(`
      INSERT INTO memories (id, type, content, tags, confidence, importance, created, updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.type, input.content, tags, input.confidence ?? 1.0, input.importance ?? 0.5, timestamp, timestamp);

    this.db.prepare(`
      INSERT INTO memories_fts (id, content, tags)
      VALUES (?, ?, ?)
    `).run(id, input.content, tags);

    this.recordHistory(id, 'create', { newContent: input.content, newStatus: 'active' });
    return id;
  }

  get(id: string): MemoryRecord | null {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as RawMemoryRow | undefined;
    if (!row) return null;
    this.db.prepare('UPDATE memories SET accessCount = accessCount + 1 WHERE id = ?').run(id);
    return this.toRecord(row);
  }

  async searchHybrid(query: string, limit = 10): Promise<SearchResult[]> {
    const ftsResults = this.searchFTS(query, limit);

    if (!this.vecAvailable || !this.embedService?.available) {
      return ftsResults;
    }

    const embedding = await this.embedService.embed(query);
    if (!embedding) return ftsResults;

    const vecResults = this.searchVector(embedding, limit);

    return this.mergeResults(vecResults, ftsResults, limit);
  }

  search(query: string, limit = 10): SearchResult[] {
    return this.searchFTS(query, limit);
  }

  private searchFTS(query: string, limit: number): SearchResult[] {
    const sanitized = query
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(w => w.length > 1)
      .join(' OR ');

    if (!sanitized) {
      return this.db.prepare(`
        SELECT * FROM memories WHERE status = 'active'
        ORDER BY importance DESC, updated DESC LIMIT ?
      `).all(limit).map(r => this.toRecord(r as RawMemoryRow));
    }

    const ftsResults = this.db.prepare(`
      SELECT m.*, fts.rank
      FROM memories_fts fts
      JOIN memories m ON m.id = fts.id
      WHERE memories_fts MATCH ?
      AND m.status = 'active'
      ORDER BY fts.rank
      LIMIT ?
    `).all(sanitized, limit) as (RawMemoryRow & { rank: number })[];

    if (ftsResults.length > 0) {
      return ftsResults.map(r => ({
        ...this.toRecord(r),
        rank: r.rank,
      }));
    }

    return this.db.prepare(`
      SELECT * FROM memories
      WHERE status = 'active'
      AND (content LIKE ? OR tags LIKE ?)
      ORDER BY importance DESC, updated DESC
      LIMIT ?
    `).all(`%${query}%`, `%${query}%`, limit)
      .map(r => this.toRecord(r as RawMemoryRow));
  }

  private searchVector(embedding: number[], limit: number): SearchResult[] {
    try {
      const queryBlob = Buffer.from(new Float32Array(embedding).buffer);
      const rows = this.db.prepare(`
        SELECT id, distance
        FROM memories_vec
        WHERE embedding MATCH ?
        ORDER BY distance
        LIMIT ?
      `).all(queryBlob, limit) as Array<{ id: string; distance: number }>;

      if (rows.length === 0) return [];

      const distances = rows.map(r => r.distance);
      const minDist = Math.min(...distances);
      const maxDist = Math.max(...distances);

      const results: SearchResult[] = [];
      for (const row of rows) {
        const memory = this.db.prepare('SELECT * FROM memories WHERE id = ? AND status = ?').get(row.id, 'active') as RawMemoryRow | undefined;
        if (!memory) continue;

        const score = maxDist === minDist ? 1 : 1 - (row.distance - minDist) / (maxDist - minDist);
        const cosineSim = cosineSimilarityFromL2(row.distance);

        results.push({
          ...this.toRecord(memory),
          score: cosineSim,
        });
      }

      return results;
    } catch (err) {
      console.error('[memory] Vector search error:', err);
      return [];
    }
  }

  private mergeResults(vectorResults: SearchResult[], ftsResults: SearchResult[], limit: number): SearchResult[] {
    const RRF_K = 60;
    const scores = new Map<string, { score: number; result: SearchResult }>();

    for (let i = 0; i < ftsResults.length; i++) {
      const r = ftsResults[i];
      const rrfScore = 1 / (RRF_K + i + 1);
      scores.set(r.id, { score: rrfScore, result: r });
    }

    for (let i = 0; i < vectorResults.length; i++) {
      const r = vectorResults[i];
      const rrfScore = 1 / (RRF_K + i + 1);
      const existing = scores.get(r.id);
      if (existing) {
        existing.score += rrfScore;
      } else {
        scores.set(r.id, { score: rrfScore, result: r });
      }
    }

    return [...scores.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => ({ ...s.result, score: s.score }));
  }

  private storeVector(id: string, embedding: number[]): void {
    try {
      this.db.prepare('DELETE FROM memories_vec WHERE id = ?').run(id);
      const blob = Buffer.from(new Float32Array(embedding).buffer);
      this.db.prepare('INSERT INTO memories_vec (id, embedding) VALUES (?, ?)').run(id, blob);
    } catch (err) {
      console.error('[memory] Vector store error:', err);
    }
  }

  list(opts?: { type?: string; status?: string; limit?: number }): MemoryRecord[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts?.type) { conditions.push('type = ?'); params.push(opts.type); }
    if (opts?.status) { conditions.push('status = ?'); params.push(opts.status); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = opts?.limit ?? 50;

    return this.db.prepare(`SELECT * FROM memories ${where} ORDER BY updated DESC LIMIT ?`)
      .all(...params, limit)
      .map(r => this.toRecord(r as RawMemoryRow));
  }

  update(id: string, partial: Partial<Pick<MemoryRecord, 'content' | 'tags' | 'status' | 'confidence' | 'importance'>>): boolean {
    const existing = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as RawMemoryRow | undefined;
    if (!existing) return false;

    const sets: string[] = ['updated = ?'];
    const params: unknown[] = [now()];

    if (partial.content !== undefined) { sets.push('content = ?'); params.push(partial.content); }
    if (partial.tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(partial.tags)); }
    if (partial.status !== undefined) { sets.push('status = ?'); params.push(partial.status); }
    if (partial.confidence !== undefined) { sets.push('confidence = ?'); params.push(partial.confidence); }
    if (partial.importance !== undefined) { sets.push('importance = ?'); params.push(partial.importance); }

    params.push(id);
    this.db.prepare(`UPDATE memories SET ${sets.join(', ')} WHERE id = ?`).run(...params);

    if (partial.content !== undefined || partial.tags !== undefined) {
      const newContent = partial.content ?? existing.content;
      const newTags = partial.tags ? JSON.stringify(partial.tags) : existing.tags;
      this.db.prepare('DELETE FROM memories_fts WHERE id = ?').run(id);
      this.db.prepare('INSERT INTO memories_fts (id, content, tags) VALUES (?, ?, ?)').run(id, newContent, newTags);
    }

    this.recordHistory(id, 'update', {
      oldContent: existing.content, oldStatus: existing.status,
      oldConfidence: existing.confidence, oldTags: existing.tags,
      newContent: partial.content, newStatus: partial.status,
    });

    return true;
  }

  remove(id: string): boolean {
    const existing = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as RawMemoryRow | undefined;
    if (!existing) return false;

    this.recordHistory(id, 'delete', { oldContent: existing.content, oldStatus: existing.status });
    this.db.prepare('DELETE FROM memories_fts WHERE id = ?').run(id);
    if (this.vecAvailable) {
      try { this.db.prepare('DELETE FROM memories_vec WHERE id = ?').run(id); } catch { /* ok */ }
    }
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return true;
  }

  supersede(oldId: string, newInput: SaveMemoryInput, reason?: string): string {
    const newId = this.saveSync(newInput);
    this.db.prepare("UPDATE memories SET status = 'superseded', supersededBy = ? WHERE id = ?").run(newId, oldId);
    this.recordHistory(oldId, 'supersede', { oldStatus: 'active', newStatus: 'superseded', reason });
    return newId;
  }

  stats(): { total: number; active: number; superseded: number; archived: number; vecEnabled: boolean } {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'superseded' THEN 1 ELSE 0 END) as superseded,
        SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) as archived
      FROM memories
    `).get() as { total: number; active: number; superseded: number; archived: number };
    return { ...row, vecEnabled: this.vecAvailable };
  }

  history(memoryId: string): Array<{
    changeType: string; oldContent: string | null; newContent: string | null;
    changedAt: string; reason: string | null;
  }> {
    const rows = this.db.prepare(`
      SELECT change_type, old_content, new_content, changed_at, reason
      FROM memory_history WHERE memory_id = ? ORDER BY changed_at DESC
    `).all(memoryId) as Array<{
      change_type: string; old_content: string | null; new_content: string | null;
      changed_at: string; reason: string | null;
    }>;
    return rows.map(r => ({
      changeType: r.change_type, oldContent: r.old_content,
      newContent: r.new_content, changedAt: r.changed_at, reason: r.reason,
    }));
  }

  private recordHistory(memoryId: string, changeType: string, data: {
    oldContent?: string | null; oldStatus?: string | null; oldConfidence?: number | null;
    oldTags?: string | null; newContent?: string | null; newStatus?: string | null; reason?: string | null;
  }): void {
    this.db.prepare(`
      INSERT INTO memory_history (memory_id, change_type, old_content, old_status, old_confidence, old_tags, new_content, new_status, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(memoryId, changeType, data.oldContent ?? null, data.oldStatus ?? null,
      data.oldConfidence ?? null, data.oldTags ?? null, data.newContent ?? null,
      data.newStatus ?? null, data.reason ?? null);
  }

  private toRecord(row: RawMemoryRow): MemoryRecord {
    return {
      id: row.id, type: row.type, content: row.content,
      tags: JSON.parse(row.tags),
      status: row.status as 'active' | 'superseded' | 'archived',
      confidence: row.confidence, importance: row.importance,
      accessCount: row.accessCount, created: row.created,
      updated: row.updated, supersededBy: row.supersededBy,
    };
  }
}

function cosineSimilarityFromL2(distance: number): number {
  if (!Number.isFinite(distance)) return 0;
  const cos = 1 - (distance * distance) / 2;
  if (cos < 0) return 0;
  if (cos > 1) return 1;
  return cos;
}

interface RawMemoryRow {
  id: string; type: string; content: string; tags: string;
  status: string; confidence: number; importance: number;
  accessCount: number; created: string; updated: string;
  supersededBy: string | null;
}
