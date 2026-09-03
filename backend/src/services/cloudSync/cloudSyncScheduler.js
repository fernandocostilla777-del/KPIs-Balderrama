/**
 * Scheduler de sincronización local → API en la nube (PostgreSQL).
 *
 * - Cada N min (default 30): TODOS los dominios juntos
 *   (overview, ventas, forecast, inventario, contabilidad, crm, postventa, auth, personal)
 * - Día 1 del mes (02:00): cierre mensual del mes anterior (mismos dominios)
 */
const { collectDomain } = require('./cloudSyncCollector');
const { pushPayload, getCloudConfig, fetchCloudStatus } = require('./cloudSyncClient');
const { getCurrentMonthRange, getMonthRangeForKey } = require('./cloudSyncUtils');

/** Dominios que siempre viajan juntos en cada ciclo de sync. */
const SYNC_DOMAINS = [
  'overview',
  'ventas',
  'forecast',
  'inventario',
  'contabilidad',
  'crm',
  'postventa',
  'objetivos',
  'auth',
  'personal',
];

const state = {
  enabled: false,
  running: false,
  incrementalTimer: null,
  monthlyTimer: null,
  lastIncrementalAt: null,
  lastDailyAt: null,
  lastMonthlyAt: null,
  lastResults: {},
  lastError: null,
  nextIncrementalAt: null,
  nextDailyAt: null,
  nextMonthlyAt: null,
};

function isEnabled() {
  return getCloudConfig().enabled;
}

function msUntilNextMonthlyRun(now = new Date()) {
  const target = new Date(now.getFullYear(), now.getMonth() + 1, 1, 2, 0, 0, 0);
  if (target <= now) {
    target.setMonth(target.getMonth() + 1);
  }
  return Math.max(0, target.getTime() - now.getTime());
}

/** setTimeout en Node/V8 solo acepta hasta ~24.8 días (int32). */
const MAX_TIMER_MS = 12 * 60 * 60 * 1000; // reprogramar cada 12 h como máximo

function scheduleMonthly() {
  if (state.monthlyTimer) clearTimeout(state.monthlyTimer);
  const remaining = msUntilNextMonthlyRun();
  const delay = Math.min(remaining, MAX_TIMER_MS);
  state.monthlyTimer = setTimeout(() => {
    const left = msUntilNextMonthlyRun();
    if (left <= 60_000) {
      runSync({ type: 'monthly', reason: 'monthly' })
        .catch(() => {})
        .finally(() => scheduleMonthly());
    } else {
      scheduleMonthly();
    }
  }, Math.max(1_000, delay));
  if (typeof state.monthlyTimer.unref === 'function') state.monthlyTimer.unref();
  state.nextMonthlyAt = new Date(Date.now() + remaining).toISOString();
}

function getStatus() {
  const cfg = getCloudConfig();
  return {
    enabled: state.enabled,
    configured: Boolean(cfg.baseUrl && cfg.apiKey),
    cloudUrl: cfg.baseUrl || null,
    syncDomains: SYNC_DOMAINS,
    /** @deprecated alias — todos los dominios van en el mismo ciclo */
    incrementalDomains: SYNC_DOMAINS.filter((d) => d !== 'auth' && d !== 'postventa'),
    dailyDomain: 'postventa',
    running: state.running,
    lastIncrementalAt: state.lastIncrementalAt,
    lastDailyAt: state.lastDailyAt,
    lastMonthlyAt: state.lastMonthlyAt,
    lastResults: state.lastResults,
    lastError: state.lastError,
    nextIncrementalAt: state.nextIncrementalAt,
    nextDailyAt: null,
    nextMonthlyAt: state.nextMonthlyAt,
  };
}

async function syncDomain(domain, options = {}) {
  const payload = await collectDomain(domain, options);
  if (!payload.records?.length) {
    return { ok: true, domain, skipped: true, reason: 'Sin registros en el periodo' };
  }
  return pushPayload(payload);
}

/** Empuja usuarios del dashboard a Cloud API (login móvil unificado). */
async function syncAuthUsers({ reason = 'manual' } = {}) {
  try {
    const result = await syncDomain('auth', {});
    state.lastResults.auth = { reason, at: new Date().toISOString(), result };
    return result;
  } catch (err) {
    state.lastError = err.message;
    state.lastResults.auth = { reason, at: new Date().toISOString(), error: err.message };
    throw err;
  }
}

/**
 * Sincroniza TODOS los dominios del mes en curso en el mismo ciclo.
 */
async function refreshCrmSheetsForObjetivos() {
  const sheetsSync = require('../crmSheetsSync');
  console.log('[cloud-sync] Actualizando tráfico y solicitudes desde Google Sheets');
  return sheetsSync.runSync({
    reason: 'cloud-sync',
    skipCloud: true,
    etls: ['etl-crm-solicitudes.js', 'etl-crm-trafico-piso.js'],
  });
}

async function runFullSync({ reason = 'schedule', syncType = 'incremental' } = {}) {
  const range = getCurrentMonthRange();
  const results = {};
  const at = new Date().toISOString();

  try {
    results.crmSheets = await refreshCrmSheetsForObjetivos();
  } catch (err) {
    results.crmSheets = { ok: false, error: err.message };
    console.warn('[cloud-sync] No se pudo actualizar Sheets CRM:', err.message);
  }

  for (const domain of SYNC_DOMAINS) {
    const domainSyncType = domain === 'auth' || domain === 'personal' ? 'monthly' : syncType;
    results[domain] = await syncDomain(domain, {
      ...range,
      fechaInicio: range.fechaInicio,
      fechaFin: range.fechaFin,
      syncType: domainSyncType,
      periodKey: domain === 'auth' || domain === 'personal' ? undefined : range.periodKey,
    });
  }

  state.lastIncrementalAt = at;
  state.lastDailyAt = at;
  state.lastResults.full = { reason, syncType, at, ...range, domains: results };
  state.lastResults.incremental = state.lastResults.full;
  state.lastResults.daily = state.lastResults.full;
  return results;
}

async function runIncrementalSync({ reason = 'schedule' } = {}) {
  return runFullSync({ reason, syncType: 'incremental' });
}

/** Alias: daily = mismo sync completo (ya no solo postventa). */
async function runDailySync({ reason = 'daily' } = {}) {
  return runFullSync({ reason, syncType: 'daily' });
}

async function runMonthlySync({ reason = 'monthly' } = {}) {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const range = getMonthRangeForKey(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`);
  const results = {};
  for (const domain of SYNC_DOMAINS) {
    results[domain] = await syncDomain(domain, {
      periodKey: domain === 'auth' || domain === 'personal' ? undefined : range.periodKey,
      fechaInicio: range.fechaInicio,
      fechaFin: range.fechaFin,
      syncType: 'monthly',
    });
  }
  state.lastMonthlyAt = new Date().toISOString();
  state.lastResults.monthly = { reason, ...range, domains: results };
  return results;
}

async function runSync({ type = 'incremental', reason = 'manual' } = {}) {
  if (state.running) {
    return { ok: false, skipped: true, reason: 'Ya hay una sincronización en curso' };
  }
  if (!isEnabled()) {
    return { ok: false, skipped: true, reason: 'CLOUD_SYNC_ENABLED=false' };
  }

  state.running = true;
  state.lastError = null;
  console.log(`[cloud-sync] Inicio type=${type} (${reason}) — dominios: ${SYNC_DOMAINS.join(', ')}`);

  try {
    let result;
    if (type === 'daily' || type === 'full') result = await runDailySync({ reason });
    else if (type === 'monthly') result = await runMonthlySync({ reason });
    else result = await runIncrementalSync({ reason });

    console.log(`[cloud-sync] OK type=${type}`);
    return { ok: true, type, result };
  } catch (err) {
    state.lastError = err.message || String(err);
    console.error(`[cloud-sync] Error: ${state.lastError}`);
    return { ok: false, type, error: state.lastError };
  } finally {
    state.running = false;
  }
}

function scheduleIncremental() {
  if (state.incrementalTimer) clearInterval(state.incrementalTimer);
  const intervalMs = Math.max(5, Number(process.env.CLOUD_SYNC_INTERVAL_MINUTES || 30)) * 60 * 1000;
  state.incrementalTimer = setInterval(() => {
    runSync({ type: 'incremental', reason: 'schedule' }).catch(() => {});
  }, intervalMs);
  if (typeof state.incrementalTimer.unref === 'function') state.incrementalTimer.unref();
  state.nextIncrementalAt = new Date(Date.now() + intervalMs).toISOString();
}

function startScheduler() {
  state.enabled = isEnabled();
  if (!state.enabled) {
    console.log('[cloud-sync] Desactivado (CLOUD_SYNC_ENABLED=false)');
    return getStatus();
  }

  const cfg = getCloudConfig();
  if (!cfg.baseUrl || !cfg.apiKey) {
    console.log('[cloud-sync] Sin CLOUD_SYNC_URL o CLOUD_SYNC_API_KEY — scheduler no iniciado');
    return getStatus();
  }

  const intervalMin = Number(process.env.CLOUD_SYNC_INTERVAL_MINUTES || 30);
  console.log(
    `[cloud-sync] Programado: cada ${intervalMin} min TODOS los dominios juntos`
    + ` (${SYNC_DOMAINS.join(', ')})`
    + ' · cierre mensual día 1 02:00'
  );

  scheduleIncremental();
  scheduleMonthly();

  if (String(process.env.CLOUD_SYNC_ON_START || 'false').toLowerCase() === 'true') {
    setTimeout(() => {
      runSync({ type: 'incremental', reason: 'startup' }).catch(() => {});
    }, 20_000).unref?.();
  }

  return getStatus();
}

function stopScheduler() {
  if (state.incrementalTimer) clearInterval(state.incrementalTimer);
  if (state.monthlyTimer) clearTimeout(state.monthlyTimer);
  state.incrementalTimer = null;
  state.monthlyTimer = null;
  state.enabled = false;
}

module.exports = {
  startScheduler,
  stopScheduler,
  runSync,
  getStatus,
  fetchCloudStatus,
  syncDomain,
  syncAuthUsers,
  SYNC_DOMAINS,
};
