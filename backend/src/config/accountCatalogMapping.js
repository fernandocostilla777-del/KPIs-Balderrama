/**
 * Mapeo del catálogo contable — Nivel Mayor (Balanza de Comprobación).
 * Fuente: Total de cuentas.xlsx + instrucción EEFF Balderrama.
 */

/** Ingresos: saldos acreedores (créditos) — grupo 0400 y complementos */
const INCOME_CATALOG = {
  autosNuevos: {
    key: 'autosNuevos',
    label: 'Venta Autos y Comerciales (0400)',
    majorAccount: '0400-0000-0000-0000',
    prefixes: ['0400%'],
    channels: [
      { key: 'piso', label: 'Piso (0400-0001)', prefix: '0400-0001-%' },
      { key: 'foraneos', label: 'Foráneos (0400-0002)', prefix: '0400-0002-%' },
      { key: 'cholula', label: 'Cholula (0400-0004)', prefix: '0400-0004-%' },
      { key: 'bdc', label: 'BDC / Casa (0400-0007)', prefix: '0400-0007-%' },
      { key: 'intercambios', label: 'Intercambios (0400-0010)', prefix: '0400-0010-%' },
      { key: 'suauto', label: 'SuAuto (0400-0008)', prefix: '0400-0008-%' },
      { key: 'zacatelco', label: 'Zacatelco (0400-0005)', prefix: '0400-0005-%' },
      { key: 'flotillas', label: 'Flotillas (0400-0006)', prefix: '0400-0006-%' },
    ],
  },
  seminuevos: {
    key: 'seminuevos',
    label: 'Venta Seminuevos (0446 + 0450)',
    majorAccount: '0446-0000-0000-0000',
    prefixes: ['0446%', '0450%'],
    channels: [
      { key: 'autos', label: 'Autos seminuevos (0446)', prefix: '0446%' },
      { key: 'comerciales', label: 'Comerciales seminuevos (0450)', prefix: '0450%' },
    ],
  },
  servicio: {
    key: 'servicio',
    label: 'Ventas Servicio (0460/0462/0463/0464/0466/0469)',
    majorAccount: '0460-0000-0000-0000',
    prefixes: ['0460%', '0462%', '0463%', '0464%', '0466%', '0469%'],
  },
  refacciones: {
    key: 'refacciones',
    label: 'Ventas Refacciones (partes servicio/HYP/garantía + mostrador/mayoreo)',
    majorAccount: null,
    prefixes: [
      '0467%', '0477%', '0480%',
      '0481%', '0482%', '0483%', '0484%',
      '0490%', '0491%',
    ],
    subLines: [
      { key: 'partesServicio', label: 'Partes en órdenes servicio (0467)', prefix: '0467%' },
      { key: 'partesHyp', label: 'Partes en órdenes HYP (0477)', prefix: '0477%' },
      { key: 'garantias', label: 'Garantías partes (0480)', prefix: '0480%' },
      { key: 'internas', label: 'Internas (0481)', prefix: '0481%' },
      { key: 'mostrador', label: 'Mostrador (0482)', prefix: '0482%' },
      { key: 'mayoreo', label: 'Mayoreo (0483)', prefix: '0483%' },
      { key: 'accesorios', label: 'Accesorios (0484)', prefix: '0484%' },
      { key: 'llantas', label: 'Llantas (0490)', prefix: '0490%' },
      { key: 'lubricantes', label: 'Lubricantes (0491)', prefix: '0491%' },
    ],
  },
  hyp: {
    key: 'hyp',
    label: 'Ventas HYP (0470/0476/0479)',
    majorAccount: '0470-0000-0000-0000',
    prefixes: ['0470%', '0476%', '0479%'],
  },
  financiamiento: {
    key: 'financiamiento',
    label: 'Ingresos F&I — Financiamiento y Seguros (0800)',
    majorAccount: '0800-0000-0000-0000',
    prefixes: ['0800%'],
    optional: true,
  },
};

/** Costos: saldos deudores (cargos) — grupo 0600 */
const COST_CATALOG = {
  autosNuevos: {
    key: 'autosNuevos',
    label: 'Costo Venta Autos y Comerciales (0600)',
    majorAccount: '0600-0000-0000-0000',
    prefixes: ['0600%'],
    channels: [
      { key: 'piso', label: 'Costo Piso (0600-0001)', prefix: '0600-0001-%' },
      { key: 'foraneos', label: 'Costo Foráneos (0600-0002)', prefix: '0600-0002-%' },
      { key: 'cholula', label: 'Costo Cholula (0600-0004)', prefix: '0600-0004-%' },
      { key: 'bdc', label: 'Costo BDC (0600-0007)', prefix: '0600-0007-%' },
      { key: 'intercambios', label: 'Costo Intercambios (0600-0010)', prefix: '0600-0010-%' },
      { key: 'suauto', label: 'Costo SuAuto (0600-0008)', prefix: '0600-0008-%' },
      { key: 'suauto_alt', label: 'Costo SuAuto alt (0600-0003)', prefix: '0600-0003-%' },
      { key: 'zacatelco', label: 'Costo Zacatelco (0600-0005)', prefix: '0600-0005-%' },
      { key: 'flotillas', label: 'Costo Flotillas (0600-0006)', prefix: '0600-0006-%' },
    ],
  },
  seminuevos: { key: 'seminuevos', label: 'Costo Seminuevos', prefixes: ['0646%', '0650%'] },
  servicio: {
    key: 'servicio',
    label: 'Costo Servicio (MO mecánica)',
    prefixes: ['0660%', '0662%', '0663%', '0664%', '0666%'],
  },
  refacciones: {
    key: 'refacciones',
    label: 'Costo Refacciones',
    prefixes: [
      '0667%', '0677%', '0680%',
      '0681%', '0682%', '0683%', '0684%',
      '0690%', '0691%',
    ],
  },
  hyp: {
    key: 'hyp',
    label: 'Costo HYP (MO + pintura)',
    prefixes: ['0670%', '0676%', '0679%'],
  },
};

/** Gastos operación: saldos deudores (cargos) — grupo 0700 */
const EXPENSE_CATALOG = {
  general: {
    key: 'general',
    label: 'Gastos de Operación (0700)',
    majorAccount: '0700-0000-0000-0000',
    prefixes: ['0700%'],
  },
  criticalSubaccounts: [
    { key: 'comisiones', label: 'Comisiones vendedores (0700-0011)', prefix: '0700-0011-%' },
    { key: 'gerentes', label: 'Remuneraciones gerentes (0700-0021)', prefix: '0700-0021-%' },
    { key: 'entrega', label: 'Entrega y gasolina (0700-0013)', prefix: '0700-0013-%' },
    { key: 'publicidad', label: 'Publicidad (0700-0065)', prefix: '0700-0065-%' },
    { key: 'planPiso', label: 'Intereses Plan Piso (0700-0076)', prefix: '0700-0076-%' },
    { key: 'rentas', label: 'Rentas (0700-0080)', prefix: '0700-0080-%' },
  ],
};

const SEGMENT_BY_SUCURSAL = {
  piso: '0001',
  foraneos: '0002',
  cholula: '0004',
  zacatelco: '0005',
  flotillas: '0006',
  casa: '0007',
  suauto: '0008',
  intercambios: '0010',
};

const AREA_INCOME_KEYS = {
  todos: ['autosNuevos', 'seminuevos', 'servicio', 'refacciones', 'hyp', 'financiamiento'],
  autosNuevos: ['autosNuevos'],
  seminuevos: ['seminuevos'],
  servicio: ['servicio'],
  refacciones: ['refacciones'],
  hyp: ['hyp'],
  postventa: ['servicio', 'refacciones', 'hyp'],
};

const AREA_COST_KEYS = {
  todos: ['autosNuevos', 'seminuevos', 'servicio', 'refacciones', 'hyp'],
  autosNuevos: ['autosNuevos'],
  seminuevos: ['seminuevos'],
  servicio: ['servicio'],
  refacciones: ['refacciones'],
  hyp: ['hyp'],
  postventa: ['servicio', 'refacciones', 'hyp'],
};

function resolveCatalogScope(sucursal = 'todos', area = 'todos', includeFi = true) {
  const segment = SEGMENT_BY_SUCURSAL[sucursal] || null;
  let incomeKeys = AREA_INCOME_KEYS[area] || AREA_INCOME_KEYS.todos;
  let costKeys = AREA_COST_KEYS[area] || AREA_COST_KEYS.todos;

  if (!includeFi) incomeKeys = incomeKeys.filter((k) => k !== 'financiamiento');

  const scopeLabel = [
    sucursal !== 'todos' ? sucursal : null,
    area !== 'todos' ? area : null,
  ].filter(Boolean).join(' · ') || 'Consolidado';

  return { sucursal, area, segment, incomeKeys, costKeys, scopeLabel, includeFi };
}

function filterPrefixesBySegment(prefixes, segment) {
  if (!segment) return prefixes;
  return prefixes.map((p) => {
    if (p.startsWith('0400') || p.startsWith('0600') || p.startsWith('0700')) {
      const base = p.replace('%', '');
      return `${base}-${segment}-%`;
    }
    return p;
  });
}

module.exports = {
  INCOME_CATALOG,
  COST_CATALOG,
  EXPENSE_CATALOG,
  SEGMENT_BY_SUCURSAL,
  resolveCatalogScope,
  filterPrefixesBySegment,
};
