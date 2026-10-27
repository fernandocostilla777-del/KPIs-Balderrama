/**
 * Tablero de vendedores de la sucursal Cholula.
 * Ventas: facturas DMS con canal CHOLULA.
 * CRM: leads, pruebas, solicitudes, visitas y seguimientos
 * cuya sucursal o fuerza es Cholula.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { getVentasSofiaCore } = require('./ventas');
const { filtrarFilasCanal, PERFILES } = require('../auth/alcanceSucursal');
const {
  getCompraLeadAtribuibleSql,
  getLeadNotDuplicateSql,
} = require('./crmCiclosService');
const { LEAD_VIDA_DIAS } = require('../config/campanasConversion');
const seguimientoStore = require('./seguimientoClientesStore');

const SUCURSAL = PERFILES.cholula;
const DB_PATH = process.env.CRM_SQLITE_PATH || path.join(__dirname, '../../data/crm-ciclos.db');
const CAMPOS = [
  'ventas',
  'ventasAnterior',
  'ventasRetail',
  'ventasFlotilla',
  'leads',
  'contactados',
  'citas',
  'citasAsistidas',
  'cotizaciones',
  'comprasLead',
  'pruebas',
  'solicitudes',
  'solicitudesAprobadas',
  'visitas',
  'seguimientos',
];
const cache = new Map();

function fechaIso(value) {
  const s = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const err = new Error('Fecha invalida. Use formato YYYY-MM-DD.');
    err.status = 400;
    throw err;
  }
  return s;
}

function restarDias(iso, dias) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - dias);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

function ultimoDiaMes(y, m) {
  return new Date(y, m, 0).getDate();
}

/**
 * Periodo anterior comparable: si el periodo son meses completos, los mismos meses justo antes
 * (septiembre → agosto); si no, el mismo número de días inmediatamente antes.
 */
function periodoAnterior(desde, hasta) {
  const [y1, m1, d1] = desde.split('-').map(Number);
  const [y2, m2, d2] = hasta.split('-').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  if (d1 === 1 && d2 === ultimoDiaMes(y2, m2)) {
    const meses = (y2 - y1) * 12 + (m2 - m1) + 1;
    const fin = new Date(y1, m1 - 1, 0);
    const ini = new Date(fin.getFullYear(), fin.getMonth() - meses + 1, 1);
    return {
      fechaInicio: `${ini.getFullYear()}-${pad(ini.getMonth() + 1)}-01`,
      fechaFin: `${fin.getFullYear()}-${pad(fin.getMonth() + 1)}-${pad(fin.getDate())}`,
    };
  }
  const dias = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000) + 1;
  return { fechaInicio: restarDias(desde, dias), fechaFin: restarDias(desde, 1) };
}

function personTokens(v) {
  const s = String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  if (!s || s === 'NULL' || s === 'SIN ASIGNAR') return [];
  return s.split(' ').filter(Boolean).sort();
}

function personTokenKey(v) {
  const tokens = personTokens(v);
  return tokens.length ? tokens.join(' ') : 'sin-asignar';
}

function clavePlana(v) {
  const s = String(v || '').replace(/\s+/g, ' ').trim().toUpperCase();
  return s && s !== 'NULL' ? s : 'SIN ASIGNAR';
}

function mismoNombre(a, b) {
  const ta = personTokens(a);
  const tb = personTokens(b);
  if (!ta.length || !tb.length) return false;
  if (ta.length === tb.length) return ta.every((t, i) => t === tb[i]);
  const [corto, largo] = ta.length < tb.length ? [ta, tb] : [tb, ta];
  if (corto.length < 2) return false;
  const set = new Set(largo);
  return corto.every((t) => set.has(t));
}

const MINUSCULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y']);
/** «ORTEGA SALAS LUIS» → «Ortega Salas Luis»; un nombre ya escrito en mayúsculas y minúsculas se respeta. */
function nombreVisible(nombre) {
  const s = String(nombre || '').replace(/\s+/g, ' ').trim();
  if (!s || s !== s.toUpperCase()) return s;
  return s.toLowerCase().split(' ').map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(' ');
}

function filaBase(nombre) {
  const vendedor = clavePlana(nombre) === 'SIN ASIGNAR'
    ? 'Sin asignar'
    : String(nombre || '').replace(/\s+/g, ' ').trim();
  const row = {
    key: personTokenKey(vendedor),
    vendedor,
    aliases: [clavePlana(nombre)],
  };
  for (const campo of CAMPOS) row[campo] = 0;
  return row;
}

function fusionar(filas) {
  const orden = [...filas].sort(
    (a, b) => personTokens(b.vendedor).length - personTokens(a.vendedor).length,
  );
  const grupos = [];
  for (const fila of orden) {
    const destino = grupos.find((g) => mismoNombre(g.vendedor, fila.vendedor));
    if (!destino) {
      grupos.push({ ...fila, aliases: [...fila.aliases] });
      continue;
    }
    for (const campo of CAMPOS) destino[campo] += Number(fila[campo] || 0);
    destino.aliases.push(...fila.aliases);
    if (personTokens(fila.vendedor).length > personTokens(destino.vendedor).length) {
      destino.vendedor = fila.vendedor;
      destino.key = personTokenKey(fila.vendedor);
    } else if (
      personTokens(fila.vendedor).length === personTokens(destino.vendedor).length
      && destino.vendedor === destino.vendedor.toUpperCase()
      && fila.vendedor !== fila.vendedor.toUpperCase()
    ) {
      // Mismo nombre: se prefiere como lo escribe el CRM (con acentos y minúsculas) al del DMS.
      destino.vendedor = fila.vendedor;
    }
  }
  const usadas = new Set();
  for (const grupo of grupos) {
    grupo.aliases = [...new Set(grupo.aliases.filter(Boolean))];
    let key = grupo.key || 'sin-asignar';
    let n = 2;
    while (usadas.has(key)) {
      key = `${grupo.key}-${n}`;
      n += 1;
    }
    grupo.key = key;
    usadas.add(key);
  }
  for (const grupo of grupos) grupo.vendedor = nombreVisible(grupo.vendedor);
  grupos.sort((a, b) => (
    Number(a.vendedor === 'Sin asignar') - Number(b.vendedor === 'Sin asignar')
    || b.ventas - a.ventas
    || b.leads - a.leads
    || b.pruebas - a.pruebas
    || a.vendedor.localeCompare(b.vendedor, 'es')
  ));
  return grupos;
}

function tomar(mapa, nombre) {
  const clave = clavePlana(nombre);
  if (!mapa.has(clave)) mapa.set(clave, filaBase(nombre));
  return mapa.get(clave);
}

const pct = (num, den) => (Number(den) > 0 ? Math.round((Number(num) / Number(den)) * 1000) / 10 : null);

/** Tasas de cada vendedor (y de la sucursal): mismas definiciones que la pestaña Leads. */
function conTasas(fila) {
  return {
    ...fila,
    pctContacto: pct(fila.contactados, fila.leads),
    pctCita: pct(fila.citas, fila.contactados),
    pctCierreLead: pct(fila.comprasLead, fila.leads),
    pctAprobacion: pct(fila.solicitudesAprobadas, fila.solicitudes),
    variacionVentasPct: Number(fila.ventasAnterior) > 0 ? pct(Number(fila.ventas) - Number(fila.ventasAnterior), fila.ventasAnterior) : null,
  };
}

function sumarTotales(vendedores) {
  const totales = {};
  for (const campo of CAMPOS) totales[campo] = 0;
  for (const fila of vendedores) {
    for (const campo of CAMPOS) totales[campo] += Number(fila[campo] || 0);
  }
  totales.vendedores = vendedores.filter((f) => f.vendedor !== 'Sin asignar').length;
  return totales;
}

function abrirCrm() {
  if (!fs.existsSync(DB_PATH)) {
    const err = new Error('Base CRM no disponible.');
    err.status = 503;
    throw err;
  }
  return new Database(DB_PATH, { readonly: true, fileMustExist: true });
}

function hayTabla(d, nombre) {
  return !!d.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
  ).get(nombre);
}

function predCholula(columnas) {
  const partes = columnas.map((col) => `instr(upper(COALESCE(${col}, '')), 'CHOLULA') > 0`);
  return `(${partes.join(' OR ')})`;
}

function leerCrm(fechaInicio, fechaFin) {
  const d = abrirCrm();
  try {
    const mapa = new Map();
    const desde = fechaIso(fechaInicio);
    const hasta = fechaIso(fechaFin);
    if (desde > hasta) {
      const err = new Error('La fecha inicial no puede ser mayor que la fecha final.');
      err.status = 400;
      throw err;
    }

    if (hayTabla(d, 'crm_leads')) {
      const compra = getCompraLeadAtribuibleSql(LEAD_VIDA_DIAS);
      const noDup = getLeadNotDuplicateSql();
      const filas = d.prepare(`
        SELECT
          TRIM(COALESCE(ejecutivo_asignado, '')) AS nombre,
          COUNT(*) AS leads,
          SUM(CASE WHEN contacto = 'SI' THEN 1 ELSE 0 END) AS contactados,
          SUM(CASE WHEN cita_programada = 'SI' THEN 1 ELSE 0 END) AS citas,
          SUM(CASE WHEN cita_asistida = 'SI' THEN 1 ELSE 0 END) AS citasAsistidas,
          SUM(CASE
            WHEN cotizacion IS NOT NULL AND trim(cotizacion) <> ''
              AND upper(trim(cotizacion)) NOT IN ('NO', 'N', '0')
            THEN 1 ELSE 0 END) AS cotizaciones,
          SUM(${compra}) AS comprasLead
        FROM crm_leads
        WHERE (${noDup})
          AND substr(fecha_entrada, 1, 10) >= ?
          AND substr(fecha_entrada, 1, 10) <= ?
          AND ${predCholula(['sucursal', 'fuerza_ventas'])}
        GROUP BY UPPER(TRIM(COALESCE(ejecutivo_asignado, '')))
      `).all(desde, hasta);
      for (const fila of filas) {
        const dest = tomar(mapa, fila.nombre);
        dest.leads += Number(fila.leads || 0);
        dest.contactados += Number(fila.contactados || 0);
        dest.citas += Number(fila.citas || 0);
        dest.citasAsistidas += Number(fila.citasAsistidas || 0);
        dest.cotizaciones += Number(fila.cotizaciones || 0);
        dest.comprasLead += Number(fila.comprasLead || 0);
      }
    }

    if (hayTabla(d, 'crm_pruebas_manejo')) {
      const filas = d.prepare(`
        SELECT TRIM(COALESCE(ejecutivo_ventas, '')) AS nombre, COUNT(*) AS pruebas
        FROM crm_pruebas_manejo
        WHERE substr(COALESCE(fecha, ''), 1, 10) >= ?
          AND substr(COALESCE(fecha, ''), 1, 10) <= ?
          AND ${predCholula(['centro_trabajo', 'fuerza_venta'])}
        GROUP BY UPPER(TRIM(COALESCE(ejecutivo_ventas, '')))
      `).all(desde, hasta);
      for (const fila of filas) {
        tomar(mapa, fila.nombre).pruebas += Number(fila.pruebas || 0);
      }
    }

    if (hayTabla(d, 'crm_solicitudes')) {
      const filas = d.prepare(`
        SELECT
          TRIM(COALESCE(asesor, '')) AS nombre,
          COUNT(*) AS solicitudes,
          SUM(CASE WHEN upper(COALESCE(estatus, '')) LIKE 'APROBADA%' THEN 1 ELSE 0 END) AS aprobadas
        FROM crm_solicitudes
        WHERE substr(COALESCE(fecha_solicitud, ''), 1, 10) >= ?
          AND substr(COALESCE(fecha_solicitud, ''), 1, 10) <= ?
          AND (
            ${predCholula(['fuerza_venta'])}
            OR id_crm IN (
              SELECT id_crm FROM crm_leads
              WHERE id_crm IS NOT NULL AND trim(id_crm) <> ''
                AND ${predCholula(['sucursal', 'fuerza_ventas'])}
            )
          )
        GROUP BY UPPER(TRIM(COALESCE(asesor, '')))
      `).all(desde, hasta);
      for (const fila of filas) {
        const dest = tomar(mapa, fila.nombre);
        dest.solicitudes += Number(fila.solicitudes || 0);
        dest.solicitudesAprobadas += Number(fila.aprobadas || 0);
      }
    }

    if (hayTabla(d, 'crm_trafico_piso')) {
      const filas = d.prepare(`
        SELECT TRIM(COALESCE(asesor, '')) AS nombre, COUNT(*) AS visitas
        FROM crm_trafico_piso
        WHERE substr(COALESCE(fecha, ''), 1, 10) >= ?
          AND substr(COALESCE(fecha, ''), 1, 10) <= ?
          AND ${predCholula(['centro_trabajo', 'fuerza'])}
        GROUP BY UPPER(TRIM(COALESCE(asesor, '')))
      `).all(desde, hasta);
      for (const fila of filas) {
        tomar(mapa, fila.nombre).visitas += Number(fila.visitas || 0);
      }
    }

    if (hayTabla(d, 'crm_leads') && hayTabla(d, 'crm_actividades')) {
      const ids = d.prepare(`
        SELECT DISTINCT id_crm AS id
        FROM crm_leads
        WHERE id_crm IS NOT NULL AND trim(id_crm) <> ''
          AND substr(fecha_entrada, 1, 10) >= ?
          AND substr(fecha_entrada, 1, 10) <= ?
          AND ${predCholula(['sucursal', 'fuerza_ventas'])}
      `).all(restarDias(desde, 120), hasta).map((r) => String(r.id));
      const fechaAct = `substr(COALESCE(fecha_crea_actividad, fecha_prog_actividad, fecha_resp_actividad, fecha_estatus), 1, 10)`;
      for (let i = 0; i < ids.length; i += 400) {
        const slice = ids.slice(i, i + 400);
        const marcas = slice.map(() => '?').join(',');
        const filas = d.prepare(`
          SELECT TRIM(COALESCE(vendedor, '')) AS nombre, COUNT(*) AS n
          FROM crm_actividades
          WHERE id_contacto IN (${marcas})
            AND ${fechaAct} >= ?
            AND ${fechaAct} <= ?
          GROUP BY UPPER(TRIM(COALESCE(vendedor, '')))
        `).all(...slice, desde, hasta);
        for (const fila of filas) {
          tomar(mapa, fila.nombre).seguimientos += Number(fila.n || 0);
        }
      }
    }

    return mapa;
  } finally {
    d.close();
  }
}

function fechaCorta(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    return `${value.getFullYear()}-${mm}-${dd}`;
  }
  const s = String(value);
  const iso = s.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const lat = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (lat) return `${lat[3]}-${lat[2]}-${lat[1]}`;
  return s.slice(0, 10);
}

async function leerVentas(fechaInicio, fechaFin) {
  try {
    const core = await getVentasSofiaCore({
      fechaInicio,
      fechaFin,
      incluirPorMes: false,
    });
    return {
      filas: filtrarFilasCanal(core.registros, SUCURSAL.canalVenta),
      error: null,
    };
  } catch (err) {
    return { filas: [], error: err.message || 'No se pudieron leer las facturas.' };
  }
}

function aplicarVentas(mapa, filas) {
  for (const fila of filas) {
    const dest = tomar(mapa, fila.VENDEDOR);
    dest.ventas += 1;
    if (String(fila.TIPOVENTA || '').toUpperCase() === 'FLOTILLA') dest.ventasFlotilla += 1;
    else dest.ventasRetail += 1;
  }
}

function notaPeriodo() {
  return 'Solo sucursal Cholula. Las ventas son facturas del canal Cholula. '
    + 'Leads, visitas y seguimientos salen del CRM con sucursal o fuerza Cholula. '
    + 'Las pruebas se cuentan por centro o fuerza Cholula. '
    + 'Las solicitudes entran si su fuerza es Cholula o si el lead ligado es de Cholula. '
    + `Una compra de lead cuenta si la factura cayó dentro de ${LEAD_VIDA_DIAS} días de la entrada. `
    + 'Los seguimientos son actividades del periodo sobre leads de Cholula que entraron en los 120 días previos al cierre. '
    + 'Contacto = contactados ÷ leads; cita = citas ÷ contactados; lead → compra = compras de lead ÷ leads; '
    + 'aprobación = solicitudes aprobadas ÷ solicitudes. El periodo anterior es el mes (o los días) inmediatamente antes.';
}

/** Ventas del periodo anterior de cada vendedor (por los mismos alias y nombres que su fila). */
function aplicarVentasAnteriores(vendedores, filasAnteriores) {
  for (const fila of filasAnteriores) {
    const grupo = vendedores.find((g) => (
      g.aliases.includes(clavePlana(fila.VENDEDOR)) || mismoNombre(g.vendedor, fila.VENDEDOR)
    ));
    if (grupo) grupo.ventasAnterior += 1;
  }
}

async function getMonitoreoCholula({ fechaInicio, fechaFin } = {}) {
  const desde = fechaIso(fechaInicio);
  const hasta = fechaIso(fechaFin);
  const clave = `${desde}|${hasta}`;
  const mapa = leerCrm(desde, hasta);
  const anterior = periodoAnterior(desde, hasta);
  const [ventas, ventasPrevias] = await Promise.all([
    leerVentas(desde, hasta),
    leerVentas(anterior.fechaInicio, anterior.fechaFin),
  ]);
  aplicarVentas(mapa, ventas.filas);
  const grupos = fusionar([...mapa.values()]);
  aplicarVentasAnteriores(grupos, ventasPrevias.filas);
  const vendedores = grupos.map(conTasas);
  const conNombre = vendedores.filter((f) => f.vendedor !== 'Sin asignar');
  const sinAsignar = vendedores.find((f) => f.vendedor === 'Sin asignar') || null;
  const totales = conTasas(sumarTotales(vendedores));
  // Promedio por vendedor (sin «Sin asignar»): referencia para leer cada fila.
  totales.promedioVentas = conNombre.length ? Math.round((totales.ventas / conNombre.length) * 10) / 10 : null;
  totales.promedioLeads = conNombre.length ? Math.round((totales.leads / conNombre.length) * 10) / 10 : null;
  const data = {
    sucursal: SUCURSAL.label,
    canal: SUCURSAL.canalVenta,
    filtros: { fechaInicio: desde, fechaFin: hasta },
    periodoAnterior: anterior,
    totales,
    vendedores,
    sinAsignar: sinAsignar ? {
      leads: sinAsignar.leads,
      visitas: sinAsignar.visitas,
      pruebas: sinAsignar.pruebas,
      solicitudes: sinAsignar.solicitudes,
      ventas: sinAsignar.ventas,
      key: sinAsignar.key,
    } : null,
    ventasError: ventas.error,
    nota: notaPeriodo(),
  };
  cache.set(clave, { at: Date.now(), data, ventas: ventas.filas });
  return data;
}

function filtroAlias(expr, aliases) {
  const reales = (aliases || []).filter((a) => a && a !== 'SIN ASIGNAR');
  const partes = [];
  const params = [];
  if (reales.length) {
    partes.push(`UPPER(TRIM(COALESCE(${expr}, ''))) IN (${reales.map(() => '?').join(',')})`);
    params.push(...reales);
  }
  if ((aliases || []).includes('SIN ASIGNAR')) {
    partes.push(`TRIM(COALESCE(${expr}, '')) = ''`);
  }
  if (!partes.length) return { sql: '0', params: [] };
  return { sql: `(${partes.join(' OR ')})`, params };
}

function acotar(lista, max) {
  return (lista || []).slice(0, max);
}

async function getMonitoreoCholulaDetalle({ fechaInicio, fechaFin, vendedor } = {}) {
  const desde = fechaIso(fechaInicio);
  const hasta = fechaIso(fechaFin);
  const clave = `${desde}|${hasta}`;
  let guardado = cache.get(clave);
  if (!guardado || Date.now() - guardado.at > 120000) {
    await getMonitoreoCholula({ fechaInicio: desde, fechaFin: hasta });
    guardado = cache.get(clave);
  }
  const pedido = String(vendedor || '').trim();
  const grupo = (guardado?.data.vendedores || []).find((fila) => (
    fila.key === pedido || clavePlana(fila.vendedor) === clavePlana(pedido)
  ));
  if (!grupo) {
    const err = new Error('Ese vendedor no tiene actividad de Cholula en el periodo.');
    err.status = 404;
    throw err;
  }

  const ventas = acotar(
    (guardado.ventas || [])
      .filter((fila) => (
        grupo.aliases.includes(clavePlana(fila.VENDEDOR))
        || mismoNombre(grupo.vendedor, fila.VENDEDOR)
      ))
      .map((fila) => ({
        fecha: fechaCorta(fila.VTE_FECHDOCTO),
        factura: fila.VTE_DOCTO || '',
        serie: fila.VTE_SERIE || '',
        cliente: fila.CLIENTE || '',
        modelo: fila.VEH_TIPOAUTO || '',
        tipo: fila.TIPOVENTA || '',
      })),
    200,
  );

  const d = abrirCrm();
  try {
    const leads = [];
    const pruebas = [];
    const solicitudes = [];
    const visitas = [];
    const seguimientos = [];
    if (hayTabla(d, 'crm_leads')) {
      const alias = filtroAlias('ejecutivo_asignado', grupo.aliases);
      const compra = getCompraLeadAtribuibleSql(LEAD_VIDA_DIAS);
      const noDup = getLeadNotDuplicateSql();
      leads.push(...d.prepare(`
        SELECT
          substr(fecha_entrada, 1, 10) AS fecha,
          nombre AS cliente,
          campana,
          auto_interes AS auto,
          contacto,
          cita_programada AS cita,
          cotizacion,
          ${compra} AS compra
        FROM crm_leads
        WHERE (${noDup})
          AND substr(fecha_entrada, 1, 10) >= ?
          AND substr(fecha_entrada, 1, 10) <= ?
          AND ${predCholula(['sucursal', 'fuerza_ventas'])}
          AND ${alias.sql}
        ORDER BY fecha_entrada DESC
        LIMIT 200
      `).all(desde, hasta, ...alias.params));
    }
    if (hayTabla(d, 'crm_pruebas_manejo')) {
      const alias = filtroAlias('ejecutivo_ventas', grupo.aliases);
      pruebas.push(...d.prepare(`
        SELECT
          substr(fecha, 1, 10) AS fecha,
          nombre_cliente AS cliente,
          auto_interes AS auto,
          tipo_auto AS tipo,
          vin
        FROM crm_pruebas_manejo
        WHERE substr(COALESCE(fecha, ''), 1, 10) >= ?
          AND substr(COALESCE(fecha, ''), 1, 10) <= ?
          AND ${predCholula(['centro_trabajo', 'fuerza_venta'])}
          AND ${alias.sql}
        ORDER BY fecha DESC
        LIMIT 200
      `).all(desde, hasta, ...alias.params));
    }
    if (hayTabla(d, 'crm_solicitudes')) {
      const alias = filtroAlias('asesor', grupo.aliases);
      solicitudes.push(...d.prepare(`
        SELECT
          substr(fecha_solicitud, 1, 10) AS fecha,
          nombre_cliente AS cliente,
          estatus,
          financiera,
          unidad_paquete AS unidad,
          no_solicitud AS folio
        FROM crm_solicitudes
        WHERE substr(COALESCE(fecha_solicitud, ''), 1, 10) >= ?
          AND substr(COALESCE(fecha_solicitud, ''), 1, 10) <= ?
          AND (
            ${predCholula(['fuerza_venta'])}
            OR id_crm IN (
              SELECT id_crm FROM crm_leads
              WHERE id_crm IS NOT NULL AND trim(id_crm) <> ''
                AND ${predCholula(['sucursal', 'fuerza_ventas'])}
            )
          )
          AND ${alias.sql}
        ORDER BY fecha_solicitud DESC
        LIMIT 200
      `).all(desde, hasta, ...alias.params));
    }
    if (hayTabla(d, 'crm_trafico_piso')) {
      const alias = filtroAlias('asesor', grupo.aliases);
      visitas.push(...d.prepare(`
        SELECT
          substr(fecha, 1, 10) AS fecha,
          cliente,
          auto_interes AS auto,
          medio,
          forma_contacto AS forma
        FROM crm_trafico_piso
        WHERE substr(COALESCE(fecha, ''), 1, 10) >= ?
          AND substr(COALESCE(fecha, ''), 1, 10) <= ?
          AND ${predCholula(['centro_trabajo', 'fuerza'])}
          AND ${alias.sql}
        ORDER BY fecha DESC
        LIMIT 200
      `).all(desde, hasta, ...alias.params));
    }
    if (hayTabla(d, 'crm_actividades') && hayTabla(d, 'crm_leads')) {
      const alias = filtroAlias('vendedor', grupo.aliases);
      const fechaAct = `substr(COALESCE(fecha_crea_actividad, fecha_prog_actividad, fecha_resp_actividad, fecha_estatus), 1, 10)`;
      seguimientos.push(...d.prepare(`
        SELECT
          ${fechaAct} AS fecha,
          nombre_contacto AS cliente,
          tipo_actividad AS tipo,
          resultado_actividad AS resultado
        FROM crm_actividades
        WHERE ${fechaAct} >= ?
          AND ${fechaAct} <= ?
          AND ${alias.sql}
          AND id_contacto IN (
            SELECT id_crm FROM crm_leads
            WHERE id_crm IS NOT NULL AND trim(id_crm) <> ''
              AND substr(fecha_entrada, 1, 10) >= ?
              AND substr(fecha_entrada, 1, 10) <= ?
              AND ${predCholula(['sucursal', 'fuerza_ventas'])}
          )
        ORDER BY fecha DESC
        LIMIT 80
      `).all(desde, hasta, ...alias.params, restarDias(desde, 120), hasta));
    }

    return {
      sucursal: SUCURSAL.label,
      vendedor: grupo.vendedor,
      key: grupo.key,
      resumen: grupo,
      ventas,
      leads,
      pruebas,
      solicitudes,
      visitas,
      seguimientos,
    };
  } finally {
    d.close();
  }
}

// ── Cartera de clientes: seguimiento uno a uno ─────────────────────────────

/** Días sin seguimiento a partir de los cuales un cliente activo se marca. */
const DIAS_SIN_SEGUIMIENTO = 7;
/** Actividad reciente que cuenta para sugerir «En seguimiento». */
const DIAS_ACTIVIDAD_RECIENTE = 15;
const ORDEN_ETIQUETA = { caliente: 0, seguimiento: 1, frio: 2, no_compra: 3, compro: 4 };

function diasEntre(desdeIso, hastaIso) {
  if (!desdeIso || !hastaIso) return null;
  const [y1, m1, d1] = desdeIso.split('-').map(Number);
  const [y2, m2, d2] = hastaIso.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

function esSi(v) {
  return String(v || '').trim().toUpperCase() === 'SI';
}

function tieneCotizacion(v) {
  const s = String(v || '').trim().toUpperCase();
  return !!s && !['NO', 'N', '0'].includes(s);
}

/**
 * Etiqueta que se propone cuando nadie la ha puesto. Solo orienta: no se guarda.
 * Compró sale del CRM y manda sobre cualquier etiqueta.
 */
function etiquetaSugerida({ compra, citaAsistida, cotizacion, contacto, diasSinSeguimiento }) {
  if (compra) return 'compro';
  if (citaAsistida || cotizacion) return 'caliente';
  if (diasSinSeguimiento != null && diasSinSeguimiento <= DIAS_ACTIVIDAD_RECIENTE) return 'seguimiento';
  if (contacto && diasSinSeguimiento == null) return 'seguimiento';
  return 'frio';
}

function grupoDeEjecutivo(grupos, nombre) {
  const plano = clavePlana(nombre);
  if (!plano) return null;
  return grupos.find((g) => g.aliases.includes(plano) || mismoNombre(g.vendedor, nombre)) || null;
}

async function gruposDelPeriodo(fechaInicio, fechaFin) {
  if (!fechaInicio) return [];
  try {
    const data = await getMonitoreoCholula({ fechaInicio, fechaFin });
    return data.vendedores || [];
  } catch {
    return [];
  }
}

/**
 * Leads de Cholula que siguen dentro de su vida (LEAD_VIDA_DIAS) al cierre del periodo,
 * con sus pasos en el CRM, el último seguimiento y la etiqueta del equipo.
 */
async function getCarteraCholula({ fechaInicio, fechaFin } = {}) {
  const hasta = fechaIso(fechaFin);
  const desdeVida = restarDias(hasta, LEAD_VIDA_DIAS - 1);
  const grupos = await gruposDelPeriodo(fechaInicio ? fechaIso(fechaInicio) : null, hasta);

  const d = abrirCrm();
  let filas = [];
  const ultimos = new Map();
  try {
    if (hayTabla(d, 'crm_leads')) {
      const compra = getCompraLeadAtribuibleSql(LEAD_VIDA_DIAS);
      const noDup = getLeadNotDuplicateSql();
      const filtro = `
        (${noDup})
        AND id_crm IS NOT NULL AND trim(CAST(id_crm AS TEXT)) <> ''
        AND substr(fecha_entrada, 1, 10) >= ?
        AND substr(fecha_entrada, 1, 10) <= ?
        AND ${predCholula(['sucursal', 'fuerza_ventas'])}`;
      filas = d.prepare(`
        SELECT
          trim(CAST(id_crm AS TEXT)) AS idCrm,
          nombre AS cliente,
          telefono,
          campana,
          auto_interes AS auto,
          substr(fecha_entrada, 1, 10) AS fecha,
          TRIM(COALESCE(ejecutivo_asignado, '')) AS ejecutivo,
          contacto,
          cita_programada AS cita,
          cita_asistida AS asistio,
          cotizacion,
          ${compra} AS compra
        FROM crm_leads
        WHERE ${filtro}
        ORDER BY fecha_entrada DESC
      `).all(desdeVida, hasta);

      if (hayTabla(d, 'crm_actividades')) {
        const fechaAct = `substr(COALESCE(fecha_resp_actividad, fecha_crea_actividad, fecha_prog_actividad, fecha_estatus), 1, 10)`;
        const acts = d.prepare(`
          SELECT trim(CAST(id_contacto AS TEXT)) AS idCrm, MAX(${fechaAct}) AS ultima, COUNT(*) AS n
          FROM crm_actividades
          WHERE ${fechaAct} <= ?
            AND trim(CAST(id_contacto AS TEXT)) IN (
              SELECT trim(CAST(id_crm AS TEXT)) FROM crm_leads WHERE ${filtro}
            )
          GROUP BY trim(CAST(id_contacto AS TEXT))
        `).all(hasta, desdeVida, hasta);
        for (const a of acts) ultimos.set(a.idCrm, { ultima: a.ultima || null, n: Number(a.n || 0) });
      }
    }
  } finally {
    d.close();
  }

  // Un cliente por id_crm (el registro más reciente).
  const vistos = new Set();
  filas = filas.filter((f) => (vistos.has(f.idCrm) ? false : vistos.add(f.idCrm)));

  const guardadas = seguimientoStore.leerEtiquetas(filas.map((f) => f.idCrm));
  const clientes = filas.map((f) => {
    const act = ultimos.get(f.idCrm) || null;
    const ultimoSeguimiento = act?.ultima || null;
    const diasSinSeguimiento = ultimoSeguimiento ? Math.max(0, diasEntre(ultimoSeguimiento, hasta)) : null;
    const pasos = {
      contacto: esSi(f.contacto),
      cita: esSi(f.cita),
      asistio: esSi(f.asistio),
      cotizacion: tieneCotizacion(f.cotizacion),
      compra: Number(f.compra) > 0,
    };
    const guardada = guardadas[f.idCrm] || null;
    let etiqueta;
    if (pasos.compra) {
      etiqueta = { clave: 'compro', origen: 'crm' };
    } else if (guardada?.etiqueta) {
      etiqueta = {
        clave: guardada.etiqueta,
        origen: 'equipo',
        motivo: guardada.motivo || null,
        motivoLabel: guardada.motivo ? seguimientoStore.MOTIVOS_NO_COMPRA[guardada.motivo] || guardada.motivo : null,
        nota: guardada.nota || null,
        autor: guardada.autor || null,
        actualizado: guardada.actualizado || null,
      };
    } else {
      etiqueta = {
        clave: etiquetaSugerida({
          compra: false,
          citaAsistida: pasos.asistio,
          cotizacion: pasos.cotizacion,
          contacto: pasos.contacto,
          diasSinSeguimiento,
        }),
        origen: 'sugerida',
      };
    }
    const activo = etiqueta.clave === 'caliente' || etiqueta.clave === 'seguimiento';
    const diasVida = diasEntre(f.fecha, hasta);
    const grupo = grupoDeEjecutivo(grupos, f.ejecutivo);
    return {
      idCrm: f.idCrm,
      cliente: nombreVisible(f.cliente) || 'Sin nombre',
      telefono: f.telefono || '',
      vendedor: grupo ? grupo.vendedor : (f.ejecutivo ? nombreVisible(f.ejecutivo) : 'Sin asignar'),
      vendedorKey: grupo ? grupo.key : personTokenKey(f.ejecutivo || 'Sin asignar'),
      campana: f.campana || '',
      auto: f.auto || '',
      fechaEntrada: f.fecha,
      diasVida,
      diasRestantes: Math.max(0, LEAD_VIDA_DIAS - 1 - diasVida),
      ultimoSeguimiento,
      diasSinSeguimiento,
      seguimientos: act?.n || 0,
      pasos,
      etiqueta,
      historial: (guardada?.historial || []).slice(0, 5).map((h) => ({
        ...h,
        motivoLabel: h.motivo ? seguimientoStore.MOTIVOS_NO_COMPRA[h.motivo] || h.motivo : null,
      })),
      alertaSeguimiento: activo && (diasSinSeguimiento == null || diasSinSeguimiento > DIAS_SIN_SEGUIMIENTO),
    };
  });

  clientes.sort((a, b) => (
    (ORDEN_ETIQUETA[a.etiqueta.clave] - ORDEN_ETIQUETA[b.etiqueta.clave])
    || (Number(b.alertaSeguimiento) - Number(a.alertaSeguimiento))
    || String(b.fechaEntrada).localeCompare(String(a.fechaEntrada))
  ));

  const resumen = { total: clientes.length, sinEtiqueta: 0, alertas: 0 };
  for (const clave of Object.keys(seguimientoStore.ETIQUETAS)) resumen[clave] = 0;
  for (const c of clientes) {
    resumen[c.etiqueta.clave] += 1;
    if (c.etiqueta.origen === 'sugerida') resumen.sinEtiqueta += 1;
    if (c.alertaSeguimiento) resumen.alertas += 1;
  }

  return {
    sucursal: SUCURSAL.label,
    fechaCorte: hasta,
    desdeVida,
    vidaDias: LEAD_VIDA_DIAS,
    diasSinSeguimiento: DIAS_SIN_SEGUIMIENTO,
    etiquetas: Object.entries(seguimientoStore.ETIQUETAS).map(([clave, e]) => ({
      clave,
      ...e,
      manual: seguimientoStore.ETIQUETAS_MANUALES.includes(clave),
    })),
    motivos: Object.entries(seguimientoStore.MOTIVOS_NO_COMPRA).map(([clave, label]) => ({ clave, label })),
    resumen,
    clientes,
    nota: `Clientes que entraron como lead de Cholula en los últimos ${LEAD_VIDA_DIAS} días al ${hasta}. `
      + '«Compró» se pone solo cuando el CRM registra la compra. Sin etiqueta del equipo se muestra una sugerida: '
      + 'caliente si asistió a cita o cotizó; en seguimiento si tuvo actividad en los últimos '
      + `${DIAS_ACTIVIDAD_RECIENTE} días; frío en otro caso. Se marca a los clientes calientes o en seguimiento `
      + `con más de ${DIAS_SIN_SEGUIMIENTO} días sin seguimiento registrado.`,
  };
}

/** Guarda la etiqueta de un cliente, solo si es un lead de Cholula. */
function etiquetarClienteCholula(idCrm, { etiqueta, motivo, nota, autor } = {}) {
  const key = String(idCrm || '').trim();
  const d = abrirCrm();
  let existe = null;
  try {
    existe = hayTabla(d, 'crm_leads')
      ? d.prepare(`
          SELECT 1 AS ok FROM crm_leads
          WHERE trim(CAST(id_crm AS TEXT)) = ?
            AND ${predCholula(['sucursal', 'fuerza_ventas'])}
          LIMIT 1
        `).get(key)
      : null;
  } finally {
    d.close();
  }
  if (!existe) {
    const err = new Error('Ese cliente no es un lead de Cholula.');
    err.status = 404;
    throw err;
  }
  const guardado = seguimientoStore.etiquetar(key, { etiqueta, motivo, nota, autor });
  return { idCrm: key, etiqueta: guardado };
}

module.exports = {
  getMonitoreoCholula,
  getMonitoreoCholulaDetalle,
  getCarteraCholula,
  etiquetarClienteCholula,
  etiquetaSugerida,
  fusionar,
  nombreVisible,
  periodoAnterior,
  conTasas,
  personTokenKey,
  mismoNombre,
};
