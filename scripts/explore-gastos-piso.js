require('dotenv').config({ override: true });
const { query } = require('../src/db');

const mov = 'ISNULL(CTA_CARGO6, 0) - ISNULL(CTA_ABONO6, 0)';
const exp = `CASE WHEN CTA_NATURALEZA = 'DEUD' THEN (${mov}) ELSE -(${mov}) END`;

async function main() {
  const rows = await query(`
    SELECT
      LEFT(CTA_NUMCTA, 9) AS prefijo,
      SUM(${exp}) AS total
    FROM CON_CTAS012026
    WHERE CTA_ACUMDET = 'DETA'
      AND CTA_NUMCTA LIKE '0700-%-0001-%'
    GROUP BY LEFT(CTA_NUMCTA, 9)
    HAVING ABS(SUM(${exp})) > 100
    ORDER BY prefijo
  `);
  let sum = 0;
  rows.forEach((r) => {
    const t = Number(r.total || 0);
    sum += t;
    console.log(r.prefijo, t.toFixed(2));
  });
  console.log('TOTAL', sum.toFixed(2), 'Excel PISO gastos jun:', 2327442.31);

  const costRows = await query(`
    SELECT LEFT(CTA_NUMCTA, 13) AS prefijo, SUM(${exp}) AS total
    FROM CON_CTAS012026
    WHERE CTA_ACUMDET = 'DETA' AND (CTA_NUMCTA LIKE '0600-0008-%' OR CTA_NUMCTA LIKE '0600-0003-%')
    GROUP BY LEFT(CTA_NUMCTA, 13)
    HAVING ABS(SUM(${exp})) > 0
    ORDER BY prefijo
  `);
  console.log('\n0600 SUAUTO related:');
  costRows.forEach((r) => console.log(r.prefijo, Number(r.total).toFixed(2)));
}

main().catch(console.error);
