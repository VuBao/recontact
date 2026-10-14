ALTER TABLE candidates ADD COLUMN response_status TEXT;
ALTER TABLE candidates ADD COLUMN response_name TEXT;
ALTER TABLE candidates ADD COLUMN response_phone TEXT;
ALTER TABLE candidates ADD COLUMN response_availability TEXT;
ALTER TABLE candidates ADD COLUMN response_start_date TEXT;
ALTER TABLE candidates ADD COLUMN response_received_at TEXT;
ALTER TABLE candidates ADD COLUMN response_message_id TEXT;
ALTER TABLE candidates ADD COLUMN response_confirmed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_candidates_response_status ON candidates(response_status);
