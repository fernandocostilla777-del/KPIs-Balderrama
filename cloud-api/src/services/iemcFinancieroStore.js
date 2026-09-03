/**
 * Almacén Railway (PostgreSQL) para parámetros y resultados IEMC F-1…F-7.1
 * de Ventas Nuevos. Complementa Excel/presupuesto cuando no alcanza.
 */

const { query } = require('../db');

function ensureIemcFinancieroSql() {
  return `
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
  `;
}

async function ensureIemcFinancieroTables() {
  const statements = ensureIemcFinancieroSql()
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const sql of statements) {
    await query(sql);
  }
}

function normalizePeriodKey(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{4})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}`;
  return null;
}

function toNumOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapPeriodoRow(row) {
  if (!row) return null;
  return {
    periodKey: row.period_key,
    objetivoVentaEconomica: row.objetivo_venta_economica != null
      ? Number(row.objetivo_venta_economica)
      : null,
    gastoOperativoControlablePpto: row.gasto_operativo_controlable_ppto != null
      ? Number(row.gasto_operativo_controlable_ppto)
      : null,
    ingresoFiObjetivo: row.ingreso_fi_objetivo != null
      ? Number(row.ingreso_fi_objetivo)
      : null,
    pvrFiObjetivo: row.pvr_fi_objetivo != null
      ? Number(row.pvr_fi_objetivo)
      : null,
    coberturaFiPlanPisoObjetivoPct: row.cobertura_fi_plan_piso_objetivo_pct != null
      ? Number(row.cobertura_fi_plan_piso_objetivo_pct)
      : null,
    uocObjetivo: row.uoc_objetivo != null ? Number(row.uoc_objetivo) : null,
    uocPeriodoBase: row.uoc_periodo_base || null,
    cargaEstructuralPpto: row.carga_estructural_ppto != null
      ? Number(row.carga_estructural_ppto)
      : null,
    notas: row.notas || '',
    meta: row.meta || {},
    source: row.source || 'api',
    updatedBy: row.updated_by || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listPeriodos() {
  const result = await query(
    `SELECT *
     FROM iemc_financiero_periodos
     ORDER BY period_key DESC`
  );
  return result.rows.map(mapPeriodoRow);
}

async function getPeriodo(periodKey) {
  const key = normalizePeriodKey(periodKey);
  if (!key) return null;
  const result = await query(
    `SELECT * FROM iemc_financiero_periodos WHERE period_key = $1`,
    [key]
  );
  return mapPeriodoRow(result.rows[0] || null);
}

async function upsertPeriodo(periodKey, body = {}) {
  const key = normalizePeriodKey(periodKey);
  if (!key) {
    const err = new Error('periodKey inválido (use YYYY-MM)');
    err.status = 400;
    throw err;
  }

  const result = await query(
    `INSERT INTO iemc_financiero_periodos (
       period_key,
       objetivo_venta_economica,
       gasto_operativo_controlable_ppto,
       ingreso_fi_objetivo,
       pvr_fi_objetivo,
       cobertura_fi_plan_piso_objetivo_pct,
       uoc_objetivo,
       uoc_periodo_base,
       carga_estructural_ppto,
       notas,
       meta,
       source,
       updated_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::jsonb, '{}'::jsonb),$12,$13
     )
     ON CONFLICT (period_key) DO UPDATE SET
       objetivo_venta_economica = COALESCE(EXCLUDED.objetivo_venta_economica, iemc_financiero_periodos.objetivo_venta_economica),
       gasto_operativo_controlable_ppto = COALESCE(EXCLUDED.gasto_operativo_controlable_ppto, iemc_financiero_periodos.gasto_operativo_controlable_ppto),
       ingreso_fi_objetivo = COALESCE(EXCLUDED.ingreso_fi_objetivo, iemc_financiero_periodos.ingreso_fi_objetivo),
       pvr_fi_objetivo = COALESCE(EXCLUDED.pvr_fi_objetivo, iemc_financiero_periodos.pvr_fi_objetivo),
       cobertura_fi_plan_piso_objetivo_pct = COALESCE(EXCLUDED.cobertura_fi_plan_piso_objetivo_pct, iemc_financiero_periodos.cobertura_fi_plan_piso_objetivo_pct),
       uoc_objetivo = COALESCE(EXCLUDED.uoc_objetivo, iemc_financiero_periodos.uoc_objetivo),
       uoc_periodo_base = COALESCE(EXCLUDED.uoc_periodo_base, iemc_financiero_periodos.uoc_periodo_base),
       carga_estructural_ppto = COALESCE(EXCLUDED.carga_estructural_ppto, iemc_financiero_periodos.carga_estructural_ppto),
       notas = CASE WHEN EXCLUDED.notas <> '' THEN EXCLUDED.notas ELSE iemc_financiero_periodos.notas END,
       meta = CASE
         WHEN EXCLUDED.meta IS NULL OR EXCLUDED.meta = '{}'::jsonb THEN iemc_financiero_periodos.meta
         ELSE iemc_financiero_periodos.meta || EXCLUDED.meta
       END,
       source = COALESCE(NULLIF(EXCLUDED.source, ''), iemc_financiero_periodos.source),
       updated_by = COALESCE(NULLIF(EXCLUDED.updated_by, ''), iemc_financiero_periodos.updated_by),
       updated_at = NOW()
     RETURNING *`,
    [
      key,
      toNumOrNull(body.objetivoVentaEconomica ?? body.objetivo_venta_economica),
      toNumOrNull(body.gastoOperativoControlablePpto ?? body.gasto_operativo_controlable_ppto),
      toNumOrNull(body.ingresoFiObjetivo ?? body.ingreso_fi_objetivo),
      toNumOrNull(body.pvrFiObjetivo ?? body.pvr_fi_objetivo),
      toNumOrNull(body.coberturaFiPlanPisoObjetivoPct ?? body.cobertura_fi_plan_piso_objetivo_pct),
      toNumOrNull(body.uocObjetivo ?? body.uoc_objetivo),
      normalizePeriodKey(body.uocPeriodoBase ?? body.uoc_periodo_base) || null,
      toNumOrNull(body.cargaEstructuralPpto ?? body.carga_estructural_ppto),
      String(body.notas || ''),
      body.meta && typeof body.meta === 'object' ? JSON.stringify(body.meta) : null,
      String(body.source || 'api').slice(0, 32),
      String(body.updatedBy || body.updated_by || '').slice(0, 120),
    ]
  );

  return mapPeriodoRow(result.rows[0]);
}

async function listClasificacion({ soloActivos = true } = {}) {
  const result = await query(
    `SELECT id, cuenta_prefix, tipo, label, activo, updated_by, created_at, updated_at
     FROM iemc_gasto_clasificacion
     WHERE ($1::boolean = FALSE OR activo = TRUE)
     ORDER BY tipo, cuenta_prefix`,
    [soloActivos]
  );
  return result.rows.map((row) => ({
    id: row.id,
    cuentaPrefix: row.cuenta_prefix,
    tipo: row.tipo,
    label: row.label,
    activo: row.activo,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

async function upsertClasificacion(body = {}) {
  const prefix = String(body.cuentaPrefix || body.cuenta_prefix || '').trim();
  const tipo = String(body.tipo || '').trim().toLowerCase();
  if (!prefix) {
    const err = new Error('cuentaPrefix es requerido');
    err.status = 400;
    throw err;
  }
  if (!['controlable', 'estructural', 'excluir'].includes(tipo)) {
    const err = new Error('tipo debe ser controlable | estructural | excluir');
    err.status = 400;
    throw err;
  }

  const result = await query(
    `INSERT INTO iemc_gasto_clasificacion (cuenta_prefix, tipo, label, activo, updated_by)
     VALUES ($1, $2, $3, COALESCE($4, TRUE), $5)
     ON CONFLICT (cuenta_prefix, tipo) DO UPDATE SET
       label = COALESCE(NULLIF(EXCLUDED.label, ''), iemc_gasto_clasificacion.label),
       activo = COALESCE(EXCLUDED.activo, iemc_gasto_clasificacion.activo),
       updated_by = COALESCE(NULLIF(EXCLUDED.updated_by, ''), iemc_gasto_clasificacion.updated_by),
       updated_at = NOW()
     RETURNING id, cuenta_prefix, tipo, label, activo, updated_by, created_at, updated_at`,
    [
      prefix.slice(0, 64),
      tipo,
      String(body.label || '').slice(0, 255),
      body.activo == null ? true : Boolean(body.activo),
      String(body.updatedBy || body.updated_by || '').slice(0, 120),
    ]
  );

  const row = result.rows[0];
  return {
    id: row.id,
    cuentaPrefix: row.cuenta_prefix,
    tipo: row.tipo,
    label: row.label,
    activo: row.activo,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function upsertSnapshot({ periodKey, kpiClave, payload, source = 'compute' } = {}) {
  const key = normalizePeriodKey(periodKey);
  const kpi = String(kpiClave || '').trim().toUpperCase();
  if (!key || !kpi) {
    const err = new Error('periodKey y kpiClave son requeridos');
    err.status = 400;
    throw err;
  }
  if (!payload || typeof payload !== 'object') {
    const err = new Error('payload debe ser un objeto JSON');
    err.status = 400;
    throw err;
  }

  const result = await query(
    `INSERT INTO iemc_financiero_snapshots (period_key, kpi_clave, payload, source, computed_at)
     VALUES ($1, $2, $3::jsonb, $4, NOW())
     ON CONFLICT (period_key, kpi_clave) DO UPDATE SET
       payload = EXCLUDED.payload,
       source = EXCLUDED.source,
       computed_at = NOW()
     RETURNING id, period_key, kpi_clave, payload, source, computed_at`,
    [key, kpi.slice(0, 16), JSON.stringify(payload), String(source).slice(0, 32)]
  );

  const row = result.rows[0];
  return {
    id: row.id,
    periodKey: row.period_key,
    kpiClave: row.kpi_clave,
    payload: row.payload,
    source: row.source,
    computedAt: row.computed_at,
  };
}

async function listSnapshots(periodKey) {
  const key = normalizePeriodKey(periodKey);
  if (!key) return [];
  const result = await query(
    `SELECT id, period_key, kpi_clave, payload, source, computed_at
     FROM iemc_financiero_snapshots
     WHERE period_key = $1
     ORDER BY kpi_clave`,
    [key]
  );
  return result.rows.map((row) => ({
    id: row.id,
    periodKey: row.period_key,
    kpiClave: row.kpi_clave,
    payload: row.payload,
    source: row.source,
    computedAt: row.computed_at,
  }));
}

module.exports = {
  ensureIemcFinancieroTables,
  ensureIemcFinancieroSql,
  listPeriodos,
  getPeriodo,
  upsertPeriodo,
  listClasificacion,
  upsertClasificacion,
  upsertSnapshot,
  listSnapshots,
  normalizePeriodKey,
};
