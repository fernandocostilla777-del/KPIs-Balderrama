const XLSX = require('xlsx');
const path = process.argv[2] || 'C:\\Users\\ABP-SDN-SI-221\\Downloads\\Simulador ABP PRESUPUESTO 2026 (1).xlsx';

const wb = XLSX.readFile(path, { cellDates: true });
const ws = wb.Sheets['PRESUPUESTO FINANCIERO 2026'];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

const keywords = [
  'TOTAL VENTAS ABP',
  'TOTAL POSVENTA',
  'TOTAL VENTAS AUTOS',
  'TOTAL VENTAS AUTOS MENUDEO',
  'VENTAS FLOTILLAS',
  'VENTAS INTERCAMBIOS',
  'VENTAS SEMINUEVOS',
  'COSTO',
  'GASTOS',
  'UTILIDAD BRUTA',
  'UTILIDAD DE OPER',
  'UTILIDAD NETA',
  'GASTOS DE ADMINISTRACION',
  'PRODUCTOS FINANCIEROS',
  'GASTOS FINANCIEROS',
  'TOTAL MANO DE OBRA SERVICIO',
  'UB VENTAS',
  'PPTO 2026 RESUMEN',
];

console.log('=== PRESUPUESTO FINANCIERO 2026 — líneas clave ===');
rows.forEach((row, i) => {
  const label = String(row[0] || '').trim().toUpperCase();
  if (!label) return;
  const hit = keywords.some((k) => label.includes(k));
  if (!hit) return;
  // find last numeric columns (annual total often near end)
  const nums = row.map((c, ci) => ({ ci, v: c, n: parseNum(c) })).filter((x) => x.n != null);
  const last = nums.slice(-5);
  console.log(`R${i + 1}: ${String(row[0]).trim().slice(0, 60)}`);
  console.log('  nums tail:', last.map((x) => `[${x.ci}]=${x.n}`).join(', '));
});

function parseNum(c) {
  if (typeof c === 'number' && Number.isFinite(c)) return c;
  const s = String(c).replace(/[$,\s]/g, '').replace(/[^\d.-]/g, '');
  const n = Number(s);
  return Number.isFinite(n) && s !== '' ? n : null;
}

console.log('\n=== RESUMEN — primeras 40 filas numéricas ===');
const res = XLSX.utils.sheet_to_json(wb.Sheets['RESUMEN'], { header: 1, defval: '' });
res.slice(0, 45).forEach((row, i) => {
  const label = String(row[0] || '').trim();
  if (!label) return;
  const n = parseNum(row[1]);
  if (n == null && !label.includes('PPTO')) return;
  console.log(`R${i + 1}: ${label} | ${n ?? row[1]}`);
});
