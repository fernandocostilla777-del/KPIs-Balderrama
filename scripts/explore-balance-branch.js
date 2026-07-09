require('dotenv').config({ override: true });
const { query } = require('../src/db');

const SEG = { piso:'0001', foraneos:'0002', cholula:'0004', zacatelco:'0005', flotillas:'0006', bdc:'0007' };

async function main() {
  const bal = `ISNULL(CTA_SDOINICIAL,0)+ISNULL(CTA_CARGO12,0)-ISNULL(CTA_ABONO12,0)`;
  for (const [name, seg] of Object.entries(SEG)) {
    const r = await query(`
      SELECT SUM(CASE WHEN CTA_NATURALEZA='DEUD' THEN (${bal}) ELSE -(${bal}) END) n
      FROM CON_CTAS012025 WHERE CTA_ACUMDET='DETA'
        AND (CTA_NUMCTA LIKE @p1 OR CTA_NUMCTA LIKE @p2 OR CTA_NUMCTA LIKE @p3)
    `, { p1: `0220-${seg}-%`, p2: `0205-${seg}-%`, p3: `0225-${seg}-%` });
    console.log(`${name} CxC/activo circ branch: ${Number(r[0]?.n||0).toFixed(0)}`);
  }
  process.exit(0);
}

main().catch(e=>{console.error(e);process.exit(1);});
