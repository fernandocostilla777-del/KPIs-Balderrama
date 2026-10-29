'use strict';
/**
 * Baja ciclos CRM desde la nube (Railway) a SQLite local (crm_ciclos_live).
 * Permite modo híbrido sin PG_READONLY_URL: usa CLOUD_SYNC_URL + CLOUD_SYNC_API_KEY
 * contra GET /api/crm.
 *
 * Flujo deseado:
 *   Oficina (SQLite completo) ──cloud-sync / crm ingest──▶ Railway
 *   Escritorio sin .db completo ◀── este pull ── Railway → crm_ciclos_live
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.CRM_SQLITE_PATH
  || path.join(__dirname, '../../data/crm-ciclos.db');
const PAGE = Math.min(parseInt(process.env.CRM_CLOUD_PULL_PAGE || '2000', 10) || 2000, 5000);

const COLUMNS = [
  'id_contacto', 'nombre_contacto', 'id_ciclo', 'fecha_inicio_ciclo',
  'fecha_esperada_cierre', 'estatus', 'fecha_estatus', 'tipo_actividad',
  'fecha_crea_actividad', 'fecha_prog_actividad', 'fecha_resp_actividad',
  'resultado_actividad', 'forma_contacto', 'medio_contacto', 'submedio_contacto',
  'num_factura', 'facturado_a', 'producto_vendido', 'fecha_factura', 'vin',
  'fecha_entrega', 'vendedor',
];

function cloudBaseUrl() {
  const url = String(process.env.CLOUD_READ_URL || process.env.CLOUD_SYNC_URL || '').trim();
  return url.replace(/\/$/, '');
}

function cloudApiKey() {
  return String(process.env.CLOUD_SYNC_API_KEY || '').trim();
}

function canPullViaApi() {
  return Boolean(cloudBaseUrl() && cloudApiKey());
}

const SHEET_TABLES = [
  'crm_leads',
  'crm_trafico_piso',
  'crm_solicitudes',
  'crm_pruebas_manejo',
  'crm_financiamiento',
  'crm_pagos_gmf',
  'crm_csi_ventas',
  'crm_csi_posventa',
];

function ensureActividadesView(db) {
  const hasTable = !!db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'crm_actividades'",
  ).get();
  if (hasTable) return;
  db.exec(`
    DROP VIEW IF EXISTS crm_actividades;
    CREATE VIEW crm_actividades AS
    SELECT
      NULL AS id,
      row_key,
      id_contacto, nombre_contacto, id_ciclo, fecha_inicio_ciclo,
      fecha_esperada_cierre, estatus, fecha_estatus, tipo_actividad,
      fecha_crea_actividad, fecha_prog_actividad, fecha_resp_actividad,
      resultado_actividad, forma_contacto, medio_contacto, submedio_contacto,
      num_factura, facturado_a, producto_vendido, fecha_factura, vin,
      fecha_entrega, vendedor
    FROM crm_ciclos_live;
  `);
}

function ensureDbFile() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_ciclos_live (
      row_key TEXT PRIMARY KEY,
      ${COLUMNS.map((c) => `${c} TEXT`).join(',\n      ')},
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ccl_contacto ON crm_ciclos_live (id_contacto);
    CREATE INDEX IF NOT EXISTS idx_ccl_ciclo ON crm_ciclos_live (id_ciclo);
    CREATE INDEX IF NOT EXISTS idx_ccl_factura ON crm_ciclos_live (fecha_factura);
    CREATE TABLE IF NOT EXISTS crm_ciclos_live_meta (
      clave TEXT PRIMARY KEY,
      valor TEXT
    );
  `);
  ensureActividadesView(db);
  return db;
}

function metaGet(db, clave) {
  return db.prepare('SELECT valor FROM crm_ciclos_live_meta WHERE clave = ?').get(clave)?.valor || null;
}

function metaSet(db, clave, valor) {
  db.prepare(
    `INSERT INTO crm_ciclos_live_meta (clave, valor) VALUES (?, ?)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`,
  ).run(clave, valor);
}

function mapCicloToLive(row) {
  const idContacto = String(row.idContacto || row.id_contacto || '').trim();
  const idCiclo = String(row.idCiclo || row.id_ciclo || '').trim();
  const tipo = String(row.tipoActividad || row.tipo_actividad || '').trim();
  const fechaCrea = String(row.fechaCreaActividad || row.fecha_crea_actividad || '').trim();
  const vin = String(row.vin || '').trim();
  const factura = String(row.numFactura || row.num_factura || '').trim();
  const rowKey = String(row.row_key || row.rowKey || '')
    || [idContacto, idCiclo, tipo, fechaCrea, vin, factura].filter(Boolean).join('|')
    || String(row.id || '');
  if (!rowKey) return null;
  return {
    row_key: rowKey,
    id_contacto: idContacto || null,
    nombre_contacto: row.nombreContacto || row.nombre_contacto || null,
    id_ciclo: idCiclo || null,
    fecha_inicio_ciclo: row.fechaInicioCiclo || row.fecha_inicio_ciclo || null,
    fecha_esperada_cierre: row.fechaEsperadaCierre || row.fecha_esperada_cierre || null,
    estatus: row.estatus || null,
    fecha_estatus: row.fechaEstatus || row.fecha_estatus || null,
    tipo_actividad: tipo || null,
    fecha_crea_actividad: fechaCrea || null,
    fecha_prog_actividad: row.fechaProgActividad || row.fecha_prog_actividad || null,
    fecha_resp_actividad: row.fechaRespActividad || row.fecha_resp_actividad || null,
    resultado_actividad: row.resultadoActividad || row.resultado_actividad || null,
    forma_contacto: row.formaContacto || row.forma_contacto || null,
    medio_contacto: row.medioContacto || row.medio_contacto || null,
    submedio_contacto: row.submedioContacto || row.submedio_contacto || null,
    num_factura: factura || null,
    facturado_a: row.facturadoA || row.facturado_a || null,
    producto_vendido: row.productoVendido || row.producto_vendido || null,
    fecha_factura: row.fechaFactura || row.fecha_factura || null,
    vin: vin || null,
    fecha_entrega: row.fechaEntrega || row.fecha_entrega || null,
    vendedor: row.vendedor || null,
    updated_at: new Date().toISOString(),
  };
}

async function fetchCrmPage({ offset, limit, q }) {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  if (q) params.set('q', q);
  const url = `${cloudBaseUrl()}/api/crm?${params}`;
  const res = await fetch(url, {
    headers: { 'X-API-Key': cloudApiKey(), Accept: 'application/json' },
    signal: AbortSignal.timeout(120000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `HTTP ${res.status} al leer /api/crm`);
  }
  return Array.isArray(body.ciclos) ? body.ciclos : [];
}

/**
 * Descarga páginas de /api/crm y las guarda en crm_ciclos_live.
 * @param {{ full?: boolean, maxRows?: number }} [opts]
 */
async function pullCrmCiclosFromCloud(opts = {}) {
  if (!canPullViaApi()) {
    return { ok: false, skipped: true, reason: 'faltan CLOUD_SYNC_URL/CLOUD_READ_URL o CLOUD_SYNC_API_KEY' };
  }

  const db = ensureDbFile();
  const upsert = db.prepare(`
    INSERT INTO crm_ciclos_live (row_key, ${COLUMNS.join(', ')}, updated_at)
    VALUES (@row_key, ${COLUMNS.map((c) => `@${c}`).join(', ')}, @updated_at)
    ON CONFLICT(row_key) DO UPDATE SET
      ${COLUMNS.map((c) => `${c} = excluded.${c}`).join(', ')},
      updated_at = excluded.updated_at
  `);
  const guardar = db.transaction((rows) => {
    for (const r of rows) upsert.run(r);
  });

  const maxRows = opts.maxRows || parseInt(process.env.CRM_CLOUD_PULL_MAX || '100000', 10) || 100000;
  let offset = 0;
  let total = 0;
  const t0 = Date.now();

  try {
    for (;;) {
      const page = await fetchCrmPage({ offset, limit: PAGE });
      if (!page.length) break;
      const mapped = page.map(mapCicloToLive).filter(Boolean);
      if (mapped.length) guardar(mapped);
      total += mapped.length;
      offset += page.length;
      if (page.length < PAGE || total >= maxRows) break;
    }
    metaSet(db, 'synced_at', new Date().toISOString());
    metaSet(db, 'source', 'cloud-api');
    ensureActividadesView(db);
    const n = db.prepare('SELECT COUNT(*) n FROM crm_ciclos_live').get().n;
    let sheets = null;
    if (opts.sheets !== false) {
      try {
        sheets = await pullCrmSheetsFromCloud({ db });
      } catch (err) {
        sheets = { ok: false, error: err.message };
      }
    }
    return {
      ok: true,
      pulled: total,
      tableRows: n,
      sheets,
      ms: Date.now() - t0,
      dbPath: DB_PATH,
      lastSync: metaGet(db, 'synced_at'),
    };
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

async function fetchSheetPage(table, { offset, limit }) {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  const url = `${cloudBaseUrl()}/api/crm/sheets/${encodeURIComponent(table)}?${params}`;
  const res = await fetch(url, {
    headers: { 'X-API-Key': cloudApiKey(), Accept: 'application/json' },
    signal: AbortSignal.timeout(120000),
  });
  if (res.status === 404) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `HTTP ${res.status} al leer /api/crm/sheets/${table}`);
  }
  return Array.isArray(body.rows) ? body.rows : [];
}

function recreateSheetTable(db, table, sampleRow) {
  const keys = Object.keys(sampleRow || {})
    .filter((k) => k !== 'row_key' && k !== 'updated_at' && k !== 'entity')
    .filter((k) => /^[a-z_][a-z0-9_]*$/i.test(k));
  if (!keys.length) return null;
  const cols = keys.map((k) => `"${k}" TEXT`).join(', ');
  db.exec(`DROP TABLE IF EXISTS ${table}`);
  db.exec(`CREATE TABLE ${table} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ${cols}
  )`);
  return keys;
}

/**
 * Baja tablas Sheets desde Railway a SQLite local.
 * Requiere cloud-api con /api/crm/sheets/* desplegado.
 */
async function pullCrmSheetsFromCloud(opts = {}) {
  if (!canPullViaApi()) {
    return { ok: false, skipped: true, reason: 'faltan CLOUD_SYNC_URL o CLOUD_SYNC_API_KEY' };
  }
  const ownDb = !opts.db;
  const db = opts.db || ensureDbFile();
  const tables = opts.tables || SHEET_TABLES;
  const result = { ok: true, tables: {} };
  try {
    for (const table of tables) {
      let offset = 0;
      let columns = null;
      let insert = null;
      let total = 0;
      let unavailable = false;
      for (;;) {
        const page = await fetchSheetPage(table, { offset, limit: PAGE });
        if (page === null) {
          unavailable = true;
          break;
        }
        if (!page.length) break;
        if (!columns) {
          columns = recreateSheetTable(db, table, page[0]);
          if (!columns) break;
          const placeholders = columns.map(() => '?').join(',');
          insert = db.prepare(
            `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(',')}) VALUES (${placeholders})`,
          );
        }
        const tx = db.transaction((rows) => {
          for (const row of rows) {
            insert.run(...columns.map((c) => (row[c] == null ? null : String(row[c]))));
          }
        });
        tx(page);
        total += page.length;
        offset += page.length;
        if (page.length < PAGE) break;
      }
      if (unavailable) {
        result.tables[table] = { skipped: true, reason: 'endpoint no desplegado' };
        result.ok = false;
        result.needsDeploy = true;
        break;
      }
      result.tables[table] = { pulled: total };
    }
    return result;
  } finally {
    if (ownDb) {
      try { db.close(); } catch { /* ignore */ }
    }
  }
}

function localCrmStatus() {
  const exists = fs.existsSync(DB_PATH);
  if (!exists) {
    return { exists: false, dbPath: DB_PATH, ciclosLive: 0, syncedAt: null, sheets: {} };
  }
  try {
    const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    const hasLive = !!db.prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name='crm_ciclos_live'`,
    ).get();
    const ciclosLive = hasLive
      ? Number(db.prepare('SELECT COUNT(*) n FROM crm_ciclos_live').get()?.n || 0)
      : 0;
    const syncedAt = hasLive ? metaGet(db, 'synced_at') : null;
    const sheets = {};
    for (const table of SHEET_TABLES) {
      const has = !!db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ?",
      ).get(table);
      sheets[table] = has
        ? Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n || 0)
        : 0;
    }
    db.close();
    return { exists: true, dbPath: DB_PATH, ciclosLive, syncedAt, sheets };
  } catch (err) {
    return { exists: true, dbPath: DB_PATH, error: err.message };
  }
}

module.exports = {
  canPullViaApi,
  pullCrmCiclosFromCloud,
  pullCrmSheetsFromCloud,
  localCrmStatus,
  ensureDbFile,
  SHEET_TABLES,
  DB_PATH,
};
