const fs = require('fs');
const path = require('path');

const PREFS_FILE = path.join(__dirname, '../../data/summaryKpiPrefs.json');

/**
 * Catálogo de KPIs disponibles para el resumen personalizado.
 * `pageId` filtra por módulos a los que el perfil tiene acceso.
 * `path` resuelve el valor desde el payload de /api/overview.
 */
const SUMMARY_KPI_CATALOG = [
  // Ventas
  {
    id: 'unidades',
    area: 'ventas',
    areaLabel: 'Ventas',
    pageId: 'sales',
    label: 'Unidades vendidas',
    description: 'Total de unidades facturadas en el periodo',
    tone: 'blue',
    kpiId: 'ovUnidades',
    default: true,
  },
  {
    id: 'utilidad_bruta',
    area: 'ventas',
    areaLabel: 'Ventas',
    pageId: 'sales',
    label: 'Utilidad bruta',
    description: 'Utilidad bruta de ventas',
    tone: 'green',
    kpiId: 'ovUtilidadBruta',
    default: true,
  },
  {
    id: 'ingreso_ventas',
    area: 'ventas',
    areaLabel: 'Ventas',
    pageId: 'sales',
    label: 'Ingreso ventas',
    description: 'Venta subtotal sin IVA',
    tone: 'blue',
    default: true,
  },
  {
    id: 'ingreso_consolidado',
    area: 'ventas',
    areaLabel: 'Ventas',
    pageId: 'overview',
    label: 'Ingreso consolidado',
    description: 'Ventas + facturación taller',
    tone: 'violet',
    default: true,
  },
  {
    id: 'margen_bruto_real',
    area: 'ventas',
    areaLabel: 'Ventas',
    pageId: 'sales',
    label: 'Margen bruto real',
    description: 'Margen % sobre unidades con costo',
    tone: 'green',
    default: false,
  },
  {
    id: 'asesores_activos',
    area: 'ventas',
    areaLabel: 'Ventas',
    pageId: 'sales',
    label: 'Asesores activos',
    description: 'Fuerza de ventas con movimiento en el periodo',
    tone: 'blue',
    default: false,
  },
  {
    id: 'alerta_margen',
    area: 'ventas',
    areaLabel: 'Ventas',
    pageId: 'sales',
    label: 'Alerta margen',
    description: 'Asesores alto volumen · bajo margen',
    tone: 'rose',
    default: false,
  },
  {
    id: 'retail_units',
    area: 'ventas',
    areaLabel: 'Ventas',
    pageId: 'sales',
    label: 'Retail',
    description: 'Unidades canal retail',
    tone: 'blue',
    default: false,
  },
  {
    id: 'flotilla_units',
    area: 'ventas',
    areaLabel: 'Ventas',
    pageId: 'sales',
    label: 'Flotilla',
    description: 'Unidades canal flotilla',
    tone: 'violet',
    default: false,
  },

  // Inventario
  {
    id: 'inventario_disponible',
    area: 'inventario',
    areaLabel: 'Inventario',
    pageId: 'inventory',
    label: 'Inventario disponible',
    description: 'Unidades libres y apartadas',
    tone: 'green',
    default: true,
  },
  {
    id: 'sin_previas',
    area: 'inventario',
    areaLabel: 'Inventario',
    pageId: 'inventory',
    label: 'Sin previas (stock)',
    description: 'Unidades en piso sin órdenes previas',
    tone: 'amber',
    kpiId: 'ovStockSinPrevias',
    default: true,
  },
  {
    id: 'plan_piso',
    area: 'inventario',
    areaLabel: 'Inventario',
    pageId: 'inventory',
    label: 'Plan piso',
    description: 'Intereses acumulados de plan piso',
    tone: 'rose',
    kpiId: 'ovPlanPiso',
    default: true,
  },
  {
    id: 'aging_60',
    area: 'inventario',
    areaLabel: 'Inventario',
    pageId: 'inventory',
    label: 'Antigüedad',
    description: 'Alertas de antigüedad en inventario (60+ días)',
    tone: 'rose',
    kpiId: 'ovAging',
    default: true,
  },
  {
    id: 'valor_inventario',
    area: 'inventario',
    areaLabel: 'Inventario',
    pageId: 'inventory',
    label: 'Valor inventario',
    description: 'Valor de unidades disponibles',
    tone: 'amber',
    default: true,
  },
  {
    id: 'dias_inventario',
    area: 'inventario',
    areaLabel: 'Inventario',
    pageId: 'inventory',
    label: 'Días prom. inventario',
    description: 'Antigüedad promedio de disponibles',
    tone: 'blue',
    default: true,
  },
  {
    id: 'demos',
    area: 'inventario',
    areaLabel: 'Inventario',
    pageId: 'inventory',
    label: 'Demos',
    description: 'Unidades demo en piso',
    tone: 'amber',
    default: false,
  },
  {
    id: 'entregas_sin_previas',
    area: 'inventario',
    areaLabel: 'Inventario',
    pageId: 'inventory',
    label: 'Entregas sin previa',
    description: 'Entregas SOFIA sin orden previa en el periodo',
    tone: 'rose',
    default: false,
  },
  {
    id: 'utilidad_neta_cierre',
    area: 'inventario',
    areaLabel: 'Inventario',
    pageId: 'inventory',
    label: 'Utilidad neta · cierre',
    description: 'Utilidad neta de unidades vendidas (cierre)',
    tone: 'green',
    default: false,
  },
  {
    id: 'ingreso_fi_cierre',
    area: 'inventario',
    areaLabel: 'Inventario',
    pageId: 'inventory',
    label: 'Ingresos F&I · cierre',
    description: 'Ingresos de financiamiento en unidades vendidas',
    tone: 'violet',
    default: false,
  },
  {
    id: 'iemc_f2',
    area: 'inventario',
    areaLabel: 'Inventario',
    pageId: 'inventory',
    label: 'IEMC (F-2)',
    description: 'Eficiencia de margen vs mix objetivo',
    tone: 'blue',
    default: false,
  },

  // Postventa / taller
  {
    id: 'ordenes_taller',
    area: 'postventa',
    areaLabel: 'Postventa',
    pageId: 'post-sales',
    label: 'Órdenes taller',
    description: 'Órdenes ingresadas en el periodo',
    tone: 'blue',
    kpiId: 'ovOrdenesTaller',
    default: true,
  },
  {
    id: 'facturacion_taller',
    area: 'postventa',
    areaLabel: 'Postventa',
    pageId: 'post-sales',
    label: 'Facturación taller',
    description: 'Importe facturado de servicio',
    tone: 'violet',
    kpiId: 'ovFacturacionTaller',
    default: true,
  },
  {
    id: 'ticket_taller',
    area: 'postventa',
    areaLabel: 'Postventa',
    pageId: 'post-sales',
    label: 'Ticket taller',
    description: 'Promedio por orden facturada',
    tone: 'violet',
    kpiId: 'ovTicketTaller',
    default: true,
  },
  {
    id: 'mano_obra',
    area: 'postventa',
    areaLabel: 'Postventa',
    pageId: 'post-sales',
    label: 'Mano de obra',
    description: 'Importe de mano de obra facturada',
    tone: 'green',
    kpiId: 'ovManoObra',
    default: true,
  },
  {
    id: 'refacciones',
    area: 'postventa',
    areaLabel: 'Postventa',
    pageId: 'post-sales',
    label: 'Refacciones',
    description: 'Importe de refacciones facturadas',
    tone: 'amber',
    default: false,
  },
  {
    id: 'ordenes_facturadas',
    area: 'postventa',
    areaLabel: 'Postventa',
    pageId: 'post-sales',
    label: 'Órdenes facturadas',
    description: 'Órdenes de taller facturadas',
    tone: 'green',
    default: false,
  },

  // Contabilidad / equilibrio
  {
    id: 'punto_equilibrio',
    area: 'contabilidad',
    areaLabel: 'Contabilidad',
    pageId: 'contabilidad',
    label: 'Punto de equilibrio',
    description: 'PE operativo de la agencia',
    tone: 'blue',
    kpiId: 'kpiCardPuntoEquilibrio',
    default: false,
  },
  {
    id: 'cobertura_equilibrio',
    area: 'contabilidad',
    areaLabel: 'Contabilidad',
    pageId: 'contabilidad',
    label: 'Cobertura PE',
    description: 'Porcentaje de cobertura del punto de equilibrio',
    tone: 'green',
    default: false,
  },
];

const DEFAULT_KPI_IDS = SUMMARY_KPI_CATALOG.filter((k) => k.default).map((k) => k.id);
const SUMMARY_SLOT_COUNT = 8;

/** KPIs fijos del puesto: siempre visibles y no se pueden quitar ni mover. */
const PROFILE_PACKS = {
  administracion: {
    label: 'Administración',
    hint: 'Indicadores obligatorios de tu puesto. No se pueden quitar ni reubicar.',
    ids: ['ingreso_consolidado', 'unidades', 'utilidad_bruta', 'punto_equilibrio'],
  },
  direccion: {
    label: 'Dirección / Gerencia general',
    hint: 'Indicadores obligatorios de dirección. No se pueden quitar ni reubicar.',
    ids: ['ingreso_consolidado', 'unidades', 'utilidad_bruta', 'punto_equilibrio'],
  },
  gerencia_comercial: {
    label: 'Gerencia comercial / Ventas',
    hint: 'Indicadores obligatorios de gerencia de ventas. No se pueden quitar ni reubicar.',
    ids: ['unidades', 'retail_units', 'utilidad_bruta', 'plan_piso'],
  },
  vendedor: {
    label: 'Ventas',
    hint: 'Indicadores obligatorios de tu puesto. No se pueden quitar ni reubicar.',
    ids: ['unidades', 'retail_units', 'utilidad_bruta', 'alerta_margen'],
  },
  contabilidad: {
    label: 'Contabilidad',
    hint: 'Indicadores obligatorios de contabilidad. No se pueden quitar ni reubicar.',
    ids: ['punto_equilibrio', 'cobertura_equilibrio', 'plan_piso', 'aging_60'],
  },
  marketing: {
    label: 'Mercadotecnia (MTK)',
    hint: 'Indicadores obligatorios de marketing. No se pueden quitar ni reubicar.',
    ids: ['unidades', 'retail_units', 'ingreso_ventas', 'asesores_activos'],
  },
};

/** Espacios visuales que ocupa cada tarjeta en la rejilla ejecutiva. */
const SUMMARY_SIZES = [
  { id: 'sm', label: '1 espacio', description: 'Un cuarto de fila', span: 3 },
  { id: 'md', label: '2 espacios', description: 'Media fila', span: 6 },
  { id: 'lg', label: '3 espacios', description: 'Tres cuartos de fila', span: 9 },
  { id: 'xl', label: '4 espacios', description: 'Fila completa', span: 12 },
];
const SUMMARY_SIZE_IDS = SUMMARY_SIZES.map((s) => s.id);
const DEFAULT_SUMMARY_SIZE = 'md';
const SUMMARY_HEIGHTS = [1, 2, 3];
const DEFAULT_SUMMARY_HEIGHT = 1;
const SUMMARY_VIEWS = ['number', 'chart'];
const DEFAULT_SUMMARY_VIEW = 'number';

function readStore() {
  try {
    if (!fs.existsSync(PREFS_FILE)) return { byUser: {} };
    const raw = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8'));
    return {
      byUser: raw?.byUser && typeof raw.byUser === 'object' ? raw.byUser : {},
      updatedAt: raw?.updatedAt || null,
    };
  } catch {
    return { byUser: {} };
  }
}

function writeStore(store) {
  const dir = path.dirname(PREFS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const payload = {
    byUser: store.byUser || {},
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(PREFS_FILE, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function catalogByPages(pages = []) {
  const pageSet = new Set(Array.isArray(pages) ? pages : []);
  return SUMMARY_KPI_CATALOG.filter((kpi) => pageSet.has(kpi.pageId));
}

function lockedIdsForRole(roleId) {
  const pack = PROFILE_PACKS[roleId] || PROFILE_PACKS.direccion;
  return pack.ids.slice();
}

function getCatalogGrouped(pages, { full = false } = {}) {
  const items = full ? SUMMARY_KPI_CATALOG : catalogByPages(pages);
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.area)) {
      groups.set(item.area, {
        area: item.area,
        areaLabel: item.areaLabel,
        pageId: item.pageId,
        items: [],
      });
    }
    groups.get(item.area).items.push({
      id: item.id,
      label: item.label,
      description: item.description,
      tone: item.tone,
      default: !!item.default,
    });
  }
  return {
    catalog: items.map(({ id, area, areaLabel, pageId, label, description, tone, default: isDefault }) => ({
      id, area, areaLabel, pageId, label, description, tone, default: isDefault,
    })),
    groups: [...groups.values()],
    sizeOptions: SUMMARY_SIZES,
  };
}

function getProfileIndicators(roleId) {
  const pack = PROFILE_PACKS[roleId] || PROFILE_PACKS.direccion;
  const items = pack.ids
    .map((id) => SUMMARY_KPI_CATALOG.find((kpi) => kpi.id === id))
    .filter(Boolean)
    .map((kpi) => ({
      id: kpi.id,
      label: kpi.label,
      description: kpi.description,
      tone: kpi.tone,
      area: kpi.area,
      areaLabel: kpi.areaLabel,
      kpiId: kpi.kpiId || null,
      locked: true,
    }));
  return {
    roleId: PROFILE_PACKS[roleId] ? roleId : 'direccion',
    label: pack.label,
    hint: pack.hint,
    items,
  };
}

function sanitizeKpiIds(kpiIds, pages) {
  const allowed = new Set(catalogByPages(pages).map((k) => k.id));
  const input = Array.isArray(kpiIds) ? kpiIds : [];
  const unique = [];
  for (const id of input) {
    const key = String(id || '').trim();
    if (!key || !allowed.has(key) || unique.includes(key)) continue;
    unique.push(key);
  }
  return unique;
}

function sanitizeSlots(slots, pages, roleId = '') {
  const allowed = new Set(SUMMARY_KPI_CATALOG.map((k) => k.id));
  const locked = new Set(lockedIdsForRole(roleId));
  const input = Array.isArray(slots) ? slots : [];
  const used = new Set();
  return Array.from({ length: SUMMARY_SLOT_COUNT }, (_, index) => {
    const key = String(input[index] || '').trim();
    if (!key || !allowed.has(key) || locked.has(key) || used.has(key)) return null;
    used.add(key);
    return key;
  });
}

function sanitizeSizes(sizes) {
  const input = Array.isArray(sizes) ? sizes : [];
  return Array.from({ length: SUMMARY_SLOT_COUNT }, (_, index) => {
    const value = String(input[index] || '').trim().toLowerCase();
    return SUMMARY_SIZE_IDS.includes(value) ? value : DEFAULT_SUMMARY_SIZE;
  });
}

function sanitizeHeights(heights) {
  const input = Array.isArray(heights) ? heights : [];
  return Array.from({ length: SUMMARY_SLOT_COUNT }, (_, index) => {
    const value = Number(input[index]);
    return SUMMARY_HEIGHTS.includes(value) ? value : DEFAULT_SUMMARY_HEIGHT;
  });
}

function sanitizeViews(views) {
  const input = Array.isArray(views) ? views : [];
  return Array.from({ length: SUMMARY_SLOT_COUNT }, (_, index) => {
    const value = String(input[index] || '').trim().toLowerCase();
    return SUMMARY_VIEWS.includes(value) ? value : DEFAULT_SUMMARY_VIEW;
  });
}

function getUserPrefs(username, pages = [], roleId = '') {
  const store = readStore();
  const key = String(username || '').trim().toLowerCase();
  const saved = store.byUser[key];
  if (!saved) {
    return {
      username: key,
      slots: Array(SUMMARY_SLOT_COUNT).fill(null),
      sizes: sanitizeSizes([]),
      heights: sanitizeHeights([]),
      views: sanitizeViews([]),
      kpiIds: [],
      isCustom: false,
      updatedAt: null,
    };
  }
  const legacyIds = sanitizeKpiIds(saved.kpiIds, pages);
  const slots = Array.isArray(saved.slots)
    ? sanitizeSlots(saved.slots, pages, roleId)
    : sanitizeSlots(legacyIds, pages, roleId);
  return {
    username: key,
    slots,
    sizes: sanitizeSizes(saved.sizes),
    heights: sanitizeHeights(saved.heights),
    views: sanitizeViews(saved.views),
    kpiIds: slots.filter(Boolean),
    isCustom: true,
    updatedAt: saved.updatedAt || null,
  };
}

function setUserPrefs(username, slots, pages = [], sizes = null, heights = null, views = null, roleId = '') {
  const key = String(username || '').trim().toLowerCase();
  if (!key) throw new Error('Usuario requerido');
  const cleaned = sanitizeSlots(slots, pages, roleId);
  const store = readStore();
  const previous = store.byUser[key];
  store.byUser[key] = {
    slots: cleaned,
    sizes: sanitizeSizes(sizes ?? previous?.sizes),
    heights: sanitizeHeights(heights ?? previous?.heights),
    views: sanitizeViews(views ?? previous?.views),
    kpiIds: cleaned.filter(Boolean),
    updatedAt: new Date().toISOString(),
  };
  writeStore(store);
  return getUserPrefs(key, pages, roleId);
}

function resetUserPrefs(username) {
  const key = String(username || '').trim().toLowerCase();
  const store = readStore();
  if (store.byUser[key]) {
    delete store.byUser[key];
    writeStore(store);
  }
  return true;
}

module.exports = {
  SUMMARY_KPI_CATALOG,
  DEFAULT_KPI_IDS,
  SUMMARY_SLOT_COUNT,
  SUMMARY_SIZES,
  getCatalogGrouped,
  getProfileIndicators,
  catalogByPages,
  getUserPrefs,
  setUserPrefs,
  resetUserPrefs,
};
