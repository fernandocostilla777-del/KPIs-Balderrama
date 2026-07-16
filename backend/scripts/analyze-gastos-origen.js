require('dotenv').config({ path: require('path').join(__dirname, '../.env'), override: true });
const XLSX = require('xlsx');
const { query } = require('../src/db');

const XLSX_PATH = 'C:\\Users\\ABP-SDN-SI-221\\Documents\\JULIO 26\\Gatos para buscar origen.xlsx';
const TABLE = 'CON_CTAS012026';

function loadExcelAccounts() {
  const wb = XLSX.readFile(XLSX_PATH);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const sections = [];
  let current = 'GENERAL';
  const accounts = [];

  for (const row of rows) {
    const a = String(row[0] || '').trim();
    const b = String(row[1] || '').trim();
    if (!a && !b) continue;
    if (a === 'TOTAL') continue;
    if (/^0\d{3}-/.test(a)) {
      accounts.push({ cuenta: a, desc: b, section: current });
      continue;
    }
    if (a && !/^0\d{3}-/.test(a) && !/^0\d{3}-/.test(b)) {
      current = a || b;
      sections.push(current);
    } else if (!a && b && !/^0\d{3}-/.test(b)) {
      current = b;
      sections.push(current);
    }
  }

  return { sections, accounts };
}

async function batchLookup(accounts, fields = 'CTA_NUMCTA, CTA_DESCRIPCION, CTA_GPOCONT, CTA_NATURALEZA, CTA_GPOCONT4') {
  const map = new Map();
  for (let i = 0; i < accounts.length; i += 80) {
    const batch = accounts.slice(i, i + 80);
    const params = {};
    const placeholders = batch.map((acc, j) => {
      params[`c${j}`] = acc.cuenta || acc;
      return `@c${j}`;
    });
    const rows = await query(
      `SELECT ${fields} FROM ${TABLE} WHERE CTA_NUMCTA IN (${placeholders.join(',')})`,
      params,
    );
    rows.forEach((r) => map.set(r.CTA_NUMCTA, r));
  }
  return map;
}

async function main() {
  const { sections, accounts } = loadExcelAccounts();

  console.log('=== SECCIONES EN EXCEL ===');
  for (const s of sections) {
    console.log(`- ${s} | cuentas: ${accounts.filter((x) => x.section === s).length}`);
  }
  console.log(`Total cuentas: ${accounts.length}`);

  const tables = await query(
    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE 'CON_%' ORDER BY TABLE_NAME",
  );
  console.log('\n=== TABLAS CON_* EN BD ===');
  console.log(tables.map((t) => t.TABLE_NAME).join(', '));

  const dbMap = await batchLookup(accounts);
  const found = accounts.filter((a) => dbMap.has(a.cuenta));
  const missing = accounts.filter((a) => !dbMap.has(a.cuenta));

  console.log('\n=== COINCIDENCIA EXCEL vs CON_CTAS012026 ===');
  console.log(`Encontradas: ${found.length} / ${accounts.length}`);
  if (missing.length) {
    console.log('No en BD (primeras 15):');
    missing.slice(0, 15).forEach((m) => console.log(`  ${m.cuenta} | ${m.desc}`));
  }

  const gpoCounts = {};
  for (const acc of found) {
    const g = dbMap.get(acc.cuenta).CTA_GPOCONT || 'NULL';
    gpoCounts[g] = (gpoCounts[g] || 0) + 1;
  }
  console.log('\n=== CTA_GPOCONT de cuentas Excel ===');
  Object.entries(gpoCounts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([k, v]) => console.log(`${k}: ${v}`));

  console.log('\n=== MAPEO SECCIÓN → GPOCONT (moda) ===');
  for (const s of sections) {
    const secAcc = accounts.filter((a) => a.section === s && dbMap.has(a.cuenta));
    const counts = {};
    secAcc.forEach((a) => {
      const g = dbMap.get(a.cuenta).CTA_GPOCONT;
      counts[g] = (counts[g] || 0) + 1;
    });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    console.log(`${s} → GPOCONT ${top ? top[0] : 'N/A'} (${top ? top[1] : 0} cuentas)`);
  }

  console.log('\n=== ESTRUCTURA CTA_NUMCTA (0700-SSSS-CCCC-FFFF) ===');
  console.log('SSSS = subcuenta gasto (0011 comisiones, 0076 plan piso, 0080 rentas...)');
  console.log('CCCC = centro/sucursal (0001 Piso, 0002 Foráneos, 0004 Cholula...)');
  console.log('FFFF = detalle auxiliar');

  const confCols = await query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'CON_CONFESTADORESULTADO' ORDER BY ORDINAL_POSITION",
  );
  console.log('\n=== CON_CONFESTADORESULTADO columnas ===');
  console.log(confCols.map((c) => c.COLUMN_NAME).join(', '));

  const conf = await query(
    "SELECT TOP 3 * FROM CON_CONFESTADORESULTADO WHERE Estado LIKE '%VTASMEN%' OR Estado LIKE '%VENTAS%'",
  );
  console.log('\n=== CON_CONFESTADORESULTADO (VTASMEN) ===');
  conf.forEach((r) => console.log(JSON.stringify(r)));

  const agrupCols = await query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'CON_AgrupadoresCuentas' ORDER BY ORDINAL_POSITION",
  );
  console.log('\n=== CON_AgrupadoresCuentas columnas ===');
  console.log(agrupCols.map((c) => c.COLUMN_NAME).join(', '));

  const agrupSample = await query(
    "SELECT TOP 5 * FROM CON_AgrupadoresCuentas WHERE Cuenta LIKE '0700-%' OR Descripcion LIKE '%GASTO%'",
  ).catch(() => query('SELECT TOP 5 * FROM CON_AgrupadoresCuentas'));
  console.log('\n=== CON_AgrupadoresCuentas (muestra) ===');
  agrupSample.forEach((r) => console.log(JSON.stringify(r)));

  const sample0700 = await query(
    `SELECT TOP 8 CTA_NUMCTA, CTA_DESCRIPCION, CTA_GPOCONT
     FROM ${TABLE}
     WHERE CTA_ACUMDET = 'DETA' AND CTA_NUMCTA LIKE '0700-0011-0001-%'
     ORDER BY CTA_NUMCTA`,
  );
  console.log('\n=== Ejemplo BD: 0700-0011-0001 (comisiones Piso) ===');
  sample0700.forEach((r) => console.log(`${r.CTA_NUMCTA} | gpo ${r.CTA_GPOCONT} | ${r.CTA_DESCRIPCION}`));

  const movement = await query(
    `SELECT SUM(ISNULL(CTA_CARGO6,0)-ISNULL(CTA_ABONO6,0)) AS jun
     FROM ${TABLE}
     WHERE CTA_ACUMDET='DETA' AND CTA_NUMCTA=@c`,
    { c: '0700-0011-0001-0001' },
  );
  console.log('\nMovimiento jun-2026 cuenta 0700-0011-0001-0001:', movement[0]?.jun);

  const vtasmenGroup = await query(
    `SELECT SUM(CASE WHEN CTA_NATURALEZA='DEUD' THEN (ISNULL(CTA_CARGO6,0)-ISNULL(CTA_ABONO6,0)) ELSE -(ISNULL(CTA_CARGO6,0)-ISNULL(CTA_ABONO6,0)) END) AS jun
     FROM ${TABLE}
     WHERE CTA_ACUMDET='DETA' AND CTA_GPOCONT='711'`,
  );
  console.log('Gastos jun-2026 GPOCONT 711 (Piso VTASMEN):', vtasmenGroup[0]?.jun);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
