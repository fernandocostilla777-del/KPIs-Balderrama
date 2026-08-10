/**
 * Personal DMS activo en PostgreSQL (Railway):
 * VENDEDOR | PERSONAL_DMS | ASESOR_SERVICIO
 */
const { query } = require('../db');

const VALID_CATEGORIES = new Set(['VENDEDOR', 'PERSONAL_DMS', 'ASESOR_SERVICIO']);

function normalizeRow(payload = {}) {
  const categoria = String(payload.categoria || '').trim().toUpperCase();
  const subtipo = String(payload.subtipo || '').trim().toUpperCase();
  const externalId = String(payload.externalId || payload.external_id || payload.id || '').trim();
  if (!VALID_CATEGORIES.has(categoria)) {
    throw new Error(`categoria inválida: ${categoria}`);
  }
  if (!externalId) {
    throw new Error('externalId requerido');
  }
  return {
    categoria,
    subtipo,
    externalId,
    paterno: String(payload.paterno || '').trim(),
    materno: String(payload.materno || '').trim(),
    nombre: String(payload.nombre || '').trim(),
    email: String(payload.email || '').trim(),
    sucursal: String(payload.sucursal || '').trim(),
    activo: payload.activo !== false,
  };
}

/**
 * Upsert del lote y elimina activos que ya no vienen (solo activos en la fuente).
 */
async function upsertPersonalBatch(client, records, { batchId, contentHashes } = {}) {
  let inserted = 0;
  let updated = 0;
  const keepKeys = new Set();

  for (let i = 0; i < records.length; i += 1) {
    const row = normalizeRow(records[i]);
    const hash = contentHashes?.[i] || null;
    keepKeys.add(`${row.categoria}|${row.subtipo}|${row.externalId}`);

    const existing = await client.query(
      `SELECT id, content_hash FROM dms_personal
       WHERE categoria = $1 AND subtipo = $2 AND external_id = $3`,
      [row.categoria, row.subtipo, row.externalId]
    );

    if (!existing.rows[0]) {
      await client.query(
        `INSERT INTO dms_personal
          (categoria, subtipo, external_id, paterno, materno, nombre, email, sucursal,
           activo, content_hash, last_batch_id, last_seen_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9,$10,NOW(),NOW())`,
        [
          row.categoria,
          row.subtipo,
          row.externalId,
          row.paterno,
          row.materno,
          row.nombre,
          row.email,
          row.sucursal,
          hash,
          batchId || null,
        ]
      );
      inserted += 1;
      continue;
    }

    if (hash && existing.rows[0].content_hash === hash) {
      await client.query(
        `UPDATE dms_personal
         SET last_seen_at = NOW(), last_batch_id = $1, activo = TRUE, updated_at = NOW()
         WHERE id = $2`,
        [batchId || null, existing.rows[0].id]
      );
      continue;
    }

    await client.query(
      `UPDATE dms_personal
       SET paterno = $1, materno = $2, nombre = $3, email = $4, sucursal = $5,
           activo = TRUE, content_hash = $6, last_batch_id = $7,
           last_seen_at = NOW(), updated_at = NOW()
       WHERE id = $8`,
      [
        row.paterno,
        row.materno,
        row.nombre,
        row.email,
        row.sucursal,
        hash,
        batchId || null,
        existing.rows[0].id,
      ]
    );
    updated += 1;
  }

  // Desactivar / borrar quienes ya no están en el lote (fuente = solo activos)
  const all = await client.query(
    `SELECT id, categoria, subtipo, external_id FROM dms_personal WHERE activo = TRUE`
  );
  let removed = 0;
  for (const row of all.rows) {
    const key = `${row.categoria}|${row.subtipo}|${row.external_id}`;
    if (keepKeys.has(key)) continue;
    await client.query(`DELETE FROM dms_personal WHERE id = $1`, [row.id]);
    removed += 1;
  }

  return { inserted, updated, removed, total: records.length };
}

async function listPersonal({ categoria, subtipo, q, limit = 500, offset = 0 } = {}) {
  const params = [];
  let sql = `
    SELECT id, categoria, subtipo, external_id AS "externalId",
           paterno, materno, nombre, email, sucursal, activo,
           last_seen_at AS "lastSeenAt", updated_at AS "updatedAt"
    FROM dms_personal
    WHERE activo = TRUE`;

  if (categoria) {
    params.push(String(categoria).trim().toUpperCase());
    sql += ` AND categoria = $${params.length}`;
  }
  if (subtipo) {
    params.push(String(subtipo).trim().toUpperCase());
    sql += ` AND subtipo = $${params.length}`;
  }
  if (q) {
    params.push(`%${String(q).trim()}%`);
    sql += ` AND (
      nombre ILIKE $${params.length}
      OR paterno ILIKE $${params.length}
      OR materno ILIKE $${params.length}
      OR email ILIKE $${params.length}
      OR external_id ILIKE $${params.length}
    )`;
  }

  sql += ` ORDER BY categoria, subtipo, nombre`;
  params.push(Math.min(Math.max(Number(limit) || 500, 1), 5000));
  sql += ` LIMIT $${params.length}`;
  params.push(Math.max(Number(offset) || 0, 0));
  sql += ` OFFSET $${params.length}`;

  const result = await query(sql, params);
  return result.rows;
}

async function getPersonalSummary() {
  const byCat = await query(
    `SELECT categoria, COUNT(*)::int AS total
     FROM dms_personal
     WHERE activo = TRUE
     GROUP BY categoria
     ORDER BY categoria`
  );
  const bySub = await query(
    `SELECT categoria, subtipo, COUNT(*)::int AS total
     FROM dms_personal
     WHERE activo = TRUE
     GROUP BY categoria, subtipo
     ORDER BY categoria, subtipo`
  );
  const total = await query(
    `SELECT COUNT(*)::int AS total FROM dms_personal WHERE activo = TRUE`
  );
  return {
    total: total.rows[0]?.total || 0,
    byCategoria: byCat.rows,
    bySubtipo: bySub.rows,
  };
}

async function ensurePersonalTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS dms_personal (
      id              BIGSERIAL PRIMARY KEY,
      categoria       VARCHAR(32)  NOT NULL,
      subtipo         VARCHAR(32)  NOT NULL DEFAULT '',
      external_id     VARCHAR(64)  NOT NULL,
      paterno         VARCHAR(120) NOT NULL DEFAULT '',
      materno         VARCHAR(120) NOT NULL DEFAULT '',
      nombre          VARCHAR(255) NOT NULL DEFAULT '',
      email           VARCHAR(255) NOT NULL DEFAULT '',
      sucursal        VARCHAR(64)  NOT NULL DEFAULT '',
      activo          BOOLEAN      NOT NULL DEFAULT TRUE,
      content_hash    CHAR(64),
      last_batch_id   BIGINT,
      first_seen_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      last_seen_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      UNIQUE (categoria, subtipo, external_id)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_dms_personal_categoria ON dms_personal (categoria, activo)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_dms_personal_nombre ON dms_personal (nombre)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_dms_personal_subtipo ON dms_personal (subtipo)`);
}

module.exports = {
  VALID_CATEGORIES,
  normalizeRow,
  upsertPersonalBatch,
  listPersonal,
  getPersonalSummary,
  ensurePersonalTable,
};
