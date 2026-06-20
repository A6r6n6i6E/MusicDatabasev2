CREATE TABLE IF NOT EXISTS albums (
  id TEXT PRIMARY KEY,
  album_key TEXT NOT NULL UNIQUE,
  album TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_albums_created_at ON albums(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_albums_updated_at ON albums(updated_at DESC);
