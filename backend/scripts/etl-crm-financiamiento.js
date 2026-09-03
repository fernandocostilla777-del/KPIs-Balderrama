/**
 * ETL: hoja "Historico de contratos" del Google Sheet a SQLite.
 * Clave de relación: columna I "VIN" → VIN/serie del cliente en Seguimiento 360.
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const Database = require('better-sqlite3');
const { contractStorageValue } = require('./lib/crmContratoNorm');

const DEFAULT_XLSX = path.join(__dirname, '../data/leads-source.xlsx');
const DB_PATH = path.join(__dirname, '../data/crm-ciclos.db');

const COL = {
  mes: 0,
  consecutivo: 1,
  fecha: 2,
  fechaTimbrado: 3,
  cliente: 4,
  asesor: 5,
  rfcAsesor: 6,
  unidad: 7,
  vin: 8,
  fechaCompra: 9,
  contrato: 10,
  plan: 11,
  plazo: 12,
  enganchePct: 13,
  engancheMonto: 14,
  montoFinanciar: 15,
  mafComision: 16,
  gap: 17,
  cxGap: 18,
  garantiaExtendida: 19,
  cxGarantia: 20,
  accesorios: 21,
  onstar: 22,
  plazoOnstar: 23,
  mantenimientoIntegrado: 24,
  comision: 25,
  noContrato: 26,
  factura: 27,
  mantenimientosIncluidos: 28,
  pagoFlexible: 29,
  seguroGratis: 30, // Col AE — seguro gratis (12 meses)
  seguroSubsecuente: 31, // Col AF — seguro subsecuente
  roboParcial: 32,
  fi: 33,
  envio: 34,
  afi: 35,
  envioResguardo: 36,
  buzone: 37,
  placas: 38,
  tipoCompra: 39,
  especial: 40,
  plan2: 41,
  equipo: 42,
};

function clean(value) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || null;
}

function normalizeVin(value) {
  const vin = clean(value)?.toUpperCase().replace(/\s+/g, '') || null;
  return vin && vin.length >= 5 ? vin : null;
}

function serialToIso(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (Number.isFinite(number) && number > 20000 && number < 60000) {
    return new Date(Date.UTC(1899, 11, 30) + number * 86400000).toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  let match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function numberValue(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value)
    .replace(/[$,%\s]/g, '')
    .replace(/,/g, '')
    .replace(/[()]/g, (character) => (character === '(' ? '-' : ''));
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function percentValue(value) {
  const number = numberValue(value);
  if (number == null) return null;
  return Math.abs(number) <= 1 ? number * 100 : number;
}

function run() {
  const xlsxPath = process.argv[2] || DEFAULT_XLSX;
  if (!fs.existsSync(xlsxPath)) throw new Error(`No existe el archivo: ${xlsxPath}`);

  console.log('Leyendo', xlsxPath, '...');
  const workbook = XLSX.readFile(xlsxPath);
  const sheetName = workbook.SheetNames.find((name) => {
    const normalized = name.toLowerCase();
    return normalized.includes('historico') && normalized.includes('contrato');
  });
  if (!sheetName) throw new Error('No se encontró la hoja "Historico de contratos"');

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: null,
  });

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    DROP TABLE IF EXISTS crm_financiamiento;
    CREATE TABLE crm_financiamiento (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mes TEXT,
      consecutivo TEXT,
      fecha TEXT,
      fecha_timbrado TEXT,
      cliente TEXT,
      asesor TEXT,
      rfc_asesor TEXT,
      unidad TEXT,
      vin TEXT NOT NULL,
      fecha_compra TEXT,
      contrato TEXT,
      plan TEXT,
      plazo_meses INTEGER,
      enganche_pct REAL,
      enganche_monto REAL,
      monto_financiar REAL,
      maf_comision REAL,
      gap_monto REAL,
      cx_gap REAL,
      garantia_extendida_monto REAL,
      cx_garantia REAL,
      accesorios_monto REAL,
      onstar_monto REAL,
      plazo_onstar TEXT,
      mantenimiento_integrado_monto REAL,
      comision REAL,
      no_contrato TEXT,
      factura TEXT,
      mantenimientos_incluidos TEXT,
      pago_flexible REAL,
      seguro_gratis TEXT,
      seguro_subsecuente TEXT,
      robo_parcial TEXT,
      fi TEXT,
      envio TEXT,
      afi TEXT,
      envio_resguardo TEXT,
      buzone TEXT,
      placas TEXT,
      tipo_compra TEXT,
      especial TEXT,
      plan_2 TEXT,
      equipo TEXT
    );
  `);

  const columns = [
    'mes', 'consecutivo', 'fecha', 'fecha_timbrado', 'cliente', 'asesor', 'rfc_asesor',
    'unidad', 'vin', 'fecha_compra', 'contrato', 'plan', 'plazo_meses', 'enganche_pct',
    'enganche_monto', 'monto_financiar', 'maf_comision', 'gap_monto', 'cx_gap',
    'garantia_extendida_monto', 'cx_garantia', 'accesorios_monto', 'onstar_monto',
    'plazo_onstar', 'mantenimiento_integrado_monto', 'comision', 'no_contrato', 'factura',
    'mantenimientos_incluidos', 'pago_flexible', 'seguro_gratis', 'seguro_subsecuente',
    'robo_parcial', 'fi', 'envio', 'afi', 'envio_resguardo', 'buzone', 'placas',
    'tipo_compra', 'especial', 'plan_2', 'equipo',
  ];
  const insert = db.prepare(`
    INSERT INTO crm_financiamiento (${columns.join(', ')})
    VALUES (${columns.map(() => '?').join(', ')})
  `);

  const records = [];
  let skipped = 0;
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const vin = normalizeVin(row?.[COL.vin]);
    if (!vin) {
      skipped += 1;
      continue;
    }
    records.push([
      clean(row[COL.mes]),
      clean(row[COL.consecutivo]),
      serialToIso(row[COL.fecha]) || clean(row[COL.fecha]),
      serialToIso(row[COL.fechaTimbrado]),
      clean(row[COL.cliente]),
      clean(row[COL.asesor]),
      clean(row[COL.rfcAsesor]),
      clean(row[COL.unidad]),
      vin,
      serialToIso(row[COL.fechaCompra]),
      contractStorageValue(row[COL.contrato]),
      clean(row[COL.plan]),
      Math.round(numberValue(row[COL.plazo]) || 0) || null,
      percentValue(row[COL.enganchePct]),
      numberValue(row[COL.engancheMonto]),
      numberValue(row[COL.montoFinanciar]),
      numberValue(row[COL.mafComision]),
      numberValue(row[COL.gap]),
      numberValue(row[COL.cxGap]),
      numberValue(row[COL.garantiaExtendida]),
      numberValue(row[COL.cxGarantia]),
      numberValue(row[COL.accesorios]),
      numberValue(row[COL.onstar]),
      clean(row[COL.plazoOnstar]),
      numberValue(row[COL.mantenimientoIntegrado]),
      numberValue(row[COL.comision]),
      contractStorageValue(row[COL.noContrato]),
      clean(row[COL.factura]),
      clean(row[COL.mantenimientosIncluidos]),
      numberValue(row[COL.pagoFlexible]),
      clean(row[COL.seguroGratis]),
      clean(row[COL.seguroSubsecuente]),
      clean(row[COL.roboParcial]),
      clean(row[COL.fi]),
      clean(row[COL.envio]),
      clean(row[COL.afi]),
      clean(row[COL.envioResguardo]),
      clean(row[COL.buzone]),
      clean(row[COL.placas]),
      clean(row[COL.tipoCompra]),
      clean(row[COL.especial]),
      clean(row[COL.plan2]),
      clean(row[COL.equipo]),
    ]);
  }

  db.transaction((items) => items.forEach((record) => insert.run(record)))(records);
  db.exec(`
    CREATE INDEX idx_fin_vin ON crm_financiamiento (vin);
    CREATE INDEX idx_fin_fecha_compra ON crm_financiamiento (fecha_compra);
    CREATE INDEX idx_fin_cliente ON crm_financiamiento (cliente);
    CREATE INDEX idx_fin_contrato ON crm_financiamiento (contrato);
    CREATE INDEX idx_fin_no_contrato ON crm_financiamiento (no_contrato);
  `);

  const pva = db.prepare(`
    SELECT
      SUM(CASE WHEN gap_monto > 0 THEN 1 ELSE 0 END) AS gap,
      SUM(CASE WHEN garantia_extendida_monto > 0 THEN 1 ELSE 0 END) AS garantia,
      SUM(CASE WHEN onstar_monto > 0 THEN 1 ELSE 0 END) AS onstar,
      SUM(CASE WHEN mantenimiento_integrado_monto > 0 THEN 1 ELSE 0 END) AS mantenimiento
    FROM crm_financiamiento
  `).get();
  console.log(`Hoja "${sheetName}": ${records.length} contratos cargados; ${skipped} filas sin VIN omitidas`);
  console.table([{ contratos: records.length, ...pva }]);
  db.close();
}

run();
