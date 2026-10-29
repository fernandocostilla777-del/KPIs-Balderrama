'use strict';
/**
 * Réplica de las respuestas del backend de la oficina (adaptada de KPIs-VECSA).
 *
 * El servidor de la oficina publica aquí (ruta + consulta → JSON) mientras ve
 * SQL Server. Un backend sin SQL Server (escritorio fuera de la red) lee de aquí.
 * Cuando alguien pide una vista que aún no existe, queda anotada como pendiente
 * y el siguiente ciclo rápido del publicador la calcula.
 */
const { query } = require('../db');

const DIAS_USO = 14;   // consultas usadas en este lapso se recalculan en cada ciclo
const DIAS_PURGA = 45; // lo que nadie consulta en este lapso se borra

/**
 * Vistas de un cliente individual (nombre, teléfono, historial). No se publican:
 * se consultan solo dentro de la oficina. Debe coincidir con
 * backend/src/services/cloudReplica/replicaKey.js (lo vigila una prueba).
 */
const PREFIJOS_EXCLUIDOS = [
  '/seguimiento-360/cliente/',
  '/seguimiento-360/expediente/',
  '/seguimiento-360/buscar',
  '/crm/contactos',
  '/post-sales/orden/',
  '/ventas/financiamiento/factura/',
  '/ventas/monitoreo-cholula/clientes',
  '/ventas/monitoreo-cholula/calendario',
  '/ai/',
  '/auth/',
];

function esRutaExcluida(ruta) {
  const r = String(ruta || '').trim();
  return PREFIJOS_EXCLUIDOS.some((p) => r === p.replace(/\/$/, '') || r.startsWith(p));
}

let ensured = false;
async function ensureDesktopCacheTable() {
  if (ensured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS desktop_cache (
      scope TEXT NOT NULL DEFAULT '',
      ruta TEXT NOT NULL,
      consulta TEXT NOT NULL DEFAULT '',
      status INTEGER,
      body TEXT,
      generado_at TIMESTAMPTZ,
      ultimo_uso TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (scope, ruta, consulta)
    )
  `);
  await query('CREATE INDEX IF NOT EXISTS desktop_cache_uso_idx ON desktop_cache (ultimo_uso DESC)');
  ensured = true;
}

/** Lee una respuesta; si no existe, la deja pedida para el siguiente ciclo. */
async function leer({ scope = '', ruta, consulta = '' }) {
  if (esRutaExcluida(ruta)) return null;
  await ensureDesktopCacheTable();
  const { rows } = await query(
    `INSERT INTO desktop_cache (scope, ruta, consulta, ultimo_uso)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (scope, ruta, consulta) DO UPDATE
       SET ultimo_uso = CASE WHEN desktop_cache.ultimo_uso < now() - interval '1 hour'
                             THEN now() ELSE desktop_cache.ultimo_uso END
     RETURNING status, body, generado_at`,
    [scope, ruta, consulta],
  );
  return rows[0] || null;
}

async function guardar(entries) {
  await ensureDesktopCacheTable();
  let guardadas = 0;
  for (const e of entries) {
    if (esRutaExcluida(e.ruta)) continue;
    // eslint-disable-next-line no-await-in-loop
    await query(
      `INSERT INTO desktop_cache (scope, ruta, consulta, status, body, generado_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (scope, ruta, consulta) DO UPDATE
         SET status = EXCLUDED.status, body = EXCLUDED.body, generado_at = EXCLUDED.generado_at`,
      [e.scope || '', e.ruta, e.consulta || '', e.status, e.body],
    );
    guardadas += 1;
  }
  await query(`DELETE FROM desktop_cache WHERE ultimo_uso < now() - interval '${DIAS_PURGA} days'`);
  return guardadas;
}

async function pendientes({ soloFaltantes = false, limite = 500 } = {}) {
  await ensureDesktopCacheTable();
  const { rows } = await query(
    `SELECT scope, ruta, consulta
     FROM desktop_cache
     WHERE ultimo_uso > now() - interval '${DIAS_USO} days'
       ${soloFaltantes ? 'AND generado_at IS NULL' : ''}
     ORDER BY (generado_at IS NULL) DESC, ultimo_uso DESC
     LIMIT $1`,
    [limite],
  );
  return rows.filter((r) => !esRutaExcluida(r.ruta));
}

async function estado() {
  await ensureDesktopCacheTable();
  const { rows } = await query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE generado_at IS NULL)::int AS faltantes,
            max(generado_at) AS ultima_publicacion
     FROM desktop_cache`,
  );
  const porRuta = await query(
    `SELECT ruta, count(*)::int AS consultas,
            count(*) FILTER (WHERE generado_at IS NULL)::int AS vacias
     FROM desktop_cache GROUP BY ruta ORDER BY ruta`,
  );
  return { ...rows[0], rutas: porRuta.rows };
}

module.exports = {
  ensureDesktopCacheTable,
  esRutaExcluida,
  PREFIJOS_EXCLUIDOS,
  leer,
  guardar,
  pendientes,
  estado,
};
