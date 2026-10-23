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
  disabled    INTEGER NOT NULL DEFAULT 0,
  totp_secret TEXT,                   -- admins: authenticator app key (two-step sign-in)
  totp_pending TEXT,                  -- a key being set up, until its first code is entered
  totp_last   INTEGER                 -- the last code's time step (a code works once)
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
  expires_at  INTEGER NOT NULL,
  admin_at    INTEGER                 -- when an admin entered their authenticator code on it
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

-- Personal crew pages, call sheets sent, "Got it", continuity photos, the admin log and
-- backups (see migrations/0005_crew_backups.sql).
CREATE TABLE IF NOT EXISTS crew_links (
  code_hash   TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  person_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  opened_at   INTEGER
);
CREATE INDEX IF NOT EXISTS crew_links_project ON crew_links(project_id, person_id);
CREATE TABLE IF NOT EXISTS sheet_sends (
  project_id  TEXT NOT NULL,
  day_id      TEXT NOT NULL,
  sent_at     INTEGER NOT NULL,
  sent_by     TEXT,
  PRIMARY KEY (project_id, day_id)
);
CREATE TABLE IF NOT EXISTS sheet_confirms (
  project_id   TEXT NOT NULL,
  day_id       TEXT NOT NULL,
  person_id    TEXT NOT NULL,
  confirmed_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, day_id, person_id)
);
CREATE TABLE IF NOT EXISTS photos (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  root_id     TEXT NOT NULL,
  created_by  TEXT,
  created_at  INTEGER NOT NULL,
  size        INTEGER NOT NULL,
  data        BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS photos_root ON photos(root_id);
CREATE TABLE IF NOT EXISTS admin_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           INTEGER NOT NULL,
  admin_email  TEXT NOT NULL,
  action       TEXT NOT NULL,
  target       TEXT,
  detail       TEXT
);
CREATE INDEX IF NOT EXISTS admin_log_at ON admin_log(at);
CREATE TABLE IF NOT EXISTS backups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL,
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL,
  parent_id   TEXT,
  owner_id    TEXT,
  taken_at    INTEGER NOT NULL,
  size        INTEGER NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0,
  meta        TEXT,
  doc         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS backups_project ON backups(project_id, taken_at);

-- What changed in shared productions (see migrations/0006_activity.sql).
CREATE TABLE IF NOT EXISTS activity (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  root_id     TEXT NOT NULL,
  project_id  TEXT NOT NULL,
  kind        TEXT NOT NULL,
  user_id     TEXT,
  user_name   TEXT NOT NULL,
  started_at  INTEGER NOT NULL,
  at          INTEGER NOT NULL,
  count       INTEGER NOT NULL,
  items       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_root ON activity(root_id, at);
CREATE INDEX IF NOT EXISTS activity_project_user ON activity(project_id, user_id, at);

-- Failed sign-in attempts per email, for basic brute-force protection.
CREATE TABLE IF NOT EXISTS auth_failures (
  email        TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
