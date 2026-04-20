import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { MemoryService } from '../src/services/memory.ts';
import { EmbedService } from '../src/services/embed.ts';

interface EvalEntry {
  question_id: string;
  question_type: string;
  question: string;
  answer: string | string[];
  question_date: string;
  haystack_sessions: Array<Array<{ role: string; content: string; has_answer?: boolean }>>;
  haystack_session_ids: string[];
  answer_session_ids: string[];
}

interface EvalResult {
  questionId: string;
  questionType: string;
  question: string;
  expectedAnswer: string;
  answerSessionIds: string[];
  retrievedMemoryIds: string[];
  hit: boolean;
  rank: number | null;
  searchResults: number;
}

const SCHEMA = fs.readFileSync(
  new URL('../src/db/schemas/memory.sql', import.meta.url),
  'utf-8',
);

function createFreshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}

function ingestSessionsSync(
  memory: MemoryService,
  sessions: EvalEntry['haystack_sessions'],
  sessionIds: string[],
): void {
  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const sessionId = sessionIds[i] ?? `session-${i}`;
    const fullText = session.map(t => `${t.role}: ${t.content}`).join('\n');
    memory.saveSync({
      type: 'conversation',
      content: fullText,
      tags: [sessionId, `session-${i}`],
      importance: 0.5,
    });
  }
}

async function ingestSessionsHybrid(
  memory: MemoryService,
  sessions: EvalEntry['haystack_sessions'],
  sessionIds: string[],
): Promise<void> {
  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const sessionId = sessionIds[i] ?? `session-${i}`;
    const fullText = session.map(t => `${t.role}: ${t.content}`).join('\n');
    await memory.save({
      type: 'conversation',
      content: fullText,
      tags: [sessionId, `session-${i}`],
      importance: 0.5,
    });
  }
}

function extractSessionIds(results: { tags: string[] }[], validIds: string[]): string[] {
  const retrieved: string[] = [];
  for (const r of results) {
    for (const tag of r.tags) {
      if (validIds.includes(tag)) {
        retrieved.push(tag);
      }
    }
  }
  return retrieved;
}

function scoreResult(
  entry: EvalEntry,
  retrievedSessionIds: string[],
  searchResults: number,
): EvalResult {
  const answerSet = new Set(entry.answer_session_ids);
  const hit = retrievedSessionIds.some(id => answerSet.has(id));
  let rank: number | null = null;
  for (let i = 0; i < retrievedSessionIds.length; i++) {
    if (answerSet.has(retrievedSessionIds[i])) { rank = i + 1; break; }
  }
  return {
    questionId: entry.question_id,
    questionType: entry.question_type,
    question: entry.question,
    expectedAnswer: Array.isArray(entry.answer) ? entry.answer.join(', ') : entry.answer,
    answerSessionIds: entry.answer_session_ids,
    retrievedMemoryIds: retrievedSessionIds,
    hit, rank, searchResults,
  };
}

async function main(): Promise<void> {
  const dataFile = process.argv[2] ?? 'eval/data/longmemeval_oracle.json';
  const topK = parseInt(process.argv[3] ?? '10');
  const maxEntries = parseInt(process.argv[4] ?? '500');
  const mode = process.argv[5] ?? 'fts';
  const startOffset = parseInt(process.argv[6] ?? '0');

  const useHybrid = mode === 'hybrid';
  let embedService: EmbedService | null = null;

  if (useHybrid) {
    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY required for hybrid mode');
      process.exit(1);
    }
    embedService = new EmbedService();
  }

  console.log(`\n━━━ Memory Eval ━━━`);
  console.log(`Dataset: ${dataFile}`);
  console.log(`Top-K: ${topK}`);
  console.log(`Max entries: ${maxEntries}`);
  console.log(`Mode: ${useHybrid ? 'HYBRID (FTS5 + Vector)' : 'FTS5 only'}\n`);

  const raw = fs.readFileSync(dataFile, 'utf-8');
  const entries: EvalEntry[] = JSON.parse(raw).slice(startOffset, startOffset + maxEntries);
  console.log(`Loaded ${entries.length} eval entries (offset ${startOffset})\n`);

  const typeStats = new Map<string, { total: number; hits: number; totalRank: number; ranked: number }>();
  const allResults: EvalResult[] = [];
  let totalHits = 0;
  let totalMRR = 0;

  const startTime = Date.now();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const db = createFreshDb();
    const memory = new MemoryService(db);

    let result: EvalResult;

    if (useHybrid && embedService) {
      memory.initVec(embedService);
      await ingestSessionsHybrid(memory, entry.haystack_sessions, entry.haystack_session_ids);
      const results = await memory.searchHybrid(entry.question, topK);
      const retrievedIds = extractSessionIds(results, entry.haystack_session_ids);
      result = scoreResult(entry, retrievedIds, results.length);
    } else {
      ingestSessionsSync(memory, entry.haystack_sessions, entry.haystack_session_ids);
      const results = memory.search(entry.question, topK);
      const retrievedIds = extractSessionIds(results, entry.haystack_session_ids);
      result = scoreResult(entry, retrievedIds, results.length);
    }

    allResults.push(result);
    if (result.hit) totalHits++;
    if (result.rank !== null) { totalMRR += 1 / result.rank; }

    if (!typeStats.has(result.questionType)) {
      typeStats.set(result.questionType, { total: 0, hits: 0, totalRank: 0, ranked: 0 });
    }
    const ts = typeStats.get(result.questionType)!;
    ts.total++;
    if (result.hit) ts.hits++;
    if (result.rank !== null) { ts.totalRank += 1 / result.rank; ts.ranked++; }

    db.close();

    if ((i + 1) % 10 === 0 || i === entries.length - 1) {
      const pct = ((totalHits / (i + 1)) * 100).toFixed(1);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  [${i + 1}/${entries.length}] Hit rate: ${pct}% | ${elapsed}s elapsed`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n━━━ Results (${useHybrid ? 'HYBRID' : 'FTS5'}) ━━━\n`);
  console.log(`Total entries:   ${entries.length}`);
  console.log(`Total hits:      ${totalHits}`);
  console.log(`Hit rate:        ${((totalHits / entries.length) * 100).toFixed(1)}%`);
  console.log(`MRR@${topK}:         ${(totalMRR / entries.length).toFixed(4)}`);
  console.log(`Time:            ${elapsed}s`);
  console.log(`Avg per entry:   ${(parseFloat(elapsed) / entries.length * 1000).toFixed(1)}ms\n`);

  console.log(`━━━ By Question Type ━━━\n`);
  const sortedTypes = [...typeStats.entries()].sort((a, b) => b[1].total - a[1].total);
  console.log(`${'Type'.padEnd(30)} ${'Total'.padStart(6)} ${'Hits'.padStart(6)} ${'Rate'.padStart(8)} ${'MRR'.padStart(8)}`);
  console.log('─'.repeat(62));
  for (const [type, stats] of sortedTypes) {
    const rate = ((stats.hits / stats.total) * 100).toFixed(1);
    const mrr = stats.total > 0 ? (stats.totalRank / stats.total).toFixed(4) : '0.0000';
    console.log(`${type.padEnd(30)} ${String(stats.total).padStart(6)} ${String(stats.hits).padStart(6)} ${(rate + '%').padStart(8)} ${mrr.padStart(8)}`);
  }

  const failures = allResults.filter(r => !r.hit);
  if (failures.length > 0) {
    console.log(`\n━━━ Sample Failures (first 10) ━━━\n`);
    for (const f of failures.slice(0, 10)) {
      console.log(`  [${f.questionType}] ${f.question}`);
      console.log(`    Expected: ${f.expectedAnswer.slice(0, 80)}`);
      console.log(`    Answer sessions: ${f.answerSessionIds.join(', ')}`);
      console.log(`    Retrieved: ${f.retrievedMemoryIds.length > 0 ? f.retrievedMemoryIds.join(', ') : '(none matched)'}`);
      console.log();
    }
  }

  const suffix = useHybrid ? '-hybrid' : '-fts';
  const reportPath = path.resolve(`eval/results${suffix}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({
    mode: useHybrid ? 'hybrid' : 'fts',
    dataset: dataFile,
    topK,
    totalEntries: entries.length,
    totalHits,
    hitRate: totalHits / entries.length,
    mrr: totalMRR / entries.length,
    elapsed: parseFloat(elapsed),
    byType: Object.fromEntries(sortedTypes.map(([type, stats]) => [type, {
      total: stats.total, hits: stats.hits,
      hitRate: stats.hits / stats.total,
      mrr: stats.totalRank / stats.total,
    }])),
    failures: failures.map(f => ({
      id: f.questionId, type: f.questionType,
      question: f.question, expected: f.expectedAnswer,
    })),
  }, null, 2));

  console.log(`\nResults saved to ${reportPath}`);
}

main().catch(err => {
  console.error('Eval failed:', err);
  process.exit(1);
});
