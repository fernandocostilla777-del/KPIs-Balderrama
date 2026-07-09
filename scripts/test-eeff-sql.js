require('dotenv').config({ override: true });
const fs = require('fs');
const path = require('path');
const { query } = require('../src/db');

function ctasTable(year) {
  return `CON_CTAS01${year}`;
}

function accountBalanceExpr(months) {
  const parts = ['ISNULL(CTA_SDOINICIAL, 0)'];
  for (let m = 1; m <= months; m++) {
    parts.push(`ISNULL(CTA_CARGO${m}, 0) - ISNULL(CTA_ABONO${m}, 0)`);
  }
  return parts.join(' + ');
}

function periodMovementExpr(startMonth, endMonth) {
  const parts = [];
  for (let m = startMonth; m <= endMonth; m++) {
    parts.push(`ISNULL(CTA_CARGO${m}, 0) - ISNULL(CTA_ABONO${m}, 0)`);
  }
  return parts.length ? parts.join(' + ') : '0';
}

function signedBalance(naturaleza, expr) {
  return naturaleza === 'DEUD'
    ? `CASE WHEN c.CTA_NATURALEZA = 'DEUD' THEN (${expr}) ELSE -(${expr}) END`
    : `CASE WHEN c.CTA_NATURALEZA = 'ACRE' THEN -(${expr}) ELSE (${expr}) END`;
}

async function main() {
  const year = 2025;
  const month = 12;
  const table = ctasTable(year);
  const balExpr = accountBalanceExpr(month);
  const movExpr = periodMovementExpr(12, 12);
  const lines = [];

  const bySection = await query(`
    SELECT cfg.PERTENECE, cfg.GRUPO,
      SUM(CASE WHEN c.CTA_NATURALEZA = 'DEUD' THEN (${balExpr}) ELSE -(${balExpr}) END) AS saldo
    FROM CON_CONFBALANCEGENERAL cfg
    LEFT JOIN [${table}] c ON c.CTA_GPOCONT = cfg.GRUPO AND c.CTA_ACUMDET = 'DETA'
    GROUP BY cfg.PERTENECE, cfg.GRUPO, cfg.CONSECUTIVO
    ORDER BY cfg.CONSECUTIVO
  `);
  lines.push('=== Balance Dic 2025 (DETA) ===');
  const totals = {};
  bySection.forEach((r) => {
    const saldo = Number(r.saldo || 0);
    totals[r.PERTENECE] = (totals[r.PERTENECE] || 0) + saldo;
    lines.push(`${r.PERTENECE}\t${r.GRUPO}\t${saldo.toFixed(2)}`);
  });
  Object.entries(totals).forEach(([k, v]) => lines.push(`TOTAL ${k}\t${v.toFixed(2)}`));

  const kpis = [
    ['Ventas totales (611-618)', "CTA_GPOCONT IN ('611','612','613','614','615','616','617','618')", 'ingreso'],
    ['Costo ventas (631-640)', "CTA_GPOCONT IN ('631','632','633','634','635','636','637','638','639','640')", 'costo'],
    ['Gastos operacion (711-733)', "CTA_GPOCONT IN ('711','712','713','714','715','716','717','718','720','731','732','733')", 'costo'],
    ['Gastos admin (740-750)', "CTA_GPOCONT IN ('740','750')", 'costo'],
    ['Otros ing/gast (800-942)', "CTA_GPOCONT IN ('800','900','903','906','908','909','910','912','931','938','940','941','942')", 'mix'],
  ];

  lines.push('\n=== Estado resultados Dic 2025 ===');
  for (const [label, where, type] of kpis) {
    const sign = type === 'ingreso'
      ? `CASE WHEN CTA_NATURALEZA = 'ACRE' THEN -(${movExpr}) ELSE (${movExpr}) END`
      : `CASE WHEN CTA_NATURALEZA = 'DEUD' THEN (${movExpr}) ELSE -(${movExpr}) END`;
    const r = await query(`
      SELECT SUM(${sign}) AS neto FROM [${table}]
      WHERE CTA_ACUMDET = 'DETA' AND ${where}
    `);
    lines.push(`${label}\t${Number(r[0]?.neto || 0).toFixed(2)}`);
  }

  fs.writeFileSync(path.join(__dirname, 'eeff-sql-test.txt'), lines.join('\n'));
  console.log(lines.join('\n'));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
