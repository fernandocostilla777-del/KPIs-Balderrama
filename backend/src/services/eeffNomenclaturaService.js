const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { BALANCE_SECTIONS } = require('../config/eeffSummaryConfig');

const DEFAULT_NOMENCLATURA_PATH = path.join(__dirname, '../../data/nomenclatura-eeff.xlsx');

const SECTION_HEADER_MAP = {
  'ACTIVO CIRCULANTE': 'activoCirculante',
  'ACTIVO FIJO': 'activoFijo',
  'ACTIVO DIFERIDO': 'activoDiferido',
  'PASIVO CIRCULANTE': 'pasivoCortoPlazo',
  'PASIVO LARGO PLAZO': 'pasivoLargoPlazo',
  CAPITAL: 'capital',
};

const CUENTA_RE = /^\d{4}-\d{4}-\d{4}-\d{4}$/;

let cachedAccounts = null;
let cachedPath = null;

function resolveNomenclaturaPath() {
  const envPath = process.env.NOMENCLATURA_XLSX_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  if (fs.existsSync(DEFAULT_NOMENCLATURA_PATH)) return DEFAULT_NOMENCLATURA_PATH;
  const downloads = path.join(
    process.env.USERPROFILE || process.env.HOME || '',
    'Documents',
    'JULIO 26',
    'Nomenclatura para eeff.xlsx',
  );
  if (downloads && fs.existsSync(downloads)) return downloads;
  return null;
}

function normHeader(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function titleLabel(value) {
  return String(value ?? '').trim();
}

function isValidCuenta(value) {
  return CUENTA_RE.test(String(value ?? '').trim());
}

function parseNomenclaturaWorkbook(wb) {
  const sheetName = wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
  const bySection = {};
  let currentSection = null;

  for (const row of rows) {
    const colB = normHeader(row[1]);
    if (SECTION_HEADER_MAP[colB]) {
      currentSection = SECTION_HEADER_MAP[colB];
      if (!bySection[currentSection]) bySection[currentSection] = [];
      continue;
    }

    const colA = String(row[0] ?? '').trim();
    if (!isValidCuenta(colA) || !currentSection) continue;

    bySection[currentSection].push({
      cuenta: colA,
      label: titleLabel(row[1]),
      sectionKey: currentSection,
    });
  }

  return bySection;
}

function getNomenclaturaAccountsBySection() {
  const filePath = resolveNomenclaturaPath();
  if (!filePath) return null;

  if (cachedAccounts && cachedPath === filePath) return cachedAccounts;

  const wb = XLSX.readFile(filePath, { cellDates: true });
  cachedAccounts = parseNomenclaturaWorkbook(wb);
  cachedPath = filePath;
  return cachedAccounts;
}

function getAllNomenclaturaAccounts() {
  const bySection = getNomenclaturaAccountsBySection();
  if (!bySection) return [];
  return Object.values(bySection).flat();
}

function getSectionMeta() {
  return BALANCE_SECTIONS.map((s) => ({
    key: s.key,
    label: s.label,
    pertenece: s.pertenece,
    accountCount: getNomenclaturaAccountsBySection()?.[s.key]?.length || 0,
  }));
}

module.exports = {
  getNomenclaturaAccountsBySection,
  getAllNomenclaturaAccounts,
  getSectionMeta,
  resolveNomenclaturaPath,
  SECTION_HEADER_MAP,
};
