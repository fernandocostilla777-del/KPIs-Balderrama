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
      description: 'Cuenta unidades vendidas de un modelo específico (ej. Aveo, Onix, Tahoe) en un periodo. Relaciona ADE_VTAFI + SER_VEHICULO por serie. Usar cuando pregunten cuántos/se vendieron de un modelo, marca o familia.',
      parameters: {
        type: 'object',
        properties: {
          modelo: { type: 'string', description: 'Nombre o fragmento del modelo (ej. Aveo, ONIX)' },
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
      description: 'Inventario de vehículos nuevos, seminuevos y plan piso.',
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
      name: 'consultar_postventa',
      description:
        'Post-venta / taller: órdenes de Servicio o HyP. '
        + 'OBLIGATORIO usar area="hyp" para hojalatería y pintura (folios A,F,H,J,V,Z,Ó) '
        + 'y area="servicio" para órdenes de servicio (C,D,G,I,K,N,O,Q,S,X,Y,Á,M,E,R). '
        + 'Para abiertas usa estatus="abiertas". '
        + 'Ejemplo: “órdenes HyP abiertas de 2025” → area=hyp, estatus=abiertas, fechaInicio=2025-01-01, fechaFin=2025-12-31. '
        + 'Responde con resumen.totalFiltrado o resumen.abiertasEnPeriodo; NUNCA uses un total global sin filtrar área.',
      parameters: {
        type: 'object',
        properties: {
          fechaInicio: { type: 'string', description: 'Fecha inicio YYYY-MM-DD' },
          fechaFin: { type: 'string', description: 'Fecha fin YYYY-MM-DD' },
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
        },
        required: ['fechaInicio', 'fechaFin'],
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
        + 'El periodo filtra la fecha de entrada del lead y la compra vinculada puede ser posterior. Para periodos relativos usa periodo.',
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
          limit: { type: 'string', description: 'Máximo de grupos (default 30)' },
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
        + 'fuente=postventa (con area hyp|servicio|posventa y estatus) | ventas | inventario | manual. '
        + 'Para postventa/ventas siempre pasa fechaInicio y fechaFin. '
        + 'NO inventes filas: esta herramienta consulta la base y arma el archivo. '
        + 'Después de usarla, dile al usuario que use el botón de descarga del chat.',
      parameters: {
        type: 'object',
        properties: {
          fuente: {
            type: 'string',
            description: 'Origen de datos',
            enum: ['postventa', 'ventas', 'inventario', 'manual'],
          },
          fechaInicio: { type: 'string', description: 'YYYY-MM-DD (postventa/ventas)' },
          fechaFin: { type: 'string', description: 'YYYY-MM-DD (postventa/ventas)' },
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
          filename: { type: 'string', description: 'Nombre sugerido del archivo, ej. hyp_abiertas_2025.xlsx' },
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

async function executeTool(name, args = {}) {
  let result;

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
    case 'consultar_postventa':
      result = await getPostSales({
        fechaInicio: args.fechaInicio,
        fechaFin: args.fechaFin,
        area: args.area || 'posventa',
        estatus: args.estatus || 'todas',
      });
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
    case 'resumen_leads':
      result = crmCiclos.getLeadsSummary(args);
      break;
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
