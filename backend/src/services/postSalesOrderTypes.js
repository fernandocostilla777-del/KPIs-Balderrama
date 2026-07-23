/** Nomenclatura PostVenta: primera letra del folio → área (Servicio / HyP). */

const TIPO_POR_LETRA = {
  V: 'Aseguradora Body 31',
  A: 'Aseguradoras',
  F: 'Aseguradoras particulares',
  E: 'Empleados',
  Á: 'Flotilla',
  G: 'Garantías',
  I: 'Interna',
  J: 'Interna HYP',
  Ó: 'Interna nuevos HYP',
  M: 'Interna seminuevos',
  H: 'Interna seminuevos HYP',
  O: 'Interna ventas',
  N: 'Normal',
  Y: 'Normal Cholula',
  Q: 'Normal Zacatelco',
  Z: 'Particulares Body 31',
  S: 'Previas',
  R: 'Reclamaciones',
  D: 'Reparación',
  X: 'Reparación Cholula',
  C: 'Reparación Zacatelco',
  K: 'Tipo K',
};

const AREA_LETRAS = {
  servicio: ['C', 'D', 'G', 'I', 'K', 'N', 'O', 'Q', 'S', 'X', 'Y', 'Á', 'M', 'E', 'R'],
  hyp: ['A', 'F', 'H', 'J', 'V', 'Z', 'Ó'],
};

const OPEN_STATUSES = new Set(['A', 'T', 'D', 'P']);

function firstLetter(orden) {
  const s = String(orden || '').trim();
  if (!s) return '';
  return s[0].toUpperCase();
}

function letterOfRecord(record) {
  const fromField = String(record?.letraOrden || '').trim().toUpperCase();
  if (fromField) return fromField;
  return firstLetter(record?.orden);
}

function matchesArea(record, area) {
  const key = String(area || '').toLowerCase();
  if (!key || key === 'posventa' || key === 'todas' || key === 'refacciones') return true;
  const letras = AREA_LETRAS[key];
  if (!letras) return true;
  return new Set(letras).has(letterOfRecord(record));
}

function isOpen(record) {
  const status = String(record?.status || '').trim().toUpperCase();
  return OPEN_STATUSES.has(status);
}

function isFacturada(record) {
  return String(record?.status || '').trim().toUpperCase() === 'I';
}

function matchesEstatus(record, estatus) {
  const key = String(estatus || 'todas').toLowerCase();
  if (!key || key === 'todas') return true;
  if (key === 'abiertas' || key === 'abierta' || key === 'open') return isOpen(record);
  if (key === 'facturadas' || key === 'facturada') return isFacturada(record);
  if (key === 'canceladas' || key === 'cancelada') {
    return String(record?.status || '').trim().toUpperCase() === 'C';
  }
  return String(record?.status || '').trim().toUpperCase() === key.toUpperCase();
}

function filterRecords(records, { area = 'posventa', estatus = 'todas' } = {}) {
  return (records || []).filter((r) => matchesArea(r, area) && matchesEstatus(r, estatus));
}

function countByLetter(records) {
  const map = new Map();
  for (const r of records || []) {
    const L = letterOfRecord(r) || '?';
    map.set(L, (map.get(L) || 0) + 1);
  }
  return [...map.entries()]
    .map(([letra, total]) => ({
      letra,
      tipo: TIPO_POR_LETRA[letra] || `Tipo ${letra}`,
      total,
    }))
    .sort((a, b) => b.total - a.total);
}

module.exports = {
  TIPO_POR_LETRA,
  AREA_LETRAS,
  OPEN_STATUSES,
  firstLetter,
  letterOfRecord,
  matchesArea,
  isOpen,
  isFacturada,
  matchesEstatus,
  filterRecords,
  countByLetter,
};
