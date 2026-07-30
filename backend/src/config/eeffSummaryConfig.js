/**
 * Estructura EEFF — alineada a EEFF DIC 2025 SUMMARY.xlsx
 * Hojas: BALANCE GRAL | EDO FINANCIERO | VENTAS | PISO… | POSTVENTA | SERVICIO | REFACCIONES | HYP
 */

const MENUDEO_BRANCHES = [
  { id: 'piso', label: 'Piso', segment: '0001', revenuePrefixes: ['0400-0001-%'], costPrefixes: ['0600-0001-%'], expenseGpo: '711', prorationKey: 'piso' },
  { id: 'foraneos', label: 'Foráneos digitales', segment: '0002', revenuePrefixes: ['0400-0002-%'], costPrefixes: ['0600-0002-%'], expenseGpo: '712', prorationKey: 'foraneos' },
  { id: 'suauto', label: 'SuAuto', segment: '0008', revenuePrefixes: ['0400-0008-%'], costPrefixes: ['0600-0008-%', '0600-0003-%'], expenseGpo: '713', prorationKey: 'suauto' },
  { id: 'cholula', label: 'Cholula', segment: '0004', revenuePrefixes: ['0400-0004-%'], costPrefixes: ['0600-0004-%'], expenseGpo: '714', prorationKey: 'cholula' },
  { id: 'zacatelco', label: 'Zacatelco', segment: '0005', revenuePrefixes: ['0400-0005-%'], costPrefixes: ['0600-0005-%'], expenseGpo: '715', prorationKey: 'zacatelco' },
  { id: 'casa', label: 'Casa', segment: '0007', revenuePrefixes: ['0400-0007-%'], costPrefixes: ['0600-0007-%'], expenseGpo: '718', prorationKey: 'casa' },
];

const FLOTILLAS_BRANCH = {
  id: 'flotillas', label: 'Flotillas', segment: '0006',
  revenuePrefixes: ['0400-0006-%'], costPrefixes: ['0600-0006-%'],
  expenseGpo: '716', prorationKey: 'flotillas',
};

const INTERCAMBIOS_BRANCH = {
  id: 'intercambios', label: 'Intercambios', segment: '0010',
  revenuePrefixes: ['0400-0010-%'], costPrefixes: ['0600-0010-%'],
  expenseGpo: '717', prorationKey: 'intercambios',
};

/** Seminuevos: autos (0446/0646) + comerciales (0450/0650) */
const SEMINUEVOS_BRANCHES = [
  {
    id: 'autos',
    label: 'Seminuevos autos',
    revenuePrefixes: ['0446%'],
    costPrefixes: ['0646%'],
  },
  {
    id: 'comerciales',
    label: 'Seminuevos comerciales',
    revenuePrefixes: ['0450%'],
    costPrefixes: ['0650%'],
  },
];

const POSTVENTA_SECTIONS = [
  {
    id: 'servicio',
    label: 'Servicio',
    /** MO mecánica: servicio, garantías, internas, prep. previa, otros talleres, materiales */
    revenuePrefixes: ['0460%', '0462%', '0463%', '0464%', '0466%', '0469%'],
    costPrefixes: ['0660%', '0662%', '0663%', '0664%', '0666%'],
    expenseGpo: '731',
    prorationKey: 'servicio',
  },
  {
    id: 'refacciones',
    label: 'Refacciones',
    /**
     * Partes a servicio/HYP/garantías + internas, mostrador, mayoreo, accesorios, llantas, lubricantes.
     */
    revenuePrefixes: [
      '0467%', '0477%', '0480%',
      '0481%', '0482%', '0483%', '0484%',
      '0490%', '0491%',
    ],
    costPrefixes: [
      '0667%', '0677%', '0680%',
      '0681%', '0682%', '0683%', '0684%',
      '0690%', '0691%',
    ],
    expenseGpo: '733',
    prorationKey: 'refacciones',
  },
  {
    id: 'hyp',
    label: 'HYP',
    /** MO HYP + otros talleres HYP + pintura (sin partes: van en Refacciones) */
    revenuePrefixes: ['0470%', '0476%', '0479%'],
    costPrefixes: ['0670%', '0676%', '0679%'],
    expenseGpo: '732',
    prorationKey: 'hyp',
  },
];

const BALANCE_SECTIONS = [
  { key: 'activoCirculante', label: 'Activo circulante', pertenece: 'ACTIVO', grupos: ['110'] },
  { key: 'activoFijo', label: 'Activo fijo', pertenece: 'ACTIVO', grupos: ['120'] },
  { key: 'activoDiferido', label: 'Activo diferido e inversiones', pertenece: 'ACTIVO', grupos: ['130'] },
  { key: 'pasivoCortoPlazo', label: 'Pasivo corto plazo', pertenece: 'PASIVO', grupos: ['150'] },
  { key: 'pasivoLargoPlazo', label: 'Pasivo largo plazo', pertenece: 'PASIVO', grupos: ['160', '170'] },
  { key: 'capital', label: 'Capital contable', pertenece: 'CAPITAL', grupos: ['190'] },
];

/** Cuentas mayor ACUM — hoja BALANCE GRAL */
const BALANCE_MAJOR_ACCOUNTS = [
  { cuenta: '0200-0000-0000-0000', label: 'Fondo de caja chica', group: 'activoCirculante' },
  { cuenta: '0201-0000-0000-0000', label: 'Caja', group: 'activoCirculante' },
  { cuenta: '0202-0000-0000-0000', label: 'Bancos', group: 'activoCirculante' },
  { cuenta: '0205-0000-0000-0000', label: 'Contratos en tránsito', group: 'activoCirculante' },
  { cuenta: '0220-0000-0000-0000', label: 'Cuentas por cobrar clientes crédito', group: 'activoCirculante' },
  { cuenta: '0225-0000-0000-0000', label: 'Cuentas por cobrar clientes contado', group: 'activoCirculante' },
  { cuenta: '0231-0000-0000-0000', label: 'Inventarios automóviles nuevos', group: 'activoCirculante' },
  { cuenta: '0237-0000-0000-0000', label: 'Inventario comerciales nuevos', group: 'activoCirculante' },
  { cuenta: '0240-0000-0000-0000', label: 'Inventario autos seminuevos', group: 'activoCirculante' },
  { cuenta: '0242-0000-0000-0000', label: 'Inventario partes y accesorios', group: 'activoCirculante' },
  { cuenta: '0245-0000-0000-0000', label: 'Inventario de pintura HYP', group: 'activoCirculante' },
  { cuenta: '0270-0000-0000-0000', label: 'Impuestos pagados por anticipado', group: 'activoCirculante' },
  { cuenta: '0272-0000-0000-0000', label: 'I.V.A. por acreditar', group: 'activoCirculante' },
  { cuenta: '0282-0000-0000-0000', label: 'Maquinaria y equipo de taller', group: 'activoFijo' },
  { cuenta: '0300-0000-0000-0000', label: 'Pasivo total (mayor)', group: 'pasivo' },
  { cuenta: '0400-0000-0000-0000', label: 'Ventas (mayor)', group: 'capital' },
];

const ADMIN_GROUPS = ['740', '750'];
const FINANCIAL_PRODUCT_GROUPS = ['812', '813', '814', '815', '816', '817', '821', '822'];
const FINANCIAL_EXPENSE_ADD = ['901', '938', '940', '941'];
const FINANCIAL_EXPENSE_SUB = ['823', '942'];
/** Intereses financieros en 0700 (también forman parte del gasto operativo) */
const FINANCIAL_INTEREST_PREFIXES = {
  planPiso: ['0700-0076%'],
  moratorios: ['0700-0077%'],
};

const EEFF_CATEGORIES = [
  { id: 'balanceGeneral', label: 'Balance General', sheet: 'BALANCE GRAL' },
  { id: 'estadoFinanciero', label: 'Edo. Financiero', sheet: 'EDO FINANCIERO' },
  { id: 'ventas', label: 'Ventas', sheet: 'VENTAS' },
  { id: 'postventa', label: 'PostVenta', sheet: 'POSTVENTA' },
];

module.exports = {
  MENUDEO_BRANCHES,
  FLOTILLAS_BRANCH,
  INTERCAMBIOS_BRANCH,
  SEMINUEVOS_BRANCHES,
  POSTVENTA_SECTIONS,
  BALANCE_SECTIONS,
  BALANCE_MAJOR_ACCOUNTS,
  ADMIN_GROUPS,
  FINANCIAL_PRODUCT_GROUPS,
  FINANCIAL_EXPENSE_ADD,
  FINANCIAL_EXPENSE_SUB,
  FINANCIAL_INTEREST_PREFIXES,
  EEFF_CATEGORIES,
};
