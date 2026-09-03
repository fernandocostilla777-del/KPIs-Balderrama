const { query } = require('../db');
const { loadVentasNuevosFinancial } = require('./ventasNuevosFinanciero');
const { loadSalesExecutiveAnalytics } = require('./salesExecutiveAnalytics');
const { getVentas } = require('./ventas');
const { getInventory, getVendidosAnalisis } = require('./inventoryService');
const { computeIemcF2 } = require('./iemcF2Service');
const { getPuntoEquilibrio } = require('./breakEvenService');

function buildSerDateClause(fechaInicio, fechaFin) {
  if (!fechaInicio || !fechaFin) return { clause: '', params: {} };
  return {
    clause: `AND CONVERT(DATE, o.ORE_FECHAORD, 103) >= @fechaInicio AND CONVERT(DATE, o.ORE_FECHAORD, 103) <= @fechaFin`,
    params: { fechaInicio, fechaFin },
  };
}

function classifyServiceBucket(clasific) {
  const c = String(clasific || '').trim().toUpperCase();
  if (c === 'RE') return 'refacciones';
  if (c.startsWith('MO')) return 'manoObra';
  return 'otros';
}

function pct(part, total) {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

async function loadServiceFinancial({ fechaInicio, fechaFin }) {
  const { clause, params } = buildSerDateClause(fechaInicio, fechaFin);

  const [orders] = await query(`
    SELECT
      COUNT(*) AS ingresadas,
      SUM(CASE WHEN o.ORE_STATUS = 'I' THEN 1 ELSE 0 END) AS facturadas
    FROM SER_ORDEN o
    WHERE o.ORE_FECHAORD IS NOT NULL
      AND LTRIM(RTRIM(o.ORE_FECHAORD)) <> ''
      ${clause}
  `, params);

  const detailRows = await query(`
    SELECT
      ISNULL(LTRIM(RTRIM(d.ORD_CLASIFIC)), '') AS clasific,
      SUM(ISNULL(d.ORD_SUBTOTAL, 0)) AS subtotal,
      SUM(ISNULL(d.ORD_IVATOT, 0)) AS iva
    FROM SER_ORDEN o
    INNER JOIN SER_ORDENDET d ON d.ORD_IDORDEN = o.ORE_IDORDEN
    WHERE o.ORE_STATUS = 'I'
      AND o.ORE_FECHAORD IS NOT NULL
      AND LTRIM(RTRIM(o.ORE_FECHAORD)) <> ''
      ${clause}
    GROUP BY d.ORD_CLASIFIC
  `, params);

  const buckets = { manoObra: 0, refacciones: 0, otros: 0 };
  for (const row of detailRows) {
    const amount = Number(row.subtotal || 0) + Number(row.iva || 0);
    buckets[classifyServiceBucket(row.clasific)] += amount;
  }

  const importeFacturado = buckets.manoObra + buckets.refacciones + buckets.otros;
  const facturadas = Number(orders.facturadas || 0);

  return {
    ingresadas: Number(orders.ingresadas || 0),
    facturadas,
    importeFacturado,
    manoObra: buckets.manoObra,
    refacciones: buckets.refacciones,
    otros: buckets.otros,
    pctFacturado: pct(facturadas, Number(orders.ingresadas || 0)),
    ticketFacturado: facturadas ? importeFacturado / facturadas : 0,
  };
}

async function getOverview({ fechaInicio, fechaFin } = {}) {
  const [
    ventasLive,
    [invBi],
    service,
    inventoryByModel,
    salesAnalytics,
    ventasOps,
    inventoryOps,
    puntoEquilibrio,
  ] = await Promise.all([
    loadVentasNuevosFinancial({ fechaInicio, fechaFin }),
    query(`
      SELECT
        ISNULL(COUNT(*), 0) AS totalUnits,
        ISNULL(SUM(CASE WHEN Vendida = 0 AND Existencia = 1 THEN 1 ELSE 0 END), 0) AS availableUnits,
        ISNULL(SUM(CASE WHEN Vendida = 0 AND Existencia = 1 THEN ISNULL(CostoCatalogo, 0) ELSE 0 END), 0) AS inventoryCost,
        ISNULL(SUM(CASE WHEN Vendida = 0 AND Existencia = 1 THEN ISNULL(ImporteVenta, 0) ELSE 0 END), 0) AS inventoryValue
      FROM BI_INVENTARIO_NUEVOS
    `).then((r) => r),
    loadServiceFinancial({ fechaInicio, fechaFin }),
    query(`
      SELECT ISNULL(Modelo, 'Sin modelo') AS model,
        ISNULL(SUM(CASE WHEN Vendida = 0 AND Existencia = 1 THEN 1 ELSE 0 END), 0) AS stock
      FROM BI_INVENTARIO_NUEVOS GROUP BY Modelo
    `),
    loadSalesExecutiveAnalytics({ fechaInicio, fechaFin }),
    getVentas({ fechaInicio, fechaFin }).catch((err) => {
      console.warn('[overview] ventas ops:', err.message);
      return null;
    }),
    getInventory({ planPisoPeriod: 'all' }).catch((err) => {
      console.warn('[overview] inventory ops:', err.message);
      return null;
    }),
    getPuntoEquilibrio({ fechaInicio, fechaFin }).catch((err) => {
      console.warn('[overview] puntoEquilibrio:', err.message);
      return null;
    }),
  ]);

  const s = ventasLive.summary;
  const stockMap = Object.fromEntries(inventoryByModel.map((r) => [r.model, r.stock]));
  const topWithStock = ventasLive.topModels.map((m) => ({
    ...m,
    brand: '',
    stock: stockMap[m.model] || 0,
    status: (stockMap[m.model] || 0) < 50 ? 'Stock bajo' : (m.unitsSold > 100 ? 'Alta demanda' : 'Estable'),
  }));

  const totalEstadoUnits = ventasLive.byEstado.reduce((sum, r) => sum + r.units, 0) || 1;
  const vr = ventasOps?.resumen || {};
  const inv = inventoryOps?.summary || {};

  const sales = {
    units: s.units,
    revenue: s.ventaSubtotal,
    revenueTotal: s.ventaTotal,
    revenueIva: s.ventaIva,
    revenueIsan: s.ventaIsan,
    utility: s.utilidad,
    cost: s.costoNeto,
    costoMiCosto: s.costoMiCosto,
    bonificacion: s.bonificacion,
    participacion: s.participacion,
    costoIva: s.costoIva,
    gastos: s.gastos,
    conCosto: s.conCosto,
    sinCosto: s.sinCosto,
    marginPct: s.marginPct,
    retailUnits: s.retailUnits ?? vr.totalRetail ?? 0,
    flotillaUnits: s.flotillaUnits ?? vr.totalFlotillas ?? 0,
    ticketPromedio: s.ticketPromedio,
  };

  const inventory = {
    totalUnits: Number(inv.totalUnits ?? invBi.totalUnits ?? 0),
    availableUnits: Number(inv.available ?? invBi.availableUnits ?? 0),
    availableLibres: Number(inv.availableLibres ?? 0),
    availableApartadas: Number(inv.availableApartadas ?? 0),
    demos: Number(inv.demos ?? 0),
    avgDaysDemo: Number(inv.avgDaysDemo ?? 0),
    demosConPruebas: Number(inv.demosConPruebas ?? 0),
    demosPruebasTotal: Number(inv.demosPruebasTotal ?? 0),
    sinPrevias: Number(inv.sinPrevias ?? 0),
    conPrevias: Number(inv.conPrevias ?? 0),
    planPisoTotal: Number(inv.planPisoTotal ?? 0),
    planPisoUnits: Number(inv.planPisoUnits ?? 0),
    ageingAlertsCount: Number(inv.ageingAlertsCount ?? inv.urgentAlerts ?? 0),
    avgDaysAvailable: Number(inv.avgDaysAvailable ?? 0),
    inventoryCost: invBi.inventoryCost,
    inventoryValue: invBi.inventoryValue || invBi.inventoryCost,
    avgDaysInventory: Number(inv.avgDaysAvailable ?? 0),
  };

  const operaciones = {
    unidadesVendidas: Number(vr.totalVentas ?? sales.units ?? 0),
    retail: Number(vr.totalRetail ?? sales.retailUnits ?? 0),
    flotillas: Number(vr.totalFlotillas ?? sales.flotillaUnits ?? 0),
    entregasSofia: Number(vr.totalNotificacionesEntrega ?? 0),
    sinTimbrar: Number(vr.totalUnidadesFacturadasNoTimbradas ?? 0),
    coberturaNumerador: Number(vr.numeradorCobertura ?? 0),
    entregasSinPrevias: Number(vr.totalEntregasSinPrevias ?? 0),
  };

  let cierre = {
    unidades: 0,
    utilidadBruta: 0,
    utilidadNeta: 0,
    ingresoFi: 0,
    conIngresoFi: 0,
    planPiso: 0,
    comisionEv: 0,
    extras: 0,
    iemcPct: null,
    brecha: null,
    margenRealPct: null,
    margenObjPct: null,
  };
  try {
    const vendidos = await getVendidosAnalisis({ fechaInicio, fechaFin });
    const iemc = await computeIemcF2({
      fechaInicio,
      fechaFin,
      vendidosTable: vendidos?.vendidosTable || [],
    });
    const vs = vendidos?.summary || {};
    cierre = {
      unidades: Number(vs.unidades || 0),
      utilidadBruta: Number(vs.utilidad || 0),
      utilidadNeta: Number(vs.utilidadNeta || 0),
      ingresoFi: Number(vs.ingresoFinanciamiento || 0),
      conIngresoFi: Number(vs.conIngresoFinanciamiento || 0),
      planPiso: Number(vs.planPiso || 0),
      comisionEv: Number(vs.comisionEv || 0),
      extras: Number(vs.extras || 0),
      iemcPct: iemc?.iemcPct == null ? null : Number(iemc.iemcPct),
      brecha: iemc?.brecha == null ? null : Number(iemc.brecha),
      margenRealPct: iemc?.real?.margenBrutoPct == null ? null : Number(iemc.real.margenBrutoPct),
      margenObjPct: iemc?.objetivo?.margenBrutoPct == null ? null : Number(iemc.objetivo.margenBrutoPct),
    };
  } catch (err) {
    console.warn('[overview] cierre/iemc:', err.message);
  }

  const consolidated = {
    ingresoTotal: sales.revenue + service.importeFacturado,
    utilidadVentas: sales.utility,
    facturacionServicio: service.importeFacturado,
    valorInventario: inventory.inventoryValue,
  };

  return {
    filtros: { fechaInicio, fechaFin },
    financial: { sales, inventory, service, consolidated },
    operaciones,
    cierre,
    salesAnalytics,
    puntoEquilibrio,
    kpis: {
      totalUnits: sales.units,
      totalRevenue: sales.revenue,
      totalUtility: sales.utility,
      marginPct: sales.marginPct,
      avgDaysInventory: inventory.avgDaysInventory,
      availableUnits: inventory.availableUnits,
      totalInventory: inventory.totalUnits,
      demos: inventory.demos,
      sinPrevias: inventory.sinPrevias,
      planPisoTotal: inventory.planPisoTotal,
      ageingAlertsCount: inventory.ageingAlertsCount,
      serviceRevenue: service.importeFacturado,
      serviceOrders: service.facturadas,
      entregasSofia: operaciones.entregasSofia,
      entregasSinPrevias: operaciones.entregasSinPrevias,
      retailUnits: operaciones.retail,
      flotillaUnits: operaciones.flotillas,
      utilidadNetaCierre: cierre.utilidadNeta,
      iemcPct: cierre.iemcPct,
      fleetEfficiency: inventory.totalUnits
        ? Math.round((1 - inventory.availableUnits / inventory.totalUnits) * 1000) / 10
        : 0,
    },
    monthlyTrend: ventasLive.monthlyTrend,
    dailyBreakdown: ventasLive.dailyBreakdown,
    topModels: topWithStock,
    byEstado: ventasLive.byEstado.map((r) => ({
      ...r,
      share: Math.round((r.units / totalEstadoUnits) * 1000) / 10,
    })),
  };
}

module.exports = { getOverview };
