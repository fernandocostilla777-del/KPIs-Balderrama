require('dotenv').config({ override: true });
const { query } = require('../src/db');

function mov(s, e) {
  const p = [];
  for (let m = s; m <= e; m++) p.push(`ISNULL(CTA_CARGO${m},0)-ISNULL(CTA_ABONO${m},0)`);
  return p.join('+');
}

async function sumGpo(g, s, e, mode = 'expense') {
  const sign = mode === 'income'
    ? `CASE WHEN CTA_NATURALEZA='ACRE' THEN -(${mov(s,e)}) ELSE (${mov(s,e)}) END`
    : `CASE WHEN CTA_NATURALEZA='DEUD' THEN (${mov(s,e)}) ELSE -(${mov(s,e)}) END`;
  const r = await query(`SELECT SUM(${sign}) t FROM CON_CTAS012026 WHERE CTA_ACUMDET='DETA' AND CTA_GPOCONT=@g`, { g });
  return Number(r[0].t || 0);
}

(async () => {
  console.log('=== Grupos financieros junio 2026 ===');
  for (const g of ['812', '813', '814', '815', '816', '817', '821', '822', '901', '938', '823', '940', '941', '942', '740', '750']) {
    const inc = await sumGpo(g, 6, 6, 'income');
    const exp = await sumGpo(g, 6, 6, 'expense');
    if (Math.abs(inc) > 1 || Math.abs(exp) > 1) {
      console.log(g, 'income', inc.toFixed(2), 'expense', exp.toFixed(2));
    }
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
