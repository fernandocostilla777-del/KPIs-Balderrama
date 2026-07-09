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

  const range = await pool.request().query(`
    SELECT
      MIN(CONVERT(DATE, ORE_FECHAORD, 103)) AS mn,
      MAX(CONVERT(DATE, ORE_FECHAORD, 103)) AS mx,
      COUNT(*) AS n
    FROM SER_ORDEN
    WHERE ORE_FECHAORD IS NOT NULL AND LTRIM(RTRIM(ORE_FECHAORD)) <> ''
  `);
  console.log('Rango SER_ORDEN:', range.recordset[0]);

  const status = await pool.request().query(`
    SELECT TOP 10 ORE_STATUS, COUNT(*) AS n
    FROM SER_ORDEN GROUP BY ORE_STATUS ORDER BY n DESC
  `);
  console.log('\nStatus SER_ORDEN:', status.recordset);

  const tipos = await pool.request().query(`
    SELECT TOP 10 ISNULL(LTRIM(RTRIM(ORE_TPOORDEN)), '(null)') AS tipo, COUNT(*) AS n
    FROM SER_ORDEN GROUP BY ORE_TPOORDEN ORDER BY n DESC
  `);
  console.log('\nTipos orden:', tipos.recordset);

  const tipoOrd = await pool.request().query(`
    SELECT TOP 10 ISNULL(LTRIM(RTRIM(ORE_TIPOORD)), '(null)') AS tipo, COUNT(*) AS n
    FROM SER_ORDEN GROUP BY ORE_TIPOORD ORDER BY n DESC
  `);
  console.log('\nORE_TIPOORD:', tipoOrd.recordset);

  const recent = await pool.request().query(`
    SELECT TOP 5
      ORE_IDORDEN, ORE_FECHAORD, ORE_FECHACIE, ORE_STATUS, ORE_TPOORDEN, ORE_TIPOORD,
      ORE_NUMSERIE, ORE_IDASESOR, ORE_KILOMETRAJE
    FROM SER_ORDEN
    ORDER BY CONVERT(DATE, ORE_FECHAORD, 103) DESC
  `);
  console.log('\nRecientes:', recent.recordset);

  // Totales facturación por orden
  const facTables = ['SER_ORDPRE', 'SER_ORDENTREGA', 'SER_ORDTOTCXP'];
  for (const t of facTables) {
    try {
      const c = await pool.request().query(`SELECT COUNT(*) AS n FROM dbo.[${t}]`);
      const cols = await pool.request().query(`
        SELECT TOP 5 COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME='${t}' ORDER BY ORDINAL_POSITION
      `);
      console.log(`\n${t} (${c.recordset[0].n}):`, cols.recordset.map((x) => x.COLUMN_NAME).join(', '));
    } catch (e) {
      console.log(`\n${t}: ${e.message}`);
    }
  }

  const facAgg = await pool.request().query(`
    SELECT TOP 3 fos_idorden, fos_docto, fos_fecventa, SUM(fos_total) AS total, fos_clasificacion
    FROM SER_FACORDEN
    WHERE fos_idorden IS NOT NULL
    GROUP BY fos_idorden, fos_docto, fos_fecventa, fos_clasificacion
    ORDER BY fos_fecventa DESC
  `);
  console.log('\nSER_FACORDEN agg sample:', facAgg.recordset);

  await pool.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
