#!/usr/bin/env node
'use strict';
/**
 * Sube tablas CRM de Sheets (SQLite local) a Railway → crm_sheet_rows.
 *
 * Uso:
 *   node backend/scripts/push-crm-sheets-cloud.js
 *   node backend/scripts/push-crm-sheets-cloud.js --tablas crm_leads,crm_trafico_piso
 *   node backend/scripts/push-crm-sheets-cloud.js --replace
 *
 * Requiere CLOUD_SYNC_URL + CLOUD_SYNC_API_KEY en backend/.env
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const Database = require('better-sqlite3');

const DB_PATH = process.env.CRM_SQLITE_PATH
  || path.join(__dirname, '../data/crm-ciclos.db');
const BASE = String(process.env.CLOUD_SYNC_URL || process.env.CLOUD_READ_URL || '')
  .trim().replace(/\/$/, '');
const KEY = String(process.env.CLOUD_SYNC_API_KEY || '').trim();
const BATCH = Math.min(parseInt(process.env.CRM_SHEETS_PUSH_BATCH || '800', 10) || 800, 5000);

const DEFAULT_TABLES = [
  'crm_leads',
  'crm_trafico_piso',
  'crm_solicitudes',
  'crm_pruebas_manejo',
  'crm_financiamiento',
  'crm_pagos_gmf',
  'crm_csi_ventas',
  'crm_csi_posventa',
];

function parseArgs(argv) {
  const out = { tablas: null, replace: false, mode: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--tablas') {
      out.tablas = String(argv[i + 1] || '').split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (argv[i] === '--replace') out.replace = true;
    if (argv[i] === '--sync') out.mode = 'sync';
  }
  return out;
}

const ENTITY_BY_TABLE = {
  crm_leads: 'lead',
  crm_trafico_piso: 'trafico',
  crm_solicitudes: 'solicitud',
  crm_pruebas_manejo: 'prueba',
  crm_financiamiento: 'financiamiento',
  crm_pagos_gmf: 'pago_gmf',
  crm_csi_ventas: 'csi_ventas',
  crm_csi_posventa: 'csi_posventa',
};

/** sync_batches.period_key es VARCHAR(7) en Railway — claves cortas. */
const PERIOD_BY_TABLE = {
  crm_leads: 's-leads',
  crm_trafico_piso: 's-traf',
  crm_solicitudes: 's-sol',
  crm_pruebas_manejo: 's-prue',
  crm_financiamiento: 's-fin',
  crm_pagos_gmf: 's-pgmf',
  crm_csi_ventas: 's-csiv',
  crm_csi_posventa: 's-csip',
};

async function postBatchSheets(table, records, replaceAll) {
  const res = await fetch(`${BASE}/api/crm/sheets/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': KEY,
      Accept: 'application/json',
    },
    body: JSON.stringify({
      table,
      records,
      replaceAll: Boolean(replaceAll),
      source: 'push-crm-sheets-cloud',
    }),
    signal: AbortSignal.timeout(180000),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 404) return { fallback: true };
  if (!res.ok) {
    throw new Error(body.error || `HTTP ${res.status} al subir ${table}`);
  }
  return body;
}

/** Fallback: guarda en sync_entities (API ya desplegada) hasta que exista /sheets/ingest. */
async function postBatchSync(table, records) {
  const entity = ENTITY_BY_TABLE[table] || table;
  const periodKey = PERIOD_BY_TABLE[table] || 's-other';
  const payload = {
    domain: 'crm',
    syncType: 'incremental',
    periodKey,
    periodStart: null,
    periodEnd: null,
    sourceHost: require('os').hostname(),
    meta: { table, source: 'push-crm-sheets-cloud' },
    records: records.map((row) => ({
      id: `${entity}|${row.id != null ? row.id : JSON.stringify(row).slice(0, 80)}`,
      data: { entity, ...row },
    })),
  };
  const res = await fetch(`${BASE}/api/sync/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': KEY,
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(180000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `HTTP ${res.status} sync ingest ${table}`);
  }
  return { ...body, via: 'sync_entities' };
}

async function postBatch(table, records, replaceAll, mode) {
  if (mode === 'sync') return postBatchSync(table, records);
  const direct = await postBatchSheets(table, records, replaceAll);
  if (direct.fallback) {
    console.warn(`  /api/crm/sheets/ingest no desplegado → sync_entities (${table})`);
    return postBatchSync(table, records);
  }
  return direct;
}

async function pushTable(db, table, { replace, mode }) {
  const exists = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ?",
  ).get(table);
  if (!exists) {
    console.warn(`  omitida ${table}: no existe en SQLite`);
    return { table, skipped: true };
  }
  const total = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n || 0);
  console.log(`→ ${table}: ${total} filas`);
  if (!total) return { table, upserted: 0, total: 0 };

  let offset = 0;
  let upserted = 0;
  let first = true;
  let via = mode || 'sheets';
  while (offset < total) {
    const rows = db.prepare(`SELECT * FROM ${table} LIMIT ? OFFSET ?`).all(BATCH, offset);
    if (!rows.length) break;
    const result = await postBatch(table, rows, replace && first, mode);
    if (result.via === 'sync_entities') via = 'sync_entities';
    first = false;
    upserted += Number(result.upserted || result.recordCount || rows.length);
    offset += rows.length;
    process.stdout.write(`  ${Math.min(offset, total)}/${total}\r`);
  }
  console.log(`  OK ${table}: enviadas ${upserted} (${via})`);
  return { table, upserted, local: total, via };
}

async function main() {
  if (!BASE || !KEY) {
    console.error('Faltan CLOUD_SYNC_URL / CLOUD_SYNC_API_KEY');
    process.exit(1);
  }
  const args = parseArgs(process.argv.slice(2));
  const tables = args.tablas?.length ? args.tablas : DEFAULT_TABLES;
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  const results = [];
  try {
    for (const table of tables) {
      results.push(await pushTable(db, table, { replace: args.replace, mode: args.mode }));
    }
  } finally {
    db.close();
  }
  console.log('\nResumen:');
  console.table(results);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
