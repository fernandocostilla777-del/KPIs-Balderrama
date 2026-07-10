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
      description: 'Post-venta y servicio: órdenes ingresadas/facturadas, importes, tipos de orden y desempeño.',
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
      description: 'Pronóstico de ventas futuras basado en el modelo del dashboard.',
      parameters: {
        type: 'object',
        properties: {
          horizon: { type: 'string', description: 'Horizonte opcional del pronóstico' },
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

async function executeTool(name, args = {}) {
  let result;

  switch (name) {
    case 'consultar_ventas':
      result = await getVentas(args);
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
      result = await getPostSales(args);
      break;
    case 'consultar_contabilidad':
      result = await getContabilidad(args);
      break;
    case 'consultar_ventas_dia':
      result = await loadDailySalesUnits({ fecha: args.fecha });
      break;
    case 'consultar_pronostico':
      result = await getForecast({ horizon: args.horizon });
      break;
    case 'consultar_objetivos_ventas':
      result = getGoals(args);
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

  return trimForAi(result);
}

module.exports = {
  TOOL_DEFINITIONS,
  executeTool,
  trimForAi,
};
