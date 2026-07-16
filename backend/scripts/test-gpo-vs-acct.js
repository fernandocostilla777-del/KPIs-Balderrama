require('dotenv').config({ path: require('path').join(__dirname, '../.env'), override: true });
const { query } = require('../src/db');
const { DEPARTMENTS } = require('../src/config/departmentExpenseMapping');

async function main() {
  const mov = 'ISNULL(CTA_CARGO6,0)-ISNULL(CTA_ABONO6,0)';
  const sign = `CASE WHEN CTA_NATURALEZA='DEUD' THEN (${mov}) ELSE -(${mov}) END`;
  let gpoTotal = 0;
  let acctTotal = 0;

  for (const d of DEPARTMENTS) {
    const g = await query(`
      SELECT SUM(${sign}) AS t FROM CON_CTAS012026
      WHERE CTA_ACUMDET='DETA' AND CTA_GPOCONT=@g
    `, { g: d.gpoCont });
    const gv = Number(g[0].t || 0);
    gpoTotal += gv;

    let av = 0;
    if (d.accounts?.length) {
      for (let i = 0; i < d.accounts.length; i += 80) {
        const batch = d.accounts.slice(i, i + 80);
        const params = {};
        const ph = batch.map((_, j) => `@a${j}`).join(', ');
        batch.forEach((a, j) => { params[`a${j}`] = a; });
        const r = await query(`
          SELECT SUM(${sign}) AS t FROM CON_CTAS012026
          WHERE CTA_ACUMDET='DETA' AND CTA_NUMCTA IN (${ph})
        `, params);
        av += Number(r[0].t || 0);
      }
    }
    acctTotal += av;
    if (Math.abs(gv - av) > 1) {
      console.log(d.label, 'GPO', gv.toFixed(2), 'ACCT', av.toFixed(2), 'diff', (av - gv).toFixed(2));
    }
  }

  const all0700 = await query(`
    SELECT SUM(${sign}) AS t FROM CON_CTAS012026
    WHERE CTA_ACUMDET='DETA' AND CTA_NUMCTA LIKE '0700%'
  `);
  console.log('GPO sum depts', gpoTotal.toFixed(2));
  console.log('ACCT sum depts', acctTotal.toFixed(2));
  console.log('0700 total', Number(all0700[0].t).toFixed(2));
}

main().catch((e) => { console.error(e); process.exit(1); });
