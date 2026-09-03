/**
 * Scheduler de sincronización del Google Sheet CRM (leads, solicitudes, tráfico).
 * Corre a las 9:00, 12:00 y 18:00 (hora de México) mientras el backend esté activo.
 * Al terminar, publica el snapshot de Objetivos Web en la nube.
 */
const { syncCrmSheets } = require('../../scripts/sync-crm-sheets');
const crmCiclos = require('./crmCiclosService');

const MAX_TIMER_MS = 12 * 60 * 60 * 1000;
const DEFAULT_HOURS = [9, 12, 18];
const DEFAULT_TZ = 'America/Mexico_City';

const state = {
  enabled: true,
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastOk: null,
  lastError: null,
  lastResult: null,
  nextRunAt: null,
  timer: null,
  runOnStart: false,
  clockHours: DEFAULT_HOURS,
  timeZone: DEFAULT_TZ,
};

function isEnabled() {
  const raw = String(process.env.CRM_SHEETS_SYNC_ENABLED ?? 'true').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(raw);
}

function getTimeZone() {
  return String(process.env.CRM_SHEETS_SYNC_TZ || DEFAULT_TZ).trim() || DEFAULT_TZ;
}

function getClockHours() {
  const raw = String(process.env.CRM_SHEETS_SYNC_AT || '9,12,18');
  const hours = raw
    .split(/[,;\s]+/)
    .map((part) => Number(part))
    .filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23);
  return hours.length ? [...new Set(hours)].sort((a, b) => a - b) : [...DEFAULT_HOURS];
}

function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const map = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function addCalendarDays(parts, days) {
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0);
  const date = new Date(utc);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function zonedLocalToUtcMs({ year, month, day, hour, minute = 0, second = 0 }, timeZone) {
  let guess = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 4; i += 1) {
    const shown = zonedParts(new Date(guess), timeZone);
    const shownUtc = Date.UTC(
      shown.year,
      shown.month - 1,
      shown.day,
      shown.hour,
      shown.minute,
      shown.second,
    );
    const wantUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    const delta = wantUtc - shownUtc;
    if (delta === 0) break;
    guess += delta;
  }
  return guess;
}

function nextRunMs(now = new Date()) {
  const timeZone = getTimeZone();
  const hours = getClockHours();
  const parts = zonedParts(now, timeZone);
  const nowMs = now.getTime();
  let best = null;
  for (const add of [0, 1]) {
    const day = addCalendarDays(parts, add);
    for (const hour of hours) {
      const ms = zonedLocalToUtcMs({ ...day, hour, minute: 0, second: 0 }, timeZone);
      if (ms > nowMs + 2000 && (best == null || ms < best)) best = ms;
    }
  }
  return best || nowMs + 60 * 60 * 1000;
}

function getStatus() {
  return {
    enabled: state.enabled,
    clockHours: state.clockHours,
    timeZone: state.timeZone,
    running: state.running,
    lastStartedAt: state.lastStartedAt,
    lastFinishedAt: state.lastFinishedAt,
    lastOk: state.lastOk,
    lastError: state.lastError,
    lastResult: state.lastResult,
    nextRunAt: state.nextRunAt,
  };
}

async function pushObjetivosToCloud() {
  const { getCloudConfig } = require('./cloudSync/cloudSyncClient');
  const { syncDomain } = require('./cloudSync/cloudSyncScheduler');
  const { getCurrentMonthRange } = require('./cloudSync/cloudSyncUtils');
  const cfg = getCloudConfig();
  if (!cfg.enabled || !cfg.baseUrl || !cfg.apiKey) {
    return { skipped: true, reason: 'Cloud sync no configurado' };
  }
  const range = getCurrentMonthRange();
  console.log(`[crm-sheets-sync] Publicando Objetivos Web ${range.periodKey} en la nube`);
  return syncDomain('objetivos', {
    ...range,
    syncType: 'incremental',
  });
}

async function runSync({ reason = 'manual', skipCloud = false, etls } = {}) {
  if (state.running) {
    return { ok: false, skipped: true, reason: 'Ya hay una sincronización en curso' };
  }

  state.running = true;
  state.lastStartedAt = new Date().toISOString();
  state.lastError = null;
  console.log(`[crm-sheets-sync] Inicio (${reason}) ${state.lastStartedAt}`);

  try {
    if (typeof crmCiclos.releaseDb === 'function') crmCiclos.releaseDb();

    const result = await syncCrmSheets({ quiet: false, etls });

    if (typeof crmCiclos.releaseDb === 'function') crmCiclos.releaseDb();

    let cloud = null;
    if (!skipCloud) {
      try {
        cloud = await pushObjetivosToCloud();
      } catch (err) {
        cloud = { ok: false, error: err.message };
        console.warn('[crm-sheets-sync] No se pudo publicar objetivos:', err.message);
      }
    }

    state.lastOk = true;
    state.lastResult = { ...result, reason, cloud };
    state.lastFinishedAt = new Date().toISOString();
    console.log(`[crm-sheets-sync] OK ${state.lastFinishedAt}`);
    return { ok: true, ...state.lastResult };
  } catch (err) {
    state.lastOk = false;
    state.lastError = err.message || String(err);
    state.lastFinishedAt = new Date().toISOString();
    console.error(`[crm-sheets-sync] Error: ${state.lastError}`);
    try {
      if (typeof crmCiclos.releaseDb === 'function') crmCiclos.releaseDb();
    } catch { /* ignore */ }
    return { ok: false, error: state.lastError, finishedAt: state.lastFinishedAt };
  } finally {
    state.running = false;
  }
}

function scheduleNext() {
  if (state.timer) clearTimeout(state.timer);
  const targetMs = nextRunMs();
  const delay = Math.min(Math.max(1000, targetMs - Date.now()), MAX_TIMER_MS);
  state.timer = setTimeout(async () => {
    const remaining = nextRunMs() - Date.now();
    if (remaining <= 60_000) {
      await runSync({ reason: 'schedule' });
    }
    if (state.enabled) scheduleNext();
  }, delay);
  if (typeof state.timer.unref === 'function') state.timer.unref();
  state.nextRunAt = new Date(targetMs).toISOString();
}

function startScheduler() {
  state.enabled = isEnabled();
  state.clockHours = getClockHours();
  state.timeZone = getTimeZone();
  state.runOnStart = String(process.env.CRM_SHEETS_SYNC_ON_START || 'true').toLowerCase() !== 'false';

  if (!state.enabled) {
    console.log('[crm-sheets-sync] Desactivado (CRM_SHEETS_SYNC_ENABLED=false)');
    return getStatus();
  }

  const hoursLabel = state.clockHours.map((h) => `${String(h).padStart(2, '0')}:00`).join(', ');
  console.log(
    `[crm-sheets-sync] Programado a las ${hoursLabel} (${state.timeZone})`
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
