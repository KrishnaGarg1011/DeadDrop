-- ============================================================================
-- DeadDrop feature migration (idempotent) — QR, sender dashboard, realtime,
-- AES file encryption, E2E text encryption, exportable audit, shared drops.
-- Safe to run repeatedly; applies cleanly to both fresh and existing DBs.
-- ============================================================================

-- E2E / encryption columns on packages
ALTER TABLE packages
  ADD COLUMN IF NOT EXISTS e2ee           BOOLEAN     NOT NULL DEFAULT false, -- client-side encrypted text
  ADD COLUMN IF NOT EXISTS enc_payload    TEXT,                              -- base64 ciphertext (text drops)
  ADD COLUMN IF NOT EXISTS enc_iv         TEXT,                              -- base64 IV (text drops)
  ADD COLUMN IF NOT EXISTS enc_salt       TEXT,                              -- base64 PBKDF2 salt (text drops)
  ADD COLUMN IF NOT EXISTS file_crypto    BOOLEAN     NOT NULL DEFAULT false, -- stored file is AES-encrypted
  ADD COLUMN IF NOT EXISTS file_key       TEXT,                              -- base64 AES key (files)
  ADD COLUMN IF NOT EXISTS file_iv        TEXT,                              -- base64 IV (files)
  ADD COLUMN IF NOT EXISTS file_tag       TEXT;                              -- base64 GCM auth tag (files)

-- Relax the content-parity check so E2E text packages (no plaintext secret_text)
-- are allowed, and file packages must not carry secret_text/enc_payload.
DO $$
BEGIN
  ALTER TABLE packages DROP CONSTRAINT IF EXISTS text_content_or_null;
  ALTER TABLE packages ADD CONSTRAINT text_content_or_null CHECK (
    (type = 'text'  AND file_path IS NULL AND (status = 'burned' OR secret_text IS NOT NULL OR enc_payload IS NOT NULL)) OR
    (type = 'file'  AND secret_text IS NULL AND enc_payload IS NULL AND (status = 'burned' OR file_path IS NOT NULL))
  );
END $$;

-- Shared / team drops: invited recipients and their read status
CREATE TABLE IF NOT EXISTS package_recipients (
  id             BIGSERIAL PRIMARY KEY,
  package_id     BIGINT      NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  recipient_email TEXT,
  opened_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recipients_package ON package_recipients (package_id);
