/**
 * ETL: carga hojas "CSI POSVENTA" y "CSI VENTAS" del Google Sheet
 * a la base interna CRM (quejas / incidencias CSI).
 *
 * CSI POSVENTA:
 *   - ORDEN (col B) → vincula al cliente vía órdenes de servicio
 *   - INCIDENCIA (col N) + COMENTARIOS (col O) → texto de queja/incidencia
 *
 * CSI VENTAS:
 *   - VIN / serie (col D) → vincula al perfil CRM por serie
 *   - INCIDENCIA + COMENTARIOS → texto de queja/incidencia
 *
 * Uso:
 *   node backend/scripts/etl-crm-csi.js [ruta.xlsx]
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
  const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const iso = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function clean(v) {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s || null;
}

function normalizeVin(v) {
  const s = clean(v);
  if (!s) return null;
  return s.replace(/[\s-]/g, '').toUpperCase();
}

function normalizeOrden(v) {
  const s = clean(v);
  if (!s) return null;
  return s.replace(/\s+/g, '').toUpperCase();
}

function headerIndexMap(headerRow) {
  const map = {};
  (headerRow || []).forEach((h, i) => {
    const key = String(h || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    if (key) map[key] = i;
  });
  return map;
}

function col(map, aliases, fallback) {
  for (const a of aliases) {
    if (map[a] != null) return map[a];
  }
  return fallback;
}

function classifyArea({ tipo, incidencia, comentarios, sucursal }) {
  const text = `${tipo || ''} ${incidencia || ''} ${comentarios || ''} ${sucursal || ''}`.toLowerCase();
  const rules = [
    { area: 'Facturación / Documentación', re: /factura|timbr|documento|cfdi|xml|comprobante/i },
    { area: 'HYP / Hojalatería y pintura', re: /hyp|hojalater|pintura|ray[oó]n|abolladur|carrocer/i },
    { area: 'Refacciones', re: /refacci[oó]n|pieza|repuesto|existencia/i },
    { area: 'Garantías', re: /garant[ií]a/i },
    { area: 'Financiamiento / F&I', re: /mensualidad|financi|cr[eé]dito|enganche|cobro|contrato|financiera/i },
    { area: 'Ventas / Ejecutivo', re: /\bev\b|ejecutivo|vendedor|atenci[oó]n.*compra|proceso de atenci[oó]n/i },
    { area: 'Entrega de unidad', re: /entrega|recepci[oó]n de unidad|fecha de entrega/i },
    { area: 'Servicio / Taller', re: /taller|servicio|diagn[oó]stic|t[eé]cnic|orden|revisi[oó]n|mantenimiento|fren|topes|rechinido/i },
    { area: 'CSI / Seguimiento', re: /solicitud de info|contacto|whatsapp|cotizaci[oó]n|seguimiento/i },
  ];
  for (const rule of rules) {
    if (rule.re.test(text)) return rule.area;
  }
  if (/garantias|garantías/i.test(tipo || '')) return 'Garantías';
  if (/diagn/i.test(tipo || '')) return 'Servicio / Taller';
  return 'General / Sin clasificar';
}

function isIncidenciaRow(incidencia, comentarios, nps, recomendacion) {
  if (clean(incidencia)) return true;
  const score = Number(nps ?? recomendacion);
  if (Number.isFinite(score) && score > 0 && score <= 6) return true;
  const com = String(comentarios || '');
  if (!com.trim()) return false;
  // Evitar falsos positivos de frases CSI positivas ("No tiene pendientes", etc.)
  if (/buena experiencia|excelente|no requiere|no tiene pendientes|muy content|muy a gusto|recomend/i.test(com)
    && !/queja|reclamo|inconform|molest|problema|falla|solicita|mejora|cobro|rechinido|tronido/i.test(com)) {
    return false;
  }
  return /queja|reclamo|inconform|molest|problema|falla|solicita|mejora|cobro improcedente|rechinido|tronido/i.test(com);
}

function loadSheetRows(wb, predicate) {
  const sheetName = wb.SheetNames.find(predicate);
  if (!sheetName) return { sheetName: null, rows: [] };
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null });
  return { sheetName, rows: raw };
}

function run() {
  const xlsxPath = process.argv[2] || DEFAULT_XLSX;
  if (!fs.existsSync(xlsxPath)) {
    console.error(`No existe el archivo: ${xlsxPath}`);
    process.exit(1);
  }

  console.log('Leyendo', xlsxPath, '...');
  const wb = XLSX.readFile(xlsxPath);

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    DROP TABLE IF EXISTS crm_csi_posventa;
    CREATE TABLE crm_csi_posventa (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT,
      orden TEXT,
      fecha TEXT,
      nombre TEXT,
      estatus_crm TEXT,
      correo TEXT,
      telefono TEXT,
      asesor TEXT,
      tecnico TEXT,
      modelo TEXT,
      serie TEXT,
      recomendacion REAL,
      incidencia TEXT,
      comentarios TEXT,
      area TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_csi_pos_orden ON crm_csi_posventa(orden);
    CREATE INDEX IF NOT EXISTS idx_csi_pos_serie ON crm_csi_posventa(serie);

    DROP TABLE IF EXISTS crm_csi_ventas;
    CREATE TABLE crm_csi_ventas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha_entrega TEXT,
      sucursal TEXT,
      modelo TEXT,
      serie TEXT,
      ejecutivo TEXT,
      cliente TEXT,
      telefono TEXT,
      correo TEXT,
      estatus_crm TEXT,
      venta_crm TEXT,
      nps REAL,
      incidencia TEXT,
      comentarios TEXT,
      intentos REAL,
      area TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_csi_ven_serie ON crm_csi_ventas(serie);
  `);

  const pos = loadSheetRows(wb, (n) => /csi/i.test(n) && /posventa|postventa|post.?venta/i.test(n));
  const ven = loadSheetRows(wb, (n) => /csi/i.test(n) && /venta/i.test(n) && !/posventa|postventa|post.?venta/i.test(n));

  const insertPos = db.prepare(`
    INSERT INTO crm_csi_posventa (
      tipo, orden, fecha, nombre, estatus_crm, correo, telefono, asesor, tecnico,
      modelo, serie, recomendacion, incidencia, comentarios, area
    ) VALUES (
      @tipo, @orden, @fecha, @nombre, @estatus_crm, @correo, @telefono, @asesor, @tecnico,
      @modelo, @serie, @recomendacion, @incidencia, @comentarios, @area
    )
  `);

  const insertVen = db.prepare(`
    INSERT INTO crm_csi_ventas (
      fecha_entrega, sucursal, modelo, serie, ejecutivo, cliente, telefono, correo,
      estatus_crm, venta_crm, nps, incidencia, comentarios, intentos, area
    ) VALUES (
      @fecha_entrega, @sucursal, @modelo, @serie, @ejecutivo, @cliente, @telefono, @correo,
      @estatus_crm, @venta_crm, @nps, @incidencia, @comentarios, @intentos, @area
    )
  `);

  let posCount = 0;
  let venCount = 0;

  if (pos.sheetName && pos.rows.length > 1) {
    const map = headerIndexMap(pos.rows[0]);
    const iTipo = col(map, ['tipo'], 0);
    const iOrden = col(map, ['orden'], 1);
    const iFecha = col(map, ['fecha'], 2);
    const iNombre = col(map, ['nombre'], 3);
    const iEstatus = col(map, ['estatus crm'], 4);
    const iCorreo = col(map, ['correo'], 5);
    const iTel = col(map, ['telefono 1', 'telefono'], 6);
    const iAsesor = col(map, ['asesor'], 8);
    const iTecnico = col(map, ['tecnico'], 9);
    const iModelo = col(map, ['modelo'], 10);
    const iSerie = col(map, ['serie'], 11);
    const iReco = col(map, ['recomendacion', 'recomendación'], 12);
    const iInc = col(map, ['incidencia'], 13);
    const iCom = col(map, ['comentarios'], 14);

    const tx = db.transaction((dataRows) => {
      for (const r of dataRows) {
        const orden = normalizeOrden(r[iOrden]);
        const incidencia = clean(r[iInc]);
        const comentarios = clean(r[iCom]);
        const recomendacion = Number(r[iReco]);
        if (!orden && !comentarios && !incidencia) continue;
        if (!isIncidenciaRow(incidencia, comentarios, null, recomendacion)) continue;
        const tipo = clean(r[iTipo]);
        insertPos.run({
          tipo,
          orden,
          fecha: serialToIso(r[iFecha]),
          nombre: clean(r[iNombre]),
          estatus_crm: clean(r[iEstatus]),
          correo: clean(r[iCorreo]),
          telefono: clean(r[iTel]),
          asesor: clean(r[iAsesor]),
          tecnico: clean(r[iTecnico]),
          modelo: clean(r[iModelo]),
          serie: normalizeVin(r[iSerie]),
          recomendacion: Number.isFinite(recomendacion) ? recomendacion : null,
          incidencia,
          comentarios,
          area: classifyArea({ tipo, incidencia, comentarios }),
        });
        posCount += 1;
      }
    });
    tx(pos.rows.slice(1));
  }

  if (ven.sheetName && ven.rows.length > 1) {
    const map = headerIndexMap(ven.rows[0]);
    const iFecha = col(map, ['fecha de entrega', 'fecha'], 0);
    const iSuc = col(map, ['sucursal'], 1);
    const iModelo = col(map, ['modelo'], 2);
    const iVin = col(map, ['vin', 'serie'], 3);
    const iEjec = col(map, ['ejecutivo'], 4);
    const iCli = col(map, ['cliente'], 5);
    const iTel = col(map, ['numero', 'número', 'telefono'], 6);
    const iCorreo = col(map, ['email', 'correo'], 8);
    const iEstatus = col(map, ['estatus en crm', 'estatus crm'], 9);
    const iVenta = col(map, ['venta registrada en crm'], 10);
    const iNps = col(map, ['nps'], 11);
    const iInc = col(map, ['incidencia'], 12);
    const iCom = col(map, ['comentarios'], 13);
    const iIntentos = col(map, ['intentos'], 14);

    const tx = db.transaction((dataRows) => {
      for (const r of dataRows) {
        const serie = normalizeVin(r[iVin]);
        const incidencia = clean(r[iInc]);
        const comentarios = clean(r[iCom]);
        const nps = Number(r[iNps]);
        if (!serie && !comentarios && !incidencia) continue;
        if (!isIncidenciaRow(incidencia, comentarios, nps, null)) continue;
        insertVen.run({
          fecha_entrega: serialToIso(r[iFecha]),
          sucursal: clean(r[iSuc]),
          modelo: clean(r[iModelo]),
          serie,
          ejecutivo: clean(r[iEjec]),
          cliente: clean(r[iCli]),
          telefono: clean(r[iTel]),
          correo: clean(r[iCorreo]),
          estatus_crm: clean(r[iEstatus]),
          venta_crm: clean(r[iVenta]),
          nps: Number.isFinite(nps) ? nps : null,
          incidencia,
          comentarios,
          intentos: Number.isFinite(Number(r[iIntentos])) ? Number(r[iIntentos]) : null,
          area: classifyArea({
            tipo: clean(r[iSuc]),
            incidencia,
            comentarios,
            sucursal: clean(r[iSuc]),
          }),
        });
        venCount += 1;
      }
    });
    tx(ven.rows.slice(1));
  }

  console.log(`CSI POSVENTA "${pos.sheetName || '—'}": ${posCount} incidencias`);
  console.log(`CSI VENTAS "${ven.sheetName || '—'}": ${venCount} incidencias`);
  console.table({
    posventa: posCount,
    ventas: venCount,
    total: posCount + venCount,
  });
  db.close();
}

if (require.main === module) {
  try {
    run();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

module.exports = { run, classifyArea, normalizeOrden, normalizeVin };
