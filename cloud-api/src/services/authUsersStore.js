/**
 * Usuarios del dashboard / móvil en PostgreSQL (Railway).
 * Se alimenta desde el sync dominio `auth` (users.json de la oficina).
 */
'use strict';

const crypto = require('crypto');
const { query, withTransaction } = require('../db');

function ensureAuthUsersTableSql() {
  return `
    CREATE TABLE IF NOT EXISTS auth_users (
      username      VARCHAR(64)  PRIMARY KEY,
      password_hash TEXT         NOT NULL,
      role          VARCHAR(64)  NOT NULL DEFAULT 'direccion',
      active        BOOLEAN      NOT NULL DEFAULT TRUE,
      content_hash  CHAR(64),
      source        VARCHAR(32)  NOT NULL DEFAULT 'sync',
      last_batch_id BIGINT,
      updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_auth_users_active ON auth_users (active);
    CREATE INDEX IF NOT EXISTS idx_auth_users_role ON auth_users (role);
  `;
}

async function ensureAuthUsersTable() {
  const statements = ensureAuthUsersTableSql()
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await query(`${statement};`);
  }
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function normalizeUser(record = {}) {
  const source = record.data && typeof record.data === 'object'
    ? { ...record, ...record.data }
    : { ...record };
  const username = normalizeUsername(source.username || source.id || source.externalId);
  const passwordHash = String(source.passwordHash || source.password_hash || '').trim();
  if (!username || !passwordHash) {
    const err = new Error('Cada usuario requiere username y passwordHash');
    err.status = 400;
    throw err;
  }
  return {
    username,
    passwordHash,
    role: String(source.role || 'direccion').trim() || 'direccion',
    active: source.active !== false,
    contentHash: hashPayload({
      username,
      passwordHash,
      role: String(source.role || 'direccion').trim(),
      active: source.active !== false,
    }),
  };
}

async function upsertAuthUsersBatch(records, {
  replaceAll = false,
  source = 'sync',
  batchId = null,
  client,
} = {}) {
  if (!Array.isArray(records) || !records.length) {
    const err = new Error('El payload debe incluir al menos un usuario');
    err.status = 400;
    throw err;
  }

  const normalized = records.map(normalizeUser);
  const run = async (db) => {
    if (replaceAll) {
      await db.query('DELETE FROM auth_users');
    }
    let upserted = 0;
    for (const user of normalized) {
      await db.query(
        `INSERT INTO auth_users
           (username, password_hash, role, active, content_hash, source, last_batch_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (username) DO UPDATE SET
           password_hash = EXCLUDED.password_hash,
           role = EXCLUDED.role,
           active = EXCLUDED.active,
           content_hash = EXCLUDED.content_hash,
           source = EXCLUDED.source,
           last_batch_id = EXCLUDED.last_batch_id,
           updated_at = NOW()
         WHERE auth_users.content_hash IS DISTINCT FROM EXCLUDED.content_hash
            OR auth_users.active IS DISTINCT FROM EXCLUDED.active`,
        [
          user.username,
          user.passwordHash,
          user.role,
          user.active,
          user.contentHash,
          source || 'sync',
          batchId || null,
        ],
      );
      upserted += 1;
    }

    if (replaceAll) {
      const keep = normalized.map((u) => u.username);
      await db.query(
        `DELETE FROM auth_users WHERE NOT (username = ANY($1::text[]))`,
        [keep],
      );
    }

    const total = await db.query('SELECT COUNT(*)::int AS total FROM auth_users');
    const active = await db.query(
      'SELECT COUNT(*)::int AS total FROM auth_users WHERE active = TRUE',
    );
    return {
      upserted,
      replaced: Boolean(replaceAll),
      total: total.rows[0]?.total || 0,
      active: active.rows[0]?.total || 0,
    };
  };

  if (client) return run(client);
  return withTransaction(run);
}

async function listAuthUsers() {
  const result = await query(
    `SELECT username, role, active, source, updated_at
     FROM auth_users
     ORDER BY username`,
  );
  return result.rows.map((row) => ({
    username: row.username,
    role: row.role,
    active: row.active,
    source: row.source,
    updatedAt: row.updated_at,
  }));
}

async function findAuthUser(username) {
  const key = normalizeUsername(username);
  if (!key) return null;
  const result = await query(
    `SELECT username, password_hash, role, active
     FROM auth_users
     WHERE username = $1
     LIMIT 1`,
    [key],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    active: row.active !== false,
    source: 'auth_users',
  };
}

async function getAuthUsersSummary() {
  const totals = await query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE active)::int AS active,
      MAX(updated_at) AS updated_at
    FROM auth_users
  `);
  return totals.rows[0] || { total: 0, active: 0, updated_at: null };
}

/** Si auth_users está vacío, copia desde sync_entities (dominio auth). */
async function backfillAuthUsersFromSync() {
  const summary = await getAuthUsersSummary();
  if (Number(summary.total) > 0) return { skipped: true, reason: 'auth_users ya tiene filas', ...summary };

  const synced = await query(
    `SELECT external_id, payload
     FROM sync_entities
     WHERE domain = 'auth'
       AND period_key IS NOT DISTINCT FROM 'global'`,
  );
  if (!synced.rows.length) return { skipped: true, reason: 'sin sync auth', total: 0 };

  const records = synced.rows.map((row) => {
    const p = row.payload || {};
    return {
      username: p.username || row.external_id,
      passwordHash: p.passwordHash,
      role: p.role || 'direccion',
      active: p.active !== false,
    };
  }).filter((r) => r.username && r.passwordHash);

  if (!records.length) return { skipped: true, reason: 'payloads sin passwordHash', total: 0 };
  return upsertAuthUsersBatch(records, { replaceAll: true, source: 'backfill-sync' });
}

module.exports = {
  ensureAuthUsersTable,
  upsertAuthUsersBatch,
  listAuthUsers,
  findAuthUser,
  getAuthUsersSummary,
  backfillAuthUsersFromSync,
  normalizeUser,
};
