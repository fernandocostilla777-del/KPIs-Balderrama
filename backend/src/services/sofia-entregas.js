const { getPool, sql } = require('../db');

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/** Caché corta: Consultar ventas y Financiamiento comparten la misma consulta SOFIA. */
const ENTREGAS_CACHE_TTL_MS = 5 * 60 * 1000;
const entregasCache = new Map();
const entregasInflight = new Map();

/** Timbrados SOFIA: excluye flotilla contado (FLOT); sí incluye Flotilla GMF (FLOTGMF). */
function isFlotillaExcluidaSofia(row) {
  const forma = String(row.FORMAPAGO_ORIGINAL || row.VTE_FORMAPAGO || '').trim().toUpperCase();
  if (forma === 'FLOTGMF') return false;
  if (forma === 'FLOT') return true;
  // Sin forma de pago: no excluir (puede ser retail u otro canal)
  return false;
}

function excludeFlotillaContadoSofia(rows = []) {
  return rows.filter((row) => !isFlotillaExcluidaSofia(row));
}

function parseDateInput(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Fecha invalida. Use formato YYYY-MM-DD.');
  }
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Fecha invalida.');
  }
  return date;
}

function buildMonthRange(inicio, fin) {
  const months = [];
  const cursor = new Date(inicio.getFullYear(), inicio.getMonth(), 1);
  const end = new Date(fin.getFullYear(), fin.getMonth(), 1);

  while (cursor <= end) {
    const month = cursor.getMonth() + 1;
    const year = cursor.getFullYear();
    months.push({
      key: `${year}-${String(month).padStart(2, '0')}`,
      label: `${MESES[month - 1]} ${year}`,
      month,
      year,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
}

function parseFechaDoc(value) {
  if (!value) return null;
  const parts = String(value).trim().split('/');
  if (parts.length !== 3) return null;

  const day = Number(parts[0]);
  const month = Number(parts[1]);
  const year = Number(parts[2]);
  if (!day || !month || !year) return null;

  return {
    monthKey: `${year}-${String(month).padStart(2, '0')}`,
  };
}

function buildEntregasDetalleQuery() {
  return `
    SELECT
      s.SOF_FechAct,
      s.SOF_HoraAct,
      s.SOF_Factura,
      s.SOF_VIN,
      s.SOF_Pedido,
      s.SOF_NoTransaccion,
      s.SOF_IDSOFIA,
      s.SOF_Estatus,
      s.SOF_Evento,
      s.SOF_Resultado,
      s.SOF_ResDescrip,
      s.SOF_CveUSu,
      s.SOF_FechFact,
      COALESCE(
        NULLIF(LTRIM(RTRIM(s.SOF_FechFact)), ''),
        v.VTE_FECHDOCTO
      ) AS FECHA_PERIODO,
      LTRIM(RTRIM(
        ISNULL(p.PER_NOMRAZON, '') + ' ' +
        ISNULL(p.PER_PATERNO, '') + ' ' +
        ISNULL(p.PER_MATERNO, '')
      )) AS CLIENTE,
      ISNULL(prev.PREVIAS, 0) AS PREVIAS,
      veh.VEH_TIPOAUTO,
      COALESCE(v.VTE_FORMAPAGO, vByVin.VTE_FORMAPAGO) AS FORMAPAGO_ORIGINAL,
      CASE COALESCE(v.VTE_FORMAPAGO, vByVin.VTE_FORMAPAGO)
        WHEN 'FLOT' THEN 'FLOTILLA'
        WHEN 'FLOTGMF' THEN 'FLOTILLA GMF'
        ELSE NULL
      END AS TIPOVENTA
    FROM SOF_Venta_Cancel_DEMO s
    LEFT JOIN PER_PERSONAS p ON p.PER_IDPERSONA = s.SOF_IDCliente
    LEFT JOIN ADE_VTAFI v
      ON v.VTE_DOCTO = s.SOF_Factura
      AND v.VTE_TIPODOCTO = 'A'
    OUTER APPLY (
      SELECT TOP 1 a.VTE_FORMAPAGO
      FROM ADE_VTAFI a
      WHERE UPPER(LTRIM(RTRIM(a.VTE_SERIE))) = UPPER(LTRIM(RTRIM(s.SOF_VIN)))
        AND a.VTE_TIPODOCTO = 'A'
      ORDER BY CONVERT(DATE, a.VTE_FECHDOCTO, 103) DESC
    ) vByVin
    OUTER APPLY (
      SELECT TOP 1 sv.VEH_TIPOAUTO
      FROM SER_VEHICULO sv
      WHERE UPPER(LTRIM(RTRIM(sv.VEH_NUMSERIE))) = UPPER(LTRIM(RTRIM(s.SOF_VIN)))
      ORDER BY CASE WHEN sv.VEH_NOINVENTA > 0 THEN 0 ELSE 1 END, sv.VEH_FECHSALIDA DESC
    ) veh
    LEFT JOIN (
      SELECT
        UPPER(LTRIM(RTRIM(o.ORE_NUMSERIE))) AS SERIE,
        COUNT(*) AS PREVIAS
      FROM SER_ORDEN o
      WHERE LEFT(LTRIM(RTRIM(o.ORE_IDORDEN)), 1) = 'S'
        AND o.ORE_STATUS <> 'C'
        AND o.ORE_NUMSERIE IS NOT NULL
        AND LTRIM(RTRIM(o.ORE_NUMSERIE)) <> ''
      GROUP BY UPPER(LTRIM(RTRIM(o.ORE_NUMSERIE)))
    ) prev ON prev.SERIE = UPPER(LTRIM(RTRIM(s.SOF_VIN)))
    WHERE UPPER(LTRIM(RTRIM(s.SOF_OrigenOpe))) = 'ENTREGA'
      AND s.SOF_Resultado = 'EXITO'
      AND COALESCE(
        NULLIF(LTRIM(RTRIM(s.SOF_FechFact)), ''),
        v.VTE_FECHDOCTO
      ) IS NOT NULL
      AND LTRIM(RTRIM(COALESCE(
        NULLIF(LTRIM(RTRIM(s.SOF_FechFact)), ''),
        v.VTE_FECHDOCTO
      ))) <> ''
      AND CONVERT(DATE, COALESCE(
        NULLIF(LTRIM(RTRIM(s.SOF_FechFact)), ''),
        v.VTE_FECHDOCTO
      ), 103) BETWEEN @fechaInicio AND @fechaFin
      AND (
        COALESCE(v.VTE_FORMAPAGO, vByVin.VTE_FORMAPAGO) IS NULL
        OR UPPER(LTRIM(RTRIM(COALESCE(v.VTE_FORMAPAGO, vByVin.VTE_FORMAPAGO)))) <> 'FLOT'
      )
    ORDER BY
      CONVERT(DATE, COALESCE(
        NULLIF(LTRIM(RTRIM(s.SOF_FechFact)), ''),
        v.VTE_FECHDOCTO
      ), 103) DESC,
      s.SOF_HoraAct DESC,
      s.SOF_NoTransaccion DESC
  `;
}

/**
 * Cobertura SOFIA: sin flotilla contado (FLOT); sí cuenta Flotilla GMF (FLOTGMF).
 */
function computeCoberturaSofia(ventasRows = [], entregasRows = []) {
  const facturadas = excludeFlotillaContadoSofia(ventasRows);
  const reportadas = excludeFlotillaContadoSofia(entregasRows);
  const totalUnidadesFacturadas = facturadas.length;
  const totalReportadasSofia = reportadas.length;
  const totalUnidadesFacturadasNoTimbradas = Math.max(0, totalUnidadesFacturadas - totalReportadasSofia);
  const numeradorCobertura = totalReportadasSofia + totalUnidadesFacturadasNoTimbradas;

  return {
    totalUnidadesFacturadas,
    totalNotificacionesEntrega: totalReportadasSofia,
    totalUnidadesFacturadasNoTimbradas,
    numeradorCobertura,
    excluyeFlotillaContado: true,
    incluyeFlotillaGmf: true,
  };
}

function buildEntregasPorMes(registros, inicio, fin) {
  const monthRange = buildMonthRange(inicio, fin);
  const counts = Object.fromEntries(monthRange.map((m) => [m.key, 0]));

  for (const row of registros) {
    const fecha = parseFechaDoc(row.FECHA_PERIODO || row.SOF_FechFact);
    if (fecha && counts.hasOwnProperty(fecha.monthKey)) {
      counts[fecha.monthKey] += 1;
    }
  }

  return monthRange.map((m) => ({
    key: m.key,
    label: m.label,
    count: counts[m.key] || 0,
  }));
}

async function getNotificacionesEntrega({ fechaInicio, fechaFin, incluirPorMes = false }) {
  const cacheKey = `${fechaInicio}|${fechaFin}|${incluirPorMes ? 1 : 0}`;
  const hit = entregasCache.get(cacheKey);
  if (hit && (Date.now() - hit.at) < ENTREGAS_CACHE_TTL_MS) {
    return hit.data;
  }
  if (entregasInflight.has(cacheKey)) {
    return entregasInflight.get(cacheKey);
  }

  const promise = (async () => {
    const inicio = parseDateInput(fechaInicio);
    const fin = parseDateInput(fechaFin);

    const pool = await getPool();
    const result = await pool.request()
      .input('fechaInicio', sql.Date, inicio)
      .input('fechaFin', sql.Date, fin)
      .query(buildEntregasDetalleQuery());

    const registrosBrutos = (result.recordset || []).map((row) => ({
      ...row,
      PREVIAS: Number(row.PREVIAS || 0) || 0,
    }));
    const excluidasFlotilla = registrosBrutos.filter(isFlotillaExcluidaSofia).length;
    const registros = excludeFlotillaContadoSofia(registrosBrutos);
    const totalEntregasSinPrevias = registros.filter((r) => r.PREVIAS === 0).length;
    const totalFlotillaGmf = registros.filter(
      (r) => String(r.FORMAPAGO_ORIGINAL || '').toUpperCase() === 'FLOTGMF'
        || String(r.TIPOVENTA || '').toUpperCase() === 'FLOTILLA GMF',
    ).length;

    const payload = {
      totalNotificacionesEntrega: registros.length,
      totalEntregasSinPrevias,
      totalEntregasConPrevias: registros.length - totalEntregasSinPrevias,
      totalEntregasExcluidasFlotilla: excluidasFlotilla,
      totalEntregasFlotillaGmf: totalFlotillaGmf,
      excluyeFlotillaContado: true,
      incluyeFlotillaGmf: true,
      registrosEntrega: registros,
    };

    if (incluirPorMes) {
      payload.entregasPorMes = buildEntregasPorMes(registros, inicio, fin);
    }

    entregasCache.set(cacheKey, { at: Date.now(), data: payload });
    return payload;
  })();

  entregasInflight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    entregasInflight.delete(cacheKey);
  }
}

module.exports = {
  getNotificacionesEntrega,
  computeCoberturaSofia,
  isFlotillaExcluidaSofia,
  excludeFlotillaContadoSofia,
};
