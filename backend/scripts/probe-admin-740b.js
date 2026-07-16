require('dotenv').config({ override: true });
const { query } = require('../src/db');
const mov = 'ISNULL(CTA_CARGO6,0)-ISNULL(CTA_ABONO6,0)';
const exp = `CASE WHEN CTA_NATURALEZA='DEUD' THEN (${mov}) ELSE -(${mov}) END`;

(async () => {
  const all = await query(`SELECT SUM(${exp}) t FROM CON_CTAS012026 WHERE CTA_ACUMDET='DETA' AND CTA_GPOCONT='740'`);
  const no7 = await query(`SELECT SUM(${exp}) t FROM CON_CTAS012026 WHERE CTA_ACUMDET='DETA' AND CTA_GPOCONT='740' AND CTA_NUMCTA NOT LIKE '%-0007-%'`);
  const only71x = await query(`SELECT SUM(${exp}) t FROM CON_CTAS012026 WHERE CTA_ACUMDET='DETA' AND CTA_GPOCONT IN ('711','712','713','714','715','718')`);
  console.log('740 all', Number(all[0].t).toFixed(2));
  console.log('740 sin 0007', Number(no7[0].t).toFixed(2), 'excel admin', 1959023.19);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
