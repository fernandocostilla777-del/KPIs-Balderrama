const XLSX = require('xlsx');
const path = process.argv[2];

const wb = XLSX.readFile(path);
const ws = wb.Sheets['PRESUPUESTO FINANCIERO 2026'];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

// Header row 13 (index 12) has month labels
const header = rows[12] || [];
console.log('Header cols with ENERO/DICIEMBRE/TOTAL:');
header.forEach((c, i) => {
  const s = String(c).toUpperCase();
  if (/ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE|ANUAL|PRESUPUESTO ANUAL|TOTAL UNIDADES/i.test(s)) {
    console.log(`  col ${i}: ${c}`);
  }
});

const targets = [
  'VENTAS AUTOS PISO SERDAN',
  'VENTAS AUTOS FORANEOS SERDAN',
  'VENTAS AUTOS SuAuto SERDAN',
  'VENTAS AUTOS CHOLULA',
  'VENTAS AUTOS ZACATELCO',
  'VENTAS AUTOS BDC-CASA SERDAN',
  'TOTAL VENTAS AUTOS MENUDEO',
  'VENTAS INTERCAMBIOS SERDAN',
  'VENTAS FLOTILLAS',
  'VENTAS SEMINUEVOS AUTOS',
  'VENTAS SEMINUEVOS COMERCIALES',
  'TOTAL VENTAS SEMINUEVOS',
  'TOTAL VENTAS ABP',
  'TOTAL POSVENTA',
];

function parseNum(c) {
  if (typeof c === 'number' && Number.isFinite(c)) return c;
  const s = String(c).replace(/[$,\s]/g, '').replace(/[^\d.-]/g, '');
  const n = Number(s);
  return Number.isFinite(n) && s !== '' ? n : null;
}

console.log('\nMonthly amounts (cols 2,5,8,... pattern check):');
rows.forEach((row, ri) => {
  const label = String(row[0] || '').trim();
  if (!targets.some((t) => label.toUpperCase().includes(t.toUpperCase()))) return;
  const monthly = [];
  for (let m = 0; m < 12; m++) {
    // try pattern: col 2 + m*3 for amount after U column
    const col = 2 + m * 30; // rough - will refine
    monthly.push(parseNum(row[col]));
  }
  // scan for 12 consecutive large numbers after col 1
  const candidates = [];
  for (let ci = 1; ci < row.length - 11; ci++) {
    const slice = row.slice(ci, ci + 12).map(parseNum);
    if (slice.every((n) => n != null && n > 1000)) {
      candidates.push({ start: ci, sum: slice.reduce((a, b) => a + b, 0), slice });
    }
  }
  const best = candidates.sort((a, b) => b.sum - a.sum)[0];
  console.log(`R${ri + 1} ${label.slice(0, 45)}`);
  if (best) {
    console.log(`  start=${best.start} annual=${best.sum.toFixed(0)} jan=${best.slice[0]} dec=${best.slice[11]}`);
  } else {
    const tail = row.slice(-15).map((c, i) => `${i}:${parseNum(c) ?? c}`).join(' | ');
    console.log('  tail:', tail);
  }
});
