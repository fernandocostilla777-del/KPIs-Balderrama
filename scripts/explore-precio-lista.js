require('dotenv').config({ override: true });
const { query } = require('../src/db');

async function main() {
  const cols = await query(`
    SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE COLUMN_NAME LIKE '%PRECIO%'
       OR COLUMN_NAME LIKE '%LISTA%'
       OR COLUMN_NAME LIKE '%PRICE%'
       OR COLUMN_NAME LIKE '%PVP%'
       OR COLUMN_NAME LIKE '%IMPORTE%'
    ORDER BY TABLE_NAME, COLUMN_NAME
  `);
  console.log('columnas relacionadas:', cols.length);
  cols.slice(0, 80).forEach((c) => console.log(`${c.TABLE_NAME}.${c.COLUMN_NAME} (${c.DATA_TYPE})`));

  const vehCols = await query(`
    SELECT COLUMN_NAME, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'SER_VEHICULO'
    ORDER BY ORDINAL_POSITION
  `);
  console.log('\nSER_VEHICULO:', vehCols.map((c) => `${c.COLUMN_NAME}(${c.DATA_TYPE})`).join(', '));

  const catCols = await query(`
    SELECT COLUMN_NAME, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'UNI_CATALOGO'
    ORDER BY ORDINAL_POSITION
  `);
  console.log('\nUNI_CATALOGO:', catCols.map((c) => `${c.COLUMN_NAME}(${c.DATA_TYPE})`).join(', '));

  process.exit(0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
