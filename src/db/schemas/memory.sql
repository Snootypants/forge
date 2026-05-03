CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'superseded', 'archived')),
  confidence REAL NOT NULL DEFAULT 1.0 CHECK(confidence >= 0.0 AND confidence <= 1.0),
  importance REAL NOT NULL DEFAULT 0.5 CHECK(importance >= 0.0 AND importance <= 1.0),
  accessCount INTEGER NOT NULL DEFAULT 0,
  created TEXT NOT NULL,
  updated TEXT NOT NULL,
  supersededBy TEXT,
  FOREIGN KEY (supersededBy) REFERENCES memories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS memory_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK(change_type IN ('create', 'update', 'delete', 'supersede')),
  old_content TEXT,
  old_status TEXT,
  old_confidence REAL,
  old_tags TEXT,
  new_content TEXT,
  new_status TEXT,
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  changed_by TEXT DEFAULT 'system',
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_memories_type ON memories (type);
CREATE INDEX IF NOT EXISTS idx_memories_status ON memories (status);
CREATE INDEX IF NOT EXISTS idx_memories_type_status ON memories (type, status);
CREATE INDEX IF NOT EXISTS idx_history_memory ON memory_history(memory_id);
CREATE INDEX IF NOT EXISTS idx_history_type ON memory_history(change_type);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  id,
  content,
  tags,
  tokenize='porter'
);
