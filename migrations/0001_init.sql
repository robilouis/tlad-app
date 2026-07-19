-- Progress store: one JSON blob per user, keyed by the Cloudflare Access email.
CREATE TABLE IF NOT EXISTS progress (
  user_id    TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
