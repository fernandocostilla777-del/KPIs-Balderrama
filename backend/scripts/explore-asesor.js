require('dotenv').config();
const sql = require('mssql');
const config = {
  server: process.env.DB_HOST, port: 1433, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 120000 },
};

async function main() {
  const pool = await sql.connect(config);
  const r = await pool.request().query(`
    SELECT TOP 3
      o.ORE_IDORDEN, o.ORE_STATUS, o.ORE_IDASESOR, o.ORE_FECHAORD, o.ORE_FECHAPROM,
      o.ORE_FECHACIE, o.ORE_TPOORDEN, o.ORE_TIPSERVICIO, o.ORE_MOTVIS,
      a.PAR_DESCRIP1 AS asesor_param
    FROM SER_ORDEN o
    LEFT JOIN PNC_PARAMETR a ON a.PAR_TIPOPARA = 'AS' AND a.PAR_IDENPARA = o.ORE_IDASESOR
    WHERE CONVERT(DATE, o.ORE_FECHAORD, 103) >= '2026-06-01'
    ORDER BY CONVERT(DATE, o.ORE_FECHAORD, 103) DESC
  `);
  console.log(JSON.stringify(r.recordset, null, 2));

  const users = await pool.request().query(`
    SELECT TOP 3 TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME LIKE '%USU%' AND TABLE_NAME LIKE 'SER_%' OR TABLE_NAME LIKE 'GEN_%USU%'
  `);
  console.log('user tables', users.recordset);

  await pool.close();
}

main().catch(console.error);
