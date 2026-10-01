/**
 * Store de EEFF mensual (Contabilidad › EEFF aplanado por mes).
 *
 * Reutiliza eeffSummaryService.getEeffSummary mes a mes y persiste en disco
 * los meses cerrados para que el Pronóstico (seguimiento PPTO y generador de
 * presupuesto 12 meses) no tenga que recalcular 24–36 meses en cada consulta.
 *
 * Cada mes se guarda aplanado con la misma nomenclatura del EEFF:
 *   pnl       → líneas del estado de resultados (ventasTotales, costoTotal, ...)
 *   detail    → autos nuevos por fuerza de venta y postventa por área
 *   segmentos → P&L por segmento (ventas, costo, UB, gastos, admin, UO)
 */
const fs = require('fs');
const path = require('path');
const { getEeffSummary } = require('./eeffSummaryService');

const CACHE_PATH = path.join(__dirname, '../../data/eeff-mensual-cache.json');
const CLOSED_TTL_MS = 24 * 60 * 60 * 1000; // meses cerrados (persistidos)
const RECENT_TTL_MS = 6 * 60 * 60 * 1000; // últimos 2 meses cerrados (ajustes contables)
const OPEN_TTL_MS = 10 * 60 * 1000; // mes en curso

const memory = new Map(); // key → { at, ttl, data }
let diskLoaded = false;
let diskDirty = false;
let flushTimer = null;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function monthKey(year, mes) {
  return `${year}-${pad2(mes)}`;
}

function monthRange(year, mes) {
  const last = new Date(year, mes, 0).getDate();
  return {
    fechaInicio: `${year}-${pad2(mes)}-01`,
    fechaFin: `${year}-${pad2(mes)}-${pad2(last)}`,
  };
}

function loadDisk() {
  if (diskLoaded) return;
  diskLoaded = true;
  try {
    if (!fs.existsSync(CACHE_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    for (const [key, entry] of Object.entries(raw?.meses || {})) {
      if (entry?.data) memory.set(key, { at: entry.at || 0, ttl: entry.ttl || CLOSED_TTL_MS, data: entry.data });
    }
  } catch (err) {
    console.error('[eeff-mensual] no se pudo leer caché en disco:', err.message);
  }
}

function scheduleFlush() {
  diskDirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (!diskDirty) return;
    diskDirty = false;
    try {
      const meses = {};
      for (const [key, entry] of memory.entries()) {
        if (!entry.persist) continue;
        meses[key] = { at: entry.at, ttl: entry.ttl, data: entry.data };
      }
      fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
      fs.writeFileSync(CACHE_PATH, JSON.stringify({ version: 1, savedAt: new Date().toISOString(), meses }));
    } catch (err) {
      console.error('[eeff-mensual] no se pudo escribir caché en disco:', err.message);
    }
  }, 1500).unref?.();
}

// ---------------------------------------------------------------------------
// Aplanado
// ---------------------------------------------------------------------------
function sectionById(list, id) {
  return (list || []).find((s) => s.id === id) || {};
}

function pnlRow(row, label) {
  return {
    label: label || row?.label || '',
    ventas: Number(row?.ventas || 0),
    costo: Number(row?.costo || 0),
    utilidadBruta: Number(row?.utilidadBruta || 0),
    gastos: Number(row?.gastos || 0),
    gastosAdministracion: Number(row?.gastosAdministracion || 0),
    sumaGastos: Number(row?.sumaGastos || 0),
    utilidadOperacion: Number(row?.utilidadOperacion || 0),
  };
}

/** Aplana un payload (real EEFF o presupuesto) a un mapa key → valor. */
function flattenPnl(payload) {
  const v = payload?.ventas || {};
  const pv = payload?.postventa || {};
  const edo = payload?.estadoFinanciero?.summary || {};
  const edoLines = payload?.estadoFinanciero?.lines || [];
  const lineValue = (key) => Number(edoLines.find((l) => l.key === key)?.value || 0);
  const seminuevos = payload?.seminuevos?.summary?.ventas ?? lineValue('ventasSeminuevos');

  return {
    ventasAutos: Number(v.totalVentasAutos?.summary?.ventas || 0),
    ventasMenudeo: Number(v.menudeo?.summary?.ventas || 0),
    ventasFlotillas: Number(v.flotillas?.summary?.ventas || 0),
    ventasIntercambios: Number(v.intercambios?.summary?.ventas || 0),
    ventasSeminuevos: Number(seminuevos || 0),
    ventasPostventa: Number(pv.summary?.ventas || 0),
    pv_servicio: Number(sectionById(pv.sections, 'servicio').ventas || 0),
    pv_refacciones: Number(sectionById(pv.sections, 'refacciones').ventas || 0),
    pv_hyp: Number(sectionById(pv.sections, 'hyp').ventas || 0),
    ventasTotales: Number(edo.ventasTotales || 0),
    costoTotal: Number(edo.costoTotal || 0),
    utilidadBruta: Number(edo.utilidadBruta || 0),
    gastosOperacion: Number(edo.gastosOperacion || 0),
    gastosAdministracion: Number(edo.gastosAdministracion || 0),
    sumaGastos: Number(edo.sumaGastos || 0),
    utilidadOperacion: Number(edo.utilidadOperacion || 0),
  };
}

/** Filas de detalle (autos nuevos por fuerza de venta / postventa por área). */
function flattenDetail(payload) {
  const v = payload?.ventas || {};
  const pv = payload?.postventa || {};
  const pick = (row) => ({
    ventas: Number(row?.ventas || 0),
    utilidadBruta: Number(row?.utilidadBruta || 0),
    utilidadOperacion: Number(row?.utilidadOperacion || 0),
  });
  const autos = {};
  for (const b of v.menudeo?.branches || []) autos[b.id] = { label: b.label, ...pick(b) };
  autos.menudeo_total = { label: 'Total menudeo', ...pick(v.menudeo?.summary) };
  autos.flotillas = { label: 'Flotillas', ...pick(v.flotillas?.summary) };
  autos.intercambios = { label: 'Intercambios', ...pick(v.intercambios?.summary) };
  autos.total = { label: 'Total autos nuevos', ...pick(v.totalVentasAutos?.summary) };

  const postventa = {};
  for (const s of pv.sections || []) postventa[s.id] = { label: s.label, ...pick(s) };
  postventa.total = { label: 'Total PostVenta', ...pick(pv.summary) };

  return { autos, postventa };
}

/** P&L por segmento operativo (base del generador de presupuesto). */
function flattenSegmentos(payload) {
  const v = payload?.ventas || {};
  const pv = payload?.postventa || {};
  const out = {};
  for (const b of v.menudeo?.branches || []) out[b.id] = { ...pnlRow(b), grupo: 'menudeo' };
  out.flotillas = { ...pnlRow(v.flotillas?.summary, 'Flotillas'), grupo: 'autos' };
  out.intercambios = { ...pnlRow(v.intercambios?.summary, 'Intercambios'), grupo: 'autos' };
  out.seminuevos = { ...pnlRow(payload?.seminuevos?.summary, 'Seminuevos'), grupo: 'seminuevos' };
  for (const s of pv.sections || []) out[s.id] = { ...pnlRow(s), grupo: 'postventa' };
  return out;
}

function flattenAll(payload) {
  return {
    available: Boolean(payload?.available),
    pnl: flattenPnl(payload),
    detail: flattenDetail(payload),
    segmentos: flattenSegmentos(payload),
  };
}

// ---------------------------------------------------------------------------
// Acceso
// ---------------------------------------------------------------------------
function isClosed(year, mes, hoy = new Date()) {
  const cur = hoy.getFullYear() * 100 + (hoy.getMonth() + 1);
  return year * 100 + mes < cur;
}

function ttlFor(year, mes, hoy = new Date()) {
  if (!isClosed(year, mes, hoy)) return OPEN_TTL_MS;
  const monthsAgo = (hoy.getFullYear() - year) * 12 + (hoy.getMonth() + 1 - mes);
  return monthsAgo <= 2 ? RECENT_TTL_MS : CLOSED_TTL_MS;
}

async function fetchMes(year, mes) {
  const key = monthKey(year, mes);
  const eeff = await getEeffSummary(monthRange(year, mes));
  const data = flattenAll(eeff);
  const closed = isClosed(year, mes);
  memory.set(key, { at: Date.now(), ttl: ttlFor(year, mes), data, persist: closed && data.available });
  if (closed && data.available) scheduleFlush();
  return { mes, year, key, ...data };
}

// Meses cerrados vencidos se sirven del caché y se refrescan en serie en segundo plano,
// para no bloquear al usuario ~2 min re-consultando 36 meses.
const refreshing = new Set();
let refreshChain = Promise.resolve();
function refreshInBackground(year, mes) {
  const key = monthKey(year, mes);
  if (refreshing.has(key)) return;
  refreshing.add(key);
  refreshChain = refreshChain
    .then(() => fetchMes(year, mes))
    .catch((err) => console.error(`[eeff-mensual] refresco ${key}:`, err.message))
    .finally(() => refreshing.delete(key));
}

/**
 * Devuelve el EEFF aplanado de un mes.
 * @param {number} year
 * @param {number} mes 1..12
 * @param {{fresh?: boolean}} [opts]
 */
async function getEeffMes(year, mes, { fresh = false } = {}) {
  loadDisk();
  const key = monthKey(year, mes);
  const hit = memory.get(key);
  if (!fresh && hit) {
    if (Date.now() - hit.at < hit.ttl) return { mes, year, key, ...hit.data };
    if (isClosed(year, mes) && hit.data?.available) {
      refreshInBackground(year, mes);
      return { mes, year, key, ...hit.data };
    }
  }
  return fetchMes(year, mes);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx;
      idx += 1;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Lista de {year, mes} para los N meses que terminan en (year, mes) inclusive. */
function monthsBack(year, mes, n) {
  const out = [];
  let y = year;
  let m = mes;
  for (let i = 0; i < n; i += 1) {
    out.unshift({ year: y, mes: m });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/**
 * Obtiene varios meses con concurrencia limitada. Los errores se devuelven
 * como { error } para no tirar toda la consulta.
 */
async function getEeffMeses(list, { fresh = false, concurrency = 3 } = {}) {
  return mapLimit(list, concurrency, ({ year, mes }) =>
    getEeffMes(year, mes, { fresh }).catch((err) => ({
      year, mes, key: monthKey(year, mes), available: false, error: err.message, pnl: null, detail: null, segmentos: null,
    })));
}

function clearCache() {
  memory.clear();
  try {
    if (fs.existsSync(CACHE_PATH)) fs.unlinkSync(CACHE_PATH);
  } catch { /* noop */ }
}

module.exports = {
  getEeffMes,
  getEeffMeses,
  monthsBack,
  monthKey,
  monthRange,
  isClosed,
  flattenPnl,
  flattenDetail,
  flattenSegmentos,
  clearCache,
  CACHE_PATH,
};
