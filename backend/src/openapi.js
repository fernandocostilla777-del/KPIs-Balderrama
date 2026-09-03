const dateParam = (name, required = true) => ({
  name,
  in: 'query',
  required,
  schema: { type: 'string', format: 'date' },
});

const queryParam = (name, description, schema = { type: 'string' }, required = false) => ({
  name,
  in: 'query',
  required,
  description,
  schema,
});

const pathParam = (name, description) => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { type: 'string' },
});

const jsonBody = (properties, required = []) => ({
  required: true,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties,
        required,
      },
    },
  },
});

const responses = {
  200: { description: 'Operación exitosa' },
  400: { description: 'Parámetros inválidos' },
  401: { description: 'Sesión requerida' },
  403: { description: 'Sin permiso para el recurso' },
  500: { description: 'Error interno' },
};

const secured = (operation) => ({
  security: [{ cookieAuth: [] }],
  responses,
  ...operation,
});

function buildOpenApiSpec({ port = 3000, lanIp = null } = {}) {
  const servers = [
    { url: `http://localhost:${port}`, description: 'Servidor local' },
  ];
  if (lanIp) servers.push({ url: `http://${lanIp}:${port}`, description: 'Servidor LAN' });

  return {
    openapi: '3.0.3',
    info: {
      title: 'BALDERRAMA Dashboard API',
      version: '1.0.0',
      description:
        'API REST del dashboard BALDERRAMA. La autenticación usa la cookie de sesión '
        + 'creada por POST /api/auth/login. Los permisos dependen del rol.',
    },
    servers,
    tags: [
      { name: 'Sistema' },
      { name: 'Autenticación' },
      { name: 'Usuarios' },
      { name: 'Ventas' },
      { name: 'Overview' },
      { name: 'Inventario' },
      { name: 'Postventa' },
      { name: 'Contabilidad' },
      { name: 'Pronóstico' },
      { name: 'Seguimiento 360' },
      { name: 'Google Sheets CRM' },
      { name: 'IA' },
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'balderrama_session',
          description: 'Cookie HttpOnly creada al iniciar sesión.',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            detail: { type: 'string' },
          },
        },
        ChatMessage: {
          type: 'object',
          required: ['role', 'content'],
          properties: {
            role: { type: 'string', enum: ['user', 'assistant'] },
            content: { type: 'string' },
          },
        },
      },
    },
    paths: {
      '/api/health': {
        get: {
          tags: ['Sistema'],
          summary: 'Verificar disponibilidad del backend',
          responses: { 200: { description: 'Backend disponible' } },
        },
      },
      '/api/objetivos-resultados/catalogo': {
        get: {
          tags: ['Objetivos resultados'],
          summary: 'Catálogo de objetivos del formato PDF y cobertura disponible',
          responses: { 200: { description: 'Catálogo y plantilla de metas' } },
        },
      },
      '/api/objetivos-resultados/metas': {
        get: {
          tags: ['Objetivos resultados'],
          summary: 'Plantilla de metas (PDF Agosto 2026)',
          parameters: [dateParam('fechaInicio', false), dateParam('fechaFin', false)],
          responses: { 200: { description: 'Metas de referencia' } },
        },
      },
      '/api/objetivos-resultados': {
        get: secured({
          tags: ['Objetivos resultados'],
          summary: 'Resultados completos en formato de objetivos comerciales',
          parameters: [dateParam('fechaInicio'), dateParam('fechaFin')],
        }),
      },
      '/api/objetivos-resultados/volumen': {
        get: secured({
          tags: ['Objetivos resultados'],
          summary: 'Volumen, facturación, carry-over y fuerza de ventas',
          parameters: [dateParam('fechaInicio'), dateParam('fechaFin')],
        }),
      },
      '/api/objetivos-resultados/lineas': {
        get: secured({
          tags: ['Objetivos resultados'],
          summary: 'Desglose por línea / modelo vs plantilla PDF',
          parameters: [dateParam('fechaInicio'), dateParam('fechaFin')],
        }),
      },
      '/api/objetivos-resultados/financiamiento': {
        get: secured({
          tags: ['Objetivos resultados'],
          summary: 'GMF, OnStar, Essentials (12 / +12 meses), accesorios y PVAs',
          parameters: [dateParam('fechaInicio'), dateParam('fechaFin')],
        }),
      },
      '/api/objetivos-resultados/afluencia': {
        get: secured({
          tags: ['Objetivos resultados'],
          summary: 'Afluencia, leads y proxy BDC',
          parameters: [dateParam('fechaInicio'), dateParam('fechaFin')],
        }),
      },
      '/api/objetivos-resultados/solicitudes': {
        get: secured({
          tags: ['Objetivos resultados'],
          summary: 'Solicitudes de crédito desde Google Sheets (crm_solicitudes), con desglose por Carline (columna M)',
          parameters: [dateParam('fechaInicio'), dateParam('fechaFin')],
        }),
      },
      '/api/objetivos-resultados/diario': {
        get: secured({
          tags: ['Objetivos resultados'],
          summary: 'Serie diaria de facturas DMS',
          parameters: [dateParam('fechaInicio'), dateParam('fechaFin')],
        }),
      },
      '/api/objetivos-resultados/seminuevos': {
        get: secured({
          tags: ['Objetivos resultados'],
          summary: 'Seminuevos · Tomas a cuenta',
          parameters: [dateParam('fechaInicio'), dateParam('fechaFin')],
        }),
      },
      '/api/openapi.json': {
        get: {
          tags: ['Sistema'],
          summary: 'Obtener especificación OpenAPI',
          responses: { 200: { description: 'Especificación OpenAPI 3.0' } },
        },
      },
      '/api/auth/config': {
        get: {
          tags: ['Autenticación'],
          summary: 'Consultar configuración de autenticación y roles',
          responses: { 200: { description: 'Configuración pública' } },
        },
      },
      '/api/auth/login': {
        post: {
          tags: ['Autenticación'],
          summary: 'Iniciar sesión',
          requestBody: jsonBody({
            username: { type: 'string' },
            password: { type: 'string', format: 'password' },
          }, ['username', 'password']),
          responses: {
            200: { description: 'Sesión iniciada; devuelve cookie de sesión' },
            401: { description: 'Credenciales incorrectas' },
          },
        },
      },
      '/api/auth/password-reset/request': {
        post: {
          tags: ['Autenticación'],
          summary: 'Solicitar código para restablecer contraseña',
          requestBody: jsonBody({ username: { type: 'string' } }, ['username']),
          responses: { 200: { description: 'Solicitud aceptada (respuesta genérica)' } },
        },
      },
      '/api/auth/password-reset/confirm': {
        post: {
          tags: ['Autenticación'],
          summary: 'Confirmar código y guardar nueva contraseña',
          requestBody: jsonBody({
            username: { type: 'string' },
            code: { type: 'string' },
            password: { type: 'string', format: 'password' },
          }, ['username', 'code', 'password']),
          responses: {
            200: { description: 'Contraseña actualizada' },
            400: { description: 'Código inválido o contraseña no válida' },
          },
        },
      },
      '/api/auth/logout': {
        post: {
          tags: ['Autenticación'],
          summary: 'Cerrar sesión',
          responses: { 200: { description: 'Sesión cerrada' } },
        },
      },
      '/api/auth/me': {
        get: secured({
          tags: ['Autenticación'],
          summary: 'Consultar usuario y rol de la sesión',
        }),
      },
      '/api/auth/users': {
        get: secured({
          tags: ['Usuarios'],
          summary: 'Listar usuarios (solo Administración)',
        }),
        post: secured({
          tags: ['Usuarios'],
          summary: 'Crear usuario (solo Administración)',
          requestBody: jsonBody({
            username: { type: 'string' },
            password: { type: 'string', format: 'password' },
            role: { type: 'string' },
          }, ['username', 'password', 'role']),
        }),
      },
      '/api/auth/users/{username}': {
        put: secured({
          tags: ['Usuarios'],
          summary: 'Actualizar usuario (solo Administración)',
          parameters: [pathParam('username', 'Nombre de usuario')],
          requestBody: jsonBody({
            password: { type: 'string', format: 'password' },
            role: { type: 'string' },
            active: { type: 'boolean' },
          }),
        }),
        delete: secured({
          tags: ['Usuarios'],
          summary: 'Eliminar usuario (solo Administración)',
          parameters: [pathParam('username', 'Nombre de usuario')],
        }),
      },
      '/api/ventas/objetivos/historico': {
        get: secured({
          tags: ['Ventas'],
          summary: 'Listar catálogo histórico de objetivos',
        }),
      },
      '/api/ventas/objetivos': {
        get: secured({
          tags: ['Ventas'],
          summary: 'Consultar objetivos de ventas del periodo',
          parameters: [dateParam('fechaInicio'), dateParam('fechaFin')],
        }),
        put: secured({
          tags: ['Ventas'],
          summary: 'Guardar objetivos de ventas',
          requestBody: jsonBody({
            fechaInicio: { type: 'string', format: 'date' },
            fechaFin: { type: 'string', format: 'date' },
            retail: { type: 'number' },
            sofia: { type: 'number' },
          }, ['fechaInicio', 'fechaFin']),
        }),
      },
      '/api/ventas': {
        get: secured({
          tags: ['Ventas'],
          summary: 'Consultar ventas del periodo',
          parameters: [dateParam('fechaInicio'), dateParam('fechaFin')],
        }),
      },
      '/api/overview': {
        get: secured({
          tags: ['Overview'],
          summary: 'Consultar resumen ejecutivo',
          parameters: [dateParam('fechaInicio'), dateParam('fechaFin')],
        }),
      },
      '/api/overview/analytics': {
        get: secured({
          tags: ['Overview'],
          summary: 'Consultar analítica de ejecutivos de ventas',
          parameters: [dateParam('fechaInicio'), dateParam('fechaFin')],
        }),
      },
      '/api/inventory': {
        get: secured({
          tags: ['Inventario'],
          summary: 'Consultar inventario',
          parameters: [
            queryParam('planPisoPeriod', 'Periodo de plan piso', { type: 'string', default: 'all' }),
          ],
        }),
      },
      '/api/inventory/vendidos': {
        get: secured({
          tags: ['Inventario'],
          summary: 'Análisis de autos vendidos + IEMC F-2 / brecha F-2.1',
          parameters: [dateParam('fechaInicio'), dateParam('fechaFin')],
        }),
      },
      '/api/inventory/postventa': {
        get: secured({
          tags: ['Inventario'],
          summary: 'Consultar inventario relacionado con postventa',
        }),
      },
      '/api/post-sales': {
        get: secured({
          tags: ['Postventa'],
          summary: 'Consultar indicadores de postventa',
          parameters: [dateParam('fechaInicio'), dateParam('fechaFin')],
        }),
      },
      '/api/contabilidad/ventas-dia': {
        get: secured({
          tags: ['Contabilidad'],
          summary: 'Consultar unidades vendidas de un día',
          parameters: [dateParam('fecha')],
        }),
      },
      '/api/eeff': {
        get: secured({
          tags: ['Contabilidad'],
          summary: 'Consultar resumen de estados financieros',
          parameters: [dateParam('fechaInicio'), dateParam('fechaFin')],
        }),
      },
      '/api/contabilidad': {
        get: secured({
          tags: ['Contabilidad'],
          summary: 'Consultar información contable',
          parameters: [
            dateParam('fechaInicio'),
            dateParam('fechaFin'),
            queryParam('planPisoPeriod', 'Periodo de plan piso'),
            queryParam('sucursal', 'Sucursal'),
            queryParam('area', 'Área'),
            queryParam('includeFi', 'Incluir F&I', { type: 'boolean' }),
          ],
        }),
      },
      '/api/forecast': {
        get: secured({
          tags: ['Pronóstico'],
          summary: 'Consultar pronóstico de ventas',
          parameters: [
            queryParam('horizon', 'Horizonte en meses', { type: 'integer', minimum: 1 }),
          ],
        }),
      },
      '/api/crm/status': {
        get: secured({
          tags: ['Seguimiento 360'],
          summary: 'Consultar estado y estadísticas de la base CRM',
        }),
      },
      '/api/crm/contactos': {
        get: secured({
          tags: ['Seguimiento 360'],
          summary: 'Buscar contactos por ID CRM, nombre, VIN, teléfono o correo',
          parameters: [
            queryParam('q', 'Texto de búsqueda', { type: 'string' }, true),
            queryParam('limit', 'Máximo de resultados', { type: 'integer', default: 50 }),
          ],
        }),
      },
      '/api/crm/contactos/{idContacto}/historico': {
        get: secured({
          tags: ['Seguimiento 360'],
          summary: 'Consultar histórico 360 de un cliente',
          parameters: [
            pathParam('idContacto', 'ID_CONTACTO / ID CRM'),
            queryParam('enrichSql', 'Enriquecer con DMS SQL (1/0)', { type: 'integer', enum: [0, 1], default: 1 }),
            dateParam('fechaInicio', false),
            dateParam('fechaFin', false),
          ],
        }),
      },
      '/api/crm/leads/resumen': {
        get: secured({
          tags: ['Seguimiento 360'],
          summary: 'Consultar resumen agregado de leads',
          parameters: [
            dateParam('desde', false),
            dateParam('hasta', false),
            queryParam('agruparPor', 'Dimensión de agrupación', {
              type: 'string',
              enum: ['canal', 'sucursal', 'tipo', 'campana', 'resultado', 'fuerza_ventas', 'ejecutivo', 'estatus_compra', 'auto_interes', 'mes'],
              default: 'canal',
            }),
            queryParam('limit', 'Máximo de grupos', { type: 'integer', default: 30 }),
          ],
        }),
      },
      '/api/crm/cierres-taller': {
        get: secured({
          tags: ['Seguimiento 360'],
          summary: 'Listar clientes con órdenes de taller cerradas en el periodo',
          parameters: [
            dateParam('fechaInicio'),
            dateParam('fechaFin'),
            queryParam('limit', 'Máximo de clientes', { type: 'integer', default: 300 }),
          ],
        }),
      },
      '/api/crm/sheets-sync/status': {
        get: secured({
          tags: ['Google Sheets CRM'],
          summary: 'Consultar estado de sincronización (9:00, 12:00 y 18:00, hora de México)',
        }),
      },
      '/api/crm/sheets-sync/run': {
        post: secured({
          tags: ['Google Sheets CRM'],
          summary: 'Forzar sincronización de leads, solicitudes y pruebas',
        }),
      },
      '/api/ai/status': {
        get: secured({
          tags: ['IA'],
          summary: 'Consultar configuración del agente de IA',
        }),
      },
      '/api/ai/chat': {
        post: secured({
          tags: ['IA'],
          summary: 'Enviar conversación al agente analítico',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['messages'],
                  properties: {
                    messages: {
                      type: 'array',
                      minItems: 1,
                      maxItems: 20,
                      items: { $ref: '#/components/schemas/ChatMessage' },
                    },
                  },
                },
              },
            },
          },
        }),
      },
    },
  };
}

module.exports = { buildOpenApiSpec };
