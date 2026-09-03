const fs = require('fs');
const path = require('path');

const STORE_FILE = path.join(__dirname, '../../data/rolePermissions.json');

/** Catálogo de páginas del dashboard (selección de permisos). */
const PAGE_CATALOG = [
  {
    id: 'overview',
    label: 'Resumen',
    description: 'Tablero ejecutivo general.',
    homePath: '/',
    apiPrefixes: ['/overview'],
  },
  {
    id: 'sales',
    label: 'Ventas',
    description: 'Ventas, financiamiento, CRM y objetivos comerciales.',
    homePath: '/sales.html',
    apiPrefixes: ['/ventas', '/crm', '/objetivos-resultados'],
  },
  {
    id: 'post-sales',
    label: 'PostVenta',
    description: 'Servicio, refacciones e HyP.',
    homePath: '/post-sales.html',
    apiPrefixes: ['/post-sales'],
  },
  {
    id: 'inventory',
    label: 'Inventario',
    description: 'Autos nuevos, cierre de unidades vendidas, seminuevos y postventa.',
    homePath: '/inventory.html',
    apiPrefixes: ['/inventory'],
  },
  {
    id: 'lista-precios',
    label: 'Lista de precios',
    description: 'Catálogo de precios de lista por modelo y versión.',
    homePath: '/lista-precios.html',
    apiPrefixes: ['/lista-precios'],
  },
  {
    id: 'contabilidad',
    label: 'Contabilidad',
    description: 'EEFF y cuentas contables.',
    homePath: '/contabilidad.html',
    apiPrefixes: ['/contabilidad', '/eeff'],
  },
  {
    id: 'forecast',
    label: 'Pronóstico',
    description: 'Pronóstico y proyección.',
    homePath: '/forecast.html',
    apiPrefixes: ['/forecast'],
  },
  {
    id: 'seguimiento',
    label: 'Seguimiento 360',
    description: 'Seguimiento de cliente / unidad.',
    homePath: '/seguimiento.html',
    apiPrefixes: ['/crm'],
  },
  {
    id: 'admin',
    label: 'Administración',
    description: 'Usuarios, roles, alertas y prorrateo.',
    homePath: '/admin.html',
    apiPrefixes: ['/auth'],
  },
];

const PAGE_BY_ID = Object.fromEntries(PAGE_CATALOG.map((p) => [p.id, p]));
const VALID_PAGE_IDS = new Set(PAGE_CATALOG.map((p) => p.id));

const HOME_PRIORITY = [
  'overview', 'sales', 'post-sales', 'inventory', 'lista-precios', 'contabilidad', 'forecast', 'seguimiento', 'admin',
];

function ensureDir() {
  const dir = path.dirname(STORE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readStore() {
  try {
    if (!fs.existsSync(STORE_FILE)) return { byRole: {}, updatedAt: null };
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    return {
      byRole: raw?.byRole && typeof raw.byRole === 'object' ? raw.byRole : {},
      updatedAt: raw?.updatedAt || null,
    };
  } catch {
    return { byRole: {}, updatedAt: null };
  }
}

function writeStore(store) {
  ensureDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function sanitizePages(pages, { forceAdmin = false } = {}) {
  const list = Array.isArray(pages) ? pages : [];
  const next = [];
  const seen = new Set();
  for (const raw of list) {
    const id = String(raw || '').trim();
    if (!VALID_PAGE_IDS.has(id) || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  if (forceAdmin && !seen.has('admin')) next.unshift('admin');
  if (!next.length) {
    throw Object.assign(new Error('Cada rol debe tener al menos una página seleccionada.'), { status: 400 });
  }
  return next;
}

function resolveHomePath(pages) {
  for (const id of HOME_PRIORITY) {
    if (pages.includes(id) && PAGE_BY_ID[id]?.homePath) return PAGE_BY_ID[id].homePath;
  }
  return PAGE_BY_ID[pages[0]]?.homePath || '/';
}

function resolveApiPrefixes(pages) {
  const prefixes = new Set(['/health', '/ai', '/auth/me', '/auth/logout', '/auth/alerts', '/auth/config', '/auth/password-reset']);
  for (const id of pages) {
    for (const p of PAGE_BY_ID[id]?.apiPrefixes || []) prefixes.add(p);
  }
  return [...prefixes];
}

function getOverrides() {
  return readStore().byRole;
}

function getRoleOverride(roleId) {
  const byRole = getOverrides();
  return byRole[roleId] || null;
}

function listPageCatalog() {
  return PAGE_CATALOG.map((p) => ({
    id: p.id,
    label: p.label,
    description: p.description,
  }));
}

/**
 * Guarda permisos por rol: { byRole: { roleId: { pages: string[] } } }
 * roleDefaults: mapa id -> páginas por defecto (para validar roles conocidos).
 */
function updateRolePermissions(byRoleInput, roleDefaults = {}) {
  const knownRoles = Object.keys(roleDefaults);
  if (!knownRoles.length) {
    throw Object.assign(new Error('No hay roles configurados.'), { status: 400 });
  }

  const prev = readStore();
  const nextByRole = { ...prev.byRole };

  for (const roleId of knownRoles) {
    const incoming = byRoleInput?.[roleId];
    if (!incoming) continue;
    const forceAdmin = roleId === 'administracion';
    const pages = sanitizePages(incoming.pages, { forceAdmin });
    nextByRole[roleId] = {
      pages,
      updatedAt: new Date().toISOString(),
    };
  }

  const store = {
    byRole: nextByRole,
    updatedAt: new Date().toISOString(),
  };
  writeStore(store);
  return store;
}

function resetRolePermissions() {
  const store = { byRole: {}, updatedAt: new Date().toISOString() };
  writeStore(store);
  return store;
}

module.exports = {
  PAGE_CATALOG,
  PAGE_BY_ID,
  VALID_PAGE_IDS,
  listPageCatalog,
  getOverrides,
  getRoleOverride,
  resolveHomePath,
  resolveApiPrefixes,
  updateRolePermissions,
  resetRolePermissions,
  readStore,
};
