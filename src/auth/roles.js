const ROLES = {
  administracion: {
    id: 'administracion',
    label: 'Administración',
    pages: ['admin', 'overview', 'sales', 'forecast', 'inventory', 'contabilidad', 'post-sales', 'assistant'],
    homePath: '/',
    canManageUsers: true,
  },
  direccion: {
    id: 'direccion',
    label: 'Dirección',
    pages: ['overview', 'sales', 'forecast', 'inventory', 'contabilidad', 'post-sales', 'assistant'],
    homePath: '/',
  },
  gerencia_comercial: {
    id: 'gerencia_comercial',
    label: 'Gerencia Comercial',
    pages: ['sales', 'forecast'],
    homePath: '/sales.html',
  },
  contabilidad: {
    id: 'contabilidad',
    label: 'Contabilidad',
    pages: ['contabilidad'],
    homePath: '/contabilidad.html',
  },
};

const USERNAME_TO_ROLE = {
  admin: 'administracion',
  administracion: 'administracion',
  direccion: 'direccion',
  gerencia: 'gerencia_comercial',
  contabilidad: 'contabilidad',
};

const API_PREFIXES_BY_ROLE = {
  administracion: ['*'],
  direccion: ['*'],
  gerencia_comercial: ['/ventas', '/forecast', '/health'],
  contabilidad: ['/contabilidad', '/health'],
};

function getRole(roleId) {
  return ROLES[roleId] || null;
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
  const prefixes = API_PREFIXES_BY_ROLE[roleId] || [];
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

module.exports = {
  ROLES,
  USERNAME_TO_ROLE,
  getRole,
  canAccessPage,
  canAccessApi,
  getApiPath,
  resolveRoleFromUsername,
  canManageUsers,
};
