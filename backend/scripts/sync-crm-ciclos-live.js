/**
 * Refleja los ciclos CRM en vivo (Postgres de solo lectura en Railway) dentro de
 * la base local, SIN tocar crm_actividades (el histórico del Excel fijo).
 *
 * Destino: backend/data/crm-ciclos.db · tabla crm_ciclos_live
 * Clave  : row_key (estable entre sincronizaciones; permite refresco incremental)
 *
 * Uso:
 *   node backend/scripts/sync-crm-ciclos-live.js            (solo cambios desde la última vez)
 *   node backend/scripts/sync-crm-ciclos-live.js --full      (relee toda la tabla remota)
 *
 * Requiere PG_READONLY_URL en backend/.env (usuario de solo lectura).
 */
const path = require('path');
const Database = require('better-sqlite3');
const { Client } = require('pg');

const DB_PATH = path.join(__dirname, '../data/crm-ciclos.db');
const PAGE = 20000;

const COLUMNS = [
  'id_contacto', 'nombre_contacto', 'id_ciclo', 'fecha_inicio_ciclo',
  'fecha_esperada_cierre', 'estatus', 'fecha_estatus', 'tipo_actividad',
  'fecha_crea_actividad', 'fecha_prog_actividad', 'fecha_resp_actividad',
  'resultado_actividad', 'forma_contacto', 'medio_contacto', 'submedio_contacto',
  'num_factura', 'facturado_a', 'producto_vendido', 'fecha_factura', 'vin',
  'fecha_entrega', 'vendedor',
];

function ensureSchema(db) {
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
}

function meta(db, clave, valor) {
  if (valor === undefined) {
    return db.prepare('SELECT valor FROM crm_ciclos_live_meta WHERE clave = ?').get(clave)?.valor || null;
  }
  db.prepare('INSERT INTO crm_ciclos_live_meta (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor')
    .run(clave, valor);
  return valor;
}

async function main() {
  const full = process.argv.includes('--full');
  const url = process.env.PG_READONLY_URL;
  if (!url) throw new Error('Falta PG_READONLY_URL en backend/.env');

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  ensureSchema(db);

  const desde = full ? null : meta(db, 'updated_at');
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 20000 });
  await client.connect();

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

  let total = 0;
  let cursor = null;
  let maxUpdated = desde;
  const t0 = Date.now();
  console.log(`[crm-ciclos-live] ${full || !desde ? 'carga completa' : `incremental desde ${desde}`}`);

  for (;;) {
    const params = [];
    const where = [];
    if (desde) { params.push(desde); where.push(`updated_at > $${params.length}`); }
    if (cursor) { params.push(cursor); where.push(`row_key > $${params.length}`); }
    params.push(PAGE);
    const sql = `
      SELECT row_key, ${COLUMNS.join(', ')}, updated_at
      FROM crm_ciclos
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY row_key
      LIMIT $${params.length}`;
    const res = await client.query(sql, params);
    if (!res.rows.length) break;
    const rows = res.rows.map((r) => {
      const out = { row_key: r.row_key };
      for (const c of COLUMNS) out[c] = r[c] ? String(r[c]) : null;
      out.updated_at = r.updated_at ? new Date(r.updated_at).toISOString() : null;
      if (out.updated_at && (!maxUpdated || out.updated_at > maxUpdated)) maxUpdated = out.updated_at;
      return out;
    });
    guardar(rows);
    total += rows.length;
    cursor = res.rows[res.rows.length - 1].row_key;
    process.stdout.write(`\r[crm-ciclos-live] ${total.toLocaleString('es-MX')} filas`);
    if (res.rows.length < PAGE) break;
  }

  if (maxUpdated) meta(db, 'updated_at', maxUpdated);
  meta(db, 'synced_at', new Date().toISOString());
  const n = db.prepare('SELECT COUNT(*) n FROM crm_ciclos_live').get().n;
  console.log(`\n[crm-ciclos-live] listo: ${total.toLocaleString('es-MX')} filas en ${Math.round((Date.now() - t0) / 1000)} s · tabla local ${Number(n).toLocaleString('es-MX')} filas`);

  await client.end();
  db.close();
}

main().catch((err) => {
  console.error('[crm-ciclos-live] error:', err.message);
  process.exit(1);
});
