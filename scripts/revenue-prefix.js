require('dotenv').config({ override: true });
const { query } = require('../src/db');

async function main() {
  const mov = 'ISNULL(CTA_CARGO12,0)-ISNULL(CTA_ABONO12,0)';
  const rows = await query(`
    SELECT LEFT(CTA_NUMCTA, 4) pref,
      SUM(CASE WHEN CTA_NATURALEZA='ACRE' THEN -(${mov}) ELSE (${mov}) END) neto
    FROM CON_CTAS012025
    WHERE CTA_ACUMDET='DETA' AND CTA_NUMCTA LIKE '04%'
    GROUP BY LEFT(CTA_NUMCTA, 4)
    HAVING ABS(SUM(CASE WHEN CTA_NATURALEZA='ACRE' THEN -(${mov}) ELSE (${mov}) END)) > 10000
    ORDER BY pref
  `);
  rows.forEach((r) => console.log(`${r.pref}\t${Number(r.neto).toFixed(0)}`));

  const rows6 = await query(`
    SELECT LEFT(CTA_NUMCTA, 4) pref,
      SUM(CASE WHEN CTA_NATURALEZA='DEUD' THEN (${mov}) ELSE -(${mov}) END) neto
    FROM CON_CTAS012025
    WHERE CTA_ACUMDET='DETA' AND CTA_NUMCTA LIKE '06%'
    GROUP BY LEFT(CTA_NUMCTA, 4)
    HAVING ABS(SUM(CASE WHEN CTA_NATURALEZA='DEUD' THEN (${mov}) ELSE -(${mov}) END)) > 10000
    ORDER BY pref
  `);
  console.log('\nCostos 06xx Dec:');
  rows6.forEach((r) => console.log(`${r.pref}\t${Number(r.neto).toFixed(0)}`));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
