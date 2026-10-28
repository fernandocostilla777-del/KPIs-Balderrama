const {
  getRoleOverride,
  resolveHomePath,
  resolveApiPrefixes,
  listPageCatalog,
  listActionCatalog,
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
    apiPrefixes: ['/overview', '/ventas', '/forecast', '/inventory', '/lista-precios', '/crm', '/seguimiento-360', '/objetivos-resultados', '/ai', '/health'],
  },
  vendedor: {
    id: 'vendedor',
    label: 'Vendedor',
    pages: ['sales', 'lista-precios', 'seguimiento'],
    homePath: '/seguimiento.html',
    apiPrefixes: ['/ventas', '/lista-precios', '/crm', '/seguimiento-360', '/objetivos-resultados', '/ai', '/health'],
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
    apiPrefixes: ['/overview', '/ventas', '/crm', '/seguimiento-360', '/objetivos-resultados', '/ai', '/health'],
  },
  gestion_inventario: {
    id: 'gestion_inventario',
    label: 'Gestión de inventario',
    pages: ['overview', 'inventory', 'post-sales', 'lista-precios'],
    homePath: '/inventory.html',
    apiPrefixes: [
      '/overview',
      '/inventory',
      '/post-sales',
      '/lista-precios',
      '/ai',
      '/health',
    ],
  },
  cholula: {
    id: 'cholula',
    label: 'Cholula',
    pages: ['sales', 'inventory', 'lista-precios', 'seguimiento'],
    homePath: '/sales.html',
    alcanceSucursal: 'cholula',
    apiPrefixes: [
      '/ventas',
      '/inventory',
      '/lista-precios',
      '/crm',
      '/seguimiento-360',
      '/objetivos-resultados',
      '/ai',
      '/health',
    ],
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
  inventario: 'gestion_inventario',
  'gestion.inventario': 'gestion_inventario',
  gestion_inventario: 'gestion_inventario',
  'gestor.inventario': 'gestion_inventario',
  cholula: 'cholula',
};

const ALWAYS_API_PREFIXES = [
  '/auth/me',
  '/auth/logout',
  '/auth/alerts',
  '/auth/config',
  '/auth/summary-kpi-prefs',
  '/auth/password-reset',
  '/health',
  '/data-source',
  '/conexion',
  '/ai',
];

function getDefaultRole(roleId) {
  return ROLE_DEFAULTS[roleId] || null;
}

function defaultActionsForRole(roleId) {
  const role = getDefaultRole(roleId);
  if (!role) return {};
  const allActions = listActionCatalog().map((action) => action.id);
  return Object.fromEntries(
    role.pages.map((pageId) => [
      pageId,
      roleId === 'administracion' ? allActions : ['leer'],
    ]),
  );
}

function getRole(roleId) {
  const base = getDefaultRole(roleId);
  if (!base) return null;

  const override = getRoleOverride(roleId);
  const actions = override?.actions && typeof override.actions === 'object'
    ? override.actions
    : defaultActionsForRole(roleId);
  const pages = Array.isArray(override?.pages) && override.pages.length
    ? [...override.pages]
    : Object.keys(actions).filter((pageId) => actions[pageId]?.includes('leer'));

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
    actions,
    alcanceSucursal: base.alcanceSucursal || null,
  };
}

function listRoles() {
  return Object.keys(ROLE_DEFAULTS).map((id) => {
    const role = getRole(id);
    return {
      id: role.id,
      label: role.label,
      pages: role.pages,
      actions: role.actions,
      homePath: role.homePath,
      canManageUsers: role.canManageUsers,
      isCustomized: role.isCustomized,
      alcanceSucursal: role.alcanceSucursal,
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
  const defaultActions = {};
  for (const id of Object.keys(ROLE_DEFAULTS)) {
    defaults[id] = [...ROLE_DEFAULTS[id].pages];
    defaultActions[id] = defaultActionsForRole(id);
  }
  return {
    pages: listPageCatalog(),
    actionCatalog: listActionCatalog(),
    roles: listRoles(),
    defaults,
    defaultActions,
    byRole: Object.fromEntries(
      Object.keys(ROLE_DEFAULTS).map((id) => {
        const role = getRole(id);
        return [id, { pages: role.pages, actions: role.actions }];
      }),
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
