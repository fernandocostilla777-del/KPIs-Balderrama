/**
 * Centros de costo operativos y administrativos.
 * Segmento = posición en CTA_NUMCTA (ej. 0400-0001-..., 0700-0011-0001-...).
 */

const SEGMENT_TO_CC = {
  '0001': { id: 'piso', label: 'Piso (Autos Nuevos)', area: 'autosNuevos', type: 'operativo' },
  '0002': { id: 'foraneos', label: 'Foráneos', area: 'autosNuevos', type: 'operativo' },
  '0004': { id: 'cholula', label: 'Cholula', area: 'autosNuevos', type: 'operativo' },
  '0005': { id: 'zacatelco', label: 'Zacatelco', area: 'autosNuevos', type: 'operativo' },
  '0006': { id: 'flotillas', label: 'Flotillas', area: 'autosNuevos', type: 'operativo' },
  '0007': { id: 'casa', label: 'Casa / BDC', area: 'autosNuevos', type: 'operativo' },
  '0008': { id: 'suauto', label: 'SuAuto', area: 'autosNuevos', type: 'operativo' },
  '0010': { id: 'intercambios', label: 'Intercambios', area: 'autosNuevos', type: 'operativo' },
};

const AREA_CC = {
  seminuevos: { id: 'seminuevos', label: 'Seminuevos', area: 'seminuevos', type: 'operativo' },
  refacciones: { id: 'refacciones', label: 'Refacciones', area: 'refacciones', type: 'operativo' },
  servicio: { id: 'servicio', label: 'Servicio', area: 'servicio', type: 'operativo' },
  hyp: { id: 'hyp', label: 'Hojalatería y Pintura', area: 'hyp', type: 'operativo' },
};

/** Plantilla VTASMEN — alineada a Excel ESTADODERESULTADO-VTASMEN */
const VTASMEN_BRANCHES = [
  { id: 'piso', label: 'Piso (Autos Nuevos)', segment: '0001', revenuePrefixes: ['0400-0001-%'], costPrefixes: ['0600-0001-%'], expenseGroup: '711' },
  { id: 'foraneos', label: 'Foráneos', segment: '0002', revenuePrefixes: ['0400-0002-%'], costPrefixes: ['0600-0002-%'], expenseGroup: '712' },
  { id: 'suauto', label: 'SuAuto', segment: '0008', revenuePrefixes: ['0400-0008-%'], costPrefixes: ['0600-0008-%', '0600-0003-%'], expenseGroup: '713' },
  { id: 'cholula', label: 'Cholula', segment: '0004', revenuePrefixes: ['0400-0004-%'], costPrefixes: ['0600-0004-%'], expenseGroup: '714' },
  { id: 'zacatelco', label: 'Zacatelco', segment: '0005', revenuePrefixes: ['0400-0005-%'], costPrefixes: ['0600-0005-%'], expenseGroup: '715' },
  { id: 'casa', label: 'Casa / BDC', segment: '0007', revenuePrefixes: ['0400-0007-%'], costPrefixes: ['0600-0007-%'], expenseGroup: '718' },
  { id: 'flotillas', label: 'Flotillas', segment: '0006', revenuePrefixes: ['0400-0006-%'], costPrefixes: ['0600-0006-%'], expenseGroup: null, expensePattern: '0700-%-0006-%' },
  { id: 'intercambios', label: 'Intercambios', segment: '0010', revenuePrefixes: ['0400-0010-%'], costPrefixes: ['0600-0010-%'], expenseGroup: null, expensePattern: '0700-%-0010-%' },
];

const ADMIN_GPOCONT = '740';

const ADMIN_CC = {
  admin_general: {
    id: 'admin_general',
    label: 'Administración General',
    type: 'administrativo',
  },
  postventa_admon: {
    id: 'postventa_admon',
    label: 'Postventa Admon',
    type: 'administrativo',
  },
};

/** Subcuentas críticas 0700 */
const EXPENSE_SUBACCOUNTS = {
  '0011': { id: 'comisiones', label: 'Comisiones' },
  '0076': { id: 'plan_piso', label: 'Intereses Plan Piso' },
  '0080': { id: 'rentas', label: 'Rentas' },
};

const ACCOUNT_MASKS = {
  ingreso: { prefix: '0400', sign: 'income' },
  costo: { prefix: '0600', sign: 'expense' },
  gasto: { prefix: '0700', sign: 'expense' },
};

const INCOME_PREFIX_TO_AREA = [
  { prefixes: ['0400'], area: 'autosNuevos', useSegment: true },
  { prefixes: ['0446', '0450'], area: 'seminuevos', useSegment: false },
  { prefixes: ['0460', '0462', '0463', '0464', '0466', '0469'], area: 'servicio', useSegment: true },
  { prefixes: ['0467', '0477', '0480', '0481', '0482', '0483', '0484', '0490', '0491'], area: 'refacciones', useSegment: false },
  { prefixes: ['0470', '0476', '0479'], area: 'hyp', useSegment: false },
];

const COST_PREFIX_TO_AREA = [
  { prefixes: ['0600'], area: 'autosNuevos', useSegment: true },
  { prefixes: ['0620', '0646', '0650'], area: 'seminuevos', useSegment: false },
  { prefixes: ['0660', '0662', '0663', '0664', '0666'], area: 'servicio', useSegment: false },
  { prefixes: ['0667', '0677', '0680', '0681', '0682', '0683', '0684', '0690', '0691'], area: 'refacciones', useSegment: false },
  { prefixes: ['0670', '0676', '0679'], area: 'hyp', useSegment: false },
];

const OPERATIONAL_CC_LIST = [
  ...Object.values(SEGMENT_TO_CC),
  ...Object.values(AREA_CC),
];

function getOperationalCc(id) {
  return OPERATIONAL_CC_LIST.find((c) => c.id === id) || null;
}

function getAllOperationalCcIds() {
  return OPERATIONAL_CC_LIST.map((c) => c.id);
}

module.exports = {
  SEGMENT_TO_CC,
  AREA_CC,
  ADMIN_CC,
  ADMIN_GPOCONT,
  VTASMEN_BRANCHES,
  EXPENSE_SUBACCOUNTS,
  ACCOUNT_MASKS,
  INCOME_PREFIX_TO_AREA,
  COST_PREFIX_TO_AREA,
  OPERATIONAL_CC_LIST,
  getOperationalCc,
  getAllOperationalCcIds,
};
