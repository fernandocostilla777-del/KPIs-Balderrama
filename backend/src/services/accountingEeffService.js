const { query } = require('../db');
const { getVentasAutosNuevosIncomeStatement } = require('./ventasAutosNuevosEeffService');
const { SUCURSALES, AREAS, resolveScope } = require('./accountingBranches');
const { computeLiquidezAnalysis } = require('./liquidezAnalysis');
const { getBalanceGeneral } = require('./balanceGeneralService');
const { BALANCE_GENERAL_SECTIONS } = require('../config/balanceGeneralAccounts');

const ACUM_DET = 'DETA';

const BALANCE_SECTIONS = [
  { key: 'activoCirculante', label: 'Activo circulante', pertenece: 'ACTIVO', grupos: ['110'] },
  { key: 'activoFijo', label: 'Activo fijo', pertenece: 'ACTIVO', grupos: ['120'] },
  { key: 'activoDiferido', label: 'Activo diferido e inversiones', pertenece: 'ACTIVO', grupos: ['130'] },
  { key: 'pasivoCortoPlazo', label: 'Pasivo corto plazo', pertenece: 'PASIVO', grupos: ['150'] },
  { key: 'pasivoLargoPlazo', label: 'Pasivo largo plazo', pertenece: 'PASIVO', grupos: ['160', '170'] },
  { key: 'capital', label: 'Capital contable', pertenece: 'CAPITAL', grupos: ['190'] },
];

const OPERATING_EXPENSE_PREFIX = '0700-%';

const EXPENSE_GROUPS = {
  gastosAdministracion: { label: 'Gastos de administración', groups: ['740', '750'] },
  productosFinancieros: {
    label: 'Productos / gastos financieros y otros',
    groups: ['800', '900', '903', '906', '908', '909', '910', '912', '931', '938', '940', '941', '942'],
    // Las cuentas 0800 se reportan como ingreso F&I, aunque su grupo contable sea financiero.
    excludePrefixes: ['0800-%'],
  },
};

// Las cuentas de administración viven dentro del prefijo 0700, por lo que hay que
// excluirlas de gastos de operación para no restarlas dos veces en el resultado.
const ADMIN_GROUPS_INSIDE_0700 = EXPENSE_GROUPS.gastosAdministracion.groups;

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

function buildBalanceExpr(endMonth) {
  const parts = ['ISNULL(CTA_SDOINICIAL, 0)'];
  for (let m = 1; m <= endMonth; m++) {
    parts.push(`ISNULL(CTA_CARGO${m}, 0) - ISNULL(CTA_ABONO${m}, 0)`);
  }
  return parts.join(' + ');
}

function incomeExpr(rawExpr) {
  return `CASE WHEN CTA_NATURALEZA = 'ACRE' THEN -(${rawExpr}) ELSE (${rawExpr}) END`;
}

function expenseExpr(rawExpr) {
  return `CASE WHEN CTA_NATURALEZA = 'DEUD' THEN (${rawExpr}) ELSE -(${rawExpr}) END`;
}

function buildLikeWhere(prefixes = [], exact = []) {
  const parts = [];
  prefixes.forEach((p, i) => parts.push(`(CTA_NUMCTA LIKE @lp${i})`));
  exact.forEach((p, i) => parts.push(`(CTA_NUMCTA LIKE @le${i})`));
  return parts.length ? parts.join(' OR ') : '1=0';
}

function likeParams(prefixes = [], exact = []) {
  const params = {};
  prefixes.forEach((p, i) => { params[`lp${i}`] = p.includes('%') ? p : `${p}%`; });
  exact.forEach((p, i) => { params[`le${i}`] = p.includes('%') ? p : `${p}%`; });
  return params;
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

async function sumByLikePatterns(table, startMonth, endMonth, { prefixes = [], exact = [], excludeGroups = [] }, asIncome) {
  if (!prefixes.length && !exact.length) return 0;
  const mov = movementExpr(startMonth, endMonth);
  const sign = asIncome ? incomeExpr(mov) : expenseExpr(mov);
  const where = buildLikeWhere(prefixes, exact);
  const params = likeParams(prefixes, exact);
  let excludeSql = '';
  if (excludeGroups.length) {
    const inList = excludeGroups.map((g, i) => `@xg${i}`).join(', ');
    excludeGroups.forEach((g, i) => { params[`xg${i}`] = g; });
    excludeSql = ` AND ISNULL(CTA_GPOCONT, '') NOT IN (${inList})`;
  }
  const rows = await query(`
    SELECT SUM(${sign}) AS total
    FROM [${table}]
    WHERE CTA_ACUMDET = '${ACUM_DET}' AND (${where})${excludeSql}
  `, params);
  return Number(rows[0]?.total || 0);
}

async function sumByGroups(table, startMonth, endMonth, groups, asIncome, excludePrefixes = []) {
  if (!groups.length) return 0;
  const mov = movementExpr(startMonth, endMonth);
  const sign = asIncome ? incomeExpr(mov) : expenseExpr(mov);
  const inList = groups.map((g, i) => `@g${i}`).join(', ');
  const params = {};
  groups.forEach((g, i) => { params[`g${i}`] = g; });
  let excludeSql = '';
  if (excludePrefixes.length) {
    excludeSql = excludePrefixes.map((p, i) => {
      params[`xp${i}`] = p.includes('%') ? p : `${p}%`;
      return ` AND CTA_NUMCTA NOT LIKE @xp${i}`;
    }).join('');
  }
  const rows = await query(`
    SELECT SUM(${sign}) AS total
    FROM [${table}]
    WHERE CTA_ACUMDET = '${ACUM_DET}' AND CTA_GPOCONT IN (${inList})${excludeSql}
  `, params);
  return Number(rows[0]?.total || 0);
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

async function getBalanceAtDate(fechaFin, scope) {
  const end = parseDate(fechaFin);
  const year = end.getFullYear();
  const month = end.getMonth() + 1;
  const table = ctasTable(year);

  if (!(await tableExists(table))) {
    return { available: false, year, month, sections: [], totals: {}, branchPosition: null };
  }

  const bal = buildBalanceExpr(month);
  const sections = [];

  if (scope.balanceConsolidated) {
    for (const def of BALANCE_SECTIONS) {
      const inList = def.grupos.map((g, i) => `@g${i}`).join(', ');
      const params = {};
      def.grupos.forEach((g, i) => { params[`g${i}`] = g; });
      const rows = await query(`
        SELECT SUM(CASE WHEN CTA_NATURALEZA = 'DEUD' THEN (${bal}) ELSE -(${bal}) END) AS saldo
        FROM [${table}]
        WHERE CTA_ACUMDET = '${ACUM_DET}' AND CTA_GPOCONT IN (${inList})
      `, params);
      let value = Number(rows[0]?.saldo || 0);
      if (def.pertenece === 'PASIVO' || def.pertenece === 'CAPITAL') value = Math.abs(value);
      sections.push({ key: def.key, label: def.label, pertenece: def.pertenece, value });
    }
  }

  let branchPosition = null;
  if (scope.balancePatterns?.length) {
    const where = scope.balancePatterns.map((p, i) => `(CTA_NUMCTA LIKE @bp${i})`).join(' OR ');
    const params = {};
    scope.balancePatterns.forEach((p, i) => { params[`bp${i}`] = p; });
    const rows = await query(`
      SELECT SUM(CASE WHEN CTA_NATURALEZA = 'DEUD' THEN (${bal}) ELSE -(${bal}) END) AS saldo
      FROM [${table}]
      WHERE CTA_ACUMDET = '${ACUM_DET}' AND (${where})
    `, params);
    branchPosition = {
      label: `CxC y cartera · ${scope.scopeLabel}`,
      value: Number(rows[0]?.saldo || 0),
    };
  }

  const activoTotal = sections.filter((s) => s.pertenece === 'ACTIVO').reduce((a, s) => a + s.value, 0);
  const pasivoTotal = sections.filter((s) => s.pertenece === 'PASIVO').reduce((a, s) => a + s.value, 0);
  const capital = sections.find((s) => s.key === 'capital')?.value || 0;

  return {
    available: true,
    year,
    month,
    asOf: fechaFin,
    consolidated: scope.balanceConsolidated,
    scopeLabel: scope.scopeLabel,
    sections,
    branchPosition,
    totals: {
      activoTotal: scope.balanceConsolidated ? activoTotal : (branchPosition?.value || 0),
      pasivoTotal: scope.balanceConsolidated ? pasivoTotal : 0,
      capital: scope.balanceConsolidated ? capital : 0,
      pasivoMasCapital: scope.balanceConsolidated ? pasivoTotal + capital : 0,
      ecuacionDiferencia: scope.balanceConsolidated ? activoTotal - (pasivoTotal + capital) : null,
    },
  };
}

async function sumOperatingExpenses(segments, scope) {
  const prefixes = scope.expenseDef?.prefixes?.length
    ? scope.expenseDef.prefixes
    : [OPERATING_EXPENSE_PREFIX];
  return sumAcrossSegments(segments, (table, ms, me) =>
    sumByLikePatterns(table, ms, me, { prefixes, excludeGroups: ADMIN_GROUPS_INSIDE_0700 }, false));
}

async function getIncomeStatement(fechaInicio, fechaFin, scope) {
  const segments = yearSegments(fechaInicio, fechaFin);

  const revenueLines = [];
  let ventasBrutas = 0;
  for (const [key, def] of Object.entries(scope.incomeLines)) {
    const value = await sumAcrossSegments(segments, (table, ms, me) =>
      sumByLikePatterns(table, ms, me, def, true));
    revenueLines.push({ key, label: def.label, value, group: 'ingreso' });
    ventasBrutas += value;
  }

  // Los descuentos sobre ventas ya vienen netados dentro de cada línea de ingreso
  // (cuentas 0460-0004/0005/0006, 0466-0002, 0467-0004, 0470-0004), por lo que no
  // se restan de nuevo aquí.
  const ventasNetas = ventasBrutas;

  const costLines = [];
  let costoVentas = 0;
  for (const [key, def] of Object.entries(scope.costLines)) {
    const value = await sumAcrossSegments(segments, (table, ms, me) =>
      sumByLikePatterns(table, ms, me, def, false));
    costLines.push({ key, label: def.label, value, group: 'costo' });
    costoVentas += value;
  }

  const expenseLines = [];
  let gastosOperacion = 0;
  let gastosAdministracion = 0;
  let productosFinancieros = 0;

  gastosOperacion = await sumOperatingExpenses(segments, scope);
  expenseLines.push({
    key: 'gastosOperacion',
    label: scope.segment
      ? `Gastos de operación (0700) · ${scope.scopeLabel}`
      : 'Gastos de operación (0700)',
    value: gastosOperacion,
    group: 'gasto',
  });

  gastosAdministracion = await sumAcrossSegments(segments, (table, ms, me) =>
    sumByGroups(table, ms, me, EXPENSE_GROUPS.gastosAdministracion.groups, false));
  expenseLines.push({
    key: 'gastosAdministracion',
    label: EXPENSE_GROUPS.gastosAdministracion.label,
    value: gastosAdministracion,
    group: 'gasto',
  });

  productosFinancieros = await sumAcrossSegments(segments, (table, ms, me) =>
    sumByGroups(table, ms, me, EXPENSE_GROUPS.productosFinancieros.groups, false, EXPENSE_GROUPS.productosFinancieros.excludePrefixes));
  expenseLines.push({
    key: 'productosFinancieros',
    label: EXPENSE_GROUPS.productosFinancieros.label,
    value: productosFinancieros,
    group: 'gasto',
  });

  const utilidadBruta = ventasNetas - costoVentas;
  const utilidadOperacion = utilidadBruta - gastosOperacion - gastosAdministracion;
  const utilidadPeriodo = utilidadOperacion - productosFinancieros;

  const margenBrutoPct = ventasNetas ? Number(((utilidadBruta / ventasNetas) * 100).toFixed(1)) : 0;
  const margenOperacionPct = ventasNetas ? Number(((utilidadOperacion / ventasNetas) * 100).toFixed(1)) : 0;
  const margenNetoPct = ventasNetas ? Number(((utilidadPeriodo / ventasNetas) * 100).toFixed(1)) : 0;

  return {
    available: (await Promise.all(segments.map((s) => tableExists(ctasTable(s.year))))).some(Boolean),
    scopeLabel: scope.scopeLabel,
    revenueLines,
    costLines,
    expenseLines,
    summary: {
      ventasNetas,
      costoVentas,
      utilidadBruta,
      gastosOperacion,
      gastosAdministracion,
      utilidadOperacion,
      productosFinancieros,
      utilidadPeriodo,
      margenBrutoPct,
      margenOperacionPct,
      margenNetoPct,
    },
    resultLines: [
      { key: 'ventasNetas', label: 'Ventas netas', value: ventasNetas, highlight: false },
      { key: 'costoVentas', label: 'Costo de ventas', value: costoVentas, highlight: false },
      { key: 'utilidadBruta', label: 'Utilidad bruta', value: utilidadBruta, highlight: true },
      { key: 'gastosOperacion', label: 'Gastos de operación', value: gastosOperacion, highlight: false },
      { key: 'gastosAdministracion', label: 'Gastos de administración', value: gastosAdministracion, highlight: false },
      { key: 'utilidadOperacion', label: 'Utilidad de operación', value: utilidadOperacion, highlight: true },
      { key: 'productosFinancieros', label: 'Productos financieros y otros', value: productosFinancieros, highlight: false },
      { key: 'utilidadPeriodo', label: 'Utilidad del periodo', value: utilidadPeriodo, highlight: true },
    ],
  };
}

async function getAccountingKpis({ fechaInicio, fechaFin, sucursal = 'todos', area = 'todos' }) {
  const scope = resolveScope(sucursal, area);
  const useVentasAutosTemplate = area === 'autosNuevos' || (sucursal !== 'todos' && area === 'todos');

  const [balance, income, balanceGeneral] = await Promise.all([
    getBalanceAtDate(fechaFin, scope),
    useVentasAutosTemplate
      ? getVentasAutosNuevosIncomeStatement(fechaInicio, fechaFin, sucursal)
      : getIncomeStatement(fechaInicio, fechaFin, scope),
    scope.balanceConsolidated
      ? getBalanceGeneral({ fechaFin }).catch(() => null)
      : Promise.resolve(null),
  ]);

  const liquidez = balanceGeneral?.liquidez || computeLiquidezAnalysis({
    activoCirculante: balance.sections.find((s) => s.key === 'activoCirculante')?.value || 0,
    pasivoCirculante: balance.sections.find((s) => s.key === 'pasivoCortoPlazo')?.value || 0,
    accounts: BALANCE_GENERAL_SECTIONS.find((s) => s.key === 'activoCirculante')?.accounts || [],
  });
  const liquidezCorriente = (balanceGeneral?.available || scope.balanceConsolidated) && liquidez.pasivoCirculante
    ? liquidez.razonCirculante
    : null;

  const balanceForTotals = balanceGeneral?.available
    ? {
      ...balance,
      sections: balanceGeneral.sections,
      totals: balanceGeneral.totals,
      balanceConsolidated: true,
    }
    : balance;

  return {
    source: 'CON_CTAS',
    filtros: { sucursal: scope.sucursal, area: scope.area, scopeLabel: scope.scopeLabel },
    catalogos: { sucursales: SUCURSALES, areas: AREAS },
    balance: balanceForTotals,
    balanceGeneral,
    income,
    liquidez,
    ratios: {
      liquidezCorriente: Number.isFinite(liquidezCorriente) ? liquidezCorriente : null,
      capitalTrabajo: liquidez.capitalTrabajo,
      pruebaAcida: liquidez.pruebaAcida,
      activosRapidos: liquidez.activosRapidos,
      inventariosYProceso: liquidez.inventariosYProceso,
      pagosAnticipados: liquidez.pagosAnticipados,
      deficitAcido: liquidez.deficitAcido,
      margenSobreAcPct: liquidez.margenSobreAcPct,
      interpretacion: liquidez.interpretacion,
      lectura: liquidez.lectura,
      margenBrutoPct: income.summary.margenBrutoPct,
      margenOperacionPct: income.summary.margenOperacionPct,
      margenNetoPct: income.summary.margenNetoPct,
      endeudamientoPct: balanceForTotals.totals?.activoTotal
        ? Number(((balanceForTotals.totals.pasivoTotal / balanceForTotals.totals.activoTotal) * 100).toFixed(1))
        : null,
    },
  };
}

module.exports = {
  getAccountingKpis,
  getBalanceAtDate,
  getIncomeStatement,
  SUCURSALES,
  AREAS,
};
