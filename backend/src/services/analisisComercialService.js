/**
 * Análisis comercial CMI · Ventas Autos Nuevos (C-1 … C-12.1)
 * Fuente metodológica: Manual CMI v3 (Google Docs).
 * Reutiliza objetivos-resultados + inventario; marca pendiente cuando falta dato/meta.
 */

const {
  getVolumenResultados,
  getLineasResultados,
  getFinanciamientoResultados,
  getSeminuevosResultados,
  getPlantillaMetas,
} = require('./objetivosResultadosService');
const { getVentas } = require('./ventas');
const { getInventory } = require('./inventoryService');

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

function kpiBase(opts) {
  const {
    clave, nombre, descripcion, valor = null, unidad = null, display = null,
    meta = null, status = 'parcial', tone = 'slate', formula = null,
    numerador = null, denominador = null, detalle = null, nota = null, disponible = true,
  } = opts;
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

/**
 * @param {{ fechaInicio: string, fechaFin: string }} opts
 */
async function getAnalisisComercial({ fechaInicio, fechaFin } = {}) {
  if (!fechaInicio || !fechaFin) {
    throw Object.assign(new Error('Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).'), { status: 400 });
  }

  const ventas = await getVentas({ fechaInicio, fechaFin });
  const tomasFromVentas = {
    total: ventas?.resumen?.totalTomasACuenta ?? ventas?.tomasACuenta?.total ?? null,
    montoTotal: ventas?.resumen?.montoTomasACuenta ?? ventas?.tomasACuenta?.montoTotal ?? null,
    montoAdquisicion: ventas?.resumen?.montoAdquisicionTomas ?? ventas?.tomasACuenta?.montoAdquisicion ?? null,
    totalVendidosMismoMes: ventas?.resumen?.totalTomasVendidasMismoMes ?? ventas?.tomasACuenta?.totalVendidosMismoMes ?? null,
    pctVendidosMismoMes: ventas?.resumen?.pctTomasVendidasMismoMes ?? ventas?.tomasACuenta?.pctVendidosMismoMes ?? null,
    error: ventas?.tomasACuenta?.error || null,
  };

  const [volumen, lineas, financiamiento, seminuevos, inventory] = await Promise.all([
    getVolumenResultados({ fechaInicio, fechaFin, ventas }),
    getLineasResultados({ fechaInicio, fechaFin, ventas }),
    getFinanciamientoResultados({ fechaInicio, fechaFin }),
    getSeminuevosResultados({ fechaInicio, fechaFin, tomas: tomasFromVentas, skipExtras: true }),
    getInventory({ planPisoPeriod: 'all' }).catch(() => null),
  ]);

  const metas = getPlantillaMetas({ fechaInicio, fechaFin });
  const vol = volumen.resultados || {};
  const fi = financiamiento.resultados || {};
  const sn = seminuevos.resultados || {};
  const mixRows = lineas.resultados?.vsMetaPlantilla || [];
  const invSummary = inventory?.summary || {};
  const ageing = Number(invSummary.ageingAlertsCount || 0);
  const available = Number(invSummary.available || 0);
  const ageingPct = pct(ageing, available);

  const entregas = vol.volumen?.real ?? null;
  const metaEntregas = vol.volumen?.meta ?? null;
  const c1 = pct(entregas, metaEntregas);
  const c1_1 = (entregas != null && metaEntregas != null)
    ? round1(Number(entregas) - Number(metaEntregas))
    : null;

  const lineasConMeta = mixRows.filter((r) => Number(r.entregas || 0) > 0);
  const lineasCumplidas = lineasConMeta.filter((r) => {
    const meta = Number(r.entregas || 0);
    const real = Number(r.entregasReal || 0);
    return meta > 0 && real >= meta;
  }).length;
  const c2 = lineasConMeta.length ? pct(lineasCumplidas, lineasConMeta.length) : null;
  const brechasMix = mixRows
    .map((r) => {
      const meta = Number(r.entregas || 0);
      const real = Number(r.entregasReal || 0);
      if (!(meta > 0)) return null;
      return {
        linea: r.linea || '—',
        meta,
        real,
        brecha: round1(real - meta),
      };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.brecha) - Math.abs(a.brecha));
  const c21 = brechasMix.reduce((s, r) => s + Math.abs(Number(r.brecha) || 0), 0);

  const gmfPct = fi.gmf?.real ?? null;
  const gmfMeta = fi.gmf?.meta ?? metas.penetracionGmfPct ?? null;
  const c5 = gmfPct;
  const c5Gap = (gmfPct != null && gmfMeta != null) ? round1(Number(gmfPct) - Number(gmfMeta)) : null;

  const facturas = vol.facturacion?.real ?? null;
  const metaFacturas = vol.facturacion?.meta ?? null;
  const c9 = pct(facturas, metaFacturas);

  const tacReal = sn.seminuevos?.real ?? null;
  const tacMeta = sn.seminuevos?.meta ?? null;
  const c10 = pct(tacReal, tacMeta);
  const c101 = pct(tacReal, entregas);

  const accReal = fi.accesorios?.real ?? null;
  const accMeta = fi.accesorios?.meta ?? metas.accesoriosMonto ?? null;
  const c11 = pct(accReal, accMeta);
  const c111 = (accReal != null && entregas > 0) ? round2(Number(accReal) / Number(entregas)) : null;

  const onstarReal = fi.onstar?.real ?? null;
  const onstarMeta = fi.onstar?.meta ?? metas.onstarUnidades ?? null;
  const onstarPen = fi.onstar?.detalle?.penetracionPct ?? null;
  const c12 = pct(onstarReal, onstarMeta);
  const c121 = onstarPen;

  const fv = vol.fuerzaVentas || {};
  const prom = vol.promedioVentasEjecutivo || {};
  const ventasPorAsesor = prom.real ?? fv.detalle?.ventasPorAsesorReal ?? null;
  const metaPorAsesor = prom.meta ?? fv.detalle?.ventasPorAsesorMeta ?? metas.ventasPorAsesor ?? null;
  const c7 = pct(ventasPorAsesor, metaPorAsesor);

  const kpis = [
    kpiBase({
      clave: 'C-1',
      nombre: 'Cumplimiento del Objetivo de Entregas',
      descripcion: 'Entregas SOFIA vs objetivo de planta del periodo.',
      valor: c1,
      unidad: '%',
      display: c1 == null ? '—' : `${c1}%`,
      meta: metaEntregas,
      status: c1 != null ? 'completo' : (metaEntregas == null ? 'pendiente_meta' : 'parcial'),
      tone: toneFromPct(c1),
      formula: 'Entregas reales ÷ Objetivo entregas × 100',
      numerador: entregas,
      denominador: metaEntregas,
      detalle: { entregas, metaEntregas, fuente: vol.volumen?.fuente },
    }),
    kpiBase({
      clave: 'C-1.1',
      nombre: 'Brecha de Entregas vs Objetivo',
      descripcion: 'Unidades arriba (+) o abajo (−) del objetivo de entregas.',
      valor: c1_1,
      unidad: 'unidades',
      display: c1_1 == null ? '—' : String(c1_1),
      status: c1_1 != null ? 'completo' : 'pendiente_meta',
      tone: c1_1 == null ? 'slate' : (c1_1 >= 0 ? 'green' : 'rose'),
      formula: 'Entregas reales − Objetivo',
      detalle: { entregas, metaEntregas, brecha: c1_1 },
    }),
    kpiBase({
      clave: 'C-2',
      nombre: 'Cumplimiento del Mix Objetivo de Entregas',
      descripcion: '% de líneas con meta que ya cubrieron su objetivo de entregas.',
      valor: c2,
      unidad: '%',
      display: c2 == null ? '—' : `${c2}%`,
      status: c2 != null ? 'completo' : 'parcial',
      tone: toneFromPct(c2, { good: 80, warn: 60 }),
      formula: 'Líneas cumplidas ÷ Líneas con meta × 100',
      numerador: lineasCumplidas,
      denominador: lineasConMeta.length || null,
      detalle: {
        lineasCumplidas,
        lineasConMeta: lineasConMeta.length,
        topBrechas: brechasMix.slice(0, 8),
      },
    }),
    kpiBase({
      clave: 'C-2.1',
      nombre: 'Brecha de Entregas por Mix Objetivo',
      descripcion: 'Suma de |brechas| por línea vs mix objetivo (unidades).',
      valor: c21 || null,
      unidad: 'unidades',
      display: c21 ? String(round1(c21)) : '—',
      status: brechasMix.length ? 'completo' : 'parcial',
      tone: 'amber',
      formula: 'Σ |entregas línea − meta línea|',
      detalle: { topBrechas: brechasMix.slice(0, 12) },
    }),
    kpiBase({
      clave: 'C-3',
      nombre: 'Exposición de Inventario por Antigüedad',
      descripcion: 'Unidades disponibles con 60+ días y % sobre el stock disponible.',
      valor: ageingPct,
      unidad: '%',
      display: ageingPct == null ? '—' : `${ageingPct}%`,
      status: available > 0 ? 'completo' : 'parcial',
      tone: toneFromPct(ageingPct, { invert: true, good: 15, warn: 30 }),
      formula: 'Unidades 60+ ÷ Inventario disponible × 100',
      numerador: ageing,
      denominador: available || null,
      detalle: {
        unidades60Plus: ageing,
        disponibles: available,
        planPiso: invSummary.planPisoTotal ?? null,
        notaCatalogo: 'El manual CMI menciona umbral 90 días; el tablero operativo usa 60+ (alerta de piso).',
      },
    }),
    kpiBase({
      clave: 'C-4',
      nombre: 'Alcance Estimado del Objetivo de Market Share',
      descripcion: 'Participación vs industria estimada por planta.',
      valor: null,
      unidad: '%',
      status: 'pendiente_meta',
      tone: 'slate',
      disponible: false,
      formula: 'Entregas ÷ Industria estimada × 100',
      meta: metas.marketShareObjetivoPct ?? null,
      nota: `Sin industria estimada (${metas.industriaEstimada ?? 'n/d'}). No se inventa el denominador.`,
      detalle: { metaSharePct: metas.marketShareObjetivoPct ?? null },
    }),
    kpiBase({
      clave: 'C-5',
      nombre: 'Penetración Financiera (GMF) sobre Entregas',
      descripcion: '% de entregas financiadas con GMF vs meta de planta.',
      valor: c5,
      unidad: '%',
      display: c5 == null ? '—' : `${c5}%`,
      meta: gmfMeta,
      status: c5 != null ? 'completo' : 'parcial',
      tone: toneFromPct(c5, { good: Number(gmfMeta) || 40, warn: Math.max(20, (Number(gmfMeta) || 40) - 10) }),
      formula: 'Entregas GMF ÷ Entregas totales × 100',
      detalle: {
        ...(fi.gmf?.detalle || {}),
        brechaPp: c5Gap,
        meta: gmfMeta,
      },
    }),
    kpiBase({
      clave: 'C-6',
      nombre: 'Composición de Entregas por Tipo de Cliente',
      descripcion: 'Primera compra vs clientes recurrentes.',
      valor: null,
      status: 'parcial',
      tone: 'slate',
      disponible: false,
      formula: 'Entregas 1ª compra ÷ Entregas totales',
      nota: 'Requiere clasificar cliente nuevo vs recurrente en CRM/SOFIA; aún no cableado como KPI formal.',
    }),
    kpiBase({
      clave: 'C-6.1',
      nombre: 'Antigüedad de Origen de las Entregas',
      descripcion: 'Distribución de oportunidades que se convirtieron en entrega por rangos de maduración.',
      valor: null,
      status: 'parcial',
      tone: 'slate',
      disponible: false,
      nota: 'Pendiente de cruzar fecha de oportunidad CRM con entrega SOFIA.',
    }),
    kpiBase({
      clave: 'C-7',
      nombre: 'Cumplimiento de Productividad de la Fuerza Comercial',
      descripcion: 'Ventas promedio por asesor activo vs meta de productividad.',
      valor: c7,
      unidad: '%',
      display: c7 == null ? '—' : `${c7}%`,
      meta: metaPorAsesor,
      status: c7 != null ? 'completo' : 'parcial',
      tone: toneFromPct(c7),
      formula: 'Ventas/asesor real ÷ Meta ventas/asesor × 100',
      numerador: ventasPorAsesor,
      denominador: metaPorAsesor,
      detalle: {
        asesoresActivos: fv.real ?? null,
        metaAsesores: fv.meta ?? null,
        promedioVentas: ventasPorAsesor,
        metaVentasPorAsesor: metaPorAsesor,
        conVenta: fv.detalle?.conVenta ?? null,
        sinVenta: fv.detalle?.sinVenta ?? null,
      },
    }),
    kpiBase({
      clave: 'C-8',
      nombre: 'Erosión de la Utilidad por Concesiones',
      descripcion: 'Proporción de utilidad erosionada por concesiones comerciales.',
      valor: null,
      status: 'parcial',
      tone: 'slate',
      disponible: false,
      nota: 'Se puede aproximar con extras/notas de cierre; falta definición formal de “concesión absorbida”.',
    }),
    kpiBase({
      clave: 'C-9',
      nombre: 'Cumplimiento del Objetivo de Facturación',
      descripcion: 'Unidades facturadas DMS vs objetivo de facturación.',
      valor: c9,
      unidad: '%',
      display: c9 == null ? '—' : `${c9}%`,
      meta: metaFacturas,
      status: c9 != null ? 'completo' : 'pendiente_meta',
      tone: toneFromPct(c9),
      formula: 'Facturas DMS ÷ Objetivo facturación × 100',
      numerador: facturas,
      denominador: metaFacturas,
      detalle: vol.facturacion?.detalle || {},
    }),
    kpiBase({
      clave: 'C-10',
      nombre: 'Cumplimiento del Objetivo de Tomas a Cuenta',
      descripcion: 'TAC del periodo vs meta PDF (TAC Nuevos).',
      valor: c10,
      unidad: '%',
      display: c10 == null ? '—' : `${c10}%`,
      meta: tacMeta,
      status: c10 != null ? 'completo' : (tacMeta == null ? 'pendiente_meta' : 'parcial'),
      tone: toneFromPct(c10),
      formula: 'Tomas a cuenta ÷ Meta TAC × 100',
      numerador: tacReal,
      denominador: tacMeta,
      detalle: sn.seminuevos?.detalle || {},
    }),
    kpiBase({
      clave: 'C-10.1',
      nombre: 'Participación de TAC sobre Entregas',
      descripcion: '% de entregas que incorporaron toma a cuenta.',
      valor: c101,
      unidad: '%',
      display: c101 == null ? '—' : `${c101}%`,
      status: c101 != null ? 'completo' : 'parcial',
      tone: 'blue',
      formula: 'TAC ÷ Entregas × 100',
      numerador: tacReal,
      denominador: entregas,
    }),
    kpiBase({
      clave: 'C-11',
      nombre: 'Cumplimiento del Objetivo de Accesorios',
      descripcion: 'Monto PVA accesorios vs meta del periodo.',
      valor: c11,
      unidad: '%',
      display: c11 == null ? '—' : `${c11}%`,
      meta: accMeta,
      status: c11 != null ? 'completo' : 'parcial',
      tone: toneFromPct(c11),
      formula: 'Monto accesorios ÷ Meta accesorios × 100',
      numerador: accReal,
      denominador: accMeta,
      detalle: fi.accesorios?.detalle || {},
    }),
    kpiBase({
      clave: 'C-11.1',
      nombre: 'Venta Promedio de Accesorios por Unidad',
      descripcion: 'Monto accesorios ÷ entregas del periodo.',
      valor: c111,
      unidad: 'MXN',
      display: c111 == null ? '—' : null,
      status: c111 != null ? 'completo' : 'parcial',
      tone: 'violet',
      formula: 'Monto accesorios ÷ Entregas',
      numerador: accReal,
      denominador: entregas,
    }),
    kpiBase({
      clave: 'C-12',
      nombre: 'Cumplimiento del Objetivo OnStar',
      descripcion: 'Contratos OnStar vs meta de unidades.',
      valor: c12,
      unidad: '%',
      display: c12 == null ? '—' : `${c12}%`,
      meta: onstarMeta,
      status: c12 != null ? 'completo' : 'parcial',
      tone: toneFromPct(c12),
      formula: 'Contratos OnStar ÷ Meta OnStar × 100',
      numerador: onstarReal,
      denominador: onstarMeta,
      detalle: fi.onstar?.detalle || {},
    }),
    kpiBase({
      clave: 'C-12.1',
      nombre: 'Penetración OnStar sobre Entregas Elegibles',
      descripcion: '% de entregas con tech OnStar que tienen contrato.',
      valor: c121,
      unidad: '%',
      display: c121 == null ? '—' : `${c121}%`,
      status: c121 != null ? 'completo' : 'parcial',
      tone: toneFromPct(c121, { good: 50, warn: 30 }),
      formula: 'Con contrato OnStar ÷ Elegibles × 100',
      detalle: {
        penetracionPct: c121,
        elegibles: fi.onstar?.detalle?.elegibles ?? null,
        sinContrato: fi.onstar?.detalle?.sinContrato ?? null,
      },
    }),
  ];

  const completos = kpis.filter((k) => k.status === 'completo').length;
  const parciales = kpis.filter((k) => k.status === 'parcial' || k.status === 'pendiente_meta').length;

  return {
    fuente: 'Manual CMI v3 · objetivos-resultados + inventario',
    alcance: 'Ventas autos nuevos · Comercial C-1…C-12.1',
    periodo: { fechaInicio, fechaFin },
    resumen: {
      total: kpis.length,
      completos,
      parciales,
      noDisponibles: kpis.filter((k) => k.disponible === false).length,
    },
    kpis,
  };
}

module.exports = {
  getAnalisisComercial,
};
