const { randomUUID } = require('crypto');
const { query } = require('../db');

let ensured = false;

async function ensureTable() {
  if (ensured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS office_commands (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      result JSONB,
      error TEXT,
      requested_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      claimed_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS office_commands_pending_idx
      ON office_commands (created_at)
      WHERE status = 'pending'
  `);
  ensured = true;
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    payload: row.payload || {},
    result: row.result || null,
    error: row.error || null,
    requestedBy: row.requested_by || null,
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
    finishedAt: row.finished_at,
  };
}

async function createCommand({ type, payload = {}, requestedBy = null } = {}) {
  await ensureTable();
  const id = randomUUID();
  const result = await query(
    `INSERT INTO office_commands (id, type, status, payload, requested_by)
     VALUES ($1, $2, 'pending', $3::jsonb, $4)
     RETURNING *`,
    [id, String(type || '').trim(), JSON.stringify(payload || {}), requestedBy],
  );
  return mapRow(result.rows[0]);
}

async function getCommand(id) {
  await ensureTable();
  const result = await query(`SELECT * FROM office_commands WHERE id = $1`, [String(id || '')]);
  return mapRow(result.rows[0]);
}

async function reclaimStale() {
  await ensureTable();
  await query(
    `UPDATE office_commands
     SET status = 'pending', claimed_at = NULL
     WHERE status = 'claimed'
       AND claimed_at IS NOT NULL
       AND claimed_at < NOW() - INTERVAL '20 minutes'`,
  );
}

/**
 * Toma el comando pendiente más antiguo (opcionalmente filtrado por tipo).
 */
async function claimNext({ types } = {}) {
  await ensureTable();
  await reclaimStale();

  const typeList = Array.isArray(types)
    ? types.map((t) => String(t || '').trim()).filter(Boolean)
    : [];

  const result = typeList.length
    ? await query(
      `WITH next AS (
         SELECT id FROM office_commands
         WHERE status = 'pending' AND type = ANY($1::text[])
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE office_commands c
       SET status = 'claimed', claimed_at = NOW()
       FROM next
       WHERE c.id = next.id
       RETURNING c.*`,
      [typeList],
    )
    : await query(
      `WITH next AS (
         SELECT id FROM office_commands
         WHERE status = 'pending'
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE office_commands c
       SET status = 'claimed', claimed_at = NOW()
       FROM next
       WHERE c.id = next.id
       RETURNING c.*`,
    );

  return mapRow(result.rows[0]);
}

async function completeCommand(id, { ok = true, result = null, error = null } = {}) {
  await ensureTable();
  const status = ok ? 'done' : 'failed';
  const updated = await query(
    `UPDATE office_commands
     SET status = $2,
         result = $3::jsonb,
         error = $4,
         finished_at = NOW()
     WHERE id = $1 AND status IN ('pending', 'claimed')
     RETURNING *`,
    [String(id || ''), status, JSON.stringify(result || {}), error ? String(error) : null],
  );
  return mapRow(updated.rows[0]);
}

async function getLatestByType(type) {
  await ensureTable();
  const result = await query(
    `SELECT * FROM office_commands
     WHERE type = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [String(type || '')],
  );
  return mapRow(result.rows[0]);
}

module.exports = {
  createCommand,
  getCommand,
  claimNext,
  completeCommand,
  getLatestByType,
  ensureTable,
};
