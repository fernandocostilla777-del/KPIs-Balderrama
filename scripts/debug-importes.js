require('dotenv').config();
const sql = require('mssql');
const config = {
  server: process.env.DB_HOST, port: 1433, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 120000 },
};

async function main() {
  const pool = await sql.connect(config);
  const period = `CONVERT(DATE, o.ORE_FECHAORD, 103) BETWEEN '2026-06-01' AND '2026-07-06'`;

  const openDet = await pool.request().query(`
    SELECT COUNT(DISTINCT o.ORE_IDORDEN) ordenes, SUM(d.ORD_SUBTOTAL) sub, SUM(d.ORD_IVATOT) iva
    FROM SER_ORDEN o
    INNER JOIN SER_ORDENDET d ON d.ORD_IDORDEN = o.ORE_IDORDEN
    WHERE o.ORE_STATUS IN ('A','T','D','P') AND ${period}
  `);
  console.log('Open ORDENDET:', openDet.recordset[0]);

  const facIva = await pool.request().query(`
    SELECT COUNT(DISTINCT o.ORE_IDORDEN) ordenes,
      SUM(d.ORD_SUBTOTAL) sub, SUM(d.ORD_IVATOT) iva,
      SUM(d.ORD_SUBTOTAL + d.ORD_IVATOT) conIva
    FROM SER_ORDEN o
    INNER JOIN SER_ORDENDET d ON d.ORD_IDORDEN = o.ORE_IDORDEN
    WHERE o.ORE_STATUS='I' AND ${period}
  `);
  console.log('Facturada sub+iva:', facIva.recordset[0]);

  const compare = await pool.request().query(`
    SELECT TOP 5 o.ORE_IDORDEN,
      ISNULL(f.imp,0) fac, ISNULL(t.imp,0) tcx,
      ISNULL(det.sub,0) sub, ISNULL(det.iva,0) iva
    FROM SER_ORDEN o
    LEFT JOIN (SELECT fos_idorden, SUM(fos_total) imp FROM SER_FACORDEN GROUP BY fos_idorden) f ON f.fos_idorden=o.ORE_IDORDEN
    LEFT JOIN (SELECT TCX_IDORDEN, SUM(TCX_TOTAL) imp FROM SER_ORDTOTCXP WHERE TCX_STATUS='T' GROUP BY TCX_IDORDEN) t ON t.TCX_IDORDEN=o.ORE_IDORDEN
    LEFT JOIN (SELECT ORD_IDORDEN, SUM(ORD_SUBTOTAL) sub, SUM(ORD_IVATOT) iva FROM SER_ORDENDET GROUP BY ORD_IDORDEN) det ON det.ORD_IDORDEN=o.ORE_IDORDEN
    WHERE o.ORE_STATUS='I' AND ${period} AND ISNULL(f.imp,0)>0
  `);
  console.log('Compare fac vs det:', compare.recordset);

  await pool.close();
}
main().catch(console.error);
