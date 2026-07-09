require('dotenv').config({ override: true });
const { query } = require('../src/db');

async function main() {
  const tables = await query(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE'
      AND (
        TABLE_NAME LIKE '%CON%'
        OR TABLE_NAME LIKE '%CTB%'
        OR TABLE_NAME LIKE '%POL%'
        OR TABLE_NAME LIKE '%BAL%'
        OR TABLE_NAME LIKE '%EEFF%'
        OR TABLE_NAME LIKE '%CUENTA%'
        OR TABLE_NAME LIKE '%MAYOR%'
        OR TABLE_NAME LIKE '%DIARIO%'
        OR TABLE_NAME LIKE '%EDO%'
        OR TABLE_NAME LIKE '%FIN%'
      )
    ORDER BY TABLE_NAME
  `);
  console.log('Tablas contables candidatas:', tables.map((t) => t.TABLE_NAME).join(', '));

  const cols = await query(`
    SELECT TABLE_NAME, COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE COLUMN_NAME LIKE '%SALDO%'
       OR COLUMN_NAME LIKE '%CUENTA%'
       OR COLUMN_NAME LIKE '%POLIZ%'
       OR COLUMN_NAME LIKE '%DEBE%'
       OR COLUMN_NAME LIKE '%HABER%'
       OR COLUMN_NAME LIKE '%UTILIDAD%'
       OR COLUMN_NAME LIKE '%ACTIVO%'
       OR COLUMN_NAME LIKE '%PASIVO%'
    ORDER BY TABLE_NAME, COLUMN_NAME
  `);
  console.log('\nColumnas saldo/cuenta (primeras 60):');
  cols.slice(0, 60).forEach((c) => console.log(`${c.TABLE_NAME}.${c.COLUMN_NAME}`));

  process.exit(0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
