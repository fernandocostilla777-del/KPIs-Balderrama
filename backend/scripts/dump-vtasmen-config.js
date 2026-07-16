require('dotenv').config({ override: true });
const fs = require('fs');
const path = require('path');
const { query } = require('../src/db');

async function dumpEstado(name) {
  const rows = await query(`
    SELECT Consecutivo, Tipo, Dato, Signo, Formula
    FROM CON_CONFESTADORESULTADO
    WHERE Estado = @estado
    ORDER BY Consecutivo
  `, { estado: name });
  return rows;
}

async function main() {
  const estados = await query(`
    SELECT DISTINCT Estado FROM CON_CONFESTADORESULTADO
    WHERE Estado LIKE '%DEPTO DE VENTAS%'
    ORDER BY Estado
  `);
  const lines = [];
  for (const { Estado } of estados) {
    lines.push('\n===== ' + Estado + ' =====');
    const rows = await dumpEstado(Estado);
    rows.forEach((r) => {
      lines.push(`${r.Consecutivo}\t${r.Tipo}\t${r.Signo || ''}\t${r.Dato}\t${r.Formula || ''}`);
    });
  }
  const dest = path.join(__dirname, 'vtasmen-config.txt');
  fs.writeFileSync(dest, lines.join('\n'), 'utf8');
  console.log('Written', dest, 'lines', lines.length);
}

main().catch(console.error);
