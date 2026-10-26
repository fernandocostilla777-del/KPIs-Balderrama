'use strict';
/**
 * Publica en la nube las respuestas de /api/* para que un backend sin SQL Server
 * (escritorio fuera de la red de la agencia) pueda mostrar el tablero.
 * Adaptado de KPIs-VECSA.
 *
 * Corre solo en el servidor de la oficina que sincroniza (CLOUD_SYNC_ENABLED=true)
 * y mientras ve SQL Server:
 * - Ciclo completo (CLOUD_REPLICA_INTERVAL_MINUTES, 30 por omisión): vistas del mes
 *   actual y anterior, y todas las consultas usadas en la nube en los últimos 14 días.
 * - Ciclo rápido (CLOUD_REPLICA_PENDING_MINUTES, 5 por omisión): solo las consultas
 *   que alguien pidió y todavía no existen.
 *
 * En Balderrama las respuestas de datos no cambian por perfil (el permiso se revisa
 * antes, en requireAuthApi), así que hay una sola réplica para todos.
 */
const http = require('http');
const zlib = require('zlib');
const dataSource = require('../dataSource');
const { getCloudConfig } = require('../cloudSync/cloudSyncClient');
const { createSession, COOKIE_NAME } = require('../../auth/session');
const { normalizeQuery, normalizeRoute, esRutaExcluida } = require('./replicaKey');

/** Rutas con periodo, tal como las pide el frontend (fechaInicio + fechaFin). */
const RUTAS_CON_FECHAS = [
  '/overview',
  '/overview/analytics',
  '/ventas',
  '/ventas/objetivos',
  '/eeff',
  '/post-sales',
  '/post-sales/refacciones',
  '/post-sales/hyp/aseguradoras-cobranza',
  '/post-sales/hyp/garantias-cobranza',
  '/contabilidad/estado-resultados',
];

/** Rutas que solo llevan la fecha de corte (fechaFin). */
const RUTAS_CORTE = ['/contabilidad/balance', '/ventas/leads/supervivencia'];

/** Rutas sin periodo, con los parámetros fijos que usa el frontend. */
const RUTAS_FIJAS = [
  { ruta: '/inventory', params: { planPisoPeriod: 'all' } },
  { ruta: '/inventory/seminuevos', params: { mesesRotacion: '12' } },
  { ruta: '/inventory/postventa', params: {} },
  { ruta: '/forecast/presupuesto', params: {} },
  { ruta: '/ventas/financiamiento/gerentes', params: {} },
];

const REQUEST_TIMEOUT_MS = 3 * 60 * 1000;
/** La nube acepta hasta 25 MB de JSON por petición. */
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_BATCH_BYTES = 10 * 1024 * 1024;
const CONCURRENCY = 2;

const state = {
  port: null,
  running: false,
  lastRunAt: null,
  lastResult: null,
  lastError: null,
  fullTimer: null,
  pendingTimer: null,
};

function minutesEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Math.max(1, Number.isFinite(n) && n > 0 ? n : fallback) * 60 * 1000;
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Mismos rangos que los atajos del frontend: mes actual y mes anterior completos. */
function monthRanges(now = new Date()) {
  const actual = [new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 0)];
  const anterior = [new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 0)];
  return [actual, anterior].map(([a, b]) => ({ fechaInicio: isoDate(a), fechaFin: isoDate(b) }));
}

function seedItems(now = new Date()) {
  const items = [];
  for (const range of monthRanges(now)) {
    for (const ruta of RUTAS_CON_FECHAS) {
      items.push({ ruta, consulta: normalizeQuery(new URLSearchParams(range)) });
    }
    for (const ruta of RUTAS_CORTE) {
      items.push({ ruta, consulta: normalizeQuery(new URLSearchParams({ fechaFin: range.fechaFin })) });
    }
  }
  for (const { ruta, params } of RUTAS_FIJAS) {
    items.push({ ruta, consulta: normalizeQuery(new URLSearchParams(params)) });
  }
  return items;
}

const itemKey = (item) => `${item.ruta}|${item.consulta}`;

function cloudConfig() {
  const cfg = getCloudConfig();
  if (!cfg.enabled || !cfg.baseUrl || !cfg.apiKey) return null;
  return cfg;
}

async function fetchPendientes(cfg, { soloFaltantes }) {
  const url = `${cfg.baseUrl}/api/desktop-cache/pendientes${soloFaltantes ? '?soloFaltantes=1' : ''}`;
  const res = await fetch(url, { headers: { 'X-API-Key': cfg.apiKey }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`pendientes: HTTP ${res.status}`);
  const data = await res.json();
  return (data.items || [])
    .map((it) => ({ ruta: normalizeRoute(it.ruta), consulta: normalizeQuery(it.consulta) }))
    .filter((it) => !esRutaExcluida(it.ruta));
}

/** Pide la ruta al propio backend con una sesión interna de Administración. */
function computeLocal(item) {
  const token = createSession({ username: 'replica-nube', role: 'administracion' });
  const path = `/api${item.ruta}${item.consulta ? `?${item.consulta}` : ''}`;
  return new Promise((resolve) => {
    const req = http.get({
      host: '127.0.0.1',
      port: state.port,
      path,
      headers: { Cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}`, 'X-Replica-Publisher': '1' },
      timeout: REQUEST_TIMEOUT_MS,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const type = String(res.headers['content-type'] || '');
        resolve({ status: res.statusCode, json: type.includes('application/json'), body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => resolve({ status: 0, error: err.message }));
  });
}

async function uploadBatch(cfg, entries) {
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify({ entries })));
  const res = await fetch(`${cfg.baseUrl}/api/desktop-cache`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'X-API-Key': cfg.apiKey },
    body: gz,
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`subida: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
}

async function publish({ soloFaltantes = false, reason = 'manual', forzadas = null, compute = computeLocal } = {}) {
  const cfg = cloudConfig();
  if (!cfg) return { ok: false, skipped: true, reason: 'Sincronización a la nube desactivada' };
  if (!state.port && compute === computeLocal) return { ok: false, skipped: true, reason: 'Backend sin puerto' };
  if (state.running) return { ok: false, skipped: true, reason: 'Publicación en curso' };

  state.running = true;
  const started = Date.now();
  const result = { reason, publicadas: 0, omitidas: 0, errores: 0, bytes: 0 };
  try {
    // Varias rutas responden 200 con secciones vacías si SQL falla: no publicar sin SQL Server.
    if ((await dataSource.refresh().catch(() => 'cloud')) === 'cloud') {
      return { ok: false, skipped: true, reason: 'Sin SQL Server' };
    }
    const pendientes = forzadas ? [] : await fetchPendientes(cfg, { soloFaltantes });
    const candidatos = forzadas || (soloFaltantes ? pendientes : [...seedItems(), ...pendientes]);
    const vistos = new Set();
    const items = candidatos.filter((it) => {
      if (esRutaExcluida(it.ruta)) return false;
      const k = itemKey(it);
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });

    let batch = [];
    let batchBytes = 0;
    const flush = async () => {
      if (!batch.length) return;
      const toSend = batch;
      batch = [];
      batchBytes = 0;
      await uploadBatch(cfg, toSend);
    };

    let cursor = 0;
    const worker = async () => {
      while (cursor < items.length) {
        const item = items[cursor];
        cursor += 1;
        const r = await compute(item); // eslint-disable-line no-await-in-loop
        if (r.error || !r.json || r.status >= 500) {
          result.errores += 1;
          console.warn(`[cloud-replica] ${item.ruta}?${item.consulta}: ${r.error || `HTTP ${r.status}`}`);
          continue;
        }
        const size = Buffer.byteLength(r.body);
        if (size > MAX_ENTRY_BYTES) {
          result.omitidas += 1;
          console.warn(`[cloud-replica] ${item.ruta} omitida: ${(size / 1048576).toFixed(1)} MB`);
          continue;
        }
        if (batchBytes + size > MAX_BATCH_BYTES) await flush(); // eslint-disable-line no-await-in-loop
        batch.push({ ...item, status: r.status, body: r.body });
        batchBytes += size;
        result.publicadas += 1;
        result.bytes += size;
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    await flush();

    result.ms = Date.now() - started;
    state.lastRunAt = new Date().toISOString();
    state.lastResult = result;
    state.lastError = null;
    if (result.publicadas || result.errores) {
      console.log(`[cloud-replica] ${result.publicadas} vistas publicadas, ${result.errores} errores (${reason}, ${Math.round(result.ms / 1000)} s)`);
    }
    return { ok: true, ...result };
  } catch (err) {
    state.lastError = err.message;
    console.warn(`[cloud-replica] ${err.message}`);
    return { ok: false, error: err.message };
  } finally {
    state.running = false;
  }
}

function start(port) {
  state.port = port;
  if (!cloudConfig()) return;
  const fullMs = minutesEnv('CLOUD_REPLICA_INTERVAL_MINUTES', 30);
  const pendingMs = minutesEnv('CLOUD_REPLICA_PENDING_MINUTES', 5);
  setTimeout(() => publish({ reason: 'arranque' }).catch(() => {}), 90 * 1000).unref();
  state.fullTimer = setInterval(() => publish({ reason: 'ciclo' }).catch(() => {}), fullMs);
  state.pendingTimer = setInterval(() => publish({ soloFaltantes: true, reason: 'faltantes' }).catch(() => {}), pendingMs);
  state.fullTimer.unref();
  state.pendingTimer.unref();
  console.log(`[cloud-replica] Publicación a la nube cada ${fullMs / 60000} min (faltantes cada ${pendingMs / 60000} min)`);
}

function getStatus() {
  return {
    running: state.running,
    lastRunAt: state.lastRunAt,
    lastResult: state.lastResult,
    lastError: state.lastError,
  };
}

module.exports = {
  start,
  publish,
  getStatus,
  seedItems,
  monthRanges,
  RUTAS_CON_FECHAS,
  RUTAS_FIJAS,
};
