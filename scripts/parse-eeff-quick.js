const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path').join(__dirname, 'eeff-dic2025.xlsx');
const wb = XLSX.readFile(path, { sheetRows: 80, cellDates: true, raw: false });
const out = ['Hojas: ' + wb.SheetNames.join(', ')];
for (const name of wb.SheetNames.slice(0, 4)) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
  out.push('\n=== ' + name + ' ===');
  rows.slice(0, 35).forEach((r, i) => {
    const c = r.map((x) => String(x).trim()).filter(Boolean);
    if (c.length) out.push((i + 1) + ': ' + c.join(' | '));
  });
}
fs.writeFileSync(path.replace('.xlsx', '-summary.txt'), out.join('\n'), 'utf8');
console.log('done', wb.SheetNames.length, 'hojas');
