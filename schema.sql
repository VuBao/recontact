-- Recontact: D1 schema (no CV files are stored in Git or D1)
CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  age INTEGER,
  email TEXT,
  phone TEXT,
  current_visa TEXT,
  japanese_level TEXT,
  status TEXT NOT NULL DEFAULT 'POOL',
  labels_json TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'manual',
  file_key TEXT,
  file_name TEXT,
  file_hash TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS job_candidates (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SELECTED',
  invited_at TEXT,
  responded_at TEXT,
  booked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(job_id, candidate_id)
);
CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status);
CREATE INDEX IF NOT EXISTS idx_job_candidates_job ON job_candidates(job_id);
CREATE INDEX IF NOT EXISTS idx_job_candidates_candidate ON job_candidates(candidate_id);

CREATE TABLE IF NOT EXISTS email_batches (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT UNIQUE NOT NULL,
  company_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PROCESSING',
  total_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_email_batches_idempotency ON email_batches(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_email_batches_status ON email_batches(status);

CREATE TABLE IF NOT EXISTS email_deliveries (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES email_batches(id),
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  recipient_email TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  error_message TEXT,
  provider_message_id TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_deliveries_batch ON email_deliveries(batch_id);
CREATE INDEX IF NOT EXISTS idx_email_deliveries_candidate ON email_deliveries(candidate_id);
CREATE INDEX IF NOT EXISTS idx_email_deliveries_status ON email_deliveries(status);
