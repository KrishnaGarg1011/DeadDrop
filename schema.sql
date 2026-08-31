-- ============================================================================
-- DeadDrop — Ephemeral Secure File Exchange Platform
-- PostgreSQL migration script (schema)
-- Run against a fresh database, e.g.:  psql "$DATABASE_URL" -f schema.sql
-- ============================================================================

-- Extension for generating unique shareable tokens (uuid)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. USERS — optional accounts for senders (anonymous sending is also allowed)
-- ----------------------------------------------------------------------------
CREATE TABLE users (
    id            BIGSERIAL PRIMARY KEY,
    email         TEXT        NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 2. ADMINS — dedicated admin accounts, separate from regular users
-- ----------------------------------------------------------------------------
CREATE TABLE admins (
    id            BIGSERIAL PRIMARY KEY,
    username      TEXT        NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 3. PACKAGES — the core entity: a secret text message OR an uploaded file
-- ----------------------------------------------------------------------------
CREATE TYPE package_type   AS ENUM ('text', 'file');
CREATE TYPE package_status AS ENUM ('active', 'expired', 'burned', 'revoked', 'locked');

CREATE TABLE packages (
    id                    BIGSERIAL PRIMARY KEY,
    token                 TEXT        NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
    access_code           VARCHAR(6),          -- short 6-digit code for code-based retrieval
    guest_id              TEXT,                -- per-session id for anonymous (guest) senders

    -- who created it (NULL when anonymous)
    creator_id            BIGINT      REFERENCES users(id) ON DELETE SET NULL,

    -- content: exactly one of these is populated depending on type
    type                  package_type NOT NULL,
    secret_text           TEXT,              -- used when type = 'text'
    file_name             TEXT,              -- used when type = 'file'
    file_path             TEXT,              -- relative path on local disk (uploads/...)
    file_mime             TEXT,
    file_size             BIGINT,

    -- lifecycle / access rules
    expires_at            TIMESTAMPTZ,       -- NULL = no time-based expiry
    max_views             INTEGER,           -- NULL = unlimited
    view_count            INTEGER     NOT NULL DEFAULT 0,
    burn_after_reading    BOOLEAN     NOT NULL DEFAULT FALSE,

    -- security
    is_password_protected BOOLEAN     NOT NULL DEFAULT FALSE,
    password_hash         TEXT,              -- bcrypt hash, NULL when unprotected
    failed_attempts       INTEGER     NOT NULL DEFAULT 0,
    max_failed_attempts   INTEGER     NOT NULL DEFAULT 5,

    -- lifecycle state
    status                package_status NOT NULL DEFAULT 'active',
    revoked_at            TIMESTAMPTZ,
    revoked_by            TEXT,              -- 'user' | 'admin' or username/id
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- enforce content parity, EXCEPT for burned packages whose content has
    -- been deliberately wiped after the one-time view/download.
    CONSTRAINT text_content_or_null    CHECK (
        (type = 'text' AND (status = 'burned' OR (secret_text IS NOT NULL AND file_path IS NULL))) OR
        (type = 'file' AND (status = 'burned' OR (file_path IS NOT NULL AND secret_text IS NULL)))
    ),
    CONSTRAINT views_within_limit      CHECK (view_count >= 0),
    CONSTRAINT created_before_expiry   CHECK (expires_at IS NULL OR expires_at > created_at)
);

-- fast lookup by shareable token and by creator/admin dashboard filters
CREATE INDEX idx_packages_token    ON packages (token);
CREATE UNIQUE INDEX idx_packages_access_code ON packages (access_code) WHERE access_code IS NOT NULL;
CREATE INDEX idx_packages_guest    ON packages (guest_id) WHERE guest_id IS NOT NULL;
CREATE INDEX idx_packages_status   ON packages (status);
CREATE INDEX idx_packages_creator  ON packages (creator_id) WHERE creator_id IS NOT NULL;
CREATE INDEX idx_packages_expiry   ON packages (expires_at);
CREATE INDEX idx_packages_created  ON packages (created_at DESC);

-- ----------------------------------------------------------------------------
-- 4. ACCESS_LOGS — every attempt to open a package (success OR failure)
--    Drives the "failed access attempts" view and burn/lock logic.
-- ----------------------------------------------------------------------------
CREATE TABLE access_logs (
    id            BIGSERIAL PRIMARY KEY,
    package_id    BIGINT      REFERENCES packages(id) ON DELETE CASCADE,
    token         TEXT,                       -- denormalized for fast lookup by link
    success       BOOLEAN     NOT NULL,
    reason        TEXT,                       -- e.g. 'ok', 'wrong_password', 'expired', 'exhausted', 'burned', 'locked'
    ip_address    INET,
    user_agent    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_access_logs_package    ON access_logs (package_id);
CREATE INDEX idx_access_logs_success    ON access_logs (success);
CREATE INDEX idx_access_logs_created    ON access_logs (created_at DESC);

-- ----------------------------------------------------------------------------
-- 5. AUTH_ATTEMPTS — login attempts for users and admins (drives failed-login view)
-- ----------------------------------------------------------------------------
CREATE TABLE auth_attempts (
    id            BIGSERIAL PRIMARY KEY,
    actor_type    TEXT        NOT NULL CHECK (actor_type IN ('user', 'admin')),
    email         TEXT,                       -- subject email/username, if known
    success       BOOLEAN     NOT NULL,
    ip_address    INET,
    user_agent    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auth_attempts_actor   ON auth_attempts (actor_type);
CREATE INDEX idx_auth_attempts_success ON auth_attempts (success);
CREATE INDEX idx_auth_attempts_created ON auth_attempts (created_at DESC);

-- ----------------------------------------------------------------------------
-- 6. AUDIT_LOGS — unified platform audit trail (state changes, creates,
--    revocations, admin actions). For the comprehensive Audit Log dashboard.
-- ----------------------------------------------------------------------------
CREATE TABLE audit_logs (
    id            BIGSERIAL PRIMARY KEY,
    actor_type    TEXT        NOT NULL CHECK (actor_type IN ('user', 'admin', 'system', 'anonymous')),
    actor_id      BIGINT,
    action        TEXT        NOT NULL,       -- e.g. 'package.created', 'package.expired', 'package.burned', 'package.revoked', 'admin.login'
    entity_type   TEXT,                       -- 'package' | 'user' | 'admin'
    entity_id     BIGINT,
    details       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    ip_address    INET,
    user_agent    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_actor    ON audit_logs (actor_type);
CREATE INDEX idx_audit_logs_action   ON audit_logs (action);
CREATE INDEX idx_audit_logs_entity   ON audit_logs (entity_type, entity_id);
CREATE INDEX idx_audit_logs_created  ON audit_logs (created_at DESC);

-- ============================================================================
-- HELPER: auto-expire packages whose time limit has passed.
-- Put the package into 'expired' state and record an audit entry.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_expire_packages() RETURNS void AS $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT id FROM packages
        WHERE status = 'active'
          AND expires_at IS NOT NULL
          AND expires_at <= now()
    LOOP
        UPDATE packages
           SET status = 'expired'
         WHERE id = r.id;

        INSERT INTO audit_logs (actor_type, action, entity_type, entity_id, details)
        VALUES ('system', 'package.expired', 'package', r.id,
                jsonb_build_object('reason', 'time_limit_reached'));
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- SEED: a default admin account (username: admin, password: admin123).
-- To change the password, edit ADMIN_PASSWORD below and re-run this script, or
-- regenerate the hash server-side and update the row.
-- ============================================================================
INSERT INTO admins (username, password_hash) VALUES
('admin', '$2a$11$U6uS8Dc7mgrdrKI44LQre.G66Vm7IGgqaN6rjIVXuxAxDz.WU4ArS')
ON CONFLICT (username) DO NOTHING;
