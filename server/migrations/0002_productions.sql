-- 1.3: productions. A shared production (kind 'shotsheet') can contain scripts and call
-- sheets (parent_id = the production). People are members of the production, and that
-- membership covers everything in it. info: small JSON for lists ({ type, episodeId }).
-- Apply once with: npm run db:migrate (remote) or npm run db:migrate:local
ALTER TABLE projects ADD COLUMN parent_id TEXT;
ALTER TABLE projects ADD COLUMN info TEXT;
CREATE INDEX IF NOT EXISTS projects_parent ON projects(parent_id);
