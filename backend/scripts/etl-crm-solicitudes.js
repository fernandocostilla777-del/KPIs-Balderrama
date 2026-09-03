/**
 * ETL: carga hoja "Solicitudes" (solicitudes de crédito F&I) del Google Sheet
 * a la base interna CRM.
 *
 * Fuente : backend/data/leads-source.xlsx (hoja "Solicitudes")
 * Destino: backend/data/crm-ciclos.db · tabla crm_solicitudes
 * Clave  : columna H "Contacto CRM" = id_crm (= ID_CONTACTO de ciclos)
 *
 * Uso:
 *   node backend/scripts/etl-crm-solicitudes.js [ruta.xlsx]
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const Database = require('better-sqlite3');

const DEFAULT_XLSX = path.join(__dirname, '../data/leads-source.xlsx');
const DB_PATH = path.join(__dirname, '../data/crm-ciclos.db');

function serialToIso(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (Number.isFinite(n) && n > 20000 && n < 60000) {
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const text = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    let y = m[3];
    if (y.length === 2) y = `20${y}`;
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

function clean(v) {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s || null;
}

// Índices de columna de la hoja "Solicitudes"
const COL = {
  noSolicitud: 0,
  fuerzaVenta: 1,
  financiera: 2,
  fechaSolicitud: 3,
  mes: 4,
  rfc: 5,
  asesor: 6,
  idCrm: 7, // columna H "Contacto CRM" — clave de relación
  nombreCliente: 8,
  estatus: 9,
  respuestaFinanciera: 10,
  biometrico: 11,
  unidadPaquete: 12,
  fuente: 13,
  origen: 14,
  fechaAprobacion: 19,
  mesFacturacion: 20,
  fechaFirma: 21,
  numContrato: 22,
  fechaCompra: 23,
  mesCompra: 24,
  comentariosFi: 25,
  fi: 26,
  afi: 27,
  enganche: 28,
};

function run() {
  const xlsxPath = process.argv[2] || DEFAULT_XLSX;
  if (!fs.existsSync(xlsxPath)) {
    console.error(`No existe el archivo: ${xlsxPath}`);
    process.exit(1);
  }

  console.log('Leyendo', xlsxPath, '...');
  const wb = XLSX.readFile(xlsxPath);
  const sheetName = wb.SheetNames.find((n) => n.toLowerCase().includes('solicitud'));
  if (!sheetName) {
    console.error('No se encontró la hoja "Solicitudes". Hojas:', wb.SheetNames);
    process.exit(1);
  }
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  console.log(`Hoja "${sheetName}": ${rows.length - 1} filas de datos`);

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    DROP TABLE IF EXISTS crm_solicitudes;
    CREATE TABLE crm_solicitudes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      no_solicitud TEXT,
      id_crm TEXT,
      nombre_cliente TEXT,
      rfc TEXT,
      fuerza_venta TEXT,
      financiera TEXT,
      fecha_solicitud TEXT,
      mes TEXT,
      asesor TEXT,
      estatus TEXT,
      respuesta_financiera TEXT,
      biometrico TEXT,
      unidad_paquete TEXT,
      fuente TEXT,
      origen TEXT,
      fecha_aprobacion TEXT,
      mes_facturacion TEXT,
      fecha_firma TEXT,
      num_contrato TEXT,
      fecha_compra TEXT,
      mes_compra TEXT,
      comentarios_fi TEXT,
      fi TEXT,
      afi TEXT,
      enganche REAL
    );
  `);

  const insert = db.prepare(`
    INSERT INTO crm_solicitudes (
      no_solicitud, id_crm, nombre_cliente, rfc, fuerza_venta, financiera,
      fecha_solicitud, mes, asesor, estatus, respuesta_financiera, biometrico,
      unidad_paquete, fuente, origen, fecha_aprobacion, mes_facturacion,
      fecha_firma, num_contrato, fecha_compra, mes_compra, comentarios_fi,
      fi, afi, enganche
    ) VALUES (${new Array(25).fill('?').join(',')})
  `);

  let total = 0;
  let conIdCrm = 0;
  const batch = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((c) => c == null || String(c).trim() === '')) continue;

    const idCrm = clean(r[COL.idCrm]);
    if (idCrm) conIdCrm++;

    const enganche = Number(r[COL.enganche]);

    batch.push([
      clean(r[COL.noSolicitud]),
      idCrm,
      clean(r[COL.nombreCliente]),
      clean(r[COL.rfc]),
      clean(r[COL.fuerzaVenta]),
      clean(r[COL.financiera]),
      serialToIso(r[COL.fechaSolicitud]),
      clean(r[COL.mes]),
      clean(r[COL.asesor]),
      clean(r[COL.estatus]),
      clean(r[COL.respuestaFinanciera]),
      clean(r[COL.biometrico]),
      clean(r[COL.unidadPaquete]),
      clean(r[COL.fuente]),
      clean(r[COL.origen]),
      serialToIso(r[COL.fechaAprobacion]),
      clean(r[COL.mesFacturacion]),
      serialToIso(r[COL.fechaFirma]),
      clean(r[COL.numContrato]),
      serialToIso(r[COL.fechaCompra]),
      clean(r[COL.mesCompra]),
      clean(r[COL.comentariosFi]),
      clean(r[COL.fi]),
      clean(r[COL.afi]),
      Number.isFinite(enganche) ? enganche : null,
    ]);
    total++;
  }

  db.transaction((data) => {
    for (const row of data) insert.run(row);
  })(batch);

  db.exec(`
    CREATE INDEX idx_sol_idcrm ON crm_solicitudes (id_crm);
    CREATE INDEX idx_sol_nombre ON crm_solicitudes (nombre_cliente);
    CREATE INDEX idx_sol_fecha ON crm_solicitudes (fecha_solicitud);
    CREATE INDEX idx_sol_estatus ON crm_solicitudes (estatus);
  `);

  const cruzanCiclos = db.prepare(`
    SELECT COUNT(DISTINCT s.id_crm) AS n
    FROM crm_solicitudes s
    WHERE s.id_crm IS NOT NULL
      AND EXISTS (SELECT 1 FROM crm_actividades a WHERE a.id_contacto = s.id_crm)
  `).get().n;
  const cruzanLeads = db.prepare(`
    SELECT COUNT(DISTINCT s.id_crm) AS n
    FROM crm_solicitudes s
    WHERE s.id_crm IS NOT NULL
      AND EXISTS (SELECT 1 FROM crm_leads l WHERE l.id_crm = s.id_crm)
  `).get().n;

  console.log('\nCarga completa → tabla crm_solicitudes en', DB_PATH);
  console.table([{
    solicitudes: total,
    conIdCrm,
    sinIdCrm: total - conIdCrm,
    idsCruzanConCiclos: cruzanCiclos,
    idsCruzanConLeads: cruzanLeads,
  }]);
  db.close();
}

run();
