require('dotenv').config({ override: true });
const { query } = require('../src/db');

(async () => {
  const r = await query(`
    SELECT TOP 20 CTA_NUMCTA, CTA_GPOCONT, CTA_NATURALEZA
    FROM CON_CTAS012026
    WHERE CTA_ACUMDET = 'DETA' AND CTA_NUMCTA LIKE '0400-0001-%'
    ORDER BY CTA_NUMCTA
  `);
  r.forEach((x) => console.log(x.CTA_NUMCTA, '| gpo:', x.CTA_GPOCONT, '|', x.CTA_NATURALEZA));

  const mov = 'ISNULL(CTA_CARGO6,0)-ISNULL(CTA_ABONO6,0)';
  const inc = `CASE WHEN CTA_NATURALEZA='ACRE' THEN -(${mov}) ELSE (${mov}) END`;
  const byGpo = await query(`
    SELECT CTA_GPOCONT, SUM(${inc}) t
    FROM CON_CTAS012026
    WHERE CTA_ACUMDET='DETA' AND CTA_NUMCTA LIKE '0400-%'
    GROUP BY CTA_GPOCONT
    HAVING ABS(SUM(${inc})) > 1000
    ORDER BY CTA_GPOCONT
  `);
  console.log('\n0400 by GPOCONT junio:');
  byGpo.forEach((x) => console.log(x.CTA_GPOCONT, Number(x.t).toFixed(2)));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
