require('dotenv').config();
const { query } = require('../src/db');

async function findColumns(pattern) {
  return query(`
    SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE COLUMN_NAME LIKE @pattern
    ORDER BY TABLE_NAME, COLUMN_NAME
  `, { pattern });
}

async function main() {
  const patterns = ['%SUBTOT%', '%COSTO%', '%BONIF%', '%UTILID%', '%VENTA%', '%GASTO%'];
  for (const p of patterns) {
    const rows = await findColumns(p);
    if (rows.length) {
      console.log(`\n-- ${p} (${rows.length}) --`);
      rows.slice(0, 40).forEach((r) => console.log(`${r.TABLE_NAME}.${r.COLUMN_NAME}`));
      if (rows.length > 40) console.log(`... +${rows.length - 40} more`);
    }
  }

  const adeCols = await query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'ADE_VTAFI' ORDER BY ORDINAL_POSITION
  `);
  console.log('\nADE_VTAFI cols:', adeCols.map((c) => c.COLUMN_NAME).join(', '));

  const recent = await query(`
    SELECT TOP 3 VTE_FECHDOCTO, VTE_DOCTO, VTE_SERIE, VTE_TIPODOCTO, VTE_STATUS
    FROM ADE_VTAFI
    WHERE VTE_TIPODOCTO = 'A' AND VTE_STATUS = 'I'
      AND CONVERT(DATE, VTE_FECHDOCTO, 103) >= '2026-06-01'
    ORDER BY VTE_FECHDOCTO DESC
  `);
  console.log('\nRecent ADE_VTAFI:', recent);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
