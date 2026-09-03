/**
 * Ciclos CRM en PostgreSQL (Railway).
 * Filas del export local (Balderrama Ciclos): un renglón = actividad.
 */
const crypto = require('crypto');
const { query, withTransaction } = require('../db');

const FIELDS = [
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

const ALIASES = {
  id_contacto: ['id_contacto', 'ID_CONTACTO', 'D_CONTACTO', 'd_contacto', 'idContacto'],
  nombre_contacto: ['nombre_contacto', 'NOMBRE_CONTACTO', 'nombreContacto'],
  id_ciclo: ['id_ciclo', 'ID_CICLO', 'idCiclo'],
  fecha_inicio_ciclo: ['fecha_inicio_ciclo', 'FECHA_INICIO_CICLO', 'fechaInicioCiclo'],
  fecha_esperada_cierre: ['fecha_esperada_cierre', 'FECHA_ESPERADA_CIERRE', 'fechaEsperadaCierre'],
  estatus: ['estatus', 'ESTATUS'],
  fecha_estatus: ['fecha_estatus', 'FECHA_ESTATUS', 'fechaEstatus'],
  tipo_actividad: ['tipo_actividad', 'TIPO_ACTIVIDAD', 'tipoActividad'],
  fecha_crea_actividad: ['fecha_crea_actividad', 'FECHA_CREA_ACTIVIDAD', 'fechaCreaActividad'],
  fecha_prog_actividad: ['fecha_prog_actividad', 'FECHA_PROG_ACTIVIDAD', 'fechaProgActividad'],
  fecha_resp_actividad: ['fecha_resp_actividad', 'FECHA_RESP_ACTIVIDAD', 'fechaRespActividad'],
  resultado_actividad: ['resultado_actividad', 'RESULTADO_ACTIVIDAD', 'resultadoActividad'],
  forma_contacto: ['forma_contacto', 'FORMA_CONTACTO', 'formaContacto'],
  medio_contacto: ['medio_contacto', 'MEDIO_CONTACTO', 'medioContacto'],
  submedio_contacto: ['submedio_contacto', 'SUBMEDIO_CONTACTO', 'submedioContacto'],
  num_factura: ['num_factura', 'NUM_FACTURA', 'numFactura'],
  facturado_a: ['facturado_a', 'FACTURADO_A', 'facturadoA'],
  producto_vendido: ['producto_vendido', 'PRODUCTO_VENDIDO', 'productoVendido'],
  fecha_factura: ['fecha_factura', 'FECHA_FACTURA', 'fechaFactura'],
  vin: ['vin', 'VIN'],
  fecha_entrega: ['fecha_entrega', 'FECHA_ENTREGA', 'fechaEntrega'],
  vendedor: ['vendedor', 'VENDEDOR'],
};

function pick(payload, keys) {
  for (const key of keys) {
    if (payload[key] != null && payload[key] !== '') return payload[key];
  }
  return '';
}

function asText(value, max = 255) {
  const text = String(value ?? '').trim();
  return text.slice(0, max);
}

const FIELD_LIMITS = {
  id_contacto: 64,
  nombre_contacto: 255,
  id_ciclo: 64,
  fecha_inicio_ciclo: 40,
  fecha_esperada_cierre: 40,
  estatus: 80,
  fecha_estatus: 40,
  tipo_actividad: 120,
  fecha_crea_actividad: 40,
  fecha_prog_actividad: 40,
  fecha_resp_actividad: 40,
  resultado_actividad: 8000,
  forma_contacto: 80,
  medio_contacto: 80,
  submedio_contacto: 120,
  num_factura: 64,
  facturado_a: 255,
  producto_vendido: 255,
  fecha_factura: 40,
  vin: 32,
  fecha_entrega: 40,
  vendedor: 160,
};

function normalizeRow(payload = {}) {
  const source = payload.data && typeof payload.data === 'object' ? { ...payload, ...payload.data } : payload;
  const row = {};
  for (const field of FIELDS) {
    row[field] = asText(pick(source, ALIASES[field]), FIELD_LIMITS[field] || 255);
  }
  if (!row.id_contacto) {
    const err = new Error('Cada fila requiere ID_CONTACTO (o D_CONTACTO)');
    err.status = 400;
    throw err;
  }

  const externalId = asText(
    source.id || source.externalId || source.external_id || source.row_key || source.rowKey,
    192
  );
  const identity = externalId || [
    row.id_contacto,
    row.id_ciclo,
    row.tipo_actividad,
    row.fecha_crea_actividad,
    row.fecha_prog_actividad,
    row.fecha_resp_actividad,
    row.vin,
    row.num_factura,
  ].join('|');
  const rowKey = crypto.createHash('sha256').update(identity).digest('hex');
  const contentHash = crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex');
  return { ...row, rowKey, contentHash };
}

function ensureCrmCiclosTableSql() {
  return `
    CREATE TABLE IF NOT EXISTS crm_ciclos (
      id                      BIGSERIAL PRIMARY KEY,
      row_key                 CHAR(64)     NOT NULL UNIQUE,
      id_contacto             VARCHAR(64)  NOT NULL,
      nombre_contacto         VARCHAR(255) NOT NULL DEFAULT '',
      id_ciclo                VARCHAR(64)  NOT NULL DEFAULT '',
      fecha_inicio_ciclo      VARCHAR(40)  NOT NULL DEFAULT '',
      fecha_esperada_cierre   VARCHAR(40)  NOT NULL DEFAULT '',
      estatus                 VARCHAR(80)  NOT NULL DEFAULT '',
      fecha_estatus           VARCHAR(40)  NOT NULL DEFAULT '',
      tipo_actividad          VARCHAR(120) NOT NULL DEFAULT '',
      fecha_crea_actividad    VARCHAR(40)  NOT NULL DEFAULT '',
      fecha_prog_actividad    VARCHAR(40)  NOT NULL DEFAULT '',
      fecha_resp_actividad    VARCHAR(40)  NOT NULL DEFAULT '',
      resultado_actividad     TEXT         NOT NULL DEFAULT '',
      forma_contacto          VARCHAR(80)  NOT NULL DEFAULT '',
      medio_contacto          VARCHAR(80)  NOT NULL DEFAULT '',
      submedio_contacto       VARCHAR(120) NOT NULL DEFAULT '',
      num_factura             VARCHAR(64)  NOT NULL DEFAULT '',
      facturado_a             VARCHAR(255) NOT NULL DEFAULT '',
      producto_vendido        VARCHAR(255) NOT NULL DEFAULT '',
      fecha_factura           VARCHAR(40)  NOT NULL DEFAULT '',
      vin                     VARCHAR(32)  NOT NULL DEFAULT '',
      fecha_entrega           VARCHAR(40)  NOT NULL DEFAULT '',
      vendedor                VARCHAR(160) NOT NULL DEFAULT '',
      content_hash            CHAR(64),
      source                  VARCHAR(32)  NOT NULL DEFAULT 'api',
      last_batch_id           BIGINT,
      created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_crm_ciclos_contacto ON crm_ciclos (id_contacto);
    CREATE INDEX IF NOT EXISTS idx_crm_ciclos_ciclo ON crm_ciclos (id_ciclo);
    CREATE INDEX IF NOT EXISTS idx_crm_ciclos_vin ON crm_ciclos (vin);
    CREATE INDEX IF NOT EXISTS idx_crm_ciclos_vendedor ON crm_ciclos (vendedor);
    CREATE INDEX IF NOT EXISTS idx_crm_ciclos_estatus ON crm_ciclos (estatus);
    CREATE INDEX IF NOT EXISTS idx_crm_ciclos_factura ON crm_ciclos (num_factura);
  `;
}

async function ensureCrmCiclosTable() {
  const statements = ensureCrmCiclosTableSql()
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await query(`${statement};`);
  }
  await query(`
    ALTER TABLE crm_ciclos
    ALTER COLUMN resultado_actividad TYPE TEXT
    USING LEFT(resultado_actividad, 8000)
  `).catch(() => {});
}

const UPSERT_SQL = `
  INSERT INTO crm_ciclos (
    row_key, id_contacto, nombre_contacto, id_ciclo, fecha_inicio_ciclo,
    fecha_esperada_cierre, estatus, fecha_estatus, tipo_actividad,
    fecha_crea_actividad, fecha_prog_actividad, fecha_resp_actividad,
    resultado_actividad, forma_contacto, medio_contacto, submedio_contacto,
    num_factura, facturado_a, producto_vendido, fecha_factura, vin,
    fecha_entrega, vendedor, content_hash, source, last_batch_id, updated_at
  ) VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,NOW()
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
    last_batch_id = EXCLUDED.last_batch_id,
    updated_at = NOW()
  WHERE crm_ciclos.content_hash IS DISTINCT FROM EXCLUDED.content_hash
`;

function upsertParams(row, { source, batchId }) {
  return [
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
    source || 'api',
    batchId || null,
  ];
}

async function upsertCrmRows(client, normalized, { replaceAll = false, source = 'api', batchId = null } = {}) {
  if (replaceAll) {
    await client.query('TRUNCATE TABLE crm_ciclos');
  }

  let upserted = 0;
  for (const row of normalized) {
    await client.query(UPSERT_SQL, upsertParams(row, { source, batchId }));
    upserted += 1;
  }

  const total = await client.query('SELECT COUNT(*)::int AS total FROM crm_ciclos');
  const contactos = await client.query(
    'SELECT COUNT(DISTINCT id_contacto)::int AS total FROM crm_ciclos'
  );
  return {
    upserted,
    replaced: Boolean(replaceAll),
    total: total.rows[0]?.total || 0,
    contactos: contactos.rows[0]?.total || 0,
  };
}

async function upsertCrmBatch(records, { replaceAll = false, source = 'api', batchId = null, client } = {}) {
  if (!Array.isArray(records) || !records.length) {
    const err = new Error('El payload debe incluir al menos un registro');
    err.status = 400;
    throw err;
  }
  if (records.length > 25000) {
    const err = new Error('Máximo 25000 filas por llamada; envíe en lotes');
    err.status = 400;
    throw err;
  }

  const normalized = records.map(normalizeRow);
  const opts = { replaceAll, source, batchId };
  if (client) return upsertCrmRows(client, normalized, opts);
  return withTransaction((txn) => upsertCrmRows(txn, normalized, opts));
}

function toApiRow(row) {
  return {
    id: row.id,
    idContacto: row.id_contacto,
    nombreContacto: row.nombre_contacto,
    idCiclo: row.id_ciclo,
    fechaInicioCiclo: row.fecha_inicio_ciclo,
    fechaEsperadaCierre: row.fecha_esperada_cierre,
    estatus: row.estatus,
    fechaEstatus: row.fecha_estatus,
    tipoActividad: row.tipo_actividad,
    fechaCreaActividad: row.fecha_crea_actividad,
    fechaProgActividad: row.fecha_prog_actividad,
    fechaRespActividad: row.fecha_resp_actividad,
    resultadoActividad: row.resultado_actividad,
    formaContacto: row.forma_contacto,
    medioContacto: row.medio_contacto,
    submedioContacto: row.submedio_contacto,
    numFactura: row.num_factura,
    facturadoA: row.facturado_a,
    productoVendido: row.producto_vendido,
    fechaFactura: row.fecha_factura,
    vin: row.vin,
    fechaEntrega: row.fecha_entrega,
    vendedor: row.vendedor,
    updatedAt: row.updated_at,
  };
}

async function listCrm({
  q,
  vendedor,
  estatus,
  idContacto,
  vin,
  idCiclo,
  limit = 200,
  offset = 0,
} = {}) {
  const params = [];
  let sql = `SELECT * FROM crm_ciclos WHERE 1=1`;

  if (idContacto) {
    params.push(String(idContacto).trim());
    sql += ` AND id_contacto = $${params.length}`;
  }
  if (idCiclo) {
    params.push(String(idCiclo).trim());
    sql += ` AND id_ciclo = $${params.length}`;
  }
  if (vendedor) {
    params.push(`%${String(vendedor).trim()}%`);
    sql += ` AND vendedor ILIKE $${params.length}`;
  }
  if (estatus) {
    params.push(String(estatus).trim());
    sql += ` AND estatus = $${params.length}`;
  }
  if (vin) {
    params.push(String(vin).trim().toUpperCase());
    sql += ` AND UPPER(vin) = $${params.length}`;
  }
  if (q) {
    params.push(`%${String(q).trim()}%`);
    sql += ` AND (
      id_contacto ILIKE $${params.length}
      OR nombre_contacto ILIKE $${params.length}
      OR vin ILIKE $${params.length}
      OR num_factura ILIKE $${params.length}
      OR vendedor ILIKE $${params.length}
    )`;
  }

  sql += ` ORDER BY fecha_crea_actividad DESC, id DESC`;
  params.push(Math.min(Math.max(Number(limit) || 200, 1), 2000));
  sql += ` LIMIT $${params.length}`;
  params.push(Math.max(Number(offset) || 0, 0));
  sql += ` OFFSET $${params.length}`;

  const result = await query(sql, params);
  return result.rows.map(toApiRow);
}

async function getCrmSummary() {
  const totals = await query(`
    SELECT
      COUNT(*)::int AS filas,
      COUNT(DISTINCT id_contacto)::int AS contactos,
      COUNT(DISTINCT id_ciclo)::int AS ciclos,
      COUNT(DISTINCT NULLIF(vin, ''))::int AS vins,
      COUNT(DISTINCT NULLIF(num_factura, ''))::int AS facturas
    FROM crm_ciclos
  `);
  const byEstatus = await query(`
    SELECT COALESCE(NULLIF(estatus, ''), '(sin estatus)') AS estatus, COUNT(*)::int AS total
    FROM crm_ciclos
    GROUP BY 1
    ORDER BY total DESC
    LIMIT 20
  `);
  const byVendedor = await query(`
    SELECT COALESCE(NULLIF(vendedor, ''), '(sin vendedor)') AS vendedor, COUNT(*)::int AS total
    FROM crm_ciclos
    GROUP BY 1
    ORDER BY total DESC
    LIMIT 20
  `);
  return {
    ...(totals.rows[0] || { filas: 0, contactos: 0, ciclos: 0, vins: 0, facturas: 0 }),
    byEstatus: byEstatus.rows,
    byVendedor: byVendedor.rows,
  };
}

module.exports = {
  FIELDS,
  normalizeRow,
  ensureCrmCiclosTableSql,
  ensureCrmCiclosTable,
  upsertCrmBatch,
  listCrm,
  getCrmSummary,
};
