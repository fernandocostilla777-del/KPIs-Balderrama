const { loadOrders, loadOpenSnapshot, loadOrderDetail, loadMesCursoNomenclatura } = require('./postSalesLoad');
const { AREA_LETRAS, filterRecords, countByLetter, resolveNomenclatura } = require('./postSalesOrderTypes');

function toIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Acumulado del año calendario de la fecha fin (o año actual). */
function ytdRange(fechaFin) {
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const year = fechaFin && /^\d{4}/.test(String(fechaFin))
    ? Number(String(fechaFin).slice(0, 4))
    : now.getFullYear();
  const fechaInicio = `${year}-01-01`;
  let fechaFinYtd;
  if (year < now.getFullYear()) {
    fechaFinYtd = `${year}-12-31`;
  } else if (year > now.getFullYear()) {
    fechaFinYtd = `${year}-12-31`;
  } else {
    fechaFinYtd = toIsoDate(now);
  }
  return { fechaInicio, fechaFin: fechaFinYtd, year };
}

function sameRange(aInicio, aFin, bInicio, bFin) {
  return String(aInicio || '') === String(bInicio || '')
    && String(aFin || '') === String(bFin || '');
}

function normalizeArea(area) {
  const key = String(area || 'posventa').trim().toLowerCase();
  if (key === 'hyp' || key === 'h&p' || key === 'hojalateria' || key === 'hojalatería') return 'hyp';
  if (key === 'servicio' || key === 'taller') return 'servicio';
  if (key === 'todas' || key === 'all') return 'posventa';
  return key || 'posventa';
}

function normalizeEstatus(estatus) {
  const key = String(estatus || 'todas').trim().toLowerCase();
  if (['abierta', 'abiertas', 'open', 'activas', 'activa'].includes(key)) return 'abiertas';
  if (['facturada', 'facturadas'].includes(key)) return 'facturadas';
  if (['cancelada', 'canceladas'].includes(key)) return 'canceladas';
  if (!key || key === 'todas' || key === 'all') return 'todas';
  return key;
}

function sumImporte(rows, field = 'importe') {
  return rows.reduce((acc, r) => acc + Number(r[field] || r.importe || 0), 0);
}

/**
 * Resumen compacto para el asistente IA.
 * area: servicio | hyp | posventa
 * estatus: abiertas | facturadas | canceladas | todas
 */
function summarizePostSales(raw, { area = 'posventa', estatus = 'todas', tipo = null } = {}) {
  const areaKey = normalizeArea(area);
  const estatusKey = normalizeEstatus(estatus);
  const tipoKey = tipo || null;
  const nomen = resolveNomenclatura(tipoKey);
  const openBase = filterRecords(raw.openSnapshot || [], { area: areaKey, estatus: 'abiertas', tipo: tipoKey });
  // “Abiertas” sin periodo (o pidiendo snapshot) → backlog actual; con periodo → abiertas del periodo
  const useOpenSnap = estatusKey === 'abiertas' && (!raw.filtros?.fechaInicio || !raw.filtros?.fechaFin || raw.useOpenSnapshot);
  const records = useOpenSnap
    ? openBase
    : filterRecords(raw.records || [], { area: areaKey, estatus: estatusKey, tipo: tipoKey });
  const openInPeriod = filterRecords(raw.records || [], { area: areaKey, estatus: 'abiertas', tipo: tipoKey });
  const factInPeriod = filterRecords(raw.records || [], { area: areaKey, estatus: 'facturadas', tipo: tipoKey });

  const openSnapArea = openBase;
  const { fechaInicio, fechaFin } = raw.filtros || {};
  const openSnapInPeriod = openSnapArea.filter((r) => {
    const d = String(r.ingresoDate || r.ingreso || '').slice(0, 10);
    if (!fechaInicio || !fechaFin) return true;
    return d >= fechaInicio && d <= fechaFin;
  });

  const filtradas = records;

  const porAsesorMap = new Map();
  for (const r of filtradas) {
    const name = String(r.asesor || 'Sin asesor').trim() || 'Sin asesor';
    const cur = porAsesorMap.get(name) || { asesor: name, ordenes: 0, abiertas: 0, facturadas: 0, importe: 0 };
    cur.ordenes += 1;
    const st = String(r.status || '').toUpperCase();
    if (['A', 'T', 'D', 'P'].includes(st)) cur.abiertas += 1;
    if (st === 'I') cur.facturadas += 1;
    cur.importe += Number(r.importeAbierto || r.importeFacturado || r.importe || 0);
    porAsesorMap.set(name, cur);
  }
  const porAsesor = [...porAsesorMap.values()]
    .map((a) => ({ ...a, importe: Math.round(a.importe * 100) / 100 }))
    .sort((a, b) => b.ordenes - a.ordenes)
    .slice(0, 15);

  const porEstatusMap = new Map();
  for (const r of filtradas) {
    const label = r.statusLabel || r.status || 'Sin estatus';
    const cur = porEstatusMap.get(label) || { estatus: label, ordenes: 0, importe: 0 };
    cur.ordenes += 1;
    cur.importe += Number(r.importeAbierto || r.importeFacturado || r.importe || 0);
    porEstatusMap.set(label, cur);
  }
  const porEstatus = [...porEstatusMap.values()]
    .map((e) => ({ ...e, importe: Math.round(e.importe * 100) / 100 }))
    .sort((a, b) => b.ordenes - a.ordenes);

  return {
    filtros: {
      fechaInicio,
      fechaFin,
      area: areaKey,
      estatus: estatusKey,
      tipo: nomen?.id || tipoKey || 'todas',
      nomenclatura: nomen
        ? { id: nomen.id, label: nomen.label, letras: nomen.letras }
        : null,
      letrasArea: AREA_LETRAS[areaKey] || null,
    },
    fuente: 'SER_ORDEN',
    interpretacion: {
      area:
        areaKey === 'hyp'
          ? 'HyP (hojalatería y pintura): folios A, F, H, J, V, Z, Ó'
          : areaKey === 'servicio'
            ? 'Servicio: folios C, D, G, I, K, N, O, Q, S, X, Y, Á, M, E, R'
            : 'PostVenta completa (Servicio + HyP)',
      tipo: nomen
        ? `${nomen.label}: letras ${nomen.letras.join(', ')}`
        : 'Todas las nomenclaturas del área',
      estatus:
        estatusKey === 'abiertas'
          ? (useOpenSnap
            ? 'Órdenes abiertas actuales (snapshot A/T/D/P)'
            : 'Órdenes abiertas del periodo (estatus A/T/D/P)')
          : estatusKey === 'facturadas'
            ? 'Órdenes facturadas (estatus I)'
            : estatusKey === 'canceladas'
              ? 'Órdenes canceladas (estatus C)'
              : 'Todos los estatus del periodo',
      notaAbiertasPeriodo:
        'Para “abiertas del año X” usa resumen.totalFiltrado (con estatus=abiertas) '
        + 'o resumen.abiertasEnPeriodo. No uses openTotal global sin filtrar área.',
    },
    resumen: {
      totalFiltrado: filtradas.length,
      ingresadasAreaPeriodo: filterRecords(raw.records || [], { area: areaKey, estatus: 'todas', tipo: tipoKey }).length,
      abiertasEnPeriodo: openInPeriod.length,
      facturadasEnPeriodo: factInPeriod.length,
      abiertasActualesDelArea: openSnapArea.length,
      abiertasActualesDelPeriodo: openSnapInPeriod.length,
      importeFiltrado: Math.round(sumImporte(filtradas) * 100) / 100,
      importeAbierto: Math.round(sumImporte(useOpenSnap ? filtradas : openInPeriod, 'importeAbierto') * 100) / 100,
      importeFacturado: Math.round(sumImporte(factInPeriod, 'importeFacturado') * 100) / 100,
      pctFacturado: filtradas.length
        ? Math.round((factInPeriod.length / filtradas.length) * 10000) / 100
        : 0,
    },
    porLetra: countByLetter(filtradas),
    porAsesor,
    porEstatus,
    muestra: filtradas.slice(0, 15).map((r) => ({
      orden: r.orden,
      letra: r.letraOrden || String(r.orden || '').charAt(0),
      status: r.status,
      statusLabel: r.statusLabel,
      cliente: r.nombre,
      asesor: r.asesor,
      ingreso: r.ingreso || r.ingresoDate,
      importe: r.importeAbierto || r.importeFacturado || r.importe || 0,
    })),
    advertencia: areaKey === 'hyp'
      ? 'NO reportes totales de Servicio ni openTotal global; responde solo con cifras del área HyP.'
      : areaKey === 'servicio'
        ? 'NO reportes totales de HyP ni openTotal global; responde solo con cifras del área Servicio.'
        : null,
  };
}

async function getPostSales({ fechaInicio, fechaFin, area, estatus, tipo } = {}) {
  const estatusKey = normalizeEstatus(estatus);
  const areaKey = normalizeArea(area);
  const wantsOpenSnap = estatusKey === 'abiertas' && (!fechaInicio || !fechaFin);

  if (wantsOpenSnap) {
    const openSnapshot = await loadOpenSnapshot();
    const raw = {
      filtros: { fechaInicio: null, fechaFin: null },
      fuente: 'SER_ORDEN',
      records: [],
      recordsYtd: [],
      openSnapshot,
      useOpenSnapshot: true,
      total: 0,
      openTotal: openSnapshot.length,
    };
    return summarizePostSales(raw, { area: areaKey, estatus: 'abiertas', tipo });
  }

  if (!fechaInicio || !fechaFin) {
    const ytd = ytdRange(fechaFin);
    fechaInicio = fechaInicio || ytd.fechaInicio;
    fechaFin = fechaFin || ytd.fechaFin;
  }

  const ytd = ytdRange(fechaFin);
  const periodIsYtd = sameRange(fechaInicio, fechaFin, ytd.fechaInicio, ytd.fechaFin);

  const [records, openSnapshot, mesCursoResult, recordsYtdRaw] = await Promise.all([
    loadOrders({ fechaInicio, fechaFin }),
    loadOpenSnapshot(),
    loadMesCursoNomenclatura().catch((err) => {
      console.error('[post-sales] mesCursoNomenclatura:', err.message);
      return null;
    }),
    periodIsYtd ? Promise.resolve(null) : loadOrders({
      fechaInicio: ytd.fechaInicio,
      fechaFin: ytd.fechaFin,
    }),
  ]);

  const recordsYtd = periodIsYtd ? records : (recordsYtdRaw || []);
  const raw = {
    filtros: { fechaInicio, fechaFin },
    fuente: 'SER_ORDEN',
    records,
    recordsYtd,
    ytd: {
      fechaInicio: ytd.fechaInicio,
      fechaFin: ytd.fechaFin,
      year: ytd.year,
    },
    openSnapshot,
    mesCursoNomenclatura: mesCursoResult,
    total: records.length,
    openTotal: openSnapshot.length,
  };

  // Asistente IA: siempre devolver resumen compacto filtrable por área/estatus/tipo.
  if (area || estatus || tipo) {
    return summarizePostSales(raw, { area: areaKey, estatus: estatusKey, tipo });
  }

  return raw;
}

async function getPostSalesOrderDetail(ordenId) {
  return loadOrderDetail(ordenId);
}

module.exports = { getPostSales, getPostSalesOrderDetail, summarizePostSales };
