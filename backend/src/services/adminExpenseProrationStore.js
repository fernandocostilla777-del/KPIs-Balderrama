/**
 * Prorrateo de gastos de administración (bolsón 740/750) hacia ventas y postventa.
 * Configurable desde Administración; usado por EEFF / estado de resultados.
 */

const fs = require('fs');
const path = require('path');

const STORE_FILE = path.join(__dirname, '../../data/adminExpenseProration.json');

const VENTAS_ITEMS = [
  { key: 'piso', label: 'Piso' },
  { key: 'foraneos', label: 'Foráneos digitales' },
  { key: 'suauto', label: 'SuAuto' },
  { key: 'cholula', label: 'Cholula' },
  { key: 'zacatelco', label: 'Zacatelco' },
  { key: 'casa', label: 'Casa' },
  { key: 'intercambios', label: 'Intercambios' },
  { key: 'flotillas', label: 'Flotillas' },
  { key: 'seminuevos', label: 'Seminuevos' },
];

const POSTVENTA_ITEMS = [
  { key: 'refacciones', label: 'Refacciones' },
  { key: 'hyp', label: 'HYP' },
  { key: 'servicio', label: 'Servicio' },
];

/** Defaults solicitados: 70% ventas / 30% postventa */
const DEFAULT_CONFIG = {
  version: 1,
  ventasSharePct: 70,
  postventaSharePct: 30,
  /** % dentro del bloque ventas (deben sumar 100) */
  ventas: {
    piso: 37,
    foraneos: 23,
    suauto: 1,
    cholula: 9,
    zacatelco: 10,
    casa: 8,
    intercambios: 2.5,
    flotillas: 1,
    seminuevos: 8.5,
  },
  /** % del total del gasto de administración (deben sumar postventaSharePct) */
  postventa: {
    refacciones: 10,
    hyp: 10,
    servicio: 10,
  },
  updatedAt: null,
};

function round4(n) {
  return Math.round(Number(n || 0) * 10000) / 10000;
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function cloneDefault() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function sumValues(obj = {}) {
  return Object.values(obj).reduce((s, v) => s + Number(v || 0), 0);
}

function normalizeConfig(raw = {}) {
  const base = cloneDefault();
  const cfg = {
    ...base,
    ...raw,
    ventas: { ...base.ventas, ...(raw.ventas || {}) },
    postventa: { ...base.postventa, ...(raw.postventa || {}) },
  };
  cfg.ventasSharePct = Number(cfg.ventasSharePct);
  cfg.postventaSharePct = Number(cfg.postventaSharePct);
  for (const item of VENTAS_ITEMS) {
    cfg.ventas[item.key] = Number(cfg.ventas[item.key] ?? 0);
  }
  for (const item of POSTVENTA_ITEMS) {
    cfg.postventa[item.key] = Number(cfg.postventa[item.key] ?? 0);
  }
  return cfg;
}

function validateConfig(input) {
  const cfg = normalizeConfig(input);
  const errors = [];

  if (!Number.isFinite(cfg.ventasSharePct) || cfg.ventasSharePct < 0) {
    errors.push('Participación de ventas inválida.');
  }
  if (!Number.isFinite(cfg.postventaSharePct) || cfg.postventaSharePct < 0) {
    errors.push('Participación de postventa inválida.');
  }
  if (Math.abs(cfg.ventasSharePct + cfg.postventaSharePct - 100) > 0.05) {
    errors.push(
      `Ventas + postventa debe sumar 100% (actual: ${round2(cfg.ventasSharePct + cfg.postventaSharePct)}%).`
    );
  }

  const ventasSum = sumValues(cfg.ventas);
  if (Math.abs(ventasSum - 100) > 0.05) {
    errors.push(`Los % del bloque ventas deben sumar 100% (actual: ${round2(ventasSum)}%).`);
  }

  const postSum = sumValues(cfg.postventa);
  if (Math.abs(postSum - cfg.postventaSharePct) > 0.05) {
    errors.push(
      `Los % de postventa deben sumar ${round2(cfg.postventaSharePct)}% del total (actual: ${round2(postSum)}%).`
    );
  }

  const factors = toFlatFactors(cfg);
  const factorSum = sumValues(factors);
  if (Math.abs(factorSum - 1) > 0.001) {
    errors.push(`La matriz resultante debe sumar 100% (actual: ${round2(factorSum * 100)}%).`);
  }

  if (errors.length) {
    const err = new Error(errors.join(' '));
    err.details = errors;
    throw err;
  }
  return cfg;
}

/**
 * Factores absolutos (0–1) sobre el bolsón administrativo total.
 * ventas[k] = (ventasShare/100) * (pctBloque/100)
 * postventa[k] = pctTotal/100
 */
function toFlatFactors(cfgInput) {
  const cfg = normalizeConfig(cfgInput);
  const flat = {};
  const vShare = cfg.ventasSharePct / 100;
  for (const item of VENTAS_ITEMS) {
    flat[item.key] = round4(vShare * (Number(cfg.ventas[item.key] || 0) / 100));
  }
  for (const item of POSTVENTA_ITEMS) {
    flat[item.key] = round4(Number(cfg.postventa[item.key] || 0) / 100);
  }
  return flat;
}

function buildBreakdown(cfgInput) {
  const cfg = normalizeConfig(cfgInput);
  const factors = toFlatFactors(cfg);
  return {
    ventasSharePct: cfg.ventasSharePct,
    postventaSharePct: cfg.postventaSharePct,
    ventas: VENTAS_ITEMS.map((item) => ({
      ...item,
      pctOfBlock: cfg.ventas[item.key],
      pctOfTotal: round2(factors[item.key] * 100),
      factor: factors[item.key],
    })),
    postventa: POSTVENTA_ITEMS.map((item) => ({
      ...item,
      pctOfTotal: cfg.postventa[item.key],
      factor: factors[item.key],
    })),
    factors,
    totalPct: round2(sumValues(factors) * 100),
  };
}

function ensureStore() {
  if (!fs.existsSync(STORE_FILE)) {
    const cfg = cloneDefault();
    cfg.updatedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(cfg, null, 2), 'utf8');
    return cfg;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    return normalizeConfig(raw);
  } catch {
    return cloneDefault();
  }
}

function getAdminExpenseProration() {
  const cfg = ensureStore();
  return {
    config: cfg,
    meta: {
      source: 'admin',
      label: 'Prorrateo administración (configuración)',
      file: path.basename(STORE_FILE),
    },
    breakdown: buildBreakdown(cfg),
    catalog: { ventas: VENTAS_ITEMS, postventa: POSTVENTA_ITEMS },
  };
}

function saveAdminExpenseProration(input) {
  const cfg = validateConfig(input);
  cfg.updatedAt = new Date().toISOString();
  cfg.version = 1;
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  return getAdminExpenseProration();
}

function resetAdminExpenseProration() {
  return saveAdminExpenseProration(cloneDefault());
}

/** Factores listos para EEFF / ETL (siempre desde admin). */
function getConfiguredProrationFactors() {
  const { breakdown } = getAdminExpenseProration();
  return { ...breakdown.factors };
}

module.exports = {
  STORE_FILE,
  DEFAULT_CONFIG,
  VENTAS_ITEMS,
  POSTVENTA_ITEMS,
  getAdminExpenseProration,
  saveAdminExpenseProration,
  resetAdminExpenseProration,
  getConfiguredProrationFactors,
  toFlatFactors,
  validateConfig,
  buildBreakdown,
};
