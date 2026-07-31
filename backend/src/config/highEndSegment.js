/**
 * Segmento comercial HIGH END (canal de lujo Balderrama).
 * No es forma de pago: se define por carline / modelo.
 */
const HIGH_END_CARLINES = ['SUBURBAN', 'TAHOE', 'CHEYENNE', 'TRAVERSE'];

/** Variantes / typos frecuentes en DMS */
const HIGH_END_ALIASES = [
  'SUBURBAN',
  'TAHOE',
  'CHEYENNE',
  'CHEYEN',
  'CHEYENE',
  'TRAVERSE',
];

function normalizeModelText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isHighEndQuery(term) {
  const t = normalizeModelText(term);
  return /^(HIGH\s*END|HIGHEND|LUJO|PREMIUM|SEGMENTO\s*LUJO)$/.test(t)
    || t.includes('HIGH END')
    || t.includes('HIGHEND');
}

function isHighEndVehicle({ tipoAuto, familia, catalogo } = {}) {
  const blob = normalizeModelText([tipoAuto, familia, catalogo].filter(Boolean).join(' '));
  if (!blob) return false;
  return HIGH_END_ALIASES.some((alias) => blob.includes(alias));
}

function highEndSqlLikeClauses(columnExpr) {
  return HIGH_END_ALIASES.map(
    (alias) => `UPPER(LTRIM(RTRIM(${columnExpr}))) LIKE '%${alias}%'`
  ).join('\n        OR ');
}

module.exports = {
  HIGH_END_CARLINES,
  HIGH_END_ALIASES,
  normalizeModelText,
  isHighEndQuery,
  isHighEndVehicle,
  highEndSqlLikeClauses,
};
