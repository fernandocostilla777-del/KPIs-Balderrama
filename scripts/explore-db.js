require('dotenv').config();
const sql = require('mssql');

const config = {
  server: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    connectTimeout: 30000,
    requestTimeout: 60000,
  },
};

async function main() {
  const pool = await sql.connect(config);
  console.log('Conexión OK:', config.database);

  const tables = await pool.request().query(`
    SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE'
    ORDER BY TABLE_SCHEMA, TABLE_NAME
  `);
  console.log('\n=== TABLAS (' + tables.recordset.length + ') ===');
  tables.recordset.forEach((t) => console.log(`${t.TABLE_SCHEMA}.${t.TABLE_NAME}`));

  const views = await pool.request().query(`
    SELECT TABLE_SCHEMA, TABLE_NAME
    FROM INFORMATION_SCHEMA.VIEWS
    ORDER BY TABLE_SCHEMA, TABLE_NAME
  `);
  if (views.recordset.length) {
    console.log('\n=== VISTAS (' + views.recordset.length + ') ===');
    views.recordset.forEach((v) => console.log(`${v.TABLE_SCHEMA}.${v.TABLE_NAME}`));
  }

  await pool.close();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
