'use strict';
/**
 * Migración del CRM de SQLite a PostgreSQL (etapa 1).
 *
 * Las pruebas unitarias corren siempre. Las de integración necesitan un
 * PostgreSQL vacío de pruebas:  CRM_PG_URL_TEST=postgresql://…  npm test
 * (sin esa variable se omiten). Todos los datos son sintéticos.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-pg-'));
const SQLITE = path.join(TMP, 'crm-ciclos.db');
process.env.CRM_SQLITE_PATH = SQLITE;

const Database = require('better-sqlite3');
const crmStore = require('../src/db/crmStore');
const { migrarTodo, migrarTabla, pgType, coerce } = require('../scripts/migrar-crm-a-postgres');
const { getComisionesFi } = require('../src/services/comisionesFiService');

const PG_URL = process.env.CRM_PG_URL_TEST;
const conPg = { skip: PG_URL ? false : 'define CRM_PG_URL_TEST para probar contra PostgreSQL' };

// ── Unitarias ───────────────────────────────────────────────────────────────

test('los marcadores ? se convierten a $n sin tocar texto entre comillas', () => {
  assert.equal(
    crmStore.toPgPlaceholders("SELECT * FROM t WHERE a = ? AND b = '¿?' AND c = ?"),
    "SELECT * FROM t WHERE a = $1 AND b = '¿?' AND c = $2",
  );
  assert.equal(crmStore.toPgPlaceholders("x = 'it''s ?' OR y = ?"), "x = 'it''s ?' OR y = $1");
});

test('tipos de SQLite → PostgreSQL', () => {
  assert.equal(pgType('INTEGER'), 'bigint');
  assert.equal(pgType('REAL'), 'double precision');
  assert.equal(pgType('TEXT'), 'text');
  assert.equal(pgType(''), 'text');
});

test('texto en columna numérica: solo números limpios se convierten; lo demás queda NULL y se cuenta', () => {
  const stats = { raros: {}, convertidos: {} };
  assert.equal(coerce(' 1200.5 ', 'double precision', stats, 'm'), 1200.5);
  assert.equal(coerce('$1,200.50', 'double precision', stats, 'm'), null); // no se «limpia»: movería cifras
  assert.equal(coerce('N/A', 'double precision', stats, 'm'), null);
  assert.equal(coerce('', 'double precision', stats, 'm'), null);
  assert.equal(coerce(7.9, 'bigint', stats, 'p'), 7);
  assert.deepEqual(stats, { raros: { m: 2 }, convertidos: { m: 1 } });
});

test('sin base cargada, Comisiones F&I responde «sin datos» en lugar de error', async () => {
  const prev = process.env.CRM_DB;
  process.env.CRM_DB = 'sqlite';
  try {
    const r = await getComisionesFi({ fechaInicio: '2026-09-01', fechaFin: '2026-09-30' });
    assert.equal(r.sinDatos, true);
    assert.equal(r.detalleTotal, 0);
  } finally {
    process.env.CRM_DB = prev;
  }
});

// ── Integración con PostgreSQL ──────────────────────────────────────────────

/** Crea la base SQLite con el DDL real del ETL de financiamiento + datos sintéticos. */
function crearSqliteSintetica() {
  const etl = fs.readFileSync(path.join(__dirname, '../scripts/etl-crm-financiamiento.js'), 'utf8');
  const ddl = etl.slice(etl.indexOf('CREATE TABLE crm_financiamiento'), etl.indexOf(');', etl.indexOf('CREATE TABLE crm_financiamiento')) + 2);
  const db = new Database(SQLITE);
  db.exec(ddl);
  db.exec(`
    CREATE INDEX idx_fin_vin ON crm_financiamiento (vin);
    CREATE TABLE crm_ciclos_live (row_key TEXT PRIMARY KEY, id_contacto TEXT, fecha_factura TEXT);
    CREATE INDEX idx_ccl_contacto ON crm_ciclos_live (id_contacto);
  `);
  const ins = db.prepare(`INSERT INTO crm_financiamiento
    (fecha_compra, cliente, asesor, unidad, vin, contrato, plazo_meses, maf_comision, gap_monto,
     garantia_extendida_monto, cx_garantia, fi, afi)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const filas = [
    ['2026-09-03', 'CLIENTE A', 'VENDEDOR 1', 'ONIX', 'VINPRUEBA000000001', 'C1', 48, 250000, 9000, 12000, 1500, 'F&I SERDAN', 'AFI UNO'],
    ['2026-09-15', 'CLIENTE B', 'VENDEDOR 2', 'TRAX', 'VINPRUEBA000000002', 'C2', 36, 310000, 0, 8000, 900, 'F&I SERDAN', 'AFI DOS'],
    ['2026-09-20', 'CLIENTE C', 'VENDEDOR 1', 'AVEO', 'VINPRUEBA000000003', 'C3', '24', '$1,200', 'N/A', null, null, 'FERNANDO', null],
    ['2026-08-30', 'CLIENTE D', 'VENDEDOR 3', 'TAHOE', 'VINPRUEBA000000004', 'C4', 60, 900000, 15000, 20000, 2500, 'F&I SERDAN', 'AFI UNO'],
  ];
  db.transaction(() => filas.forEach((f) => ins.run(...f)))();
  db.prepare('INSERT INTO crm_ciclos_live VALUES (?, ?, ?)').run('k1', 'C-1', '2026-09-01');
  db.close();
}

test('migración a PostgreSQL: cuadra, reporta texto raro e intercambia sin dejar la tabla vacía', conPg, async (t) => {
  const { Client } = require('pg');
  crearSqliteSintetica();
  const pg = new Client({ connectionString: PG_URL });
  await pg.connect();
  t.after(() => pg.end());
  await pg.query('DROP TABLE IF EXISTS crm_financiamiento, crm_ciclos_live, crm_migracion_log');
  await pg.query('CREATE TABLE crm_migracion_log (tabla text PRIMARY KEY, filas bigint, columnas_con_texto_en_numero jsonb, migrado_en timestamptz)');

  const db = new Database(SQLITE, { readonly: true });
  t.after(() => db.close());

  const r = await migrarTabla(db, pg, 'crm_financiamiento');
  assert.equal(r.ok, true, r.problemas.join('; '));
  assert.equal(r.filas, 4);
  assert.deepEqual(r.convertidos, {}); // '24' ya lo convierte SQLite (columna INTEGER)
  assert.deepEqual(r.raros, { maf_comision: 1, gap_monto: 1 }); // '$1,200' y 'N/A'

  const { rows: [suma] } = await pg.query('SELECT SUM(maf_comision) AS s, COUNT(*) AS n FROM crm_financiamiento');
  assert.equal(Number(suma.s), 250000 + 310000 + 900000);

  // Índice conservado y la clave sigue generando ids nuevos.
  const { rows: idx } = await pg.query("SELECT indexname FROM pg_indexes WHERE tablename = 'crm_financiamiento'");
  assert.ok(idx.some((i) => i.indexname === 'idx_fin_vin'));
  const { rows: [nuevo] } = await pg.query("INSERT INTO crm_financiamiento (vin) VALUES ('VINNUEVO') RETURNING id");
  assert.equal(Number(nuevo.id), 5);

  // Clave de texto (crm_ciclos_live) también migra.
  const r2 = await migrarTabla(db, pg, 'crm_ciclos_live');
  assert.equal(r2.ok, true);

  // Recarga: mientras se llena __nuevo, la tabla vigente sigue completa.
  const lector = new Client({ connectionString: PG_URL });
  await lector.connect();
  t.after(() => lector.end());
  const original = pg.query.bind(pg);
  let visto = null;
  pg.query = async (sql, params) => {
    if (visto === null && /^INSERT INTO "crm_financiamiento__nuevo"/.test(sql)) {
      visto = Number((await lector.query('SELECT COUNT(*) AS n FROM crm_financiamiento')).rows[0].n);
    }
    return original(sql, params);
  };
  const r3 = await migrarTabla(db, pg, 'crm_financiamiento');
  pg.query = original;
  assert.equal(r3.ok, true);
  assert.equal(visto, 5, 'durante la recarga el tablero debe seguir viendo los datos anteriores');
  const { rows: [despues] } = await pg.query('SELECT COUNT(*) AS n FROM crm_financiamiento');
  assert.equal(Number(despues.n), 4);
});

test('Comisiones F&I da el mismo resultado leyendo SQLite o PostgreSQL', conPg, async (t) => {
  const periodo = { fechaInicio: '2026-09-01', fechaFin: '2026-09-30' };
  process.env.CRM_DB = 'sqlite';
  const desdeSqlite = await getComisionesFi(periodo);
  process.env.CRM_DB = 'postgres';
  process.env.CRM_PG_URL = PG_URL;
  t.after(async () => { process.env.CRM_DB = 'sqlite'; await crmStore.close(); });
  const desdePg = await getComisionesFi(periodo);

  assert.equal(desdeSqlite.detalleTotal, 3);
  assert.equal(desdePg.sinDatos, false);
  // Mismas cifras con cualquier motor: la migración no debe mover comisiones.
  assert.deepEqual(desdePg.totales, desdeSqlite.totales);
  assert.deepEqual(desdePg.porFi, desdeSqlite.porFi);
  assert.deepEqual(desdePg.depositos, desdeSqlite.depositos);
  assert.deepEqual(desdePg.detalle, desdeSqlite.detalle);
});

test('migrarTodo (la que usa la sincronización programada) copia todas las tablas', conPg, async () => {
  const r = await migrarTodo({ sqlitePath: SQLITE, pgUrl: PG_URL, log: null });
  assert.equal(r.ok, true);
  assert.deepEqual(r.tablas.map((t) => t.table).sort(), ['crm_ciclos_live', 'crm_financiamiento']);
});

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
