/**
 * Matriz de prorrateo del bolsón administrativo (0700 / GPO 740-750)
 * hacia centros operativos. Los porcentajes deben sumar 1.0 (100%).
 *
 * · Años distintos de 2026 → matriz histórica
 * · 2026 → matriz oficial (Piso 38.56%, Foráneos 19.70%, …)
 */

/** Matriz histórica (años ≠ 2026) */
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

/**
 * Matriz 2026:
 * PISO 38.56000% · ZACATELCO 7.46% · FORANEOS 19.70% · CASA 6.03%
 * INTERCAMBIOS 9.34% · SEMINUEVOS 8.00% · CHOLULA 7.06% · FLOTILLAS 3.85%
 */
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

/** Alias de compatibilidad → matriz histórica */
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
 * Factores de prorrateo según año del periodo (fechaFin).
 * Solo 2026 usa la matriz nueva; el resto conserva la histórica.
 */
function getProrationFactors(yearOrOpts) {
  const year = resolveProrationYear(yearOrOpts);
  const matrix = year === PRORATION_YEAR_2026
    ? PRORATION_MATRIX_2026
    : PRORATION_MATRIX_LEGACY;
  validateMatrix(matrix);
  return { ...matrix };
}

function getProrationMatrixMeta(yearOrOpts) {
  const year = resolveProrationYear(yearOrOpts);
  const is2026 = year === PRORATION_YEAR_2026;
  return {
    year,
    key: is2026 ? '2026' : 'legacy',
    label: is2026 ? 'Matriz 2026' : 'Matriz histórica',
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
