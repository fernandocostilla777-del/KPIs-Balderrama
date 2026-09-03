const { query } = require('../db');
const { getProrationFactors, getProrationMatrixMeta } = require('../config/prorationMatrix');
const {
  MENUDEO_BRANCHES,
  FLOTILLAS_BRANCH,
  INTERCAMBIOS_BRANCH,
  SEMINUEVOS_BRANCHES,
  POSTVENTA_SECTIONS,
  ADMIN_GROUPS,
  FINANCIAL_PRODUCT_GROUPS,
  FINANCIAL_EXPENSE_ADD,
  FINANCIAL_EXPENSE_SUB,
  FINANCIAL_INTEREST_PREFIXES,
  EEFF_CATEGORIES,
} = require('../config/eeffSummaryConfig');
const {
  getAccountsForGpo,
  getDepartmentByGpo,
} = require('../config/departmentExpenseMapping');
const { buildEeffComparativa } = require('./eeffComparativaService');
const { getBalanceGeneral, getDepreciacionPeriodo } = require('./balanceGeneralService');
const { computeEbitMetrics } = require('./estructuraFinanciera');
const { getCatalogKpis } = require('./accountingCatalogKpiService');

const ACUM_DET = 'DETA';
const SEMINUEVOS_EXPENSE_GPO = '720';
/** GPO de operación a reportar en el drill de gastos (sin verificentro). */
const OPERATING_DEPARTMENT_GPOS = [
  '711', '712', '713', '714', '715', '716', '717', '718',
  '720', '730', '731', '732', '733',
];

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

function balanceExpr(endMonth) {
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

function shiftYearIso(iso, years) {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setFullYear(d.getFullYear() + years);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

/**
 * Suma movimiento DETA de cuentas explícitas del departamento,
 * restringidas a su GPOCONT (evita mezclar productos financieros 81x/82x).
 * Si no hay lista, cae a suma por GPO.
 */
async function sumByDepartmentAccounts(table, startMonth, endMonth, gpoCont) {
  const accounts = getAccountsForGpo(gpoCont);
  if (!accounts.length) {
    return sumByGroup(table, startMonth, endMonth, gpoCont, false);
  }
  const mov = movementExpr(startMonth, endMonth);
  const sign = expenseExpr(mov);
  let total = 0;
  for (let i = 0; i < accounts.length; i += 80) {
    const batch = accounts.slice(i, i + 80);
    const params = { gpo: String(gpoCont) };
    const ph = batch.map((_, j) => `@a${j}`).join(', ');
    batch.forEach((acc, j) => { params[`a${j}`] = acc; });
    const rows = await query(`
      SELECT SUM(${sign}) AS total
      FROM [${table}]
      WHERE CTA_ACUMDET = '${ACUM_DET}'
        AND CTA_GPOCONT = @gpo
        AND CTA_NUMCTA IN (${ph})
    `, params);
    total += Number(rows[0]?.total || 0);
  }
  return total;
}

async function sumByGroups(table, startMonth, endMonth, groups, asIncome) {
  if (!groups.length) return 0;
  const mov = movementExpr(startMonth, endMonth);
  const sign = asIncome ? incomeExpr(mov) : expenseExpr(mov);
  const inList = groups.map((g, i) => `@g${i}`).join(', ');
  const params = {};
  groups.forEach((g, i) => { params[`g${i}`] = g; });
  const rows = await query(`
    SELECT SUM(${sign}) AS total
    FROM [${table}]
    WHERE CTA_ACUMDET = '${ACUM_DET}' AND CTA_GPOCONT IN (${inList})
  `, params);
  return Number(rows[0]?.total || 0);
}

async function sumLine(segments, prefixes, asIncome) {
  return sumAcrossSegments(segments, (table, ms, me) =>
    sumByLikePatterns(table, ms, me, prefixes, asIncome));
}

async function sumGpoLine(segments, gpo) {
  return sumAcrossSegments(segments, (table, ms, me) =>
    sumByDepartmentAccounts(table, ms, me, gpo));
}

async function sumAdminTotal(segments) {
  let total = 0;
  for (const gpo of ADMIN_GROUPS) {
    total += await sumGpoLine(segments, gpo);
  }
  return total;
}

async function buildDepartmentExpenseBreakdown(segments) {
  const rows = [];
  for (const gpo of OPERATING_DEPARTMENT_GPOS) {
    const dept = getDepartmentByGpo(gpo);
    const value = await sumGpoLine(segments, gpo);
    rows.push({
      id: dept?.id || `gpo_${gpo}`,
      label: dept?.label || `GPO ${gpo}`,
      gpoCont: gpo,
      accountCount: dept?.accounts?.length || 0,
      value,
    });
  }
  return rows;
}

function pct(num, den) {
  if (!den) return 0;
  return Number(((num / den) * 100).toFixed(1));
}

function line(key, label, value, extra = {}) {
  return { key, label, value, ...extra };
}

async function buildBranchPnL(segments, branchDef, adminTotal, prorationFactors) {
  const ventas = await sumLine(segments, branchDef.revenuePrefixes, true);
  const costo = await sumLine(segments, branchDef.costPrefixes, false);
  const utilidadBruta = ventas - costo;
  const gastos = branchDef.expenseGpo
    ? await sumGpoLine(segments, branchDef.expenseGpo)
    : 0;
  const factor = prorationFactors[branchDef.prorationKey] || 0;
  const gastosAdministracion = adminTotal * factor;
  const sumaGastos = gastos + gastosAdministracion;
  const utilidadOperacion = utilidadBruta - sumaGastos;

  return {
    id: branchDef.id,
    label: branchDef.label,
    ventas,
    costo,
    utilidadBruta,
    gastos,
    gastosAdministracion,
    sumaGastos,
    utilidadOperacion,
    margenBrutoPct: pct(utilidadBruta, ventas),
    margenOperacionPct: pct(utilidadOperacion, ventas),
    prorationPct: factor * 100,
  };
}

function aggregateRows(rows) {
  const sum = (fn) => rows.reduce((a, r) => a + fn(r), 0);
  const ventas = sum((r) => r.ventas);
  const costo = sum((r) => r.costo);
  const utilidadBruta = ventas - costo;
  const gastos = sum((r) => r.gastos);
  const gastosAdministracion = sum((r) => r.gastosAdministracion);
  const sumaGastos = gastos + gastosAdministracion;
  const utilidadOperacion = utilidadBruta - sumaGastos;
  return {
    ventas, costo, utilidadBruta, gastos, gastosAdministracion, sumaGastos, utilidadOperacion,
    margenBrutoPct: pct(utilidadBruta, ventas),
    margenOperacionPct: pct(utilidadOperacion, ventas),
  };
}

function pnlToLines(row, prefix = '') {
  return [
    line(`${prefix}ventas`, 'Ventas', row.ventas, { group: 'ingreso' }),
    line(`${prefix}costo`, 'Costo de ventas', row.costo, { group: 'costo' }),
    line(`${prefix}utilidadBruta`, 'Utilidad bruta', row.utilidadBruta, { group: 'resultado', highlight: true }),
    line(`${prefix}gastos`, 'Gastos operación', row.gastos, { group: 'gasto' }),
    line(`${prefix}gastosAdmin`, 'Gastos administración (prorrateo)', row.gastosAdministracion, { group: 'gasto' }),
    line(`${prefix}sumaGastos`, 'Suma gastos', row.sumaGastos, { group: 'gasto', highlight: true }),
    line(`${prefix}utilidadOperacion`, 'Utilidad de operación', row.utilidadOperacion, { group: 'resultado', highlight: true }),
  ];
}

async function buildVentasSection(segments, adminTotal, prorationFactors) {
  const menudeoBranches = await Promise.all(
    MENUDEO_BRANCHES.map((b) => buildBranchPnL(segments, b, adminTotal, prorationFactors)),
  );
  const flotillas = await buildBranchPnL(segments, FLOTILLAS_BRANCH, adminTotal, prorationFactors);
  const intercambios = await buildBranchPnL(segments, INTERCAMBIOS_BRANCH, adminTotal, prorationFactors);

  const menudeo = aggregateRows(menudeoBranches);
  const totalVentasAutos = aggregateRows([...menudeoBranches, flotillas, intercambios]);

  return {
    menudeo: {
      label: 'Menudeo',
      description: 'Piso · Zacatelco · Foráneos · Cholula · SuAuto · Casa',
      branches: menudeoBranches,
      summary: menudeo,
      lines: [
        line('menudeo_total', 'Total menudeo', menudeo.ventas, { group: 'ingreso', highlight: true, level: 0 }),
        ...menudeoBranches.flatMap((b) => [
          line(`menudeo_${b.id}_ventas`, `  ${b.label}`, b.ventas, { group: 'ingreso', level: 1 }),
        ]),
        ...pnlToLines(menudeo, 'menudeo_'),
      ],
    },
    flotillas: {
      label: 'Flotillas',
      branch: flotillas,
      summary: flotillas,
      lines: pnlToLines(flotillas, 'flotillas_'),
    },
    intercambios: {
      label: 'Intercambios',
      branch: intercambios,
      summary: intercambios,
      lines: pnlToLines(intercambios, 'intercambios_'),
    },
    totalVentasAutos: {
      label: 'Total ventas autos nuevos',
      summary: totalVentasAutos,
      lines: pnlToLines(totalVentasAutos, 'total_'),
    },
  };
}

async function buildPostventaSection(segments, adminTotal, prorationFactors) {
  const sections = await Promise.all(
    POSTVENTA_SECTIONS.map(async (def) => {
      const ventas = await sumLine(segments, def.revenuePrefixes, true);
      const costo = await sumLine(segments, def.costPrefixes, false);
      const utilidadBruta = ventas - costo;
      const gastos = await sumGpoLine(segments, def.expenseGpo);
      const factor = prorationFactors[def.prorationKey] || 0;
      const gastosAdministracion = adminTotal * factor;
      const sumaGastos = gastos + gastosAdministracion;
      const utilidadOperacion = utilidadBruta - sumaGastos;
      return {
        id: def.id,
        label: def.label,
        ventas,
        costo,
        utilidadBruta,
        gastos,
        gastosAdministracion,
        sumaGastos,
        utilidadOperacion,
        margenBrutoPct: pct(utilidadBruta, ventas),
        margenOperacionPct: pct(utilidadOperacion, ventas),
      };
    }),
  );

  const total = aggregateRows(sections);

  return {
    description: 'Acumulado Servicio + Refacciones + HYP',
    sections,
    summary: total,
    lines: [
      line('postventa_total', 'Total PostVenta', total.ventas, { group: 'ingreso', highlight: true }),
      ...sections.flatMap((s) => [
        line(`pv_${s.id}_ventas`, `  ${s.label}`, s.ventas, { group: 'ingreso', level: 1 }),
      ]),
      ...pnlToLines(total, 'postventa_'),
    ],
  };
}

async function buildSeminuevosSection(segments, adminTotal, prorationFactors) {
  const factor = prorationFactors.seminuevos || 0;
  const gastosTotal = await sumGpoLine(segments, SEMINUEVOS_EXPENSE_GPO);
  const gastosAdministracionTotal = adminTotal * factor;

  const branches = [];
  for (const def of SEMINUEVOS_BRANCHES) {
    const ventas = await sumLine(segments, def.revenuePrefixes, true);
    const costo = await sumLine(segments, def.costPrefixes, false);
    const utilidadBruta = ventas - costo;
    const share = 0; // gastos se asignan al total, no por rama
    branches.push({
      id: def.id,
      label: def.label,
      ventas,
      costo,
      utilidadBruta,
      gastos: 0,
      gastosAdministracion: 0,
      sumaGastos: 0,
      utilidadOperacion: utilidadBruta,
      margenBrutoPct: pct(utilidadBruta, ventas),
      margenOperacionPct: pct(utilidadBruta, ventas),
      share,
    });
  }

  const ventas = branches.reduce((s, b) => s + b.ventas, 0);
  const costo = branches.reduce((s, b) => s + b.costo, 0);
  const utilidadBruta = ventas - costo;
  const sumaGastos = gastosTotal + gastosAdministracionTotal;
  const utilidadOperacion = utilidadBruta - sumaGastos;

  const summary = {
    ventas,
    costo,
    utilidadBruta,
    gastos: gastosTotal,
    gastosAdministracion: gastosAdministracionTotal,
    sumaGastos,
    utilidadOperacion,
    margenBrutoPct: pct(utilidadBruta, ventas),
    margenOperacionPct: pct(utilidadOperacion, ventas),
  };

  return {
    branches,
    summary,
    lines: [
      line('seminuevos_total', 'Total seminuevos', ventas, { group: 'ingreso', highlight: true }),
      ...branches.map((b) =>
        line(`seminuevos_${b.id}_ventas`, `  ${b.label}`, b.ventas, { group: 'ingreso', level: 1 })),
      ...pnlToLines(summary, 'seminuevos_'),
    ],
  };
}

async function buildBalanceGeneral(fechaFin) {
  const bg = await getBalanceGeneral({ fechaFin });
  return {
    available: bg.available,
    asOf: fechaFin,
    nomenclaturaSource: 'balanceGeneralAccounts.js',
    sections: bg.sections || [],
    accountsBySection: bg.accountsBySection || {},
    majorAccounts: bg.majorAccounts || [],
    totals: bg.totals || {},
    liquidez: bg.liquidez,
    lines: bg.lines || [],
    methodology: bg.methodology,
  };
}

async function buildEstadoFinanciero(segments, ventas, postventa, seminuevos, adminTotal, gastosPorDepartamento = []) {
  const productosFinancieros = await sumAcrossSegments(segments, (table, ms, me) =>
    sumByGroups(table, ms, me, FINANCIAL_PRODUCT_GROUPS, true));

  let gastosFinancieros = await sumAcrossSegments(segments, (table, ms, me) =>
    sumByGroups(table, ms, me, FINANCIAL_EXPENSE_ADD, false));
  const gastosFinSub = await sumAcrossSegments(segments, (table, ms, me) =>
    sumByGroups(table, ms, me, FINANCIAL_EXPENSE_SUB, false));
  gastosFinancieros -= gastosFinSub;

  const interesesPlanPiso = await sumLine(segments, FINANCIAL_INTEREST_PREFIXES.planPiso, false);
  const interesesMoratorios = await sumLine(segments, FINANCIAL_INTEREST_PREFIXES.moratorios, false);

  const ventasTotales = ventas.totalVentasAutos.summary.ventas
    + seminuevos.summary.ventas
    + postventa.summary.ventas;

  const costoTotal = ventas.totalVentasAutos.summary.costo
    + seminuevos.summary.costo
    + postventa.summary.costo;

  const utilidadBruta = ventasTotales - costoTotal;
  const gastosOperacion = ventas.totalVentasAutos.summary.gastos
    + seminuevos.summary.gastos
    + postventa.summary.gastos;
  const gastosAdministracion = adminTotal;
  const sumaGastos = gastosOperacion + gastosAdministracion;
  const utilidadOperacion = utilidadBruta - sumaGastos;
  const utilidadFinanciera = productosFinancieros - gastosFinancieros;
  const perdidaFinanciera = productosFinancieros
    - gastosFinancieros
    - interesesPlanPiso
    - interesesMoratorios;
  const utilidad = utilidadOperacion + utilidadFinanciera;

  const lines = [
    line('ventasAutos', 'Ventas autos nuevos', ventas.totalVentasAutos.summary.ventas, { group: 'ingreso' }),
    line('ventasMenudeo', '  Menudeo', ventas.menudeo.summary.ventas, { group: 'ingreso', level: 1 }),
    line('ventasFlotillas', '  Flotillas', ventas.flotillas.summary.ventas, { group: 'ingreso', level: 1 }),
    line('ventasIntercambios', '  Intercambios', ventas.intercambios.summary.ventas, { group: 'ingreso', level: 1 }),
    line('ventasSeminuevos', 'Ventas seminuevos', seminuevos.summary.ventas, { group: 'ingreso' }),
    ...(seminuevos.branches || []).map((b) =>
      line(`ventasSeminuevos_${b.id}`, `  ${b.label}`, b.ventas, { group: 'ingreso', level: 1 })),
    line('ventasPostventa', 'Ventas PostVenta', postventa.summary.ventas, { group: 'ingreso' }),
    ...postventa.sections.map((s) =>
      line(`pv_${s.id}`, `  ${s.label}`, s.ventas, { group: 'ingreso', level: 1 })),
    line('ventasTotales', 'Total ventas', ventasTotales, { group: 'ingreso', highlight: true }),
    line('costoTotal', 'Costo de ventas', costoTotal, { group: 'costo' }),
    line('utilidadBruta', 'Utilidad bruta', utilidadBruta, { group: 'resultado', highlight: true }),
    line('gastosOperacion', 'Gastos de operación', gastosOperacion, { group: 'gasto' }),
    line('gastosAdministracion', 'Gastos administración', gastosAdministracion, { group: 'gasto' }),
    line('sumaGastos', 'Suma gastos', sumaGastos, { group: 'gasto', highlight: true }),
    line('utilidadOperacion', 'Utilidad de operación', utilidadOperacion, { group: 'resultado', highlight: true }),
    line('productosFinancieros', 'Productos financieros', productosFinancieros, { group: 'financiero' }),
    line('gastosFinancieros', 'Gastos financieros', gastosFinancieros, { group: 'financiero' }),
    line('interesesPlanPiso', 'Intereses Plan Piso', interesesPlanPiso, { group: 'financiero' }),
    line('interesesMoratorios', 'Intereses moratorios', interesesMoratorios, { group: 'financiero' }),
    line('perdidaFinanciera', 'Pérdida financiera', perdidaFinanciera, { group: 'financiero', highlight: true }),
    line('utilidadFinanciera', 'Utilidad / pérdida financiera', utilidadFinanciera, { group: 'financiero' }),
    line('utilidad', 'Utilidad', utilidad, { group: 'resultado', highlight: true }),
  ];

  return {
    summary: {
      ventasTotales,
      costoTotal,
      utilidadBruta,
      gastosOperacion,
      gastosAdministracion,
      sumaGastos,
      utilidadOperacion,
      productosFinancieros,
      gastosFinancieros,
      interesesPlanPiso,
      interesesMoratorios,
      perdidaFinanciera,
      utilidadFinanciera,
      utilidad,
      margenBrutoPct: pct(utilidadBruta, ventasTotales),
      margenOperacionPct: pct(utilidadOperacion, ventasTotales),
    },
    gastosPorDepartamento,
    lines,
  };
}

async function getEeffSummary({ fechaInicio, fechaFin }) {
  const segments = yearSegments(fechaInicio, fechaFin);
  const available = (await Promise.all(segments.map((s) => tableExists(ctasTable(s.year))))).some(Boolean);
  const prorationFactors = getProrationFactors({ fechaFin });
  const prorationMeta = getProrationMatrixMeta({ fechaFin });
  const adminTotal = await sumAdminTotal(segments);

  const priorInicio = shiftYearIso(fechaInicio, -1);
  const priorFin = shiftYearIso(fechaFin, -1);

  const [ventas, postventa, seminuevos, balanceGeneral, gastosPorDepartamento, depPeriodo, catalogPrior] = await Promise.all([
    buildVentasSection(segments, adminTotal, prorationFactors),
    buildPostventaSection(segments, adminTotal, prorationFactors),
    buildSeminuevosSection(segments, adminTotal, prorationFactors),
    buildBalanceGeneral(fechaFin),
    buildDepartmentExpenseBreakdown(segments),
    getDepreciacionPeriodo(fechaInicio, fechaFin).catch((err) => {
      console.error('[eeff] depreciacionPeriodo:', err.message);
      return { available: false, depreciacionPeriodo: 0 };
    }),
    getCatalogKpis({ fechaInicio: priorInicio, fechaFin: priorFin }).catch(() => null),
  ]);

  const estadoFinanciero = await buildEstadoFinanciero(
    segments, ventas, postventa, seminuevos, adminTotal, gastosPorDepartamento,
  );

  const ebitMetrics = computeEbitMetrics({
    ventas: estadoFinanciero.summary.ventasTotales,
    utilidadOperacion: estadoFinanciero.summary.utilidadOperacion,
    depreciacionPeriodo: depPeriodo?.depreciacionPeriodo || 0,
    utilidadOperacionAnterior: catalogPrior?.summary?.utilidadOperacion ?? null,
  });
  Object.assign(estadoFinanciero.summary, {
    ebit: ebitMetrics.ebit,
    ebitda: ebitMetrics.ebitda,
    uafida: ebitMetrics.uafida,
    margenEbitPct: ebitMetrics.margenEbitPct,
    margenEbitdaPct: ebitMetrics.margenEbitdaPct,
    crecimientoEbitPct: ebitMetrics.crecimientoEbitPct,
    depreciacionPeriodo: ebitMetrics.depreciacionPeriodo,
    ebitdaTone: ebitMetrics.ebitdaTone,
    ebitdaLabel: ebitMetrics.ebitdaLabel,
    ebitdaSummary: ebitMetrics.ebitdaSummary,
  });

  const payload = {
    available,
    source: 'CON_CTAS · EEFF SUMMARY',
    template: 'EEFF DIC 2025 SUMMARY.xlsx',
    filtros: { fechaInicio, fechaFin },
    categorias: EEFF_CATEGORIES,
    balanceGeneral,
    estadoFinanciero,
    ventas,
    postventa,
    seminuevos,
    ebitMetrics,
    depreciacionPeriodo: depPeriodo,
    proration: {
      ...prorationMeta,
      factors: prorationFactors,
      adminTotal,
    },
    methodology: {
      ventas: 'Menudeo (sucursales) + Flotillas + Intercambios = total autos nuevos',
      postventa: 'Servicio + Refacciones + HYP (prefijos Contpaq)',
      gastos: 'Cuentas Contpaq por departamento (listas) restringidas a CTA_GPOCONT + prorrateo administración (740/750)',
      balance: 'Saldos al cierre · GPOCONT 110–190 + cuentas mayor ACUM',
      ebitda: 'EBIT (utilidad operación) + Δ depreciación acumulada del periodo',
      crecimientoEbit: 'Variación % de utilidad de operación vs mismo periodo del año anterior',
    },
  };

  payload.comparativaPresupuesto = buildEeffComparativa(payload, fechaInicio, fechaFin);
  return payload;
}

module.exports = { getEeffSummary, EEFF_CATEGORIES };
