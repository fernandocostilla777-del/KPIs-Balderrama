const { getOverview } = require('./overviewService');
const { getInventory } = require('./inventoryService');
const { getAccountingKpis } = require('./accountingEeffService');
const { getVentasAutosNuevosIncomeStatement } = require('./ventasAutosNuevosEeffService');
const { runAccountingEtl } = require('./accountingEtlService');
const { getCatalogKpis } = require('./accountingCatalogKpiService');
const { getBalanceGeneral, getDepreciacionPeriodo } = require('./balanceGeneralService');
const { getPuntoEquilibrio } = require('./breakEvenService');
const { computeDpo, computeEbitMetrics } = require('./estructuraFinanciera');

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

function currentMonthPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(yr, mo) {
  return `${MONTH_NAMES[(mo || 1) - 1]} ${yr}`;
}

async function getContabilidad({ fechaInicio, fechaFin, planPisoPeriod, sucursal, area, includeFi } = {}) {
  const period = planPisoPeriod && /^\d{4}-\d{2}$/.test(planPisoPeriod)
    ? planPisoPeriod
    : currentMonthPeriod();

  const includeFinanciamiento = includeFi !== 'false' && includeFi !== false;

  // Siempre calcular Balance General con cuentas mayor (independiente del alcance EEFF)
  const priorInicio = shiftYear(fechaInicio, -1);
  const priorFin = shiftYear(fechaFin, -1);
  const [overview, inventory, catalogKpis, eeff, ventasAutosNuevosEeff, etlConsolidado, balanceGeneralRaw, puntoEquilibrio, depPeriodo, catalogPrior] = await Promise.all([
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
  const estructura = balanceGeneral?.estructura || null;

  const dpo = computeDpo({
    cxpProveedores: balanceGeneral?.cxpProveedores || 0,
    costoVentas: kpi.costoVentas,
    fechaInicio,
    fechaFin,
  });

  const ebitMetrics = computeEbitMetrics({
    ventas: kpi.ventasTotales || kpi.ventasNetas,
    utilidadOperacion: kpi.utilidadOperacion,
    depreciacionPeriodo: depPeriodo?.depreciacionPeriodo || 0,
    utilidadOperacionAnterior: catalogPrior?.summary?.utilidadOperacion ?? null,
  });

  if (balanceGeneral && typeof balanceGeneral === 'object') {
    balanceGeneral.dpo = dpo;
    balanceGeneral.ebitMetrics = ebitMetrics;
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
    dpo,
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
      calidadDeudaCortoPct: estructura?.calidadDeuda?.cortoPct ?? null,
      dpoDias: dpo.dpoDias,
      margenEbitdaPct: ebitMetrics.margenEbitdaPct,
      crecimientoEbitPct: ebitMetrics.crecimientoEbitPct,
      ebit: ebitMetrics.ebit,
      ebitda: ebitMetrics.ebitda,
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
