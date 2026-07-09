require('dotenv').config({ override: true });
const { query } = require('../src/db');

async function main() {
  const mov = `ISNULL(CTA_CARGO12,0)-ISNULL(CTA_ABONO12,0)`;
  const rows = await query(`
    SELECT TOP 30 CTA_GPOCONT g, MIN(CTA_DESCRIPCION) ejemplo, MIN(CTA_NATURALEZA) nat,
      SUM(CASE WHEN CTA_NATURALEZA='ACRE' THEN -(${mov}) ELSE (${mov}) END) neto
    FROM CON_CTAS012025
    WHERE CTA_ACUMDET='DETA' AND CTA_GPOCONT LIKE '4%'
    GROUP BY CTA_GPOCONT
    HAVING ABS(SUM(CASE WHEN CTA_NATURALEZA='ACRE' THEN -(${mov}) ELSE (${mov}) END)) > 50000
    ORDER BY ABS(SUM(CASE WHEN CTA_NATURALEZA='ACRE' THEN -(${mov}) ELSE (${mov}) END)) DESC
  `);
  rows.forEach((r) => console.log(`${r.g}\t${r.nat}\t${Number(r.neto).toFixed(0)}\t${r.ejemplo}`));

  const ing = await query(`
    SELECT TOP 20 CTA_GPOCONT g, MIN(CTA_DESCRIPCION) ejemplo,
      SUM(CASE WHEN CTA_NATURALEZA='ACRE' THEN -(${mov}) ELSE (${mov}) END) neto
    FROM CON_CTAS012025
    WHERE CTA_ACUMDET='DETA' AND CTA_NUMCTA LIKE '04%'
    GROUP BY CTA_GPOCONT
    ORDER BY ABS(SUM(CASE WHEN CTA_NATURALEZA='ACRE' THEN -(${mov}) ELSE (${mov}) END)) DESC
  `);
  console.log('\nBy account 04xx:');
  ing.forEach((r) => console.log(`${r.g}\t${Number(r.neto).toFixed(0)}\t${r.ejemplo}`));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
