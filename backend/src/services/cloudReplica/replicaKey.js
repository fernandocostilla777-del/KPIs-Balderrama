'use strict';
/**
 * Clave de una respuesta en la réplica de la nube: ruta bajo /api + consulta
 * normalizada. La usan igual el lector (modo nube) y el publicador (oficina).
 */

/** Parámetros que no cambian la respuesta (romper caché o forzar recálculo). */
const IGNORED_PARAMS = new Set(['_', 't', 'ts', 'nocache', 'fresh', 'refresh']);

/**
 * Vistas de un cliente individual (nombre, teléfono, historial): no se publican
 * en la nube, solo se consultan dentro de la oficina. Debe coincidir con
 * cloud-api/src/services/desktopCacheStore.js (lo vigila una prueba).
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

function normalizeQuery(input) {
  const params = input instanceof URLSearchParams ? input : new URLSearchParams(input || '');
  const pairs = [];
  for (const [k, v] of params) {
    if (!IGNORED_PARAMS.has(k)) pairs.push([k, v]);
  }
  pairs.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  return new URLSearchParams(pairs).toString();
}

function normalizeRoute(route) {
  const clean = String(route || '').split('?')[0].replace(/\/+$/, '');
  return clean.startsWith('/') ? clean : `/${clean}`;
}

function esRutaExcluida(ruta) {
  const r = normalizeRoute(ruta);
  return PREFIJOS_EXCLUIDOS.some((p) => r === p.replace(/\/$/, '') || r.startsWith(p));
}

module.exports = { normalizeQuery, normalizeRoute, esRutaExcluida, PREFIJOS_EXCLUIDOS };
