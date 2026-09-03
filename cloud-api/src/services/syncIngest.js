const crypto = require('crypto');
const { withTransaction } = require('../db');
const { upsertPersonalBatch } = require('./dmsPersonalService');
const { upsertCrmBatch, normalizeRow } = require('./crmCiclosCloudService');

const VALID_DOMAINS = new Set([
  'overview',
  'ventas',
  'forecast',
  'inventario',
  'contabilidad',
  'postventa',
  'crm',
  'auth',
  'personal',
  'objetivos',
]);
const VALID_SYNC_TYPES = new Set(['incremental', 'daily', 'monthly']);

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function hashPayload(payload) {
  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object') {
    throw new Error('Cada registro debe ser un objeto con id y data');
  }
  const externalId = String(record.id || record.externalId || '').trim();
  if (!externalId) {
    throw new Error('Registro sin id');
  }
  const data = record.data !== undefined ? record.data : record;
  const payload = record.data !== undefined
    ? data
    : Object.fromEntries(Object.entries(data).filter(([k]) => k !== 'id' && k !== 'externalId'));
  return {
    externalId,
    payload,
    contentHash: hashPayload(payload),
  };
}

async function archiveEntity(client, entity, batchId, changeReason) {
  await client.query(
    `INSERT INTO sync_entity_history
      (domain, external_id, period_key, payload, content_hash, valid_from, valid_to, batch_id, change_reason)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8)`,
    [
      entity.domain,
      entity.external_id,
      entity.period_key,
      entity.payload,
      entity.content_hash,
      entity.last_seen_at || new Date(),
      batchId,
      changeReason,
    ]
  );
}

async function ingestSyncPayload(body) {
  const domain = String(body.domain || '').trim().toLowerCase();
  const syncType = String(body.syncType || 'incremental').trim().toLowerCase();
  const periodKey = body.periodKey ? String(body.periodKey) : null;
  const periodStart = body.periodStart || null;
  const periodEnd = body.periodEnd || null;
  const sourceHost = body.sourceHost ? String(body.sourceHost) : null;
  const meta = body.meta && typeof body.meta === 'object' ? body.meta : null;
  const records = Array.isArray(body.records) ? body.records : [];

  if (!VALID_DOMAINS.has(domain)) {
    throw new Error(`Dominio inválido: ${domain}`);
  }
  if (!VALID_SYNC_TYPES.has(syncType)) {
    throw new Error(`syncType inválido: ${syncType}`);
  }
  if (!records.length) {
    throw new Error('El payload debe incluir al menos un registro');
  }

  const normalized = records.map(normalizeRecord);
  const incomingIds = new Set(normalized.map((r) => r.externalId));

  return withTransaction(async (client) => {
    const batchRes = await client.query(
      `INSERT INTO sync_batches
        (domain, sync_type, period_key, period_start, period_end, source_host, record_count, meta, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'processing')
       RETURNING id`,
      [domain, syncType, periodKey, periodStart, periodEnd, sourceHost, normalized.length, meta]
    );
    const batchId = batchRes.rows[0].id;

    let inserted = 0;
    let updated = 0;
    let history = 0;
    let archived = 0;

    for (const row of normalized) {
      const existingRes = await client.query(
        `SELECT id, domain, external_id, period_key, payload, content_hash, last_seen_at
         FROM sync_entities
         WHERE domain = $1 AND external_id = $2 AND period_key IS NOT DISTINCT FROM $3`,
        [domain, row.externalId, periodKey]
      );
      const existing = existingRes.rows[0];

      if (!existing) {
        await client.query(
          `INSERT INTO sync_entities
            (domain, external_id, period_key, payload, content_hash, last_batch_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [domain, row.externalId, periodKey, row.payload, row.contentHash, batchId]
        );
        inserted += 1;
        continue;
      }

      if (existing.content_hash === row.contentHash) {
        await client.query(
          `UPDATE sync_entities SET last_seen_at = NOW(), last_batch_id = $1 WHERE id = $2`,
          [batchId, existing.id]
        );
        continue;
      }

      await archiveEntity(client, existing, batchId, syncType === 'monthly' ? 'monthly_snapshot' : 'update');
      history += 1;

      await client.query(
        `UPDATE sync_entities
         SET payload = $1, content_hash = $2, last_seen_at = NOW(), last_batch_id = $3
         WHERE id = $4`,
        [row.payload, row.contentHash, batchId, existing.id]
      );
      updated += 1;
    }

    if (syncType === 'monthly' && periodKey) {
      const staleRes = await client.query(
        `SELECT id, domain, external_id, period_key, payload, content_hash, last_seen_at
         FROM sync_entities
         WHERE domain = $1 AND period_key IS NOT DISTINCT FROM $2`,
        [domain, periodKey]
      );
      for (const entity of staleRes.rows) {
        if (incomingIds.has(entity.external_id)) continue;
        await archiveEntity(client, entity, batchId, 'delete');
        await client.query('DELETE FROM sync_entities WHERE id = $1', [entity.id]);
        archived += 1;
        history += 1;
      }
    }

    let personalMirror = null;
    if (domain === 'personal') {
      personalMirror = await upsertPersonalBatch(
        client,
        normalized.map((r) => r.payload),
        {
          batchId,
          contentHashes: normalized.map((r) => r.contentHash),
        }
      );
    }

    let crmMirror = null;
    if (domain === 'crm') {
      const actividades = normalized
        .map((r) => r.payload)
        .filter((payload) => {
          const entity = String(payload?.entity || '').toLowerCase();
          if (entity && entity !== 'actividad') return false;
          try {
            normalizeRow(payload);
            return true;
          } catch {
            return false;
          }
        });
      if (actividades.length) {
        crmMirror = await upsertCrmBatch(actividades, {
          source: 'sync',
          batchId,
          client,
        });
      }
    }

    await client.query(
      `UPDATE sync_batches
       SET inserted_count = $1, updated_count = $2, history_count = $3, archived_count = $4, status = 'ok'
       WHERE id = $5`,
      [inserted, updated, history, archived, batchId]
    );

    return {
      batchId,
      domain,
      syncType,
      periodKey,
      recordCount: normalized.length,
      inserted,
      updated,
      history,
      archived,
      personalMirror,
      crmMirror,
    };
  });
}

async function getSyncStatus() {
  const { query } = require('../db');
  const lastByDomain = await query(
    `SELECT DISTINCT ON (domain)
       domain, id AS batch_id, sync_type, period_key, record_count,
       inserted_count, updated_count, history_count, archived_count, status, created_at
     FROM sync_batches
     ORDER BY domain, created_at DESC`
  );
  const totals = await query(
    `SELECT domain, COUNT(*)::int AS entities
     FROM sync_entities
     GROUP BY domain
     ORDER BY domain`
  );
  return {
    domains: lastByDomain.rows,
    entityTotals: totals.rows,
  };
}

async function getHistory({ domain, externalId, periodKey, limit = 50 }) {
  const { query } = require('../db');
  const params = [domain];
  let sql = `
    SELECT id, domain, external_id, period_key, payload, content_hash,
           valid_from, valid_to, batch_id, change_reason
    FROM sync_entity_history
    WHERE domain = $1`;
  if (externalId) {
    params.push(externalId);
    sql += ` AND external_id = $${params.length}`;
  }
  if (periodKey) {
    params.push(periodKey);
    sql += ` AND period_key = $${params.length}`;
  }
  params.push(Math.min(Number(limit) || 50, 200));
  sql += ` ORDER BY valid_from DESC LIMIT $${params.length}`;
  const result = await query(sql, params);
  return result.rows;
}

module.exports = {
  ingestSyncPayload,
  getSyncStatus,
  getHistory,
  hashPayload,
};
