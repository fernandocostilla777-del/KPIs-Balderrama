require('dotenv').config({ override: true });
const { query } = require('../src/db');

const mov = 'ISNULL(CTA_CARGO6,0)-ISNULL(CTA_ABONO6,0)';
const exp = `CASE WHEN CTA_NATURALEZA='DEUD' THEN (${mov}) ELSE -(${mov}) END`;

(async () => {
  const rows = await query(`
    SELECT CTA_NUMCTA, SUM(${exp}) AS t
    FROM CON_CTAS012026
    WHERE CTA_ACUMDET='DETA' AND CTA_GPOCONT='740'
    GROUP BY CTA_NUMCTA
    HAVING ABS(SUM(${exp})) > 1000
    ORDER BY ABS(SUM(${exp})) DESC
  `);
  let total = 0;
  rows.forEach((r) => {
    const t = Number(r.t);
    total += t;
    console.log(r.CTA_NUMCTA, t.toFixed(2));
  });
  console.log('TOTAL', total.toFixed(2));

  // CORTE05 groups as income
  const prodGroups = ['812', '813', '814', '815', '816', '817', '821', '822'];
  const inc = `CASE WHEN CTA_NATURALEZA='ACRE' THEN -(${mov}) ELSE (${mov}) END`;
  let prod = 0;
  for (const g of prodGroups) {
    const r = await query(`SELECT SUM(${inc}) t FROM CON_CTAS012026 WHERE CTA_ACUMDET='DETA' AND CTA_GPOCONT=@g`, { g });
    const t = Number(r[0].t || 0);
    prod += t;
    if (t) console.log('prod', g, t.toFixed(2));
  }
  console.log('Sum productos groups', prod.toFixed(2), 'excel', 2202877.45);

  const gastGroups = ['901', '938', '940', '941'];
  let gast = 0;
  for (const g of gastGroups) {
    const r = await query(`SELECT SUM(${exp}) t FROM CON_CTAS012026 WHERE CTA_ACUMDET='DETA' AND CTA_GPOCONT=@g`, { g });
    const t = Number(r[0].t || 0);
    gast += t;
    if (t) console.log('gast', g, t.toFixed(2));
  }
  const r823 = await query(`SELECT SUM(${exp}) t FROM CON_CTAS012026 WHERE CTA_ACUMDET='DETA' AND CTA_GPOCONT='823'`);
  const r942 = await query(`SELECT SUM(${exp}) t FROM CON_CTAS012026 WHERE CTA_ACUMDET='DETA' AND CTA_GPOCONT='942'`);
  gast -= Number(r823[0].t || 0);
  gast -= Number(r942[0].t || 0);
  console.log('Sum gastos fin', gast.toFixed(2), 'excel', 436010.68);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
