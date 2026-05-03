![Node.js 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen) ![License: MIT](https://img.shields.io/badge/license-MIT-blue)

# forge

Self-hosted memory and chat infrastructure for building personal AI agents.

**99% retrieval hit rate on [LongMemEval](https://arxiv.org/abs/2410.10813). 95.6% on [LOCOMO](https://arxiv.org/abs/2402.17753). No GPU, no vector database, no embedding pipeline.** Just SQLite FTS5 running on whatever hardware you have lying around.

```
━━━ LongMemEval (500 entries) ━━━        ━━━ LOCOMO (1986 questions) ━━━
Hit rate:  99.0%                          Hit rate:  95.6%
MRR@10:    0.9167                         MRR@10:    0.7585
Time:      6.4s                           Time:      0.7s
```

## Why This Exists

Most agent memory systems are either cloud-locked SaaS, require a stack of infrastructure (Postgres, vector DB, embedding service), or just don't work well enough to trust with real context.

Forge is different: a single-process platform that runs on a NAS, a Raspberry Pi, or a retired laptop plugged into your router. The memory retrieval harness is benchmarked against published academic evals — not "it feels like it works" but actual hit rates on thousands of retrieval challenges. It scores 99% using only SQLite full-text search, which means retrieved context works without any external API calls, without internet access, and without burning money on embeddings.

The core is intentionally small. One directory, one config file, one process.

## Current Stance

Forge is not trying to be one more all-in-one hosted agent product. It is the base layer: memory, identity, chat surfaces, provider selection, and local persistence. The user decides what the agent is allowed to do on top of that base.

That distinction matters. Claude, Codex, OpenAI, Anthropic, and later local models are providers behind the same interface. Forge should not be conceptually tied to any single model vendor or CLI.

The current runtime is usable, but still hardening-stage software. It is good enough for personal infrastructure and active development; the remaining work is around migrations, runtime settings truth, Slack trust policy, Docker defaults, and deeper chat/context parity.

## What I Actually Use This For

I run an instance called Ember on local hardware plugged into my home network. Forge gives her persistent memory, identity, a web chat surface, and Slack access. Provider CLIs or APIs supply the model. Anything more powerful, such as file operations, network actions, or media management, is something the user deliberately layers on through their chosen provider and local setup.

## What This Is

A portable foundation for self-hosted agents. One directory, one config, one process — runs on anything with Node 22. Designed for low-power hardware: NAS boxes, old laptops, mini-PCs, Docker containers.

Each instance is a self-contained agent with:
- Long-term memory (FTS5 + optional vector search)
- Provider-backed LLM runtime: Claude CLI, Codex CLI, OpenAI API, or Anthropic API
- Slack integration (Bolt Socket Mode)
- Web UI (chat + settings)
- SQLite-backed memory, message history, and lifecycle schemas
- Three-file identity system (who the agent is, how it behaves, who it serves)

Want another agent? Copy the folder, change the config, start it on a different port. Each instance can have its own identity, memory, provider, model, and permission posture.

## What This Is Not

- Not a SaaS agent runtime.
- Not a hosted model provider.
- Not a promise that every provider is sandboxed the same way.
- Not yet a polished public release with migrations and every settings control fully wired.
- Not a replacement for user judgment about CLI permissions, local tools, or deployment exposure.

## How It Compares

| | **forge** | **MemGPT/Letta** | **Mem0** |
|---|---|---|---|
| LongMemEval hit rate | **99.0%** | ~75% (episodic recall) | — |
| LOCOMO hit rate | **95.6%** | — | ~91% (claimed) |
| Multi-hop reasoning | 75.0% | — | — |
| External services needed | None for memory; LLM provider for chat | PostgreSQL + vector DB | Cloud API |
| Embedding API required | No (optional) | Yes | Yes |
| Query latency (500 memories) | **0.4ms** | ~200ms | ~500ms |
| Deployment | Single process, SQLite | Multi-service | SaaS / self-host |
| Auth model | Provider-specific: CLI login or API key refs | API key | API key |

forge achieves 99% retrieval hit rate with zero external dependencies in the checked-in eval harness. The optional vector search (OpenAI embeddings) improves MRR and rescues semantic edge cases but isn't required.

## The Memory Thesis

Most memory systems reach for vector databases, embedding pipelines, and reranking models before asking whether full-text search solves the problem.

It usually does.

FTS5 with porter stemming handles morphological variation (running/ran/runs) without embeddings. The tokenizer does the heavy lifting that people assume requires a neural network. This system proves it: 495/500 LongMemEval challenges and 1898/1986 LOCOMO questions solved with keyword search alone.

The remaining failures require reasoning — multi-hop inference across sessions, counting entities, resolving relative dates. That's knowledge graph territory, not a retrieval problem. Vectors help at the margins; graphs solve the gap.

## Benchmark Results

### LongMemEval (ICLR 2025)

[LongMemEval](https://arxiv.org/abs/2410.10813) — 500 conversation sessions ingested, 500 questions asked.

| Category | Entries | FTS5 Hit Rate | Hybrid Hit Rate |
|----------|---------|---------------|-----------------|
| single-session-assistant | 56 | **100%** | **100%** |
| single-session-user | 70 | **100%** | **100%** |
| knowledge-update | 78 | **100%** | **100%** |
| multi-session | 133 | 99.2% | 99.2% |
| temporal-reasoning | 133 | 98.5% | 97.7% |
| single-session-preference | 30 | 93.3% | **96.7%** |

### LOCOMO (Snap Research)

[LOCOMO](https://arxiv.org/abs/2402.17753) — 10 conversations, 272 sessions, 5882 dialog turns, 1986 QA pairs.

| Category | Questions | Hit Rate | MRR |
|----------|-----------|----------|-----|
| open-domain | 841 | **98.0%** | 0.806 |
| adversarial | 446 | **96.9%** | 0.812 |
| temporal | 321 | 95.6% | 0.767 |
| single-hop | 282 | 93.3% | 0.630 |
| multi-hop | 96 | 75.0% | 0.445 |

Multi-hop is the weak spot — those questions require chaining facts across sessions where no keywords overlap. This is the problem a knowledge graph solves.

### Run the Benchmarks Yourself

```bash
# LongMemEval — FTS5 (~6 seconds)
node --experimental-strip-types eval/run-eval.ts eval/data/longmemeval_s_cleaned.json 10 500 fts

# LongMemEval — Hybrid (requires OPENAI_API_KEY, ~90 minutes)
node --experimental-strip-types eval/run-eval.ts eval/data/longmemeval_s_cleaned.json 10 500 hybrid

# LOCOMO — FTS5 (<1 second)
node --experimental-strip-types eval/run-locomo.ts eval/data/locomo10.json 10 9999 fts

# LOCOMO — Hybrid (requires OPENAI_API_KEY)
node --experimental-strip-types eval/run-locomo.ts eval/data/locomo10.json 10 9999 hybrid
```

Datasets: [LongMemEval repo](https://github.com/xiaowu0162/LongMemEval), [LOCOMO repo](https://github.com/snap-research/locomo). Place in `eval/data/` (gitignored — not redistributable).

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  forge                                                 │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Platform (singleton — boots everything)              │  │
│  └───────────┬───────────────────────────────────────────┘  │
│              │                                              │
│  ┌───────────┼───────────────────────────────────────────┐  │
│  │  Services │                                           │  │
│  │           │                                           │  │
│  │  ┌────────┴────────┐  ┌──────────┐  ┌────────────┐   │  │
│  │  │  MemoryService  │  │   LLM    │  │   Embed    │   │  │
│  │  │  (FTS5 + vec)   │  │ Provider │  │  (OpenAI)  │   │  │
│  │  └─────────────────┘  └──────────┘  └────────────┘   │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Interfaces                                           │  │
│  │                                                       │  │
│  │  ┌─────────────────┐  ┌─────────────────────────┐    │  │
│  │  │  Web UI (:6800) │  │  Slack (Socket Mode)    │    │  │
│  │  │  Chat + Settings│  │  Thread-aware, queued   │    │  │
│  │  └─────────────────┘  └─────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  SQLite Databases (6 core)                            │  │
│  │                                                       │  │
│  │  memory.db ── durable memories + FTS5 + vec0          │  │
│  │  messages.db ── chat surface messages + annotations   │  │
│  │  all.db ── documents + chunks + FTS5                  │  │
│  │  chat-history.db ── durable conversation capture      │  │
│  │  notepad.db ── topic notes, tags, pinned notes        │  │
│  │  logs.db ── issues + occurrences                      │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Identity (gitignored)                                │  │
│  │  IDENTITY.md — who the agent is                       │  │
│  │  SOUL.md — how the agent behaves                      │  │
│  │  USER.md — who the agent serves                       │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

Single process. SQLite for state. External services are optional except for whichever LLM provider you choose.

## Installation

### Prerequisites

- Node.js 22.6+ (Node 22 LTS is the supported runtime line; `.nvmrc` pins this repo to Node 22)
- One LLM provider: Claude Code CLI, Codex CLI, OpenAI API, or Anthropic API
- Git

### Quick Start

```bash
git clone https://github.com/Snootypants/forge.git
cd forge
npm ci
```

### Build

```bash
npm run typecheck   # TypeScript validation only
npm run build       # Typecheck, then emit dist/
npm run start:dist  # Run the compiled release artifact
```

### First Run

```bash
npm start
```

On first boot:
1. Creates SQLite databases in `./dbs/`
2. Generates a web auth token and saves it under `./logs/` if one is not configured
3. Starts the web UI on `http://127.0.0.1:6800` by default
4. Skips Slack if no tokens are configured (normal)

Open the web UI and configure auth via the Settings tab.

### Authentication Setup

#### LLM Provider

Forge is provider-backed. The default provider is `claude-cli`, but `codex-cli`, `openai-api`, and `anthropic-api` are also supported through the same chat/memory surface.

For Claude CLI, Forge prefers Claude Code's OAuth. You can also point `api.anthropic` at an environment variable when you intentionally want API-key auth.

From the Settings UI, click **"Authenticate Claude"** — this spawns `claude auth login` which opens a browser for the OAuth flow. Once authenticated, the credential lives in `~/.claude/` and the Claude CLI handles refresh.

Or from terminal:
```bash
claude auth login
```

For Codex CLI, authenticate the installed Codex CLI separately:

```bash
codex login
```

For API providers, set the matching key ref in `.env` or `forge.config.yaml`.

The selected provider is configured under `llm:`. CLI providers can run in `permission_mode: default` or `permission_mode: yolo`. `yolo` intentionally maps to the provider's full-power/no-sandbox mode where supported.

#### OpenAI (optional — enables vector search)

Adds semantic/vector search via `text-embedding-3-small`. Without it, the system runs FTS5-only at 99% accuracy.

From Settings UI: paste your OpenAI API key. It's written to `.env` with `chmod 600`.

Or manually:
```bash
echo "OPENAI_API_KEY=sk-..." >> .env
chmod 600 .env
```

#### Slack (optional — enables Slack agent)

Requires a Slack app with Socket Mode enabled:

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps)
2. Enable **Socket Mode** — generates an App-Level Token (`xapp-...`)
3. Add **Bot Token Scopes**: `chat:write`, `channels:history`, `channels:read`, `users:read`, `reactions:write`
4. Install to workspace — generates Bot Token (`xoxb-...`)
5. Invite the bot to channels it should monitor

From Settings UI: paste both tokens. Or:
```bash
echo "SLACK_BOT_TOKEN=xoxb-..." >> .env
echo "SLACK_APP_TOKEN=xapp-..." >> .env
chmod 600 .env
```

Restart forge after adding Slack tokens.

## Configuration

`forge.config.yaml` — the single config file:

```yaml
forge:
  name: my-agent        # agent name (shows in logs + Slack)
  version: "1.0.0"
  root: .

user:
  name: your-name       # who this agent serves

api:
  anthropic:
    env: ANTHROPIC_API_KEY    # optional API-key fallback / anthropic-api provider
  openai:
    env: OPENAI_API_KEY       # embeddings, openai-api provider, or Codex CLI env fallback
  slack:
    bot_token:
      env: SLACK_BOT_TOKEN
    app_token:
      env: SLACK_APP_TOKEN
    # bot_user_id and channels are optional.
    # bot_user_id is auto-detected on Slack connect.
    # By default Slack responds only in DMs or configured channel mentions.
    # Set channels: ["C0123ABC"] to allow a channel ID.
    # Set allow_all_channels: true only when every invited channel is trusted.
    bot_user_id: ""
    channels: []
    allow_all_channels: false
    require_mention: true
    allow_yolo: false

models:
  default: claude-sonnet-4-6    # daily driver
  architect: claude-opus-4-6    # complex reasoning
  sentinel: claude-haiku-4-5    # fast classification

llm:
  provider: claude-cli          # claude-cli | codex-cli | openai-api | anthropic-api
  model: claude-sonnet-4-6      # set a provider-appropriate model
  permission_mode: default      # default | yolo; CLI providers only

paths:
  dbs: ./dbs
  identity: ./identity
  logs: ./logs

services:
  web:
    port: 6800
    host: 127.0.0.1
    context_window_tokens: 80000
    debug_prompt_context: false
    # Optional. If omitted, forge uses FORGE_AUTH_TOKEN or a generated token
    # persisted in the resolved logs directory.
    # auth_token: "change-me"
  daemon:
    port: 6790

memory:
  retention_days: 30
  index_rebuild_interval_minutes: 15

budget:
  daily_limit_cents: 5000       # $50/day cap
  per_job_limit_cents: 1500     # $15/job cap
  warn_at_percent: 80
```

API keys can use `env:` references — they're read from environment variables or `.env` at runtime. Nothing sensitive lives in this file unless you intentionally set inline `value:` entries or `services.web.auth_token`.

Web auth token precedence is: `FORGE_AUTH_TOKEN`, then `services.web.auth_token`, then the persisted token file in the resolved logs directory. If none exists, forge generates a 32-byte token and writes it with `0600` permissions. Startup logs show the saved path, not the token value.

## Identity

The `identity/` directory (gitignored) contains three files that define your agent:

**`IDENTITY.md`** — who the agent is. Name, role, responsibilities, capabilities.

**`SOUL.md`** — how the agent behaves. Personality, communication style, values, behavioral directives.

**`USER.md`** — who the agent serves. The user's role, preferences, context the agent needs to work effectively.

All three are loaded in that order and injected as the system prompt for every LLM call. Web identity edits are reloaded for subsequent web chat turns. They're gitignored because each deployment is unique — the same codebase can host completely different agents.

On first run, forge generates starter templates for all three files. `USER.md` ships with a prompt telling the agent to ask the user about themselves and fill it out — the agent bootstraps its own context through conversation.

Example `identity/IDENTITY.md`:
```markdown
You are Ember, an AI agent managing a home network.
You have access to the local network, Plex, and file management.
```

Example `identity/SOUL.md`:
```markdown
You are direct, concise, and proactive.
You take action first and report after — don't ask permission for routine ops.
When something breaks, fix it before explaining what happened.
```

## Multi-Instance Deployment

Forge is designed for running multiple agents on the same machine:

```bash
# Agent 1: Ember (network management)
cp -r forge ~/agents/ember
cd ~/agents/ember
# Edit forge.config.yaml: name: ember, port: 6800
# Edit identity/IDENTITY.md: Ember's personality
npm start

# Agent 2: Atlas (research assistant)
cp -r forge ~/agents/atlas
cd ~/agents/atlas
# Edit forge.config.yaml: name: atlas, port: 6801
# Edit identity/IDENTITY.md: Atlas's personality
npm start
```

Each instance has its own:
- SQLite databases (completely isolated state)
- Identity files (different personality/purpose)
- Slack tokens (different Slack apps or shared)
- Web UI port
- Auth credentials

No shared state. No coordination required. They can coexist on the same box or different machines.

### Running as a Service (systemd)

```ini
[Unit]
Description=forge agent (%i)
After=network.target

[Service]
Type=simple
User=agent
WorkingDirectory=/home/agent/agents/%i
ExecStart=/home/agent/.nvm/versions/node/v22/bin/node dist/index.js --config /home/agent/agents/%i/forge.config.yaml
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=FORGE_WEB_HOST=127.0.0.1

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable forge@ember
sudo systemctl start forge@ember
```

### Running in Docker

```bash
docker build -t forge .
```

```bash
docker volume create forge-dbs forge-identity forge-logs

docker run -d \
  --name ember \
  -p 6800:6800 \
  --mount type=bind,src="$(pwd)/forge.config.yaml",dst=/config/forge.config.yaml,readonly \
  --mount type=volume,src=forge-dbs,dst=/app/dbs \
  --mount type=volume,src=forge-identity,dst=/app/identity \
  --mount type=volume,src=forge-logs,dst=/app/logs \
  --env-file .env \
  forge
```

The image builds `dist/` in a build stage and runs `node dist/index.js` with production dependencies only. It does not copy `forge.config.yaml`; mount the runtime config at `/config/forge.config.yaml`. Keep secrets in `.env` or in provider-owned CLI auth stores, and keep config key references as `env:` entries instead of inline key values.

`.dockerignore` excludes local databases, identity files, logs, `.env*`, `forge.config.yaml`, Claude credentials, editor files, and eval datasets so local state and secrets are not sent to the Docker build context.

Use named volumes for `dbs/`, `identity/`, and `logs/` so state, identity, and the generated web auth token persist across container rebuilds without host ownership surprises. If you intentionally bind-mount host directories instead, create them first and make them writable by the container user, which is UID/GID `1000:1000` in the base Node image:

```bash
mkdir -p dbs identity logs
sudo chown -R 1000:1000 dbs identity logs
```

The image sets `FORGE_CONFIG=/config/forge.config.yaml` and `FORGE_WEB_HOST=0.0.0.0` so a mounted config and `-p 6800:6800` work; local bare-metal runs still default to `127.0.0.1`.

### Health and Readiness

Forge exposes unauthenticated liveness and readiness endpoints for local supervisors and container health checks:

```bash
curl http://127.0.0.1:6800/healthz
curl http://127.0.0.1:6800/readyz
```

`/healthz` returns process liveness. `/readyz` checks opened SQLite handles and returns only `{ "ok": true }` or `503` with `{ "ok": false }`. Detailed database health is available through the authenticated Settings API.

## Memory API

```typescript
import Database from 'better-sqlite3';
import { MemoryService } from './src/services/memory.ts';
import { EmbedService } from './src/services/embed.ts';

// 1. Open database and apply schema
const db = new Database('./dbs/memory.db');
db.pragma('journal_mode = WAL');
db.exec(fs.readFileSync('./src/db/schemas/memory.sql', 'utf-8'));

// 2. Create memory service
const memory = new MemoryService(db);

// 3. (Optional) Enable vector search
const embed = new EmbedService(config.api.openai);  // honors configured OpenAI key refs
memory.initVec(embed);             // loads sqlite-vec, creates vec0 table

// Save a memory
const id = await memory.save({
  type: 'preference',
  content: 'User prefers dark roast coffee, specifically Ethiopian Yirgacheffe',
  tags: ['food', 'preferences'],
  importance: 0.8,
  confidence: 1.0,
});

// Search — FTS5 only (synchronous, fast)
const results = memory.search('coffee preference', 5);

// Search — hybrid FTS5 + vector (async, requires OpenAI key)
const results = await memory.searchHybrid('what kind of coffee do they like', 10);

// Update
memory.update(id, { importance: 0.9, tags: ['food', 'preferences', 'coffee'] });

// Supersede (old memory gets marked, new one created)
const newId = memory.supersede(oldId, {
  type: 'preference',
  content: 'User switched to light roast — prefers fruity Ethiopian naturals',
  tags: ['food', 'preferences'],
  importance: 0.8,
}, 'user corrected preference');

// Audit trail
const changes = memory.history(id);
// → [{ changeType: 'create', newContent: '...', changedAt: '...' }, ...]

// Stats
const stats = memory.stats();
// → { total: 142, active: 130, superseded: 10, archived: 2, vecEnabled: true }
```

### Memory Lifecycle

```
active ──→ superseded (replaced by newer memory, pointer maintained)
   │
   └────→ archived (no longer relevant, but kept for history)
```

`supersede()` preserves lifecycle history by marking the old memory and pointing it at the replacement. The current `/forget` command removes a memory from active storage and records delete history; changing `/forget` to archive instead of delete is on the hardening backlog.

### Write Policy

What to save as memories:

| Save | Skip |
|------|------|
| User preferences and corrections | Greetings, small talk |
| Decisions and their reasoning | Information already in code/docs |
| Facts the user shared about themselves | Duplicate of existing memory |
| Project context that won't be in git | Ephemeral task state |
| Corrections to prior beliefs (`supersede()`) | Same thing worded differently |

**Importance scoring:**
- `1.0` — user explicitly stated this, high confidence
- `0.8` — clear preference or correction
- `0.5` — normal conversational context
- `0.2` — ambient, might be useful someday

**Confidence scoring:**
- `1.0` — directly stated by user
- `0.7` — inferred from behavior
- `0.4` — speculative, needs confirmation

## How Retrieval Works

### The Conversation Cycle

```
Message in → Search memory → Build context → LLM response
```

On every incoming message (Slack or web), forge:

1. **Searches memory** using the message as the query
2. **Builds context** — identity + retrieved memories + available chat thread context
3. **Sends to the selected LLM provider**
4. **Responds** in the same channel/thread

Memory writes are currently explicit: use `/remember ...` in Slack or web chat to save a memory, and `/forget <memory-id>` to remove one. Automatic memory extraction/writeback and archive-first forgetting are planned runtime features, not active behavior.

### FTS5 Search

The user's message IS the query. FTS5 matches on the words they're using — stemmed via porter tokenizer so "running" matches "ran" and "runs".

Query sanitization: strips special characters, splits into words > 1 char, joins with `OR`. Natural language in, relevant memories out.

### Hybrid Search (FTS5 + Vector)

When `OPENAI_API_KEY` is set and `sqlite-vec` loads successfully:

1. Run FTS5 search → ranked results by BM25
2. Embed query via OpenAI `text-embedding-3-small` (1536 dims)
3. Run vec0 similarity search → ranked results by cosine distance
4. Merge via **Reciprocal Rank Fusion** (k=60):
   - Each result gets score `1/(k + rank)` from each list
   - Items appearing in both lists get summed scores (boosted)
   - Final ranking by combined score

RRF avoids the normalization problem — FTS5 BM25 scores and cosine distances live on different scales, but ranks are directly comparable.

### Why Not Vector-Only?

We tested it. Pure vector search scores ~90% on LongMemEval. FTS5 alone scores 99%. The reason: keyword matching on conversational text is already very precise. When someone asks "what coffee do I like?" and the memory contains "prefers dark roast coffee" — that's a keyword match, not a semantic inference.

Vectors help with the 1% where keywords fail: "recommend publications I'd find interesting" when the memory says "researches machine learning at Stanford." No keyword overlap, but semantically connected. That's where hybrid earns its keep.

## LLM Providers

The runtime calls a provider through `LLMService`; web and Slack do not know whether the backend is Claude CLI, Codex CLI, OpenAI API, or Anthropic API.

Supported providers:

| Provider | Path | Notes |
| --- | --- | --- |
| `claude-cli` | local subprocess | Uses `claude --print --output-format json`; `permission_mode: yolo` maps to Claude `bypassPermissions`. |
| `codex-cli` | local subprocess | Uses `codex exec`; `permission_mode: yolo` maps to `--dangerously-bypass-approvals-and-sandbox`. |
| `openai-api` | HTTPS API | Uses OpenAI Responses API; `permission_mode` does not apply. |
| `anthropic-api` | HTTPS API | Uses Anthropic Messages API; `permission_mode` does not apply. |

CLI providers may inherit local tool capabilities from their own CLIs and config. Forge makes that explicit through `permission_mode`; the user chooses the power/risk profile. Slack is conservative by default: DMs are allowed, channel replies require an explicit channel allowlist or `allow_all_channels`, channel mentions are required unless `require_mention: false`, and yolo-mode Slack replies require `allow_yolo: true`.

Forge does not yet expose a JSON-schema tool registry or SDK tool loop.

### Provider Stance

Forge owns the stable substrate:

- memory retrieval and storage
- identity files
- web and Slack chat surfaces
- message persistence
- provider selection and normalized responses

Providers own model behavior:

- model choice
- CLI vs API execution
- local tool access
- sandbox/permission behavior
- token usage reporting

That boundary is deliberate. Forge should stay useful whether the user prefers Claude, Codex, OpenAI API, Anthropic API, or a future local provider.

Built-in memory commands are handled before the LLM call:

```text
/remember The user prefers dark roast coffee.
/forget <memory-id>
```

Host tools such as shell commands, file operations, network checks, and third-party integrations should be added deliberately behind a scoped service boundary. User-facing Slack and web chat should not run with broad local tool permissions.

## Integrating With Other Systems

### As a Memory Backend

Use the memory service standalone in any Node.js application:

```typescript
import Database from 'better-sqlite3';
import fs from 'node:fs';
import { MemoryService } from 'forge/src/services/memory.ts';

const db = new Database('./my-app.db');
db.exec(fs.readFileSync('path/to/forge/src/db/schemas/memory.sql', 'utf-8'));
const memory = new MemoryService(db);

// Your app's memory layer — 99% retrieval accuracy out of the box
```

### Pairing With Other Agents

Forge instances communicate via Slack (shared channels) or direct HTTP:

```bash
# Agent A posts to a shared channel → Agent B picks it up via Slack listener
# Both agents have their own memory, identity, and context

# Or hit the messages API directly:
curl -X POST http://localhost:6800/api/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "What do you know about the network config?"}'
```

### Multi-Agent Topologies

**Shared Slack workspace** — simplest. All agents in the same workspace, different channels or mentions to route:
```
User → #general → Ember picks up
User → #research → Atlas picks up
Ember → #agent-ops → Atlas sees it (inter-agent communication)
```

**HTTP mesh** — agents call each other's APIs directly:
```
Ember (network) ←→ Atlas (research) ←→ Scribe (documentation)
Each has its own port, identity, and memory
```

**Hub and spoke** — one coordinator agent dispatches to specialists:
```
Coordinator (:6800) → Ember (:6801) for network tasks
                    → Atlas (:6802) for research tasks
                    → Scribe (:6803) for documentation
```

## Deployment Targets

Tested and designed for:

| Platform | Notes |
|----------|-------|
| **ZimaOS** | Docker or host OS. Shares disk pool with NAS. |
| **macOS** | Bare metal. Good for development. |
| **Ubuntu/Debian** | systemd service. Production recommendation. |
| **Docker** | Any host. Mount volumes for persistence. |
| **Raspberry Pi 4/5** | Node 22 ARM builds available. Runs fine. |

### Hardware Requirements

- **Minimum:** 1GB RAM, 1 core, 500MB disk
- **Recommended:** 2GB RAM, 2 cores, 2GB disk
- **With vector search:** Add ~100MB RAM for sqlite-vec + embedding cache

SQLite runs entirely in-process. No database server. No ports to manage beyond the web UI.

## Project Structure

```
forge/
├── src/
│   ├── index.ts              # entry point — boots platform, starts servers
│   ├── platform.ts           # singleton — DB init, service init, identity load
│   ├── config.ts             # YAML config loader + .env management
│   ├── types.ts              # Zod schemas + TypeScript types
│   ├── auth/
│   │   └── oauth.ts          # provider, Slack, and OpenAI key helpers
│   ├── db/
│   │   ├── manager.ts        # opens/closes core runtime databases
│   │   └── schemas/          # SQL schema files
│   ├── services/
│   │   ├── memory.ts         # FTS5 + hybrid search + lifecycle
│   │   ├── llm.ts            # provider-backed LLM service
│   │   ├── llm/              # Claude CLI, Codex CLI, OpenAI API, Anthropic API providers
│   │   └── embed.ts          # OpenAI embeddings + TPM throttling
│   ├── slack/
│   │   ├── listener.ts       # Bolt Socket Mode + thread queuing
│   │   └── context.ts        # context builder for LLM calls
│   └── web/
│       ├── server.ts         # Express + auth middleware
│       ├── routes/           # settings, messages, auth APIs
│       └── public/           # frontend (HTML/JS/CSS)
├── eval/
│   ├── run-eval.ts           # LongMemEval eval harness
│   ├── run-locomo.ts         # LOCOMO eval harness
│   ├── baselines/            # saved benchmark results
│   └── data/                 # eval datasets (gitignored)
├── identity/                 # IDENTITY.md + SOUL.md + USER.md (gitignored)
├── dbs/                      # SQLite databases (gitignored)
├── forge.config.yaml         # main configuration
└── .env                      # secrets (gitignored, chmod 600)
```

## Security Model

- **No raw API keys in code** — prefer provider login or `env:` key refs; keep raw keys in `.env` with `chmod 600`
- **Web UI auth** — bearer token (generated on first boot) or HttpOnly cookie, timing-safe comparison
- **Identity files gitignored** — agent personality and user context never leave the box
- **Database files gitignored** — all runtime state stays local
- **Slack Socket Mode** — no inbound webhooks, no public URLs needed

## License

MIT
