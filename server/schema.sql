-- D1 schema for the Production Tools server.
-- Apply with: npm run db:init (remote) or npm run db:init:local (local dev)

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  pw          TEXT NOT NULL,          -- pbkdf2$<iterations>$<salt b64>$<hash b64>
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER,                -- for usage stats (updated at most once an hour)
  app_version TEXT,                   -- the app version they last used
  disabled    INTEGER NOT NULL DEFAULT 0
);

-- One-time password codes (see migrations/0004_admin.sql).
CREATE TABLE IF NOT EXISTS reset_codes (
  code_hash   TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);
CREATE INDEX IF NOT EXISTS reset_codes_user ON reset_codes(user_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,       -- SHA-256 of the bearer token; the token itself is never stored
  user_id     TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,          -- 'shotsheet' (a production) | 'script' | 'callsheet'
  title       TEXT NOT NULL,
  owner_id    TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  parent_id   TEXT,                   -- the production a script / call sheet belongs to
  info        TEXT                    -- JSON for lists: { type, episodeId }
);
CREATE INDEX IF NOT EXISTS projects_parent ON projects(parent_id);

CREATE TABLE IF NOT EXISTS members (
  project_id  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  role        TEXT NOT NULL,          -- 'owner' | 'editor' | 'viewer'
  added_at    INTEGER NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS members_user ON members(user_id);

-- Personal availability links (see migrations/0003_availability.sql).
CREATE TABLE IF NOT EXISTS availability_links (
  code_hash    TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL,
  person_id    TEXT NOT NULL,
  name         TEXT NOT NULL,
  role         TEXT NOT NULL,
  start_date   TEXT NOT NULL,
  end_date     TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  responded_at INTEGER
);
CREATE INDEX IF NOT EXISTS availability_project ON availability_links(project_id, person_id);

-- Failed sign-in attempts per email, for basic brute-force protection.
CREATE TABLE IF NOT EXISTS auth_failures (
  email        TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
