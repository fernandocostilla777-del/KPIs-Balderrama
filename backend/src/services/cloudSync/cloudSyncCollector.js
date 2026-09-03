const { getVentas } = require('../ventas');
const { getOverview } = require('../overviewService');
const { getInventory } = require('../inventoryService');
const { getInventoryPostventa } = require('../inventoryPostventaService');
const { getContabilidad } = require('../contabilidadService');
const { getPostSales } = require('../postSalesService');
const { getForecast } = require('../forecastService');
const { getObjetivosResultadosCompleto } = require('../objetivosResultadosService');
const { getGoals } = require('../salesGoals');
const crmCiclos = require('../crmCiclosService');
const userStore = require('../../auth/userStore');
const { getCurrentMonthRange, getMonthRangeForKey, serializeRow } = require('./cloudSyncUtils');
const { collectPersonal } = require('./collectPersonal');

function resolveRange({ periodKey, fechaInicio, fechaFin } = {}) {
  if (fechaInicio && fechaFin && periodKey) {
    return { periodKey, fechaInicio, fechaFin };
  }
  if (periodKey) return getMonthRangeForKey(periodKey);
  return getCurrentMonthRange();
}

function mapVentasRecords(rows) {
  return rows.map((row) => {
    const data = serializeRow(row);
    const docto = data.VTE_DOCTO ?? data.vteDocto ?? '';
    const serie = data.VTE_SERIE ?? data.serie ?? '';
    return {
      id: `${docto}|${serie}`,
      data,
    };
  });
}

function mapInventarioNuevosRecords(rows) {
  return rows.map((row) => {
    const data = serializeRow(row);
    const serie = data.serie || data.VEH_NUMSERIE || data.vin || '';
    return {
      id: String(serie),
      data: { ...data, tipo: 'autos_nuevos' },
    };
  });
}

function mapInventarioPostventaRecords(invPost) {
  const records = [];
  for (const area of Object.values(invPost.areas || {})) {
    for (const row of area.detalle || []) {
      const data = serializeRow(row);
      const parte = data.parte || '';
      const almacen = data.almacen || '';
      records.push({
        id: `${parte}|${almacen}`,
        data: { ...data, area: area.id, tipo: 'postventa_stock' },
      });
    }
  }
  return records;
}

function mapContabilidadRecords(etlRows, periodKey) {
  return (etlRows || []).map((row) => {
    const data = serializeRow(row);
    const ccId = data.ccId || data.centroCosto || 'sin-cc';
    const area = data.area || 'sin-area';
    return {
      id: `${ccId}|${area}|${periodKey}`,
      data,
    };
  });
}

function mapPostventaRecords(records, tipo) {
  return (records || []).map((row) => {
    const data = serializeRow(row);
    const orden = data.orden || data.ORE_IDORDEN || '';
    return {
      id: `${orden}|${tipo}`,
      data: { ...data, snapshotTipo: tipo },
    };
  });
}

function buildSofiaSnapshot(resumen = {}, goals = {}) {
  const notificaciones = Number(resumen.totalNotificacionesEntrega || 0);
  const sinTimbrar = Number(resumen.totalUnidadesFacturadasNoTimbradas || 0);
  const numeradorCobertura = Number(
    resumen.numeradorCobertura ?? (notificaciones + sinTimbrar)
  );
  const objetivo = Number(goals.sofia || 0);
  const avancePct = objetivo > 0 ? Math.round((notificaciones / objetivo) * 1000) / 10 : 0;
  const coberturaPct = objetivo > 0 ? Math.round((numeradorCobertura / objetivo) * 1000) / 10 : 0;
  return {
    notificaciones,
    sinTimbrar,
    numeradorCobertura,
    objetivo,
    avancePct,
    coberturaPct,
  };
}

async function collectOverview({ periodKey, fechaInicio, fechaFin, syncType = 'incremental' } = {}) {
  const range = resolveRange({ periodKey, fechaInicio, fechaFin });
  const [data, ventas, goals] = await Promise.all([
    getOverview({
      fechaInicio: range.fechaInicio,
      fechaFin: range.fechaFin,
    }),
    getVentas({
      fechaInicio: range.fechaInicio,
      fechaFin: range.fechaFin,
    }),
    Promise.resolve(getGoals({
      fechaInicio: range.fechaInicio,
      fechaFin: range.fechaFin,
    })),
  ]);
  const sofia = buildSofiaSnapshot(ventas.resumen || {}, goals);
  return {
    domain: 'overview',
    syncType,
    periodKey: range.periodKey,
    periodStart: range.fechaInicio,
    periodEnd: range.fechaFin,
    records: [{ id: range.periodKey, data: { ...data, sofia } }],
    meta: { periodKey: range.periodKey, sofia, goals, resumen: ventas.resumen || null },
  };
}

async function collectVentas({ periodKey, fechaInicio, fechaFin, syncType = 'incremental' } = {}) {
  const range = resolveRange({ periodKey, fechaInicio, fechaFin });
  const data = await getVentas({
    fechaInicio: range.fechaInicio,
    fechaFin: range.fechaFin,
  });
  const goals = getGoals({
    fechaInicio: range.fechaInicio,
    fechaFin: range.fechaFin,
  });
  return {
    domain: 'ventas',
    syncType,
    periodKey: range.periodKey,
    periodStart: range.fechaInicio,
    periodEnd: range.fechaFin,
    records: mapVentasRecords(data.registros || []),
    meta: {
      totalRegistros: (data.registros || []).length,
      resumen: data.resumen || null,
      goals,
      sofia: buildSofiaSnapshot(data.resumen || {}, goals),
    },
  };
}

async function collectInventario({ periodKey, fechaInicio, fechaFin, syncType = 'incremental' } = {}) {
  const range = resolveRange({ periodKey, fechaInicio, fechaFin });
  const [nuevos, postventa] = await Promise.all([
    getInventory({ planPisoPeriod: range.periodKey }),
    getInventoryPostventa(),
  ]);
  const records = [
    ...mapInventarioNuevosRecords(nuevos.inventoryTable || []),
    ...mapInventarioPostventaRecords(postventa),
  ];
  return {
    domain: 'inventario',
    syncType,
    periodKey: range.periodKey,
    periodStart: range.fechaInicio,
    periodEnd: range.fechaFin,
    records,
    meta: {
      autosNuevos: (nuevos.inventoryTable || []).length,
      postventaLineas: records.length - (nuevos.inventoryTable || []).length,
      summaryNuevos: nuevos.summary || null,
      overviewPostventa: postventa.overview || null,
    },
  };
}

async function collectContabilidad({ periodKey, fechaInicio, fechaFin, syncType = 'incremental' } = {}) {
  const range = resolveRange({ periodKey, fechaInicio, fechaFin });
  const data = await getContabilidad({
    fechaInicio: range.fechaInicio,
    fechaFin: range.fechaFin,
    planPisoPeriod: range.periodKey,
  });
  const rows = data.etlConsolidado?.filtered?.rows || data.etlConsolidado?.procesoD?.rows || [];
  return {
    domain: 'contabilidad',
    syncType,
    periodKey: range.periodKey,
    periodStart: range.fechaInicio,
    periodEnd: range.fechaFin,
    records: mapContabilidadRecords(rows, range.periodKey),
    meta: {
      summary: data.summary || null,
      etlSummary: data.etlConsolidado?.summary || null,
      totalFilas: rows.length,
    },
  };
}

async function collectPostventa({ periodKey, fechaInicio, fechaFin, syncType = 'daily' } = {}) {
  const range = resolveRange({ periodKey, fechaInicio, fechaFin });
  const data = await getPostSales({
    fechaInicio: range.fechaInicio,
    fechaFin: range.fechaFin,
  });
  const records = [
    ...mapPostventaRecords(data.records, 'periodo'),
    ...mapPostventaRecords(data.openSnapshot, 'abierta'),
  ];
  return {
    domain: 'postventa',
    syncType,
    periodKey: range.periodKey,
    periodStart: range.fechaInicio,
    periodEnd: range.fechaFin,
    records,
    meta: {
      totalPeriodo: (data.records || []).length,
      totalAbiertas: (data.openSnapshot || []).length,
      facturadas: (data.records || []).filter((row) => String(row.status || '').toUpperCase() === 'I').length,
      importeFacturado: (data.records || []).reduce(
        (sum, row) => sum + Number(row.importeFacturado || 0),
        0
      ),
      criticas: (data.openSnapshot || []).filter((row) => row.critica).length,
      mesCurso: data.mesCursoNomenclatura || null,
    },
  };
}

async function collectForecast({ periodKey, fechaInicio, fechaFin, syncType = 'incremental' } = {}) {
  const range = resolveRange({ periodKey, fechaInicio, fechaFin });
  const data = await getForecast({ horizon: 6 });
  return {
    domain: 'forecast',
    syncType,
    periodKey: range.periodKey,
    periodStart: range.fechaInicio,
    periodEnd: range.fechaFin,
    records: [{ id: `${range.periodKey}|6m`, data }],
    meta: {
      kpis: data.kpis || null,
      forecast: data.forecast || [],
      dataSource: data.dataSource || null,
    },
  };
}

async function collectCrm({ periodKey, fechaInicio, fechaFin, syncType = 'incremental' } = {}) {
  const range = resolveRange({ periodKey, fechaInicio, fechaFin });
  const exported = crmCiclos.exportCloudSyncRecords({
    fechaInicio: range.fechaInicio,
    fechaFin: range.fechaFin,
  });
  const seguimiento = crmCiclos.getSeguimiento360Summary({
    desde: range.fechaInicio,
    hasta: range.fechaFin,
  });
  return {
    domain: 'crm',
    syncType,
    periodKey: range.periodKey,
    periodStart: range.fechaInicio,
    periodEnd: range.fechaFin,
    records: exported.records || [],
    meta: { ...(exported.meta || {}), seguimiento },
  };
}

/**
 * Tablero de objetivos ya calculado. Se envía como snapshot por periodo para que
 * la nube no tenga que replicar la lógica de agregación ni el acceso al DMS.
 */
async function collectObjetivos({ periodKey, fechaInicio, fechaFin, syncType = 'incremental' } = {}) {
  const range = resolveRange({ periodKey, fechaInicio, fechaFin });
  const data = await getObjetivosResultadosCompleto({
    fechaInicio: range.fechaInicio,
    fechaFin: range.fechaFin,
  });
  return {
    domain: 'objetivos',
    syncType,
    periodKey: range.periodKey,
    periodStart: range.fechaInicio,
    periodEnd: range.fechaFin,
    records: [{ id: range.periodKey, data }],
    meta: {
      generadoEn: data.generadoEn || null,
      metricas: Object.keys(data.resultados || {}).length,
    },
  };
}

/** Usuarios del dashboard web → Cloud API (mismo login móvil). */
async function collectAuth(_options = {}) {
  const records = userStore.exportCloudSyncRecords();
  return {
    domain: 'auth',
    // monthly + period global: elimina en nube a quien ya no exista en el dashboard
    syncType: 'monthly',
    periodKey: 'global',
    periodStart: null,
    periodEnd: null,
    records,
    meta: {
      userCount: records.length,
      activeCount: records.filter((r) => r.data?.active !== false).length,
    },
  };
}

const COLLECTORS = {
  overview: collectOverview,
  ventas: collectVentas,
  inventario: collectInventario,
  contabilidad: collectContabilidad,
  postventa: collectPostventa,
  forecast: collectForecast,
  crm: collectCrm,
  objetivos: collectObjetivos,
  auth: collectAuth,
  personal: collectPersonal,
};

async function collectDomain(domain, options = {}) {
  const fn = COLLECTORS[domain];
  if (!fn) throw new Error(`Dominio de sync desconocido: ${domain}`);
  return fn(options);
}

module.exports = {
  collectOverview,
  collectVentas,
  collectInventario,
  collectContabilidad,
  collectPostventa,
  collectForecast,
  collectCrm,
  collectObjetivos,
  collectAuth,
  collectPersonal,
  collectDomain,
};
