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
const { getPlantillaMetas } = require('./objetivosResultadosService');

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

  // F-1: Σ(UR×PL) ÷ Σ(UO×PL) a precio lleno guía (sin bonificación de crédito en ninguno de los lados).
  // La factura con bono no entra al numerador; ese efecto se reporta en F-2.
  let metaVenta = null;
  let fuenteObjetivo = null;
  let unidadesObjetivo = Number(iemc?.objetivo?.unidades || 0) || null;
  let plPromedioUsado = null;
  let ventaAPl = Number(iemc?.real?.ventaAPl || 0) || 0;

  if (Number(iemc?.objetivo?.ventaNeta || 0) > 0 && ventaAPl >= 0 && Number(iemc?.objetivo?.lineasConMonto || 0) > 0) {
    metaVenta = Number(iemc.objetivo.ventaNeta);
    fuenteObjetivo = 'mix_uo_pl_guia';
  } else if (cloudMetas?.objetivoVentaEconomica != null && Number(cloudMetas.objetivoVentaEconomica) > 0) {
    metaVenta = Number(cloudMetas.objetivoVentaEconomica);
    fuenteObjetivo = 'railway';
    ventaAPl = Number(iemc?.real?.ventaNeta || 0);
  } else {
    const plantilla = getPlantillaMetas({ fechaInicio, fechaFin });
    const sumLineas = (plantilla.lineasProducto || []).reduce(
      (s, l) => s + (Number(l.facturas || l.entregas || 0) || 0),
      0
    );
    const metaUnidades = Number(plantilla.facturasAFacturar)
      || sumLineas
      || Number(plantilla.volumenReferencia)
      || null;
    const plPromedio = Number(iemc?.dms?.plPromedio || 0) || null;
    if (metaUnidades != null && metaUnidades > 0 && plPromedio != null && plPromedio > 0) {
      metaVenta = round2(metaUnidades * plPromedio);
      fuenteObjetivo = 'unidades_x_pl_promedio';
      unidadesObjetivo = metaUnidades;
      plPromedioUsado = plPromedio;
      if (!(ventaAPl > 0) && unidades > 0) {
        ventaAPl = round2(unidades * plPromedio);
      }
    }
  }

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

  const ventaFacturada = Number(iemc?.real?.ventaNeta || 0);
  const f1 = pct(ventaAPl, metaVenta);
  const f2 = iemc?.iemcPct ?? null;
  const f21 = iemc?.brecha ?? null;
  const efectoBonificacion = iemc?.real?.efectoBonificacion ?? null;
  const realizacionPrecioPct = iemc?.real?.realizacionPrecioPct ?? null;

  const topMovLineas = (iemc?.mix || [])
    .filter((r) => Number(r.ventaObjetivo || 0) > 0)
    .sort((a, b) => Number(b.ventaObjetivo || 0) - Number(a.ventaObjetivo || 0))
    .slice(0, 8)
    .map((r) => ({
      linea: r.linea,
      uo: r.uo,
      ur: r.unidadesReales,
      pl: r.pl,
      ventaObjetivo: r.ventaObjetivo,
      ventaAPlReal: r.ventaAPlReal,
    }));

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

  const f1Nota = metaVenta == null
    ? 'Sin objetivo económico: importa mix PDF (UO×PL guía) o captura meta en Railway.'
    : (fuenteObjetivo === 'mix_uo_pl_guia'
      ? 'F-1 a precio lleno: Σ(UR×PL) ÷ Σ(UO×PL). La bonificación de la factura no entra; se reporta en F-2.'
      : (fuenteObjetivo === 'unidades_x_pl_promedio'
        ? 'MOV estimado: unidades objetivo × precio lista promedio (sin mix línea a línea).'
        : (Number(iemc?.objetivo?.lineasSinPl || 0) > 0
          ? `${iemc.objetivo.lineasSinPl} línea(s) con UO sin precio de lista; no entran al MOV.`
          : null)));

  const f2NotaParts = [];
  if (!iemc?.mixDisponible) f2NotaParts.push('Sin mix objetivo del PDF para el periodo.');
  if (efectoBonificacion != null) {
    f2NotaParts.push(
      efectoBonificacion < 0
        ? `Efecto bonificación/precio vs PL lleno: ${efectoBonificacion.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 })} (factura debajo del PL; no castiga F-1).`
        : `Efecto precio vs PL lleno: ${efectoBonificacion.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 })}.`
    );
  }

  const kpis = [
    kpiBase({
      clave: 'F-1',
      nombre: 'Cumplimiento del Objetivo Económico de Venta',
      descripcion: 'Volumen económico a precio lleno: Σ(UR×PL) vs Σ(UO×PL) del mix. Sin bonificación de crédito.',
      valor: f1,
      unidad: '%',
      display: f1 == null ? '—' : `${f1}%`,
      meta: metaVenta,
      status: f1 != null ? 'completo' : 'pendiente_meta',
      tone: toneFromPct(f1, { good: 100, warn: 90 }),
      formula: 'Σ(UR × PL lleno) ÷ Σ(UO × PL lleno) × 100',
      numerador: ventaAPl,
      denominador: metaVenta,
      detalle: {
        ventaAPl: ventaAPl,
        ventaFacturada: ventaFacturada,
        objetivoEconomico: metaVenta,
        unidadesObjetivo: unidadesObjetivo,
        unidadesReales: iemc?.real?.unidades ?? unidades,
        plPromedio: plPromedioUsado ?? iemc?.dms?.plPromedio ?? null,
        fuenteObjetivo: fuenteObjetivo,
        lineasConMonto: iemc?.objetivo?.lineasConMonto ?? null,
        lineasSinPl: iemc?.objetivo?.lineasSinPl ?? null,
        topLineasMov: topMovLineas,
      },
      nota: f1Nota,
    }),
    kpiBase({
      clave: 'F-2',
      nombre: 'Eficiencia del Mix Comercial (IEMC)',
      descripcion: 'Margen bruto real ÷ margen bruto del mix objetivo. Incluye el efecto de bonificación vs precio lleno.',
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
        ventaFacturada: ventaFacturada,
        ventaAPlSinIva: iemc?.real?.ventaAPlSinIva ?? null,
        efectoBonificacion: efectoBonificacion,
        realizacionPrecioPct: realizacionPrecioPct,
        bonificacionDms: iemc?.real?.bonificacion ?? null,
      },
      nota: f2NotaParts.length ? f2NotaParts.join(' ') : null,
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
      status: f3 != null ? 'completo' : 'parcial',
      tone: toneFromPct(f3, { invert: true, good: 25, warn: 35 }),
      formula: 'Gasto operativo ÷ Ventas autos nuevos × 100',
      numerador: gastoCtrlReal,
      denominador: ventaAutos,
      detalle: {
        gastoOperativo: gastoCtrlReal,
        ventasAutos: ventaAutos,
        proxy: cloudMetas?.gastoOperativoControlablePpto != null
          ? 'meta_railway'
          : (pptoGastosOp != null ? 'presupuesto_2026' : '0700_total'),
      },
      nota: cloudMetas?.gastoOperativoControlablePpto != null
        ? null
        : (pptoGastosOp != null
          ? 'Gasto operativo Contpaq 0700; meta de F-3.1 desde presupuesto 2026.'
          : 'Gasto operativo = 0700 Contpaq (total del periodo).'),
    }),
    kpiBase({
      clave: 'F-3.1',
      nombre: 'Brecha Económica del Gasto Operativo',
      descripcion: 'Gasto real − gasto presupuestado / meta.',
      valor: f31,
      unidad: 'MXN',
      display: f31 == null ? '—' : null,
      meta: metaGastoCtrl,
      status: f31 != null ? 'completo' : 'parcial',
      tone: f31 == null ? 'slate' : (f31 <= 0 ? 'green' : 'rose'),
      formula: 'Gasto real − Gasto presupuestado',
      numerador: gastoCtrlReal,
      denominador: metaGastoCtrl,
      detalle: {
        gastoReal: gastoCtrlReal,
        gastoPresupuesto: metaGastoCtrl,
        fuenteMeta: cloudMetas?.gastoOperativoControlablePpto != null
          ? 'railway'
          : (pptoGastosOp != null ? 'presupuesto_2026' : null),
      },
      nota: f31 != null
        ? null
        : 'Sin meta de gasto (Railway o presupuesto 2026) para calcular la brecha.',
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
      status: f6 != null ? 'completo' : 'parcial',
      tone: f6 == null ? 'slate' : (f6 >= 0 ? 'green' : 'rose'),
      formula: '(UOC actual − UOC comparable) ÷ |UOC comparable| × 100',
      detalle: {
        utilidadOperacion: uocActual,
        crecimientoEbitPct: f6,
        proxy: 'utilidad_operacion_eeff',
      },
      nota: f6 != null
        ? 'Crecimiento según utilidad de operación / EBIT del EEFF del periodo.'
        : 'Sin comparable EEFF para calcular el crecimiento en este corte.',
    }),
    kpiBase({
      clave: 'F-7',
      nombre: 'Carga Estructural Asignada a Ventas Nuevos',
      descripcion: 'Proporción de la capacidad operativa absorbida por estructura (admin).',
      valor: f7,
      unidad: '%',
      display: f7 == null ? '—' : `${f7}%`,
      status: f7 != null ? 'completo' : 'parcial',
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
      nota: 'Admin Contpaq (grupos 740/750). Capacidad = utilidad bruta − gasto operativo.',
    }),
    kpiBase({
      clave: 'F-7.1',
      nombre: 'Brecha Económica de Carga Estructural',
      descripcion: 'Carga estructural real − presupuestada.',
      valor: f71,
      unidad: 'MXN',
      display: f71 == null ? '—' : null,
      meta: metaCarga,
      status: f71 != null ? 'completo' : 'parcial',
      tone: f71 == null ? 'slate' : (f71 <= 0 ? 'green' : 'rose'),
      formula: 'Carga estructural real − Carga presupuestada',
      numerador: gastosAdmin,
      denominador: metaCarga,
      detalle: {
        cargaReal: gastosAdmin,
        cargaPresupuesto: metaCarga,
        fuenteMeta: cloudMetas?.cargaEstructuralPpto != null
          ? 'railway'
          : (pptoAdmin != null ? 'presupuesto_2026' : null),
      },
      nota: f71 != null
        ? null
        : 'Sin meta de admin (Railway o presupuesto 2026) para calcular la brecha.',
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
      ventaNetaReal: ventaFacturada,
      ventaAPl,
      objetivoEconomico: metaVenta,
      unidadesObjetivo,
      fuenteObjetivo,
      efectoBonificacion,
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
