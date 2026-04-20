![Node.js 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen) ![License: MIT](https://img.shields.io/badge/license-MIT-blue)

# forge

A portable agent platform with a memory system that scores **99% on LongMemEval** and **95.6% on LOCOMO** — using nothing but SQLite FTS5.

No GPU. No vector database. No embedding pipeline required.

```
━━━ LongMemEval (500 entries) ━━━        ━━━ LOCOMO (1986 questions) ━━━
Hit rate:  99.0%                          Hit rate:  95.6%
MRR@10:    0.9167                         MRR@10:    0.7585
Time:      6.4s                           Time:      0.7s
```

## What This Is

A complete, single-process agent hosting platform. One directory, one config, one process — runs on anything with Node 22. Designed for low-power hardware: NAS boxes, old laptops, mini-PCs.

Each instance is a self-contained agent with:
- Long-term memory (FTS5 + optional vector search)
- Claude LLM via OAuth (no raw API keys — Claude Code SDK)
- Slack integration (Bolt Socket Mode)
- Web UI (chat + settings)
- 8 SQLite databases covering the full agent lifecycle

Want another agent? Copy the folder, change the config, start it on a different port.

## How It Compares

| | **forge** | **MemGPT/Letta** | **Mem0** |
|---|---|---|---|
| LongMemEval hit rate | **99.0%** | ~75% (episodic recall) | — |
| LOCOMO hit rate | **95.6%** | — | ~91% (claimed) |
| Multi-hop reasoning | 75.0% | — | — |
| External services needed | None | PostgreSQL + vector DB | Cloud API |
| Embedding API required | No (optional) | Yes | Yes |
| Query latency (500 memories) | **0.4ms** | ~200ms | ~500ms |
| Deployment | Single process, SQLite | Multi-service | SaaS / self-host |
| Auth model | OAuth (no raw keys) | API key | API key |

forge achieves 99% retrieval accuracy with zero external dependencies. The optional vector search (OpenAI embeddings) improves MRR and rescues semantic edge cases but isn't required.

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
│  │  │  (FTS5 + vec)   │  │  (OAuth) │  │  (OpenAI)  │   │  │
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
│  │  SQLite Databases (8)                                 │  │
│  │                                                       │  │
│  │  memory.db ── memories + FTS5 index + vec0 vectors    │  │
│  │  messages.db ── message history + annotations         │  │
│  │  all.db ── documents + chunks + FTS5                  │  │
│  │  anvil.db ── jobs, budgets, agent runs                │  │
│  │  agent-events.db ── conversations, retrieval runs     │  │
│  │  chat-history.db ── conversation threads              │  │
│  │  knowledge.db ── knowledge base entries               │  │
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

~2100 lines of TypeScript. Single process. Zero external services required (everything optional degrades gracefully).

## Installation

### Prerequisites

- Node.js 22+ (minimum — 24 LTS or later recommended)
- Claude Code CLI (`npm install -g @anthropic-ai/claude-code`)
- Git

### Quick Start

```bash
git clone https://github.com/Snootypants/forge.git
cd forge
npm install
```

### First Run

```bash
npm start
```

On first boot:
1. Creates all 8 SQLite databases in `./dbs/`
2. Generates a random auth token (printed to console — save it)
3. Starts the web UI on `http://0.0.0.0:6800`
4. Skips Slack if no tokens are configured (normal)

Open the web UI and configure auth via the Settings tab.

### Authentication Setup

#### Claude (required for LLM features)

Forge uses Claude Code's OAuth — no raw `ANTHROPIC_API_KEY` ever touches this system. Auth flows through the Claude Code SDK, which manages the subscription OAuth token.

From the Settings UI, click **"Authenticate Claude"** — this spawns `claude auth login` which opens a browser for the OAuth flow. Once authenticated, the credential lives in `~/.claude/` and the SDK handles refresh.

Or from terminal:
```bash
claude auth login
```

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
    env: ANTHROPIC_API_KEY    # managed by OAuth — don't set manually
  openai:
    env: OPENAI_API_KEY       # read from .env
  slack:
    bot_token:
      env: SLACK_BOT_TOKEN
    app_token:
      env: SLACK_APP_TOKEN
    # bot_user_id and channels are optional — leave empty for defaults.
    # bot_user_id is auto-detected on Slack connect.
    # channels: [] means the bot responds in ALL channels it's invited to.
    # Set channels: ["C0123ABC"] to restrict to specific channel IDs.
    bot_user_id: ""
    channels: []

models:
  default: claude-sonnet-4-6    # daily driver
  architect: claude-opus-4-6    # complex reasoning
  sentinel: claude-haiku-4-5    # fast classification

paths:
  dbs: ./dbs
  identity: ./identity
  logs: ./logs

services:
  web:
    port: 6800
  daemon:
    port: 6790

budget:
  daily_limit_cents: 5000       # $50/day cap
  per_job_limit_cents: 1500     # $15/job cap
  warn_at_percent: 80
```

All API keys use `env:` references — they're read from environment variables or `.env` at runtime. Nothing sensitive lives in this file.

## Identity

The `identity/` directory (gitignored) contains three files that define your agent:

**`IDENTITY.md`** — who the agent is. Name, role, responsibilities, capabilities.

**`SOUL.md`** — how the agent behaves. Personality, communication style, values, behavioral directives.

**`USER.md`** — who the agent serves. The user's role, preferences, context the agent needs to work effectively.

All three are loaded at boot (in that order) and injected as the system prompt for every LLM call. They're gitignored because each deployment is unique — the same codebase can host completely different agents.

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
ExecStart=/home/agent/.nvm/versions/node/v22/bin/node --experimental-strip-types src/index.ts
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable forge@ember
sudo systemctl start forge@ember
```

### Running in Docker

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p dbs logs
EXPOSE 6800
CMD ["node", "--experimental-strip-types", "src/index.ts"]
```

```bash
docker run -d \
  --name ember \
  -p 6800:6800 \
  -v ./dbs:/app/dbs \
  -v ./identity:/app/identity \
  -v ./logs:/app/logs \
  --env-file .env \
  forge
```

Mount `dbs/` and `identity/` as volumes so state persists across container rebuilds.

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
const embed = new EmbedService();  // reads OPENAI_API_KEY from env
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

Memories are never deleted in normal operation — they transition states. The full mutation history is preserved in `memory_history`.

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
Message in → Search memory → Build context → LLM response → Save what matters
```

On every incoming message (Slack or web), forge:

1. **Searches memory** using the message as the query
2. **Builds context** — identity + retrieved memories + thread history
3. **Sends to Claude** via the Claude Code SDK (OAuth, no raw key)
4. **Responds** in the same channel/thread
5. **Saves** meaningful information back as memories

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

## Adding Tools

The LLM service wraps the Claude Code SDK, which supports tool use natively. Tools extend what the agent can do beyond conversation — file access, API calls, system commands.

### Defining Tools

Tools are defined as JSON schemas and passed to the SDK at query time. The SDK handles the tool-use loop (Claude requests a tool call → you execute it → return results → Claude continues):

```typescript
import { query } from '@anthropic-ai/claude-code';

const tools = [
  {
    name: 'check_server_status',
    description: 'Check if a server on the local network is responding',
    input_schema: {
      type: 'object',
      properties: {
        hostname: { type: 'string', description: 'Hostname or IP to check' },
        port: { type: 'number', description: 'Port number (default 80)' },
      },
      required: ['hostname'],
    },
  },
];

const messages = await query({
  prompt: userMessage,
  systemPrompt: identity,
  tools,
  toolHandler: async (toolName, input) => {
    if (toolName === 'check_server_status') {
      // Execute the tool and return result
      const alive = await ping(input.hostname, input.port ?? 80);
      return { status: alive ? 'up' : 'down', hostname: input.hostname };
    }
    return { error: 'Unknown tool' };
  },
});
```

### Tool Patterns

**System tools** — network checks, file operations, process management:
```typescript
{ name: 'run_command', description: 'Execute a shell command on the host' }
{ name: 'read_file', description: 'Read a file from the filesystem' }
{ name: 'list_network_devices', description: 'Scan local network for active devices' }
```

**Memory tools** — let the agent manage its own memory:
```typescript
{ name: 'remember', description: 'Save something important to long-term memory' }
{ name: 'recall', description: 'Search memory for relevant context' }
{ name: 'forget', description: 'Archive or supersede an outdated memory' }
```

**Integration tools** — connect to external services:
```typescript
{ name: 'plex_search', description: 'Search the Plex media library' }
{ name: 'home_assistant', description: 'Control smart home devices' }
{ name: 'send_notification', description: 'Send a push notification' }
```

Tools are registered per-agent via the identity or a tools config file. Each forge instance can have a completely different toolset — one agent manages media, another handles network ops, another does research.

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
│   │   └── oauth.ts          # Claude OAuth, Slack/OpenAI key management
│   ├── db/
│   │   ├── manager.ts        # opens/closes all 8 databases
│   │   └── schemas/          # 8 SQL schema files
│   ├── services/
│   │   ├── memory.ts         # FTS5 + hybrid search + lifecycle
│   │   ├── llm.ts            # Claude Code SDK wrapper (OAuth)
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

- **No raw API keys in code or config** — Claude auth via OAuth, other keys in `.env` with `chmod 600`
- **Web UI auth** — bearer token (generated on first boot) or HttpOnly cookie, timing-safe comparison
- **Identity files gitignored** — agent personality and user context never leave the box
- **Database files gitignored** — all runtime state stays local
- **Slack Socket Mode** — no inbound webhooks, no public URLs needed

## License

MIT
