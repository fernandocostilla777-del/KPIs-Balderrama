-- BALDERRAMA Cloud Sync — PostgreSQL
-- Ejecutar una vez al desplegar: npm run init-db

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS sync_batches (
  id              BIGSERIAL PRIMARY KEY,
  domain          VARCHAR(32)  NOT NULL,
  sync_type       VARCHAR(16)  NOT NULL DEFAULT 'incremental',
  period_key      VARCHAR(7),
  period_start    DATE,
  period_end      DATE,
  source_host     VARCHAR(255),
  record_count    INT          NOT NULL DEFAULT 0,
  inserted_count  INT          NOT NULL DEFAULT 0,
  updated_count   INT          NOT NULL DEFAULT 0,
  history_count   INT          NOT NULL DEFAULT 0,
  archived_count  INT          NOT NULL DEFAULT 0,
  status          VARCHAR(16)  NOT NULL DEFAULT 'ok',
  error_message   TEXT,
  meta            JSONB,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE sync_batches ADD COLUMN IF NOT EXISTS meta JSONB;

CREATE INDEX IF NOT EXISTS idx_sync_batches_domain ON sync_batches (domain, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_batches_period ON sync_batches (period_key, domain);

CREATE TABLE IF NOT EXISTS sync_entities (
  id              BIGSERIAL PRIMARY KEY,
  domain          VARCHAR(32)  NOT NULL,
  external_id     VARCHAR(192) NOT NULL,
  period_key      VARCHAR(7),
  payload         JSONB        NOT NULL,
  content_hash    CHAR(64)     NOT NULL,
  first_seen_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_batch_id   BIGINT       REFERENCES sync_batches (id),
  UNIQUE (domain, external_id, period_key)
);

CREATE INDEX IF NOT EXISTS idx_sync_entities_domain_period ON sync_entities (domain, period_key);
CREATE INDEX IF NOT EXISTS idx_sync_entities_last_seen ON sync_entities (last_seen_at DESC);

CREATE TABLE IF NOT EXISTS sync_entity_history (
  id              BIGSERIAL PRIMARY KEY,
  domain          VARCHAR(32)  NOT NULL,
  external_id     VARCHAR(192) NOT NULL,
  period_key      VARCHAR(7),
  payload         JSONB        NOT NULL,
  content_hash    CHAR(64)     NOT NULL,
  valid_from      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  valid_to        TIMESTAMPTZ,
  batch_id        BIGINT       REFERENCES sync_batches (id),
  change_reason   VARCHAR(32)  NOT NULL DEFAULT 'update'
);

CREATE INDEX IF NOT EXISTS idx_sync_history_lookup
  ON sync_entity_history (domain, external_id, valid_from DESC);

CREATE INDEX IF NOT EXISTS idx_sync_history_period
  ON sync_entity_history (domain, period_key, valid_from DESC);
