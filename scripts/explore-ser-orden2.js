require('dotenv').config();
const sql = require('mssql');

const config = {
  server: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 120000 },
};

async function main() {
  const pool = await sql.connect(config);

  const motvis = await pool.request().query(`
    SELECT TOP 10 ISNULL(LTRIM(RTRIM(ORE_MOTVIS)), '(null)') AS v, COUNT(*) AS n
    FROM SER_ORDEN WHERE ORE_FECHAORD IS NOT NULL
    GROUP BY ORE_MOTVIS ORDER BY n DESC
  `);
  console.log('ORE_MOTVIS:', motvis.recordset);

  const tipserv = await pool.request().query(`
    SELECT TOP 10 ISNULL(LTRIM(RTRIM(ORE_TIPSERVICIO)), '(null)') AS v, COUNT(*) AS n
    FROM SER_ORDEN GROUP BY ORE_TIPSERVICIO ORDER BY n DESC
  `);
  console.log('ORE_TIPSERVICIO:', tipserv.recordset);

  const month2026 = await pool.request().query(`
    SELECT COUNT(*) AS ordenes,
      SUM(CASE WHEN ORE_STATUS='I' THEN 1 ELSE 0 END) AS facturadas,
      AVG(CASE WHEN ORE_FECHACIE IS NOT NULL AND ORE_FECHAORD IS NOT NULL
        THEN DATEDIFF(day, CONVERT(DATE, ORE_FECHAORD, 103), CONVERT(DATE, ORE_FECHACIE, 103)) END) AS avg_dias
    FROM SER_ORDEN
    WHERE CONVERT(DATE, ORE_FECHAORD, 103) >= '2026-01-01'
      AND CONVERT(DATE, ORE_FECHAORD, 103) <= '2026-07-06'
  `);
  console.log('\n2026 YTD:', month2026.recordset[0]);

  const tcx = await pool.request().query(`
    SELECT TOP 10 TCX_CLASIFIC, SUM(TCX_TOTAL) AS total, COUNT(*) AS n
    FROM SER_ORDTOTCXP GROUP BY TCX_CLASIFIC ORDER BY total DESC
  `);
  console.log('\nSER_ORDTOTCXP clasific:', tcx.recordset);

  const facMonth = await pool.request().query(`
    SELECT
      COUNT(DISTINCT fos_idorden) AS ordenes,
      SUM(fos_total) AS venta,
      SUM(CASE WHEN fos_clasificacion LIKE '%M.O%' OR fos_clasificacion LIKE '%MANO%' THEN fos_total ELSE 0 END) AS mo,
      SUM(CASE WHEN fos_clasificacion LIKE '%REFACC%' OR fos_clasificacion = 'REFACCIONES' THEN fos_total ELSE 0 END) AS re
    FROM SER_FACORDEN
    WHERE CONVERT(DATE, fos_fecventa, 103) >= '2026-06-01'
      AND CONVERT(DATE, fos_fecventa, 103) <= '2026-06-30'
  `);
  console.log('\nSER_FACORDEN Jun 2026:', facMonth.recordset[0]);

  const joinTest = await pool.request().query(`
    SELECT TOP 5 o.ORE_IDORDEN, f.fos_idorden, f.fos_docto, f.fos_total
    FROM SER_ORDEN o
    INNER JOIN SER_FACORDEN f ON f.fos_idorden = o.ORE_IDORDEN
    ORDER BY CONVERT(DATE, o.ORE_FECHAORD, 103) DESC
  `);
  console.log('\nJoin directo:', joinTest.recordset);

  const joinTest2 = await pool.request().query(`
    SELECT TOP 5 o.ORE_IDORDEN, f.fos_idorden, f.fos_docto, SUM(f.fos_total) AS total
    FROM SER_ORDEN o
    INNER JOIN SER_FACORDEN f ON REPLACE(f.fos_idorden, 'S', 'O') = o.ORE_IDORDEN OR f.fos_idorden = o.ORE_IDORDEN
    WHERE CONVERT(DATE, o.ORE_FECHAORD, 103) >= '2026-06-01'
    GROUP BY o.ORE_IDORDEN, f.fos_idorden, f.fos_docto
    ORDER BY total DESC
  `);
  console.log('\nJoin flexible:', joinTest2.recordset);

  // ADE service invoices?
  const ade = await pool.request().query(`
    SELECT TOP 5 TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME LIKE 'ADE_%SER%' OR TABLE_NAME LIKE 'ADE_%VTA%'
    ORDER BY TABLE_NAME
  `);
  console.log('\nADE tables:', ade.recordset.map((r) => r.TABLE_NAME));

  const facRecent = await pool.request().query(`
    SELECT TOP 3
      o.ORE_IDORDEN, o.ORE_FECHAORD, o.ORE_FECHACIE, o.ORE_STATUS,
      o.ORE_NUMSERIE, o.ORE_IDASESOR,
      p.PER_NOMRAZON + ' ' + p.PER_PATERNO AS asesor
    FROM SER_ORDEN o
    LEFT JOIN PER_PERSONAS p ON p.PER_IDPERSONA = (
      SELECT TOP 1 u.USU_IDPERSONA FROM GEN_USUARIO u WHERE u.USU_CLAVE = o.ORE_IDASESOR
    )
    WHERE CONVERT(DATE, o.ORE_FECHAORD, 103) >= '2026-06-01'
    ORDER BY CONVERT(DATE, o.ORE_FECHAORD, 103) DESC
  `);
  console.log('\nOrdenes recientes con asesor:', facRecent.recordset);

  await pool.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
