const { getOverview } = require('./overviewService');
const { getInventory } = require('./inventoryService');
const { getAccountingKpis } = require('./accountingEeffService');
const { getVentasAutosNuevosIncomeStatement } = require('./ventasAutosNuevosEeffService');
const { runAccountingEtl } = require('./accountingEtlService');
const { getCatalogKpis } = require('./accountingCatalogKpiService');
const { getBalanceGeneral, getDepreciacionPeriodo } = require('./balanceGeneralService');
const { getPuntoEquilibrio } = require('./breakEvenService');
const { computeCicloEfectivo, computeCoberturaCapitalTrabajo, computeDpo, computeDri, computeDso, computeEbitMetrics, computeEstructuraFinanciera } = require('./estructuraFinanciera');

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function shiftYear(iso, years) {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setFullYear(d.getFullYear() + years);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Ventana UDM (últimos 12 meses) cerrada en fechaFin. */
function udmWindow(fechaFin) {
  const end = new Date(`${fechaFin}T12:00:00`);
  if (Number.isNaN(end.getTime())) return { fechaInicio: fechaFin, fechaFin };
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - 1);
  start.setDate(start.getDate() + 1);
  const y = start.getFullYear();
  const m = String(start.getMonth() + 1).padStart(2, '0');
  const day = String(start.getDate()).padStart(2, '0');
  return { fechaInicio: `${y}-${m}-${day}`, fechaFin };
}

function currentMonthPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(yr, mo) {
  return `${MONTH_NAMES[(mo || 1) - 1]} ${yr}`;
}

/** Etiqueta corta del rango: "Ago 2025" para un mes, "Ene – Ago 2025" para un acumulado. */
function periodLabel(fechaInicio, fechaFin) {
  const a = new Date(`${fechaInicio}T12:00:00`);
  const b = new Date(`${fechaFin}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return '';
  const finLabel = formatMonthLabel(b.getFullYear(), b.getMonth() + 1);
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) return finLabel;
  if (a.getFullYear() === b.getFullYear()) return `${MONTH_NAMES[a.getMonth()]} – ${finLabel}`;
  return `${formatMonthLabel(a.getFullYear(), a.getMonth() + 1)} – ${finLabel}`;
}

function growthPct(actual, anterior) {
  const current = Number(actual);
  const prior = Number(anterior);
  if (!Number.isFinite(current) || !Number.isFinite(prior) || Math.abs(prior) < 0.01) return null;
  return Math.round(((current - prior) / Math.abs(prior)) * 1000) / 10;
}

function profitabilityTone(value, { warningBelow = 0, goodAt = 10 } = {}) {
  if (value == null || !Number.isFinite(Number(value))) return 'slate';
  if (Number(value) < warningBelow) return 'rose';
  if (Number(value) < goodAt) return 'amber';
  return 'green';
}

// Agencia: crecer por debajo de la inflación equivale a perder participación,
// por eso el verde empieza en 5% y no en 0%.
function growthTone(value) {
  if (value == null || !Number.isFinite(Number(value))) return 'slate';
  if (Number(value) < -5) return 'rose';
  if (Number(value) < 5) return 'amber';
  return 'green';
}

const INCOME_ROW_LABELS = {
  ventasNetas: 'Ventas netas',
  costoVentas: 'Costo de ventas',
  utilidadBruta: 'Utilidad bruta',
  gastosOperacion: 'Gastos de operación',
  gastosAdministracion: 'Gastos de administración',
  utilidadOperacion: 'Utilidad de operación',
  productosFinancieros: 'Productos financieros y otros',
  utilidadPeriodo: 'Utilidad del periodo',
};

function incomeRows(summary, keys) {
  if (!summary) return [];
  return keys
    .filter((key) => summary[key] != null && Number.isFinite(Number(summary[key])))
    .map((key) => ({ cuenta: '', label: INCOME_ROW_LABELS[key] || key, value: Number(summary[key]) }));
}

function lineRows(lines) {
  return (lines || [])
    .filter((l) => Number.isFinite(Number(l?.value)))
    .map((l) => ({ cuenta: '', label: l.label || l.key, value: Number(l.value) }));
}

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Comparativo contra el mismo mes del año anterior para los indicadores clave.
 * Los de crecimiento comparan la magnitud que los origina (utilidad, ventas), no el %,
 * porque comparar "crecimiento vs crecimiento" exigiría un tercer año de historia.
 */
function buildComparativoAnual({
  fechaInicio,
  fechaFin,
  priorInicio,
  priorFin,
  balancePrior,
  incomePrior = {},
  kpiPrior = {},
  liquidez,
  estructura,
  cicloEfectivo,
  coberturaCt,
  actuales = {},
  anteriores = {},
}) {
  const liquidezPrior = balancePrior?.liquidez || null;
  const ventasPrior = finiteOrNull(incomePrior.ventasNetas ?? kpiPrior.ventasNetas ?? kpiPrior.ventasTotales);
  const costoVentasPrior = finiteOrNull(incomePrior.costoVentas ?? kpiPrior.costoVentas);
  const capitalPrior = finiteOrNull(balancePrior?.totals?.capital);

  let cicloPrior = null;
  let coberturaPrior = null;
  let estructuraPrior = null;
  if (balancePrior) {
    const dsoPrior = computeDso({
      cuentasPorCobrar: liquidezPrior?.cuentasPorCobrar || 0,
      ventas: ventasPrior || 0,
      fechaInicio: priorInicio,
      fechaFin: priorFin,
    });
    const driPrior = computeDri({
      inventario: liquidezPrior?.inventariosYProceso || 0,
      costoVentas: costoVentasPrior || 0,
      fechaInicio: priorInicio,
      fechaFin: priorFin,
    });
    const dpoPrior = computeDpo({
      cxpProveedores: balancePrior.cxpProveedores || 0,
      costoVentas: costoVentasPrior || 0,
      fechaInicio: priorInicio,
      fechaFin: priorFin,
    });
    cicloPrior = computeCicloEfectivo({
      driDias: driPrior.driDias,
      dsoDias: dsoPrior.dsoDias,
      dpoDias: dpoPrior.dpoDias,
    });
    coberturaPrior = computeCoberturaCapitalTrabajo({
      capitalTrabajo: liquidezPrior?.capitalTrabajo || 0,
      inventario: driPrior.inventario || liquidezPrior?.inventariosYProceso || 0,
      cuentasPorCobrarSinIva: dsoPrior.cuentasPorCobrarSinIva || 0,
      cxpProveedores: dpoPrior.cxpProveedores || 0,
      planPiso: balancePrior.planPisoPasivo || 0,
      activoCirculante: liquidezPrior?.activoCirculante || 0,
      pasivoCirculante: liquidezPrior?.pasivoCirculante || 0,
    });
    // Sin ebitdaUdm del año anterior el apalancamiento comparable no se puede calcular.
    estructuraPrior = computeEstructuraFinanciera({
      activoTotal: balancePrior.totals?.activoTotal || 0,
      pasivoTotal: balancePrior.totals?.pasivoTotal || 0,
      pasivoCorto: liquidezPrior?.pasivoCirculante
        || balancePrior.sections?.find((s) => s.key === 'pasivoCortoPlazo')?.value
        || 0,
      pasivoLargo: balancePrior.sections?.find((s) => s.key === 'pasivoLargoPlazo')?.value || 0,
      capital: balancePrior.totals?.capital || 0,
      efectivoYEquivalentes: liquidezPrior?.efectivoYEquivalentes || 0,
    });
  }

  const roePctPrior = capitalPrior != null && Math.abs(capitalPrior) > 0.01
    && finiteOrNull(incomePrior.utilidadPeriodo) != null
    ? Math.round((Number(incomePrior.utilidadPeriodo) / capitalPrior) * 1000) / 10
    : null;

  const entry = (unidad, etiqueta, actual, anterior) => ({
    unidad,
    etiqueta,
    actual: finiteOrNull(actual),
    anterior: finiteOrNull(anterior),
  });

  const kpis = {
    crecimientoUtilidad: entry('money', 'Utilidad del periodo', actuales.utilidadPeriodo, anteriores.utilidadPeriodo),
    crecimientoEbit: entry('money', 'EBIT', actuales.ebit, anteriores.ebit),
    crecimientoVentas: entry('money', 'Ventas netas', actuales.ventasNetas, anteriores.ventasNetas),
    crecimientoUtilidadBruta: entry('money', 'Utilidad bruta', actuales.utilidadBruta, anteriores.utilidadBruta),
    razonCirculante: entry('ratio', 'Razón circulante', liquidez?.razonCirculante, liquidezPrior?.razonCirculante),
    pruebaAcida: entry('ratio', 'Prueba ácida', liquidez?.pruebaAcida, liquidezPrior?.pruebaAcida),
    cicloEfectivo: entry('dias', 'Ciclo de efectivo', cicloEfectivo?.cicloDias, cicloPrior?.cicloDias),
    coberturaCt: entry('ratio', 'Cobertura del capital de trabajo', coberturaCt?.cobertura, coberturaPrior?.cobertura),
    endeudamiento: entry('pct', 'Endeudamiento', estructura?.endeudamientoPct, estructuraPrior?.endeudamientoPct),
    autonomia: entry('pct', 'Ratio de autonomía', estructura?.autonomiaPct, estructuraPrior?.autonomiaPct),
    calidadDeuda: entry('pct', 'Pasivo a corto plazo', estructura?.calidadDeuda?.cortoPct, estructuraPrior?.calidadDeuda?.cortoPct),
    apalancamiento: entry('ratio', 'Deuda neta ÷ EBITDA UDM', estructura?.apalancamiento, estructuraPrior?.apalancamiento),
    roe: entry('pct', 'ROE', actuales.roePct, roePctPrior),
    margenNeto: entry('pct', 'Margen neto', actuales.margenNetoPct, incomePrior.margenNetoPct),
    margenBruto: entry('pct', 'Margen bruto', actuales.margenBrutoPct, incomePrior.margenBrutoPct),
    margenOperacion: entry('pct', 'Margen de operación', actuales.margenOperacionPct, incomePrior.margenOperacionPct),
  };

  return {
    disponible: Object.values(kpis).some((k) => k.anterior != null),
    balancePriorDisponible: Boolean(balancePrior),
    periodoActual: periodLabel(fechaInicio, fechaFin),
    periodoAnterior: periodLabel(priorInicio, priorFin),
    kpis,
  };
}

function comparativeGroups({ actualTitle, actualRows, actualTotal, priorTitle, priorRows, priorTotal }) {
  const groups = [];
  if (actualRows.length) groups.push({ title: actualTitle, rows: actualRows, total: actualTotal });
  if (priorRows.length) groups.push({ title: priorTitle, rows: priorRows, total: priorTotal });
  return groups;
}

function vitalGrowth({ actual, anterior, formula, noun }) {
  const valorPct = growthPct(actual, anterior);
  const growthLabel = () => {
    if (valorPct == null) return 'Sin comparativo';
    if (valorPct >= 5) return 'Crecimiento real';
    if (valorPct >= 0) return 'Crece bajo inflación';
    if (valorPct >= -5) return 'Contracción leve';
    return 'Contracción';
  };
  const growthSummary = () => {
    if (valorPct == null) return `No existe ${noun.toLowerCase()} comparable suficiente para medir el crecimiento.`;
    const base = `${noun} ${valorPct >= 0 ? 'creció' : 'disminuyó'} ${Math.abs(valorPct)}% frente al mismo periodo del año anterior`;
    if (valorPct >= 5) return `${base}: crecimiento real por encima de la inflación.`;
    if (valorPct >= 0) return `${base}: crece en pesos pero por debajo de la inflación, lo que en la práctica es perder terreno frente al mercado.`;
    return `${base}: la agencia está por debajo del año anterior.`;
  };
  return {
    valorPct,
    actual: Number.isFinite(Number(actual)) ? Number(actual) : null,
    anterior: Number.isFinite(Number(anterior)) ? Number(anterior) : null,
    tone: growthTone(valorPct),
    label: growthLabel(),
    formula,
    summary: growthSummary(),
  };
}

function vitalMargin({ valorPct, numerador, denominador, formula, noun, goodAt, benchmark }) {
  const pctVal = valorPct == null || !Number.isFinite(Number(valorPct)) ? null : Number(valorPct);
  return {
    valorPct: pctVal,
    numerador: Number(numerador) || 0,
    denominador: Number(denominador) || 0,
    tone: profitabilityTone(pctVal, { warningBelow: 0, goodAt }),
    label: pctVal == null ? 'Sin dato' : pctVal < 0 ? `${noun} negativo` : pctVal < goodAt ? `Bajo referencia` : `${noun} en referencia`,
    formula,
    summary: pctVal == null
      ? `Faltan datos para calcular ${noun.toLowerCase()}.`
      : pctVal < 0
        ? `${noun} negativo de ${pctVal}%. ${benchmark}`
        : `${noun} de ${pctVal}%: de cada $100 quedan ${pctVal >= 0 ? '$' : '-$'}${Math.abs(pctVal)}. ${benchmark}`,
  };
}

async function getContabilidad({ fechaInicio, fechaFin, planPisoPeriod, sucursal, area, includeFi } = {}) {
  const period = planPisoPeriod && /^\d{4}-\d{2}$/.test(planPisoPeriod)
    ? planPisoPeriod
    : currentMonthPeriod();

  const includeFinanciamiento = includeFi !== 'false' && includeFi !== false;

  // Siempre calcular Balance General con cuentas mayor (independiente del alcance EEFF)
  const priorInicio = shiftYear(fechaInicio, -1);
  const priorFin = shiftYear(fechaFin, -1);
  const udm = udmWindow(fechaFin);
  const [overview, inventory, catalogKpis, eeff, ventasAutosNuevosEeff, etlConsolidado, balanceGeneralRaw, puntoEquilibrio, depPeriodo, catalogPrior, catalogUdm, depUdm, eeffPrior, balanceGeneralPriorRaw] = await Promise.all([
    getOverview({ fechaInicio, fechaFin }),
    getInventory({ planPisoPeriod: period }),
    getCatalogKpis({ fechaInicio, fechaFin, sucursal, area, includeFi: includeFinanciamiento }),
    getAccountingKpis({ fechaInicio, fechaFin, sucursal, area }),
    getVentasAutosNuevosIncomeStatement(fechaInicio, fechaFin, sucursal),
    runAccountingEtl({ fechaInicio, fechaFin, sucursal, area }),
    getBalanceGeneral({ fechaFin }).catch((err) => {
      console.error('[contabilidad] balanceGeneral:', err.message);
      return null;
    }),
    getPuntoEquilibrio({ fechaInicio, fechaFin, sucursal: sucursal || 'todos' }).catch((err) => {
      console.error('[contabilidad] puntoEquilibrio:', err.message);
      return null;
    }),
    getDepreciacionPeriodo(fechaInicio, fechaFin).catch((err) => {
      console.error('[contabilidad] depreciacionPeriodo:', err.message);
      return { available: false, depreciacionPeriodo: 0 };
    }),
    getCatalogKpis({
      fechaInicio: priorInicio,
      fechaFin: priorFin,
      sucursal,
      area,
      includeFi: includeFinanciamiento,
    }).catch(() => null),
    getCatalogKpis({
      fechaInicio: udm.fechaInicio,
      fechaFin: udm.fechaFin,
      sucursal,
      area,
      includeFi: includeFinanciamiento,
    }).catch((err) => {
      console.error('[contabilidad] catalogUdm:', err.message);
      return null;
    }),
    getDepreciacionPeriodo(udm.fechaInicio, udm.fechaFin).catch((err) => {
      console.error('[contabilidad] depreciacionUdm:', err.message);
      return { available: false, depreciacionPeriodo: 0 };
    }),
    getAccountingKpis({
      fechaInicio: priorInicio,
      fechaFin: priorFin,
      sucursal,
      area,
    }).catch((err) => {
      console.error('[contabilidad] eeffPrior:', err.message);
      return null;
    }),
    // Balance al cierre del mismo mes del año anterior: permite comparar los
    // indicadores que salen del balance (liquidez, endeudamiento, ROE) contra YoY.
    getBalanceGeneral({ fechaFin: priorFin, includeComparativo: false }).catch((err) => {
      console.error('[contabilidad] balanceGeneralPrior:', err.message);
      return null;
    }),
  ]);

  const balanceGeneral = (balanceGeneralRaw?.available && balanceGeneralRaw)
    || (eeff.balanceGeneral?.available && eeff.balanceGeneral)
    || balanceGeneralRaw
    || eeff.balanceGeneral
    || null;

  const { sales, service, inventory: invSnap, consolidated } = overview.financial;
  const invSummary = inventory.summary;
  const kpi = catalogKpis.summary;
  const peSummary = puntoEquilibrio?.summary || null;
  // Preferir PE operativo (sin F&I) para el KPI principal
  if (peSummary?.puntoEquilibrio != null) {
    kpi.puntoEquilibrio = peSummary.puntoEquilibrio;
    kpi.puntoEquilibrioDetalle = peSummary;
  }

  const monthlyTrend = (overview.monthlyTrend || []).map((r) => ({
    label: formatMonthLabel(r.yr, r.mo),
    yr: r.yr,
    mo: r.mo,
    units: Number(r.units || 0),
    revenue: Number(r.revenue || 0),
  }));

  const dailyBreakdown = overview.dailyBreakdown || [];
  const balanceTotals = balanceGeneral?.totals || eeff.balance?.totals || {};
  const liquidez = balanceGeneral?.liquidez || eeff.liquidez || null;

  const dso = computeDso({
    cuentasPorCobrar: liquidez?.cuentasPorCobrar || 0,
    ventas: kpi.ventasNetas || kpi.ventasTotales || 0,
    fechaInicio,
    fechaFin,
  });
  const dri = computeDri({
    inventario: liquidez?.inventariosYProceso || 0,
    costoVentas: kpi.costoVentas || 0,
    fechaInicio,
    fechaFin,
  });
  const dpo = computeDpo({
    cxpProveedores: balanceGeneral?.cxpProveedores || 0,
    costoVentas: kpi.costoVentas || 0,
    fechaInicio,
    fechaFin,
  });
  const cicloEfectivo = computeCicloEfectivo({
    driDias: dri.driDias,
    dsoDias: dso.dsoDias,
    dpoDias: dpo.dpoDias,
  });
  const coberturaCt = computeCoberturaCapitalTrabajo({
    capitalTrabajo: liquidez?.capitalTrabajo || 0,
    inventario: dri.inventario || liquidez?.inventariosYProceso || 0,
    cuentasPorCobrarSinIva: dso.cuentasPorCobrarSinIva || 0,
    cxpProveedores: dpo.cxpProveedores || 0,
    planPiso: balanceGeneral?.planPisoPasivo || 0,
    activoCirculante: liquidez?.activoCirculante || 0,
    pasivoCirculante: liquidez?.pasivoCirculante || 0,
  });

  const ebitMetrics = computeEbitMetrics({
    ventas: kpi.ventasTotales || kpi.ventasNetas,
    utilidadOperacion: kpi.utilidadOperacion,
    depreciacionPeriodo: depPeriodo?.depreciacionPeriodo || 0,
    utilidadOperacionAnterior: catalogPrior?.summary?.utilidadOperacion ?? null,
  });
  const income = eeff?.income?.summary || {};
  const incomePrior = eeffPrior?.income?.summary || {};
  const utilidadPeriodo = Number(income.utilidadPeriodo || 0);
  const utilidadPeriodoAnterior = incomePrior.utilidadPeriodo;
  const ventasActuales = Number(income.ventasNetas || kpi.ventasNetas || kpi.ventasTotales || 0);
  const ventasAnteriores = Number(incomePrior.ventasNetas || catalogPrior?.summary?.ventasNetas || catalogPrior?.summary?.ventasTotales || 0);
  const utilidadBrutaActual = Number(income.utilidadBruta || kpi.utilidadBruta || 0);
  const utilidadBrutaAnterior = Number(incomePrior.utilidadBruta || catalogPrior?.summary?.utilidadBruta || 0);
  const capitalContable = Number(balanceTotals.capital || 0);
  const roePct = Math.abs(capitalContable) > 0.01
    ? Math.round((utilidadPeriodo / capitalContable) * 1000) / 10
    : null;
  const margenBrutoPct = income.margenBrutoPct ?? kpi.margenBrutoPct ?? null;
  const margenOperacionPct = income.margenOperacionPct ?? kpi.margenOperacionPct ?? null;
  const margenNetoPct = income.margenNetoPct ?? null;
  const resultadoKeys = ['ventasNetas', 'costoVentas', 'utilidadBruta', 'gastosOperacion', 'gastosAdministracion', 'utilidadOperacion', 'productosFinancieros', 'utilidadPeriodo'];
  const comparablePeriodo = eeffPrior?.periodo?.label || 'mismo periodo del año anterior';
  const revenueRows = lineRows(eeff?.income?.revenueLines);
  const revenueRowsPrior = lineRows(eeffPrior?.income?.revenueLines);

  const vitales = {
    crecimientoUtilidad: {
      ...vitalGrowth({
        actual: utilidadPeriodo,
        anterior: utilidadPeriodoAnterior,
        formula: '(Utilidad del periodo actual − comparable anterior) ÷ |utilidad comparable anterior| × 100',
        noun: 'La utilidad del periodo',
      }),
      utilidadActual: utilidadPeriodo,
      utilidadAnterior: utilidadPeriodoAnterior ?? null,
      groups: comparativeGroups({
        actualTitle: 'Estado de resultados · periodo actual',
        actualRows: incomeRows(income, resultadoKeys),
        actualTotal: utilidadPeriodo,
        priorTitle: `Estado de resultados · ${comparablePeriodo}`,
        priorRows: incomeRows(incomePrior, resultadoKeys),
        priorTotal: utilidadPeriodoAnterior ?? null,
      }),
    },
    crecimientoEbit: {
      ...vitalGrowth({
        actual: ebitMetrics.ebit,
        anterior: ebitMetrics.utilidadOperacionAnterior,
        formula: '(EBIT actual − EBIT comparable anterior) ÷ |EBIT comparable anterior| × 100',
        noun: 'El EBIT',
      }),
      ebitActual: ebitMetrics.ebit,
      ebitAnterior: ebitMetrics.utilidadOperacionAnterior,
      groups: comparativeGroups({
        actualTitle: 'Construcción del EBIT · periodo actual',
        actualRows: [
          ...incomeRows(income, ['ventasNetas', 'costoVentas', 'utilidadBruta', 'gastosOperacion', 'gastosAdministracion', 'utilidadOperacion']),
          { cuenta: '', label: 'EBIT', value: Number(ebitMetrics.ebit) || 0 },
        ],
        actualTotal: Number(ebitMetrics.ebit) || 0,
        priorTitle: `Utilidad de operación · ${comparablePeriodo}`,
        priorRows: ebitMetrics.utilidadOperacionAnterior == null
          ? []
          : [{ cuenta: '', label: 'Utilidad de operación comparable', value: Number(ebitMetrics.utilidadOperacionAnterior) }],
        priorTotal: ebitMetrics.utilidadOperacionAnterior ?? null,
      }),
    },
    crecimientoVentas: {
      ...vitalGrowth({
        actual: ventasActuales,
        anterior: ventasAnteriores,
        formula: '(Ventas actuales − ventas del periodo comparable) ÷ |ventas comparables| × 100',
        noun: 'Las ventas netas',
      }),
      groups: comparativeGroups({
        actualTitle: 'Ingresos por línea · periodo actual',
        actualRows: revenueRows.length ? revenueRows : incomeRows(income, ['ventasNetas']),
        actualTotal: ventasActuales,
        priorTitle: `Ingresos por línea · ${comparablePeriodo}`,
        priorRows: revenueRowsPrior.length ? revenueRowsPrior : incomeRows(incomePrior, ['ventasNetas']),
        priorTotal: ventasAnteriores,
      }),
    },
    crecimientoUtilidadBruta: {
      ...vitalGrowth({
        actual: utilidadBrutaActual,
        anterior: utilidadBrutaAnterior,
        formula: '(Utilidad bruta actual − comparable anterior) ÷ |utilidad bruta comparable| × 100',
        noun: 'La utilidad bruta',
      }),
      groups: comparativeGroups({
        actualTitle: 'Utilidad bruta · periodo actual',
        actualRows: incomeRows(income, ['ventasNetas', 'costoVentas', 'utilidadBruta']),
        actualTotal: utilidadBrutaActual,
        priorTitle: `Utilidad bruta · ${comparablePeriodo}`,
        priorRows: incomeRows(incomePrior, ['ventasNetas', 'costoVentas', 'utilidadBruta']),
        priorTotal: utilidadBrutaAnterior,
      }),
    },
    roe: {
      ...vitalMargin({
        valorPct: roePct,
        numerador: utilidadPeriodo,
        denominador: capitalContable,
        formula: 'Utilidad del periodo ÷ Capital contable × 100',
        noun: 'ROE',
        goodAt: 15,
        benchmark: 'Una agencia de autos nuevos bien administrada retorna entre 15% y 25% sobre el capital; por debajo de 15% el patrimonio rinde menos de lo que el sector espera.',
      }),
      utilidadPeriodo,
      capitalContable,
      groups: [
        {
          title: 'Utilidad generada · estado de resultados',
          rows: incomeRows(income, resultadoKeys),
          total: utilidadPeriodo,
        },
      ],
    },
    margenNeto: {
      ...vitalMargin({
        valorPct: margenNetoPct,
        numerador: utilidadPeriodo,
        denominador: ventasActuales,
        formula: 'Utilidad del periodo ÷ Ventas netas × 100',
        noun: 'Margen neto',
        goodAt: 2,
        benchmark: 'En agencias el margen neto sano va de 2% a 3% sobre ventas totales: el negocio vive del volumen y de la utilidad de taller, refacciones y F&I, no del margen por unidad.',
      }),
      utilidadPeriodo,
      ventasNetas: ventasActuales,
      groups: [
        {
          title: 'Del ingreso a la utilidad del periodo',
          rows: incomeRows(income, resultadoKeys),
          total: utilidadPeriodo,
        },
      ],
    },
    margenBruto: {
      ...vitalMargin({
        valorPct: margenBrutoPct,
        numerador: utilidadBrutaActual,
        denominador: ventasActuales,
        formula: 'Utilidad bruta ÷ Ventas netas × 100',
        noun: 'Margen bruto',
        goodAt: 13,
        benchmark: 'Referencia de agencia: 13% a 16% consolidado. Autos nuevos aporta poco (4% a 7%), y el margen lo levantan seminuevos, refacciones, taller y F&I.',
      }),
      utilidadBruta: utilidadBrutaActual,
      ventasNetas: ventasActuales,
      groups: [
        {
          title: 'Ingresos por línea',
          rows: revenueRows.length ? revenueRows : incomeRows(income, ['ventasNetas']),
          total: ventasActuales,
        },
        {
          title: 'Costo de ventas y utilidad bruta',
          rows: incomeRows(income, ['costoVentas', 'utilidadBruta']),
          total: utilidadBrutaActual,
        },
      ],
    },
    margenOperacion: {
      ...vitalMargin({
        valorPct: margenOperacionPct,
        numerador: Number(income.utilidadOperacion || kpi.utilidadOperacion || 0),
        denominador: ventasActuales,
        formula: 'Utilidad de operación ÷ Ventas netas × 100',
        noun: 'Margen de operación',
        goodAt: 2.5,
        benchmark: 'En agencias el margen de operación sano va de 2.5% a 4% sobre ventas; abajo de 2.5% los gastos de la casa se están comiendo la utilidad de las áreas.',
      }),
      utilidadOperacion: Number(income.utilidadOperacion || kpi.utilidadOperacion || 0),
      ventasNetas: ventasActuales,
      groups: [
        {
          title: 'De ventas netas a utilidad de operación',
          rows: incomeRows(income, ['ventasNetas', 'costoVentas', 'utilidadBruta', 'gastosOperacion', 'gastosAdministracion', 'utilidadOperacion']),
          total: Number(income.utilidadOperacion || kpi.utilidadOperacion || 0),
        },
      ],
    },
  };

  // EBITDA UDM: si el filtro ya cubre ~12 meses, reutilizar; si no, calcular ventana UDM.
  const daysSelected = (() => {
    const a = new Date(`${fechaInicio}T12:00:00`);
    const b = new Date(`${fechaFin}T12:00:00`);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
    return Math.round((b - a) / 86400000) + 1;
  })();
  const usePeriodAsUdm = daysSelected >= 350;
  const ebitMetricsUdm = usePeriodAsUdm
    ? ebitMetrics
    : computeEbitMetrics({
      ventas: catalogUdm?.summary?.ventasTotales || catalogUdm?.summary?.ventasNetas || 0,
      utilidadOperacion: catalogUdm?.summary?.utilidadOperacion || 0,
      depreciacionPeriodo: depUdm?.depreciacionPeriodo || 0,
    });

  let estructura = balanceGeneral?.estructura || null;
  if (balanceGeneral?.available) {
    estructura = computeEstructuraFinanciera({
      activoTotal: balanceGeneral.totals?.activoTotal || 0,
      pasivoTotal: balanceGeneral.totals?.pasivoTotal || 0,
      pasivoCorto: balanceGeneral.liquidez?.pasivoCirculante
        || balanceGeneral.sections?.find((s) => s.key === 'pasivoCortoPlazo')?.value
        || 0,
      pasivoLargo: balanceGeneral.sections?.find((s) => s.key === 'pasivoLargoPlazo')?.value || 0,
      capital: balanceGeneral.totals?.capital || 0,
      efectivoYEquivalentes: balanceGeneral.liquidez?.efectivoYEquivalentes || 0,
      ebitdaUdm: ebitMetricsUdm.ebitda,
    });
    balanceGeneral.estructura = estructura;
    balanceGeneral.dso = dso;
    balanceGeneral.dri = dri;
    balanceGeneral.dpo = dpo;
    balanceGeneral.cicloEfectivo = cicloEfectivo;
    balanceGeneral.coberturaCt = coberturaCt;
    balanceGeneral.vitales = vitales;
    balanceGeneral.ebitMetrics = {
      ...ebitMetrics,
      ebitdaUdm: ebitMetricsUdm.ebitda,
      udm: {
        fechaInicio: usePeriodAsUdm ? fechaInicio : udm.fechaInicio,
        fechaFin: usePeriodAsUdm ? fechaFin : udm.fechaFin,
        ebitda: ebitMetricsUdm.ebitda,
        ebit: ebitMetricsUdm.ebit,
        depreciacionPeriodo: ebitMetricsUdm.depreciacionPeriodo,
        margenEbitdaPct: ebitMetricsUdm.margenEbitdaPct,
      },
    };
  } else if (balanceGeneral && typeof balanceGeneral === 'object') {
    balanceGeneral.dso = dso;
    balanceGeneral.dri = dri;
    balanceGeneral.dpo = dpo;
    balanceGeneral.cicloEfectivo = cicloEfectivo;
    balanceGeneral.coberturaCt = coberturaCt;
    balanceGeneral.vitales = vitales;
    balanceGeneral.ebitMetrics = ebitMetrics;
  }

  const comparativoAnual = buildComparativoAnual({
    fechaInicio,
    fechaFin,
    priorInicio,
    priorFin,
    balancePrior: balanceGeneralPriorRaw?.available ? balanceGeneralPriorRaw : null,
    incomePrior,
    kpiPrior: catalogPrior?.summary || {},
    liquidez,
    estructura,
    cicloEfectivo,
    coberturaCt,
    actuales: {
      utilidadPeriodo,
      ebit: ebitMetrics.ebit,
      ventasNetas: ventasActuales,
      utilidadBruta: utilidadBrutaActual,
      roePct,
      margenNetoPct,
      margenBrutoPct,
      margenOperacionPct,
    },
    anteriores: {
      utilidadPeriodo: utilidadPeriodoAnterior,
      ebit: ebitMetrics.utilidadOperacionAnterior,
      ventasNetas: ventasAnteriores,
      utilidadBruta: utilidadBrutaAnterior,
    },
  });
  if (balanceGeneral && typeof balanceGeneral === 'object') {
    balanceGeneral.comparativoAnual = comparativoAnual;
  }

  return {
    filtros: {
      fechaInicio,
      fechaFin,
      planPisoPeriod: period,
      sucursal,
      area,
      includeFi: includeFinanciamiento,
      scopeLabel: catalogKpis.filtros?.scopeLabel || eeff.filtros?.scopeLabel,
    },
    catalogKpis,
    eeff,
    balanceGeneral,
    ventasAutosNuevosEeff,
    etlConsolidado,
    puntoEquilibrio,
    dso,
    dri,
    dpo,
    cicloEfectivo,
    vitales,
    comparativoAnual,
    ebitMetrics,
    depreciacionPeriodo: depPeriodo,
    summary: {
      ingresoVentas: sales.revenue,
      ingresoServicio: service.importeFacturado,
      ingresoTotal: consolidated.ingresoTotal,
      utilidadVentas: sales.utility,
      margenVentasPct: sales.marginPct,
      unidadesVendidas: sales.units,
      ordenesServicio: service.facturadas,
      valorInventario: invSnap.inventoryValue,
      unidadesInventario: invSnap.availableUnits,
      planPisoCorte: invSummary.planPisoTotal,
      planPisoPeriodLabel: invSummary.planPisoPeriodLabel,
      planPisoUnits: invSummary.planPisoUnits,
      retailUnits: sales.retailUnits,
      flotillaUnits: sales.flotillaUnits,
      ticketPromedio: sales.ticketPromedio,
      ticketServicio: service.ticketFacturado,
      ventasTotales: kpi.ventasTotales,
      ventasNetas: kpi.ventasNetas,
      costoVentas: kpi.costoVentas,
      utilidadBruta: kpi.utilidadBruta,
      gastoDepartamento: kpi.gastoDepartamento,
      gastosOperacion: kpi.gastosOperacion,
      utilidadOperacion: kpi.utilidadOperacion,
      margenBrutoPct: kpi.margenBrutoPct,
      margenOperacionPct: kpi.margenOperacionPct,
      puntoEquilibrio: kpi.puntoEquilibrio,
      activoTotal: balanceTotals.activoTotal,
      pasivoTotal: balanceTotals.pasivoTotal,
      capitalContable: balanceTotals.capital,
      liquidezCorriente: liquidez?.razonCirculante ?? eeff.ratios?.liquidezCorriente,
      capitalTrabajo: liquidez?.capitalTrabajo ?? eeff.ratios?.capitalTrabajo,
      pruebaAcida: liquidez?.pruebaAcida ?? eeff.ratios?.pruebaAcida,
      liquidez,
      endeudamientoPct: estructura?.endeudamientoPct ?? eeff.ratios?.endeudamientoPct ?? null,
      apalancamiento: estructura?.apalancamiento ?? null,
      deudaNeta: estructura?.deudaNeta ?? null,
      ebitdaUdm: estructura?.ebitdaUdm ?? ebitMetricsUdm?.ebitda ?? null,
      calidadDeudaCortoPct: estructura?.calidadDeuda?.cortoPct ?? null,
      dsoDias: dso.dsoDias,
      driDias: dri.driDias,
      dpoDias: dpo.dpoDias,
      cicloEfectivoDias: cicloEfectivo.cicloDias,
      crecimientoUtilidadPct: vitales.crecimientoUtilidad.valorPct,
      crecimientoVentasPct: vitales.crecimientoVentas.valorPct,
      crecimientoUtilidadBrutaPct: vitales.crecimientoUtilidadBruta.valorPct,
      roePct: vitales.roe.valorPct,
      margenNetoPct: vitales.margenNeto.valorPct,
      margenEbitdaPct: ebitMetrics.margenEbitdaPct,
      crecimientoEbitPct: ebitMetrics.crecimientoEbitPct,
      ebit: ebitMetrics.ebit,
      ebitda: ebitMetrics.ebitda,
      uafida: ebitMetrics.uafida,
      depreciacionPeriodo: ebitMetrics.depreciacionPeriodo,
    },
    ventas: {
      lines: [
        { key: 'ventaSubtotal', label: 'Venta subtotal', value: sales.revenue, group: 'ingreso' },
        { key: 'costoNeto', label: 'Costo neto', value: sales.cost, group: 'costo' },
        { key: 'utilidad', label: 'Utilidad bruta', value: sales.utility, group: 'resultado', highlight: true },
      ],
      units: sales.units,
    },
    servicio: {
      lines: [
        { label: 'Total facturado', value: service.importeFacturado, highlight: true },
      ],
      facturadas: service.facturadas,
    },
    inventario: {
      totalUnits: invSnap.totalUnits,
      availableUnits: invSnap.availableUnits,
      inventoryValue: invSnap.inventoryValue,
      planPisoTotal: invSummary.planPisoTotal,
    },
    monthlyTrend,
    dailyBreakdown,
    links: {
      ventas: `/sales.html?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}`,
      inventario: '/inventory.html',
      resumen: `/?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}`,
    },
  };
}

module.exports = { getContabilidad };
