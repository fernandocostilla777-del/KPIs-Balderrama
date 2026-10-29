const os = require('os');
const { chunkArray } = require('./cloudSyncUtils');

function getCloudConfig() {
  const enabled = !['0', 'false', 'no', 'off'].includes(
    String(process.env.CLOUD_SYNC_ENABLED ?? 'false').trim().toLowerCase()
  );
  const baseUrl = String(process.env.CLOUD_SYNC_URL || '').trim().replace(/\/$/, '');
  const apiKey = String(process.env.CLOUD_SYNC_API_KEY || '').trim();
  const sourceHost = String(process.env.CLOUD_SYNC_SOURCE_HOST || os.hostname()).trim();
  const chunkSize = Math.max(50, Number(process.env.CLOUD_SYNC_CHUNK_SIZE || 300));
  return { enabled, baseUrl, apiKey, sourceHost, chunkSize };
}

function assertConfigured() {
  const cfg = getCloudConfig();
  if (!cfg.enabled) {
    throw new Error('CLOUD_SYNC_ENABLED=false');
  }
  if (!cfg.baseUrl) {
    throw new Error('CLOUD_SYNC_URL no configurada');
  }
  if (!cfg.apiKey) {
    throw new Error('CLOUD_SYNC_API_KEY no configurada');
  }
  return cfg;
}

/** Auth de usuarios: basta URL + API key (no exige CLOUD_SYNC_ENABLED). */
function assertCloudCredentials() {
  const cfg = getCloudConfig();
  if (!cfg.baseUrl) {
    throw new Error('CLOUD_SYNC_URL no configurada');
  }
  if (!cfg.apiKey) {
    throw new Error('CLOUD_SYNC_API_KEY no configurada');
  }
  return cfg;
}

async function postJson(url, body, apiKey) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data.error || data.detail || res.statusText || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function pushPayload(payload, { requireEnabled = true } = {}) {
  const cfg = requireEnabled ? assertConfigured() : assertCloudCredentials();
  // personal: un solo lote (reemplazo completo de activos); no trocear
  // auth: un solo lote (replaceAll mensual en auth_users)
  const chunks = (payload.domain === 'personal' || payload.domain === 'auth')
    ? [payload.records || []]
    : chunkArray(payload.records || [], cfg.chunkSize);
  if (!chunks.length || (chunks.length === 1 && !(chunks[0] || []).length)) {
    return { ok: true, skipped: true, reason: 'Sin registros para enviar' };
  }

  const results = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const body = {
      domain: payload.domain,
      syncType: payload.syncType,
      periodKey: payload.periodKey,
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd,
      sourceHost: cfg.sourceHost,
      meta: payload.meta
        ? { ...payload.meta, chunk: i + 1, totalChunks: chunks.length }
        : { chunk: i + 1, totalChunks: chunks.length },
      records: chunks[i],
    };
    const result = await postJson(`${cfg.baseUrl}/api/sync/ingest`, body, cfg.apiKey);
    results.push(result);
  }

  const last = results[results.length - 1] || {};
  return {
    ok: true,
    domain: payload.domain,
    syncType: payload.syncType,
    periodKey: payload.periodKey,
    chunks: chunks.length,
    recordCount: payload.records.length,
    batchId: last.batchId,
    inserted: results.reduce((s, r) => s + (r.inserted || 0), 0),
    updated: results.reduce((s, r) => s + (r.updated || 0), 0),
    history: results.reduce((s, r) => s + (r.history || 0), 0),
    archived: results.reduce((s, r) => s + (r.archived || 0), 0),
    authUsersMirror: last.authUsersMirror || null,
  };
}

/**
 * Publica users.json → sync_entities + auth_users.
 * No requiere CLOUD_SYNC_ENABLED (solo URL + API key).
 */
async function pushAuthUsersPayload(payload) {
  const cfg = assertCloudCredentials();
  const records = payload.records || [];

  let tableMirror = null;
  try {
    tableMirror = await postJson(
      `${cfg.baseUrl}/api/auth/users/ingest`,
      {
        records: records.map((r) => r.data || r),
        replaceAll: true,
        source: 'admin-crud',
      },
      cfg.apiKey,
    );
  } catch (err) {
    // Endpoint viejo / en deploy: el sync_entities + mirror del ingest bastan.
    console.warn('[cloud-sync] auth_users ingest:', err.message);
  }

  const syncResult = await pushPayload(payload, { requireEnabled: false });
  return {
    ...syncResult,
    authUsersTable: tableMirror,
  };
}

async function fetchCloudStatus() {
  const cfg = assertConfigured();
  const res = await fetch(`${cfg.baseUrl}/api/sync/status`, {
    headers: { 'X-API-Key': cfg.apiKey },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || res.statusText);
  }
  return data;
}

module.exports = {
  getCloudConfig,
  assertCloudCredentials,
  pushPayload,
  pushAuthUsersPayload,
  fetchCloudStatus,
};
