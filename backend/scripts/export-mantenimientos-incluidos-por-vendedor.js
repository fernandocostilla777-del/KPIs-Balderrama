/**
 * Exporta mantenimientos incluidos ene-ago 2026 por vendedor (crm_financiamiento).
 */
const path = require('path');
const Database = require('better-sqlite3');
const XLSX = require('xlsx');

const DB_PATH = path.join(__dirname, '../data/crm-ciclos.db');
const OUT_PATH = path.join(
  __dirname,
  '../data/mantenimientos-incluidos-ene-ago-2026-por-vendedor.xlsx',
);

const FECHA_INI = '2026-01-01';
const FECHA_FIN = '2026-08-31';

function hasMantenimientos(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  const u = s.toUpperCase();
  return !['NO', 'N/A', '0', 'NULL', 'FALSE', 'NINGUNO', 'NA', '-'].includes(u);
}

function monthLabel(fecha) {
  const m = Number(String(fecha || '').slice(5, 7));
  const labels = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return labels[m] || String(m);
}

const d = new Database(DB_PATH, { readonly: true, fileMustExist: true });

const rows = d
  .prepare(`
  SELECT
    fecha, mes, asesor, cliente, unidad, vin, plan, tipo_compra, factura,
    no_contrato, contrato, mantenimientos_incluidos,
    mantenimiento_integrado_monto
  FROM crm_financiamiento
  WHERE fecha IS NOT NULL
    AND fecha >= ?
    AND fecha <= ?
  ORDER BY fecha ASC, asesor ASC
`)
  .all(FECHA_INI, FECHA_FIN)
  .filter((r) => hasMantenimientos(r.mantenimientos_incluidos));

d.close();

const byAsesor = new Map();
for (const r of rows) {
  const asesor = String(r.asesor || '').trim() || 'Sin asesor';
  if (!byAsesor.has(asesor)) {
    byAsesor.set(asesor, {
      asesor,
      total: 0,
      ene: 0,
      feb: 0,
      mar: 0,
      abr: 0,
      may: 0,
      jun: 0,
      jul: 0,
      ago: 0,
    });
  }
  const b = byAsesor.get(asesor);
  b.total += 1;
  const m = Number(String(r.fecha || '').slice(5, 7));
  const key = { 1: 'ene', 2: 'feb', 3: 'mar', 4: 'abr', 5: 'may', 6: 'jun', 7: 'jul', 8: 'ago' }[m];
  if (key) b[key] += 1;
}

const resumen = [...byAsesor.values()].sort((a, b) => b.total - a.total || a.asesor.localeCompare(b.asesor));

const resumenSheet = [
  ['Mantenimientos incluidos · Enero–Agosto 2026 · Por vendedor'],
  ['Fuente: CRM financiamiento (columna mantenimientos_incluidos)'],
  [`Periodo: ${FECHA_INI} a ${FECHA_FIN}`],
  [`Contratos con mantenimientos incluidos: ${rows.length}`],
  [`Vendedores: ${resumen.length}`],
  [],
  ['Vendedor', 'Total', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago'],
  ...resumen.map((r) => [r.asesor, r.total, r.ene, r.feb, r.mar, r.abr, r.may, r.jun, r.jul, r.ago]),
  [],
  [
    'TOTAL',
    resumen.reduce((a, r) => a + r.total, 0),
    resumen.reduce((a, r) => a + r.ene, 0),
    resumen.reduce((a, r) => a + r.feb, 0),
    resumen.reduce((a, r) => a + r.mar, 0),
    resumen.reduce((a, r) => a + r.abr, 0),
    resumen.reduce((a, r) => a + r.may, 0),
    resumen.reduce((a, r) => a + r.jun, 0),
    resumen.reduce((a, r) => a + r.jul, 0),
    resumen.reduce((a, r) => a + r.ago, 0),
  ],
];

const detalleSheet = [
  [
    'Fecha',
    'Mes',
    'Vendedor',
    'Cliente',
    'Unidad',
    'VIN',
    'Plan',
    'Tipo compra',
    'Factura',
    'No. contrato',
    'Mantenimientos incluidos',
    'Monto mant. integrado',
  ],
  ...rows.map((r) => [
    r.fecha,
    monthLabel(r.fecha),
    String(r.asesor || '').trim() || 'Sin asesor',
    r.cliente || '',
    r.unidad || '',
    r.vin || '',
    r.plan || '',
    r.tipo_compra || '',
    r.factura || '',
    r.no_contrato || r.contrato || '',
    r.mantenimientos_incluidos || '',
    r.mantenimiento_integrado_monto != null ? Number(r.mantenimiento_integrado_monto) : '',
  ]),
];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumenSheet), 'Por vendedor');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detalleSheet), 'Detalle');
XLSX.writeFile(wb, OUT_PATH);

console.log(JSON.stringify({
  out: OUT_PATH,
  contratos: rows.length,
  vendedores: resumen.length,
  top5: resumen.slice(0, 5).map((r) => ({ asesor: r.asesor, total: r.total })),
}, null, 2));
