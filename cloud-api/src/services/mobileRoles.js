/**
 * Permisos móviles alineados con el dashboard web.
 * Las tools del asistente usan los mismos nombres que en web.
 */

const ROLE_SCOPES = {
  administracion: {
    pages: ['dashboard', 'metrics', 'seguimiento', 'assistant', 'profile'],
    metricSections: ['ventas', 'forecast', 'inventory', 'contabilidad', 'post-sales', 'seguimiento'],
    tools: [
      'consultar_resumen_ejecutivo',
      'consultar_ventas',
      'consultar_inventario',
      'consultar_postventa',
      'consultar_contabilidad',
      'consultar_pronostico',
      'resumen_seguimiento_360',
    ],
    label: 'Administración',
  },
  direccion: {
    pages: ['dashboard', 'metrics', 'seguimiento', 'assistant', 'profile'],
    metricSections: ['ventas', 'forecast', 'inventory', 'contabilidad', 'post-sales', 'seguimiento'],
    tools: [
      'consultar_resumen_ejecutivo',
      'consultar_ventas',
      'consultar_inventario',
      'consultar_postventa',
      'consultar_contabilidad',
      'consultar_pronostico',
      'resumen_seguimiento_360',
    ],
    label: 'Dirección',
  },
  gerencia_comercial: {
    pages: ['metrics', 'seguimiento', 'assistant', 'profile'],
    metricSections: ['ventas', 'forecast', 'seguimiento'],
    tools: [
      'consultar_ventas',
      'consultar_pronostico',
      'resumen_seguimiento_360',
    ],
    label: 'Gerencia comercial',
  },
  vendedor: {
    pages: ['metrics', 'seguimiento', 'assistant', 'profile'],
    metricSections: ['ventas', 'seguimiento'],
    tools: [
      'consultar_ventas',
      'resumen_seguimiento_360',
    ],
    label: 'Vendedor',
  },
  contabilidad: {
    pages: ['metrics', 'assistant', 'profile'],
    metricSections: ['contabilidad'],
    tools: ['consultar_contabilidad'],
    label: 'Contabilidad',
  },
  marketing: {
    pages: ['metrics', 'seguimiento', 'assistant', 'profile'],
    metricSections: ['ventas', 'seguimiento'],
    tools: [
      'consultar_ventas',
      'resumen_seguimiento_360',
    ],
    label: 'Mercadotecnia (MTK)',
  },
};

const METRIC_SECTION_ALIASES = {
  ventas: 'ventas',
  sales: 'ventas',
  forecast: 'forecast',
  pronostico: 'forecast',
  inventory: 'inventory',
  inventario: 'inventory',
  contabilidad: 'contabilidad',
  'post-sales': 'post-sales',
  postventa: 'post-sales',
  seguimiento: 'seguimiento',
  crm: 'seguimiento',
};

const ALLOWED_METRIC_SECTIONS = new Set(Object.keys(METRIC_SECTION_ALIASES));

function normalizeMetricSection(section) {
  const key = String(section || '').toLowerCase().trim();
  return METRIC_SECTION_ALIASES[key] || null;
}

function getRoleScope(roleId) {
  return ROLE_SCOPES[roleId] || {
    pages: ['profile'],
    metricSections: [],
    tools: [],
    label: 'Sin rol',
  };
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
  const normalized = normalizeMetricSection(section);
  if (!normalized) return false;
  return roleMetricSections(roleId).includes(normalized);
}

module.exports = {
  ROLE_SCOPES,
  ALLOWED_METRIC_SECTIONS,
  normalizeMetricSection,
  getRoleScope,
  rolePages,
  roleTools,
  roleMetricSections,
  canUseTool,
  canAccessPage,
  canAccessMetricSection,
};
