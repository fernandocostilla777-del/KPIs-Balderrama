/**
 * Genera departmentExpenseMapping.js desde Gatos para buscar origen.xlsx
 * node scripts/build-department-expense-map.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env'), override: true });
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { query } = require('../src/db');

const XLSX_PATH = 'C:\\Users\\ABP-SDN-SI-221\\Documents\\JULIO 26\\Gatos para buscar origen.xlsx';
const OUT_PATH = path.join(__dirname, '../src/config/departmentExpenseMapping.js');

const GPO_BY_SECTION = {
  'GASTOS AUTOS NUEVOS-PISO': '711',
  'GASTOS AUTOS NUEVOS-FORANEOS': '712',
  'GASTOS AUTOS NUEVOS-SUAUTO': '713',
  'GASTOS AUTOS NUEVOS-CHOLULA': '714',
  'GASTOS AUTOS NUEVOS-ZACATELCO': '715',
  'GASTOS - FLOTILLAS': '716',
  'GASTOS AUTOS NUEVOS-INTERCAMBIOS': '717',
  'GASTOS - VTAS CASA': '718',
  'GASTOS AUTOS NUEVOS-SEMINUEVOS': '720',
  'GASTOS-POSTVENTA': '730',
  'GASTOS-SERVICIO': '731',
  'GASTOS   HYP': '732',
  'GASTOS - REFACCIONES': '733',
  'GASTOS - ADMINISTRACION': '740',
  'GASTOS-VERIFICENTRO': '750',
};

const SUCURSAL_TO_SECTION = {
  piso: 'GASTOS AUTOS NUEVOS-PISO',
  foraneos: 'GASTOS AUTOS NUEVOS-FORANEOS',
  suauto: 'GASTOS AUTOS NUEVOS-SUAUTO',
  cholula: 'GASTOS AUTOS NUEVOS-CHOLULA',
  zacatelco: 'GASTOS AUTOS NUEVOS-ZACATELCO',
  flotillas: 'GASTOS - FLOTILLAS',
  intercambios: 'GASTOS AUTOS NUEVOS-INTERCAMBIOS',
  casa: 'GASTOS - VTAS CASA',
};

const AREA_TO_SECTIONS = {
  autosNuevos: [
    'GASTOS AUTOS NUEVOS-PISO', 'GASTOS AUTOS NUEVOS-FORANEOS', 'GASTOS AUTOS NUEVOS-SUAUTO',
    'GASTOS AUTOS NUEVOS-CHOLULA', 'GASTOS AUTOS NUEVOS-ZACATELCO', 'GASTOS - FLOTILLAS',
    'GASTOS AUTOS NUEVOS-INTERCAMBIOS', 'GASTOS - VTAS CASA',
  ],
  seminuevos: ['GASTOS AUTOS NUEVOS-SEMINUEVOS'],
  servicio: ['GASTOS-SERVICIO'],
  refacciones: ['GASTOS - REFACCIONES'],
  hyp: ['GASTOS   HYP'],
  postventa: ['GASTOS-POSTVENTA', 'GASTOS-SERVICIO', 'GASTOS - REFACCIONES', 'GASTOS   HYP'],
};

function isAccountCode(value) {
  return /^(0700|0690)-\d/.test(String(value || '').trim());
}

function parseExcelSections() {
  const wb = XLSX.readFile(XLSX_PATH);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  let current = '';
  const sections = {};

  for (const row of rows) {
    const a = String(row[0] || '').trim();
    const b = String(row[1] || '').trim();
    if (a === 'TOTAL') continue;
    if (/^0700-/.test(a)) {
      if (!sections[current]) sections[current] = [];
      sections[current].push({ cuenta: a, desc: b });
      continue;
    }
    if (a && !isAccountCode(a) && !isAccountCode(b)) current = a;
    else if (!a && b && !isAccountCode(b)) current = b;
  }
  return sections;
}

async function main() {
  const sections = parseExcelSections();
  const departments = [];

  for (const [section, accounts] of Object.entries(sections)) {
    if (!accounts.length || section === 'TOTAL') continue;
    const gpoCont = GPO_BY_SECTION[section] || null;
    if (!gpoCont) continue;
    departments.push({
      id: section.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
      label: section,
      gpoCont,
      accounts: accounts.map((a) => a.cuenta),
    });
  }

  const content = `/**
 * Gastos por departamento — generado desde Gatos para buscar origen.xlsx
 * Cada departamento = cuentas 0700 con CTA_GPOCONT específico.
 * Regenerar: node scripts/build-department-expense-map.js
 */
const DEPARTMENTS = ${JSON.stringify(departments, null, 2)};

const GPO_BY_SECTION = ${JSON.stringify(GPO_BY_SECTION, null, 2)};

const SUCURSAL_TO_SECTION = ${JSON.stringify(SUCURSAL_TO_SECTION, null, 2)};

const AREA_TO_SECTIONS = ${JSON.stringify(AREA_TO_SECTIONS, null, 2)};

const OPERATING_GPO_GROUPS = ['711','712','713','714','715','716','717','718','720','730','731','732','733','750'];

const FALLBACK_BY_GPO = {
  '732': { id: 'gastos_hyp', label: 'GASTOS   HYP', gpoCont: '732', accounts: [] },
};

function getDepartmentsForScope(sucursal = 'todos', area = 'todos') {
  if (sucursal !== 'todos' && SUCURSAL_TO_SECTION[sucursal]) {
    const section = SUCURSAL_TO_SECTION[sucursal];
    const found = DEPARTMENTS.filter((d) => d.label === section);
    if (found.length) return found;
  }
  if (area !== 'todos' && AREA_TO_SECTIONS[area]) {
    const labels = AREA_TO_SECTIONS[area];
    const found = DEPARTMENTS.filter((d) => labels.includes(d.label));
    const missing = labels.filter((l) => !found.some((d) => d.label === l));
    for (const label of missing) {
      const gpo = GPO_BY_SECTION[label];
      if (gpo && FALLBACK_BY_GPO[gpo]) found.push({ ...FALLBACK_BY_GPO[gpo], label });
      else if (gpo) found.push({ id: label.toLowerCase().replace(/[^a-z0-9]+/g, '_'), label, gpoCont: gpo, accounts: [] });
    }
    return found;
  }
  return DEPARTMENTS;
}

function getGpoGroupsForScope(sucursal = 'todos', area = 'todos') {
  return getDepartmentsForScope(sucursal, area).map((d) => d.gpoCont);
}

module.exports = {
  DEPARTMENTS,
  GPO_BY_SECTION,
  SUCURSAL_TO_SECTION,
  AREA_TO_SECTIONS,
  OPERATING_GPO_GROUPS,
  getDepartmentsForScope,
  getGpoGroupsForScope,
};
`;

  fs.writeFileSync(OUT_PATH, content, 'utf8');
  console.log('Written', OUT_PATH, 'departments:', departments.length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
