PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS editions (
  date TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  curated_at TEXT NOT NULL,
  timezone TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  edition_date TEXT NOT NULL REFERENCES editions(date) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  source TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  publication_date TEXT
);

CREATE INDEX IF NOT EXISTS items_edition_date_idx ON items(edition_date);

CREATE TABLE IF NOT EXISTS votes (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  visitor_hash TEXT NOT NULL,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (item_id, visitor_hash)
);

CREATE INDEX IF NOT EXISTS votes_updated_at_idx ON votes(updated_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  ip_hash TEXT NOT NULL,
  bucket_start INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 1),
  PRIMARY KEY (ip_hash, bucket_start)
);

CREATE INDEX IF NOT EXISTS rate_limits_bucket_start_idx ON rate_limits(bucket_start);
