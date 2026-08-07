/**
 * Acceso del asistente IA según el perfil (rol) del usuario.
 * Solo puede usar herramientas / temas de las páginas que su rol permite.
 */
const { getRole } = require('../auth/roles');
const { isAuthEnabled } = require('../auth/session');
const { buildPlaybookPromptBlock } = require('../config/aiProfilePlaybooks');
const { buildUserMemoryPromptBlock } = require('./aiUserMemory');

/** Herramientas exploratorias: solo perfiles con acceso amplio. */
const SQL_TOOLS = new Set(['listar_tablas_bd', 'ejecutar_consulta_sql']);

/** Memoria de perfil: disponible para cualquier sesión con asistente. */
const PROFILE_MEMORY_TOOLS = new Set([
  'consultar_memoria_perfil',
  'actualizar_memoria_usuario',
]);

/**
 * Mapa página del dashboard → herramientas IA permitidas.
 * Un usuario obtiene la unión de herramientas de todas sus páginas.
 */
const PAGE_AI_TOOLS = {
  overview: [
    'consultar_resumen_ejecutivo',
    'consultar_analytics_ventas',
    'consultar_ventas_dia',
    'consultar_riesgos_oportunidades',
    'consultar_recomendaciones_directivas',
    'consultar_objetivos_ventas',
  ],
  sales: [
    'consultar_ventas',
    'consultar_ventas_modelo',
    'consultar_ventas_por_auto',
    'consultar_ventas_dia',
    'consultar_analytics_ventas',
    'consultar_objetivos_ventas',
    'consultar_financiamiento',
    'consultar_utilidad_carline',
    'consultar_lista_precios',
    'resumen_leads',
    'consultar_riesgos_oportunidades',
    'consultar_recomendaciones_directivas',
    'generar_excel',
  ],
  forecast: [
    'consultar_pronostico',
    'consultar_objetivos_ventas',
    'consultar_ventas',
    'consultar_riesgos_oportunidades',
    'consultar_recomendaciones_directivas',
  ],
  inventory: [
    'consultar_inventario',
    'consultar_inventario_postventa',
    'consultar_riesgos_oportunidades',
  ],
  contabilidad: [
    'consultar_contabilidad',
    'consultar_riesgos_oportunidades',
  ],
  'post-sales': [
    'consultar_postventa',
    'consultar_quejas_csi',
    'consultar_inventario_postventa',
    'consultar_refacciones',
    'consultar_riesgos_oportunidades',
    'generar_excel',
  ],
  'lista-precios': [
    'consultar_lista_precios',
    'consultar_inventario',
  ],
  seguimiento: [
    'buscar_cliente_crm',
    'historico_cliente_crm',
    'resumen_leads',
    'resumen_seguimiento_360',
    'listar_vendedores_360',
    'resumen_vendedor_360',
    'consultar_quejas_csi',
    'consultar_financiamiento',
    'consultar_riesgos_oportunidades',
    'consultar_recomendaciones_directivas',
    'generar_excel',
  ],
  admin: [
    'consultar_roles_acceso',
    'consultar_lista_precios',
  ],
};

const PAGE_LABELS = {
  overview: 'Resumen ejecutivo',
  sales: 'Ventas / F&I / utilidad',
  forecast: 'Pronóstico',
  inventory: 'Inventario',
  'lista-precios': 'Lista de precios',
  contabilidad: 'Contabilidad / EEFF',
  'post-sales': 'PostVenta / taller',
  seguimiento: 'Seguimiento 360 / CRM / leads',
  admin: 'Administración',
};

function roleHasFullAccess(role) {
  if (!role) return false;
  if (role.canManageUsers) return true;
  const prefixes = role.apiPrefixes || [];
  return prefixes.includes('*');
}

/**
 * @param {string|null} roleId
 * @returns {{ allowedTools: Set<string>|null, pages: string[], roleLabel: string, fullAccess: boolean }}
 */
function resolveAiAccess(roleId) {
  if (!isAuthEnabled()) {
    return {
      allowedTools: null, // null = todas
      pages: ['*'],
      roleLabel: 'Desarrollo (auth desactivada)',
      fullAccess: true,
    };
  }

  const role = getRole(roleId);
  if (!role) {
    return {
      allowedTools: new Set([...PROFILE_MEMORY_TOOLS]),
      pages: [],
      roleLabel: 'Sin perfil',
      fullAccess: false,
    };
  }

  if (roleHasFullAccess(role)) {
    return {
      allowedTools: null,
      pages: role.pages || [],
      roleLabel: role.label || roleId,
      fullAccess: true,
    };
  }

  const allowed = new Set([...PROFILE_MEMORY_TOOLS]);
  for (const pageId of role.pages || []) {
    for (const tool of PAGE_AI_TOOLS[pageId] || []) {
      allowed.add(tool);
    }
  }

  return {
    allowedTools: allowed,
    pages: role.pages || [],
    roleLabel: role.label || roleId,
    fullAccess: false,
  };
}

function filterToolDefinitions(toolDefinitions, roleId) {
  const access = resolveAiAccess(roleId);
  if (access.allowedTools == null) return toolDefinitions;
  return (toolDefinitions || []).filter((def) => {
    const name = def?.function?.name;
    return name && access.allowedTools.has(name);
  });
}

function isToolAllowedForRole(roleId, toolName) {
  const access = resolveAiAccess(roleId);
  if (access.allowedTools == null) return true;
  if (SQL_TOOLS.has(toolName)) return false;
  if (PROFILE_MEMORY_TOOLS.has(toolName)) return true;
  return access.allowedTools.has(toolName);
}

function buildRoleScopeNote(roleId, username = null) {
  const access = resolveAiAccess(roleId);
  const who = username ? `Usuario: ${username}. ` : '';

  if (access.fullAccess) {
    return `${who}Perfil: ${access.roleLabel}. Acceso completo al asistente (todas las áreas permitidas).`;
  }

  const areas = (access.pages || [])
    .map((p) => PAGE_LABELS[p] || p)
    .filter(Boolean);

  const dataTools = [...(access.allowedTools || [])].filter((t) => !PROFILE_MEMORY_TOOLS.has(t));
  if (!areas.length || !dataTools.length) {
    return [
      `${who}Perfil: ${access.roleLabel}.`,
      'NO tienes módulos de datos asignados para el asistente.',
      'Si preguntan por ventas, inventario, contabilidad, postventa u otra área: responde que tu perfil no tiene acceso y sugiere contactar a Administración.',
      'No inventes cifras ni uses herramientas fuera de tu alcance.',
    ].join(' ');
  }

  return [
    `${who}Perfil: ${access.roleLabel}.`,
    `Solo puedes consultar y responder sobre: ${areas.join('; ')}.`,
    'Si el usuario pregunta por un área fuera de tu perfil (ej. contabilidad sin permiso, inventario sin permiso, etc.):',
    '1) Declara claramente que tu perfil no tiene acceso a esa información.',
    '2) No inventes datos ni intentes consultar herramientas no disponibles.',
    '3) Ofrece ayuda solo con los temas de tu perfil.',
    'Nunca reveles datos de módulos ajenos ni uses SQL exploratorio.',
  ].join(' ');
}

/**
 * Bloque de memoria + playbook para razonar enfocado al perfil.
 */
function buildProfileMemoryNote(roleId, username = null) {
  return [
    '## Memoria y conocimiento del perfil (obligatorio)',
    'Usa este bloque para interpretar la pregunta y decidir qué consultar.',
    'En ### Razonamiento menciona brevemente el lente del perfil (ej. “como Gerencia Comercial priorizo ritmo vs meta”).',
    buildPlaybookPromptBlock(roleId),
    '',
    buildUserMemoryPromptBlock(username),
    '',
    'Si el usuario declara preferencias nuevas (periodo default, sucursal, fuerza, formato de respuesta, métrica favorita),',
    'llama actualizar_memoria_usuario para recordarlas en sesiones futuras.',
  ].join('\n');
}

module.exports = {
  PAGE_AI_TOOLS,
  PROFILE_MEMORY_TOOLS,
  resolveAiAccess,
  filterToolDefinitions,
  isToolAllowedForRole,
  buildRoleScopeNote,
  buildProfileMemoryNote,
};
