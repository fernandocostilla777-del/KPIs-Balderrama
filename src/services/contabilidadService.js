const { getOverview } = require('./overviewService');
const { getInventory } = require('./inventoryService');
const { getAccountingKpis } = require('./accountingEeffService');
const { getVentasAutosNuevosIncomeStatement } = require('./ventasAutosNuevosEeffService');

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function currentMonthPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(yr, mo) {
  return `${MONTH_NAMES[(mo || 1) - 1]} ${yr}`;
}

async function getContabilidad({ fechaInicio, fechaFin, planPisoPeriod, sucursal, area } = {}) {
  const period = planPisoPeriod && /^\d{4}-\d{2}$/.test(planPisoPeriod)
    ? planPisoPeriod
    : currentMonthPeriod();

  const [overview, inventory, eeff, ventasAutosNuevosEeff] = await Promise.all([
    getOverview({ fechaInicio, fechaFin }),
    getInventory({ planPisoPeriod: period }),
    getAccountingKpis({ fechaInicio, fechaFin, sucursal, area }),
    getVentasAutosNuevosIncomeStatement(fechaInicio, fechaFin, sucursal),
  ]);

  const { sales, service, inventory: invSnap, consolidated } = overview.financial;
  const invSummary = inventory.summary;

  const ventasLines = [
    { key: 'ventaSubtotal', label: 'Venta subtotal', value: sales.revenue, group: 'ingreso' },
    { key: 'ventaIva', label: 'IVA venta', value: sales.revenueIva, group: 'ingreso' },
    { key: 'ventaIsan', label: 'ISAN', value: sales.revenueIsan, group: 'ingreso' },
    { key: 'ventaTotal', label: 'Venta total', value: sales.revenueTotal, group: 'ingreso', highlight: true },
    { key: 'costoMiCosto', label: 'Costo mi costo', value: sales.costoMiCosto, group: 'costo' },
    { key: 'bonificacion', label: 'Bonificación', value: sales.bonificacion, group: 'costo' },
    { key: 'participacion', label: 'Participación', value: sales.participacion, group: 'costo' },
    { key: 'costoNeto', label: 'Costo neto', value: sales.cost, group: 'costo', highlight: true },
    { key: 'costoIva', label: 'IVA costo', value: sales.costoIva, group: 'costo' },
    { key: 'gastos', label: 'Gastos unidad', value: sales.gastos, group: 'costo' },
    { key: 'utilidad', label: 'Utilidad bruta', value: sales.utility, group: 'resultado', highlight: true },
  ];

  const servicioLines = [
    { label: 'Mano de obra', value: service.manoObra },
    { label: 'Refacciones', value: service.refacciones },
    { label: 'Otros conceptos', value: service.otros },
    { label: 'Total facturado', value: service.importeFacturado, highlight: true },
  ];

  const monthlyTrend = (overview.monthlyTrend || []).map((r) => ({
    label: formatMonthLabel(r.yr, r.mo),
    yr: r.yr,
    mo: r.mo,
    units: Number(r.units || 0),
    revenue: Number(r.revenue || 0),
  }));

  const dailyBreakdown = overview.dailyBreakdown || [];

  const eeffSummary = eeff.income?.summary || {};
  const vtasmenSummary = ventasAutosNuevosEeff?.summary || {};
  const useVtasmen = area === 'autosNuevos';
  const kpiSource = useVtasmen ? vtasmenSummary : eeffSummary;
  const balanceTotals = eeff.balance?.totals || {};

  return {
    filtros: { fechaInicio, fechaFin, planPisoPeriod: period, sucursal, area, scopeLabel: eeff.filtros?.scopeLabel },
    eeff,
    ventasAutosNuevosEeff,
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
      // KPIs contables (CON_CTAS / EEFF)
      ventasNetas: kpiSource.ventasNetas,
      utilidadBruta: kpiSource.utilidadBruta,
      utilidadOperacion: kpiSource.utilidadOperacion,
      utilidadPeriodo: kpiSource.utilidadPeriodo ?? kpiSource.utilidadAntesImpuestos,
      activoTotal: balanceTotals.activoTotal,
      pasivoTotal: balanceTotals.pasivoTotal,
      capitalContable: balanceTotals.capital,
      margenBrutoPct: kpiSource.margenBrutoPct,
      margenOperacionPct: kpiSource.margenOperacionPct,
      liquidezCorriente: eeff.ratios?.liquidezCorriente,
    },
    ventas: {
      lines: ventasLines,
      units: sales.units,
      conCosto: sales.conCosto,
      sinCosto: sales.sinCosto,
    },
    servicio: {
      lines: servicioLines,
      ingresadas: service.ingresadas,
      facturadas: service.facturadas,
      pctFacturado: service.pctFacturado,
    },
    inventario: {
      totalUnits: invSnap.totalUnits,
      availableUnits: invSnap.availableUnits,
      inventoryCost: invSnap.inventoryCost,
      inventoryValue: invSnap.inventoryValue,
      planPisoTotal: invSummary.planPisoTotal,
      planPisoPeriodLabel: invSummary.planPisoPeriodLabel,
      planPisoUnits: invSummary.planPisoUnits,
    },
    monthlyTrend,
    dailyBreakdown,
    links: {
      ventas: `/sales.html?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}`,
      postventa: `/post-sales.html?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}`,
      inventario: '/inventory.html',
      resumen: `/?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}`,
    },
  };
}

module.exports = { getContabilidad };
