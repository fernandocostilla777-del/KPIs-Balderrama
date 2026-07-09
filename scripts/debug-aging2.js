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
    SELECT ORE_STATUS, COUNT(*) n,
      AVG(DATEDIFF(day, CONVERT(DATE, ORE_FECHAORD, 103), CAST(GETDATE() AS DATE))) avgDias
    FROM SER_ORDEN
    WHERE ORE_STATUS IN ('A','T','D','P')
      AND (ORE_FECHACIE IS NULL OR LTRIM(RTRIM(ORE_FECHACIE)) = '')
    GROUP BY ORE_STATUS
  `);
  console.log('Currently open (no cierre):', r.recordset);

  const buckets = await pool.request().query(`
    SELECT
      CASE
        WHEN DATEDIFF(day, CONVERT(DATE, ORE_FECHAORD, 103), CAST(GETDATE() AS DATE)) <= 30 THEN '0-30'
        WHEN DATEDIFF(day, CONVERT(DATE, ORE_FECHAORD, 103), CAST(GETDATE() AS DATE)) <= 60 THEN '31-60'
        WHEN DATEDIFF(day, CONVERT(DATE, ORE_FECHAORD, 103), CAST(GETDATE() AS DATE)) <= 90 THEN '61-90'
        WHEN DATEDIFF(day, CONVERT(DATE, ORE_FECHAORD, 103), CAST(GETDATE() AS DATE)) <= 120 THEN '91-120'
        ELSE '+120'
      END AS bucket,
      COUNT(*) n
    FROM SER_ORDEN
    WHERE ORE_STATUS IN ('A','T','D','P')
      AND (ORE_FECHACIE IS NULL OR LTRIM(RTRIM(ORE_FECHACIE)) = '')
    GROUP BY CASE
        WHEN DATEDIFF(day, CONVERT(DATE, ORE_FECHAORD, 103), CAST(GETDATE() AS DATE)) <= 30 THEN '0-30'
        WHEN DATEDIFF(day, CONVERT(DATE, ORE_FECHAORD, 103), CAST(GETDATE() AS DATE)) <= 60 THEN '31-60'
        WHEN DATEDIFF(day, CONVERT(DATE, ORE_FECHAORD, 103), CAST(GETDATE() AS DATE)) <= 90 THEN '61-90'
        WHEN DATEDIFF(day, CONVERT(DATE, ORE_FECHAORD, 103), CAST(GETDATE() AS DATE)) <= 120 THEN '91-120'
        ELSE '+120'
      END
    ORDER BY bucket
  `);
  console.log('Open buckets all-time:', buckets.recordset);

  await pool.close();
}
main().catch(console.error);
