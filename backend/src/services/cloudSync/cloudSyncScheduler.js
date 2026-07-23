/**
 * Scheduler de sincronización local → API en la nube (PostgreSQL).
 *
 * - Cada 30 min: ventas, inventario, contabilidad, CRM/leads (solo mes en curso)
 * - Inicio del día: postventa
 * - Día 1 del mes (02:00): cierre mensual con detección de bajas
 */
const { collectDomain } = require('./cloudSyncCollector');
const { pushPayload, getCloudConfig, fetchCloudStatus } = require('./cloudSyncClient');
const { getCurrentMonthRange, getMonthRangeForKey } = require('./cloudSyncUtils');

const THIRTY_MIN_MS = 30 * 60 * 1000;
const INCREMENTAL_DOMAINS = ['overview', 'ventas', 'forecast', 'inventario', 'contabilidad', 'crm'];

const state = {
  enabled: false,
  running: false,
  incrementalTimer: null,
  dailyTimer: null,
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

function getDailyHour() {
  const h = Number(process.env.CLOUD_SYNC_DAILY_HOUR ?? 6);
  return Number.isFinite(h) && h >= 0 && h <= 23 ? Math.floor(h) : 6;
}

function msUntilNextDailyRun(now = new Date()) {
  const target = new Date(now);
  target.setHours(getDailyHour(), 0, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

function msUntilNextMonthlyRun(now = new Date()) {
  const target = new Date(now.getFullYear(), now.getMonth() + 1, 1, 2, 0, 0, 0);
  if (target <= now) {
    target.setMonth(target.getMonth() + 1);
  }
  return target.getTime() - now.getTime();
}

function getStatus() {
  const cfg = getCloudConfig();
  return {
    enabled: state.enabled,
    configured: Boolean(cfg.baseUrl && cfg.apiKey),
    cloudUrl: cfg.baseUrl || null,
    incrementalDomains: INCREMENTAL_DOMAINS,
    dailyDomain: 'postventa',
    dailyHour: getDailyHour(),
    running: state.running,
    lastIncrementalAt: state.lastIncrementalAt,
    lastDailyAt: state.lastDailyAt,
    lastMonthlyAt: state.lastMonthlyAt,
    lastResults: state.lastResults,
    lastError: state.lastError,
    nextIncrementalAt: state.nextIncrementalAt,
    nextDailyAt: state.nextDailyAt,
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

async function runIncrementalSync({ reason = 'schedule' } = {}) {
  const range = getCurrentMonthRange();
  const results = {};
  for (const domain of INCREMENTAL_DOMAINS) {
    results[domain] = await syncDomain(domain, {
      ...range,
      fechaInicio: range.fechaInicio,
      fechaFin: range.fechaFin,
      syncType: 'incremental',
    });
  }
  state.lastIncrementalAt = new Date().toISOString();
  state.lastResults.incremental = { reason, ...range, domains: results };
  return results;
}

async function runDailySync({ reason = 'daily' } = {}) {
  const range = getCurrentMonthRange();
  const result = await syncDomain('postventa', {
    ...range,
    fechaInicio: range.fechaInicio,
    fechaFin: range.fechaFin,
    syncType: 'daily',
  });
  state.lastDailyAt = new Date().toISOString();
  state.lastResults.daily = { reason, ...range, postventa: result };
  return result;
}

async function runMonthlySync({ reason = 'monthly' } = {}) {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const range = getMonthRangeForKey(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`);
  const results = {};
  for (const domain of [...INCREMENTAL_DOMAINS, 'postventa']) {
    results[domain] = await syncDomain(domain, {
      periodKey: range.periodKey,
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
  console.log(`[cloud-sync] Inicio type=${type} (${reason})`);

  try {
    let result;
    if (type === 'daily') result = await runDailySync({ reason });
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

function scheduleDaily() {
  if (state.dailyTimer) clearTimeout(state.dailyTimer);
  const delay = msUntilNextDailyRun();
  state.dailyTimer = setTimeout(() => {
    runSync({ type: 'daily', reason: 'daily' })
      .catch(() => {})
      .finally(() => scheduleDaily());
  }, delay);
  if (typeof state.dailyTimer.unref === 'function') state.dailyTimer.unref();
  state.nextDailyAt = new Date(Date.now() + delay).toISOString();
}

function scheduleMonthly() {
  if (state.monthlyTimer) clearTimeout(state.monthlyTimer);
  const delay = msUntilNextMonthlyRun();
  state.monthlyTimer = setTimeout(() => {
    runSync({ type: 'monthly', reason: 'monthly' })
      .catch(() => {})
      .finally(() => scheduleMonthly());
  }, delay);
  if (typeof state.monthlyTimer.unref === 'function') state.monthlyTimer.unref();
  state.nextMonthlyAt = new Date(Date.now() + delay).toISOString();
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
    `[cloud-sync] Programado: cada ${intervalMin} min (overview/ventas/pronóstico/inventario/contabilidad/crm)`
    + ` · postventa ${getDailyHour()}:00`
    + ' · cierre mensual día 1 02:00'
  );

  scheduleIncremental();
  scheduleDaily();
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
  if (state.dailyTimer) clearTimeout(state.dailyTimer);
  if (state.monthlyTimer) clearTimeout(state.monthlyTimer);
  state.incrementalTimer = null;
  state.dailyTimer = null;
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
};
