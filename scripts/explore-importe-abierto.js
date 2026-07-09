require('dotenv').config();
const sql = require('mssql');
const config = {
  server: process.env.DB_HOST, port: 1433, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
};

async function main() {
  const pool = await sql.connect(config);
  const r = await pool.request().query(`
    SELECT TOP 5 o.ORE_IDORDEN, o.ORE_STATUS,
      ISNULL(fac.importe,0) fac, ISNULL(tcx.tcx,0) tcx
    FROM SER_ORDEN o
    LEFT JOIN (SELECT fos_idorden, SUM(fos_total) importe FROM SER_FACORDEN GROUP BY fos_idorden) fac ON fac.fos_idorden=o.ORE_IDORDEN
    LEFT JOIN (SELECT TCX_IDORDEN, SUM(TCX_TOTAL) tcx FROM SER_ORDTOTCXP WHERE TCX_STATUS='A' GROUP BY TCX_IDORDEN) tcx ON tcx.TCX_IDORDEN=o.ORE_IDORDEN
    WHERE o.ORE_STATUS IN ('A','T') AND CONVERT(DATE,o.ORE_FECHAORD,103)>='2026-06-01'
  `);
  console.log(r.recordset);
  await pool.close();
}
main().catch(console.error);
