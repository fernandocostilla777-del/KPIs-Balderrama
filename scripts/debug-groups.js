require('dotenv').config({ override: true });
const { query } = require('../src/db');

async function main() {
  const mov = `
    ISNULL(CTA_CARGO12,0)-ISNULL(CTA_ABONO12,0)
  `;
  const groups = await query(`
    SELECT CTA_GPOCONT g,
      SUM(CASE WHEN CTA_NATURALEZA='ACRE' THEN -(${mov}) ELSE (${mov}) END) ingreso,
      SUM(CASE WHEN CTA_NATURALEZA='DEUD' THEN (${mov}) ELSE -(${mov}) END) costo
    FROM CON_CTAS012025
    WHERE CTA_ACUMDET='DETA'
      AND (CTA_GPOCONT LIKE '6%' OR CTA_GPOCONT LIKE '7%')
    GROUP BY CTA_GPOCONT
    HAVING ABS(SUM(CASE WHEN CTA_NATURALEZA='ACRE' THEN -(${mov}) ELSE (${mov}) END)) > 1000
       OR ABS(SUM(CASE WHEN CTA_NATURALEZA='DEUD' THEN (${mov}) ELSE -(${mov}) END)) > 1000
    ORDER BY CTA_GPOCONT
  `);
  console.log('Groups Dec 2025:', groups.map((r) => `${r.g}\ting=${Number(r.ingreso).toFixed(0)}\tcosto=${Number(r.costo).toFixed(0)}`).join('\n'));

  const util = await query(`
    SELECT Consecutivo, Descripcion, Importe, SubTotal
    FROM CON_TEMPESTADORESULTADO
    WHERE Usuario='GMI '
      AND (Descripcion LIKE '%UTILIDAD%' OR Descripcion LIKE '%VENTA TOTAL%' OR Descripcion LIKE '%TOTAL ACTIVO%'
        OR Descripcion LIKE '%PASIVO%' OR Descripcion LIKE '%CAPITAL%')
      AND Descripcion IS NOT NULL
    ORDER BY Consecutivo
  `);
  console.log('\nUtilidad/totales temp:', util.slice(0, 30));

  const acum2026 = await query(`SELECT CTA_ACUMDET, COUNT(*) c FROM CON_CTAS012026 GROUP BY CTA_ACUMDET`);
  console.log('\n2026 ACUMDET:', acum2026);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
