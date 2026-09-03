const {
  getRoleOverride,
  resolveHomePath,
  resolveApiPrefixes,
  listPageCatalog,
  getOverrides,
  updateRolePermissions,
  resetRolePermissions,
  readStore,
} = require('./rolePermissionsStore');

const ROLE_DEFAULTS = {
  administracion: {
    id: 'administracion',
    label: 'Administración',
    pages: ['admin', 'overview', 'sales', 'forecast', 'inventory', 'lista-precios', 'contabilidad', 'post-sales', 'seguimiento'],
    homePath: '/',
    canManageUsers: true,
    apiPrefixes: ['*'],
  },
  direccion: {
    id: 'direccion',
    label: 'Dirección',
    pages: ['overview', 'sales', 'forecast', 'inventory', 'lista-precios', 'contabilidad', 'post-sales', 'seguimiento'],
    homePath: '/',
    apiPrefixes: ['*'],
  },
  gerencia_comercial: {
    id: 'gerencia_comercial',
    label: 'Gerencia Comercial',
    pages: ['overview', 'sales', 'forecast', 'inventory', 'lista-precios', 'seguimiento'],
    homePath: '/',
    apiPrefixes: ['/overview', '/ventas', '/forecast', '/inventory', '/lista-precios', '/crm', '/objetivos-resultados', '/ai', '/health'],
  },
  vendedor: {
    id: 'vendedor',
    label: 'Vendedor',
    pages: ['sales', 'lista-precios', 'seguimiento'],
    homePath: '/seguimiento.html',
    apiPrefixes: ['/ventas', '/lista-precios', '/crm', '/objetivos-resultados', '/ai', '/health'],
  },
  contabilidad: {
    id: 'contabilidad',
    label: 'Contabilidad',
    pages: ['overview', 'inventory', 'contabilidad'],
    homePath: '/contabilidad.html',
    apiPrefixes: ['/overview', '/inventory', '/contabilidad', '/eeff', '/ai', '/health'],
  },
  marketing: {
    id: 'marketing',
    label: 'Mercadotecnia (MTK)',
    pages: ['overview', 'sales', 'seguimiento'],
    homePath: '/',
    apiPrefixes: ['/overview', '/ventas', '/crm', '/objetivos-resultados', '/ai', '/health'],
  },
};

/** @deprecated use ROLE_DEFAULTS — kept for compatibility with require('./roles').ROLES */
const ROLES = ROLE_DEFAULTS;

const USERNAME_TO_ROLE = {
  admin: 'administracion',
  administracion: 'administracion',
  direccion: 'direccion',
  'gerente.general': 'direccion',
  gerencia: 'gerencia_comercial',
  comercial: 'gerencia_comercial',
  vendedor: 'vendedor',
  ventas: 'vendedor',
  contabilidad: 'contabilidad',
  contraloria: 'contabilidad',
  mtk: 'marketing',
  marketing: 'marketing',
  mercadotecnia: 'marketing',
};

const ALWAYS_API_PREFIXES = [
  '/auth/me',
  '/auth/logout',
  '/auth/alerts',
  '/auth/config',
  '/auth/summary-kpi-prefs',
  '/auth/password-reset',
  '/health',
  '/ai',
];

function getDefaultRole(roleId) {
  return ROLE_DEFAULTS[roleId] || null;
}

function getRole(roleId) {
  const base = getDefaultRole(roleId);
  if (!base) return null;

  const override = getRoleOverride(roleId);
  const pages = Array.isArray(override?.pages) && override.pages.length
    ? [...override.pages]
    : [...base.pages];

  // Administración siempre gestiona usuarios y conserva página admin
  if (base.canManageUsers && !pages.includes('admin')) {
    pages.unshift('admin');
  }

  let apiPrefixes;
  if (base.canManageUsers) {
    apiPrefixes = ['*'];
  } else if (!override?.pages && (base.apiPrefixes || []).includes('*')) {
    apiPrefixes = ['*'];
  } else if (!override?.pages) {
    apiPrefixes = [...(base.apiPrefixes || [])];
  } else {
    apiPrefixes = resolveApiPrefixes(pages);
  }

  return {
    id: base.id,
    label: base.label,
    pages,
    homePath: resolveHomePath(pages) || base.homePath,
    canManageUsers: !!base.canManageUsers,
    apiPrefixes,
    isCustomized: Boolean(override?.pages),
  };
}

function listRoles() {
  return Object.keys(ROLE_DEFAULTS).map((id) => {
    const role = getRole(id);
    return {
      id: role.id,
      label: role.label,
      pages: role.pages,
      homePath: role.homePath,
      canManageUsers: role.canManageUsers,
      isCustomized: role.isCustomized,
    };
  });
}

function canAccessPage(roleId, pageId) {
  const role = getRole(roleId);
  if (!role) return false;
  return role.pages.includes(pageId);
}

function getApiPath(originalUrl) {
  const path = (originalUrl || '').split('?')[0];
  return path.replace(/^\/api/, '') || '/';
}

function canAccessApi(roleId, originalUrl) {
  const role = getRole(roleId);
  if (!role) return false;
  const apiPath = getApiPath(originalUrl);
  if (ALWAYS_API_PREFIXES.some((p) => apiPath === p || apiPath.startsWith(`${p}/`))) {
    return true;
  }
  const prefixes = role.apiPrefixes || [];
  if (prefixes.includes('*')) return true;
  return prefixes.some((prefix) => apiPath === prefix || apiPath.startsWith(`${prefix}/`));
}

function resolveRoleFromUsername(username) {
  const key = String(username || '').trim().toLowerCase();
  return USERNAME_TO_ROLE[key] || null;
}

function canManageUsers(roleId) {
  return !!getRole(roleId)?.canManageUsers;
}

function getRolePermissionsPayload() {
  const store = readStore();
  const defaults = {};
  for (const id of Object.keys(ROLE_DEFAULTS)) {
    defaults[id] = [...ROLE_DEFAULTS[id].pages];
  }
  return {
    pages: listPageCatalog(),
    roles: listRoles(),
    defaults,
    byRole: Object.fromEntries(
      Object.keys(ROLE_DEFAULTS).map((id) => [id, { pages: getRole(id).pages }]),
    ),
    updatedAt: store.updatedAt,
  };
}

function saveRolePermissions(byRole) {
  const defaults = {};
  for (const id of Object.keys(ROLE_DEFAULTS)) {
    defaults[id] = ROLE_DEFAULTS[id].pages;
  }
  updateRolePermissions(byRole, defaults);
  return getRolePermissionsPayload();
}

function restoreDefaultRolePermissions() {
  resetRolePermissions();
  return getRolePermissionsPayload();
}

module.exports = {
  ROLES,
  ROLE_DEFAULTS,
  USERNAME_TO_ROLE,
  getRole,
  listRoles,
  canAccessPage,
  canAccessApi,
  getApiPath,
  resolveRoleFromUsername,
  canManageUsers,
  getRolePermissionsPayload,
  saveRolePermissions,
  restoreDefaultRolePermissions,
  getOverrides,
};
