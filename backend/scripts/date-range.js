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

(async () => {
  const pool = await sql.connect(config);
  const ventas = await pool.request().query(`
    SELECT MIN(fecha_factura) AS mn, MAX(fecha_factura) AS mx, COUNT(*) AS n
    FROM BI_AN_VENTAS WHERE fecha_factura IS NOT NULL
  `);
  const servicio = await pool.request().query(`
    SELECT MIN(fecha_factura) AS mn, MAX(fecha_factura) AS mx, COUNT(*) AS n
    FROM BI_SER_VENTAS WHERE fecha_factura IS NOT NULL
  `);
  console.log('VENTAS', ventas.recordset[0]);
  console.log('SERVICIO', servicio.recordset[0]);
  await pool.close();
})();
