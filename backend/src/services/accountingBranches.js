const SUCURSALES = [
  { id: 'todos', label: 'Consolidado', segment: null },
  { id: 'piso', label: 'Piso / Casa', segment: '0001' },
  { id: 'foraneos', label: 'Foráneos', segment: '0002' },
  { id: 'cholula', label: 'Cholula', segment: '0004' },
  { id: 'zacatelco', label: 'Zacatelco', segment: '0005' },
  { id: 'flotillas', label: 'Flotillas', segment: '0006' },
  { id: 'casa', label: 'Casa', segment: '0007' },
  { id: 'suauto', label: 'Su Auto', segment: '0008' },
  { id: 'intercambios', label: 'Intercambios', segment: '0010' },
];

const AREAS = [
  { id: 'todos', label: 'Todas las áreas' },
  { id: 'autosNuevos', label: 'Autos nuevos' },
  { id: 'seminuevos', label: 'Seminuevos' },
  { id: 'servicio', label: 'Servicio' },
  { id: 'refacciones', label: 'Refacciones' },
  { id: 'hyp', label: 'Hojalatería y pintura' },
  { id: 'postventa', label: 'Postventa (serv.+ref.+HYP)' },
];

const INCOME_DEFAULT = {
  autosNuevos: { label: 'Ventas autos nuevos', prefixes: ['0400'] },
  seminuevos: { label: 'Ventas seminuevos', exact: ['0446-0001', '0450-0001'] },
  servicio: { label: 'Ventas servicio', prefixes: ['0460', '0462', '0463', '0464', '0466', '0469'] },
  refacciones: {
    label: 'Ventas refacciones',
    prefixes: ['0467', '0477', '0480', '0481', '0482', '0483', '0484', '0490', '0491'],
  },
  hyp: { label: 'Ventas hojalatería y pintura', prefixes: ['0470', '0476', '0479'] },
  financiamiento: { label: 'Ingresos F&I (financiamiento y seguros)', prefixes: ['0800'] },
};

const COST_DEFAULT = {
  autosNuevos: { label: 'Costo autos nuevos', prefixes: ['0600'] },
  seminuevos: { label: 'Costo seminuevos', prefixes: ['0620', '0646-0001', '0650-0001'] },
  servicio: { label: 'Costo servicio', prefixes: ['0660', '0662', '0663', '0664', '0666'] },
  refacciones: {
    label: 'Costo refacciones',
    prefixes: ['0667', '0677', '0680', '0681', '0682', '0683', '0684', '0690', '0691'],
  },
  hyp: { label: 'Costo hojalatería y pintura', prefixes: ['0670', '0676', '0679'] },
  financiamiento: { label: 'Costo F&I', prefixes: [] },
};

const POSTVENTA_AREAS = ['servicio', 'refacciones', 'hyp'];

function findSucursal(id) {
  return SUCURSALES.find((s) => s.id === id) || SUCURSALES[0];
}

function findArea(id) {
  return AREAS.find((a) => a.id === id) || AREAS[0];
}

function branchPrefix(base, segment) {
  if (!segment) return [`${base}%`];
  return [`${base}-${segment}-%`];
}

function branchExpensePatterns(segment) {
  if (!segment) return ['0700-%'];
  return [`0700-%-${segment}-%`];
}

function branchBalancePatterns(segment) {
  if (!segment) return [];
  return [
    `0205-${segment}-%`,
    `0220-${segment}-%`,
    `0225-${segment}-%`,
  ];
}

function areasToInclude(areaId, sucursalId = 'todos') {
  if (areaId === 'todos' && sucursalId !== 'todos') return ['autosNuevos'];
  if (areaId === 'todos') return Object.keys(INCOME_DEFAULT);
  if (areaId === 'postventa') return POSTVENTA_AREAS;
  if (INCOME_DEFAULT[areaId]) return [areaId];
  return Object.keys(INCOME_DEFAULT);
}

function resolveScope(sucursalId = 'todos', areaId = 'todos') {
  const sucursal = findSucursal(sucursalId);
  const area = findArea(areaId);
  const segment = sucursal.segment;
  const includeAreas = areasToInclude(area.id, sucursal.id);
  const isConsolidated = sucursal.id === 'todos' && area.id === 'todos';

  const incomeLines = {};
  const costLines = {};

  for (const key of includeAreas) {
    const inc = INCOME_DEFAULT[key];
    const cost = COST_DEFAULT[key];

    if (key === 'autosNuevos' && segment) {
      incomeLines[key] = { label: inc.label, prefixes: branchPrefix('0400', segment) };
      costLines[key] = { label: cost.label, prefixes: branchPrefix('0600', segment) };
    } else if (key === 'servicio' && segment) {
      incomeLines[key] = {
        label: `${inc.label} · ${sucursal.label}`,
        prefixes: inc.prefixes.map((p) => `${p}-${segment}-%`),
      };
      costLines[key] = { label: cost.label, prefixes: cost.prefixes || [], exact: cost.exact || [] };
    } else {
      incomeLines[key] = { label: inc.label, prefixes: inc.prefixes || [], exact: inc.exact || [] };
      costLines[key] = { label: cost.label, prefixes: cost.prefixes || [], exact: cost.exact || [] };
    }
  }

  let expenseDef = { prefixes: branchExpensePatterns(segment) };

  const scopeLabel = [
    sucursal.id === 'todos' ? null : sucursal.label,
    area.id === 'todos' ? null : area.label,
  ].filter(Boolean).join(' · ') || 'Consolidado';

  return {
    sucursal: sucursal.id,
    area: area.id,
    segment,
    isConsolidated,
    balanceConsolidated: sucursal.id === 'todos',
    scopeLabel,
    incomeLines,
    costLines,
    expenseDef,
    balancePatterns: segment ? branchBalancePatterns(segment) : null,
  };
}

module.exports = {
  SUCURSALES,
  AREAS,
  resolveScope,
  findSucursal,
  findArea,
};
