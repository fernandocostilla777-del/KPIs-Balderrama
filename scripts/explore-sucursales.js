require('dotenv').config({ override: true });
const { query } = require('../src/db');

async function main() {
  const mov = 'ISNULL(CTA_CARGO12,0)-ISNULL(CTA_ABONO12,0)';
  const sign = `CASE WHEN CTA_NATURALEZA='ACRE' THEN -(${mov}) WHEN CTA_NATURALEZA='DEUD' THEN (${mov}) ELSE 0 END`;

  const ventas = await query(`
    SELECT TOP 40 CTA_NUMCTA, CTA_DESCRIPCION, CTA_GPOCONT, ${sign} AS neto
    FROM CON_CTAS012025
    WHERE CTA_ACUMDET='DETA'
      AND (CTA_NUMCTA LIKE '0400%' OR CTA_NUMCTA LIKE '041%' OR CTA_NUMCTA LIKE '042%')
      AND ABS(${sign}) > 50000
    ORDER BY ABS(${sign}) DESC
  `);
  console.log('=== Ventas autos por cuenta Dic 2025 ===');
  ventas.forEach((r) => console.log(`${r.CTA_NUMCTA}\t${Number(r.neto).toFixed(0)}\t${r.CTA_DESCRIPCION}`));

  const cc = await query(`
    SELECT DISTINCT CTA_GPOCONT4, COUNT(*) c
    FROM CON_CTAS012025
    WHERE CTA_ACUMDET='DETA' AND CTA_GPOCONT4 IS NOT NULL AND LTRIM(RTRIM(CTA_GPOCONT4)) <> ''
    GROUP BY CTA_GPOCONT4 ORDER BY c DESC
  `);
  console.log('\n=== CTA_GPOCONT4 ===', cc.slice(0, 20));

  const gastos = await query(`
    SELECT DISTINCT LEFT(CTA_NUMCTA, 13) pref, MIN(CTA_DESCRIPCION) descrp, COUNT(*) c
    FROM CON_CTAS012025
    WHERE CTA_ACUMDET='DETA' AND CTA_NUMCTA LIKE '0700-0011%'
    GROUP BY LEFT(CTA_NUMCTA, 13)
    ORDER BY pref
  `);
  console.log('\n=== Gastos ventas 0700-0011 ===');
  gastos.forEach((r) => console.log(`${r.pref}\t${r.descrp}`));

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
