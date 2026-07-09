require('dotenv').config();
const sql = require('mssql');
const config = {
  server: process.env.DB_HOST, port: 1433, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 120000 },
};

async function main() {
  const pool = await sql.connect(config);
  const tipo = await pool.request().query(`
    SELECT ISNULL(Est_Tipo_venta, Dis_Tipo_venta) tv, COUNT(*) n, SUM(Venta) v, SUM(Utilidad) u
    FROM BI_AN_VENTAS
    WHERE fecha_factura >= '2026-01-01'
    GROUP BY ISNULL(Est_Tipo_venta, Dis_Tipo_venta) ORDER BY n DESC
  `);
  console.log('tipo venta:', tipo.recordset);

  const inv = await pool.request().query(`
    SELECT COUNT(*) u, SUM(CostoCatalogo) costo, SUM(ImporteVenta) venta
    FROM BI_INVENTARIO_NUEVOS WHERE Vendida = 0 AND Existencia = 1
  `);
  console.log('inv value:', inv.recordset[0]);

  await pool.close();
}
main().catch(console.error);
