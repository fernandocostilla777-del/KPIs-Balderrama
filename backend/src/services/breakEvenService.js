/**
 * Punto de equilibrio operativo (agencia y por departamento).
 *
 * Preliminar (como Nov-2025):
 *   MC  = TOTAL VENTAS − TOTAL COSTOS
 *   MC% = MC / Ventas
 *   GF  = gastos departamentales (parte fija provisional = total de gastos depto)
 *   PE  = GF / MC%
 *
 * Excluye F&I / productos financieros. Internas postventa se excluyen del consolidado
 * para evitar doble conteo entre departamentos.
 */
const { getCatalogKpis, sumPrefixesForPeriod } = require('./accountingCatalogKpiService');

const SEGMENTS = [
  {
    id: 'autosNuevos',
    label: 'Autos nuevos',
    area: 'autosNuevos',
    salesAccount: 'TOTAL VENTAS AUTOS NUEVOS',
  },
  {
    id: 'seminuevos',
    label: 'Seminuevos',
    area: 'seminuevos',
    salesAccount: 'TOTAL VENTAS SEMINUEVOS',
  },
  {
    id: 'postventa',
    label: 'Postventa',
    area: 'postventa',
    salesAccount: 'VENTAS TOTALES POST-VENTA',
  },
  {
    id: 'agencia',
    label: 'Agencia consolidada',
    area: 'todos',
    salesAccount: 'TOTAL VENTAS',
  },
];

/** Prefijos típicamente variables dentro de 0700 (refinado opcional). */
const VARIABLE_EXPENSE_PREFIXES = [
  '0700-0011-%', // comisiones
  '0700-0013-%', // entrega / gasolina
  '0700-0065-%', // publicidad
];

const INTERNAL_INCOME_PREFIXES = ['0481%'];
const INTERNAL_COST_PREFIXES = ['0681%'];

function parseDate(value) {
  const d = new Date(`${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) throw new Error(`Fecha inválida: ${value}`);
  return d;
}

function toIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function lastDayOfMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0, 12, 0, 0, 0);
}

function monthRange(year, monthIndex) {
  const start = new Date(year, monthIndex, 1, 12, 0, 0, 0);
  const end = lastDayOfMonth(year, monthIndex);
  return { fechaInicio: toIsoDate(start), fechaFin: toIsoDate(end), year, monthIndex };
}

function previousClosedMonths(refDate, count = 3) {
  const out = [];
  let y = refDate.getFullYear();
  let m = refDate.getMonth() - 1;
  for (let i = 0; i < count; i++) {
    if (m < 0) {
      m = 11;
      y -= 1;
    }
    out.push(monthRange(y, m));
    m -= 1;
  }
  return out;
}

/**
 * Modo temporal del KPI según el rango consultado vs hoy.
 * - cerrado: mes(es) ya terminados → PE con datos reales
 * - inicio: día 1 del mes en curso → meta con margen histórico + GF reciente
 * - en_curso: mes actual parcial → avance y proyección al cierre
 * - rango: periodos multi-mes / no estándar
 */
function resolveTemporalMode(fechaInicio, fechaFin, now = new Date()) {
  const start = parseDate(fechaInicio);
  const end = parseDate(fechaFin);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
  const curStart = new Date(today.getFullYear(), today.getMonth(), 1, 12, 0, 0, 0);
  const curEnd = lastDayOfMonth(today.getFullYear(), today.getMonth());

  const singleMonth = start.getFullYear() === end.getFullYear()
    && start.getMonth() === end.getMonth()
    && start.getDate() === 1
    && end.getDate() === lastDayOfMonth(end.getFullYear(), end.getMonth()).getDate();

  if (!singleMonth) {
    return {
      mode: 'rango',
      label: 'Rango personalizado',
      purpose: 'Evaluación del periodo seleccionado con datos reales acumulados',
    };
  }

  const sameCurrentMonth = start.getFullYear() === curStart.getFullYear()
    && start.getMonth() === curStart.getMonth();

  if (sameCurrentMonth) {
    if (today.getDate() <= 1) {
      return {
        mode: 'inicio',
        label: 'Inicio de mes · meta',
        purpose: 'Meta mínima con margen histórico + gastos fijos de meses cerrados',
      };
    }
    return {
      mode: 'en_curso',
      label: 'Mes en curso · monitoreo',
      purpose: 'Avance vs PE y proyección de ventas al cierre',
      daysElapsed: today.getDate(),
      daysInMonth: curEnd.getDate(),
    };
  }

  if (end < curStart) {
    return {
      mode: 'cerrado',
      label: 'Mes terminado',
      purpose: 'Evaluar si el mes alcanzó el equilibrio operativo',
    };
  }

  return {
    mode: 'rango',
    label: 'Periodo',
    purpose: 'Evaluación del periodo seleccionado',
  };
}

function formatMoneyInsight(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(v);
}

/**
 * Alerta inteligente: ratio de cobertura del punto de equilibrio.
 * Ratio = Ventas ÷ PE · Cobertura % = ratio × 100.
 */
function buildAgencyDetailInsight(agencia, temporal = {}) {
  if (!agencia || agencia.puntoEquilibrio == null || !(Number(agencia.ventas) > 0)) {
    return null;
  }

  const ventas = Number(agencia.ventas || 0);
  const pe = Number(agencia.puntoEquilibrio);
  if (!(pe > 0)) return null;

  const mc = Number(agencia.margenContribucion || 0);
  const mcPct = Number(agencia.margenContribucionPct || 0);
  const gf = Number(agencia.gastosFijos || 0);
  const uo = Number(agencia.utilidadOperativa || 0);
  const costos = Number(agencia.costosVariables || agencia.costosVariablesDirectos || 0);
  const mode = temporal.mode || 'cerrado';

  const coberturaRatio = Number(agencia.coberturaRatio != null
    ? agencia.coberturaRatio
    : (ventas / pe));
  const coberturaPct = Number(agencia.coberturaPct != null
    ? agencia.coberturaPct
    : round2(coberturaRatio * 100));
  const ratioRounded = Number(agencia.coberturaRatio != null
    ? agencia.coberturaRatio
    : round4(coberturaRatio));
  const brechaPct = Number(agencia.brechaEquilibrioPct != null
    ? agencia.brechaEquilibrioPct
    : round2(Math.max(0, 100 - coberturaPct)));
  const ventasAdicionales = Number(agencia.ventasAdicionalesRequeridas != null
    ? agencia.ventasAdicionalesRequeridas
    : round2(Math.max(0, pe - ventas)));
  const excedente = round2(Math.max(0, ventas - pe));
  const alcanzo = coberturaRatio >= 1;

  const facts = [
    { label: 'Ventas del periodo', value: formatMoneyInsight(ventas) },
    { label: 'Punto de equilibrio', value: formatMoneyInsight(pe) },
    { label: 'Ratio de cobertura', value: `${ratioRounded} veces` },
    { label: 'Cobertura porcentual', value: `${coberturaPct}%` },
    {
      label: alcanzo ? 'Excedente sobre el equilibrio' : 'Brecha para alcanzar el equilibrio',
      value: alcanzo
        ? `${formatMoneyInsight(excedente)} (${round2(Math.max(0, coberturaPct - 100))}%)`
        : `${brechaPct}%`,
    },
  ];
  if (!alcanzo) {
    facts.push({ label: 'Ventas adicionales requeridas', value: formatMoneyInsight(ventasAdicionales) });
  }
  facts.push(
    { label: 'Margen de contribución', value: `${formatMoneyInsight(mc)} (${mcPct}%)` },
    { label: 'Gastos fijos', value: formatMoneyInsight(gf) },
    { label: 'Costos variables', value: formatMoneyInsight(costos) },
    {
      label: uo >= 0 ? 'Utilidad operativa' : 'Pérdida operativa',
      value: formatMoneyInsight(uo),
    },
  );

  let severity = 'info';
  let title;
  let summary;
  let analysis;
  const recommendations = [];

  const criterio = [
    'Mayor a 1 o 100%: operación por encima del equilibrio.',
    'Igual a 1 o 100%: equilibrio exacto.',
    'Menor a 1 o 100%: operación por debajo del equilibrio.',
  ];

  if (alcanzo) {
    severity = 'info';
    title = 'Cobertura del punto de equilibrio alcanzada';
    summary = `Ratio de cobertura = Ventas ÷ PE = ${formatMoneyInsight(ventas)} ÷ ${formatMoneyInsight(pe)} `
      + `= ${ratioRounded} → cobertura ${coberturaPct}%.`;
    analysis = `La agencia cubrió ${coberturaPct}% de las ventas necesarias para alcanzar su punto de equilibrio. `
      + `Por cada $1.00 requerido, generó aproximadamente $${ratioRounded.toFixed(2)}, `
      + `por lo que el periodo cerró por encima (o en) el equilibrio operativo. `
      + `Margen de contribución ${mcPct}% · gastos fijos ${formatMoneyInsight(gf)}.`;
    recommendations.push(
      'Mantener el mix y el control de gastos fijos para no erosionar el colchón sobre el PE.',
      'Usar el PE por departamento para ver qué área sostiene o debilita el consolidado.',
    );
  } else {
    severity = coberturaPct < 95 ? 'critical' : 'warning';
    title = 'Cobertura del punto de equilibrio incompleta';
    summary = `Ratio de cobertura = ${formatMoneyInsight(ventas)} ÷ ${formatMoneyInsight(pe)} `
      + `= ${ratioRounded} → cobertura ${coberturaPct}% · brecha ${brechaPct}%.`;
    const debajo = coberturaPct >= 95 ? 'ligeramente por debajo' : 'por debajo';
    analysis = `La agencia cubrió ${coberturaPct}% de las ventas necesarias para alcanzar su punto de equilibrio. `
      + `Por cada $1.00 requerido, generó aproximadamente $${ratioRounded.toFixed(2)}, `
      + `por lo que el periodo cerró ${debajo} del equilibrio operativo. `
      + `Faltan ${formatMoneyInsight(ventasAdicionales)} de ventas adicionales `
      + `(${brechaPct}% de brecha) para empatar el PE. `
      + `Con MC ${mcPct}%, los gastos fijos de ${formatMoneyInsight(gf)} exigen vender ${formatMoneyInsight(pe)}.`;
    recommendations.push(
      `Cerrar el gap de ${formatMoneyInsight(ventasAdicionales)} en ventas sin bajar el margen, o mejorar el MC% para reducir el PE.`,
      'Separar comisiones, bonos y publicidad del gasto fijo para un PE más preciso.',
      'Revisar el mix: postventa suele aportar mayor margen de contribución que nuevos.',
    );
  }

  if (mode === 'en_curso' && agencia.monitoreo) {
    const mon = agencia.monitoreo;
    analysis += ` En el mes en curso, el avance al PE es ${mon.avanceEquilibrioPct ?? '—'}% `
      + `y la proyección al cierre es ${formatMoneyInsight(mon.ventasProyectadas)}`
      + (mon.proyectaAlcanzar ? ' (proyecta alcanzar el equilibrio).' : ' (aún no proyecta alcanzar el equilibrio).');
    recommendations.unshift(
      mon.proyectaAlcanzar
        ? 'La proyección al cierre sugiere que se puede empatar si se mantiene el ritmo actual.'
        : 'Acelerar ventas o recortar variables esta semana: la proyección al cierre aún queda bajo el PE.',
    );
  } else if (mode === 'inicio' && agencia.puntoEquilibrioMeta) {
    analysis += ' Este PE es una meta de inicio de mes (margen histórico de meses cerrados + gastos fijos promedio).';
  }

  return {
    id: 'pe-detalle-agencia',
    kpiId: 'kpiCardPuntoEquilibrio',
    module: 'punto-equilibrio',
    severity,
    badge: 'Alerta inteligente',
    title,
    summary,
    analysis,
    recommendations,
    criterio,
    facts,
    metrics: {
      ventas,
      puntoEquilibrio: pe,
      coberturaRatio: ratioRounded,
      coberturaPct,
      brechaEquilibrioPct: brechaPct,
      ventasAdicionalesRequeridas: ventasAdicionales,
    },
    chatPrompt: [
      'Eres el analista financiero de BALDERRAMA. Explica la cobertura del punto de equilibrio.',
      'Fórmula: Ratio de cobertura = Ventas ÷ Punto de equilibrio. Cobertura % = ratio × 100.',
      `Hallazgo: ${title}`,
      'Datos:',
      ...facts.map((f) => `- ${f.label}: ${f.value}`),
      'Criterio de lectura:',
      ...criterio.map((c) => `- ${c}`),
      `Modo temporal: ${temporal.label || mode}`,
      'Explica en español el ratio, la brecha y da 3 acciones concretas. No inventes cifras fuera de las dadas.',
    ].join('\n'),
  };
}


function round2(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Number(Number(n).toFixed(2));
}

function round1(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Number(Number(n).toFixed(1));
}

function round4(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Number(Number(n).toFixed(4));
}

function calcBreakEvenRow({
  id,
  label,
  salesAccount,
  ventas,
  costosVariablesDirectos,
  gastosVariablesAdicionales = 0,
  gastosFijos,
  excludeNote,
}) {
  const costosVariables = Number(costosVariablesDirectos || 0) + Number(gastosVariablesAdicionales || 0);
  const margenContribucion = Number(ventas || 0) - costosVariables;
  const margenPct = ventas > 0 ? margenContribucion / ventas : 0;
  const puntoEquilibrio = margenPct > 0 ? gastosFijos / margenPct : null;
  const faltante = puntoEquilibrio != null ? puntoEquilibrio - ventas : null;
  const coberturaRatio = puntoEquilibrio > 0 ? ventas / puntoEquilibrio : null;
  const coberturaPct = coberturaRatio != null ? coberturaRatio * 100 : null;
  const cumplimientoPct = coberturaPct;
  const brechaEquilibrioPct = coberturaPct != null ? Math.max(0, 100 - coberturaPct) : null;
  const ventasAdicionalesRequeridas = faltante != null ? Math.max(0, faltante) : null;
  const utilidadOperativa = margenContribucion - Number(gastosFijos || 0);

  return {
    id,
    label,
    salesAccount,
    ventas: round2(ventas),
    costosVariablesDirectos: round2(costosVariablesDirectos),
    gastosVariablesAdicionales: round2(gastosVariablesAdicionales),
    costosVariables: round2(costosVariables),
    margenContribucion: round2(margenContribucion),
    margenContribucionPct: round1(margenPct * 100),
    gastosFijos: round2(gastosFijos),
    puntoEquilibrio: puntoEquilibrio != null ? round2(puntoEquilibrio) : null,
    faltante: faltante != null ? round2(faltante) : null,
    coberturaRatio: coberturaRatio != null ? round4(coberturaRatio) : null,
    coberturaPct: coberturaPct != null ? round2(coberturaPct) : null,
    brechaEquilibrioPct: brechaEquilibrioPct != null ? round2(brechaEquilibrioPct) : null,
    ventasAdicionalesRequeridas: ventasAdicionalesRequeridas != null
      ? round2(ventasAdicionalesRequeridas)
      : null,
    cumplimientoPct: cumplimientoPct != null ? round1(cumplimientoPct) : null,
    utilidadOperativa: round2(utilidadOperativa),
    alcanzoEquilibrio: puntoEquilibrio != null ? ventas >= puntoEquilibrio : null,
    excludeNote: excludeNote || null,
    formula: 'Ratio cobertura = Ventas ÷ PE · PE = Gastos fijos ÷ (1 − Costos variables ÷ Ventas)',
  };
}

async function loadSegmentActuals({ fechaInicio, fechaFin, segment, sucursal = 'todos' }) {
  const catalog = await getCatalogKpis({
    fechaInicio,
    fechaFin,
    sucursal,
    area: segment.area,
    includeFi: false,
  });
  const ventas = Number(catalog.summary?.ventasTotales || 0);
  const costos = Number(catalog.summary?.costoVentas || 0);
  const gastosFijos = Number(catalog.summary?.gastoDepartamento || 0);
  let excludeNote = 'Sin F&I ni productos financieros';
  let internas = null;

  // Preliminar alinea TOTAL VENTAS Contpaq (como Nov-2025). Internas se reportan
  // para revisión; no se restan automáticamente del PE preliminar.
  if (segment.id === 'agencia') {
    const [ventasInt, costoInt] = await Promise.all([
      sumPrefixesForPeriod(fechaInicio, fechaFin, INTERNAL_INCOME_PREFIXES, true),
      sumPrefixesForPeriod(fechaInicio, fechaFin, INTERNAL_COST_PREFIXES, false),
    ]);
    if (Math.abs(ventasInt) > 0.01 || Math.abs(costoInt) > 0.01) {
      internas = {
        ventas: round2(ventasInt),
        costos: round2(costoInt),
        note: 'Internas postventa (0481/0681) detectadas; no restadas en PE preliminar.',
      };
      excludeNote += ' · internas reportadas (no restadas en preliminar)';
    }
  }

  return {
    ventas,
    costosVariablesDirectos: costos,
    gastosFijos,
    catalog,
    excludeNote,
    internas,
  };
}

async function optionalVariableExpenses(fechaInicio, fechaFin) {
  try {
    return await sumPrefixesForPeriod(fechaInicio, fechaFin, VARIABLE_EXPENSE_PREFIXES, false);
  } catch {
    return 0;
  }
}

async function buildSegmentBreakEven({
  fechaInicio,
  fechaFin,
  segment,
  sucursal = 'todos',
  refined = false,
}) {
  const actuals = await loadSegmentActuals({ fechaInicio, fechaFin, segment, sucursal });
  let gastosVariablesAdicionales = 0;
  let gastosFijos = actuals.gastosFijos;

  if (refined && segment.id === 'agencia') {
    gastosVariablesAdicionales = await optionalVariableExpenses(fechaInicio, fechaFin);
    // No restar del GF departamental sin mapear cuenta→depto; se reporta como adicional
    // al costo variable (PE más conservador). Flag preliminar vs refinado.
  }

  const row = calcBreakEvenRow({
    id: segment.id,
    label: segment.label,
    salesAccount: segment.salesAccount,
    ventas: actuals.ventas,
    costosVariablesDirectos: actuals.costosVariablesDirectos,
    gastosVariablesAdicionales,
    gastosFijos,
    excludeNote: actuals.excludeNote + (refined ? ' · comisiones/entrega/publicidad como variables adicionales' : ' · preliminar (TOTAL COSTOS variable · gastos depto fijos)'),
  });

  return {
    ...row,
    refined,
    internas: actuals.internas || null,
    source: 'CON_CTAS_CATALOGO',
  };
}

async function averageHistoricMarginAndFixed({
  closedMonths,
  segment,
  sucursal = 'todos',
}) {
  const rows = [];
  for (const m of closedMonths) {
    try {
      const r = await buildSegmentBreakEven({
        fechaInicio: m.fechaInicio,
        fechaFin: m.fechaFin,
        segment,
        sucursal,
        refined: false,
      });
      if (r.margenContribucionPct != null && r.ventas > 0) rows.push(r);
    } catch {
      /* mes sin tabla */
    }
  }
  if (!rows.length) return null;
  const margenPct = rows.reduce((s, r) => s + r.margenContribucionPct, 0) / rows.length / 100;
  const gastosFijos = rows.reduce((s, r) => s + Number(r.gastosFijos || 0), 0) / rows.length;
  return {
    monthsUsed: rows.map((r) => r),
    monthCount: rows.length,
    margenContribucionPct: round1(margenPct * 100),
    gastosFijos: round2(gastosFijos),
    puntoEquilibrioMeta: margenPct > 0 ? round2(gastosFijos / margenPct) : null,
  };
}

function attachMonitoring(row, temporal, ventasAcumuladas) {
  if (!temporal || temporal.mode !== 'en_curso' || !row?.puntoEquilibrio) return row;
  const daysElapsed = temporal.daysElapsed || 1;
  const daysInMonth = temporal.daysInMonth || 30;
  const ventasProyectadas = (ventasAcumuladas / daysElapsed) * daysInMonth;
  const avancePct = row.puntoEquilibrio > 0
    ? (ventasAcumuladas / row.puntoEquilibrio) * 100
    : null;
  return {
    ...row,
    monitoreo: {
      ventasAcumuladas: round2(ventasAcumuladas),
      ventasProyectadas: round2(ventasProyectadas),
      avanceEquilibrioPct: avancePct != null ? round1(avancePct) : null,
      daysElapsed,
      daysInMonth,
      proyectaAlcanzar: ventasProyectadas >= row.puntoEquilibrio,
    },
  };
}

/**
 * Calcula los 4 PE + metadatos temporales.
 */
async function getPuntoEquilibrio({
  fechaInicio,
  fechaFin,
  sucursal = 'todos',
  refined = false,
  now = new Date(),
} = {}) {
  const temporal = resolveTemporalMode(fechaInicio, fechaFin, now);
  const start = parseDate(fechaInicio);

  const segments = await Promise.all(
    SEGMENTS.map((segment) => buildSegmentBreakEven({
      fechaInicio,
      fechaFin,
      segment,
      sucursal,
      refined,
    })),
  );

  let metaHistorica = null;
  if (temporal.mode === 'inicio' || temporal.mode === 'en_curso') {
    const closed = previousClosedMonths(start, 3);
    metaHistorica = await averageHistoricMarginAndFixed({
      closedMonths: closed,
      segment: SEGMENTS.find((s) => s.id === 'agencia'),
      sucursal,
    });
  }

  const byId = Object.fromEntries(segments.map((s) => [s.id, s]));
  const agencia = byId.agencia;

  // En mes en curso: PE meta = histórico; monitoreo con ventas reales del mes
  let agenciaDisplay = agencia;
  if ((temporal.mode === 'inicio' || temporal.mode === 'en_curso') && metaHistorica?.puntoEquilibrioMeta) {
    agenciaDisplay = {
      ...agencia,
      puntoEquilibrioMeta: metaHistorica.puntoEquilibrioMeta,
      margenHistoricoPct: metaHistorica.margenContribucionPct,
      gastosFijosPromedio: metaHistorica.gastosFijos,
      historicMonths: metaHistorica.monthCount,
    };
    if (temporal.mode === 'inicio') {
      agenciaDisplay.puntoEquilibrio = metaHistorica.puntoEquilibrioMeta;
      agenciaDisplay.gastosFijos = metaHistorica.gastosFijos;
      agenciaDisplay.margenContribucionPct = metaHistorica.margenContribucionPct;
      agenciaDisplay.faltante = round2(metaHistorica.puntoEquilibrioMeta - agencia.ventas);
      agenciaDisplay.cumplimientoPct = metaHistorica.puntoEquilibrioMeta > 0
        ? round1((agencia.ventas / metaHistorica.puntoEquilibrioMeta) * 100)
        : null;
      agenciaDisplay.note = 'Meta de inicio de mes: PE = GF promedio 3 meses ÷ MC% histórico';
    }
  }

  if (temporal.mode === 'en_curso') {
    agenciaDisplay = attachMonitoring(
      {
        ...agenciaDisplay,
        // PE de referencia: meta histórica si existe; si no, PE del acumulado
        puntoEquilibrio: agenciaDisplay.puntoEquilibrioMeta || agencia.puntoEquilibrio,
      },
      temporal,
      agencia.ventas,
    );
  }

  const insight = buildAgencyDetailInsight(agenciaDisplay, temporal);

  return {
    available: segments.some((s) => Number(s.ventas) > 0 || Number(s.gastosFijos) > 0),
    temporal,
    refined: Boolean(refined),
    methodology: {
      ventas: 'TOTAL VENTAS operativas (sin F&I). Departamentos: nuevos / seminuevos / postventa.',
      costosVariables: 'TOTAL COSTOS del alcance (preliminar = 100% variables).',
      gastosVariablesAdicionales: refined
        ? 'Comisiones, entrega y publicidad (0700-0011/0013/0065) sumadas al variable.'
        : 'Preliminares en 0 — se asume que están dentro de gastos depto como fijos.',
      gastosFijos: 'Gastos departamentales del catálogo Excel/GPO (sin productos financieros). Agencia incluye administración.',
      formula: 'Ratio cobertura = Ventas ÷ PE · PE = Gastos fijos ÷ Margen de contribución %',
      exclusiones: 'Productos/gastos financieros, otros ingresos, provisiones, dividendos, F&I. Internas postventa se reportan sin restar en el preliminar.',
      preliminar: true,
    },
    segmentos: segments.map((s) => (s.id === 'agencia' ? agenciaDisplay : s)),
    agencia: agenciaDisplay,
    insight,
    summary: {
      ventas: agenciaDisplay.ventas,
      costosVariables: agenciaDisplay.costosVariables,
      margenContribucion: agenciaDisplay.margenContribucion,
      margenContribucionPct: agenciaDisplay.margenContribucionPct,
      gastosFijos: agenciaDisplay.gastosFijos,
      puntoEquilibrio: agenciaDisplay.puntoEquilibrio,
      faltante: agenciaDisplay.faltante,
      coberturaRatio: agenciaDisplay.coberturaRatio,
      coberturaPct: agenciaDisplay.coberturaPct,
      brechaEquilibrioPct: agenciaDisplay.brechaEquilibrioPct,
      ventasAdicionalesRequeridas: agenciaDisplay.ventasAdicionalesRequeridas,
      cumplimientoPct: agenciaDisplay.cumplimientoPct,
      utilidadOperativa: agenciaDisplay.utilidadOperativa,
      alcanzoEquilibrio: agenciaDisplay.alcanzoEquilibrio,
    },
  };
}

module.exports = {
  getPuntoEquilibrio,
  calcBreakEvenRow,
  resolveTemporalMode,
  buildAgencyDetailInsight,
  SEGMENTS,
  VARIABLE_EXPENSE_PREFIXES,
};
