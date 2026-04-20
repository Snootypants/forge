CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  external_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('chat', 'thread', 'task', 'ops', 'research', 'system')),
  source TEXT NOT NULL CHECK (source IN ('slack', 'anvil', 'terminal', 'ios', 'worker', 'system')),
  title TEXT,
  parent_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS actors (
  id TEXT PRIMARY KEY,
  external_key TEXT UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('user', 'agent', 'worker', 'tool', 'system')),
  source TEXT NOT NULL CHECK (source IN ('slack', 'anvil', 'terminal', 'ios', 'worker', 'system')),
  label TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  parent_event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
  actor_id TEXT NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('message', 'tool_call', 'tool_result', 'system', 'status', 'reaction', 'edit', 'delete')
  ),
  source TEXT NOT NULL CHECK (source IN ('slack', 'anvil', 'terminal', 'ios', 'worker', 'system')),
  source_event_id TEXT,
  channel_key TEXT,
  text TEXT,
  payload_json TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  edited_at TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS retrieval_runs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  trigger_event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
  query_kind TEXT NOT NULL CHECK (query_kind IN ('reply', 'search', 'debug', 'recovery', 'memory', 'knowledge')),
  prompt_profile TEXT NOT NULL CHECK (prompt_profile IN ('default', 'debug', 'ops', 'task', 'research')),
  backend TEXT NOT NULL,
  query_text TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS retrieval_hits (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES retrieval_runs(id) ON DELETE CASCADE,
  section TEXT NOT NULL CHECK (
    section IN ('recent_events', 'semantic_events', 'durable_memory', 'knowledge', 'live_state')
  ),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('event', 'memory', 'knowledge', 'state')),
  source_id TEXT,
  rank_order INTEGER NOT NULL,
  score REAL,
  included INTEGER NOT NULL DEFAULT 1 CHECK (included IN (0, 1)),
  tokens_est INTEGER,
  reason TEXT,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS prompt_builds (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE REFERENCES retrieval_runs(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  prompt_profile TEXT NOT NULL CHECK (prompt_profile IN ('default', 'debug', 'ops', 'task', 'research')),
  recent_events_tokens INTEGER NOT NULL DEFAULT 0,
  semantic_events_tokens INTEGER NOT NULL DEFAULT 0,
  durable_memory_tokens INTEGER NOT NULL DEFAULT 0,
  knowledge_tokens INTEGER NOT NULL DEFAULT 0,
  live_state_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens_est INTEGER NOT NULL DEFAULT 0,
  total_chars INTEGER NOT NULL DEFAULT 0,
  build_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_conversations_kind ON conversations(kind);
CREATE INDEX IF NOT EXISTS idx_conversations_source ON conversations(source);
CREATE INDEX IF NOT EXISTS idx_events_conversation ON events(conversation_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_actor ON events(actor_id);
CREATE INDEX IF NOT EXISTS idx_retrieval_runs_conversation ON retrieval_runs(conversation_id);
CREATE INDEX IF NOT EXISTS idx_retrieval_hits_run ON retrieval_hits(run_id);
