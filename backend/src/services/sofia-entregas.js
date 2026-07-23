const { getPool, sql } = require('../db');

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

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
      ISNULL(prev.PREVIAS, 0) AS PREVIAS
    FROM SOF_Venta_Cancel_DEMO s
    LEFT JOIN PER_PERSONAS p ON p.PER_IDPERSONA = s.SOF_IDCliente
    LEFT JOIN ADE_VTAFI v
      ON v.VTE_DOCTO = s.SOF_Factura
      AND v.VTE_TIPODOCTO = 'A'
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
    ORDER BY
      CONVERT(DATE, COALESCE(
        NULLIF(LTRIM(RTRIM(s.SOF_FechFact)), ''),
        v.VTE_FECHDOCTO
      ), 103) DESC,
      s.SOF_HoraAct DESC,
      s.SOF_NoTransaccion DESC
  `;
}

function computeCoberturaSofia(ventasRows = [], entregasRows = []) {
  const totalUnidadesFacturadas = ventasRows.length;
  const totalReportadasSofia = entregasRows.length;
  const totalUnidadesFacturadasNoTimbradas = Math.max(0, totalUnidadesFacturadas - totalReportadasSofia);
  const numeradorCobertura = totalReportadasSofia + totalUnidadesFacturadasNoTimbradas;

  return {
    totalUnidadesFacturadas,
    totalNotificacionesEntrega: totalReportadasSofia,
    totalUnidadesFacturadasNoTimbradas,
    numeradorCobertura,
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
  const inicio = parseDateInput(fechaInicio);
  const fin = parseDateInput(fechaFin);

  const pool = await getPool();
  const result = await pool.request()
    .input('fechaInicio', sql.Date, inicio)
    .input('fechaFin', sql.Date, fin)
    .query(buildEntregasDetalleQuery());

  const registros = (result.recordset || []).map((row) => ({
    ...row,
    PREVIAS: Number(row.PREVIAS || 0) || 0,
  }));
  const totalEntregasSinPrevias = registros.filter((r) => r.PREVIAS === 0).length;
  const payload = {
    totalNotificacionesEntrega: registros.length,
    totalEntregasSinPrevias,
    totalEntregasConPrevias: registros.length - totalEntregasSinPrevias,
    registrosEntrega: registros,
  };

  if (incluirPorMes) {
    payload.entregasPorMes = buildEntregasPorMes(registros, inicio, fin);
  }

  return payload;
}

module.exports = {
  getNotificacionesEntrega,
  computeCoberturaSofia,
};
