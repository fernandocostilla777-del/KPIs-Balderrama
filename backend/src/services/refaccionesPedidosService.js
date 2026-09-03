const { query } = require('../db');
const { getCatalogKpis, sumPrefixesForPeriod } = require('./accountingCatalogKpiService');
const { INCOME_CATALOG, COST_CATALOG } = require('../config/accountCatalogMapping');

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

function fechaValidaPedMostSql(alias = 'm') {
  return `
    ${alias}.PMM_FECHA IS NOT NULL
    AND LEN(RTRIM(${alias}.PMM_FECHA)) = 10
    AND SUBSTRING(${alias}.PMM_FECHA, 3, 1) = '/'
    AND SUBSTRING(${alias}.PMM_FECHA, 6, 1) = '/'
    AND ISNUMERIC(SUBSTRING(${alias}.PMM_FECHA, 1, 2)) = 1
    AND ISNUMERIC(SUBSTRING(${alias}.PMM_FECHA, 4, 2)) = 1
    AND ISNUMERIC(SUBSTRING(${alias}.PMM_FECHA, 7, 4)) = 1
  `;
}

/**
 * Ventas de mostrador operativas (PAR_PEDMOST).
 * Contable oficial: CON_CTAS 0481–0484 vía getVentasFinancieras.
 */
async function getVentasMostrador({ fechaInicio, fechaFin, limit = 300 } = {}) {
  const fi = parseDateInput(fechaInicio);
  const ff = parseDateInput(fechaFin);
  const desde = toYmdCompact(fi);
  const hasta = toYmdCompact(ff);
  const top = Math.min(Math.max(Number(limit) || 300, 50), 1000);

  const rows = await query(`
    SELECT TOP (${top})
      CAST(m.PMM_NUMERO AS varchar(20)) AS numero,
      m.PMM_FECHA AS fecha,
      RTRIM(ISNULL(m.PMM_STATUS, '')) AS status,
      RTRIM(ISNULL(m.PMM_COTPED, '')) AS cotPed,
      RTRIM(ISNULL(CAST(m.PMM_TIPMOV AS varchar(20)), '')) AS tipMov,
      CAST(ISNULL(m.PMM_IDCLIENTE, 0) AS varchar(20)) AS cliente,
      RTRIM(ISNULL(m.PMM_IDALMA, '')) AS almacen,
      ISNULL(m.PMM_TOTAL, 0) AS total,
      ISNULL(m.PMM_IVA, 0) AS iva
    FROM PAR_PEDMOST m
    WHERE ${fechaValidaPedMostSql('m')}
      AND UPPER(LTRIM(RTRIM(ISNULL(m.PMM_COTPED, '')))) = 'PEDIDO'
      AND CONVERT(datetime, m.PMM_FECHA, 103) >= CONVERT(datetime, @desde, 112)
      AND CONVERT(datetime, m.PMM_FECHA, 103) < DATEADD(day, 1, CONVERT(datetime, @hasta, 112))
    ORDER BY CONVERT(datetime, m.PMM_FECHA, 103) DESC, m.PMM_NUMERO DESC
  `, { desde, hasta });

  const agg = await query(`
    SELECT
      COUNT(*) AS pedidos,
      SUM(ISNULL(m.PMM_TOTAL, 0)) AS importe,
      SUM(ISNULL(m.PMM_IVA, 0)) AS iva,
      SUM(CASE WHEN UPPER(RTRIM(ISNULL(m.PMM_STATUS, ''))) = 'P' THEN 1 ELSE 0 END) AS pendientes,
      SUM(CASE WHEN UPPER(RTRIM(ISNULL(m.PMM_STATUS, ''))) IN ('C', 'X') THEN 1 ELSE 0 END) AS cerrados,
      SUM(CASE WHEN UPPER(RTRIM(ISNULL(m.PMM_STATUS, ''))) = 'P' THEN ISNULL(m.PMM_TOTAL, 0) ELSE 0 END) AS importePendientes,
      SUM(CASE WHEN UPPER(RTRIM(ISNULL(m.PMM_STATUS, ''))) IN ('C', 'X') THEN ISNULL(m.PMM_TOTAL, 0) ELSE 0 END) AS importeCerrados
    FROM PAR_PEDMOST m
    WHERE ${fechaValidaPedMostSql('m')}
      AND UPPER(LTRIM(RTRIM(ISNULL(m.PMM_COTPED, '')))) = 'PEDIDO'
      AND CONVERT(datetime, m.PMM_FECHA, 103) >= CONVERT(datetime, @desde, 112)
      AND CONVERT(datetime, m.PMM_FECHA, 103) < DATEADD(day, 1, CONVERT(datetime, @hasta, 112))
  `, { desde, hasta });

  const a = agg[0] || {};
  const detalle = (rows || []).map((r) => ({
    numero: String(r.numero || '').trim(),
    fecha: r.fecha,
    status: String(r.status || '').trim().toUpperCase(),
    cotPed: String(r.cotPed || '').trim(),
    tipMov: String(r.tipMov || '').trim() || null,
    cliente: String(r.cliente || '').trim() || null,
    almacen: String(r.almacen || '').trim() || null,
    total: round2(r.total),
    iva: round2(r.iva),
    neto: round2(Number(r.total || 0) - Number(r.iva || 0)),
  }));

  return {
    fuente: 'PAR_PEDMOST',
    nota: 'Pedidos de mostrador (excluye cotizaciones). Status P=pendiente; C/X=cerrados/facturados según DMS.',
    summary: {
      pedidos: Number(a.pedidos || 0),
      importe: round2(a.importe),
      iva: round2(a.iva),
      pendientes: Number(a.pendientes || 0),
      cerrados: Number(a.cerrados || 0),
      importePendientes: round2(a.importePendientes),
      importeCerrados: round2(a.importeCerrados),
    },
    detalle,
  };
}

/**
 * Ventas financieras de refacciones desde catálogo contable (0481–0484 / costos 066x).
 */
async function getVentasFinancieras({ fechaInicio, fechaFin } = {}) {
  const fi = parseDateInput(fechaInicio);
  const ff = parseDateInput(fechaFin);

  const subLines = INCOME_CATALOG.refacciones?.subLines || [];
  const [kpis, ...ingresosCanal] = await Promise.all([
    getCatalogKpis({
      fechaInicio: fi,
      fechaFin: ff,
      sucursal: 'todos',
      area: 'refacciones',
      includeFi: false,
    }),
    ...subLines.map(async (sub) => ({
      key: sub.key,
      label: sub.label,
      prefixIngreso: sub.prefix,
      ingreso: round2(await sumPrefixesForPeriod(fi, ff, [sub.prefix], true)),
    })),
  ]);

  const s = kpis.summary || {};
  const ventas = round2(s.ventasTotales);
  const canales = ingresosCanal
    .filter((c) => Math.abs(c.ingreso) > 0.01)
    .map((c) => ({
      ...c,
      pctVentas: ventas ? round2((c.ingreso / ventas) * 100) : 0,
    }));

  return {
    fuente: 'CON_CTAS · catálogo 0481–0484 / costos 066x',
    available: kpis.available !== false,
    methodology: kpis.methodology,
    summary: {
      ventas,
      costo: round2(s.costoVentas),
      utilidadBruta: round2(s.utilidadBruta),
      margenBrutoPct: Number(s.margenBrutoPct || 0),
      gastosOperacion: round2(s.gastosOperacion),
      utilidadOperacion: round2(s.utilidadOperacion),
      margenOperacionPct: Number(s.margenOperacionPct || 0),
    },
    canales,
    incomeLines: kpis.incomeLines || [],
    costLines: kpis.costLines || [],
    costCatalogPrefixes: COST_CATALOG.refacciones?.prefixes || [],
  };
}

function fechaValidaMovSql(alias = 'm') {
  return `
    ${alias}.Mov_Fecha IS NOT NULL
    AND LEN(RTRIM(${alias}.Mov_Fecha)) = 10
    AND SUBSTRING(${alias}.Mov_Fecha, 3, 1) = '/'
    AND SUBSTRING(${alias}.Mov_Fecha, 6, 1) = '/'
    AND ISNUMERIC(SUBSTRING(${alias}.Mov_Fecha, 1, 2)) = 1
    AND ISNUMERIC(SUBSTRING(${alias}.Mov_Fecha, 4, 2)) = 1
    AND ISNUMERIC(SUBSTRING(${alias}.Mov_Fecha, 7, 4)) = 1
  `;
}

function mapParteRow(r, extras = {}) {
  return {
    parte: String(r.parte || '').trim(),
    descripcion: String(r.descripcion || '').trim() || 'Sin descripción',
    ...extras,
  };
}

/**
 * Alertas dinámicas de control de inventario / ventas para la vista de pedidos.
 * Fuentes: PAR_ALMACEN (stock trabado, min/max) + PAR_MOVTOS/PAR_MOVDET (salidas) + PEDIDETA pendientes.
 */
async function getInventarioAlertas({ fechaInicio, fechaFin, limit = 8 } = {}) {
  const fi = parseDateInput(fechaInicio);
  const ff = parseDateInput(fechaFin);
  const desde = toYmdCompact(fi);
  const hasta = toYmdCompact(ff);
  const top = Math.min(Math.max(Number(limit) || 8, 5), 15);

  const costoUnit = `ISNULL(NULLIF(d.Mod_CunProm, 0), ISNULL(d.mod_ctopromact, 0))`;

  const [
    stockRules,
    trabadoRows,
    topVentaRows,
    topUtilRows,
    pendParteRows,
    resumenSalidas,
  ] = await Promise.all([
    query(`
      SELECT
        SUM(CASE WHEN ISNULL(a.ALM_EXISTEN,0) > 0 THEN 1 ELSE 0 END) AS conStock,
        SUM(CASE WHEN ISNULL(a.ALM_EXISTEN,0) < ISNULL(a.ALM_MIN,0) AND ISNULL(a.ALM_MIN,0) > 0 THEN 1 ELSE 0 END) AS bajoMin,
        SUM(CASE WHEN ISNULL(a.ALM_MAX,0) > 0 AND ISNULL(a.ALM_EXISTEN,0) > ISNULL(a.ALM_MAX,0) THEN 1 ELSE 0 END) AS sobreMax,
        SUM(CASE
          WHEN ISNULL(a.ALM_EXISTEN,0) > 0 AND (
            a.ALM_FECHULTVEN IS NULL OR LTRIM(RTRIM(a.ALM_FECHULTVEN)) = ''
            OR (LEN(RTRIM(a.ALM_FECHULTVEN)) = 10
                AND CONVERT(datetime, a.ALM_FECHULTVEN, 103) < DATEADD(day, -90, GETDATE()))
          ) THEN 1 ELSE 0 END) AS trabados90,
        SUM(CASE
          WHEN ISNULL(a.ALM_EXISTEN,0) > 0 AND (
            a.ALM_FECHULTVEN IS NULL OR LTRIM(RTRIM(a.ALM_FECHULTVEN)) = ''
            OR (LEN(RTRIM(a.ALM_FECHULTVEN)) = 10
                AND CONVERT(datetime, a.ALM_FECHULTVEN, 103) < DATEADD(day, -90, GETDATE()))
          ) THEN ISNULL(a.ALM_EXISTEN,0) * ISNULL(a.ALM_CTOPROM,0) ELSE 0 END) AS costoTrabado90
      FROM PAR_ALMACEN a
      WHERE ISNULL(a.ALM_STATUS, 'A') = 'A'
    `),
    query(`
      SELECT TOP (${top})
        LTRIM(RTRIM(a.ALM_IDPARTE)) AS parte,
        LTRIM(RTRIM(ISNULL(p.PTS_DESPARTE, ''))) AS descripcion,
        LTRIM(RTRIM(a.ALM_IDALMA)) AS almacen,
        ISNULL(a.ALM_EXISTEN, 0) AS existencia,
        ISNULL(a.ALM_CTOPROM, 0) AS costoPromedio,
        ISNULL(a.ALM_EXISTEN, 0) * ISNULL(a.ALM_CTOPROM, 0) AS costo,
        a.ALM_FECHULTVEN AS ultimaVenta,
        CASE
          WHEN a.ALM_FECHULTVEN IS NULL OR LTRIM(RTRIM(a.ALM_FECHULTVEN)) = '' THEN 9999
          WHEN LEN(RTRIM(a.ALM_FECHULTVEN)) = 10
            THEN DATEDIFF(day, CONVERT(datetime, a.ALM_FECHULTVEN, 103), GETDATE())
          ELSE 9999
        END AS diasSinVenta
      FROM PAR_ALMACEN a
      LEFT JOIN PAR_PARTES p
        ON LTRIM(RTRIM(p.PTS_IDPARTE)) = LTRIM(RTRIM(a.ALM_IDPARTE))
      WHERE ISNULL(a.ALM_STATUS, 'A') = 'A'
        AND ISNULL(a.ALM_EXISTEN, 0) > 0
        AND (
          a.ALM_FECHULTVEN IS NULL OR LTRIM(RTRIM(a.ALM_FECHULTVEN)) = ''
          OR (LEN(RTRIM(a.ALM_FECHULTVEN)) = 10
              AND CONVERT(datetime, a.ALM_FECHULTVEN, 103) < DATEADD(day, -90, GETDATE()))
        )
      ORDER BY ISNULL(a.ALM_EXISTEN, 0) * ISNULL(a.ALM_CTOPROM, 0) DESC
    `),
    query(`
      SELECT TOP (${top})
        LTRIM(RTRIM(d.Mod_Idparte)) AS parte,
        MAX(LTRIM(RTRIM(ISNULL(p.PTS_DESPARTE, '')))) AS descripcion,
        SUM(ABS(ISNULL(d.Mod_Cantidad, 0))) AS cantidad,
        SUM(ISNULL(d.Mod_Total, 0)) AS venta,
        SUM(ABS(ISNULL(d.Mod_Cantidad, 0)) * ${costoUnit}) AS costo
      FROM PAR_MOVTOS m
      INNER JOIN PAR_MOVDET d
        ON d.Mod_TipoMov = m.Mov_TipoMov AND d.Mod_Numero = m.Mov_Numero
      LEFT JOIN PAR_PARTES p
        ON LTRIM(RTRIM(p.PTS_IDPARTE)) = LTRIM(RTRIM(d.Mod_Idparte))
      WHERE ${fechaValidaMovSql('m')}
        AND CONVERT(datetime, m.Mov_Fecha, 103) >= CONVERT(datetime, @desde, 112)
        AND CONVERT(datetime, m.Mov_Fecha, 103) < DATEADD(day, 1, CONVERT(datetime, @hasta, 112))
        AND ISNULL(d.Mod_Cantidad, 0) < 0
        AND ISNULL(d.Mod_Total, 0) > 0
      GROUP BY LTRIM(RTRIM(d.Mod_Idparte))
      ORDER BY SUM(ISNULL(d.Mod_Total, 0)) DESC
    `, { desde, hasta }),
    query(`
      SELECT TOP (${top})
        LTRIM(RTRIM(d.Mod_Idparte)) AS parte,
        MAX(LTRIM(RTRIM(ISNULL(p.PTS_DESPARTE, '')))) AS descripcion,
        SUM(ABS(ISNULL(d.Mod_Cantidad, 0))) AS cantidad,
        SUM(ISNULL(d.Mod_Total, 0)) AS venta,
        SUM(ABS(ISNULL(d.Mod_Cantidad, 0)) * ${costoUnit}) AS costo,
        SUM(ISNULL(d.Mod_Total, 0) - ABS(ISNULL(d.Mod_Cantidad, 0)) * ${costoUnit}) AS utilidad
      FROM PAR_MOVTOS m
      INNER JOIN PAR_MOVDET d
        ON d.Mod_TipoMov = m.Mov_TipoMov AND d.Mod_Numero = m.Mov_Numero
      LEFT JOIN PAR_PARTES p
        ON LTRIM(RTRIM(p.PTS_IDPARTE)) = LTRIM(RTRIM(d.Mod_Idparte))
      WHERE ${fechaValidaMovSql('m')}
        AND CONVERT(datetime, m.Mov_Fecha, 103) >= CONVERT(datetime, @desde, 112)
        AND CONVERT(datetime, m.Mov_Fecha, 103) < DATEADD(day, 1, CONVERT(datetime, @hasta, 112))
        AND ISNULL(d.Mod_Cantidad, 0) < 0
        AND ISNULL(d.Mod_Total, 0) > 0
      GROUP BY LTRIM(RTRIM(d.Mod_Idparte))
      HAVING SUM(ISNULL(d.Mod_Total, 0) - ABS(ISNULL(d.Mod_Cantidad, 0)) * ${costoUnit}) > 0
      ORDER BY SUM(ISNULL(d.Mod_Total, 0) - ABS(ISNULL(d.Mod_Cantidad, 0)) * ${costoUnit}) DESC
    `, { desde, hasta }),
    query(`
      SELECT TOP (${top})
        LTRIM(RTRIM(d.PDT_IDPARTE)) AS parte,
        MAX(LTRIM(RTRIM(ISNULL(NULLIF(d.PDT_DESPARTE, ''), p.PTS_DESPARTE)))) AS descripcion,
        SUM(ISNULL(d.PDT_CANTIDAD, 0) - ISNULL(d.PDT_CANTSURT, 0)) AS pendiente,
        SUM(ISNULL(d.PDT_TOTAL, 0)) AS importe,
        COUNT(DISTINCT d.PDT_NUMERO) AS pedidos
      FROM PAR_PEDIDO ped
      INNER JOIN PAR_PEDIDETA d ON d.PDT_NUMERO = ped.PED_NUMERO
      LEFT JOIN PAR_PARTES p
        ON LTRIM(RTRIM(p.PTS_IDPARTE)) = LTRIM(RTRIM(d.PDT_IDPARTE))
      WHERE ISNULL(ped.PED_STATUS, '') <> 'C'
        AND ISNULL(d.PDT_CANTIDAD, 0) > ISNULL(d.PDT_CANTSURT, 0)
      GROUP BY LTRIM(RTRIM(d.PDT_IDPARTE))
      ORDER BY SUM(ISNULL(d.PDT_CANTIDAD, 0) - ISNULL(d.PDT_CANTSURT, 0)) DESC
    `),
    query(`
      SELECT
        COUNT(DISTINCT LTRIM(RTRIM(d.Mod_Idparte))) AS partes,
        SUM(ABS(ISNULL(d.Mod_Cantidad, 0))) AS cantidad,
        SUM(ISNULL(d.Mod_Total, 0)) AS venta,
        SUM(ISNULL(d.Mod_Total, 0) - ABS(ISNULL(d.Mod_Cantidad, 0)) * ${costoUnit}) AS utilidad
      FROM PAR_MOVTOS m
      INNER JOIN PAR_MOVDET d
        ON d.Mod_TipoMov = m.Mov_TipoMov AND d.Mod_Numero = m.Mov_Numero
      WHERE ${fechaValidaMovSql('m')}
        AND CONVERT(datetime, m.Mov_Fecha, 103) >= CONVERT(datetime, @desde, 112)
        AND CONVERT(datetime, m.Mov_Fecha, 103) < DATEADD(day, 1, CONVERT(datetime, @hasta, 112))
        AND ISNULL(d.Mod_Cantidad, 0) < 0
        AND ISNULL(d.Mod_Total, 0) > 0
    `, { desde, hasta }),
  ]);

  const rules = stockRules[0] || {};
  const salidas = resumenSalidas[0] || {};

  const stockTrabado = (trabadoRows || []).map((r) => mapParteRow(r, {
    almacen: String(r.almacen || '').trim(),
    existencia: round2(r.existencia),
    costoPromedio: round2(r.costoPromedio),
    costo: round2(r.costo),
    ultimaVenta: r.ultimaVenta || null,
    diasSinVenta: Number(r.diasSinVenta || 0),
  }));

  const topVendidos = (topVentaRows || []).map((r) => {
    const venta = round2(r.venta);
    const costo = round2(r.costo);
    const utilidad = round2(venta - costo);
    return mapParteRow(r, {
      cantidad: round2(r.cantidad),
      venta,
      costo,
      utilidad,
      margenPct: venta ? round2((utilidad / venta) * 100) : 0,
    });
  });

  const topUtilidad = (topUtilRows || []).map((r) => {
    const venta = round2(r.venta);
    const costo = round2(r.costo);
    const utilidad = round2(r.utilidad);
    return mapParteRow(r, {
      cantidad: round2(r.cantidad),
      venta,
      costo,
      utilidad,
      margenPct: venta ? round2((utilidad / venta) * 100) : 0,
    });
  });

  const pendientesCompra = (pendParteRows || []).map((r) => mapParteRow(r, {
    pendiente: round2(r.pendiente),
    importe: round2(r.importe),
    pedidos: Number(r.pedidos || 0),
  }));

  const summary = {
    conStock: Number(rules.conStock || 0),
    bajoMin: Number(rules.bajoMin || 0),
    sobreMax: Number(rules.sobreMax || 0),
    trabados90: Number(rules.trabados90 || 0),
    costoTrabado90: round2(rules.costoTrabado90),
    partesVendidas: Number(salidas.partes || 0),
    cantidadVendida: round2(salidas.cantidad),
    ventaPeriodo: round2(salidas.venta),
    utilidadPeriodo: round2(salidas.utilidad),
  };

  const alerts = [];
  if (summary.trabados90 > 0) {
    const top = stockTrabado[0];
    alerts.push({
      id: 'stock-trabado',
      severity: summary.costoTrabado90 > 500000 ? 'critical' : 'warning',
      icon: 'inventory_2',
      title: 'Inventario trabado (+90 días sin venta)',
      summary: `${summary.trabados90.toLocaleString('es-MX')} partes · capital ${summary.costoTrabado90.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}`,
      detail: top
        ? `Mayor inmovilizado: ${top.parte} · ${top.descripcion} (${top.diasSinVenta} días, ${top.costo.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })})`
        : 'Revisar existencias sin rotación.',
      action: 'Evitar recompra de estas partes y evaluar liquidación o traspaso.',
    });
  }
  if (summary.bajoMin > 0) {
    alerts.push({
      id: 'bajo-minimo',
      severity: summary.bajoMin > 200 ? 'critical' : 'warning',
      icon: 'trending_down',
      title: 'Stock bajo el mínimo',
      summary: `${summary.bajoMin.toLocaleString('es-MX')} partes por debajo de ALM_MIN`,
      detail: 'Riesgo de quiebre en mostrador/taller si no se surten pedidos a tiempo.',
      action: 'Priorizar pedidos abiertos de estas partes.',
    });
  }
  if (summary.sobreMax > 0) {
    alerts.push({
      id: 'sobre-maximo',
      severity: 'info',
      icon: 'trending_up',
      title: 'Stock sobre el máximo',
      summary: `${summary.sobreMax.toLocaleString('es-MX')} partes arriba de ALM_MAX`,
      detail: 'Sobreinventario: frena nuevos pedidos de compra en esas líneas.',
      action: 'Congelar reórdenes hasta bajar a máximo.',
    });
  }
  if (topVendidos[0]) {
    const t = topVendidos[0];
    alerts.push({
      id: 'mejor-vendido',
      severity: 'success',
      icon: 'local_fire_department',
      title: 'Lo mejor vendido del periodo',
      summary: `${t.parte} · ${t.descripcion}`,
      detail: `${t.cantidad.toLocaleString('es-MX')} pzas · venta ${t.venta.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}`,
      action: 'Asegurar disponibilidad y surtido de pedidos de compra relacionados.',
    });
  }
  if (topUtilidad[0]) {
    const t = topUtilidad[0];
    alerts.push({
      id: 'mejor-utilidad',
      severity: 'success',
      icon: 'payments',
      title: 'Mayor utilidad del periodo',
      summary: `${t.parte} · ${t.descripcion}`,
      detail: `Utilidad ${t.utilidad.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })} · margen ${t.margenPct}%`,
      action: 'Proteger stock y evitar rupturas en esta línea de alto margen.',
    });
  }
  if (pendientesCompra[0]) {
    const t = pendientesCompra[0];
    alerts.push({
      id: 'compra-pendiente',
      severity: 'warning',
      icon: 'pending_actions',
      title: 'Compra trabada (pendiente de surtir)',
      summary: `${t.parte} · ${t.descripcion}`,
      detail: `${t.pendiente.toLocaleString('es-MX')} pzas en ${t.pedidos} pedido(s) · ${t.importe.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}`,
      action: 'Dar seguimiento a planta/proveedor para liberar el flujo.',
    });
  }

  return {
    fuente: 'PAR_ALMACEN · PAR_MOVTOS/PAR_MOVDET · PAR_PEDIDETA',
    nota: 'Salidas = movimientos con cantidad negativa y total > 0. Stock trabado = sin venta ≥ 90 días.',
    filtros: { fechaInicio: fi, fechaFin: ff },
    summary,
    alerts,
    stockTrabado,
    topVendidos,
    topUtilidad,
    pendientesCompra,
  };
}

/**
 * Dashboard completo de la sección Refacciones (PosVenta).
 */
async function getRefaccionesDashboard({ fechaInicio, fechaFin } = {}) {
  const fi = parseDateInput(fechaInicio);
  const ff = parseDateInput(fechaFin);
  const { getTraspasosEntreAlmacenes } = require('./inventoryPostventaService');

  const [pedidosRows, inventario, ventasFinancieras, ventasMostrador, alertas, traspasos] = await Promise.all([
    loadPedidosRows(fi, ff),
    getRefaccionesInventario({ limit: 400 }),
    getVentasFinancieras({ fechaInicio: fi, fechaFin: ff }),
    getVentasMostrador({ fechaInicio: fi, fechaFin: ff, limit: 300 }),
    getInventarioAlertas({ fechaInicio: fi, fechaFin: ff, limit: 8 }),
    getTraspasosEntreAlmacenes({ fechaInicio: fi, fechaFin: ff, limit: 60 }),
  ]);

  const pedidos = buildPedidosPayload(pedidosRows);

  return {
    filtros: { fechaInicio: fi, fechaFin: ff },
    fuentes: {
      catalogo: 'PAR_PARTES',
      existencias: 'PAR_ALMACEN (+ PAR_PARTES)',
      pedidos: 'PAR_PEDIDO / PAR_PEDIDETA',
      ventasFinancieras: 'CON_CTAS 0481–0484',
      ventasMostrador: 'PAR_PEDMOST',
      alertas: 'PAR_ALMACEN + PAR_MOVTOS/PAR_MOVDET',
      traspasos: 'PAR_MOVTOS/PAR_MOVDET · observación DE…A…',
      entradas: 'PAR_PEDENT / PAR_PEDENTDET (próximo)',
      sugeridos: 'PAR_PEDSUGERIDO (próximo)',
    },
    inventario,
    traspasos,
    ventas: {
      financieras: ventasFinancieras,
      mostrador: ventasMostrador,
    },
    alertas,
    pedidos: {
      fuente: pedidos.fuente,
      summary: pedidos.summary,
      porStatus: pedidos.porStatus,
      porTipo: pedidos.porTipo,
      porProveedor: pedidos.porProveedor,
      pedidos: pedidos.pedidos,
      alertas,
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
  getVentasFinancieras,
  getVentasMostrador,
  getInventarioAlertas,
  getRefaccionesDashboard,
};
