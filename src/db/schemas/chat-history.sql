CREATE TABLE IF NOT EXISTS conversations (
  uuid TEXT PRIMARY KEY,
  name TEXT,
  summary TEXT,
  created_at TEXT,
  updated_at TEXT,
  message_count INTEGER
);

CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_uuid TEXT NOT NULL,
  chunk_text TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  start_message_idx INTEGER NOT NULL DEFAULT 0,
  end_message_idx INTEGER NOT NULL DEFAULT 0,
  timestamp_start TEXT,
  timestamp_end TEXT,
  embedding BLOB,
  FOREIGN KEY (conversation_uuid) REFERENCES conversations(uuid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chunks_conv ON chunks(conversation_uuid);
CREATE INDEX IF NOT EXISTS idx_chunks_timestamp_start ON chunks(timestamp_start);

DROP TRIGGER IF EXISTS chunks_conversation_delete;

CREATE TRIGGER chunks_conversation_delete AFTER DELETE ON conversations BEGIN
  DELETE FROM chunks WHERE conversation_uuid = old.uuid;
END;
