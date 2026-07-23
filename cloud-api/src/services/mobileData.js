const { query } = require('../db');

function normalizePeriod(value) {
  const period = String(value || '').slice(0, 7);
  return /^\d{4}-\d{2}$/.test(period) ? period : null;
}

function money(value) {
  return Number(value || 0);
}

function countItems(list = []) {
  return Array.isArray(list) ? list.length : 0;
}

function ranked(items = [], limit = 8) {
  return (items || [])
    .map((item) => ({
      label: String(item.label || item.canal || item.vendedor || item.model || item.situacion || item.name || '—'),
      count: Number(item.count ?? item.unidades ?? item.units ?? item.total ?? 0),
    }))
    .filter((item) => item.label)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function grouped(rows, fields, limit = 8) {
  const counts = new Map();
  for (const row of rows) {
    const payload = row.payload || {};
    const value = fields.map((field) => payload[field]).find((item) => String(item || '').trim());
    const label = String(value || 'Sin dato').trim();
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

async function getPayloads(domain, period) {
  const params = [domain];
  let filter = '';
  if (period) {
    params.push(period);
    filter = `AND period_key = $${params.length}`;
  }
  const result = await query(
    `SELECT payload, period_key, last_seen_at
     FROM sync_entities
     WHERE domain = $1 ${filter}
     ORDER BY last_seen_at DESC`,
    params
  );
  return result.rows;
}

async function getLatestMeta(domain, period) {
  const params = [domain];
  let filter = '';
  if (period) {
    params.push(period);
    filter = `AND period_key = $${params.length}`;
  }
  const result = await query(
    `SELECT meta, period_key, created_at
     FROM sync_batches
     WHERE domain = $1 ${filter} AND meta IS NOT NULL
     ORDER BY created_at DESC`,
    params
  );
  return result.rows.find((row) => {
    const meta = row.meta || {};
    return meta.sofia || meta.resumen || meta.goals || meta.summary
      || meta.summaryNuevos || meta.seguimiento || meta.kpis || meta.totalPeriodo != null;
  }) || null;
}

function buildSofia(source = {}) {
  if (source?.sofia && typeof source.sofia === 'object') {
    return {
      notificaciones: Number(source.sofia.notificaciones || 0),
      sinTimbrar: Number(source.sofia.sinTimbrar || 0),
      numeradorCobertura: Number(source.sofia.numeradorCobertura || 0),
      objetivo: Number(source.sofia.objetivo || 0),
      avancePct: Number(source.sofia.avancePct || 0),
      coberturaPct: Number(source.sofia.coberturaPct || 0),
    };
  }

  const resumen = source?.resumen || {};
  const goals = source?.goals || {};
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

function hasSofiaData(sofia) {
  return Boolean(sofia && (sofia.objetivo > 0 || sofia.notificaciones > 0 || sofia.coberturaPct > 0));
}

async function getLatestOverview(period) {
  const requested = normalizePeriod(period);
  let [rows, overviewMeta, ventasMeta] = await Promise.all([
    getPayloads('overview', requested),
    getLatestMeta('overview', requested),
    getLatestMeta('ventas', requested),
  ]);
  if (!rows.length && requested) rows = await getPayloads('overview', null);
  if (!overviewMeta && requested) overviewMeta = await getLatestMeta('overview', null);
  if (!ventasMeta && requested) ventasMeta = await getLatestMeta('ventas', null);

  let sofia = buildSofia(rows[0]?.payload || {});
  if (!hasSofiaData(sofia)) sofia = buildSofia(overviewMeta?.meta || {});
  if (!hasSofiaData(sofia)) sofia = buildSofia(ventasMeta?.meta || {});

  if (rows.length) {
    return {
      ...rows[0].payload,
      sofia,
      cloud: { periodKey: rows[0].period_key, syncedAt: rows[0].last_seen_at },
    };
  }

  const [ventas, inventario, postventa] = await Promise.all([
    getPayloads('ventas', requested),
    getPayloads('inventario', requested),
    getPayloads('postventa', requested),
  ]);
  const autos = inventario.filter((row) => row.payload?.tipo === 'autos_nuevos');
  const ordenes = postventa.filter((row) => row.payload?.snapshotTipo === 'periodo');
  const facturadas = ordenes.filter((row) => String(row.payload?.status || '').toUpperCase() === 'I');
  const importeFacturado = facturadas.reduce(
    (total, row) => total + Number(row.payload?.importeFacturado || 0),
    0
  );

  return {
    financial: {
      sales: { units: ventas.length, revenue: 0, marginPct: 0 },
      inventory: { availableUnits: autos.length, inventoryValue: 0 },
      service: { facturadas: facturadas.length, importeFacturado },
    },
    kpis: { totalUnits: ventas.length },
    sofia,
    cloud: { periodKey: requested, partial: true },
  };
}

async function getVentasSummary(period) {
  const requested = normalizePeriod(period);
  let [rows, ventasMeta] = await Promise.all([
    getPayloads('ventas', requested),
    getLatestMeta('ventas', requested),
  ]);
  if (!rows.length && requested) rows = await getPayloads('ventas', null);
  if (!ventasMeta && requested) ventasMeta = await getLatestMeta('ventas', null);
  const syncedSummary = ventasMeta?.meta?.resumen;
  const resumen = syncedSummary || {
    totalVentas: rows.length,
    totalRetail: 0,
    totalFlotillas: 0,
    totalNotificacionesEntrega: 0,
    porCanal: grouped(rows, ['CANAL_LABEL', 'CANAL_VENTA', 'canal']),
    porVendedor: grouped(rows, ['VENDEDOR', 'vendedor']),
  };
  return {
    section: 'ventas',
    title: 'Ventas',
    hero: {
      label: 'Ventas del periodo',
      value: Number(resumen.totalVentas || rows.length || 0),
      hint: 'Unidades · mes en curso',
    },
    kpis: [
      { label: 'Total ventas', value: Number(resumen.totalVentas || rows.length || 0) },
      { label: 'Retail', value: Number(resumen.totalRetail || 0) },
      { label: 'Flotillas', value: Number(resumen.totalFlotillas || 0) },
      { label: 'Entregas GMMX', value: Number(resumen.totalNotificacionesEntrega || 0) },
    ],
    lists: [
      {
        title: 'Ventas por departamento',
        type: 'bars',
        items: ranked(resumen.porCanal || resumen.canales || grouped(rows, ['CANAL_LABEL', 'CANAL_VENTA', 'canal'])),
      },
      {
        title: 'Top vendedores',
        type: 'list',
        items: ranked(resumen.porVendedor || resumen.vendedores || grouped(rows, ['VENDEDOR', 'vendedor'])),
      },
    ],
    resumen,
    goals: ventasMeta?.meta?.goals || {},
    sofia: buildSofia(ventasMeta?.meta || {}),
    cloud: {
      periodKey: ventasMeta?.period_key || rows[0]?.period_key || requested,
      syncedAt: ventasMeta?.created_at || rows[0]?.last_seen_at || null,
    },
  };
}

async function getInventorySummary(period) {
  const requested = normalizePeriod(period);
  let [rows, meta] = await Promise.all([
    getPayloads('inventario', requested),
    getLatestMeta('inventario', requested),
  ]);
  if (!rows.length && requested) rows = await getPayloads('inventario', null);
  if (!meta && requested) meta = await getLatestMeta('inventario', null);

  const autos = rows.filter((row) => row.payload?.tipo === 'autos_nuevos');
  const summary = meta?.meta?.summaryNuevos || {};
  const bySituacion = ranked(
    summary.bySituacion
      || grouped(autos, ['situacionLabel', 'situacion']),
    8
  );

  return {
    section: 'inventory',
    title: 'Inventario',
    hero: {
      label: 'Unidades disponibles',
      value: Number(summary.available ?? autos.length),
      hint: 'Autos nuevos sincronizados',
    },
    kpis: [
      { label: 'Total', value: Number(summary.totalUnits ?? autos.length) },
      { label: 'Disponibles', value: Number(summary.available ?? autos.length) },
      { label: 'Alertas', value: Number(summary.ageingAlertsCount || summary.urgentAlerts || 0) },
      { label: 'Plan piso', value: money(summary.planPisoTotal), money: true },
    ],
    lists: [
      {
        title: 'Por situación',
        type: 'bars',
        items: bySituacion,
      },
    ],
    summary,
    inventoryTable: autos.slice(0, 20).map((row) => row.payload),
    cloud: {
      periodKey: meta?.period_key || rows[0]?.period_key || requested,
      syncedAt: meta?.created_at || rows[0]?.last_seen_at || null,
    },
  };
}

async function getContabilidadSummary(period) {
  const requested = normalizePeriod(period);
  let meta = await getLatestMeta('contabilidad', requested);
  if (!meta && requested) meta = await getLatestMeta('contabilidad', null);
  const summary = meta?.meta?.summary || {};

  return {
    section: 'contabilidad',
    title: 'Contabilidad',
    hero: {
      label: 'Ventas totales',
      value: money(summary.ventasTotales || summary.ingresoVentas),
      hint: 'Catálogo / periodo sincronizado',
      money: true,
    },
    kpis: [
      { label: 'Ventas totales', value: money(summary.ventasTotales || summary.ingresoVentas), money: true },
      { label: 'Costo de ventas', value: money(summary.costoVentas), money: true },
      { label: 'Utilidad bruta', value: money(summary.utilidadBruta || summary.utilidadVentas), money: true },
      { label: 'Utilidad operación', value: money(summary.utilidadOperacion), money: true },
    ],
    lists: [
      {
        title: 'Indicadores',
        type: 'list',
        items: [
          { label: 'Margen bruto', count: Number(summary.margenBrutoPct || summary.margenVentasPct || 0), suffix: '%' },
          { label: 'Gastos operación', count: money(summary.gastosOperacion), money: true },
          { label: 'Punto de equilibrio', count: money(summary.puntoEquilibrio), money: true },
          { label: 'Valor inventario', count: money(summary.valorInventario), money: true },
        ],
      },
    ],
    summary,
    cloud: {
      periodKey: meta?.period_key || requested,
      syncedAt: meta?.created_at || null,
    },
  };
}

async function getPostventaSummary(period) {
  const requested = normalizePeriod(period);
  let [rows, meta] = await Promise.all([
    getPayloads('postventa', requested),
    getLatestMeta('postventa', requested),
  ]);
  if (!rows.length && requested) rows = await getPayloads('postventa', null);
  if (!meta && requested) meta = await getLatestMeta('postventa', null);

  const periodo = rows.filter((row) => row.payload?.snapshotTipo === 'periodo');
  const abiertas = rows.filter((row) => row.payload?.snapshotTipo === 'abierta');
  const facturadas = periodo.filter((row) => String(row.payload?.status || '').toUpperCase() === 'I');
  const importeFacturado = Number(
    meta?.meta?.importeFacturado
      ?? facturadas.reduce((sum, row) => sum + Number(row.payload?.importeFacturado || 0), 0)
  );

  return {
    section: 'post-sales',
    title: 'Postventa',
    hero: {
      label: 'Órdenes del periodo',
      value: Number(meta?.meta?.totalPeriodo ?? periodo.length),
      hint: 'Servicio y taller',
    },
    kpis: [
      { label: 'Órdenes', value: Number(meta?.meta?.totalPeriodo ?? periodo.length) },
      { label: 'Facturadas', value: Number(meta?.meta?.facturadas ?? facturadas.length) },
      { label: 'Abiertas', value: Number(meta?.meta?.totalAbiertas ?? abiertas.length) },
      { label: 'Importe facturado', value: importeFacturado, money: true },
    ],
    lists: [
      {
        title: 'Por estatus',
        type: 'bars',
        items: grouped(periodo, ['statusLabel', 'status']),
      },
      {
        title: 'Por asesor',
        type: 'list',
        items: grouped(periodo, ['asesor']),
      },
    ],
    cloud: {
      periodKey: meta?.period_key || rows[0]?.period_key || requested,
      syncedAt: meta?.created_at || rows[0]?.last_seen_at || null,
    },
  };
}

async function getForecastSummary(period) {
  const requested = normalizePeriod(period);
  let [rows, meta] = await Promise.all([
    getPayloads('forecast', requested),
    getLatestMeta('forecast', requested),
  ]);
  if (!rows.length && requested) rows = await getPayloads('forecast', null);
  if (!meta && requested) meta = await getLatestMeta('forecast', null);

  const payload = rows[0]?.payload || {};
  const kpis = meta?.meta?.kpis || payload.kpis || {};
  const forecast = meta?.meta?.forecast || payload.forecast || [];
  const breakdown = payload.breakdown || {};

  return {
    section: 'forecast',
    title: 'Pronóstico',
    hero: {
      label: kpis.nextMonthLabel || 'Próximo mes',
      value: Number(kpis.nextMonthUnits || 0),
      hint: 'Unidades proyectadas',
    },
    kpis: [
      { label: 'Último mes real', value: Number(kpis.lastMonthUnits || 0) },
      { label: 'Próximo mes', value: Number(kpis.nextMonthUnits || 0) },
      { label: 'Total horizonte', value: Number(kpis.horizonTotal || 0) },
      { label: 'MAPE', value: Number(kpis.mape || 0), suffix: '%' },
    ],
    lists: [
      {
        title: 'Pronóstico mensual',
        type: 'list',
        items: ranked(
          (forecast || []).map((item) => ({
            label: item.label || item.month || 'Mes',
            count: Number(item.units || 0),
          })),
          12
        ),
      },
      {
        title: 'Modelos principales',
        type: 'bars',
        items: ranked(breakdown.byModelo || [], 8),
      },
    ],
    cloud: {
      periodKey: meta?.period_key || rows[0]?.period_key || requested,
      syncedAt: meta?.created_at || rows[0]?.last_seen_at || null,
      dataSource: meta?.meta?.dataSource || payload.dataSource || null,
    },
  };
}

async function getSeguimientoSummary(period) {
  const requested = normalizePeriod(period);
  let meta = await getLatestMeta('crm', requested);
  if (!meta && requested) meta = await getLatestMeta('crm', null);
  const seguimiento = meta?.meta?.seguimiento || {};
  const leads = seguimiento.leads || {};
  const solicitudes = seguimiento.solicitudes || {};
  const pruebas = seguimiento.pruebasManejo || {};
  const ciclos = seguimiento.ciclos || {};
  const financiamiento = seguimiento.financiamiento || {};
  const conversiones = seguimiento.conversiones || {};
  const counts = meta?.meta || {};

  return {
    section: 'seguimiento',
    title: 'Seguimiento 360',
    hero: {
      label: 'Leads del periodo',
      value: Number(leads.total || counts.leads || 0),
      hint: 'CRM sincronizado',
    },
    kpis: [
      { label: 'Leads', value: Number(leads.total || counts.leads || 0) },
      { label: 'Solicitudes F&I', value: Number(solicitudes.total || counts.solicitudes || 0) },
      { label: 'Pruebas', value: Number(pruebas.total || counts.pruebas || 0) },
      { label: 'Ciclos', value: Number(ciclos.total || counts.actividades || 0) },
      { label: 'Unidades financiadas', value: Number(financiamiento.unidades || counts.financiamiento || 0) },
    ],
    lists: [
      {
        title: 'Conversiones',
        type: 'list',
        items: [
          { label: 'Lead → compra', count: Number(conversiones.leadACompraPct || 0), suffix: '%' },
          { label: 'Solicitud → compra', count: Number(conversiones.solicitudACompraPct || 0), suffix: '%' },
          { label: 'Prueba → compra', count: Number(conversiones.pruebaManejoACompraPct || 0), suffix: '%' },
          { label: 'Clientes con VIN', count: Number(ciclos.clientesConCompra || 0) },
        ],
      },
      {
        title: 'Productos de valor agregado',
        type: 'list',
        items: [
          { label: 'GAP', count: Number(financiamiento.conGap || 0) },
          { label: 'Garantía extendida', count: Number(financiamiento.conGarantiaExtendida || 0) },
          { label: 'OnStar', count: Number(financiamiento.conOnstar || 0) },
          { label: 'Mantenimientos integrados', count: Number(financiamiento.conMantenimiento || 0) },
          { label: 'Robo parcial', count: Number(financiamiento.conRoboParcial || 0) },
        ],
      },
    ],
    seguimiento,
    cloud: {
      periodKey: meta?.period_key || requested,
      syncedAt: meta?.created_at || null,
    },
  };
}

async function getMetricsSection(section, period) {
  switch (String(section || 'ventas').toLowerCase()) {
    case 'forecast':
    case 'pronostico':
      return getForecastSummary(period);
    case 'inventory':
    case 'inventario':
      return getInventorySummary(period);
    case 'contabilidad':
      return getContabilidadSummary(period);
    case 'post-sales':
    case 'postventa':
      return getPostventaSummary(period);
    case 'seguimiento':
    case 'crm':
      return getSeguimientoSummary(period);
    case 'ventas':
    case 'sales':
    default:
      return getVentasSummary(period);
  }
}

module.exports = {
  getLatestOverview,
  getVentasSummary,
  getInventorySummary,
  getContabilidadSummary,
  getPostventaSummary,
  getForecastSummary,
  getSeguimientoSummary,
  getMetricsSection,
  normalizePeriod,
};
