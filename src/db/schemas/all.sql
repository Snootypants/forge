CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSON,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT,
  UNIQUE(source, source_id)
);

CREATE TABLE IF NOT EXISTS document_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  start_char INTEGER NOT NULL,
  end_char INTEGER NOT NULL,
  UNIQUE(document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source);
CREATE INDEX IF NOT EXISTS idx_documents_updated ON documents(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_chunks_doc ON document_chunks(document_id);

CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  source,
  content,
  source_id UNINDEXED,
  tokenize='porter'
);

DROP TRIGGER IF EXISTS documents_fts_insert;
DROP TRIGGER IF EXISTS documents_fts_delete;
DROP TRIGGER IF EXISTS documents_fts_update;

CREATE TRIGGER documents_fts_insert AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(rowid, source, content, source_id)
  VALUES (new.id, new.source, new.content, new.source_id);
END;

CREATE TRIGGER documents_fts_delete AFTER DELETE ON documents BEGIN
  DELETE FROM documents_fts WHERE rowid = old.id;
END;

CREATE TRIGGER documents_fts_update AFTER UPDATE ON documents BEGIN
  DELETE FROM documents_fts WHERE rowid = old.id;
  INSERT INTO documents_fts(rowid, source, content, source_id)
  VALUES (new.id, new.source, new.content, new.source_id);
END;
