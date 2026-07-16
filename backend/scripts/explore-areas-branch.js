require('dotenv').config({ override: true });
const { query } = require('../src/db');

const SEG = { piso:'0001', foraneos:'0002', cholula:'0004', zacatelco:'0005', flotillas:'0006', bdc:'0007', suauto:'0008', intercambios:'0010' };

async function main() {
  const mov = 'ISNULL(CTA_CARGO12,0)-ISNULL(CTA_ABONO12,0)';
  const areas = [
    ['sem v', '0446-0001%'], ['sem c', '0646-0001%'],
    ['sem com v', '0450-0001%'], ['sem com c', '0650-0001%'],
    ['ref v', '047%'], ['ref c', '067%'],
    ['hyp v', '048%'], ['hyp c', '068%'],
  ];
  for (const [label, base] of areas) {
    console.log(`\n${label} (${base})`);
    for (const [name, seg] of Object.entries(SEG)) {
      const r = await query(`
        SELECT SUM(CASE WHEN CTA_NATURALEZA='ACRE' THEN -(${mov}) WHEN CTA_NATURALEZA='DEUD' THEN (${mov}) ELSE 0 END) n
        FROM CON_CTAS012025 WHERE CTA_ACUMDET='DETA' AND CTA_NUMCTA LIKE @pat
      `, { pat: base.replace('%', `-${seg}-%`).replace('0446-0001-', '0446-0001-').replace('0646-0001-', '0646-0001-') });
      // simpler: for 047%, use 047%-{seg}-%
      const pat2 = base.endsWith('%') && base.length <= 5 ? `${base.slice(0,-1)}-${seg}-%` : `${base.split('%')[0]}-${seg}-%`;
      const r2 = await query(`
        SELECT SUM(CASE WHEN CTA_NATURALEZA='ACRE' THEN -(${mov}) WHEN CTA_NATURALEZA='DEUD' THEN (${mov}) ELSE 0 END) n
        FROM CON_CTAS012025 WHERE CTA_ACUMDET='DETA' AND CTA_NUMCTA LIKE @pat
      `, { pat: pat2 });
      if (Math.abs(r2[0]?.n||0) > 500) console.log(`  ${name}: ${Number(r2[0].n).toFixed(0)}`);
    }
  }
  process.exit(0);
}

main().catch(e=>{console.error(e);process.exit(1);});
