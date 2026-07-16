require('dotenv').config({ path: require('path').join(__dirname, '../.env'), override: true });
const XLSX = require('xlsx');
const { query } = require('../src/db');

const XLSX_PATH = 'C:\\Users\\ABP-SDN-SI-221\\Documents\\JULIO 26\\Total de cuentas.xlsx';
const TABLE = 'CON_CTAS012026';

function loadExcelAccounts() {
  const wb = XLSX.readFile(XLSX_PATH);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const accounts = [];

  for (const row of rows) {
    const cuenta = String(row[0] || '').trim();
    const desc = String(row[1] || '').trim();
    if (!/^\d{4}-/.test(cuenta)) continue;
    accounts.push({ cuenta, desc });
  }
  return accounts;
}

async function batchLookup(accounts, fields) {
  const map = new Map();
  for (let i = 0; i < accounts.length; i += 80) {
    const batch = accounts.slice(i, i + 80);
    const params = {};
    const placeholders = batch.map((acc, j) => {
      params[`c${j}`] = acc.cuenta;
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

function majorPrefix(cuenta) {
  return cuenta.slice(0, 4);
}

function accountClass(prefix) {
  const p = parseInt(prefix, 10);
  if (p >= 200 && p < 300) return 'Activo circulante / Caja-Bancos-CxC';
  if (p >= 300 && p < 400) return 'Activo fijo / diferido';
  if (p >= 400 && p < 500) return 'Ingresos (0400-04xx)';
  if (p >= 600 && p < 700) return 'Costos (0600-06xx)';
  if (p >= 700 && p < 800) return 'Gastos operación (0700-07xx)';
  if (p >= 800 && p < 900) return 'Productos/Financieros (08xx)';
  if (p >= 900 && p < 1000) return 'Otros gastos/financieros (09xx)';
  return 'Otro';
}

async function main() {
  const accounts = loadExcelAccounts();
  console.log('=== TOTAL DE CUENTAS (EXCEL) ===');
  console.log(`Cuentas válidas: ${accounts.length}`);

  const dbMap = await batchLookup(
    accounts,
    'CTA_NUMCTA, CTA_DESCRIPCION, CTA_GPOCONT, CTA_NATURALEZA, CTA_ACUMDET, CTA_GPOCONT4',
  );

  const found = accounts.filter((a) => dbMap.has(a.cuenta));
  const missing = accounts.filter((a) => !dbMap.has(a.cuenta));

  console.log(`\n=== COINCIDENCIA vs ${TABLE} ===`);
  console.log(`Encontradas: ${found.length} / ${accounts.length} (${((found.length / accounts.length) * 100).toFixed(1)}%)`);
  if (missing.length) {
    console.log(`No en BD: ${missing.length}`);
    console.log('Primeras 20 faltantes:');
    missing.slice(0, 20).forEach((m) => console.log(`  ${m.cuenta} | ${m.desc}`));
  }

  const byPrefix = {};
  const byClass = {};
  const byGpo = {};
  const byNaturaleza = {};
  const byAcum = {};

  for (const acc of found) {
    const db = dbMap.get(acc.cuenta);
    const pref = majorPrefix(acc.cuenta);
    byPrefix[pref] = (byPrefix[pref] || 0) + 1;
    const cls = accountClass(pref);
    byClass[cls] = (byClass[cls] || 0) + 1;
    const g = db.CTA_GPOCONT || 'NULL';
    byGpo[g] = (byGpo[g] || 0) + 1;
    byNaturaleza[db.CTA_NATURALEZA || 'NULL'] = (byNaturaleza[db.CTA_NATURALEZA || 'NULL'] || 0) + 1;
    byAcum[db.CTA_ACUMDET || 'NULL'] = (byAcum[db.CTA_ACUMDET || 'NULL'] || 0) + 1;
  }

  console.log('\n=== CLASIFICACIÓN POR TIPO DE CUENTA ===');
  Object.entries(byClass)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`${k}: ${v}`));

  console.log('\n=== PREFIJOS PRINCIPALES (4 dígitos) ===');
  Object.entries(byPrefix)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([k, v]) => console.log(`${k}: ${v} cuentas`));

  console.log('\n=== CTA_NATURALEZA ===');
  Object.entries(byNaturaleza).forEach(([k, v]) => console.log(`${k}: ${v}`));

  console.log('\n=== CTA_ACUMDET ===');
  Object.entries(byAcum).forEach(([k, v]) => console.log(`${k}: ${v}`));

  console.log('\n=== TOP CTA_GPOCONT ===');
  Object.entries(byGpo)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .forEach(([k, v]) => console.log(`${k}: ${v}`));

  // Sample per major class
  console.log('\n=== MUESTRAS POR CLASE ===');
  const samples = {
    '0202': 'Bancos',
    '0400': 'Ingresos autos',
    '0600': 'Costos autos',
    '0700': 'Gastos operación',
    '0800': 'Productos financieros',
  };
  for (const [pref, label] of Object.entries(samples)) {
    const match = found.find((a) => a.cuenta.startsWith(pref));
    if (!match) continue;
    const db = dbMap.get(match.cuenta);
    console.log(`\n${label} (${pref})`);
    console.log(`  Excel: ${match.cuenta} | ${match.desc}`);
    console.log(`  BD:    ${db.CTA_NUMCTA} | ${db.CTA_DESCRIPCION}`);
    console.log(`  GPOCONT=${db.CTA_GPOCONT} NAT=${db.CTA_NATURALEZA} ACUM=${db.CTA_ACUMDET}`);
  }

  // Catalog tables
  const catalogTables = await query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME IN (
      'CON_CTAS012026','CON_AgrupadoresCuentas','CON_CONFESTADORESULTADO',
      'CON_CONFBALANCEGENERAL','CON_CONFIGCONTA','CON_CONFCONTA',
      'CATALOGO_DE_CUENTAS_GMI','CON_CATCTASSAT'
    )
    ORDER BY TABLE_NAME
  `);
  console.log('\n=== TABLAS CATÁLOGO / CONFIG RELACIONADAS ===');
  catalogTables.forEach((t) => console.log('-', t.TABLE_NAME));

  // Check if GMI catalog exists
  const gmi = await query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME LIKE '%CUENTAS%' OR TABLE_NAME LIKE '%CATALOGO%'
    ORDER BY TABLE_NAME
  `);
  console.log('\nTablas con CUENTAS/CATALOGO:');
  gmi.forEach((t) => console.log('-', t.TABLE_NAME));

  // Compare descriptions match
  let descMatch = 0;
  let descDiff = 0;
  for (const acc of found.slice(0, 200)) {
    const db = dbMap.get(acc.cuenta);
    const a = acc.desc.toUpperCase().replace(/\s+/g, ' ').trim();
    const b = String(db.CTA_DESCRIPCION || '').toUpperCase().replace(/\s+/g, ' ').trim();
    if (a === b || a.includes(b.slice(0, 20)) || b.includes(a.slice(0, 20))) descMatch++;
    else descDiff++;
  }
  console.log('\n=== COINCIDENCIA DE DESCRIPCIÓN (muestra 200) ===');
  console.log(`Similares: ${descMatch} | Diferentes: ${descDiff}`);

  // Movement sample for active accounts in June
  const movSample = await query(`
    SELECT TOP 10
      CTA_NUMCTA, CTA_DESCRIPCION, CTA_GPOCONT,
      ISNULL(CTA_CARGO6,0)-ISNULL(CTA_ABONO6,0) AS mov_jun
    FROM ${TABLE}
    WHERE CTA_ACUMDET='DETA'
      AND ABS(ISNULL(CTA_CARGO6,0)-ISNULL(CTA_ABONO6,0)) > 1000
    ORDER BY ABS(ISNULL(CTA_CARGO6,0)-ISNULL(CTA_ABONO6,0)) DESC
  `);
  console.log('\n=== TOP 10 CUENTAS CON MOVIMIENTO JUN-2026 ===');
  movSample.forEach((r) => console.log(`${r.CTA_NUMCTA} | gpo ${r.CTA_GPOCONT} | jun ${Number(r.mov_jun).toFixed(2)} | ${(r.CTA_DESCRIPCION||'').slice(0,45)}`));

  // CON_CONFIGCONTA sample if exists
  try {
    const confCols = await query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CON_CONFIGCONTA' ORDER BY ORDINAL_POSITION",
    );
    if (confCols.length) {
      console.log('\n=== CON_CONFIGCONTA columnas ===');
      console.log(confCols.map((c) => c.COLUMN_NAME).join(', '));
      const confSample = await query('SELECT TOP 3 * FROM CON_CONFIGCONTA');
      console.log('Muestra:', JSON.stringify(confSample));
    }
  } catch {
    /* optional */
  }

  console.log('\n=== ORIGEN DE DATOS (cadena) ===');
  console.log('1. Catálogo/plan: CON_CTAS01{AAAA} (CTA_NUMCTA + CTA_DESCRIPCION)');
  console.log('2. Movimientos:   CON_MOVDET01{AAAA} → CON_POL01{AAAA}');
  console.log('3. Agrupadores:   CTA_GPOCONT en CON_CTAS + CON_CONFESTADORESULTADO');
  console.log('4. Balance:       CON_CONFBALANCEGENERAL');
  console.log('5. Clasificación: CON_AgrupadoresCuentas (GPC_Cuenta)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
