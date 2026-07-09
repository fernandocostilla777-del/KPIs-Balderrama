require('dotenv').config({ override: true });
const { query } = require('../src/db');

async function main() {
  const tables = await query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME LIKE '%ESTADO%' OR TABLE_NAME LIKE '%VTAS%' OR TABLE_NAME LIKE '%RESULT%'
    ORDER BY TABLE_NAME
  `);
  console.log('Tables:', tables.map((t) => t.TABLE_NAME).join(', '));

  const conf = await query(`
    SELECT TOP 200 Estado, Consecutivo, Tipo, Dato, Signo, Formula
    FROM CON_CONFESTADORESULTADO
    WHERE Dato LIKE '%AUTOS%' OR Dato LIKE '%VTAS%' OR Dato LIKE '%0700%' OR Dato LIKE '%0400%'
    ORDER BY Estado, Consecutivo
  `);
  conf.forEach((r) => console.log(JSON.stringify(r)));
}

main().catch(console.error);
