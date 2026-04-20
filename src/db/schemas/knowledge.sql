CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  problem TEXT NOT NULL,
  solution TEXT NOT NULL,
  root_cause TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  context TEXT,
  created TEXT NOT NULL DEFAULT (datetime('now')),
  updated TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tags ON entries(tags);
CREATE INDEX IF NOT EXISTS idx_created ON entries(created);
