-- Preflight before applying:
-- SELECT lower(trim(replace(replace(replace(replace(replace(title, '　', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '))) AS title_key,
--        COUNT(*) AS duplicate_count
-- FROM jobs WHERE status = 'OPEN'
-- GROUP BY title_key HAVING COUNT(*) > 1;
--
-- Resolve every returned duplicate deliberately (rename, close, or merge its
-- assignments) before applying this migration. The unique index intentionally
-- fails rather than guessing which role is canonical.

ALTER TABLE jobs ADD COLUMN title_key TEXT;

UPDATE jobs
   SET title_key = lower(trim(replace(replace(replace(replace(replace(title, '　', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' ')))
 WHERE title_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_open_title_key
  ON jobs(title_key)
  WHERE status = 'OPEN';
