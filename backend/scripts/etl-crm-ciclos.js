/**
 * ETL histórico: carga completa "Balderrama Ciclos" a SQLite local.
 *
 * Fuente : CSV o XLSX export del CRM (ID_CONTACTO = ID CRM)
 * Destino: backend/data/crm-ciclos.db  · tabla crm_actividades (archivo histórico)
 *
 * Para seguir alimentando el embudo BDC y el histórico local use:
 *   node backend/scripts/ingest-crm-ciclos-railway.js "<export reciente>"
 *
 * Uso (solo reconstrucción histórica — borra y recrea crm_actividades):
 *   node backend/scripts/etl-crm-ciclos.js --historical "C:/ruta/Balderrama acumulados ciclos.xlsx"
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const XLSX = require('xlsx');
const Database = require('better-sqlite3');

const DEFAULT_SOURCE = 'C:/Users/ABP-SDN-SI-221/Documents/JULIO 26/Balderrama acumulados ciclos.xlsx';
const DB_PATH = path.join(__dirname, '../data/crm-ciclos.db');

const COLUMNS = [
  'ID_CONTACTO', 'NOMBRE_CONTACTO', 'ID_CICLO', 'FECHA_INICIO_CICLO',
  'FECHA_ESPERADA_CIERRE', 'ESTATUS', 'FECHA_ESTATUS', 'TIPO_ACTIVIDAD',
  'FECHA_CREA_ACTIVIDAD', 'FECHA_PROG_ACTIVIDAD', 'FECHA_RESP_ACTIVIDAD',
  'RESULTADO_ACTIVIDAD', 'FORMA_CONTACTO', 'MEDIO_CONTACTO', 'SUBMEDIO_CONTACTO',
  'NUM_FACTURA', 'FACTURADO_A', 'PRODUCTO_VENDIDO', 'FECHA_FACTURA', 'VIN',
  'FECHA_ENTREGA', 'VENDEDOR',
];

const DATE_COLS = new Set([
  'FECHA_INICIO_CICLO', 'FECHA_ESPERADA_CIERRE', 'FECHA_ESTATUS',
  'FECHA_CREA_ACTIVIDAD', 'FECHA_PROG_ACTIVIDAD', 'FECHA_RESP_ACTIVIDAD',
  'FECHA_FACTURA', 'FECHA_ENTREGA',
]);

function toIso(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const number = Number(value);
  if (Number.isFinite(number) && number > 20000 && number < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + number * 86400000).toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

function cleanText(value) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || null;
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

function mapRecord(header, cells) {
  const rec = {};
  for (let i = 0; i < COLUMNS.length; i++) {
    const col = COLUMNS[i];
    const idx = header.indexOf(col);
    let val = idx >= 0 ? cells[idx] : null;
    if (DATE_COLS.has(col)) val = toIso(val);
    else val = cleanText(val);
    rec[col] = val;
  }
  return rec;
}

function valuesFromRecord(rec) {
  return [
    rec.ID_CONTACTO, rec.NOMBRE_CONTACTO, rec.ID_CICLO, rec.FECHA_INICIO_CICLO,
    rec.FECHA_ESPERADA_CIERRE, rec.ESTATUS, rec.FECHA_ESTATUS, rec.TIPO_ACTIVIDAD,
    rec.FECHA_CREA_ACTIVIDAD, rec.FECHA_PROG_ACTIVIDAD, rec.FECHA_RESP_ACTIVIDAD,
    rec.RESULTADO_ACTIVIDAD, rec.FORMA_CONTACTO, rec.MEDIO_CONTACTO, rec.SUBMEDIO_CONTACTO,
    rec.NUM_FACTURA, rec.FACTURADO_A, rec.PRODUCTO_VENDIDO, rec.FECHA_FACTURA, rec.VIN,
    rec.FECHA_ENTREGA, rec.VENDEDOR,
  ];
}

async function loadFromCsv(csvPath, insertMany) {
  let header = null;
  let total = 0;
  let skipped = 0;
  let batch = [];
  const BATCH_SIZE = 5000;

  const rl = readline.createInterface({
    input: fs.createReadStream(csvPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!header) {
      header = parseCsvLine(line.replace(/^\uFEFF/, '')).map((h) => h.trim().toUpperCase());
      continue;
    }
    if (!line.trim()) continue;
    const rec = mapRecord(header, parseCsvLine(line));
    if (!rec.ID_CONTACTO) { skipped += 1; continue; }
    batch.push(valuesFromRecord(rec));
    if (batch.length >= BATCH_SIZE) {
      insertMany(batch);
      total += batch.length;
      batch = [];
      if (total % 100000 === 0) console.log(`  ${total.toLocaleString()} filas...`);
    }
  }
  if (batch.length) {
    insertMany(batch);
    total += batch.length;
  }
  return { total, skipped };
}

function loadFromXlsx(xlsxPath, insertMany) {
  console.log('Leyendo XLSX...');
  const workbook = XLSX.readFile(xlsxPath);
  const sheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: null,
    raw: true,
  });
  if (!rows.length) throw new Error('El Excel no tiene filas');

  const header = rows[0].map((h) => String(h || '').trim().toUpperCase());
  let total = 0;
  let skipped = 0;
  let batch = [];
  const BATCH_SIZE = 5000;

  for (let i = 1; i < rows.length; i++) {
    const rec = mapRecord(header, rows[i] || []);
    if (!rec.ID_CONTACTO) { skipped += 1; continue; }
    batch.push(valuesFromRecord(rec));
    if (batch.length >= BATCH_SIZE) {
      insertMany(batch);
      total += batch.length;
      batch = [];
      if (total % 100000 === 0) console.log(`  ${total.toLocaleString()} filas...`);
    }
  }
  if (batch.length) {
    insertMany(batch);
    total += batch.length;
  }
  console.log(`Hoja "${sheetName}" procesada`);
  return { total, skipped };
}

async function run() {
  const args = process.argv.slice(2);
  const historical = args.includes('--historical');
  const sourcePath = args.find((a) => a !== '--historical') || DEFAULT_SOURCE;

  if (!historical) {
    console.error('Este ETL reemplaza la tabla histórica local. Para carga operativa en Railway use:');
    console.error('  node backend/scripts/ingest-crm-ciclos-railway.js "<export Balderrama Ciclos>"');
    console.error('Si desea reconstruir el histórico local, agregue --historical');
    process.exit(1);
  }

  if (!fs.existsSync(sourcePath)) {
    console.error(`No existe el archivo: ${sourcePath}`);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = OFF');

  console.warn('Modo --historical: se reemplazará crm_actividades en SQLite local.');
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
  const insertMany = db.transaction((rows) => {
    for (const row of rows) insert.run(row);
  });

  const ext = path.extname(sourcePath).toLowerCase();
  console.log('Cargando', sourcePath, '...');
  const { total, skipped } = ext === '.xlsx' || ext === '.xls'
    ? loadFromXlsx(sourcePath, insertMany)
    : await loadFromCsv(sourcePath, insertMany);

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
    comprasConVin: db.prepare("SELECT COUNT(DISTINCT vin) AS n FROM crm_actividades WHERE vin IS NOT NULL AND trim(vin) <> ''").get().n,
  };
  db.close();

  console.log('\nCarga completa →', DB_PATH);
  console.table([stats]);
}

run().catch((err) => { console.error(err); process.exit(1); });
