require('dotenv').config({ override: true });
const { query } = require('../src/db');

function mov(s, e) {
  const p = [];
  for (let m = s; m <= e; m++) p.push(`ISNULL(CTA_CARGO${m},0)-ISNULL(CTA_ABONO${m},0)`);
  return p.join('+');
}

async function sumExpGpo(g, s, e) {
  const sign = `CASE WHEN CTA_NATURALEZA='DEUD' THEN (${mov(s,e)}) ELSE -(${mov(s,e)}) END`;
  const r = await query(`SELECT SUM(${sign}) t FROM CON_CTAS012026 WHERE CTA_ACUMDET='DETA' AND CTA_GPOCONT=@g`, { g });
  return Number(r[0].t || 0);
}

async function sumLike(pattern, s, e, income) {
  const sign = income
    ? `CASE WHEN CTA_NATURALEZA='ACRE' THEN -(${mov(s,e)}) ELSE (${mov(s,e)}) END`
    : `CASE WHEN CTA_NATURALEZA='DEUD' THEN (${mov(s,e)}) ELSE -(${mov(s,e)}) END`;
  const r = await query(`SELECT SUM(${sign}) t FROM CON_CTAS012026 WHERE CTA_ACUMDET='DETA' AND CTA_NUMCTA LIKE @p`, { p: pattern });
  return Number(r[0].t || 0);
}

(async () => {
  const branches = [
    ['PISO', '0001', '411', '611', '711'],
    ['FORANEOS', '0002', '412', '612', '712'],
    ['SUAUTO', '0008', '413', '613', '713'],
    ['CHOLULA', '0004', '414', '614', '714'],
    ['ZACATELCO', '0005', '415', '615', '715'],
    ['CASA', '0007', '423', '618', '718'],
  ];
  const excel = {
    PISO: { v: 16866602.63, c: 15297484.44, g: 2327442.31 },
    FORANEOS: { v: 13548134.96, c: 12351359.12, g: 647599.43 },
    SUAUTO: { v: 2674938.8, c: 2387872.47, g: 115594.52 },
    CHOLULA: { v: 4380751.17, c: 3982065.6, g: 511287.72 },
    ZACATELCO: { v: 3455985.23, c: 3127166.91, g: 430217.83 },
    CASA: { v: 1247848.24, c: 1144653.17, g: 305339.07 },
  };

  for (const [name, seg, vg, cg, gg] of branches) {
    const vPrefix = await sumLike(`0400-${seg}-%`, 6, 6, true);
    const cPrefix = await sumLike(`0600-${seg}-%`, 6, 6, false);
    const c0003 = seg === '0008' ? await sumLike('0600-0003-%', 6, 6, false) : 0;
    const vGpo = await sumLike('%', 6, 6, true); // skip
    const gGpo = await sumExpGpo(gg, 6, 6);
    const ex = excel[name];
    console.log(`\n${name}`);
    console.log('  ventas prefix', vPrefix.toFixed(2), 'excel', ex.v);
    console.log('  costo prefix', cPrefix.toFixed(2), '+0003', c0003.toFixed(2), 'excel', ex.c);
    console.log('  gastos gpo', gg, gGpo.toFixed(2), 'excel', ex.g);
  }

  const admin740 = await sumExpGpo('740', 6, 6);
  console.log('\nAdmin 740', admin740.toFixed(2), 'excel admin', 1959023.19);

  // financial from config
  const finGroups = ['812', '813', '814', '815', '816', '817', '822', '821'];
  const gastFinGroups = ['901', '938', '823', '940', '941', '942'];
  let prod = 0; for (const g of finGroups) prod += await sumExpGpo(g, 6, 6);
  let gastFin = 0; for (const g of gastFinGroups) {
    const t = await sumExpGpo(g, 6, 6);
    gastFin += g === '823' || g === '942' ? -t : t;
  }
  console.log('Prod fin', prod.toFixed(2), 'excel', 2202877.45);
  console.log('Gast fin', gastFin.toFixed(2), 'excel', 436010.68);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
