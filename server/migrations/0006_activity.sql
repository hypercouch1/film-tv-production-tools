-- 1.5.0: what changed in shared productions (the production home's "Recent activity").
-- Apply once with: npm run db:migrate:activity (remote) or npm run db:migrate:activity:local
-- One row per person per document per stretch of editing (edits within 15 minutes of each
-- other are combined); kept for 60 days.
CREATE TABLE IF NOT EXISTS activity (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  root_id     TEXT NOT NULL,          -- the production
  project_id  TEXT NOT NULL,          -- the document changed
  kind        TEXT NOT NULL,
  user_id     TEXT,
  user_name   TEXT NOT NULL,
  started_at  INTEGER NOT NULL,
  at          INTEGER NOT NULL,       -- the latest change
  count       INTEGER NOT NULL,       -- how many changes
  items       TEXT NOT NULL           -- JSON: what was changed, e.g. ["Scene 4", "Day of 2026-11-03"]
);
CREATE INDEX IF NOT EXISTS activity_root ON activity(root_id, at);
CREATE INDEX IF NOT EXISTS activity_project_user ON activity(project_id, user_id, at);
