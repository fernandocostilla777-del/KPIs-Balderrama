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

const DB_PATH = path.join(__dirname, '../../data/crm-ciclos.db');

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
      'Base CRM no encontrada. Ejecute: node backend/scripts/etl-crm-ciclos.js "<ruta al CSV Balderrama Ciclos>"'
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

  return [...byId.values()].slice(0, max);
}

function matchCrmVinToSerie(crmVin, serieSql) {
  const a = normalizeVin(crmVin);
  const b = normalizeVin(serieSql);
  if (!a || !b) return false;
  return a === b || b.endsWith(a) || a.endsWith(b);
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
  });
  if (fechaInicio) params.fechaInicio = fechaInicio;
  if (fechaFin) params.fechaFin = fechaFin;
  const matchSql = (col) => list.map((_, i) => `
    UPPER(LTRIM(RTRIM(${col}))) = @vin${i}
    OR UPPER(LTRIM(RTRIM(${col}))) LIKE @like${i}
  `).join(' OR ');
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
          LTRIM(RTRIM(ISNULL(c.PER_NOMRAZON, '') + ' ' + ISNULL(c.PER_PATERNO, '') + ' ' + ISNULL(c.PER_MATERNO, ''))) AS clienteDms
        FROM ADE_VTAFI v
        INNER JOIN SER_VEHICULO veh
          ON veh.VEH_NUMSERIE = v.VTE_SERIE
          AND veh.VEH_NOINVENTA > 0
        LEFT JOIN PER_PERSONAS c ON c.PER_IDPERSONA = v.VTE_IDCLIENTE
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

    const unidades = list.map((vin) => {
      const facturasVentaSql = ventasRows.filter((r) => matchCrmVinToSerie(vin, r.serie));
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
        });
      }
      const unidad = bySerie.get(serie);
      if (row.orden) unidad.ordenes.add(String(row.orden));
      if (!unidad.modelo && row.modelo) unidad.modelo = row.modelo;
      if (!unidad.anModelo && row.anModelo) unidad.anModelo = row.anModelo;
      const fecha = toIsoDate(row.ingreso || row.cierre);
      if (fecha && (!unidad.primeraVisita || fecha < unidad.primeraVisita)) unidad.primeraVisita = fecha;
      if (fecha && (!unidad.ultimaVisita || fecha > unidad.ultimaVisita)) unidad.ultimaVisita = fecha;
    }

    const series = [...bySerie.keys()];
    let ventas = [];
    if (series.length) {
      const ventaParams = {};
      const placeholders = series.map((serie, i) => {
        ventaParams[`serie${i}`] = serie;
        return `@serie${i}`;
      });
      ventas = await query(`
        SELECT
          UPPER(LTRIM(RTRIM(v.VTE_SERIE))) AS serie,
          LTRIM(RTRIM(v.VTE_DOCTO)) AS factura,
          v.VTE_FECHDOCTO AS fechaFactura,
          v.VTE_IDCLIENTE AS idClienteVenta
        FROM ADE_VTAFI v
        WHERE v.VTE_TIPODOCTO = 'A'
          AND v.VTE_STATUS = 'I'
          AND UPPER(LTRIM(RTRIM(v.VTE_SERIE))) IN (${placeholders.join(', ')})
      `, ventaParams);
    }

    const ventaBySerie = new Map();
    for (const venta of ventas) {
      const serie = normalizeVin(venta.serie);
      if (!serie || ventaBySerie.has(serie)) continue;
      ventaBySerie.set(serie, venta);
    }

    const unidades = [...bySerie.values()]
      .map((unidad) => {
        const venta = ventaBySerie.get(unidad.serie);
        const ordenIds = [...unidad.ordenes];
        return {
          ...unidad,
          ordenes: ordenIds.length,
          ordenIds,
          ventaEnDistribuidor: !!venta,
          facturaVenta: venta?.factura || null,
          fechaFactura: toIsoDate(venta?.fechaFactura),
        };
      })
      .sort((a, b) => String(b.ultimaVisita || '').localeCompare(String(a.ultimaVisita || '')));

    return { unidades, error: null };
  } catch (err) {
    return { unidades: [], error: err.message || String(err) };
  }
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
               estatus, respuesta_financiera, unidad_paquete, fuente, origen,
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
    const fechasAlt = [
      ...leads.map((l) => l.fecha_entrada),
      ...solicitudes.map((s) => s.fecha_solicitud),
      ...pruebasManejo.map((p) => p.fecha),
    ].filter(Boolean).sort();
    return {
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
        realizoPruebaManejo: pruebasManejo.length > 0,
        pruebaManejoConCompra: pruebasManejo.length > 0 && vinsLead.length > 0,
        totalUnidadesDistribuidor: unidadesDms.unidades.length,
        totalOrdenesServicio: ordenesServicio.length,
        importeTaller,
        primeraActividad: fechasAlt[0] || null,
        ultimaActividad: fechasAlt[fechasAlt.length - 1] || null,
      },
      ciclos: [],
      compras: [],
      leads,
      solicitudes,
      pruebasManejo,
      timeline: [],
      unidadesSql: [...(sqlEnrich.unidades || []), ...(sqlAdicional.unidades || [])],
      unidadesDistribuidor: unidadesDms.unidades,
      ordenesServicio,
      periodoOrdenes: { fechaInicio, fechaFin },
      sqlError: sqlEnrich.error || sqlAdicional.error || unidadesDms.error,
    };
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
  }

  return {
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
      realizoPruebaManejo: pruebasManejo.length > 0,
      pruebaManejoConCompra: pruebasManejo.length > 0 && compras.length > 0,
      totalUnidadesDistribuidor: unidadesDms.unidades.length,
      totalOrdenesServicio: ordenesServicio.length,
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
    timeline,
    timelineTruncado: rows.length > maxActividades,
    unidadesSql,
    unidadesDistribuidor: unidadesDms.unidades,
    ordenesServicio,
    periodoOrdenes: { fechaInicio, fechaFin },
    sqlError: sqlEnrich.error || sqlAdicional.error || unidadesDms.error,
  };
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
    case 'trimestre_actual':
      start = new Date(year, Math.floor(month / 3) * 3, 1);
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

  const where = [];
  const params = [];
  if (desde) { where.push('fecha_entrada >= ?'); params.push(String(desde)); }
  if (hasta) { where.push('fecha_entrada <= ?'); params.push(String(hasta)); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

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

  const fillZeros = (record, keys) => {
    for (const key of keys) record[key] = Number(record[key] || 0);
  };
  fillZeros(leads, ['total', 'clientes', 'contactados', 'citas', 'conCompra']);
  fillZeros(solicitudes, ['total', 'clientes', 'aprobadas', 'conCompra']);
  fillZeros(pruebasManejo, ['total', 'clientes', 'conCompra']);
  fillZeros(ciclos, ['total', 'clientes', 'actividades', 'clientesConCompra', 'unidadesConVin']);

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
 * Incluye leads, solicitudes F&I, pruebas de manejo y actividades (ciclos).
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
  const counts = { leads: 0, solicitudes: 0, pruebas: 0, actividades: 0 };

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

module.exports = {
  isAvailable,
  releaseDb,
  getCrmStats,
  searchContacts,
  getContactHistory,
  getLeadsSummary,
  getSeguimiento360Summary,
  resolveCrmPeriod,
  getCierresTallerPeriodo,
  exportCloudSyncRecords,
  enrichByVins,
  getCustomerUnitsDms,
  normalizeVin,
  resolveIdCrmBySerie,
  resolveIdCrmByNombre,
  resolveIdCrmByTelefono,
};
