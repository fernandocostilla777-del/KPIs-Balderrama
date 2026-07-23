const { query } = require('../db');

function parseDateInput(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw Object.assign(new Error('Fecha invalida. Use formato YYYY-MM-DD.'), { status: 400 });
  }
  return value;
}

function toYmdCompact(iso) {
  return String(iso).replace(/-/g, '');
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function fechaValidaSql(alias = 'p') {
  return `
    ${alias}.PED_FECHA IS NOT NULL
    AND LEN(RTRIM(${alias}.PED_FECHA)) = 10
    AND SUBSTRING(${alias}.PED_FECHA, 3, 1) = '/'
    AND SUBSTRING(${alias}.PED_FECHA, 6, 1) = '/'
    AND ISNUMERIC(SUBSTRING(${alias}.PED_FECHA, 1, 2)) = 1
    AND ISNUMERIC(SUBSTRING(${alias}.PED_FECHA, 4, 2)) = 1
    AND ISNUMERIC(SUBSTRING(${alias}.PED_FECHA, 7, 4)) = 1
  `;
}

/**
 * Existencias actuales: PAR_ALMACEN + PAR_PARTES
 * (PAR_INVENTARIO suele ir vacío en este DMS; el stock operativo está en almacén).
 */
async function getRefaccionesInventario({ limit = 500 } = {}) {
  const rows = await query(`
    SELECT TOP (${Math.min(Math.max(Number(limit) || 500, 50), 2000)})
      LTRIM(RTRIM(a.ALM_IDPARTE)) AS parte,
      LTRIM(RTRIM(ISNULL(p.PTS_DESPARTE, ''))) AS descripcion,
      LTRIM(RTRIM(a.ALM_IDALMA)) AS almacen,
      LTRIM(RTRIM(ISNULL(p.PTS_GRUPO, ''))) AS grupo,
      LTRIM(RTRIM(ISNULL(g.PAR_DESCRIP1, ''))) AS grupoLabel,
      LTRIM(RTRIM(ISNULL(p.PTS_LINEA, ''))) AS linea,
      ISNULL(a.ALM_EXISTEN, 0) AS existencia,
      ISNULL(a.ALM_APARTADA, 0) AS apartada,
      ISNULL(a.ALM_PROCESO, 0) AS proceso,
      ISNULL(a.ALM_CTOPROM, 0) AS costoPromedio,
      ISNULL(a.ALM_EXISTEN, 0) * ISNULL(a.ALM_CTOPROM, 0) AS costo,
      LTRIM(RTRIM(ISNULL(a.ALM_STATUS, 'A'))) AS status
    FROM PAR_ALMACEN a
    LEFT JOIN PAR_PARTES p
      ON LTRIM(RTRIM(p.PTS_IDPARTE)) = LTRIM(RTRIM(a.ALM_IDPARTE))
    LEFT JOIN PNC_PARAMETR g
      ON g.PAR_TIPOPARA IN ('GP', 'GS')
     AND LTRIM(RTRIM(g.PAR_IDENPARA)) = LTRIM(RTRIM(ISNULL(p.PTS_GRUPO, '')))
    WHERE ISNULL(a.ALM_STATUS, 'A') = 'A'
      AND ISNULL(a.ALM_EXISTEN, 0) > 0
    ORDER BY ISNULL(a.ALM_EXISTEN, 0) * ISNULL(a.ALM_CTOPROM, 0) DESC
  `);

  const detalle = (rows || []).map((r) => ({
    parte: String(r.parte || '').trim(),
    descripcion: String(r.descripcion || '').trim() || 'Sin descripción',
    almacen: String(r.almacen || '').trim(),
    grupo: String(r.grupo || '').trim(),
    grupoLabel: String(r.grupoLabel || '').trim() || (r.grupo ? `Grupo ${r.grupo}` : 'Sin grupo'),
    linea: String(r.linea || '').trim() || null,
    existencia: round2(r.existencia),
    apartada: round2(r.apartada),
    proceso: round2(r.proceso),
    costoPromedio: round2(r.costoPromedio),
    costo: round2(r.costo),
    status: String(r.status || 'A').trim(),
  }));

  const summary = {
    lineas: detalle.length,
    existencia: round2(detalle.reduce((s, r) => s + r.existencia, 0)),
    costo: round2(detalle.reduce((s, r) => s + r.costo, 0)),
    almacenes: new Set(detalle.map((r) => r.almacen).filter(Boolean)).size,
  };

  return {
    fuente: 'PAR_ALMACEN · PAR_PARTES',
    nota: 'Existencias físicas operativas desde almacén. PAR_INVENTARIO no se usa (conteos físicos vacíos en este DMS).',
    summary,
    detalle,
  };
}

async function loadPedidosRows(fi, ff) {
  const desde = toYmdCompact(fi);
  const hasta = toYmdCompact(ff);

  return query(`
    SELECT
      CAST(p.PED_NUMERO AS varchar(20)) AS numero,
      p.PED_FECHA AS fecha,
      CAST(ISNULL(p.PED_PROVEED, 0) AS varchar(20)) AS proveedor,
      RTRIM(ISNULL(p.PED_STATUS, '')) AS status,
      RTRIM(ISNULL(p.ped_tiporped, '')) AS tipoPedido,
      RTRIM(ISNULL(p.PED_REFPLANTA, '')) AS refPlanta,
      RTRIM(ISNULL(p.ped_origen, '')) AS origen,
      COUNT(d.PDT_IDPARTE) AS lineas,
      SUM(ISNULL(d.PDT_CANTIDAD, 0)) AS cantPedida,
      SUM(ISNULL(d.PDT_CANTSURT, 0)) AS cantSurtida,
      SUM(ISNULL(d.PDT_TOTAL, 0)) AS importeTotal,
      SUM(CASE
        WHEN ISNULL(d.PDT_CANTIDAD, 0) > ISNULL(d.PDT_CANTSURT, 0) THEN 1
        ELSE 0
      END) AS lineasPendientes
    FROM PAR_PEDIDO p
    LEFT JOIN PAR_PEDIDETA d
      ON d.PDT_NUMERO = p.PED_NUMERO
    WHERE ${fechaValidaSql('p')}
      AND CONVERT(datetime, p.PED_FECHA, 103) >= CONVERT(datetime, @desde, 112)
      AND CONVERT(datetime, p.PED_FECHA, 103) < DATEADD(day, 1, CONVERT(datetime, @hasta, 112))
    GROUP BY
      p.PED_NUMERO,
      p.PED_FECHA,
      p.PED_PROVEED,
      p.PED_STATUS,
      p.ped_tiporped,
      p.PED_REFPLANTA,
      p.ped_origen
    ORDER BY CONVERT(datetime, p.PED_FECHA, 103) DESC, p.PED_NUMERO DESC
  `, { desde, hasta });
}

function mapPedido(r) {
  const status = String(r.status || '').trim().toUpperCase();
  const cantPedida = Number(r.cantPedida || 0);
  const cantSurtida = Number(r.cantSurtida || 0);
  const abierto = status !== 'C';
  const pendienteSurtir = cantPedida > cantSurtida;
  const proveedor = String(r.proveedor || '').trim();
  return {
    numero: String(r.numero || '').trim(),
    fecha: r.fecha,
    proveedor: !proveedor || proveedor === '0' ? 'Sin proveedor' : proveedor,
    status,
    tipoPedido: String(r.tipoPedido || '').trim() || '—',
    refPlanta: String(r.refPlanta || '').trim() || null,
    origen: String(r.origen || '').trim() || null,
    lineas: Number(r.lineas || 0),
    cantPedida: round2(cantPedida),
    cantSurtida: round2(cantSurtida),
    importeTotal: round2(r.importeTotal),
    lineasPendientes: Number(r.lineasPendientes || 0),
    abierto,
    pendienteSurtir,
  };
}

function buildPedidosPayload(rows) {
  const pedidos = (rows || []).map(mapPedido);
  const abiertos = pedidos.filter((p) => p.abierto);
  const pendientes = pedidos.filter((p) => p.pendienteSurtir && p.abierto);
  const cancelados = pedidos.filter((p) => !p.abierto);

  const porStatusMap = new Map();
  const porTipoMap = new Map();
  const porProveedorMap = new Map();
  for (const p of pedidos) {
    porStatusMap.set(p.status || '(SIN)', (porStatusMap.get(p.status || '(SIN)') || 0) + 1);
    porTipoMap.set(p.tipoPedido, (porTipoMap.get(p.tipoPedido) || 0) + 1);
    porProveedorMap.set(p.proveedor, (porProveedorMap.get(p.proveedor) || 0) + 1);
  }
  const toList = (map) => [...map.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  return {
    fuente: 'PAR_PEDIDO · PAR_PEDIDETA',
    summary: {
      totalPedidos: pedidos.length,
      abiertos: abiertos.length,
      cancelados: cancelados.length,
      pendientesSurtir: pendientes.length,
      importeTotal: round2(pedidos.reduce((s, p) => s + Number(p.importeTotal || 0), 0)),
      importeAbiertos: round2(abiertos.reduce((s, p) => s + Number(p.importeTotal || 0), 0)),
      lineasPendientes: pendientes.reduce((s, p) => s + p.lineasPendientes, 0),
    },
    porStatus: toList(porStatusMap),
    porTipo: toList(porTipoMap),
    porProveedor: toList(porProveedorMap).slice(0, 15),
    pedidos,
    pendientes,
  };
}

/**
 * Pedidos del periodo + pendientes de surtir (cant pedida > surtida).
 */
async function getRefaccionesPedidos({ fechaInicio, fechaFin } = {}) {
  const fi = parseDateInput(fechaInicio);
  const ff = parseDateInput(fechaFin);
  const rows = await loadPedidosRows(fi, ff);
  return {
    filtros: { fechaInicio: fi, fechaFin: ff },
    ...buildPedidosPayload(rows),
  };
}

/**
 * Dashboard completo de la sección Refacciones (PosVenta).
 */
async function getRefaccionesDashboard({ fechaInicio, fechaFin } = {}) {
  const fi = parseDateInput(fechaInicio);
  const ff = parseDateInput(fechaFin);

  const [pedidosRows, inventario] = await Promise.all([
    loadPedidosRows(fi, ff),
    getRefaccionesInventario({ limit: 400 }),
  ]);

  const pedidos = buildPedidosPayload(pedidosRows);

  return {
    filtros: { fechaInicio: fi, fechaFin: ff },
    fuentes: {
      catalogo: 'PAR_PARTES',
      existencias: 'PAR_ALMACEN (+ PAR_PARTES)',
      pedidos: 'PAR_PEDIDO / PAR_PEDIDETA',
      entradas: 'PAR_PEDENT / PAR_PEDENTDET (próximo)',
      mostrador: 'PAR_PEDMOST (próximo)',
      sugeridos: 'PAR_PEDSUGERIDO (próximo)',
    },
    inventario,
    pedidos: {
      fuente: pedidos.fuente,
      summary: pedidos.summary,
      porStatus: pedidos.porStatus,
      porTipo: pedidos.porTipo,
      porProveedor: pedidos.porProveedor,
      pedidos: pedidos.pedidos,
    },
    pendientes: {
      fuente: 'PAR_PEDIDO / PAR_PEDIDETA · cant. pedida > surtida',
      summary: {
        total: pedidos.pendientes.length,
        lineasPendientes: pedidos.summary.lineasPendientes,
        importe: round2(pedidos.pendientes.reduce((s, p) => s + Number(p.importeTotal || 0), 0)),
      },
      pedidos: pedidos.pendientes,
    },
  };
}

module.exports = {
  getRefaccionesPedidos,
  getRefaccionesInventario,
  getRefaccionesDashboard,
};
