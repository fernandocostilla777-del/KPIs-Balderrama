/**
 * Matriz de prorrateo del bolsón administrativo (0700 / GPO 740-750)
 * hacia centros operativos.
 *
 * Fuente activa: configuración en Administración (adminExpenseProration.json).
 * Las matrices legacy / 2026 quedan solo como referencia de respaldo.
 */

const {
  getConfiguredProrationFactors,
  getAdminExpenseProration,
} = require('../services/adminExpenseProrationStore');

/** Matriz histórica (referencia; ya no se usa por defecto) */
const PRORATION_MATRIX_LEGACY = {
  piso: 0.22,
  foraneos: 0.10,
  cholula: 0.08,
  zacatelco: 0.06,
  flotillas: 0.08,
  casa: 0.05,
  suauto: 0.04,
  intercambios: 0.03,
  seminuevos: 0.08,
  refacciones: 0.10,
  servicio: 0.10,
  hyp: 0.06,
};

/** Matriz 2026 histórica (referencia) */
const PRORATION_MATRIX_2026 = {
  piso: 0.3856,
  zacatelco: 0.0746,
  foraneos: 0.197,
  casa: 0.0603,
  intercambios: 0.0934,
  seminuevos: 0.08,
  cholula: 0.0706,
  flotillas: 0.0385,
};

const PRORATION_MATRIX = PRORATION_MATRIX_LEGACY;
const PRORATION_YEAR_2026 = 2026;

function resolveProrationYear(yearOrOpts) {
  if (yearOrOpts == null) return null;
  if (typeof yearOrOpts === 'number' && Number.isFinite(yearOrOpts)) {
    return Math.trunc(yearOrOpts);
  }
  if (typeof yearOrOpts === 'string') {
    const y = Number(String(yearOrOpts).slice(0, 4));
    return Number.isFinite(y) ? y : null;
  }
  if (typeof yearOrOpts === 'object') {
    if (yearOrOpts.year != null) return resolveProrationYear(yearOrOpts.year);
    if (yearOrOpts.fechaFin) return resolveProrationYear(String(yearOrOpts.fechaFin).slice(0, 4));
    if (yearOrOpts.fechaInicio) return resolveProrationYear(String(yearOrOpts.fechaInicio).slice(0, 4));
  }
  return null;
}

function validateMatrix(matrix = PRORATION_MATRIX_LEGACY) {
  const total = Object.values(matrix).reduce((s, v) => s + v, 0);
  if (Math.abs(total - 1) > 0.001) {
    throw new Error(`La matriz de prorrateo debe sumar 100% (actual: ${(total * 100).toFixed(1)}%)`);
  }
  return true;
}

/**
 * Factores de prorrateo desde Administración (70% ventas / 30% postventa).
 * yearOrOpts se conserva por compatibilidad de firmas; no cambia la fuente.
 */
function getProrationFactors(_yearOrOpts) {
  const matrix = getConfiguredProrationFactors();
  validateMatrix(matrix);
  return { ...matrix };
}

function getProrationMatrixMeta(yearOrOpts) {
  const year = resolveProrationYear(yearOrOpts);
  let adminMeta = null;
  try {
    adminMeta = getAdminExpenseProration();
  } catch {
    adminMeta = null;
  }
  const cfg = adminMeta?.config;
  return {
    year,
    key: 'admin',
    label: 'Configuración administración',
    source: 'adminExpenseProration',
    ventasSharePct: cfg?.ventasSharePct ?? 70,
    postventaSharePct: cfg?.postventaSharePct ?? 30,
    updatedAt: cfg?.updatedAt || null,
  };
}

module.exports = {
  PRORATION_MATRIX,
  PRORATION_MATRIX_LEGACY,
  PRORATION_MATRIX_2026,
  PRORATION_YEAR_2026,
  getProrationFactors,
  getProrationMatrixMeta,
  validateMatrix,
};
