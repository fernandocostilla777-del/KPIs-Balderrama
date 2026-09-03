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
  return db;
}

/** Cierra la conexión y limpia índices en memoria (necesario antes/después de un ETL). */
function releaseDb() {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }
  vinIndexCache = null;
  nameIndexCache = null;
  phoneIndexCache = null;
  clearLeadNotDuplicateSqlCache();
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
  for (const u of unidadesSql || []) {
    for (const f of u.facturasVentaSql || []) {
      if (!inDateRange(f.fechaFactura, fechaInicio, fechaFin)) continue;
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

function getCrmStats() {
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

  const params = {};
  list.forEach((vin, i) => {
    params[`vin${i}`] = vin;
    params[`like${i}`] = `%${vin}`;
    const suffix = vinSearchSuffix(vin);
    if (suffix) params[`suf${i}`] = `%${suffix}`;
  });
  if (fechaInicio) params.fechaInicio = fechaInicio;
  if (fechaFin) params.fechaFin = fechaFin;
  const matchSql = (col) => list.map((vin, i) => {
    const parts = [
      `UPPER(LTRIM(RTRIM(${col}))) = @vin${i}`,
      `UPPER(LTRIM(RTRIM(${col}))) LIKE @like${i}`,
    ];
    if (params[`suf${i}`]) {
      parts.push(`UPPER(LTRIM(RTRIM(${col}))) LIKE @suf${i}`);
    }
    return parts.join('\n    OR ');
  }).join(' OR ');
  const orderDateSql = [
    fechaInicio ? 'AND CONVERT(DATE, o.ORE_FECHAORD, 103) >= @fechaInicio' : '',
    fechaFin ? 'AND CONVERT(DATE, o.ORE_FECHAORD, 103) <= @fechaFin' : '',
  ].filter(Boolean).join('\n');

  try {
    const [ventasRows, ordenesRows] = await Promise.all([
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
        LEFT JOIN UNI_TEMLIBROVENTAS lv
          ON lv.VTE_DOCTO = v.VTE_DOCTO
          AND lv.VTE_ORGSTATUS = 'I'
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
        LEFT JOIN (
          SELECT fos_idorden, MAX(fos_docto) AS factura, SUM(fos_total) AS importe
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
          SELECT ORD_IDORDEN AS idorden,
            SUM(ORD_SUBTOTAL) AS subtotal,
            SUM(ORD_IVATOT) AS iva
          FROM SER_ORDENDET
          GROUP BY ORD_IDORDEN
        ) det ON det.idorden = o.ORE_IDORDEN
        LEFT JOIN PNC_PARAMETR asr
          ON asr.PAR_TIPOPARA = 'AS' AND asr.PAR_IDENPARA = o.ORE_IDASESOR
        WHERE (${matchSql('o.ORE_NUMSERIE')})
          ${orderDateSql}
        ORDER BY CONVERT(DATE, o.ORE_FECHAORD, 103) DESC
      `, params),
    ]);

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

    const ventasCalculadas = ventasRows.map((row) => {
      const ventaSubtotal = Number(row.ventaSubtotal || 0);
      const costoNeto = Number(row.costoNeto || 0);
      const gastos = Number(row.gastos || 0);
      const tieneLibro = Number(row.tieneLibro || 0) === 1;
      const utilidad = (tieneLibro || costoNeto > 0)
        ? Math.round((ventaSubtotal - costoNeto - gastos) * 100) / 100
        : null;
      return {
        ...row,
        ventaSubtotal,
        costoNeto,
        gastos,
        utilidad,
      };
    });

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
  const compraActual = [...compras].sort((a, b) =>
    String(b.fechaEntrega || b.fechaFactura || '').localeCompare(
      String(a.fechaEntrega || a.fechaFactura || '')
    ))[0] || null;
  const contratoActual = [...contratos].sort((a, b) =>
    String(validHistoricalDate(b.fecha_compra_valida, b.fecha_compra, b.fecha_timbrado, b.fecha) || '').localeCompare(
      String(validHistoricalDate(a.fecha_compra_valida, a.fecha_compra, a.fecha_timbrado, a.fecha) || '')
    ))[0] || null;
  const vinActual = normalizeVin(contratoActual?.vin || compraActual?.vin);
  const unidadActual = unidades.find((u) => matchCrmVinToSerie(vinActual, u.serie))
    || [...unidades].sort((a, b) =>
      String(b.fechaFactura || b.ultimaVisita || '').localeCompare(
        String(a.fechaFactura || a.ultimaVisita || '')
      ))[0]
    || null;

  const ordenesValidas = ordenes.filter((o) => String(o.status || '').trim().toUpperCase() !== 'C');
  const ordenesOrdenadas = [...ordenesValidas].sort((a, b) =>
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

  const ultimaActividad = [...timeline].sort((a, b) =>
    String(b.fecha || '').localeCompare(String(a.fecha || '')))[0] || null;
  const textoIncidencias = timeline.map((t) =>
    `${t.tipo || ''} ${t.resultado || ''}`).join(' | ');
  const quejasTimeline = (textoIncidencias.match(/QUEJA|INCIDENCIA|RECLAMO|INCONFORMIDAD/gi) || []).length;
  const quejasIncidencias = Number(quejasCsi?.total ?? 0) > 0
    ? Number(quejasCsi.total)
    : quejasTimeline;
  const digitalPattern = /DIGITAL|WEB|INTERNET|FACEBOOK|INSTAGRAM|WHATSAPP|CHAT|GOOGLE|PORTAL|EMAIL|CORREO/i;
  const interaccionesDigitales = leads.filter((l) =>
    digitalPattern.test(`${l.canal || ''} ${l.tipo || ''} ${l.campana || ''}`)
  ).length + timeline.filter((t) =>
    digitalPattern.test(`${t.tipo || ''} ${t.resultado || ''}`)
  ).length;

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

  return {
    consolidado: {
      fechaUltimaCompra: toIsoDate(
        validHistoricalDate(
          contratoActual?.fecha_compra_valida,
          contratoActual?.fecha_compra,
          contratoActual?.fecha_timbrado,
          contratoActual?.fecha
        ) || compraActual?.fechaEntrega || compraActual?.fechaFactura
      ),
      modeloActual: contratoActual?.unidad || compraActual?.modeloSql || compraActual?.producto
        || unidadActual?.modelo || null,
      anModelo: unidadActual?.anModelo || null,
      vinActual: vinActual || unidadActual?.serie || null,
      numeroContrato: contratoActual?.no_contrato || contratoActual?.contrato || null,
      tipoCompra: contratoActual?.tipo_compra || contratoActual?.plan_2
        || contratoActual?.plan || (contratoActual ? 'Crédito' : null),
      seguroAuto: contratoActual?.aseguradora || null,
      plazoContratado: Number.isFinite(plazo) && plazo > 0 ? plazo : null,
      mensualidadesPagadas,
      saldoEstimado,
      valorEstimadoUnidad,
      ultimaVisitaTaller: toIsoDate(ultimaOrden?.ingreso || ultimaOrden?.cierre),
      kilometraje: kmOrden ? Number(kmOrden.kilometraje) : (unidadActual?.kilometraje ?? null),
      fechaKilometraje: kmOrden
        ? toIsoDate(kmOrden.ingreso || kmOrden.cierre)
        : (unidadActual?.fechaKilometraje || null),
      serviciosRealizados: ordenesValidas.length,
      ultimoContactoComercial: toIsoDate(ultimaActividad?.fecha),
      interaccionesDigitales,
      quejasIncidencias,
      quejasPosventa: Number(quejasCsi?.totalPosventa || 0),
      quejasVentas: Number(quejasCsi?.totalVentas || 0),
      quejasAreaPrincipal: quejasCsi?.areaPrincipal || null,
      historialCompras: new Set([
        ...compras.map((c) => normalizeVin(c.vin)),
        ...contratos.map((c) => normalizeVin(c.vin)),
      ].filter(Boolean)).size,
      metodologia: {
        mensualidades: 'Meses transcurridos desde la compra, limitados al plazo; no confirma pagos reales.',
        saldo: 'Monto financiado amortizado linealmente; no incluye intereses, pagos anticipados ni mora.',
        valorUnidad: 'Monto financiado más enganche al contratar; no es un avalúo comercial actual.',
        kilometraje: 'Último kilometraje disponible en una orden de taller.',
        quejas: 'CSI Posventa (orden) + CSI Ventas (serie/VIN). Área inferida del texto de la incidencia.',
      },
    },
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
    const telefonoCliente = last?.telefono || lastPrueba?.telefono || null;
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
      compras: vinsLead.map((vin) => ({ vin })),
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
      correo: last?.correo || null,
      vendedor: vendedorAsignado,
      resumen: {
        totalActividades: 0,
        totalCiclos: 0,
        totalCompras: vinsLead.length,
        totalLeads: leads.length,
        totalSolicitudes: solicitudes.length,
        totalPruebasManejo: pruebasManejo.length,
        totalContratosFinanciamiento: contratosFinanciamiento.length,
        totalPvas: contratosFinanciamiento.reduce((sum, contrato) => sum + contrato.pvas.length, 0),
        realizoPruebaManejo: pruebasManejo.length > 0,
        pruebaManejoConCompra: pruebasManejo.length > 0 && vinsLead.length > 0,
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
      compras: vinsLead.map((vin) => ({ vin })),
      leads,
      solicitudes,
      pruebasManejo,
      contratosFinanciamiento,
      timeline: [],
      quejasCsi,
      ficha360: cliente360.consolidado,
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
  const telefonoCliente = leads.length
    ? leads[leads.length - 1].telefono
    : (pruebasManejo[pruebasManejo.length - 1]?.telefono || null);
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

  // Adjuntar cruce SQL a cada compra CRM
  const unidadesSql = [...(sqlEnrich.unidades || []), ...(sqlAdicional.unidades || [])];
  const contratosFinanciamiento = getFinanciamientoByVins(d, [
    ...vins,
    ...unidadesDms.unidades.map((unidad) => unidad.serie),
  ]);
  const sqlByVin = new Map(unidadesSql.map((u) => [u.vin, u]));
  for (const compra of compras) {
    const enr = sqlByVin.get(compra.vin);
    compra.serieSql = enr?.serieSql || null;
    compra.facturaVentaSql = enr?.facturasVentaSql?.[0]?.facturaVenta || null;
    compra.facturasVentaSql = enr?.facturasVentaSql || [];
    compra.modeloSql = enr?.facturasVentaSql?.[0]?.modelo || null;
    compra.ordenesServicio = (enr?.ordenesServicio || []).filter(
      (orden) => !ordenIdsCliente.size || ordenIdsCliente.has(String(orden.orden))
    );
    compra.totalOrdenes = compra.ordenesServicio.length;
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
    compras,
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
    correo: leads.length ? leads[leads.length - 1].correo : null,
    vendedor: vendedorAsignado,
    resumen: {
      totalActividades: rows.length,
      totalCiclos: ciclos.length,
      totalCompras: compras.length, // VINs distintos (col T)
      totalLeads: leads.length,
      totalSolicitudes: solicitudes.length,
      totalPruebasManejo: pruebasManejo.length,
      totalContratosFinanciamiento: contratosFinanciamiento.length,
      totalPvas: contratosFinanciamiento.reduce((sum, contrato) => sum + contrato.pvas.length, 0),
      realizoPruebaManejo: pruebasManejo.length > 0,
      pruebaManejoConCompra: pruebasManejo.length > 0 && compras.length > 0,
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
    compras,
    leads,
    solicitudes,
    pruebasManejo,
    contratosFinanciamiento,
    timeline,
    quejasCsi,
    ficha360: cliente360.consolidado,
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
  const rows = d.prepare(`
    SELECT DISTINCT upper(trim(vin)) AS vin, id_contacto
    FROM crm_actividades
    WHERE vin IS NOT NULL AND length(trim(vin)) >= 5
  `).all();
  const byVin = new Map();
  const lengths = new Set();
  for (const r of rows) {
    if (!byVin.has(r.vin)) byVin.set(r.vin, r.id_contacto);
    lengths.add(r.vin.length);
  }
  vinIndexCache = { byVin, lengths: [...lengths].sort((a, b) => b - a) };
  return vinIndexCache;
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

  const rows = await query(`
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
    LEFT JOIN (
      SELECT fos_idorden, MAX(fos_docto) AS factura, MAX(fos_qctipoauto) AS autoFac, SUM(fos_total) AS importe
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
  `, { fechaInicio, fechaFin });

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

  const ultimaActividadById = getUltimaActividadByIds(
    [...clientes.values()].map((c) => c.idCrm).filter(Boolean)
  );
  for (const cliente of clientes.values()) {
    const fechaCrm = cliente.idCrm
      ? ultimaActividadById.get(String(cliente.idCrm))
      : null;
    if (fechaCrm && (!cliente.ultimaActividad || fechaCrm > cliente.ultimaActividad)) {
      cliente.ultimaActividad = fechaCrm;
    }
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

/** Excluye leads marcados DUPLICADO (Google Sheets col. AD / resultado / contacto / estación). */
let leadNotDuplicateSqlCache = null;

function getLeadNotDuplicateSql() {
  if (leadNotDuplicateSqlCache) return leadNotDuplicateSqlCache;
  const parts = [
    `upper(trim(COALESCE(resultado, ''))) <> 'DUPLICADO'`,
    `upper(trim(COALESCE(contacto, ''))) <> 'DUPLICADO'`,
    `upper(trim(COALESCE(estacion, ''))) <> 'DUPLICADO'`,
  ];
  try {
    const d = getDb();
    const cols = new Set(
      d.prepare('PRAGMA table_info(crm_leads)').all().map((c) => c.name),
    );
    if (cols.has('enlace_directo')) {
      parts.push(`upper(trim(COALESCE(enlace_directo, ''))) <> 'DUPLICADO'`);
    }
    if (cols.has('es_duplicado')) {
      parts.push('COALESCE(es_duplicado, 0) = 0');
    }
  } catch {
    /* tabla aún no disponible */
  }
  leadNotDuplicateSqlCache = parts.join(' AND ');
  return leadNotDuplicateSqlCache;
}

function clearLeadNotDuplicateSqlCache() {
  leadNotDuplicateSqlCache = null;
}

/** Fecha de compra asociada al lead (factura lead o ciclo CRM con VIN). */
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
  const max = Math.min(1000, Math.max(50, Number(limit) || 400));

  const notDupSql = getLeadNotDuplicateSql();
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

  const totales = d.prepare(`
    SELECT
      COUNT(*) AS leads,
      COUNT(DISTINCT CASE WHEN id_crm IS NOT NULL AND trim(id_crm) <> '' THEN id_crm END) AS oportunidades,
      SUM(CASE WHEN contacto = 'SI' THEN 1 ELSE 0 END) AS contactados,
      SUM(CASE WHEN cita_programada = 'SI' THEN 1 ELSE 0 END) AS citas,
      SUM(CASE WHEN cita_asistida = 'SI' THEN 1 ELSE 0 END) AS citasAsistidas,
      SUM(CASE WHEN cotizacion IS NOT NULL AND trim(cotizacion) <> '' AND upper(trim(cotizacion)) NOT IN ('NO','N','0') THEN 1 ELSE 0 END) AS cotizados,
      SUM(${COMPRA_LEAD_SQL}) AS compras,
      SUM(CASE WHEN ejecutivo_asignado IS NOT NULL AND trim(ejecutivo_asignado) <> '' THEN 1 ELSE 0 END) AS conEjecutivo
    FROM crm_leads
    ${whereSql}
  `).get(...params);

  const n = (k) => Number(totales?.[k] || 0);
  const leads = n('leads');
  const contactados = n('contactados');
  const citas = n('citas');
  const cotizados = n('cotizados');
  const compras = n('compras');
  const pct = (num, den) => (den ? Math.round((num / den) * 10000) / 100 : 0);

  const summary = {
    leads,
    oportunidades: n('oportunidades'),
    contactados,
    citas,
    citasAsistidas: n('citasAsistidas'),
    cotizados,
    compras,
    conEjecutivo: n('conEjecutivo'),
    sinCompra: Math.max(0, leads - compras),
    conversionContactoPct: pct(contactados, leads),
    conversionCitaPct: pct(citas, leads),
    conversionCotizacionPct: pct(cotizados, leads),
    conversionCompraPct: pct(compras, leads),
    conversionCitaACompraPct: pct(compras, citas),
    conversionContactoACompraPct: pct(compras, contactados),
  };

  const funnel = [
    { key: 'leads', label: 'Leads / oportunidades', value: leads, pct: 100 },
    { key: 'contactados', label: 'Contactados', value: contactados, pct: pct(contactados, leads) },
    { key: 'citas', label: 'Cita programada', value: citas, pct: pct(citas, leads) },
    { key: 'cotizados', label: 'Cotizados', value: cotizados, pct: pct(cotizados, leads) },
    { key: 'compras', label: 'Compra (VIN)', value: compras, pct: pct(compras, leads) },
  ];

  const groupQuery = (expr, maxGroups = 20) => d.prepare(`
    SELECT
      COALESCE(NULLIF(trim(${expr}), ''), '(sin dato)') AS grupo,
      COUNT(*) AS leads,
      SUM(CASE WHEN contacto = 'SI' THEN 1 ELSE 0 END) AS contactados,
      SUM(CASE WHEN cita_programada = 'SI' THEN 1 ELSE 0 END) AS citas,
      SUM(CASE WHEN cotizacion IS NOT NULL AND trim(cotizacion) <> '' AND upper(trim(cotizacion)) NOT IN ('NO','N','0') THEN 1 ELSE 0 END) AS cotizados,
      SUM(${COMPRA_LEAD_SQL}) AS compras
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
      SUM(${COMPRA_LEAD_SQL}) AS compras
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
    LEAD_VIDA_DIAS,
    resolveCampanaConversionKey,
  } = require('../config/campanasConversion');

  const COMPRA_LEAD_90D_SQL = buildCompraLeadDentroVidaSql(LEAD_VIDA_DIAS);

  const campanaAggRows = d.prepare(`
    SELECT
      COALESCE(NULLIF(trim(campana), ''), '(sin campaña)') AS campana,
      COUNT(*) AS leads,
      SUM(CASE WHEN contacto = 'SI' THEN 1 ELSE 0 END) AS contactados,
      SUM(${COMPRA_LEAD_SQL}) AS compras,
      SUM(${COMPRA_LEAD_90D_SQL}) AS vendidos
    FROM crm_leads
    ${whereSql}
    GROUP BY campana
  `).all(...params);

  const campanasMap = Object.fromEntries(
    CAMPANAS_CONVERSION.map((c) => [c.key, {
      key: c.key,
      campana: c.label,
      total: 0,
      contactados: 0,
      vendidos: 0,
      vendidosFueraVida: 0,
      conversionPct: 0,
      matchedNames: [],
    }])
  );

  for (const row of campanaAggRows) {
    const key = resolveCampanaConversionKey(row.campana);
    if (!key || !campanasMap[key]) continue;
    const bucket = campanasMap[key];
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

  const campanasConversion = CAMPANAS_CONVERSION.map((c) => {
    const b = campanasMap[c.key];
    b.conversionPct = pct(b.vendidos, b.total);
    return b;
  });

  const campanasConversionTotales = campanasConversion.reduce((acc, r) => {
    acc.total += r.total;
    acc.contactados += r.contactados;
    acc.vendidos += r.vendidos;
    acc.vendidosFueraVida += r.vendidosFueraVida;
    return acc;
  }, { total: 0, contactados: 0, vendidos: 0, vendidosFueraVida: 0 });
  campanasConversionTotales.conversionPct = pct(
    campanasConversionTotales.vendidos,
    campanasConversionTotales.total
  );
  campanasConversionTotales.vidaDias = LEAD_VIDA_DIAS;

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
      const key = resolveCampanaConversionKey(r.campana);
      if (!key) return null;
      const campanaCfg = CAMPANAS_CONVERSION.find((c) => c.key === key);
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
        campana: campanaCfg?.label || String(r.campana || '').trim(),
        campanaKey: key,
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

  cobertura.sinDatosEnPeriodo = leads === 0 && Number(cobertura.totalLeads || 0) > 0;

  const detalleRows = d.prepare(`
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

  const detalle = detalleRows.map((r) => {
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
      vin,
      fechaFactura: r.fechaFactura || null,
      estatusCompra: String(r.estatusCompra || '').trim() || null,
      estatusCiclo: String(r.estatusCiclo || '').trim() || null,
      etapa: conCompra ? 'compra' : (String(r.citaProgramada || '').trim().toUpperCase() === 'SI' ? 'cita' : (String(r.contacto || '').trim().toUpperCase() === 'SI' ? 'contacto' : 'lead')),
    };
  });

  return {
    filtros: {
      fechaInicio: rango.desde,
      fechaFin: rango.hasta,
      periodo: rango.periodo,
    },
    fuente: 'crm_leads · crm_actividades (Balderrama Ciclos)',
    reglaCompra: 'VIN en ciclo CRM del mismo ID CRM, o vin_comprado en el lead',
    cobertura,
    semantica: {
      cohorte: 'El periodo filtra fecha_entrada del lead (oportunidad)',
      compras: 'Compra vinculada por ID CRM; puede ocurrir después del periodo',
      sinDuplicados: 'No se contabilizan leads marcados DUPLICADO en Google Sheets (columna AD / resultado / contacto / estación)',
      campanasConversion: `Vendidos de campañas documentadas solo cuentan si la compra ocurre dentro de ${LEAD_VIDA_DIAS} días desde fecha_entrada; fuera de esa vida útil no suman a conversión aunque exista venta`,
      alertasCaducar: 'Las alertas de caducidad usan la misma cohorte por fecha_entrada del periodo, con vida restante ≤14 días de 90',
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
    campanasCaducarAlertas,
    campanasCaducarResumen,
    detalle,
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

function collectVendedorVins(d, { clientesIds, vendedorKey, fechaInicio, fechaFin }) {
  const vins = new Set();
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
  {
    const params = [vendedorKey];
    const dateSql = vendedorDateClause(actDate, fechaInicio, fechaFin, params);
    const rows = d.prepare(`
      SELECT DISTINCT UPPER(TRIM(vin)) AS vin
      FROM crm_actividades
      WHERE UPPER(TRIM(vendedor)) = ?
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
  vins,
  fechaInicio,
  fechaFin,
}) {
  if (!hasFinanciamientoTable(d) || !tokenKey) {
    return {
      fuente: 'crm_financiamiento',
      contratos: 0,
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
    if (asesorTok && asesorTok === tokenKey) byAsesor.push(row);
    else if (vin && vinSet.has(vin)) byVin.push(row);
  }

  const match = byAsesor.length ? 'asesor' : (byVin.length ? 'vin_cartera' : 'ninguno');
  const contratos = byAsesor.length ? byAsesor : byVin;

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

function buildLibroVentasCrmStats(d, { clientesIds, vendedorKey, fechaInicio, fechaFin }) {
  const actDate = 'COALESCE(fecha_factura, fecha_entrega, fecha_inicio_ciclo, fecha_crea_actividad)';
  const params = [vendedorKey];
  const dateSql = vendedorDateClause(actDate, fechaInicio, fechaFin, params);
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
    WHERE UPPER(TRIM(vendedor)) = ?
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

async function buildVendedorComercialStats(d, {
  vendedorKey,
  vendedorNombre,
  clientesIds,
  fechaInicio,
  fechaFin,
}) {
  const tokenKey = personTokenKey(vendedorNombre) || personTokenKey(vendedorKey);
  const vins = collectVendedorVins(d, {
    clientesIds,
    vendedorKey,
    fechaInicio,
    fechaFin,
  });

  const financiamiento = buildFinanciamientoVendedorStats(d, {
    tokenKey,
    vins,
    fechaInicio,
    fechaFin,
  });
  const libroCrm = buildLibroVentasCrmStats(d, {
    clientesIds,
    vendedorKey,
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

  const [libroResult, tallerResult] = await Promise.all([
    queryLibroVentasSqlByVins(vins, fechaInicio, fechaFin)
      .then((ventasSql) => {
        const byDoc = new Map();
        for (const row of ventasSql) {
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
      })
      .catch((err) => ({
        unidades: 0,
        porTipoPago: [],
        muestra: [],
        error: err.message,
      })),
    queryTallerReturnByVins(vins).catch((err) => ({
      vinsConOrden: new Set(),
      ordenes: 0,
      importe: 0,
      error: err.message,
    })),
  ]);

  libroSql = libroResult;

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
      map.set(key, { vendedor: display, key, clientes: 0, fuentes: new Set() });
    }
    const row = map.get(key);
    if (display.length > row.vendedor.length) row.vendedor = display;
    row.clientes = Math.max(row.clientes, Number(clientes || 0));
    row.fuentes.add(fuente);
  };

  const like = term ? `%${term}%` : null;
  const actSql = `
    SELECT TRIM(vendedor) AS nombre, COUNT(DISTINCT id_contacto) AS clientes
    FROM crm_actividades
    WHERE vendedor IS NOT NULL AND TRIM(vendedor) <> ''
      ${like ? 'AND vendedor LIKE ?' : ''}
    GROUP BY UPPER(TRIM(vendedor))
  `;
  for (const r of d.prepare(actSql).all(...(like ? [like] : []))) {
    bump(r.nombre, r.clientes, 'ciclos');
  }

  if (hasLeadsTable(d)) {
    const leadSql = `
      SELECT TRIM(ejecutivo_asignado) AS nombre, COUNT(DISTINCT id_crm) AS clientes
      FROM crm_leads
      WHERE ejecutivo_asignado IS NOT NULL AND TRIM(ejecutivo_asignado) <> ''
        AND id_crm IS NOT NULL
        ${like ? 'AND ejecutivo_asignado LIKE ?' : ''}
      GROUP BY UPPER(TRIM(ejecutivo_asignado))
    `;
    for (const r of d.prepare(leadSql).all(...(like ? [like] : []))) {
      bump(r.nombre, r.clientes, 'leads');
    }
  }

  if (hasPruebasManejoTable(d)) {
    const pruebaSql = `
      SELECT TRIM(ejecutivo_ventas) AS nombre, COUNT(DISTINCT id_crm) AS clientes
      FROM crm_pruebas_manejo
      WHERE ejecutivo_ventas IS NOT NULL AND TRIM(ejecutivo_ventas) <> ''
        AND id_crm IS NOT NULL
        ${like ? 'AND ejecutivo_ventas LIKE ?' : ''}
      GROUP BY UPPER(TRIM(ejecutivo_ventas))
    `;
    for (const r of d.prepare(pruebaSql).all(...(like ? [like] : []))) {
      bump(r.nombre, r.clientes, 'pruebas');
    }
  }

  if (hasSolicitudesTable(d)) {
    const solSql = `
      SELECT TRIM(asesor) AS nombre, COUNT(DISTINCT id_crm) AS clientes
      FROM crm_solicitudes
      WHERE asesor IS NOT NULL AND TRIM(asesor) <> ''
        AND id_crm IS NOT NULL
        ${like ? 'AND asesor LIKE ?' : ''}
      GROUP BY UPPER(TRIM(asesor))
    `;
    for (const r of d.prepare(solSql).all(...(like ? [like] : []))) {
      bump(r.nombre, r.clientes, 'solicitudes');
    }
  }

  return [...map.values()]
    .map((r) => ({
      vendedor: r.vendedor,
      key: r.key,
      clientes: r.clientes,
      fuentes: [...r.fuentes],
    }))
    .sort((a, b) => b.clientes - a.clientes || a.vendedor.localeCompare(b.vendedor, 'es'))
    .slice(0, max);
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

  // Búsqueda parcial si hay un único match
  const candidates = listVendedores({ q: vendedorRaw, limit: 20 })
    .filter((v) => v.key === key || v.key.includes(key) || key.includes(v.key));
  if (candidates.length === 1) return candidates[0].vendedor;
  if (candidates.length > 1) {
    const exactKey = candidates.find((v) => v.key === key);
    if (exactKey) return exactKey.vendedor;
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
  const nombre = resolveVendedorNombre(d, vendedor);
  const key = normalizeVendedorKey(nombre || vendedor);
  if (!key) throw new Error('Indique un vendedor válido.');

  const max = Math.min(500, Math.max(1, Number(limit) || 300));
  const fi = fechaInicio ? String(fechaInicio) : null;
  const ff = fechaFin ? String(fechaFin) : null;
  if (fi && ff && fi > ff) {
    throw new Error('La fecha inicial no puede ser posterior a la final.');
  }

  const actDate = 'COALESCE(fecha_inicio_ciclo, fecha_factura, fecha_crea_actividad, fecha_entrega)';
  const clientUnions = [];
  const clientParams = [];

  {
    const p = [key];
    const dateSql = vendedorDateClause(actDate, fi, ff, p);
    clientUnions.push(`
      SELECT CAST(id_contacto AS TEXT) AS id_crm
      FROM crm_actividades
      WHERE id_contacto IS NOT NULL
        AND UPPER(TRIM(vendedor)) = ?
        ${dateSql}
    `);
    clientParams.push(...p);
  }

  if (hasLeadsTable(d)) {
    const p = [key];
    const dateSql = vendedorDateClause('fecha_entrada', fi, ff, p);
    clientUnions.push(`
      SELECT CAST(id_crm AS TEXT) AS id_crm
      FROM crm_leads
      WHERE id_crm IS NOT NULL
        AND UPPER(TRIM(ejecutivo_asignado)) = ?
        ${dateSql}
    `);
    clientParams.push(...p);
  }

  if (hasPruebasManejoTable(d)) {
    const p = [key];
    const dateSql = vendedorDateClause('fecha', fi, ff, p);
    clientUnions.push(`
      SELECT CAST(id_crm AS TEXT) AS id_crm
      FROM crm_pruebas_manejo
      WHERE id_crm IS NOT NULL
        AND UPPER(TRIM(ejecutivo_ventas)) = ?
        ${dateSql}
    `);
    clientParams.push(...p);
  }

  if (hasSolicitudesTable(d)) {
    const p = [key];
    const dateSql = vendedorDateClause('fecha_solicitud', fi, ff, p);
    clientUnions.push(`
      SELECT CAST(id_crm AS TEXT) AS id_crm
      FROM crm_solicitudes
      WHERE id_crm IS NOT NULL
        AND UPPER(TRIM(asesor)) = ?
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
      vendedorNombre: nombre || key,
      clientesIds: [],
      fechaInicio: fi,
      fechaFin: ff,
    });
    return {
      vendedor: nombre || key,
      key,
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
 * Embudo BDC sobre crm_actividades (histórico local Balderrama Ciclos).
 * Respaldo cuando Railway no responde; la fuente operativa es crm_ciclos en la nube.
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
  const row = d.prepare(`
    WITH ciclos_periodo AS (
      SELECT *
      FROM crm_actividades
      WHERE substr(COALESCE(fecha_inicio_ciclo, ''), 1, 10) BETWEEN ? AND ?
        AND substr(COALESCE(fecha_inicio_ciclo, ''), 1, 10) GLOB '????-??-??'
    ),
    contactos AS (
      SELECT COUNT(DISTINCT id_contacto) AS total FROM ciclos_periodo
    ),
    citas AS (
      SELECT * FROM ciclos_periodo WHERE UPPER(TRIM(tipo_actividad)) = 'CITA'
    )
    SELECT
      (SELECT total FROM contactos) AS contactos,
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

  const real = {
    contactos: Number(row?.contactos || 0),
    citasAgendadas: Number(row?.citas_agendadas || 0),
    citasConfirmadas: Number(row?.citas_confirmadas || 0),
    citasCumplidas: Number(row?.citas_cumplidas || 0),
    entregasBdc: Number(row?.entregas_bdc || 0),
  };

  return {
    disponible: real.contactos > 0,
    status: real.contactos > 0 ? 'completo' : 'sin-periodo',
    real,
    fuente: 'crm_actividades (local)',
    conversion: {
      citasSobreContactosPct: pctBdc(real.citasAgendadas, real.contactos),
      confirmadasSobreAgendadasPct: pctBdc(real.citasConfirmadas, real.citasAgendadas),
      cumplidasSobreConfirmadasPct: pctBdc(real.citasCumplidas, real.citasConfirmadas),
      entregasSobreCumplidasPct: pctBdc(real.entregasBdc, real.citasCumplidas),
    },
    nota: 'Contactos únicos con ciclo iniciado en el periodo; las etapas posteriores se calculan con sus actividades CRM.',
  };
}

module.exports = {
  isAvailable,
  releaseDb,
  getCrmStats,
  searchContacts,
  getContactHistory,
  getLeadsSummary,
  getLeadsDashboard,
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
  getQuejasCsiSummary,
  getQuejasCsiForPersona,
};
