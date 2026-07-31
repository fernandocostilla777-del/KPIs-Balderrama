/**
 * Actualización en vivo de notificaciones de entrega SOFIA
 * el último día del mes (o el siguiente hábil si ese día es inhábil).
 *
 * Ese día se fuerza sync frecuente del dominio ventas (incluye SOFIA)
 * hacia Cloud API, y se marca el modo live para el dashboard/alertas.
 */
const {
  getSofiaLiveUpdateContext,
  getSofiaLiveUpdateDayForMonth,
  toIsoDate,
} = require('./businessCalendar');

const state = {
  enabled: true,
  timer: null,
  checkTimer: null,
  running: false,
  lastRunAt: null,
  lastResult: null,
  lastError: null,
  lastContext: null,
  nextCheckAt: null,
};

function liveIntervalMinutes() {
  const n = Number(process.env.SOFIA_LIVE_INTERVAL_MINUTES || 2);
  return Number.isFinite(n) && n > 0 ? Math.max(1, n) : 2;
}

function isSchedulerEnabled() {
  const raw = String(process.env.SOFIA_MONTH_END_LIVE_ENABLED ?? 'true').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off' && raw !== 'no';
}

function getStatus() {
  const ctx = getSofiaLiveUpdateContext();
  return {
    enabled: state.enabled && isSchedulerEnabled(),
    liveActive: Boolean(ctx.active),
    context: ctx.active ? ctx : { active: false, today: ctx.today },
    intervalMinutes: liveIntervalMinutes(),
    running: state.running,
    lastRunAt: state.lastRunAt,
    lastResult: state.lastResult,
    lastError: state.lastError,
    nextCheckAt: state.nextCheckAt,
  };
}

async function syncSofiaVentasLive(ctx, { reason = 'sofia-month-end-live' } = {}) {
  if (!ctx?.active) return { ok: false, skipped: true, reason: 'Hoy no es día de actualización en vivo SOFIA' };

  const { getCloudConfig } = require('./cloudSync/cloudSyncClient');
  const { syncDomain } = require('./cloudSync/cloudSyncScheduler');
  const cfg = getCloudConfig();
  if (!cfg.enabled || !cfg.baseUrl || !cfg.apiKey) {
    return {
      ok: true,
      skipped: true,
      reason: 'Cloud sync no configurado — modo live solo aplica a dashboard/API local',
      context: ctx,
    };
  }

  state.running = true;
  state.lastError = null;
  try {
    console.log(
      `[sofia-live] Sync ventas periodo ${ctx.periodKey} (${ctx.fechaInicio}→${ctx.fechaFin})`
      + (ctx.deferredFromNonWorking ? ' · diferido por día inhábil' : '')
    );
    const ventas = await syncDomain('ventas', {
      periodKey: ctx.periodKey,
      fechaInicio: ctx.fechaInicio,
      fechaFin: ctx.fechaFin,
      syncType: 'incremental',
    });
    // Overview lleva el snapshot SOFIA del KPI
    const overview = await syncDomain('overview', {
      periodKey: ctx.periodKey,
      fechaInicio: ctx.fechaInicio,
      fechaFin: ctx.fechaFin,
      syncType: 'incremental',
    });
    const result = {
      ok: true,
      reason,
      at: new Date().toISOString(),
      context: ctx,
      ventas,
      overview,
    };
    state.lastRunAt = result.at;
    state.lastResult = result;
    state.lastContext = ctx;
    console.log('[sofia-live] OK');
    return result;
  } catch (err) {
    state.lastError = err.message || String(err);
    console.error('[sofia-live] Error:', state.lastError);
    return { ok: false, reason, error: state.lastError, context: ctx };
  } finally {
    state.running = false;
  }
}

async function tickLiveSync() {
  const ctx = getSofiaLiveUpdateContext();
  if (!ctx.active) return { ok: true, skipped: true, reason: 'inactive' };
  if (state.running) return { ok: false, skipped: true, reason: 'already-running' };
  return syncSofiaVentasLive(ctx);
}

function clearLiveTimer() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

function ensureLiveTimer() {
  clearLiveTimer();
  const ctx = getSofiaLiveUpdateContext();
  if (!ctx.active || !isSchedulerEnabled()) return;

  const ms = liveIntervalMinutes() * 60 * 1000;
  console.log(
    `[sofia-live] Activo hoy ${ctx.today} · cierre ${ctx.periodKey}`
    + (ctx.deferredFromNonWorking ? ` (último día ${ctx.lastCalendarDay} inhábil → ${ctx.liveDay})` : '')
    + ` · cada ${liveIntervalMinutes()} min`
  );
  // Disparo inmediato
  setTimeout(() => {
    tickLiveSync().catch(() => {});
  }, 8_000).unref?.();

  state.timer = setInterval(() => {
    tickLiveSync().catch(() => {});
  }, ms);
  if (typeof state.timer.unref === 'function') state.timer.unref();
}

function scheduleDailyCheck() {
  if (state.checkTimer) clearInterval(state.checkTimer);
  // Revisa cada hora si entramos/salimos del día live
  state.checkTimer = setInterval(() => {
    const ctx = getSofiaLiveUpdateContext();
    if (ctx.active && !state.timer) ensureLiveTimer();
    if (!ctx.active && state.timer) {
      clearLiveTimer();
      console.log('[sofia-live] Día de actualización en vivo terminado');
    }
    state.nextCheckAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  }, 60 * 60 * 1000);
  if (typeof state.checkTimer.unref === 'function') state.checkTimer.unref();
  state.nextCheckAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
}

function startScheduler() {
  state.enabled = isSchedulerEnabled();
  if (!state.enabled) {
    console.log('[sofia-live] Desactivado (SOFIA_MONTH_END_LIVE_ENABLED=false)');
    return getStatus();
  }

  const now = new Date();
  const liveThisMonth = getSofiaLiveUpdateDayForMonth(now.getFullYear(), now.getMonth());
  console.log(
    `[sofia-live] Programado · actualización en vivo el ${toIsoDate(liveThisMonth)}`
    + ' (último día del mes o siguiente hábil)'
  );

  ensureLiveTimer();
  scheduleDailyCheck();
  return getStatus();
}

function stopScheduler() {
  clearLiveTimer();
  if (state.checkTimer) clearInterval(state.checkTimer);
  state.checkTimer = null;
  state.enabled = false;
}

module.exports = {
  startScheduler,
  stopScheduler,
  getStatus,
  getSofiaLiveUpdateContext,
  syncSofiaVentasLive,
  tickLiveSync,
};
