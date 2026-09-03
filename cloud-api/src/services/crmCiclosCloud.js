const crypto = require('crypto');
const { query, withTransaction } = require('../db');

const ACTIVITY_FIELDS = [
  'id_contacto',
  'nombre_contacto',
  'id_ciclo',
  'fecha_inicio_ciclo',
  'fecha_esperada_cierre',
  'estatus',
  'fecha_estatus',
  'tipo_actividad',
  'fecha_crea_actividad',
  'fecha_prog_actividad',
  'fecha_resp_actividad',
  'resultado_actividad',
  'forma_contacto',
  'medio_contacto',
  'submedio_contacto',
  'num_factura',
  'facturado_a',
  'producto_vendido',
  'fecha_factura',
  'vin',
  'fecha_entrega',
  'vendedor',
];

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function cleanText(value, maxLen = null) {
  if (value == null) return '';
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (maxLen != null && text.length > maxLen) return text.slice(0, maxLen);
  return text;
}

const FIELD_LIMITS = {
  id_contacto: 64,
  nombre_contacto: 255,
  id_ciclo: 64,
  fecha_inicio_ciclo: 32,
  fecha_esperada_cierre: 32,
  estatus: 120,
  fecha_estatus: 32,
  tipo_actividad: 120,
  fecha_crea_actividad: 32,
  fecha_prog_actividad: 32,
  fecha_resp_actividad: 32,
  forma_contacto: 120,
  medio_contacto: 120,
  submedio_contacto: 120,
  num_factura: 64,
  facturado_a: 255,
  producto_vendido: 255,
  fecha_factura: 32,
  vin: 64,
  fecha_entrega: 32,
  vendedor: 255,
};

/** Excluye canal/vendedor CODE (ej. Redes Sociales_Code). */
function isCodeSeller(row = {}) {
  const vendedor = cleanText(row.vendedor || row.VENDEDOR).toUpperCase();
  const submedio = cleanText(row.submedio_contacto || row.SUBMEDIO_CONTACTO || row.submedioContacto);
  const medio = cleanText(row.medio_contacto || row.MEDIO_CONTACTO || row.medioContacto);

  if (vendedor === 'CODE' || vendedor === 'CODE.') return true;
  if (/\bCODE\b/i.test(vendedor) && vendedor.length <= 20) return true;
  if (/_code\b/i.test(submedio) || /^code$/i.test(submedio)) return true;
  if (/redes sociales[_\s-]*code/i.test(submedio)) return true;
  if (/_code\b/i.test(medio) || /redes sociales[_\s-]*code/i.test(medio)) return true;
  return false;
}

function pickField(obj, ...keys) {
  for (const key of keys) {
    if (obj[key] != null && String(obj[key]).trim() !== '') return obj[key];
  }
  return '';
}

function normalizeCicloRow(input, index = 0) {
  const src = input?.data && typeof input.data === 'object' ? { ...input, ...input.data } : (input || {});
  const row = {};
  for (const field of ACTIVITY_FIELDS) {
    const camel = field.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    row[field] = cleanText(pickField(src, field, camel), FIELD_LIMITS[field]);
  }

  if (!row.id_contacto && !row.id_ciclo) {
    throw new Error(`Registro CRM sin id_contacto ni id_ciclo (índice ${index})`);
  }

  const identity = [
    'actividad',
    row.id_ciclo || 'sin-ciclo',
    row.id_contacto || 'sin-contacto',
    row.fecha_crea_actividad || row.fecha_inicio_ciclo || String(index),
    row.tipo_actividad || String(index),
  ].join('|');

  const providedId = cleanText(pickField(input || {}, 'id', 'externalId', 'rowKey', 'row_key'));
  const rowKey = sha256(providedId || identity);
  const contentHash = sha256(JSON.stringify(row));

  return { rowKey, contentHash, identity, ...row };
}

function toApiRow(dbRow) {
  if (!dbRow) return null;
  return {
    id: dbRow.id,
    idContacto: dbRow.id_contacto,
    nombreContacto: dbRow.nombre_contacto,
    idCiclo: dbRow.id_ciclo,
    fechaInicioCiclo: dbRow.fecha_inicio_ciclo,
    fechaEsperadaCierre: dbRow.fecha_esperada_cierre,
    estatus: dbRow.estatus,
    fechaEstatus: dbRow.fecha_estatus,
    tipoActividad: dbRow.tipo_actividad,
    fechaCreaActividad: dbRow.fecha_crea_actividad,
    fechaProgActividad: dbRow.fecha_prog_actividad,
    fechaRespActividad: dbRow.fecha_resp_actividad,
    resultadoActividad: dbRow.resultado_actividad,
    formaContacto: dbRow.forma_contacto,
    medioContacto: dbRow.medio_contacto,
    submedioContacto: dbRow.submedio_contacto,
    numFactura: dbRow.num_factura,
    facturadoA: dbRow.facturado_a,
    productoVendido: dbRow.producto_vendido,
    fechaFactura: dbRow.fecha_factura,
    vin: dbRow.vin,
    fechaEntrega: dbRow.fecha_entrega,
    vendedor: dbRow.vendedor,
    updatedAt: dbRow.updated_at,
  };
}

async function ensureCrmTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS crm_ciclos (
      id BIGSERIAL PRIMARY KEY,
      row_key CHAR(64) NOT NULL UNIQUE,
      id_contacto VARCHAR(64) NOT NULL DEFAULT '',
      nombre_contacto VARCHAR(255) NOT NULL DEFAULT '',
      id_ciclo VARCHAR(64) NOT NULL DEFAULT '',
      fecha_inicio_ciclo VARCHAR(32) NOT NULL DEFAULT '',
      fecha_esperada_cierre VARCHAR(32) NOT NULL DEFAULT '',
      estatus VARCHAR(120) NOT NULL DEFAULT '',
      fecha_estatus VARCHAR(32) NOT NULL DEFAULT '',
      tipo_actividad VARCHAR(120) NOT NULL DEFAULT '',
      fecha_crea_actividad VARCHAR(32) NOT NULL DEFAULT '',
      fecha_prog_actividad VARCHAR(32) NOT NULL DEFAULT '',
      fecha_resp_actividad VARCHAR(32) NOT NULL DEFAULT '',
      resultado_actividad TEXT NOT NULL DEFAULT '',
      forma_contacto VARCHAR(120) NOT NULL DEFAULT '',
      medio_contacto VARCHAR(120) NOT NULL DEFAULT '',
      submedio_contacto VARCHAR(120) NOT NULL DEFAULT '',
      num_factura VARCHAR(64) NOT NULL DEFAULT '',
      facturado_a VARCHAR(255) NOT NULL DEFAULT '',
      producto_vendido VARCHAR(255) NOT NULL DEFAULT '',
      fecha_factura VARCHAR(32) NOT NULL DEFAULT '',
      vin VARCHAR(64) NOT NULL DEFAULT '',
      fecha_entrega VARCHAR(32) NOT NULL DEFAULT '',
      vendedor VARCHAR(255) NOT NULL DEFAULT '',
      content_hash CHAR(64),
      source VARCHAR(64) NOT NULL DEFAULT 'api',
      last_batch_id BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS crm_contactos (
      id_contacto VARCHAR(64) PRIMARY KEY,
      nombre_contacto VARCHAR(255) NOT NULL DEFAULT '',
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      first_ciclo_at VARCHAR(32) NOT NULL DEFAULT '',
      last_actividad_at VARCHAR(32) NOT NULL DEFAULT '',
      total_ciclos INT NOT NULL DEFAULT 0,
      total_actividades INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query('CREATE INDEX IF NOT EXISTS idx_crm_ciclos_contacto ON crm_ciclos (id_contacto)');
  await query('CREATE INDEX IF NOT EXISTS idx_crm_ciclos_ciclo ON crm_ciclos (id_ciclo)');
  await query('CREATE INDEX IF NOT EXISTS idx_crm_ciclos_estatus ON crm_ciclos (estatus)');
  await query('CREATE INDEX IF NOT EXISTS idx_crm_ciclos_vendedor ON crm_ciclos (vendedor)');
  await query('CREATE INDEX IF NOT EXISTS idx_crm_ciclos_vin ON crm_ciclos (vin)');
  await query('CREATE INDEX IF NOT EXISTS idx_crm_ciclos_factura ON crm_ciclos (num_factura)');
  await query('CREATE INDEX IF NOT EXISTS idx_crm_contactos_nombre ON crm_contactos (nombre_contacto)');
  await query('CREATE INDEX IF NOT EXISTS idx_crm_contactos_last_seen ON crm_contactos (last_seen_at DESC)');
  await query(`
    ALTER TABLE crm_ciclos
    ALTER COLUMN resultado_actividad TYPE TEXT
    USING LEFT(resultado_actividad, 8000)
  `).catch(() => {});
}

async function refreshContacto(client, idContacto) {
  const id = cleanText(idContacto);
  if (!id) return;

  const stats = await client.query(
    `
    SELECT
      COALESCE(MAX(NULLIF(nombre_contacto, '')), '') AS nombre_contacto,
      COALESCE(MIN(NULLIF(fecha_inicio_ciclo, '')), '') AS first_ciclo_at,
      COALESCE(
        NULLIF(MAX(fecha_resp_actividad), ''),
        NULLIF(MAX(fecha_prog_actividad), ''),
        NULLIF(MAX(fecha_crea_actividad), ''),
        NULLIF(MAX(fecha_inicio_ciclo), ''),
        ''
      ) AS last_actividad_at,
      COUNT(DISTINCT NULLIF(id_ciclo, ''))::int AS total_ciclos,
      COUNT(*)::int AS total_actividades
    FROM crm_ciclos
    WHERE id_contacto = $1
    `,
    [id]
  );

  const s = stats.rows[0] || {};
  await client.query(
    `
    INSERT INTO crm_contactos (
      id_contacto, nombre_contacto, first_seen_at, last_seen_at,
      first_ciclo_at, last_actividad_at, total_ciclos, total_actividades, updated_at
    ) VALUES ($1, $2, NOW(), NOW(), $3, $4, $5, $6, NOW())
    ON CONFLICT (id_contacto) DO UPDATE SET
      nombre_contacto = CASE
        WHEN EXCLUDED.nombre_contacto <> '' THEN EXCLUDED.nombre_contacto
        ELSE crm_contactos.nombre_contacto
      END,
      last_seen_at = NOW(),
      first_ciclo_at = CASE
        WHEN crm_contactos.first_ciclo_at = '' OR (
          EXCLUDED.first_ciclo_at <> '' AND EXCLUDED.first_ciclo_at < crm_contactos.first_ciclo_at
        ) THEN EXCLUDED.first_ciclo_at
        ELSE crm_contactos.first_ciclo_at
      END,
      last_actividad_at = CASE
        WHEN EXCLUDED.last_actividad_at <> '' AND (
          crm_contactos.last_actividad_at = '' OR EXCLUDED.last_actividad_at > crm_contactos.last_actividad_at
        ) THEN EXCLUDED.last_actividad_at
        ELSE crm_contactos.last_actividad_at
      END,
      total_ciclos = EXCLUDED.total_ciclos,
      total_actividades = EXCLUDED.total_actividades,
      updated_at = NOW()
    `,
    [
      id,
      s.nombre_contacto || '',
      s.first_ciclo_at || '',
      s.last_actividad_at || '',
      s.total_ciclos || 0,
      s.total_actividades || 0,
    ]
  );
}

async function ingestCrmCiclos(body = {}) {
  const replace = Boolean(body.replace || body.replaced);
  const source = cleanText(body.sourceHost || body.source || 'api') || 'api';
  const raw = Array.isArray(body.ciclos)
    ? body.ciclos
    : Array.isArray(body.records)
      ? body.records
      : Array.isArray(body.actividades)
        ? body.actividades
        : [];

  if (!raw.length) {
    throw new Error('El payload debe incluir ciclos/records');
  }

  const normalized = raw
    .map((item, index) => normalizeCicloRow(item, index))
    .filter((row) => !isCodeSeller(row));
  const skippedCode = raw.length - normalized.length;

  if (!normalized.length) {
    throw new Error(
      skippedCode
        ? 'Todos los registros pertenecen a CODE y fueron excluidos'
        : 'El payload debe incluir ciclos/records'
    );
  }

  return withTransaction(async (client) => {
    if (replace) {
      await client.query('DELETE FROM crm_ciclos');
      await client.query('DELETE FROM crm_contactos');
    }

    let upserted = 0;
    const touchedContactos = new Set();

    for (const row of normalized) {
      await client.query(
        `
        INSERT INTO crm_ciclos (
          row_key, id_contacto, nombre_contacto, id_ciclo,
          fecha_inicio_ciclo, fecha_esperada_cierre, estatus, fecha_estatus,
          tipo_actividad, fecha_crea_actividad, fecha_prog_actividad, fecha_resp_actividad,
          resultado_actividad, forma_contacto, medio_contacto, submedio_contacto,
          num_factura, facturado_a, producto_vendido, fecha_factura, vin,
          fecha_entrega, vendedor, content_hash, source, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,NOW()
        )
        ON CONFLICT (row_key) DO UPDATE SET
          id_contacto = EXCLUDED.id_contacto,
          nombre_contacto = EXCLUDED.nombre_contacto,
          id_ciclo = EXCLUDED.id_ciclo,
          fecha_inicio_ciclo = EXCLUDED.fecha_inicio_ciclo,
          fecha_esperada_cierre = EXCLUDED.fecha_esperada_cierre,
          estatus = EXCLUDED.estatus,
          fecha_estatus = EXCLUDED.fecha_estatus,
          tipo_actividad = EXCLUDED.tipo_actividad,
          fecha_crea_actividad = EXCLUDED.fecha_crea_actividad,
          fecha_prog_actividad = EXCLUDED.fecha_prog_actividad,
          fecha_resp_actividad = EXCLUDED.fecha_resp_actividad,
          resultado_actividad = EXCLUDED.resultado_actividad,
          forma_contacto = EXCLUDED.forma_contacto,
          medio_contacto = EXCLUDED.medio_contacto,
          submedio_contacto = EXCLUDED.submedio_contacto,
          num_factura = EXCLUDED.num_factura,
          facturado_a = EXCLUDED.facturado_a,
          producto_vendido = EXCLUDED.producto_vendido,
          fecha_factura = EXCLUDED.fecha_factura,
          vin = EXCLUDED.vin,
          fecha_entrega = EXCLUDED.fecha_entrega,
          vendedor = EXCLUDED.vendedor,
          content_hash = EXCLUDED.content_hash,
          source = EXCLUDED.source,
          updated_at = NOW()
        `,
        [
          row.rowKey,
          row.id_contacto,
          row.nombre_contacto,
          row.id_ciclo,
          row.fecha_inicio_ciclo,
          row.fecha_esperada_cierre,
          row.estatus,
          row.fecha_estatus,
          row.tipo_actividad,
          row.fecha_crea_actividad,
          row.fecha_prog_actividad,
          row.fecha_resp_actividad,
          row.resultado_actividad,
          row.forma_contacto,
          row.medio_contacto,
          row.submedio_contacto,
          row.num_factura,
          row.facturado_a,
          row.producto_vendido,
          row.fecha_factura,
          row.vin,
          row.fecha_entrega,
          row.vendedor,
          row.contentHash,
          source,
        ]
      );
      upserted += 1;
      if (row.id_contacto) touchedContactos.add(row.id_contacto);
    }

    for (const idContacto of touchedContactos) {
      await refreshContacto(client, idContacto);
    }

    const totals = await client.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(DISTINCT NULLIF(id_contacto, ''))::int AS contactos
      FROM crm_ciclos
      WHERE NOT (
        UPPER(TRIM(vendedor)) IN ('CODE', 'CODE.')
        OR submedio_contacto ~* '(_code\\b)|(^code$)|(redes sociales[_\\s-]*code)'
        OR medio_contacto ~* '(_code\\b)|(redes sociales[_\\s-]*code)'
      )
    `);

    return {
      upserted,
      skippedCode,
      replaced: replace,
      total: totals.rows[0].total,
      contactos: totals.rows[0].contactos,
    };
  });
}

const CODE_EXCLUDE_SQL = `
  NOT (
    UPPER(TRIM(vendedor)) IN ('CODE', 'CODE.')
    OR submedio_contacto ~* '(_code\\b)|(^code$)|(redes sociales[_\\s-]*code)'
    OR medio_contacto ~* '(_code\\b)|(redes sociales[_\\s-]*code)'
  )
`;

async function listCiclos({ idContacto = null, limit = 100, offset = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 1000);
  const off = Math.max(Number(offset) || 0, 0);
  const id = cleanText(idContacto);

  const params = id ? [id, lim, off] : [lim, off];
  const where = id
    ? `WHERE id_contacto = $1 AND (${CODE_EXCLUDE_SQL})`
    : `WHERE ${CODE_EXCLUDE_SQL}`;
  const limIdx = id ? 2 : 1;
  const offIdx = id ? 3 : 2;

  const result = await query(
    `
    SELECT *
    FROM crm_ciclos
    ${where}
    ORDER BY COALESCE(NULLIF(fecha_resp_actividad, ''), NULLIF(fecha_prog_actividad, ''), NULLIF(fecha_crea_actividad, ''), NULLIF(fecha_inicio_ciclo, '')) DESC,
             id DESC
    LIMIT $${limIdx} OFFSET $${offIdx}
    `,
    params
  );

  return {
    ok: true,
    idContacto: id || undefined,
    count: result.rows.length,
    ciclos: result.rows.map(toApiRow),
  };
}

async function getContactoHistorico(idContacto) {
  const id = cleanText(idContacto);
  if (!id) throw new Error('idContacto requerido');

  const contactoRes = await query('SELECT * FROM crm_contactos WHERE id_contacto = $1', [id]);
  const rowsRes = await query(
    `
    SELECT *
    FROM crm_ciclos
    WHERE id_contacto = $1
      AND (${CODE_EXCLUDE_SQL})
    ORDER BY COALESCE(NULLIF(fecha_inicio_ciclo, ''), NULLIF(fecha_crea_actividad, '')) ASC,
             COALESCE(NULLIF(fecha_crea_actividad, ''), NULLIF(fecha_prog_actividad, ''), NULLIF(fecha_resp_actividad, '')) ASC,
             id ASC
    `,
    [id]
  );

  const rows = rowsRes.rows;
  if (!rows.length && !contactoRes.rows[0]) {
    return { ok: true, idContacto: id, encontrado: false, ciclos: [] };
  }

  const byCiclo = new Map();
  for (const row of rows) {
    const cicloId = row.id_ciclo || 'sin-ciclo';
    if (!byCiclo.has(cicloId)) {
      byCiclo.set(cicloId, {
        idCiclo: cicloId,
        fechaInicioCiclo: row.fecha_inicio_ciclo || null,
        fechaEsperadaCierre: row.fecha_esperada_cierre || null,
        estatus: row.estatus || null,
        fechaEstatus: row.fecha_estatus || null,
        vendedor: row.vendedor || null,
        actividades: [],
      });
    }
    const ciclo = byCiclo.get(cicloId);
    if (!ciclo.fechaInicioCiclo && row.fecha_inicio_ciclo) ciclo.fechaInicioCiclo = row.fecha_inicio_ciclo;
    if (!ciclo.fechaEsperadaCierre && row.fecha_esperada_cierre) ciclo.fechaEsperadaCierre = row.fecha_esperada_cierre;
    if (row.estatus) ciclo.estatus = row.estatus;
    if (row.fecha_estatus) ciclo.fechaEstatus = row.fecha_estatus;
    if (row.vendedor) ciclo.vendedor = row.vendedor;
    ciclo.actividades.push({
      tipoActividad: row.tipo_actividad || null,
      fechaCreaActividad: row.fecha_crea_actividad || null,
      fechaProgActividad: row.fecha_prog_actividad || null,
      fechaRespActividad: row.fecha_resp_actividad || null,
      resultadoActividad: row.resultado_actividad || null,
      formaContacto: row.forma_contacto || null,
      medioContacto: row.medio_contacto || null,
      submedioContacto: row.submedio_contacto || null,
      numFactura: row.num_factura || null,
      facturadoA: row.facturado_a || null,
      productoVendido: row.producto_vendido || null,
      fechaFactura: row.fecha_factura || null,
      vin: row.vin || null,
      fechaEntrega: row.fecha_entrega || null,
      vendedor: row.vendedor || null,
    });
  }

  const ciclos = [...byCiclo.values()];
  const contacto = contactoRes.rows[0] || null;
  const nombre = contacto?.nombre_contacto || rows.find((r) => r.nombre_contacto)?.nombre_contacto || null;
  const fechas = rows
    .flatMap((r) => [r.fecha_inicio_ciclo, r.fecha_crea_actividad, r.fecha_prog_actividad, r.fecha_resp_actividad])
    .filter(Boolean)
    .sort();

  return {
    ok: true,
    encontrado: true,
    idContacto: id,
    nombre,
    resumen: {
      totalCiclos: ciclos.length,
      totalActividades: rows.length,
      primeraActividad: fechas[0] || contacto?.first_ciclo_at || null,
      ultimaActividad: fechas[fechas.length - 1] || contacto?.last_actividad_at || null,
      firstSeenAt: contacto?.first_seen_at || null,
      lastSeenAt: contacto?.last_seen_at || null,
    },
    ciclos,
  };
}

async function purgeCodeSellerRows() {
  return withTransaction(async (client) => {
    const deleted = await client.query(`
      DELETE FROM crm_ciclos
      WHERE UPPER(TRIM(vendedor)) IN ('CODE', 'CODE.')
         OR submedio_contacto ~* '(_code\\b)|(^code$)|(redes sociales[_\\s-]*code)'
         OR medio_contacto ~* '(_code\\b)|(redes sociales[_\\s-]*code)'
      RETURNING id_contacto
    `);
    const touched = [...new Set(deleted.rows.map((r) => r.id_contacto).filter(Boolean))];
    for (const idContacto of touched) {
      const remaining = await client.query(
        'SELECT COUNT(*)::int AS n FROM crm_ciclos WHERE id_contacto = $1',
        [idContacto]
      );
      if (remaining.rows[0].n === 0) {
        await client.query('DELETE FROM crm_contactos WHERE id_contacto = $1', [idContacto]);
      } else {
        await refreshContacto(client, idContacto);
      }
    }
    const totals = await client.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(DISTINCT NULLIF(id_contacto, ''))::int AS contactos
      FROM crm_ciclos
    `);
    return {
      deleted: deleted.rowCount || 0,
      contactosActualizados: touched.length,
      total: totals.rows[0].total,
      contactos: totals.rows[0].contactos,
    };
  });
}

async function backfillContactos() {
  const ids = await query(`
    SELECT DISTINCT id_contacto
    FROM crm_ciclos
    WHERE id_contacto IS NOT NULL AND id_contacto <> ''
  `);
  return withTransaction(async (client) => {
    for (const row of ids.rows) {
      await refreshContacto(client, row.id_contacto);
    }
    return { contactos: ids.rows.length };
  });
}

module.exports = {
  ensureCrmTables,
  ingestCrmCiclos,
  listCiclos,
  getContactoHistorico,
  backfillContactos,
  purgeCodeSellerRows,
  isCodeSeller,
};
