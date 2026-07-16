const XLSX = require('xlsx');
const p = 'C:\\Users\\ABP-SDN-SI-221\\Documents\\FEBRERO 26\\EEFF DIC 2025 SUMMARY.xlsx';
const SHEETS = [
  'BALANCE GRAL', 'EDO FINANCIERO', 'VENTAS', 'PISO', 'ZACATELCO', 'FORANEOS',
  'INTERCAMBIOS', 'BDC', 'CHOLULA', 'FLOTILLAS', 'SUAUTO', 'SEMINUEVOS',
  'POSTVENTA', 'SERVICIO', 'REFACCIONES', 'HYP',
];

const wb = XLSX.readFile(p);
for (const name of SHEETS) {
  if (!wb.SheetNames.includes(name)) {
    console.log('\n=== MISSING:', name);
    continue;
  }
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
  console.log('\n===', name, 'rows', rows.length, '===');
  rows.slice(0, 40).forEach((r, i) => {
    const slice = r.slice(0, 10).map((c) => (typeof c === 'number' ? c : String(c).trim()));
    if (slice.some(Boolean)) console.log(i, JSON.stringify(slice));
  });
}
