-- Recipient acknowledge (manual "I've seen it") support.
ALTER TABLE package_recipients
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
