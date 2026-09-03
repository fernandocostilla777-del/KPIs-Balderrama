/**
 * Análisis financiero IEMC · Ventas Nuevos (F-1 … F-7.1)
 * Ficha Contabilidad — calcula con DMS/contabilidad; metas opcionales (mix / ppto / Railway).
 */

const { getVendidosAnalisis } = require('./inventoryService');
const { computeIemcF2 } = require('./iemcF2Service');
const { getCatalogKpis } = require('./accountingCatalogKpiService');
const { getEeffSummary } = require('./eeffSummaryService');
const { getInventory } = require('./inventoryService');
const { getBudgetForPeriod } = require('./budget2026Service');

function round1(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.round(x * 10) / 10;
}

function round2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.round(x * 100) / 100;
}

function pct(num, den) {
  const n = Number(num);
  const d = Number(den);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return round1((n / d) * 100);
}

function kpiBase({
  clave,
  nombre,
  descripcion,
  valor = null,
  unidad = null,
  display = null,
  meta = null,
  status = 'parcial',
  tone = 'slate',
  formula = null,
  numerador = null,
  denominador = null,
  detalle = null,
  nota = null,
  disponible = true,
}) {
  return {
    clave,
    nombre,
    descripcion,
    valor,
    unidad,
    display: display ?? (valor == null ? '—' : String(valor)),
    meta,
    status,
    tone,
    formula,
    numerador,
    denominador,
    detalle,
    nota,
    disponible,
  };
}

function toneFromPct(pctVal, { invert = false, good = 100, warn = 90 } = {}) {
  if (pctVal == null) return 'slate';
  if (invert) {
    if (pctVal <= good) return 'green';
    if (pctVal <= warn) return 'amber';
    return 'rose';
  }
  if (pctVal >= good) return 'green';
  if (pctVal >= warn) return 'amber';
  return 'rose';
}

async function tryFetchCloudMetas(periodKey) {
  const base = String(process.env.CLOUD_SYNC_URL || '').replace(/\/$/, '');
  const key = String(process.env.CLOUD_SYNC_API_KEY || '').trim();
  if (!base || !key || !periodKey) return null;
  try {
    const res = await fetch(`${base}/api/iemc-financiero/periodos/${periodKey}`, {
      headers: { 'X-API-Key': key },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.periodo || null;
  } catch {
    return null;
  }
}

async function getAnalisisFinanciero({ fechaInicio, fechaFin } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaInicio || '')
    || !/^\d{4}-\d{2}-\d{2}$/.test(fechaFin || '')) {
    const err = new Error('fechaInicio y fechaFin son requeridos (YYYY-MM-DD)');
    err.status = 400;
    throw err;
  }

  const periodKey = String(fechaInicio).slice(0, 7);
  const planPisoPeriod = periodKey;

  const [vendidos, catalog, catalogFi, eeff, inventory, budget, cloudMetas] = await Promise.all([
    getVendidosAnalisis({ fechaInicio, fechaFin }),
    getCatalogKpis({
      fechaInicio,
      fechaFin,
      sucursal: 'todos',
      area: 'autosNuevos',
      includeFi: false,
    }),
    getCatalogKpis({
      fechaInicio,
      fechaFin,
      sucursal: 'todos',
      area: 'todos',
      includeFi: true,
    }),
    getEeffSummary({ fechaInicio, fechaFin }),
    getInventory({ planPisoPeriod }),
    Promise.resolve().then(() => {
      try {
        return getBudgetForPeriod({ fechaInicio, fechaFin });
      } catch {
        return { available: false };
      }
    }),
    tryFetchCloudMetas(periodKey),
  ]);

  const iemc = await computeIemcF2({
    fechaInicio,
    fechaFin,
    vendidosTable: vendidos.vendidosTable || [],
  });

  const ventaAutos = Number(catalog.summary?.ventasTotales || catalog.summary?.ventasNetas || 0);
  const gastosOp = Number(catalog.summary?.gastosOperacion || 0);
  const utilidadOp = Number(catalog.summary?.utilidadOperacion || 0);
  const utilidadBruta = Number(catalog.summary?.utilidadBruta || 0);
  const gastoDepto = Number(catalog.summary?.gastoDepartamento || 0);

  const edo = eeff?.estadoFinanciero?.summary || {};
  const gastosAdmin = Number(edo.gastosAdministracion || 0);

  const fiLine = (catalogFi.incomeLines || []).find((l) => l.key === 'financiamiento');
  const ingresoFi = round2(Number(fiLine?.value || 0));
  const ventasConFi = Number(catalogFi.summary?.ventasTotales || 0);

  const unidades = Number(vendidos.summary?.unidades || vendidos.vendidosTable?.length || 0);
  const planPiso = Number(inventory?.summary?.planPisoTotal || 0);

  const ppto = budget?.available ? budget.estadoFinanciero?.summary : null;
  const pptoGastosOp = ppto ? Number(ppto.gastosOperacion || 0) : null;
  const pptoAdmin = ppto ? Number(ppto.gastosAdministracion || 0) : null;

  const metaVenta = cloudMetas?.objetivoVentaEconomica != null
    ? Number(cloudMetas.objetivoVentaEconomica)
    : (iemc?.objetivo?.ventaNeta || null);
  const metaGastoCtrl = cloudMetas?.gastoOperativoControlablePpto != null
    ? Number(cloudMetas.gastoOperativoControlablePpto)
    : pptoGastosOp;
  const metaPvr = cloudMetas?.pvrFiObjetivo != null ? Number(cloudMetas.pvrFiObjetivo) : null;
  const metaCarga = cloudMetas?.cargaEstructuralPpto != null
    ? Number(cloudMetas.cargaEstructuralPpto)
    : pptoAdmin;
  const metaCobertura = cloudMetas?.coberturaFiPlanPisoObjetivoPct != null
    ? Number(cloudMetas.coberturaFiPlanPisoObjetivoPct)
    : 100;

  const ventaReal = Number(iemc?.real?.ventaNeta || 0);
  const f1 = pct(ventaReal, metaVenta);
  const f2 = iemc?.iemcPct ?? null;
  const f21 = iemc?.brecha ?? null;

  const gastoCtrlReal = cloudMetas?.gastoOperativoControlablePpto != null
    ? gastoDepto || gastosOp
    : gastosOp;
  const f3 = pct(gastoCtrlReal, ventaAutos);
  const f31 = metaGastoCtrl != null ? round2(gastoCtrlReal - metaGastoCtrl) : null;

  const ingresosBaseFi = ventasConFi > 0 ? ventasConFi : (ventaAutos + (ingresoFi || 0));
  const f4 = pct(ingresoFi, ingresosBaseFi);
  const f41 = unidades > 0 ? round2(ingresoFi / unidades) : null;

  const f5 = planPiso > 0 ? pct(ingresoFi, planPiso) : null;

  const crecEbit = eeff?.ebitMetrics?.crecimientoEbitPct
    ?? eeff?.estadoFinanciero?.summary?.crecimientoEbitPct
    ?? null;
  const uocActual = utilidadOp;
  const f6 = crecEbit;

  const capacidad = utilidadBruta - gastoCtrlReal;
  const f7 = pct(gastosAdmin, capacidad > 0 ? capacidad : utilidadBruta);
  const f71 = metaCarga != null ? round2(gastosAdmin - metaCarga) : null;

  const kpis = [
    kpiBase({
      clave: 'F-1',
      nombre: 'Cumplimiento del Objetivo Económico de Venta',
      descripcion: 'Monto económico de venta real vs objetivo (mix UO×PL o meta Railway).',
      valor: f1,
      unidad: '%',
      display: f1 == null ? '—' : `${f1}%`,
      meta: metaVenta,
      status: f1 != null ? 'completo' : 'pendiente_meta',
      tone: toneFromPct(f1, { good: 100, warn: 90 }),
      formula: 'Venta neta real ÷ Objetivo económico × 100',
      numerador: ventaReal,
      denominador: metaVenta,
      detalle: {
        ventaNetaReal: ventaReal,
        objetivoEconomico: metaVenta,
        unidadesReales: iemc?.real?.unidades ?? unidades,
        fuenteObjetivo: cloudMetas?.objetivoVentaEconomica != null ? 'railway' : 'mix_uo_pl',
      },
      nota: metaVenta == null
        ? 'Sin objetivo económico: importa mix PDF o captura meta en Railway (iemc_financiero_periodos).'
        : null,
    }),
    kpiBase({
      clave: 'F-2',
      nombre: 'Eficiencia del Mix Comercial (IEMC)',
      descripcion: 'Margen bruto real ÷ margen bruto del mix objetivo.',
      valor: f2,
      unidad: '%',
      display: f2 == null ? '—' : `${f2}%`,
      status: f2 != null ? 'completo' : 'parcial',
      tone: toneFromPct(f2, { good: 100, warn: 90 }),
      formula: 'Margen bruto real ÷ Margen bruto objetivo mix × 100',
      detalle: {
        margenBrutoReal: iemc?.real?.margenBrutoPct ?? null,
        margenBrutoObjetivo: iemc?.objetivo?.margenBrutoPct ?? null,
        ubaReal: iemc?.real?.uba ?? null,
        ubaObjetivo: iemc?.objetivo?.uba ?? null,
      },
      nota: iemc?.mixDisponible ? null : 'Sin mix objetivo del PDF para el periodo.',
    }),
    kpiBase({
      clave: 'F-2.1',
      nombre: 'Brecha Económica del Margen',
      descripcion: 'Utilidad bruta real − utilidad bruta del mix objetivo.',
      valor: f21,
      unidad: 'MXN',
      display: f21 == null ? '—' : null,
      status: f21 != null ? 'completo' : 'parcial',
      tone: f21 == null ? 'slate' : (f21 >= 0 ? 'green' : 'rose'),
      formula: 'UBA real − UBA objetivo mix',
      detalle: {
        ubaReal: iemc?.real?.uba ?? null,
        ubaObjetivo: iemc?.objetivo?.uba ?? null,
      },
    }),
    kpiBase({
      clave: 'F-3',
      nombre: 'Eficiencia del Gasto Operativo Controlable',
      descripcion: 'Proporción de ingresos de vehículos consumida por gasto operativo.',
      valor: f3,
      unidad: '%',
      display: f3 == null ? '—' : `${f3}%`,
      meta: metaGastoCtrl != null && ventaAutos > 0 ? pct(metaGastoCtrl, ventaAutos) : null,
      status: cloudMetas ? 'completo' : 'parcial',
      tone: toneFromPct(f3, { invert: true, good: 25, warn: 35 }),
      formula: 'Gasto operativo ÷ Ventas autos nuevos × 100',
      numerador: gastoCtrlReal,
      denominador: ventaAutos,
      detalle: {
        gastoOperativo: gastoCtrlReal,
        ventasAutos: ventaAutos,
        proxy: cloudMetas ? 'meta_railway' : '0700_total',
      },
      nota: cloudMetas
        ? null
        : 'Sin clasificación controlable en Railway: se usa 0700 total como proxy.',
    }),
    kpiBase({
      clave: 'F-3.1',
      nombre: 'Brecha Económica del Gasto Operativo',
      descripcion: 'Gasto real − gasto presupuestado / meta.',
      valor: f31,
      unidad: 'MXN',
      display: f31 == null ? '—' : null,
      status: f31 != null ? 'completo' : 'pendiente_meta',
      tone: f31 == null ? 'slate' : (f31 <= 0 ? 'green' : 'rose'),
      formula: 'Gasto real − Gasto presupuestado',
      detalle: {
        gastoReal: gastoCtrlReal,
        gastoPresupuesto: metaGastoCtrl,
        fuenteMeta: cloudMetas?.gastoOperativoControlablePpto != null ? 'railway' : (ppto ? 'presupuesto_2026' : null),
      },
    }),
    kpiBase({
      clave: 'F-4',
      nombre: 'Aportación de Ingresos F&I',
      descripcion: 'Peso de ingresos F&I (0800) dentro de los ingresos totales.',
      valor: f4,
      unidad: '%',
      display: f4 == null ? '—' : `${f4}%`,
      status: ingresoFi > 0 ? 'completo' : 'parcial',
      tone: toneFromPct(f4, { good: 3, warn: 1.5 }),
      formula: 'Ingresos F&I ÷ Ingresos totales × 100',
      numerador: ingresoFi,
      denominador: ingresosBaseFi,
      detalle: { ingresoFi, ingresosTotales: ingresosBaseFi },
    }),
    kpiBase({
      clave: 'F-4.1',
      nombre: 'Ingreso F&I Promedio por Unidad (PVR)',
      descripcion: 'Ingreso F&I por cada vehículo vendido.',
      valor: f41,
      unidad: 'MXN',
      display: f41 == null ? '—' : null,
      meta: metaPvr,
      status: f41 != null ? 'completo' : 'parcial',
      tone: metaPvr != null && f41 != null
        ? toneFromPct(pct(f41, metaPvr), { good: 100, warn: 90 })
        : (f41 != null ? 'blue' : 'slate'),
      formula: 'Ingresos F&I ÷ Unidades vendidas',
      numerador: ingresoFi,
      denominador: unidades,
      detalle: { ingresoFi, unidades, metaPvr },
    }),
    kpiBase({
      clave: 'F-5',
      nombre: 'Ratio de Cobertura F&I / Plan Piso',
      descripcion: 'Si los ingresos F&I cubren el costo financiero del inventario.',
      valor: f5,
      unidad: '%',
      display: f5 == null ? '—' : `${f5}%`,
      meta: metaCobertura,
      status: f5 != null ? 'completo' : 'parcial',
      tone: toneFromPct(f5, { good: metaCobertura || 100, warn: 70 }),
      formula: 'Ingresos F&I ÷ Intereses plan piso × 100',
      numerador: ingresoFi,
      denominador: planPiso,
      detalle: {
        ingresoFi,
        planPiso,
        planPisoPeriod: inventory?.summary?.planPisoPeriodLabel || planPisoPeriod,
        unidadesPlanPiso: inventory?.summary?.planPisoUnits ?? null,
      },
      nota: planPiso <= 0 ? 'Sin intereses de plan piso en el corte del periodo.' : null,
    }),
    kpiBase({
      clave: 'F-6',
      nombre: 'Crecimiento de la Utilidad Operativa Controlable',
      descripcion: 'Variación de la utilidad de operación vs periodo comparable.',
      valor: f6,
      unidad: '%',
      display: f6 == null ? '—' : `${f6}%`,
      status: f6 != null ? 'parcial' : 'parcial',
      tone: f6 == null ? 'slate' : (f6 >= 0 ? 'green' : 'rose'),
      formula: '(UOC actual − UOC comparable) ÷ |UOC comparable| × 100',
      detalle: {
        utilidadOperacion: uocActual,
        crecimientoEbitPct: f6,
        proxy: 'utilidad_operacion_eeff',
      },
      nota: 'Proxy con utilidad de operación / EBIT hasta clasificar gasto controlable.',
    }),
    kpiBase({
      clave: 'F-7',
      nombre: 'Carga Estructural Asignada a Ventas Nuevos',
      descripcion: 'Proporción de la capacidad operativa absorbida por estructura (admin).',
      valor: f7,
      unidad: '%',
      display: f7 == null ? '—' : `${f7}%`,
      status: f7 != null ? 'parcial' : 'parcial',
      tone: toneFromPct(f7, { invert: true, good: 20, warn: 35 }),
      formula: 'Gastos administración ÷ (Utilidad bruta − gasto operativo) × 100',
      numerador: gastosAdmin,
      denominador: capacidad > 0 ? capacidad : utilidadBruta,
      detalle: {
        gastosAdministracion: gastosAdmin,
        utilidadBruta,
        gastoOperativo: gastoCtrlReal,
        capacidadOperativa: capacidad,
      },
    }),
    kpiBase({
      clave: 'F-7.1',
      nombre: 'Brecha Económica de Carga Estructural',
      descripcion: 'Carga estructural real − presupuestada.',
      valor: f71,
      unidad: 'MXN',
      display: f71 == null ? '—' : null,
      status: f71 != null ? 'completo' : 'pendiente_meta',
      tone: f71 == null ? 'slate' : (f71 <= 0 ? 'green' : 'rose'),
      formula: 'Carga estructural real − Carga presupuestada',
      detalle: {
        cargaReal: gastosAdmin,
        cargaPresupuesto: metaCarga,
        fuenteMeta: cloudMetas?.cargaEstructuralPpto != null ? 'railway' : (ppto ? 'presupuesto_2026' : null),
      },
    }),
  ];

  // Format money displays
  for (const k of kpis) {
    if (k.unidad === 'MXN' && k.valor != null && k.display == null) {
      k.display = k.valor;
      k.displayIsMoney = true;
    }
  }

  return {
    periodo: { fechaInicio, fechaFin, periodKey },
    generadoEn: new Date().toISOString(),
    alcance: 'Ventas nuevos · IEMC financiero F-1…F-7.1',
    fuentes: {
      iemc: Boolean(iemc?.mixDisponible),
      contabilidad: true,
      presupuesto2026: Boolean(budget?.available),
      railwayMetas: Boolean(cloudMetas),
      planPiso: planPiso > 0,
    },
    resumen: {
      ventaNetaReal: ventaReal,
      ingresoFi,
      unidades,
      planPiso,
      utilidadOperacion: uocActual,
    },
    kpis,
    iemcResumen: iemc
      ? {
          iemcPct: iemc.iemcPct,
          brecha: iemc.brecha,
          mixDisponible: iemc.mixDisponible,
          plantilla: iemc.plantilla,
        }
      : null,
  };
}

module.exports = { getAnalisisFinanciero };
