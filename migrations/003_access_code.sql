-- 003: short 6-digit access code for code-based retrieval (link + QR alternative).
ALTER TABLE packages ADD COLUMN IF NOT EXISTS access_code VARCHAR(6);

CREATE UNIQUE INDEX IF NOT EXISTS idx_packages_access_code
    ON packages (access_code) WHERE access_code IS NOT NULL;

-- Backfill codes for any existing active/legacy packages (best-effort; skip gaps).
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT id FROM packages WHERE access_code IS NULL LOOP
        UPDATE packages
           SET access_code = to_char(floor(random() * 1000000)::int, 'FM000000')
         WHERE id = r.id;
    END LOOP;
END
$$;
