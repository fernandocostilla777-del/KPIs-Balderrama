require('dotenv').config();
const { query } = require('../src/db');

async function main() {
  for (const table of ['BI_VentaAutosNuevosFechDet', 'BI_AN_VENTAS']) {
    const cols = await query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = @table
      ORDER BY ORDINAL_POSITION
    `, { table });
    console.log(`\n=== ${table} (${cols.length} cols) ===`);
    console.log(cols.map((c) => c.COLUMN_NAME).join(', '));

    const [count] = await query(`SELECT COUNT(*) AS n FROM dbo.[${table}]`);
    console.log('rows:', count.n);

    const dateCol = cols.find((c) => /fecha/i.test(c.COLUMN_NAME));
    if (dateCol) {
      const range = await query(`
        SELECT MIN(${dateCol.COLUMN_NAME}) AS minD, MAX(${dateCol.COLUMN_NAME}) AS maxD
        FROM dbo.[${table}]
      `);
      console.log('date range:', range[0]);
    }
  }

  const biFin = await query(`
    SELECT TOP 3
      Venta, Costo, Utilidad, Bonificaciones, CostoBPRO,
      Unidades_vendidas, fecha_factura
    FROM BI_AN_VENTAS
    WHERE fecha_factura >= '2024-01-01'
    ORDER BY fecha_factura DESC
  `);
  console.log('\nBI_AN_VENTAS sample:', biFin);

  const detCols = await query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'BI_VentaAutosNuevosFechDet'
      AND (COLUMN_NAME LIKE '%Venta%' OR COLUMN_NAME LIKE '%Costo%'
        OR COLUMN_NAME LIKE '%Util%' OR COLUMN_NAME LIKE '%Bonif%'
        OR COLUMN_NAME LIKE '%Gasto%' OR COLUMN_NAME LIKE '%fecha%')
    ORDER BY ORDINAL_POSITION
  `);
  console.log('\nFinancial-like cols in BI_VentaAutosNuevosFechDet:', detCols.map((c) => c.COLUMN_NAME));

  if (detCols.length) {
    const names = detCols.map((c) => c.COLUMN_NAME);
    const sample = await query(`SELECT TOP 2 ${names.join(', ')} FROM BI_VentaAutosNuevosFechDet`);
    console.log('sample:', sample);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
