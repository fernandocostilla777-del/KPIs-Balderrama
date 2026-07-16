require('dotenv').config();
const sql = require('mssql');

const config = {
  server: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
};

const BI_TABLES = [
  'BI_AN_VENTAS',
  'BI_INVENTARIO_NUEVOS',
  'BI_InventarioAutosNuevosFechDet',
  'BI_InventarioAutosSeminuevosFechDet',
  'BI_REF_INVENT',
  'BI_SER_VENTAS',
  'BI_VentaAutosNuevosFechDet',
  'BI_VentaAutosSeminuevosFechDet',
  'BI_VentaRefaccionesFechDet',
  'BI_VentaTallerFechDet',
];

async function main() {
  const pool = await sql.connect(config);

  for (const table of BI_TABLES) {
    const cols = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = '${table}'
      ORDER BY ORDINAL_POSITION
    `);
    const count = await pool.request().query(`SELECT COUNT(*) AS n FROM dbo.[${table}]`);
    console.log(`\n=== ${table} (${count.recordset[0].n} filas) ===`);
    console.log(cols.recordset.map((c) => `${c.COLUMN_NAME} (${c.DATA_TYPE})`).join(', '));

    const sample = await pool.request().query(`SELECT TOP 2 * FROM dbo.[${table}]`);
    if (sample.recordset.length) {
      console.log('Muestra:', JSON.stringify(sample.recordset[0], null, 0).slice(0, 500));
    }
  }

  await pool.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
