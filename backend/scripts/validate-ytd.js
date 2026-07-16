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
  const ytd = movRange(1, 12);
  const dec = movRange(12, 12);

  const lines = [];
  lines.push('YTD 2025:');
  lines.push(`Ventas (4%)\t${await sum(t, ytd, "CTA_GPOCONT LIKE '4%'", true)}`);
  lines.push(`Costos (6%)\t${await sum(t, ytd, "CTA_GPOCONT LIKE '6%'", false)}`);
  lines.push(`Gastos op 711-733\t${await sum(t, ytd, "CTA_GPOCONT IN ('711','712','713','714','715','716','717','718','720','731','732','733')", false)}`);
  lines.push(`Gastos admin 740-750\t${await sum(t, ytd, "CTA_GPOCONT IN ('740','750')", false)}`);
  lines.push(`Otros fin 800-942\t${await sum(t, ytd, "CTA_GPOCONT IN ('800','900','903','906','908','909','910','912','931','938','940','941','942')", false)}`);

  const ventas = await sum(t, ytd, "CTA_GPOCONT LIKE '4%'", true);
  const costos = await sum(t, ytd, "CTA_GPOCONT LIKE '6%'", false);
  const gOp = await sum(t, ytd, "CTA_GPOCONT IN ('711','712','713','714','715','716','717','718','720','731','732','733')", false);
  const gAd = await sum(t, ytd, "CTA_GPOCONT IN ('740','750')", false);
  const otros = await sum(t, ytd, "CTA_GPOCONT IN ('800','900','903','906','908','909','910','912','931','938','940','941','942')", false);
  const utilBruta = ventas - costos;
  const utilOper = utilBruta - gOp - gAd;
  const utilPeriodo = utilOper - otros;
  lines.push(`Util bruta calc\t${utilBruta}`);
  lines.push(`Util oper calc\t${utilOper}`);
  lines.push(`Util periodo calc\t${utilPeriodo}`);

  console.log(lines.join('\n'));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
