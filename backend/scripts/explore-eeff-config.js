require('dotenv').config({ override: true });
const fs = require('fs');
const path = require('path');
const { query } = require('../src/db');

async function main() {
  const lines = [];

  const edoConfig = await query(`
    SELECT Estado, Consecutivo, Tipo, Dato, Signo, Formula
    FROM CON_CONFESTADORESULTADO
    WHERE Estado LIKE '%RESULTADOS%'
    ORDER BY Consecutivo
  `);
  lines.push('=== CON_CONFESTADORESULTADO (Estado de Resultados) ===');
  edoConfig.forEach((r) => {
    lines.push(`${r.Consecutivo}\t${r.Tipo}\t${r.Signo || ''}\t${r.Dato}`);
  });

  const balConfig = await query(`
    SELECT CONSECUTIVO, PERTENECE, GRUPO, Signo
    FROM CON_CONFBALANCEGENERAL
    ORDER BY CONSECUTIVO
  `);
  lines.push('\n=== CON_CONFBALANCEGENERAL ===');
  balConfig.forEach((r) => {
    lines.push(`${r.CONSECUTIVO}\t${r.PERTENECE}\t${r.GRUPO}\t${r.Signo}`);
  });

  const grupos = await query(`
    SELECT DISTINCT CTA_GPOCONT, COUNT(*) AS cuentas
    FROM CON_CTAS012026
    GROUP BY CTA_GPOCONT
    ORDER BY CTA_GPOCONT
  `);
  lines.push('\n=== Grupos contables CON_CTAS012026 ===');
  grupos.forEach((r) => lines.push(`${r.CTA_GPOCONT}\t${r.cuentas} cuentas`));

  const edoResult = await query(`
    SELECT Consecutivo, Descripcion, Importe, SubTotal, PorVentas, Usuario
    FROM CON_TEMPESTADORESULTADO
    WHERE Usuario = 'GMI '
      AND Descripcion IS NOT NULL AND LTRIM(RTRIM(Descripcion)) <> ''
      AND Importe IS NOT NULL AND LTRIM(RTRIM(CAST(Importe AS VARCHAR(50)))) <> ''
    ORDER BY Consecutivo
  `);
  lines.push('\n=== CON_TEMPESTADORESULTADO (GMI, con importe) ===');
  edoResult.slice(0, 80).forEach((r) => {
    lines.push(`${r.Consecutivo}\t${r.Descripcion}\t${r.Importe}\t${r.SubTotal || ''}`);
  });

  const balance = await query(`
    SELECT consecutivo, descripcion, monto, usuario
    FROM CON_TEMPBALANCEGENERAL
    WHERE usuario = 'GMI'
      AND descripcion IS NOT NULL AND LTRIM(RTRIM(descripcion)) <> ''
      AND monto NOT LIKE '%____%'
    ORDER BY consecutivo
  `);
  lines.push('\n=== CON_TEMPBALANCEGENERAL (GMI) ===');
  balance.forEach((r) => lines.push(`${r.consecutivo}\t${r.descripcion}\t${r.monto}`));

  const dest = path.join(__dirname, 'eeff-config-output.txt');
  fs.writeFileSync(dest, lines.join('\n'), 'utf8');
  console.log('Escrito:', dest);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
