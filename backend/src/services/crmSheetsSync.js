/**
 * Scheduler de sincronización del Google Sheet CRM (leads, solicitudes, pruebas).
 * Corre cada N horas mientras el backend esté activo.
 */
const { syncCrmSheets } = require('../../scripts/sync-crm-sheets');
const crmCiclos = require('./crmCiclosService');

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;

const state = {
  enabled: true,
  intervalMs: FIVE_HOURS_MS,
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastOk: null,
  lastError: null,
  lastResult: null,
  nextRunAt: null,
  timer: null,
  runOnStart: false,
};

function getIntervalMs() {
  const hours = Number(process.env.CRM_SHEETS_SYNC_HOURS || 5);
  if (!Number.isFinite(hours) || hours <= 0) return FIVE_HOURS_MS;
  return Math.round(hours * 60 * 60 * 1000);
}

function isEnabled() {
  const raw = String(process.env.CRM_SHEETS_SYNC_ENABLED ?? 'true').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(raw);
}

function getStatus() {
  return {
    enabled: state.enabled,
    intervalMs: state.intervalMs,
    intervalHours: Math.round((state.intervalMs / 3600000) * 100) / 100,
    running: state.running,
    lastStartedAt: state.lastStartedAt,
    lastFinishedAt: state.lastFinishedAt,
    lastOk: state.lastOk,
    lastError: state.lastError,
    lastResult: state.lastResult,
    nextRunAt: state.nextRunAt,
  };
}

async function runSync({ reason = 'manual' } = {}) {
  if (state.running) {
    return { ok: false, skipped: true, reason: 'Ya hay una sincronización en curso' };
  }

  state.running = true;
  state.lastStartedAt = new Date().toISOString();
  state.lastError = null;
  console.log(`[crm-sheets-sync] Inicio (${reason}) ${state.lastStartedAt}`);

  try {
    // Liberar locks/readonly del servicio antes de escribir con ETL
    if (typeof crmCiclos.releaseDb === 'function') crmCiclos.releaseDb();

    const result = await syncCrmSheets({ quiet: false });

    if (typeof crmCiclos.releaseDb === 'function') crmCiclos.releaseDb();

    state.lastOk = true;
    state.lastResult = { ...result, reason };
    state.lastFinishedAt = new Date().toISOString();
    console.log(`[crm-sheets-sync] OK ${state.lastFinishedAt}`);
    return { ok: true, ...state.lastResult };
  } catch (err) {
    state.lastOk = false;
    state.lastError = err.message || String(err);
    state.lastFinishedAt = new Date().toISOString();
    console.error(`[crm-sheets-sync] Error: ${state.lastError}`);
    // Reabrir lectura aunque falle, para no dejar el servicio sin DB
    try {
      if (typeof crmCiclos.releaseDb === 'function') crmCiclos.releaseDb();
    } catch { /* ignore */ }
    return { ok: false, error: state.lastError, finishedAt: state.lastFinishedAt };
  } finally {
    state.running = false;
    if (state.timer) {
      state.nextRunAt = new Date(Date.now() + state.intervalMs).toISOString();
    }
  }
}

function scheduleNext() {
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(async () => {
    await runSync({ reason: 'schedule' });
    if (state.enabled) scheduleNext();
  }, state.intervalMs);
  if (typeof state.timer.unref === 'function') state.timer.unref();
  state.nextRunAt = new Date(Date.now() + state.intervalMs).toISOString();
}

function startScheduler() {
  state.enabled = isEnabled();
  state.intervalMs = getIntervalMs();
  state.runOnStart = String(process.env.CRM_SHEETS_SYNC_ON_START || 'false').toLowerCase() === 'true';

  if (!state.enabled) {
    console.log('[crm-sheets-sync] Desactivado (CRM_SHEETS_SYNC_ENABLED=false)');
    return getStatus();
  }

  console.log(
    `[crm-sheets-sync] Programado cada ${state.intervalMs / 3600000} h`
    + (state.runOnStart ? ' · también al arrancar' : '')
  );

  if (state.runOnStart) {
    setTimeout(() => {
      runSync({ reason: 'startup' }).finally(() => {
        if (state.enabled) scheduleNext();
      });
    }, 15_000).unref?.();
  } else {
    scheduleNext();
  }

  return getStatus();
}

function stopScheduler() {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  state.enabled = false;
  state.nextRunAt = null;
}

module.exports = {
  startScheduler,
  stopScheduler,
  runSync,
  getStatus,
};
