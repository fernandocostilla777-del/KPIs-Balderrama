require('dotenv').config({ override: true });
const { query } = require('../src/db');

const BRANCH_SEG = {
  piso: '0001', foraneos: '0002', cholula: '0004', zacatelco: '0005',
  flotillas: '0006', bdc: '0007', suauto: '0008', intercambios: '0010',
};

async function sumPat(table, mov, pat, asIncome) {
  const sign = asIncome
    ? `CASE WHEN CTA_NATURALEZA='ACRE' THEN -(${mov}) ELSE (${mov}) END`
    : `CASE WHEN CTA_NATURALEZA='DEUD' THEN (${mov}) ELSE -(${mov}) END`;
  const r = await query(`
    SELECT SUM(${sign}) n FROM [${table}]
    WHERE CTA_ACUMDET='DETA' AND CTA_NUMCTA LIKE @pat
  `, { pat });
  return Number(r[0]?.n || 0);
}

async function main() {
  const mov = 'ISNULL(CTA_CARGO12,0)-ISNULL(CTA_ABONO12,0)';
  const t = 'CON_CTAS012025';
  let totalV = 0;
  for (const [name, seg] of Object.entries(BRANCH_SEG)) {
    const v = await sumPat(t, mov, `0400-${seg}-%`, true);
    const c = await sumPat(t, mov, `0600-${seg}-%`, false);
    const g = await sumPat(t, mov, `0700-%${seg}-%`, false);
    totalV += v;
    console.log(`${name.padEnd(14)} v=${v.toFixed(0)} c=${c.toFixed(0)} g=${g.toFixed(0)} util=${(v-c).toFixed(0)}`);
  }
  console.log('sum ventas branch', totalV.toFixed(0));
  const all0400 = await sumPat(t, mov, '0400-%', true);
  console.log('total 0400', all0400.toFixed(0));

  // servicio/refacc/hyp by branch in account segment
  console.log('\nServicio por sucursal (046x segment 2):');
  for (const [name, seg] of Object.entries(BRANCH_SEG)) {
    const v = await sumPat(t, mov, `046%-${seg}-%`, true);
    if (Math.abs(v) > 1000) console.log(`  ${name}: ${v.toFixed(0)}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
