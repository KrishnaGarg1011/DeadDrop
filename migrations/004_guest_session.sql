-- 004: per-session guest tracking. Anonymous (guest) senders get a client
-- generated session id so they can see their own drops + delivery log without
-- creating an account. The id is a long random UUID, not guessable.
ALTER TABLE packages ADD COLUMN IF NOT EXISTS guest_id TEXT;

CREATE INDEX IF NOT EXISTS idx_packages_guest ON packages (guest_id) WHERE guest_id IS NOT NULL;
