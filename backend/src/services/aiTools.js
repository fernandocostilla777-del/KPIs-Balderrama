const { query } = require('../db');
const { getVentas } = require('./ventas');
const { getOverview } = require('./overviewService');
const { loadSalesExecutiveAnalytics } = require('./salesExecutiveAnalytics');
const { getInventory } = require('./inventoryService');
const { getPostSales } = require('./postSalesService');
const { getContabilidad } = require('./contabilidadService');
const { getForecast } = require('./forecastService');
const { getGoals } = require('./salesGoals');
const { loadDailySalesUnits } = require('./ventasNuevosFinanciero');
const { getVentasPorModelo } = require('./aiVentasModeloService');
const crmCiclos = require('./crmCiclosService');
const { getVentasPorAuto } = require('./ventasPorAuto');
const { generateExcelExport } = require('./aiExcelExport');
const { nomenclaturaHelpText } = require('./postSalesOrderTypes');
const { getFinanciamientoAiAnalysis } = require('./financiamientoService');
const { getUtilidadPorCarlineAiAnalysis } = require('./utilidadCarlineService');
const { buildInsights } = require('./intelligentInsightsService');
const { getExecutiveRecommendations } = require('./executiveRecommendationsService');
const { buildOperationalAlerts, getPrefs, listAlertTypes } = require('./alertsService');
const { getInventoryPostventa } = require('./inventoryPostventaService');
const { getRefaccionesDashboard } = require('./refaccionesPedidosService');
const { getRole, listRoles } = require('../auth/roles');
const { getProfilePlaybook } = require('../config/aiProfilePlaybooks');
const { getListaPreciosFicha } = require('./listaPreciosService');
const { getActivePlansMeta } = require('./planesChevroletParser');
const {
  getUserMemory,
  rememberFact,
  rememberPreference,
  clearUserMemory,
} = require('./aiUserMemory');
const { resolveAiAccess } = require('./aiRoleAccess');

const FORBIDDEN_SQL = [
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'TRUNCATE', 'ALTER', 'CREATE',
  'EXEC', 'EXECUTE', 'MERGE', 'GRANT', 'REVOKE', 'INTO ', 'XP_', 'SP_',
  'OPENROWSET', 'OPENDATASOURCE', 'BULK', 'SHUTDOWN',
];

function trimForAi(value, depth = 0) {
  if (value == null || depth > 6) return value;
  if (Array.isArray(value)) {
    if (value.length > 25) {
      return {
        _truncated: true,
        total: value.length,
        items: value.slice(0, 25).map((item) => trimForAi(item, depth + 1)),
      };
    }
    return value.map((item) => trimForAi(item, depth + 1));
  }
  if (typeof value !== 'object') return value;

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (['registros', 'registrosEntrega', 'rows', 'detalle'].includes(key) && Array.isArray(val)) {
      out[key] = {
        total: val.length,
        muestra: trimForAi(val.slice(0, 8), depth + 1),
      };
      continue;
    }
    out[key] = trimForAi(val, depth + 1);
  }
  return out;
}

function validateReadOnlySql(sqlText) {
  const normalized = String(sqlText || '').trim();
  if (!normalized) throw new Error('La consulta SQL está vacía.');
  const upper = normalized.toUpperCase().replace(/\s+/g, ' ');

  for (const word of FORBIDDEN_SQL) {
    if (upper.includes(word)) {
      throw new Error(`Operación no permitida en consultas del asistente: ${word.trim()}`);
    }
  }

  if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) {
    throw new Error('Solo se permiten consultas SELECT de solo lectura.');
  }

  const withoutTrailing = normalized.replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) {
    throw new Error('No se permiten múltiples sentencias SQL.');
  }

  return withoutTrailing;
}

function ensureTopLimit(sqlText, limit = 200) {
  const upper = sqlText.toUpperCase();
  if (/\bTOP\s+\d+\b/.test(upper)) return sqlText;
  return sqlText.replace(/^\s*SELECT\b/i, `SELECT TOP ${limit}`);
}

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'consultar_ventas_modelo',
      description:
        'Cuenta unidades vendidas de un modelo/carline (Aveo, Onix, Tahoe…) o del segmento HIGH END '
        + '(canal de lujo: Suburban, Tahoe, Cheyenne, Traverse). Para HIGH END usa modelo="HIGH END". '
        + 'Relaciona ADE_VTAFI + SER_VEHICULO. Usar cuando pregunten cuántos se vendieron de un modelo o del lujo.',
      parameters: {
        type: 'object',
        properties: {
          modelo: {
            type: 'string',
            description: 'Modelo/carline (Aveo, ONIX…) o exactamente "HIGH END" para el segmento de lujo',
          },
          fechaInicio: { type: 'string', description: 'Fecha inicio YYYY-MM-DD' },
          fechaFin: { type: 'string', description: 'Fecha fin YYYY-MM-DD' },
          incluirFlotilla: { type: 'boolean', description: 'Incluir ventas flotilla (default true)' },
        },
        required: ['modelo', 'fechaInicio', 'fechaFin'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_ventas',
      description: 'Consulta ventas de autos nuevos: totales, retail vs flotilla, canales, vendedores, modelos, comparativo YTD y cobertura SOFIA.',
      parameters: {
        type: 'object',
        properties: {
          fechaInicio: { type: 'string', description: 'Fecha inicio YYYY-MM-DD' },
          fechaFin: { type: 'string', description: 'Fecha fin YYYY-MM-DD' },
        },
        required: ['fechaInicio', 'fechaFin'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_ventas_por_auto',
      description: 'Ventas desglosadas por auto/modelo con detalle por unidad: serie VIN, color, vendedor, cliente, fecha, venta, utilidad y margen. Usar cuando pregunten ventas por auto, por modelo, por vehículo o unidades vendidas específicas.',
      parameters: {
        type: 'object',
        properties: {
          fechaInicio: { type: 'string', description: 'Fecha inicio YYYY-MM-DD' },
          fechaFin: { type: 'string', description: 'Fecha fin YYYY-MM-DD' },
          modelo: { type: 'string', description: 'Filtro opcional por nombre de modelo (parcial, ej. AVEO, S10, TAHOE)' },
          serie: { type: 'string', description: 'Filtro opcional por número de serie/VIN (parcial)' },
          vendedor: { type: 'string', description: 'Filtro opcional por nombre del vendedor (parcial)' },
          limite: { type: 'number', description: 'Máximo de unidades a devolver (default 50, max 100)' },
        },
        required: ['fechaInicio', 'fechaFin'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_resumen_ejecutivo',
      description: 'Resumen ejecutivo consolidado: ventas financieras, inventario, servicio/postventa y analytics de ejecutivos.',
      parameters: {
        type: 'object',
        properties: {
          fechaInicio: { type: 'string', description: 'Fecha inicio YYYY-MM-DD' },
          fechaFin: { type: 'string', description: 'Fecha fin YYYY-MM-DD' },
        },
        required: ['fechaInicio', 'fechaFin'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_analytics_ventas',
      description: 'Analytics avanzado de ventas: matriz volumen/margen por modelo, segmentación de ejecutivos y tendencias.',
      parameters: {
        type: 'object',
        properties: {
          fechaInicio: { type: 'string', description: 'Fecha inicio YYYY-MM-DD' },
          fechaFin: { type: 'string', description: 'Fecha fin YYYY-MM-DD' },
        },
        required: ['fechaInicio', 'fechaFin'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_inventario',
      description:
        'Inventario de vehículos nuevos (FIS/DIS/SEP…), plan piso, aging y sin previas. '
        + 'Para stock de refacciones/HyP usa consultar_inventario_postventa. '
        + 'Este módulo es autos nuevos; seminuevos no están el foco principal (acláralo si preguntan).',
      parameters: {
        type: 'object',
        properties: {
          planPisoPeriod: {
            type: 'string',
            description: 'Periodo del plan piso: all, current, previous',
            enum: ['all', 'current', 'previous'],
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_inventario_postventa',
      description:
        'Inventario de postventa: refacciones, HyP (grupo 32/ALM8) y piezas en proceso de servicio. '
        + 'Úsala para stock trabado, costo inmovilizado o comparar áreas de refacciones vs HyP.',
      parameters: {
        type: 'object',
        properties: {
          area: {
            type: 'string',
            enum: ['refacciones', 'hyp', 'servicio', 'todas'],
            description: 'Área a enfatizar (default todas)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_refacciones',
      description:
        'Dashboard de refacciones: pedidos, partes con más días sin venta (+90), mejor utilidad y margen. '
        + 'Úsala para “inventario de refacciones trabado”, “top partes por utilidad” o pedidos pendientes.',
      parameters: {
        type: 'object',
        properties: {
          fechaInicio: { type: 'string', description: 'Inicio YYYY-MM-DD (default mes actual)' },
          fechaFin: { type: 'string', description: 'Fin YYYY-MM-DD (default hoy)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_roles_acceso',
      description:
        'Catálogo de roles del dashboard (Administración, Dirección, Gerencia Comercial, Vendedor, Contabilidad): '
        + 'páginas/módulos que ve cada perfil y capacidades. Úsala para preguntas de administración de accesos.',
      parameters: {
        type: 'object',
        properties: {
          rol: {
            type: 'string',
            description: 'Opcional: administracion | direccion | gerencia_comercial | vendedor | contabilidad',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_memoria_perfil',
      description:
        'Lee el playbook del perfil activo y la memoria personal del usuario (preferencias y hechos guardados). '
        + 'Úsala si necesitas recordar foco del rol, preferencias de periodo/sucursal o cómo suele pedir reportes.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'actualizar_memoria_usuario',
      description:
        'Guarda preferencias o hechos del usuario para sesiones futuras '
        + '(periodo favorito, sucursal, fuerza, métrica preferida, formato de respuesta, etc.). '
        + 'Úsala cuando el usuario diga “siempre muéstrame…”, “prefiero…”, “recuerda que…”.',
      parameters: {
        type: 'object',
        properties: {
          accion: {
            type: 'string',
            enum: ['preferencia', 'hecho', 'limpiar'],
            description: 'preferencia | hecho | limpiar (borra toda la memoria del usuario)',
          },
          clave: {
            type: 'string',
            description: 'Clave corta (ej. periodo_default, sucursal, fuerza, formato_respuesta)',
          },
          valor: {
            type: 'string',
            description: 'Valor a recordar',
          },
          categoria: {
            type: 'string',
            description: 'Categoría del hecho: preferencia | foco | contexto | general',
          },
        },
        required: ['accion'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_postventa',
      description:
        'Post-venta / taller: órdenes de Servicio o HyP. '
        + 'OBLIGATORIO usar area="hyp" para hojalatería y pintura (folios A,F,H,J,V,Z,Ó; también I/E de asesores HyP Jair/Brian/Edel) '
        + 'y area="servicio" para órdenes de servicio (C,D,G,I,K,N,O,Q,S,X,Y,Á,M,E,R). '
        + 'Para abiertas usa estatus="abiertas" (snapshot actual; fechas opcionales). '
        + 'Nomenclatura con tipo=…: internas (I,J,Ó,M,H,O), normales (N,Y,Q), reparacion (D,X,C), '
        + 'garantias (G), aseguradoras (A,F,V), particulares (Z), empleados (E), flotilla (Á), previas (S), reclamaciones (R). '
        + 'Segmentación UI HyP (chips): externas = A,F,V,Z; hyp_internas = J,H,Ó,I,E. '
        + 'También acepta una letra (“N”) o lista (“N,Y,Q”). '
        + `Catálogo: ${nomenclaturaHelpText()}. `
        + 'Ejemplo: “órdenes normales abiertas” → estatus=abiertas, tipo=normales (sin fechas). '
        + 'Ejemplo: “órdenes internas abiertas” → estatus=abiertas, tipo=internas. '
        + 'Ejemplo HyP: “externas HyP abiertas” → area=hyp, estatus=abiertas, tipo=externas. '
        + 'Ejemplo: “órdenes HyP abiertas de 2025” → area=hyp, estatus=abiertas, fechaInicio=2025-01-01, fechaFin=2025-12-31. '
        + 'En la respuesta menciona qué letras aplicaste (filtros.nomenclatura). '
        + 'Responde con resumen.totalFiltrado o resumen.abiertasActualesDelArea; NUNCA uses un total global sin filtrar.',
      parameters: {
        type: 'object',
        properties: {
          fechaInicio: { type: 'string', description: 'Fecha inicio YYYY-MM-DD (opcional si estatus=abiertas)' },
          fechaFin: { type: 'string', description: 'Fecha fin YYYY-MM-DD (opcional si estatus=abiertas)' },
          area: {
            type: 'string',
            description: 'Área PostVenta: hyp | servicio | posventa (default posventa = ambas)',
            enum: ['hyp', 'servicio', 'posventa'],
          },
          estatus: {
            type: 'string',
            description: 'Filtro de estatus: abiertas | facturadas | canceladas | todas',
            enum: ['abiertas', 'facturadas', 'canceladas', 'todas'],
          },
          tipo: {
            type: 'string',
            description:
              'Nomenclatura: normales | internas | externas | hyp_internas | reparacion | garantias | aseguradoras | particulares | '
              + 'empleados | flotilla | previas | reclamaciones | letra (N) | lista (N,Y,Q)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_lista_precios',
      description:
        'Lista de precios Chevrolet vigente (planes Guía Administración o Bono Toma a Cuenta) cruzada con inventario y ficha técnica. '
        + 'Úsala para: Precio de Venta GMMX (campo msrp en datos), bonificaciones, descuentos, planes GMF/contado/leasing, stock por versión/color, '
        + 'ficha técnica (motor, transmisión — Aveo LT Plus = CVT automática), vigencia del PDF publicado. '
        + 'Secciones: administracion (default) | bono-toma-cuenta. '
        + 'Si preguntan precio, plan, bono o stock de un modelo → esta herramienta (no inventes cifras). '
        + 'Admin publica el PDF mensual; tú solo lees el catálogo vigente.',
      parameters: {
        type: 'object',
        properties: {
          section: {
            type: 'string',
            enum: ['administracion', 'bono-toma-cuenta'],
            description: 'Guía Administración (default) o Bono Toma a Cuenta',
          },
          modelo: {
            type: 'string',
            description: 'Carline / modelo (ej. AVEO, TRAVERSE, EQUINOX EV). Vacío = todos con stock.',
          },
          q: {
            type: 'string',
            description: 'Búsqueda libre en modelo/versión/código GMF',
          },
          soloConStock: {
            type: 'boolean',
            description: 'true (default) = solo versiones con existencia; false = catálogo completo',
          },
          detalle: {
            type: 'string',
            enum: ['resumen', 'completo'],
            description: 'resumen (default) o completo (más planes por versión)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_contabilidad',
      description: 'Contabilidad y EEFF: estados financieros, VTASMEN autos nuevos, utilidades y desglose por sucursal/área.',
      parameters: {
        type: 'object',
        properties: {
          fechaInicio: { type: 'string', description: 'Fecha inicio YYYY-MM-DD' },
          fechaFin: { type: 'string', description: 'Fecha fin YYYY-MM-DD' },
          sucursal: { type: 'string', description: 'Filtro opcional de sucursal' },
          area: { type: 'string', description: 'Filtro opcional de área' },
          planPisoPeriod: { type: 'string', description: 'all, current o previous' },
        },
        required: ['fechaInicio', 'fechaFin'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_ventas_dia',
      description: 'Unidades vendidas en un día específico (contabilidad/ventas diarias).',
      parameters: {
        type: 'object',
        properties: {
          fecha: { type: 'string', description: 'Fecha YYYY-MM-DD' },
        },
        required: ['fecha'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_pronostico',
      description:
        'OBLIGATORIA para cualquier pregunta de pronóstico, proyección, forecast, ventas futuras, '
        + 'próximo mes, horizonte o “cuántas unidades se venderán”. '
        + 'Usa el mismo modelo y datos del módulo Pronóstico del dashboard (histórico 12 meses + proyección). '
        + 'No sustituir por consultar_ventas.',
      parameters: {
        type: 'object',
        properties: {
          horizon: {
            type: 'string',
            description: 'Meses a proyectar: "3", "6" (default) o "12"',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_objetivos_ventas',
      description: 'Objetivos de ventas retail y SOFIA para un periodo.',
      parameters: {
        type: 'object',
        properties: {
          fechaInicio: { type: 'string', description: 'Fecha inicio YYYY-MM-DD' },
          fechaFin: { type: 'string', description: 'Fecha fin YYYY-MM-DD' },
        },
        required: ['fechaInicio', 'fechaFin'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_quejas_csi',
      description:
        'OBLIGATORIA para quejas, reclamos, incidencias CSI, NPS bajo o insatisfacción por vendedor/ejecutivo '
        + 'o por asesor de servicio/taller. Fuente: CSI Posventa (columna asesor) y CSI Ventas (columna ejecutivo). '
        + 'Sin persona → ranking de asesores y vendedores con más quejas. Con persona → detalle de sus quejas, '
        + 'área y muestra de comentarios. Por defecto solo Queja/Baja calificación (tipoIncidencia=quejas); '
        + 'usa tipoIncidencia=todas para incluir solicitudes de info, sugerencias y felicitaciones. '
        + 'No uses buscar_cliente_crm ni SQL para este caso.',
      parameters: {
        type: 'object',
        properties: {
          persona: {
            type: 'string',
            description: 'Nombre parcial o completo del vendedor/ejecutivo o asesor de servicio. Vacío = ranking general.',
          },
          rol: {
            type: 'string',
            enum: ['auto', 'vendedor', 'asesor_servicio'],
            description: 'auto busca en ambos; vendedor=CSI Ventas (ejecutivo); asesor_servicio=CSI Posventa (asesor).',
          },
          fuente: {
            type: 'string',
            enum: ['todas', 'posventa', 'ventas'],
            description: 'Filtrar solo posventa/taller, solo ventas, o ambas.',
          },
          tipoIncidencia: {
            type: 'string',
            enum: ['quejas', 'todas'],
            description: 'quejas (default) = Queja/Baja calificación; todas = cualquier incidencia CSI.',
          },
          periodo: {
            type: 'string',
            enum: ['hoy', 'mes_actual', 'mes_pasado', 'ultimos_30_dias', 'ultimos_90_dias', 'trimestre_actual', 'acumulado_anio', 'anio_actual', 'anio_anterior', 'todo'],
            description: 'Periodo relativo. Para “mes pasado” usa mes_pasado.',
          },
          fechaInicio: { type: 'string', description: 'Inicio YYYY-MM-DD (opcional)' },
          fechaFin: { type: 'string', description: 'Fin YYYY-MM-DD (opcional)' },
          area: { type: 'string', description: 'Filtro parcial de área (Garantías, Servicio, HYP, Facturación, etc.)' },
          limit: { type: 'string', description: 'Máximo de filas de detalle (default 25)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar_cliente_crm',
      description:
        'Busca clientes en Seguimiento 360: Balderrama Ciclos (fuente maestra), leads, solicitudes F&I y pruebas de manejo. '
        + 'Busca por ID CRM '
        + '(ID_CONTACTO), nombre parcial, VIN, teléfono o correo. Devuelve id_contacto, nombre, número de ciclos, '
        + 'actividades, compras, leads, solicitudes y pruebas de manejo. Úsala primero cuando pregunten por un cliente y no tengas su ID.',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'ID CRM numérico, nombre del cliente, VIN, teléfono o correo' },
          limit: { type: 'string', description: 'Máximo de resultados (default 25)' },
        },
        required: ['q'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'historico_cliente_crm',
      description:
        'CRM 360° COMPLETO de un cliente en el distribuidor. Incluye ficha360 con última compra, modelo/año/VIN actual, '
        + 'tipo y plazo de compra, mensualidades y saldo ESTIMADOS, valor de referencia, última visita a taller, '
        + 'último kilometraje registrado, servicios realizados, último contacto comercial, interacciones digitales, '
        + 'quejas/incidencias e historial de compras. Incluye timeline360 unificada con compras, financiamiento, taller, '
        + 'contactos comerciales, leads digitales y pruebas de manejo. También devuelve contratos de financiamiento '
        + 'relacionados al VIN con su número de contrato, aseguradora y PVAs '
        + '(GAP, garantía extendida, accesorios, OnStar y mantenimientos integrados). '
        + 'Compra en ciclo de venta = VIN asignado '
        + '(columna T del CRM). Ese VIN se cruza con SQL: factura de venta (ADE_VTAFI.VTE_SERIE / VTE_DOCTO) y '
        + 'órdenes de servicio (SER_ORDEN.ORE_NUMSERIE). También incluye ciclos, leads, solicitudes de crédito F&I '
        + '(financiera, estatus, aprobación, enganche), pruebas de manejo, vendedor, línea de tiempo y TODAS las unidades '
        + 'a nombre del cliente en el DMS, incluso si no tienen una venta originada en nuestra base. Un ID CRM puede tener varios VIN. '
        + 'Las mensualidades pagadas y el saldo son aproximaciones por tiempo transcurrido y amortización lineal; '
        + 'no deben presentarse como pagos o saldo real de la financiera. '
        + 'Requiere id_contacto (= ID CRM).',
      parameters: {
        type: 'object',
        properties: {
          idContacto: { type: 'string', description: 'ID_CONTACTO / ID CRM del cliente' },
          fechaInicio: { type: 'string', description: 'Inicio opcional YYYY-MM-DD para órdenes de taller' },
          fechaFin: { type: 'string', description: 'Fin opcional YYYY-MM-DD para órdenes de taller' },
        },
        required: ['idContacto'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resumen_leads',
      description:
        'Resumen agregado de LEADS (interesados) de la base interna: total de leads, contactados, citas y compras, '
        + 'agrupados por canal, sucursal, tipo, campaña, resultado, fuerza de ventas, ejecutivo, estatus de compra, '
        + 'auto de interés o mes. Úsala para preguntas como "cuántos leads llegaron en enero", "leads por canal", '
        + '"conversión de leads a citas/compras" o "cuántos leads hubo el mes pasado". "Compras" representa leads '
        + 'del periodo vinculados por ID CRM a un VIN de compra; no representa las ventas totales facturadas en el DMS. '
        + 'El periodo filtra la fecha de entrada del lead y la compra vinculada puede ser posterior. Para periodos relativos usa periodo. '
        + 'Para “oportunidades con cita que aún no compran” usa listar="citas_sin_compra".',
      parameters: {
        type: 'object',
        properties: {
          periodo: {
            type: 'string',
            enum: ['hoy', 'mes_actual', 'mes_pasado', 'ultimos_30_dias', 'ultimos_90_dias', 'trimestre_actual', 'acumulado_anio', 'anio_actual', 'anio_anterior', 'todo'],
            description: 'Periodo relativo. Para "el mes pasado" usa exactamente mes_pasado. Para “últimos 90 días” usa ultimos_90_dias.',
          },
          desde: { type: 'string', description: 'Fecha inicio YYYY-MM-DD (opcional)' },
          hasta: { type: 'string', description: 'Fecha fin YYYY-MM-DD (opcional)' },
          agruparPor: {
            type: 'string',
            enum: ['canal', 'sucursal', 'tipo', 'campana', 'resultado', 'fuerza_ventas', 'ejecutivo', 'estatus_compra', 'auto_interes', 'mes'],
            description: 'Dimensión de agrupación (default: canal)',
          },
          listar: {
            type: 'string',
            enum: ['citas_sin_compra', 'sin_compra'],
            description: 'Devuelve detalle de leads: citas_sin_compra = cita programada sin VIN de compra',
          },
          limit: { type: 'string', description: 'Máximo de grupos o filas de detalle (default 30)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resumen_seguimiento_360',
      description:
        'Resumen agregado de todas las mini bases de Seguimiento 360 en un periodo: leads, solicitudes F&I, '
        + 'pruebas de manejo, ciclos, actividades y compras por VIN. Incluye clientes distintos y conversiones '
        + 'lead→compra, solicitud→compra y prueba de manejo→compra. Úsala para preguntas agregadas que mezclan '
        + 'dos o más fuentes, o para solicitudes/pruebas de manejo por periodo. La conversión lead→compra es una '
        + 'atribución por ID CRM + VIN de la cohorte de leads, no el cociente entre ventas totales del DMS y leads. '
        + 'Para desempeño de un vendedor/ejecutivo concreto usa resumen_vendedor_360 (no esta herramienta).',
      parameters: {
        type: 'object',
        properties: {
          periodo: {
            type: 'string',
            enum: ['hoy', 'mes_actual', 'mes_pasado', 'ultimos_30_dias', 'ultimos_90_dias', 'trimestre_actual', 'acumulado_anio', 'anio_actual', 'anio_anterior', 'todo'],
            description: 'Periodo relativo; usa mes_pasado cuando el usuario diga “mes pasado”; ultimos_90_dias para “últimos 90 días”.',
          },
          desde: { type: 'string', description: 'Fecha inicio YYYY-MM-DD (opcional)' },
          hasta: { type: 'string', description: 'Fecha fin YYYY-MM-DD (opcional)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_vendedores_360',
      description:
        'Lista vendedores/ejecutivos/asesores de Seguimiento 360 con conteo de clientes en cartera. '
        + 'Fuentes: ciclos (vendedor), leads (ejecutivo), pruebas de manejo (ejecutivo) y solicitudes F&I (asesor). '
        + 'Úsala cuando pregunten “qué vendedores hay”, “busca al ejecutivo X” o antes de resumen_vendedor_360 '
        + 'si el nombre no es exacto.',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'Filtro opcional por nombre parcial del vendedor' },
          limit: { type: 'string', description: 'Máximo de resultados (default 50)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resumen_vendedor_360',
      description:
        'Resumen Seguimiento 360 por vendedor (misma vista “Por vendedor” del dashboard). Incluye cartera '
        + '(clientes, ciclos, leads, solicitudes F&I, pruebas de manejo), unidades vendidas del libro ADE_VTAFI '
        + '(comercial.libroVentas.unidades — fuente fiel de facturas), desempeño comercial F&I '
        + '(contratos, monto a financiar, plazo promedio, distribución de plazos), promedio de PVAs '
        + '(cantidad promedio de productos PVA por contrato, no monto) y retorno a taller. '
        + 'Úsala para “cómo va el vendedor X”, “unidades vendidas de…”, “contratos F&I de…”, “PVAs de…”, '
        + '“pruebas de manejo de…”, “retorno a taller del ejecutivo…”.',
      parameters: {
        type: 'object',
        properties: {
          vendedor: { type: 'string', description: 'Nombre del vendedor / ejecutivo / asesor' },
          fechaInicio: { type: 'string', description: 'Inicio opcional YYYY-MM-DD' },
          fechaFin: { type: 'string', description: 'Fin opcional YYYY-MM-DD' },
          limit: { type: 'string', description: 'Máximo de clientes en listado (default 50 para IA)' },
        },
        required: ['vendedor'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generar_excel',
      description:
        'OBLIGATORIA cuando el usuario pida Excel, XLSX, descargar listado, exportar o “pásame un archivo”. '
        + 'Genera un .xlsx descargable en el chat. '
        + 'fuente=postventa (con area, estatus y tipo de nomenclatura) | ventas | inventario | manual. '
        + 'Para órdenes abiertas NO hace falta periodo: estatus=abiertas usa el snapshot actual. '
        + 'tipo=normales (N,Y,Q) | internas (I,J,Ó,M,H,O) | reparacion (D,X,C) | garantias | aseguradoras | etc. '
        + 'Ej.: “Excel de normales abiertas” → fuente=postventa, estatus=abiertas, tipo=normales. '
        + 'Para facturadas/ventas del periodo sí pasa fechaInicio y fechaFin (si faltan, usa YTD). '
        + 'NO inventes filas: esta herramienta consulta la base y arma el archivo. '
        + 'Después de usarla, dile al usuario que use el botón de descarga del chat y menciona las letras usadas.',
      parameters: {
        type: 'object',
        properties: {
          fuente: {
            type: 'string',
            description: 'Origen de datos',
            enum: ['postventa', 'ventas', 'inventario', 'manual'],
          },
          fechaInicio: { type: 'string', description: 'YYYY-MM-DD (opcional si postventa abiertas)' },
          fechaFin: { type: 'string', description: 'YYYY-MM-DD (opcional si postventa abiertas)' },
          area: {
            type: 'string',
            description: 'Solo postventa: hyp | servicio | posventa',
            enum: ['hyp', 'servicio', 'posventa'],
          },
          estatus: {
            type: 'string',
            description: 'Solo postventa: abiertas | facturadas | canceladas | todas',
            enum: ['abiertas', 'facturadas', 'canceladas', 'todas'],
          },
          tipo: {
            type: 'string',
            description:
              'Nomenclatura postventa: normales | internas | reparacion | garantias | aseguradoras | '
              + 'particulares | empleados | flotilla | previas | reclamaciones | letra | lista de letras',
          },
          filename: { type: 'string', description: 'Nombre sugerido, ej. normales_abiertas.xlsx' },
          filas: {
            type: 'array',
            description: 'Solo fuente=manual: arreglo de objetos fila',
            items: { type: 'object' },
          },
          sheets: {
            type: 'array',
            description: 'Solo fuente=manual: hojas [{name, rows}]',
            items: { type: 'object' },
          },
        },
        required: ['fuente'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_financiamiento',
      description:
        'Contratos F&I del CRM (crm_financiamiento). OBLIGATORIA para ranking de vendedores/asesores en '
        + 'crédito vs leasing/arrendamiento, volumen de contratos, o “quién vendió más en leasing”. '
        + 'Distingue modalidad: leasing = plan_2/especial con LEASING; crédito = TRADICIONAL, SUBSIDIADO, DIAMANTE, etc. '
        + 'El vendedor es el campo asesor del contrato (no FI/AFI). '
        + 'Si el usuario NO indica periodo, usa periodo=mes_actual (mes en curso). '
        + 'Devuelve ranking, totales y periodosSugeridos (trimestre/semestre/año) para ofrecer ampliar la vista.',
      parameters: {
        type: 'object',
        properties: {
          modalidad: {
            type: 'string',
            enum: ['leasing', 'credito', 'todos'],
            description:
              'leasing/arrendamiento → solo LEASING; credito → sin leasing; todos → ambos. '
              + 'Para “ventas en leasing” usa leasing; para “crédito” usa credito.',
          },
          periodo: {
            type: 'string',
            enum: [
              'mes_actual', 'mes_pasado', 'ultimos_30_dias', 'ultimos_90_dias',
              'trimestre_actual', 'semestre_actual', 'acumulado_anio', 'anio_actual', 'anio_anterior',
            ],
            description: 'Default recomendado: mes_actual si el usuario no especifica fechas.',
          },
          fechaInicio: { type: 'string', description: 'Inicio YYYY-MM-DD (opcional; tiene prioridad sobre periodo)' },
          fechaFin: { type: 'string', description: 'Fin YYYY-MM-DD (opcional)' },
          limit: { type: 'string', description: 'Máximo de asesores en el ranking (default 10)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_utilidad_carline',
      description:
        'OBLIGATORIA para “qué auto deja más utilidad por carline/familia”, “mejor versión por línea”, '
        + '“margen bruto por carline” o ranking de utilidad por familia GM. '
        + 'Carline = UNC_FAMILIA (AVEO, ONIX, CAPTIVA…). Versión = descripción completa TIPOAUTO (paquete/trim). '
        + 'Por cada carline devuelve la versión con mejor utilidad y su margen bruto %. '
        + 'Si el usuario NO indica periodo, usa periodo=mes_actual. '
        + 'Incluye periodosSugeridos (trimestre/semestre/año) para ofrecer ampliar la vista.',
      parameters: {
        type: 'object',
        properties: {
          periodo: {
            type: 'string',
            enum: [
              'mes_actual', 'mes_pasado', 'ultimos_30_dias', 'ultimos_90_dias',
              'trimestre_actual', 'semestre_actual', 'acumulado_anio', 'anio_actual', 'anio_anterior',
            ],
            description: 'Default recomendado: mes_actual si el usuario no especifica fechas.',
          },
          fechaInicio: { type: 'string', description: 'Inicio YYYY-MM-DD (opcional; prioridad sobre periodo)' },
          fechaFin: { type: 'string', description: 'Fin YYYY-MM-DD (opcional)' },
          carline: {
            type: 'string',
            description: 'Filtrar una familia (ej. AVEO, CAPTIVA). Opcional; sin filtro = todas.',
          },
          metric: {
            type: 'string',
            enum: ['utilidad_promedio', 'utilidad_total', 'margen'],
            description:
              'Criterio de “mejor versión”: utilidad_promedio (default), utilidad_total o margen bruto %.',
          },
          minUnidades: {
            type: 'string',
            description: 'Mínimo de unidades vendidas de la versión para considerarla (default 1).',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_recomendaciones_directivas',
      description:
        'OBLIGATORIA para recomendaciones a nivel dirección/gerencia: cuellos de botella, '
        + 'cuándo meter presión comercial, ritmo de leads/solicitudes vs histórico, '
        + 'si el mix de coches (retail/flotilla/HIGH END/utilidad) alcanza la meta, '
        + 'run-rate diario necesario y plan de acciones. Combina ventas + objetivos + embudo CRM. '
        + 'Sin periodo → mes_actual.',
      parameters: {
        type: 'object',
        properties: {
          periodo: {
            type: 'string',
            description: 'mes_actual | mes_pasado | semana_actual',
            enum: ['mes_actual', 'mes_pasado', 'semana_actual'],
          },
          fechaInicio: { type: 'string', description: 'Opcional YYYY-MM-DD (override)' },
          fechaFin: { type: 'string', description: 'Opcional YYYY-MM-DD (override)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_riesgos_oportunidades',
      description:
        'OBLIGATORIA para riesgos, oportunidades, alertas críticas, “qué revisar hoy/esta semana”, '
        + 'hallazgos del tablero o insights accionables. Consolida alertas operativas + insights de '
        + 'ventas/inventario/tablero (previas, aging, plan piso, margen, taller, etc.). '
        + 'Sin periodo → semana_actual (últimos 7 días). Responde con riesgos + oportunidades + 2–4 acciones. '
        + 'Para presión/mix/embudo directivo usa también consultar_recomendaciones_directivas.',
      parameters: {
        type: 'object',
        properties: {
          periodo: {
            type: 'string',
            description: 'semana_actual | mes_actual | mes_pasado',
            enum: ['semana_actual', 'mes_actual', 'mes_pasado'],
          },
          fechaInicio: { type: 'string', description: 'Opcional YYYY-MM-DD (override)' },
          fechaFin: { type: 'string', description: 'Opcional YYYY-MM-DD (override)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_tablas_bd',
      description: 'Lista tablas y vistas de la base GMOFARRIL para explorar estructura.',
      parameters: {
        type: 'object',
        properties: {
          filtro: { type: 'string', description: 'Texto opcional para filtrar nombres de tabla' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'describir_tabla',
      description: 'Describe columnas, tipos y nulabilidad de una tabla o vista.',
      parameters: {
        type: 'object',
        properties: {
          tableName: { type: 'string', description: 'Nombre de tabla, ej. ADE_VTAFI o dbo.ADE_VTAFI' },
        },
        required: ['tableName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ejecutar_consulta_sql',
      description: 'Ejecuta una consulta SELECT de solo lectura para análisis ad-hoc. Máximo 200 filas.',
      parameters: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'Consulta T-SQL SELECT o WITH' },
        },
        required: ['sql'],
      },
    },
  },
];

async function listTables({ filtro } = {}) {
  const rows = await query(`
    SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE IN ('BASE TABLE', 'VIEW')
    ORDER BY TABLE_SCHEMA, TABLE_NAME
  `);
  const filtered = filtro
    ? rows.filter((r) => `${r.TABLE_SCHEMA}.${r.TABLE_NAME}`.toLowerCase().includes(String(filtro).toLowerCase()))
    : rows;
  return {
    total: filtered.length,
    tablas: filtered.slice(0, 150).map((r) => `${r.TABLE_SCHEMA}.${r.TABLE_NAME} (${r.TABLE_TYPE})`),
  };
}

function parseTableName(tableName) {
  const raw = String(tableName || '').trim();
  if (!raw) throw new Error('tableName es requerido.');
  const parts = raw.split('.');
  if (parts.length === 2) return { schema: parts[0], table: parts[1] };
  return { schema: 'dbo', table: parts[0] };
}

async function describeTable({ tableName }) {
  const { schema, table } = parseTableName(tableName);
  const columns = await query(`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
    ORDER BY ORDINAL_POSITION
  `, { schema, table });

  if (!columns.length) {
    throw new Error(`No se encontró la tabla ${schema}.${table}`);
  }

  return {
    table: `${schema}.${table}`,
    columnas: columns.map((c) => ({
      nombre: c.COLUMN_NAME,
      tipo: c.DATA_TYPE,
      nullable: c.IS_NULLABLE,
      longitud: c.CHARACTER_MAXIMUM_LENGTH,
    })),
  };
}

async function executeReadOnlySql({ sql: sqlText }) {
  const safeSql = ensureTopLimit(validateReadOnlySql(sqlText));
  const rows = await query(safeSql);
  return {
    filas: rows.length,
    columnas: rows.length ? Object.keys(rows[0]) : [],
    datos: rows,
  };
}

function shapeForecastForAi(raw) {
  if (!raw || raw.error) return raw;
  const history = Array.isArray(raw.history) ? raw.history.slice(-12) : [];
  const forecast = Array.isArray(raw.forecast) ? raw.forecast : [];
  return {
    fuente: 'Modulo Pronostico del dashboard (forecastService)',
    dataSource: raw.dataSource,
    model: raw.model,
    metrics: raw.metrics,
    kpis: raw.kpis,
    historyUltimos12Meses: history.map((r) => ({
      label: r.label,
      units: r.units,
      fitted: r.fitted,
    })),
    forecastMensual: forecast.map((r) => ({
      label: r.label,
      units: r.units,
      low: r.low,
      high: r.high,
    })),
    // alias para visualizaciones del asistente
    history,
    forecast,
    breakdown: raw.breakdown,
    notes: raw.notes,
  };
}

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function resolveRiesgosPeriodo({ periodo, fechaInicio, fechaFin } = {}) {
  if (fechaInicio && fechaFin) {
    return { fechaInicio, fechaFin, label: `${fechaInicio} → ${fechaFin}`, periodo: 'custom' };
  }
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const key = String(periodo || 'semana_actual').toLowerCase();

  if (key === 'mes_pasado') {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    return {
      fechaInicio: ymd(start),
      fechaFin: ymd(end),
      label: 'Mes pasado',
      periodo: 'mes_pasado',
    };
  }

  if (key === 'mes_actual') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return {
      fechaInicio: ymd(start),
      fechaFin: ymd(today),
      label: 'Mes en curso',
      periodo: 'mes_actual',
    };
  }

  // semana_actual = últimos 7 días (incluye hoy)
  const start = new Date(today);
  start.setDate(start.getDate() - 6);
  return {
    fechaInicio: ymd(start),
    fechaFin: ymd(today),
    label: 'Últimos 7 días',
    periodo: 'semana_actual',
  };
}

function shapeInsight(insight, tipo = 'riesgo') {
  return {
    tipo,
    severity: insight.severity || 'info',
    modulo: insight.module || null,
    titulo: insight.title,
    resumen: insight.summary,
    analisis: insight.analysis,
    acciones: Array.isArray(insight.recommendations) ? insight.recommendations.slice(0, 3) : [],
  };
}

function getRolesAcceso({ rol } = {}) {
  const PAGE_LABELS = {
    overview: 'Resumen / Tablero',
    sales: 'Ventas / F&I / Leads',
    forecast: 'Pronóstico',
    inventory: 'Inventario',
    'lista-precios': 'Lista de precios',
    contabilidad: 'Contabilidad / EEFF',
    'post-sales': 'PostVenta',
    seguimiento: 'Seguimiento 360',
    admin: 'Administración de usuarios',
  };

  const all = listRoles().map((r) => {
    const full = getRole(r.id) || r;
    return {
      id: full.id,
      label: full.label,
      homePath: full.homePath,
      canManageUsers: Boolean(full.canManageUsers),
      paginas: (full.pages || []).map((p) => ({
        id: p,
        label: PAGE_LABELS[p] || p,
      })),
    };
  });

  const wanted = String(rol || '').trim().toLowerCase();
  const filtered = wanted
    ? all.filter((r) => r.id === wanted || String(r.label || '').toLowerCase().includes(wanted))
    : all;

  return {
    roles: filtered.length ? filtered : all,
    alertasTipos: listAlertTypes().map((t) => ({ id: t.id, label: t.label, category: t.category })),
    preferenciasAlertasPorRol: getPrefs(),
    nota:
      'Vendedor ve Ventas, Lista de precios y Seguimiento 360 (sin Pronóstico). '
      + 'Gerencia Comercial ve Ventas, Pronóstico, Lista de precios y Seguimiento 360. '
      + 'Contabilidad solo Contabilidad/EEFF. Dirección y Administración ven el tablero completo '
      + '(Admin puede publicar el PDF mensual de planes Chevrolet).',
  };
}

async function shapeListaPreciosForAi(args = {}) {
  const section = args.section === 'bono-toma-cuenta' ? 'bono-toma-cuenta' : 'administracion';
  const detalleCompleto = String(args.detalle || 'resumen').toLowerCase() === 'completo';
  const soloConStock = args.soloConStock !== false && args.soloConStock !== '0' && args.soloConStock !== 'false';
  const meta = getActivePlansMeta();
  const data = await getListaPreciosFicha({
    section,
    modelo: args.modelo || '',
    q: args.q || '',
    soloConStock,
  });

  const versionLimit = detalleCompleto ? 20 : 8;
  const planLimit = detalleCompleto ? 8 : 3;
  const modelos = (data.modelos || []).slice(0, detalleCompleto ? 25 : 12).map((m) => ({
    modelo: m.modelo,
    anio: m.anio,
    titulo: m.titulo,
    stockTotal: m.stockTotal,
    badgeSeguro: m.badgeSeguro,
    versions: (m.versions || []).slice(0, versionLimit).map((v) => {
      const planes = (v.planes || []).slice(0, planLimit).map((p) => ({
        tipoPago: p.tipoPago,
        nombre: p.nombre,
        precioFinal: p.precioFinal,
        bonificacion: p.bonificacion,
        descuento: p.descuentoMostrador ?? p.descuento,
        tasaGmf: p.tasaGmf || p.tasaFactor,
        enganche: p.enganche,
        recomendado: Boolean(p.recomendado),
        seguroGratis: p.seguroGratis,
      }));
      const ficha = v.fichaTecnica || {};
      const desempeno = Array.isArray(ficha.desempeno) ? ficha.desempeno.slice(0, 4) : [];
      return {
        version: v.version,
        paquete: v.paquete,
        precioVentaGmmx: v.msrp,
        msrp: v.msrp,
        stockDisponible: v.stockDisponible,
        stockApartadas: v.stockApartadas,
        colores: (v.colores || []).slice(0, 6).map((c) => ({
          label: c.label,
          disponibles: c.disponibles,
          apartadas: c.apartadas,
        })),
        resumen: v.summary ? {
          precioFinalDesde: v.summary.precioFinalDesde,
          descuentoMaximo: v.summary.descuentoMaximo,
          descuentoPct: v.summary.descuentoPct,
          seguroGratis: v.summary.seguroGratis,
          tasaGmfDesde: v.summary.tasaGmfDesde,
          leasingFactor: v.summary.leasingFactor,
        } : null,
        ficha: {
          transmision: desempeno.find((x) => /transmisi/i.test(x.label || ''))?.value
            || (typeof ficha.transmision === 'string' ? ficha.transmision : null),
          highlights: desempeno.map((x) => `${x.label}: ${x.value}`),
        },
        planes,
      };
    }),
  }));

  return {
    available: Boolean(meta.exists),
    vigencia: meta.vigencia || data.meta?.vigencia || null,
    fuentePdf: meta.sourceFile || data.meta?.sourceFile || null,
    publicado: {
      uploadedAt: meta.uploadedAt || null,
      uploadedBy: meta.uploadedBy || null,
      parsedAt: meta.parsedAt || null,
    },
    seccion: section,
    seccionLabel: section === 'bono-toma-cuenta' ? 'Bono Toma a Cuenta' : 'Guía Administración',
    notaUi:
      'En la interfaz el campo MSRP se muestra como «Precio de Venta GMMX». '
      + 'Aveo LT Plus = transmisión CVT (automática), no manual. '
      + 'El PDF mensual lo publica Administración (solo Guía Administración + Bono Toma a Cuenta del índice).',
    kpis: data.kpis || null,
    catalogoModelos: meta.modelos || data.catalog?.modelos || [],
    filtros: {
      modelo: args.modelo || null,
      q: args.q || null,
      soloConStock,
      detalle: detalleCompleto ? 'completo' : 'resumen',
    },
    modelos,
    instruccionRespuesta:
      'Responde con Precio de Venta GMMX, mejor plan/precio final, stock y 1 dato de ficha si aporta. '
      + 'Menciona vigencia/fuente si está disponible. No inventes precios fuera de este resultado.',
  };
}

function currentMonthRangeYmd() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { fechaInicio: ymd(start), fechaFin: ymd(now) };
}

async function getRiesgosOportunidades(args = {}) {
  const range = resolveRiesgosPeriodo(args);
  const { fechaInicio, fechaFin } = range;

  const [overview, inventory, alertas, directivo] = await Promise.all([
    getOverview({ fechaInicio, fechaFin }).catch((err) => ({ error: err.message })),
    getInventory({ planPisoPeriod: 'all' }).catch((err) => ({ error: err.message })),
    buildOperationalAlerts().catch(() => []),
    getExecutiveRecommendations({ fechaInicio, fechaFin }).catch((err) => ({ available: false, reason: err.message })),
  ]);

  const insights = [];
  if (!overview?.error) {
    insights.push(...buildInsights({
      module: 'overview',
      fechaInicio,
      fechaFin,
      financial: overview.financial,
      operaciones: overview.operaciones,
      analytics: overview.analytics || overview.salesAnalytics,
      salesAnalytics: overview.salesAnalytics || overview.analytics,
    }));
  }
  if (!inventory?.error) {
    insights.push(...buildInsights({
      module: 'inventory',
      summary: inventory.summary,
      postventa: inventory.postventa,
    }));
  }
  if (directivo?.available) {
    for (const rec of directivo.recomendaciones || []) {
      if (rec.prioridad > 2) continue;
      insights.push({
        module: 'ventas',
        severity: rec.prioridad === 1 ? 'critical' : 'warning',
        title: rec.titulo,
        summary: rec.porQue,
        analysis: directivo.diagnosticoEjecutivo,
        recommendations: [rec.accion],
      });
    }
  }

  const rank = { critical: 3, warning: 2, info: 1 };
  const riesgos = insights
    .filter((i) => i.severity === 'critical' || i.severity === 'warning')
    .sort((a, b) => (rank[b.severity] || 0) - (rank[a.severity] || 0))
    .slice(0, 8)
    .map((i) => shapeInsight(i, 'riesgo'));

  const oportunidades = [];
  const seen = new Set();
  for (const insight of insights) {
    for (const rec of insight.recommendations || []) {
      const key = String(rec).trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      oportunidades.push({
        tipo: 'oportunidad',
        severity: 'info',
        modulo: insight.module || null,
        titulo: `Acción: ${insight.title}`,
        resumen: rec,
        origen: insight.summary,
      });
      if (oportunidades.length >= 8) break;
    }
    if (oportunidades.length >= 8) break;
  }

  // Señales positivas del tablero cuando el KPI está sano
  const f = overview?.financial || {};
  const ops = overview?.operaciones || {};
  const sales = f.sales || {};
  const service = f.service || {};
  const inv = f.inventory || inventory?.summary || {};
  if (Number(sales.marginPct) >= 10) {
    oportunidades.unshift({
      tipo: 'oportunidad',
      severity: 'info',
      modulo: 'overview',
      titulo: 'Margen bruto saludable',
      resumen: `Margen ${Number(sales.marginPct).toFixed(1)}% en el periodo — sostener disciplina de precio/descuento.`,
    });
  }
  if (Number(service.pctFacturado) >= 70) {
    oportunidades.unshift({
      tipo: 'oportunidad',
      severity: 'info',
      modulo: 'overview',
      titulo: 'Buena conversión de taller a factura',
      resumen: `${Number(service.pctFacturado).toFixed(1)}% de órdenes facturadas — replicar ritmo de cierre.`,
    });
  }
  if (Number(ops.unidadesVendidas ?? sales.units) > 0 && Number(inv.sinPrevias || 0) === 0) {
    oportunidades.unshift({
      tipo: 'oportunidad',
      severity: 'info',
      modulo: 'inventory',
      titulo: 'Stock con previas al día',
      resumen: 'No hay disponibles sin previa — ventaja operativa para entregas limpias.',
    });
  }

  const alertasOp = (alertas || []).slice(0, 10).map((a) => ({
    severity: a.severity,
    titulo: a.title,
    mensaje: a.message,
    tipo: a.type,
    href: a.href,
  }));

  return {
    periodo: range,
    totales: {
      riesgos: riesgos.length,
      oportunidades: Math.min(oportunidades.length, 8),
      alertasOperativas: alertasOp.length,
    },
    riesgos,
    oportunidades: oportunidades.slice(0, 8),
    alertasOperativas: alertasOp,
    kpisRapidos: overview?.error ? { error: overview.error } : {
      unidadesVendidas: Number(ops.unidadesVendidas ?? sales.units ?? 0),
      entregasSofia: Number(ops.entregasSofia ?? 0),
      entregasSinPrevias: Number(ops.entregasSinPrevias ?? 0),
      sinTimbrar: Number(ops.sinTimbrar ?? 0),
      margenPct: Number(sales.marginPct ?? 0),
      inventarioDisponible: Number(inv.availableUnits ?? inv.available ?? 0),
      sinPreviasStock: Number(inv.sinPrevias ?? 0),
      envejecidas: Number(inv.ageingAlertsCount ?? 0),
      planPiso: Number(inv.planPisoTotal ?? 0),
      pctFacturadoTaller: Number(service.pctFacturado ?? 0),
    },
    instruccionRespuesta:
      'Lista 1) Riesgos (críticos primero) con cifra + por qué importa + 1 acción. '
      + '2) Oportunidades / acciones de mejora. 3) Cierra con las 3 prioridades de la semana. '
      + 'No digas que no tienes acceso: estos datos ya están en la herramienta.',
  };
}

async function executeTool(name, args = {}, context = {}) {
  let result;
  const username = context.username || null;
  const roleId = context.roleId || null;

  switch (name) {
    case 'consultar_ventas_modelo':
      result = await getVentasPorModelo(args);
      break;
    case 'consultar_ventas':
      result = await getVentas(args);
      break;
    case 'consultar_ventas_por_auto':
      result = await getVentasPorAuto(args);
      break;
    case 'consultar_resumen_ejecutivo':
      result = await getOverview(args);
      break;
    case 'consultar_analytics_ventas':
      result = await loadSalesExecutiveAnalytics(args);
      break;
    case 'consultar_inventario':
      result = await getInventory({ planPisoPeriod: args.planPisoPeriod || 'all' });
      break;
    case 'consultar_inventario_postventa': {
      const raw = await getInventoryPostventa();
      const area = String(args.area || 'todas').toLowerCase();
      if (area === 'todas' || !raw.areas?.[area]) {
        result = raw;
      } else {
        result = {
          fuente: raw.fuente,
          area: raw.areas[area],
          overview: raw.overview,
        };
      }
      break;
    }
    case 'consultar_memoria_perfil': {
      const access = resolveAiAccess(roleId);
      const playbook = getProfilePlaybook(roleId);
      const memory = getUserMemory(username);
      result = {
        perfil: {
          id: roleId,
          label: access.roleLabel,
          pages: access.pages,
          fullAccess: access.fullAccess,
        },
        playbook,
        memoriaUsuario: {
          preferences: memory.preferences || {},
          facts: memory.facts || [],
          notes: memory.notes || '',
          updatedAt: memory.updatedAt,
        },
        instruccion:
          'Adapta el razonamiento y la respuesta al playbook del perfil y a la memoria del usuario. '
          + 'Prioriza KPIs y lente de decisión del rol.',
      };
      break;
    }
    case 'actualizar_memoria_usuario': {
      const accion = String(args.accion || '').toLowerCase();
      if (!username) {
        result = { error: 'No hay usuario en sesión para guardar memoria.' };
        break;
      }
      if (accion === 'limpiar') {
        result = { ok: true, ...(clearUserMemory(username)), mensaje: 'Memoria del usuario borrada.' };
        break;
      }
      if (accion === 'preferencia') {
        const mem = rememberPreference(username, args.clave, args.valor);
        result = {
          ok: true,
          mensaje: `Preferencia guardada: ${args.clave} = ${args.valor}`,
          memoria: { preferences: mem.preferences, facts: mem.facts },
        };
        break;
      }
      if (accion === 'hecho') {
        const mem = rememberFact(username, {
          key: args.clave,
          value: args.valor,
          category: args.categoria || 'general',
        });
        result = {
          ok: true,
          mensaje: `Hecho recordado: ${args.valor}`,
          memoria: { preferences: mem.preferences, facts: mem.facts },
        };
        break;
      }
      result = { error: 'accion debe ser preferencia | hecho | limpiar' };
      break;
    }
    case 'consultar_refacciones': {
      const range = (args.fechaInicio && args.fechaFin)
        ? { fechaInicio: args.fechaInicio, fechaFin: args.fechaFin }
        : currentMonthRangeYmd();
      result = await getRefaccionesDashboard(range);
      break;
    }
    case 'consultar_roles_acceso':
      result = getRolesAcceso({ rol: args.rol || null });
      break;
    case 'consultar_postventa':
      result = await getPostSales({
        fechaInicio: args.fechaInicio,
        fechaFin: args.fechaFin,
        area: args.area || 'posventa',
        estatus: args.estatus || 'todas',
        tipo: args.tipo || null,
      });
      break;
    case 'consultar_lista_precios':
      result = await shapeListaPreciosForAi(args);
      break;
    case 'consultar_contabilidad':
      result = await getContabilidad(args);
      break;
    case 'consultar_ventas_dia':
      result = await loadDailySalesUnits({ fecha: args.fecha });
      break;
    case 'consultar_pronostico':
      result = shapeForecastForAi(await getForecast({ horizon: args.horizon }));
      break;
    case 'consultar_objetivos_ventas': {
      const goals = getGoals(args);
      let avance = null;
      try {
        if (args.fechaInicio && args.fechaFin) {
          const ventas = await getVentas({
            fechaInicio: args.fechaInicio,
            fechaFin: args.fechaFin,
          });
          const r = ventas?.resumen || {};
          avance = {
            retail: r.totalRetail ?? null,
            total: r.totalVentas ?? null,
            flotilla: r.totalFlotillas ?? null,
          };
        }
      } catch (_) {
        avance = null;
      }
      result = { ...goals, avance };
      break;
    }
    case 'consultar_quejas_csi':
      result = crmCiclos.getQuejasCsiSummary({
        persona: args.persona || null,
        rol: args.rol || 'auto',
        fuente: args.fuente || 'todas',
        tipoIncidencia: args.tipoIncidencia || 'quejas',
        periodo: args.periodo || null,
        fechaInicio: args.fechaInicio || null,
        fechaFin: args.fechaFin || null,
        area: args.area || null,
        limit: Math.min(50, Math.max(5, Number(args.limit) || 25)),
      });
      break;
    case 'buscar_cliente_crm':
      result = { resultados: crmCiclos.searchContacts(args) };
      break;
    case 'historico_cliente_crm':
      result = await crmCiclos.getContactHistory(args.idContacto, {
        enrichSql: true,
        fechaInicio: args.fechaInicio || null,
        fechaFin: args.fechaFin || null,
      });
      break;
    case 'resumen_leads': {
      if (args.listar === 'citas_sin_compra' || args.listar === 'sin_compra') {
        const rango = crmCiclos.resolveCrmPeriod
          ? crmCiclos.resolveCrmPeriod({
            periodo: args.periodo || 'mes_actual',
            desde: args.desde || null,
            hasta: args.hasta || null,
          })
          : null;
        const dash = crmCiclos.getLeadsDashboard({
          fechaInicio: args.desde || rango?.desde || null,
          fechaFin: args.hasta || rango?.hasta || null,
          limit: Math.min(400, Math.max(50, Number(args.limit) || 200)),
        });
        const detalle = (dash.detalle || []).filter((d) => {
          if (args.listar === 'citas_sin_compra') return d.cita && !d.conCompra;
          return !d.conCompra;
        }).slice(0, Math.min(50, Number(args.limit) || 30));
        result = {
          filtros: dash.filtros,
          listar: args.listar,
          summary: dash.summary,
          totalListado: detalle.length,
          detalle,
          nota: args.listar === 'citas_sin_compra'
            ? 'Oportunidades con cita programada y sin VIN de compra vinculado.'
            : 'Leads del periodo sin compra vinculada.',
        };
      } else {
        result = crmCiclos.getLeadsSummary(args);
      }
      break;
    }
    case 'resumen_seguimiento_360':
      result = crmCiclos.getSeguimiento360Summary(args);
      break;
    case 'listar_vendedores_360':
      result = {
        vendedores: crmCiclos.listVendedores({
          q: args.q || '',
          limit: Math.min(100, Math.max(1, Number(args.limit) || 50)),
        }),
      };
      break;
    case 'resumen_vendedor_360': {
      const raw = await crmCiclos.getVendedorResumen({
        vendedor: args.vendedor,
        fechaInicio: args.fechaInicio || null,
        fechaFin: args.fechaFin || null,
        limit: Math.min(80, Math.max(1, Number(args.limit) || 50)),
      });
      const fin = raw.comercial?.financiamiento || {};
      const pvas = fin.pvas || {};
      const libro = raw.comercial?.libroVentas || {};
      const retorno = raw.comercial?.retornoTaller || {};
      result = {
        vendedor: raw.vendedor,
        periodo: raw.periodo,
        totales: raw.totales,
        desempenoComercial: {
          unidadesVendidas: Number(libro.unidades || 0),
          fuenteUnidades: libro.fuente || null,
          contratosFi: Number(fin.contratos || 0),
          matchFinanciamiento: fin.match || null,
          montoPromedioFinanciar: fin.montoFinanciarPromedio ?? null,
          plazoPromedioMeses: fin.plazoPromedio ?? null,
          plazos: fin.plazos || [],
          promedioCantidadPvasPorContrato: pvas.promedioCantidadPvas ?? null,
          penetracionPvasPct: pvas.penetracionPct ?? null,
          pvasPorTipo: pvas.porTipo || [],
          retornoTallerPct: retorno.tasaRetornoPct ?? null,
          retornoBase: retorno.base || null,
          ordenesTaller: retorno.ordenes ?? 0,
        },
        quejasCsi: raw.quejasCsi || null,
        libroVentas: {
          unidades: Number(libro.unidades || 0),
          fuente: libro.fuente || null,
          porTipoPago: libro.sql?.porTipoPago || libro.crm?.porTipoPago || [],
          muestra: (libro.sql?.muestra?.length ? libro.sql.muestra : (libro.crm?.muestra || [])).slice(0, 10),
        },
        clientes: (raw.clientes || []).slice(0, 25).map((c) => ({
          id_contacto: c.id_contacto,
          nombre: c.nombre,
          ciclos: c.ciclos,
          leads: c.leads,
          solicitudes: c.solicitudes,
          pruebas: c.pruebas,
          compras: c.compras,
          ultima_actividad: c.ultima_actividad,
        })),
        nota:
          'Unidades vendidas = libro ADE_VTAFI cuando hay match. '
          + 'Promedio PVAs = cantidad de productos con monto > 0 por contrato (no monto monetario). '
          + 'Quejas CSI: asesor de servicio en CSI Posventa y ejecutivo/vendedor en CSI Ventas.',
      };
      break;
    }
    case 'consultar_financiamiento':
      result = getFinanciamientoAiAnalysis({
        periodo: args.periodo || null,
        fechaInicio: args.fechaInicio || null,
        fechaFin: args.fechaFin || null,
        modalidad: args.modalidad || 'todos',
        limit: Math.min(25, Math.max(1, Number(args.limit) || 10)),
      });
      break;
    case 'consultar_utilidad_carline':
      result = await getUtilidadPorCarlineAiAnalysis({
        periodo: args.periodo || null,
        fechaInicio: args.fechaInicio || null,
        fechaFin: args.fechaFin || null,
        carline: args.carline || null,
        metric: args.metric || 'utilidad_promedio',
        minUnidades: Math.min(20, Math.max(1, Number(args.minUnidades) || 1)),
      });
      break;
    case 'consultar_recomendaciones_directivas':
      result = await getExecutiveRecommendations({
        periodo: args.periodo || 'mes_actual',
        fechaInicio: args.fechaInicio || null,
        fechaFin: args.fechaFin || null,
      });
      break;
    case 'consultar_riesgos_oportunidades':
      result = await getRiesgosOportunidades({
        periodo: args.periodo || 'semana_actual',
        fechaInicio: args.fechaInicio || null,
        fechaFin: args.fechaFin || null,
      });
      break;
    case 'generar_excel':
      result = await generateExcelExport(args);
      break;
    case 'listar_tablas_bd':
      result = await listTables(args);
      break;
    case 'describir_tabla':
      result = await describeTable(args);
      break;
    case 'ejecutar_consulta_sql':
      result = await executeReadOnlySql(args);
      break;
    default:
      throw new Error(`Herramienta desconocida: ${name}`);
  }

  if (name === 'generar_excel') return result;
  return trimForAi(result);
}

module.exports = {
  TOOL_DEFINITIONS,
  executeTool,
  trimForAi,
};
