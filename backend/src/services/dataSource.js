'use strict';
/**
 * Origen de datos del backend: SQL Server (DMS, por la red de la agencia) o la
 * réplica publicada en la nube. Adaptado de KPIs-VECSA, sin contraseñas en el
 * código: la réplica se lee con una llave de solo lectura (CLOUD_READ_API_KEY).
 *
 * DATA_SOURCE=auto (por omisión): SQL Server si responde; si no, la réplica.
 * DATA_SOURCE=sql | cloud: fuerza el modo.
 * Sin CLOUD_READ_URL/CLOUD_SYNC_URL o sin CLOUD_READ_API_KEY no hay modo nube:
 * el backend se queda en SQL Server, como antes.
 */
const PROBE_TIMEOUT_MS = 3000;
const PROBE_INTERVAL_MS = 60 * 1000;

const state = {
  mode: null,
  reason: null,
  checkedAt: null,
  timer: null,
  probing: null,
};

function configuredMode() {
  const v = String(process.env.DATA_SOURCE || 'auto').trim().toLowerCase();
  return v === 'sql' || v === 'cloud' ? v : 'auto';
}

function cloudReadUrl() {
  const url = String(process.env.CLOUD_READ_URL || process.env.CLOUD_SYNC_URL || '').trim();
  if (!url || /tu-api\.ejemplo\.com/.test(url)) return '';
  return url.replace(/\/$/, '');
}

function cloudReadKey() {
  return String(process.env.CLOUD_READ_API_KEY || '').trim();
}

function cloudReadConfigured() {
  return Boolean(cloudReadUrl() && cloudReadKey());
}

function setMode(mode, reason) {
  if (state.mode !== mode) {
    console.log(`[data-source] ${mode === 'cloud' ? 'Réplica en la nube' : 'SQL Server'} (${reason})`);
  }
  state.mode = mode;
  state.reason = reason;
  state.checkedAt = new Date().toISOString();
}

async function probeSql() {
  if (!String(process.env.DB_HOST || '').trim()) return { ok: false, reason: 'DB_HOST vacío' };
  const { query } = require('../db');
  let timer;
  try {
    await Promise.race([
      query('SELECT 1 AS ok'),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`sin respuesta en ${PROBE_TIMEOUT_MS / 1000} s`)), PROBE_TIMEOUT_MS);
      }),
    ]);
    return { ok: true, reason: `${process.env.DB_HOST} responde` };
  } catch (err) {
    return { ok: false, reason: `${process.env.DB_HOST}: ${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

/** Decide el modo. `probe` se puede sustituir en pruebas. */
async function refresh({ probe = probeSql } = {}) {
  const forced = configuredMode();
  if (forced === 'sql') {
    setMode('sql', 'DATA_SOURCE=sql');
    return state.mode;
  }
  if (!cloudReadConfigured()) {
    setMode('sql', 'réplica en la nube no configurada');
    return state.mode;
  }
  if (forced === 'cloud') {
    setMode('cloud', 'DATA_SOURCE=cloud');
    return state.mode;
  }
  if (!state.probing) {
    state.probing = probe()
      .then((r) => setMode(r.ok ? 'sql' : 'cloud', r.reason))
      .finally(() => { state.probing = null; });
  }
  await state.probing;
  return state.mode;
}

function start() {
  if (state.timer) return refresh();
  state.timer = setInterval(() => refresh().catch(() => {}), PROBE_INTERVAL_MS);
  if (typeof state.timer.unref === 'function') state.timer.unref();
  return refresh();
}

function getMode() {
  return state.mode || 'sql';
}

function isCloud() {
  return getMode() === 'cloud';
}

function getStatus() {
  return {
    mode: getMode(),
    configured: configuredMode(),
    reason: state.reason,
    checkedAt: state.checkedAt,
    cloudReadConfigured: cloudReadConfigured(),
    cloudUrl: cloudReadUrl() || null,
  };
}

/** Solo para pruebas. */
function _reset() {
  if (state.timer) clearInterval(state.timer);
  Object.assign(state, { mode: null, reason: null, checkedAt: null, timer: null, probing: null });
}

module.exports = {
  start,
  refresh,
  getMode,
  isCloud,
  getStatus,
  cloudReadUrl,
  cloudReadKey,
  cloudReadConfigured,
  _reset,
};
