const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path').join(__dirname, 'eeff-dic2025.xlsx');

const KPI_PATTERNS = [
  /TOTAL/i, /UTILIDAD/i, /VENTA/i, /COSTO/i, /ACTIVO/i, /PASIVO/i, /CAPITAL/i,
  /EFECTIVO/i, /BANCO/i, /INVENTARIO/i, /CUENTAS POR/i, /MARGEN/i, /RESULTADO/i,
  /INGRESO/i, /GASTO/i, /DEPRECI/i, /IMPUESTO/i, /OPERAC/i, /BRUTA/i, /NETA/i,
];

const wb = XLSX.readFile(path, { cellDates: true, raw: false });
const out = ['Hojas: ' + wb.SheetNames.join(' | ')];

for (const name of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false });
  out.push(`\n=== ${name} (${rows.length} filas) — KPIs ===`);
  rows.forEach((row, i) => {
    const cells = row.map((c) => String(c).trim()).filter(Boolean);
    if (!cells.length) return;
    const text = cells.join(' ');
    const isKpi = KPI_PATTERNS.some((p) => p.test(text));
    const hasMoney = cells.some((c) => /^[\d,.()-]+$/.test(c.replace(/\$/g, '')) && c.length > 3);
    if (isKpi || (hasMoney && cells.length >= 2)) {
      out.push(`${String(i + 1).padStart(4)}: ${cells.join(' | ')}`);
    }
  });
  out.push(`\n--- Primeras 25 filas ${name} ---`);
  rows.slice(0, 25).forEach((row, i) => {
    const cells = row.map((c) => String(c).trim()).filter(Boolean);
    if (cells.length) out.push(`${String(i + 1).padStart(3)}: ${cells.join(' | ')}`);
  });
}

fs.writeFileSync(require('path').join(__dirname, 'eeff-output.txt'), out.join('\n'), 'utf8');
console.log('OK', out.length, 'lineas');
