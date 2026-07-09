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

  const sample = await pool.request().query(`
    SELECT TOP 3
      o.ORE_IDORDEN AS orden,
      o.ORE_STATUS AS status,
      o.ORE_FECHAORD AS ingreso,
      o.ORE_FECHACIE AS cierre,
      o.ORE_NUMSERIE AS serie,
      o.ORE_DOCTO AS factura_orden,
      o.ORE_IDCLIENTE,
      o.ORE_IDASEGURADORA,
      c.PER_NOMRAZON, c.PER_PATERNO, c.PER_MATERNO,
      c.PER_TELEFONO1, c.PER_TELCELULAR, c.PER_EMAIL,
      v.VEH_TIPOAUTO, v.VEH_ANMODELO
    FROM SER_ORDEN o
    LEFT JOIN PER_PERSONAS c ON c.PER_IDPERSONA = o.ORE_IDCLIENTE
    LEFT JOIN SER_VEHICULO v ON v.VEH_NUMSERIE = o.ORE_NUMSERIE
    WHERE CONVERT(DATE, o.ORE_FECHAORD, 103) >= '2026-06-01'
    ORDER BY CONVERT(DATE, o.ORE_FECHAORD, 103) DESC
  `);
  console.log('SER_ORDEN sample:', JSON.stringify(sample.recordset, null, 2));

  const fac = await pool.request().query(`
    SELECT TOP 3
      f.fos_idorden, f.fos_docto, f.fos_fecventa, SUM(f.fos_total) AS importe,
      f.fos_clinomrazon, f.fos_clitelefono1, f.fos_clitelefono2, f.fos_cliemail,
      f.fos_qctipoauto, f.fos_numserie, f.fos_aseguradora
    FROM SER_FACORDEN f
    WHERE CONVERT(DATE, f.fos_fecventa, 103) >= '2026-01-01'
    GROUP BY f.fos_idorden, f.fos_docto, f.fos_fecventa,
      f.fos_clinomrazon, f.fos_clitelefono1, f.fos_clitelefono2, f.fos_cliemail,
      f.fos_qctipoauto, f.fos_numserie, f.fos_aseguradora
    ORDER BY CONVERT(DATE, f.fos_fecventa, 103) DESC
  `);
  console.log('\nSER_FACORDEN sample:', JSON.stringify(fac.recordset, null, 2));

  const aseg = await pool.request().query(`
    SELECT TOP 5 TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME LIKE '%ASEG%' OR TABLE_NAME LIKE '%SEGURO%'
    ORDER BY TABLE_NAME
  `);
  console.log('\nAseg tables:', aseg.recordset.map((r) => r.TABLE_NAME));

  const asegCols = await pool.request().query(`
    SELECT TOP 1 * FROM SER_ASEGURADORA
  `).catch(async () => {
    const t = await pool.request().query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE '%ASEG%'
    `);
    return t;
  });
  console.log('\nAseg sample attempt:', asegCols.recordset?.[0] || asegCols.recordset);

  const importeTest = await pool.request().query(`
    SELECT TOP 5
      o.ORE_IDORDEN,
      o.ORE_DOCTO,
      ISNULL(SUM(f.fos_total), 0) AS importe_fac,
      ISNULL(SUM(t.TCX_TOTAL), 0) AS importe_tcx
    FROM SER_ORDEN o
    LEFT JOIN SER_FACORDEN f ON f.fos_idorden = o.ORE_IDORDEN
    LEFT JOIN SER_ORDTOTCXP t ON t.TCX_IDORDEN = o.ORE_IDORDEN AND t.TCX_STATUS = 'A'
    WHERE CONVERT(DATE, o.ORE_FECHAORD, 103) >= '2026-06-01'
    GROUP BY o.ORE_IDORDEN, o.ORE_DOCTO
    ORDER BY importe_fac DESC, importe_tcx DESC
  `);
  console.log('\nImporte sources:', importeTest.recordset);

  await pool.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
