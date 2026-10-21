-- 1.3: personal availability links. Each cast or crew member asked for their availability
-- gets a code; only its SHA-256 is stored. Answers are written into the production
-- document (availability[person_id]), so they show up live in the app.
-- Apply once with: npm run db:migrate:availability (remote) or npm run db:migrate:availability:local
CREATE TABLE IF NOT EXISTS availability_links (
  code_hash    TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL,          -- the production
  person_id    TEXT NOT NULL,          -- character or crew id in the production
  name         TEXT NOT NULL,          -- shown on their page ("Ann Lee")
  role         TEXT NOT NULL,          -- "Maya" / "Gaffer"
  start_date   TEXT NOT NULL,          -- the dates they're asked about
  end_date     TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  responded_at INTEGER
);
CREATE INDEX IF NOT EXISTS availability_project ON availability_links(project_id, person_id);
