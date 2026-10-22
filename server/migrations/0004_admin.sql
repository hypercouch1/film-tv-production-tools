-- 1.4: admin page. Usage stats (when each account was last active and on which app
-- version), switching accounts off, and one-time codes for forgotten passwords.
-- Apply once with: npm run db:migrate:admin (remote) or npm run db:migrate:admin:local
ALTER TABLE users ADD COLUMN last_seen INTEGER;
ALTER TABLE users ADD COLUMN app_version TEXT;
ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;

-- One-time password codes an admin gives someone who forgot their password. Only the
-- code's SHA-256 is stored; a code works once, for one account, until it expires.
CREATE TABLE IF NOT EXISTS reset_codes (
  code_hash   TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);
CREATE INDEX IF NOT EXISTS reset_codes_user ON reset_codes(user_id);
