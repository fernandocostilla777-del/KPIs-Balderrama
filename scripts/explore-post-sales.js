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

const TABLES = [
  'BI_SER_VENTAS',
  'BI_VentaTallerFechDet',
  'REPORTE_ORDENES',
  'SER_ORDEN',
  'SER_FACORDEN',
];

async function describeTable(pool, table) {
  const cols = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = '${table}'
    ORDER BY ORDINAL_POSITION
  `);
  let count = { recordset: [{ n: '?' }] };
  try {
    count = await pool.request().query(`SELECT COUNT(*) AS n FROM dbo.[${table}]`);
  } catch (e) {
    console.log(`\n=== ${table} — sin acceso: ${e.message} ===`);
    return;
  }
  console.log(`\n=== ${table} (${count.recordset[0].n} filas) ===`);
  console.log(cols.recordset.map((c) => c.COLUMN_NAME).join(', '));
  const sample = await pool.request().query(`SELECT TOP 1 * FROM dbo.[${table}]`);
  if (sample.recordset.length) {
    console.log('Muestra:', JSON.stringify(sample.recordset[0]).slice(0, 800));
  }
}

async function main() {
  const pool = await sql.connect(config);
  console.log('Usuario SQL:', config.user, '| BD:', config.database);

  for (const table of TABLES) {
    await describeTable(pool, table);
  }

  const biRange = await pool.request().query(`
    SELECT MIN(fecha_factura) AS mn, MAX(fecha_factura) AS mx, COUNT(*) AS n
    FROM BI_SER_VENTAS WHERE fecha_factura IS NOT NULL
  `);
  console.log('\nRango BI_SER_VENTAS:', biRange.recordset[0]);

  await pool.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
