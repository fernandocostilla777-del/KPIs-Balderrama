const { query } = require('../db');

/**
 * Libro de ventas (UNI_TEMLIBROVENTAS) = columnas del reporte financiero:
 * SUBTOTAL, IVA, TOTAL, PEN_ISAN, pen_costo1, BONIFICACION, PARTICIPACION,
 * COSTO (neto), COSTOIVA, VEH_MISELANEOS.
 * Utilidad = SUBTOTAL − COSTO NETO − GASTOS.
 */
const VENTAS_BASE_CTE = `
  WITH ventas_base AS (
    SELECT
      v.VTE_DOCTO,
      v.VTE_SERIE,
      v.VTE_FECHDOCTO,
      v.VTE_FORMAPAGO,
      ISNULL(NULLIF(LTRIM(RTRIM(lv.TIPOAUTO)), ''), veh.VEH_TIPOAUTO) AS modelo,
      ISNULL(NULLIF(LTRIM(RTRIM(lv.PER_ESTADO)), ''), C.PAR_DESCRIP1) AS estado,
      COALESCE(
        NULLIF(lv.SUBTOTAL, 0),
        NULLIF(veh.VEH_SSUBTOTAL, 0),
        det.ventaSubtotal,
        CASE WHEN ISNULL(v.VTE_IMPORTEMON, 0) > 0 THEN ROUND(v.VTE_IMPORTEMON / 1.16, 2) ELSE 0 END
      ) AS ventaSubtotal,
      COALESCE(
        NULLIF(lv.IVA, 0),
        NULLIF(veh.VEH_SIVA, 0),
        CASE WHEN ISNULL(lv.TOTAL, 0) > 0 AND ISNULL(lv.SUBTOTAL, 0) > 0 THEN lv.TOTAL - lv.SUBTOTAL ELSE 0 END,
        CASE WHEN ISNULL(v.VTE_IMPORTEMON, 0) > 0 THEN ROUND(v.VTE_IMPORTEMON - (v.VTE_IMPORTEMON / 1.16), 2) ELSE 0 END
      ) AS ventaIva,
      COALESCE(
        NULLIF(lv.TOTAL, 0),
        NULLIF(v.VTE_IMPORTEMON, 0),
        NULLIF(veh.VEH_IMPFACT, 0),
        NULLIF(veh.VEH_VENTA, 0),
        0
      ) AS ventaTotal,
      ISNULL(lv.PEN_ISAN, ISNULL(veh.VEH_ISAN, 0)) AS ventaIsan,
      COALESCE(NULLIF(lv.pen_costo1, 0), NULLIF(veh.VEH_COSTO1, 0), NULLIF(det.costoDet, 0), 0) AS costoMiCosto,
      ISNULL(lv.BONIFICACION, ISNULL(veh.VEH_REBATE, 0)) AS bonificacion,
      ISNULL(lv.PARTICIPACION, ISNULL(veh.VEH_PARTICIP, 0)) AS participacion,
      COALESCE(
        NULLIF(lv.COSTO, 0),
        NULLIF(lv.pen_costo1, 0) - ISNULL(lv.BONIFICACION, 0) - ISNULL(lv.PARTICIPACION, 0),
        NULLIF(veh.VEH_COSTO1, 0) - ISNULL(veh.VEH_REBATE, 0) - ISNULL(veh.VEH_PARTICIP, 0),
        0
      ) AS costoNeto,
      ISNULL(lv.COSTOIVA, 0) AS costoIva,
      ISNULL(lv.VEH_MISELANEOS, ISNULL(veh.VEH_MISELANEOS, 0)) AS gastos,
      CASE WHEN v.VTE_FORMAPAGO IN ('FLOT', 'FLOTGMF') THEN 1 ELSE 0 END AS isFlotilla,
      CASE WHEN lv.VTE_DOCTO IS NOT NULL THEN 1 ELSE 0 END AS tieneLibro,
      RTRIM(LTRIM(
        ISNULL(cli.PER_NOMRAZON, '') + ' ' + ISNULL(cli.PER_PATERNO, '') + ' ' + ISNULL(cli.PER_MATERNO, '')
      )) AS cliente,
      veh.VEH_ANMODELO AS anioModelo
    FROM ADE_VTAFI v
    INNER JOIN SER_VEHICULO veh
      ON veh.VEH_NUMSERIE = v.VTE_SERIE
      AND veh.VEH_NOINVENTA > 0
    INNER JOIN PER_PERSONAS cli ON cli.PER_IDPERSONA = v.VTE_IDCLIENTE
    LEFT JOIN PNC_PARAMETR C ON C.PAR_TIPOPARA = 'EO' AND C.PAR_IDENPARA = cli.PER_ESTADO
    LEFT JOIN UNI_TEMLIBROVENTAS lv
      ON lv.VTE_DOCTO = v.VTE_DOCTO
      AND lv.VTE_ORGSTATUS = 'I'
    LEFT JOIN (
      SELECT
        VTD_IDDOCTO,
        VTD_TIPODOCTO,
        MAX(NULLIF(VTD_PRECIOUNITARIO, 0)) AS ventaSubtotal,
        SUM(ISNULL(NULLIF(VTD_COSTO, 0), 0)) AS costoDet
      FROM ADE_VTAFIDET
      GROUP BY VTD_IDDOCTO, VTD_TIPODOCTO
    ) det ON det.VTD_IDDOCTO = v.VTE_DOCTO AND det.VTD_TIPODOCTO = v.VTE_TIPODOCTO
    WHERE v.VTE_TIPODOCTO = 'A'
      AND v.VTE_STATUS = 'I'
      AND veh.VEH_SITUACION = 'VEN'
      AND v.VTE_FORMAPAGO NOT IN ('VENTAMRS', 'VTACON')
  ),
  ventas AS (
    SELECT
      *,
      CASE
        WHEN tieneLibro = 1 OR costoNeto > 0
        THEN ventaSubtotal - costoNeto - gastos
        ELSE NULL
      END AS utilidad
    FROM ventas_base
  )
`;

function buildVentasDateClause(fechaInicio, fechaFin) {
  if (!fechaInicio || !fechaFin) return { clause: '', params: {} };
  return {
    clause: `AND CONVERT(DATE, v.VTE_FECHDOCTO, 103) >= @fechaInicio AND CONVERT(DATE, v.VTE_FECHDOCTO, 103) <= @fechaFin`,
    params: { fechaInicio, fechaFin },
  };
}

function pct(part, total) {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

function mapSummary(row) {
  const units = Number(row.units || 0);
  const ventaSubtotal = Number(row.ventaSubtotal || 0);
  const ventaTotal = Number(row.ventaTotal || 0);
  const ventaIva = ventaTotal > ventaSubtotal ? ventaTotal - ventaSubtotal : Number(row.ventaIva || 0);
  const utilidad = Number(row.utilidad || 0);
  const costoNeto = Number(row.costoNeto || 0);
  const flotillaUnits = Number(row.flotillaUnits || 0);
  const conCosto = Number(row.conCosto || 0);

  return {
    units,
    ventaSubtotal,
    ventaIva,
    ventaTotal,
    ventaIsan: Number(row.ventaIsan || 0),
    costoMiCosto: Number(row.costoMiCosto || 0),
    bonificacion: Number(row.bonificacion || 0),
    participacion: Number(row.participacion || 0),
    costoNeto,
    costoIva: Number(row.costoIva || 0),
    gastos: Number(row.gastos || 0),
    utilidad,
    conCosto,
    sinCosto: Math.max(0, units - conCosto),
    marginPct: pct(utilidad, ventaSubtotal),
    retailUnits: Math.max(0, units - flotillaUnits),
    flotillaUnits,
    ticketPromedio: units ? ventaSubtotal / units : 0,
  };
}

function mapDailyRow(row) {
  const raw = row.fecha;
  const fecha = raw instanceof Date
    ? raw.toISOString().slice(0, 10)
    : String(raw).slice(0, 10);
  const ventaSubtotal = Number(row.ventaSubtotal || 0);
  const costoNeto = Number(row.costoNeto || 0);
  const utilidad = Number(row.utilidad || 0);
  const units = Number(row.units || 0);

  return {
    fecha,
    units,
    ventaSubtotal,
    costoNeto,
    utilidad,
    margenPct: pct(utilidad, ventaSubtotal),
  };
}

function mapUnitRow(row) {
  const ventaSubtotal = Number(row.ventaSubtotal || 0);
  const costoNeto = Number(row.costoNeto || 0);
  const utilidad = row.utilidad == null ? null : Number(row.utilidad || 0);
  return {
    factura: row.factura,
    serie: row.serie,
    modelo: row.modelo || 'Sin modelo',
    anioModelo: row.anioModelo || '',
    cliente: (row.cliente || '').trim() || '—',
    estado: row.estado || '—',
    formaPago: row.formaPago || '—',
    flotilla: Boolean(row.isFlotilla),
    ventaSubtotal,
    costoNeto,
    gastos: Number(row.gastos || 0),
    utilidad,
    margenPct: utilidad != null ? pct(utilidad, ventaSubtotal) : null,
  };
}

async function loadDailySalesUnits({ fecha }) {
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new Error('fecha inválida (use YYYY-MM-DD).');
  }

  const rows = await query(`
    ${VENTAS_BASE_CTE}
    SELECT
      v.VTE_DOCTO AS factura,
      v.VTE_SERIE AS serie,
      v.modelo,
      v.anioModelo,
      v.cliente,
      v.estado,
      v.VTE_FORMAPAGO AS formaPago,
      v.isFlotilla,
      v.ventaSubtotal,
      v.costoNeto,
      v.gastos,
      v.utilidad
    FROM ventas v
    WHERE CONVERT(DATE, v.VTE_FECHDOCTO, 103) = @fecha
    ORDER BY v.ventaSubtotal DESC, v.VTE_DOCTO
  `, { fecha });

  const units = rows.map(mapUnitRow);
  const summary = units.reduce((acc, u) => ({
    units: acc.units + 1,
    ventaSubtotal: acc.ventaSubtotal + u.ventaSubtotal,
    costoNeto: acc.costoNeto + u.costoNeto,
    utilidad: acc.utilidad + (u.utilidad ?? 0),
  }), { units: 0, ventaSubtotal: 0, costoNeto: 0, utilidad: 0 });

  return {
    fecha,
    units,
    summary: {
      ...summary,
      margenPct: pct(summary.utilidad, summary.ventaSubtotal),
    },
  };
}

async function loadVentasNuevosFinancial({ fechaInicio, fechaFin }) {
  const { clause, params } = buildVentasDateClause(fechaInicio, fechaFin);

  const [[summary], monthlyTrend, topModels, byEstado, dailyBreakdown] = await Promise.all([
    query(`
      ${VENTAS_BASE_CTE}
      SELECT
        COUNT(*) AS units,
        ISNULL(SUM(ventaSubtotal), 0) AS ventaSubtotal,
        ISNULL(SUM(ventaIva), 0) AS ventaIva,
        ISNULL(SUM(ventaTotal), 0) AS ventaTotal,
        ISNULL(SUM(ventaIsan), 0) AS ventaIsan,
        ISNULL(SUM(costoMiCosto), 0) AS costoMiCosto,
        ISNULL(SUM(bonificacion), 0) AS bonificacion,
        ISNULL(SUM(participacion), 0) AS participacion,
        ISNULL(SUM(costoNeto), 0) AS costoNeto,
        ISNULL(SUM(costoIva), 0) AS costoIva,
        ISNULL(SUM(gastos), 0) AS gastos,
        ISNULL(SUM(utilidad), 0) AS utilidad,
        ISNULL(SUM(CASE WHEN utilidad IS NOT NULL THEN 1 ELSE 0 END), 0) AS conCosto,
        ISNULL(SUM(isFlotilla), 0) AS flotillaUnits
      FROM ventas v
      WHERE 1 = 1 ${clause}
    `, params),
    query(`
      ${VENTAS_BASE_CTE}
      SELECT
        YEAR(CONVERT(DATE, v.VTE_FECHDOCTO, 103)) AS yr,
        MONTH(CONVERT(DATE, v.VTE_FECHDOCTO, 103)) AS mo,
        COUNT(*) AS units,
        ISNULL(SUM(v.ventaSubtotal), 0) AS revenue
      FROM ventas v
      WHERE 1 = 1 ${clause}
      GROUP BY
        YEAR(CONVERT(DATE, v.VTE_FECHDOCTO, 103)),
        MONTH(CONVERT(DATE, v.VTE_FECHDOCTO, 103))
      ORDER BY yr, mo
    `, params),
    query(`
      ${VENTAS_BASE_CTE}
      SELECT TOP 10
        ISNULL(NULLIF(LTRIM(RTRIM(v.modelo)), ''), 'Sin modelo') AS model,
        COUNT(*) AS unitsSold,
        ISNULL(SUM(v.ventaSubtotal), 0) AS revenue
      FROM ventas v
      WHERE 1 = 1 ${clause}
      GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(v.modelo)), ''), 'Sin modelo')
      ORDER BY unitsSold DESC, revenue DESC
    `, params),
    query(`
      ${VENTAS_BASE_CTE}
      SELECT TOP 8
        ISNULL(NULLIF(LTRIM(RTRIM(v.estado)), ''), 'Sin estado') AS state,
        COUNT(*) AS units,
        ISNULL(SUM(v.ventaSubtotal), 0) AS revenue
      FROM ventas v
      WHERE 1 = 1 ${clause}
      GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(v.estado)), ''), 'Sin estado')
      ORDER BY units DESC
    `, params),
    query(`
      ${VENTAS_BASE_CTE}
      SELECT
        CONVERT(DATE, v.VTE_FECHDOCTO, 103) AS fecha,
        COUNT(*) AS units,
        ISNULL(SUM(v.ventaSubtotal), 0) AS ventaSubtotal,
        ISNULL(SUM(v.costoNeto), 0) AS costoNeto,
        ISNULL(SUM(v.utilidad), 0) AS utilidad
      FROM ventas v
      WHERE 1 = 1 ${clause}
      GROUP BY CONVERT(DATE, v.VTE_FECHDOCTO, 103)
      ORDER BY fecha
    `, params),
  ]);

  return {
    summary: mapSummary(summary),
    monthlyTrend,
    dailyBreakdown: dailyBreakdown.map(mapDailyRow),
    topModels,
    byEstado,
  };
}

module.exports = {
  loadVentasNuevosFinancial,
  loadDailySalesUnits,
  mapSummary,
  mapDailyRow,
  mapUnitRow,
  VENTAS_BASE_CTE,
  buildVentasDateClause,
  pct,
};
