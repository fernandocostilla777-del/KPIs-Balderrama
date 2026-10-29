'use strict';
/**
 * Modo nube: responde GET /api/* con la réplica publicada en la nube, sin tocar
 * SQL Server. Adaptado de KPIs-VECSA.
 *
 * - Va después de requireAuthApi: el permiso por perfil se revisa aquí, en local,
 *   antes de pedir nada a la nube.
 * - Si la vista aún no está publicada (o es de un cliente individual), se resuelve
 *   localmente: funciona lo que no depende de SQL Server (CRM, archivos, IA).
 * - Las escrituras (POST/PUT/DELETE) siempre van al backend local.
 */
const dataSource = require('../dataSource');
const { normalizeQuery, normalizeRoute, esRutaExcluida } = require('./replicaKey');

const READ_TIMEOUT_MS = 60 * 1000;

/** No dependen de SQL Server: se atienden local sin ir a la nube. */
const LOCAL_PREFIXES = [
  '/health',
  '/data-source',
  '/conexion',
  '/ai/',
  '/crm/sheets-sync/',
  '/cloud-sync/',
  '/lista-precios',
  '/forecast/presupuesto-12m/escenarios',
  '/ventas/financiamiento/notas',
];

function esLocal(ruta) {
  return LOCAL_PREFIXES.some((p) => ruta === p.replace(/\/$/, '') || ruta.startsWith(p));
}

function createReplicaMiddleware({ fetchImpl = (...a) => fetch(...a) } = {}) {
  return async function replicaMiddleware(req, res, next) {
    if (!dataSource.isCloud()) return next();
    if (req.method !== 'GET' || req.headers['x-replica-publisher']) return next();

    const ruta = normalizeRoute(req.path);
    if (esLocal(ruta) || esRutaExcluida(ruta)) return next();

    // La réplica se publica con la vista de toda la agencia. Un perfil de sucursal (Cholula)
    // no puede leerla: vería cifras de toda la agencia. Se atiende en local (SQL con alcance).
    const { alcanceDeRol } = require('../../auth/alcanceSucursal');
    if (alcanceDeRol(req.session?.role)) {
      res.setHeader('X-Data-Source', 'local-sucursal');
      return next();
    }

    const qsIndex = req.originalUrl.indexOf('?');
    const consulta = normalizeQuery(qsIndex >= 0 ? req.originalUrl.slice(qsIndex + 1) : '');
    const url = `${dataSource.cloudReadUrl()}/api/desktop-cache?${new URLSearchParams({ ruta, consulta })}`;

    let cloudRes;
    try {
      cloudRes = await fetchImpl(url, {
        headers: { 'X-Read-Key': dataSource.cloudReadKey(), 'Accept-Encoding': 'gzip' },
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });
    } catch (err) {
      res.setHeader('X-Data-Source', 'local-sin-nube');
      console.warn(`[cloud-replica] sin respuesta de la nube para ${ruta}: ${err.message}`);
      return next();
    }

    // Aún no publicada, excluida o sin permiso de lectura: intentar local.
    if (cloudRes.status === 503 || cloudRes.status === 404 || cloudRes.status === 401) {
      if (cloudRes.status === 401) console.warn('[cloud-replica] la nube rechazó CLOUD_READ_API_KEY');
      res.setHeader('X-Data-Source', 'local');
      return next();
    }

    const body = await cloudRes.text();
    const generado = cloudRes.headers.get('x-replica-generado');
    if (generado) res.setHeader('X-Replica-Generado', generado);
    res.setHeader('X-Data-Source', 'cloud');
    return res
      .status(cloudRes.status)
      .type(cloudRes.headers.get('content-type') || 'application/json')
      .send(body);
  };
}

module.exports = { replicaMiddleware: createReplicaMiddleware(), createReplicaMiddleware, esLocal };
