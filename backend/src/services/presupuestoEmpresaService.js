/**
 * Presupuesto de la empresa (Pronóstico · Presupuesto 2026).
 *
 * Construye un estado de resultados presupuestal mes a mes con la MISMA
 * estructura y las MISMAS fuentes que la sección Contabilidad › EEFF:
 *   - Real:        eeffSummaryService.getEeffSummary (CON_CTAS, por mes)
 *   - Presupuesto: budget2026Service.getBudgetForPeriod (Simulador ABP 2026)
 *
 * Para cada línea del P&L entrega: presupuesto anual, presupuesto YTD,
 * real YTD (meses cerrados), variación, cumplimiento, presupuesto restante y
 * dos proyecciones de cierre:
 *   - proyeccionCierre:    real cerrado + presupuesto de los meses restantes
 *   - proyeccionTendencia: presupuesto anual × (real YTD / PPTO YTD)
 */
const { getBudgetForPeriod, BUDGET_YEAR } = require('./budget2026Service');
const {
  getEeffMeses, monthRange, flattenPnl, flattenDetail, clearCache: clearEeffCache,
} = require('./eeffMensualStore');

const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MONTH_LABELS_LONG = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const CONCURRENCY = 3;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function pct(num, den, decimals = 1) {
  if (!den) return null;
  return Number(((num / den) * 100).toFixed(decimals));
}

function pctVariacion(real, presupuesto) {
  if (!presupuesto) return real ? 100 : 0;
  return Number((((real - presupuesto) / Math.abs(presupuesto)) * 100).toFixed(1));
}

// ---------------------------------------------------------------------------
// Definición de líneas (mismo orden/etiquetas que Contabilidad › EEFF)
// ---------------------------------------------------------------------------
const PNL_LINES = [
  { key: 'ventasAutos', label: 'Ventas autos nuevos', group: 'ingreso' },
  { key: 'ventasMenudeo', label: 'Menudeo', group: 'ingreso', level: 1 },
  { key: 'ventasFlotillas', label: 'Flotillas', group: 'ingreso', level: 1 },
  { key: 'ventasIntercambios', label: 'Intercambios', group: 'ingreso', level: 1 },
  { key: 'ventasSeminuevos', label: 'Ventas seminuevos', group: 'ingreso' },
  { key: 'ventasPostventa', label: 'Ventas PostVenta', group: 'ingreso' },
  { key: 'pv_servicio', label: 'Servicio', group: 'ingreso', level: 1 },
  { key: 'pv_refacciones', label: 'Refacciones', group: 'ingreso', level: 1 },
  { key: 'pv_hyp', label: 'HYP', group: 'ingreso', level: 1 },
  { key: 'ventasTotales', label: 'Total ventas', group: 'ingreso', highlight: true },
  { key: 'costoTotal', label: 'Costo de ventas', group: 'costo', invert: true },
  { key: 'utilidadBruta', label: 'Utilidad bruta', group: 'resultado', highlight: true },
  { key: 'gastosOperacion', label: 'Gastos de operación', group: 'gasto', invert: true },
  { key: 'gastosAdministracion', label: 'Gastos administración', group: 'gasto', invert: true },
  { key: 'sumaGastos', label: 'Suma gastos', group: 'gasto', highlight: true, invert: true },
  { key: 'utilidadOperacion', label: 'Utilidad de operación', group: 'resultado', highlight: true },
];

const DETAIL_METRICS = ['ventas', 'utilidadBruta', 'utilidadOperacion'];

// ---------------------------------------------------------------------------
// Presupuesto por mes
// ---------------------------------------------------------------------------
function budgetMonth(year, mes) {
  const b = getBudgetForPeriod(monthRange(year, mes));
  if (!b.available) return { mes, available: false, reason: b.reason, pnl: flattenPnl(null), detail: flattenDetail(null) };
  return {
    mes,
    available: true,
    source: b.source,
    template: b.template,
    pnl: flattenPnl(b),
    detail: flattenDetail(b),
  };
}

// ---------------------------------------------------------------------------
// Armado de líneas
// ---------------------------------------------------------------------------
function buildLineMetrics({ pptoMeses, realMeses, closedMonths, currentMonth, invert = false }) {
  const pptoAnual = pptoMeses.reduce((s, v) => s + v, 0);
  const pptoYtd = closedMonths.reduce((s, m) => s + pptoMeses[m - 1], 0);
  const realYtd = closedMonths.reduce((s, m) => s + (realMeses[m - 1] || 0), 0);
  const variacion = realYtd - pptoYtd;
  const restantes = pptoMeses.filter((_, i) => !closedMonths.includes(i + 1));
  const pptoRestante = restantes.reduce((s, v) => s + v, 0);
  const proyeccionCierre = realYtd + pptoRestante;
  const ratio = pptoYtd ? realYtd / pptoYtd : null;
  const proyeccionTendencia = ratio != null
    ? pptoAnual * ratio
    : (closedMonths.length ? (realYtd / closedMonths.length) * 12 : 0);

  const mesEnCurso = currentMonth && !closedMonths.includes(currentMonth)
    ? {
      mes: currentMonth,
      label: MONTH_LABELS[currentMonth - 1],
      ppto: round2(pptoMeses[currentMonth - 1]),
      real: realMeses[currentMonth - 1] == null ? null : round2(realMeses[currentMonth - 1]),
    }
    : null;

  return {
    pptoAnual: round2(pptoAnual),
    pptoYtd: round2(pptoYtd),
    realYtd: round2(realYtd),
    variacion: round2(variacion),
    variacionPct: pctVariacion(realYtd, pptoYtd),
    cumplimientoPct: pct(realYtd, pptoYtd),
    // Para costos/gastos, "favorable" significa por debajo del presupuesto
    favorable: invert ? variacion <= 0 : variacion >= 0,
    pptoRestante: round2(pptoRestante),
    proyeccionCierre: round2(proyeccionCierre),
    proyeccionTendencia: round2(proyeccionTendencia),
    variacionCierre: round2(proyeccionCierre - pptoAnual),
    variacionCierrePct: pctVariacion(proyeccionCierre, pptoAnual),
    variacionTendencia: round2(proyeccionTendencia - pptoAnual),
    variacionTendenciaPct: pctVariacion(proyeccionTendencia, pptoAnual),
    mesEnCurso,
  };
}

function monthEstado(mes, closedMonths, currentMonth) {
  if (closedMonths.includes(mes)) return 'cerrado';
  if (currentMonth && mes === currentMonth) return 'en-curso';
  if (currentMonth && mes < currentMonth) return 'abierto'; // transcurrido pero sin cierre contable
  return 'pendiente';
}

function buildMeses(pptoMeses, realMeses, closedMonths, currentMonth) {
  return pptoMeses.map((ppto, i) => {
    const mes = i + 1;
    const real = realMeses[i];
    const estado = monthEstado(mes, closedMonths, currentMonth);
    const realVal = estado !== 'pendiente' && real != null ? round2(real) : null;
    return {
      mes,
      label: MONTH_LABELS[i],
      estado,
      ppto: round2(ppto),
      real: realVal,
      variacion: realVal == null ? null : round2(realVal - ppto),
      variacionPct: realVal == null ? null : pctVariacion(realVal, ppto),
      cumplimientoPct: realVal == null ? null : pct(realVal, ppto),
    };
  });
}

function resolveCutoff({ year, hoy, mesCorte }) {
  const today = hoy instanceof Date ? hoy : new Date();
  const currentYear = today.getFullYear();
  let currentMonth = null;
  let defaultClosed;
  if (currentYear < year) {
    defaultClosed = 0;
  } else if (currentYear > year) {
    defaultClosed = 12;
  } else {
    currentMonth = today.getMonth() + 1;
    defaultClosed = currentMonth - 1;
  }
  let corte = Number(mesCorte);
  if (!Number.isInteger(corte) || corte < 0 || corte > 12) corte = defaultClosed;
  const closedMonths = Array.from({ length: corte }, (_, i) => i + 1);
  return { currentMonth, closedMonths, mesCorte: corte, mesCorteDefault: defaultClosed };
}

// ---------------------------------------------------------------------------
// Servicio principal
// ---------------------------------------------------------------------------
async function getPresupuestoEmpresa({ mesCorte, fresh = false, hoy } = {}) {
  const year = BUDGET_YEAR;
  const { currentMonth, closedMonths, mesCorte: corte, mesCorteDefault } = resolveCutoff({ year, hoy, mesCorte });

  // Presupuesto 12 meses (síncrono, workbook en caché)
  const pptoByMonth = Array.from({ length: 12 }, (_, i) => budgetMonth(year, i + 1));
  const pptoAvailable = pptoByMonth.some((m) => m.available);
  if (!pptoAvailable) {
    return {
      available: false,
      year,
      reason: pptoByMonth[0]?.reason || `No se encontró el presupuesto ${year}.`,
    };
  }

  // Real: meses cerrados + meses transcurridos sin cierre + mes en curso
  const lastMonthWithReal = Math.max(closedMonths.length, currentMonth || 0);
  const monthsToFetch = Array.from({ length: lastMonthWithReal }, (_, i) => i + 1);
  const realList = await getEeffMeses(
    monthsToFetch.map((mes) => ({ year, mes })),
    { fresh: Boolean(fresh), concurrency: CONCURRENCY },
  );
  realList.filter((r) => r.error).forEach((r) => {
    console.error(`[presupuesto-empresa] real ${year}-${pad2(r.mes)}:`, r.error);
  });
  const realByMonth = new Map(realList.map((r) => [r.mes, r]));
  const realErrors = realList.filter((r) => r.error).map((r) => `${MONTH_LABELS[r.mes - 1]}: ${r.error}`);

  const realSeries = (getter) => Array.from({ length: 12 }, (_, i) => {
    const r = realByMonth.get(i + 1);
    if (!r || !r.pnl) return null;
    return getter(r);
  });
  const pptoSeries = (getter) => pptoByMonth.map((m) => (m.available ? getter(m) : 0));

  // Líneas P&L
  const lineas = PNL_LINES.map((def) => {
    const pptoMeses = pptoSeries((m) => m.pnl[def.key] || 0);
    const realMeses = realSeries((r) => r.pnl[def.key] || 0);
    const metrics = buildLineMetrics({ pptoMeses, realMeses, closedMonths, currentMonth, invert: def.invert });
    return {
      key: def.key,
      label: def.label,
      group: def.group,
      level: def.level || 0,
      highlight: Boolean(def.highlight),
      invert: Boolean(def.invert),
      ...metrics,
      meses: buildMeses(pptoMeses, realMeses, closedMonths, currentMonth),
    };
  });
  const lineByKey = Object.fromEntries(lineas.map((l) => [l.key, l]));

  // Detalle: autos nuevos por fuerza de venta y postventa por área
  const detailRows = (section, orderIds) => {
    const ids = orderIds || [];
    // ids reales (sucursales) provienen del primer mes con datos
    const sample = [...realByMonth.values()].find((r) => r.detail)?.detail?.[section]
      || pptoByMonth.find((m) => m.available)?.detail?.[section]
      || {};
    const allIds = [...new Set([...ids, ...Object.keys(sample)])];
    return allIds.map((id) => {
      const label = sample[id]?.label
        || pptoByMonth.find((m) => m.available)?.detail?.[section]?.[id]?.label
        || id;
      const metrics = {};
      for (const metric of DETAIL_METRICS) {
        const pptoMeses = pptoSeries((m) => m.detail[section]?.[id]?.[metric] || 0);
        const realMeses = realSeries((r) => r.detail[section]?.[id]?.[metric] || 0);
        metrics[metric] = buildLineMetrics({ pptoMeses, realMeses, closedMonths, currentMonth });
      }
      return {
        id,
        label,
        isTotal: id === 'total' || id === 'menudeo_total',
        ...metrics,
      };
    });
  };
  const menudeoIds = Object.keys(
    [...realByMonth.values()].find((r) => r.detail)?.detail?.autos
    || pptoByMonth.find((m) => m.available)?.detail?.autos
    || {},
  ).filter((id) => !['menudeo_total', 'flotillas', 'intercambios', 'total'].includes(id));
  const autosRows = detailRows('autos', [...menudeoIds, 'menudeo_total', 'flotillas', 'intercambios', 'total']);
  const postventaRows = detailRows('postventa', ['servicio', 'refacciones', 'hyp', 'total']);

  // KPIs ejecutivos
  const kpiOf = (key) => {
    const l = lineByKey[key];
    return {
      key,
      label: l.label,
      pptoAnual: l.pptoAnual,
      pptoYtd: l.pptoYtd,
      realYtd: l.realYtd,
      variacion: l.variacion,
      variacionPct: l.variacionPct,
      cumplimientoPct: l.cumplimientoPct,
      favorable: l.favorable,
      proyeccionCierre: l.proyeccionCierre,
      proyeccionTendencia: l.proyeccionTendencia,
      variacionCierrePct: l.variacionCierrePct,
    };
  };
  const margen = (numKey, denKey, which) => {
    const num = lineByKey[numKey];
    const den = lineByKey[denKey];
    return {
      real: pct(num.realYtd, den.realYtd),
      ppto: pct(num.pptoYtd, den.pptoYtd),
      pptoAnual: pct(num.pptoAnual, den.pptoAnual),
      proyeccion: pct(num[which], den[which]),
    };
  };

  const kpis = {
    ventasTotales: kpiOf('ventasTotales'),
    utilidadBruta: kpiOf('utilidadBruta'),
    sumaGastos: kpiOf('sumaGastos'),
    utilidadOperacion: kpiOf('utilidadOperacion'),
    margenBruto: margen('utilidadBruta', 'ventasTotales', 'proyeccionCierre'),
    margenOperacion: margen('utilidadOperacion', 'ventasTotales', 'proyeccionCierre'),
  };

  const closedLabel = closedMonths.length
    ? (closedMonths.length === 1
      ? MONTH_LABELS_LONG[0]
      : `${MONTH_LABELS[0]}–${MONTH_LABELS[closedMonths.length - 1]}`)
    : 'sin meses cerrados';

  const src = pptoByMonth.find((m) => m.available) || {};
  return {
    available: true,
    year,
    generatedAt: new Date().toISOString(),
    source: {
      real: 'CON_CTAS · EEFF SUMMARY (Contabilidad › EEFF)',
      presupuesto: `${src.template || 'Simulador ABP PRESUPUESTO 2026'} · ${src.source || 'presupuesto-2026.xlsx'}`,
    },
    corte: {
      mesCorte: corte,
      mesCorteDefault,
      mesesCerrados: closedMonths,
      mesesCerradosLabel: closedLabel,
      mesEnCurso: currentMonth && !closedMonths.includes(currentMonth) ? currentMonth : null,
      mesEnCursoLabel: currentMonth && !closedMonths.includes(currentMonth) ? MONTH_LABELS_LONG[currentMonth - 1] : null,
      mesesRestantes: 12 - closedMonths.length,
      factorYtd: Number((closedMonths.length / 12).toFixed(4)),
      realParcial: realList.some((r) => !r.available && !r.error),
      errores: realErrors,
    },
    meses: MONTH_LABELS.map((label, i) => ({
      mes: i + 1,
      label,
      estado: monthEstado(i + 1, closedMonths, currentMonth),
    })),
    kpis,
    lineas,
    detalle: {
      autosNuevos: autosRows,
      postventa: postventaRows,
    },
    metodologia: {
      real: 'Movimientos contables por mes (CON_CTAS) con la misma lógica de Contabilidad › EEFF: menudeo por sucursal + flotillas + intercambios, seminuevos, postventa (Servicio/Refacciones/HYP), gastos por departamento y prorrateo de administración.',
      presupuesto: 'Simulador ABP 2026: ventas por sucursal/división de la hoja PRESUPUESTO FINANCIERO (mensual); utilidad bruta, gastos y administración de la hoja RESUMEN distribuidos linealmente por mes (1/12).',
      ytd: `Real y presupuesto acumulados de los meses cerrados (${closedLabel}), según el corte contable elegido. Los meses transcurridos sin cierre y el mes en curso se muestran como referencia y no entran en el YTD ni en las proyecciones.`,
      proyeccionCierre: 'Real de meses cerrados + presupuesto de los meses restantes (cierre "a presupuesto").',
      proyeccionTendencia: 'Presupuesto anual × cumplimiento YTD (real YTD ÷ PPTO YTD); mantiene la estacionalidad del presupuesto.',
      signos: 'Costos y gastos: variación favorable cuando el real queda por debajo del presupuesto.',
    },
  };
}

function clearCache() {
  clearEeffCache();
}

module.exports = { getPresupuestoEmpresa, clearCache, PNL_LINES };
