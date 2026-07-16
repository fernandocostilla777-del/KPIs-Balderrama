require('dotenv').config({ override: true });
const { query } = require('../src/db');
const mov = 'ISNULL(CTA_CARGO6,0)-ISNULL(CTA_ABONO6,0)';
const exp = `CASE WHEN CTA_NATURALEZA='DEUD' THEN (${mov}) ELSE -(${mov}) END`;

(async () => {
  const rows = await query(`
    SELECT CTA_NUMCTA, SUM(${exp}) t
    FROM CON_CTAS012026 WHERE CTA_ACUMDET='DETA' AND CTA_GPOCONT='740'
    GROUP BY CTA_NUMCTA HAVING ABS(SUM(${exp}))>500
    ORDER BY ABS(SUM(${exp})) DESC
  `);
  let veh = 0;
  let other = 0;
  rows.forEach((r) => {
    const t = Number(r.t);
    const isVeh = /VEHIC|VENTA.*AUTO|AUTOS NUEV|DEPTO.*VENT/i.test(r.CTA_NUMCTA);
    if (isVeh) veh += t;
    else other += t;
    console.log(t.toFixed(2), r.CTA_NUMCTA);
  });
  console.log('veh', veh, 'other', other, 'total', veh + other, 'excel', 1959023.19);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
