require('dotenv').config();
const { getPool, sql } = require('../src/db');

(async () => {
  const pool = await getPool();
  const fi = process.argv[2] || '2026-08-01';
  const ff = process.argv[3] || '2026-08-31';

  const detail = await pool.request()
    .input('fi', sql.Date, new Date(`${fi}T12:00:00`))
    .input('ff', sql.Date, new Date(`${ff}T12:00:00`))
    .query(`
      SELECT
        s.SOF_FechAct,
        s.SOF_FechFact,
        v.VTE_FECHDOCTO,
        s.SOF_Factura,
        s.SOF_VIN,
        s.SOF_NoTransaccion,
        s.SOF_Estatus,
        s.SOF_Evento,
        s.SOF_Resultado,
        s.SOF_OrigenOpe,
        v.VTE_FORMAPAGO,
        CASE
          WHEN CONVERT(DATE, s.SOF_FechAct, 103) BETWEEN @fi AND @ff THEN 1 ELSE 0
        END AS inFechAct,
        CASE
          WHEN CONVERT(DATE, COALESCE(NULLIF(LTRIM(RTRIM(s.SOF_FechFact)), ''), v.VTE_FECHDOCTO), 103)
               BETWEEN @fi AND @ff THEN 1 ELSE 0
        END AS inFechFact
      FROM SOF_Venta_Cancel_DEMO s
      LEFT JOIN ADE_VTAFI v
        ON v.VTE_DOCTO = s.SOF_Factura AND v.VTE_TIPODOCTO = 'A'
      WHERE UPPER(LTRIM(RTRIM(s.SOF_OrigenOpe))) = 'ENTREGA'
        AND s.SOF_Resultado = 'EXITO'
        AND (
          CONVERT(DATE, s.SOF_FechAct, 103) BETWEEN @fi AND @ff
          OR CONVERT(DATE, COALESCE(NULLIF(LTRIM(RTRIM(s.SOF_FechFact)), ''), v.VTE_FECHDOCTO), 103)
             BETWEEN @fi AND @ff
        )
      ORDER BY s.SOF_FechAct DESC
    `);

  console.log('rows', detail.recordset.length);
  for (const r of detail.recordset) {
    console.log({
      act: r.SOF_FechAct,
      fact: r.SOF_FechFact,
      vte: r.VTE_FECHDOCTO,
      factura: r.SOF_Factura,
      vin: r.SOF_VIN,
      estatus: r.SOF_Estatus,
      evento: r.SOF_Evento,
      forma: r.VTE_FORMAPAGO,
      inAct: r.inFechAct,
      inFact: r.inFechFact,
    });
  }

  // July by both
  for (const [a, b, label] of [
    ['2026-07-01', '2026-07-31', 'julio'],
    ['2026-06-01', '2026-06-30', 'junio'],
  ]) {
    const r = await pool.request()
      .input('fi', sql.Date, new Date(`${a}T12:00:00`))
      .input('ff', sql.Date, new Date(`${b}T12:00:00`))
      .query(`
        SELECT
          SUM(CASE WHEN CONVERT(DATE, s.SOF_FechAct, 103) BETWEEN @fi AND @ff THEN 1 ELSE 0 END) AS byAct,
          SUM(CASE WHEN CONVERT(DATE, COALESCE(NULLIF(LTRIM(RTRIM(s.SOF_FechFact)), ''), v.VTE_FECHDOCTO), 103)
                        BETWEEN @fi AND @ff THEN 1 ELSE 0 END) AS byFact
        FROM SOF_Venta_Cancel_DEMO s
        LEFT JOIN ADE_VTAFI v ON v.VTE_DOCTO = s.SOF_Factura AND v.VTE_TIPODOCTO = 'A'
        WHERE UPPER(LTRIM(RTRIM(s.SOF_OrigenOpe))) = 'ENTREGA' AND s.SOF_Resultado = 'EXITO'
      `);
    console.log(label, r.recordset[0]);
  }

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
