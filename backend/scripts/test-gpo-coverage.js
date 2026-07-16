require('dotenv').config({ path: require('path').join(__dirname, '../.env'), override: true });
const { query } = require('../src/db');
const { DEPARTMENTS, OPERATING_GPO_GROUPS } = require('../src/config/departmentExpenseMapping');

async function main() {
  const mov = 'ISNULL(CTA_CARGO6,0)-ISNULL(CTA_ABONO6,0)';
  const sign = `CASE WHEN CTA_NATURALEZA='DEUD' THEN (${mov}) ELSE -(${mov}) END`;
  const rows = await query(`
    SELECT CTA_GPOCONT AS gpo, SUM(${sign}) AS total
    FROM CON_CTAS012026
    WHERE CTA_ACUMDET='DETA' AND CTA_NUMCTA LIKE '0700%'
    GROUP BY CTA_GPOCONT
    HAVING ABS(SUM(${sign})) > 0.01
    ORDER BY CTA_GPOCONT
  `);
  const deptGpos = new Set(DEPARTMENTS.map((d) => d.gpoCont));
  let mapped = 0;
  let unmapped = 0;
  for (const r of rows) {
    const t = Number(r.total);
    const inDept = deptGpos.has(String(r.gpo).trim());
    console.log(r.gpo, t.toFixed(2), inDept ? 'OK' : 'MISSING');
    if (inDept) mapped += t;
    else unmapped += t;
  }
  console.log('Mapped GPO sum', mapped.toFixed(2));
  console.log('Unmapped GPO sum', unmapped.toFixed(2));
  console.log('OPERATING_GPO_GROUPS', OPERATING_GPO_GROUPS.join(','));
}

main().catch((e) => { console.error(e); process.exit(1); });
