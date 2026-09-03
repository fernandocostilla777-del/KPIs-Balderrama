/**
 * Normalización y match de números de contrato GMF
 * (Histórico vs PAGOS GMF: a menudo difieren en 1 dígito / formato).
 */

function digitsOnly(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  const text = String(value).replace(/[^\d]/g, '');
  return text || null;
}

/** Valor estable para guardar contrato (evita notación científica). */
function contractStorageValue(value) {
  const digits = digitsOnly(value);
  if (digits) return digits;
  if (value == null || value === '') return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || null;
}

/**
 * ¿pagoNorm y histNorm representan el mismo contrato?
 * Acepta igualdad o prefijo (truncado en pagos).
 */
function contractsLooselyMatch(pagoNorm, histNorm, { minLen = 10 } = {}) {
  if (!pagoNorm || !histNorm) return false;
  if (pagoNorm === histNorm) return true;
  const shorter = pagoNorm.length <= histNorm.length ? pagoNorm : histNorm;
  if (shorter.length < minLen) return false;
  return histNorm.startsWith(pagoNorm) || pagoNorm.startsWith(histNorm);
}

function scoreContractMatch(pagoNorm, histNorm) {
  if (!contractsLooselyMatch(pagoNorm, histNorm)) return -1;
  if (pagoNorm === histNorm) return 1000 + histNorm.length;
  if (histNorm.startsWith(pagoNorm)) return 500 + pagoNorm.length;
  if (pagoNorm.startsWith(histNorm)) return 250 + histNorm.length;
  return 0;
}

/**
 * Índice contrato_norm → { vin, contrato, noContrato }
 * Preferencia: el histórico más largo cuando hay varios prefijos.
 */
function buildContratoHistoricoIndex(rows = []) {
  const byNorm = new Map();
  for (const row of rows) {
    const vin = String(row.vin || '').toUpperCase().replace(/\s+/g, '') || null;
    const contrato = contractStorageValue(row.contrato);
    const noContrato = contractStorageValue(row.no_contrato ?? row.noContrato);
    for (const key of [contrato, noContrato]) {
      if (!key) continue;
      const prev = byNorm.get(key);
      if (!prev || (vin && !prev.vin)) {
        byNorm.set(key, {
          vin,
          contrato: contrato || noContrato,
          noContrato,
          contratoNorm: key,
        });
      }
    }
  }
  const norms = [...byNorm.keys()].sort((a, b) => b.length - a.length);
  return { byNorm, norms };
}

function resolveHistoricoByContrato(pagoContrato, index, opts) {
  const pagoNorm = digitsOnly(pagoContrato);
  if (!pagoNorm || !index?.byNorm) return null;
  const exact = index.byNorm.get(pagoNorm);
  if (exact) return { ...exact, matchMode: 'exact' };

  let best = null;
  let bestScore = -1;
  for (const histNorm of index.norms) {
    const score = scoreContractMatch(pagoNorm, histNorm);
    if (score > bestScore) {
      bestScore = score;
      best = index.byNorm.get(histNorm);
    }
  }
  if (!best || bestScore < 0) return null;
  if (!contractsLooselyMatch(pagoNorm, best.contratoNorm, opts)) return null;
  return {
    ...best,
    matchMode: best.contratoNorm.startsWith(pagoNorm) ? 'prefix_pago' : 'prefix_hist',
  };
}

module.exports = {
  digitsOnly,
  contractStorageValue,
  contractsLooselyMatch,
  scoreContractMatch,
  buildContratoHistoricoIndex,
  resolveHistoricoByContrato,
};
