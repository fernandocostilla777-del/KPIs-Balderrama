require('dotenv').config({ override: true });
const { query } = require('../src/db');

function movRange(a, b) {
  const p = [];
  for (let m = a; m <= b; m++) p.push(`ISNULL(CTA_CARGO${m},0)-ISNULL(CTA_ABONO${m},0)`);
  return p.join('+');
}

async function sum(table, mov, where, asIncome) {
  const sign = asIncome
    ? `CASE WHEN CTA_NATURALEZA='ACRE' THEN -(${mov}) ELSE (${mov}) END`
    : `CASE WHEN CTA_NATURALEZA='DEUD' THEN (${mov}) ELSE -(${mov}) END`;
  const r = await query(`SELECT SUM(${sign}) n FROM [${table}] WHERE CTA_ACUMDET='DETA' AND ${where}`);
  return Number(r[0]?.n || 0);
}

async function main() {
  const t = 'CON_CTAS012025';
  for (const [label, mov] of [['Dic', movRange(12, 12)], ['YTD', movRange(1, 12)]]) {
    const ventas = await sum(t, mov, "CTA_GPOCONT LIKE '4%'", true);
    const costos = await sum(t, mov, "CTA_GPOCONT LIKE '6%'", false);
    const gOp = await sum(t, mov, "CTA_GPOCONT IN ('711','712','713','714','715','716','717','718','720','731','732','733')", false);
    const gAd = await sum(t, mov, "CTA_GPOCONT IN ('740','750')", false);
    console.log(`\n${label}: ventas=${ventas.toFixed(2)} costos=${costos.toFixed(2)} utilBruta=${(ventas-costos).toFixed(2)} gastosOp=${gOp.toFixed(2)} gastosAd=${gAd.toFixed(2)} utilOp=${(ventas-costos-gOp-gAd).toFixed(2)}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
