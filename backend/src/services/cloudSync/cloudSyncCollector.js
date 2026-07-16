const { getVentas } = require('../ventas');
const { getInventory } = require('../inventoryService');
const { getInventoryPostventa } = require('../inventoryPostventaService');
const { getContabilidad } = require('../contabilidadService');
const { getPostSales } = require('../postSalesService');
const crmCiclos = require('../crmCiclosService');
const { getCurrentMonthRange, getMonthRangeForKey, serializeRow } = require('./cloudSyncUtils');

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

async function collectVentas({ periodKey, fechaInicio, fechaFin, syncType = 'incremental' } = {}) {
  const range = resolveRange({ periodKey, fechaInicio, fechaFin });
  const data = await getVentas({
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
      mesCurso: data.mesCursoNomenclatura || null,
    },
  };
}

async function collectCrm({ periodKey, fechaInicio, fechaFin, syncType = 'incremental' } = {}) {
  const range = resolveRange({ periodKey, fechaInicio, fechaFin });
  const exported = crmCiclos.exportCloudSyncRecords({
    fechaInicio: range.fechaInicio,
    fechaFin: range.fechaFin,
  });
  return {
    domain: 'crm',
    syncType,
    periodKey: range.periodKey,
    periodStart: range.fechaInicio,
    periodEnd: range.fechaFin,
    records: exported.records || [],
    meta: exported.meta || {},
  };
}

const COLLECTORS = {
  ventas: collectVentas,
  inventario: collectInventario,
  contabilidad: collectContabilidad,
  postventa: collectPostventa,
  crm: collectCrm,
};

async function collectDomain(domain, options = {}) {
  const fn = COLLECTORS[domain];
  if (!fn) throw new Error(`Dominio de sync desconocido: ${domain}`);
  return fn(options);
}

module.exports = {
  collectVentas,
  collectInventario,
  collectContabilidad,
  collectPostventa,
  collectCrm,
  collectDomain,
};
