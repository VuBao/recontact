-- Recontact: Email batch audit tables
CREATE TABLE IF NOT EXISTS email_batches (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT UNIQUE NOT NULL,
  request_fingerprint TEXT NOT NULL,
  provider TEXT NOT NULL,
  company_name TEXT NOT NULL,
  attachment_names_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'PROCESSING',
  requested_count INTEGER NOT NULL DEFAULT 0,
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
  candidate_name TEXT NOT NULL,
  role_title TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  error_code TEXT,
  error_message TEXT,
  provider_message_id TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(batch_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_email_deliveries_batch ON email_deliveries(batch_id);
CREATE INDEX IF NOT EXISTS idx_email_deliveries_candidate ON email_deliveries(candidate_id);
CREATE INDEX IF NOT EXISTS idx_email_deliveries_status ON email_deliveries(status);
