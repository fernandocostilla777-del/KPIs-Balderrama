require('dotenv').config({ override: true });
const { query } = require('../src/db');

async function cols(table) {
  return query(`
    SELECT COLUMN_NAME, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = @table
    ORDER BY ORDINAL_POSITION
  `, { table });
}

async function main() {
  const targets = [
    'CON_CONFESTADORESULTADO',
    'CON_CONFBALANCEGENERAL',
    'CON_TEMPBALANCEGENERAL',
    'CON_TEMPESTADORESULTADO',
    'CON_CTAS012026',
    'CON_POL012026',
    'CON_MOVDET012026',
    'CATALOGO_DE_CUENTAS_GMI',
    'BALANZA_DE_COMPROBACIÓN_GMI',
  ];

  for (const table of targets) {
    try {
      const c = await cols(table);
      if (!c.length) {
        console.log(`\n${table}: (no existe)`);
        continue;
      }
      console.log(`\n${table}:`, c.map((x) => x.COLUMN_NAME).join(', '));
      const sample = await query(`SELECT TOP 3 * FROM [${table}]`);
      console.log('sample:', JSON.stringify(sample, null, 2).slice(0, 1500));
    } catch (e) {
      console.log(`\n${table}: ERROR ${e.message}`);
    }
  }

  // Latest year pol/mov tables
  const polTables = await query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME LIKE 'CON_POL%'
    ORDER BY TABLE_NAME DESC
  `);
  console.log('\nPOL tables (latest):', polTables.slice(0, 8).map((t) => t.TABLE_NAME));

  process.exit(0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
