require('dotenv').config({ override: true });
const { query } = require('../src/db');

async function main() {
  const mov = 'ISNULL(CTA_CARGO12,0)-ISNULL(CTA_ABONO12,0)';
  const rows = await query(`
    SELECT TOP 15 CTA_NUMCTA, CTA_DESCRIPCION, CTA_GPOCONT,
      CASE WHEN CTA_NATURALEZA='ACRE' THEN -(${mov}) ELSE (${mov}) END neto
    FROM CON_CTAS012025
    WHERE CTA_ACUMDET='DETA'
      AND (CTA_DESCRIPCION LIKE '%SEMIN%' OR CTA_DESCRIPCION LIKE '%SEMI %' OR CTA_DESCRIPCION LIKE '%USAD%')
      AND ABS(CASE WHEN CTA_NATURALEZA='ACRE' THEN -(${mov}) ELSE (${mov}) END) > 1000
    ORDER BY ABS(CASE WHEN CTA_NATURALEZA='ACRE' THEN -(${mov}) ELSE (${mov}) END) DESC
  `);
  rows.forEach((r) => console.log(`${r.CTA_NUMCTA}\t${r.CTA_GPOCONT}\t${Number(r.neto).toFixed(0)}\t${r.CTA_DESCRIPCION}`));

  const desc = await query(`
    SELECT CTA_GPOCONT g, SUM(CASE WHEN CTA_NATURALEZA='ACRE' THEN -(${mov}) ELSE (${mov}) END) neto
    FROM CON_CTAS012025 WHERE CTA_ACUMDET='DETA' AND CTA_GPOCONT IN ('431','432','433','435','436','437','438')
    GROUP BY CTA_GPOCONT
  `);
  console.log('\nDescuentos por grupo:', desc);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
