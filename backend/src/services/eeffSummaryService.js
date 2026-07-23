const path = require('path');
const { query } = require('../db');
const { getProrationFactors, getProrationMatrixMeta } = require('../config/prorationMatrix');
const { getBalanceAtDate } = require('./accountingEeffService');
const {
  MENUDEO_BRANCHES,
  FLOTILLAS_BRANCH,
  INTERCAMBIOS_BRANCH,
  POSTVENTA_SECTIONS,
  BALANCE_MAJOR_ACCOUNTS,
  ADMIN_GROUPS,
  FINANCIAL_PRODUCT_GROUPS,
  FINANCIAL_EXPENSE_ADD,
  FINANCIAL_EXPENSE_SUB,
  EEFF_CATEGORIES,
} = require('../config/eeffSummaryConfig');
const { buildEeffComparativa } = require('./eeffComparativaService');
const {
  getNomenclaturaAccountsBySection,
  getAllNomenclaturaAccounts,
  resolveNomenclaturaPath,
} = require('./eeffNomenclaturaService');

const ACUM_DET = 'DETA';
const BALANCE_MAYOR_ACUMDET = 'ACUM';
const SEMINUEVOS_INCOME = ['0446%'];
const SEMINUEVOS_COST = ['0646%', '0650%'];
const SEMINUEVOS_EXPENSE_GPO = '720';

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
    sumByGroup(table, ms, me, gpo, false));
}

async function sumAdminTotal(segments) {
  return sumAcrossSegments(segments, (table, ms, me) =>
    sumByGroups(table, ms, me, ADMIN_GROUPS, false));
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
  const ventas = await sumLine(segments, SEMINUEVOS_INCOME, true);
  const costo = await sumLine(segments, SEMINUEVOS_COST, false);
  const utilidadBruta = ventas - costo;
  const gastos = await sumGpoLine(segments, SEMINUEVOS_EXPENSE_GPO);
  const gastosAdministracion = adminTotal * (prorationFactors.seminuevos || 0);
  const sumaGastos = gastos + gastosAdministracion;
  const utilidadOperacion = utilidadBruta - sumaGastos;
  const summary = {
    ventas, costo, utilidadBruta, gastos, gastosAdministracion, sumaGastos, utilidadOperacion,
    margenBrutoPct: pct(utilidadBruta, ventas),
    margenOperacionPct: pct(utilidadOperacion, ventas),
  };
  return { summary, lines: pnlToLines(summary, 'seminuevos_') };
}

async function queryMajorAccountBalance(table, balanceExprSql, cuenta) {
  const rows = await query(`
    SELECT SUM(CASE WHEN CTA_NATURALEZA = 'DEUD' THEN (${balanceExprSql}) ELSE -(${balanceExprSql}) END) AS saldo
    FROM [${table}]
    WHERE CTA_ACUMDET = '${BALANCE_MAYOR_ACUMDET}' AND CTA_NUMCTA LIKE @p
  `, { p: `${cuenta}%` });
  return Number(rows[0]?.saldo || 0);
}

async function buildBalanceGeneral(fechaFin) {
  const balance = await getBalanceAtDate(fechaFin, {
    balanceConsolidated: true,
    balancePatterns: null,
    scopeLabel: 'Consolidado',
  });

  const end = parseDate(fechaFin);
  const year = end.getFullYear();
  const month = end.getMonth() + 1;
  const table = ctasTable(year);
  const bal = balanceExpr(month);
  const nomenclaturaBySection = getNomenclaturaAccountsBySection() || {};
  const allAccounts = getAllNomenclaturaAccounts();
  const accountsBySection = {};
  const majorLines = [];

  if (await tableExists(table) && allAccounts.length) {
    for (const [sectionKey, accounts] of Object.entries(nomenclaturaBySection)) {
      const sectionLines = [];
      for (const acc of accounts) {
        const value = await queryMajorAccountBalance(table, bal, acc.cuenta);
        const line = {
          cuenta: acc.cuenta,
          label: acc.label,
          sectionKey,
          value,
        };
        sectionLines.push(line);
        if (Math.abs(value) > 0.01) {
          majorLines.push(line);
        }
      }
      accountsBySection[sectionKey] = sectionLines;
    }
  } else if (await tableExists(table)) {
    for (const acc of BALANCE_MAJOR_ACCOUNTS) {
      const value = await queryMajorAccountBalance(table, bal, acc.cuenta);
      if (Math.abs(value) > 0.01) {
        const line = {
          cuenta: acc.cuenta,
          label: acc.label,
          group: acc.group,
          sectionKey: acc.group === 'pasivo' ? 'pasivoCortoPlazo' : acc.group,
          value,
        };
        majorLines.push(line);
        const sk = line.sectionKey;
        if (!accountsBySection[sk]) accountsBySection[sk] = [];
        accountsBySection[sk].push(line);
      }
    }
  }

  return {
    available: balance.available,
    asOf: fechaFin,
    nomenclaturaSource: resolveNomenclaturaPath() ? path.basename(resolveNomenclaturaPath()) : null,
    sections: balance.sections || [],
    accountsBySection,
    majorAccounts: majorLines,
    totals: balance.totals || {},
    lines: (balance.sections || []).map((s) =>
      line(s.key, s.label, s.value, { group: s.pertenece, highlight: s.key === 'capital' }),
    ),
  };
}

async function buildEstadoFinanciero(segments, ventas, postventa, seminuevos, adminTotal) {
  const productosFinancieros = await sumAcrossSegments(segments, (table, ms, me) =>
    sumByGroups(table, ms, me, FINANCIAL_PRODUCT_GROUPS, true));

  let gastosFinancieros = await sumAcrossSegments(segments, (table, ms, me) =>
    sumByGroups(table, ms, me, FINANCIAL_EXPENSE_ADD, false));
  const gastosFinSub = await sumAcrossSegments(segments, (table, ms, me) =>
    sumByGroups(table, ms, me, FINANCIAL_EXPENSE_SUB, false));
  gastosFinancieros -= gastosFinSub;

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
  const utilidad = utilidadOperacion + utilidadFinanciera;

  const lines = [
    line('ventasAutos', 'Ventas autos nuevos', ventas.totalVentasAutos.summary.ventas, { group: 'ingreso' }),
    line('ventasMenudeo', '  Menudeo', ventas.menudeo.summary.ventas, { group: 'ingreso', level: 1 }),
    line('ventasFlotillas', '  Flotillas', ventas.flotillas.summary.ventas, { group: 'ingreso', level: 1 }),
    line('ventasIntercambios', '  Intercambios', ventas.intercambios.summary.ventas, { group: 'ingreso', level: 1 }),
    line('ventasSeminuevos', 'Ventas seminuevos', seminuevos.summary.ventas, { group: 'ingreso' }),
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
      utilidadFinanciera,
      utilidad,
      margenBrutoPct: pct(utilidadBruta, ventasTotales),
      margenOperacionPct: pct(utilidadOperacion, ventasTotales),
    },
    lines,
  };
}

async function getEeffSummary({ fechaInicio, fechaFin }) {
  const segments = yearSegments(fechaInicio, fechaFin);
  const available = (await Promise.all(segments.map((s) => tableExists(ctasTable(s.year))))).some(Boolean);
  const prorationFactors = getProrationFactors({ fechaFin });
  const prorationMeta = getProrationMatrixMeta({ fechaFin });
  const adminTotal = await sumAdminTotal(segments);

  const [ventas, postventa, seminuevos, balanceGeneral] = await Promise.all([
    buildVentasSection(segments, adminTotal, prorationFactors),
    buildPostventaSection(segments, adminTotal, prorationFactors),
    buildSeminuevosSection(segments, adminTotal, prorationFactors),
    buildBalanceGeneral(fechaFin),
  ]);

  const estadoFinanciero = await buildEstadoFinanciero(
    segments, ventas, postventa, seminuevos, adminTotal,
  );

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
    proration: {
      ...prorationMeta,
      factors: prorationFactors,
      adminTotal,
    },
    methodology: {
      ventas: 'Menudeo (sucursales) + Flotillas + Intercambios = total autos nuevos',
      postventa: 'Servicio (0460) + Refacciones (0481–84) + HYP (0480/0466)',
      gastos: 'GPOCONT por departamento + prorrateo administración (740/750) según configuración en Administración (ventas/postventa)',
      balance: 'Saldos al cierre · GPOCONT 110–190 + cuentas mayor ACUM',
    },
  };

  payload.comparativaPresupuesto = buildEeffComparativa(payload, fechaInicio, fechaFin);
  return payload;
}

module.exports = { getEeffSummary, EEFF_CATEGORIES };
