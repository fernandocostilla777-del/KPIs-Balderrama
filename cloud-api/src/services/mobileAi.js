const OpenAI = require('openai');
const mobileData = require('./mobileData');
const { roleTools, canUseTool, getRoleScope } = require('./mobileRoles');
const { buildSharedIdentity } = require('../config/aiReasoningPrompt');

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_MESSAGES = 12;
const MAX_TOOL_ROUNDS = 8;

/** Nombres alineados con el asistente web (misma intención / mismo razonamiento). */
const TOOL_META = {
  consultar_resumen_ejecutivo: {
    description:
      'Resumen ejecutivo consolidado del periodo: ventas, inventario, servicio/postventa y cobertura SOFIA.',
    mapsTo: 'overview',
  },
  consultar_ventas: {
    description:
      'Consulta ventas: totales, canales, top modelos/vendedores del periodo sincronizado.',
    mapsTo: 'ventas',
  },
  consultar_inventario: {
    description: 'Inventario disponible, valor y antigüedad.',
    mapsTo: 'inventory',
  },
  consultar_postventa: {
    description:
      'Órdenes de taller / postventa. OBLIGATORIO usar area="hyp" para HyP/hojalatería '
      + '(folios A,F,H,J,V,Z,Ó) y area="servicio" para taller. '
      + 'Para abiertas usa estatus="abiertas". '
      + 'Ejemplo: “órdenes HyP abiertas” → area=hyp, estatus=abiertas. '
      + 'Responde con kpis Abiertas o hero.value; no digas que no tienes acceso si la tool funciona.',
    mapsTo: 'post-sales',
  },
  consultar_contabilidad: {
    description: 'Contabilidad / EEFF del periodo sincronizado: márgenes, gastos, utilidad.',
    mapsTo: 'contabilidad',
  },
  consultar_pronostico: {
    description:
      'Pronóstico de ventas / proyección / forecast (misma lógica que la página Pronóstico). '
      + 'Usar para “próximo mes”, horizonte o unidades futuras.',
    mapsTo: 'forecast',
  },
  resumen_seguimiento_360: {
    description:
      'Seguimiento 360 agregado: leads, solicitudes F&I, pruebas, conversiones y PVAs del periodo.',
    mapsTo: 'seguimiento',
  },
};

const MOBILE_CHANNEL_RULES = `
## Canal móvil (mismos criterios que web; datos sync)
- Fuente: sync PostgreSQL en la nube (snapshot), no SQL Server en vivo. Indica periodo sincronizado si aporta.
- En ### Resultado: sé conciso (hallazgo + 2–4 cifras + 1 acción), pero **no omitas** ### Razonamiento.
- No inventes tools de CRM 360, Excel o SQL si no están en tu lista.
- Leads / F&I / pruebas → resumen_seguimiento_360.
- Ventas generales → consultar_ventas; overview → consultar_resumen_ejecutivo.
- No digas “no tengo acceso a HyP” si puedes llamar consultar_postventa con area=hyp.
`;

function isConfigured() {
  return Boolean(String(process.env.OPENAI_API_KEY || '').trim());
}

function getClient() {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY no está configurada en cloud-api');
  return new OpenAI({ apiKey });
}

function buildToolDefinitions(allowedTools) {
  return allowedTools.map((name) => {
    const properties = {
      periodo: {
        type: 'string',
        description: 'Periodo YYYY-MM (opcional). Vacío = último disponible. También acepta mes_pasado / ultimos_90_dias si aplica.',
      },
      fechaInicio: { type: 'string', description: 'Fecha inicio YYYY-MM-DD (opcional)' },
      fechaFin: { type: 'string', description: 'Fecha fin YYYY-MM-DD (opcional)' },
    };

    if (name === 'consultar_postventa') {
      properties.area = {
        type: 'string',
        description: 'Área PostVenta: hyp | servicio | posventa (default posventa = ambas)',
        enum: ['hyp', 'servicio', 'posventa'],
      };
      properties.estatus = {
        type: 'string',
        description: 'Filtro de estatus: abiertas | facturadas | canceladas | todas',
        enum: ['abiertas', 'facturadas', 'canceladas', 'todas'],
      };
    }

    return {
      type: 'function',
      function: {
        name,
        description: TOOL_META[name]?.description || name,
        parameters: {
          type: 'object',
          properties,
        },
      },
    };
  });
}

function trimPayload(value, depth = 0) {
  if (value == null || depth > 4) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((item) => trimPayload(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out = {};
    const entries = Object.entries(value).slice(0, 24);
    for (const [key, val] of entries) {
      if (key === 'seguimiento' && depth > 0) continue;
      out[key] = trimPayload(val, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 180) return `${value.slice(0, 180)}…`;
  return value;
}

async function executeMobileTool(name, args = {}) {
  const period = args.periodo || args.fechaInicio || null;
  const meta = TOOL_META[name];
  if (!meta) return { error: `Herramienta desconocida: ${name}` };

  if (meta.mapsTo === 'overview') {
    return trimPayload(await mobileData.getLatestOverview(period));
  }

  const options = {};
  if (meta.mapsTo === 'post-sales') {
    if (args.area) options.area = args.area;
    if (args.estatus) options.estatus = args.estatus;
  }

  return trimPayload(await mobileData.getMetricsSection(meta.mapsTo, period, options));
}

function extractHighlights(toolResult) {
  if (!toolResult || toolResult.error) return [];
  const items = [];

  if (Array.isArray(toolResult.kpis)) {
    for (const kpi of toolResult.kpis.slice(0, 4)) {
      items.push({
        label: String(kpi.label || 'KPI'),
        value: kpi.suffix
          ? `${Number(kpi.value || 0).toLocaleString('es-MX')}${kpi.suffix}`
          : kpi.money
            ? formatMoney(kpi.value)
            : Number(kpi.value || 0).toLocaleString('es-MX'),
      });
    }
  }

  const hero = toolResult.hero;
  if (hero?.label != null && items.length < 4) {
    items.unshift({
      label: String(hero.label),
      value: hero.money
        ? formatMoney(hero.value)
        : Number(hero.value || 0).toLocaleString('es-MX'),
    });
  }

  const fin = toolResult.financial || {};
  const sales = fin.sales || {};
  if (sales.units != null && items.length < 4) {
    items.push({ label: 'Unidades', value: Number(sales.units).toLocaleString('es-MX') });
  }
  if (sales.revenue != null && items.length < 4) {
    items.push({ label: 'Ingreso', value: formatMoney(sales.revenue) });
  }

  const sofia = toolResult.sofia || {};
  if (sofia.coberturaPct != null && items.length < 4) {
    items.push({ label: 'Cobertura', value: `${Number(sofia.coberturaPct).toFixed(1)}%` });
  }

  const seen = new Set();
  return items.filter((item) => {
    const key = item.label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4);
}

function formatMoney(n) {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${Math.round(v).toLocaleString('es-MX')}`;
}

function buildSystemPrompt(user) {
  const scope = getRoleScope(user.role);
  const tools = roleTools(user.role);
  return [
    buildSharedIdentity({
      channel: 'mobile',
      roleNote: `Usuario: ${user.username}. Rol: ${scope.label} (${user.role}).`,
      dataSourceNote: 'Fuente de datos: sync en la nube (PostgreSQL). Mismos criterios de negocio que el asistente web.',
      toolsList: tools.join(', ') || 'ninguna',
    }),
    MOBILE_CHANNEL_RULES,
  ].join('\n');
}

function sanitizeMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .slice(-MAX_MESSAGES)
    .map((m) => ({
      role: m.role,
      content: String(m.content).slice(0, 2000),
    }));
}

async function runMobileChat({ messages, user }) {
  if (!isConfigured()) {
    const err = new Error('Asistente no configurado: falta OPENAI_API_KEY en cloud-api');
    err.status = 503;
    throw err;
  }

  const allowedTools = roleTools(user.role);
  const toolDefs = buildToolDefinitions(allowedTools);
  const history = sanitizeMessages(messages);
  if (!history.length || history[history.length - 1].role !== 'user') {
    const err = new Error('El último mensaje debe ser del usuario');
    err.status = 400;
    throw err;
  }

  const client = getClient();
  const openaiMessages = [
    { role: 'system', content: buildSystemPrompt(user) },
    ...history,
  ];

  const toolsUsed = [];
  const highlights = [];
  let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let reply = '';

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: openaiMessages,
      tools: toolDefs.length ? toolDefs : undefined,
      tool_choice: toolDefs.length ? 'auto' : undefined,
      temperature: 0.35,
      max_tokens: 900,
    });

    const u = response.usage || {};
    usage = {
      prompt_tokens: usage.prompt_tokens + (u.prompt_tokens || 0),
      completion_tokens: usage.completion_tokens + (u.completion_tokens || 0),
      total_tokens: usage.total_tokens + (u.total_tokens || 0),
    };

    const choice = response.choices?.[0]?.message;
    if (!choice) break;

    const toolCalls = choice.tool_calls || [];
    if (!toolCalls.length) {
      reply = String(choice.content || '').trim();
      break;
    }

    openaiMessages.push({
      role: 'assistant',
      content: choice.content || null,
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      const name = call.function?.name;
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || '{}');
      } catch {
        args = {};
      }

      let result;
      if (!canUseTool(user.role, name)) {
        result = {
          error: `Tu rol (${user.role}) no tiene acceso a ${name}.`,
          permitido: allowedTools,
        };
      } else {
        try {
          result = await executeMobileTool(name, args);
          toolsUsed.push(name);
          for (const h of extractHighlights(result)) {
            if (highlights.length < 4) highlights.push(h);
          }
        } catch (err) {
          result = { error: err.message || 'Error al consultar datos sync' };
        }
      }

      openaiMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 12000),
      });
    }
  }

  if (!reply) {
    reply = 'No pude generar un resumen. Intenta de nuevo con una pregunta más concreta.';
  }

  if (reply.length > 2200) {
    reply = `${reply.slice(0, 2197)}…`;
  }

  return {
    reply,
    highlights,
    toolsUsed: [...new Set(toolsUsed)],
    scope: {
      role: user.role,
      roleLabel: getRoleScope(user.role).label,
      tools: allowedTools,
    },
    usage,
    model: DEFAULT_MODEL,
    source: 'cloud-sync',
  };
}

module.exports = {
  isConfigured,
  runMobileChat,
  DEFAULT_MODEL,
  buildSystemPrompt,
};
