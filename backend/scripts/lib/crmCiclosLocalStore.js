/**
 * Upsert incremental en SQLite local (crm_actividades) sin DROP TABLE.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { rowKeyFromCloudRow } = require('./crmCiclosParse');

const DB_PATH = path.join(__dirname, '../../data/crm-ciclos.db');

const SQLITE_COLUMNS = [
  'row_key',
  'id_contacto', 'nombre_contacto', 'id_ciclo', 'fecha_inicio_ciclo',
  'fecha_esperada_cierre', 'estatus', 'fecha_estatus', 'tipo_actividad',
  'fecha_crea_actividad', 'fecha_prog_actividad', 'fecha_resp_actividad',
  'resultado_actividad', 'forma_contacto', 'medio_contacto', 'submedio_contacto',
  'num_factura', 'facturado_a', 'producto_vendido', 'fecha_factura', 'vin',
  'fecha_entrega', 'vendedor',
];

function ensureSchema(db) {
  const table = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='crm_actividades'"
  ).get();

  if (!table) {
    db.exec(`
      CREATE TABLE crm_actividades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        row_key TEXT,
        id_contacto TEXT NOT NULL,
        nombre_contacto TEXT,
        id_ciclo TEXT,
        fecha_inicio_ciclo TEXT,
        fecha_esperada_cierre TEXT,
        estatus TEXT,
        fecha_estatus TEXT,
        tipo_actividad TEXT,
        fecha_crea_actividad TEXT,
        fecha_prog_actividad TEXT,
        fecha_resp_actividad TEXT,
        resultado_actividad TEXT,
        forma_contacto TEXT,
        medio_contacto TEXT,
        submedio_contacto TEXT,
        num_factura TEXT,
        facturado_a TEXT,
        producto_vendido TEXT,
        fecha_factura TEXT,
        vin TEXT,
        fecha_entrega TEXT,
        vendedor TEXT
      );
      CREATE UNIQUE INDEX idx_crm_actividades_row_key ON crm_actividades (row_key);
      CREATE INDEX idx_crm_contacto ON crm_actividades (id_contacto);
      CREATE INDEX idx_crm_ciclo ON crm_actividades (id_ciclo);
      CREATE INDEX idx_crm_vin ON crm_actividades (vin);
      CREATE INDEX idx_crm_nombre ON crm_actividades (nombre_contacto);
      CREATE INDEX idx_crm_factura ON crm_actividades (num_factura);
    `);
    return;
  }

  const cols = db.prepare('PRAGMA table_info(crm_actividades)').all();
  const hasRowKey = cols.some((c) => c.name === 'row_key');
  if (!hasRowKey) {
    db.exec('ALTER TABLE crm_actividades ADD COLUMN row_key TEXT');
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_actividades_row_key ON crm_actividades (row_key)');
}

function openLocalStore() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  ensureSchema(db);
  return db;
}

function valuesFromCloudRow(row) {
  return [
    rowKeyFromCloudRow(row),
    row.id_contacto || null,
    row.nombre_contacto || null,
    row.id_ciclo || null,
    row.fecha_inicio_ciclo || null,
    row.fecha_esperada_cierre || null,
    row.estatus || null,
    row.fecha_estatus || null,
    row.tipo_actividad || null,
    row.fecha_crea_actividad || null,
    row.fecha_prog_actividad || null,
    row.fecha_resp_actividad || null,
    row.resultado_actividad || null,
    row.forma_contacto || null,
    row.medio_contacto || null,
    row.submedio_contacto || null,
    row.num_factura || null,
    row.facturado_a || null,
    row.producto_vendido || null,
    row.fecha_factura || null,
    row.vin || null,
    row.fecha_entrega || null,
    row.vendedor || null,
  ];
}

function upsertLocalBatch(db, cloudRows) {
  if (!cloudRows.length) return { inserted: 0, updated: 0 };

  const placeholders = SQLITE_COLUMNS.map(() => '?').join(', ');
  const updates = SQLITE_COLUMNS
    .filter((c) => c !== 'row_key')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');

  const existsStmt = db.prepare('SELECT id FROM crm_actividades WHERE row_key = ?');
  const upsertStmt = db.prepare(`
    INSERT INTO crm_actividades (${SQLITE_COLUMNS.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT(row_key) DO UPDATE SET ${updates}
  `);

  let inserted = 0;
  let updated = 0;
  const tx = db.transaction((rows) => {
    for (const row of rows) {
      const key = rowKeyFromCloudRow(row);
      const before = existsStmt.get(key);
      upsertStmt.run(...valuesFromCloudRow(row));
      if (before) updated += 1;
      else inserted += 1;
    }
  });
  tx(cloudRows);
  return { inserted, updated };
}

function localStats(db) {
  return {
    actividades: db.prepare('SELECT COUNT(*) AS n FROM crm_actividades').get().n,
    contactos: db.prepare('SELECT COUNT(DISTINCT id_contacto) AS n FROM crm_actividades').get().n,
    conRowKey: db.prepare("SELECT COUNT(*) AS n FROM crm_actividades WHERE row_key IS NOT NULL AND trim(row_key) <> ''").get().n,
    maxFechaInicio: db.prepare(`
      SELECT MAX(fecha_inicio_ciclo) AS n FROM crm_actividades WHERE fecha_inicio_ciclo GLOB '????-??-??'
    `).get().n,
  };
}

module.exports = {
  DB_PATH,
  openLocalStore,
  upsertLocalBatch,
  localStats,
};
