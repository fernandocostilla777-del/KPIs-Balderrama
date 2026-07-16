require('dotenv').config({ override: true });
const { query } = require('../src/db');

const BRANCHES = {
  '0001': 'piso',
  '0002': 'foraneos',
  '0004': 'cholula',
  '0005': 'zacatelco',
  '0006': 'flotillas',
  '0007': 'bdc',
  '0008': 'suauto',
  '0010': 'intercambios',
};

async function main() {
  const mov = 'ISNULL(CTA_CARGO12,0)-ISNULL(CTA_ABONO12,0)';

  for (const [seg, name] of Object.entries(BRANCHES)) {
    const ventas = await query(`
      SELECT SUM(CASE WHEN CTA_NATURALEZA='ACRE' THEN -(${mov}) ELSE (${mov}) END) v,
        SUM(CASE WHEN CTA_NATURALEZA='DEUD' THEN (${mov}) ELSE -(${mov}) END) c
      FROM CON_CTAS012025
      WHERE CTA_ACUMDET='DETA' AND CTA_NUMCTA LIKE @pat
    `, { pat: `04%-${seg}-%` });
    const costos = await query(`
      SELECT SUM(CASE WHEN CTA_NATURALEZA='DEUD' THEN (${mov}) ELSE -(${mov}) END) c
      FROM CON_CTAS012025
      WHERE CTA_ACUMDET='DETA' AND CTA_NUMCTA LIKE @pat
    `, { pat: `06%-${seg}-%` });
    const gastos = await query(`
      SELECT SUM(CASE WHEN CTA_NATURALEZA='DEUD' THEN (${mov}) ELSE -(${mov}) END) g
      FROM CON_CTAS012025
      WHERE CTA_ACUMDET='DETA' AND CTA_NUMCTA LIKE @pat
    `, { pat: `07%-${seg}-%` });
    console.log(`${name.padEnd(14)} ventas=${Number(ventas[0]?.v||0).toFixed(0)} costos=${Number(costos[0]?.c||0).toFixed(0)} gastos=${Number(gastos[0]?.g||0).toFixed(0)}`);
  }

  // Lineas negocio globales sin sucursal en segmento 2
  console.log('\n=== Lineas negocio (sin filtro sucursal) ===');
  for (const [label, pat] of [
    ['servicio 046', '046%'], ['refacc 047', '047%'], ['hyp 048', '048%'],
    ['sem 0446-0001', '0446-0001%'], ['sem 0450-0001', '0450-0001%'],
  ]) {
    const r = await query(`
      SELECT SUM(CASE WHEN CTA_NATURALEZA='ACRE' THEN -(${mov}) WHEN CTA_NATURALEZA='DEUD' THEN (${mov}) ELSE 0 END) n
      FROM CON_CTAS012025 WHERE CTA_ACUMDET='DETA' AND CTA_NUMCTA LIKE @pat
    `, { pat });
    console.log(`${label}\t${Number(r[0]?.n||0).toFixed(0)}`);
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
