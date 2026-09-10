/**
 * Scheduler de sincronización del Google Sheet CRM (leads, solicitudes, tráfico, F&I…).
 * Corre a las 10:00, 16:00, 18:00 y 19:50 (hora de México) mientras el backend esté activo.
 * La corrida 19:50 es carga completa de fuentes para Objetivos Web + publicación a la nube.
 */
const { syncCrmSheets, ALL_ETLS } = require('../../scripts/sync-crm-sheets');
const crmCiclos = require('./crmCiclosService');

const MAX_TIMER_MS = 12 * 60 * 60 * 1000;
/** Horas enteras legacy + cargas Objetivos Web a las 19:50 y 20:10. */
const DEFAULT_SLOTS = [
  { hour: 10, minute: 0 },
  { hour: 16, minute: 0 },
  { hour: 18, minute: 0 },
  { hour: 19, minute: 50 },
];
const DEFAULT_TZ = 'America/Mexico_City';
const DEFAULT_SLOTS_LABEL = '10,16,18,19:50';
const OBJETIVOS_FULL_SLOTS = [
  { hour: 19, minute: 50 },
];

const state = {
  enabled: true,
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastOk: null,
  lastError: null,
  lastResult: null,
  nextRunAt: null,
  nextSlot: null,
  timer: null,
  runOnStart: false,
  clockSlots: DEFAULT_SLOTS.map((s) => ({ ...s })),
  timeZone: DEFAULT_TZ,
};

function isEnabled() {
  const raw = String(process.env.CRM_SHEETS_SYNC_ENABLED ?? 'true').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(raw);
}

function getTimeZone() {
  return String(process.env.CRM_SHEETS_SYNC_TZ || DEFAULT_TZ).trim() || DEFAULT_TZ;
}

/**
 * Acepta "10,16,18,19:50" o "10:00,16:00,18:00,19:50".
 * Hora sola ⇒ :00. Duplicados se eliminan.
 */
function parseClockSlots(raw) {
  const text = String(raw || '').trim();
  if (!text) return DEFAULT_SLOTS.map((s) => ({ ...s }));

  const slots = [];
  for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
    if (!m) continue;
    const hour = Number(m[1]);
    const minute = m[2] != null ? Number(m[2]) : 0;
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) continue;
    slots.push({ hour, minute });
  }

  if (!slots.length) return DEFAULT_SLOTS.map((s) => ({ ...s }));

  const key = (s) => `${s.hour}:${s.minute}`;
  const unique = [];
  const seen = new Set();
  for (const s of slots.sort((a, b) => a.hour - b.hour || a.minute - b.minute)) {
    const k = key(s);
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(s);
  }
  return unique;
}

function getClockSlots() {
  return parseClockSlots(process.env.CRM_SHEETS_SYNC_AT || DEFAULT_SLOTS_LABEL);
}

function formatSlot(slot) {
  return `${String(slot.hour).padStart(2, '0')}:${String(slot.minute).padStart(2, '0')}`;
}

/** Cierre diario de Objetivos Web: todas las hojas CRM + push a cloud. */
function isObjetivosFullSlot(slot) {
  if (!slot) return false;
  return OBJETIVOS_FULL_SLOTS.some((s) => s.hour === slot.hour && s.minute === slot.minute);
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

function nextRun(now = new Date()) {
  const timeZone = getTimeZone();
  const slots = getClockSlots();
  const parts = zonedParts(now, timeZone);
  const nowMs = now.getTime();
  let best = null;
  let bestSlot = null;
  for (const add of [0, 1]) {
    const day = addCalendarDays(parts, add);
    for (const slot of slots) {
      const ms = zonedLocalToUtcMs(
        { ...day, hour: slot.hour, minute: slot.minute, second: 0 },
        timeZone,
      );
      if (ms > nowMs + 2000 && (best == null || ms < best)) {
        best = ms;
        bestSlot = slot;
      }
    }
  }
  return {
    ms: best || nowMs + 60 * 60 * 1000,
    slot: bestSlot,
  };
}

function nextRunMs(now = new Date()) {
  return nextRun(now).ms;
}

function getStatus() {
  return {
    enabled: state.enabled,
    clockSlots: state.clockSlots.map(formatSlot),
    /** Compat: solo horas (sin minutos). */
    clockHours: [...new Set(state.clockSlots.map((s) => s.hour))],
    timeZone: state.timeZone,
    running: state.running,
    lastStartedAt: state.lastStartedAt,
    lastFinishedAt: state.lastFinishedAt,
    lastOk: state.lastOk,
    lastError: state.lastError,
    lastResult: state.lastResult,
    nextRunAt: state.nextRunAt,
    nextSlot: state.nextSlot ? formatSlot(state.nextSlot) : null,
    objetivosFullAt: OBJETIVOS_FULL_SLOTS.map(formatSlot),
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

/**
 * @param {{ reason?: string, skipCloud?: boolean, etls?: string[], fullObjetivos?: boolean }} opts
 */
async function runSync({ reason = 'manual', skipCloud = false, etls, fullObjetivos = false } = {}) {
  if (state.running) {
    return { ok: false, skipped: true, reason: 'Ya hay una sincronización en curso' };
  }

  state.running = true;
  state.lastStartedAt = new Date().toISOString();
  state.lastError = null;
  const useFull = fullObjetivos
    || reason.includes('19:50')
    || reason.includes('objetivos-full');
  const etlList = useFull ? undefined : etls;
  console.log(
    `[crm-sheets-sync] Inicio (${reason})${useFull ? ' · FULL Objetivos Web' : ''} ${state.lastStartedAt}`,
  );

  try {
    if (typeof crmCiclos.releaseDb === 'function') crmCiclos.releaseDb();

    // Full = todos los ETL del sheet (leads, solicitudes, tráfico, F&I, pagos GMF, CSI…).
    const result = await syncCrmSheets({ quiet: false, etls: etlList });

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
    state.lastResult = {
      ...result,
      reason,
      fullObjetivos: useFull,
      etls: useFull ? ALL_ETLS : (etlList || ALL_ETLS),
      cloud,
    };
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
  const upcoming = nextRun();
  const delay = Math.min(Math.max(1000, upcoming.ms - Date.now()), MAX_TIMER_MS);
  state.nextRunAt = new Date(upcoming.ms).toISOString();
  state.nextSlot = upcoming.slot || null;
  const scheduledSlot = upcoming.slot ? { ...upcoming.slot } : null;
  const scheduledMs = upcoming.ms;
  state.timer = setTimeout(async () => {
    const remaining = scheduledMs - Date.now();
    if (remaining <= 60_000) {
      const slot = scheduledSlot;
      const label = slot ? formatSlot(slot) : 'schedule';
      const full = isObjetivosFullSlot(slot);
      await runSync({
        reason: full ? `schedule-${label}-objetivos-full` : `schedule-${label}`,
        fullObjetivos: full,
      });
    }
    if (state.enabled) scheduleNext();
  }, delay);
  if (typeof state.timer.unref === 'function') state.timer.unref();
}

function startScheduler() {
  state.enabled = isEnabled();
  state.clockSlots = getClockSlots();
  state.timeZone = getTimeZone();
  state.runOnStart = String(process.env.CRM_SHEETS_SYNC_ON_START || 'true').toLowerCase() !== 'false';

  if (!state.enabled) {
    console.log('[crm-sheets-sync] Desactivado (CRM_SHEETS_SYNC_ENABLED=false)');
    return getStatus();
  }

  const slotsLabel = state.clockSlots.map(formatSlot).join(', ');
  const fullLabel = OBJETIVOS_FULL_SLOTS.map(formatSlot).join(' y ');
  console.log(
    `[crm-sheets-sync] Programado a las ${slotsLabel} (${state.timeZone})`
    + ` · ${fullLabel} = carga completa Objetivos Web`
    + (state.runOnStart ? ' · también al arrancar' : ''),
  );

  if (state.runOnStart) {
    setTimeout(() => {
      runSync({ reason: 'startup' }).finally(() => {
        if (state.enabled) scheduleNext();
      });
    }, 8_000);
  } else {
    scheduleNext();
  }

  return getStatus();
}

module.exports = {
  startScheduler,
  runSync,
  getStatus,
  nextRunMs,
  parseClockSlots,
  ALL_ETLS,
};
