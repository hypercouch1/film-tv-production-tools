-- D1 schema for the Production Hub server.
-- Apply with: npm run db:init (remote) or npm run db:init:local (local dev)

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  pw          TEXT NOT NULL,          -- pbkdf2$<iterations>$<salt b64>$<hash b64>
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,       -- SHA-256 of the bearer token; the token itself is never stored
  user_id     TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,          -- 'callsheet' | 'shotsheet'
  title       TEXT NOT NULL,
  owner_id    TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  project_id  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  role        TEXT NOT NULL,          -- 'owner' | 'editor' | 'viewer'
  added_at    INTEGER NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS members_user ON members(user_id);

-- Failed sign-in attempts per email, for basic brute-force protection.
CREATE TABLE IF NOT EXISTS auth_failures (
  email        TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
