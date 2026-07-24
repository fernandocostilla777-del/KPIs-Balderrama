const OpenAI = require('openai');
const mobileData = require('./mobileData');
const { roleTools, canUseTool, getRoleScope } = require('./mobileRoles');

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_MESSAGES = 12;
const MAX_TOOL_ROUNDS = 4;

const TOOL_META = {
  resumen_ejecutivo: {
    description: 'Resumen ejecutivo del periodo: ventas, inventario, servicio y cobertura SOFIA.',
    mapsTo: 'overview',
  },
  consultar_ventas: {
    description: 'KPIs y desglose de ventas del periodo (unidades, canales, top modelos/vendedores).',
    mapsTo: 'ventas',
  },
  consultar_inventario: {
    description: 'Inventario disponible, valor y antigüedad.',
    mapsTo: 'inventory',
  },
  consultar_postventa: {
    description: 'Órdenes de taller / postventa e importes facturados.',
    mapsTo: 'post-sales',
  },
  consultar_contabilidad: {
    description: 'Indicadores contables / EEFF del periodo sincronizado.',
    mapsTo: 'contabilidad',
  },
  consultar_pronostico: {
    description: 'Pronóstico de ventas (proyección del periodo).',
    mapsTo: 'forecast',
  },
  consultar_seguimiento: {
    description: 'Seguimiento 360: leads, solicitudes F&I, pruebas, conversiones y PVAs.',
    mapsTo: 'seguimiento',
  },
};

function isConfigured() {
  return Boolean(String(process.env.OPENAI_API_KEY || '').trim());
}

function getClient() {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY no está configurada en cloud-api');
  return new OpenAI({ apiKey });
}

function buildToolDefinitions(allowedTools) {
  return allowedTools.map((name) => ({
    type: 'function',
    function: {
      name,
      description: TOOL_META[name]?.description || name,
      parameters: {
        type: 'object',
        properties: {
          periodo: {
            type: 'string',
            description: 'Periodo YYYY-MM (opcional). Vacío = último disponible.',
          },
        },
      },
    },
  }));
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
  return trimPayload(await mobileData.getMetricsSection(meta.mapsTo, period));
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

  // unique by label
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
    'Eres el asistente ejecutivo BALDERRAMA para la app móvil.',
    `Usuario: ${user.username}. Rol: ${scope.label} (${user.role}).`,
    `Solo puedes usar estas herramientas: ${tools.join(', ') || 'ninguna'}.`,
    'Los datos vienen del sync en la nube (PostgreSQL), no del SQL Server en vivo.',
    '',
    'REGLAS DE RESPUESTA (móvil — máximo resumen):',
    '1. Responde SIEMPRE en español.',
    '2. Máximo 5 líneas o 3 viñetas. Sin secciones ###. Sin párrafos largos.',
    '3. Empieza con el hallazgo principal en 1 frase.',
    '4. Luego 2–3 cifras clave. Cierra con 1 acción sugerida si aplica.',
    '5. No listes tablas completas ni rankings largos; solo el top 1–2.',
    '6. Si el usuario pide algo fuera de su rol, dilo en 1 frase y ofrece lo que sí puede ver.',
    '7. No inventes cifras: usa herramientas antes de afirmar números.',
    `8. Hoy es ${new Date().toISOString().slice(0, 10)}.`,
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
      temperature: 0.2,
      max_tokens: 350,
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

  // Compactar respuesta: máximo ~700 chars
  if (reply.length > 700) {
    reply = `${reply.slice(0, 697)}…`;
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
};
