/**
 * Generador de presupuesto · próximos 12 meses.
 *
 * Construye un presupuesto mensual (estado de resultados con la misma
 * estructura que Contabilidad › EEFF) para los 12 meses siguientes, a partir
 * del histórico contable real (CON_CTAS, 24–36 meses) y un conjunto de
 * supuestos ajustables por segmento:
 *   - crecimiento de ventas (%), margen bruto objetivo (%), crecimiento de gastos (%)
 *   - crecimiento de gastos de administración (%)
 *
 * Métodos de proyección:
 *   - estacional (default): últimos 12 meses × (1 + crecimiento), distribuidos
 *     con el índice de estacionalidad de los últimos 24 meses.
 *   - regresion: forecastModel (OLS tendencia + estacionalidad + lags), con
 *     reescalado si el usuario fija un crecimiento.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const { forecastSales } = require('./forecastModel');
const { getEeffMeses, monthsBack, flattenPnl, monthRange } = require('./eeffMensualStore');
const { getBudgetForPeriod, BUDGET_YEAR } = require('./budget2026Service');

const ESCENARIOS_PATH = path.join(__dirname, '../../data/presupuesto-escenarios.json');
const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const DEFAULT_HISTORIA = 36;
const MIN_HISTORIA = 13;
const HORIZONTE = 12;
const MAX_TREND = 0.25; // tope al crecimiento derivado de ventas (±25 %)
const RUNRATE_MONTHS = 6; // gastos: base = run-rate de los últimos 6 meses anualizado

const SEGMENTOS = [
  { id: 'piso', label: 'Piso', grupo: 'menudeo' },
  { id: 'foraneos', label: 'Foráneos digitales', grupo: 'menudeo' },
  { id: 'suauto', label: 'SuAuto', grupo: 'menudeo' },
  { id: 'cholula', label: 'Cholula', grupo: 'menudeo' },
  { id: 'zacatelco', label: 'Zacatelco', grupo: 'menudeo' },
  { id: 'casa', label: 'Casa', grupo: 'menudeo' },
  { id: 'flotillas', label: 'Flotillas', grupo: 'autos' },
  { id: 'intercambios', label: 'Intercambios', grupo: 'autos' },
  { id: 'seminuevos', label: 'Seminuevos', grupo: 'seminuevos' },
  { id: 'servicio', label: 'Servicio', grupo: 'postventa' },
  { id: 'refacciones', label: 'Refacciones', grupo: 'postventa' },
  { id: 'hyp', label: 'HYP', grupo: 'postventa' },
];

const GRUPO_LABELS = {
  menudeo: 'Autos nuevos · Menudeo',
  autos: 'Autos nuevos · Flotillas e intercambios',
  seminuevos: 'Seminuevos',
  postventa: 'PostVenta',
};

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

// ---------------------------------------------------------------------------
// utilidades
// ---------------------------------------------------------------------------
const pad2 = (n) => String(n).padStart(2, '0');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const sum = (arr) => arr.reduce((s, v) => s + (Number(v) || 0), 0);
const mean = (arr) => (arr.length ? sum(arr) / arr.length : 0);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pctOf = (num, den, d = 1) => (den ? Number(((num / den) * 100).toFixed(d)) : null);
const pctChange = (val, base, d = 1) => (base ? Number((((val - base) / Math.abs(base)) * 100).toFixed(d)) : null);
const toNum = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function monthLabel(year, mes) {
  return `${MONTH_LABELS[mes - 1]} ${String(year).slice(-2)}`;
}

function addMonths(year, mes, n) {
  const total = year * 12 + (mes - 1) + n;
  return { year: Math.floor(total / 12), mes: (total % 12) + 1 };
}

function parseInicio(inicio, hoy) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(inicio || ''));
  if (m) {
    const year = Number(m[1]);
    const mes = Number(m[2]);
    if (mes >= 1 && mes <= 12) return { year, mes };
  }
  return addMonths(hoy.getFullYear(), hoy.getMonth() + 1, 1); // mes siguiente al actual
}

// ---------------------------------------------------------------------------
// Modelos de proyección
// ---------------------------------------------------------------------------
/**
 * Índice estacional por mes calendario a partir de los últimos 24 meses
 * (ventanas de 12). Devuelve arreglo [13] con índice medio 1.
 */
function seasonalIndex(points) {
  const n = points.length;
  const windows = [];
  if (n >= 12) windows.push(points.slice(n - 12));
  if (n >= 24) windows.push(points.slice(n - 24, n - 12));
  if (n >= 36) windows.push(points.slice(n - 36, n - 24));
  const acc = Array.from({ length: 13 }, () => []);
  for (const w of windows) {
    const avg = mean(w.map((p) => p.value));
    if (!avg) continue;
    for (const p of w) acc[p.mes].push(p.value / avg);
  }
  const idx = acc.map((list) => (list.length ? mean(list) : 1));
  const present = idx.slice(1);
  const norm = mean(present) || 1;
  return idx.map((v) => v / norm);
}

function derivedGrowth(points) {
  const n = points.length;
  if (n < 24) return { pct: 0, base: 'insuficiente' };
  const last12 = sum(points.slice(n - 12).map((p) => p.value));
  const prev12 = sum(points.slice(n - 24, n - 12).map((p) => p.value));
  if (!prev12) return { pct: 0, base: 'sin-base' };
  return { pct: Number((clamp(last12 / prev12 - 1, -MAX_TREND, MAX_TREND) * 100).toFixed(1)), base: 'yoy' };
}

/**
 * Proyecta una serie mensual 12 meses hacia adelante.
 * @param {Array<{year:number, mes:number, value:number}>} points histórico ASC (solo meses disponibles)
 * @param {Array<{year:number, mes:number}>} horizonte 12 meses
 * @param {{metodo?: string, crecimientoPct?: number|null}} opts
 */
function proyectarSerie(points, horizonte, { metodo = 'estacional', crecimientoPct = null, baseModo = 'ultimos12' } = {}) {
  const n = points.length;
  const last12 = points.slice(Math.max(0, n - 12));
  const ultimos12 = sum(last12.map((p) => p.value));
  // Base anual: últimos 12 meses (ventas) o run-rate de los últimos 6 meses anualizado (gastos)
  let base12 = ultimos12;
  let baseLabel = 'últimos 12 meses';
  if (baseModo === 'runrate6' && n >= RUNRATE_MONTHS) {
    base12 = mean(points.slice(n - RUNRATE_MONTHS).map((p) => p.value)) * 12;
    baseLabel = `run-rate ${RUNRATE_MONTHS}m anualizado`;
  }
  const derived = baseModo === 'runrate6'
    ? { pct: 0, base: 'runrate', runrateVsUltimos12Pct: pctChange(base12, ultimos12) }
    : derivedGrowth(points);
  const growthPct = crecimientoPct != null ? crecimientoPct : derived.pct;
  const growth = growthPct / 100;

  if (!n || !base12) {
    return {
      valores: horizonte.map(() => 0),
      metodo: 'sin-historia',
      base12: 0,
      baseLabel,
      ultimos12: round2(ultimos12),
      crecimientoDerivadoPct: derived.pct,
      crecimientoAplicadoPct: growthPct,
      runrateVsUltimos12Pct: derived.runrateVsUltimos12Pct ?? null,
    };
  }

  let valores;
  let metodoUsado = metodo;
  if (metodo === 'regresion' && n >= 16) {
    try {
      const scale = 1000;
      const history = points.map((p) => ({ yr: p.year, mo: p.mes, units: Math.round(p.value / scale) }));
      const fc = forecastSales(history, horizonte.length + 3);
      const byKey = new Map(fc.forecast.map((f) => [`${f.yr}-${pad2(f.mo)}`, f.units * scale]));
      valores = horizonte.map((h) => byKey.get(`${h.year}-${pad2(h.mes)}`));
      if (valores.some((v) => v == null)) throw new Error('horizonte fuera del pronóstico');
      // Si el usuario fija crecimiento, reescalar manteniendo la forma del modelo
      if (crecimientoPct != null) {
        const target = base12 * (1 + growth);
        const got = sum(valores);
        if (got > 0) valores = valores.map((v) => (v * target) / got);
      }
    } catch {
      valores = null;
      metodoUsado = 'estacional';
    }
  }
  if (!valores) {
    metodoUsado = 'estacional';
    const idx = seasonalIndex(points);
    const level = (base12 / 12) * (1 + growth);
    valores = horizonte.map((h) => level * (idx[h.mes] || 1));
  }

  valores = valores.map((v) => Math.max(0, round2(v)));
  const total = sum(valores);
  return {
    valores,
    metodo: metodoUsado,
    base12: round2(base12),
    baseLabel,
    ultimos12: round2(ultimos12),
    crecimientoDerivadoPct: derived.pct,
    crecimientoAplicadoPct: crecimientoPct != null ? crecimientoPct : Number((pctChange(total, base12) ?? 0).toFixed(1)),
    runrateVsUltimos12Pct: derived.runrateVsUltimos12Pct ?? null,
  };
}

// ---------------------------------------------------------------------------
// Generación
// ---------------------------------------------------------------------------
function normalizeSupuestos(raw = {}) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const segmentos = {};
  for (const [id, cfg] of Object.entries(s.segmentos || {})) {
    if (!cfg || typeof cfg !== 'object') continue;
    segmentos[id] = {
      crecimientoVentasPct: toNum(cfg.crecimientoVentasPct),
      margenBrutoPct: toNum(cfg.margenBrutoPct),
      crecimientoGastosPct: toNum(cfg.crecimientoGastosPct),
    };
  }
  return {
    metodo: s.metodo === 'regresion' ? 'regresion' : 'estacional',
    crecimientoVentasPct: toNum(s.crecimientoVentasPct),
    crecimientoGastosPct: toNum(s.crecimientoGastosPct),
    crecimientoAdminPct: toNum(s.crecimientoAdminPct),
    segmentos,
  };
}

function seriesFrom(meses, getter) {
  return meses
    .filter((m) => m.available && m.pnl)
    .map((m) => ({ year: m.year, mes: m.mes, value: Number(getter(m)) || 0 }));
}

async function getPresupuesto12m({
  inicio, mesesHistoria = DEFAULT_HISTORIA, supuestos: rawSupuestos, fresh = false, hoy,
} = {}) {
  const today = hoy instanceof Date ? hoy : new Date();
  const supuestos = normalizeSupuestos(rawSupuestos);
  const start = parseInicio(inicio, today);
  const horizonte = Array.from({ length: HORIZONTE }, (_, i) => {
    const { year, mes } = addMonths(start.year, start.mes, i);
    return { year, mes, key: `${year}-${pad2(mes)}`, label: monthLabel(year, mes) };
  });

  // Histórico: meses cerrados hasta el mes anterior al actual
  const lastClosed = addMonths(today.getFullYear(), today.getMonth() + 1, -1);
  const nHist = clamp(Number(mesesHistoria) || DEFAULT_HISTORIA, MIN_HISTORIA, 48);
  const histList = monthsBack(lastClosed.year, lastClosed.mes, nHist);
  const meses = await getEeffMeses(histList, { fresh: Boolean(fresh), concurrency: 3 });
  const disponibles = meses.filter((m) => m.available && m.pnl);
  const faltantes = meses.filter((m) => !m.available || !m.pnl).map((m) => m.key);
  if (disponibles.length < MIN_HISTORIA) {
    return {
      available: false,
      reason: `Se requieren al menos ${MIN_HISTORIA} meses contables cerrados; disponibles: ${disponibles.length}.`,
      faltantes,
    };
  }

  const opcionesModelo = { metodo: supuestos.metodo };

  // --- Segmentos
  const segmentos = SEGMENTOS.map((def) => {
    const cfg = supuestos.segmentos[def.id] || {};
    const label = disponibles[disponibles.length - 1]?.segmentos?.[def.id]?.label || def.label;
    const ventasHist = seriesFrom(meses, (m) => m.segmentos?.[def.id]?.ventas);
    const ubHist = seriesFrom(meses, (m) => m.segmentos?.[def.id]?.utilidadBruta);
    const gastosHist = seriesFrom(meses, (m) => m.segmentos?.[def.id]?.gastos);

    const ventasProj = proyectarSerie(ventasHist, horizonte, {
      ...opcionesModelo,
      crecimientoPct: cfg.crecimientoVentasPct ?? supuestos.crecimientoVentasPct,
    });
    const gastosProj = proyectarSerie(gastosHist, horizonte, {
      ...opcionesModelo,
      baseModo: 'runrate6',
      crecimientoPct: cfg.crecimientoGastosPct ?? supuestos.crecimientoGastosPct,
    });

    const ventas12 = sum(ventasHist.slice(-12).map((p) => p.value));
    const ub12 = sum(ubHist.slice(-12).map((p) => p.value));
    const margen12 = ventas12 ? (ub12 / ventas12) * 100 : 0;
    const margenAplicado = cfg.margenBrutoPct != null ? cfg.margenBrutoPct : Number(margen12.toFixed(2));

    const ventas = ventasProj.valores;
    const utilidadBruta = ventas.map((v) => round2(v * (margenAplicado / 100)));
    const costo = ventas.map((v, i) => round2(v - utilidadBruta[i]));
    const gastos = gastosProj.valores;
    const utilidadOperacion = utilidadBruta.map((v, i) => round2(v - gastos[i]));

    const tot = (arr) => round2(sum(arr));
    return {
      id: def.id,
      label,
      grupo: def.grupo,
      grupoLabel: GRUPO_LABELS[def.grupo],
      supuestos: {
        ventas12m: round2(ventas12),
        crecimientoVentasDerivadoPct: ventasProj.crecimientoDerivadoPct,
        crecimientoVentasAplicadoPct: ventasProj.crecimientoAplicadoPct,
        crecimientoVentasManual: cfg.crecimientoVentasPct != null || supuestos.crecimientoVentasPct != null,
        margenBruto12mPct: Number(margen12.toFixed(2)),
        margenBrutoAplicadoPct: margenAplicado,
        margenBrutoManual: cfg.margenBrutoPct != null,
        gastos12m: round2(sum(gastosHist.slice(-12).map((p) => p.value))),
        gastosBase: gastosProj.base12,
        gastosBaseLabel: gastosProj.baseLabel,
        gastosRunrateVsUltimos12Pct: gastosProj.runrateVsUltimos12Pct,
        crecimientoGastosDerivadoPct: gastosProj.crecimientoDerivadoPct,
        crecimientoGastosAplicadoPct: gastosProj.crecimientoAplicadoPct,
        crecimientoGastosManual: cfg.crecimientoGastosPct != null || supuestos.crecimientoGastosPct != null,
        metodoVentas: ventasProj.metodo,
        metodoGastos: gastosProj.metodo,
      },
      meses: { ventas, costo, utilidadBruta, gastos, utilidadOperacion },
      totales: {
        ventas: tot(ventas),
        costo: tot(costo),
        utilidadBruta: tot(utilidadBruta),
        gastos: tot(gastos),
        utilidadOperacion: tot(utilidadOperacion),
        margenBrutoPct: pctOf(sum(utilidadBruta), sum(ventas)),
        margenOperacionPct: pctOf(sum(utilidadOperacion), sum(ventas)),
      },
    };
  });

  // --- Administración (total empresa)
  const adminHist = seriesFrom(meses, (m) => m.pnl.gastosAdministracion);
  const adminProj = proyectarSerie(adminHist, horizonte, {
    ...opcionesModelo,
    baseModo: 'runrate6',
    crecimientoPct: supuestos.crecimientoAdminPct,
  });

  // --- Líneas P&L por mes
  const segBy = (pred) => segmentos.filter(pred);
  const sumSeg = (list, metric) => horizonte.map((_, i) => round2(sum(list.map((s) => s.meses[metric][i]))));
  const menudeo = segBy((s) => s.grupo === 'menudeo');
  const flot = segBy((s) => s.id === 'flotillas');
  const inter = segBy((s) => s.id === 'intercambios');
  const semi = segBy((s) => s.id === 'seminuevos');
  const pv = segBy((s) => s.grupo === 'postventa');
  const all = segmentos;

  const valores = {
    ventasMenudeo: sumSeg(menudeo, 'ventas'),
    ventasFlotillas: sumSeg(flot, 'ventas'),
    ventasIntercambios: sumSeg(inter, 'ventas'),
    ventasSeminuevos: sumSeg(semi, 'ventas'),
    pv_servicio: sumSeg(segBy((s) => s.id === 'servicio'), 'ventas'),
    pv_refacciones: sumSeg(segBy((s) => s.id === 'refacciones'), 'ventas'),
    pv_hyp: sumSeg(segBy((s) => s.id === 'hyp'), 'ventas'),
    ventasPostventa: sumSeg(pv, 'ventas'),
    ventasTotales: sumSeg(all, 'ventas'),
    costoTotal: sumSeg(all, 'costo'),
    utilidadBruta: sumSeg(all, 'utilidadBruta'),
    gastosOperacion: sumSeg(all, 'gastos'),
    gastosAdministracion: adminProj.valores,
  };
  valores.ventasAutos = horizonte.map((_, i) => round2(valores.ventasMenudeo[i] + valores.ventasFlotillas[i] + valores.ventasIntercambios[i]));
  valores.sumaGastos = horizonte.map((_, i) => round2(valores.gastosOperacion[i] + valores.gastosAdministracion[i]));
  valores.utilidadOperacion = horizonte.map((_, i) => round2(valores.utilidadBruta[i] - valores.sumaGastos[i]));

  // --- Referencias: mismo mes año anterior (real) y PPTO oficial 2026 cuando aplique
  const histByKey = new Map(disponibles.map((m) => [m.key, m]));
  const pptoByKey = new Map();
  for (const h of horizonte) {
    if (h.year !== BUDGET_YEAR) continue;
    const b = getBudgetForPeriod(monthRange(h.year, h.mes));
    if (b.available) pptoByKey.set(h.key, flattenPnl(b));
  }
  const anioAnteriorSerie = (key) => horizonte.map((h) => {
    const prev = histByKey.get(`${h.year - 1}-${pad2(h.mes)}`);
    return prev ? round2(prev.pnl[key]) : null;
  });
  const pptoSerie = (key) => horizonte.map((h) => (pptoByKey.has(h.key) ? round2(pptoByKey.get(h.key)[key]) : null));

  // Base de comparación: últimos 12 meses reales cerrados (misma línea)
  const ultimos12 = disponibles.slice(-12);
  const ultimos12Total = (key) => round2(sum(ultimos12.map((m) => m.pnl[key])));

  const lineas = PNL_LINES.map((def) => {
    const meses12 = valores[def.key];
    const total = round2(sum(meses12));
    const prev = anioAnteriorSerie(def.key);
    const prevTotal = prev.every((v) => v != null) ? round2(sum(prev)) : null;
    const base = ultimos12Total(def.key);
    const ppto = pptoSerie(def.key);
    return {
      key: def.key,
      label: def.label,
      group: def.group,
      level: def.level || 0,
      highlight: Boolean(def.highlight),
      invert: Boolean(def.invert),
      meses: meses12,
      total,
      promedioMensual: round2(total / HORIZONTE),
      ultimos12mTotal: base,
      variacionVsUltimos12mPct: pctChange(total, base),
      anioAnterior: prev,
      anioAnteriorTotal: prevTotal,
      variacionAnioAnteriorPct: prevTotal != null ? pctChange(total, prevTotal) : null,
      ppto2026: ppto.some((v) => v != null) ? ppto : null,
    };
  });
  const lineByKey = Object.fromEntries(lineas.map((l) => [l.key, l]));

  const kpi = (key) => ({
    key,
    label: lineByKey[key].label,
    total: lineByKey[key].total,
    promedioMensual: lineByKey[key].promedioMensual,
    ultimos12mTotal: lineByKey[key].ultimos12mTotal,
    variacionPct: lineByKey[key].variacionVsUltimos12mPct,
  });
  const kpis = {
    ventasTotales: kpi('ventasTotales'),
    utilidadBruta: kpi('utilidadBruta'),
    sumaGastos: kpi('sumaGastos'),
    utilidadOperacion: kpi('utilidadOperacion'),
    margenBrutoPct: pctOf(lineByKey.utilidadBruta.total, lineByKey.ventasTotales.total),
    margenOperacionPct: pctOf(lineByKey.utilidadOperacion.total, lineByKey.ventasTotales.total),
    margenBrutoAnteriorPct: pctOf(lineByKey.utilidadBruta.ultimos12mTotal, lineByKey.ventasTotales.ultimos12mTotal),
    margenOperacionAnteriorPct: pctOf(lineByKey.utilidadOperacion.ultimos12mTotal, lineByKey.ventasTotales.ultimos12mTotal),
    ultimos12mRango: ultimos12.length
      ? `${monthLabel(ultimos12[0].year, ultimos12[0].mes)} – ${monthLabel(ultimos12[ultimos12.length - 1].year, ultimos12[ultimos12.length - 1].mes)}`
      : null,
  };

  // Serie histórica para gráfica (últimos 24 meses reales)
  const historia = disponibles.slice(-24).map((m) => ({
    key: m.key,
    label: monthLabel(m.year, m.mes),
    ventasTotales: round2(m.pnl.ventasTotales),
    utilidadBruta: round2(m.pnl.utilidadBruta),
    sumaGastos: round2(m.pnl.sumaGastos),
    utilidadOperacion: round2(m.pnl.utilidadOperacion),
  }));

  return {
    available: true,
    generatedAt: new Date().toISOString(),
    horizonte,
    inicio: `${start.year}-${pad2(start.mes)}`,
    historiaInfo: {
      desde: meses[0]?.key,
      hasta: meses[meses.length - 1]?.key,
      solicitados: nHist,
      disponibles: disponibles.length,
      faltantes,
      ultimoCerrado: `${lastClosed.year}-${pad2(lastClosed.mes)}`,
    },
    supuestos,
    supuestosAplicados: {
      metodo: supuestos.metodo,
      admin: {
        gastos12m: round2(sum(adminHist.slice(-12).map((p) => p.value))),
        gastosBase: adminProj.base12,
        gastosBaseLabel: adminProj.baseLabel,
        gastosRunrateVsUltimos12Pct: adminProj.runrateVsUltimos12Pct,
        crecimientoDerivadoPct: adminProj.crecimientoDerivadoPct,
        crecimientoAplicadoPct: adminProj.crecimientoAplicadoPct,
        manual: supuestos.crecimientoAdminPct != null,
        metodo: adminProj.metodo,
      },
      segmentos: segmentos.map((s) => ({ id: s.id, label: s.label, grupo: s.grupo, grupoLabel: s.grupoLabel, ...s.supuestos })),
    },
    kpis,
    lineas,
    segmentos,
    historia,
    metodologia: {
      base: 'Histórico contable real mes a mes (CON_CTAS) con la lógica de Contabilidad › EEFF: ventas y costo por sucursal/división, gastos por departamento y administración total.',
      estacional: `Presupuesto 12 meses = últimos 12 meses reales × (1 + crecimiento). El crecimiento por defecto es la variación de los últimos 12 meses contra los 12 anteriores (tope ±${Math.round(MAX_TREND * 100)} %). La distribución mensual usa el índice de estacionalidad de los últimos 24–36 meses.`,
      regresion: 'Regresión lineal múltiple (tendencia + estacionalidad + rezagos) sobre cada serie; si se fija un crecimiento manual se reescala el total conservando la forma.',
      margen: 'Costo de ventas = ventas × (1 − margen bruto). El margen por defecto es el real de los últimos 12 meses por segmento y puede fijarse como objetivo.',
      gastos: 'Gastos de operación por segmento y administración total: base = run-rate de los últimos 6 meses anualizado (recoge cambios recientes de estructura), distribuido con estacionalidad y ajustado por el crecimiento/inflación que se indique (0 % por defecto).',
      referencias: 'Año anterior = real del mismo mes del año previo. PPTO 2026 = presupuesto oficial vigente para los meses que caen en 2026.',
    },
  };
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------
function buildXlsx(data) {
  const wb = XLSX.utils.book_new();
  const months = data.horizonte.map((h) => h.label);

  const edo = [['Concepto', ...months, 'Total 12m', 'Últimos 12m reales', 'Var. %']];
  for (const l of data.lineas) {
    edo.push([
      `${'  '.repeat(l.level || 0)}${l.label}`,
      ...l.meses,
      l.total,
      l.ultimos12mTotal ?? '',
      l.variacionVsUltimos12mPct ?? '',
    ]);
  }
  edo.push([]);
  edo.push(['Margen bruto %', ...data.horizonte.map((_, i) => pctOf(data.lineas.find((l) => l.key === 'utilidadBruta').meses[i], data.lineas.find((l) => l.key === 'ventasTotales').meses[i]) ?? ''), data.kpis.margenBrutoPct ?? '']);
  edo.push(['Margen operación %', ...data.horizonte.map((_, i) => pctOf(data.lineas.find((l) => l.key === 'utilidadOperacion').meses[i], data.lineas.find((l) => l.key === 'ventasTotales').meses[i]) ?? ''), data.kpis.margenOperacionPct ?? '']);
  const ws1 = XLSX.utils.aoa_to_sheet(edo);
  ws1['!cols'] = [{ wch: 28 }, ...months.map(() => ({ wch: 14 })), { wch: 16 }, { wch: 16 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Presupuesto 12m');

  const seg = [['Segmento', 'Grupo', 'Concepto', ...months, 'Total 12m']];
  const metricLabels = { ventas: 'Ventas', costo: 'Costo', utilidadBruta: 'Utilidad bruta', gastos: 'Gastos operación', utilidadOperacion: 'Utilidad operación (antes de admón.)' };
  for (const s of data.segmentos) {
    for (const [metric, label] of Object.entries(metricLabels)) {
      seg.push([s.label, s.grupoLabel, label, ...s.meses[metric], s.totales[metric]]);
    }
  }
  const ws2 = XLSX.utils.aoa_to_sheet(seg);
  ws2['!cols'] = [{ wch: 20 }, { wch: 30 }, { wch: 32 }, ...months.map(() => ({ wch: 14 })), { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Segmentos');

  const sup = [['Segmento', 'Grupo', 'Ventas últimos 12m', 'Crec. ventas derivado %', 'Crec. ventas aplicado %', 'Margen bruto 12m %', 'Margen bruto aplicado %', 'Gastos últimos 12m', 'Gastos base (run-rate 6m anualizado)', 'Crec. gastos aplicado %', 'Método']];
  for (const s of data.supuestosAplicados.segmentos) {
    sup.push([s.label, s.grupoLabel, s.ventas12m, s.crecimientoVentasDerivadoPct, s.crecimientoVentasAplicadoPct, s.margenBruto12mPct, s.margenBrutoAplicadoPct, s.gastos12m, s.gastosBase, s.crecimientoGastosAplicadoPct, s.metodoVentas]);
  }
  const a = data.supuestosAplicados.admin;
  sup.push(['Gastos administración', 'Empresa', '', '', '', '', '', a.gastos12m, a.gastosBase, a.crecimientoAplicadoPct, a.metodo]);
  sup.push([]);
  sup.push(['Método global', data.supuestosAplicados.metodo]);
  sup.push(['Histórico', `${data.historiaInfo.desde} → ${data.historiaInfo.hasta} (${data.historiaInfo.disponibles} meses)`]);
  sup.push(['Generado', data.generatedAt]);
  const ws3 = XLSX.utils.aoa_to_sheet(sup);
  ws3['!cols'] = [{ wch: 22 }, { wch: 30 }, ...Array.from({ length: 9 }, () => ({ wch: 18 }))];
  XLSX.utils.book_append_sheet(wb, ws3, 'Supuestos');

  const hist = [['Mes', 'Total ventas', 'Utilidad bruta', 'Suma gastos', 'Utilidad de operación']];
  for (const h of data.historia) hist.push([h.label, h.ventasTotales, h.utilidadBruta, h.sumaGastos, h.utilidadOperacion]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hist), 'Histórico real');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// ---------------------------------------------------------------------------
// Escenarios guardados
// ---------------------------------------------------------------------------
function readEscenarios() {
  try {
    if (!fs.existsSync(ESCENARIOS_PATH)) return [];
    const raw = JSON.parse(fs.readFileSync(ESCENARIOS_PATH, 'utf8'));
    return Array.isArray(raw?.escenarios) ? raw.escenarios : [];
  } catch {
    return [];
  }
}

function writeEscenarios(list) {
  fs.mkdirSync(path.dirname(ESCENARIOS_PATH), { recursive: true });
  fs.writeFileSync(ESCENARIOS_PATH, JSON.stringify({ version: 1, escenarios: list }, null, 2));
}

function listEscenarios() {
  return readEscenarios().map((e) => ({
    id: e.id, nombre: e.nombre, inicio: e.inicio, creado: e.creado, actualizado: e.actualizado, usuario: e.usuario || null,
  }));
}

function getEscenario(id) {
  return readEscenarios().find((e) => e.id === id) || null;
}

function saveEscenario({ id, nombre, inicio, mesesHistoria, supuestos, usuario }) {
  const list = readEscenarios();
  const now = new Date().toISOString();
  const clean = {
    nombre: String(nombre || '').trim().slice(0, 80) || `Escenario ${list.length + 1}`,
    inicio: inicio || null,
    mesesHistoria: Number(mesesHistoria) || DEFAULT_HISTORIA,
    supuestos: normalizeSupuestos(supuestos),
    usuario: usuario || null,
  };
  const existing = id ? list.find((e) => e.id === id) : null;
  if (existing) {
    Object.assign(existing, clean, { actualizado: now });
    writeEscenarios(list);
    return existing;
  }
  const nuevo = { id: crypto.randomBytes(6).toString('hex'), creado: now, actualizado: now, ...clean };
  list.push(nuevo);
  writeEscenarios(list);
  return nuevo;
}

function deleteEscenario(id) {
  const list = readEscenarios();
  const next = list.filter((e) => e.id !== id);
  if (next.length === list.length) return false;
  writeEscenarios(next);
  return true;
}

module.exports = {
  getPresupuesto12m,
  buildXlsx,
  listEscenarios,
  getEscenario,
  saveEscenario,
  deleteEscenario,
  normalizeSupuestos,
  proyectarSerie,
  SEGMENTOS,
  PNL_LINES,
};
