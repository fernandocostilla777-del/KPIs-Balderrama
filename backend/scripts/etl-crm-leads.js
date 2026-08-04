/**
 * ETL: carga dataset de LEADS (Google Sheet "Acumulado") a la base interna CRM.
 *
 * Fuente : xlsx exportado del sheet (backend/data/leads-source.xlsx)
 * Destino: backend/data/crm-ciclos.db · tabla crm_leads
 * Clave  : columna G "ID CRM" = id_crm (mismo ID que crm_actividades.id_contacto)
 *
 * Uso:
 *   node backend/scripts/etl-crm-leads.js [ruta.xlsx]
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const Database = require('better-sqlite3');

const DEFAULT_XLSX = path.join(__dirname, '../data/leads-source.xlsx');
const DB_PATH = path.join(__dirname, '../data/crm-ciclos.db');

// Excel serial → ISO yyyy-mm-dd
function serialToIso(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (Number.isFinite(n) && n > 20000 && n < 60000) {
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function clean(v) {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s || null;
}

/** Duplicados en sheet Acumulado: columna AD (y marcas en resultado/contacto/estación). */
function isDuplicadoLead(row) {
  const markers = [
    row[COL.enlaceDirecto],
    row[COL.resultado],
    row[COL.contacto],
    row[COL.estacion],
  ];
  return markers.some((v) => String(v || '').trim().toUpperCase() === 'DUPLICADO');
}

// Índices de columna del sheet "Acumulado" (hay encabezados duplicados; se mapea por posición)
const COL = {
  sucursal: 0,
  tipo: 1,
  canal: 2,
  campana: 3,
  idLeadFabricante: 4,
  idOportunidad: 5,
  idCrm: 6, // columna G — clave de relación
  nombres: 8,
  apellidos: 9,
  telefono: 10,
  telefono2: 11,
  correo: 12,
  autoInteres: 13,
  fuerzaVentas: 14,
  cuandoEstrena: 16,
  formaCompra: 17,
  mes: 22,
  fechaEntrada: 23,
  estacion: 24,
  contacto: 26,
  resultado: 27,
  comentario: 28,
  enlaceDirecto: 29, // columna AD — puede ser SI / NO / DUPLICADO / N/A
  intentosContacto: 31,
  canalContacto: 32,
  asignacion: 33,
  ejecutivoAsignado: 34,
  fechaAsignacion: 35,
  citaProgramada: 42,
  fechaCita: 43,
  citaAsistida: 44,
  cotizacion: 48,
  vinComprado: 59,
  fechaFactura: 60,
  fechaEntrega: 61,
  estatusCompra: 63,
};

function run() {
  const xlsxPath = process.argv[2] || DEFAULT_XLSX;
  if (!fs.existsSync(xlsxPath)) {
    console.error(`No existe el archivo: ${xlsxPath}`);
    process.exit(1);
  }

  console.log('Leyendo', xlsxPath, '...');
  const wb = XLSX.readFile(xlsxPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  console.log(`Hoja "${wb.SheetNames[0]}": ${rows.length - 1} filas de datos`);

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    DROP TABLE IF EXISTS crm_leads;
    CREATE TABLE crm_leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      id_crm TEXT,
      id_lead_fabricante TEXT,
      id_oportunidad TEXT,
      sucursal TEXT,
      tipo TEXT,
      canal TEXT,
      campana TEXT,
      nombre TEXT,
      telefono TEXT,
      telefono2 TEXT,
      correo TEXT,
      auto_interes TEXT,
      fuerza_ventas TEXT,
      cuando_estrena TEXT,
      forma_compra TEXT,
      mes TEXT,
      fecha_entrada TEXT,
      estacion TEXT,
      contacto TEXT,
      resultado TEXT,
      comentario TEXT,
      enlace_directo TEXT,
      es_duplicado INTEGER NOT NULL DEFAULT 0,
      intentos_contacto TEXT,
      canal_contacto TEXT,
      asignacion TEXT,
      ejecutivo_asignado TEXT,
      fecha_asignacion TEXT,
      cita_programada TEXT,
      fecha_cita TEXT,
      cita_asistida TEXT,
      cotizacion TEXT,
      vin_comprado TEXT,
      fecha_factura TEXT,
      fecha_entrega TEXT,
      estatus_compra TEXT
    );
  `);

  const insert = db.prepare(`
    INSERT INTO crm_leads (
      id_crm, id_lead_fabricante, id_oportunidad, sucursal, tipo, canal, campana,
      nombre, telefono, telefono2, correo, auto_interes, fuerza_ventas,
      cuando_estrena, forma_compra, mes, fecha_entrada, estacion, contacto,
      resultado, comentario, enlace_directo, es_duplicado, intentos_contacto, canal_contacto, asignacion,
      ejecutivo_asignado, fecha_asignacion, cita_programada, fecha_cita,
      cita_asistida, cotizacion, vin_comprado, fecha_factura, fecha_entrega,
      estatus_compra
    ) VALUES (${new Array(36).fill('?').join(',')})
  `);

  let total = 0;
  let conIdCrm = 0;
  let omitidosDuplicado = 0;
  const insertMany = db.transaction((data) => {
    for (const r of data) insert.run(r);
  });

  const batch = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((c) => c == null || String(c).trim() === '')) continue;

    // No cargar duplicados (columna AD / resultado / contacto / estación = DUPLICADO)
    if (isDuplicadoLead(r)) {
      omitidosDuplicado += 1;
      continue;
    }

    const idCrm = clean(r[COL.idCrm]);
    if (idCrm) conIdCrm++;

    const nombre = [clean(r[COL.nombres]), clean(r[COL.apellidos])].filter(Boolean).join(' ') || null;

    batch.push([
      idCrm,
      clean(r[COL.idLeadFabricante]),
      clean(r[COL.idOportunidad]),
      clean(r[COL.sucursal]),
      clean(r[COL.tipo]),
      clean(r[COL.canal]),
      clean(r[COL.campana]),
      nombre ? nombre.toUpperCase() : null,
      clean(r[COL.telefono]),
      clean(r[COL.telefono2]),
      clean(r[COL.correo]),
      clean(r[COL.autoInteres]),
      clean(r[COL.fuerzaVentas]),
      clean(r[COL.cuandoEstrena]),
      clean(r[COL.formaCompra]),
      clean(r[COL.mes]),
      serialToIso(r[COL.fechaEntrada]),
      clean(r[COL.estacion]),
      clean(r[COL.contacto]),
      clean(r[COL.resultado]),
      clean(r[COL.comentario]),
      clean(r[COL.enlaceDirecto]),
      0,
      clean(r[COL.intentosContacto]),
      clean(r[COL.canalContacto]),
      clean(r[COL.asignacion]),
      clean(r[COL.ejecutivoAsignado]),
      serialToIso(r[COL.fechaAsignacion]),
      clean(r[COL.citaProgramada]),
      serialToIso(r[COL.fechaCita]),
      clean(r[COL.citaAsistida]),
      clean(r[COL.cotizacion]),
      clean(r[COL.vinComprado]),
      serialToIso(r[COL.fechaFactura]),
      serialToIso(r[COL.fechaEntrega]),
      clean(r[COL.estatusCompra]),
    ]);
    total++;
  }
  insertMany(batch);

  db.exec(`
    CREATE INDEX idx_leads_idcrm ON crm_leads (id_crm);
    CREATE INDEX idx_leads_nombre ON crm_leads (nombre);
    CREATE INDEX idx_leads_telefono ON crm_leads (telefono);
    CREATE INDEX idx_leads_correo ON crm_leads (correo);
    CREATE INDEX idx_leads_fecha ON crm_leads (fecha_entrada);
  `);

  const cruzan = db.prepare(`
    SELECT COUNT(DISTINCT l.id_crm) AS n
    FROM crm_leads l
    WHERE l.id_crm IS NOT NULL
      AND EXISTS (SELECT 1 FROM crm_actividades a WHERE a.id_contacto = l.id_crm)
  `).get().n;

  console.log('\nCarga completa → tabla crm_leads en', DB_PATH);
  console.table([{
    leads: total,
    omitidosDuplicado,
    conIdCrm,
    sinIdCrm: total - conIdCrm,
    idsCruzanConCiclos: cruzan,
  }]);
  db.close();
}

run();
