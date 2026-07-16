/**
 * ETL: hoja "Prueba de manejo" del Google Sheet a la base interna CRM.
 * Clave: columna P "ID de CRM" = ID_CONTACTO.
 * Uso: node backend/scripts/etl-crm-pruebas-manejo.js [ruta.xlsx]
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const Database = require('better-sqlite3');

const DEFAULT_XLSX = path.join(__dirname, '../data/leads-source.xlsx');
const DB_PATH = path.join(__dirname, '../data/crm-ciclos.db');

function clean(value) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || null;
}

function serialToIso(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (Number.isFinite(number) && number > 20000 && number < 60000) {
    return new Date(Date.UTC(1899, 11, 30) + number * 86400000).toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : null;
}

function excelTime(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (Number.isFinite(number) && number >= 0 && number < 1) {
    const minutes = Math.round(number * 24 * 60) % (24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  return clean(value);
}

function run() {
  const xlsxPath = process.argv[2] || DEFAULT_XLSX;
  if (!fs.existsSync(xlsxPath)) throw new Error(`No existe el archivo: ${xlsxPath}`);

  const workbook = XLSX.readFile(xlsxPath);
  const sheetName = workbook.SheetNames.find((name) => name.toLowerCase().includes('prueba de manejo'));
  if (!sheetName) throw new Error('No se encontró la hoja "Prueba de manejo"');
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null });

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    DROP TABLE IF EXISTS crm_pruebas_manejo;
    CREATE TABLE crm_pruebas_manejo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mes TEXT,
      fuerza_venta TEXT,
      centro_trabajo TEXT,
      fecha TEXT,
      hora_salida TEXT,
      ejecutivo_ventas TEXT,
      nombre_cliente TEXT,
      no_licencia TEXT,
      telefono TEXT,
      correo TEXT,
      auto_interes TEXT,
      tipo_auto TEXT,
      vin TEXT,
      kilometraje_inicial REAL,
      kilometraje_final REAL,
      id_crm TEXT,
      hostess_registro TEXT
    );
  `);

  const insert = db.prepare(`
    INSERT INTO crm_pruebas_manejo (
      mes, fuerza_venta, centro_trabajo, fecha, hora_salida, ejecutivo_ventas,
      nombre_cliente, no_licencia, telefono, correo, auto_interes, tipo_auto,
      vin, kilometraje_inicial, kilometraje_final, id_crm, hostess_registro
    ) VALUES (${new Array(17).fill('?').join(',')})
  `);

  let total = 0;
  let conIdCrm = 0;
  const data = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((value) => value == null || String(value).trim() === '')) continue;
    const idCrm = clean(row[15]);
    const kmInicial = Number(row[13]);
    const kmFinal = Number(row[14]);
    if (idCrm) conIdCrm++;
    data.push([
      clean(row[0]), clean(row[1]), clean(row[2]), serialToIso(row[3]), excelTime(row[4]),
      clean(row[5]), clean(row[6]), clean(row[7]), clean(row[8]), clean(row[9]),
      clean(row[10]), clean(row[11]), clean(row[12])?.toUpperCase() || null,
      Number.isFinite(kmInicial) ? kmInicial : null,
      Number.isFinite(kmFinal) ? kmFinal : null,
      idCrm, clean(row[16]),
    ]);
    total++;
  }

  db.transaction((records) => records.forEach((record) => insert.run(record)))(data);
  db.exec(`
    CREATE INDEX idx_prueba_idcrm ON crm_pruebas_manejo (id_crm);
    CREATE INDEX idx_prueba_fecha ON crm_pruebas_manejo (fecha);
    CREATE INDEX idx_prueba_nombre ON crm_pruebas_manejo (nombre_cliente);
    CREATE INDEX idx_prueba_vin ON crm_pruebas_manejo (vin);
  `);

  const idsCruzanCiclos = db.prepare(`
    SELECT COUNT(DISTINCT p.id_crm) AS n FROM crm_pruebas_manejo p
    WHERE p.id_crm IS NOT NULL
      AND EXISTS (SELECT 1 FROM crm_actividades a WHERE a.id_contacto = p.id_crm)
  `).get().n;
  const pruebasConCompra = db.prepare(`
    SELECT COUNT(DISTINCT p.id_crm) AS n FROM crm_pruebas_manejo p
    WHERE p.id_crm IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM crm_actividades a
        WHERE a.id_contacto = p.id_crm AND a.vin IS NOT NULL AND trim(a.vin) <> ''
      )
  `).get().n;

  console.table([{ total, conIdCrm, sinIdCrm: total - conIdCrm, idsCruzanCiclos, pruebasConCompra }]);
  db.close();
}

run();
