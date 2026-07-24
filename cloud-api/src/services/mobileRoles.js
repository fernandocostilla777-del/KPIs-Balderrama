/**
 * Permisos móviles alineados con el dashboard web.
 * Las tools del asistente se filtran por rol.
 */

const ROLE_SCOPES = {
  administracion: {
    pages: ['dashboard', 'metrics', 'seguimiento', 'assistant', 'profile'],
    metricSections: ['ventas', 'forecast', 'inventory', 'contabilidad', 'post-sales', 'seguimiento'],
    tools: [
      'resumen_ejecutivo',
      'consultar_ventas',
      'consultar_inventario',
      'consultar_postventa',
      'consultar_contabilidad',
      'consultar_pronostico',
      'consultar_seguimiento',
    ],
    label: 'Administración',
  },
  direccion: {
    pages: ['dashboard', 'metrics', 'seguimiento', 'assistant', 'profile'],
    metricSections: ['ventas', 'forecast', 'inventory', 'contabilidad', 'post-sales', 'seguimiento'],
    tools: [
      'resumen_ejecutivo',
      'consultar_ventas',
      'consultar_inventario',
      'consultar_postventa',
      'consultar_contabilidad',
      'consultar_pronostico',
      'consultar_seguimiento',
    ],
    label: 'Dirección',
  },
  gerencia_comercial: {
    pages: ['metrics', 'seguimiento', 'assistant', 'profile'],
    metricSections: ['ventas', 'forecast', 'seguimiento'],
    tools: [
      'consultar_ventas',
      'consultar_pronostico',
      'consultar_seguimiento',
    ],
    label: 'Gerencia comercial',
  },
  contabilidad: {
    pages: ['metrics', 'assistant', 'profile'],
    metricSections: ['contabilidad'],
    tools: ['consultar_contabilidad'],
    label: 'Contabilidad',
  },
};

function getRoleScope(roleId) {
  return ROLE_SCOPES[roleId] || ROLE_SCOPES.direccion;
}

function rolePages(roleId) {
  return [...getRoleScope(roleId).pages];
}

function roleTools(roleId) {
  return [...getRoleScope(roleId).tools];
}

function roleMetricSections(roleId) {
  return [...getRoleScope(roleId).metricSections];
}

function canUseTool(roleId, toolName) {
  return roleTools(roleId).includes(toolName);
}

function canAccessPage(roleId, pageId) {
  return rolePages(roleId).includes(pageId);
}

function canAccessMetricSection(roleId, section) {
  const key = String(section || '').toLowerCase();
  const normalized = key === 'pronostico' ? 'forecast'
    : key === 'inventario' ? 'inventory'
      : key === 'postventa' ? 'post-sales'
        : key === 'crm' ? 'seguimiento'
          : key === 'sales' ? 'ventas'
            : key;
  return roleMetricSections(roleId).includes(normalized);
}

module.exports = {
  ROLE_SCOPES,
  getRoleScope,
  rolePages,
  roleTools,
  roleMetricSections,
  canUseTool,
  canAccessPage,
  canAccessMetricSection,
};
