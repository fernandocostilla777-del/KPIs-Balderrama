'use strict';
/**
 * Escritorio (Electron): el CRM no usa el SQLite de oficina.
 * Arranca vacío y baja ciclos + tablas Sheets desde Railway a CRM_SQLITE_PATH
 * (caché en userData). La oficina sigue con su .db + ETL.
 */
const { canPullViaApi, pullCrmCiclosFromCloud, localCrmStatus } = require('./crmCloudPull');

function isDesktopCloudCrm() {
  return process.env.DESKTOP_MANAGED === '1'
    || ['1', 'true', 'yes', 'cloud'].includes(String(process.env.DESKTOP_CRM_CLOUD || '').trim().toLowerCase())
    || String(process.env.CRM_SOURCE || '').trim().toLowerCase() === 'cloud';
}

function sheetsMissingOrEmpty(status) {
  const sheets = status?.sheets || {};
  const leads = Number(sheets.crm_leads || 0);
  const trafico = Number(sheets.crm_trafico_piso || 0);
  return leads <= 0 || trafico <= 0;
}

/**
 * Garantiza caché CRM desde la nube. Idempotente.
 * @returns {Promise<object>}
 */
async function bootstrapDesktopCrmFromCloud({ force = false } = {}) {
  if (!isDesktopCloudCrm()) {
    return { skipped: true, reason: 'no es escritorio cloud' };
  }
  if (!canPullViaApi()) {
    return {
      ok: false,
      reason: 'Faltan CLOUD_SYNC_URL / CLOUD_SYNC_API_KEY para bajar el CRM',
    };
  }

  const before = localCrmStatus();
  const pullOnStart = !['0', 'false', 'no', 'off'].includes(
    String(process.env.CRM_CLOUD_PULL_ON_START ?? 'true').trim().toLowerCase(),
  );
  const cacheIncomplete = !before.exists || !before.ciclosLive || sheetsMissingOrEmpty(before);
  const needs = force || (pullOnStart && cacheIncomplete);

  if (!needs) {
    return { ok: true, skipped: true, reason: 'caché cloud ya lista', local: before };
  }

  console.log('[desktop-crm] Bajando CRM desde la nube (sin SQLite de oficina)…');
  const result = await pullCrmCiclosFromCloud({ sheets: true, full: true });
  try {
    require('./crmCiclosService').releaseDb();
  } catch { /* ignore */ }

  const after = localCrmStatus();
  console.log(
    `[desktop-crm] listo · ciclos=${after.ciclosLive || 0}`
    + ` · leads=${after.sheets?.crm_leads || 0}`
    + ` · tráfico=${after.sheets?.crm_trafico_piso || 0}`
    + ` · ${result.ms || '?'} ms`,
  );
  return { ...result, local: after, via: 'cloud-api' };
}

module.exports = {
  isDesktopCloudCrm,
  bootstrapDesktopCrmFromCloud,
};
