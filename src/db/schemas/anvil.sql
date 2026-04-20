CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  agent TEXT,
  workspace TEXT,
  prompt TEXT,
  result TEXT,
  retry_count INTEGER DEFAULT 0,
  last_error TEXT,
  retry_after TEXT,
  source_type TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cost_budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL DEFAULT 'global',
  daily_limit_cents INTEGER NOT NULL DEFAULT 5000,
  per_job_limit_cents INTEGER NOT NULL DEFAULT 1500,
  alert_threshold_percent INTEGER NOT NULL DEFAULT 80,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cost_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  cost_cents REAL NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT,
  session_id TEXT,
  agent_name TEXT NOT NULL,
  source TEXT NOT NULL,
  workspace TEXT,
  project_slug TEXT,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cost_cents REAL NOT NULL DEFAULT 0,
  bucket_5h_resets_at INTEGER,
  bucket_7d_resets_at INTEGER,
  started_at INTEGER NOT NULL,
  completed_at INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS subscription_usage_log (
  ts INTEGER PRIMARY KEY,
  five_hour_pct REAL NOT NULL,
  five_hour_resets_at INTEGER NOT NULL,
  seven_day_pct REAL NOT NULL,
  seven_day_resets_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scratchpad (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'system',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (namespace, key)
);

CREATE INDEX IF NOT EXISTS idx_cost_records_job_id ON cost_records (job_id);
CREATE INDEX IF NOT EXISTS idx_cost_records_recorded_at ON cost_records (recorded_at);
CREATE INDEX IF NOT EXISTS idx_ar_started ON agent_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_ar_agent ON agent_runs(agent_name);
CREATE INDEX IF NOT EXISTS idx_ar_workspace ON agent_runs(workspace);
CREATE INDEX IF NOT EXISTS idx_ar_project ON agent_runs(project_slug);
CREATE INDEX IF NOT EXISTS idx_sul_ts ON subscription_usage_log(ts);
CREATE INDEX IF NOT EXISTS idx_scratchpad_namespace ON scratchpad (namespace);
