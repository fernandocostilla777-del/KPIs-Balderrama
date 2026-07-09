require('dotenv').config({ override: true });
const { query } = require('../src/db');

const EXCEL_BRANCHES = [
  ['PISO', '0001'],
  ['FORANEOS', '0002'],
  ['SUAUTO', '0008'],
  ['CHOLULA', '0004'],
  ['ZACATELCO', '0005'],
  ['CASA', '0007'],
];

const OTHER_SEGMENTS = [
  ['FLOTILLAS', '0006'],
  ['INTERCAMBIOS', '0010'],
];

function movementExpr(startMonth, endMonth) {
  const parts = [];
  for (let m = startMonth; m <= endMonth; m++) {
    parts.push(`ISNULL(CTA_CARGO${m}, 0) - ISNULL(CTA_ABONO${m}, 0)`);
  }
  return parts.join(' + ');
}

function incomeExpr(raw) {
  return `CASE WHEN CTA_NATURALEZA = 'ACRE' THEN -(${raw}) ELSE (${raw}) END`;
}

function expenseExpr(raw) {
  return `CASE WHEN CTA_NATURALEZA = 'DEUD' THEN (${raw}) ELSE -(${raw}) END`;
}

async function sumLike(table, pattern, asIncome, startMonth, endMonth) {
  const mov = movementExpr(startMonth, endMonth);
  const sign = asIncome ? incomeExpr(mov) : expenseExpr(mov);
  const rows = await query(`
    SELECT SUM(${sign}) AS total
    FROM [${table}]
    WHERE CTA_ACUMDET = 'DETA' AND CTA_NUMCTA LIKE @p
  `, { p: pattern });
  return Number(rows[0]?.total || 0);
}

async function sumAdmin(startMonth, endMonth) {
  const groups = ['740', '750'];
  const mov = movementExpr(startMonth, endMonth);
  const sign = expenseExpr(mov);
  const inList = groups.map((g, i) => `@g${i}`).join(', ');
  const params = {};
  groups.forEach((g, i) => { params[`g${i}`] = g; });
  const rows = await query(`
    SELECT SUM(${sign}) AS total
    FROM CON_CTAS012026
    WHERE CTA_ACUMDET = 'DETA' AND CTA_GPOCONT IN (${inList})
  `, params);
  return Number(rows[0]?.total || 0);
}

async function sumFinancial(startMonth, endMonth, groups) {
  const mov = movementExpr(startMonth, endMonth);
  const sign = expenseExpr(mov);
  const inList = groups.map((g, i) => `@g${i}`).join(', ');
  const params = {};
  groups.forEach((g, i) => { params[`g${i}`] = g; });
  const rows = await query(`
    SELECT SUM(${sign}) AS total
    FROM CON_CTAS012026
    WHERE CTA_ACUMDET = 'DETA' AND CTA_GPOCONT IN (${inList})
  `, params);
  return Number(rows[0]?.total || 0);
}

async function main() {
  const startMonth = 6;
  const endMonth = 6;
  const table = 'CON_CTAS012026';

  console.log('=== Solo JUNIO 2026 · comparación vs Excel ===\n');

  let totalVentas = 0;
  let totalCosto = 0;
  let totalUtil = 0;
  let totalGastos = 0;

  for (const [name, seg] of EXCEL_BRANCHES) {
    const ventas = await sumLike(table, `0400-${seg}-%`, true, startMonth, endMonth);
    const costo = await sumLike(table, `0600-${seg}-%`, false, startMonth, endMonth);
    const gastos = await sumLike(table, `0700-%-${seg}-%`, false, startMonth, endMonth);
    const util = ventas - costo;
    totalVentas += ventas;
    totalCosto += costo;
    totalUtil += util;
    totalGastos += gastos;
    console.log(`${name.padEnd(10)} ventas ${ventas.toFixed(2)}  costo ${costo.toFixed(2)}  util ${util.toFixed(2)}  gastos ${gastos.toFixed(2)}`);
  }

  const admin = await sumAdmin(startMonth, endMonth);
  const sumaGastos = totalGastos + admin;
  const utilOp = totalUtil - sumaGastos;

  console.log('\n--- Totales (6 sucursales Excel) ---');
  console.log('Ventas', totalVentas.toFixed(2), '(Excel: 42174261.03)');
  console.log('Costo', totalCosto.toFixed(2), '(Excel: 38290601.71)');
  console.log('Util bruta', totalUtil.toFixed(2), '(Excel: 3883659.32)');
  console.log('Gastos autos', totalGastos.toFixed(2), '(Excel: 4337480.88)');
  console.log('Gastos admin', admin.toFixed(2), '(Excel: 1959023.19)');
  console.log('Suma gastos', sumaGastos.toFixed(2), '(Excel: 6296504.07)');
  console.log('Util operación', utilOp.toFixed(2), '(Excel: -2412844.75)');

  console.log('\n--- Segmentos NO en plantilla Excel ---');
  for (const [name, seg] of OTHER_SEGMENTS) {
    const ventas = await sumLike(table, `0400-${seg}-%`, true, startMonth, endMonth);
    const costo = await sumLike(table, `0600-${seg}-%`, false, startMonth, endMonth);
    if (ventas || costo) {
      console.log(`${name}: ventas ${ventas.toFixed(2)} costo ${costo.toFixed(2)}`);
    }
  }

  const all0400 = await sumLike(table, '0400-%', true, startMonth, endMonth);
  const all0700 = await sumLike(table, '0700-%', false, startMonth, endMonth);
  console.log('\n--- Actual dashboard (todo 0400 / todo 0700) ---');
  console.log('Todo 0400:', all0400.toFixed(2));
  console.log('Todo 0700:', all0700.toFixed(2));

  const prodFin = await sumFinancial(startMonth, endMonth, ['800', '900', '903', '906', '908', '909', '910', '912', '931', '938', '940', '941', '942']);
  console.log('\nProductos financieros (grupos actuales):', prodFin.toFixed(2), '(Excel prod fin: 2202877.45)');

  console.log('\n--- Prueba segmentos alternos ---');
  for (const seg of ['0003', '0008', '0019']) {
    const ventas = await sumLike(table, `0400-${seg}-%`, true, startMonth, endMonth);
    const costo = await sumLike(table, `0600-${seg}-%`, false, startMonth, endMonth);
  const gastos = await sumLike(table, `0700-%-${seg}-%`, false, startMonth, endMonth);
    if (ventas || costo || gastos) console.log(`seg ${seg}: v ${ventas.toFixed(2)} c ${costo.toFixed(2)} g ${gastos.toFixed(2)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
