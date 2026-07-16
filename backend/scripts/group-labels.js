require('dotenv').config({ override: true });
const { query } = require('../src/db');

async function main() {
  const rows = await query(`
    SELECT DISTINCT CTA_GPOCONT, MIN(CTA_DESCRIPCION) AS ejemplo, MIN(CTA_NATURALEZA) AS nat
    FROM CON_CTAS012025
    WHERE CTA_ACUMDET='DETA' AND CTA_GPOCONT IN (
      '611','612','613','614','615','616','617','618',
      '631','632','633','634','635','636','637','638',
      '711','712','713','714','715','716','717','718','720','731','732','733','740','750',
      '110','120','130','150','160','170','190'
    )
    GROUP BY CTA_GPOCONT
    ORDER BY CTA_GPOCONT
  `);
  rows.forEach((r) => console.log(`${r.CTA_GPOCONT}\t${r.nat}\t${r.ejemplo}`));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
