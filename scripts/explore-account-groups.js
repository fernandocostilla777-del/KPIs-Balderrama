require('dotenv').config({ override: true });
const { query } = require('../src/db');

async function sampleGroup(g) {
  const rows = await query(`
    SELECT TOP 5 CTA_NUMCTA, CTA_DESCRIP
    FROM CON_CTAS012026
    WHERE CTA_ACUMDET = 'DETA' AND CTA_GPOCONT = @g
    ORDER BY CTA_NUMCTA
  `, { g });
  console.log(`\nGrupo ${g}:`);
  rows.forEach((r) => console.log(' ', r.CTA_NUMCTA, r.CTA_DESCRIP?.trim()));
}

async function sumGroup(g, startMonth, endMonth) {
  const parts = [];
  for (let m = startMonth; m <= endMonth; m++) {
    parts.push(`ISNULL(CTA_CARGO${m}, 0) - ISNULL(CTA_ABONO${m}, 0)`);
  }
  const mov = parts.join(' + ');
  const sign = `CASE WHEN CTA_NATURALEZA = 'ACRE' THEN -(${mov}) ELSE (${mov}) END`;
  const rows = await query(`SELECT SUM(${sign}) t FROM CON_CTAS012026 WHERE CTA_ACUMDET='DETA' AND CTA_GPOCONT=@g`, { g });
  return Number(rows[0].t || 0);
}

async function sumExpenseGroup(g, startMonth, endMonth) {
  const parts = [];
  for (let m = startMonth; m <= endMonth; m++) {
    parts.push(`ISNULL(CTA_CARGO${m}, 0) - ISNULL(CTA_ABONO${m}, 0)`);
  }
  const mov = parts.join(' + ');
  const sign = `CASE WHEN CTA_NATURALEZA = 'DEUD' THEN (${mov}) ELSE -(${mov}) END`;
  const rows = await query(`SELECT SUM(${sign}) t FROM CON_CTAS012026 WHERE CTA_ACUMDET='DETA' AND CTA_GPOCONT=@g`, { g });
  return Number(rows[0].t || 0);
}

async function main() {
  console.log('\n=== Junio 2026 por grupo ===');
  const ventaGroups = ['411', '412', '413', '414', '415', '423'];
  const costGroups = ['611', '612', '613', '614', '615', '618'];
  const gastoGroups = ['711', '712', '713', '714', '715', '718'];

  let v = 0; for (const g of ventaGroups) { const t = await sumGroup(g, 6, 6); console.log('V', g, t.toFixed(2)); v += t; }
  console.log('Ventas excel branches', v.toFixed(2), 'excel', 42174261.03);

  let c = 0; for (const g of costGroups) { const t = await sumExpenseGroup(g, 6, 6); console.log('C', g, t.toFixed(2)); c += t; }
  console.log('Costo excel branches', c.toFixed(2), 'excel', 38290601.71);

  let g = 0; for (const gr of gastoGroups) { const t = await sumExpenseGroup(gr, 6, 6); console.log('G', gr, t.toFixed(2)); g += t; }
  console.log('Gastos autos', g.toFixed(2), 'excel', 4337480.88);

  const admin = await sumExpenseGroup('740', 6, 6);
  console.log('Admin 740', admin.toFixed(2), 'excel', 1959023.19);
}

main().catch(console.error);
