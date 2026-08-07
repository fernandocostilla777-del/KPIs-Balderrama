require('dotenv').config();
const { getPool, sql } = require('../src/db');
const { getNotificacionesEntrega } = require('../src/services/sofia-entregas');

async function q(pool, label, text, fi, ff) {
  const r = await pool.request()
    .input('fi', sql.Date, new Date(`${fi}T12:00:00`))
    .input('ff', sql.Date, new Date(`${ff}T12:00:00`))
    .query(text);
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(r.recordset, null, 2));
}

(async () => {
  const fi = process.argv[2] || '2026-08-01';
  const ff = process.argv[3] || '2026-08-07';
  const pool = await getPool();

  await q(pool, 'rows by FechFact/VTE', `
    SELECT COUNT(*) AS n FROM SOF_Venta_Cancel_DEMO s
    LEFT JOIN ADE_VTAFI v ON v.VTE_DOCTO = s.SOF_Factura AND v.VTE_TIPODOCTO = 'A'
    WHERE UPPER(LTRIM(RTRIM(s.SOF_OrigenOpe))) = 'ENTREGA' AND s.SOF_Resultado = 'EXITO'
      AND CONVERT(DATE, COALESCE(NULLIF(LTRIM(RTRIM(s.SOF_FechFact)), ''), v.VTE_FECHDOCTO), 103)
          BETWEEN @fi AND @ff
  `, fi, ff);

  await q(pool, 'rows by FechAct (registro)', `
    SELECT COUNT(*) AS n FROM SOF_Venta_Cancel_DEMO s
    WHERE UPPER(LTRIM(RTRIM(s.SOF_OrigenOpe))) = 'ENTREGA' AND s.SOF_Resultado = 'EXITO'
      AND CONVERT(DATE, s.SOF_FechAct, 103) BETWEEN @fi AND @ff
  `, fi, ff);

  await q(pool, 'distinct VIN / Factura / Transaccion by FechFact', `
    SELECT
      COUNT(*) AS nRows,
      COUNT(DISTINCT UPPER(LTRIM(RTRIM(s.SOF_VIN)))) AS nVin,
      COUNT(DISTINCT LTRIM(RTRIM(s.SOF_Factura))) AS nFact,
      COUNT(DISTINCT s.SOF_NoTransaccion) AS nTx
    FROM SOF_Venta_Cancel_DEMO s
    LEFT JOIN ADE_VTAFI v ON v.VTE_DOCTO = s.SOF_Factura AND v.VTE_TIPODOCTO = 'A'
    WHERE UPPER(LTRIM(RTRIM(s.SOF_OrigenOpe))) = 'ENTREGA' AND s.SOF_Resultado = 'EXITO'
      AND CONVERT(DATE, COALESCE(NULLIF(LTRIM(RTRIM(s.SOF_FechFact)), ''), v.VTE_FECHDOCTO), 103)
          BETWEEN @fi AND @ff
  `, fi, ff);

  await q(pool, 'duplicate VINs', `
    SELECT TOP 15
      UPPER(LTRIM(RTRIM(s.SOF_VIN))) AS vin,
      COUNT(*) AS c,
      STRING_AGG(CAST(s.SOF_Factura AS varchar(40)), ',') AS facturas
    FROM SOF_Venta_Cancel_DEMO s
    LEFT JOIN ADE_VTAFI v ON v.VTE_DOCTO = s.SOF_Factura AND v.VTE_TIPODOCTO = 'A'
    WHERE UPPER(LTRIM(RTRIM(s.SOF_OrigenOpe))) = 'ENTREGA' AND s.SOF_Resultado = 'EXITO'
      AND CONVERT(DATE, COALESCE(NULLIF(LTRIM(RTRIM(s.SOF_FechFact)), ''), v.VTE_FECHDOCTO), 103)
          BETWEEN @fi AND @ff
    GROUP BY UPPER(LTRIM(RTRIM(s.SOF_VIN)))
    HAVING COUNT(*) > 1
    ORDER BY c DESC
  `, fi, ff);

  await q(pool, 'estatus/evento mix', `
    SELECT s.SOF_Estatus, s.SOF_Evento, COUNT(*) AS c
    FROM SOF_Venta_Cancel_DEMO s
    LEFT JOIN ADE_VTAFI v ON v.VTE_DOCTO = s.SOF_Factura AND v.VTE_TIPODOCTO = 'A'
    WHERE UPPER(LTRIM(RTRIM(s.SOF_OrigenOpe))) = 'ENTREGA' AND s.SOF_Resultado = 'EXITO'
      AND CONVERT(DATE, COALESCE(NULLIF(LTRIM(RTRIM(s.SOF_FechFact)), ''), v.VTE_FECHDOCTO), 103)
          BETWEEN @fi AND @ff
    GROUP BY s.SOF_Estatus, s.SOF_Evento
    ORDER BY c DESC
  `, fi, ff);

  await q(pool, 'join ADE_VTAFI multiplica? (facturas duplicadas en ADE)', `
    SELECT TOP 10 s.SOF_Factura, COUNT(*) AS joinRows
    FROM SOF_Venta_Cancel_DEMO s
    LEFT JOIN ADE_VTAFI v ON v.VTE_DOCTO = s.SOF_Factura AND v.VTE_TIPODOCTO = 'A'
    WHERE UPPER(LTRIM(RTRIM(s.SOF_OrigenOpe))) = 'ENTREGA' AND s.SOF_Resultado = 'EXITO'
      AND CONVERT(DATE, COALESCE(NULLIF(LTRIM(RTRIM(s.SOF_FechFact)), ''), v.VTE_FECHDOCTO), 103)
          BETWEEN @fi AND @ff
    GROUP BY s.SOF_Factura, s.SOF_NoTransaccion, s.SOF_VIN
    HAVING COUNT(*) > 1
    ORDER BY joinRows DESC
  `, fi, ff);

  const kpi = await getNotificacionesEntrega({ fechaInicio: fi, fechaFin: ff, fresh: true });
  console.log('\n=== servicio actual ===');
  console.log({
    total: kpi.totalNotificacionesEntrega,
    sinPrevias: kpi.totalEntregasSinPrevias,
    excluidasFLOT: kpi.totalEntregasExcluidasFlotilla,
    flotillaGmf: kpi.totalEntregasFlotillaGmf,
    registros: kpi.registrosEntrega.length,
  });

  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
