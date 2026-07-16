const XLSX = require('xlsx');
const path = 'C:\\Users\\ABP-SDN-SI-221\\Downloads\\1.- EEFF DIC 2025_.xlsx';

const wb = XLSX.readFile(path, { cellDates: true, cellNF: true });
console.log('Hojas:', wb.SheetNames.join(' | '));

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  console.log(`\n=== ${name} (${rows.length} filas) ===`);
  rows.slice(0, 45).forEach((row, i) => {
    const cells = row.map((c) => String(c).trim()).filter(Boolean);
    if (cells.length) console.log(`${String(i + 1).padStart(3)}: ${cells.join(' | ')}`);
  });
}
