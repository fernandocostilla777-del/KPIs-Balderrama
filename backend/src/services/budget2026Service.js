const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const {
  BUDGET_YEAR,
  DEFAULT_BUDGET_PATH,
  RESUMEN_AMOUNT_COL,
  FIN_LABEL_COL,
  FIN_MONTH_START_COL,
  FIN_MONTH_STEP,
  FIN_ANNUAL_COL,
  RESUMEN_LINES,
  RESUMEN_GASTOS_POSTVENTA_LABEL,
  RESUMEN_GASTOS_POSTVENTA_OCCURRENCE,
  BRANCH_VENTAS_ROWS,
} = require('../config/budget2026Config');
const { MENUDEO_BRANCHES } = require('../config/eeffSummaryConfig');

let cachedWorkbook = null;
let cachedPath = null;

function resolveBudgetPath() {
  const envPath = process.env.BUDGET_XLSX_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  if (fs.existsSync(DEFAULT_BUDGET_PATH)) return DEFAULT_BUDGET_PATH;
  const downloads = path.join(
    process.env.USERPROFILE || process.env.HOME || '',
    'Downloads',
    'Simulador ABP PRESUPUESTO 2026 (1).xlsx',
  );
  if (downloads && fs.existsSync(downloads)) return downloads;
  return null;
}

function loadWorkbook() {
  const filePath = resolveBudgetPath();
  if (!filePath) return null;
  if (cachedWorkbook && cachedPath === filePath) return { wb: cachedWorkbook, path: filePath };
  cachedWorkbook = XLSX.readFile(filePath, { cellDates: true });
  cachedPath = filePath;
  return { wb: cachedWorkbook, path: filePath };
}

function parseNum(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const s = String(value ?? '').replace(/[$,\s]/g, '').replace(/[^\d.-]/g, '');
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function normLabel(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function sheetRows(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

function parseResumen(wb) {
  const rows = sheetRows(wb, 'RESUMEN');
  const map = {};
  const counts = {};

  for (const row of rows) {
    const label = normLabel(row[0]);
    if (!label) continue;
    counts[label] = (counts[label] || 0) + 1;
    const amount = parseNum(row[RESUMEN_AMOUNT_COL]);
    if (!amount) continue;

    for (const [key, pattern] of Object.entries(RESUMEN_LINES)) {
      if (normLabel(pattern) !== label) continue;
      if (key === 'ventasPostventa' && counts[label] > 1) continue;
      if (map[key] == null) map[key] = amount;
    }

    if (label === normLabel(RESUMEN_GASTOS_POSTVENTA_LABEL)
      && counts[label] === RESUMEN_GASTOS_POSTVENTA_OCCURRENCE) {
      map.gastosPostventa = amount;
    }
  }

  return map;
}

function findFinRow(wb, pattern) {
  const rows = sheetRows(wb, 'PRESUPUESTO FINANCIERO 2026');
  const target = normLabel(pattern);
  return rows.find((row) => normLabel(row[FIN_LABEL_COL]) === target);
}

function monthAmount(row, monthIndex, startCol, step) {
  return parseNum(row[startCol + monthIndex * step]);
}

function sumMonths(row, months, startCol, step) {
  return months.reduce((acc, m) => acc + monthAmount(row, m - 1, startCol, step), 0);
}

function scaleAnnual(annual, months) {
  if (!annual || !months.length) return 0;
  return annual * (months.length / 12);
}

function monthsInRange(fechaInicio, fechaFin) {
  const start = new Date(`${fechaInicio}T12:00:00`);
  const end = new Date(`${fechaFin}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Fechas inválidas para presupuesto.');
  }
  if (start > end) throw new Error('fechaInicio no puede ser mayor que fechaFin.');

  const startYear = start.getFullYear();
  const endYear = end.getFullYear();
  if (startYear !== BUDGET_YEAR || endYear !== BUDGET_YEAR) {
    return [];
  }

  const months = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1, 12);
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1, 12);
  while (cursor <= endMonth) {
    months.push(cursor.getMonth() + 1);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

function aggregateRows(rows) {
  return rows.reduce((acc, r) => ({
    ventas: acc.ventas + r.ventas,
    costo: acc.costo + r.costo,
    utilidadBruta: acc.utilidadBruta + r.utilidadBruta,
    gastos: acc.gastos + r.gastos,
    gastosAdministracion: acc.gastosAdministracion + r.gastosAdministracion,
    sumaGastos: acc.sumaGastos + r.sumaGastos,
    utilidadOperacion: acc.utilidadOperacion + r.utilidadOperacion,
  }), {
    ventas: 0, costo: 0, utilidadBruta: 0, gastos: 0, gastosAdministracion: 0, sumaGastos: 0, utilidadOperacion: 0,
  });
}

function branchShare(ventasBranch, ventasMenudeoTotal) {
  if (!ventasMenudeoTotal) return 0;
  return ventasBranch / ventasMenudeoTotal;
}

function buildBranchBudget(wb, resumen, months) {
  const menudeoVentasAnnual = resumen.ventasMenudeo || 0;
  const menudeoUbAnnual = resumen.ubMenudeo || 0;
  const menudeoGastosAnnual = Math.max(
    0,
    (resumen.gastosVentasAutos || 0)
      - (resumen.gastosIntercambios || 0)
      - (resumen.gastosFlotillas || 0)
      - (resumen.gastosSeminuevos || 0),
  );

  return MENUDEO_BRANCHES.map((branch) => {
    const row = findFinRow(wb, BRANCH_VENTAS_ROWS[branch.id]);
    let ventas = 0;
    if (row) {
      ventas = months.length
        ? sumMonths(row, months, FIN_MONTH_START_COL, FIN_MONTH_STEP)
        : parseNum(row[FIN_ANNUAL_COL]);
    }
    const share = branchShare(ventas, scaleAnnual(menudeoVentasAnnual, months));
    const utilidadBruta = scaleAnnual(menudeoUbAnnual, months) * share;
    const costo = ventas - utilidadBruta;
    const gastos = scaleAnnual(menudeoGastosAnnual, months) * share;
    const adminShare = (resumen.ventasTotales
      ? scaleAnnual(menudeoVentasAnnual, months) / scaleAnnual(resumen.ventasTotales, months)
      : 0.7);
    const gastosAdministracion = scaleAnnual(resumen.gastosAdministracion || 0, months) * share * adminShare;
    const sumaGastos = gastos + gastosAdministracion;
    const utilidadOperacion = utilidadBruta - sumaGastos;

    return {
      id: branch.id,
      label: branch.label,
      ventas,
      costo,
      utilidadBruta,
      gastos,
      gastosAdministracion,
      sumaGastos,
      utilidadOperacion,
      margenOperacionPct: ventas ? Number(((utilidadOperacion / ventas) * 100).toFixed(1)) : 0,
    };
  });
}

function buildDivisionBudget(wb, resumen, months, rowLabel, ubAnnual, gastosAnnual) {
  const row = findFinRow(wb, rowLabel);
  let ventas = 0;
  if (row) {
    ventas = months.length
      ? sumMonths(row, months, FIN_MONTH_START_COL, FIN_MONTH_STEP)
      : parseNum(row[FIN_ANNUAL_COL]);
  }
  const annualVentas = parseNum(row?.[FIN_ANNUAL_COL]);
  const ubRatio = annualVentas ? (ubAnnual || 0) / annualVentas : 0;
  const utilidadBruta = ventas * ubRatio;
  const costo = ventas - utilidadBruta;
  const gastos = scaleAnnual(gastosAnnual, months);
  const utilidadOperacion = utilidadBruta - gastos;
  return {
    ventas,
    costo,
    utilidadBruta,
    gastos,
    gastosAdministracion: 0,
    sumaGastos: gastos,
    utilidadOperacion,
    margenOperacionPct: ventas ? Number(((utilidadOperacion / ventas) * 100).toFixed(1)) : 0,
  };
}

function buildPostventaBudget(resumen, months) {
  const scale = (annual) => scaleAnnual(annual, months);
  const ventasTotal = scale(resumen.ventasPostventa);

  const mkSection = (id, label, ventasAnnual, ubAnnual, gastosAnnual) => {
    const ventas = scale(ventasAnnual);
    const utilidadBruta = scale(ubAnnual);
    const costo = ventas - utilidadBruta;
    const gastos = scale(gastosAnnual);
    const gastosAdministracion = ventasTotal
      ? scale(resumen.gastosAdministracion || 0) * 0.3 * (ventas / ventasTotal)
      : 0;
    const sumaGastos = gastos + gastosAdministracion;
    const utilidadOperacion = utilidadBruta - sumaGastos;
    return {
      id,
      label,
      ventas,
      costo,
      utilidadBruta,
      gastos,
      gastosAdministracion,
      sumaGastos,
      utilidadOperacion,
      margenOperacionPct: ventas ? Number(((utilidadOperacion / ventas) * 100).toFixed(1)) : 0,
    };
  };

  const sections = [
    mkSection('servicio', 'Servicio', resumen.ventasMoServicio, resumen.ubMoServicio, resumen.gastosDeptoServicio),
    mkSection(
      'refacciones',
      'Refacciones',
      (resumen.ventasRefaccServicio || 0) + (resumen.ventasRefaccMayoreo || 0),
      (resumen.ubRefaccServicio || 0) + (resumen.ubRefaccMayoreo || 0),
      resumen.gastosDeptosRefacciones,
    ),
    mkSection(
      'hyp',
      'HYP',
      (resumen.ventasMoBodys || 0) + (resumen.ventasRefaccBodys || 0),
      (resumen.ubMoBodys || 0) + (resumen.ubRefaccBodys || 0),
      resumen.gastosDeptoBody,
    ),
  ];

  const summary = aggregateRows(sections);
  summary.margenOperacionPct = summary.ventas
    ? Number(((summary.utilidadOperacion / summary.ventas) * 100).toFixed(1))
    : 0;

  return { sections, summary };
}

function buildEstadoFinancieroBudget(resumen, months, autosSummary, postventaSummary) {
  const scale = (annual) => scaleAnnual(annual, months);
  const ventasSeminuevos = scale(resumen.ventasSeminuevos);
  const ventasPostventa = postventaSummary.summary.ventas;
  const ventasAutosNuevosTotal = autosSummary.ventas;
  const ventasTotales = ventasAutosNuevosTotal + ventasSeminuevos + ventasPostventa;

  const utilidadBruta = scale(resumen.ubTotal);
  const costoTotal = ventasTotales - utilidadBruta;
  const gastosOperacion = scale(resumen.gastosOperativos);
  const gastosAdministracion = scale(resumen.gastosAdministracion);
  const sumaGastos = scale(resumen.gastosOperativosYAdmin);
  const utilidadOperacion = utilidadBruta - sumaGastos;

  return {
    summary: {
      ventasTotales,
      costoTotal,
      utilidadBruta,
      gastosOperacion,
      gastosAdministracion,
      sumaGastos,
      utilidadOperacion,
      utilidad: utilidadOperacion,
      margenBrutoPct: ventasTotales ? Number(((utilidadBruta / ventasTotales) * 100).toFixed(1)) : 0,
      margenOperacionPct: ventasTotales ? Number(((utilidadOperacion / ventasTotales) * 100).toFixed(1)) : 0,
    },
    lines: [
      { key: 'ventasAutos', label: 'Ventas autos nuevos', value: ventasAutosNuevosTotal },
      { key: 'ventasSeminuevos', label: 'Ventas seminuevos', value: ventasSeminuevos },
      { key: 'ventasPostventa', label: 'Ventas PostVenta', value: ventasPostventa },
      { key: 'ventasTotales', label: 'Total ventas', value: ventasTotales, highlight: true },
      { key: 'costoTotal', label: 'Costo de ventas', value: costoTotal },
      { key: 'utilidadBruta', label: 'Utilidad bruta', value: utilidadBruta, highlight: true },
      { key: 'gastosOperacion', label: 'Gastos de operación', value: gastosOperacion },
      { key: 'gastosAdministracion', label: 'Gastos administración', value: gastosAdministracion },
      { key: 'sumaGastos', label: 'Suma gastos', value: sumaGastos, highlight: true },
      { key: 'utilidadOperacion', label: 'Utilidad de operación', value: utilidadOperacion, highlight: true },
    ],
  };
}

function getBudgetForPeriod({ fechaInicio, fechaFin }) {
  const loaded = loadWorkbook();
  if (!loaded) {
    return { available: false, reason: 'No se encontró el archivo de presupuesto 2026.' };
  }

  const { wb, path: filePath } = loaded;
  const months = monthsInRange(fechaInicio, fechaFin);
  if (!months.length) {
    return {
      available: false,
      reason: `La comparativa PPTO solo aplica a ${BUDGET_YEAR}. Seleccione fecha inicio y fin dentro de ${BUDGET_YEAR} (ej. 2026-01-01 al mes en curso).`,
      year: BUDGET_YEAR,
    };
  }

  const resumen = parseResumen(wb);
  const menudeoBranches = buildBranchBudget(wb, resumen, months);
  const flotillas = buildDivisionBudget(
    wb,
    resumen,
    months,
    'VENTAS FLOTILLAS',
    resumen.ubFlotillas,
    resumen.gastosFlotillas || 0,
  );
  const intercambios = buildDivisionBudget(
    wb,
    resumen,
    months,
    'VENTAS INTERCAMBIOS SERDAN',
    resumen.ubIntercambios,
    resumen.gastosIntercambios || 0,
  );

  const autosRows = [...menudeoBranches, flotillas, intercambios];
  const autosSummary = aggregateRows(autosRows);
  const postventa = buildPostventaBudget(resumen, months);
  const estadoFinanciero = buildEstadoFinancieroBudget(
    resumen,
    months,
    autosSummary,
    postventa,
  );

  return {
    available: true,
    source: path.basename(filePath),
    template: 'Simulador ABP PRESUPUESTO 2026',
    year: BUDGET_YEAR,
    filtros: { fechaInicio, fechaFin },
    mesesIncluidos: months,
    factorPeriodo: Number((months.length / 12).toFixed(4)),
    ventas: {
      menudeo: { branches: menudeoBranches, summary: aggregateRows(menudeoBranches) },
      flotillas: { branch: { id: 'flotillas', label: 'Flotillas', ...flotillas }, summary: flotillas },
      intercambios: { branch: { id: 'intercambios', label: 'Intercambios', ...intercambios }, summary: intercambios },
      totalVentasAutos: { summary: autosSummary },
    },
    postventa,
    estadoFinanciero,
  };
}

module.exports = {
  getBudgetForPeriod,
  resolveBudgetPath,
  BUDGET_YEAR,
};
