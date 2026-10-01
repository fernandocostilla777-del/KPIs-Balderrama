/**
 * Seguimiento 360 en nube (Railway).
 * Resume KPIs sincronizados + expediente ligero desde crm_ciclos (sin DMS).
 */
const { listCrm, getCrmSummary } = require('./crmCiclosCloudService');
const { getSeguimientoSummary } = require('./mobileData');

function normalizeVin(v) {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase();
  if (!s || s === 'NULL' || /^0+$/.test(s) || s.length < 5) return null;
  return s;
}

function activityDate(row) {
  return row.fechaRespActividad
    || row.fechaProgActividad
    || row.fechaCreaActividad
    || row.fechaInicioCiclo
    || null;
}

function buildCliente360FromCiclos(idContacto, rows) {
  const ciclosMap = new Map();
  const comprasMap = new Map();
  const timeline = [];

  for (const r of rows) {
    if (r.idCiclo && !ciclosMap.has(r.idCiclo)) {
      ciclosMap.set(r.idCiclo, {
        idCiclo: r.idCiclo,
        fechaInicio: r.fechaInicioCiclo || null,
        fechaEsperadaCierre: r.fechaEsperadaCierre || null,
        estatus: r.estatus || null,
        fechaEstatus: r.fechaEstatus || null,
        formaContacto: r.formaContacto || null,
        medio: r.medioContacto || null,
        submedio: r.submedioContacto || null,
        actividades: 0,
        vin: null,
      });
    }
    if (r.idCiclo) {
      const ciclo = ciclosMap.get(r.idCiclo);
      ciclo.actividades += 1;
      const vinCiclo = normalizeVin(r.vin);
      if (vinCiclo && !ciclo.vin) ciclo.vin = vinCiclo;
    }

    const vin = normalizeVin(r.vin);
    if (vin) {
      if (!comprasMap.has(vin)) {
        comprasMap.set(vin, {
          vin,
          numFactura: r.numFactura || null,
          facturadoA: r.facturadoA || null,
          producto: r.productoVendido || null,
          fechaFactura: r.fechaFactura || null,
          fechaEntrega: r.fechaEntrega || null,
          vendedor: r.vendedor || null,
          idCiclo: r.idCiclo || null,
        });
      } else {
        const c = comprasMap.get(vin);
        if (!c.numFactura && r.numFactura) c.numFactura = r.numFactura;
        if (!c.producto && r.productoVendido) c.producto = r.productoVendido;
        if (!c.fechaFactura && r.fechaFactura) c.fechaFactura = r.fechaFactura;
        if (!c.fechaEntrega && r.fechaEntrega) c.fechaEntrega = r.fechaEntrega;
        if (!c.vendedor && r.vendedor) c.vendedor = r.vendedor;
      }
    }

    timeline.push({
      fecha: activityDate(r),
      idCiclo: r.idCiclo || null,
      tipo: r.tipoActividad || null,
      resultado: r.resultadoActividad || null,
      fechaProgramada: r.fechaProgActividad || null,
      fechaRespuesta: r.fechaRespActividad || null,
      estatusCiclo: r.estatus || null,
      vin: normalizeVin(r.vin),
    });
  }

  const ciclos = [...ciclosMap.values()].sort((a, b) =>
    String(a.fechaInicio || '').localeCompare(String(b.fechaInicio || '')));
  const compras = [...comprasMap.values()].sort((a, b) =>
    String(a.fechaFactura || '').localeCompare(String(b.fechaFactura || '')));
  const fechas = timeline.map((t) => t.fecha).filter(Boolean).sort();
  const last = rows[rows.length - 1] || {};

  const timeline360 = timeline
    .filter((t) => t.fecha)
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
    .map((t) => ({
      fecha: t.fecha,
      categoria: 'comercial',
      titulo: t.tipo || 'Contacto comercial',
      detalle: [t.resultado, t.estatusCiclo].filter(Boolean).join(' · ') || null,
      vin: t.vin,
    }));

  return {
    idContacto: String(idContacto),
    encontrado: rows.length > 0,
    nombre: last.nombreContacto || null,
    telefono: null,
    correo: null,
    vendedor: last.vendedor || null,
    resumen: {
      totalActividades: rows.length,
      totalCiclos: ciclos.length,
      totalCompras: compras.length,
      totalLeads: 0,
      totalSolicitudes: 0,
      totalPruebasManejo: 0,
      totalContratosFinanciamiento: 0,
      totalPvas: 0,
      totalUnidadesDistribuidor: 0,
      totalOrdenesServicio: 0,
      totalQuejas: 0,
      importeTaller: null,
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
    leads: [],
    solicitudes: [],
    pruebasManejo: [],
    contratosFinanciamiento: [],
    timeline,
    timeline360,
    ficha360: {
      disponible: true,
      fuente: 'crm_ciclos (Railway)',
      nota: 'Expediente ligero en nube. Taller, financiamiento DMS y CSI solo están en el backend de oficina.',
      compras: compras.length,
      ciclos: ciclos.length,
      actividades: rows.length,
      vins: compras.map((c) => c.vin),
    },
    unidadesSql: [],
    unidadesDistribuidor: [],
    ordenesServicio: [],
    sqlError: null,
    limitacionesNube: [
      'Sin enriquecimiento SQL Server (taller, unidades DMS, CSI).',
      'Sin leads / solicitudes / pruebas locales (solo ciclos sincronizados).',
    ],
  };
}

async function getResumen({ periodo, fechaInicio, fechaFin } = {}) {
  const period = periodo
    || (fechaInicio && fechaFin ? String(fechaInicio).slice(0, 7) : null);
  const summary = await getSeguimientoSummary(period);
  const crm = await getCrmSummary().catch(() => null);
  return {
    ...summary,
    crmCiclos: crm,
  };
}

async function buscarContactos({ q, limit = 25 } = {}) {
  const query = String(q || '').trim();
  if (!query) {
    const err = new Error('Parámetro requerido: q (ID CRM, nombre o VIN).');
    err.status = 400;
    throw err;
  }
  const rows = await listCrm({
    q: query,
    limit: Math.min(Number(limit) || 25, 100),
  });

  const byContact = new Map();
  for (const row of rows) {
    const id = String(row.idContacto || '').trim();
    if (!id) continue;
    if (!byContact.has(id)) {
      byContact.set(id, {
        idContacto: id,
        nombre: row.nombreContacto || null,
        vendedor: row.vendedor || null,
        actividades: 0,
        vins: new Set(),
        ultimaActividad: null,
      });
    }
    const item = byContact.get(id);
    item.actividades += 1;
    const vin = normalizeVin(row.vin);
    if (vin) item.vins.add(vin);
    const fecha = activityDate(row);
    if (fecha && (!item.ultimaActividad || String(fecha) > String(item.ultimaActividad))) {
      item.ultimaActividad = fecha;
      if (row.vendedor) item.vendedor = row.vendedor;
    }
  }

  return [...byContact.values()].map((item) => ({
    idContacto: item.idContacto,
    nombre: item.nombre,
    vendedor: item.vendedor,
    actividades: item.actividades,
    vins: [...item.vins],
    ultimaActividad: item.ultimaActividad,
  }));
}

async function getCliente360(idContacto, { limit = 2000 } = {}) {
  const id = String(idContacto || '').trim();
  if (!id) {
    const err = new Error('idContacto requerido.');
    err.status = 400;
    throw err;
  }
  const rows = await listCrm({
    idContacto: id,
    limit: Math.min(Number(limit) || 2000, 5000),
  });
  if (!rows.length) {
    return {
      idContacto: id,
      encontrado: false,
      limitacionesNube: [
        'Sin actividades en crm_ciclos para este contacto.',
      ],
    };
  }
  return buildCliente360FromCiclos(id, rows);
}

module.exports = {
  getResumen,
  buscarContactos,
  getCliente360,
};
