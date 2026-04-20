import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { MemoryService } from '../src/services/memory.ts';
import { EmbedService } from '../src/services/embed.ts';

interface LocomoTurn {
  speaker: string;
  dia_id: string;
  text: string;
}

interface LocomoQA {
  question: string;
  answer?: string;
  adversarial_answer?: string;
  evidence: string[];
  category: number;
}

interface LocomoEntry {
  sample_id: string;
  conversation: Record<string, unknown>;
  qa: LocomoQA[];
  event_summary?: unknown;
  observation?: unknown;
  session_summary?: unknown;
}

interface EvalResult {
  sampleId: string;
  question: string;
  category: number;
  evidenceSessions: number[];
  retrievedSessions: number[];
  hit: boolean;
  rank: number | null;
}

const CATEGORY_NAMES: Record<number, string> = {
  1: 'single-hop',
  2: 'temporal',
  3: 'multi-hop',
  4: 'open-domain',
  5: 'adversarial',
};

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

function extractSessions(conversation: Record<string, unknown>): Map<number, { date: string; turns: LocomoTurn[] }> {
  const sessions = new Map<number, { date: string; turns: LocomoTurn[] }>();
  const keys = Object.keys(conversation);

  for (const key of keys) {
    const match = key.match(/^session_(\d+)$/);
    if (match) {
      const num = parseInt(match[1]);
      const dateKey = `session_${num}_date_time`;
      sessions.set(num, {
        date: (conversation[dateKey] as string) ?? '',
        turns: conversation[key] as LocomoTurn[],
      });
    }
  }

  return sessions;
}

function evidenceToSessions(evidence: string[]): number[] {
  const sessions = new Set<number>();
  for (const e of evidence) {
    const match = e.match(/^D(\d+):/);
    if (match) sessions.add(parseInt(match[1]));
  }
  return [...sessions];
}

function ingestSessions(
  memory: MemoryService,
  sessions: Map<number, { date: string; turns: LocomoTurn[] }>,
  speakerA: string,
  speakerB: string,
): void {
  for (const [num, session] of sessions) {
    const header = session.date ? `[${session.date}] ` : '';
    const text = session.turns
      .map(t => `${t.speaker}: ${t.text}`)
      .join('\n');
    const fullText = `${header}Conversation between ${speakerA} and ${speakerB}\n\n${text}`;

    memory.saveSync({
      type: 'conversation',
      content: fullText,
      tags: [`session-${num}`],
      importance: 0.5,
    });
  }
}

async function ingestSessionsHybrid(
  memory: MemoryService,
  sessions: Map<number, { date: string; turns: LocomoTurn[] }>,
  speakerA: string,
  speakerB: string,
): Promise<void> {
  for (const [num, session] of sessions) {
    const header = session.date ? `[${session.date}] ` : '';
    const text = session.turns
      .map(t => `${t.speaker}: ${t.text}`)
      .join('\n');
    const fullText = `${header}Conversation between ${speakerA} and ${speakerB}\n\n${text}`;

    await memory.save({
      type: 'conversation',
      content: fullText,
      tags: [`session-${num}`],
      importance: 0.5,
    });
  }
}

function extractRetrievedSessions(results: { tags: string[] }[]): number[] {
  const sessions: number[] = [];
  for (const r of results) {
    for (const tag of r.tags) {
      const match = tag.match(/^session-(\d+)$/);
      if (match) sessions.push(parseInt(match[1]));
    }
  }
  return sessions;
}

function scoreResult(
  sampleId: string,
  qa: LocomoQA,
  retrievedSessions: number[],
): EvalResult {
  const evidenceSessions = evidenceToSessions(qa.evidence);
  const evidenceSet = new Set(evidenceSessions);
  const hit = retrievedSessions.some(s => evidenceSet.has(s));
  let rank: number | null = null;
  for (let i = 0; i < retrievedSessions.length; i++) {
    if (evidenceSet.has(retrievedSessions[i])) { rank = i + 1; break; }
  }

  return {
    sampleId,
    question: qa.question,
    category: qa.category,
    evidenceSessions,
    retrievedSessions,
    hit,
    rank,
  };
}

async function main(): Promise<void> {
  const dataFile = process.argv[2] ?? 'eval/data/locomo10.json';
  const topK = parseInt(process.argv[3] ?? '10');
  const maxQuestions = parseInt(process.argv[4] ?? '9999');
  const mode = process.argv[5] ?? 'fts';

  const useHybrid = mode === 'hybrid';
  let embedService: EmbedService | null = null;

  if (useHybrid) {
    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY required for hybrid mode');
      process.exit(1);
    }
    embedService = new EmbedService();
  }

  console.log(`\n━━━ LOCOMO Eval ━━━`);
  console.log(`Dataset: ${dataFile}`);
  console.log(`Top-K: ${topK}`);
  console.log(`Max questions: ${maxQuestions}`);
  console.log(`Mode: ${useHybrid ? 'HYBRID (FTS5 + Vector)' : 'FTS5 only'}\n`);

  const raw = fs.readFileSync(dataFile, 'utf-8');
  const entries: LocomoEntry[] = JSON.parse(raw);
  console.log(`Loaded ${entries.length} conversations\n`);

  const catStats = new Map<number, { total: number; hits: number; totalRR: number }>();
  const allResults: EvalResult[] = [];
  let totalHits = 0;
  let totalMRR = 0;
  let questionCount = 0;

  const startTime = Date.now();

  for (const entry of entries) {
    if (questionCount >= maxQuestions) break;

    const conv = entry.conversation as Record<string, unknown>;
    const sessions = extractSessions(conv);
    const speakerA = conv.speaker_a as string;
    const speakerB = conv.speaker_b as string;

    const db = createFreshDb();
    const memory = new MemoryService(db);

    if (useHybrid && embedService) {
      memory.initVec(embedService);
      await ingestSessionsHybrid(memory, sessions, speakerA, speakerB);
    } else {
      ingestSessions(memory, sessions, speakerA, speakerB);
    }

    const questionsToRun = entry.qa.slice(0, maxQuestions - questionCount);

    for (const qa of questionsToRun) {
      let results;
      if (useHybrid) {
        results = await memory.searchHybrid(qa.question, topK);
      } else {
        results = memory.search(qa.question, topK);
      }

      const retrievedSessions = extractRetrievedSessions(results);
      const result = scoreResult(entry.sample_id, qa, retrievedSessions);

      allResults.push(result);
      if (result.hit) totalHits++;
      if (result.rank !== null) totalMRR += 1 / result.rank;

      if (!catStats.has(qa.category)) {
        catStats.set(qa.category, { total: 0, hits: 0, totalRR: 0 });
      }
      const cs = catStats.get(qa.category)!;
      cs.total++;
      if (result.hit) cs.hits++;
      if (result.rank !== null) cs.totalRR += 1 / result.rank;

      questionCount++;
    }

    db.close();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const pct = ((totalHits / questionCount) * 100).toFixed(1);
    console.log(`  [${entry.sample_id}] ${questionCount} questions done | Hit rate: ${pct}% | ${elapsed}s`);

    if (questionCount >= maxQuestions) break;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n━━━ Results (${useHybrid ? 'HYBRID' : 'FTS5'}) ━━━\n`);
  console.log(`Total questions: ${questionCount}`);
  console.log(`Total hits:      ${totalHits}`);
  console.log(`Hit rate:        ${((totalHits / questionCount) * 100).toFixed(1)}%`);
  console.log(`MRR@${topK}:         ${(totalMRR / questionCount).toFixed(4)}`);
  console.log(`Time:            ${elapsed}s`);
  console.log(`Avg per question: ${(parseFloat(elapsed) / questionCount * 1000).toFixed(1)}ms\n`);

  console.log(`━━━ By Category ━━━\n`);
  const sortedCats = [...catStats.entries()].sort((a, b) => a[0] - b[0]);
  console.log(`${'Category'.padEnd(20)} ${'Total'.padStart(6)} ${'Hits'.padStart(6)} ${'Rate'.padStart(8)} ${'MRR'.padStart(8)}`);
  console.log('─'.repeat(52));
  for (const [cat, stats] of sortedCats) {
    const name = CATEGORY_NAMES[cat] ?? `cat-${cat}`;
    const rate = ((stats.hits / stats.total) * 100).toFixed(1);
    const mrr = (stats.totalRR / stats.total).toFixed(4);
    console.log(`${name.padEnd(20)} ${String(stats.total).padStart(6)} ${String(stats.hits).padStart(6)} ${(rate + '%').padStart(8)} ${mrr.padStart(8)}`);
  }

  const failures = allResults.filter(r => !r.hit);
  if (failures.length > 0) {
    console.log(`\n━━━ Sample Failures (first 10) ━━━\n`);
    for (const f of failures.slice(0, 10)) {
      const catName = CATEGORY_NAMES[f.category] ?? `cat-${f.category}`;
      console.log(`  [${catName}] ${f.question}`);
      console.log(`    Evidence sessions: ${f.evidenceSessions.join(', ')}`);
      console.log(`    Retrieved sessions: ${f.retrievedSessions.length > 0 ? f.retrievedSessions.join(', ') : '(none matched)'}`);
      console.log();
    }
  }

  const suffix = useHybrid ? '-hybrid' : '-fts';
  const reportPath = path.resolve(`eval/results-locomo${suffix}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({
    benchmark: 'LOCOMO',
    mode: useHybrid ? 'hybrid' : 'fts',
    dataset: dataFile,
    topK,
    totalQuestions: questionCount,
    totalHits,
    hitRate: totalHits / questionCount,
    mrr: totalMRR / questionCount,
    elapsed: parseFloat(elapsed),
    byCategory: Object.fromEntries(sortedCats.map(([cat, stats]) => [
      CATEGORY_NAMES[cat] ?? `cat-${cat}`, {
        total: stats.total, hits: stats.hits,
        hitRate: stats.hits / stats.total,
        mrr: stats.totalRR / stats.total,
      },
    ])),
    failures: failures.map(f => ({
      sampleId: f.sampleId,
      category: CATEGORY_NAMES[f.category],
      question: f.question,
      evidenceSessions: f.evidenceSessions,
      retrievedSessions: f.retrievedSessions,
    })),
  }, null, 2));

  console.log(`\nResults saved to ${reportPath}`);
}

main().catch(err => {
  console.error('LOCOMO eval failed:', err);
  process.exit(1);
});
