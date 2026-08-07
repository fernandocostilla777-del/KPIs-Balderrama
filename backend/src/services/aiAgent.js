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
  buildProfileMemoryNote,
  resolveAiAccess,
} = require('./aiRoleAccess');

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_TOOL_ROUNDS = 10;

const EXCEL_INTENT_RE = /excel|xlsx|descargar|exportar|spreadsheet|hoja\s+de\s+c[aá]lculo|archivo\s+descargable|pasame\s+(el\s+)?listado|pásame\s+(el\s+)?listado|dame\s+(en\s+)?(un\s+)?excel|en\s+(un\s+)?excel/i;

const WEB_MODULE_RULES = `
## Módulos disponibles (herramientas web · SQL Server / CRM en vivo)
- Ventas por modelo / **HIGH END** → consultar_ventas_modelo (modelo="HIGH END" o carline)
- Ventas por auto con detalle → consultar_ventas_por_auto
- Ventas generales, canales, vendedores, SOFIA → consultar_ventas
- Resumen ejecutivo → consultar_resumen_ejecutivo
- Analytics ventas → consultar_analytics_ventas
- Inventario autos + plan piso → consultar_inventario
- Inventario refacciones/HyP → consultar_inventario_postventa
- Refacciones (utilidad / días sin venta) → consultar_refacciones
- Post-venta → consultar_postventa
- Lista de precios / planes Chevrolet / Precio de Venta GMMX → consultar_lista_precios
- Excel → generar_excel
- Contabilidad / EEFF → consultar_contabilidad
- Pronóstico → consultar_pronostico
- Objetivos → consultar_objetivos_ventas
- CRM 360 → buscar_cliente_crm → historico_cliente_crm
- Leads → resumen_leads (listar="citas_sin_compra" si aplica)
- Seguimiento 360 → resumen_seguimiento_360 / listar_vendedores_360 / resumen_vendedor_360
- Quejas CSI → consultar_quejas_csi
- F&I → consultar_financiamiento
- Utilidad carline → consultar_utilidad_carline
- Riesgos / oportunidades / alertas → consultar_riesgos_oportunidades
- Recomendaciones directivas (presión, mix, cuellos vs histórico) → consultar_recomendaciones_directivas
- Roles / accesos / alertas por perfil → consultar_roles_acceso
- SQL exploratorio solo si nada más cubre la pregunta

## HIGH END (obligatorio)
- HIGH END = **canal de lujo** Balderrama (NO es forma de pago).
- Carlines: **SUBURBAN, TAHOE, CHEYENNE, TRAVERSE**.
- Preguntas de HIGH END / lujo → consultar_ventas_modelo con modelo="HIGH END".

## Preguntas sugeridas del chat → herramienta (OBLIGATORIO llamar; nunca digas “no tengo acceso”)
### Tablero / general
- Resumen ejecutivo / “cómo cerramos el mes” → consultar_resumen_ejecutivo (mes actual)
- Alertas críticas / qué revisar hoy / insights / riesgos / oportunidades / dónde se traba → consultar_riesgos_oportunidades
- Recomendaciones a dirección / cuándo meter presión / ritmo de solicitudes / mix vs meta / cuellos de botella → consultar_recomendaciones_directivas
- Ventas vs postventa → consultar_resumen_ejecutivo + consultar_postventa
- Cumplimiento metas retail / qué falta para meta → consultar_objetivos_ventas + consultar_ventas (+ consultar_recomendaciones_directivas)
- Área más desviada del presupuesto / EEFF / gastos / utilidad por área / 0481–0484 → consultar_contabilidad
- Comparar este mes vs anterior → dos llamadas (mes_actual y mes_pasado) a la herramienta del tema
- Variación más relevante → consultar_riesgos_oportunidades + consultar_resumen_ejecutivo

### Ventas
- Unidades retail / top vendedores / SOFIA sin previas / mes vs mes → consultar_ventas (+ analytics si ranking)
- Penetración GMF → consultar_financiamiento
- Conversión leads / canal de leads → resumen_leads (agruparPor=canal)
- Citas que aún no compran → resumen_leads con listar="citas_sin_compra" y periodo=mes_actual
- Presión comercial / embudo vs histórico / mix HIGH END vs meta → consultar_recomendaciones_directivas
- Precio / plan / bono / stock de un modelo → consultar_lista_precios

### Inventario
- Plan piso / envejecidas / sin previas / modelos con más interés → consultar_inventario
- Nuevos vs seminuevos → consultar_inventario y aclara que el tablero prioriza **autos nuevos**; seminuevos no son el catálogo principal

### Lista de precios
- Precio de Venta GMMX / MSRP / planes GMF / bono toma a cuenta / ficha / stock por versión → consultar_lista_precios
- “¿Está vigente la lista?” → consultar_lista_precios (mira vigencia/fuentePdf/publicado)
- Aveo LT Plus = CVT automática (no digas manual)

### Postventa
- Órdenes abiertas críticas / facturadas / HyP vs Servicio / productividad asesor → consultar_postventa
- Segmentación HyP Externas (A,F,V,Z) / Internas HyP (J,H,Ó,I,E) → consultar_postventa area=hyp + tipo=externas|hyp_internas
- Refacciones trabadas +90 / top utilidad → consultar_refacciones (+ consultar_inventario_postventa si stock)

### Pronóstico
- Pronóstico vs meta / tendencia / YTD → consultar_pronostico + consultar_objetivos_ventas (+ consultar_ventas si YTD)

### Seguimiento 360
- Cliente reciente con compra → resumen_seguimiento_360 luego buscar_cliente_crm / historico_cliente_crm del primero con compra
- Actividad / conversión por vendedor → listar_vendedores_360 + resumen_vendedor_360

### Admin
- Roles / PostVenta / Gerencia Comercial / Vendedor / alertas por perfil → consultar_roles_acceso
- Vigencia lista de precios / planes publicados → consultar_lista_precios (la carga del PDF la hace un admin en la UI; el asistente solo consulta)

## Reglas adicionales (solo web)
4. Conteo por modelo/marca/HIGH END → **consultar_ventas_modelo** (YTD si no dan fechas).
4b. Detalle por unidad → **consultar_ventas_por_auto**.
5. Ventas generales → consultar_ventas o consultar_resumen_ejecutivo.
5b. Riesgos/oportunidades/alertas → **consultar_riesgos_oportunidades**. NUNCA digas que no tienes acceso: llama la herramienta.
5c. Recomendaciones directivas / presión / mix / cuellos → **consultar_recomendaciones_directivas**.
5d. Precios / planes Chevrolet → **consultar_lista_precios**. Di «Precio de Venta GMMX» (no solo MSRP).
6. Pronóstico: KPIs + serie mensual.
6b. CRM 360 → buscar_cliente_crm → historico_cliente_crm.
6c. Leads → resumen_leads. Citas sin compra → listar="citas_sin_compra".
6d. F&I → consultar_financiamiento. Utilidad carline → consultar_utilidad_carline.
6g. Por vendedor → listar_vendedores_360 + resumen_vendedor_360.
6h. Contabilidad: diagnóstico + acciones.
6k. Excel: si piden descargar, DEBES llamar generar_excel.
7. Solo usar ejecutar_consulta_sql si ninguna herramienta cubre la pregunta.
8. Visualizaciones: resume hallazgo + 1–2 acciones; no dumps crudos.
9. Si la pregunta sugerida toca un área fuera del perfil: dilo en 1 frase y ofrece lo más cercano permitido.
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
    buildProfileMemoryNote(roleId, username),
    '',
    AI_DATA_MODEL,
    WEB_MODULE_RULES,
    '',
    '## Restricción de perfil (obligatoria)',
    'Cumple estrictamente el alcance de perfil indicado arriba.',
    'Solo usa herramientas de la lista de esta sesión.',
    'Si la pregunta sale del perfil: niega el acceso con claridad y redirige a lo que sí puedes consultar.',
    'Responde siempre con el lente del playbook del perfil y la memoria del usuario.',
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
  const toolContext = { roleId, username };
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
          toolResult = await executeTool(fnName, fnArgs, toolContext);
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
