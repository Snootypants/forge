import crypto from 'node:crypto';
import OpenAI from 'openai';

const DEFAULT_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSION = 1536;
const MAX_BATCH_SIZE = 100;
const MAX_INPUT_TOKENS = 8000;
const TPM_CEILING = 900_000;
const TPM_WINDOW_MS = 60_000;
const CHARS_PER_TOKEN = 4;

interface TpmRecord {
  timestamp: number;
  tokens: number;
}

export class EmbedService {
  private client: OpenAI | null;
  private cache = new Map<string, number[]>();
  private recentRequests: TpmRecord[] = [];

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      this.client = new OpenAI({ apiKey });
      console.log('[embed] OpenAI client initialized');
    } else {
      this.client = null;
      console.log('[embed] No OPENAI_API_KEY — vector search disabled, FTS5 only');
    }
  }

  get available(): boolean {
    return this.client !== null;
  }

  private truncate(text: string): string {
    const maxChars = MAX_INPUT_TOKENS * 3;
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars);
  }

  async embed(text: string): Promise<number[] | null> {
    if (!this.client) return null;

    const truncated = this.truncate(text);
    const hash = crypto.createHash('sha256').update(truncated).digest('hex');
    const cached = this.cache.get(hash);
    if (cached) return cached;

    await this.throttle(truncated);

    const response = await this.client.embeddings.create({
      model: DEFAULT_MODEL,
      input: truncated,
    });

    const embedding = response.data[0].embedding;
    this.cache.set(hash, embedding);
    return embedding;
  }

  async embedBatch(texts: string[]): Promise<(number[] | null)[]> {
    if (!this.client) return texts.map(() => null);

    const results: (number[] | null)[] = new Array(texts.length).fill(null);
    const uncached: { index: number; text: string }[] = [];

    for (let i = 0; i < texts.length; i++) {
      const truncated = this.truncate(texts[i]);
      const hash = crypto.createHash('sha256').update(truncated).digest('hex');
      const cached = this.cache.get(hash);
      if (cached) {
        results[i] = cached;
      } else {
        uncached.push({ index: i, text: truncated });
      }
    }

    for (let b = 0; b < uncached.length; b += MAX_BATCH_SIZE) {
      const batch = uncached.slice(b, b + MAX_BATCH_SIZE);
      const batchTexts = batch.map(u => u.text);

      await this.throttleBatch(batchTexts);

      const response = await this.client.embeddings.create({
        model: DEFAULT_MODEL,
        input: batchTexts,
      });

      for (let j = 0; j < response.data.length; j++) {
        const embedding = response.data[j].embedding;
        const hash = crypto.createHash('sha256').update(batch[j].text).digest('hex');
        this.cache.set(hash, embedding);
        results[batch[j].index] = embedding;
      }
    }

    return results;
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  private async throttle(text: string): Promise<void> {
    const tokens = this.estimateTokens(text);
    await this.waitForCapacity(tokens);
    this.recentRequests.push({ timestamp: Date.now(), tokens });
  }

  private async throttleBatch(texts: string[]): Promise<void> {
    const tokens = texts.reduce((sum, t) => sum + this.estimateTokens(t), 0);
    await this.waitForCapacity(tokens);
    this.recentRequests.push({ timestamp: Date.now(), tokens });
  }

  private async waitForCapacity(pendingTokens: number): Promise<void> {
    const cutoff = Date.now() - TPM_WINDOW_MS;
    this.recentRequests = this.recentRequests.filter(r => r.timestamp > cutoff);

    const tokensInWindow = this.recentRequests.reduce((sum, r) => sum + r.tokens, 0);
    if (tokensInWindow + pendingTokens <= TPM_CEILING) return;

    const oldest = this.recentRequests[0];
    if (!oldest) return;

    const sleepMs = oldest.timestamp - cutoff + 100;
    if (sleepMs > 0) {
      console.log(`[embed] TPM throttle: sleeping ${sleepMs}ms`);
      await new Promise(resolve => setTimeout(resolve, sleepMs));
    }

    return this.waitForCapacity(pendingTokens);
  }

  get dimension(): number {
    return EMBEDDING_DIMENSION;
  }
}
