require('dotenv').config({ override: true });
const { query } = require('../src/db');

async function main() {
  const biCols = await query(`
    SELECT COLUMN_NAME, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'BI_AN_VENTAS'
    ORDER BY ORDINAL_POSITION
  `);
  console.log('BI_AN_VENTAS:', biCols.map((c) => `${c.COLUMN_NAME}(${c.DATA_TYPE})`).join(', '));

  const monthly = await query(`
    SELECT TOP 24
      YEAR(fecha_factura) AS yr,
      MONTH(fecha_factura) AS mo,
      SUM(Unidades_vendidas) AS units,
      SUM(Venta) AS revenue,
      AVG(CAST(Dias_en_inventario AS FLOAT)) AS avgDays
    FROM BI_AN_VENTAS
    WHERE fecha_factura IS NOT NULL
    GROUP BY YEAR(fecha_factura), MONTH(fecha_factura)
    ORDER BY yr DESC, mo DESC
  `);
  console.log('monthly sample:', monthly.slice(0, 5));

  const byTipo = await query(`
    SELECT TOP 5 VTE_FORMAPAGO, COUNT(*) AS n
    FROM ADE_VTAFI
    WHERE VTE_TIPODOCTO = 'A' AND VTE_STATUS = 'I'
    GROUP BY VTE_FORMAPAGO
    ORDER BY n DESC
  `);
  console.log('formas pago:', byTipo);

  process.exit(0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
