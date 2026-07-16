const { query } = require('../db');

/**
 * Estado de resultados · Ventas autos nuevos
 * Estructura alineada a plantilla B-Pro ESTADODERESULTADO-VTASMEN
 * y CON_CONFESTADORESULTADO "ESTADO DE RESULTADOS DEPTO DE VENTAS".
 */
const ACUM_DET = 'DETA';

const BRANCHES = [
  {
    id: 'piso',
    label: 'PISO',
    sucursalId: 'piso',
    revenuePrefixes: ['0400-0001-%'],
    costPrefixes: ['0600-0001-%'],
    expenseGroup: '711',
  },
  {
    id: 'foraneos',
    label: 'FORANEOS',
    sucursalId: 'foraneos',
    revenuePrefixes: ['0400-0002-%'],
    costPrefixes: ['0600-0002-%'],
    expenseGroup: '712',
  },
  {
    id: 'suauto',
    label: 'SUAUTO',
    sucursalId: 'suauto',
    revenuePrefixes: ['0400-0008-%'],
    costPrefixes: ['0600-0008-%', '0600-0003-%'],
    expenseGroup: '713',
  },
  {
    id: 'cholula',
    label: 'CHOLULA',
    sucursalId: 'cholula',
    revenuePrefixes: ['0400-0004-%'],
    costPrefixes: ['0600-0004-%'],
    expenseGroup: '714',
  },
  {
    id: 'zacatelco',
    label: 'ZACATELCO',
    sucursalId: 'zacatelco',
    revenuePrefixes: ['0400-0005-%'],
    costPrefixes: ['0600-0005-%'],
    expenseGroup: '715',
  },
  {
    id: 'casa',
    label: 'CASA',
    sucursalId: 'casa',
    revenuePrefixes: ['0400-0007-%'],
    costPrefixes: ['0600-0007-%'],
    expenseGroup: '718',
  },
];

const ADMIN_GROUP = '740';
const FINANCIAL_PRODUCT_GROUPS = ['812', '813', '814', '815', '816', '817', '821', '822'];
const FINANCIAL_EXPENSE_ADD = ['901', '938', '940', '941'];
const FINANCIAL_EXPENSE_SUB = ['823', '942'];

function parseDate(value) {
  const d = new Date(`${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) throw new Error(`Fecha inválida: ${value}`);
  return d;
}

function ctasTable(year) {
  return `CON_CTAS01${year}`;
}

async function tableExists(name) {
  const rows = await query(
    'SELECT 1 AS ok FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @name',
    { name },
  );
  return rows.length > 0;
}

function movementExpr(startMonth, endMonth) {
  const parts = [];
  for (let m = startMonth; m <= endMonth; m++) {
    parts.push(`ISNULL(CTA_CARGO${m}, 0) - ISNULL(CTA_ABONO${m}, 0)`);
  }
  return parts.length ? parts.join(' + ') : '0';
}

function incomeExpr(rawExpr) {
  return `CASE WHEN CTA_NATURALEZA = 'ACRE' THEN -(${rawExpr}) ELSE (${rawExpr}) END`;
}

function expenseExpr(rawExpr) {
  return `CASE WHEN CTA_NATURALEZA = 'DEUD' THEN (${rawExpr}) ELSE -(${rawExpr}) END`;
}

function yearSegments(fechaInicio, fechaFin) {
  const start = parseDate(fechaInicio);
  const end = parseDate(fechaFin);
  if (start > end) throw new Error('fechaInicio no puede ser mayor que fechaFin');

  const segments = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    const year = cursor.getFullYear();
    const monthStart = cursor.getMonth() + 1;
    const yearEndDate = new Date(year, 11, 31, 12);
    const segEnd = end < yearEndDate ? end : yearEndDate;
    const monthEnd = segEnd.getMonth() + 1;
    segments.push({ year, monthStart, monthEnd });
    cursor = new Date(year + 1, 0, 1, 12);
  }
  return segments;
}

async function sumAcrossSegments(segments, fn) {
  let total = 0;
  for (const seg of segments) {
    const table = ctasTable(seg.year);
    if (!(await tableExists(table))) continue;
    total += await fn(table, seg.monthStart, seg.monthEnd);
  }
  return total;
}

async function sumByLikePatterns(table, startMonth, endMonth, prefixes, asIncome) {
  if (!prefixes.length) return 0;
  const mov = movementExpr(startMonth, endMonth);
  const sign = asIncome ? incomeExpr(mov) : expenseExpr(mov);
  const where = prefixes.map((_, i) => `(CTA_NUMCTA LIKE @lp${i})`).join(' OR ');
  const params = {};
  prefixes.forEach((p, i) => { params[`lp${i}`] = p; });
  const rows = await query(`
    SELECT SUM(${sign}) AS total
    FROM [${table}]
    WHERE CTA_ACUMDET = '${ACUM_DET}' AND (${where})
  `, params);
  return Number(rows[0]?.total || 0);
}

async function sumByGroup(table, startMonth, endMonth, group, asIncome) {
  const mov = movementExpr(startMonth, endMonth);
  const sign = asIncome ? incomeExpr(mov) : expenseExpr(mov);
  const rows = await query(`
    SELECT SUM(${sign}) AS total
    FROM [${table}]
    WHERE CTA_ACUMDET = '${ACUM_DET}' AND CTA_GPOCONT = @g
  `, { g: group });
  return Number(rows[0]?.total || 0);
}

async function sumByGroups(table, startMonth, endMonth, groups, asIncome) {
  let total = 0;
  for (const g of groups) {
    total += await sumByGroup(table, startMonth, endMonth, g, asIncome);
  }
  return total;
}

function resolveBranches(sucursalId = 'todos') {
  if (!sucursalId || sucursalId === 'todos') return BRANCHES;
  const branch = BRANCHES.find((b) => b.sucursalId === sucursalId || b.id === sucursalId);
  return branch ? [branch] : BRANCHES;
}

function line(key, label, value, extra = {}) {
  return { key, label, value, ...extra };
}

async function getVentasAutosNuevosIncomeStatement(fechaInicio, fechaFin, sucursalId = 'todos') {
  const segments = yearSegments(fechaInicio, fechaFin);
  const branches = resolveBranches(sucursalId);
  const available = (await Promise.all(segments.map((s) => tableExists(ctasTable(s.year))))).some(Boolean);

  const branchRows = [];
  for (const branch of branches) {
    const ventas = await sumAcrossSegments(segments, (table, ms, me) =>
      sumByLikePatterns(table, ms, me, branch.revenuePrefixes, true));
    const costo = await sumAcrossSegments(segments, (table, ms, me) =>
      sumByLikePatterns(table, ms, me, branch.costPrefixes, false));
    const gastos = await sumAcrossSegments(segments, (table, ms, me) =>
      sumByGroup(table, ms, me, branch.expenseGroup, false));
    const utilidadBruta = ventas - costo;
    branchRows.push({
      ...branch,
      ventas,
      costo,
      utilidadBruta,
      gastos,
      utilidadOperacion: utilidadBruta - gastos,
    });
  }

  const ventasNetas = branchRows.reduce((a, b) => a + b.ventas, 0);
  const costoVentas = branchRows.reduce((a, b) => a + b.costo, 0);
  const utilidadBruta = ventasNetas - costoVentas;
  const gastosAutos = branchRows.reduce((a, b) => a + b.gastos, 0);

  const gastosAdministracion = await sumAcrossSegments(segments, (table, ms, me) =>
    sumByGroup(table, ms, me, ADMIN_GROUP, false));

  const sumaGastos = gastosAutos + gastosAdministracion;
  const utilidadOperacion = utilidadBruta - sumaGastos;

  const productosFinancieros = await sumAcrossSegments(segments, (table, ms, me) =>
    sumByGroups(table, ms, me, FINANCIAL_PRODUCT_GROUPS, true));

  let gastosFinancieros = await sumAcrossSegments(segments, (table, ms, me) =>
    sumByGroups(table, ms, me, FINANCIAL_EXPENSE_ADD, false));
  const gastosFinSub = await sumAcrossSegments(segments, (table, ms, me) =>
    sumByGroups(table, ms, me, FINANCIAL_EXPENSE_SUB, false));
  gastosFinancieros -= gastosFinSub;

  const utilidadFinanciera = productosFinancieros - gastosFinancieros;
  const utilidadAntesImpuestos = utilidadOperacion + utilidadFinanciera;

  const margenBrutoPct = ventasNetas ? Number(((utilidadBruta / ventasNetas) * 100).toFixed(1)) : 0;
  const margenOperacionPct = ventasNetas ? Number(((utilidadOperacion / ventasNetas) * 100).toFixed(1)) : 0;

  const resultLines = [
    line('ventasNetas', 'Ventas autos nuevos', ventasNetas, { section: 'ingreso', level: 0 }),
    ...branchRows.map((b) => line(`ventas_${b.id}`, b.label, b.ventas, { section: 'ingreso', level: 1, branchId: b.id })),
    line('costoVentas', 'Costo autos nuevos', costoVentas, { section: 'costo', level: 0 }),
    ...branchRows.map((b) => line(`costo_${b.id}`, b.label, b.costo, { section: 'costo', level: 1, branchId: b.id })),
    line('utilidadBruta', 'Total utilidad bruta', utilidadBruta, { section: 'resultado', level: 0, highlight: true }),
    ...branchRows.map((b) => line(`util_${b.id}`, b.label, b.utilidadBruta, { section: 'resultado', level: 1, branchId: b.id })),
    line('gastosAutos', 'Gastos autos nuevos', gastosAutos, { section: 'gasto', level: 0 }),
    ...branchRows.map((b) => line(`gastos_${b.id}`, b.label, b.gastos, { section: 'gasto', level: 1, branchId: b.id })),
    line('gastosAdministracion', 'Gastos administración', gastosAdministracion, { section: 'gasto', level: 0 }),
    line('sumaGastos', 'Suma gastos', sumaGastos, { section: 'gasto', level: 0, highlight: true }),
    line('utilidadOperacion', 'Utilidad de operación', utilidadOperacion, { section: 'resultado', level: 0, highlight: true }),
    line('productosFinancieros', 'Productos financieros', productosFinancieros, { section: 'financiero', level: 0 }),
    line('gastosFinancieros', 'Gastos financieros', gastosFinancieros, { section: 'financiero', level: 0 }),
    line('utilidadFinanciera', 'Utilidad o pérdida financiera', utilidadFinanciera, { section: 'financiero', level: 0, highlight: true }),
    line('utilidadAntesImpuestos', 'Utilidad antes de impuestos', utilidadAntesImpuestos, { section: 'resultado', level: 0, highlight: true }),
  ];

  return {
    available,
    source: 'CON_CTAS · VTASMEN',
    template: 'ESTADO DE RESULTADOS DEPTO DE VENTAS',
    scopeLabel: sucursalId === 'todos' ? 'Autos nuevos · consolidado' : `Autos nuevos · ${branchRows[0]?.label || sucursalId}`,
    branches: branchRows,
    summary: {
      ventasNetas,
      costoVentas,
      utilidadBruta,
      gastosAutos,
      gastosAdministracion,
      sumaGastos,
      utilidadOperacion,
      productosFinancieros,
      gastosFinancieros,
      utilidadFinanciera,
      utilidadAntesImpuestos,
      utilidadPeriodo: utilidadAntesImpuestos,
      margenBrutoPct,
      margenOperacionPct,
      margenNetoPct: ventasNetas ? Number(((utilidadAntesImpuestos / ventasNetas) * 100).toFixed(1)) : 0,
    },
    resultLines,
    revenueLines: branchRows.map((b) => line(b.id, b.label, b.ventas, { group: 'ingreso' })),
    costLines: branchRows.map((b) => line(b.id, b.label, b.costo, { group: 'costo' })),
    expenseLines: [
      line('gastosAutos', 'Gastos autos nuevos', gastosAutos, { group: 'gasto' }),
      line('gastosAdministracion', 'Gastos administración', gastosAdministracion, { group: 'gasto' }),
    ],
  };
}

module.exports = {
  BRANCHES,
  getVentasAutosNuevosIncomeStatement,
};
