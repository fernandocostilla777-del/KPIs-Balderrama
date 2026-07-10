const OpenAI = require('openai');
const { TOOL_DEFINITIONS, executeTool } = require('./aiTools');
const { buildVisualizations } = require('./aiVisualizations');

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_TOOL_ROUNDS = 8;

const SYSTEM_PROMPT = `Eres el asistente analítico de BALDERRAMA, concesionario automotriz.
Tu trabajo es consultar datos reales de SQL Server (base GMOFARRIL) y ayudar a encontrar información, responder preguntas de negocio y hacer análisis.

Módulos disponibles:
- Ventas de autos nuevos (retail, flotilla, canales, vendedores, modelos, YTD, SOFIA)
- Resumen ejecutivo y analytics de ventas
- Inventario y plan piso
- Post-venta y servicio (SER_ORDEN)
- Contabilidad y estados financieros (EEFF, VTASMEN)
- Pronóstico de ventas
- Objetivos de ventas

Reglas:
1. Responde siempre en español, claro y orientado a negocio.
2. Usa las herramientas para obtener datos reales antes de afirmar cifras.
3. Si el usuario no indica fechas, asume el mes actual o el YTD del año en curso según convenga.
4. Cuando hagas análisis, enfócate en hallazgos clave, comparaciones, tendencias y recomendaciones accionables. Los datos numéricos se mostrarán automáticamente en tarjetas y gráficas — no repitas tablas extensas en texto.
5. Usa encabezados ### para secciones, listas cortas y párrafos breves. Máximo 3-4 secciones por respuesta.
6. Si una consulta SQL personalizada es necesaria, usa ejecutar_consulta_sql solo con SELECT.
7. Si no hay datos o hay error, dilo explícitamente y sugiere qué revisar.
8. Hoy es ${new Date().toISOString().slice(0, 10)}.`;

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
