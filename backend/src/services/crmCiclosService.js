/**
 * Base interna CRM — histórico de actividad del cliente en el distribuidor.
 * Fuente: backend/data/crm-ciclos.db (cargada con scripts/etl-crm-ciclos.js).
 * Clave de rastreo: id_contacto (= ID CRM).
 *
 * Compra en ciclo de venta = fila con VIN (columna T del export CRM).
 * Ese VIN = número de serie en SQL:
 *   SER_VEHICULO.VEH_NUMSERIE ≡ ADE_VTAFI.VTE_SERIE ≡ SER_ORDEN.ORE_NUMSERIE
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { query } = require('../db');
const { firstLetter, AREA_LETRAS } = require('./postSalesOrderTypes');

const DB_PATH = path.join(__dirname, '../../data/crm-ciclos.db');
const HYP_LETRAS = new Set(AREA_LETRAS.hyp || ['A', 'F', 'H', 'J', 'V', 'Z', 'Ó']);

function normalizeVin(v) {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase();
  if (!s || s === 'NULL' || /^0+$/.test(s) || s.length < 5) return null;
  return s;
}

let db = null;

function getDb() {
  if (db) return db;
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(
      'Base CRM no encontrada. Ejecute: node backend/scripts/etl-crm-ciclos.js "<ruta al XLSX/CSV Balderrama Ciclos>"'
    );
  }
  db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  // Más páginas en memoria y lectura por mmap: las consultas en frío sobre
  // crm_actividades (~1M filas) dejan de depender tanto del disco.
  try {
    db.pragma('cache_size = -131072'); // 128 MB
    db.pragma('mmap_size = 536870912'); // 512 MB
    db.pragma('temp_store = MEMORY');
  } catch { /* pragmas opcionales */ }
  return db;
}

/**
 * Caché corta en memoria para resultados caros que se repiten entre pantallas
 * (resumen del periodo, cruces al DMS). Se vacía en releaseDb().
 * compute puede devolver promesa; las llamadas concurrentes comparten la misma.
 */
const ttlCaches = new Map();
function ttlCache(name, key, ttlMs, compute) {
  if (!ttlCaches.has(name)) ttlCaches.set(name, new Map());
  const bucket = ttlCaches.get(name);
  const now = Date.now();
  const hit = bucket.get(key);
  if (hit && hit.expires > now) return hit.value;
  let value;
  try {
    value = compute();
  } catch (err) {
    bucket.delete(key);
    throw err;
  }
  bucket.set(key, { value, expires: now + ttlMs });
  if (value && typeof value.then === 'function') {
    value.catch(() => bucket.delete(key));
  }
  if (bucket.size > 300) {
    for (const [k, v] of bucket) {
      if (v.expires <= now) bucket.delete(k);
    }
    if (bucket.size > 300) bucket.delete(bucket.keys().next().value);
  }
  return value;
}

let crmStatsCache = null;

/** Cierra la conexión y limpia índices en memoria (necesario antes/después de un ETL). */
function releaseDb() {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }
  vinIndexCache = null;
  nameIndexCache = null;
  phoneIndexCache = null;
  crmStatsCache = null;
  ttlCaches.clear();
  clearLeadNotDuplicateSqlCache();
}

const yieldLoop = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Precalienta lo que la primera pantalla paga en frío (índices VIN/nombre/teléfono
 * y los conteos de /crm/status). Cada paso cede el event loop para no detener
 * otras peticiones. Se llama al arrancar y después de cada sincronización.
 */
async function warmCaches({ log = console.log } = {}) {
  if (!isAvailable()) return { ok: false, motivo: 'sin base CRM' };
  const t0 = Date.now();
  const steps = [
    ['índice VIN', () => getVinIndex()],
    ['índice nombre', () => getNameIndex()],
    ['índice teléfono', () => getPhoneIndex()],
    ['conteos CRM', () => getCrmStats()],
    ['maduración P-VTA-4', () => getMaduracionBase(new Date().toISOString().slice(0, 10))],
  ];
  for (const [label, fn] of steps) {
    await yieldLoop();
    const a = Date.now();
    try {
      fn();
      if (log) log(`[crm] precalentado ${label} en ${Date.now() - a} ms`);
    } catch (err) {
      if (log) log(`[crm] precalentar ${label}: ${err.message}`);
    }
  }
  return { ok: true, ms: Date.now() - t0 };
}

function isAvailable() {
  return fs.existsSync(DB_PATH);
}

function hasLeadsTable(d) {
  return !!d.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'crm_leads'`).get();
}

function hasSolicitudesTable(d) {
  return !!d.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'crm_solicitudes'`).get();
}

function hasPruebasManejoTable(d) {
  return !!d.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'crm_pruebas_manejo'`).get();
}

function hasFinanciamientoTable(d) {
  return !!d.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'crm_financiamiento'`).get();
}

function hasCsiPosventaTable(d) {
  return !!d.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'crm_csi_posventa'`).get();
}

function hasCsiVentasTable(d) {
  return !!d.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'crm_csi_ventas'`).get();
}

function normalizeOrdenCsi(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(/\s+/g, '').toUpperCase();
  return s || null;
}

function mapCsiPosventaRow(r) {
  return {
    fuente: 'posventa',
    id: r.id,
    tipo: r.tipo || null,
    orden: r.orden || null,
    fecha: r.fecha || null,
    nombre: r.nombre || null,
    asesor: r.asesor || null,
    tecnico: r.tecnico || null,
    modelo: r.modelo || null,
    serie: r.serie || null,
    recomendacion: r.recomendacion != null ? Number(r.recomendacion) : null,
    incidencia: r.incidencia || null,
    comentarios: r.comentarios || null,
    queja: r.comentarios || r.incidencia || null,
    area: r.area || 'General / Sin clasificar',
  };
}

function mapCsiVentasRow(r) {
  return {
    fuente: 'ventas',
    id: r.id,
    fecha: r.fecha_entrega || null,
    sucursal: r.sucursal || null,
    modelo: r.modelo || null,
    serie: r.serie || null,
    ejecutivo: r.ejecutivo || null,
    cliente: r.cliente || null,
    nps: r.nps != null ? Number(r.nps) : null,
    incidencia: r.incidencia || null,
    comentarios: r.comentarios || null,
    queja: r.comentarios || r.incidencia || null,
    area: r.area || 'General / Sin clasificar',
  };
}

/**
 * Quejas/incidencias CSI vinculadas al cliente:
 * - Posventa: por número de orden (col ORDEN)
 * - Ventas: por serie/VIN (col D)
 */
function getCsiQuejasForContact(d, { ordenes = [], vins = [] } = {}) {
  const posventa = [];
  const ventas = [];

  const ordenSet = [...new Set(
    (ordenes || []).map((o) => normalizeOrdenCsi(typeof o === 'object' ? o.orden : o)).filter(Boolean)
  )];
  const vinSet = [...new Set((vins || []).map(normalizeVin).filter(Boolean))];

  if (hasCsiPosventaTable(d) && ordenSet.length) {
    const placeholders = ordenSet.map(() => '?').join(',');
    const rows = d.prepare(`
      SELECT * FROM crm_csi_posventa
      WHERE orden IN (${placeholders})
      ORDER BY fecha DESC, id DESC
    `).all(...ordenSet);
    posventa.push(...rows.map(mapCsiPosventaRow));
  }

  // Fallback posventa por serie si no hubo match por orden
  if (hasCsiPosventaTable(d) && vinSet.length) {
    const placeholders = vinSet.map(() => '?').join(',');
    const rows = d.prepare(`
      SELECT * FROM crm_csi_posventa
      WHERE serie IN (${placeholders})
      ORDER BY fecha DESC, id DESC
    `).all(...vinSet);
    const seen = new Set(posventa.map((r) => r.id));
    for (const row of rows.map(mapCsiPosventaRow)) {
      if (!seen.has(row.id)) posventa.push(row);
    }
  }

  if (hasCsiVentasTable(d) && vinSet.length) {
    const clauses = ['serie IN (' + vinSet.map(() => '?').join(',') + ')'];
    const params = [...vinSet];
    for (const vin of vinSet) {
      if (vin.length < 17) {
        clauses.push('serie LIKE ?');
        params.push(`%${vin}`);
      }
    }
    const rows = d.prepare(`
      SELECT * FROM crm_csi_ventas
      WHERE ${clauses.join(' OR ')}
      ORDER BY fecha_entrega DESC, id DESC
    `).all(...params);
    const seen = new Set();
    for (const row of rows.map(mapCsiVentasRow)) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      ventas.push(row);
    }
  }

  const todas = [...posventa, ...ventas];
  const porArea = {};
  for (const q of todas) {
    const key = q.area || 'General / Sin clasificar';
    porArea[key] = (porArea[key] || 0) + 1;
  }
  const areaPrincipal = Object.entries(porArea).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  return {
    posventa,
    ventas,
    total: todas.length,
    totalPosventa: posventa.length,
    totalVentas: ventas.length,
    porArea,
    areaPrincipal,
  };
}

function isQuejaIncidencia(incidencia) {
  const s = String(incidencia || '').trim().toLowerCase();
  if (!s) return false;
  return /queja|baja\s*calific|reclamo|inconform/.test(s);
}

function matchesCsiTipoIncidencia(row, tipoIncidencia = 'quejas') {
  const key = String(tipoIncidencia || 'quejas').toLowerCase();
  if (key === 'todas' || key === 'all') return true;
  if (key === 'quejas') return isQuejaIncidencia(row.incidencia);
  const wanted = key.replace(/_/g, ' ');
  return String(row.incidencia || '').trim().toLowerCase() === wanted;
}

function personNameMatches(stored, query) {
  const a = normalizeVendedorKey(stored);
  const b = normalizeVendedorKey(query);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const ta = personTokenKey(stored);
  const tb = personTokenKey(query);
  if (!ta || !tb) return false;
  if (ta === tb) return true;
  const aToks = new Set(ta.split(' '));
  const bToks = tb.split(' ');
  // Match parcial si el query aporta ≥2 tokens y todos están en el nombre
  if (bToks.length >= 2 && bToks.every((t) => aToks.has(t))) return true;
  if (aToks.size >= 2 && [...aToks].every((t) => bToks.includes(t))) return true;
  return false;
}

function loadCsiPosventaRows(d) {
  if (!hasCsiPosventaTable(d)) return [];
  return d.prepare(`
    SELECT * FROM crm_csi_posventa
    ORDER BY fecha DESC, id DESC
  `).all().map(mapCsiPosventaRow);
}

function loadCsiVentasRows(d) {
  if (!hasCsiVentasTable(d)) return [];
  return d.prepare(`
    SELECT * FROM crm_csi_ventas
    ORDER BY fecha_entrega DESC, id DESC
  `).all().map(mapCsiVentasRow);
}

function groupCount(rows, keyFn, limit = 20) {
  const map = new Map();
  for (const row of rows) {
    const label = String(keyFn(row) || 'Sin asignar').trim() || 'Sin asignar';
    const cur = map.get(label) || { label, count: 0 };
    cur.count += 1;
    map.set(label, cur);
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

function summarizeQuejasRows(rows) {
  const porArea = groupCount(rows, (r) => r.area, 20).map((x) => ({
    area: x.label,
    count: x.count,
  }));
  const porIncidencia = groupCount(rows, (r) => r.incidencia || '(sin tipo)', 15).map((x) => ({
    incidencia: x.label,
    count: x.count,
  }));
  return {
    total: rows.length,
    porArea,
    porIncidencia,
    areaPrincipal: porArea[0]?.area || null,
  };
}

/**
 * Ranking y detalle de quejas/incidencias CSI por vendedor (ejecutivo)
 * o asesor de servicio.
 */
function getQuejasCsiSummary({
  persona = null,
  rol = 'auto',
  fuente = 'todas',
  tipoIncidencia = 'quejas',
  periodo = null,
  fechaInicio = null,
  fechaFin = null,
  area = null,
  limit = 25,
  rankingLimit = 15,
} = {}) {
  const d = getDb();
  const range = resolveCrmPeriod({
    periodo,
    desde: fechaInicio || null,
    hasta: fechaFin || null,
  });
  const fi = range.desde;
  const ff = range.hasta;
  const fuenteKey = String(fuente || 'todas').toLowerCase();
  const rolKey = String(rol || 'auto').toLowerCase();
  const areaKey = area ? String(area).trim().toLowerCase() : null;
  const maxDetail = Math.min(50, Math.max(5, Number(limit) || 25));
  const maxRank = Math.min(30, Math.max(5, Number(rankingLimit) || 15));

  const includePos = fuenteKey === 'todas' || fuenteKey === 'posventa' || fuenteKey === 'servicio';
  const includeVen = fuenteKey === 'todas' || fuenteKey === 'ventas';

  let posventa = includePos ? loadCsiPosventaRows(d) : [];
  let ventas = includeVen ? loadCsiVentasRows(d) : [];

  posventa = posventa.filter((r) => matchesCsiTipoIncidencia(r, tipoIncidencia) && inPeriod(r.fecha, fi, ff));
  ventas = ventas.filter((r) => matchesCsiTipoIncidencia(r, tipoIncidencia) && inPeriod(r.fecha, fi, ff));

  if (areaKey) {
    posventa = posventa.filter((r) => String(r.area || '').toLowerCase().includes(areaKey));
    ventas = ventas.filter((r) => String(r.area || '').toLowerCase().includes(areaKey));
  }

  const rankingAsesores = groupCount(posventa, (r) => r.asesor || 'Sin asesor', maxRank)
    .map((x) => ({ asesor: x.label, quejas: x.count, fuente: 'posventa' }));
  const rankingVendedores = groupCount(ventas, (r) => r.ejecutivo || 'Sin ejecutivo', maxRank)
    .map((x) => ({ vendedor: x.label, quejas: x.count, fuente: 'ventas' }));

  const catalogo = {
    asesoresServicio: rankingAsesores.map((r) => r.asesor).filter((n) => n !== 'Sin asesor'),
    vendedores: rankingVendedores.map((r) => r.vendedor).filter((n) => n !== 'Sin ejecutivo'),
  };

  const base = {
    filtros: {
      persona: persona || null,
      rol: rolKey,
      fuente: fuenteKey,
      tipoIncidencia,
      periodo: range.periodo,
      fechaInicio: fi,
      fechaFin: ff,
      area: area || null,
    },
    semantica: {
      posventa: 'CSI Posventa → columna asesor (asesor de servicio / taller).',
      ventas: 'CSI Ventas → columna ejecutivo (vendedor / EV).',
      tipoQuejas: 'Por defecto solo Queja / Baja calificación / reclamo. Usa tipoIncidencia=todas para incluir solicitudes, sugerencias y felicitaciones.',
    },
    totales: {
      total: posventa.length + ventas.length,
      posventa: posventa.length,
      ventas: ventas.length,
    },
    rankingAsesoresServicio: rankingAsesores,
    rankingVendedores: rankingVendedores,
    porArea: summarizeQuejasRows([...posventa, ...ventas]).porArea,
    catalogo,
  };

  const q = String(persona || '').trim();
  if (!q) {
    return {
      ...base,
      modo: 'ranking',
      coincidencias: [],
      detalle: [],
    };
  }

  const wantAsesor = rolKey === 'auto' || rolKey === 'asesor' || rolKey === 'asesor_servicio' || rolKey === 'servicio';
  const wantVendedor = rolKey === 'auto' || rolKey === 'vendedor' || rolKey === 'ejecutivo' || rolKey === 'ev';

  const matchesAsesor = wantAsesor
    ? [...new Set(posventa.map((r) => r.asesor).filter(Boolean))]
      .filter((name) => personNameMatches(name, q))
    : [];
  const matchesVendedor = wantVendedor
    ? [...new Set(ventas.map((r) => r.ejecutivo).filter(Boolean))]
      .filter((name) => personNameMatches(name, q))
    : [];

  const coincidencias = [
    ...matchesAsesor.map((nombre) => ({ nombre, rol: 'asesor_servicio', fuente: 'posventa' })),
    ...matchesVendedor.map((nombre) => ({ nombre, rol: 'vendedor', fuente: 'ventas' })),
  ];

  if (!coincidencias.length) {
    return {
      ...base,
      modo: 'persona',
      encontrado: false,
      coincidencias: [],
      detalle: [],
      sugerencia: 'No hubo coincidencia exacta. Revisa rankingAsesoresServicio / rankingVendedores o acota el nombre.',
    };
  }

  const asesorSet = new Set(matchesAsesor.map((n) => normalizeVendedorKey(n)));
  const vendedorSet = new Set(matchesVendedor.map((n) => normalizeVendedorKey(n)));

  const posFiltrado = posventa.filter((r) => asesorSet.has(normalizeVendedorKey(r.asesor)));
  const venFiltrado = ventas.filter((r) => vendedorSet.has(normalizeVendedorKey(r.ejecutivo)));
  const todas = [...posFiltrado, ...venFiltrado]
    .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));

  const resumenPersona = summarizeQuejasRows(todas);
  const porPersona = coincidencias.map((c) => {
    const rows = c.rol === 'asesor_servicio'
      ? posFiltrado.filter((r) => normalizeVendedorKey(r.asesor) === normalizeVendedorKey(c.nombre))
      : venFiltrado.filter((r) => normalizeVendedorKey(r.ejecutivo) === normalizeVendedorKey(c.nombre));
    return {
      ...c,
      quejas: rows.length,
      porArea: summarizeQuejasRows(rows).porArea.slice(0, 6),
    };
  }).sort((a, b) => b.quejas - a.quejas);

  return {
    ...base,
    modo: 'persona',
    encontrado: true,
    coincidencias,
    porPersona,
    totalesPersona: {
      total: todas.length,
      posventa: posFiltrado.length,
      ventas: venFiltrado.length,
      ...resumenPersona,
    },
    detalle: todas.slice(0, maxDetail).map((r) => ({
      fuente: r.fuente,
      fecha: r.fecha,
      persona: r.asesor || r.ejecutivo || null,
      rol: r.fuente === 'posventa' ? 'asesor_servicio' : 'vendedor',
      cliente: r.nombre || r.cliente || null,
      orden: r.orden || null,
      serie: r.serie || null,
      modelo: r.modelo || null,
      incidencia: r.incidencia || null,
      area: r.area || null,
      comentario: (r.comentarios || r.queja || '').slice(0, 220),
      nps: r.nps ?? r.recomendacion ?? null,
    })),
  };
}

function getQuejasCsiForPersona(persona, opts = {}) {
  return getQuejasCsiSummary({ ...opts, persona });
}

function cleanSeguroValor(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const upper = text.toUpperCase();
  if (upper === 'N/A' || upper === 'NA' || upper === 'NULL' || upper === '-' || upper === '—') return null;
  return text;
}

/**
 * Seguro del auto (Historico de contratos):
 * - Col AE = seguro_gratis (vigencia 12 meses)
 * - Col AF = seguro_subsecuente
 * Regla: sin AE → AF; con AE y compra > 1 año → AF; con AE y ≤ 1 año → AE.
 */
function resolveAseguradoraContrato(row, contratoMayorUnAnio) {
  const seguroGratis = cleanSeguroValor(row.seguro_gratis);
  const seguroSubsecuente = cleanSeguroValor(row.seguro_subsecuente);

  if (contratoMayorUnAnio) {
    return { aseguradora: seguroSubsecuente || null };
  }
  if (seguroGratis) {
    return { aseguradora: seguroGratis };
  }
  return { aseguradora: seguroSubsecuente || null };
}

function getFinanciamientoByVins(d, vins) {
  if (!hasFinanciamientoTable(d)) return [];
  const normalized = [...new Set((vins || []).map(normalizeVin).filter(Boolean))];
  if (!normalized.length) return [];

  const clauses = ['vin IN (' + normalized.map(() => '?').join(',') + ')'];
  const params = [...normalized];
  for (const vin of normalized) {
    if (vin.length < 17) {
      clauses.push('vin LIKE ?');
      params.push(`%${vin}`);
    }
  }
  const rows = d.prepare(`
    SELECT * FROM crm_financiamiento
    WHERE ${clauses.join(' OR ')}
    ORDER BY COALESCE(fecha_compra, fecha_timbrado, fecha) DESC
  `).all(...params);

  const seen = new Set();
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const mapped = rows
    .filter((row) => {
      if (!normalized.some((vin) => matchCrmVinToSerie(vin, row.vin))) return false;
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    })
    .map((row) => {
      const fechaCompraValida = validHistoricalDate(row.fecha_compra, row.fecha_timbrado, row.fecha);
      const purchaseDate = fechaCompraValida ? new Date(`${fechaCompraValida}T00:00:00`) : null;
      const contratoMayorUnAnio = purchaseDate && !Number.isNaN(purchaseDate.getTime())
        ? purchaseDate < oneYearAgo
        : false;
      const resolved = resolveAseguradoraContrato(row, contratoMayorUnAnio);
      const pvas = [
        { tipo: 'GAP', monto: Number(row.gap_monto || 0) },
        { tipo: 'Garantía extendida', monto: Number(row.garantia_extendida_monto || 0) },
        { tipo: 'Accesorios', monto: Number(row.accesorios_monto || 0) },
        { tipo: 'OnStar', monto: Number(row.onstar_monto || 0), plazo: row.plazo_onstar || null },
        { tipo: 'Mantenimientos integrados', monto: Number(row.mantenimiento_integrado_monto || 0) },
      ].filter((item) => item.monto > 0);
      return {
        ...row,
        fecha_compra_valida: fechaCompraValida,
        aseguradora: resolved.aseguradora,
        contratoMayorUnAnio,
        pvas,
      };
    });

  try {
    const { getPagosGmfByVins } = require('./pagosGmfService');
    const pagosByVin = getPagosGmfByVins(mapped.map((r) => r.vin));
    for (const row of mapped) {
      const vinKey = normalizeVin(row.vin);
      row.pagos_gmf = vinKey ? (pagosByVin.get(vinKey) || []) : [];
    }
  } catch {
    for (const row of mapped) row.pagos_gmf = [];
  }

  return mapped;
}

function toIsoDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return text || null;
}

function inDateRange(isoDate, fechaInicio, fechaFin) {
  if (!fechaInicio && !fechaFin) return true;
  const d = toIsoDate(isoDate);
  if (!d) return false;
  if (fechaInicio && d < fechaInicio) return false;
  if (fechaFin && d > fechaFin) return false;
  return true;
}

function previousPeriodRange(fechaInicio, fechaFin) {
  if (!fechaInicio || !fechaFin) return null;
  const start = new Date(`${fechaInicio}T00:00:00`);
  const end = new Date(`${fechaFin}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null;
  const days = Math.round((end - start) / 86400000) + 1;
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - days + 1);
  return {
    fechaInicio: toIsoDate(prevStart),
    fechaFin: toIsoDate(prevEnd),
  };
}

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function isHypOrden(orden) {
  const letter = firstLetter(orden?.orden || orden);
  return HYP_LETRAS.has(letter);
}

/**
 * CLV del cliente (ficha 360): valor económico disponible sin restar CAC.
 * Componentes: utilidad venta, F&I (comisiones/PVAs), accesorios, servicio,
 * refacciones (si no hay split, 0), colisión (HyP), renovación (2ª+ unidad).
 */
function buildClienteClv({
  contratos = [],
  ordenes = [],
  unidadesSql = [],
  fechaInicio = null,
  fechaFin = null,
  clvAnterior = null,
} = {}) {
  const composicion = {
    ventaVehiculo: 0,
    financiamiento: 0,
    seguros: 0,
    accesorios: 0,
    servicio: 0,
    refacciones: 0,
    colision: 0,
    renovacion: 0,
  };

  const ventas = [];
  const facturasVistas = new Set();
  for (const u of unidadesSql || []) {
    for (const f of u.facturasVentaSql || []) {
      if (!inDateRange(f.fechaFactura, fechaInicio, fechaFin)) continue;
      const facturaKey = String(f.facturaVenta || '').trim().toUpperCase()
        || `${normalizeVin(f.serie || u.vin)}|${toIsoDate(f.fechaFactura)}`;
      if (facturasVistas.has(facturaKey)) continue;
      facturasVistas.add(facturaKey);
      const utilidad = f.utilidad != null ? Number(f.utilidad) : null;
      const aporte = utilidad != null ? utilidad : 0;
      composicion.ventaVehiculo += aporte;
      ventas.push({
        serie: f.serie || u.vin,
        factura: f.facturaVenta,
        fecha: toIsoDate(f.fechaFactura),
        utilidad: aporte,
        ventaSubtotal: Number(f.ventaSubtotal || 0),
      });
    }
  }
  ventas.sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')));
  if (ventas.length > 1) {
    const renovacion = ventas.slice(1).reduce((s, v) => s + Number(v.utilidad || 0), 0);
    composicion.renovacion += renovacion;
    composicion.ventaVehiculo = Math.max(0, composicion.ventaVehiculo - renovacion);
  }

  for (const c of contratos || []) {
    const fecha = c.fecha_compra_valida || c.fecha_compra || c.fecha_timbrado || c.fecha;
    if (!inDateRange(fecha, fechaInicio, fechaFin)) continue;
    const comision = Number(c.comision || 0);
    const gap = Number(c.gap_monto || 0);
    const garantia = Number(c.garantia_extendida_monto || 0);
    const onstar = Number(c.onstar_monto || 0);
    const mantto = Number(c.mantenimiento_integrado_monto || 0);
    const accesorios = Number(c.accesorios_monto || 0);
    composicion.financiamiento += comision + gap + garantia + onstar + mantto;
    composicion.accesorios += accesorios;
    // Sin prima de seguro en CRM: se deja en 0 (solo nombre de aseguradora).
  }

  for (const o of ordenes || []) {
    if (String(o.status || '').toUpperCase() === 'C') continue;
    const fecha = o.ingreso || o.cierre;
    if (!inDateRange(fecha, fechaInicio, fechaFin)) continue;
    const importe = Number(o.importe || 0);
    if (importe <= 0) continue;
    if (isHypOrden(o)) composicion.colision += importe;
    else composicion.servicio += importe;
  }

  Object.keys(composicion).forEach((k) => {
    composicion[k] = roundMoney(composicion[k]);
  });

  const clv = roundMoney(Object.values(composicion).reduce((s, n) => s + n, 0));

  let segmento = 'bajo';
  let segmentoLabel = 'Bajo valor';
  const ultimaOrden = (ordenes || [])
    .map((o) => toIsoDate(o.ingreso || o.cierre))
    .filter(Boolean)
    .sort()
    .pop();
  const hoy = toIsoDate(new Date());
  const diasSinVisita = ultimaOrden && hoy
    ? Math.round((new Date(`${hoy}T00:00:00`) - new Date(`${ultimaOrden}T00:00:00`)) / 86400000)
    : null;
  if (diasSinVisita != null && diasSinVisita > 365 && clv < 40000) {
    segmento = 'riesgo';
    segmentoLabel = 'En riesgo';
  } else if (clv >= 100000) {
    segmento = 'alto';
    segmentoLabel = 'Alto valor';
  } else if (clv >= 40000) {
    segmento = 'medio';
    segmentoLabel = 'Valor medio';
  } else if (clv > 0) {
    segmento = 'bajo';
    segmentoLabel = 'Bajo valor';
  } else {
    segmento = 'riesgo';
    segmentoLabel = 'En riesgo';
  }

  let variacionPct = null;
  if (clvAnterior && Number.isFinite(Number(clvAnterior.clv))) {
    const prev = Number(clvAnterior.clv);
    if (prev > 0) variacionPct = Math.round(((clv - prev) / prev) * 1000) / 10;
    else if (clv > 0) variacionPct = 100;
    else variacionPct = 0;
  }

  const chart = [
    { id: 'ventaVehiculo', label: 'Venta vehículo', value: composicion.ventaVehiculo },
    { id: 'financiamiento', label: 'Financiamiento', value: composicion.financiamiento },
    { id: 'servicio', label: 'Servicio', value: composicion.servicio },
    { id: 'refacciones', label: 'Refacciones', value: composicion.refacciones },
    { id: 'colision', label: 'Centro de Colisión', value: composicion.colision },
    { id: 'renovacion', label: 'Renovación', value: composicion.renovacion },
  ];

  return {
    clv,
    clientesAnalizados: 1,
    clvTotal: clv,
    variacionPct,
    composicion: {
      ...composicion,
      seguros: composicion.seguros,
    },
    chart,
    segmento,
    segmentoLabel,
    segmentacion: [
      { id: 'alto', label: 'Alto valor', activo: segmento === 'alto' },
      { id: 'medio', label: 'Valor medio', activo: segmento === 'medio' },
      { id: 'bajo', label: 'Bajo valor', activo: segmento === 'bajo' },
      { id: 'riesgo', label: 'En riesgo', activo: segmento === 'riesgo' },
    ],
    periodo: { fechaInicio, fechaFin },
    nota: 'CLV ≈ valor generado disponible (sin CAC). Financiamiento usa comisiones/PVAs, no el monto a financiar.',
  };
}

async function attachClvToHistory(payload, {
  contratos,
  ordenes,
  unidadesSql,
  fechaInicio,
  fechaFin,
  vinsForPrev = [],
} = {}) {
  let clvAnterior = null;
  const prev = previousPeriodRange(fechaInicio, fechaFin);
  if (prev && vinsForPrev.length) {
    try {
      const prevEnrich = await enrichByVins(vinsForPrev, {
        fechaInicio: prev.fechaInicio,
        fechaFin: prev.fechaFin,
      });
      clvAnterior = buildClienteClv({
        contratos,
        ordenes: prevEnrich.ordenesServicio || [],
        unidadesSql: prevEnrich.unidades || unidadesSql,
        fechaInicio: prev.fechaInicio,
        fechaFin: prev.fechaFin,
      });
    } catch (_) {
      clvAnterior = null;
    }
  }

  const clv = buildClienteClv({
    contratos,
    ordenes,
    unidadesSql,
    fechaInicio,
    fechaFin,
    clvAnterior,
  });

  payload.clv = clv;
  payload.resumen = {
    ...(payload.resumen || {}),
    clv: clv.clv,
    clvVariacionPct: clv.variacionPct,
    clvSegmento: clv.segmentoLabel,
  };
  return payload;
}


function validHistoricalDate(...values) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  for (const value of values) {
    const iso = toIsoDate(value);
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
    const date = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(date.getTime()) || date.getFullYear() < 2000 || date > tomorrow) continue;
    return iso;
  }
  return null;
}

function getUltimaActividadByIds(ids) {
  const list = [...new Set((ids || []).map(String).filter(Boolean))];
  if (!list.length) return new Map();
  const d = getDb();
  const placeholders = list.map(() => '?').join(',');
  const unions = [`
    SELECT id_contacto AS id_crm,
      MAX(COALESCE(fecha_resp_actividad, fecha_prog_actividad, fecha_crea_actividad, fecha_estatus, fecha_inicio_ciclo)) AS fecha
    FROM crm_actividades
    WHERE id_contacto IN (${placeholders})
    GROUP BY id_contacto
  `];
  const params = [...list];
  if (hasLeadsTable(d)) {
    unions.push(`
      SELECT id_crm, MAX(fecha_entrada) AS fecha
      FROM crm_leads
      WHERE id_crm IN (${placeholders})
      GROUP BY id_crm
    `);
    params.push(...list);
  }
  if (hasSolicitudesTable(d)) {
    unions.push(`
      SELECT id_crm,
        MAX(COALESCE(fecha_compra, fecha_firma, fecha_aprobacion, fecha_solicitud)) AS fecha
      FROM crm_solicitudes
      WHERE id_crm IN (${placeholders})
      GROUP BY id_crm
    `);
    params.push(...list);
  }
  const rows = d.prepare(`
    SELECT id_crm, MAX(fecha) AS ultima_actividad
    FROM (${unions.join(' UNION ALL ')})
    GROUP BY id_crm
  `).all(...params);
  return new Map(rows.map((r) => [String(r.id_crm), r.ultima_actividad]));
}

/** Valor no vacío del registro más reciente de una lista ordenada cronológicamente. */
function ultimoDato(lista, campo) {
  for (let i = (lista || []).length - 1; i >= 0; i -= 1) {
    const v = lista[i]?.[campo];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

/**
 * Perfil de calidad de datos por ID CRM: unidades compradas (VIN en ciclos),
 * actividades, ciclos y si hay teléfono/correo en alguna fuente.
 * Se usa para priorizar en el inicio de Seguimiento 360 los clientes cuyo
 * expediente se verá completo.
 */
function getPerfilCalidadByIds(ids) {
  const list = [...new Set((ids || []).map(String).filter(Boolean))];
  const result = new Map();
  if (!list.length) return result;
  const d = getDb();
  const placeholders = list.map(() => '?').join(',');

  const base = d.prepare(`
    SELECT id_contacto AS id_crm,
      COUNT(*) AS actividades,
      COUNT(DISTINCT id_ciclo) AS ciclos,
      COUNT(DISTINCT CASE WHEN vin IS NOT NULL AND TRIM(vin) <> '' THEN UPPER(TRIM(vin)) END) AS compras,
      MAX(CASE WHEN num_factura IS NOT NULL AND TRIM(num_factura) <> '' THEN 1 ELSE 0 END) AS tiene_factura,
      MAX(CASE WHEN vendedor IS NOT NULL AND TRIM(vendedor) <> '' THEN 1 ELSE 0 END) AS tiene_vendedor,
      MAX(nombre_contacto) AS nombre_crm
    FROM crm_actividades
    WHERE id_contacto IN (${placeholders})
    GROUP BY id_contacto
  `).all(...list);
  for (const r of base) {
    result.set(String(r.id_crm), {
      nombreCrm: r.nombre_crm || null,
      compras: Number(r.compras || 0),
      actividades: Number(r.actividades || 0),
      ciclos: Number(r.ciclos || 0),
      tieneFactura: Number(r.tiene_factura || 0) === 1,
      tieneVendedor: Number(r.tiene_vendedor || 0) === 1,
      tieneTelefono: false,
      tieneCorreo: false,
    });
  }
  const ensure = (id) => {
    const key = String(id);
    if (!result.has(key)) {
      result.set(key, {
        nombreCrm: null, compras: 0, actividades: 0, ciclos: 0, tieneFactura: false, tieneVendedor: false,
        tieneTelefono: false, tieneCorreo: false,
      });
    }
    return result.get(key);
  };
  if (hasLeadsTable(d)) {
    const rows = d.prepare(`
      SELECT id_crm,
        MAX(CASE WHEN telefono IS NOT NULL AND TRIM(telefono) <> '' THEN 1 ELSE 0 END) AS tel,
        MAX(CASE WHEN correo IS NOT NULL AND TRIM(correo) <> '' THEN 1 ELSE 0 END) AS correo
      FROM crm_leads
      WHERE id_crm IN (${placeholders})
      GROUP BY id_crm
    `).all(...list);
    for (const r of rows) {
      const p = ensure(r.id_crm);
      if (Number(r.tel) === 1) p.tieneTelefono = true;
      if (Number(r.correo) === 1) p.tieneCorreo = true;
    }
  }
  if (hasPruebasManejoTable(d)) {
    const rows = d.prepare(`
      SELECT id_crm,
        MAX(CASE WHEN telefono IS NOT NULL AND TRIM(telefono) <> '' THEN 1 ELSE 0 END) AS tel,
        MAX(CASE WHEN correo IS NOT NULL AND TRIM(correo) <> '' THEN 1 ELSE 0 END) AS correo
      FROM crm_pruebas_manejo
      WHERE id_crm IN (${placeholders})
      GROUP BY id_crm
    `).all(...list);
    for (const r of rows) {
      const p = ensure(r.id_crm);
      if (Number(r.tel) === 1) p.tieneTelefono = true;
      if (Number(r.correo) === 1) p.tieneCorreo = true;
    }
  }
  return result;
}

/**
 * Puntaje 0–100 de qué tan completo se verá el 360 de un cliente del inicio.
 * Pesa sobre todo tener unidades compradas en CRM y datos de contacto.
 */
function scoreCalidadCliente(perfil, { telefonoDms = null, nombre = null, nombreCoincide = true } = {}) {
  if (!perfil) return 0;
  let score = 0;
  if (perfil.compras > 0) score += 40;
  if (perfil.compras > 1) score += 5;
  if (perfil.tieneFactura) score += 10;
  if (perfil.tieneTelefono) score += 15;
  else if (telefonoDms) score += 5;
  if (perfil.tieneCorreo) score += 5;
  if (perfil.actividades >= 5) score += 10;
  else if (perfil.actividades > 0) score += 5;
  if (perfil.tieneVendedor) score += 5;
  if (nombre && String(nombre).trim() && String(nombre).trim() !== '(Sin nombre)') score += 5;
  if (nombreCoincide) score += 5;
  else score -= 30;
  return Math.max(0, Math.min(100, score));
}

/**
 * ¿El nombre del cliente en el DMS corresponde al contacto del CRM?
 * Si la serie cambió de dueño, el ID CRM apunta a otra persona y el 360
 * mostraría datos de alguien más: no debe ofrecerse como ejemplo.
 */
function nombresCoinciden(nombreDms, nombreCrm) {
  if (!nombreDms || !nombreCrm) return false;
  if (isSamePersonName(nombreDms, nombreCrm)) return true;
  const ignorar = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'SA', 'CV', 'S', 'A', 'C', 'V', 'RL']);
  const ta = personTokens(nombreDms).filter((t) => t.length > 2 && !ignorar.has(t));
  const tb = new Set(personTokens(nombreCrm).filter((t) => t.length > 2 && !ignorar.has(t)));
  const comunes = ta.filter((t) => tb.has(t)).length;
  return comunes >= 2 || (comunes >= 1 && Math.min(ta.length, tb.size) === 1);
}

function getCrmStats() {
  if (crmStatsCache) return crmStatsCache;
  const stats = computeCrmStats();
  crmStatsCache = stats;
  return stats;
}

// Conteos sobre toda la base (COUNT DISTINCT en ~1M filas). Solo cambian cuando
// corre un ETL, así que se calculan una vez por conexión y se sirven de caché.
function computeCrmStats() {
  const d = getDb();
  const stats = {
    actividades: d.prepare('SELECT COUNT(*) AS n FROM crm_actividades').get().n,
    contactos: d.prepare('SELECT COUNT(DISTINCT id_contacto) AS n FROM crm_actividades').get().n,
    ciclos: d.prepare('SELECT COUNT(DISTINCT id_ciclo) AS n FROM crm_actividades').get().n,
    // Compra en ciclo = VIN asignado (col T), no solo presencia de num_factura
    comprasConVin: d.prepare(`
      SELECT COUNT(DISTINCT upper(trim(vin))) AS n
      FROM crm_actividades
      WHERE vin IS NOT NULL AND trim(vin) <> ''
    `).get().n,
    ventasFacturadas: d.prepare('SELECT COUNT(DISTINCT num_factura) AS n FROM crm_actividades WHERE num_factura IS NOT NULL').get().n,
    rangoFechas: d.prepare(`
      SELECT MIN(fecha_inicio_ciclo) AS desde, MAX(fecha_inicio_ciclo) AS hasta
      FROM crm_actividades WHERE fecha_inicio_ciclo IS NOT NULL
    `).get(),
  };
  if (hasLeadsTable(d)) {
    stats.leads = {
      total: d.prepare('SELECT COUNT(*) AS n FROM crm_leads').get().n,
      conIdCrm: d.prepare('SELECT COUNT(*) AS n FROM crm_leads WHERE id_crm IS NOT NULL').get().n,
      rangoFechas: d.prepare(`
        SELECT MIN(fecha_entrada) AS desde, MAX(fecha_entrada) AS hasta
        FROM crm_leads WHERE fecha_entrada IS NOT NULL
      `).get(),
    };
  }
  if (hasSolicitudesTable(d)) {
    stats.solicitudes = {
      total: d.prepare('SELECT COUNT(*) AS n FROM crm_solicitudes').get().n,
      conIdCrm: d.prepare('SELECT COUNT(*) AS n FROM crm_solicitudes WHERE id_crm IS NOT NULL').get().n,
      aprobadas: d.prepare(`SELECT COUNT(*) AS n FROM crm_solicitudes WHERE upper(estatus) LIKE 'APROBADA%'`).get().n,
      rangoFechas: d.prepare(`
        SELECT MIN(fecha_solicitud) AS desde, MAX(fecha_solicitud) AS hasta
        FROM crm_solicitudes WHERE fecha_solicitud IS NOT NULL
      `).get(),
    };
  }
  if (hasPruebasManejoTable(d)) {
    stats.pruebasManejo = {
      total: d.prepare('SELECT COUNT(*) AS n FROM crm_pruebas_manejo').get().n,
      conIdCrm: d.prepare('SELECT COUNT(*) AS n FROM crm_pruebas_manejo WHERE id_crm IS NOT NULL').get().n,
      rangoFechas: d.prepare(`
        SELECT MIN(fecha) AS desde, MAX(fecha) AS hasta
        FROM crm_pruebas_manejo WHERE fecha IS NOT NULL
      `).get(),
    };
  }
  if (hasFinanciamientoTable(d)) {
    stats.financiamiento = {
      total: d.prepare('SELECT COUNT(*) AS n FROM crm_financiamiento').get().n,
      vins: d.prepare('SELECT COUNT(DISTINCT vin) AS n FROM crm_financiamiento').get().n,
      rangoFechas: d.prepare(`
        SELECT MIN(fecha_compra) AS desde, MAX(fecha_compra) AS hasta
        FROM crm_financiamiento WHERE fecha_compra IS NOT NULL
      `).get(),
    };
  }
  return stats;
}

/**
 * Buscar contactos por ID CRM exacto, nombre parcial, VIN, teléfono o correo.
 * Busca tanto en actividades (ciclos) como en leads y consolida por ID CRM.
 */
function searchContacts({ q = '', limit = 25 } = {}) {
  const d = getDb();
  const term = String(q || '').trim();
  if (!term) return [];
  const max = Math.min(100, Math.max(1, Number(limit) || 25));

  const base = `
    SELECT
      id_contacto,
      MAX(nombre_contacto) AS nombre,
      COUNT(DISTINCT id_ciclo) AS ciclos,
      COUNT(*) AS actividades,
      COUNT(DISTINCT CASE
        WHEN vin IS NOT NULL AND trim(vin) <> '' THEN upper(trim(vin))
      END) AS compras,
      MIN(fecha_inicio_ciclo) AS primera_actividad,
      MAX(COALESCE(fecha_resp_actividad, fecha_prog_actividad, fecha_estatus, fecha_inicio_ciclo)) AS ultima_actividad
    FROM crm_actividades
  `;

  let results = [];
  const isNumeric = /^\d+$/.test(term);

  if (isNumeric) {
    results = d.prepare(`${base} WHERE id_contacto = ? GROUP BY id_contacto LIMIT ?`).all(term, max);
  } else if (/^[A-Za-z0-9]{8,17}$/.test(term) && /\d/.test(term)) {
    results = d.prepare(`${base} WHERE vin LIKE ? GROUP BY id_contacto LIMIT ?`).all(`%${term.toUpperCase()}%`, max);
  }
  if (!results.length && !isNumeric) {
    results = d.prepare(`${base} WHERE nombre_contacto LIKE ? GROUP BY id_contacto ORDER BY actividades DESC LIMIT ?`)
      .all(`%${term.toUpperCase()}%`, max);
  }

  // Buscar también en leads: por ID CRM (numérico o teléfono), nombre o correo
  let leadRows = [];
  if (hasLeadsTable(d)) {
    const leadBase = `
      SELECT
        id_crm,
        MAX(nombre) AS nombre,
        COUNT(*) AS leads,
        MAX(telefono) AS telefono,
        MAX(correo) AS correo,
        MAX(auto_interes) AS ultimo_auto_interes,
        MIN(fecha_entrada) AS primer_lead,
        MAX(fecha_entrada) AS ultimo_lead
      FROM crm_leads
    `;
    if (isNumeric) {
      leadRows = d.prepare(`
        ${leadBase} WHERE id_crm = ? OR telefono LIKE ? GROUP BY id_crm LIMIT ?
      `).all(term, `%${term}%`, max);
    } else if (term.includes('@')) {
      leadRows = d.prepare(`${leadBase} WHERE correo LIKE ? GROUP BY id_crm LIMIT ?`).all(`%${term.toLowerCase()}%`, max);
    } else {
      leadRows = d.prepare(`${leadBase} WHERE nombre LIKE ? GROUP BY id_crm ORDER BY leads DESC LIMIT ?`)
        .all(`%${term.toUpperCase()}%`, max);
    }
  }

  // Consolidar por ID CRM
  const byId = new Map(results.map((r) => [String(r.id_contacto), { ...r, leads: 0 }]));
  for (const l of leadRows) {
    const key = l.id_crm != null ? String(l.id_crm) : `lead:${l.nombre}|${l.telefono}`;
    if (byId.has(key)) {
      const r = byId.get(key);
      r.leads = l.leads;
      r.telefono = l.telefono;
      r.correo = l.correo;
      r.ultimo_auto_interes = l.ultimo_auto_interes;
    } else {
      byId.set(key, {
        id_contacto: l.id_crm,
        nombre: l.nombre,
        ciclos: 0,
        actividades: 0,
        compras: 0,
        leads: l.leads,
        telefono: l.telefono,
        correo: l.correo,
        ultimo_auto_interes: l.ultimo_auto_interes,
        primera_actividad: l.primer_lead,
        ultima_actividad: l.ultimo_lead,
        soloLead: true,
      });
    }
  }

  // Buscar también en solicitudes de crédito (F&I): por ID CRM o nombre
  if (hasSolicitudesTable(d)) {
    const solBase = `
      SELECT
        id_crm,
        MAX(nombre_cliente) AS nombre,
        COUNT(*) AS solicitudes,
        MIN(fecha_solicitud) AS primera_solicitud,
        MAX(fecha_solicitud) AS ultima_solicitud
      FROM crm_solicitudes
      WHERE id_crm IS NOT NULL
    `;
    let solRows = [];
    if (isNumeric) {
      solRows = d.prepare(`${solBase} AND id_crm = ? GROUP BY id_crm LIMIT ?`).all(term, max);
    } else if (!term.includes('@')) {
      solRows = d.prepare(`${solBase} AND nombre_cliente LIKE ? GROUP BY id_crm ORDER BY solicitudes DESC LIMIT ?`)
        .all(`%${term.toUpperCase()}%`, max);
    }
    for (const s of solRows) {
      const key = String(s.id_crm);
      if (byId.has(key)) {
        byId.get(key).solicitudes = s.solicitudes;
      } else {
        byId.set(key, {
          id_contacto: s.id_crm,
          nombre: s.nombre,
          ciclos: 0,
          actividades: 0,
          compras: 0,
          leads: 0,
          solicitudes: s.solicitudes,
          primera_actividad: s.primera_solicitud,
          ultima_actividad: s.ultima_solicitud,
          soloSolicitud: true,
        });
      }
    }
  }

  if (hasPruebasManejoTable(d)) {
    const pruebaBase = `
      SELECT id_crm, MAX(nombre_cliente) AS nombre, COUNT(*) AS pruebas_manejo,
             MAX(telefono) AS telefono, MAX(correo) AS correo,
             MAX(auto_interes) AS auto_interes,
             MIN(fecha) AS primera_prueba, MAX(fecha) AS ultima_prueba
      FROM crm_pruebas_manejo
      WHERE id_crm IS NOT NULL
    `;
    let pruebaRows = [];
    if (isNumeric) {
      pruebaRows = d.prepare(`
        ${pruebaBase} AND (id_crm = ? OR telefono LIKE ?) GROUP BY id_crm LIMIT ?
      `).all(term, `%${term}%`, max);
    } else if (term.includes('@')) {
      pruebaRows = d.prepare(`
        ${pruebaBase} AND correo LIKE ? GROUP BY id_crm LIMIT ?
      `).all(`%${term.toLowerCase()}%`, max);
    } else {
      pruebaRows = d.prepare(`
        ${pruebaBase} AND (nombre_cliente LIKE ? OR vin LIKE ?)
        GROUP BY id_crm ORDER BY pruebas_manejo DESC LIMIT ?
      `).all(`%${term.toUpperCase()}%`, `%${term.toUpperCase()}%`, max);
    }
    for (const p of pruebaRows) {
      const key = String(p.id_crm);
      if (byId.has(key)) {
        const current = byId.get(key);
        current.pruebas_manejo = p.pruebas_manejo;
        if (!current.telefono) current.telefono = p.telefono;
        if (!current.correo) current.correo = p.correo;
      } else {
        byId.set(key, {
          id_contacto: p.id_crm, nombre: p.nombre, ciclos: 0, actividades: 0,
          compras: 0, leads: 0, solicitudes: 0, pruebas_manejo: p.pruebas_manejo,
          telefono: p.telefono, correo: p.correo, ultimo_auto_interes: p.auto_interes,
          primera_actividad: p.primera_prueba, ultima_actividad: p.ultima_prueba,
          soloPruebaManejo: true,
        });
      }
    }
  }

  // Financiamiento: búsqueda por VIN o cliente y cruce a ID CRM por VIN
  if (hasFinanciamientoTable(d) && !isNumeric) {
    const finRows = d.prepare(`
      SELECT vin, MAX(cliente) AS cliente, COUNT(*) AS contratos,
             MAX(unidad) AS unidad, MAX(fecha_compra) AS ultima_compra
      FROM crm_financiamiento
      WHERE vin LIKE ? OR cliente LIKE ?
      GROUP BY vin
      ORDER BY ultima_compra DESC
      LIMIT ?
    `).all(`%${term.toUpperCase()}%`, `%${term.toUpperCase()}%`, max);

    for (const fin of finRows) {
      const linked = d.prepare(`
        SELECT id_contacto AS id_crm, MAX(nombre_contacto) AS nombre
        FROM crm_actividades
        WHERE vin LIKE ?
        GROUP BY id_contacto
        LIMIT 1
      `).get(`%${fin.vin}%`) || (hasLeadsTable(d)
        ? d.prepare(`
            SELECT id_crm, MAX(nombre) AS nombre
            FROM crm_leads
            WHERE vin_comprado LIKE ? AND id_crm IS NOT NULL
            GROUP BY id_crm
            LIMIT 1
          `).get(`%${fin.vin}%`)
        : null);

      if (linked?.id_crm) {
        const key = String(linked.id_crm);
        if (byId.has(key)) {
          byId.get(key).contratos_financiamiento = fin.contratos;
          byId.get(key).ultimo_auto_interes = byId.get(key).ultimo_auto_interes || fin.unidad;
        } else {
          byId.set(key, {
            id_contacto: linked.id_crm,
            nombre: linked.nombre || fin.cliente,
            ciclos: 0,
            actividades: 0,
            compras: 1,
            leads: 0,
            solicitudes: 0,
            contratos_financiamiento: fin.contratos,
            ultimo_auto_interes: fin.unidad,
            primera_actividad: fin.ultima_compra,
            ultima_actividad: fin.ultima_compra,
            soloFinanciamiento: true,
          });
        }
      }
    }
  }

  return [...byId.values()].slice(0, max);
}

function matchCrmVinToSerie(crmVin, serieSql) {
  const a = normalizeVin(crmVin);
  const b = normalizeVin(serieSql);
  if (!a || !b) return false;
  if (a === b || b.endsWith(a) || a.endsWith(b)) return true;
  // ADE_VTAFI a veces guarda serie con prefijo de inventario: "-014833-9ML137199"
  const minLen = 8;
  return a.length >= minLen && b.length >= minLen && a.slice(-minLen) === b.slice(-minLen);
}

/** Sufijo estable para buscar series con prefijo de inventario en SQL. */
function vinSearchSuffix(vin, len = 8) {
  const s = normalizeVin(vin);
  if (!s || s.length < len) return null;
  return s.slice(-len);
}

/**
 * Enriquecer VINs del CRM con factura de venta (ADE_VTAFI) y órdenes (SER_ORDEN).
 * VIN CRM = serie DMS. El CRM a veces trae VIN corto (últimos dígitos);
 * SQL suele tener el VIN/serie completo → se casa exacto o por sufijo.
 */
async function enrichByVins(vins, {
  maxOrdenes = 500,
  fechaInicio = null,
  fechaFin = null,
} = {}) {
  const list = [...new Set((vins || []).map(normalizeVin).filter(Boolean))].slice(0, 20);
  if (!list.length) {
    return { unidades: [], ordenesServicio: [], error: null };
  }

  const cacheKey = JSON.stringify([list, maxOrdenes, fechaInicio, fechaFin]);
  const cached = await ttlCache('enrichByVins', cacheKey, ENRICH_TTL_MS, () => enrichByVinsUncached(list, { maxOrdenes, fechaInicio, fechaFin }));
  if (cached.error) ttlCacheDelete('enrichByVins', cacheKey);
  return cached;
}

const ENRICH_TTL_MS = 5 * 60 * 1000;
const CIERRES_TTL_MS = 3 * 60 * 1000;

function ttlCacheDelete(name, key) {
  const bucket = ttlCaches.get(name);
  if (bucket) bucket.delete(key);
}

/**
 * Dos pasadas contra el DMS:
 *  1) igualdad directa sobre la columna (usa el índice: ~200 ms);
 *  2) sólo para las series sin resultado, el barrido tolerante con
 *     UPPER/LTRIM/RTRIM + LIKE por sufijo (recorre la tabla: varios segundos).
 * Antes siempre se hacía el barrido, aunque la serie estuviera limpia en el DMS.
 */
async function enrichByVinsUncached(list, { maxOrdenes, fechaInicio, fechaFin }) {
  const baseParams = {};
  if (fechaInicio) baseParams.fechaInicio = fechaInicio;
  if (fechaFin) baseParams.fechaFin = fechaFin;
  const orderDateSql = [
    fechaInicio ? 'AND CONVERT(DATE, o.ORE_FECHAORD, 103) >= @fechaInicio' : '',
    fechaFin ? 'AND CONVERT(DATE, o.ORE_FECHAORD, 103) <= @fechaFin' : '',
  ].filter(Boolean).join('\n');

  const buildExact = (vins) => {
    const params = { ...baseParams };
    vins.forEach((vin, i) => { params[`vin${i}`] = vin; });
    const matchSql = (col) => vins.map((_, i) => `${col} = @vin${i}`).join(' OR ');
    return { params, matchSql };
  };
  const buildLoose = (vins) => {
    const params = { ...baseParams };
    vins.forEach((vin, i) => {
      params[`vin${i}`] = vin;
      params[`like${i}`] = `%${vin}`;
      const suffix = vinSearchSuffix(vin);
      if (suffix) params[`suf${i}`] = `%${suffix}`;
    });
    const matchSql = (col) => vins.map((vin, i) => {
      const parts = [
        `UPPER(LTRIM(RTRIM(${col}))) = @vin${i}`,
        `UPPER(LTRIM(RTRIM(${col}))) LIKE @like${i}`,
      ];
      if (params[`suf${i}`]) {
        parts.push(`UPPER(LTRIM(RTRIM(${col}))) LIKE @suf${i}`);
      }
      return parts.join('\n    OR ');
    }).join(' OR ');
    return { params, matchSql };
  };

  const runQueries = ({ params, matchSql }) => Promise.all([
      query(`
        SELECT
          UPPER(LTRIM(RTRIM(v.VTE_SERIE))) AS serie,
          LTRIM(RTRIM(v.VTE_DOCTO)) AS facturaVenta,
          v.VTE_FECHDOCTO AS fechaFactura,
          LTRIM(RTRIM(v.VTE_FORMAPAGO)) AS formaPago,
          LTRIM(RTRIM(veh.VEH_TIPOAUTO)) AS modelo,
          veh.VEH_ANMODELO AS anModelo,
          LTRIM(RTRIM(veh.VEH_SITUACION)) AS situacion,
          v.VTE_IDCLIENTE AS idClienteDms,
          LTRIM(RTRIM(ISNULL(c.PER_NOMRAZON, '') + ' ' + ISNULL(c.PER_PATERNO, '') + ' ' + ISNULL(c.PER_MATERNO, ''))) AS clienteDms,
          COALESCE(
            NULLIF(lv.SUBTOTAL, 0),
            NULLIF(veh.VEH_SSUBTOTAL, 0),
            CASE WHEN ISNULL(v.VTE_IMPORTEMON, 0) > 0 THEN ROUND(v.VTE_IMPORTEMON / 1.16, 2) ELSE 0 END
          ) AS ventaSubtotal,
          COALESCE(
            NULLIF(lv.COSTO, 0),
            NULLIF(lv.pen_costo1, 0) - ISNULL(lv.BONIFICACION, 0) - ISNULL(lv.PARTICIPACION, 0),
            NULLIF(veh.VEH_COSTO1, 0) - ISNULL(veh.VEH_REBATE, 0) - ISNULL(veh.VEH_PARTICIP, 0),
            0
          ) AS costoNeto,
          ISNULL(lv.VEH_MISELANEOS, ISNULL(veh.VEH_MISELANEOS, 0)) AS gastos,
          CASE WHEN lv.VTE_DOCTO IS NOT NULL THEN 1 ELSE 0 END AS tieneLibro
        FROM ADE_VTAFI v
        INNER JOIN SER_VEHICULO veh
          ON veh.VEH_NUMSERIE = v.VTE_SERIE
          AND veh.VEH_NOINVENTA > 0
        LEFT JOIN PER_PERSONAS c ON c.PER_IDPERSONA = v.VTE_IDCLIENTE
        OUTER APPLY (
          SELECT TOP 1
            lv.SUBTOTAL, lv.COSTO, lv.pen_costo1, lv.BONIFICACION,
            lv.PARTICIPACION, lv.VEH_MISELANEOS, lv.VTE_DOCTO
          FROM UNI_TEMLIBROVENTAS lv
          WHERE lv.VTE_DOCTO = v.VTE_DOCTO
            AND lv.VTE_ORGSTATUS = 'I'
          ORDER BY ISNULL(lv.SUBTOTAL, 0) DESC
        ) lv
        WHERE v.VTE_TIPODOCTO = 'A'
          AND v.VTE_STATUS = 'I'
          AND (${matchSql('v.VTE_SERIE')})
        ORDER BY CONVERT(DATE, v.VTE_FECHDOCTO, 103) DESC
      `, params),
      query(`
        SELECT TOP (${Math.max(1, Number(maxOrdenes) || 50)})
          o.ORE_IDORDEN AS orden,
          UPPER(LTRIM(RTRIM(o.ORE_NUMSERIE))) AS serie,
          COALESCE(NULLIF(LTRIM(RTRIM(o.ORE_DOCTO)), ''), fac.factura) AS facturaTaller,
          o.ORE_FECHAORD AS ingreso,
          o.ORE_FECHACIE AS cierre,
          o.ORE_STATUS AS status,
          o.ORE_KILOMETRAJE AS kilometraje,
          LTRIM(RTRIM(o.ORE_TPOORDEN)) AS tipoOrden,
          LTRIM(RTRIM(o.ORE_TIPSERVICIO)) AS tipoServicio,
          LTRIM(RTRIM(COALESCE(NULLIF(veh.VEH_TIPOAUTO, ''), ''))) AS modelo,
          LTRIM(RTRIM(COALESCE(asr.PAR_DESCRIP1, o.ORE_IDASESOR, ''))) AS asesor,
          ISNULL(fac.importe, 0) AS importeFac,
          ISNULL(tcx.importe, 0) AS importeTcx,
          ISNULL(det.subtotal, 0) AS importeDetSub,
          ISNULL(det.iva, 0) AS importeDetIva
        FROM SER_ORDEN o
        LEFT JOIN SER_VEHICULO veh ON veh.VEH_NUMSERIE = o.ORE_NUMSERIE
        OUTER APPLY (
          SELECT MAX(f.fos_docto) AS factura, SUM(f.fos_total) AS importe
          FROM SER_FACORDEN f
          WHERE f.fos_idorden = o.ORE_IDORDEN
        ) fac
        OUTER APPLY (
          SELECT SUM(t.TCX_TOTAL) AS importe
          FROM SER_ORDTOTCXP t
          WHERE t.TCX_IDORDEN = o.ORE_IDORDEN
            AND t.TCX_STATUS IN ('T', 'A')
        ) tcx
        OUTER APPLY (
          SELECT SUM(d.ORD_SUBTOTAL) AS subtotal, SUM(d.ORD_IVATOT) AS iva
          FROM SER_ORDENDET d
          WHERE d.ORD_IDORDEN = o.ORE_IDORDEN
        ) det
        LEFT JOIN PNC_PARAMETR asr
          ON asr.PAR_TIPOPARA = 'AS' AND asr.PAR_IDENPARA = o.ORE_IDASESOR
        WHERE (${matchSql('o.ORE_NUMSERIE')})
          ${orderDateSql}
        ORDER BY CONVERT(DATE, o.ORE_FECHAORD, 103) DESC
      `, params),
    ]);

  try {
    let [ventasRows, ordenesRows] = await runQueries(buildExact(list));

    // Series sin ninguna fila por igualdad: probar el barrido tolerante.
    const encontradas = new Set();
    for (const r of ventasRows) encontradas.add(normalizeVin(r.serie));
    for (const r of ordenesRows) encontradas.add(normalizeVin(r.serie));
    const faltantes = list.filter((vin) => !encontradas.has(vin));
    if (faltantes.length) {
      const [ventasExtra, ordenesExtra] = await runQueries(buildLoose(faltantes));
      ventasRows = ventasRows.concat(ventasExtra);
      ordenesRows = ordenesRows.concat(ordenesExtra);
    }

    const ordenesCalculadas = ordenesRows.map((row) => {
      const importeFac = Number(row.importeFac || 0);
      const importeTcx = Number(row.importeTcx || 0);
      const importeDet = Number(row.importeDetSub || 0) + Number(row.importeDetIva || 0);
      const importe = importeFac > 0 ? importeFac : (importeDet > 0 ? importeDet : importeTcx);
      const status = String(row.status || '').trim().toUpperCase();
      return {
        ...row,
        importe,
        importeFacturado: status === 'I' ? importe : 0,
        importeAbierto: ['A', 'T', 'D', 'P'].includes(status) ? importe : 0,
      };
    });

    const ventasVistas = new Set();
    const ventasCalculadas = [];
    for (const row of ventasRows) {
      const facturaKey = `${String(row.facturaVenta || '').trim().toUpperCase()}|${normalizeVin(row.serie)}`;
      if (ventasVistas.has(facturaKey)) continue;
      ventasVistas.add(facturaKey);
      const ventaSubtotal = Number(row.ventaSubtotal || 0);
      const costoNeto = Number(row.costoNeto || 0);
      const gastos = Number(row.gastos || 0);
      const tieneLibro = Number(row.tieneLibro || 0) === 1;
      const utilidad = (tieneLibro || costoNeto > 0)
        ? Math.round((ventaSubtotal - costoNeto - gastos) * 100) / 100
        : null;
      ventasCalculadas.push({
        ...row,
        ventaSubtotal,
        costoNeto,
        gastos,
        utilidad,
      });
    }

    const unidades = list.map((vin) => {
      const facturasVentaSql = ventasCalculadas.filter((r) => matchCrmVinToSerie(vin, r.serie));
      const ordenesServicio = ordenesCalculadas.filter((r) => matchCrmVinToSerie(vin, r.serie));
      return {
        vin,
        serieSql: facturasVentaSql[0]?.serie || ordenesServicio[0]?.serie || null,
        facturasVentaSql,
        ordenesServicio,
      };
    });

    return {
      unidades,
      ordenesServicio: ordenesCalculadas,
      periodoOrdenes: { fechaInicio, fechaFin },
      error: null,
    };
  } catch (err) {
    return {
      unidades: list.map((vin) => ({ vin, serieSql: null, facturasVentaSql: [], ordenesServicio: [] })),
      ordenesServicio: [],
      error: err.message || String(err),
    };
  }
}

/**
 * Obtiene todas las unidades que han generado órdenes a nombre del cliente en el DMS,
 * aunque el VIN no exista en la columna T de Balderrama Ciclos.
 * El match final exige nombre normalizado exacto o teléfono exacto para evitar homónimos.
 */
async function getCustomerUnitsDms({ nombre, telefono, maxOrdenes = 5000 } = {}) {
  const nombreNormalizado = normalizeNombre(nombre);
  const telefonoNormalizado = normalizeTelefono(telefono);
  if (!nombreNormalizado && !telefonoNormalizado) {
    return { unidades: [], error: null };
  }
  // El filtro por nombre/teléfono recorre PER_PERSONAS completa (~1.5 s);
  // al reabrir el mismo cliente o cambiar de periodo se reutiliza.
  const cacheKey = `${nombreNormalizado}|${telefonoNormalizado}|${maxOrdenes}`;
  const res = await ttlCache('customerUnits', cacheKey, ENRICH_TTL_MS, () => getCustomerUnitsDmsUncached({
    nombreNormalizado, telefonoNormalizado, maxOrdenes,
  }));
  if (res.error) ttlCacheDelete('customerUnits', cacheKey);
  return res;
}

async function getCustomerUnitsDmsUncached({ nombreNormalizado, telefonoNormalizado, maxOrdenes }) {
  const params = {};
  const identitySql = [];
  if (nombreNormalizado) {
    const tokens = nombreNormalizado.split(' ').filter(Boolean);
    params.nombreLike = `%${tokens.join('%')}%`;
    identitySql.push(`
      UPPER(LTRIM(RTRIM(
        ISNULL(c.PER_NOMRAZON, '') + ' ' + ISNULL(c.PER_PATERNO, '') + ' ' + ISNULL(c.PER_MATERNO, '')
      ))) LIKE @nombreLike
    `);
  }
  if (telefonoNormalizado) {
    params.telefono = telefonoNormalizado;
    identitySql.push(`
      RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(c.PER_TELEFONO1, ''), ' ', ''), '-', ''), '(', ''), ')', ''), 10) = @telefono
      OR RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(c.PER_TELCELULAR, ''), ' ', ''), '-', ''), '(', ''), ')', ''), 10) = @telefono
    `);
  }

  try {
    const rows = await query(`
      SELECT TOP (${Math.min(10000, Math.max(1, Number(maxOrdenes) || 5000))})
        o.ORE_IDCLIENTE AS idClienteDms,
        o.ORE_IDORDEN AS orden,
        UPPER(LTRIM(RTRIM(o.ORE_NUMSERIE))) AS serie,
        o.ORE_FECHAORD AS ingreso,
        o.ORE_FECHACIE AS cierre,
        o.ORE_STATUS AS status,
        o.ORE_KILOMETRAJE AS kilometraje,
        LTRIM(RTRIM(COALESCE(NULLIF(veh.VEH_TIPOAUTO, ''), ''))) AS modelo,
        veh.VEH_ANMODELO AS anModelo,
        LTRIM(RTRIM(
          ISNULL(c.PER_NOMRAZON, '') + ' ' + ISNULL(c.PER_PATERNO, '') + ' ' + ISNULL(c.PER_MATERNO, '')
        )) AS clienteDms,
        LTRIM(RTRIM(c.PER_TELEFONO1)) AS telefono,
        LTRIM(RTRIM(c.PER_TELCELULAR)) AS celular
      FROM SER_ORDEN o
      INNER JOIN PER_PERSONAS c ON c.PER_IDPERSONA = o.ORE_IDCLIENTE
      LEFT JOIN SER_VEHICULO veh ON veh.VEH_NUMSERIE = o.ORE_NUMSERIE
      WHERE o.ORE_NUMSERIE IS NOT NULL
        AND LTRIM(RTRIM(o.ORE_NUMSERIE)) <> ''
        AND o.ORE_STATUS <> 'C'
        AND (${identitySql.map((sql) => `(${sql})`).join(' OR ')})
    `, params);

    const matchedRows = rows.filter((row) => {
      const mismoNombre = nombreNormalizado
        && normalizeNombre(row.clienteDms) === nombreNormalizado;
      const mismoTelefono = telefonoNormalizado
        && [row.telefono, row.celular]
          .map(normalizeTelefono)
          .filter(Boolean)
          .includes(telefonoNormalizado);
      return mismoNombre || mismoTelefono;
    });

    const bySerie = new Map();
    for (const row of matchedRows) {
      const serie = normalizeVin(row.serie);
      if (!serie) continue;
      if (!bySerie.has(serie)) {
        bySerie.set(serie, {
          serie,
          modelo: row.modelo || null,
          anModelo: row.anModelo || null,
          idClienteDms: row.idClienteDms || null,
          clienteDms: row.clienteDms || null,
          ordenes: new Set(),
          primeraVisita: null,
          ultimaVisita: null,
          kilometraje: null,
          fechaKilometraje: null,
        });
      }
      const unidad = bySerie.get(serie);
      if (row.orden) unidad.ordenes.add(String(row.orden));
      if (!unidad.modelo && row.modelo) unidad.modelo = row.modelo;
      if (!unidad.anModelo && row.anModelo) unidad.anModelo = row.anModelo;
      const fecha = toIsoDate(row.ingreso || row.cierre);
      if (fecha && (!unidad.primeraVisita || fecha < unidad.primeraVisita)) unidad.primeraVisita = fecha;
      if (fecha && (!unidad.ultimaVisita || fecha > unidad.ultimaVisita)) unidad.ultimaVisita = fecha;
      const km = Number(row.kilometraje);
      if (Number.isFinite(km) && km >= 0
        && (!unidad.fechaKilometraje || !fecha || fecha >= unidad.fechaKilometraje)) {
        unidad.kilometraje = km;
        unidad.fechaKilometraje = fecha;
      }
    }

    const series = [...bySerie.keys()];
    let ventas = [];
    if (series.length) {
      const ventaParams = {};
      const conditions = [];
      series.forEach((serie, i) => {
        ventaParams[`serie${i}`] = serie;
        conditions.push(`UPPER(LTRIM(RTRIM(v.VTE_SERIE))) = @serie${i}`);
        const suffix = vinSearchSuffix(serie);
        if (suffix) {
          ventaParams[`suf${i}`] = `%${suffix}`;
          conditions.push(`UPPER(LTRIM(RTRIM(v.VTE_SERIE))) LIKE @suf${i}`);
        }
      });
      ventas = await query(`
        SELECT
          UPPER(LTRIM(RTRIM(v.VTE_SERIE))) AS serie,
          LTRIM(RTRIM(v.VTE_DOCTO)) AS factura,
          v.VTE_FECHDOCTO AS fechaFactura,
          v.VTE_IDCLIENTE AS idClienteVenta,
          v.VTE_TIPODOCTO AS tipoDocto
        FROM ADE_VTAFI v
        WHERE v.VTE_TIPODOCTO IN ('A', 'U')
          AND v.VTE_STATUS = 'I'
          AND (${conditions.join(' OR ')})
      `, ventaParams);
    }

    const unidades = [...bySerie.values()]
      .map((unidad) => {
        const matches = ventas.filter((venta) => matchCrmVinToSerie(unidad.serie, venta.serie));
        // 1) Factura a nombre del mismo cliente DMS (A o U)
        // 2) Si no, venta de auto nuevo (A) del VIN (series con prefijo de inventario)
        // No atribuir facturas U de otros clientes (reventas posteriores)
        const venta = matches.find((v) =>
          unidad.idClienteDms != null && String(v.idClienteVenta) === String(unidad.idClienteDms)
        ) || matches.find((v) => String(v.tipoDocto || '').toUpperCase() === 'A')
          || null;
        const ordenIds = [...unidad.ordenes];
        return {
          ...unidad,
          ordenes: ordenIds.length,
          ordenIds,
          ventaEnDistribuidor: !!venta,
          facturaVenta: venta?.factura || null,
          fechaFactura: toIsoDate(venta?.fechaFactura),
          tipoVenta: venta?.tipoDocto || null,
        };
      })
      .sort((a, b) => String(b.ultimaVisita || '').localeCompare(String(a.ultimaVisita || '')));

    return { unidades, error: null };
  } catch (err) {
    return { unidades: [], error: err.message || String(err) };
  }
}

function monthsElapsed(fromDate, toDate = new Date()) {
  const iso = toIsoDate(fromDate);
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const from = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(from.getTime()) || from > toDate) return 0;
  let months = (toDate.getFullYear() - from.getFullYear()) * 12
    + toDate.getMonth() - from.getMonth();
  if (toDate.getDate() < from.getDate()) months -= 1;
  return Math.max(0, months);
}

/** Unidad vigente: la venta más reciente en el DMS, no la única compra que trae el CRM. */
function pickUnidadActual(unidades = []) {
  const vendidas = unidades.filter((u) => u.ventaEnDistribuidor || u.facturaVenta || u.fechaFactura);
  const pool = vendidas.length ? vendidas : unidades;
  return [...pool].sort((a, b) => {
    const fecha = String(b.fechaFactura || '').localeCompare(String(a.fechaFactura || ''));
    if (fecha) return fecha;
    return String(b.ultimaVisita || '').localeCompare(String(a.ultimaVisita || ''));
  })[0] || null;
}

function fechaContratoIso(contrato) {
  return String(validHistoricalDate(
    contrato?.fecha_compra_valida,
    contrato?.fecha_compra,
    contrato?.fecha_timbrado,
    contrato?.fecha,
  ) || '');
}

/**
 * El CRM solo marca compra cuando el ciclo trae VIN. Las demás facturas del
 * mismo cliente viven en el DMS: se agregan aquí para que historial, tabla y
 * timeline cuenten la misma lista.
 */
function mergeComprasDesdeDms(compras = [], unidades = []) {
  const list = [...compras];
  for (const unidad of unidades) {
    if (!unidad.ventaEnDistribuidor && !unidad.facturaVenta) continue;
    const serie = normalizeVin(unidad.serie);
    if (!serie) continue;
    const previa = list.find((c) => matchCrmVinToSerie(c.vin, serie));
    if (previa) {
      if (!previa.numFactura && unidad.facturaVenta) previa.numFactura = unidad.facturaVenta;
      if (!previa.fechaFactura && unidad.fechaFactura) previa.fechaFactura = unidad.fechaFactura;
      if (!previa.modeloSql && unidad.modelo) previa.modeloSql = unidad.modelo;
      if (!previa.producto && unidad.modelo) previa.producto = unidad.modelo;
      continue;
    }
    list.push({
      vin: serie,
      numFactura: unidad.facturaVenta || null,
      facturadoA: null,
      producto: unidad.modelo || null,
      modeloSql: unidad.modelo || null,
      fechaFactura: unidad.fechaFactura || null,
      fechaEntrega: null,
      vendedor: null,
      idCiclo: null,
      origen: 'dms',
    });
  }
  return list.sort((a, b) => String(a.fechaFactura || '').localeCompare(String(b.fechaFactura || '')));
}

function buildCliente360({
  compras = [],
  contratos = [],
  unidades = [],
  ordenes = [],
  timeline = [],
  leads = [],
  pruebas = [],
  quejasCsi = null,
} = {}) {
  const ordenesValidas = ordenes.filter((o) => String(o.status || '').trim().toUpperCase() !== 'C');

  const catalogoUnidades = [];
  const registrarUnidad = (vin, modelo, anModelo, fecha) => {
    const key = normalizeVin(vin);
    if (!key) return;
    const previa = catalogoUnidades.find((u) => matchCrmVinToSerie(u.vin, key));
    if (previa) {
      if (!previa.modelo && modelo) previa.modelo = modelo;
      if (!previa.anModelo && anModelo) previa.anModelo = anModelo;
      if (fecha && (!previa.fecha || String(fecha) > String(previa.fecha))) previa.fecha = fecha;
      return;
    }
    catalogoUnidades.push({
      vin: key,
      modelo: modelo || null,
      anModelo: anModelo || null,
      fecha: fecha || null,
    });
  };
  for (const unidad of unidades) {
    registrarUnidad(unidad.serie, unidad.modelo, unidad.anModelo, unidad.fechaFactura || unidad.ultimaVisita);
  }
  for (const compra of compras) {
    registrarUnidad(compra.vin, compra.modeloSql || compra.producto, null, compra.fechaEntrega || compra.fechaFactura);
  }
  for (const contrato of contratos) {
    registrarUnidad(contrato.vin, contrato.unidad, null, fechaContratoIso(contrato));
  }

  // Unidad inicial = la más reciente (fecha de factura / contrato / última visita).
  const masReciente = catalogoUnidades
    .filter((u) => u.fecha)
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0] || null;
  const vinVigente = masReciente?.vin
    || normalizeVin(pickUnidadActual(unidades)?.serie)
    || catalogoUnidades[0]?.vin
    || null;

  // El número de contrato no depende de la unidad elegida: es el de la vista
  // completa (unidad vigente por factura), que ya era el correcto.
  const unidadContrato = pickUnidadActual(unidades);
  const vinContrato = normalizeVin(unidadContrato?.serie);
  const contratoFijo = (vinContrato
    ? [...contratos]
      .filter((c) => matchCrmVinToSerie(c.vin, vinContrato))
      .sort((a, b) => fechaContratoIso(b).localeCompare(fechaContratoIso(a)))[0] || null
    : null)
    || (vinContrato ? null : [...contratos].sort((a, b) =>
      fechaContratoIso(b).localeCompare(fechaContratoIso(a))
    )[0])
    || null;
  const numeroContratoFijo = contratoFijo?.no_contrato || contratoFijo?.contrato || null;

  const ultimaActividad = [...timeline].sort((a, b) =>
    String(b.fecha || '').localeCompare(String(a.fecha || '')))[0] || null;
  const textoIncidencias = timeline.map((t) =>
    `${t.tipo || ''} ${t.resultado || ''}`).join(' | ');
  const quejasTimeline = (textoIncidencias.match(/QUEJA|INCIDENCIA|RECLAMO|INCONFORMIDAD/gi) || []).length;
  const digitalPattern = /DIGITAL|WEB|INTERNET|FACEBOOK|INSTAGRAM|WHATSAPP|CHAT|GOOGLE|PORTAL|EMAIL|CORREO/i;
  const interaccionesDigitales = leads.filter((l) =>
    digitalPattern.test(`${l.canal || ''} ${l.tipo || ''} ${l.campana || ''}`)
  ).length + timeline.filter((t) =>
    digitalPattern.test(`${t.tipo || ''} ${t.resultado || ''}`)
  ).length;
  const historialCompras = (() => {
    const vins = new Set();
    const add = (vin) => {
      const key = normalizeVin(vin);
      if (!key) return;
      if ([...vins].some((prev) => matchCrmVinToSerie(prev, key))) return;
      vins.add(key);
    };
    compras.forEach((c) => add(c.vin));
    contratos.forEach((c) => add(c.vin));
    unidades.forEach((u) => {
      if (u.ventaEnDistribuidor || u.facturaVenta) add(u.serie);
    });
    return vins.size;
  })();
  const quejasDeVin = (vin) => {
    if (!vin) {
      return {
        quejasIncidencias: Number(quejasCsi?.total ?? 0) > 0 ? Number(quejasCsi.total) : quejasTimeline,
        quejasPosventa: Number(quejasCsi?.totalPosventa || 0),
        quejasVentas: Number(quejasCsi?.totalVentas || 0),
        quejasAreaPrincipal: quejasCsi?.areaPrincipal || null,
      };
    }
    const pos = (quejasCsi?.posventa || []).filter((q) => q.serie && matchCrmVinToSerie(vin, q.serie));
    const ven = (quejasCsi?.ventas || []).filter((q) => q.serie && matchCrmVinToSerie(vin, q.serie));
    return {
      quejasIncidencias: pos.length + ven.length,
      quejasPosventa: pos.length,
      quejasVentas: ven.length,
      quejasAreaPrincipal: [...pos, ...ven].map((q) => q.area).find(Boolean) || null,
    };
  };

  function consolidadoDeVin(vinObjetivo) {
  const unidadActual = vinObjetivo
    ? (unidades.find((u) => matchCrmVinToSerie(u.serie, vinObjetivo)) || null)
    : null;
  const vinUnidad = normalizeVin(vinObjetivo);
  const compraDeUnidad = vinUnidad
    ? [...compras]
      .filter((c) => matchCrmVinToSerie(c.vin, vinUnidad))
      .sort((a, b) => String(b.fechaEntrega || b.fechaFactura || '').localeCompare(
        String(a.fechaEntrega || a.fechaFactura || '')
      ))[0] || null
    : null;
  const contratoDeUnidad = vinUnidad
    ? [...contratos]
      .filter((c) => matchCrmVinToSerie(c.vin, vinUnidad))
      .sort((a, b) => fechaContratoIso(b).localeCompare(fechaContratoIso(a)))[0] || null
    : null;
  const compraActual = compraDeUnidad || (vinUnidad ? null : [...compras].sort((a, b) =>
    String(b.fechaEntrega || b.fechaFactura || '').localeCompare(
      String(a.fechaEntrega || a.fechaFactura || '')
    ))[0] || null);
  const contratoActual = contratoDeUnidad || (vinUnidad ? null : [...contratos].sort((a, b) =>
    fechaContratoIso(b).localeCompare(fechaContratoIso(a))
  )[0]) || null;
  const vinActual = vinUnidad || normalizeVin(contratoActual?.vin || compraActual?.vin);

  const ordenesDeUnidad = vinActual
    ? ordenesValidas.filter((o) => matchCrmVinToSerie(vinActual, o.serie))
    : [];
  const ordenesParaFicha = vinActual ? ordenesDeUnidad : ordenesValidas;
  const ordenesOrdenadas = [...ordenesParaFicha].sort((a, b) =>
    String(toIsoDate(b.ingreso || b.cierre) || '').localeCompare(
      String(toIsoDate(a.ingreso || a.cierre) || '')
    ));
  const ultimaOrden = ordenesOrdenadas[0] || null;
  const kmOrden = ordenesOrdenadas.find((o) => {
    const km = Number(o.kilometraje);
    return Number.isFinite(km) && km >= 0;
  }) || null;

  const plazo = Number(contratoActual?.plazo_meses);
  const mesesTranscurridos = monthsElapsed(
    validHistoricalDate(
      contratoActual?.fecha_compra_valida,
      contratoActual?.fecha_compra,
      contratoActual?.fecha_timbrado,
      contratoActual?.fecha
    )
  );
  const mensualidadesPagadas = Number.isFinite(plazo) && plazo > 0 && mesesTranscurridos != null
    ? Math.min(plazo, mesesTranscurridos)
    : null;
  const montoFinanciar = Number(contratoActual?.monto_financiar);
  const enganche = Number(contratoActual?.enganche_monto);
  const saldoEstimado = Number.isFinite(montoFinanciar) && mensualidadesPagadas != null && plazo > 0
    ? Math.max(0, montoFinanciar * (1 - mensualidadesPagadas / plazo))
    : null;
  const valorEstimadoUnidad = Number.isFinite(montoFinanciar)
    ? montoFinanciar + (Number.isFinite(enganche) ? enganche : 0)
    : null;
  const mensualidadEstimada = Number.isFinite(montoFinanciar) && montoFinanciar > 0
    && Number.isFinite(plazo) && plazo > 0
    ? Math.round((montoFinanciar / plazo) * 100) / 100
    : null;
  const quejas = quejasDeVin(vinActual);

  return {
      fechaUltimaCompra: toIsoDate(
        unidadActual?.fechaFactura
        || fechaContratoIso(contratoActual)
        || compraActual?.fechaEntrega
        || compraActual?.fechaFactura
      ),
      modeloActual: unidadActual?.modelo || contratoActual?.unidad
        || compraActual?.modeloSql || compraActual?.producto || null,
      anModelo: unidadActual?.anModelo || null,
      vinActual: vinActual || unidadActual?.serie || null,
      numeroContrato: numeroContratoFijo,
      tipoCompra: contratoActual?.tipo_compra || contratoActual?.plan_2
        || contratoActual?.plan || (contratoActual ? 'Crédito' : null),
      seguroAuto: contratoActual?.aseguradora || null,
      plazoContratado: Number.isFinite(plazo) && plazo > 0 ? plazo : null,
      mensualidadesPagadas,
      mensualidadEstimada,
      saldoEstimado,
      valorEstimadoUnidad,
      ultimaVisitaTaller: toIsoDate(ultimaOrden?.ingreso || ultimaOrden?.cierre),
      kilometraje: kmOrden ? Number(kmOrden.kilometraje) : (unidadActual?.kilometraje ?? null),
      fechaKilometraje: kmOrden
        ? toIsoDate(kmOrden.ingreso || kmOrden.cierre)
        : (unidadActual?.fechaKilometraje || null),
      serviciosRealizados: vinActual ? ordenesDeUnidad.length : ordenesValidas.length,
      ultimoContactoComercial: toIsoDate(ultimaActividad?.fecha),
      interaccionesDigitales,
      quejasIncidencias: quejas.quejasIncidencias,
      quejasPosventa: quejas.quejasPosventa,
      quejasVentas: quejas.quejasVentas,
      quejasAreaPrincipal: quejas.quejasAreaPrincipal,
      historialCompras,
      metodologia: {
        mensualidades: 'Mensualidad estimada = monto financiado entre el plazo, sin intereses. El avance (meses transcurridos de ese plazo) no confirma pagos reales.',
        saldo: 'Monto financiado amortizado linealmente; no incluye intereses, pagos anticipados ni mora.',
        valorUnidad: 'Monto financiado más enganche al contratar; no es un avalúo comercial actual.',
        kilometraje: 'Último kilometraje de la unidad seleccionada, tomado de su orden de taller más reciente.',
        unidadActual: 'Cada opción es una unidad del cliente; se muestra primero la más reciente.',
        quejas: 'CSI Posventa y CSI Ventas de la serie seleccionada.',
      },
  };
  }

  const eventos = [];
  for (const t of timeline) {
    eventos.push({
      fecha: toIsoDate(t.fecha),
      categoria: 'comercial',
      titulo: t.tipo || 'Contacto comercial',
      detalle: [t.resultado, t.estatusCiclo].filter(Boolean).join(' · ') || null,
      vin: t.vin || null,
    });
  }
  for (const c of compras) {
    eventos.push({
      fecha: toIsoDate(c.fechaEntrega || c.fechaFactura),
      categoria: 'compra',
      titulo: 'Compra de unidad',
      detalle: [c.producto, c.numFactura ? `Factura ${c.numFactura}` : null].filter(Boolean).join(' · '),
      vin: c.vin || null,
    });
  }
  for (const c of contratos) {
    eventos.push({
      fecha: validHistoricalDate(c.fecha_compra_valida, c.fecha_compra, c.fecha_timbrado, c.fecha),
      categoria: 'financiamiento',
      titulo: 'Contrato de financiamiento',
      detalle: [
        c.unidad,
        (c.no_contrato || c.contrato) ? `Contrato ${c.no_contrato || c.contrato}` : null,
        c.plazo_meses ? `${c.plazo_meses} meses` : null,
        c.tipo_compra || c.plan_2 || c.plan,
      ].filter(Boolean).join(' · '),
      vin: c.vin || null,
    });
  }
  for (const o of ordenesValidas) {
    eventos.push({
      fecha: toIsoDate(o.ingreso || o.cierre),
      categoria: 'taller',
      titulo: 'Visita a taller',
      detalle: [
        o.tipoServicio || o.tipoOrden,
        Number.isFinite(Number(o.kilometraje)) ? `${Number(o.kilometraje).toLocaleString('es-MX')} km` : null,
        o.orden ? `Orden ${o.orden}` : null,
      ].filter(Boolean).join(' · '),
      vin: normalizeVin(o.serie),
    });
  }
  for (const l of leads) {
    eventos.push({
      fecha: toIsoDate(l.fecha_entrada),
      categoria: 'digital',
      titulo: 'Lead registrado',
      detalle: [l.canal, l.auto_interes, l.resultado].filter(Boolean).join(' · '),
      vin: normalizeVin(l.vin_comprado),
    });
  }
  for (const p of pruebas) {
    eventos.push({
      fecha: toIsoDate(p.fecha),
      categoria: 'prueba',
      titulo: 'Prueba de manejo',
      detalle: [p.auto_interes, p.tipo_auto].filter(Boolean).join(' · '),
      vin: normalizeVin(p.vin),
    });
  }
  for (const q of (quejasCsi?.posventa || [])) {
    eventos.push({
      fecha: toIsoDate(q.fecha),
      categoria: 'queja',
      titulo: q.incidencia || 'Incidencia CSI posventa',
      detalle: [q.area, q.orden ? `Orden ${q.orden}` : null, q.queja].filter(Boolean).join(' · '),
      vin: normalizeVin(q.serie),
    });
  }
  for (const q of (quejasCsi?.ventas || [])) {
    eventos.push({
      fecha: toIsoDate(q.fecha),
      categoria: 'queja',
      titulo: q.incidencia || 'Incidencia CSI ventas',
      detalle: [q.area, q.sucursal, q.queja].filter(Boolean).join(' · '),
      vin: normalizeVin(q.serie),
    });
  }

  const porUnidad = catalogoUnidades
    .map((unidad) => {
      const ficha = consolidadoDeVin(unidad.vin);
      return {
        vin: unidad.vin,
        modelo: ficha.modeloActual || unidad.modelo || null,
        anModelo: ficha.anModelo || unidad.anModelo || null,
        fecha: unidad.fecha || ficha.fechaUltimaCompra || null,
        ficha,
      };
    })
    .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
  const consolidado = (vinVigente && porUnidad.find((u) => matchCrmVinToSerie(u.vin, vinVigente))?.ficha)
    || consolidadoDeVin(vinVigente);

  return {
    consolidado,
    porUnidad,
    timeline: eventos
      .filter((e) => e.fecha)
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
      .slice(0, 250),
  };
}

/**
 * Histórico completo del cliente por ID_CONTACTO (= ID CRM):
 * resumen, ciclos, compras (VIN col T), leads, solicitudes de crédito (F&I),
 * timeline y cruce SQL por VIN.
 */
async function getContactHistory(idContacto, {
  maxActividades = 500,
  enrichSql = true,
  fechaInicio = null,
  fechaFin = null,
} = {}) {
  const d = getDb();
  const id = String(idContacto || '').trim();
  if (!id) throw new Error('idContacto requerido');

  const rows = d.prepare(`
    SELECT * FROM crm_actividades
    WHERE id_contacto = ?
    ORDER BY COALESCE(fecha_resp_actividad, fecha_prog_actividad, fecha_crea_actividad, fecha_inicio_ciclo) ASC
  `).all(id);

  const leads = hasLeadsTable(d)
    ? d.prepare(`
        SELECT fecha_entrada, sucursal, tipo, canal, campana, auto_interes, forma_compra,
               fuerza_ventas, resultado, ejecutivo_asignado, fecha_asignacion,
               cita_programada, fecha_cita, cita_asistida, cotizacion,
               vin_comprado, fecha_factura, fecha_entrega, estatus_compra,
               telefono, correo, nombre, comentario
        FROM crm_leads
        WHERE id_crm = ?
        ORDER BY fecha_entrada ASC
      `).all(id)
    : [];

  const solicitudes = hasSolicitudesTable(d)
    ? d.prepare(`
        SELECT no_solicitud, fecha_solicitud, financiera, fuerza_venta, asesor,
               estatus, respuesta_financiera, biometrico, unidad_paquete, fuente, origen,
               fecha_aprobacion, fecha_firma, num_contrato, fecha_compra,
               mes_compra, fi, afi, enganche, nombre_cliente, rfc
        FROM crm_solicitudes
        WHERE id_crm = ?
        ORDER BY fecha_solicitud ASC
      `).all(id)
    : [];

  const pruebasManejo = hasPruebasManejoTable(d)
    ? d.prepare(`
        SELECT fecha, hora_salida, fuerza_venta, centro_trabajo, ejecutivo_ventas,
               nombre_cliente, telefono, correo, auto_interes, tipo_auto, vin,
               kilometraje_inicial, kilometraje_final, hostess_registro
        FROM crm_pruebas_manejo
        WHERE id_crm = ?
        ORDER BY fecha ASC, hora_salida ASC
      `).all(id)
    : [];

  if (!rows.length && !leads.length && !solicitudes.length && !pruebasManejo.length) {
    return { idContacto: id, encontrado: false };
  }

  // Vendedor que atiende: último vendedor en actividades CRM;
  // si no hay, ejecutivo asignado del último lead o asesor de la última solicitud.
  const cleanPerson = (v) => {
    const s = String(v || '').replace(/\s+/g, ' ').trim();
    return s && s.toUpperCase() !== 'NULL' ? s : null;
  };
  let vendedorAsignado = null;
  for (let i = rows.length - 1; i >= 0 && !vendedorAsignado; i--) {
    vendedorAsignado = cleanPerson(rows[i].vendedor);
  }
  for (let i = pruebasManejo.length - 1; i >= 0 && !vendedorAsignado; i--) {
    vendedorAsignado = cleanPerson(pruebasManejo[i].ejecutivo_ventas);
  }
  for (let i = leads.length - 1; i >= 0 && !vendedorAsignado; i--) {
    vendedorAsignado = cleanPerson(leads[i].ejecutivo_asignado);
  }
  for (let i = solicitudes.length - 1; i >= 0 && !vendedorAsignado; i--) {
    vendedorAsignado = cleanPerson(solicitudes[i].asesor);
  }

  if (!rows.length) {
    const last = leads[leads.length - 1] || null;
    const lastSol = solicitudes[solicitudes.length - 1] || null;
    const lastPrueba = pruebasManejo[pruebasManejo.length - 1] || null;
    const nombreCliente = last?.nombre || lastSol?.nombre_cliente || lastPrueba?.nombre_cliente || null;
    const telefonoCliente = ultimoDato(leads, 'telefono') || ultimoDato(pruebasManejo, 'telefono') || null;
    const correoCliente = ultimoDato(leads, 'correo') || ultimoDato(pruebasManejo, 'correo') || null;
    const vinsLead = [...new Set(leads.map((l) => normalizeVin(l.vin_comprado)).filter(Boolean))];
    const [sqlEnrich, unidadesDms] = await Promise.all([
      enrichSql && vinsLead.length
        ? enrichByVins(vinsLead, { fechaInicio, fechaFin })
        : Promise.resolve({ unidades: [], ordenesServicio: [], error: null }),
      enrichSql
        ? getCustomerUnitsDms({ nombre: nombreCliente, telefono: telefonoCliente })
        : Promise.resolve({ unidades: [], error: null }),
    ]);
    const vinsAdicionales = unidadesDms.unidades
      .map((unidad) => unidad.serie)
      .filter((serie) => !vinsLead.some((vin) => matchCrmVinToSerie(vin, serie)));
    const sqlAdicional = enrichSql && vinsAdicionales.length
      ? await enrichByVins(vinsAdicionales, { fechaInicio, fechaFin })
      : { unidades: [], ordenesServicio: [], error: null };
    const ordenIdsCliente = new Set(
      unidadesDms.unidades.flatMap((unidad) => unidad.ordenIds || []).map(String)
    );
    const ordenesById = new Map(
      [...(sqlEnrich.ordenesServicio || []), ...(sqlAdicional.ordenesServicio || [])]
        .map((orden) => [String(orden.orden), orden])
    );
    const ordenesServicio = [...ordenesById.values()]
      .filter((orden) => !ordenIdsCliente.size || ordenIdsCliente.has(String(orden.orden)));
    const importeTaller = ordenesServicio
      .filter((o) => String(o.status || '').toUpperCase() !== 'C')
      .reduce((sum, o) => sum + Number(o.importe || 0), 0);
    const contratosFinanciamiento = getFinanciamientoByVins(d, [
      ...vinsLead,
      ...unidadesDms.unidades.map((unidad) => unidad.serie),
    ]);
    const comprasAlt = mergeComprasDesdeDms(
      vinsLead.map((vin) => ({ vin })),
      unidadesDms.unidades,
    );
    const fechasAlt = [
      ...leads.map((l) => l.fecha_entrada),
      ...solicitudes.map((s) => s.fecha_solicitud),
      ...pruebasManejo.map((p) => p.fecha),
      ...contratosFinanciamiento.map((contrato) => contrato.fecha_compra),
    ].filter(Boolean).sort();
    const quejasCsi = getCsiQuejasForContact(d, {
      ordenes: ordenesServicio,
      vins: [
        ...vinsLead,
        ...unidadesDms.unidades.map((unidad) => unidad.serie),
        ...contratosFinanciamiento.map((c) => c.vin),
      ],
    });
    const cliente360 = buildCliente360({
      compras: comprasAlt,
      contratos: contratosFinanciamiento,
      unidades: unidadesDms.unidades,
      ordenes: ordenesServicio,
      timeline: [],
      leads,
      pruebas: pruebasManejo,
      quejasCsi,
    });
    const unidadesSqlAlt = [...(sqlEnrich.unidades || []), ...(sqlAdicional.unidades || [])];
    return attachClvToHistory({
      idContacto: id,
      encontrado: true,
      nombre: nombreCliente,
      telefono: telefonoCliente,
      correo: correoCliente,
      vendedor: vendedorAsignado,
      resumen: {
        totalActividades: 0,
        totalCiclos: 0,
        totalCompras: comprasAlt.length,
        totalLeads: leads.length,
        totalSolicitudes: solicitudes.length,
        totalPruebasManejo: pruebasManejo.length,
        totalContratosFinanciamiento: contratosFinanciamiento.length,
        totalPvas: contratosFinanciamiento.reduce((sum, contrato) => sum + contrato.pvas.length, 0),
        realizoPruebaManejo: pruebasManejo.length > 0,
        pruebaManejoConCompra: pruebasManejo.length > 0 && comprasAlt.length > 0,
        totalUnidadesDistribuidor: unidadesDms.unidades.length,
        totalOrdenesServicio: ordenesServicio.length,
        totalQuejas: quejasCsi.total,
        totalQuejasPosventa: quejasCsi.totalPosventa,
        totalQuejasVentas: quejasCsi.totalVentas,
        quejasAreaPrincipal: quejasCsi.areaPrincipal,
        importeTaller,
        primeraActividad: fechasAlt[0] || null,
        ultimaActividad: fechasAlt[fechasAlt.length - 1] || null,
      },
      ciclos: [],
      compras: comprasAlt,
      leads,
      solicitudes,
      pruebasManejo,
      contratosFinanciamiento,
      timeline: [],
      quejasCsi,
      ficha360: cliente360.consolidado,
      unidadesRadiografia: cliente360.porUnidad,
      timeline360: cliente360.timeline,
      unidadesSql: unidadesSqlAlt,
      unidadesDistribuidor: unidadesDms.unidades,
      ordenesServicio,
      periodoOrdenes: { fechaInicio, fechaFin },
      sqlError: sqlEnrich.error || sqlAdicional.error || unidadesDms.error || null,
    }, {
      contratos: contratosFinanciamiento,
      ordenes: ordenesServicio,
      unidadesSql: unidadesSqlAlt,
      fechaInicio,
      fechaFin,
      vinsForPrev: [
        ...vinsLead,
        ...unidadesDms.unidades.map((unidad) => unidad.serie),
      ].filter(Boolean),
    });
  }

  const ciclosMap = new Map();
  // Compra en ciclo = VIN asignado (columna T). Agrupa por VIN, no por num_factura.
  const comprasMap = new Map();
  for (const r of rows) {
    if (r.id_ciclo && !ciclosMap.has(r.id_ciclo)) {
      ciclosMap.set(r.id_ciclo, {
        idCiclo: r.id_ciclo,
        fechaInicio: r.fecha_inicio_ciclo,
        fechaEsperadaCierre: r.fecha_esperada_cierre,
        estatus: r.estatus,
        fechaEstatus: r.fecha_estatus,
        formaContacto: r.forma_contacto,
        medio: r.medio_contacto,
        submedio: r.submedio_contacto,
        actividades: 0,
        vin: null,
      });
    }
    if (r.id_ciclo) {
      const ciclo = ciclosMap.get(r.id_ciclo);
      ciclo.actividades += 1;
      const vinCiclo = normalizeVin(r.vin);
      if (vinCiclo && !ciclo.vin) ciclo.vin = vinCiclo;
    }

    const vin = normalizeVin(r.vin);
    if (!vin) continue;
    if (!comprasMap.has(vin)) {
      comprasMap.set(vin, {
        vin,
        numFactura: r.num_factura || null,
        facturadoA: r.facturado_a || null,
        producto: r.producto_vendido || null,
        fechaFactura: r.fecha_factura || null,
        fechaEntrega: r.fecha_entrega || null,
        vendedor: r.vendedor || null,
        idCiclo: r.id_ciclo || null,
      });
    } else {
      const c = comprasMap.get(vin);
      if (!c.numFactura && r.num_factura) c.numFactura = r.num_factura;
      if (!c.producto && r.producto_vendido) c.producto = r.producto_vendido;
      if (!c.fechaFactura && r.fecha_factura) c.fechaFactura = r.fecha_factura;
      if (!c.fechaEntrega && r.fecha_entrega) c.fechaEntrega = r.fecha_entrega;
      if (!c.vendedor && r.vendedor) c.vendedor = r.vendedor;
    }
  }

  const timeline = rows.slice(-maxActividades).map((r) => ({
    fecha: r.fecha_resp_actividad || r.fecha_prog_actividad || r.fecha_crea_actividad || r.fecha_inicio_ciclo,
    idCiclo: r.id_ciclo,
    tipo: r.tipo_actividad,
    resultado: r.resultado_actividad,
    fechaProgramada: r.fecha_prog_actividad,
    fechaRespuesta: r.fecha_resp_actividad,
    estatusCiclo: r.estatus,
    vin: normalizeVin(r.vin),
  }));

  const ciclos = [...ciclosMap.values()].sort((a, b) => String(a.fechaInicio).localeCompare(String(b.fechaInicio)));
  const compras = [...comprasMap.values()].sort((a, b) => String(a.fechaFactura || '').localeCompare(String(b.fechaFactura || '')));

  const fechas = rows
    .map((r) => r.fecha_resp_actividad || r.fecha_prog_actividad || r.fecha_crea_actividad || r.fecha_inicio_ciclo)
    .filter(Boolean)
    .sort();

  const nombreCliente = rows[rows.length - 1].nombre_contacto;
  // Último lead / prueba de manejo que sí traiga el dato (el más reciente puede venir vacío).
  const telefonoCliente = ultimoDato(leads, 'telefono') || ultimoDato(pruebasManejo, 'telefono') || null;
  const correoCliente = ultimoDato(leads, 'correo') || ultimoDato(pruebasManejo, 'correo') || null;
  const vins = compras.map((c) => c.vin);
  const [sqlEnrich, unidadesDms] = await Promise.all([
    enrichSql && vins.length
      ? enrichByVins(vins, { fechaInicio, fechaFin })
      : Promise.resolve({ unidades: [], ordenesServicio: [], error: null }),
    enrichSql
      ? getCustomerUnitsDms({ nombre: nombreCliente, telefono: telefonoCliente })
      : Promise.resolve({ unidades: [], error: null }),
  ]);
  const vinsAdicionales = unidadesDms.unidades
    .map((unidad) => unidad.serie)
    .filter((serie) => !vins.some((vin) => matchCrmVinToSerie(vin, serie)));
  const sqlAdicional = enrichSql && vinsAdicionales.length
    ? await enrichByVins(vinsAdicionales, { fechaInicio, fechaFin })
    : { unidades: [], ordenesServicio: [], error: null };
  const ordenIdsCliente = new Set(
    unidadesDms.unidades.flatMap((unidad) => unidad.ordenIds || []).map(String)
  );
  const ordenesById = new Map(
    [...(sqlEnrich.ordenesServicio || []), ...(sqlAdicional.ordenesServicio || [])]
      .map((orden) => [String(orden.orden), orden])
  );
  const ordenesServicio = [...ordenesById.values()]
    .filter((orden) => !ordenIdsCliente.size || ordenIdsCliente.has(String(orden.orden)));
  const ordenesValidas = ordenesServicio.filter(
    (o) => String(o.status || '').trim().toUpperCase() !== 'C'
  );
  const importeTaller = ordenesValidas.reduce((sum, o) => sum + Number(o.importe || 0), 0);
  const importeFacturadoTaller = ordenesValidas.reduce(
    (sum, o) => sum + Number(o.importeFacturado || 0),
    0
  );
  const importeAbiertoTaller = ordenesValidas.reduce(
    (sum, o) => sum + Number(o.importeAbierto || 0),
    0
  );

  // Adjuntar cruce SQL a cada compra. El CRM solo trae el VIN del ciclo;
  // las demás facturas del mismo cliente se suman desde el DMS.
  const comprasCliente = mergeComprasDesdeDms(compras, unidadesDms.unidades);
  const unidadesSql = [...(sqlEnrich.unidades || []), ...(sqlAdicional.unidades || [])];
  const contratosFinanciamiento = getFinanciamientoByVins(d, [
    ...vins,
    ...unidadesDms.unidades.map((unidad) => unidad.serie),
  ]);
  const sqlByVin = new Map(unidadesSql.map((u) => [u.vin, u]));
  for (const compra of comprasCliente) {
    const enr = sqlByVin.get(compra.vin)
      || unidadesSql.find((u) => matchCrmVinToSerie(compra.vin, u.vin) || matchCrmVinToSerie(compra.vin, u.serieSql));
    compra.serieSql = enr?.serieSql || null;
    compra.facturaVentaSql = enr?.facturasVentaSql?.[0]?.facturaVenta || null;
    compra.facturasVentaSql = enr?.facturasVentaSql || [];
    compra.modeloSql = enr?.facturasVentaSql?.[0]?.modelo || null;
    compra.ordenesServicio = (enr?.ordenesServicio || []).filter(
      (orden) => !ordenIdsCliente.size || ordenIdsCliente.has(String(orden.orden))
    );
    compra.totalOrdenes = compra.ordenesServicio.length
      || Number(unidadesDms.unidades.find((u) => matchCrmVinToSerie(compra.vin, u.serie))?.ordenes || 0);
    compra.financiamiento = contratosFinanciamiento.find(
      (contrato) => matchCrmVinToSerie(compra.vin, contrato.vin)
    ) || null;
  }
  const quejasCsi = getCsiQuejasForContact(d, {
    ordenes: ordenesServicio,
    vins: [
      ...vins,
      ...unidadesDms.unidades.map((unidad) => unidad.serie),
      ...contratosFinanciamiento.map((c) => c.vin),
      ...leads.map((l) => l.vin_comprado),
    ],
  });
  const cliente360 = buildCliente360({
    compras: comprasCliente,
    contratos: contratosFinanciamiento,
    unidades: unidadesDms.unidades,
    ordenes: ordenesServicio,
    timeline,
    leads,
    pruebas: pruebasManejo,
    quejasCsi,
  });

  return attachClvToHistory({
    idContacto: id,
    encontrado: true,
    nombre: nombreCliente,
    telefono: telefonoCliente,
    correo: correoCliente,
    vendedor: vendedorAsignado,
    resumen: {
      totalActividades: rows.length,
      totalCiclos: ciclos.length,
      totalCompras: comprasCliente.length,
      totalLeads: leads.length,
      totalSolicitudes: solicitudes.length,
      totalPruebasManejo: pruebasManejo.length,
      totalContratosFinanciamiento: contratosFinanciamiento.length,
      totalPvas: contratosFinanciamiento.reduce((sum, contrato) => sum + contrato.pvas.length, 0),
      realizoPruebaManejo: pruebasManejo.length > 0,
      pruebaManejoConCompra: pruebasManejo.length > 0 && comprasCliente.length > 0,
      totalUnidadesDistribuidor: unidadesDms.unidades.length,
      totalOrdenesServicio: ordenesServicio.length,
      totalQuejas: quejasCsi.total,
      totalQuejasPosventa: quejasCsi.totalPosventa,
      totalQuejasVentas: quejasCsi.totalVentas,
      quejasAreaPrincipal: quejasCsi.areaPrincipal,
      importeTaller,
      importeFacturadoTaller,
      importeAbiertoTaller,
      primeraActividad: fechas[0] || null,
      ultimaActividad: fechas[fechas.length - 1] || null,
      estatusCiclos: ciclos.reduce((acc, c) => {
        const key = c.estatus || 'Sin estatus';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
    },
    ciclos,
    compras: comprasCliente,
    leads,
    solicitudes,
    pruebasManejo,
    contratosFinanciamiento,
    timeline,
    quejasCsi,
    ficha360: cliente360.consolidado,
    unidadesRadiografia: cliente360.porUnidad,
    timeline360: cliente360.timeline,
    timelineTruncado: rows.length > maxActividades,
    unidadesSql,
    unidadesDistribuidor: unidadesDms.unidades,
    ordenesServicio,
    periodoOrdenes: { fechaInicio, fechaFin },
    sqlError: sqlEnrich.error || sqlAdicional.error || unidadesDms.error,
  }, {
    contratos: contratosFinanciamiento,
    ordenes: ordenesServicio,
    unidadesSql,
    fechaInicio,
    fechaFin,
    vinsForPrev: [
      ...vins,
      ...unidadesDms.unidades.map((unidad) => unidad.serie),
    ].filter(Boolean),
  });
}

/**
 * Índice VIN → ID CRM desde crm_actividades (col T), en memoria.
 * Sirve para cruzar series completas del DMS con los VIN (a veces cortos) del CRM.
 */
let vinIndexCache = null;
function getVinIndex() {
  if (vinIndexCache) return vinIndexCache;
  const d = getDb();
  const byVin = new Map();
  const lengths = new Set();
  const add = (vinRaw, idRaw) => {
    const vin = normalizeVin(vinRaw);
    const id = idRaw != null ? String(idRaw).trim() : '';
    if (!vin || vin.length < 5 || !id) return;
    if (!byVin.has(vin)) byVin.set(vin, id);
    lengths.add(vin.length);
  };
  for (const r of d.prepare(`
    SELECT DISTINCT upper(trim(vin)) AS vin, id_contacto
    FROM crm_actividades
    WHERE vin IS NOT NULL AND length(trim(vin)) >= 5
  `).all()) {
    add(r.vin, r.id_contacto);
  }
  if (hasLeadsTable(d)) {
    for (const r of d.prepare(`
      SELECT DISTINCT upper(trim(vin_comprado)) AS vin, id_crm
      FROM crm_leads
      WHERE vin_comprado IS NOT NULL AND length(trim(vin_comprado)) >= 5 AND id_crm IS NOT NULL
    `).all()) {
      add(r.vin, r.id_crm);
    }
  }
  vinIndexCache = { byVin, lengths: [...lengths].sort((a, b) => b - a) };
  return vinIndexCache;
}

let facturaIndexCache = null;
function getFacturaIndex() {
  if (facturaIndexCache) return facturaIndexCache;
  const d = getDb();
  const map = new Map();
  const add = (facturaRaw, idRaw) => {
    const factura = String(facturaRaw || '').trim().toUpperCase();
    const id = idRaw != null ? String(idRaw).trim() : '';
    if (!factura || !id) return;
    if (!map.has(factura)) map.set(factura, new Set());
    map.get(factura).add(id);
  };
  for (const r of d.prepare(`
    SELECT DISTINCT upper(trim(num_factura)) AS factura, id_contacto
    FROM crm_actividades
    WHERE num_factura IS NOT NULL AND trim(num_factura) <> '' AND id_contacto IS NOT NULL
  `).all()) {
    add(r.factura, r.id_contacto);
  }
  facturaIndexCache = map;
  return map;
}

function resolveIdCrmByFactura(factura) {
  const key = String(factura || '').trim().toUpperCase();
  if (!key) return null;
  const ids = getFacturaIndex().get(key);
  return ids && ids.size === 1 ? [...ids][0] : null;
}

/** Resolver ID CRM a partir de una serie completa del DMS (match exacto o por sufijo). */
function resolveIdCrmBySerie(serie) {
  const s = normalizeVin(serie);
  if (!s) return null;
  const { byVin, lengths } = getVinIndex();
  if (byVin.has(s)) return byVin.get(s);
  for (const len of lengths) {
    if (len >= s.length) continue;
    const sufijo = s.slice(-len);
    if (byVin.has(sufijo)) return byVin.get(sufijo);
  }
  return null;
}

/**
 * Índices nombre → ID CRM y teléfono → ID CRM (todas las fuentes internas).
 * Respaldo cuando la serie del DMS no tiene VIN en la columna T del CRM.
 * Solo vinculan cuando el nombre/teléfono corresponde a UN único ID CRM.
 */
let nameIndexCache = null;
let phoneIndexCache = null;

function normalizeNombre(v) {
  if (!v) return null;
  const s = String(v)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  return s.length >= 8 ? s : null;
}

function nombreTokens(v) {
  return String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function nombreSimilitud(a, b) {
  const ta = new Set(nombreTokens(a));
  const tb = new Set(nombreTokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = new Set([...ta, ...tb]).size || 1;
  return inter / union;
}

function esNombreLeadSospechoso(nombre) {
  const n = String(nombre || '').trim();
  if (!n) return true;
  return /AN[OÓ]NIMO|SIN\s*NOMBRE|PRUEBA|TEST\b|DEMO\b|XXXX|N\/A|NO\s*NAME|CLIENTE\s*GENERICO|CLIENTE\s*GEN[EÉ]RICO/i.test(n);
}

/**
 * Compras de la cohorte donde el nombre del lead no coincide con el del comprador (VIN),
 * o el lead es anónimo/genérico — típico de reclasificación para forzar conversión.
 */
function buildAlertasConversionCompras(d, { whereSql, params, compraSql, limit = 40 }) {
  const max = Math.min(80, Math.max(10, Number(limit) || 40));
  const rows = d.prepare(`
    SELECT
      id_crm AS idCrm,
      nombre AS nombreLead,
      fecha_entrada AS fechaEntrada,
      campana,
      ejecutivo_asignado AS ejecutivo,
      resultado,
      (
        SELECT a.nombre_contacto FROM crm_actividades a
        WHERE a.id_contacto = crm_leads.id_crm
          AND a.vin IS NOT NULL AND trim(a.vin) <> ''
        ORDER BY COALESCE(a.fecha_factura, a.fecha_entrega, a.fecha_estatus, a.fecha_inicio_ciclo) DESC
        LIMIT 1
      ) AS nombreCompra,
      (
        SELECT a.vin FROM crm_actividades a
        WHERE a.id_contacto = crm_leads.id_crm
          AND a.vin IS NOT NULL AND trim(a.vin) <> ''
        ORDER BY COALESCE(a.fecha_factura, a.fecha_entrega, a.fecha_estatus, a.fecha_inicio_ciclo) DESC
        LIMIT 1
      ) AS vin,
      COALESCE(
        NULLIF(trim(fecha_factura), ''),
        (
          SELECT COALESCE(a.fecha_factura, a.fecha_entrega, a.fecha_estatus)
          FROM crm_actividades a
          WHERE a.id_contacto = crm_leads.id_crm
            AND a.vin IS NOT NULL AND trim(a.vin) <> ''
          ORDER BY COALESCE(a.fecha_factura, a.fecha_entrega, a.fecha_estatus, a.fecha_inicio_ciclo) DESC
          LIMIT 1
        )
      ) AS fechaCompra
    FROM crm_leads
    ${whereSql}
      AND (${compraSql}) = 1
    ORDER BY fecha_entrada DESC
    LIMIT 2000
  `).all(...params);

  const alertas = [];
  for (const r of rows) {
    const nombreLead = String(r.nombreLead || '').trim() || '(sin nombre)';
    const nombreCompra = String(r.nombreCompra || '').trim() || null;
    const anonimo = esNombreLeadSospechoso(nombreLead);
    const sim = nombreCompra ? nombreSimilitud(nombreLead, nombreCompra) : 0;
    const desfaseNombre = !!(nombreCompra && sim < 0.34);
    if (!anonimo && !desfaseNombre) continue;

    const motivos = [];
    if (anonimo) motivos.push('Lead anónimo / genérico');
    if (desfaseNombre) motivos.push('Nombre del lead ≠ comprador del VIN');

    alertas.push({
      idCrm: r.idCrm ? String(r.idCrm) : null,
      nombreLead,
      nombreCompra,
      vin: r.vin ? String(r.vin).trim().toUpperCase() : null,
      fechaEntrada: r.fechaEntrada ? String(r.fechaEntrada).slice(0, 10) : null,
      fechaCompra: r.fechaCompra ? String(r.fechaCompra).slice(0, 10) : null,
      campana: String(r.campana || '').trim() || null,
      ejecutivo: String(r.ejecutivo || '').trim() || null,
      similitudPct: Math.round(sim * 100),
      anonimo,
      desfaseNombre,
      motivos,
      severidad: anonimo && desfaseNombre ? 'critical' : 'warning',
    });
  }

  alertas.sort((a, b) => {
    const sev = (a.severidad === 'critical' ? 0 : 1) - (b.severidad === 'critical' ? 0 : 1);
    if (sev !== 0) return sev;
    return String(b.fechaCompra || '').localeCompare(String(a.fechaCompra || ''));
  });

  return {
    total: alertas.length,
    mostrados: Math.min(max, alertas.length),
    texto: 'Compras de la cohorte donde el nombre del lead no coincide con el comprador del VIN, o el lead es anónimo/genérico (posible reclasificación para conversión).',
    items: alertas.slice(0, max),
  };
}

function normalizeTelefono(v) {
  const digits = String(v || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

function getNameIndex() {
  if (nameIndexCache) return nameIndexCache;
  const d = getDb();
  const map = new Map();
  const add = (nombre, id) => {
    const key = normalizeNombre(nombre);
    if (!key || id == null) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(String(id));
  };
  for (const r of d.prepare('SELECT DISTINCT nombre_contacto AS n, id_contacto AS i FROM crm_actividades').all()) add(r.n, r.i);
  if (hasLeadsTable(d)) {
    for (const r of d.prepare('SELECT DISTINCT nombre AS n, id_crm AS i FROM crm_leads WHERE id_crm IS NOT NULL').all()) add(r.n, r.i);
  }
  if (hasSolicitudesTable(d)) {
    for (const r of d.prepare('SELECT DISTINCT nombre_cliente AS n, id_crm AS i FROM crm_solicitudes WHERE id_crm IS NOT NULL').all()) add(r.n, r.i);
  }
  if (hasPruebasManejoTable(d)) {
    for (const r of d.prepare('SELECT DISTINCT nombre_cliente AS n, id_crm AS i FROM crm_pruebas_manejo WHERE id_crm IS NOT NULL').all()) add(r.n, r.i);
  }
  nameIndexCache = map;
  return map;
}

function getPhoneIndex() {
  if (phoneIndexCache) return phoneIndexCache;
  const d = getDb();
  const map = new Map();
  const add = (tel, id) => {
    const key = normalizeTelefono(tel);
    if (!key || id == null) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(String(id));
  };
  if (hasLeadsTable(d)) {
    for (const r of d.prepare('SELECT DISTINCT telefono AS t, id_crm AS i FROM crm_leads WHERE id_crm IS NOT NULL AND telefono IS NOT NULL').all()) add(r.t, r.i);
  }
  if (hasPruebasManejoTable(d)) {
    for (const r of d.prepare('SELECT DISTINCT telefono AS t, id_crm AS i FROM crm_pruebas_manejo WHERE id_crm IS NOT NULL AND telefono IS NOT NULL').all()) add(r.t, r.i);
  }
  phoneIndexCache = map;
  return map;
}

function resolveIdCrmByNombre(nombre) {
  const key = normalizeNombre(nombre);
  if (!key) return null;
  const ids = getNameIndex().get(key);
  return ids && ids.size === 1 ? [...ids][0] : null;
}

function resolveIdCrmByTelefono(telefono) {
  const key = normalizeTelefono(telefono);
  if (!key) return null;
  const ids = getPhoneIndex().get(key);
  return ids && ids.size === 1 ? [...ids][0] : null;
}

/**
 * Clientes con órdenes de servicio CERRADAS en un periodo (ORE_FECHACIE),
 * con importe generado en taller y cruce a ID CRM vía VIN/serie;
 * si la serie no está en el CRM, respaldo por nombre y teléfono.
 */
async function getCierresTallerPeriodo({ fechaInicio, fechaFin, limit = 200 } = {}) {
  if (!fechaInicio || !fechaFin) {
    throw new Error('fechaInicio y fechaFin son requeridos (YYYY-MM-DD)');
  }
  const max = Math.min(500, Math.max(1, Number(limit) || 200));

  // Las órdenes cerradas del periodo se piden en cada carga de la pantalla;
  // compartir el resultado unos minutos evita repetir la consulta pesada.
  const rows = await ttlCache('cierresTaller', `${fechaInicio}|${fechaFin}`, CIERRES_TTL_MS, () => query(`
    SELECT TOP 5000
      o.ORE_IDCLIENTE AS idClienteDms,
      LTRIM(RTRIM(ISNULL(c.PER_NOMRAZON, '') + ' ' + ISNULL(c.PER_PATERNO, '') + ' ' + ISNULL(c.PER_MATERNO, ''))) AS cliente,
      LTRIM(RTRIM(c.PER_TELEFONO1)) AS telefono,
      LTRIM(RTRIM(c.PER_TELCELULAR)) AS celular,
      o.ORE_IDORDEN AS orden,
      UPPER(LTRIM(RTRIM(o.ORE_NUMSERIE))) AS serie,
      o.ORE_FECHAORD AS ingreso,
      o.ORE_FECHACIE AS cierre,
      o.ORE_STATUS AS status,
      LTRIM(RTRIM(COALESCE(NULLIF(veh.VEH_TIPOAUTO, ''), fac.autoFac, ''))) AS modelo,
      LTRIM(RTRIM(COALESCE(asr.PAR_DESCRIP1, o.ORE_IDASESOR, ''))) AS asesor,
      ISNULL(fac.importe, 0) AS importeFac,
      ISNULL(tcx.importe, 0) AS importeTcx,
      ISNULL(det.subtotal, 0) AS importeDetSub,
      ISNULL(det.iva, 0) AS importeDetIva
    FROM SER_ORDEN o
    LEFT JOIN PER_PERSONAS c ON c.PER_IDPERSONA = o.ORE_IDCLIENTE
    LEFT JOIN SER_VEHICULO veh ON veh.VEH_NUMSERIE = o.ORE_NUMSERIE
    OUTER APPLY (
      SELECT MAX(f.fos_docto) AS factura, MAX(f.fos_qctipoauto) AS autoFac, SUM(f.fos_total) AS importe
      FROM SER_FACORDEN f
      WHERE f.fos_idorden = o.ORE_IDORDEN
    ) fac
    OUTER APPLY (
      SELECT SUM(t.TCX_TOTAL) AS importe
      FROM SER_ORDTOTCXP t
      WHERE t.TCX_IDORDEN = o.ORE_IDORDEN
        AND t.TCX_STATUS IN ('T', 'A')
    ) tcx
    OUTER APPLY (
      SELECT SUM(d.ORD_SUBTOTAL) AS subtotal, SUM(d.ORD_IVATOT) AS iva
      FROM SER_ORDENDET d
      WHERE d.ORD_IDORDEN = o.ORE_IDORDEN
    ) det
    LEFT JOIN PNC_PARAMETR asr
      ON asr.PAR_TIPOPARA = 'AS' AND asr.PAR_IDENPARA = o.ORE_IDASESOR
    WHERE o.ORE_FECHACIE IS NOT NULL
      AND LTRIM(RTRIM(o.ORE_FECHACIE)) <> ''
      AND CONVERT(DATE, o.ORE_FECHACIE, 103) >= @fechaInicio
      AND CONVERT(DATE, o.ORE_FECHACIE, 103) <= @fechaFin
      AND o.ORE_STATUS <> 'C'
      AND UPPER(ISNULL(c.PER_NOMRAZON, '') + ' ' + ISNULL(c.PER_PATERNO, '') + ' ' + ISNULL(c.PER_MATERNO, ''))
        NOT LIKE '%AUTOMOTRIZ%BALDERRAMA%PUEBLA%'
    ORDER BY CONVERT(DATE, o.ORE_FECHACIE, 103) DESC
  `, { fechaInicio, fechaFin }));

  const clientes = new Map();
  let importeTotal = 0;

  for (const row of rows) {
    const importeFac = Number(row.importeFac || 0);
    const importeDet = Number(row.importeDetSub || 0) + Number(row.importeDetIva || 0);
    const importe = importeFac > 0 ? importeFac : (importeDet > 0 ? importeDet : Number(row.importeTcx || 0));
    importeTotal += importe;

    const key = row.idClienteDms || `sin-cliente:${row.orden}`;
    if (!clientes.has(key)) {
      clientes.set(key, {
        idClienteDms: row.idClienteDms || null,
        cliente: row.cliente || '(Sin nombre)',
        telefono: row.telefono || row.celular || null,
        idCrm: null,
        ordenes: 0,
        importe: 0,
        series: new Set(),
        modelos: new Set(),
        ultimaActividad: null,
      });
    }
    const cli = clientes.get(key);
    cli.ordenes += 1;
    cli.importe += importe;
    if (row.serie) cli.series.add(row.serie);
    if (row.modelo) cli.modelos.add(row.modelo);
    const cierre = toIsoDate(row.cierre);
    if (cierre && (!cli.ultimaActividad || cierre > cli.ultimaActividad)) cli.ultimaActividad = cierre;
    if (!cli.idCrm && row.serie) cli.idCrm = resolveIdCrmBySerie(row.serie);
  }

  // Respaldo: si la serie del taller no está en la col T del CRM,
  // usar la base Balderrama Ciclos (y leads/solicitudes/pruebas) por nombre o teléfono.
  for (const cli of clientes.values()) {
    if (cli.idCrm) continue;
    cli.idCrm = resolveIdCrmByNombre(cli.cliente)
      || resolveIdCrmByTelefono(cli.telefono)
      || null;
  }

  const idsCrm = [...clientes.values()].map((c) => c.idCrm).filter(Boolean);
  const ultimaActividadById = getUltimaActividadByIds(idsCrm);
  const perfilById = getPerfilCalidadByIds(idsCrm);
  for (const cliente of clientes.values()) {
    const fechaCrm = cliente.idCrm
      ? ultimaActividadById.get(String(cliente.idCrm))
      : null;
    if (fechaCrm && (!cliente.ultimaActividad || fechaCrm > cliente.ultimaActividad)) {
      cliente.ultimaActividad = fechaCrm;
    }
    const perfil = cliente.idCrm ? perfilById.get(String(cliente.idCrm)) : null;
    const nombreCoincide = perfil ? nombresCoinciden(cliente.cliente, perfil.nombreCrm) : false;
    const score = scoreCalidadCliente(perfil, {
      telefonoDms: cliente.telefono, nombre: cliente.cliente, nombreCoincide,
    });
    cliente.calidad = {
      score,
      nombreCrm: perfil?.nombreCrm || null,
      nombreCoincide,
      compras: perfil?.compras || 0,
      actividades: perfil?.actividades || 0,
      ciclos: perfil?.ciclos || 0,
      tieneTelefono: Boolean(perfil?.tieneTelefono),
      tieneCorreo: Boolean(perfil?.tieneCorreo),
      tieneFactura: Boolean(perfil?.tieneFactura),
      // Expediente "completo": el contacto CRM es la misma persona que en el DMS,
      // tiene unidad comprada, teléfono en CRM y actividad registrada.
      completo: Boolean(cliente.idCrm && perfil && nombreCoincide && perfil.compras > 0
        && perfil.tieneTelefono && perfil.actividades > 0),
    };
  }

  const lista = [...clientes.values()]
    .map((c) => ({
      ...c,
      series: [...c.series].slice(0, 5),
      modelos: [...c.modelos].slice(0, 5),
      importe: Math.round(c.importe * 100) / 100,
    }))
    .sort((a, b) => b.importe - a.importe)
    .slice(0, max);

  return {
    periodo: { fechaInicio, fechaFin },
    totales: {
      ordenesCerradas: rows.length,
      clientes: clientes.size,
      clientesConIdCrm: lista.filter((c) => c.idCrm).length,
      clientesCompletos: lista.filter((c) => c.calidad?.completo).length,
      importeTaller: Math.round(importeTotal * 100) / 100,
    },
    clientes: lista,
  };
}

const LEAD_GROUP_FIELDS = {
  canal: 'canal',
  sucursal: 'sucursal',
  tipo: 'tipo',
  campana: 'campana',
  resultado: 'resultado',
  fuerza_ventas: 'fuerza_ventas',
  ejecutivo: 'ejecutivo_asignado',
  estatus_compra: 'estatus_compra',
  auto_interes: 'auto_interes',
  mes: `substr(fecha_entrada, 1, 7)`,
};

function formatIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Convierte periodos relativos usados por el agente IA en fechas concretas.
 * Las fechas explícitas tienen prioridad.
 */
function resolveCrmPeriod({ periodo = null, desde = null, hasta = null } = {}) {
  if (desde || hasta) {
    return { periodo: 'personalizado', desde: desde || null, hasta: hasta || null };
  }

  const key = String(periodo || 'todo').trim().toLowerCase();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  let start = null;
  let end = null;

  switch (key) {
    case 'hoy':
      start = now;
      end = now;
      break;
    case 'mes_actual':
      start = new Date(year, month, 1);
      end = now;
      break;
    case 'mes_pasado':
      start = new Date(year, month - 1, 1);
      end = new Date(year, month, 0);
      break;
    case 'ultimos_30_dias':
      start = new Date(year, month, now.getDate() - 29);
      end = now;
      break;
    case 'ultimos_90_dias':
      start = new Date(year, month, now.getDate() - 89);
      end = now;
      break;
    case 'trimestre_actual':
      start = new Date(year, Math.floor(month / 3) * 3, 1);
      end = now;
      break;
    case 'semestre_actual':
      start = new Date(year, month < 6 ? 0 : 6, 1);
      end = now;
      break;
    case 'acumulado_anio':
    case 'anio_actual':
      start = new Date(year, 0, 1);
      end = key === 'anio_actual' ? new Date(year, 11, 31) : now;
      break;
    case 'anio_anterior':
      start = new Date(year - 1, 0, 1);
      end = new Date(year - 1, 11, 31);
      break;
    case 'todo':
    default:
      return { periodo: 'todo', desde: null, hasta: null };
  }

  return {
    periodo: key,
    desde: formatIsoDate(start),
    hasta: formatIsoDate(end),
  };
}

/**
 * Resumen agregado de leads (interesados) con filtros de fecha y agrupación.
 * agruparPor: canal | sucursal | tipo | campana | resultado | fuerza_ventas |
 *             ejecutivo | estatus_compra | auto_interes | mes
 */
function getLeadsSummary({
  periodo = null,
  desde = null,
  hasta = null,
  agruparPor = 'canal',
  limit = 30,
} = {}) {
  const d = getDb();
  if (!hasLeadsTable(d)) throw new Error('Tabla de leads no cargada. Ejecute: node backend/scripts/etl-crm-leads.js');

  const rango = resolveCrmPeriod({ periodo, desde, hasta });
  desde = rango.desde;
  hasta = rango.hasta;
  const groupExpr = LEAD_GROUP_FIELDS[agruparPor] || LEAD_GROUP_FIELDS.canal;
  const max = Math.min(100, Math.max(1, Number(limit) || 30));

  const where = [getLeadNotDuplicateSql()];
  const params = [];
  if (desde) { where.push('substr(fecha_entrada, 1, 10) >= ?'); params.push(String(desde).slice(0, 10)); }
  if (hasta) { where.push('substr(fecha_entrada, 1, 10) <= ?'); params.push(String(hasta).slice(0, 10)); }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  // Compra = el ID CRM del lead tiene al menos un VIN en ciclos (col T),
  // o el propio lead trae vin_comprado.
  const compraExpr = `
    CASE WHEN (
      (vin_comprado IS NOT NULL AND trim(vin_comprado) <> '')
      OR EXISTS (
        SELECT 1 FROM crm_actividades a
        WHERE a.id_contacto = crm_leads.id_crm
          AND a.vin IS NOT NULL AND trim(a.vin) <> ''
      )
    ) THEN 1 ELSE 0 END
  `;

  const grupos = d.prepare(`
    SELECT
      COALESCE(${groupExpr}, '(sin dato)') AS grupo,
      COUNT(*) AS leads,
      SUM(CASE WHEN contacto = 'SI' THEN 1 ELSE 0 END) AS contactados,
      SUM(CASE WHEN cita_programada = 'SI' THEN 1 ELSE 0 END) AS citas,
      SUM(${compraExpr}) AS compras
    FROM crm_leads
    ${whereSql}
    GROUP BY grupo
    ORDER BY leads DESC
    LIMIT ?
  `).all(...params, max);

  const totales = d.prepare(`
    SELECT COUNT(*) AS leads,
      SUM(CASE WHEN contacto = 'SI' THEN 1 ELSE 0 END) AS contactados,
      SUM(CASE WHEN cita_programada = 'SI' THEN 1 ELSE 0 END) AS citas,
      SUM(${compraExpr}) AS compras
    FROM crm_leads ${whereSql}
  `).get(...params);
  for (const key of ['leads', 'contactados', 'citas', 'compras']) {
    totales[key] = Number(totales[key] || 0);
  }

  return {
    filtros: rango,
    agruparPor: agruparPor in LEAD_GROUP_FIELDS ? agruparPor : 'canal',
    reglaCompra: 'VIN en ciclo CRM (col T) del mismo ID CRM, o vin_comprado en el lead',
    semantica: {
      cohorte: 'El periodo filtra fecha_entrada del lead',
      compras: 'Cantidad de leads de la cohorte vinculados a compra por ID CRM + VIN; la compra puede ser posterior al periodo',
      noEsVentasTotales: 'No equivale al total de facturas o ventas del DMS en el periodo',
    },
    totales,
    grupos,
  };
}

const COMPRA_LEAD_SQL = `
  CASE WHEN (
    (vin_comprado IS NOT NULL AND trim(vin_comprado) <> '')
    OR EXISTS (
      SELECT 1 FROM crm_actividades a
      WHERE a.id_contacto = crm_leads.id_crm
        AND a.vin IS NOT NULL AND trim(a.vin) <> ''
    )
  ) THEN 1 ELSE 0 END
`;

/** Compra atribuible al lead: VIN + fecha de compra ≥ entrada y dentro de vida útil. */
function getCompraLeadAtribuibleSql(dias = 90) {
  return buildCompraLeadDentroVidaSql(dias);
}

/** Excluye leads marcados DUPLICADO en columna AB (Resultado) / flag es_duplicado. */
let leadNotDuplicateSqlCache = null;
let leadIsDuplicateSqlCache = null;

function getLeadNotDuplicateSql() {
  if (leadNotDuplicateSqlCache) return leadNotDuplicateSqlCache;
  const parts = [
    `upper(trim(COALESCE(resultado, ''))) <> 'DUPLICADO'`,
  ];
  try {
    const d = getDb();
    const cols = new Set(
      d.prepare('PRAGMA table_info(crm_leads)').all().map((c) => c.name),
    );
    if (cols.has('es_duplicado')) {
      parts.push('COALESCE(es_duplicado, 0) = 0');
    }
  } catch {
    /* tabla aún no disponible */
  }
  leadNotDuplicateSqlCache = parts.join(' AND ');
  return leadNotDuplicateSqlCache;
}

/** Marca positiva de duplicado (columna AB Resultado = DUPLICADO). */
function getLeadIsDuplicateSql() {
  if (leadIsDuplicateSqlCache) return leadIsDuplicateSqlCache;
  const parts = [
    `upper(trim(COALESCE(resultado, ''))) = 'DUPLICADO'`,
  ];
  try {
    const d = getDb();
    const cols = new Set(
      d.prepare('PRAGMA table_info(crm_leads)').all().map((c) => c.name),
    );
    if (cols.has('es_duplicado')) {
      parts.push('COALESCE(es_duplicado, 0) = 1');
    }
  } catch {
    /* tabla aún no disponible */
  }
  leadIsDuplicateSqlCache = `(${parts.join(' OR ')})`;
  return leadIsDuplicateSqlCache;
}

function clearLeadNotDuplicateSqlCache() {
  leadNotDuplicateSqlCache = null;
  leadIsDuplicateSqlCache = null;
}

/** Resultados de contacto que se consideran descartados / no recuperables. */
const LEAD_DESCARTADO_RESULTADOS = [
  '# NO EXISTE',
  '# EQUIVOCADO',
  'FUERA AREA SERVICIO',
  'FUERA ÁREA SERVICIO',
  'NO PIDIO INFORMES',
  'NO PIDIÓ INFORMES',
  'CUELGA LLAMADA',
  'DESCARTADO',
  'DESISTIO',
  'DESISTIÓ',
  'PERDIDO',
];

function getLeadDescartadoSql() {
  const escaped = LEAD_DESCARTADO_RESULTADOS
    .map((v) => `'${String(v).replace(/'/g, "''")}'`)
    .join(', ');
  return `(
    upper(trim(COALESCE(resultado, ''))) IN (${escaped})
    OR upper(trim(COALESCE(resultado, ''))) LIKE '%DESCART%'
    OR upper(trim(COALESCE(resultado, ''))) LIKE '%DESIST%'
  )`;
}

/** Lead a monitorear: en seguimiento, o con prueba de manejo / solicitud de crédito; sin compra y no descartado. */
function getLeadSeguimientoSinCompraSql() {
  const engagement = [
    `upper(trim(COALESCE(resultado, ''))) LIKE '%SEGUIMIENTO%'`,
  ];
  try {
    const d = getDb();
    if (hasPruebasManejoTable(d)) {
      engagement.push(`EXISTS (
        SELECT 1 FROM crm_pruebas_manejo p
        WHERE p.id_crm IS NOT NULL AND trim(p.id_crm) <> ''
          AND p.id_crm = crm_leads.id_crm
          AND (
            p.fecha IS NULL OR trim(p.fecha) = ''
            OR julianday(substr(p.fecha, 1, 10)) >= julianday(crm_leads.fecha_entrada)
          )
      )`);
    }
    if (hasSolicitudesTable(d)) {
      engagement.push(`EXISTS (
        SELECT 1 FROM crm_solicitudes s
        WHERE s.id_crm IS NOT NULL AND trim(s.id_crm) <> ''
          AND s.id_crm = crm_leads.id_crm
          AND (
            COALESCE(s.fecha_solicitud, s.fecha_compra, s.fecha_firma) IS NULL
            OR trim(COALESCE(s.fecha_solicitud, s.fecha_compra, s.fecha_firma)) = ''
            OR julianday(substr(COALESCE(s.fecha_solicitud, s.fecha_compra, s.fecha_firma), 1, 10))
              >= julianday(crm_leads.fecha_entrada)
          )
      )`);
    }
  } catch {
    /* tablas aún no disponibles */
  }
  return `(
    (${COMPRA_LEAD_SQL}) = 0
    AND NOT ${getLeadDescartadoSql()}
    AND (${engagement.join('\n    OR ')})
  )`;
}

/** Resta/suma días a una fecha ISO yyyy-mm-dd. */
function shiftIsoDays(iso, days) {
  const raw = String(iso || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

/**
 * Pipeline a monitorear para cierre: únicos sin compra, con vida activa
 * (fecha_entrada en [hasta - vidaDías, hasta]) y con señal de avance:
 * resultado en seguimiento, prueba de manejo o solicitud de crédito.
 */
function buildSeguimientoVidaActivaQuery({ notDupSql, hasta, vidaDias = null }) {
  const { LEAD_VIDA_DIAS } = require('../config/campanasConversion');
  const vida = Math.max(1, Number(vidaDias) || LEAD_VIDA_DIAS || 90);
  const refHasta = String(hasta || formatIsoDate(new Date())).slice(0, 10);
  const desdeVida = shiftIsoDays(refHasta, -vida) || refHasta;
  const where = [
    notDupSql,
    `fecha_entrada IS NOT NULL AND trim(fecha_entrada) <> ''`,
    'substr(fecha_entrada, 1, 10) >= ?',
    'substr(fecha_entrada, 1, 10) <= ?',
    getLeadSeguimientoSinCompraSql(),
  ];
  return {
    whereSql: `WHERE ${where.join(' AND ')}`,
    params: [desdeVida, refHasta],
    desdeVida,
    refHasta,
    vidaDias: vida,
  };
}
const FECHA_COMPRA_LEAD_SQL = `
  COALESCE(
    NULLIF(trim(crm_leads.fecha_factura), ''),
    NULLIF(trim(crm_leads.fecha_entrega), ''),
    (
      SELECT COALESCE(a.fecha_factura, a.fecha_entrega, a.fecha_estatus, a.fecha_inicio_ciclo)
      FROM crm_actividades a
      WHERE a.id_contacto = crm_leads.id_crm
        AND a.vin IS NOT NULL AND trim(a.vin) <> ''
      ORDER BY COALESCE(a.fecha_factura, a.fecha_entrega, a.fecha_estatus, a.fecha_inicio_ciclo) DESC
      LIMIT 1
    )
  )
`;

/**
 * Compra válida para campañas documentadas: VIN + fecha de compra
 * dentro de LEAD_VIDA_DIAS desde fecha_entrada.
 */
function buildCompraLeadDentroVidaSql(dias = 90) {
  const life = Math.max(1, Number(dias) || 90);
  return `
    CASE WHEN (
      (${COMPRA_LEAD_SQL}) = 1
      AND crm_leads.fecha_entrada IS NOT NULL
      AND trim(crm_leads.fecha_entrada) <> ''
      AND (${FECHA_COMPRA_LEAD_SQL}) IS NOT NULL
      AND julianday(${FECHA_COMPRA_LEAD_SQL}) >= julianday(crm_leads.fecha_entrada)
      AND (julianday(${FECHA_COMPRA_LEAD_SQL}) - julianday(crm_leads.fecha_entrada)) <= ${life}
    ) THEN 1 ELSE 0 END
  `;
}

/**
 * Dashboard de conversión oportunidades → ventas para la sección Leads en Ventas.
 * Cohorte por fecha_entrada; compra = VIN en ciclo del mismo ID CRM o vin_comprado.
 */
/**
 * Normaliza fuerza de ventas del CRM al catálogo operativo (dispersión de leads).
 */
const FUERZA_VENTAS_ORDER = [
  'MATRIZ PISO',
  'FORANEO DIGITAL',
  'CHOLULA',
  'ZACATELCO PISO',
  'SEMINUEVOS CERTIFICADOS',
  'FLOTILLAS',
  'ADMINISTRATIVO',
  'SuAuto',
];

function normalizeFuerzaVentasLabel(raw) {
  const u = String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!u || u === '(SIN DATO)' || u === 'SIN DATO') return 'Sin fuerza asignada';
  if (u.includes('MATRIZ') && u.includes('PISO')) return 'MATRIZ PISO';
  if (u.includes('FORANEO')) return 'FORANEO DIGITAL';
  if (u.includes('CHOLULA')) return 'CHOLULA';
  if (u.includes('ZACATELCO')) return 'ZACATELCO PISO';
  if (u.includes('SEMINUEVO')) return 'SEMINUEVOS CERTIFICADOS';
  if (u.includes('FLOTILLA')) return 'FLOTILLAS';
  if (u.includes('ADMINISTRATIVO')) return 'ADMINISTRATIVO';
  if (u.includes('SUAUTO') || u.includes('SU AUTO')) return 'SuAuto';
  return String(raw || '').trim() || 'Sin fuerza asignada';
}

function aggregateFuerzaVentas(rows = []) {
  const map = new Map();
  for (const r of rows) {
    const grupo = normalizeFuerzaVentasLabel(r.grupo);
    if (!map.has(grupo)) {
      map.set(grupo, {
        grupo,
        leads: 0,
        contactados: 0,
        citas: 0,
        cotizados: 0,
        compras: 0,
      });
    }
    const b = map.get(grupo);
    b.leads += Number(r.leads || 0);
    b.contactados += Number(r.contactados || 0);
    b.citas += Number(r.citas || 0);
    b.cotizados += Number(r.cotizados || 0);
    b.compras += Number(r.compras || 0);
  }

  const totalLeads = [...map.values()].reduce((s, r) => s + r.leads, 0);
  const pct = (num, den) => (den ? Math.round((num / den) * 10000) / 100 : 0);

  const known = FUERZA_VENTAS_ORDER
    .map((name) => map.get(name) || {
      grupo: name, leads: 0, contactados: 0, citas: 0, cotizados: 0, compras: 0,
    })
    .map((r) => ({
      ...r,
      conversionPct: pct(r.compras, r.leads),
      participacionPct: pct(r.leads, totalLeads),
    }));

  const extras = [...map.values()]
    .filter((r) => !FUERZA_VENTAS_ORDER.includes(r.grupo) && r.grupo !== 'Sin fuerza asignada')
    .sort((a, b) => b.leads - a.leads)
    .map((r) => ({
      ...r,
      conversionPct: pct(r.compras, r.leads),
      participacionPct: pct(r.leads, totalLeads),
    }));

  const sinAsignar = map.get('Sin fuerza asignada');
  const out = [...known, ...extras];
  if (sinAsignar && sinAsignar.leads > 0) {
    out.push({
      ...sinAsignar,
      conversionPct: pct(sinAsignar.compras, sinAsignar.leads),
      participacionPct: pct(sinAsignar.leads, totalLeads),
    });
  }

  const totales = out.reduce((acc, r) => {
    acc.leads += r.leads;
    acc.contactados += r.contactados;
    acc.citas += r.citas;
    acc.cotizados += r.cotizados;
    acc.compras += r.compras;
    return acc;
  }, { leads: 0, contactados: 0, citas: 0, cotizados: 0, compras: 0 });

  return {
    filas: out,
    totales: {
      ...totales,
      conversionPct: pct(totales.compras, totales.leads),
      participacionPct: 100,
    },
  };
}

/** Filtro SQL adicional por KPI del embudo de leads (misma lógica que summary). */
function leadKpiExtraWhere(kpi, { compraSql = null } = {}) {
  const key = String(kpi || '').trim();
  const compra = compraSql || COMPRA_LEAD_SQL;
  const cotizadoSql = `(cotizacion IS NOT NULL AND trim(cotizacion) <> '' AND upper(trim(cotizacion)) NOT IN ('NO','N','0'))`;
  switch (key) {
    case 'contactados':
      return `contacto = 'SI'`;
    case 'citas':
      return `cita_programada = 'SI'`;
    case 'cotizados':
      return cotizadoSql;
    case 'compras':
    case 'convCompra':
      return `(${compra}) = 1`;
    case 'sinCompra':
      return getLeadDescartadoSql();
    case 'convCitaCompra':
      return `cita_programada = 'SI' AND (${compra}) = 1`;
    case 'convContactoCompra':
      return `contacto = 'SI' AND (${compra}) = 1`;
    case 'seguimientoSinCompra':
    case 'enSeguimiento':
      return getLeadSeguimientoSinCompraSql();
    case 'leads':
    case 'leadsUnicos':
      return null;
    case 'leadsDuplicados':
      return null;
    default:
      return null;
  }
}

function mapLeadDetalleRow(r) {
  const vin = String(r.vinComprado || r.vinCiclo || '').trim() || null;
  const conCompra = Number(r.conCompra || 0) === 1;
  return {
    idCrm: String(r.idCrm || '').trim() || null,
    idOportunidad: String(r.idOportunidad || '').trim() || null,
    nombre: String(r.nombre || '').trim() || null,
    telefono: String(r.telefono || '').trim() || null,
    fechaEntrada: r.fechaEntrada || null,
    canal: String(r.canal || '').trim() || null,
    sucursal: String(r.sucursal || '').trim() || null,
    tipo: String(r.tipo || '').trim() || null,
    campana: String(r.campana || '').trim() || null,
    ejecutivo: String(r.ejecutivo || '').trim() || null,
    fuerzaVentas: String(r.fuerzaVentas || '').trim() || null,
    contactado: String(r.contacto || '').trim().toUpperCase() === 'SI',
    cita: String(r.citaProgramada || '').trim().toUpperCase() === 'SI',
    fechaCita: r.fechaCita || null,
    cotizado: !!(r.cotizacion && String(r.cotizacion).trim() && !['NO', 'N', '0'].includes(String(r.cotizacion).trim().toUpperCase())),
    autoInteres: String(r.autoInteres || '').trim() || null,
    resultado: String(r.resultado || '').trim() || null,
    conCompra,
    conPruebaManejo: Number(r.conPruebaManejo || 0) === 1,
    conSolicitud: Number(r.conSolicitud || 0) === 1,
    vin,
    fechaFactura: r.fechaFactura || null,
    estatusCompra: String(r.estatusCompra || '').trim() || null,
    estatusCiclo: String(r.estatusCiclo || '').trim() || null,
    etapa: conCompra
      ? 'compra'
      : (String(r.citaProgramada || '').trim().toUpperCase() === 'SI'
        ? 'cita'
        : (String(r.contacto || '').trim().toUpperCase() === 'SI' ? 'contacto' : 'lead')),
  };
}

function queryLeadsDetalleRows(d, { whereSql, params, limit }) {
  const max = Math.min(20000, Math.max(1, Number(limit) || 400));
  const pruebaSql = hasPruebasManejoTable(d)
    ? `EXISTS (
        SELECT 1 FROM crm_pruebas_manejo p
        WHERE p.id_crm = crm_leads.id_crm
          AND p.id_crm IS NOT NULL AND trim(p.id_crm) <> ''
          AND (
            p.fecha IS NULL OR trim(p.fecha) = ''
            OR julianday(substr(p.fecha, 1, 10)) >= julianday(crm_leads.fecha_entrada)
          )
      )`
    : '0';
  const solSql = hasSolicitudesTable(d)
    ? `EXISTS (
        SELECT 1 FROM crm_solicitudes s
        WHERE s.id_crm = crm_leads.id_crm
          AND s.id_crm IS NOT NULL AND trim(s.id_crm) <> ''
          AND (
            COALESCE(s.fecha_solicitud, s.fecha_compra, s.fecha_firma) IS NULL
            OR trim(COALESCE(s.fecha_solicitud, s.fecha_compra, s.fecha_firma)) = ''
            OR julianday(substr(COALESCE(s.fecha_solicitud, s.fecha_compra, s.fecha_firma), 1, 10))
              >= julianday(crm_leads.fecha_entrada)
          )
      )`
    : '0';
  const rows = d.prepare(`
    SELECT
      id_crm AS idCrm,
      id_oportunidad AS idOportunidad,
      nombre,
      telefono,
      fecha_entrada AS fechaEntrada,
      canal,
      sucursal,
      tipo,
      campana,
      ejecutivo_asignado AS ejecutivo,
      fuerza_ventas AS fuerzaVentas,
      contacto,
      cita_programada AS citaProgramada,
      fecha_cita AS fechaCita,
      cotizacion,
      auto_interes AS autoInteres,
      resultado,
      vin_comprado AS vinComprado,
      fecha_factura AS fechaFactura,
      estatus_compra AS estatusCompra,
      ${COMPRA_LEAD_SQL} AS conCompra,
      CASE WHEN (${pruebaSql}) THEN 1 ELSE 0 END AS conPruebaManejo,
      CASE WHEN (${solSql}) THEN 1 ELSE 0 END AS conSolicitud,
      (
        SELECT a.vin FROM crm_actividades a
        WHERE a.id_contacto = crm_leads.id_crm
          AND a.vin IS NOT NULL AND trim(a.vin) <> ''
        ORDER BY COALESCE(a.fecha_factura, a.fecha_entrega, a.fecha_estatus, a.fecha_inicio_ciclo) DESC
        LIMIT 1
      ) AS vinCiclo,
      (
        SELECT a.estatus FROM crm_actividades a
        WHERE a.id_contacto = crm_leads.id_crm
        ORDER BY COALESCE(a.fecha_estatus, a.fecha_inicio_ciclo) DESC
        LIMIT 1
      ) AS estatusCiclo
    FROM crm_leads
    ${whereSql}
    ORDER BY fecha_entrada DESC, id_crm DESC
    LIMIT ?
  `).all(...params, max);
  return rows.map(mapLeadDetalleRow);
}

/**
 * Detalle completo de un KPI del embudo (sin depender del preview truncado del dashboard).
 */
function getLeadsKpiDetalle({ fechaInicio = null, fechaFin = null, kpi = 'leads', limit = 5000 } = {}) {
  const d = getDb();
  if (!hasLeadsTable(d)) {
    throw Object.assign(
      new Error('Tabla de leads no cargada. Ejecute: node backend/scripts/etl-crm-leads.js'),
      { status: 503 },
    );
  }

  const rango = resolveCrmPeriod({ desde: fechaInicio || null, hasta: fechaFin || null });
  const kpiKey = String(kpi || 'leads').trim();
  const notDupSql = getLeadNotDuplicateSql();
  const dupSql = getLeadIsDuplicateSql();

  // En seguimiento: ventana de vida 90d al cierre del periodo (no cohorte del mes).
  if (kpiKey === 'seguimientoSinCompra' || kpiKey === 'enSeguimiento') {
    const vidaQ = buildSeguimientoVidaActivaQuery({
      notDupSql,
      hasta: rango.hasta,
    });
    const total = Number(
      d.prepare(`SELECT COUNT(*) AS n FROM crm_leads ${vidaQ.whereSql}`).get(...vidaQ.params)?.n || 0,
    );
    const max = Math.min(20000, Math.max(50, Number(limit) || 5000));
    const detalle = queryLeadsDetalleRows(d, {
      whereSql: vidaQ.whereSql,
      params: vidaQ.params,
      limit: max,
    });
    return {
      filtros: {
        fechaInicio: rango.desde,
        fechaFin: rango.hasta,
        periodo: rango.periodo,
        kpi: kpiKey || 'leads',
        ventanaVidaDesde: vidaQ.desdeVida,
        ventanaVidaHasta: vidaQ.refHasta,
        vidaDias: vidaQ.vidaDias,
      },
      total,
      returned: detalle.length,
      limited: detalle.length < total,
      limit: max,
      detalle,
    };
  }

  const where = [];
  if (kpiKey === 'leadsDuplicados') {
    where.push(dupSql);
  } else {
    where.push(notDupSql);
  }
  const params = [];
  if (rango.desde) {
    where.push('substr(fecha_entrada, 1, 10) >= ?');
    params.push(String(rango.desde).slice(0, 10));
  }
  if (rango.hasta) {
    where.push('substr(fecha_entrada, 1, 10) <= ?');
    params.push(String(rango.hasta).slice(0, 10));
  }
  const extra = leadKpiExtraWhere(kpiKey, {
    compraSql: getCompraLeadAtribuibleSql(require('../config/campanasConversion').LEAD_VIDA_DIAS),
  });
  if (extra) where.push(`(${extra})`);
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const total = Number(d.prepare(`SELECT COUNT(*) AS n FROM crm_leads ${whereSql}`).get(...params)?.n || 0);
  const max = Math.min(20000, Math.max(50, Number(limit) || 5000));
  const detalle = queryLeadsDetalleRows(d, { whereSql, params, limit: max });

  return {
    filtros: {
      fechaInicio: rango.desde,
      fechaFin: rango.hasta,
      periodo: rango.periodo,
      kpi: kpiKey || 'leads',
    },
    total,
    returned: detalle.length,
    limited: detalle.length < total,
    limit: max,
    detalle,
  };
}

function getLeadsDashboard({ fechaInicio = null, fechaFin = null, limit = 400 } = {}) {
  const d = getDb();
  if (!hasLeadsTable(d)) {
    throw Object.assign(
      new Error('Tabla de leads no cargada. Ejecute: node backend/scripts/etl-crm-leads.js'),
      { status: 503 },
    );
  }

  const desde = fechaInicio || null;
  const hasta = fechaFin || null;
  const rango = resolveCrmPeriod({ desde, hasta });
  const { LEAD_VIDA_DIAS } = require('../config/campanasConversion');
  const COMPRA_ATRIBUIBLE_SQL = getCompraLeadAtribuibleSql(LEAD_VIDA_DIAS);

  const notDupSql = getLeadNotDuplicateSql();
  const dupSql = getLeadIsDuplicateSql();
  const coberturaRow = d.prepare(`
    SELECT
      MIN(substr(fecha_entrada, 1, 10)) AS minFechaEntrada,
      MAX(substr(fecha_entrada, 1, 10)) AS maxFechaEntrada,
      COUNT(*) AS totalLeads
    FROM crm_leads
    WHERE fecha_entrada IS NOT NULL AND trim(fecha_entrada) <> ''
      AND (${notDupSql})
  `).get();
  const cobertura = {
    minFechaEntrada: coberturaRow?.minFechaEntrada || null,
    maxFechaEntrada: coberturaRow?.maxFechaEntrada || null,
    totalLeads: Number(coberturaRow?.totalLeads || 0),
    sinDatosEnPeriodo: false,
  };

  const where = [notDupSql];
  const params = [];
  if (rango.desde) {
    where.push('substr(fecha_entrada, 1, 10) >= ?');
    params.push(String(rango.desde).slice(0, 10));
  }
  if (rango.hasta) {
    where.push('substr(fecha_entrada, 1, 10) <= ?');
    params.push(String(rango.hasta).slice(0, 10));
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const periodDateWhere = [];
  const periodDateParams = [];
  if (rango.desde) {
    periodDateWhere.push('substr(fecha_entrada, 1, 10) >= ?');
    periodDateParams.push(String(rango.desde).slice(0, 10));
  }
  if (rango.hasta) {
    periodDateWhere.push('substr(fecha_entrada, 1, 10) <= ?');
    periodDateParams.push(String(rango.hasta).slice(0, 10));
  }
  const periodDateSql = periodDateWhere.length
    ? `WHERE ${periodDateWhere.join(' AND ')}`
    : '';

  const volumenDup = d.prepare(`
    SELECT
      COUNT(*) AS totalBruto,
      SUM(CASE WHEN (${notDupSql}) THEN 1 ELSE 0 END) AS unicos,
      SUM(CASE WHEN ${dupSql} THEN 1 ELSE 0 END) AS duplicados
    FROM crm_leads
    ${periodDateSql}
  `).get(...periodDateParams);

  const totales = d.prepare(`
    SELECT
      COUNT(*) AS leads,
      COUNT(DISTINCT CASE WHEN id_crm IS NOT NULL AND trim(id_crm) <> '' THEN id_crm END) AS oportunidades,
      SUM(CASE WHEN contacto = 'SI' THEN 1 ELSE 0 END) AS contactados,
      SUM(CASE WHEN cita_programada = 'SI' THEN 1 ELSE 0 END) AS citas,
      SUM(CASE WHEN cita_asistida = 'SI' THEN 1 ELSE 0 END) AS citasAsistidas,
      SUM(CASE WHEN cotizacion IS NOT NULL AND trim(cotizacion) <> '' AND upper(trim(cotizacion)) NOT IN ('NO','N','0') THEN 1 ELSE 0 END) AS cotizados,
      SUM(${COMPRA_ATRIBUIBLE_SQL}) AS compras,
      SUM(CASE WHEN ejecutivo_asignado IS NOT NULL AND trim(ejecutivo_asignado) <> '' THEN 1 ELSE 0 END) AS conEjecutivo,
      SUM(CASE WHEN ${getLeadDescartadoSql()} THEN 1 ELSE 0 END) AS sinCompra
    FROM crm_leads
    ${whereSql}
  `).get(...params);

  const seguimientoVidaQ = buildSeguimientoVidaActivaQuery({
    notDupSql,
    hasta: rango.hasta,
  });
  const seguimientoSinCompra = Number(
    d.prepare(`SELECT COUNT(*) AS n FROM crm_leads ${seguimientoVidaQ.whereSql}`)
      .get(...seguimientoVidaQ.params)?.n || 0,
  );
  const pipelineVivo = Number(
    d.prepare(`
      SELECT COUNT(*) AS n FROM crm_leads
      WHERE (${notDupSql})
        AND fecha_entrada IS NOT NULL AND trim(fecha_entrada) <> ''
        AND substr(fecha_entrada, 1, 10) >= ?
        AND substr(fecha_entrada, 1, 10) <= ?
    `).get(...seguimientoVidaQ.params)?.n || 0,
  );

  const n = (k) => Number(totales?.[k] || 0);
  const leads = n('leads');
  const leadsUnicos = Number(volumenDup?.unicos || leads);
  const leadsDuplicados = Number(volumenDup?.duplicados || 0);
  const leadsTotales = Number(volumenDup?.totalBruto || (leadsUnicos + leadsDuplicados));
  const contactados = n('contactados');
  const citas = n('citas');
  const cotizados = n('cotizados');
  const compras = n('compras');
  const sinCompra = n('sinCompra');
  const pct = (num, den) => (den ? Math.round((num / den) * 10000) / 100 : 0);

  const summary = {
    leads,
    leadsUnicos,
    leadsDuplicados,
    leadsTotales,
    oportunidades: n('oportunidades'),
    contactados,
    citas,
    citasAsistidas: n('citasAsistidas'),
    cotizados,
    compras,
    conEjecutivo: n('conEjecutivo'),
    seguimientoSinCompra,
    pipelineVivo,
    seguimientoVentanaDesde: seguimientoVidaQ.desdeVida,
    seguimientoVentanaHasta: seguimientoVidaQ.refHasta,
    seguimientoVidaDias: seguimientoVidaQ.vidaDias,
    sinCompra,
    conversionContactoPct: pct(contactados, leads),
    conversionCitaPct: pct(citas, leads),
    conversionCotizacionPct: pct(cotizados, leads),
    conversionCompraPct: pct(compras, leads),
    conversionCitaACompraPct: pct(compras, citas),
    conversionContactoACompraPct: pct(compras, contactados),
    pctDuplicados: pct(leadsDuplicados, leadsTotales),
    pctSeguimientoSinCompra: pct(seguimientoSinCompra, pipelineVivo || seguimientoSinCompra),
  };

  const funnel = [
    { key: 'leadsUnicos', label: 'Leads únicos', value: leadsUnicos, pct: pct(leadsUnicos, leadsTotales || leadsUnicos) },
    { key: 'leadsDuplicados', label: 'Duplicados', value: leadsDuplicados, pct: pct(leadsDuplicados, leadsTotales || 1) },
    { key: 'contactados', label: 'Contactados', value: contactados, pct: pct(contactados, leads) },
    { key: 'citas', label: 'Citas', value: citas, pct: pct(citas, leads) },
    { key: 'cotizados', label: 'Cotizados', value: cotizados, pct: pct(cotizados, leads) },
    { key: 'compras', label: 'Compras', value: compras, pct: pct(compras, leads) },
    { key: 'seguimientoSinCompra', label: 'En seguimiento', value: seguimientoSinCompra, pct: pct(seguimientoSinCompra, pipelineVivo || seguimientoSinCompra) },
    { key: 'sinCompra', label: 'Sin compra', value: sinCompra, pct: pct(sinCompra, leads) },
  ];

  const groupQuery = (expr, maxGroups = 20) => d.prepare(`
    SELECT
      COALESCE(NULLIF(trim(${expr}), ''), '(sin dato)') AS grupo,
      COUNT(*) AS leads,
      SUM(CASE WHEN contacto = 'SI' THEN 1 ELSE 0 END) AS contactados,
      SUM(CASE WHEN cita_programada = 'SI' THEN 1 ELSE 0 END) AS citas,
      SUM(CASE WHEN cotizacion IS NOT NULL AND trim(cotizacion) <> '' AND upper(trim(cotizacion)) NOT IN ('NO','N','0') THEN 1 ELSE 0 END) AS cotizados,
      SUM(${COMPRA_ATRIBUIBLE_SQL}) AS compras
    FROM crm_leads
    ${whereSql}
    GROUP BY grupo
    ORDER BY compras DESC, leads DESC
    LIMIT ?
  `).all(...params, maxGroups).map((r) => ({
    grupo: String(r.grupo || '(sin dato)'),
    leads: Number(r.leads || 0),
    contactados: Number(r.contactados || 0),
    citas: Number(r.citas || 0),
    cotizados: Number(r.cotizados || 0),
    compras: Number(r.compras || 0),
    conversionPct: pct(Number(r.compras || 0), Number(r.leads || 0)),
  }));

  const porCanal = groupQuery('canal');
  const porEjecutivo = groupQuery('ejecutivo_asignado', 25);
  const porResultado = groupQuery('resultado', 15);
  const porSucursal = groupQuery('sucursal', 15);
  const porFuerzaRaw = d.prepare(`
    SELECT
      COALESCE(NULLIF(trim(fuerza_ventas), ''), '(sin dato)') AS grupo,
      COUNT(*) AS leads,
      SUM(CASE WHEN contacto = 'SI' THEN 1 ELSE 0 END) AS contactados,
      SUM(CASE WHEN cita_programada = 'SI' THEN 1 ELSE 0 END) AS citas,
      SUM(CASE WHEN cotizacion IS NOT NULL AND trim(cotizacion) <> '' AND upper(trim(cotizacion)) NOT IN ('NO','N','0') THEN 1 ELSE 0 END) AS cotizados,
      SUM(${COMPRA_ATRIBUIBLE_SQL}) AS compras
    FROM crm_leads
    ${whereSql}
    GROUP BY grupo
    ORDER BY leads DESC
  `).all(...params).map((r) => ({
    grupo: String(r.grupo || '(sin dato)'),
    leads: Number(r.leads || 0),
    contactados: Number(r.contactados || 0),
    citas: Number(r.citas || 0),
    cotizados: Number(r.cotizados || 0),
    compras: Number(r.compras || 0),
  }));
  const porFuerzaVentas = aggregateFuerzaVentas(porFuerzaRaw);

  const {
    CAMPANAS_CONVERSION,
    resolveCampanaConversionKey,
    classifyCampanaConversion,
  } = require('../config/campanasConversion');

  const COMPRA_LEAD_90D_SQL = COMPRA_ATRIBUIBLE_SQL;

  const campanaAggRows = d.prepare(`
    SELECT
      COALESCE(NULLIF(trim(campana), ''), '(sin campaña)') AS campana,
      COUNT(*) AS leads,
      SUM(CASE WHEN contacto = 'SI' THEN 1 ELSE 0 END) AS contactados,
      SUM(${COMPRA_ATRIBUIBLE_SQL}) AS compras,
      SUM(${COMPRA_LEAD_90D_SQL}) AS vendidos
    FROM crm_leads
    ${whereSql}
    GROUP BY campana
  `).all(...params);

  const campanasMap = Object.fromEntries(
    CAMPANAS_CONVERSION.map((c) => [c.key, {
      key: c.key,
      campana: c.label,
      tipo: c.tipo || 'reactiva',
      total: 0,
      contactados: 0,
      vendidos: 0,
      vendidosFueraVida: 0,
      conversionPct: 0,
      matchedNames: [],
      dinamica: false,
    }])
  );

  for (const row of campanaAggRows) {
    const cls = classifyCampanaConversion(row.campana);
    if (!cls.tipo || !cls.key) continue;
    if (!campanasMap[cls.key]) {
      campanasMap[cls.key] = {
        key: cls.key,
        campana: cls.label,
        tipo: cls.tipo,
        total: 0,
        contactados: 0,
        vendidos: 0,
        vendidosFueraVida: 0,
        conversionPct: 0,
        matchedNames: [],
        dinamica: !!cls.dinamica,
      };
    }
    const bucket = campanasMap[cls.key];
    const compras = Number(row.compras || 0);
    const vendidos = Number(row.vendidos || 0);
    bucket.total += Number(row.leads || 0);
    bucket.contactados += Number(row.contactados || 0);
    bucket.vendidos += vendidos;
    bucket.vendidosFueraVida += Math.max(0, compras - vendidos);
    if (row.campana && !bucket.matchedNames.includes(row.campana)) {
      bucket.matchedNames.push(String(row.campana));
    }
  }

  const campanasConversion = Object.values(campanasMap)
    .map((b) => {
      b.conversionPct = pct(b.vendidos, b.total);
      return b;
    })
    .filter((b) => Number(b.total || 0) > 0 || !b.dinamica)
    .sort((a, b) => {
      if (a.tipo !== b.tipo) return a.tipo === 'reactiva' ? -1 : 1;
      return Number(b.total || 0) - Number(a.total || 0) || String(a.campana).localeCompare(String(b.campana));
    });

  const sumCampanas = (rows) => {
    const acc = rows.reduce((a, r) => {
      a.total += Number(r.total || 0);
      a.contactados += Number(r.contactados || 0);
      a.vendidos += Number(r.vendidos || 0);
      a.vendidosFueraVida += Number(r.vendidosFueraVida || 0);
      return a;
    }, { total: 0, contactados: 0, vendidos: 0, vendidosFueraVida: 0 });
    acc.conversionPct = pct(acc.vendidos, acc.total);
    acc.vidaDias = LEAD_VIDA_DIAS;
    return acc;
  };

  const campanasReactivas = campanasConversion.filter((r) => r.tipo === 'reactiva');
  const campanasProactivas = campanasConversion.filter((r) => r.tipo === 'proactiva');
  const campanasConversionTotales = sumCampanas(campanasConversion);
  const campanasReactivasTotales = sumCampanas(campanasReactivas);
  const campanasProactivasTotales = sumCampanas(campanasProactivas);

  const { normalizeVehiculoLead } = require('../config/campanasConversion');
  const vehiculoAggRows = d.prepare(`
    SELECT
      COALESCE(NULLIF(trim(campana), ''), '(sin campaña)') AS campana,
      COALESCE(NULLIF(trim(auto_interes), ''), '(sin vehículo)') AS autoInteres,
      COUNT(*) AS leads,
      SUM(${COMPRA_ATRIBUIBLE_SQL}) AS convertidos
    FROM crm_leads
    ${whereSql}
    GROUP BY campana, autoInteres
  `).all(...params);

  const vehiculoMap = new Map();
  for (const row of vehiculoAggRows) {
    const cls = classifyCampanaConversion(row.campana);
    if (!cls.tipo) continue;
    const vehiculo = normalizeVehiculoLead(row.autoInteres);
    const cur = vehiculoMap.get(vehiculo) || { vehiculo, total: 0, convertidos: 0 };
    cur.total += Number(row.leads || 0);
    cur.convertidos += Number(row.convertidos || 0);
    vehiculoMap.set(vehiculo, cur);
  }
  const conversionPorVehiculo = [...vehiculoMap.values()]
    .map((r) => ({
      ...r,
      conversionPct: pct(r.convertidos, r.total),
    }))
    .sort((a, b) => b.total - a.total || b.convertidos - a.convertidos);

  const yearRef = String(rango.hasta || rango.desde || formatIsoDate(new Date())).slice(0, 4);
  const yearNum = /^\d{4}$/.test(yearRef) ? yearRef : String(new Date().getFullYear());
  const yearDesde = `${yearNum}-01-01`;
  const yearHasta = `${yearNum}-12-31`;
  const mesCampanaRows = d.prepare(`
    SELECT
      substr(fecha_entrada, 1, 7) AS mes,
      COALESCE(NULLIF(trim(campana), ''), '(sin campaña)') AS campana,
      COUNT(*) AS total,
      SUM(${COMPRA_ATRIBUIBLE_SQL}) AS convertidos
    FROM crm_leads
    WHERE (${notDupSql})
      AND fecha_entrada IS NOT NULL AND trim(fecha_entrada) <> ''
      AND substr(fecha_entrada, 1, 10) >= ?
      AND substr(fecha_entrada, 1, 10) <= ?
    GROUP BY substr(fecha_entrada, 1, 7), campana
  `).all(yearDesde, yearHasta);

  const mesBuckets = new Map();
  for (let i = 1; i <= 12; i += 1) {
    const mes = `${yearNum}-${String(i).padStart(2, '0')}`;
    mesBuckets.set(mes, {
      mes,
      anio: Number(yearNum),
      total: 0,
      convertidos: 0,
      conversionPct: 0,
    });
  }

  for (const row of mesCampanaRows) {
    const cls = classifyCampanaConversion(row.campana);
    if (cls.tipo !== 'reactiva') continue;
    const mes = String(row.mes || '');
    const bucket = mesBuckets.get(mes);
    if (!bucket) continue;
    bucket.total += Number(row.total || 0);
    bucket.convertidos += Number(row.convertidos || 0);
  }

  const conversionPorMes = [...mesBuckets.values()].map((b) => ({
    ...b,
    conversionPct: pct(b.convertidos, b.total),
  }));
  const conversionPorMesMeta = {
    anio: Number(yearNum),
    desde: yearDesde,
    hasta: yearHasta,
    alcance: 'campanas_reactivas',
    texto: `Año ${yearNum} · solo campañas reactivas (excluye proactivas, AMDGM, ABP y CODE), compra ≤${LEAD_VIDA_DIAS}d`,
  };

  const CADUCAR_ALERTA_DIAS = 14;
  const hoyIso = formatIsoDate(new Date());
  // Caducar respeta el mismo filtro de cohorte (fecha_entrada) que el resto de Leads.
  const caducarDesde = rango.desde || formatIsoDate(new Date(Date.now() - LEAD_VIDA_DIAS * 24 * 60 * 60 * 1000));
  const caducarHasta = rango.hasta || hoyIso;
  const candidatosCaducar = d.prepare(`
    SELECT
      id_crm AS idCrm,
      id_oportunidad AS idOportunidad,
      nombre,
      telefono,
      campana,
      ejecutivo_asignado AS ejecutivo,
      fuerza_ventas AS fuerzaVentas,
      fecha_entrada AS fechaEntrada,
      CAST(julianday(?) - julianday(substr(fecha_entrada, 1, 10)) AS INTEGER) AS diasVividos
    FROM crm_leads
    WHERE fecha_entrada IS NOT NULL
      AND trim(fecha_entrada) <> ''
      AND (${notDupSql})
      AND substr(fecha_entrada, 1, 10) >= ?
      AND substr(fecha_entrada, 1, 10) <= ?
      AND (${COMPRA_LEAD_SQL}) = 0
    ORDER BY fecha_entrada ASC
    LIMIT 3000
  `).all(hoyIso, String(caducarDesde).slice(0, 10), String(caducarHasta).slice(0, 10));

  const campanasCaducarAll = candidatosCaducar
    .map((r) => {
      const cls = classifyCampanaConversion(r.campana);
      if (!cls.tipo) return null;
      const diasVividos = Math.max(0, Number(r.diasVividos || 0));
      const diasRestantes = LEAD_VIDA_DIAS - diasVividos;
      if (diasRestantes < 0 || diasRestantes > CADUCAR_ALERTA_DIAS) return null;
      let severidad = 'info';
      if (diasRestantes <= 3) severidad = 'critical';
      else if (diasRestantes <= 7) severidad = 'warning';
      return {
        idCrm: r.idCrm || null,
        idOportunidad: r.idOportunidad || null,
        nombre: String(r.nombre || '').trim() || '(Sin nombre)',
        telefono: String(r.telefono || '').trim() || null,
        campana: cls.label || String(r.campana || '').trim(),
        campanaKey: cls.key,
        ejecutivo: String(r.ejecutivo || '').trim() || 'Sin ejecutivo',
        fuerzaVentas: String(r.fuerzaVentas || '').trim() || null,
        fechaEntrada: String(r.fechaEntrada || '').slice(0, 10) || null,
        diasVividos,
        diasRestantes,
        severidad,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.diasRestantes - b.diasRestantes || String(a.nombre).localeCompare(String(b.nombre), 'es'));

  // Prioriza recuperables (1–14 d); incluye un cupo de los que caducan hoy (0 d).
  const porCaducar = campanasCaducarAll.filter((x) => x.diasRestantes >= 1);
  const caducanHoy = campanasCaducarAll.filter((x) => x.diasRestantes === 0);
  const campanasCaducarAlertas = [...porCaducar.slice(0, 30), ...caducanHoy.slice(0, 10)]
    .sort((a, b) => a.diasRestantes - b.diasRestantes || String(a.nombre).localeCompare(String(b.nombre), 'es'));

  const campanasCaducarResumen = {
    total: campanasCaducarAll.length,
    mostrados: campanasCaducarAlertas.length,
    criticos: campanasCaducarAll.filter((x) => x.severidad === 'critical').length,
    warning: campanasCaducarAll.filter((x) => x.severidad === 'warning').length,
    vidaDias: LEAD_VIDA_DIAS,
    umbralDias: CADUCAR_ALERTA_DIAS,
    independienteDelPeriodo: false,
    texto: `Cohorte del periodo · campañas documentadas sin compra, con ≤${CADUCAR_ALERTA_DIAS} días de vida restante (de ${LEAD_VIDA_DIAS}).`,
  };

  const max = Math.min(2000, Math.max(50, Number(limit) || 400));

  cobertura.sinDatosEnPeriodo = leads === 0 && Number(cobertura.totalLeads || 0) > 0;

  const detalle = queryLeadsDetalleRows(d, { whereSql, params, limit: max });
  const detalleMeta = {
    returned: detalle.length,
    total: leads,
    limited: detalle.length < leads,
    limit: max,
    nota: detalle.length < leads
      ? `Preview de tabla: ${detalle.length} de ${leads}. El detalle por KPI carga el universo completo del indicador.`
      : null,
  };

  // KPIs poco densos: incluir detalle completo en el payload para que el drawer
  // no dependa de un segundo request ni del preview truncado.
  const buildKpiDetalle = (kpiKey, softLimit = 2000) => {
    if (kpiKey === 'seguimientoSinCompra' || kpiKey === 'enSeguimiento') {
      return queryLeadsDetalleRows(d, {
        whereSql: seguimientoVidaQ.whereSql,
        params: seguimientoVidaQ.params,
        limit: softLimit,
      });
    }
    const extra = leadKpiExtraWhere(kpiKey, { compraSql: COMPRA_ATRIBUIBLE_SQL });
    const kpiWhere = extra ? `${whereSql} AND (${extra})` : whereSql;
    return queryLeadsDetalleRows(d, { whereSql: kpiWhere, params, limit: softLimit });
  };
  const detallePorKpi = {
    compras: buildKpiDetalle('compras', 500),
    citas: buildKpiDetalle('citas', 2000),
    cotizados: buildKpiDetalle('cotizados', 2000),
    convCompra: null, // alias de compras; se resuelve en cliente
    convCitaCompra: buildKpiDetalle('convCitaCompra', 500),
    convContactoCompra: buildKpiDetalle('convContactoCompra', 500),
    seguimientoSinCompra: buildKpiDetalle('seguimientoSinCompra', 2000),
  };
  detallePorKpi.convCompra = detallePorKpi.compras;

  const alertasConversionCompras = buildAlertasConversionCompras(d, {
    whereSql,
    params,
    compraSql: COMPRA_ATRIBUIBLE_SQL,
    limit: 40,
  });

  return {
    filtros: {
      fechaInicio: rango.desde,
      fechaFin: rango.hasta,
      periodo: rango.periodo,
    },
    fuente: 'crm_leads · crm_actividades (Balderrama Ciclos)',
    reglaCompra: `Serie/VIN en ciclo CRM del mismo ID CRM (o vin_comprado), con fecha de compra ≥ fecha_entrada y dentro de ${LEAD_VIDA_DIAS} días; la conversión se atribuye al mes de origen del lead`,
    cobertura,
    semantica: {
      cohorte: 'El periodo filtra fecha_entrada del lead (mes de origen de la oportunidad)',
      compras: `Compra vinculada por ID CRM vía serie/VIN; cuenta en el mes de origen si la compra ocurre dentro de ${LEAD_VIDA_DIAS} días desde fecha_entrada`,
      sinDuplicados: 'No se contabilizan en el embudo los leads con Resultado=DUPLICADO (columna AB del sheet Acumulado)',
      seguimientoSinCompra: `Leads vivos (≤${seguimientoVidaQ.vidaDias}d al cierre: ${seguimientoVidaQ.desdeVida} → ${seguimientoVidaQ.refHasta}) sin compra y no descartados, con resultado en seguimiento y/o prueba de manejo y/o solicitud de crédito`,
      sinCompra: 'Oportunidades perdidas de la cohorte: resultado descartado, desistido, perdido u equivalentes',
      campanasConversion: `Vendidos de campañas documentadas solo cuentan si la compra ocurre dentro de ${LEAD_VIDA_DIAS} días desde fecha_entrada; fuera de esa vida útil no suman a conversión aunque exista venta`,
      alertasCaducar: 'Las alertas de caducidad usan la misma cohorte por fecha_entrada del periodo, con vida restante ≤14 días de 90',
      alertasConversionCompras: 'Compras con posible alteración: lead anónimo/genérico o nombre del lead distinto al comprador vinculado por VIN/ID CRM',
      conversionPorMes: 'Serie ene–dic · solo reactivas (cualquier campaña no proactiva/ABP/CODE se agrega sola)',
      noEsVentasTotales: 'No equivale al total de facturas DMS del periodo',
    },
    campanasConversionRegla: {
      vidaDias: LEAD_VIDA_DIAS,
      texto: `La vida del lead es de ${LEAD_VIDA_DIAS} días. Al culminar ese plazo ya no cuenta para conversión de campañas documentadas, aunque después se venda.`,
    },
    summary,
    funnel,
    porCanal,
    porEjecutivo,
    porResultado,
    porSucursal,
    porFuerzaVentas,
    campanasConversion,
    campanasConversionTotales,
    campanasReactivas,
    campanasReactivasTotales,
    campanasProactivas,
    campanasProactivasTotales,
    conversionPorVehiculo,
    conversionPorMes,
    conversionPorMesMeta,
    campanasCaducarAlertas,
    campanasCaducarResumen,
    alertasConversionCompras,
    detalle,
    detalleMeta,
    detallePorKpi,
  };
}

/**
 * Resumen conjunto de las mini bases que alimentan Seguimiento 360.
 * Sirve al agente para consultas agregadas por periodos relativos.
 */
function getSeguimiento360Summary({ periodo = null, desde = null, hasta = null } = {}) {
  const d = getDb();
  const rango = resolveCrmPeriod({ periodo, desde, hasta });

  const whereFor = (column) => {
    const clauses = [];
    const params = [];
    if (rango.desde) {
      clauses.push(`${column} >= ?`);
      params.push(rango.desde);
    }
    if (rango.hasta) {
      clauses.push(`${column} <= ?`);
      params.push(rango.hasta);
    }
    return {
      sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
      params,
    };
  };

  const leadWhere = whereFor('fecha_entrada');
  const solicitudWhere = whereFor('fecha_solicitud');
  const pruebaWhere = whereFor('fecha');
  const cicloWhere = whereFor('fecha_inicio_ciclo');
  const financiamientoWhere = whereFor('fecha_compra');

  const leads = hasLeadsTable(d)
    ? d.prepare(`
        SELECT
          COUNT(*) AS total,
          COUNT(DISTINCT CASE WHEN id_crm IS NOT NULL THEN id_crm END) AS clientes,
          SUM(CASE WHEN contacto = 'SI' THEN 1 ELSE 0 END) AS contactados,
          SUM(CASE WHEN cita_programada = 'SI' THEN 1 ELSE 0 END) AS citas,
          SUM(CASE WHEN (
            (vin_comprado IS NOT NULL AND trim(vin_comprado) <> '')
            OR EXISTS (
              SELECT 1 FROM crm_actividades a
              WHERE a.id_contacto = crm_leads.id_crm
                AND a.vin IS NOT NULL AND trim(a.vin) <> ''
            )
          ) THEN 1 ELSE 0 END) AS conCompra
        FROM crm_leads
        ${leadWhere.sql}
      `).get(...leadWhere.params)
    : { total: 0, clientes: 0, contactados: 0, citas: 0, conCompra: 0 };

  const solicitudes = hasSolicitudesTable(d)
    ? d.prepare(`
        SELECT
          COUNT(*) AS total,
          COUNT(DISTINCT CASE WHEN id_crm IS NOT NULL THEN id_crm END) AS clientes,
          SUM(CASE WHEN upper(estatus) LIKE 'APROBADA%' THEN 1 ELSE 0 END) AS aprobadas,
          SUM(CASE WHEN fecha_compra IS NOT NULL OR upper(COALESCE(estatus, '')) LIKE '%FACT%' THEN 1 ELSE 0 END) AS conCompra
        FROM crm_solicitudes
        ${solicitudWhere.sql}
      `).get(...solicitudWhere.params)
    : { total: 0, clientes: 0, aprobadas: 0, conCompra: 0 };

  const pruebasManejo = hasPruebasManejoTable(d)
    ? d.prepare(`
        SELECT
          COUNT(*) AS total,
          COUNT(DISTINCT id_crm) AS clientes,
          SUM(CASE WHEN EXISTS (
            SELECT 1 FROM crm_actividades a
            WHERE a.id_contacto = crm_pruebas_manejo.id_crm
              AND a.vin IS NOT NULL AND trim(a.vin) <> ''
          ) THEN 1 ELSE 0 END) AS conCompra
        FROM crm_pruebas_manejo
        ${pruebaWhere.sql}
      `).get(...pruebaWhere.params)
    : { total: 0, clientes: 0, conCompra: 0 };

  const ciclos = d.prepare(`
    SELECT
      COUNT(DISTINCT id_ciclo) AS total,
      COUNT(DISTINCT id_contacto) AS clientes,
      COUNT(*) AS actividades,
      COUNT(DISTINCT CASE WHEN vin IS NOT NULL AND trim(vin) <> '' THEN id_contacto END) AS clientesConCompra,
      COUNT(DISTINCT CASE WHEN vin IS NOT NULL AND trim(vin) <> '' THEN upper(trim(vin)) END) AS unidadesConVin
    FROM crm_actividades
    ${cicloWhere.sql}
  `).get(...cicloWhere.params);

  const financiamiento = hasFinanciamientoTable(d)
    ? d.prepare(`
        SELECT
          COUNT(*) AS total,
          COUNT(DISTINCT vin) AS unidades,
          SUM(CASE WHEN gap_monto > 0 THEN 1 ELSE 0 END) AS conGap,
          SUM(CASE WHEN garantia_extendida_monto > 0 THEN 1 ELSE 0 END) AS conGarantiaExtendida,
          SUM(CASE WHEN accesorios_monto > 0 THEN 1 ELSE 0 END) AS conAccesorios,
          SUM(CASE WHEN onstar_monto > 0 THEN 1 ELSE 0 END) AS conOnstar,
          SUM(CASE WHEN mantenimiento_integrado_monto > 0 THEN 1 ELSE 0 END) AS conMantenimiento,
          SUM(CASE WHEN upper(trim(COALESCE(robo_parcial, ''))) IN ('C/COBERTURA', 'CON COBERTURA', 'SI') THEN 1 ELSE 0 END) AS conRoboParcial
        FROM crm_financiamiento
        ${financiamientoWhere.sql}
      `).get(...financiamientoWhere.params)
    : {
        total: 0, unidades: 0, conGap: 0, conGarantiaExtendida: 0,
        conAccesorios: 0, conOnstar: 0, conMantenimiento: 0, conRoboParcial: 0,
      };

  const fillZeros = (record, keys) => {
    for (const key of keys) record[key] = Number(record[key] || 0);
  };
  fillZeros(leads, ['total', 'clientes', 'contactados', 'citas', 'conCompra']);
  fillZeros(solicitudes, ['total', 'clientes', 'aprobadas', 'conCompra']);
  fillZeros(pruebasManejo, ['total', 'clientes', 'conCompra']);
  fillZeros(ciclos, ['total', 'clientes', 'actividades', 'clientesConCompra', 'unidadesConVin']);
  fillZeros(financiamiento, [
    'total', 'unidades', 'conGap', 'conGarantiaExtendida',
    'conAccesorios', 'conOnstar', 'conMantenimiento', 'conRoboParcial',
  ]);

  const pct = (numerator, denominator) => (
    denominator ? Math.round((Number(numerator || 0) / Number(denominator)) * 10000) / 100 : 0
  );

  return {
    fuenteMaestra: 'Balderrama Ciclos (ID_CONTACTO = ID CRM)',
    periodo: rango,
    leads,
    solicitudes,
    pruebasManejo,
    ciclos,
    financiamiento,
    conversiones: {
      leadACompraPct: pct(leads.conCompra, leads.total),
      solicitudACompraPct: pct(solicitudes.conCompra, solicitudes.total),
      pruebaManejoACompraPct: pct(pruebasManejo.conCompra, pruebasManejo.total),
    },
    semanticaConversion: {
      tipo: 'conversión de cohorte por vínculo CRM',
      periodo: 'Cada fuente se filtra por su fecha de entrada; la compra vinculada puede ocurrir después',
      ventasTotalesDms: 'No incluidas; deben consultarse por separado para una comparación de volumen',
    },
    reglas: {
      compraCiclo: 'VIN asignado en columna T de Balderrama Ciclos',
      idLead: 'columna G = ID CRM',
      idSolicitud: 'columna H = ID CRM',
      idPruebaManejo: 'columna P = ID CRM',
      unidadesCliente: 'Todos los VIN a nombre del cliente en DMS; pueden no tener venta originada en el distribuidor',
    },
  };
}

/**
 * Exporta registros CRM del periodo para sincronización a la nube.
 * Incluye leads, solicitudes F&I, pruebas de manejo, contratos y actividades.
 */
function exportCloudSyncRecords({ fechaInicio, fechaFin } = {}) {
  if (!fechaInicio || !fechaFin) {
    throw new Error('exportCloudSyncRecords requiere fechaInicio y fechaFin');
  }
  if (!isAvailable()) {
    return {
      records: [],
      meta: { available: false, reason: 'Base CRM no encontrada' },
    };
  }

  const d = getDb();
  const records = [];
  const counts = { leads: 0, solicitudes: 0, pruebas: 0, financiamiento: 0, actividades: 0 };

  function mapSqliteRows(entity, rows) {
    for (const row of rows) {
      const data = { entity, ...row };
      const sqliteId = data.id;
      records.push({
        id: `${entity}|${sqliteId}`,
        data,
      });
    }
    if (entity === 'lead') counts.leads += rows.length;
    else if (entity === 'solicitud') counts.solicitudes += rows.length;
    else if (entity === 'prueba') counts.pruebas += rows.length;
    else if (entity === 'financiamiento') counts.financiamiento += rows.length;
    else if (entity === 'actividad') counts.actividades += rows.length;
  }

  if (hasLeadsTable(d)) {
    const leads = d.prepare(`
      SELECT * FROM crm_leads
      WHERE fecha_entrada IS NOT NULL
        AND fecha_entrada >= ? AND fecha_entrada <= ?
    `).all(fechaInicio, fechaFin);
    mapSqliteRows('lead', leads);
  }

  if (hasSolicitudesTable(d)) {
    const solicitudes = d.prepare(`
      SELECT * FROM crm_solicitudes
      WHERE COALESCE(fecha_compra, fecha_firma, fecha_aprobacion, fecha_solicitud) IS NOT NULL
        AND COALESCE(fecha_compra, fecha_firma, fecha_aprobacion, fecha_solicitud) >= ?
        AND COALESCE(fecha_compra, fecha_firma, fecha_aprobacion, fecha_solicitud) <= ?
    `).all(fechaInicio, fechaFin);
    mapSqliteRows('solicitud', solicitudes);
  }

  if (hasPruebasManejoTable(d)) {
    const pruebas = d.prepare(`
      SELECT * FROM crm_pruebas_manejo
      WHERE fecha IS NOT NULL
        AND fecha >= ? AND fecha <= ?
    `).all(fechaInicio, fechaFin);
    mapSqliteRows('prueba', pruebas);
  }

  if (hasFinanciamientoTable(d)) {
    const financiamiento = d.prepare(`
      SELECT * FROM crm_financiamiento
      WHERE COALESCE(fecha_compra, fecha_timbrado) IS NOT NULL
        AND COALESCE(fecha_compra, fecha_timbrado) >= ?
        AND COALESCE(fecha_compra, fecha_timbrado) <= ?
    `).all(fechaInicio, fechaFin);
    mapSqliteRows('financiamiento', financiamiento);
  }

  const actividades = d.prepare(`
    SELECT * FROM crm_actividades
    WHERE COALESCE(fecha_inicio_ciclo, fecha_factura, fecha_crea_actividad, fecha_entrega) IS NOT NULL
      AND COALESCE(fecha_inicio_ciclo, fecha_factura, fecha_crea_actividad, fecha_entrega) >= ?
      AND COALESCE(fecha_inicio_ciclo, fecha_factura, fecha_crea_actividad, fecha_entrega) <= ?
  `).all(fechaInicio, fechaFin);
  mapSqliteRows('actividad', actividades);

  return {
    records,
    meta: {
      available: true,
      fechaInicio,
      fechaFin,
      ...counts,
      total: records.length,
    },
  };
}

function normalizeVendedorKey(v) {
  const s = String(v || '').replace(/\s+/g, ' ').trim().toUpperCase();
  return s && s !== 'NULL' ? s : null;
}

/** Clave estable por tokens ordenados: "Gabriel Chacon" ≡ "CHACON GABRIEL". */
function personTokenKey(v) {
  const s = String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  if (!s || s === 'NULL') return null;
  const tokens = s.split(' ').filter(Boolean);
  return tokens.length ? tokens.sort().join(' ') : null;
}

function personTokens(v) {
  const key = personTokenKey(v);
  return key ? key.split(' ') : [];
}

/** Tokens en el orden original del nombre (ya en mayúsculas, sin acentos). */
function orderedNameTokens(v) {
  const s = String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  if (!s || s === 'NULL') return [];
  return s.split(' ').filter(Boolean);
}

function hasLowercaseLetters(name) {
  return /[a-záéíóúüñ]/.test(String(name || ''));
}

/**
 * True si `name` parece forma APELLIDOS + NOMBRES respecto de `other`
 * (p. ej. "SORIANO REYES DIANA PATRICIA" vs "Diana Soriano Reyes").
 */
function isSurnameFirstForm(name, other) {
  const a = orderedNameTokens(name);
  const b = orderedNameTokens(other);
  if (a.length < 2 || b.length < 2) return false;
  return a.slice(0, 2).join(' ') === b.slice(-2).join(' ');
}

/** Convierte "Nombre Apellido1 Apellido2" → "APELLIDO1 APELLIDO2 NOMBRE". */
function toApellidosNombresUpper(name) {
  const parts = orderedNameTokens(name);
  if (parts.length <= 1) return parts.join(' ') || String(name || '').trim().toUpperCase();
  if (parts.length === 2) return `${parts[1]} ${parts[0]}`;
  if (parts.length === 3) return `${parts[1]} ${parts[2]} ${parts[0]}`;
  return [...parts.slice(-2), ...parts.slice(0, -2)].join(' ');
}

/**
 * Misma persona con distinto orden / nombre incompleto:
 * "Diana Soriano Reyes" ≡ "SORIANO REYES DIANA PATRICIA"
 * (el más corto debe tener ≥2 tokens y estar contenido en el más largo).
 */
function isSamePersonName(a, b) {
  const ta = personTokens(a);
  const tb = personTokens(b);
  if (!ta.length || !tb.length) return false;
  if (ta.length === tb.length) {
    return ta.every((t, i) => t === tb[i]);
  }
  const [short, long] = ta.length < tb.length ? [ta, tb] : [tb, ta];
  if (short.length < 2) return false;
  const longSet = new Set(long);
  return short.every((t) => longSet.has(t));
}

function preferVendedorDisplay(current, candidate) {
  const cur = String(current || '').replace(/\s+/g, ' ').trim();
  const next = String(candidate || '').replace(/\s+/g, ' ').trim();
  if (!cur) return next;
  if (!next) return cur;

  const nextIsSf = isSurnameFirstForm(next, cur);
  const curIsSf = isSurnameFirstForm(cur, next);
  if (nextIsSf && !curIsSf) return next;
  if (curIsSf && !nextIsSf) return cur;

  const curTok = personTokens(cur).length;
  const nextTok = personTokens(next).length;
  if (nextTok !== curTok) return nextTok > curTok ? next : cur;

  const curUp = !hasLowercaseLetters(cur);
  const nextUp = !hasLowercaseLetters(next);
  if (nextUp !== curUp) return nextUp ? next : cur;

  if (next.length !== cur.length) return next.length > cur.length ? next : cur;
  return cur;
}

/** Nombres de pila frecuentes: si el nombre empieza así, se reordena a APELLIDOS + NOMBRES. */
const COMMON_GIVEN_NAMES = new Set([
  'ADRIAN', 'ADRIANA', 'ALEJANDRA', 'ALEJANDRO', 'ALEX', 'ALEXA', 'ALEXANDER', 'ALFONSO',
  'ALICIA', 'ANA', 'ANDREA', 'ANDRES', 'ANGEL', 'ANGELA', 'ANTONIO', 'ARMANDO',
  'ARTURO', 'BEATRIZ', 'BENJAMIN', 'BRENDA', 'CARLA', 'CARLOS', 'CARMEN', 'CAROLINA',
  'CECILIA', 'CELIA', 'CESAR', 'CHRISTIAN', 'CLAUDIA', 'CRISTIAN', 'CRISTINA', 'DANIEL',
  'DANIELA', 'DAVID', 'DIANA', 'DIEGO', 'DULCE', 'EDUARDO', 'ELENA', 'ELIZABETH',
  'EMILIO', 'ENRIQUE', 'ERICK', 'ERIKA', 'ERNESTO', 'ESTEBAN', 'ESTHER', 'EVA',
  'FABIAN', 'FABIOLA', 'FELIPE', 'FERNANDO', 'FRANCISCO', 'GABRIEL', 'GABRIELA', 'GERARDO',
  'GLORIA', 'GUADALUPE', 'GUILLERMO', 'GUSTAVO', 'HECTOR', 'HUGO', 'IRMA', 'ISAAC',
  'ISABEL', 'IVAN', 'JAIME', 'JAVIER', 'JESUS', 'JOEL', 'JORGE', 'JOSE', 'JOSEFINA',
  'JUAN', 'JULIA', 'JULIO', 'KARLA', 'KAREN', 'LAURA', 'LEONARDO', 'LETICIA', 'LILIANA',
  'LORENA', 'LUCIA', 'LUIS', 'LUISA', 'MANUEL', 'MARCELA', 'MARCO', 'MARCOS', 'MARGARITA',
  'MARIA', 'MARIANA', 'MARIO', 'MARTA', 'MARTIN', 'MAURICIO', 'MAYRA', 'MIGUEL', 'MIRIAM',
  'MONICA', 'NANCY', 'NATALIA', 'NOEMI', 'NORMA', 'OCTAVIO', 'OLGA', 'OSCAR', 'PABLO',
  'PATRICIA', 'PAULA', 'PAULO', 'PEDRO', 'RAFAEL', 'RAQUEL', 'RAUL', 'REBECA', 'RICARDO',
  'ROBERTO', 'RODOLFO', 'RODRIGO', 'ROSA', 'ROSARIO', 'RUBEN', 'SALVADOR', 'SAMUEL',
  'SANDRA', 'SANTIAGO', 'SARA', 'SAUL', 'SERGIO', 'SILVIA', 'SOFIA', 'SUSANA', 'TERESA',
  'VALENTIN', 'VALERIA', 'VERONICA', 'VICENTE', 'VICTOR', 'VICTORIA', 'VIRGINIA', 'VIRIDIANA',
  'XIMENA', 'YOLANDA', 'ABIGAIL', 'ALAN', 'ALONDRA', 'ITZEL', 'IVETTE', 'JAZMIN', 'JIMENA',
  'KATIA', 'LIZBETH', 'MARLENE', 'MICHELLE', 'PAOLA', 'PERLA', 'REGINA', 'SEBASTIAN', 'YESENIA',
]);

function startsWithGivenName(name) {
  const parts = orderedNameTokens(name);
  return parts.length >= 2 && COMMON_GIVEN_NAMES.has(parts[0]);
}

/** Elige y normaliza la etiqueta visible: siempre APELLIDOS + NOMBRES en mayúsculas. */
function formatVendedorApellidosNombres(candidates) {
  const names = [...new Set(
    (candidates || [])
      .map((n) => String(n || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  )];
  if (!names.length) return null;

  let best = names[0];
  for (let i = 1; i < names.length; i += 1) {
    best = preferVendedorDisplay(best, names[i]);
  }

  const surnameFirst = names.find((n) =>
    names.some((o) => normalizeVendedorKey(o) !== normalizeVendedorKey(n) && isSurnameFirstForm(n, o))
  );
  if (surnameFirst) {
    return normalizeVendedorKey(surnameFirst);
  }

  // Title case / "Nombre Apellidos" → reordenar.
  if (hasLowercaseLetters(best) || startsWithGivenName(best)) {
    return toApellidosNombresUpper(best);
  }

  return normalizeVendedorKey(best);
}

function chunkArray(arr, size) {
  const out = [];
  const n = Math.max(1, Number(size) || 40);
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function avg(nums) {
  const list = (nums || []).filter((n) => Number.isFinite(n));
  if (!list.length) return null;
  return list.reduce((a, b) => a + b, 0) / list.length;
}

function roundMoney(n) {
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function inPeriod(fecha, fi, ff) {
  if (!fecha) return !fi && !ff;
  const f = String(fecha).slice(0, 10);
  if (fi && f < String(fi)) return false;
  if (ff && f > String(ff)) return false;
  return true;
}

function vendedorDateClause(column, fechaInicio, fechaFin, params) {
  const parts = [];
  if (fechaInicio) {
    parts.push(`${column} >= ?`);
    params.push(String(fechaInicio));
  }
  if (fechaFin) {
    parts.push(`${column} <= ?`);
    params.push(String(fechaFin));
  }
  return parts.length ? ` AND ${parts.join(' AND ')}` : '';
}

function collectVendedorVins(d, { clientesIds, vendedorKeys, fechaInicio, fechaFin }) {
  const vins = new Set();
  const keys = [...new Set((vendedorKeys || []).map(normalizeVendedorKey).filter(Boolean))];
  const actDate = 'COALESCE(fecha_inicio_ciclo, fecha_factura, fecha_crea_actividad, fecha_entrega)';
  if (clientesIds.length) {
    const ph = clientesIds.map(() => '?').join(',');
    const params = [...clientesIds];
    const dateSql = vendedorDateClause(actDate, fechaInicio, fechaFin, params);
    const rows = d.prepare(`
      SELECT DISTINCT UPPER(TRIM(vin)) AS vin
      FROM crm_actividades
      WHERE CAST(id_contacto AS TEXT) IN (${ph})
        AND vin IS NOT NULL AND TRIM(vin) <> ''
        ${dateSql}
    `).all(...params);
    for (const r of rows) {
      const vin = normalizeVin(r.vin);
      if (vin) vins.add(vin);
    }
  }
  if (keys.length) {
    const ph = keys.map(() => '?').join(',');
    const params = [...keys];
    const dateSql = vendedorDateClause(actDate, fechaInicio, fechaFin, params);
    const rows = d.prepare(`
      SELECT DISTINCT UPPER(TRIM(vin)) AS vin
      FROM crm_actividades
      WHERE UPPER(TRIM(vendedor)) IN (${ph})
        AND vin IS NOT NULL AND TRIM(vin) <> ''
        ${dateSql}
    `).all(...params);
    for (const r of rows) {
      const vin = normalizeVin(r.vin);
      if (vin) vins.add(vin);
    }
  }
  return [...vins];
}

function buildFinanciamientoVendedorStats(d, {
  tokenKey,
  vendedorNombre,
  vins,
  fechaInicio,
  fechaFin,
}) {
  if (!hasFinanciamientoTable(d) || !(tokenKey || vendedorNombre)) {
    return {
      fuente: 'crm_financiamiento',
      contratos: 0,
      vins: [],
      match: 'ninguno',
      montoFinanciarPromedio: null,
      montoFinanciarTotal: 0,
      enganchePromedio: null,
      plazoPromedio: null,
      plazos: [],
      pvas: {
        contratosConPva: 0,
        penetracionPct: null,
        porTipo: [],
        montoTotalPvas: 0,
        montoPromedioPvaPorContrato: null,
        promedioCantidadPvas: null,
        totalCantidadPvas: 0,
      },
      planes: [],
      tiposCompra: [],
      muestra: [],
    };
  }

  const vinSet = new Set((vins || []).map(normalizeVin).filter(Boolean));
  const all = d.prepare(`
    SELECT *
    FROM crm_financiamiento
    WHERE COALESCE(fecha_compra, fecha, fecha_timbrado) IS NOT NULL
       OR vin IS NOT NULL
  `).all();

  const byAsesor = [];
  const byVin = [];
  for (const row of all) {
    const fecha = row.fecha_compra || row.fecha || row.fecha_timbrado;
    if (!inPeriod(fecha, fechaInicio, fechaFin)) continue;
    const asesorTok = personTokenKey(row.asesor);
    const vin = normalizeVin(row.vin);
    const sameAsesor = Boolean(
      (vendedorNombre && isSamePersonName(row.asesor, vendedorNombre))
      || (tokenKey && asesorTok && (asesorTok === tokenKey || isSamePersonName(row.asesor, tokenKey)))
    );
    if (sameAsesor) byAsesor.push(row);
    else if (vin && vinSet.has(vin)) byVin.push(row);
  }

  const match = byAsesor.length ? 'asesor' : (byVin.length ? 'vin_cartera' : 'ninguno');
  const contratos = byAsesor.length ? byAsesor : byVin;
  const contratoVins = [...new Set(
    contratos.map((c) => normalizeVin(c.vin)).filter(Boolean)
  )];

  const montos = contratos.map((c) => Number(c.monto_financiar)).filter((n) => Number.isFinite(n) && n > 0);
  const enganches = contratos.map((c) => Number(c.enganche_monto)).filter((n) => Number.isFinite(n) && n > 0);
  const plazosNums = contratos.map((c) => Number(c.plazo_meses)).filter((n) => Number.isFinite(n) && n > 0);

  const plazoMap = new Map();
  for (const p of plazosNums) {
    plazoMap.set(p, (plazoMap.get(p) || 0) + 1);
  }
  const plazos = [...plazoMap.entries()]
    .map(([plazo, count]) => ({ plazo, count, pct: contratos.length ? Math.round((count / contratos.length) * 1000) / 10 : 0 }))
    .sort((a, b) => b.count - a.count || a.plazo - b.plazo);

  const pvaDefs = [
    { key: 'gap', label: 'GAP', col: 'gap_monto' },
    { key: 'garantia', label: 'Garantía extendida', col: 'garantia_extendida_monto' },
    { key: 'accesorios', label: 'Accesorios', col: 'accesorios_monto' },
    { key: 'onstar', label: 'OnStar', col: 'onstar_monto' },
    { key: 'mantenimiento', label: 'Mantenimientos', col: 'mantenimiento_integrado_monto' },
  ];
  const porTipo = pvaDefs.map((def) => {
    const con = contratos.filter((c) => Number(c[def.col] || 0) > 0);
    const monto = con.reduce((s, c) => s + Number(c[def.col] || 0), 0);
    return {
      tipo: def.label,
      key: def.key,
      contratos: con.length,
      penetracionPct: contratos.length ? Math.round((con.length / contratos.length) * 1000) / 10 : 0,
      montoTotal: roundMoney(monto),
      montoPromedio: roundMoney(avg(con.map((c) => Number(c[def.col] || 0)))),
    };
  });
  const contratosConPva = contratos.filter((c) => pvaDefs.some((def) => Number(c[def.col] || 0) > 0)).length;
  const montoTotalPvas = porTipo.reduce((s, t) => s + Number(t.montoTotal || 0), 0);
  const cantidadesPva = contratos.map((c) =>
    pvaDefs.reduce((n, def) => n + (Number(c[def.col] || 0) > 0 ? 1 : 0), 0)
  );
  const totalCantidadPvas = cantidadesPva.reduce((s, n) => s + n, 0);
  const promedioCantidadPvas = contratos.length
    ? Math.round((totalCantidadPvas / contratos.length) * 10) / 10
    : null;

  const planMap = new Map();
  const tipoMap = new Map();
  for (const c of contratos) {
    const plan = String(c.plan || c.plan_2 || '(sin plan)').trim() || '(sin plan)';
    planMap.set(plan, (planMap.get(plan) || 0) + 1);
    const tipo = String(c.tipo_compra || '(sin tipo)').trim() || '(sin tipo)';
    tipoMap.set(tipo, (tipoMap.get(tipo) || 0) + 1);
  }

  const muestra = contratos.slice(0, 12).map((c) => {
    const pvaLabels = pvaDefs.filter((def) => Number(c[def.col] || 0) > 0).map((def) => def.label);
    return {
      fecha: c.fecha_compra || c.fecha || null,
      cliente: c.cliente || null,
      vin: c.vin || null,
      unidad: c.unidad || null,
      contrato: c.no_contrato || c.contrato || null,
      plazo: Number(c.plazo_meses) || null,
      montoFinanciar: Number(c.monto_financiar) || null,
      enganche: Number(c.enganche_monto) || null,
      pvas: pvaLabels,
      cantidadPvas: pvaLabels.length,
    };
  });

  return {
    fuente: 'crm_financiamiento',
    match,
    contratos: contratos.length,
    vins: contratoVins,
    montoFinanciarPromedio: roundMoney(avg(montos)),
    montoFinanciarTotal: roundMoney(montos.reduce((s, n) => s + n, 0)),
    enganchePromedio: roundMoney(avg(enganches)),
    plazoPromedio: plazosNums.length ? Math.round(avg(plazosNums) * 10) / 10 : null,
    plazos,
    pvas: {
      contratosConPva,
      penetracionPct: contratos.length ? Math.round((contratosConPva / contratos.length) * 1000) / 10 : null,
      porTipo,
      montoTotalPvas: roundMoney(montoTotalPvas),
      montoPromedioPvaPorContrato: contratos.length ? roundMoney(montoTotalPvas / contratos.length) : null,
      totalCantidadPvas,
      promedioCantidadPvas,
    },
    planes: [...planMap.entries()].map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count).slice(0, 8),
    tiposCompra: [...tipoMap.entries()].map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
    muestra,
  };
}

function buildLibroVentasCrmStats(d, { clientesIds, vendedorKeys, fechaInicio, fechaFin }) {
  const keys = [...new Set((vendedorKeys || []).map(normalizeVendedorKey).filter(Boolean))];
  if (!keys.length) {
    return { fuente: 'crm_actividades', unidades: 0, clientes: 0, vins: 0, muestra: [] };
  }
  const actDate = 'COALESCE(fecha_factura, fecha_entrega, fecha_inicio_ciclo, fecha_crea_actividad)';
  const params = [...keys];
  const dateSql = vendedorDateClause(actDate, fechaInicio, fechaFin, params);
  const ph = keys.map(() => '?').join(',');
  const rows = d.prepare(`
    SELECT
      CAST(id_contacto AS TEXT) AS id_crm,
      nombre_contacto AS nombre,
      UPPER(TRIM(vin)) AS vin,
      num_factura AS factura,
      fecha_factura AS fecha,
      producto_vendido AS modelo,
      facturado_a AS cliente
    FROM crm_actividades
    WHERE UPPER(TRIM(vendedor)) IN (${ph})
      AND num_factura IS NOT NULL AND TRIM(num_factura) <> ''
      ${dateSql}
  `).all(...params);

  const byFactura = new Map();
  for (const r of rows) {
    const key = `${r.factura}|${r.vin || ''}`;
    if (!byFactura.has(key)) byFactura.set(key, r);
  }
  const ventas = [...byFactura.values()];
  return {
    fuente: 'crm_actividades',
    unidades: ventas.length,
    clientes: new Set(ventas.map((v) => v.id_crm).filter(Boolean)).size,
    vins: new Set(ventas.map((v) => normalizeVin(v.vin)).filter(Boolean)).size,
    muestra: ventas.slice(0, 15).map((v) => ({
      fecha: v.fecha || null,
      factura: v.factura || null,
      vin: v.vin || null,
      modelo: v.modelo || null,
      cliente: v.cliente || v.nombre || null,
      idCrm: v.id_crm || null,
    })),
  };
}

async function mapChunks(list, size, worker) {
  const chunks = chunkArray(list, size);
  const concurrency = 3;
  const results = [];
  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    const part = await Promise.all(batch.map((chunk, idx) => worker(chunk, i + idx)));
    results.push(...part);
  }
  return results;
}

async function queryLibroVentasSqlByVins(vins, fechaInicio, fechaFin) {
  const list = [...new Set((vins || []).map(normalizeVin).filter(Boolean))];
  if (!list.length) return [];
  const parts = await mapChunks(list, 40, async (chunk) => {
    const params = {};
    chunk.forEach((vin, i) => {
      params[`vin${i}`] = vin;
      params[`like${i}`] = `%${vin}`;
    });
    if (fechaInicio) params.fechaInicio = fechaInicio;
    if (fechaFin) params.fechaFin = fechaFin;
    const match = chunk.map((_, i) =>
      `(UPPER(LTRIM(RTRIM(v.VTE_SERIE))) = @vin${i} OR UPPER(LTRIM(RTRIM(v.VTE_SERIE))) LIKE @like${i})`
    ).join(' OR ');
    const dateSql = [
      fechaInicio ? 'AND CONVERT(DATE, v.VTE_FECHDOCTO, 103) >= @fechaInicio' : '',
      fechaFin ? 'AND CONVERT(DATE, v.VTE_FECHDOCTO, 103) <= @fechaFin' : '',
    ].filter(Boolean).join('\n');
    try {
      return await query(`
        SELECT
          UPPER(LTRIM(RTRIM(v.VTE_SERIE))) AS serie,
          LTRIM(RTRIM(v.VTE_DOCTO)) AS factura,
          v.VTE_FECHDOCTO AS fechaFactura,
          LTRIM(RTRIM(v.VTE_FORMAPAGO)) AS formaPago,
          LTRIM(RTRIM(veh.VEH_TIPOAUTO)) AS modelo,
          veh.VEH_ANMODELO AS anModelo,
          LTRIM(RTRIM(
            ISNULL(B.PER_PATERNO, '') + ' ' + ISNULL(B.PER_MATERNO, '') + ' ' + ISNULL(B.PER_NOMRAZON, '')
          )) AS vendedorLibro,
          LTRIM(RTRIM(
            ISNULL(A.PER_NOMRAZON, '') + ' ' + ISNULL(A.PER_PATERNO, '') + ' ' + ISNULL(A.PER_MATERNO, '')
          )) AS cliente
        FROM ADE_VTAFI v
        INNER JOIN SER_VEHICULO veh
          ON veh.VEH_NUMSERIE = v.VTE_SERIE
          AND veh.VEH_NOINVENTA > 0
        LEFT JOIN PER_PERSONAS A ON A.PER_IDPERSONA = v.VTE_IDCLIENTE
        LEFT JOIN PER_PERSONAS B ON B.PER_IDPERSONA = veh.VEH_VENDEDOR
        WHERE v.VTE_TIPODOCTO = 'A'
          AND v.VTE_STATUS = 'I'
          AND veh.VEH_SITUACION IN ('VEN')
          AND (${match})
          ${dateSql}
        ORDER BY CONVERT(DATE, v.VTE_FECHDOCTO, 103) DESC
      `, params);
    } catch (err) {
      console.warn('[crm] libro ventas SQL chunk:', err.message);
      return [];
    }
  });
  return parts.flat();
}

async function queryTallerReturnByVins(vins) {
  const list = [...new Set((vins || []).map(normalizeVin).filter(Boolean))];
  if (!list.length) {
    return { vinsConOrden: new Set(), ordenes: 0, importe: 0 };
  }
  const vinsConOrden = new Set();
  let ordenes = 0;
  let importe = 0;
  const parts = await mapChunks(list, 40, async (chunk) => {
    const params = {};
    chunk.forEach((vin, i) => {
      params[`vin${i}`] = vin;
      params[`like${i}`] = `%${vin}`;
    });
    const match = chunk.map((_, i) =>
      `(UPPER(LTRIM(RTRIM(o.ORE_NUMSERIE))) = @vin${i} OR UPPER(LTRIM(RTRIM(o.ORE_NUMSERIE))) LIKE @like${i})`
    ).join(' OR ');
    try {
      return await query(`
        SELECT
          UPPER(LTRIM(RTRIM(o.ORE_NUMSERIE))) AS serie,
          COUNT(*) AS ordenes,
          SUM(
            CASE
              WHEN ISNULL(fac.importe, 0) > 0 THEN fac.importe
              WHEN ISNULL(det.subtotal, 0) + ISNULL(det.iva, 0) > 0 THEN ISNULL(det.subtotal, 0) + ISNULL(det.iva, 0)
              ELSE ISNULL(tcx.importe, 0)
            END
          ) AS importe
        FROM SER_ORDEN o
        LEFT JOIN (
          SELECT fos_idorden, SUM(fos_total) AS importe
          FROM SER_FACORDEN
          GROUP BY fos_idorden
        ) fac ON fac.fos_idorden = o.ORE_IDORDEN
        LEFT JOIN (
          SELECT TCX_IDORDEN AS idorden, SUM(TCX_TOTAL) AS importe
          FROM SER_ORDTOTCXP
          WHERE TCX_STATUS IN ('T', 'A')
          GROUP BY TCX_IDORDEN
        ) tcx ON tcx.idorden = o.ORE_IDORDEN
        LEFT JOIN (
          SELECT ORD_IDORDEN AS idorden, SUM(ORD_SUBTOTAL) AS subtotal, SUM(ORD_IVATOT) AS iva
          FROM SER_ORDENDET
          GROUP BY ORD_IDORDEN
        ) det ON det.idorden = o.ORE_IDORDEN
        WHERE o.ORE_STATUS <> 'C'
          AND (${match})
        GROUP BY UPPER(LTRIM(RTRIM(o.ORE_NUMSERIE)))
      `, params);
    } catch (err) {
      console.warn('[crm] taller return SQL chunk:', err.message);
      return [];
    }
  });
  for (const rows of parts) {
    for (const r of rows) {
      const vin = normalizeVin(r.serie);
      if (vin) vinsConOrden.add(vin);
      ordenes += Number(r.ordenes || 0);
      importe += Number(r.importe || 0);
    }
  }
  return { vinsConOrden, ordenes, importe };
}

async function queryLibroVentasSqlByVendedor(vendedorNombre, fechaInicio, fechaFin) {
  const nombre = String(vendedorNombre || '').replace(/\s+/g, ' ').trim();
  if (!nombre) return [];
  const params = { vendedor: nombre.toUpperCase() };
  if (fechaInicio) params.fechaInicio = fechaInicio;
  if (fechaFin) params.fechaFin = fechaFin;
  const dateSql = [
    fechaInicio ? 'AND CONVERT(DATE, v.VTE_FECHDOCTO, 103) >= @fechaInicio' : '',
    fechaFin ? 'AND CONVERT(DATE, v.VTE_FECHDOCTO, 103) <= @fechaFin' : '',
  ].filter(Boolean).join('\n');
  try {
    return await query(`
      SELECT
        UPPER(LTRIM(RTRIM(v.VTE_SERIE))) AS serie,
        LTRIM(RTRIM(v.VTE_DOCTO)) AS factura,
        v.VTE_FECHDOCTO AS fechaFactura,
        LTRIM(RTRIM(v.VTE_FORMAPAGO)) AS formaPago,
        LTRIM(RTRIM(veh.VEH_TIPOAUTO)) AS modelo,
        veh.VEH_ANMODELO AS anModelo,
        LTRIM(RTRIM(
          ISNULL(B.PER_PATERNO, '') + ' ' + ISNULL(B.PER_MATERNO, '') + ' ' + ISNULL(B.PER_NOMRAZON, '')
        )) AS vendedorLibro,
        LTRIM(RTRIM(
          ISNULL(A.PER_NOMRAZON, '') + ' ' + ISNULL(A.PER_PATERNO, '') + ' ' + ISNULL(A.PER_MATERNO, '')
        )) AS cliente
      FROM ADE_VTAFI v
      INNER JOIN SER_VEHICULO veh
        ON veh.VEH_NUMSERIE = v.VTE_SERIE
        AND veh.VEH_NOINVENTA > 0
      LEFT JOIN PER_PERSONAS A ON A.PER_IDPERSONA = v.VTE_IDCLIENTE
      LEFT JOIN PER_PERSONAS B ON B.PER_IDPERSONA = veh.VEH_VENDEDOR
      WHERE v.VTE_TIPODOCTO = 'A'
        AND v.VTE_STATUS = 'I'
        AND veh.VEH_SITUACION IN ('VEN')
        AND UPPER(LTRIM(RTRIM(
          ISNULL(B.PER_PATERNO, '') + ' ' + ISNULL(B.PER_MATERNO, '') + ' ' + ISNULL(B.PER_NOMRAZON, '')
        ))) = @vendedor
        ${dateSql}
      ORDER BY CONVERT(DATE, v.VTE_FECHDOCTO, 103) DESC
    `, params);
  } catch (err) {
    console.warn('[crm] libro ventas SQL por vendedor:', err.message);
    return [];
  }
}

function summarizeLibroSqlRows(ventasSql) {
  const byDoc = new Map();
  for (const row of ventasSql || []) {
    const k = `${row.factura}|${row.serie}`;
    if (!byDoc.has(k)) byDoc.set(k, row);
  }
  const unique = [...byDoc.values()];
  const pagoMap = new Map();
  for (const row of unique) {
    const fp = String(row.formaPago || 'OTRO').trim() || 'OTRO';
    pagoMap.set(fp, (pagoMap.get(fp) || 0) + 1);
  }
  return {
    fuente: 'ADE_VTAFI',
    unidades: unique.length,
    porTipoPago: [...pagoMap.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
    muestra: unique.slice(0, 15).map((v) => ({
      fecha: v.fechaFactura || null,
      factura: v.factura || null,
      vin: v.serie || null,
      modelo: v.modelo || null,
      formaPago: v.formaPago || null,
      cliente: v.cliente || null,
      vendedorLibro: v.vendedorLibro || null,
    })),
    error: null,
  };
}

async function buildVendedorComercialStats(d, {
  vendedorKey,
  vendedorKeys,
  vendedorNombre,
  clientesIds,
  fechaInicio,
  fechaFin,
}) {
  const aliases = [...new Set(
    (vendedorKeys && vendedorKeys.length ? vendedorKeys : [vendedorKey])
      .map(normalizeVendedorKey)
      .filter(Boolean)
  )];
  const tokenKey = personTokenKey(vendedorNombre) || personTokenKey(aliases[0]);
  const vinsCrm = collectVendedorVins(d, {
    clientesIds,
    vendedorKeys: aliases,
    fechaInicio,
    fechaFin,
  });

  const financiamiento = buildFinanciamientoVendedorStats(d, {
    tokenKey,
    vendedorNombre: vendedorNombre || aliases[0],
    vins: vinsCrm,
    fechaInicio,
    fechaFin,
  });

  // Unir VINs del CRM + contratos F&I del asesor: evita subcontar ventas
  // cuando el CRM no trae VIN en el periodo pero sí hay contrato/factura.
  const vins = [...new Set([
    ...vinsCrm,
    ...(financiamiento.vins || []),
  ])];

  const libroCrm = buildLibroVentasCrmStats(d, {
    clientesIds,
    vendedorKeys: aliases,
    fechaInicio,
    fechaFin,
  });

  let libroSql = { unidades: 0, porTipoPago: [], muestra: [], error: null };
  let retorno = {
    vinsCartera: vins.length,
    vinsConTaller: 0,
    clientesConCompra: 0,
    clientesConTaller: 0,
    tasaRetornoPct: null,
    ordenes: 0,
    importeTaller: 0,
    error: null,
  };

  const [libroByVin, libroByVend, tallerResult] = await Promise.all([
    queryLibroVentasSqlByVins(vins, fechaInicio, fechaFin).catch((err) => {
      console.warn('[crm] libro por VIN:', err.message);
      return [];
    }),
    queryLibroVentasSqlByVendedor(vendedorNombre || vendedorKey, fechaInicio, fechaFin).catch((err) => {
      console.warn('[crm] libro por vendedor:', err.message);
      return [];
    }),
    queryTallerReturnByVins(vins).catch((err) => ({
      vinsConOrden: new Set(),
      ordenes: 0,
      importe: 0,
      error: err.message,
    })),
  ]);

  try {
    libroSql = summarizeLibroSqlRows([...(libroByVin || []), ...(libroByVend || [])]);
  } catch (err) {
    libroSql = { unidades: 0, porTipoPago: [], muestra: [], error: err.message };
  }

  if (tallerResult.error) {
    retorno.error = tallerResult.error;
  } else {
    const taller = tallerResult;
    let clientesConCompra = 0;
    let clientesConTaller = 0;
    if (clientesIds.length) {
      const ph = clientesIds.map(() => '?').join(',');
      const compraRows = d.prepare(`
        SELECT CAST(id_contacto AS TEXT) AS id_crm,
          GROUP_CONCAT(DISTINCT UPPER(TRIM(vin))) AS vins
        FROM crm_actividades
        WHERE CAST(id_contacto AS TEXT) IN (${ph})
          AND vin IS NOT NULL AND TRIM(vin) <> ''
        GROUP BY CAST(id_contacto AS TEXT)
      `).all(...clientesIds);
      clientesConCompra = compraRows.length;
      for (const row of compraRows) {
        const clientVins = String(row.vins || '').split(',').map(normalizeVin).filter(Boolean);
        if (clientVins.some((vin) => taller.vinsConOrden.has(vin))) clientesConTaller += 1;
      }
    }
    const base = clientesConCompra || vins.length;
    const retornos = clientesConCompra ? clientesConTaller : taller.vinsConOrden.size;
    retorno = {
      vinsCartera: vins.length,
      vinsConTaller: taller.vinsConOrden.size,
      clientesConCompra,
      clientesConTaller,
      tasaRetornoPct: base > 0 ? Math.round((retornos / base) * 1000) / 10 : null,
      ordenes: taller.ordenes,
      importeTaller: roundMoney(taller.importe),
      base: clientesConCompra ? 'clientes_con_compra' : 'vins_cartera',
    };
  }

  const sqlUnits = Number(libroSql.unidades || 0);
  const crmUnits = Number(libroCrm.unidades || 0);
  // Fuente fiel: libro ADE_VTAFI (SQL). CRM solo como respaldo si no hay facturas en DMS.
  const libroUnidades = sqlUnits > 0 ? sqlUnits : crmUnits;
  const libroFuente = sqlUnits > 0 ? 'ADE_VTAFI' : (crmUnits > 0 ? 'crm_facturas' : 'ninguna');

  return {
    vinsCartera: vins.length,
    libroVentas: {
      sql: libroSql,
      crm: libroCrm,
      unidades: libroUnidades,
      fuente: libroFuente,
    },
    financiamiento,
    retornoTaller: retorno,
  };
}

/**
 * Catálogo de vendedores / ejecutivos con conteo de clientes.
 */
function listVendedores({ q = '', limit = 250 } = {}) {
  const d = getDb();
  const max = Math.min(500, Math.max(1, Number(limit) || 250));
  const term = String(q || '').trim();
  const map = new Map();

  const bump = (nombre, clientes, fuente) => {
    const key = normalizeVendedorKey(nombre);
    if (!key) return;
    const display = String(nombre || '').replace(/\s+/g, ' ').trim();
    if (!map.has(key)) {
      map.set(key, {
        vendedor: display,
        key,
        clientes: 0,
        fuentes: new Set(),
        displays: new Set([display]),
      });
    }
    const row = map.get(key);
    row.displays.add(display);
    row.vendedor = preferVendedorDisplay(row.vendedor, display);
    row.clientes = Math.max(row.clientes, Number(clientes || 0));
    row.fuentes.add(fuente);
  };

  const actSql = `
    SELECT TRIM(vendedor) AS nombre, COUNT(DISTINCT id_contacto) AS clientes
    FROM crm_actividades
    WHERE vendedor IS NOT NULL AND TRIM(vendedor) <> ''
    GROUP BY UPPER(TRIM(vendedor))
  `;
  for (const r of d.prepare(actSql).all()) {
    bump(r.nombre, r.clientes, 'ciclos');
  }

  if (hasLeadsTable(d)) {
    const leadSql = `
      SELECT TRIM(ejecutivo_asignado) AS nombre, COUNT(DISTINCT id_crm) AS clientes
      FROM crm_leads
      WHERE ejecutivo_asignado IS NOT NULL AND TRIM(ejecutivo_asignado) <> ''
        AND id_crm IS NOT NULL
      GROUP BY UPPER(TRIM(ejecutivo_asignado))
    `;
    for (const r of d.prepare(leadSql).all()) {
      bump(r.nombre, r.clientes, 'leads');
    }
  }

  if (hasPruebasManejoTable(d)) {
    const pruebaSql = `
      SELECT TRIM(ejecutivo_ventas) AS nombre, COUNT(DISTINCT id_crm) AS clientes
      FROM crm_pruebas_manejo
      WHERE ejecutivo_ventas IS NOT NULL AND TRIM(ejecutivo_ventas) <> ''
        AND id_crm IS NOT NULL
      GROUP BY UPPER(TRIM(ejecutivo_ventas))
    `;
    for (const r of d.prepare(pruebaSql).all()) {
      bump(r.nombre, r.clientes, 'pruebas');
    }
  }

  if (hasSolicitudesTable(d)) {
    const solSql = `
      SELECT TRIM(asesor) AS nombre, COUNT(DISTINCT id_crm) AS clientes
      FROM crm_solicitudes
      WHERE asesor IS NOT NULL AND TRIM(asesor) <> ''
        AND id_crm IS NOT NULL
      GROUP BY UPPER(TRIM(asesor))
    `;
    for (const r of d.prepare(solSql).all()) {
      bump(r.nombre, r.clientes, 'solicitudes');
    }
  }

  // Fusionar alias de la misma persona (orden distinto / nombre incompleto).
  const clusters = [];
  const sorted = [...map.values()].sort((a, b) => {
    const tokDiff = personTokens(b.vendedor).length - personTokens(a.vendedor).length;
    if (tokDiff) return tokDiff;
    return b.clientes - a.clientes;
  });
  for (const row of sorted) {
    const found = clusters.find((c) => isSamePersonName(c.vendedor, row.vendedor));
    if (!found) {
      clusters.push({
        vendedor: row.vendedor,
        key: row.key,
        clientes: row.clientes,
        fuentes: new Set(row.fuentes),
        aliases: new Set([row.key]),
        displays: new Set(row.displays || [row.vendedor]),
      });
      continue;
    }
    for (const dname of (row.displays || [row.vendedor])) found.displays.add(dname);
    found.displays.add(row.vendedor);
    found.vendedor = preferVendedorDisplay(found.vendedor, row.vendedor);
    found.clientes = Math.max(found.clientes, row.clientes);
    found.aliases.add(row.key);
    for (const f of row.fuentes) found.fuentes.add(f);
  }

  const termUpper = term.toUpperCase();
  return clusters
    .map((r) => {
      const aliases = [...r.aliases];
      const display = formatVendedorApellidosNombres([...(r.displays || []), ...aliases])
        || normalizeVendedorKey(r.vendedor);
      return {
        vendedor: display,
        key: display,
        aliases: [...new Set([display, ...aliases].filter(Boolean))],
        clientes: r.clientes,
        fuentes: [...r.fuentes],
      };
    })
    .filter((r) => {
      if (!termUpper) return true;
      if (r.vendedor.toUpperCase().includes(termUpper)) return true;
      if (r.key.includes(termUpper)) return true;
      return (r.aliases || []).some((a) => String(a).includes(termUpper));
    })
    .sort((a, b) => b.clientes - a.clientes || a.vendedor.localeCompare(b.vendedor, 'es'))
    .slice(0, max);
}

function resolveVendedorAliases(d, vendedorRaw) {
  const rawKey = normalizeVendedorKey(vendedorRaw);
  if (!rawKey) return { display: null, key: null, aliases: [] };

  const catalog = listVendedores({ limit: 500 });
  const hit = catalog.find((v) =>
    v.key === rawKey
    || (v.aliases || []).includes(rawKey)
    || isSamePersonName(v.vendedor, vendedorRaw)
  );

  if (hit) {
    const aliases = [...new Set([hit.key, ...(hit.aliases || [])].filter(Boolean))];
    return { display: hit.vendedor, key: hit.key, aliases };
  }

  const display = resolveVendedorNombre(d, vendedorRaw) || String(vendedorRaw).replace(/\s+/g, ' ').trim();
  const key = normalizeVendedorKey(display) || rawKey;
  return { display, key, aliases: [key] };
}

function resolveVendedorNombre(d, vendedorRaw) {
  const key = normalizeVendedorKey(vendedorRaw);
  if (!key) return null;

  const exact = d.prepare(`
    SELECT TRIM(vendedor) AS nombre
    FROM crm_actividades
    WHERE vendedor IS NOT NULL AND UPPER(TRIM(vendedor)) = ?
    LIMIT 1
  `).get(key);
  if (exact?.nombre) return String(exact.nombre).replace(/\s+/g, ' ').trim();

  if (hasLeadsTable(d)) {
    const lead = d.prepare(`
      SELECT TRIM(ejecutivo_asignado) AS nombre
      FROM crm_leads
      WHERE ejecutivo_asignado IS NOT NULL AND UPPER(TRIM(ejecutivo_asignado)) = ?
      LIMIT 1
    `).get(key);
    if (lead?.nombre) return String(lead.nombre).replace(/\s+/g, ' ').trim();
  }

  // Misma persona con otro orden / incompleto
  const candidates = listVendedores({ limit: 500 })
    .filter((v) => v.key === key || (v.aliases || []).includes(key) || isSamePersonName(v.vendedor, vendedorRaw));
  if (candidates.length === 1) return candidates[0].vendedor;
  if (candidates.length > 1) {
    const exactKey = candidates.find((v) => v.key === key);
    if (exactKey) return exactKey.vendedor;
    return preferVendedorDisplay(candidates[0].vendedor, candidates[1].vendedor);
  }
  return String(vendedorRaw || '').replace(/\s+/g, ' ').trim() || null;
}

/**
 * Acumulado de actividad CRM de los clientes vinculados a un vendedor.
 * Vinculación: actividades.vendedor | leads.ejecutivo | pruebas.ejecutivo | solicitudes.asesor
 */
async function getVendedorResumen({
  vendedor,
  fechaInicio = null,
  fechaFin = null,
  limit = 300,
} = {}) {
  const d = getDb();
  const resolved = resolveVendedorAliases(d, vendedor);
  const nombre = resolved.display || resolveVendedorNombre(d, vendedor);
  const key = resolved.key || normalizeVendedorKey(nombre || vendedor);
  const aliases = (resolved.aliases && resolved.aliases.length)
    ? resolved.aliases
    : (key ? [key] : []);
  if (!key || !aliases.length) throw new Error('Indique un vendedor válido.');

  const max = Math.min(500, Math.max(1, Number(limit) || 300));
  const fi = fechaInicio ? String(fechaInicio) : null;
  const ff = fechaFin ? String(fechaFin) : null;
  if (fi && ff && fi > ff) {
    throw new Error('La fecha inicial no puede ser posterior a la final.');
  }

  const aliasPh = aliases.map(() => '?').join(',');
  const actDate = 'COALESCE(fecha_inicio_ciclo, fecha_factura, fecha_crea_actividad, fecha_entrega)';
  const clientUnions = [];
  const clientParams = [];

  {
    const p = [...aliases];
    const dateSql = vendedorDateClause(actDate, fi, ff, p);
    clientUnions.push(`
      SELECT CAST(id_contacto AS TEXT) AS id_crm
      FROM crm_actividades
      WHERE id_contacto IS NOT NULL
        AND UPPER(TRIM(vendedor)) IN (${aliasPh})
        ${dateSql}
    `);
    clientParams.push(...p);
  }

  if (hasLeadsTable(d)) {
    const p = [...aliases];
    const dateSql = vendedorDateClause('fecha_entrada', fi, ff, p);
    clientUnions.push(`
      SELECT CAST(id_crm AS TEXT) AS id_crm
      FROM crm_leads
      WHERE id_crm IS NOT NULL
        AND UPPER(TRIM(ejecutivo_asignado)) IN (${aliasPh})
        ${dateSql}
    `);
    clientParams.push(...p);
  }

  if (hasPruebasManejoTable(d)) {
    const p = [...aliases];
    const dateSql = vendedorDateClause('fecha', fi, ff, p);
    clientUnions.push(`
      SELECT CAST(id_crm AS TEXT) AS id_crm
      FROM crm_pruebas_manejo
      WHERE id_crm IS NOT NULL
        AND UPPER(TRIM(ejecutivo_ventas)) IN (${aliasPh})
        ${dateSql}
    `);
    clientParams.push(...p);
  }

  if (hasSolicitudesTable(d)) {
    const p = [...aliases];
    const dateSql = vendedorDateClause('fecha_solicitud', fi, ff, p);
    clientUnions.push(`
      SELECT CAST(id_crm AS TEXT) AS id_crm
      FROM crm_solicitudes
      WHERE id_crm IS NOT NULL
        AND UPPER(TRIM(asesor)) IN (${aliasPh})
        ${dateSql}
    `);
    clientParams.push(...p);
  }

  const clientesIds = d.prepare(`
    SELECT DISTINCT id_crm FROM (${clientUnions.join(' UNION ')})
    WHERE id_crm IS NOT NULL AND TRIM(id_crm) <> ''
  `).all(...clientParams).map((r) => String(r.id_crm));

  const totales = {
    clientes: clientesIds.length,
    actividades: 0,
    ciclos: 0,
    compras: 0,
    leads: 0,
    solicitudes: 0,
    pruebas: 0,
  };

  if (!clientesIds.length) {
    const comercial = await buildVendedorComercialStats(d, {
      vendedorKey: key,
      vendedorKeys: aliases,
      vendedorNombre: nombre || key,
      clientesIds: [],
      fechaInicio: fi,
      fechaFin: ff,
    });
    return {
      vendedor: nombre || key,
      key,
      aliases,
      periodo: { fechaInicio: fi, fechaFin: ff },
      totales,
      comercial,
      clientes: [],
    };
  }

  // Agregados por cliente (actividad de la cartera del vendedor en el periodo)
  const placeholders = clientesIds.map(() => '?').join(',');
  const actParams = [...clientesIds];
  const actPeriod = vendedorDateClause(actDate, fi, ff, actParams);
  const porActividad = d.prepare(`
    SELECT
      CAST(id_contacto AS TEXT) AS id_crm,
      MAX(nombre_contacto) AS nombre,
      COUNT(DISTINCT id_ciclo) AS ciclos,
      COUNT(*) AS actividades,
      COUNT(DISTINCT CASE WHEN vin IS NOT NULL AND TRIM(vin) <> '' THEN UPPER(TRIM(vin)) END) AS compras,
      MAX(${actDate}) AS ultima_actividad
    FROM crm_actividades
    WHERE CAST(id_contacto AS TEXT) IN (${placeholders})
      ${actPeriod}
    GROUP BY CAST(id_contacto AS TEXT)
  `).all(...actParams);

  const byId = new Map();
  for (const id of clientesIds) {
    byId.set(id, {
      id_contacto: id,
      nombre: null,
      telefono: null,
      correo: null,
      ciclos: 0,
      actividades: 0,
      compras: 0,
      leads: 0,
      solicitudes: 0,
      pruebas: 0,
      ultima_actividad: null,
    });
  }

  for (const r of porActividad) {
    const row = byId.get(String(r.id_crm));
    if (!row) continue;
    row.nombre = r.nombre || row.nombre;
    row.ciclos = Number(r.ciclos || 0);
    row.actividades = Number(r.actividades || 0);
    row.compras = Number(r.compras || 0);
    row.ultima_actividad = r.ultima_actividad || row.ultima_actividad;
    totales.ciclos += row.ciclos;
    totales.actividades += row.actividades;
    totales.compras += row.compras;
  }

  if (hasLeadsTable(d)) {
    const p = [...clientesIds];
    const dateSql = vendedorDateClause('fecha_entrada', fi, ff, p);
    const rows = d.prepare(`
      SELECT CAST(id_crm AS TEXT) AS id_crm,
        MAX(nombre) AS nombre,
        MAX(telefono) AS telefono,
        MAX(correo) AS correo,
        COUNT(*) AS leads,
        MAX(fecha_entrada) AS ultima
      FROM crm_leads
      WHERE CAST(id_crm AS TEXT) IN (${placeholders})
        ${dateSql}
      GROUP BY CAST(id_crm AS TEXT)
    `).all(...p);
    for (const r of rows) {
      const row = byId.get(String(r.id_crm));
      if (!row) continue;
      row.leads = Number(r.leads || 0);
      row.nombre = row.nombre || r.nombre;
      row.telefono = row.telefono || r.telefono;
      row.correo = row.correo || r.correo;
      totales.leads += row.leads;
      if (!row.ultima_actividad || (r.ultima && String(r.ultima) > String(row.ultima_actividad))) {
        row.ultima_actividad = r.ultima;
      }
    }
  }

  if (hasSolicitudesTable(d)) {
    const p = [...clientesIds];
    const dateSql = vendedorDateClause('fecha_solicitud', fi, ff, p);
    const rows = d.prepare(`
      SELECT CAST(id_crm AS TEXT) AS id_crm, COUNT(*) AS n, MAX(fecha_solicitud) AS ultima
      FROM crm_solicitudes
      WHERE CAST(id_crm AS TEXT) IN (${placeholders})
        ${dateSql}
      GROUP BY CAST(id_crm AS TEXT)
    `).all(...p);
    for (const r of rows) {
      const row = byId.get(String(r.id_crm));
      if (!row) continue;
      row.solicitudes = Number(r.n || 0);
      totales.solicitudes += row.solicitudes;
      if (!row.ultima_actividad || (r.ultima && String(r.ultima) > String(row.ultima_actividad))) {
        row.ultima_actividad = r.ultima;
      }
    }
  }

  if (hasPruebasManejoTable(d)) {
    const p = [...clientesIds];
    const dateSql = vendedorDateClause('fecha', fi, ff, p);
    const rows = d.prepare(`
      SELECT CAST(id_crm AS TEXT) AS id_crm, COUNT(*) AS n, MAX(fecha) AS ultima,
        MAX(nombre_cliente) AS nombre,
        MAX(telefono) AS telefono,
        MAX(correo) AS correo
      FROM crm_pruebas_manejo
      WHERE CAST(id_crm AS TEXT) IN (${placeholders})
        ${dateSql}
      GROUP BY CAST(id_crm AS TEXT)
    `).all(...p);
    for (const r of rows) {
      const row = byId.get(String(r.id_crm));
      if (!row) continue;
      row.pruebas = Number(r.n || 0);
      row.nombre = row.nombre || r.nombre;
      row.telefono = row.telefono || r.telefono;
      row.correo = row.correo || r.correo;
      totales.pruebas += row.pruebas;
      if (!row.ultima_actividad || (r.ultima && String(r.ultima) > String(row.ultima_actividad))) {
        row.ultima_actividad = r.ultima;
      }
    }
  }

  const clientes = [...byId.values()]
    .sort((a, b) => {
      const score = (x) => (x.compras * 10) + x.ciclos + x.leads + x.solicitudes + x.pruebas + x.actividades;
      const diff = score(b) - score(a);
      if (diff) return diff;
      return String(b.ultima_actividad || '').localeCompare(String(a.ultima_actividad || ''));
    })
    .slice(0, max);

  const comercial = await buildVendedorComercialStats(d, {
    vendedorKey: key,
    vendedorKeys: aliases,
    vendedorNombre: nombre || key,
    clientesIds,
    fechaInicio: fi,
    fechaFin: ff,
  });

  // Alinear Compras (VIN) con Libro de ventas (ADE_VTAFI): misma fuente fiel.
  const comprasCrm = Number(totales.compras || 0);
  const comprasLibro = Number(comercial?.libroVentas?.unidades || 0);
  totales.comprasCrm = comprasCrm;
  if (comprasLibro > 0 || comercial?.libroVentas?.fuente === 'ADE_VTAFI') {
    totales.compras = comprasLibro;
    totales.comprasFuente = comercial?.libroVentas?.fuente || 'ADE_VTAFI';
  } else {
    totales.comprasFuente = 'crm_vin';
  }

  const quejasCsi = getQuejasCsiSummary({
    persona: nombre || key,
    rol: 'auto',
    tipoIncidencia: 'quejas',
    fechaInicio: fi,
    fechaFin: ff,
    limit: 15,
  });

  return {
    vendedor: nombre || key,
    key,
    aliases,
    periodo: { fechaInicio: fi, fechaFin: ff },
    totales,
    comercial,
    clientes,
    quejasCsi: {
      encontrado: Boolean(quejasCsi.encontrado),
      total: Number(quejasCsi.totalesPersona?.total || 0),
      posventa: Number(quejasCsi.totalesPersona?.posventa || 0),
      ventas: Number(quejasCsi.totalesPersona?.ventas || 0),
      porArea: quejasCsi.totalesPersona?.porArea || [],
      porPersona: quejasCsi.porPersona || [],
      coincidencias: quejasCsi.coincidencias || [],
      muestra: quejasCsi.detalle || [],
    },
  };
}

function pctBdc(part, total) {
  const p = Number(part);
  const t = Number(total);
  if (!Number.isFinite(p) || !Number.isFinite(t) || t <= 0) return null;
  return Math.round((p / t) * 1000) / 10;
}

/**
 * Embudo BDC sobre crm_actividades + crm_leads (histórico local Balderrama Ciclos).
 * Contactos = unión de:
 *  - contactos con ciclo iniciado en el periodo
 *  - leads no duplicados con ejecutivo de ventas asignado (cartera EV)
 *    por fecha_asignacion (o fecha_entrada si no hay asignación)
 * Respaldo cuando Railway no responde; la fuente operativa de citas sigue siendo crm_ciclos en la nube.
 */
function getBdcEmbudo({ fechaInicio, fechaFin } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaInicio || '')
    || !/^\d{4}-\d{2}-\d{2}$/.test(fechaFin || '')) {
    return { disponible: false, status: 'sin-periodo', real: null };
  }
  if (!isAvailable()) {
    return { disponible: false, status: 'sin-crm', real: null };
  }

  const d = getDb();
  const hasLeads = hasLeadsTable(d);

  const row = hasLeads
    ? d.prepare(`
    WITH ciclos_periodo AS (
      SELECT *
      FROM crm_actividades
      WHERE substr(COALESCE(fecha_inicio_ciclo, ''), 1, 10) BETWEEN ? AND ?
        AND substr(COALESCE(fecha_inicio_ciclo, ''), 1, 10) GLOB '????-??-??'
    ),
    contactos_ciclo AS (
      SELECT DISTINCT TRIM(id_contacto) AS id
      FROM ciclos_periodo
      WHERE TRIM(COALESCE(id_contacto, '')) <> ''
    ),
    citas AS (
      SELECT * FROM ciclos_periodo WHERE UPPER(TRIM(tipo_actividad)) = 'CITA'
    ),
    leads_asignados AS (
      SELECT DISTINCT TRIM(id_crm) AS id
      FROM crm_leads
      WHERE COALESCE(es_duplicado, 0) = 0
        AND TRIM(COALESCE(ejecutivo_asignado, '')) <> ''
        AND TRIM(COALESCE(id_crm, '')) <> ''
        AND substr(
          COALESCE(NULLIF(TRIM(fecha_asignacion), ''), fecha_entrada, ''),
          1, 10
        ) BETWEEN ? AND ?
        AND substr(
          COALESCE(NULLIF(TRIM(fecha_asignacion), ''), fecha_entrada, ''),
          1, 10
        ) GLOB '????-??-??'
    )
    SELECT
      (SELECT COUNT(*) FROM contactos_ciclo) AS contactos_ciclos,
      (SELECT COUNT(*) FROM leads_asignados) AS contactos_leads_asignados,
      (
        SELECT COUNT(*) FROM contactos_ciclo c
        INNER JOIN leads_asignados l ON l.id = c.id
      ) AS contactos_overlap,
      (SELECT COUNT(*) FROM citas) AS citas_agendadas,
      (SELECT COUNT(*) FROM citas WHERE TRIM(COALESCE(fecha_resp_actividad, '')) <> '') AS citas_confirmadas,
      (SELECT COUNT(*) FROM citas WHERE
         UPPER(COALESCE(resultado_actividad, '')) = 'PM OK'
         OR UPPER(COALESCE(resultado_actividad, '')) LIKE '%CONFIRMA%ASISTENCIA%'
         OR UPPER(COALESCE(resultado_actividad, '')) LIKE '%CITA%CUMPLIDA%'
         OR UPPER(COALESCE(resultado_actividad, '')) LIKE '%CLIENTE%ASISTE%'
         OR UPPER(COALESCE(resultado_actividad, '')) LIKE '%CLIENTE%ACUDE%'
         OR UPPER(COALESCE(resultado_actividad, '')) LIKE '%CONTACTO EN PISO%'
      ) AS citas_cumplidas,
      (SELECT COUNT(DISTINCT id_contacto) FROM ciclos_periodo
         WHERE TRIM(COALESCE(fecha_entrega, '')) <> ''
           AND substr(fecha_entrega, 1, 10) BETWEEN ? AND ?
      ) AS entregas_bdc
  `).get(fechaInicio, fechaFin, fechaInicio, fechaFin, fechaInicio, fechaFin)
    : d.prepare(`
    WITH ciclos_periodo AS (
      SELECT *
      FROM crm_actividades
      WHERE substr(COALESCE(fecha_inicio_ciclo, ''), 1, 10) BETWEEN ? AND ?
        AND substr(COALESCE(fecha_inicio_ciclo, ''), 1, 10) GLOB '????-??-??'
    ),
    contactos_ciclo AS (
      SELECT DISTINCT TRIM(id_contacto) AS id
      FROM ciclos_periodo
      WHERE TRIM(COALESCE(id_contacto, '')) <> ''
    ),
    citas AS (
      SELECT * FROM ciclos_periodo WHERE UPPER(TRIM(tipo_actividad)) = 'CITA'
    )
    SELECT
      (SELECT COUNT(*) FROM contactos_ciclo) AS contactos_ciclos,
      0 AS contactos_leads_asignados,
      0 AS contactos_overlap,
      (SELECT COUNT(*) FROM citas) AS citas_agendadas,
      (SELECT COUNT(*) FROM citas WHERE TRIM(COALESCE(fecha_resp_actividad, '')) <> '') AS citas_confirmadas,
      (SELECT COUNT(*) FROM citas WHERE
         UPPER(COALESCE(resultado_actividad, '')) = 'PM OK'
         OR UPPER(COALESCE(resultado_actividad, '')) LIKE '%CONFIRMA%ASISTENCIA%'
         OR UPPER(COALESCE(resultado_actividad, '')) LIKE '%CITA%CUMPLIDA%'
         OR UPPER(COALESCE(resultado_actividad, '')) LIKE '%CLIENTE%ASISTE%'
         OR UPPER(COALESCE(resultado_actividad, '')) LIKE '%CLIENTE%ACUDE%'
         OR UPPER(COALESCE(resultado_actividad, '')) LIKE '%CONTACTO EN PISO%'
      ) AS citas_cumplidas,
      (SELECT COUNT(DISTINCT id_contacto) FROM ciclos_periodo
         WHERE TRIM(COALESCE(fecha_entrega, '')) <> ''
           AND substr(fecha_entrega, 1, 10) BETWEEN ? AND ?
      ) AS entregas_bdc
  `).get(fechaInicio, fechaFin, fechaInicio, fechaFin);

  const ciclos = Number(row?.contactos_ciclos || 0);
  const leadsAsignados = hasLeads ? Number(row?.contactos_leads_asignados || 0) : 0;
  const overlap = hasLeads ? Number(row?.contactos_overlap || 0) : 0;
  const contactos = Math.max(0, ciclos + leadsAsignados - overlap);

  const real = {
    contactos,
    contactosCiclos: ciclos,
    contactosLeadsAsignados: leadsAsignados,
    contactosOverlap: overlap,
    citasAgendadas: Number(row?.citas_agendadas || 0),
    citasConfirmadas: Number(row?.citas_confirmadas || 0),
    citasCumplidas: Number(row?.citas_cumplidas || 0),
    entregasBdc: Number(row?.entregas_bdc || 0),
  };

  return {
    disponible: real.contactos > 0,
    status: real.contactos > 0 ? 'completo' : 'sin-datos',
    real,
    fuente: hasLeads
      ? 'crm_actividades + crm_leads (EV asignados)'
      : 'crm_actividades (histórico local)',
    conversion: {
      citasSobreContactosPct: pctBdc(real.citasAgendadas, real.contactos),
      confirmadasSobreAgendadasPct: pctBdc(real.citasConfirmadas, real.citasAgendadas),
      cumplidasSobreConfirmadasPct: pctBdc(real.citasCumplidas, real.citasConfirmadas),
      entregasSobreCumplidasPct: pctBdc(real.entregasBdc, real.citasCumplidas),
    },
    nota: hasLeads
      ? `Contactos = ciclos del periodo (${ciclos}) ∪ leads con ejecutivo asignado (${leadsAsignados}; solape ${overlap}).`
      : 'Contactos = ciclos iniciados en el periodo. Sin tabla crm_leads para cartera EV.',
  };
}

/**
 * Días naturales entre dos fechas ISO (YYYY-MM-DD).
 */
function daysBetweenIso(startIso, endIso) {
  const a = toIsoDate(startIso);
  const b = toIsoDate(endIso);
  if (!a || !b) return null;
  const start = new Date(`${a}T00:00:00`);
  const end = new Date(`${b}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.round((end - start) / 86400000);
}

function rangoAntiguedad(dias) {
  if (dias == null || dias < 0) return null;
  if (dias <= 30) return '0-30';
  if (dias <= 90) return '31-90';
  if (dias <= 180) return '91-180';
  return '>180';
}

/**
 * Índice de compras históricas por ID CRM (historial 360):
 * VIN → fecha más temprana de factura/entrega/inicio de ciclo.
 * No usa órdenes de taller (CMI prohíbe inferir recompra por posventa).
 */
function buildPurchaseHistoryByContact(d) {
  const byContact = new Map();
  const add = (idRaw, vinRaw, fechaRaw) => {
    const id = String(idRaw || '').trim();
    const vin = normalizeVin(vinRaw);
    if (!id || !vin) return;
    const fecha = toIsoDate(fechaRaw);
    if (!byContact.has(id)) byContact.set(id, new Map());
    const m = byContact.get(id);
    const prev = m.get(vin);
    if (!prev) m.set(vin, fecha);
    else if (fecha && fecha < prev) m.set(vin, fecha);
  };

  for (const r of d.prepare(`
    SELECT id_contacto AS id, vin,
           fecha_factura, fecha_entrega, fecha_inicio_ciclo
    FROM crm_actividades
    WHERE id_contacto IS NOT NULL
      AND vin IS NOT NULL AND trim(vin) <> ''
  `).all()) {
    add(r.id, r.vin, r.fecha_factura || r.fecha_entrega || r.fecha_inicio_ciclo);
  }

  if (hasLeadsTable(d)) {
    for (const r of d.prepare(`
      SELECT id_crm AS id, vin_comprado AS vin,
             fecha_factura, fecha_entrega, fecha_entrada
      FROM crm_leads
      WHERE id_crm IS NOT NULL
        AND vin_comprado IS NOT NULL AND trim(vin_comprado) <> ''
    `).all()) {
      add(r.id, r.vin, r.fecha_factura || r.fecha_entrega || r.fecha_entrada);
    }
  }

  if (hasFinanciamientoTable(d)) {
    for (const r of d.prepare(`
      SELECT vin, fecha_compra, fecha
      FROM crm_financiamiento
      WHERE vin IS NOT NULL AND trim(vin) <> ''
    `).all()) {
      const id = resolveIdCrmBySerie(r.vin);
      if (id) add(id, r.vin, r.fecha_compra || r.fecha);
    }
  }

  return byContact;
}

/**
 * Fecha de captura CRM de la oportunidad que produjo la entrega (por VIN + ID).
 * Usa inicio de ciclo / entrada de lead del VIN entregado — no el primer contacto histórico
 * del cliente (evita inflar >180 en recompras).
 * Fallback por contacto: última captura ≤ fecha de entrega (ciclo que pudo originar la venta).
 */
function buildCaptureDateByContactVin(d) {
  const map = new Map();
  const byContact = new Map(); // id -> sorted unique fechas ISO
  const keyOf = (id, vin) => `${String(id)}|${vin}`;
  const setMin = (idRaw, vinRaw, fechaRaw) => {
    const id = String(idRaw || '').trim();
    const vin = normalizeVin(vinRaw);
    const fecha = toIsoDate(fechaRaw);
    if (!id || !fecha) return;
    if (vin) {
      const k = keyOf(id, vin);
      const prev = map.get(k);
      if (!prev || fecha < prev) map.set(k, fecha);
    }
    if (!byContact.has(id)) byContact.set(id, []);
    byContact.get(id).push(fecha);
  };

  for (const r of d.prepare(`
    SELECT id_contacto AS id, vin, fecha_inicio_ciclo, fecha_crea_actividad
    FROM crm_actividades
    WHERE id_contacto IS NOT NULL
  `).all()) {
    setMin(r.id, r.vin, r.fecha_inicio_ciclo || r.fecha_crea_actividad);
  }

  if (hasLeadsTable(d)) {
    for (const r of d.prepare(`
      SELECT id_crm AS id, vin_comprado AS vin, fecha_entrada
      FROM crm_leads
      WHERE id_crm IS NOT NULL AND fecha_entrada IS NOT NULL
    `).all()) {
      setMin(r.id, r.vin, r.fecha_entrada);
    }
  }

  // Deduplicate and sort fechas por contacto
  for (const [id, fechas] of byContact.entries()) {
    byContact.set(id, [...new Set(fechas)].sort());
  }

  return { byVin: map, byContact };
}

function findCaptureDate(captureIndex, idCrm, vin, fechaEntrega) {
  if (!idCrm || !captureIndex) return null;
  const id = String(idCrm);
  const byVin = captureIndex.byVin || captureIndex;
  const byContact = captureIndex.byContact || null;

  if (vin) {
    const exact = byVin.get?.(`${id}|${normalizeVin(vin)}`);
    if (exact) return exact;
    let best = null;
    for (const [key, fecha] of (byVin.entries?.() || [])) {
      if (!key.startsWith(`${id}|`)) continue;
      const keyVin = key.slice(id.length + 1);
      if (!matchCrmVinToSerie(keyVin, vin)) continue;
      if (!best || (fecha && fecha < best)) best = fecha;
    }
    if (best) return best;
  }

  // Fallback: captura más reciente del contacto en o antes de la entrega
  if (byContact && fechaEntrega) {
    const fechas = byContact.get(id) || [];
    let pick = null;
    for (const f of fechas) {
      if (f <= fechaEntrega) pick = f;
      else break;
    }
    return pick;
  }
  return null;
}

async function loadDmsPurchaseHistoryByClient(clientIds = []) {
  const ids = [...new Set(
    (clientIds || [])
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n > 0),
  )];
  const byClient = new Map();
  if (!ids.length) return { error: null, byClient };

  const chunkSize = 400;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const params = {};
    const placeholders = chunk.map((id, idx) => {
      const key = `id${idx}`;
      params[key] = id;
      return `@${key}`;
    }).join(',');
    let rows = [];
    try {
      rows = await query(`
        SELECT
          a.VTE_IDCLIENTE AS idCliente,
          UPPER(LTRIM(RTRIM(a.VTE_SERIE))) AS serie,
          CONVERT(varchar(10), CONVERT(date, a.VTE_FECHDOCTO, 103), 23) AS fecha
        FROM ADE_VTAFI a
        WHERE a.VTE_TIPODOCTO = 'A'
          AND a.VTE_IDCLIENTE IN (${placeholders})
          AND a.VTE_SERIE IS NOT NULL
          AND LTRIM(RTRIM(a.VTE_SERIE)) <> ''
      `, params);
    } catch (err) {
      return { error: err.message || String(err), byClient };
    }
    for (const r of rows || []) {
      const id = String(r.idCliente);
      const vin = normalizeVin(r.serie);
      const fecha = toIsoDate(r.fecha);
      if (!id || !vin) continue;
      if (!byClient.has(id)) byClient.set(id, new Map());
      const m = byClient.get(id);
      const prev = m.get(vin);
      if (!prev) m.set(vin, fecha);
      else if (fecha && fecha < prev) m.set(vin, fecha);
    }
  }
  return { error: null, byClient };
}

function countPriorPurchases(purchaseMap, currentVin, fechaEntrega) {
  if (!purchaseMap || !purchaseMap.size) return 0;
  let prior = 0;
  for (const [vin, fecha] of purchaseMap.entries()) {
    if (matchCrmVinToSerie(vin, currentVin)) continue;
    if (!fechaEntrega) {
      prior += 1;
      continue;
    }
    if (!fecha || fecha < fechaEntrega) prior += 1;
  }
  return prior;
}

/**
 * Clasifica entregas SOFIA (mismo universo C-1) con historial 360 + facturación DMS.
 * C-6: primera compra vs recurrente.
 * C-6.1: distribución por antigüedad captura CRM → entrega.
 *
 * @param {Array<object>} entregasSofia
 */
async function loadPhonesByClient(clientIds = []) {
  const ids = [...new Set(
    (clientIds || [])
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n > 0),
  )];
  const byClient = new Map();
  if (!ids.length) return byClient;

  const chunkSize = 400;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const placeholders = chunk.map((_, idx) => `@id${idx}`).join(',');
    const params = {};
    chunk.forEach((id, idx) => { params[`id${idx}`] = id; });
    try {
      const rows = await query(`
        SELECT
          PER_IDPERSONA AS idCliente,
          LTRIM(RTRIM(PER_TELEFONO1)) AS telefono,
          LTRIM(RTRIM(PER_TELCELULAR)) AS celular
        FROM PER_PERSONAS
        WHERE PER_IDPERSONA IN (${placeholders})
      `, params);
      for (const r of rows || []) {
        byClient.set(String(r.idCliente), {
          telefono: r.telefono || null,
          celular: r.celular || null,
        });
      }
    } catch (_) {
      // Si falla el lookup de teléfonos, se sigue con VIN/nombre/factura.
    }
  }
  return byClient;
}

async function classifyEntregasTipoCliente(entregasSofia = []) {
  const list = Array.isArray(entregasSofia) ? entregasSofia : [];
  const empty = {
    disponible: false,
    total: list.length,
    primeraCompra: 0,
    recurrente: 0,
    sinClasificar: list.length,
    pctPrimeraCompra: null,
    pctRecurrente: null,
    coberturaPct: null,
    antiguedad: {
      clasificables: 0,
      noClasificables: list.length,
      coberturaPct: null,
      sinIdCrm: list.length,
      sinCaptura: 0,
      diasNegativos: 0,
      rangos: { '0-30': 0, '31-90': 0, '91-180': 0, '>180': 0 },
      pctRangos: { '0-30': null, '31-90': null, '91-180': null, '>180': null },
      pctSobreTotal: {
        '0-30': null, '31-90': null, '91-180': null, '>180': null, sinClasificar: null,
      },
    },
    fuente: 'Seguimiento 360 (CRM) + ADE_VTAFI',
    nota: null,
    error: null,
  };

  if (!list.length) {
    return { ...empty, disponible: true, sinClasificar: 0, nota: 'Sin entregas en el periodo.' };
  }

  let d;
  try {
    if (!isAvailable()) {
      return { ...empty, nota: 'Base CRM (Seguimiento 360) no disponible.' };
    }
    d = getDb();
  } catch (err) {
    return { ...empty, error: err.message || String(err), nota: 'No se pudo abrir el CRM 360.' };
  }

  const purchasesByContact = buildPurchaseHistoryByContact(d);
  const captureIndex = buildCaptureDateByContactVin(d);

  const clientIds = list.map((e) => e.ID_CLIENTE ?? e.SOF_IDCliente ?? e.idCliente).filter((x) => x != null);
  const [dmsHist, phonesByClient] = await Promise.all([
    loadDmsPurchaseHistoryByClient(clientIds),
    loadPhonesByClient(clientIds),
  ]);
  const dmsByClient = dmsHist.byClient || new Map();

  let primeraCompra = 0;
  let recurrente = 0;
  let sinClasificar = 0;
  let matchCrm = 0;
  let matchDmsOnly = 0;
  let matchByPhone = 0;
  let matchByFactura = 0;
  const rangos = { '0-30': 0, '31-90': 0, '91-180': 0, '>180': 0 };
  let clasificables61 = 0;
  let noClasificables61 = 0;
  let sinIdCrm61 = 0;
  let sinCaptura61 = 0;
  let diasNegativos61 = 0;

  for (const e of list) {
    const vin = normalizeVin(e.SOF_VIN || e.vin || e.SERIE || e.VTE_SERIE);
    const fechaEntrega = toIsoDate(
      e.SOF_FechAct || e.FECHA_PERIODO || e.fechaEntrega || e.fecha || e.FECHA_FACTURA,
    );
    const idClienteDms = e.ID_CLIENTE ?? e.SOF_IDCliente ?? e.idCliente ?? null;
    const factura = String(e.SOF_Factura || e.factura || e.VTE_DOCTO || '').trim();

    let idCrm = vin ? resolveIdCrmBySerie(vin) : null;
    if (!idCrm && e.CLIENTE) idCrm = resolveIdCrmByNombre(e.CLIENTE);
    if (!idCrm && factura) {
      const byFac = resolveIdCrmByFactura(factura);
      if (byFac) {
        idCrm = byFac;
        matchByFactura += 1;
      }
    }
    if (!idCrm && idClienteDms != null && phonesByClient.has(String(idClienteDms))) {
      const phones = phonesByClient.get(String(idClienteDms));
      const byTel = resolveIdCrmByTelefono(phones?.celular)
        || resolveIdCrmByTelefono(phones?.telefono);
      if (byTel) {
        idCrm = byTel;
        matchByPhone += 1;
      }
    }

    let prior = 0;
    let resolved = false;

    if (idCrm) {
      matchCrm += 1;
      prior = countPriorPurchases(purchasesByContact.get(String(idCrm)), vin, fechaEntrega);
      resolved = true;
    }

    // Complemento / respaldo: histórico transaccional DMS (facturas), nunca taller.
    if (idClienteDms != null && dmsByClient.has(String(idClienteDms))) {
      const dmsPrior = countPriorPurchases(dmsByClient.get(String(idClienteDms)), vin, fechaEntrega);
      if (dmsPrior > prior) prior = dmsPrior;
      if (!resolved) {
        matchDmsOnly += 1;
        resolved = true;
      }
    }

    if (!resolved) {
      sinClasificar += 1;
      noClasificables61 += 1;
      sinIdCrm61 += 1;
      continue;
    }

    if (prior > 0) recurrente += 1;
    else primeraCompra += 1;

    // C-6.1 solo con fecha de captura del ciclo/VIN en 360 (no se inventa desde factura DMS).
    let captura = null;
    if (idCrm && fechaEntrega) {
      captura = findCaptureDate(captureIndex, idCrm, vin, fechaEntrega);
    }
    if (!idCrm) {
      noClasificables61 += 1;
      sinIdCrm61 += 1;
      continue;
    }
    if (!captura || !fechaEntrega) {
      noClasificables61 += 1;
      sinCaptura61 += 1;
      continue;
    }
    const dias = daysBetweenIso(captura, fechaEntrega);
    if (dias == null) {
      noClasificables61 += 1;
      sinCaptura61 += 1;
      continue;
    }
    if (dias < 0) {
      noClasificables61 += 1;
      diasNegativos61 += 1;
      continue;
    }
    const rango = rangoAntiguedad(dias);
    if (rango) {
      clasificables61 += 1;
      rangos[rango] += 1;
    } else {
      noClasificables61 += 1;
      sinCaptura61 += 1;
    }
  }

  const clasificados = primeraCompra + recurrente;
  const total = list.length;
  const pctPrimera = clasificados ? roundPct(primeraCompra, clasificados) : null;
  const pctRecurrente = clasificados ? roundPct(recurrente, clasificados) : null;
  // Si cobertura completa, PC+RC sobre C-1; si no, sobre clasificados y se reporta hueco.
  const denomC6 = sinClasificar === 0 ? total : clasificados;
  const c6pc = denomC6 ? roundPct(primeraCompra, denomC6) : null;
  const c6rc = denomC6 ? roundPct(recurrente, denomC6) : null;

  const pctRangos = {
    '0-30': clasificables61 ? roundPct(rangos['0-30'], clasificables61) : null,
    '31-90': clasificables61 ? roundPct(rangos['31-90'], clasificables61) : null,
    '91-180': clasificables61 ? roundPct(rangos['91-180'], clasificables61) : null,
    '>180': clasificables61 ? roundPct(rangos['>180'], clasificables61) : null,
  };

  const huecos61 = [];
  if (sinIdCrm61) huecos61.push(`${sinIdCrm61} sin vínculo CRM`);
  if (sinCaptura61) huecos61.push(`${sinCaptura61} sin fecha de captura`);
  if (diasNegativos61) huecos61.push(`${diasNegativos61} con días < 0`);

  return {
    disponible: clasificados > 0,
    total,
    primeraCompra,
    recurrente,
    sinClasificar,
    pctPrimeraCompra: c6pc,
    pctRecurrente: c6rc,
    coberturaPct: total ? roundPct(clasificados, total) : null,
    matchCrm,
    matchDmsOnly,
    matchByPhone,
    matchByFactura,
    antiguedad: {
      clasificables: clasificables61,
      noClasificables: noClasificables61,
      coberturaPct: total ? roundPct(clasificables61, total) : null,
      sinIdCrm: sinIdCrm61,
      sinCaptura: sinCaptura61,
      diasNegativos: diasNegativos61,
      rangos,
      pctRangos,
      pctSobreTotal: {
        '0-30': total ? roundPct(rangos['0-30'], total) : null,
        '31-90': total ? roundPct(rangos['31-90'], total) : null,
        '91-180': total ? roundPct(rangos['91-180'], total) : null,
        '>180': total ? roundPct(rangos['>180'], total) : null,
        sinClasificar: total ? roundPct(noClasificables61, total) : null,
      },
    },
    fuente: 'Seguimiento 360 (VIN/nombre/teléfono/factura) + ADE_VTAFI; no usa PREVIAS de taller',
    nota: [
      sinClasificar
        ? `${sinClasificar} entrega(s) sin match 360/DMS; C-6 se calcula sobre clasificadas (${clasificados}).`
        : 'Universo conciliado con C-1 (Primera + Recurrente = Entregas).',
      `C-6.1: ${clasificables61} de ${total} entregas SOFIA (C-1) con captura CRM`
        + (huecos61.length ? ` · ${huecos61.join(' · ')}` : '')
        + '. No usa facturas DMS como universo.',
    ].filter(Boolean).join(' '),
    error: dmsHist.error || null,
    pctPrimeraSobreClasificadas: pctPrimera,
    pctRecurrenteSobreClasificadas: pctRecurrente,
  };
}

function roundPct(num, den) {
  const n = Number(num);
  const d = Number(den);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return Math.round((n / d) * 1000) / 10;
}

const ESTATUS_CARTERA_ACTIVA = ['Prospección', 'Ofrecimiento', 'Neg. Caliente', 'Pre-pedido', 'Cartera'];

function packedTail(value) {
  const text = String(value || '');
  const cut = text.indexOf('|');
  const tail = cut >= 0 ? text.slice(cut + 1) : text;
  return tail.trim() || null;
}

/** Un ciclo = estatus del último movimiento y ejecutivo de la última actividad que sí lo trae. */
function sqlCicloVigente() {
  return `
    SELECT
      id_ciclo,
      MAX(CASE WHEN id_contacto IS NOT NULL AND trim(id_contacto) <> ''
        THEN printf('%s|%s', COALESCE(fecha_estatus, ''), id_contacto) END) AS contacto_key,
      MAX(CASE WHEN nombre_contacto IS NOT NULL AND trim(nombre_contacto) <> ''
        THEN printf('%s|%s', COALESCE(fecha_estatus, ''), nombre_contacto) END) AS nombre_key,
      MAX(CASE WHEN estatus IS NOT NULL AND trim(estatus) <> ''
        THEN printf('%s|%s', COALESCE(fecha_estatus, ''), estatus) END) AS estatus_key,
      MAX(CASE WHEN vendedor IS NOT NULL AND trim(vendedor) <> ''
        THEN printf('%s|%s', COALESCE(fecha_estatus, ''), vendedor) END) AS vendedor_key,
      MAX(CASE WHEN vin IS NOT NULL AND trim(vin) <> ''
        THEN printf('%s|%s', COALESCE(fecha_estatus, ''), vin) END) AS vin_key,
      MAX(fecha_estatus) AS fecha_estatus,
      MAX(fecha_prog_actividad) AS fecha_prog_actividad,
      MAX(fecha_resp_actividad) AS fecha_resp_actividad
    FROM crm_actividades
    WHERE id_ciclo IS NOT NULL AND trim(id_ciclo) <> ''
    GROUP BY id_ciclo
  `;
}

function hasCiclosLiveTable(d) {
  return !!d.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'crm_ciclos_live'`).get();
}

function hasActividadesTable(d) {
  return !!d.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'crm_actividades'`).get();
}

function citaAsistidaSql(alias = '') {
  const col = `${alias}resultado_actividad`;
  const txt = `LOWER(COALESCE(${col}, ''))`;
  return `(
    ${txt} <> ''
    AND ${txt} NOT LIKE '%no show%'
    AND ${txt} NOT LIKE '%noshow%'
    AND ${txt} NOT LIKE '%cancel%'
    AND ${txt} NOT LIKE '%no asist%'
    AND ${txt} NOT LIKE '%no se present%'
    AND ${txt} NOT LIKE '%reprogram%'
  )`;
}

function citaConResultadoSql(alias = '') {
  return `LOWER(COALESCE(${alias}resultado_actividad, '')) <> ''`;
}

/**
 * P-PRO-1 a P-PRO-6 para la pestaña Leads.
 * P-PRO-6 sale del corte de cartera (HT-PRO-2). Los SLA que piden hora se dejan sin valor.
 */
function getProspeccionIndicadores({ fechaInicio = null, fechaFin = null } = {}) {
  const d = getDb();
  if (!hasLeadsTable(d)) {
    throw Object.assign(new Error('Tabla de leads no cargada.'), { status: 503 });
  }
  const desde = fechaInicio ? String(fechaInicio).slice(0, 10) : null;
  const hasta = fechaFin ? String(fechaFin).slice(0, 10) : null;
  const notDup = getLeadNotDuplicateSql();
  const where = [notDup];
  const params = [];
  if (desde) {
    where.push('substr(fecha_entrada, 1, 10) >= ?');
    params.push(desde);
  }
  if (hasta) {
    where.push('substr(fecha_entrada, 1, 10) <= ?');
    params.push(hasta);
  }
  const hoja = d.prepare(`
    SELECT
      COUNT(*) AS entrantes,
      SUM(CASE WHEN resultado IS NOT NULL AND trim(resultado) <> '' THEN 1 ELSE 0 END) AS conPrimeraAtencion,
      SUM(CASE WHEN upper(trim(COALESCE(asignacion, ''))) = 'SI'
        OR (ejecutivo_asignado IS NOT NULL AND trim(ejecutivo_asignado) <> '') THEN 1 ELSE 0 END) AS asignados,
      SUM(CASE WHEN upper(trim(COALESCE(contacto, ''))) = 'SI' THEN 1 ELSE 0 END) AS contactadosBdc,
      SUM(CASE WHEN upper(trim(COALESCE(cita_programada, ''))) IN ('SI', 'VIRTUAL')
        OR (fecha_cita IS NOT NULL AND trim(fecha_cita) <> '') THEN 1 ELSE 0 END) AS conCita,
      SUM(CASE WHEN upper(trim(COALESCE(contacto, ''))) = 'SI'
        AND (upper(trim(COALESCE(cita_programada, ''))) IN ('SI', 'VIRTUAL')
          OR (fecha_cita IS NOT NULL AND trim(fecha_cita) <> '')) THEN 1 ELSE 0 END) AS contactadosConCita,
      SUM(CASE WHEN upper(trim(COALESCE(cita_asistida, ''))) = 'SI' THEN 1 ELSE 0 END) AS asistidasHoja,
      SUM(CASE WHEN cita_programada IS NULL OR trim(cita_programada) = '' THEN 1 ELSE 0 END) AS citaVacia
    FROM crm_leads
    WHERE ${where.join(' AND ')}
  `).get(...params);

  const entrantes = Number(hoja?.entrantes || 0);
  const conPrimera = Number(hoja?.conPrimeraAtencion || 0);
  const contactados = Number(hoja?.contactadosBdc || 0);
  const contactadosConCita = Number(hoja?.contactadosConCita || 0);

  let citas = { programadas: 0, conResultado: 0, asistidas: 0, disponible: false };
  let cartera = {
    activa: 0,
    vigentes: 0,
    diferida: 0,
    diferidaConEspera: 0,
    ultimoEstatus: null,
    porEjecutivo: [],
    disponible: false,
  };

  if (hasActividadesTable(d)) {
    const citaWhere = [`UPPER(TRIM(COALESCE(tipo_actividad, ''))) = 'CITA'`];
    const citaParams = [];
    if (desde) {
      citaWhere.push('substr(fecha_prog_actividad, 1, 10) >= ?');
      citaParams.push(desde);
    }
    if (hasta) {
      citaWhere.push('substr(fecha_prog_actividad, 1, 10) <= ?');
      citaParams.push(hasta);
    }
    const citaRow = d.prepare(`
      SELECT
        COUNT(DISTINCT id_ciclo) AS programadas,
        COUNT(DISTINCT CASE WHEN ${citaConResultadoSql()} THEN id_ciclo END) AS conResultado,
        COUNT(DISTINCT CASE WHEN ${citaAsistidaSql()} THEN id_ciclo END) AS asistidas
      FROM crm_actividades
      WHERE ${citaWhere.join(' AND ')}
    `).get(...citaParams);
    citas = {
      programadas: Number(citaRow?.programadas || 0),
      conResultado: Number(citaRow?.conResultado || 0),
      asistidas: Number(citaRow?.asistidas || 0),
      disponible: true,
    };

    const corte = hasta || new Date().toISOString().slice(0, 10);
    const activosSql = ESTATUS_CARTERA_ACTIVA.map(() => '?').join(',');
    const cicloSql = sqlCicloVigente();
    const carteraRow = d.prepare(`
      WITH ciclo AS (${cicloSql})
      SELECT
        SUM(CASE WHEN substr(estatus_key, instr(estatus_key, '|') + 1) IN (${activosSql}) THEN 1 ELSE 0 END) AS activa,
        SUM(CASE WHEN substr(estatus_key, instr(estatus_key, '|') + 1) IN (${activosSql})
          AND substr(COALESCE(fecha_prog_actividad, ''), 1, 10) >= ? THEN 1 ELSE 0 END) AS vigentes,
        SUM(CASE WHEN substr(estatus_key, instr(estatus_key, '|') + 1) = 'Neg. Diferida' THEN 1 ELSE 0 END) AS diferida,
        SUM(CASE WHEN substr(estatus_key, instr(estatus_key, '|') + 1) = 'Neg. Diferida'
          AND substr(COALESCE(fecha_prog_actividad, ''), 1, 10) >= ? THEN 1 ELSE 0 END) AS diferidaConEspera,
        MAX(CASE WHEN substr(estatus_key, instr(estatus_key, '|') + 1) IN (${activosSql}) THEN fecha_estatus END) AS ultimoEstatus
      FROM ciclo
    `).get(...ESTATUS_CARTERA_ACTIVA, ...ESTATUS_CARTERA_ACTIVA, corte, corte, ...ESTATUS_CARTERA_ACTIVA);

    const porEjecutivo = d.prepare(`
      WITH ciclo AS (${cicloSql}),
      lead_ej AS (
        SELECT trim(id_crm) AS id_crm,
          MAX(CASE WHEN ejecutivo_asignado IS NOT NULL AND trim(ejecutivo_asignado) <> '' THEN ejecutivo_asignado END) AS ejecutivo
        FROM crm_leads
        WHERE es_duplicado = 0 AND id_crm IS NOT NULL AND trim(id_crm) <> ''
        GROUP BY trim(id_crm)
      )
      SELECT
        COALESCE(
          NULLIF(trim(substr(ciclo.vendedor_key, instr(ciclo.vendedor_key, '|') + 1)), ''),
          NULLIF(trim(lead_ej.ejecutivo), ''),
          'Sin ejecutivo'
        ) AS ejecutivo,
        SUM(CASE WHEN substr(ciclo.estatus_key, instr(ciclo.estatus_key, '|') + 1) IN (${activosSql}) THEN 1 ELSE 0 END) AS cartera,
        SUM(CASE WHEN substr(ciclo.estatus_key, instr(ciclo.estatus_key, '|') + 1) IN (${activosSql})
          AND substr(COALESCE(ciclo.fecha_prog_actividad, ''), 1, 10) >= ? THEN 1 ELSE 0 END) AS vigentes
      FROM ciclo
      LEFT JOIN lead_ej
        ON lead_ej.id_crm = substr(ciclo.contacto_key, instr(ciclo.contacto_key, '|') + 1)
      GROUP BY ejecutivo
      HAVING cartera > 0
      ORDER BY (cartera - vigentes) DESC, cartera DESC
      LIMIT 15
    `).all(...ESTATUS_CARTERA_ACTIVA, ...ESTATUS_CARTERA_ACTIVA, corte);

    cartera = {
      activa: Number(carteraRow?.activa || 0),
      vigentes: Number(carteraRow?.vigentes || 0),
      diferida: Number(carteraRow?.diferida || 0),
      diferidaConEspera: Number(carteraRow?.diferidaConEspera || 0),
      ultimoEstatus: carteraRow?.ultimoEstatus || null,
      corte,
      porEjecutivo: porEjecutivo.map((row) => ({
        ejecutivo: row.ejecutivo,
        cartera: Number(row.cartera || 0),
        vigentes: Number(row.vigentes || 0),
        coberturaPct: roundPct(row.vigentes, row.cartera),
      })),
      disponible: true,
    };
  }

  const coberturaPct = roundPct(conPrimera, entrantes);
  const ppro4Pct = roundPct(contactadosConCita, contactados);
  const ppro5Pct = citas.disponible ? roundPct(citas.asistidas, citas.conResultado) : null;
  const ppro6Pct = cartera.disponible ? roundPct(cartera.vigentes, cartera.activa) : null;

  return {
    periodo: { fechaInicio: desde, fechaFin: hasta },
    indicadores: [
      {
        id: 'P-PRO-1A',
        nombre: 'Cumplimiento del SLA de Primera Atención',
        componente: 'Cobertura de Primera Atención',
        valor: coberturaPct,
        unidad: '%',
        numerador: conPrimera,
        denominador: entrantes,
        meta: 100,
        disponible: true,
        detalle: 'Leads del periodo con resultado de la hoja STREGA, sobre entrantes sin duplicado.',
      },
      {
        id: 'P-PRO-1B',
        nombre: 'Cumplimiento del SLA de Primera Atención',
        componente: 'Cumplimiento del SLA ≤10 minutos',
        valor: null,
        unidad: '%',
        numerador: null,
        denominador: entrantes,
        meta: 100,
        disponible: false,
        detalle: 'La hoja no trae hora de entrada ni hora del primer intento. No se promedia con la cobertura.',
      },
      {
        id: 'P-PRO-2',
        nombre: 'Contacto Efectivo del Ejecutivo',
        valor: null,
        unidad: '%',
        numerador: null,
        denominador: Number(hoja?.asignados || 0),
        meta: null,
        disponible: false,
        detalle: 'La asignación trae fecha, sin hora, y la columna Contacto es la llamada del centro de contacto. Falta el contacto de doble vía del ejecutivo.',
      },
      {
        id: 'P-PRO-3',
        nombre: 'CSI de Atención al Prospecto',
        valor: null,
        unidad: '%',
        numerador: null,
        denominador: null,
        meta: 90,
        disponible: false,
        detalle: 'El archivo CSI Ventas es NPS de entrega, no la calificación 10 de la llamada al prospecto.',
      },
      {
        id: 'P-PRO-4',
        nombre: 'Conversión Contacto → Cita Programada',
        valor: ppro4Pct,
        unidad: '%',
        numerador: contactadosConCita,
        denominador: contactados,
        meta: 25,
        disponible: contactados > 0,
        detalle: `${Number(hoja?.citaVacia || 0)} leads del periodo traen la columna de cita vacía. La tasa usa contacto SI y cita SI, virtual o con fecha.`,
      },
      {
        id: 'P-PRO-5',
        nombre: 'Conversión Cita Programada → Cita Asistida',
        valor: ppro5Pct,
        unidad: '%',
        numerador: citas.asistidas,
        denominador: citas.conResultado,
        meta: 60,
        disponible: citas.disponible && citas.conResultado > 0,
        detalle: citas.disponible
          ? `${citas.programadas} primeras citas con fecha en el periodo · ${citas.conResultado} con resultado · ${citas.asistidas} asistidas.`
          : 'No hay actividades de cita en el CRM local.',
      },
      {
        id: 'P-PRO-6',
        nombre: 'Cobertura de Gestión de la Cartera Comercial Activa',
        valor: ppro6Pct,
        unidad: '%',
        numerador: cartera.vigentes,
        denominador: cartera.activa,
        meta: 100,
        disponible: cartera.disponible,
        detalle: cartera.disponible
          ? `Corte ${cartera.corte}. ${cartera.vigentes} de ${cartera.activa} ciclos activos tienen acción siguiente. Negociación diferida aparte: ${cartera.diferidaConEspera} de ${cartera.diferida} con fecha de espera. Último movimiento de estatus en la cartera: ${cartera.ultimoEstatus || 'sin fecha'}.`
          : 'No hay ciclos CRM para armar la cartera.',
      },
    ],
    cartera,
    citas,
    hoja: {
      entrantes,
      conPrimeraAtencion: conPrimera,
      asignados: Number(hoja?.asignados || 0),
      contactadosBdc: contactados,
      asistidasHoja: Number(hoja?.asistidasHoja || 0),
      citaVacia: Number(hoja?.citaVacia || 0),
    },
  };
}

/** HT-PRO-1: expediente de un prospecto, una fila lógica por ciclo. */
function getExpedienteProspecto(idContacto) {
  const d = getDb();
  const id = String(idContacto || '').trim();
  if (!id) {
    throw Object.assign(new Error('idContacto requerido.'), { status: 400 });
  }
  const lead = hasLeadsTable(d)
    ? d.prepare(`
        SELECT id_crm, nombre, fecha_entrada, resultado, contacto, asignacion,
          ejecutivo_asignado, fecha_asignacion, cita_programada, fecha_cita, cita_asistida, vin_comprado,
          canal, campana, auto_interes
        FROM crm_leads
        WHERE trim(id_crm) = ? AND es_duplicado = 0
        ORDER BY fecha_entrada DESC
        LIMIT 1
      `).get(id)
    : null;
  // Primer lead registrado con este ID: canal y campaña por los que entró originalmente.
  const origen = hasLeadsTable(d)
    ? d.prepare(`
        SELECT canal, campana, fecha_entrada, tipo, auto_interes
        FROM crm_leads
        WHERE trim(id_crm) = ?
        ORDER BY (fecha_entrada IS NULL), fecha_entrada ASC, id ASC
        LIMIT 1
      `).get(id)
    : null;

  let ciclos = [];
  if (hasActividadesTable(d)) {
    const corte = new Date().toISOString().slice(0, 10);
    ciclos = d.prepare(`
      SELECT
        id_ciclo,
        MAX(CASE WHEN nombre_contacto IS NOT NULL AND trim(nombre_contacto) <> ''
          THEN printf('%s|%s', COALESCE(fecha_estatus, ''), nombre_contacto) END) AS nombre_key,
        MAX(CASE WHEN estatus IS NOT NULL AND trim(estatus) <> ''
          THEN printf('%s|%s', COALESCE(fecha_estatus, ''), estatus) END) AS estatus_key,
        MAX(CASE WHEN vendedor IS NOT NULL AND trim(vendedor) <> ''
          THEN printf('%s|%s', COALESCE(fecha_estatus, ''), vendedor) END) AS vendedor_key,
        MAX(CASE WHEN vin IS NOT NULL AND trim(vin) <> ''
          THEN printf('%s|%s', COALESCE(fecha_estatus, ''), vin) END) AS vin_key,
        MAX(fecha_estatus) AS fecha_estatus,
        MAX(fecha_prog_actividad) AS fecha_prog_actividad,
        MAX(fecha_resp_actividad) AS fecha_resp_actividad
      FROM crm_actividades
      WHERE trim(id_contacto) = ?
        AND id_ciclo IS NOT NULL AND trim(id_ciclo) <> ''
      GROUP BY id_ciclo
      ORDER BY fecha_estatus DESC
      LIMIT 8
    `).all(id).map((row) => {
      const estatus = packedTail(row.estatus_key);
      const prog = row.fecha_prog_actividad;
      const vigente = ESTATUS_CARTERA_ACTIVA.includes(estatus)
        && String(prog || '').slice(0, 10) >= corte;
      return {
        id_ciclo: row.id_ciclo,
        nombre_contacto: packedTail(row.nombre_key),
        estatus,
        vendedor: packedTail(row.vendedor_key),
        vin: packedTail(row.vin_key),
        fecha_estatus: row.fecha_estatus,
        fecha_prog_actividad: prog,
        fecha_resp_actividad: row.fecha_resp_actividad,
        gestion_vigente: vigente ? 1 : 0,
      };
    });
  }

  const activos = ciclos.filter((row) => ESTATUS_CARTERA_ACTIVA.includes(row.estatus));
  return {
    idContacto: id,
    herramienta: 'Expediente Integral del Prospecto (EIP)',
    prospecto: lead ? {
      nombre: lead.nombre,
      fechaEntrada: lead.fecha_entrada,
      resultado: lead.resultado,
      contactoBdc: lead.contacto,
      asignacion: lead.asignacion,
      ejecutivo: lead.ejecutivo_asignado,
      fechaAsignacion: lead.fecha_asignacion,
      citaProgramada: lead.cita_programada,
      fechaCita: lead.fecha_cita,
      citaAsistida: lead.cita_asistida,
      vin: lead.vin_comprado,
      canal: lead.canal,
      campana: lead.campana,
      autoInteres: lead.auto_interes,
      origen: origen ? {
        canal: origen.canal,
        campana: origen.campana,
        fechaEntrada: origen.fecha_entrada,
        tipo: origen.tipo,
        autoInteres: origen.auto_interes,
      } : null,
    } : null,
    ciclos: ciclos.map((row) => ({
      idCiclo: row.id_ciclo,
      nombre: row.nombre_contacto,
      estatus: row.estatus,
      vendedor: row.vendedor,
      vin: row.vin,
      fechaEstatus: row.fecha_estatus,
      accionSiguiente: row.fecha_prog_actividad,
      ultimaRespuesta: row.fecha_resp_actividad,
      gestionVigente: Number(row.gestion_vigente) === 1,
      enCarteraActiva: ESTATUS_CARTERA_ACTIVA.includes(row.estatus),
    })),
    ppro6: {
      cartera: activos.length,
      vigentes: activos.filter((row) => Number(row.gestion_vigente) === 1).length,
    },
    faltantes: [
      'Cumplimiento del SLA de Primera Atención: falta la hora de entrada y del primer intento.',
      'Contacto Efectivo del Ejecutivo: falta la hora del contacto de doble vía.',
      'CSI de Atención al Prospecto: falta la calificación 10 de la llamada al prospecto.',
    ],
  };
}

/** HT-PRO-2: la cartera de un ejecutivo, con la lista del 1 a 1. */
function getCarteraEjecutivo({ vendedor, fechaFin = null } = {}) {
  const d = getDb();
  const nombre = String(vendedor || '').trim();
  if (!nombre) {
    throw Object.assign(new Error('vendedor requerido.'), { status: 400 });
  }
  if (!hasActividadesTable(d)) {
    throw Object.assign(new Error('No hay ciclos CRM para armar la cartera.'), { status: 503 });
  }
  const corte = fechaFin ? String(fechaFin).slice(0, 10) : new Date().toISOString().slice(0, 10);
  const sinEjecutivo = nombre.toLowerCase() === 'sin ejecutivo';
  const activosSql = ESTATUS_CARTERA_ACTIVA.map(() => '?').join(',');
  const ejecutivoExpr = `COALESCE(
    NULLIF(trim(substr(ciclo.vendedor_key, instr(ciclo.vendedor_key, '|') + 1)), ''),
    NULLIF(trim(lead_ej.ejecutivo), ''),
    'Sin ejecutivo'
  )`;
  const rows = d.prepare(`
    WITH ciclo AS (${sqlCicloVigente()}),
    lead_ej AS (
      SELECT trim(id_crm) AS id_crm,
        MAX(CASE WHEN ejecutivo_asignado IS NOT NULL AND trim(ejecutivo_asignado) <> '' THEN ejecutivo_asignado END) AS ejecutivo
      FROM crm_leads
      WHERE es_duplicado = 0 AND id_crm IS NOT NULL AND trim(id_crm) <> ''
      GROUP BY trim(id_crm)
    )
    SELECT ciclo.id_ciclo, ciclo.contacto_key, ciclo.nombre_key, ciclo.estatus_key, ciclo.vin_key,
      ciclo.fecha_estatus, ciclo.fecha_prog_actividad,
      CASE WHEN substr(COALESCE(ciclo.fecha_prog_actividad, ''), 1, 10) >= ? THEN 1 ELSE 0 END AS gestion_vigente
    FROM ciclo
    LEFT JOIN lead_ej
      ON lead_ej.id_crm = substr(ciclo.contacto_key, instr(ciclo.contacto_key, '|') + 1)
    WHERE ${sinEjecutivo ? `${ejecutivoExpr} = 'Sin ejecutivo'` : `LOWER(${ejecutivoExpr}) = LOWER(?)`}
      AND substr(ciclo.estatus_key, instr(ciclo.estatus_key, '|') + 1) IN (${activosSql})
    ORDER BY gestion_vigente ASC, ciclo.fecha_estatus DESC
  `).all(...(sinEjecutivo ? [corte] : [corte, nombre]), ...ESTATUS_CARTERA_ACTIVA);

  const vigentes = rows.filter((row) => Number(row.gestion_vigente) === 1).length;
  return {
    herramienta: 'Expediente Integral del Ejecutivo de Ventas (EIEV)',
    vendedor: nombre,
    corte,
    cartera: rows.length,
    vigentes,
    sinGestion: rows.length - vigentes,
    coberturaPct: roundPct(vigentes, rows.length),
    meta: 100,
    lista: rows.slice(0, 40).map((row) => ({
      idCiclo: row.id_ciclo,
      idContacto: packedTail(row.contacto_key),
      nombre: packedTail(row.nombre_key),
      estatus: packedTail(row.estatus_key),
      vin: packedTail(row.vin_key),
      fechaEstatus: row.fecha_estatus,
      accionSiguiente: row.fecha_prog_actividad,
      gestionVigente: Number(row.gestion_vigente) === 1,
    })),
  };
}

/* ───────────────── P-VTA-4 · Tiempo de Maduración Comercial ───────────────── */

/** Parámetros por confirmar con Gerencia (docs P-VTA-4). */
const PVTA4 = {
  agrupaCompraDias: 7,      // compras casi simultáneas = una sola venta
  carteraMeses: 48,         // compra previa dentro de este plazo = cliente de cartera
  perdidoDias: 180,         // prospecto sin actividad = perdido
  maxMaduracionDias: 730,   // > 24 meses se excluye
  // Un ciclo cerrado en negativo que no tuvo seguimiento dentro de estos días
  // no cuenta como llegada: no inició el proceso que produjo la venta.
  cicloMuertoDias: 30,
  mesesSerie: 12,           // serie mensual mostrada
  mesesCurva: 24,           // histórico para la curva de maduración
};
const PVTA4_TTL_MS = 10 * 60 * 1000;
// Estatus que cierran un ciclo sin compra. Si el ciclo no tuvo actividad
// después de abrirse, no cuenta como llegada del cliente.
// Estatus que no representan una gestión en curso. Un ciclo en estos estatus
// solo cuenta como llegada si tuvo seguimiento real después de abrirse.
const ESTATUS_CICLO_CERRADO = new Set([
  'Descartado', 'Lead Caducado', 'Venta Perdida', 'Neg. Diferida', 'Prospección',
]);

const PVTA4_EDADES = [
  { key: '0-7', label: '0–7 d', min: 0, max: 7 },
  { key: '8-15', label: '8–15 d', min: 8, max: 15 },
  { key: '16-30', label: '16–30 d', min: 16, max: 30 },
  { key: '31-60', label: '31–60 d', min: 31, max: 60 },
  { key: '61-90', label: '61–90 d', min: 61, max: 90 },
  { key: '91-180', label: '91–180 d', min: 91, max: 180 },
  { key: '180+', label: '> 180 d', min: 181, max: Infinity },
];

function isoDay(value) {
  const iso = toIsoDate(value);
  return iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

function diasEntre(desdeIso, hastaIso) {
  if (!desdeIso || !hastaIso) return null;
  const a = Date.UTC(+desdeIso.slice(0, 4), +desdeIso.slice(5, 7) - 1, +desdeIso.slice(8, 10));
  const b = Date.UTC(+hastaIso.slice(0, 4), +hastaIso.slice(5, 7) - 1, +hastaIso.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

function sumarMesesIso(iso, meses) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + meses);
  return d.toISOString().slice(0, 10);
}

function sumarDiasIso(iso, dias) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function estadisticasDias(valores) {
  const list = valores.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!list.length) return { n: 0, promedio: null, mediana: null, p25: null, p75: null, min: null, max: null };
  const q = (p) => list[Math.min(list.length - 1, Math.floor(p * (list.length - 1) + 0.5))];
  return {
    n: list.length,
    promedio: Math.round((list.reduce((s, v) => s + v, 0) / list.length) * 10) / 10,
    mediana: q(0.5),
    p25: q(0.25),
    p75: q(0.75),
    min: list[0],
    max: list[list.length - 1],
  };
}

/**
 * Base longitudinal del P-VTA-4: cada venta lograda con su fecha de llegada,
 * días de maduración y origen (cartera / lead / sin clasificar), más los
 * prospectos activos con su edad y los prospectos perdidos para la curva.
 * Se calcula una vez por día y se reutiliza para cualquier periodo.
 */
function computeMaduracionBase(hoyIso) {
  const d = getDb();
  if (!hasActividadesTable(d)) {
    throw Object.assign(new Error('No hay ciclos CRM para medir la maduración.'), { status: 503 });
  }
  const fechaValida = (col) => `${col} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'`;

  // 1) Ciclos: histórico del Excel fijo (crm_actividades) + ciclos en vivo de
  // Railway (crm_ciclos_live). Cuando un ciclo existe en ambos, gana el vivo.
  const cicloSelect = (tabla) => `
    SELECT
      trim(id_contacto) AS id_contacto,
      trim(id_ciclo) AS id_ciclo,
      MIN(CASE WHEN ${fechaValida('fecha_inicio_ciclo')} THEN substr(fecha_inicio_ciclo, 1, 10) END) AS fic,
      MIN(CASE WHEN ${fechaValida('fecha_crea_actividad')} THEN substr(fecha_crea_actividad, 1, 10) END) AS crea,
      MAX(substr(COALESCE(fecha_resp_actividad, fecha_prog_actividad, fecha_crea_actividad, fecha_estatus, fecha_inicio_ciclo), 1, 10)) AS ult,
      MAX(substr(COALESCE(fecha_resp_actividad, fecha_crea_actividad, fecha_estatus), 1, 10)) AS ult_real,
      MAX(CASE WHEN estatus IS NOT NULL AND trim(estatus) <> ''
        THEN printf('%s|%s', COALESCE(fecha_estatus, ''), estatus) END) AS estatus_key,
      MAX(CASE WHEN nombre_contacto IS NOT NULL AND trim(nombre_contacto) <> '' THEN nombre_contacto END) AS nombre,
      MAX(CASE WHEN vendedor IS NOT NULL AND trim(vendedor) <> '' THEN vendedor END) AS vendedor,
      MIN(CASE WHEN ${fechaValida('fecha_factura')} THEN substr(fecha_factura, 1, 10) END) AS ff,
      MAX(CASE WHEN producto_vendido IS NOT NULL AND trim(producto_vendido) <> '' THEN producto_vendido END) AS producto,
      COUNT(DISTINCT CASE WHEN trim(COALESCE(vin, '')) <> '' AND ${fechaValida('fecha_factura')} THEN upper(trim(vin)) END) AS unidades
    FROM ${tabla}
    WHERE id_contacto IS NOT NULL AND trim(id_contacto) <> ''
      AND id_ciclo IS NOT NULL AND trim(id_ciclo) <> ''
    GROUP BY trim(id_contacto), trim(id_ciclo)`;
  const live = hasCiclosLiveTable(d);
  const ciclosRows = d.prepare(live
    ? `${cicloSelect('crm_actividades')}
       AND trim(id_ciclo) NOT IN (SELECT trim(id_ciclo) FROM crm_ciclos_live WHERE trim(COALESCE(id_ciclo, '')) <> '')
       UNION ALL
       ${cicloSelect('crm_ciclos_live')}`
    : cicloSelect('crm_actividades')).all();

  const contactos = new Map();
  const getC = (id) => {
    let c = contactos.get(id);
    if (!c) {
      c = { id, nombre: null, ciclos: [], leads: [], huellas: [], ventas: [] };
      contactos.set(id, c);
    }
    return c;
  };
  for (const r of ciclosRows) {
    const c = getC(r.id_contacto);
    if (!c.nombre && r.nombre) c.nombre = r.nombre;
    const ciclo = {
      idCiclo: r.id_ciclo,
      fic: isoDay(r.fic),
      crea: isoDay(r.crea),
      ult: isoDay(r.ult),
      ultReal: isoDay(r.ult_real),
      estatus: packedTail(r.estatus_key),
      vendedor: r.vendedor || null,
      ff: isoDay(r.ff),
      producto: r.producto || null,
      unidades: Number(r.unidades || 0),
    };
    c.ciclos.push(ciclo);
    // Ciclo cerrado en negativo sin seguimiento: no inició el proceso de la venta.
    // Seguimiento real = actividad distinta al alta del ciclo. Una fecha
    // programada a futuro no cuenta: el CRM la asigna al crear el ciclo.
    const referencia = ciclo.ultReal !== undefined ? ciclo.ultReal : ciclo.ult;
    const muerto = ESTATUS_CICLO_CERRADO.has(ciclo.estatus) && ciclo.fic && (
      !referencia
      || diasEntre(ciclo.fic, referencia) <= 0
      || diasEntre(ciclo.fic, referencia) <= PVTA4.cicloMuertoDias
    );
    if (muerto) continue;
    if (ciclo.fic) c.huellas.push({ fecha: ciclo.fic, fuente: 'ciclo' });
    // La fecha de creación de la actividad no es una llegada: el CRM reutiliza
    // actividades de ciclos anteriores y esa fecha puede ser meses previa al
    // inicio real del ciclo que produjo la venta.
  }

  // 2) Huellas fuera de los ciclos: leads, pruebas de manejo y solicitudes.
  if (hasLeadsTable(d)) {
    for (const r of d.prepare(`
      SELECT trim(id_crm) AS id, substr(fecha_entrada, 1, 10) AS fecha, canal, campana
      FROM crm_leads
      WHERE id_crm IS NOT NULL AND trim(id_crm) <> '' AND ${fechaValida('fecha_entrada')}
    `).all()) {
      const fecha = isoDay(r.fecha);
      if (!fecha) continue;
      const c = getC(r.id);
      c.leads.push({ fecha, canal: r.canal || null, campana: r.campana || null });
      c.huellas.push({ fecha, fuente: 'lead' });
    }
  }
  if (hasPruebasManejoTable(d)) {
    for (const r of d.prepare(`
      SELECT trim(id_crm) AS id, substr(fecha, 1, 10) AS fecha
      FROM crm_pruebas_manejo
      WHERE id_crm IS NOT NULL AND trim(id_crm) <> '' AND ${fechaValida('fecha')}
    `).all()) {
      const fecha = isoDay(r.fecha);
      if (fecha) getC(r.id).huellas.push({ fecha, fuente: 'prueba' });
    }
  }
  if (hasSolicitudesTable(d)) {
    for (const r of d.prepare(`
      SELECT trim(id_crm) AS id, substr(fecha_solicitud, 1, 10) AS fecha
      FROM crm_solicitudes
      WHERE id_crm IS NOT NULL AND trim(id_crm) <> '' AND ${fechaValida('fecha_solicitud')}
    `).all()) {
      const fecha = isoDay(r.fecha);
      if (fecha) getC(r.id).huellas.push({ fecha, fuente: 'solicitud' });
    }
  }

  const ventas = [];
  const activos = [];
  const perdidos = [];
  for (const c of contactos.values()) {
    const r = clasificarContactoMaduracion(c, hoyIso);
    ventas.push(...r.ventas);
    if (r.activo) activos.push(r.activo);
    if (r.perdido) perdidos.push(r.perdido);
  }

  return {
    hoy: hoyIso,
    ventas,
    activos,
    perdidos,
    contactos: contactos.size,
    ciclosEnVivo: live,
    ciclosEnVivoSync: live
      ? (d.prepare(`SELECT valor FROM crm_ciclos_live_meta WHERE clave = 'synced_at'`).get()?.valor || null)
      : null,
  };
}

/**
 * Reglas P-VTA-4 para un contacto (función pura, probada con datos sintéticos):
 *  - una venta = un ciclo ganador; compras separadas ≤ 7 días se agrupan;
 *  - la llegada es la primera huella posterior a la compra anterior;
 *  - origen cartera > lead > sin clasificar;
 *  - el contacto sin compra posterior queda como activo o perdido.
 *
 * @param {{id, nombre, ciclos:[{idCiclo,fic,crea,ult,estatus,vendedor,ff,producto,unidades}], leads:[{fecha,canal,campana}], huellas:[{fecha,fuente}]}} c
 */
function clasificarContactoMaduracion(c, hoyIso) {
  const limiteCartera = PVTA4.carteraMeses * 30.44;
  const limiteFuturo = sumarDiasIso(hoyIso, 1);
  const ventas = [];
  const huellas = (c.huellas || [])
    .filter((h) => h.fecha && h.fecha >= '2000-01-01' && h.fecha < limiteFuturo)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  const leads = [...(c.leads || [])].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const ciclos = c.ciclos || [];

  // Ventas: ciclos con factura, agrupando compras casi simultáneas.
  const facturados = ciclos.filter((x) => x.ff && x.ff < limiteFuturo).sort((a, b) => a.ff.localeCompare(b.ff));
  const grupos = [];
  for (const ciclo of facturados) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && diasEntre(ultimo.ff, ciclo.ff) <= PVTA4.agrupaCompraDias) {
      ultimo.ciclos.push(ciclo);
      ultimo.unidades += Math.max(1, ciclo.unidades || 0);
      continue;
    }
    grupos.push({ ff: ciclo.ff, ciclos: [ciclo], unidades: Math.max(1, ciclo.unidades || 0) });
  }

  let prevFf = null;
  for (const g of grupos) {
    const ganador = g.ciclos[0];
    const enVentana = (fecha) => fecha <= g.ff && (!prevFf || fecha > prevFf);
    const huellasVentana = huellas.filter((h) => enVentana(h.fecha));
    let llegada = null;
    let fuente = null;
    if (prevFf && ganador.fic && ganador.fic <= prevFf) {
      // El ciclo ganador ya estaba abierto al facturar la compra anterior.
      llegada = ganador.fic;
      fuente = 'ciclo';
    } else if (huellasVentana.length) {
      llegada = huellasVentana[0].fecha;
      fuente = huellasVentana[0].fuente;
    } else if (ganador.fic) {
      llegada = ganador.fic;
      fuente = 'ciclo';
    }
    const dias = diasEntre(llegada, g.ff);
    let excluida = null;
    if (!llegada) excluida = 'sin fecha de llegada';
    else if (dias < 0) excluida = 'duración negativa';
    else if (dias > PVTA4.maxMaduracionDias) excluida = 'mayor a 24 meses';

    const leadsVentana = leads.filter((l) => enVentana(l.fecha));
    let origen = 'sin_clasificar';
    if (prevFf && llegada && diasEntre(prevFf, llegada) <= limiteCartera) origen = 'cartera';
    else if (leadsVentana.length) origen = 'lead';
    const lead = leadsVentana[0] || null;
    const ciclosHastaCerrar = ciclos.filter((x) => x.fic && enVentana(x.fic)).length || 1;

    ventas.push({
      idContacto: c.id,
      nombre: c.nombre || null,
      idCiclo: ganador.idCiclo,
      fechaFactura: g.ff,
      llegada,
      llegadaFuente: fuente,
      dias: excluida ? null : dias,
      excluida,
      origen,
      canal: lead?.canal || null,
      campana: lead?.campana || null,
      vendedor: ganador.vendedor || null,
      producto: ganador.producto || null,
      unidades: g.unidades,
      ciclosHastaCerrar,
      compraPrevia: prevFf,
    });
    prevFf = g.ff;
  }

  // Prospecto sin compra posterior a su última huella: activo o perdido.
  const ultimaFf = prevFf;
  const ciclosAbiertos = ciclos.filter((x) => !x.ff && (!ultimaFf || !x.fic || x.fic > ultimaFf));
  if (!ciclosAbiertos.length) return { ventas, activo: null, perdido: null };
  const huellasPost = huellas.filter((h) => !ultimaFf || h.fecha > ultimaFf);
  const llegada = huellasPost[0]?.fecha
    || ciclosAbiertos.map((x) => x.fic).filter(Boolean).sort()[0]
    || null;
  if (!llegada) return { ventas, activo: null, perdido: null };
  const ultimaAct = ciclosAbiertos.map((x) => x.ult).filter(Boolean).sort().pop() || llegada;
  const cicloVigente = [...ciclosAbiertos].sort((a, b) =>
    String(b.ult || b.fic || '').localeCompare(String(a.ult || a.fic || '')))[0];
  const leadPost = leads.find((l) => !ultimaFf || l.fecha > ultimaFf) || null;
  const origen = ultimaFf && diasEntre(ultimaFf, llegada) <= limiteCartera
    ? 'cartera'
    : (leadPost ? 'lead' : 'sin_clasificar');
  const sinActividad = diasEntre(ultimaAct, hoyIso);
  const enCartera = ESTATUS_CARTERA_ACTIVA.includes(cicloVigente.estatus);
  if (enCartera && sinActividad <= PVTA4.perdidoDias) {
    return {
      ventas,
      perdido: null,
      activo: {
        idContacto: c.id,
        nombre: c.nombre || null,
        llegada,
        edad: Math.max(0, diasEntre(llegada, hoyIso)),
        estatus: cicloVigente.estatus,
        vendedor: cicloVigente.vendedor || null,
        ultimaActividad: ultimaAct,
        origen,
        canal: leadPost?.canal || null,
      },
    };
  }
  return {
    ventas,
    activo: null,
    perdido: {
      llegada,
      edadAlPerder: Math.max(0, diasEntre(llegada, ultimaAct)),
      origen,
    },
  };
}

function getMaduracionBase(hoyIso) {
  return ttlCache('pvta4Base', hoyIso, PVTA4_TTL_MS, () => computeMaduracionBase(hoyIso));
}

/**
 * Curva empírica: probabilidad de que un prospecto que seguía abierto a la edad `a`
 * compre en los siguientes `h` días. Incluye a los perdidos para no sobrestimar.
 */
function construirCurva(ventas, perdidos, { desde, hasta }) {
  const cohorteVentas = ventas.filter((v) => v.dias != null && v.llegada >= desde && v.llegada <= hasta);
  const cohortePerdidos = perdidos.filter((p) => p.llegada >= desde && p.llegada <= hasta);
  const porOrigen = (origen) => ({
    compras: cohorteVentas.filter((v) => !origen || v.origen === origen).map((v) => v.dias),
    perdidos: cohortePerdidos.filter((p) => !origen || p.origen === origen).map((p) => p.edadAlPerder),
  });
  const curvas = {
    general: porOrigen(null),
    cartera: porOrigen('cartera'),
    lead: porOrigen('lead'),
    sin_clasificar: porOrigen('sin_clasificar'),
  };
  const MINIMO_VIVOS = 20;
  const evaluar = (base, edad, horizonte) => {
    const vivos = base.compras.filter((x) => x > edad).length + base.perdidos.filter((x) => x > edad).length;
    if (vivos < MINIMO_VIVOS) return null;
    const compran = base.compras.filter((x) => x > edad && x <= edad + horizonte).length;
    return Math.min(1, compran / vivos);
  };
  const probabilidad = (origen, edad, horizonte) => {
    const propia = curvas[origen];
    const conPropia = propia && propia.compras.length >= 30 ? evaluar(propia, edad, horizonte) : null;
    if (conPropia != null) return conPropia;
    return evaluar(curvas.general, edad, horizonte) ?? 0;
  };
  return {
    probabilidad,
    tamano: {
      compras: curvas.general.compras.length,
      perdidos: curvas.general.perdidos.length,
      desde,
      hasta,
    },
  };
}

/**
 * P-VTA-4 para un periodo: días de maduración (promedio, mediana, P75) por origen,
 * serie mensual, prospectos activos por edad y cobertura del objetivo.
 */
function getTiempoMaduracion({ fechaInicio = null, fechaFin = null } = {}) {
  const hoy = new Date().toISOString().slice(0, 10);
  let fi = isoDay(fechaInicio);
  let ff = isoDay(fechaFin);
  if (!fi || !ff) {
    fi = `${hoy.slice(0, 7)}-01`;
    ff = sumarDiasIso(sumarMesesIso(fi, 1), -1);
  }
  if (fi > ff) [fi, ff] = [ff, fi];
  return ttlCache('pvta4', `${fi}|${ff}|${hoy}`, PVTA4_TTL_MS, () => {
    const base = getMaduracionBase(hoy);
    const ventasPeriodo = base.ventas.filter((v) => v.fechaFactura >= fi && v.fechaFactura <= ff);
    const validas = ventasPeriodo.filter((v) => v.dias != null);
    const excluidas = ventasPeriodo.filter((v) => v.excluida);

    const resumenOrigen = (origen) => {
      const lista = validas.filter((v) => v.origen === origen);
      return {
        ...estadisticasDias(lista.map((v) => v.dias)),
        mezclaPct: validas.length ? Math.round((lista.length / validas.length) * 1000) / 10 : 0,
        ciclosHastaCerrar: lista.length
          ? Math.round((lista.reduce((s, v) => s + v.ciclosHastaCerrar, 0) / lista.length) * 10) / 10
          : null,
      };
    };
    const general = estadisticasDias(validas.map((v) => v.dias));
    const origenes = {
      cartera: resumenOrigen('cartera'),
      lead: resumenOrigen('lead'),
      sin_clasificar: resumenOrigen('sin_clasificar'),
    };

    // Serie mensual (meses completos que terminan en el mes del fin del periodo).
    const mesFin = `${ff.slice(0, 7)}-01`;
    const serie = [];
    for (let i = PVTA4.mesesSerie - 1; i >= 0; i--) {
      const inicioMes = sumarMesesIso(mesFin, -i);
      const finMes = sumarDiasIso(sumarMesesIso(inicioMes, 1), -1);
      const delMes = base.ventas.filter((v) => v.dias != null && v.fechaFactura >= inicioMes && v.fechaFactura <= finMes);
      const stat = (origen) => estadisticasDias(delMes.filter((v) => !origen || v.origen === origen).map((v) => v.dias));
      serie.push({
        mes: inicioMes.slice(0, 7),
        general: stat(null),
        cartera: stat('cartera'),
        lead: stat('lead'),
        ventas: delMes.length,
        mezclaCarteraPct: delMes.length
          ? Math.round((delMes.filter((v) => v.origen === 'cartera').length / delMes.length) * 1000) / 10
          : null,
      });
    }
    const ultimos3 = serie.slice(-3).flatMap((m) => base.ventas.filter((v) => v.dias != null && v.fechaFactura.slice(0, 7) === m.mes).map((v) => v.dias));
    const previos9 = serie.slice(0, -3).flatMap((m) => base.ventas.filter((v) => v.dias != null && v.fechaFactura.slice(0, 7) === m.mes).map((v) => v.dias));
    const movil3 = estadisticasDias(ultimos3);
    const historico = estadisticasDias(previos9);
    const anual = estadisticasDias([...previos9, ...ultimos3]);

    // Leads por canal (ventas del periodo con origen lead).
    const porCanal = new Map();
    for (const v of validas.filter((x) => x.origen === 'lead')) {
      const key = v.canal || 'Sin canal';
      if (!porCanal.has(key)) porCanal.set(key, []);
      porCanal.get(key).push(v.dias);
    }
    const leadsPorCanal = [...porCanal.entries()]
      .map(([canal, dias]) => ({ canal, ...estadisticasDias(dias) }))
      .sort((a, b) => b.n - a.n);

    // Prospectos activos por edad. Zona de maduración = rango intercuartil de los
    // últimos 12 meses (donde cierra la mitad central de las ventas).
    const zonaDesde = anual.p25 ?? null;
    const zonaHasta = anual.p75 ?? null;
    const activosPorEdad = PVTA4_EDADES.map((b) => ({
      ...b,
      max: Number.isFinite(b.max) ? b.max : null,
      n: base.activos.filter((a) => a.edad >= b.min && a.edad <= b.max).length,
      enZona: zonaDesde != null && zonaHasta != null && b.max >= zonaDesde && b.min <= zonaHasta,
    }));
    const activosMaduros = zonaDesde != null ? base.activos.filter((a) => a.edad >= zonaDesde).length : 0;
    const ultimoCicloAbierto = base.activos.map((a) => a.llegada).sort().pop() || null;
    const ultimaFactura = base.ventas.map((v) => v.fechaFactura).sort().pop() || null;

    // Cobertura del objetivo (solo tiene sentido si el periodo sigue abierto).
    const horizonte = Math.max(0, diasEntre(hoy, ff));
    const curva = construirCurva(base.ventas, base.perdidos, {
      desde: sumarMesesIso(ff, -PVTA4.mesesCurva),
      hasta: sumarDiasIso(ff, -PVTA4.perdidoDias),
    });
    let objetivo = null;
    let objetivoFuente = null;
    try {
      const goals = require('./salesGoals').getGoals({ fechaInicio: fi, fechaFin: ff });
      objetivo = Number(goals?.retail) > 0 ? Number(goals.retail) : null;
      objetivoFuente = objetivo != null ? (goals?.retailSource || null) : null;
    } catch { /* sin objetivo configurado */ }
    const facturadas = ventasPeriodo.reduce((s, v) => s + Math.max(1, v.unidades), 0);
    const faltante = objetivo != null ? Math.max(0, objetivo - facturadas) : null;
    const prospectos = base.activos
      .map((a) => ({ ...a, probabilidad: horizonte > 0 ? curva.probabilidad(a.origen, a.edad, horizonte) : 0 }))
      .sort((a, b) => b.probabilidad - a.probabilidad || b.edad - a.edad);
    const esperadas = Math.round(prospectos.reduce((s, p) => s + p.probabilidad, 0) * 10) / 10;
    const cobertura = {
      aplica: horizonte > 0 && objetivo != null,
      periodoCerrado: horizonte === 0,
      horizonteDias: horizonte,
      objetivo,
      objetivoFuente,
      facturadas,
      faltante,
      esperadas,
      pct: faltante != null && faltante > 0 && horizonte > 0
        ? Math.round((esperadas / faltante) * 1000) / 10
        : (faltante === 0 ? 100 : null),
      prospectosActivos: base.activos.length,
      prospectosMaduros: activosMaduros,
      prospectosNecesarios: faltante != null && faltante > 0 && esperadas < faltante && base.activos.length && esperadas > 0
        ? Math.ceil((faltante - esperadas) / (esperadas / base.activos.length))
        : 0,
      curva: curva.tamano,
    };

    const listaVentas = [...validas]
      .sort((a, b) => b.fechaFactura.localeCompare(a.fechaFactura))
      .slice(0, 60)
      .map((v) => ({
        idContacto: v.idContacto,
        nombre: v.nombre,
        fechaFactura: v.fechaFactura,
        llegada: v.llegada,
        llegadaFuente: v.llegadaFuente,
        dias: v.dias,
        origen: v.origen,
        canal: v.canal,
        campana: v.campana,
        vendedor: v.vendedor,
        producto: v.producto,
        unidades: v.unidades,
        ciclosHastaCerrar: v.ciclosHastaCerrar,
      }));

    return {
      clave: 'P-VTA-4',
      indicador: 'Tiempo de Maduración Comercial',
      periodo: { fechaInicio: fi, fechaFin: ff, hoy },
      parametros: { ...PVTA4 },
      general,
      origenes,
      movil3,
      historico,
      anual,
      serie,
      leadsPorCanal,
      datos: {
        contactos: base.contactos,
        ventasHistoricas: base.ventas.length,
        ultimaFactura,
        ultimoCicloAbierto,
        ciclosEnVivo: base.ciclosEnVivo,
        ciclosEnVivoSync: base.ciclosEnVivoSync,
      },
      excluidas: {
        total: excluidas.length,
        motivos: excluidas.reduce((acc, v) => {
          acc[v.excluida] = (acc[v.excluida] || 0) + 1;
          return acc;
        }, {}),
      },
      activosPorEdad,
      zonaMaduracion: { desde: zonaDesde, hasta: zonaHasta },
      cobertura,
      prospectos: prospectos.slice(0, 40),
      ventas: listaVentas,
      metodologia: {
        llegada: 'Primera huella del cliente en CRM (lead, ciclo, actividad, prueba de manejo o solicitud) posterior a su compra anterior. Un ciclo descartado, caducado, perdido, diferido o que se quedó en prospección sin seguimiento posterior no cuenta como llegada.',
        venta: 'Fecha de factura del ciclo; compras separadas por 7 días o menos cuentan como una sola venta.',
        origen: 'Cartera = compra previa en Balderrama dentro de 48 meses; Lead = registro en STREGA sin compra previa; el resto queda sin clasificar.',
        cobertura: 'Ventas esperadas = suma de la probabilidad histórica de compra de cada prospecto activo según su edad, en los días que faltan del periodo. Objetivo = meta retail del mes en Ventas.',
        semaforo: 'Sin meta ni semáforo por definición del catálogo; la cobertura se lee contra 100%.',
      },
    };
  });
}

module.exports = {
  isAvailable,
  releaseDb,
  warmCaches,
  getTiempoMaduracion,
  clasificarContactoMaduracion,
  PVTA4,
  getCrmStats,
  searchContacts,
  getContactHistory,
  getLeadsSummary,
  getLeadsDashboard,
  getLeadsKpiDetalle,
  getBdcEmbudo,
  getSeguimiento360Summary,
  resolveCrmPeriod,
  getLeadNotDuplicateSql,
  getCierresTallerPeriodo,
  exportCloudSyncRecords,
  enrichByVins,
  getCustomerUnitsDms,
  normalizeVin,
  resolveIdCrmBySerie,
  resolveIdCrmByNombre,
  resolveIdCrmByTelefono,
  listVendedores,
  getVendedorResumen,
  getProspeccionIndicadores,
  getExpedienteProspecto,
  getCarteraEjecutivo,
  getQuejasCsiSummary,
  getQuejasCsiForPersona,
  classifyEntregasTipoCliente,
};
