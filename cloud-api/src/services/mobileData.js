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

/** Primera letra del folio → área (misma lógica que backend postSalesOrderTypes). */
const AREA_LETRAS = {
  servicio: ['C', 'D', 'G', 'I', 'K', 'N', 'O', 'Q', 'S', 'X', 'Y', 'Á', 'M', 'E', 'R'],
  hyp: ['A', 'F', 'H', 'J', 'V', 'Z', 'Ó'],
};
/** Asesores HyP: órdenes de empleados (E) cuentan en HyP. */
const HYP_ASESORES_EMPLEADOS = ['jair', 'brian', 'brayan', 'bryan', 'edel'];
const HYP_ASESORES = HYP_ASESORES_EMPLEADOS;
const HYP_ASESOR_LETRAS_INCLUIDAS = new Set(['I', 'E']);
const OPEN_STATUSES = new Set(['A', 'T', 'D', 'P']);

function normalizeArea(area) {
  const key = String(area || 'posventa').trim().toLowerCase();
  if (key === 'hyp' || key === 'h&p' || key === 'hojalateria' || key === 'hojalatería') return 'hyp';
  if (key === 'servicio' || key === 'taller') return 'servicio';
  return 'posventa';
}

function letterOfPayload(payload = {}) {
  const fromField = String(payload.letraOrden || payload.letra || '').trim().toUpperCase();
  if (fromField) return fromField;
  return String(payload.orden || payload.ORE_IDORDEN || '').trim().charAt(0).toUpperCase();
}

function stripAccents(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isHypAsesorPayload(payload = {}) {
  const asesor = stripAccents(payload.asesor || '');
  if (!asesor) return false;
  return HYP_ASESORES.some((name) => {
    const re = new RegExp(`(?:^|[^a-z])${name}(?:[^a-z]|$)`);
    return re.test(asesor);
  });
}

function isHypAsesorOrdenParaHypPayload(payload = {}) {
  if (!isHypAsesorPayload(payload)) return false;
  return HYP_ASESOR_LETRAS_INCLUIDAS.has(letterOfPayload(payload));
}

function isHypEmpleadoAsesorPayload(payload = {}) {
  return isHypAsesorOrdenParaHypPayload(payload);
}

function matchesAreaPayload(payload, area) {
  const key = normalizeArea(area);
  if (key === 'posventa') return true;
  const letra = letterOfPayload(payload);
  if (key === 'hyp') {
    if ((AREA_LETRAS.hyp || []).includes(letra)) return true;
    return isHypAsesorOrdenParaHypPayload(payload);
  }
  if (key === 'servicio') {
    if (!(AREA_LETRAS.servicio || []).includes(letra)) return false;
    if (isHypAsesorOrdenParaHypPayload(payload)) return false;
    return true;
  }
  const letras = AREA_LETRAS[key];
  if (!letras) return true;
  return letras.includes(letra);
}

function matchesEstatusPayload(payload, estatus) {
  const key = String(estatus || 'todas').trim().toLowerCase();
  if (!key || key === 'todas') return true;
  const status = String(payload.status || '').trim().toUpperCase();
  if (key === 'abiertas' || key === 'abierta' || key === 'open') {
    if (payload.snapshotTipo === 'abierta') return true;
    return OPEN_STATUSES.has(status);
  }
  if (key === 'facturadas' || key === 'facturada') return status === 'I';
  if (key === 'canceladas' || key === 'cancelada') return status === 'C';
  return status === key.toUpperCase();
}

function filterPostventaRows(rows, { area = 'posventa', estatus = 'todas' } = {}) {
  return (rows || []).filter((row) => {
    const payload = row.payload || {};
    return matchesAreaPayload(payload, area) && matchesEstatusPayload(payload, estatus);
  });
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
  const fromRowsFlotilla = rows.filter((row) => {
    const tipo = String(row.payload?.TIPOVENTA || row.payload?.tipoventa || '').toUpperCase();
    return tipo === 'FLOTILLA' || tipo.includes('FLOT');
  }).length;
  const fromRowsRetail = Math.max(0, rows.length - fromRowsFlotilla);

  const resumen = syncedSummary || {
    totalVentas: rows.length,
    totalRetail: fromRowsRetail,
    totalFlotillas: fromRowsFlotilla,
    totalNotificacionesEntrega: 0,
    porCanal: grouped(rows, ['CANAL_LABEL', 'CANAL_VENTA', 'canal']),
    porVendedor: grouped(rows, ['VENDEDOR', 'vendedor']),
  };

  const sofia = buildSofia(ventasMeta?.meta || {});
  const retail = Number(resumen.totalRetail ?? fromRowsRetail);
  const flotillas = Number(resumen.totalFlotillas ?? fromRowsFlotilla);
  const entregasGmmx = Number(resumen.totalNotificacionesEntrega || sofia.notificaciones || 0);
  const coberturaPct = Number(sofia.coberturaPct || 0);

  return {
    section: 'ventas',
    title: 'Ventas',
    hero: {
      label: 'Ventas Retail',
      value: retail,
      hint: 'Unidades retail · mes en curso',
    },
    kpis: [
      { label: 'Ventas Retail', value: retail },
      { label: 'Flotillas', value: flotillas },
      { label: 'Entregas GMMX', value: entregasGmmx },
      { label: 'Cobertura', value: coberturaPct, suffix: '%' },
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
    sofia,
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

function sumPayload(rows, field) {
  return (rows || []).reduce((sum, row) => {
    const p = row.payload || {};
    return sum + Number(p[field] ?? p.importe ?? 0);
  }, 0);
}

function agingBucket(payload = {}) {
  const known = String(payload.antiguedad || '').trim();
  if (known) return known;
  const d = Number(payload.dias || 0);
  if (d <= 30) return '0-30';
  if (d <= 60) return '31-60';
  if (d <= 90) return '61-90';
  if (d <= 120) return '91-120';
  return '+120';
}

function hasRefacciones(payload = {}) {
  if (payload.conRefacciones === true || payload.conRefacciones === 1) return true;
  return Number(payload.refaccionesLineas || 0) > 0;
}

/** Misma lógica operativa que PostSalesAnalytics.computeDashboard (web). */
function buildPostventaDashboard(periodoRows, abiertasRows, area) {
  const periodo = filterPostventaRows(periodoRows, { area, estatus: 'todas' });
  const abiertas = filterPostventaRows(abiertasRows, { area, estatus: 'abiertas' });
  const facturadas = periodo.filter((row) => String(row.payload?.status || '').toUpperCase() === 'I');
  const canceladas = periodo.filter((row) => String(row.payload?.status || '').toUpperCase() === 'C');
  const cerradas = periodo.filter((row) => {
    const st = String(row.payload?.status || '').toUpperCase();
    return !OPEN_STATUSES.has(st);
  });

  const importeIngresado = sumPayload(periodo, 'importe');
  const importeFacturado = sumPayload(facturadas, 'importeFacturado');
  const importeAbierto = sumPayload(abiertas, 'importeAbierto');

  const pctFacturado = periodo.length
    ? Math.round((facturadas.length / periodo.length) * 1000) / 10
    : 0;
  const pctImporteFacturado = importeIngresado > 0
    ? Math.round((importeFacturado / importeIngresado) * 1000) / 10
    : 0;
  const pctCerrado = periodo.length
    ? Math.round((cerradas.length / periodo.length) * 1000) / 10
    : 0;

  const agingCounts = { '0-30': 0, '31-60': 0, '61-90': 0, '91-120': 0, '+120': 0 };
  for (const row of abiertas) {
    const b = agingBucket(row.payload || {});
    if (agingCounts[b] != null) agingCounts[b] += 1;
    else agingCounts['+120'] += 1;
  }

  const openPlus120 = abiertas.filter((row) => agingBucket(row.payload || {}) === '+120');
  const conRef = abiertas.filter((row) => hasRefacciones(row.payload || {}));

  const avgDias = (rows) => {
    const vals = rows
      .map((row) => Number(row.payload?.dias))
      .filter((d) => Number.isFinite(d) && d >= 0);
    if (!vals.length) return 0;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  };
  const enMecanica = abiertas.filter((row) => {
    const p = row.payload || {};
    const st = String(p.status || '').toUpperCase();
    return matchesAreaPayload(p, 'servicio') && (st === 'T' || st === 'A');
  });
  const enEsperaRefacc = abiertas.filter((row) => {
    const p = row.payload || {};
    const st = String(p.status || '').toUpperCase();
    return st === 'D' || (st === 'P' && hasRefacciones(p));
  });
  const enPintura = abiertas.filter((row) => matchesAreaPayload(row.payload || {}, 'hyp'));

  const operations = {
    diasPromMecanica: avgDias(enMecanica),
    ordenesMecanica: enMecanica.length,
    diasPromEsperaRefacc: avgDias(enEsperaRefacc),
    ordenesEsperaRefacc: enEsperaRefacc.length,
    diasPromPintura: avgDias(enPintura),
    ordenesPintura: enPintura.length,
  };

  const summary = {
    totalOrdenes: periodo.length,
    facturadas: facturadas.length,
    canceladas: canceladas.length,
    cerradas: cerradas.length,
    abiertas: abiertas.length,
    importeIngresado,
    importeFacturado,
    importeAbierto,
    pctFacturado,
    pctImporteFacturado,
    pctCerrado,
    ticketPromFacturado: facturadas.length ? importeFacturado / facturadas.length : 0,
    ticketPromIngresado: periodo.length ? importeIngresado / periodo.length : 0,
    riesgo120: sumPayload(openPlus120, 'importeAbierto'),
  };

  const aging = {
    b0_30: agingCounts['0-30'],
    b31_60: agingCounts['31-60'],
    b61_90: agingCounts['61-90'],
    b91_120: agingCounts['91-120'],
    b120p: agingCounts['+120'],
  };

  const risk = {
    criticas60: abiertas.filter((row) => row.payload?.critica).length,
    conRefacciones: conRef.length,
    conRefaccionesImporte: sumPayload(conRef, 'importeAbierto'),
    promesasVencidas: abiertas.filter((row) => row.payload?.promesaVencida).length,
    sinImporte: abiertas.filter((row) => row.payload?.sinImporte).length,
    sinAseguradora: abiertas.filter((row) => row.payload?.sinAseguradora).length,
    abiertasSinPromesa: abiertas.filter((row) => row.payload?.abiertaSinPromesa).length,
    sinFechaIngreso: abiertas.filter((row) => row.payload?.sinFechaIngreso).length,
    excluidos: periodo.filter((row) => row.payload?.excluido).length,
  };

  return { periodo, abiertas, facturadas, summary, aging, risk, operations };
}

async function getPostventaSummary(period, options = {}) {
  const requested = normalizePeriod(period);
  const area = normalizeArea(options.area);
  const estatus = String(options.estatus || 'todas').trim().toLowerCase() || 'todas';

  let [rows, meta] = await Promise.all([
    getPayloads('postventa', requested),
    getLatestMeta('postventa', requested),
  ]);
  if (!rows.length && requested) rows = await getPayloads('postventa', null);
  if (!meta && requested) meta = await getLatestMeta('postventa', null);

  const periodoAll = rows.filter((row) => row.payload?.snapshotTipo === 'periodo');
  const abiertasAll = rows.filter((row) => row.payload?.snapshotTipo === 'abierta');

  const dash = buildPostventaDashboard(periodoAll, abiertasAll, area);
  const { summary: s, aging: a, risk: r, operations: o } = dash;

  const servicioN = filterPostventaRows(periodoAll, { area: 'servicio' }).length;
  const hypN = filterPostventaRows(periodoAll, { area: 'hyp' }).length;

  const areaLabel = area === 'hyp' ? 'HyP' : area === 'servicio' ? 'Servicio' : 'PostVenta';
  const areaHint = area === 'hyp'
    ? 'Folios A, F, H, J, V, Z, Ó'
    : area === 'servicio'
      ? 'Taller / reparación'
      : 'Vista consolidada · Servicio y HyP';

  const areas = [
    { id: 'posventa', label: 'PostVenta' },
    { id: 'servicio', label: 'Servicio' },
    { id: 'hyp', label: 'HyP' },
  ];

  const cloud = {
    periodKey: meta?.period_key || rows[0]?.period_key || requested,
    syncedAt: meta?.created_at || rows[0]?.last_seen_at || null,
  };

  const wantAbiertas = ['abiertas', 'abierta', 'open'].includes(estatus);
  const hero = wantAbiertas
    ? { label: `Órdenes abiertas · ${areaLabel}`, value: s.abiertas, hint: areaHint }
    : { label: 'Órdenes ingresadas', value: s.totalOrdenes, hint: areaHint };

  if (area === 'posventa') {
    return {
      section: 'post-sales',
      title: 'PostVenta',
      area,
      areas,
      hero,
      kpis: [
        { label: 'Órdenes ingresadas', value: s.totalOrdenes },
        { label: 'Facturadas', value: s.facturadas, sub: `${s.pctFacturado}% del total` },
        { label: 'Importe facturado', value: s.importeFacturado, money: true },
        { label: 'Backlog abierto', value: s.importeAbierto, money: true, sub: `${s.abiertas} en taller` },
      ],
      kpiGroups: [
        {
          title: 'Secciones',
          items: [
            { label: 'Servicio', value: servicioN, sub: 'Órdenes de servicio' },
            { label: 'HyP', value: hypN, sub: 'Órdenes HyP' },
          ],
        },
        {
          title: 'Resumen directivo',
          items: [
            { label: 'Tasa de facturación', value: s.pctImporteFacturado, suffix: '%' },
            { label: 'Abiertas hoy', value: s.abiertas },
            { label: 'Riesgo +120 días', value: s.riesgo120, money: true },
            { label: 'Canceladas', value: s.canceladas },
          ],
        },
        {
          title: 'Operación de taller',
          items: [
            {
              label: 'Reparación mecánica',
              value: o.diasPromMecanica,
              suffix: ' d',
              sub: `${o.ordenesMecanica} abiertas Servicio`,
            },
            {
              label: 'Espera de refacciones',
              value: o.diasPromEsperaRefacc,
              suffix: ' d',
              sub: `${o.ordenesEsperaRefacc} detenidas / pend. RE`,
            },
            {
              label: 'Pintura / HyP',
              value: o.diasPromPintura,
              suffix: ' d',
              sub: `${o.ordenesPintura} abiertas HyP`,
            },
          ],
        },
      ],
      lists: [
        { title: 'Por estatus', type: 'bars', items: grouped(dash.periodo, ['statusLabel', 'status']) },
        { title: 'Por asesor', type: 'list', items: grouped(dash.periodo, ['asesor']) },
      ],
      summary: s,
      aging: a,
      risk: r,
      operations: o,
      estatus,
      cloud,
    };
  }

  return {
    section: 'post-sales',
    title: areaLabel,
    area,
    areas,
    hero,
    kpis: [
      { label: 'Importe facturado', value: s.importeFacturado, money: true, sub: `${s.facturadas} órdenes · ${s.pctFacturado}%` },
      { label: 'Tasa de facturación', value: s.pctImporteFacturado, suffix: '%' },
      { label: 'Backlog abierto', value: s.importeAbierto, money: true, sub: `${s.abiertas} en taller` },
      { label: 'Riesgo +120 días', value: s.riesgo120, money: true },
    ],
    kpiGroups: [
      {
        title: 'Volumen del periodo',
        items: [
          { label: 'Órdenes ingresadas', value: s.totalOrdenes },
          { label: 'Facturadas', value: s.facturadas, sub: `${s.pctFacturado}%` },
          { label: 'Cerradas', value: s.cerradas, sub: `${s.pctCerrado}%` },
          { label: 'Abiertas hoy', value: s.abiertas },
          { label: 'Canceladas', value: s.canceladas },
        ],
      },
      {
        title: 'Importes y tickets',
        items: [
          { label: 'Importe ingresado', value: s.importeIngresado, money: true },
          { label: 'Ticket prom. facturado', value: s.ticketPromFacturado, money: true },
          { label: 'Ticket prom. ingresado', value: s.ticketPromIngresado, money: true },
          { label: 'Importe facturado', value: s.importeFacturado, money: true },
        ],
      },
      {
        title: 'Antigüedad de abiertas',
        items: [
          { label: '0-30 días', value: a.b0_30 },
          { label: '31-60 días', value: a.b31_60 },
          { label: '61-90 días', value: a.b61_90 },
          { label: '91-120 días', value: a.b91_120 },
          { label: '+120 días', value: a.b120p },
        ],
      },
      {
        title: 'Operación de taller',
        items: [
          {
            label: 'Reparación mecánica',
            value: o.diasPromMecanica,
            suffix: ' d',
            sub: `${o.ordenesMecanica} abiertas Servicio`,
          },
          {
            label: 'Espera de refacciones',
            value: o.diasPromEsperaRefacc,
            suffix: ' d',
            sub: `${o.ordenesEsperaRefacc} detenidas / pend. RE`,
          },
          {
            label: 'Pintura / HyP',
            value: o.diasPromPintura,
            suffix: ' d',
            sub: `${o.ordenesPintura} abiertas HyP`,
          },
          { label: 'Con refacciones', value: r.conRefacciones },
          { label: 'Promesas vencidas', value: r.promesasVencidas },
          { label: 'Críticas +60', value: r.criticas60 },
        ],
      },
      {
        title: 'Control de taller',
        items: [
          { label: 'Sin importe', value: r.sinImporte },
          { label: 'Sin aseguradora', value: r.sinAseguradora },
          { label: 'Abiertas sin promesa', value: r.abiertasSinPromesa },
          { label: 'Sin fecha ingreso', value: r.sinFechaIngreso },
          { label: 'Registros excluidos', value: r.excluidos },
        ],
      },
    ],
    lists: [
      { title: 'Por estatus', type: 'bars', items: grouped(dash.periodo, ['statusLabel', 'status']) },
      { title: 'Por asesor', type: 'list', items: grouped(dash.periodo, ['asesor']) },
      { title: 'Por tipo de orden', type: 'bars', items: grouped(dash.periodo, ['tipoPorLetra', 'tipoOrden', 'letraOrden']) },
    ],
    summary: s,
    aging: a,
    risk: r,
    operations: o,
    estatus,
    cloud,
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

async function getMetricsSection(section, period, options = {}) {
  const key = String(section || '').toLowerCase();
  switch (key) {
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
      return getPostventaSummary(period, options);
    case 'seguimiento':
    case 'crm':
      return getSeguimientoSummary(period);
    case 'ventas':
    case 'sales':
      return getVentasSummary(period);
    default: {
      const err = new Error('Sección no válida');
      err.status = 400;
      throw err;
    }
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
