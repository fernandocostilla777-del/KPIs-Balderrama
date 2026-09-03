/**
 * Motor de semáforo e interpretación de KPIs
 * basado en "Mapa de indicadores" del Catálogo ABP 2026.
 *
 * Columnas del Excel:
 *  E → KPI
 *  G → Interpretación
 *  H → Valor de control (umbrales verde / amarillo / rojo)
 *  J → Usado por (perfiles a notificar)
 */

const fs = require('fs');
const path = require('path');

const CATALOG_FILE = path.join(__dirname, '../../data/kpiMapaCatalog.json');

let cachedCatalog = null;

function loadCatalog() {
  if (cachedCatalog) return cachedCatalog;
  try {
    const raw = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
    cachedCatalog = Array.isArray(raw.items) ? raw.items : [];
  } catch {
    cachedCatalog = [];
  }
  return cachedCatalog;
}

/** Mapeo roles dashboard → etiquetas del catálogo (columna J). */
const ROLE_TO_CATALOG_PROFILES = {
  administracion: [
    'Director', 'Gerente General', 'Gerencia General', 'Administración',
    'Data Manager', 'Auditor', 'Contador General', 'Gerentes de área',
  ],
  direccion: [
    'Director', 'Gerente General', 'Gerencia General', 'Data Manager', 'Auditor',
  ],
  gerencia_comercial: [
    'Gerencia Comercial', 'Gerencia Ventas', 'Gerente Comercial Ventas',
    'CRM', 'BDC', 'F&I', 'Data Manager',
  ],
  vendedor: ['Gerencia Ventas', 'CRM', 'BDC'],
  contabilidad: [
    'Contador General', 'Contabilidad', 'Finanzas', 'Tesorería',
    'Crédito y Cobranza', 'Cuentas por Pagar',
  ],
  marketing: [
    'Gerente de MKT', 'Gerencia Marketing', 'Marketing', 'MTK', 'CRM', 'BDC',
  ],
};

/** Vincula insights operativos existentes con entradas del catálogo ABP. */
const INSIGHT_TO_CATALOG = {
  'ventas-ritmo-retail': ['C-6', 'cumplimiento del objetivo', 'crecimiento porcentual de ventas'],
  'ventas-ritmo-sofia': ['cumplimiento del objetivo', 'entregas'],
  'ventas-cobertura': ['cumplimiento del objetivo'],
  'ventas-ytd': ['C-6', 'crecimiento porcentual de ventas'],
  'ventas-sin-timbrar': ['entregas sin incidencias', 'proceso de entrega'],
  'overview-margen': ['C-2', 'margen bruto'],
  'overview-utilidad': ['C-2', 'margen bruto', 'SV-1'],
  'overview-aging': ['C-3', 'días de rotación de inventario', 'dri'],
  'overview-plan-piso': ['C-3', 'días de rotación de inventario'],
  'overview-inventario': ['C-3', 'días de rotación de inventario'],
  'inventory-aging': ['C-3', 'días de rotación de inventario', 'dri'],
  'inventory-days': ['C-3', 'días de rotación de inventario', 'dri'],
  'inventory-sin-previas': ['P-5', 'entregas sin incidencias', 'proceso de entrega', 'satisfacción en la entrega'],
  'inv-sin-previas': ['P-5', 'entregas sin incidencias', 'proceso de entrega', 'satisfacción en la entrega'],
  'inv-entregas-sin-previas': ['P-5', 'entregas sin incidencias', 'proceso de entrega'],
  'inv-aging': ['C-3', 'días de rotación de inventario', 'inventario envejecido'],
  'inv-plan-piso': ['P-1', 'costo financiero del inventario'],
  'inv-pv-traspasos': ['P-1', 'rotación de inventario'],
  'inv-pv-refacciones-valor': ['P-1', 'rotación de inventario'],
  'contabilidad-liquidez': ['SV-3', 'ratio de liqidez', 'liquidez'],
  'contabilidad-endeudamiento': ['SV-2', 'endeudamiento'],
  'contabilidad-roe': ['SV-1', 'roe'],
  'contabilidad-margen': ['F-6', 'C-2', 'margen'],
  'contabilidad-ciclo': ['F-3', 'ciclo de efectivo'],
  'seguimiento-conversion': ['tasa de cierre', 'conversión'],
  'seguimiento-citas': ['tasa de asistencia', 'tasa de citas'],
  'marketing-conversion': ['conversión de marketing a venta'],
  'marketing-cac': ['costo de adquisición', 'cac'],
  'postventa-facturacion': ['facturación'],
  'fi-penetracion': ['penetración de financiamiento', 'gmf'],
};

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findCatalogEntry(insight) {
  const catalog = loadCatalog();
  if (!catalog.length) return null;

  const hints = INSIGHT_TO_CATALOG[insight.id] || [];
  for (const hint of hints) {
    const h = normalize(hint);
    const byClave = catalog.find((item) => normalize(item.clave) === h || normalize(item.clave).replace(/-/g, '') === h.replace(/-/g, ''));
    if (byClave) return byClave;
    const byKpi = catalog.find((item) => normalize(item.kpi).includes(h) || h.includes(normalize(item.kpi).slice(0, 18)));
    if (byKpi) return byKpi;
  }

  const blob = normalize([insight.title, insight.summary, insight.kpiId].join(' '));
  let best = null;
  let bestScore = 0;
  for (const item of catalog) {
    const kpi = normalize(item.kpi);
    const ind = normalize(item.indicador);
    let score = 0;
    if (kpi && blob.includes(kpi)) score += 3;
    if (ind && blob.includes(ind)) score += 2;
    const tokens = kpi.split(' ').filter((t) => t.length > 4);
    score += tokens.filter((t) => blob.includes(t)).length;
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return bestScore >= 3 ? best : null;
}

/**
 * Evalúa semáforo a partir del texto de valor de control (columna H)
 * y métricas numéricas del insight.
 *
 * @returns {'verde'|'amarillo'|'rojo'|null}
 */
function evaluateSemaforoFromControl(valorControl, metrics = {}, severity = null) {
  const text = String(valorControl || '');
  const n = pickPrimaryMetric(metrics);

  // Bandas explícitas: "≤30 = objetivo; 31–45 = atención; >45 = alerta"
  const bandObjective = text.match(/(?:≤|<=)\s*([\d.,]+)\s*(?:días)?\s*=\s*objetivo/i)
    || text.match(/([\d.,]+)\s*[–-]\s*([\d.,]+)\s*(?:días)?\s*=\s*objetivo/i);
  const bandAttention = text.match(/([\d.,]+)\s*[–-]\s*([\d.,]+)\s*(?:días)?\s*=\s*atenci[oó]n/i)
    || text.match(/(?:≥|>=)\s*([\d.,]+)\s*=\s*objetivo;\s*([\d.,]+)\s*[–-]\s*([\d.,]+)\s*=\s*atenci[oó]n;\s*(?:<|≤)\s*([\d.,]+)\s*=\s*alerta/i);
  const bandAlert = text.match(/(?:>|≥|>=)\s*([\d.,]+)\s*(?:días)?\s*=\s*alerta/i)
    || text.match(/<\s*([\d.,]+)\s*=\s*alerta/i);

  // Patrón CyB: "≥0.33 = objetivo; 0.20–0.32 = atención; <0.20 = alerta"
  const cyb = text.match(/(?:≥|>=)\s*([\d.,]+)\s*=\s*objetivo;\s*([\d.,]+)\s*[–-]\s*([\d.,]+)\s*=\s*atenci[oó]n;\s*<\s*([\d.,]+)\s*=\s*alerta/i);
  if (cyb && Number.isFinite(n)) {
    const greenMin = num(cyb[1]);
    const yellowMin = num(cyb[2]);
    const yellowMax = num(cyb[3]);
    const redMax = num(cyb[4]);
    if (n >= greenMin) return 'verde';
    if (n >= yellowMin && n <= yellowMax) return 'amarillo';
    if (n < redMax) return 'rojo';
  }

  // Cumplimiento: "≥100% = cumplimiento; 90–99% = atención; <90% = alerta"
  const cumplimiento = text.match(/(?:≥|>=)\s*100%\s*=\s*cumplimiento;\s*90[–-]99%\s*=\s*atenci[oó]n;\s*<\s*90%\s*=\s*alerta/i);
  if (cumplimiento && Number.isFinite(n)) {
    if (n >= 100) return 'verde';
    if (n >= 90) return 'amarillo';
    return 'rojo';
  }

  // Rango "Entre X y Y"
  const entre = text.match(/entre\s*([\d.,]+)\s*y\s*([\d.,]+)/i);
  if (entre && Number.isFinite(n)) {
    const lo = num(entre[1]);
    const hi = num(entre[2]);
    const span = hi - lo;
    if (n >= lo && n <= hi) return 'verde';
    if (n >= lo - span * 0.15 && n <= hi + span * 0.15) return 'amarillo';
    return 'rojo';
  }

  // DRI estilo: "45–60 días = objetivo; 61–90 = atención; >90 = alerta crítica"
  const dri = text.match(/([\d.,]+)\s*[–-]\s*([\d.,]+)\s*d[ií]as?\s*=\s*objetivo;\s*([\d.,]+)\s*[–-]\s*([\d.,]+)\s*=\s*atenci[oó]n;\s*>\s*([\d.,]+)/i);
  if (dri && Number.isFinite(n)) {
    const g1 = num(dri[1]);
    const g2 = num(dri[2]);
    const y1 = num(dri[3]);
    const y2 = num(dri[4]);
    const r1 = num(dri[5]);
    if (n >= g1 && n <= g2) return 'verde';
    if (n >= y1 && n <= y2) return 'amarillo';
    if (n > r1) return 'rojo';
  }

  // Ciclo efectivo: "≤30 = objetivo; 31–45 = atención; >45 = alerta"
  const ciclo = text.match(/(?:≤|<=)\s*([\d.,]+)\s*(?:d[ií]as)?\s*=\s*objetivo;\s*([\d.,]+)\s*[–-]\s*([\d.,]+)\s*=\s*atenci[oó]n;\s*>\s*([\d.,]+)\s*=\s*alerta/i);
  if (ciclo && Number.isFinite(n)) {
    const greenMax = num(ciclo[1]);
    const y1 = num(ciclo[2]);
    const y2 = num(ciclo[3]);
    const redMin = num(ciclo[4]);
    if (n <= greenMax) return 'verde';
    if (n >= y1 && n <= y2) return 'amarillo';
    if (n > redMin) return 'rojo';
  }

  // Caída > X% = alerta → usar gap/pct del insight
  const caida = text.match(/ca[ií]da\s*>\s*([\d.,]+)\s*(?:p\.?p\.?|%)?/i);
  if (caida) {
    const threshold = num(caida[1]);
    const gap = Number(metrics.gap ?? metrics.ytdVar ?? metrics.variacion);
    if (Number.isFinite(gap) && gap <= -threshold) return 'rojo';
    if (Number.isFinite(gap) && gap < 0) return 'amarillo';
  }

  // Fallback por severity del motor operativo
  if (severity === 'critical') return 'rojo';
  if (severity === 'warning') return 'amarillo';
  if (severity === 'info') return 'verde';
  return null;
}

function num(raw) {
  const n = Number(String(raw).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

function pickPrimaryMetric(metrics = {}) {
  const keys = [
    'pct', 'pctCobertura', 'pctCob', 'avancePct', 'coberturaPct', 'margenBrutoPct',
    'avgDays', 'avgDaysInventory', 'ageing', 'ratio', 'liquidez', 'endeudamiento',
    'dri', 'drc', 'drp', 'ciclo', 'n', 'value', 'pctFunc', 'convCanal',
  ];
  for (const key of keys) {
    const v = Number(metrics[key]);
    if (Number.isFinite(v)) return v;
  }
  return NaN;
}

function severityFromSemaforo(semaforo) {
  if (semaforo === 'rojo') return 'critical';
  if (semaforo === 'amarillo') return 'warning';
  if (semaforo === 'verde') return 'info';
  return null;
}

function buildAccionAgente(insight, catalogEntry) {
  const kpiName = catalogEntry?.kpi || insight.title;
  const control = catalogEntry?.valorControl || '';
  // Interpretación = definición del KPI en catálogo (no reutilizar el análisis situacional).
  const interpretacion = catalogEntry?.interpretacion || '';
  const semaforo = insight.semaforo || 'amarillo';
  const tono = semaforo === 'rojo'
    ? 'está en riesgo (rojo)'
    : semaforo === 'amarillo'
      ? 'requiere ajuste (amarillo)'
      : 'está bajo control (verde)';

  return {
    label: 'Acción sugerida por el agente',
    short: semaforo === 'rojo'
      ? `Priorizar plan correctivo para ${kpiName}`
      : semaforo === 'amarillo'
        ? `Definir ajuste operativo para ${kpiName}`
        : `Mantener control y monitorear ${kpiName}`,
    prompt: [
      `Eres el agente analista de BALDERRAMA. El KPI «${kpiName}» ${tono}.`,
      catalogEntry?.clave ? `Clave catálogo ABP: ${catalogEntry.clave}.` : null,
      interpretacion ? `Interpretación del indicador: ${interpretacion}` : null,
      control ? `Valor de control (umbrales): ${control}` : null,
      insight.analysis ? `Análisis situacional: ${insight.analysis}` : null,
      `Hallazgo: ${insight.title}`,
      `Resumen: ${insight.summary || ''}`,
      insight.metrics ? `Métricas: ${JSON.stringify(insight.metrics)}` : null,
      'Entrega UNA acción prioritaria concreta (qué hacer, quién, en cuánto tiempo) y 2 acciones de soporte.',
      'No inventes cifras. Responde en español, breve y accionable.',
    ].filter(Boolean).join('\n'),
  };
}

function profilesForRole(roleId) {
  return ROLE_TO_CATALOG_PROFILES[roleId] || ROLE_TO_CATALOG_PROFILES.direccion;
}

function insightRelevantForRole(insight, roleId) {
  if (!roleId || roleId === 'administracion' || roleId === 'direccion') return true;
  const audience = insight.audiencia || [];
  if (!audience.length) return true;
  const profiles = profilesForRole(roleId).map(normalize);
  return audience.some((a) => profiles.some((p) => normalize(a).includes(p) || p.includes(normalize(a))));
}

/**
 * Enriquece un insight operativo con catálogo ABP + semáforo + acción agente.
 */
function enrichInsight(insight, { roleId } = {}) {
  if (!insight) return null;
  const catalogEntry = findCatalogEntry(insight);
  const valorControl = catalogEntry?.valorControl || null;
  const semaforo = evaluateSemaforoFromControl(valorControl, insight.metrics || {}, insight.severity)
    || (insight.severity === 'critical' ? 'rojo'
      : insight.severity === 'warning' ? 'amarillo'
        : insight.severity === 'info' ? 'verde' : 'amarillo');

  const severity = severityFromSemaforo(semaforo) || insight.severity || 'warning';

  // Previas / entregas: dueño operativo = Gerencia Comercial / Ventas (no Contabilidad).
  const isPreviasInsight = /sin-previas|entregas-sin-previas/i.test(String(insight.id || ''));
  const responsable = isPreviasInsight
    ? (insight.responsable || 'Gerente Comercial Ventas')
    : (insight.responsable || catalogEntry?.responsable || null);
  const audiencia = isPreviasInsight
    ? (insight.audiencia?.length ? insight.audiencia : ['Gerencia Comercial', 'Gerencia Ventas', 'CRM'])
    : (insight.audiencia?.length ? insight.audiencia : (catalogEntry?.usadoPor || []));

  const catalogInterp = String(catalogEntry?.interpretacion || '').trim();
  const analysisText = String(insight.analysis || '').trim();
  // Solo mostrar Interpretación si viene del catálogo y no duplica Análisis.
  const interpretacion = catalogInterp
    && catalogInterp.toLowerCase() !== analysisText.toLowerCase()
    ? catalogInterp
    : null;

  const enriched = {
    ...insight,
    severity,
    semaforo,
    semaforoLabel: semaforo === 'rojo' ? 'Riesgo alto' : semaforo === 'amarillo' ? 'Requiere ajuste' : 'En control',
    interpretacion,
    valorControl,
    catalogClave: catalogEntry?.clave || null,
    catalogKpi: catalogEntry?.kpi || null,
    audiencia,
    responsable,
  };
  enriched.accionAgente = buildAccionAgente(enriched, catalogEntry);

  if (roleId && !insightRelevantForRole(enriched, roleId)) {
    return null;
  }
  return enriched;
}

function enrichInsights(insights, options = {}) {
  return (Array.isArray(insights) ? insights : [])
    .map((insight) => enrichInsight(insight, options))
    .filter(Boolean);
}

function listCatalog({ perspectiva, roleId } = {}) {
  let items = loadCatalog();
  if (perspectiva) {
    const p = normalize(perspectiva);
    items = items.filter((item) => normalize(item.perspectiva) === p);
  }
  if (roleId && roleId !== 'administracion' && roleId !== 'direccion') {
    const profiles = profilesForRole(roleId).map(normalize);
    items = items.filter((item) =>
      (item.usadoPor || []).some((a) => profiles.some((p) => normalize(a).includes(p) || p.includes(normalize(a))))
    );
  }
  return items;
}

module.exports = {
  loadCatalog,
  listCatalog,
  enrichInsight,
  enrichInsights,
  evaluateSemaforoFromControl,
  insightRelevantForRole,
  ROLE_TO_CATALOG_PROFILES,
};
