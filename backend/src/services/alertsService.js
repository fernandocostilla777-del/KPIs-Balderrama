const fs = require('fs');
const path = require('path');
const { ROLES } = require('../auth/roles');

const PREFS_FILE = path.join(__dirname, '../../data/alertPrefs.json');

const ALERT_TYPES = [
  {
    id: 'inventario_envejecidas',
    label: 'Inventario envejecido 60+',
    description: 'Unidades disponibles con más de 60 días en piso.',
    severity: 'high',
    category: 'Inventario',
  },
  {
    id: 'inventario_sin_previas',
    label: 'Stock sin previas',
    description: 'Unidades en inventario sin órdenes de servicio previas.',
    severity: 'medium',
    category: 'Inventario',
  },
  {
    id: 'plan_piso',
    label: 'Plan piso acumulado',
    description: 'Intereses de plan piso en unidades disponibles.',
    severity: 'high',
    category: 'Inventario',
  },
  {
    id: 'entregas_sin_previa',
    label: 'Entregas sin previa',
    description: 'Entregas SOFIA del periodo sin previas de taller.',
    severity: 'medium',
    category: 'Ventas',
  },
  {
    id: 'sin_timbrar',
    label: 'Unidades sin timbrar',
    description: 'Facturas emitidas pendientes de timbrado.',
    severity: 'medium',
    category: 'Ventas',
  },
  {
    id: 'margen_asesores',
    label: 'Alerta de margen (asesores)',
    description: 'Asesores con alto volumen y bajo margen.',
    severity: 'high',
    category: 'Ventas',
  },
  {
    id: 'taller_abiertas',
    label: 'Órdenes de taller abiertas',
    description: 'Órdenes ingresadas pendientes de facturar en el periodo.',
    severity: 'low',
    category: 'Postventa',
  },
  {
    id: 'sistema',
    label: 'Avisos del sistema',
    description: 'Mensajes generales de la plataforma.',
    severity: 'low',
    category: 'Sistema',
  },
];

const DEFAULT_PREFS = {
  administracion: ALERT_TYPES.map((t) => t.id),
  direccion: [
    'inventario_envejecidas',
    'inventario_sin_previas',
    'plan_piso',
    'entregas_sin_previa',
    'sin_timbrar',
    'margen_asesores',
    'taller_abiertas',
    'sistema',
  ],
  gerencia_comercial: [
    'entregas_sin_previa',
    'sin_timbrar',
    'margen_asesores',
    'inventario_sin_previas',
    'sistema',
  ],
  vendedor: [
    'entregas_sin_previa',
    'inventario_sin_previas',
    'sistema',
  ],
  contabilidad: [
    'plan_piso',
    'sin_timbrar',
    'taller_abiertas',
    'sistema',
  ],
};

let cache = { at: 0, alerts: [] };
const CACHE_MS = 3 * 60 * 1000;

function listAlertTypes() {
  return ALERT_TYPES.map((t) => ({ ...t }));
}

function ensurePrefsFile() {
  if (fs.existsSync(PREFS_FILE)) return;
  savePrefs({ byRole: { ...DEFAULT_PREFS } });
}

function loadPrefs() {
  ensurePrefsFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8'));
    if (parsed?.byRole && typeof parsed.byRole === 'object') {
      const byRole = { ...DEFAULT_PREFS, ...parsed.byRole };
      for (const roleId of Object.keys(ROLES)) {
        if (!Array.isArray(byRole[roleId])) byRole[roleId] = [...(DEFAULT_PREFS[roleId] || [])];
      }
      return { byRole };
    }
  } catch {
    /* corrupt */
  }
  return { byRole: { ...DEFAULT_PREFS } };
}

function savePrefs(store) {
  fs.mkdirSync(path.dirname(PREFS_FILE), { recursive: true });
  fs.writeFileSync(PREFS_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function getPrefs() {
  return loadPrefs().byRole;
}

function getPrefsForRole(roleId) {
  const byRole = getPrefs();
  const enabled = byRole[roleId] || DEFAULT_PREFS[roleId] || [];
  return enabled.filter((id) => ALERT_TYPES.some((t) => t.id === id));
}

function updatePrefs(byRoleInput = {}) {
  const validIds = new Set(ALERT_TYPES.map((t) => t.id));
  const next = { ...DEFAULT_PREFS };
  for (const roleId of Object.keys(ROLES)) {
    const incoming = byRoleInput[roleId];
    if (!Array.isArray(incoming)) {
      next[roleId] = getPrefsForRole(roleId);
      continue;
    }
    next[roleId] = [...new Set(incoming.filter((id) => validIds.has(id)))];
  }
  savePrefs({ byRole: next });
  return next;
}

function monthToDateRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return {
    fechaInicio: `${y}-${m}-01`,
    fechaFin: `${y}-${m}-${d}`,
  };
}

function fmtMoney(n) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);
}

async function buildOperationalAlerts() {
  const now = Date.now();
  let sofiaLive = null;
  try {
    sofiaLive = require('./sofiaMonthEndLive').getSofiaLiveUpdateContext();
  } catch {
    sofiaLive = { active: false };
  }
  // Día de cierre SOFIA: sin caché para que las notificaciones de entrega se vean al momento
  const skipCache = Boolean(sofiaLive?.active);
  if (!skipCache && cache.alerts.length && now - cache.at < CACHE_MS) {
    return cache.alerts;
  }

  const alerts = [];
  let { fechaInicio, fechaFin } = monthToDateRange();
  if (sofiaLive?.active && sofiaLive.fechaInicio && sofiaLive.fechaFin) {
    fechaInicio = sofiaLive.fechaInicio;
    fechaFin = sofiaLive.fechaFin;
  }
  const periodLabel = `${fechaInicio} — ${fechaFin}`;

  try {
    const { getInventory } = require('./inventoryService');
    const inv = await getInventory({ planPisoPeriod: 'all' });
    const s = inv?.summary || {};
    if (Number(s.ageingAlertsCount) > 0) {
      alerts.push({
        id: `inv-age-${s.ageingAlertsCount}`,
        type: 'inventario_envejecidas',
        title: 'Inventario envejecido',
        message: `${s.ageingAlertsCount} unidad(es) con alertas de aging (60+ días).`,
        severity: 'high',
        href: '/inventory.html',
        createdAt: new Date().toISOString(),
      });
    }
    if (Number(s.sinPrevias) > 0) {
      alerts.push({
        id: `inv-prev-${s.sinPrevias}`,
        type: 'inventario_sin_previas',
        title: 'Stock sin previas',
        message: `${s.sinPrevias} unidad(es) disponibles sin previas de taller.`,
        severity: 'medium',
        href: '/inventory.html',
        createdAt: new Date().toISOString(),
      });
    }
    if (Number(s.planPisoTotal) > 0) {
      alerts.push({
        id: `inv-piso-${Math.round(s.planPisoTotal)}`,
        type: 'plan_piso',
        title: 'Plan piso acumulado',
        message: `${fmtMoney(s.planPisoTotal)} en ${s.planPisoUnits || 0} unidad(es).`,
        severity: 'high',
        href: '/inventory.html',
        createdAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.warn('[alerts] inventario:', err.message);
  }

  try {
    const { getVentas } = require('./ventas');
    const ventas = await getVentas({ fechaInicio, fechaFin });
    const r = ventas?.resumen || {};
    if (Number(r.totalEntregasSinPrevias) > 0) {
      alerts.push({
        id: `vta-prev-${r.totalEntregasSinPrevias}`,
        type: 'entregas_sin_previa',
        title: 'Entregas sin previa',
        message: `${r.totalEntregasSinPrevias} entrega(s) SOFIA sin previas · ${periodLabel}.`,
        severity: 'medium',
        href: '/sales.html',
        createdAt: new Date().toISOString(),
      });
    }
    if (Number(r.totalUnidadesFacturadasNoTimbradas) > 0) {
      alerts.push({
        id: `vta-tim-${r.totalUnidadesFacturadasNoTimbradas}`,
        type: 'sin_timbrar',
        title: 'Sin timbrar',
        message: `${r.totalUnidadesFacturadasNoTimbradas} unidad(es) facturadas pendientes de timbrar.`,
        severity: 'medium',
        href: '/sales.html',
        createdAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.warn('[alerts] ventas:', err.message);
  }

  try {
    const { loadSalesExecutiveAnalytics } = require('./salesExecutiveAnalytics');
    const analytics = await loadSalesExecutiveAnalytics({ fechaInicio, fechaFin });
    const ranking = analytics?.fuerzaVentas?.ranking || [];
    const regalo = ranking.filter((v) => v.quadrant === 'regalo').length;
    if (regalo > 0) {
      alerts.push({
        id: `vta-margen-${regalo}`,
        type: 'margen_asesores',
        title: 'Alerta de margen',
        message: `${regalo} asesor(es) con alto volumen y bajo margen · ${periodLabel}.`,
        severity: 'high',
        href: '/',
        createdAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.warn('[alerts] analytics:', err.message);
  }

  try {
    const { query } = require('../db');
    const [row] = await query(`
      SELECT
        COUNT(*) AS ingresadas,
        SUM(CASE WHEN o.ORE_STATUS = 'I' THEN 1 ELSE 0 END) AS facturadas
      FROM SER_ORDEN o
      WHERE o.ORE_FECHAORD IS NOT NULL
        AND LTRIM(RTRIM(o.ORE_FECHAORD)) <> ''
        AND CONVERT(DATE, o.ORE_FECHAORD, 103) >= @fechaInicio
        AND CONVERT(DATE, o.ORE_FECHAORD, 103) <= @fechaFin
    `, { fechaInicio, fechaFin });
    const ingresadas = Number(row?.ingresadas || 0);
    const facturadas = Number(row?.facturadas || 0);
    const abiertas = Math.max(0, ingresadas - facturadas);
    if (abiertas > 0) {
      alerts.push({
        id: `svc-abiertas-${abiertas}`,
        type: 'taller_abiertas',
        title: 'Órdenes pendientes de facturar',
        message: `${abiertas} de ${ingresadas} órdenes del periodo aún no facturadas.`,
        severity: 'low',
        href: '/post-sales.html',
        createdAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.warn('[alerts] taller:', err.message);
  }

  alerts.push({
    id: 'sys-ready',
    type: 'sistema',
    title: 'Centro de alertas activo',
    message: 'Las alertas se generan según el perfil y los indicadores operativos.',
    severity: 'low',
    href: null,
    createdAt: new Date().toISOString(),
  });

  cache = { at: Date.now(), alerts };
  return alerts;
}

function enrichAlert(alert) {
  const meta = ALERT_TYPES.find((t) => t.id === alert.type) || {};
  return {
    ...alert,
    typeLabel: meta.label || alert.type,
    category: meta.category || 'General',
    severity: alert.severity || meta.severity || 'low',
  };
}

async function getAlertsForRole(roleId) {
  const enabled = new Set(getPrefsForRole(roleId));
  const all = await buildOperationalAlerts();
  return all.filter((a) => enabled.has(a.type)).map(enrichAlert);
}

module.exports = {
  ALERT_TYPES,
  listAlertTypes,
  getPrefs,
  getPrefsForRole,
  updatePrefs,
  getAlertsForRole,
  buildOperationalAlerts,
};
