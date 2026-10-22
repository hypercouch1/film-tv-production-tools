-- 1.4.1: personal crew pages (call sheets, "Got it", calendar), continuity photos, the
-- admin's two-step sign-in, the admin log and document backups.
-- Apply once with: npm run db:migrate:crew (remote) or npm run db:migrate:crew:local

-- A personal page per cast or crew member (film.prismdashboard.cc/c/<code>).
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

-- When a shoot day's call sheet was sent out, and who has confirmed it since.
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

-- Continuity photos (JPEG) for shared productions; root_id is the production.
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

-- The admin's authenticator app (two-step sign-in to the admin page).
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_pending TEXT;
ALTER TABLE users ADD COLUMN totp_last INTEGER;
ALTER TABLE sessions ADD COLUMN admin_at INTEGER;

-- What admins did on the admin page.
CREATE TABLE IF NOT EXISTS admin_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           INTEGER NOT NULL,
  admin_email  TEXT NOT NULL,
  action       TEXT NOT NULL,
  target       TEXT,
  detail       TEXT
);
CREATE INDEX IF NOT EXISTS admin_log_at ON admin_log(at);

-- Daily copies of every shared document (the last 14 per document; a deleted document's
-- final copy is kept for 30 days).
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
