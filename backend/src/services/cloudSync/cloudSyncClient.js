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

async function pushPayload(payload) {
  const cfg = assertConfigured();
  // personal: un solo lote (reemplazo completo de activos); no trocear
  const chunks = payload.domain === 'personal'
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
  pushPayload,
  fetchCloudStatus,
};
