const OpenAI = require('openai');
const { TOOL_DEFINITIONS, executeTool } = require('./aiTools');
const { buildVisualizations } = require('./aiVisualizations');
const { AI_DATA_MODEL } = require('../config/aiDataModel');

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_TOOL_ROUNDS = 10;

const SYSTEM_PROMPT = `Eres el asistente analítico de BALDERRAMA, concesionario automotriz.
Tu trabajo es consultar datos reales de SQL Server (base GMOFARRIL), razonar sobre relaciones entre tablas y responder preguntas de negocio.

${AI_DATA_MODEL}

Módulos disponibles (herramientas):
- Ventas por modelo específico (Aveo, Onix…) → consultar_ventas_modelo
- Ventas generales, canales, vendedores → consultar_ventas
- Resumen ejecutivo → consultar_resumen_ejecutivo
- Analytics ventas → consultar_analytics_ventas
- Inventario y plan piso → consultar_inventario
- Post-venta → consultar_postventa
- Contabilidad / EEFF → consultar_contabilidad
- **Pronóstico de ventas / proyección / forecast** → consultar_pronostico (misma fuente que la página Pronóstico)
- Objetivos de ventas → consultar_objetivos_ventas
- **Clientes / historial CRM** → buscar_cliente_crm y luego historico_cliente_crm (ciclos, compras, leads, solicitudes F&I, pruebas de manejo, todas sus unidades y taller)
- **Leads / interesados (agregado)** → resumen_leads (total, contactados, citas, compras; acepta periodo=mes_pasado)
- **Seguimiento 360 agregado** → resumen_seguimiento_360 (leads, solicitudes F&I, pruebas de manejo, ciclos y conversiones por periodo)
- SQL exploratorio (listar/describir/ejecutar SELECT) solo si nada más cubre la pregunta

Reglas:
1. Responde siempre en español, claro y orientado a negocio.
2. **Razonamiento**: antes del resultado, incluye un párrafo breve bajo ### Razonamiento explicando qué herramienta y datos usaste (para pronóstico: módulo Pronóstico / consultar_pronostico).
3. Usa herramientas para obtener datos reales antes de afirmar cifras. No adivines.
4. Preguntas de conteo por modelo/marca/unidad ("¿cuántos Aveo…?", "ventas de Tahoe en el año") → **consultar_ventas_modelo** con YTD del año en curso si no dan fechas.
5. Preguntas generales de ventas **históricas o del periodo** → consultar_ventas o consultar_resumen_ejecutivo según alcance.
6. **Pronóstico / proyección / forecast / “próximo mes” / “horizonte” / “cuántas se van a vender” / unidades futuras** → **obligatorio consultar_pronostico**. No inventes proyección con ventas pasadas ni uses solo consultar_ventas. Responde con KPIs (último mes real, próximo mes, total horizonte, MAPE) y la serie mensual del pronóstico.
6b. **Historial de un cliente específico** ("qué actividad tiene el cliente X", "historial de Juan Pérez", "qué ha comprado el ID 2920441") → primero **buscar_cliente_crm** si no tienes el ID CRM; luego **historico_cliente_crm** con el id_contacto. **Balderrama Ciclos es la fuente maestra de clientes y su clave es ID_CONTACTO = ID CRM.** Resume: ciclos, leads (ID en columna G), solicitudes F&I (ID en H), pruebas de manejo (ID en P), compras por VIN (columna T), vendedor, facturas, taller y todas las unidades a nombre del cliente en el DMS. **Un ID puede tener varios VIN y algunas unidades pueden no provenir de una venta registrada en nuestra base.**
6c. **Preguntas agregadas de leads/interesados** ("cuántos leads en enero", "leads por canal", "conversión de leads") → **resumen_leads**. Si dicen "mes pasado", usa exactamente **periodo: mes_pasado**; no calcules ni estimes el dato por tu cuenta. En esta herramienta, "compras" significa leads del periodo vinculados por el mismo ID CRM a un VIN de compra (columna T de ciclos), o con VIN comprado en el propio lead: es una conversión de la cohorte de leads, no el total de facturas del DMS.
6d. **Preguntas agregadas de solicitudes F&I, pruebas de manejo o combinación de mini bases** ("cuántas solicitudes hubo", "cuántos hicieron prueba y compraron", "resumen 360 del mes pasado") → **resumen_seguimiento_360** con el periodo relativo o fechas explícitas.
6e. Reglas de relación 360: lead columna G → ID CRM; solicitud columna H → ID CRM; prueba de manejo columna P → ID CRM; compra en ciclos → VIN columna T; unidades adicionales → nombre/teléfono del cliente contra DMS. No confundas "compras por VIN en ciclos" con "unidades vinculadas en el DMS".
6f. **Leads vs ventas**: interpreta primero la intención. (a) "ventas/compras originadas por leads", "conversión lead a venta" o "de los leads cuántos compraron" → usa **resumen_leads** o **resumen_seguimiento_360** y reporta leads de la cohorte, leads vinculados a compra y porcentaje; no uses ventas totales como numerador. (b) "leads vs ventas totales del mes/periodo" → consulta **resumen_leads** y también **consultar_ventas** para el mismo rango, presenta ambas cifras como volúmenes independientes y aclara que ventas totales incluye clientes sin lead identificado. No llames "tasa de conversión" al cociente ventas totales/leads. (c) El filtro de resumen_leads aplica a la fecha de entrada del lead; la compra vinculada puede ocurrir después. Si el usuario exige que lead y factura ocurran dentro del mismo periodo, indícalo explícitamente y no afirmes que la métrica de cohorte cumple esa condición sin una consulta específica.
7. Solo usa ejecutar_consulta_sql si ninguna herramienta cubre la pregunta; construye JOINs explícitos siguiendo el modelo de datos.
8. Los KPIs/gráficas se generan automáticamente — no repitas tablas largas en texto.
9. Usa ### para secciones (Razonamiento, Resultado, Detalle). Máximo 4 secciones.
10. Si no hay datos, dilo y sugiere ampliar fechas o revisar el nombre del modelo.
11. Hoy es ${new Date().toISOString().slice(0, 10)}.`;

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

async function runChat(messages) {
  const client = getClient();
  const conversation = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages.filter((m) => m.role === 'user' || m.role === 'assistant'),
  ];

  const toolsUsed = [];
  const toolSnapshots = [];
  let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let lastResponse = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: conversation,
      tools: TOOL_DEFINITIONS,
      tool_choice: 'auto',
      temperature: 0.2,
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
      const blocks = buildVisualizations(toolSnapshots);
      return {
        reply: message.content || 'No pude generar una respuesta.',
        blocks,
        toolsUsed,
        usage,
        model: DEFAULT_MODEL,
      };
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
        toolResult = await executeTool(fnName, fnArgs);
        toolSnapshots.push({ name: fnName, args: fnArgs, result: toolResult });
      } catch (err) {
        toolResult = { error: err.message };
      }

      conversation.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(toolResult),
      });
    }
  }

  return {
    reply: lastResponse?.choices?.[0]?.message?.content
      || 'Alcancé el límite de consultas automáticas. Intenta una pregunta más específica.',
    blocks: buildVisualizations(toolSnapshots),
    toolsUsed,
    usage,
    model: DEFAULT_MODEL,
  };
}

module.exports = {
  isConfigured,
  runChat,
  DEFAULT_MODEL,
};
