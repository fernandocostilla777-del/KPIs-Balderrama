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

-- Personal DMS activo (vendedores, roles internos, asesores de servicio)
CREATE TABLE IF NOT EXISTS dms_personal (
  id              BIGSERIAL PRIMARY KEY,
  categoria       VARCHAR(32)  NOT NULL,
  subtipo         VARCHAR(32)  NOT NULL DEFAULT '',
  external_id     VARCHAR(64)  NOT NULL,
  paterno         VARCHAR(120) NOT NULL DEFAULT '',
  materno         VARCHAR(120) NOT NULL DEFAULT '',
  nombre          VARCHAR(255) NOT NULL DEFAULT '',
  email           VARCHAR(255) NOT NULL DEFAULT '',
  sucursal        VARCHAR(64)  NOT NULL DEFAULT '',
  activo          BOOLEAN      NOT NULL DEFAULT TRUE,
  content_hash    CHAR(64),
  last_batch_id   BIGINT       REFERENCES sync_batches (id),
  first_seen_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (categoria, subtipo, external_id)
);

CREATE INDEX IF NOT EXISTS idx_dms_personal_categoria ON dms_personal (categoria, activo);
CREATE INDEX IF NOT EXISTS idx_dms_personal_nombre ON dms_personal (nombre);
CREATE INDEX IF NOT EXISTS idx_dms_personal_subtipo ON dms_personal (subtipo);

-- Ciclos CRM (export Balderrama Ciclos / actividades)
CREATE TABLE IF NOT EXISTS crm_ciclos (
  id                      BIGSERIAL PRIMARY KEY,
  row_key                 CHAR(64)     NOT NULL UNIQUE,
  id_contacto             VARCHAR(64)  NOT NULL,
  nombre_contacto         VARCHAR(255) NOT NULL DEFAULT '',
  id_ciclo                VARCHAR(64)  NOT NULL DEFAULT '',
  fecha_inicio_ciclo      VARCHAR(40)  NOT NULL DEFAULT '',
  fecha_esperada_cierre   VARCHAR(40)  NOT NULL DEFAULT '',
  estatus                 VARCHAR(80)  NOT NULL DEFAULT '',
  fecha_estatus           VARCHAR(40)  NOT NULL DEFAULT '',
  tipo_actividad          VARCHAR(120) NOT NULL DEFAULT '',
  fecha_crea_actividad    VARCHAR(40)  NOT NULL DEFAULT '',
  fecha_prog_actividad    VARCHAR(40)  NOT NULL DEFAULT '',
  fecha_resp_actividad    VARCHAR(40)  NOT NULL DEFAULT '',
  resultado_actividad     TEXT         NOT NULL DEFAULT '',
  forma_contacto          VARCHAR(80)  NOT NULL DEFAULT '',
  medio_contacto          VARCHAR(80)  NOT NULL DEFAULT '',
  submedio_contacto       VARCHAR(120) NOT NULL DEFAULT '',
  num_factura             VARCHAR(64)  NOT NULL DEFAULT '',
  facturado_a             VARCHAR(255) NOT NULL DEFAULT '',
  producto_vendido        VARCHAR(255) NOT NULL DEFAULT '',
  fecha_factura           VARCHAR(40)  NOT NULL DEFAULT '',
  vin                     VARCHAR(64)  NOT NULL DEFAULT '',
  fecha_entrega           VARCHAR(40)  NOT NULL DEFAULT '',
  vendedor                VARCHAR(160) NOT NULL DEFAULT '',
  content_hash            CHAR(64),
  source                  VARCHAR(32)  NOT NULL DEFAULT 'api',
  last_batch_id           BIGINT,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_ciclos_contacto ON crm_ciclos (id_contacto);
CREATE INDEX IF NOT EXISTS idx_crm_ciclos_ciclo ON crm_ciclos (id_ciclo);
CREATE INDEX IF NOT EXISTS idx_crm_ciclos_vin ON crm_ciclos (vin);
CREATE INDEX IF NOT EXISTS idx_crm_ciclos_vendedor ON crm_ciclos (vendedor);
CREATE INDEX IF NOT EXISTS idx_crm_ciclos_estatus ON crm_ciclos (estatus);
CREATE INDEX IF NOT EXISTS idx_crm_ciclos_factura ON crm_ciclos (num_factura);

CREATE TABLE IF NOT EXISTS crm_contactos (
  id_contacto VARCHAR(64) PRIMARY KEY,
  nombre_contacto VARCHAR(255) NOT NULL DEFAULT '',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_ciclo_at VARCHAR(32) NOT NULL DEFAULT '',
  last_actividad_at VARCHAR(32) NOT NULL DEFAULT '',
  total_ciclos INT NOT NULL DEFAULT 0,
  total_actividades INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_contactos_nombre ON crm_contactos (nombre_contacto);
CREATE INDEX IF NOT EXISTS idx_crm_contactos_last_seen ON crm_contactos (last_seen_at DESC);

-- IEMC financiero Ventas Nuevos (F-1…F-7.1): parámetros y snapshots
-- cuando Excel/presupuesto no alcanzan.
CREATE TABLE IF NOT EXISTS iemc_financiero_periodos (
  period_key                         VARCHAR(7)   PRIMARY KEY,
  objetivo_venta_economica           NUMERIC(18,2),
  gasto_operativo_controlable_ppto   NUMERIC(18,2),
  ingreso_fi_objetivo                NUMERIC(18,2),
  pvr_fi_objetivo                    NUMERIC(18,2),
  cobertura_fi_plan_piso_objetivo_pct NUMERIC(8,2),
  uoc_objetivo                       NUMERIC(18,2),
  uoc_periodo_base                   VARCHAR(7),
  carga_estructural_ppto             NUMERIC(18,2),
  notas                              TEXT         NOT NULL DEFAULT '',
  meta                               JSONB        NOT NULL DEFAULT '{}'::jsonb,
  source                             VARCHAR(32)  NOT NULL DEFAULT 'api',
  updated_by                         VARCHAR(120) NOT NULL DEFAULT '',
  created_at                         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS iemc_gasto_clasificacion (
  id              BIGSERIAL PRIMARY KEY,
  cuenta_prefix   VARCHAR(64)  NOT NULL,
  tipo            VARCHAR(32)  NOT NULL,
  label           VARCHAR(255) NOT NULL DEFAULT '',
  activo          BOOLEAN      NOT NULL DEFAULT TRUE,
  updated_by      VARCHAR(120) NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (cuenta_prefix, tipo),
  CONSTRAINT iemc_gasto_tipo_chk CHECK (tipo IN ('controlable', 'estructural', 'excluir'))
);

CREATE INDEX IF NOT EXISTS idx_iemc_gasto_tipo
  ON iemc_gasto_clasificacion (tipo, activo);

CREATE TABLE IF NOT EXISTS iemc_financiero_snapshots (
  id              BIGSERIAL PRIMARY KEY,
  period_key      VARCHAR(7)   NOT NULL,
  kpi_clave       VARCHAR(16)  NOT NULL,
  payload         JSONB        NOT NULL,
  source          VARCHAR(32)  NOT NULL DEFAULT 'compute',
  computed_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (period_key, kpi_clave)
);

CREATE INDEX IF NOT EXISTS idx_iemc_snapshots_period
  ON iemc_financiero_snapshots (period_key, computed_at DESC);
