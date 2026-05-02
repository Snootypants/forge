CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  channelName TEXT,
  user TEXT,
  userName TEXT,
  text TEXT NOT NULL DEFAULT '',
  ts TEXT NOT NULL,
  threadTs TEXT,
  mentioned INTEGER DEFAULT 0,
  receivedAt INTEGER NOT NULL,
  prompt_context TEXT,
  llm_metadata TEXT,
  subtype TEXT
);

CREATE TABLE IF NOT EXISTS annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL,
  annotation_type TEXT NOT NULL CHECK(annotation_type IN ('note', 'pin', 'flag', 'bookmark')),
  content TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages (channel);
CREATE INDEX IF NOT EXISTS idx_messages_receivedAt ON messages (receivedAt DESC);
CREATE INDEX IF NOT EXISTS idx_annotations_message ON annotations(message_id);
CREATE INDEX IF NOT EXISTS idx_annotations_type ON annotations(annotation_type);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  text,
  userName,
  channelName,
  id,
  channel,
  ts,
  receivedAt
);

DROP TRIGGER IF EXISTS messages_fts_insert;
DROP TRIGGER IF EXISTS messages_fts_delete;
DROP TRIGGER IF EXISTS messages_fts_update;

CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(text, userName, channelName, id, channel, ts, receivedAt)
  VALUES (new.text, new.userName, new.channelName, new.id, new.channel, new.ts, new.receivedAt);
END;

CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
  DELETE FROM messages_fts WHERE id = old.id;
END;

CREATE TRIGGER messages_fts_update AFTER UPDATE ON messages BEGIN
  DELETE FROM messages_fts WHERE id = old.id;
  INSERT INTO messages_fts(text, userName, channelName, id, channel, ts, receivedAt)
  VALUES (new.text, new.userName, new.channelName, new.id, new.channel, new.ts, new.receivedAt);
END;
