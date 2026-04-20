# Memory Eval Baselines

---

## LOCOMO (1986 questions, top-K=10)

Benchmark: [LoCoMo](https://arxiv.org/abs/2402.17753) (Snap Research)
10 conversations, 272 sessions, 5882 dialog turns, 1986 QA pairs.

### 2026-04-20 — FTS5 Only
- **Hit rate: 95.6%** (1898/1986)
- **MRR@10: 0.7585**
- Time: 0.7s (0.4ms/question)

| Category | Total | Hits | Rate | MRR |
|---|---|---|---|---|
| open-domain | 841 | 824 | 98.0% | 0.8055 |
| adversarial | 446 | 432 | 96.9% | 0.8123 |
| temporal | 321 | 307 | 95.6% | 0.7673 |
| single-hop | 282 | 263 | 93.3% | 0.6303 |
| multi-hop | 96 | 72 | 75.0% | 0.4448 |

### Failures Analysis (88 total)
- **Multi-hop (24 failures):** require chaining facts across sessions — no keyword overlap between query and evidence. Knowledge graph territory.
- **Single-hop (19 failures):** implicit references ("her relationship status" when the session discusses a specific partner without using the word "relationship")
- **Temporal (14 failures):** relative time references or duration calculations
- **Open-domain (17 failures):** need world knowledge + conversation context
- **Adversarial (14 failures):** intentionally misleading questions

### Key Takeaway
Multi-hop is the clear weak spot (75%). These require entity-relationship traversal — connecting "LGBTQ support group" + "social justice advocacy" to infer "progressive political leaning." This is knowledge graph work, not search.

---

## LongMemEval (500 entries, top-K=10)

## 2026-04-20 — Initial Baseline

### FTS5 Only
- **Hit rate: 99.0%** (495/500)
- **MRR@10: 0.9167**
- Time: 6.4s (12.8ms/entry)

| Type | Total | Hits | Rate | MRR |
|---|---|---|---|---|
| single-session-assistant | 56 | 56 | 100.0% | 1.0000 |
| single-session-user | 70 | 70 | 100.0% | 0.9348 |
| knowledge-update | 78 | 78 | 100.0% | 0.9808 |
| multi-session | 133 | 132 | 99.2% | 0.9430 |
| temporal-reasoning | 133 | 131 | 98.5% | 0.8647 |
| single-session-preference | 30 | 28 | 93.3% | 0.6659 |

### Hybrid (FTS5 + OpenAI text-embedding-3-small + RRF k=60)
- **Hit rate: 99.0%** (495/500)
- **MRR@10: 0.9332**
- Time: 5236.5s (10.5s/entry)

| Type | Total | Hits | Rate | MRR |
|---|---|---|---|---|
| single-session-assistant | 56 | 56 | 100.0% | 1.0000 |
| single-session-user | 70 | 70 | 100.0% | 0.9347 |
| knowledge-update | 78 | 78 | 100.0% | 0.9872 |
| multi-session | 133 | 132 | 99.2% | 0.9574 |
| temporal-reasoning | 133 | 130 | 97.7% | 0.8856 |
| single-session-preference | 30 | 29 | 96.7% | 0.7684 |

### Failures (5)
1. **[preference]** "high school reunion" — requires connecting nostalgia to personal history
2. **[multi-session]** "total siblings" — requires counting across multiple sessions
3. **[temporal]** "lunch last Tuesday" — requires date arithmetic
4. **[temporal]** "investment four weeks ago" — requires date arithmetic
5. **[temporal]** "kitchen appliance 10 days ago" — requires date arithmetic

### Key Takeaways
- Hybrid improved MRR by +0.018 (results rank higher)
- Hybrid rescued 1 preference failure, lost 1 temporal (net even on hit rate)
- Remaining 5 failures all require reasoning (date math, counting) not retrieval
- FTS5 alone is 99% — the memory schema + FTS5 tokenizer does heavy lifting
