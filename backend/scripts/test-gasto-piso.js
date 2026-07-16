require('dotenv').config({ path: require('path').join(__dirname, '../.env'), override: true });
const { query } = require('../src/db');
const { DEPARTMENTS } = require('../src/config/departmentExpenseMapping');

async function main() {
  const mov = 'ISNULL(CTA_CARGO6,0)-ISNULL(CTA_ABONO6,0)';
  const sign = `CASE WHEN CTA_NATURALEZA='DEUD' THEN (${mov}) ELSE -(${mov}) END`;

  const gpo711 = await query(`
    SELECT SUM(${sign}) AS t FROM CON_CTAS012026
    WHERE CTA_ACUMDET='DETA' AND CTA_GPOCONT='711'
  `);
  const gpo711_0700 = await query(`
    SELECT SUM(${sign}) AS t FROM CON_CTAS012026
    WHERE CTA_ACUMDET='DETA' AND CTA_NUMCTA LIKE '0700%' AND CTA_GPOCONT='711'
  `);

  const piso = DEPARTMENTS.find((d) => d.gpoCont === '711');
  const accounts = piso.accounts;
  let acctTotal = 0;
  for (let i = 0; i < accounts.length; i += 80) {
    const batch = accounts.slice(i, i + 80);
    const params = {};
    const ph = batch.map((_, j) => `@a${j}`).join(', ');
    batch.forEach((acc, j) => { params[`a${j}`] = acc; });
    const rows = await query(`
      SELECT SUM(${sign}) AS t FROM CON_CTAS012026
      WHERE CTA_ACUMDET='DETA' AND CTA_NUMCTA IN (${ph})
    `, params);
    acctTotal += Number(rows[0]?.t || 0);
  }

  console.log('GPO 711 (all accounts):', gpo711[0].t);
  console.log('GPO 711 (0700 only):', gpo711_0700[0].t);
  console.log('Excel account list (' + accounts.length + '):', acctTotal);

  // accounts in GPO711 but not in excel list
  const rows = await query(`
    SELECT CTA_NUMCTA, ${sign} AS mov
    FROM CON_CTAS012026
    WHERE CTA_ACUMDET='DETA' AND CTA_GPOCONT='711' AND CTA_NUMCTA LIKE '0700%'
      AND ABS(${sign}) > 0.01
  `);
  const excelSet = new Set(accounts);
  const missing = rows.filter((r) => !excelSet.has(r.CTA_NUMCTA.trim()));
  const extra = rows.filter((r) => excelSet.has(r.CTA_NUMCTA.trim()));
  console.log('Moving accounts in GPO711 not in Excel:', missing.length, 'sum', missing.reduce((s, r) => s + Number(r.mov), 0));
  console.log('Moving accounts in Excel list:', extra.length, 'sum', extra.reduce((s, r) => s + Number(r.mov), 0));
  if (missing.length) {
    console.log('Sample missing:', missing.slice(0, 10).map((r) => `${r.CTA_NUMCTA}=${r.mov}`));
  }

  // Cuentas Excel con movimiento pero GPOCONT distinto de 711
  const wrongGpo = [];
  for (const acc of accounts) {
    const rows = await query(`
      SELECT CTA_GPOCONT, ${sign} AS mov FROM CON_CTAS012026
      WHERE CTA_ACUMDET='DETA' AND CTA_NUMCTA=@a AND ABS(${sign}) > 0.01
    `, { a: acc });
    for (const r of rows) {
      if (String(r.CTA_GPOCONT).trim() !== '711') {
        wrongGpo.push({ acc, gpo: r.CTA_GPOCONT, mov: r.mov });
      }
    }
  }
  console.log('Excel accounts with movement but GPO != 711:', wrongGpo.length,
    'sum', wrongGpo.reduce((s, r) => s + Number(r.mov), 0));
  wrongGpo.slice(0, 15).forEach((r) => console.log(' ', r.acc, 'GPO', r.gpo, r.mov));
}

main().catch((e) => { console.error(e); process.exit(1); });
