const { query } = require('../db');
const {
  INCOME_CATALOG,
  COST_CATALOG,
  EXPENSE_CATALOG,
  resolveCatalogScope,
  filterPrefixesBySegment,
} = require('../config/accountCatalogMapping');
const {
  DEPARTMENTS,
  getDepartmentsForScope,
  getGpoGroupsForScope,
} = require('../config/departmentExpenseMapping');

const ACUM_DET = 'DETA';

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

/** Créditos netos para ingresos (cuentas acreedoras) */
function incomeExpr(rawExpr) {
  return `CASE WHEN CTA_NATURALEZA = 'ACRE' THEN -(${rawExpr}) ELSE (${rawExpr}) END`;
}

/** Cargos netos para costos y gastos (cuentas deudoras) */
function expenseExpr(rawExpr) {
  return `CASE WHEN CTA_NATURALEZA = 'DEUD' THEN (${rawExpr}) ELSE -(${rawExpr}) END`;
}

function buildLikeWhere(prefixes) {
  if (!prefixes.length) return '1=0';
  return prefixes.map((_, i) => `(CTA_NUMCTA LIKE @p${i})`).join(' OR ');
}

function likeParams(prefixes) {
  const params = {};
  prefixes.forEach((p, i) => {
    params[`p${i}`] = p.includes('%') ? p : `${p}%`;
  });
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

async function sumByPrefixes(table, startMonth, endMonth, prefixes, asIncome) {
  if (!prefixes.length) return 0;
  const mov = movementExpr(startMonth, endMonth);
  const sign = asIncome ? incomeExpr(mov) : expenseExpr(mov);
  const where = buildLikeWhere(prefixes);
  const params = likeParams(prefixes);
  const rows = await query(`
    SELECT SUM(${sign}) AS total
    FROM [${table}]
    WHERE CTA_ACUMDET = '${ACUM_DET}' AND (${where})
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

async function sumLine(segments, prefixes, asIncome) {
  return sumAcrossSegments(segments, (table, ms, me) =>
    sumByPrefixes(table, ms, me, prefixes, asIncome));
}

function pct(num, den) {
  if (!den) return 0;
  return Number(((num / den) * 100).toFixed(1));
}

/** PE operativo preliminar: GF ÷ (MC / Ventas). Por defecto GF = gastos depto. */
function breakEven(gastosFijos, margenContribucion, ventasTotales) {
  const margenPct = ventasTotales ? margenContribucion / ventasTotales : 0;
  if (margenPct <= 0) return null;
  return Number((gastosFijos / margenPct).toFixed(2));
}

async function buildIncomeLines(segments, scope) {
  const lines = [];
  let ventasTotales = 0;

  for (const key of scope.incomeKeys) {
    const def = INCOME_CATALOG[key];
    if (!def) continue;
    let prefixes = [...def.prefixes];
    if (scope.segment && key === 'autosNuevos') {
      prefixes = filterPrefixesBySegment(prefixes, scope.segment);
    }
    const value = await sumLine(segments, prefixes, true);
    lines.push({
      key: def.key,
      label: def.label,
      value,
      group: 'ingreso',
      majorAccount: def.majorAccount,
    });
    ventasTotales += value;

    if (def.channels && scope.segment == null && key === 'autosNuevos' && scope.area === 'todos') {
      for (const ch of def.channels) {
        const chVal = await sumLine(segments, [ch.prefix], true);
        if (Math.abs(chVal) > 0.01) {
          lines.push({
            key: ch.key,
            label: `  ${ch.label}`,
            value: chVal,
            group: 'ingreso',
            level: 2,
          });
        }
      }
    }

    if (def.subLines && (scope.area === 'todos' || key === 'refacciones')) {
      for (const sub of def.subLines) {
        const subVal = await sumLine(segments, [sub.prefix], true);
        if (Math.abs(subVal) > 0.01) {
          lines.push({
            key: sub.key,
            label: `  ${sub.label}`,
            value: subVal,
            group: 'ingreso',
            level: 2,
          });
        }
      }
    }
  }

  return { lines, ventasTotales };
}

async function buildCostLines(segments, scope) {
  const lines = [];
  let costoVentas = 0;

  for (const key of scope.costKeys) {
    const def = COST_CATALOG[key];
    if (!def) continue;
    let prefixes = [...def.prefixes];
    if (scope.segment && key === 'autosNuevos') {
      prefixes = filterPrefixesBySegment(prefixes, scope.segment);
    }
    const value = await sumLine(segments, prefixes, false);
    lines.push({
      key: def.key,
      label: def.label,
      value,
      group: 'costo',
      majorAccount: def.majorAccount,
    });
    costoVentas += value;

    if (def.channels && !scope.segment && key === 'autosNuevos' && scope.area === 'todos') {
      for (const ch of def.channels) {
        const chVal = await sumLine(segments, [ch.prefix], false);
        if (Math.abs(chVal) > 0.01) {
          lines.push({
            key: ch.key,
            label: `  ${ch.label}`,
            value: chVal,
            group: 'costo',
            level: 2,
          });
        }
      }
    }
  }

  return { lines, costoVentas };
}

async function sumByGpoCont(table, startMonth, endMonth, groups) {
  if (!groups.length) return 0;
  const mov = movementExpr(startMonth, endMonth);
  const sign = expenseExpr(mov);
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

async function sumByAccountNumbers(table, startMonth, endMonth, accounts) {
  if (!accounts.length) return 0;
  const mov = movementExpr(startMonth, endMonth);
  const sign = expenseExpr(mov);
  let total = 0;
  for (let i = 0; i < accounts.length; i += 80) {
    const batch = accounts.slice(i, i + 80);
    const params = {};
    const ph = batch.map((_, j) => `@a${j}`).join(', ');
    batch.forEach((acc, j) => { params[`a${j}`] = acc; });
    const rows = await query(`
      SELECT SUM(${sign}) AS total
      FROM [${table}]
      WHERE CTA_ACUMDET = '${ACUM_DET}' AND CTA_NUMCTA IN (${ph})
    `, params);
    total += Number(rows[0]?.total || 0);
  }
  return total;
}

async function sumGpoLine(segments, groups) {
  return sumAcrossSegments(segments, (table, ms, me) =>
    sumByGpoCont(table, ms, me, groups));
}

async function sumDepartmentGasto(segments, dept) {
  // Lista Contpaq por departamento, restringida a CTA_GPOCONT del depto
  // (evita inflar con productos financieros 81x/82x que aparecen en las capturas).
  return sumAcrossSegments(segments, async (table, ms, me) => {
    const accounts = dept.accounts || [];
    if (!accounts.length) {
      return sumByGpoCont(table, ms, me, [dept.gpoCont]);
    }
    const mov = movementExpr(ms, me);
    const sign = expenseExpr(mov);
    let total = 0;
    for (let i = 0; i < accounts.length; i += 80) {
      const batch = accounts.slice(i, i + 80);
      const params = { gpo: String(dept.gpoCont) };
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
  });
}

async function buildDepartmentExpenseLines(segments, sucursal, area) {
  const departments = getDepartmentsForScope(sucursal, area);
  const lines = [];
  let gastoDepartamento = 0;

  for (const dept of departments) {
    const value = await sumDepartmentGasto(segments, dept);
    gastoDepartamento += value;
    lines.push({
      key: dept.id,
      label: dept.label,
      value,
      group: 'gasto',
      gpoCont: dept.gpoCont,
      accountCount: dept.accounts?.length || 0,
    });
  }

  return { lines, gastoDepartamento, departments };
}

async function buildExpenseLines(segments, scope) {
  const gastosOperacion = await sumLine(segments, ['0700%'], false);

  const { lines: departmentLines, gastoDepartamento } = await buildDepartmentExpenseLines(
    segments,
    scope.sucursal,
    scope.area,
  );

  const lines = [
    {
      key: 'gastosOperacionTotal',
      label: 'Gastos de operación total (0700)',
      value: gastosOperacion,
      group: 'gasto',
      majorAccount: EXPENSE_CATALOG.general.majorAccount,
      highlight: true,
    },
    {
      key: 'gastoDepartamento',
      label: scope.scopeLabel === 'Consolidado'
        ? 'Gasto por departamentos (catálogo Excel)'
        : `Gasto · ${scope.scopeLabel}`,
      value: gastoDepartamento,
      group: 'gasto',
      highlight: false,
    },
  ];

  if (departmentLines.length) {
    for (const dept of departmentLines) {
      if (Math.abs(dept.value) > 0.01) {
        lines.push({
          key: dept.key,
          label: `  ${dept.label} (GPO ${dept.gpoCont})`,
          value: dept.value,
          group: 'gasto',
          level: 2,
        });
      }
    }
  }

  if (scope.sucursal === 'todos' && scope.area === 'todos') {
    for (const sub of EXPENSE_CATALOG.criticalSubaccounts) {
      const val = await sumLine(segments, [sub.prefix], false);
      if (Math.abs(val) > 0.01) {
        lines.push({
          key: sub.key,
          label: `  ${sub.label}`,
          value: val,
          group: 'gasto',
          level: 2,
        });
      }
    }
  }

  return { lines, gastosOperacion, gastoDepartamento, departmentLines };
}

async function getCatalogKpis({ fechaInicio, fechaFin, sucursal = 'todos', area = 'todos', includeFi = true }) {
  const scope = resolveCatalogScope(sucursal, area, includeFi);
  const segments = yearSegments(fechaInicio, fechaFin);

  const available = (await Promise.all(
    segments.map((s) => tableExists(ctasTable(s.year))),
  )).some(Boolean);

  const [income, cost, expense] = await Promise.all([
    buildIncomeLines(segments, scope),
    buildCostLines(segments, scope),
    buildExpenseLines(segments, scope),
  ]);

  const ventasTotales = income.ventasTotales;
  const costoVentas = cost.costoVentas;
  const gastosOperacion = expense.gastosOperacion;
  const gastoDepartamento = expense.gastoDepartamento;
  const utilidadBruta = ventasTotales - costoVentas;
  const utilidadOperacion = utilidadBruta - gastosOperacion;
  const margenBrutoPct = pct(utilidadBruta, ventasTotales);
  const margenOperacionPct = pct(utilidadOperacion, ventasTotales);
  // Preliminar: TOTAL COSTOS = variable · gastos depto = fijos (no usar 0700 total)
  const puntoEquilibrio = breakEven(gastoDepartamento, utilidadBruta, ventasTotales);

  const resultLines = [
    { key: 'ventasTotales', label: 'Ventas totales (0400 + complementos)', value: ventasTotales, group: 'ingreso' },
    { key: 'costoVentas', label: 'Costo de ventas (0600)', value: costoVentas, group: 'costo' },
    { key: 'utilidadBruta', label: 'Utilidad bruta / MC preliminar', value: utilidadBruta, group: 'resultado', highlight: true },
    { key: 'gastoDepartamento', label: 'Gastos fijos provisionales (depto)', value: gastoDepartamento, group: 'gasto' },
    { key: 'gastosOperacion', label: 'Gastos de operación total (0700)', value: gastosOperacion, group: 'gasto' },
    { key: 'utilidadOperacion', label: 'Utilidad de operación', value: utilidadOperacion, group: 'resultado', highlight: true },
    { key: 'margenBrutoPct', label: 'Margen contribución %', value: margenBrutoPct, group: 'ratio', suffix: '%' },
    { key: 'puntoEquilibrio', label: 'Punto de equilibrio ($)', value: puntoEquilibrio, group: 'ratio', highlight: true },
  ];

  return {
    available,
    source: 'CON_CTAS_CATALOGO',
    methodology: {
      ingresos: 'Créditos (saldos acreedores) — cuentas 0400, 0446, 0460, 0481-84' + (includeFi ? ', 0800' : ''),
      costos: 'Cargos (saldos deudores) — cuentas 0600',
      gastos: 'Gasto departamento: CTA_GPOCONT por área (Excel) · Gastos operación: total 0700',
      utilidadBruta: 'Ventas − Costo de ventas',
      utilidadOperacion: 'Utilidad bruta − Gastos de operación',
      puntoEquilibrio: 'Gastos fijos (depto) ÷ (Margen contribución ÷ Ventas) — preliminar operativo',
    },
    filtros: {
      sucursal: scope.sucursal,
      area: scope.area,
      scopeLabel: scope.scopeLabel,
      includeFi,
    },
    incomeLines: income.lines,
    costLines: cost.lines,
    expenseLines: expense.lines,
    departmentExpenseLines: expense.departmentLines,
    resultLines,
    summary: {
      ventasTotales,
      ventasNetas: ventasTotales,
      costoVentas,
      utilidadBruta,
      gastoDepartamento,
      gastosOperacion,
      utilidadOperacion,
      margenBrutoPct,
      margenOperacionPct,
      puntoEquilibrio,
    },
  };
}

/**
 * Suma prefijos de cuentas en un rango de fechas.
 * @param {boolean} asIncome true = ingresos (acreedor); false = costos/gastos (deudor)
 */
async function sumPrefixesForPeriod(fechaInicio, fechaFin, prefixes, asIncome = true) {
  const segments = yearSegments(fechaInicio, fechaFin);
  return sumLine(segments, prefixes || [], asIncome);
}

module.exports = {
  getCatalogKpis,
  sumPrefixesForPeriod,
  breakEven,
};
