/**
 * Tablas CRM de Google Sheets en Railway (JSONB genérico).
 * Complementa crm_ciclos: leads, tráfico piso, solicitudes, pruebas, F&I, CSI…
 */
'use strict';

const crypto = require('crypto');
const { query, withTransaction } = require('../db');

const ALLOWED_TABLES = new Set([
  'crm_leads',
  'crm_trafico_piso',
  'crm_solicitudes',
  'crm_pruebas_manejo',
  'crm_financiamiento',
  'crm_pagos_gmf',
  'crm_csi_ventas',
  'crm_csi_posventa',
]);

function ensureTableSql() {
  return `
    CREATE TABLE IF NOT EXISTS crm_sheet_rows (
      table_name   TEXT         NOT NULL,
      row_key      TEXT         NOT NULL,
      payload      JSONB        NOT NULL,
      content_hash CHAR(64)     NOT NULL,
      source       VARCHAR(32)  NOT NULL DEFAULT 'api',
      last_batch_id BIGINT,
      created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      PRIMARY KEY (table_name, row_key)
    );
    CREATE INDEX IF NOT EXISTS idx_crm_sheet_table ON crm_sheet_rows (table_name);
    CREATE INDEX IF NOT EXISTS idx_crm_sheet_id_crm
      ON crm_sheet_rows (table_name, ((payload->>'id_crm')));
    CREATE INDEX IF NOT EXISTS idx_crm_sheet_fecha
      ON crm_sheet_rows (table_name, ((payload->>'fecha')));
    CREATE INDEX IF NOT EXISTS idx_crm_sheet_fecha_entrada
      ON crm_sheet_rows (table_name, ((payload->>'fecha_entrada')));
  `;
}

async function ensureCrmSheetsTables() {
  const statements = ensureTableSql()
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await query(`${statement};`);
  }
}

function assertTable(tableName) {
  const name = String(tableName || '').trim();
  if (!ALLOWED_TABLES.has(name)) {
    const err = new Error(`Tabla no permitida: ${tableName}. Válidas: ${[...ALLOWED_TABLES].join(', ')}`);
    err.status = 400;
    throw err;
  }
  return name;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function normalizePayload(row) {
  if (!row || typeof row !== 'object') {
    const err = new Error('Cada fila debe ser un objeto');
    err.status = 400;
    throw err;
  }
  const source = row.data && typeof row.data === 'object' ? { ...row, ...row.data } : { ...row };
  delete source.entity;
  delete source.data;
  const out = {};
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function rowKeyFor(tableName, payload) {
  const explicit = String(payload.row_key || payload.rowKey || payload.externalId || '').trim();
  if (explicit) return explicit.slice(0, 190);
  if (payload.id != null && String(payload.id).trim() !== '') {
    return `${tableName}|${String(payload.id).trim()}`.slice(0, 190);
  }
  const identity = stableStringify(payload);
  return crypto.createHash('sha256').update(`${tableName}|${identity}`).digest('hex');
}

async function upsertSheetBatch(tableName, records, {
  replaceAll = false,
  source = 'api',
  batchId = null,
  client,
} = {}) {
  const table = assertTable(tableName);
  if (!Array.isArray(records) || !records.length) {
    const err = new Error('El payload debe incluir al menos un registro');
    err.status = 400;
    throw err;
  }
  if (records.length > 10000) {
    const err = new Error('Máximo 10000 filas por llamada; envíe en lotes');
    err.status = 400;
    throw err;
  }

  const normalized = records.map((r) => {
    const payload = normalizePayload(r);
    const rowKey = rowKeyFor(table, payload);
    const contentHash = crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
    return { rowKey, payload, contentHash };
  });

  const run = async (db) => {
    if (replaceAll) {
      await db.query('DELETE FROM crm_sheet_rows WHERE table_name = $1', [table]);
    }
    let upserted = 0;
    for (const row of normalized) {
      await db.query(
        `INSERT INTO crm_sheet_rows
           (table_name, row_key, payload, content_hash, source, last_batch_id, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, NOW())
         ON CONFLICT (table_name, row_key) DO UPDATE SET
           payload = EXCLUDED.payload,
           content_hash = EXCLUDED.content_hash,
           source = EXCLUDED.source,
           last_batch_id = EXCLUDED.last_batch_id,
           updated_at = NOW()
         WHERE crm_sheet_rows.content_hash IS DISTINCT FROM EXCLUDED.content_hash`,
        [table, row.rowKey, JSON.stringify(row.payload), row.contentHash, source || 'api', batchId || null],
      );
      upserted += 1;
    }
    const total = await db.query(
      'SELECT COUNT(*)::int AS total FROM crm_sheet_rows WHERE table_name = $1',
      [table],
    );
    return {
      table,
      upserted,
      replaced: Boolean(replaceAll),
      total: total.rows[0]?.total || 0,
    };
  };

  if (client) return run(client);
  return withTransaction(run);
}

async function listSheetRows(tableName, { limit = 2000, offset = 0, idCrm, q } = {}) {
  const table = assertTable(tableName);
  const params = [table];
  let sql = `SELECT row_key, payload, updated_at FROM crm_sheet_rows WHERE table_name = $1`;
  if (idCrm) {
    params.push(String(idCrm).trim());
    sql += ` AND payload->>'id_crm' = $${params.length}`;
  }
  if (q) {
    params.push(`%${String(q).trim()}%`);
    sql += ` AND payload::text ILIKE $${params.length}`;
  }
  sql += ` ORDER BY row_key`;
  params.push(Math.min(Math.max(Number(limit) || 2000, 1), 5000));
  sql += ` LIMIT $${params.length}`;
  params.push(Math.max(Number(offset) || 0, 0));
  sql += ` OFFSET $${params.length}`;
  const result = await query(sql, params);
  return result.rows.map((r) => ({
    row_key: r.row_key,
    updated_at: r.updated_at,
    ...(r.payload && typeof r.payload === 'object' ? r.payload : {}),
  }));
}

async function getSheetsSummary() {
  const totals = await query(`
    SELECT table_name, COUNT(*)::int AS total, MAX(updated_at) AS updated_at
    FROM crm_sheet_rows
    GROUP BY table_name
    ORDER BY table_name
  `);
  const byTable = Object.fromEntries(
    totals.rows.map((r) => [r.table_name, { total: r.total, updatedAt: r.updated_at }]),
  );
  for (const name of ALLOWED_TABLES) {
    if (!byTable[name]) byTable[name] = { total: 0, updatedAt: null };
  }
  return { tables: byTable, allowed: [...ALLOWED_TABLES] };
}

module.exports = {
  ALLOWED_TABLES,
  ensureCrmSheetsTables,
  upsertSheetBatch,
  listSheetRows,
  getSheetsSummary,
  assertTable,
};
