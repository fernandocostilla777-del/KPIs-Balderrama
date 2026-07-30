const OpenAI = require('openai');
const { TOOL_DEFINITIONS, executeTool } = require('./aiTools');
const { buildVisualizations } = require('./aiVisualizations');
const { AI_DATA_MODEL } = require('../config/aiDataModel');
const { buildSharedIdentity } = require('../config/aiReasoningPrompt');
const { generateExcelExport } = require('./aiExcelExport');
const { resolveNomenclatura, NOMENCLATURA_GRUPOS, stripAccents } = require('./postSalesOrderTypes');
const {
  filterToolDefinitions,
  isToolAllowedForRole,
  buildRoleScopeNote,
  resolveAiAccess,
} = require('./aiRoleAccess');

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_TOOL_ROUNDS = 10;

const EXCEL_INTENT_RE = /excel|xlsx|descargar|exportar|spreadsheet|hoja\s+de\s+c[aá]lculo|archivo\s+descargable|pasame\s+(el\s+)?listado|pásame\s+(el\s+)?listado|dame\s+(en\s+)?(un\s+)?excel|en\s+(un\s+)?excel/i;

const WEB_MODULE_RULES = `
## Módulos disponibles (herramientas web · SQL Server / CRM en vivo)
- Ventas por modelo específico (Aveo, Onix…) → consultar_ventas_modelo
- Ventas por auto/modelo con detalle por unidad (serie, color, vendedor, utilidad) → consultar_ventas_por_auto
- Ventas generales, canales, vendedores → consultar_ventas
- Resumen ejecutivo → consultar_resumen_ejecutivo
- Analytics ventas → consultar_analytics_ventas
- Inventario y plan piso → consultar_inventario
- Post-venta → consultar_postventa
- **Excel / XLSX / descargar listado** → generar_excel (después de consultar o con los mismos filtros)
- Contabilidad / EEFF → consultar_contabilidad
- **Pronóstico de ventas / proyección / forecast** → consultar_pronostico (misma fuente que la página Pronóstico)
- Objetivos de ventas → consultar_objetivos_ventas
- **Clientes / CRM 360°** → buscar_cliente_crm y luego historico_cliente_crm
- **Leads / interesados (agregado)** → resumen_leads (acepta periodo=mes_pasado)
- **Seguimiento 360 agregado** → resumen_seguimiento_360
- **Seguimiento 360 · por vendedor** → listar_vendedores_360 y resumen_vendedor_360
- **Quejas / incidencias CSI** → consultar_quejas_csi
- **Financiamiento F&I (crédito vs leasing)** → consultar_financiamiento
- **Utilidad / margen bruto por carline (mejor versión)** → consultar_utilidad_carline
- SQL exploratorio solo si nada más cubre la pregunta

## Reglas adicionales (solo web)
4. Conteo por modelo/marca → **consultar_ventas_modelo** (YTD del año en curso si no dan fechas).
4b. Detalle por unidad (serie, color, vendedor, utilidad) → **consultar_ventas_por_auto**.
5. Ventas generales del periodo → consultar_ventas o consultar_resumen_ejecutivo.
6. Pronóstico: responde con KPIs (último mes real, próximo mes, horizonte, MAPE) y serie mensual.
6b. Cliente / CRM 360° → buscar_cliente_crm → historico_cliente_crm. Balderrama Ciclos = fuente maestra (ID_CONTACTO = ID CRM). Empieza con ficha360.
6b.1. Precisión CRM: mensualidades/saldo/valor estimado; menciona “estimado”. PVAs solo de contratosFinanciamiento[].pvas.
6c. Leads agregados → resumen_leads. “Mes pasado” → periodo: mes_pasado. “Compras” = conversión de cohorte, no total DMS.
6d. Solicitudes F&I / pruebas / combo 360 → resumen_seguimiento_360.
6d.1. **Contratos F&I crédito vs leasing** → consultar_financiamiento. Leasing ≠ crédito. Sin periodo → mes_actual. Ofrece trimestre/semestre/YTD.
6d.2. **Mejor utilidad por carline** → consultar_utilidad_carline. Responde versión completa + margen bruto %. Sin periodo → mes_actual. Ofrece trimestre/semestre/YTD.
6e. Relaciones 360: lead G, solicitud H, prueba P → ID CRM; compra ciclos → VIN columna T.
6f. Leads vs ventas: conversión → resumen_leads/360; vs totales → cifras independientes (no llames conversión al cociente ventas/leads).
6g. Por vendedor → listar_vendedores_360 + resumen_vendedor_360. Unidades = comercial.libroVentas.unidades (ADE_VTAFI).
6g.1. Quejas CSI → consultar_quejas_csi (asesor_servicio vs vendedor).
6h. Contabilidad: margen bruto, gastos 0700, utilidad, PE; diagnóstico + acciones si hay pérdida.
6i. Ventas: ritmo vs calendario; alertas accionables si van atrás.
6k. Excel: si piden descargar, DEBES llamar generar_excel. No digas que no puedes generar archivos.
7. Solo usa ejecutar_consulta_sql si ninguna herramienta cubre la pregunta.
8. Visualizaciones: el sistema monta KPIs/gráficas; no dupliques listados largos; resume hallazgo + 1–2 acciones.
`;

function buildWebSystemPrompt({ roleId = null, username = null } = {}) {
  const access = resolveAiAccess(roleId);
  const toolsForPrompt = access.allowedTools == null
    ? TOOL_DEFINITIONS
    : filterToolDefinitions(TOOL_DEFINITIONS, roleId);
  const toolsList = toolsForPrompt
    .map((t) => t?.function?.name)
    .filter(Boolean)
    .join(', ') || '(ninguna)';

  return [
    buildSharedIdentity({
      channel: 'web',
      dataSourceNote: 'Fuente de datos: SQL Server GMOFARRIL y CRM en vivo (no sync).',
      roleNote: buildRoleScopeNote(roleId, username),
      toolsList,
    }),
    '',
    AI_DATA_MODEL,
    WEB_MODULE_RULES,
    '',
    '## Restricción de perfil (obligatoria)',
    'Cumple estrictamente el alcance de perfil indicado arriba.',
    'Solo usa herramientas de la lista de esta sesión.',
    'Si la pregunta sale del perfil: niega el acceso con claridad y redirige a lo que sí puedes consultar.',
  ].join('\n');
}

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY no está configurada. Agrégala en el archivo .env');
  }
  return new OpenAI({ apiKey });
}

function isConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function collectExports(toolSnapshots) {
  return (toolSnapshots || [])
    .filter((s) => s?.name === 'generar_excel' && s.result?.downloadUrl && !s.result?.error)
    .map((s) => ({
      url: s.result.downloadUrl,
      filename: s.result.filename || 'export.xlsx',
      label: s.result.label || s.result.filename || 'Descargar Excel',
      rowCount: s.result.rowCount || 0,
    }));
}

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user' && messages[i].content) return String(messages[i].content);
  }
  return '';
}

function userWantsExcel(messages) {
  return EXCEL_INTENT_RE.test(lastUserText(messages));
}

function buildAutoExcelArgs(snapshot) {
  if (!snapshot || snapshot.result?.error) return null;
  const args = snapshot.args || {};
  if (snapshot.name === 'consultar_postventa') {
    const estatus = args.estatus || 'todas';
    const tipo = args.tipo || null;
    const auto = {
      fuente: 'postventa',
      area: args.area || 'posventa',
      estatus,
      tipo,
      filename: `postventa_${args.area || 'todas'}_${estatus}${tipo ? `_${tipo}` : ''}_${args.fechaInicio || 'abiertas'}_${args.fechaFin || 'hoy'}.xlsx`,
    };
    if (args.fechaInicio) auto.fechaInicio = args.fechaInicio;
    if (args.fechaFin) auto.fechaFin = args.fechaFin;
    return auto;
  }
  if (['consultar_ventas', 'consultar_ventas_modelo', 'consultar_ventas_por_auto', 'consultar_ventas_dia'].includes(snapshot.name)) {
    const fecha = args.fecha || args.fechaInicio;
    const fechaFin = args.fechaFin || args.fecha || args.fechaInicio;
    if (!fecha || !fechaFin) return null;
    return {
      fuente: 'ventas',
      fechaInicio: fecha,
      fechaFin,
      filename: `ventas_${fecha}_${fechaFin}.xlsx`,
    };
  }
  if (snapshot.name === 'consultar_inventario') {
    return {
      fuente: 'inventario',
      planPisoPeriod: args.planPisoPeriod || 'all',
      filename: 'inventario.xlsx',
    };
  }
  return null;
}

/** Detecta nomenclatura en el texto del usuario (normales, internas, letra N, etc.). */
function inferTipoFromText(text) {
  const t = String(text || '');
  const norm = stripAccents(t);

  // Preferir grupos por alias más largos primero
  const ranked = [...NOMENCLATURA_GRUPOS].sort(
    (a, b) => Math.max(...b.aliases.map((x) => x.length)) - Math.max(...a.aliases.map((x) => x.length)),
  );
  for (const g of ranked) {
    for (const alias of [g.id, g.label, ...g.aliases]) {
      const a = stripAccents(alias);
      if (a.length >= 4 && new RegExp(`\\b${a}\\b`, 'i').test(norm)) return g.id;
      if (a.length >= 4 && norm.includes(a)) return g.id;
    }
  }

  // Letra explícita: “letra N”, “tipo N”, “folios N”
  const letter = t.match(/\b(?:letra|tipo|folio|folios)\s*([A-ZÁÉÍÓÚÑ])\b/i);
  if (letter) {
    const resolved = resolveNomenclatura(letter[1]);
    if (resolved) return resolved.id;
  }

  return null;
}

/** Infiera export postventa desde el texto del usuario (fallback si el modelo no llamó generar_excel). */
function inferExcelArgsFromText(text) {
  const t = String(text || '');
  if (!/post.?venta|orden|taller|hyp|servicio|pintura|hojalat|interna|normal|reparac|garant|asegura|excel|xlsx/i.test(t)) {
    return null;
  }

  const estatus = /abierta/i.test(t) ? 'abiertas' : /facturada/i.test(t) ? 'facturadas' : 'todas';
  const tipo = inferTipoFromText(t);
  let area = 'posventa';
  if (/hyp|pintura|hojalat/i.test(t) && !tipo) area = 'hyp';
  else if (/\bservicio\b/i.test(t) && !tipo) area = 'servicio';

  const args = {
    fuente: 'postventa',
    area,
    estatus,
    filename: `postventa_${area}_${estatus}${tipo ? `_${tipo}` : ''}.xlsx`,
  };
  if (tipo) args.tipo = tipo;

  const yearMatch = t.match(/\b(20\d{2})\b/);
  if (yearMatch && estatus !== 'abiertas') {
    args.fechaInicio = `${yearMatch[1]}-01-01`;
    args.fechaFin = `${yearMatch[1]}-12-31`;
  }
  return args;
}

async function ensureExcelExport(messages, toolSnapshots, toolsUsed, roleId = null) {
  const existing = collectExports(toolSnapshots);
  if (existing.length) return { exports: existing, lastError: null };
  if (!userWantsExcel(messages)) return { exports: [], lastError: null };
  if (!isToolAllowedForRole(roleId, 'generar_excel')) {
    return { exports: [], lastError: 'Tu perfil no permite exportar Excel.' };
  }

  let lastError = null;
  const candidates = [...(toolSnapshots || [])].reverse();
  for (const snap of candidates) {
    const autoArgs = buildAutoExcelArgs(snap);
    if (!autoArgs) continue;
    try {
      const result = await generateExcelExport(autoArgs);
      toolSnapshots.push({ name: 'generar_excel', args: autoArgs, result });
      toolsUsed.push('generar_excel');
      return { exports: collectExports(toolSnapshots), lastError: null };
    } catch (err) {
      lastError = err.message;
      toolSnapshots.push({
        name: 'generar_excel',
        args: autoArgs,
        result: { error: err.message },
      });
    }
  }

  const inferred = inferExcelArgsFromText(lastUserText(messages));
  if (inferred) {
    try {
      const result = await generateExcelExport(inferred);
      toolSnapshots.push({ name: 'generar_excel', args: inferred, result });
      toolsUsed.push('generar_excel');
      return { exports: collectExports(toolSnapshots), lastError: null };
    } catch (err) {
      lastError = err.message;
      toolSnapshots.push({
        name: 'generar_excel',
        args: inferred,
        result: { error: err.message },
      });
    }
  }

  return { exports: [], lastError };
}

function finalizeReply(messageContent, toolSnapshots, toolsUsed, usage) {
  return {
    reply: messageContent || 'No pude generar una respuesta.',
    blocks: buildVisualizations(toolSnapshots),
    exports: collectExports(toolSnapshots),
    toolsUsed,
    usage,
    model: DEFAULT_MODEL,
  };
}

async function runChat(messages, { roleId = null, username = null } = {}) {
  const client = getClient();
  const allowedTools = filterToolDefinitions(TOOL_DEFINITIONS, roleId);
  const conversation = [
    { role: 'system', content: buildWebSystemPrompt({ roleId, username }) },
    ...messages.filter((m) => m.role === 'user' || m.role === 'assistant'),
  ];

  if (!allowedTools.length) {
    return finalizeReply(
      `Tu perfil (${resolveAiAccess(roleId).roleLabel}) no tiene módulos de datos habilitados para el asistente. `
        + 'Contacta a Administración si necesitas acceso.',
      [],
      [],
      { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    );
  }

  const toolsUsed = [];
  const toolSnapshots = [];
  let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let lastResponse = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: conversation,
      tools: allowedTools,
      tool_choice: 'auto',
      temperature: 0.35,
    });

    lastResponse = response;
    if (response.usage) {
      usage.prompt_tokens += response.usage.prompt_tokens || 0;
      usage.completion_tokens += response.usage.completion_tokens || 0;
      usage.total_tokens += response.usage.total_tokens || 0;
    }

    const choice = response.choices[0];
    const message = choice.message;
    conversation.push(message);

    const toolCalls = message.tool_calls || [];
    if (!toolCalls.length) {
      const ensured = await ensureExcelExport(messages, toolSnapshots, toolsUsed, roleId);
      const out = finalizeReply(message.content, toolSnapshots, toolsUsed, usage);
      if (userWantsExcel(messages) && !out.exports.length) {
        const detail = ensured.lastError ? ` (${ensured.lastError})` : '';
        out.reply += `\n\nNo pude generar el Excel automáticamente${detail}. `
          + 'Prueba de nuevo con: “Excel de órdenes internas abiertas” o indica área (HyP/Servicio) y periodo.';
      } else if (out.exports.length && !/descarga|excel|xlsx/i.test(out.reply || '')) {
        const ex = out.exports[0];
        out.reply += `\n\n### Descarga\nExcel listo: **${ex.filename}** (${Number(ex.rowCount || 0).toLocaleString('es-MX')} filas). Usa el botón de descarga debajo.`;
      }
      return out;
    }

    for (const toolCall of toolCalls) {
      const fnName = toolCall.function.name;
      let fnArgs = {};
      try {
        fnArgs = JSON.parse(toolCall.function.arguments || '{}');
      } catch {
        fnArgs = {};
      }

      toolsUsed.push(fnName);
      let toolResult;
      try {
        if (!isToolAllowedForRole(roleId, fnName)) {
          toolResult = {
            error: `Herramienta "${fnName}" no permitida para tu perfil. Solo puedes consultar áreas autorizadas.`,
            deniedByRole: true,
          };
        } else {
          toolResult = await executeTool(fnName, fnArgs);
        }
        toolSnapshots.push({ name: fnName, args: fnArgs, result: toolResult });
      } catch (err) {
        toolResult = { error: err.message };
        toolSnapshots.push({ name: fnName, args: fnArgs, result: toolResult });
      }

      conversation.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(toolResult),
      });
    }
  }

  await ensureExcelExport(messages, toolSnapshots, toolsUsed, roleId);
  return finalizeReply(
    lastResponse?.choices?.[0]?.message?.content
      || 'Alcancé el límite de consultas automáticas. Intenta una pregunta más específica.',
    toolSnapshots,
    toolsUsed,
    usage,
  );
}

module.exports = {
  isConfigured,
  runChat,
  DEFAULT_MODEL,
  buildWebSystemPrompt,
};
