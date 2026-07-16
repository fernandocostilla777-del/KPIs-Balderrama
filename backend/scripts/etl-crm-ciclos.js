/**
 * ETL: carga "Balderrama Ciclos" (CRM) a base interna SQLite.
 *
 * Fuente : CSV export del CRM (ID_CONTACTO = ID CRM)
 * Destino: backend/data/crm-ciclos.db  · tabla crm_actividades
 *
 * Uso:
 *   node backend/scripts/etl-crm-ciclos.js "C:/ruta/Balderrama Ciclos.csv"
 *   (sin argumento usa la ruta por defecto de Documents/MAYO 2026)
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const Database = require('better-sqlite3');

const DEFAULT_CSV = 'C:/Users/ABP-SDN-SI-221/Documents/MAYO 2026/Balderrama Ciclos.csv';
const DB_PATH = path.join(__dirname, '../data/crm-ciclos.db');

const COLUMNS = [
  'ID_CONTACTO', 'NOMBRE_CONTACTO', 'ID_CICLO', 'FECHA_INICIO_CICLO',
  'FECHA_ESPERADA_CIERRE', 'ESTATUS', 'FECHA_ESTATUS', 'TIPO_ACTIVIDAD',
  'FECHA_CREA_ACTIVIDAD', 'FECHA_PROG_ACTIVIDAD', 'FECHA_RESP_ACTIVIDAD',
  'RESULTADO_ACTIVIDAD', 'FORMA_CONTACTO', 'MEDIO_CONTACTO', 'SUBMEDIO_CONTACTO',
  'NUM_FACTURA', 'FACTURADO_A', 'PRODUCTO_VENDIDO', 'FECHA_FACTURA', 'VIN',
  'FECHA_ENTREGA', 'VENDEDOR',
];

// Fechas del CRM vienen dd/mm/yyyy → ISO yyyy-mm-dd para poder ordenar
function toIso(dmy) {
  const m = String(dmy || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

async function run() {
  const csvPath = process.argv[2] || DEFAULT_CSV;
  if (!fs.existsSync(csvPath)) {
    console.error(`No existe el archivo: ${csvPath}`);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = OFF');

  db.exec(`
    DROP TABLE IF EXISTS crm_actividades;
    CREATE TABLE crm_actividades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  `);

  const insert = db.prepare(`
    INSERT INTO crm_actividades (
      id_contacto, nombre_contacto, id_ciclo, fecha_inicio_ciclo,
      fecha_esperada_cierre, estatus, fecha_estatus, tipo_actividad,
      fecha_crea_actividad, fecha_prog_actividad, fecha_resp_actividad,
      resultado_actividad, forma_contacto, medio_contacto, submedio_contacto,
      num_factura, facturado_a, producto_vendido, fecha_factura, vin,
      fecha_entrega, vendedor
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  const DATE_COLS = new Set([
    'FECHA_INICIO_CICLO', 'FECHA_ESPERADA_CIERRE', 'FECHA_ESTATUS',
    'FECHA_CREA_ACTIVIDAD', 'FECHA_PROG_ACTIVIDAD', 'FECHA_RESP_ACTIVIDAD',
    'FECHA_FACTURA', 'FECHA_ENTREGA',
  ]);

  let header = null;
  let total = 0;
  let skipped = 0;
  let batch = [];
  const BATCH_SIZE = 5000;
  const insertMany = db.transaction((rows) => {
    for (const r of rows) insert.run(r);
  });

  // Export del CRM: UTF-8 con BOM
  const rl = readline.createInterface({
    input: fs.createReadStream(csvPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!header) {
      const clean = line.replace(/^\uFEFF/, '');
      header = parseCsvLine(clean).map((h) => h.trim().toUpperCase());
      continue;
    }
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    const rec = {};
    for (let i = 0; i < COLUMNS.length; i++) {
      const idx = header.indexOf(COLUMNS[i]);
      let val = idx >= 0 ? String(cells[idx] ?? '').trim() : '';
      if (DATE_COLS.has(COLUMNS[i])) val = toIso(val);
      rec[COLUMNS[i]] = val || null;
    }
    if (!rec.ID_CONTACTO) { skipped++; continue; }

    batch.push([
      rec.ID_CONTACTO, rec.NOMBRE_CONTACTO, rec.ID_CICLO, rec.FECHA_INICIO_CICLO,
      rec.FECHA_ESPERADA_CIERRE, rec.ESTATUS, rec.FECHA_ESTATUS, rec.TIPO_ACTIVIDAD,
      rec.FECHA_CREA_ACTIVIDAD, rec.FECHA_PROG_ACTIVIDAD, rec.FECHA_RESP_ACTIVIDAD,
      rec.RESULTADO_ACTIVIDAD, rec.FORMA_CONTACTO, rec.MEDIO_CONTACTO, rec.SUBMEDIO_CONTACTO,
      rec.NUM_FACTURA, rec.FACTURADO_A, rec.PRODUCTO_VENDIDO, rec.FECHA_FACTURA, rec.VIN,
      rec.FECHA_ENTREGA, rec.VENDEDOR,
    ]);
    if (batch.length >= BATCH_SIZE) {
      insertMany(batch);
      total += batch.length;
      batch = [];
      if (total % 100000 === 0) console.log(`  ${total.toLocaleString()} filas...`);
    }
  }
  if (batch.length) { insertMany(batch); total += batch.length; }

  console.log('Creando índices...');
  db.exec(`
    CREATE INDEX idx_crm_contacto ON crm_actividades (id_contacto);
    CREATE INDEX idx_crm_ciclo ON crm_actividades (id_ciclo);
    CREATE INDEX idx_crm_vin ON crm_actividades (vin);
    CREATE INDEX idx_crm_nombre ON crm_actividades (nombre_contacto);
    CREATE INDEX idx_crm_factura ON crm_actividades (num_factura);
  `);

  const stats = {
    filas: total,
    omitidas: skipped,
    contactos: db.prepare('SELECT COUNT(DISTINCT id_contacto) AS n FROM crm_actividades').get().n,
    ciclos: db.prepare('SELECT COUNT(DISTINCT id_ciclo) AS n FROM crm_actividades').get().n,
    facturas: db.prepare("SELECT COUNT(DISTINCT num_factura) AS n FROM crm_actividades WHERE num_factura IS NOT NULL").get().n,
  };
  db.close();

  console.log('\nCarga completa →', DB_PATH);
  console.table([stats]);
}

run().catch((err) => { console.error(err); process.exit(1); });
