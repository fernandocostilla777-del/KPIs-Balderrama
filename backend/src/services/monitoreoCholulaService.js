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
/** Equipo que sí entra en Vendedores Cholula. El orden de los nombres no importa. */
const EQUIPO_CHOLULA = [
  'JUNCO CASTAÑEDA MAX JALIL',
  'JIMENEZ GONZALEZ CARLOS',
  'ALVARADO MARTINEZ VERONICA',
  'BOLIVAR OLAIZ SIMON',
  'BARDESI ZAMORA EDUARDO',
  'VAZQUEZ LOPEZ JENNIFER',
  'REYES AGUILAR LAURA VIVIANA',
  'TELLEZ FLORES ADRIANA',
  'ARENAS GARZON FREDY',
];
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

function esVendedorEquipo(nombre) {
  return EQUIPO_CHOLULA.some((oficial) => mismoNombre(oficial, nombre));
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

function abrirCrm(ruta) {
  const archivo = ruta || DB_PATH;
  if (!fs.existsSync(archivo)) {
    const err = new Error('Base CRM no disponible.');
    err.status = 503;
    throw err;
  }
  return new Database(archivo, { readonly: true, fileMustExist: true });
}

/**
 * ¿Existe la tabla? También cuenta una vista: en el escritorio, la caché del CRM que baja de la
 * nube deja crm_actividades como vista sobre crm_ciclos_live.
 */
function hayTabla(d, nombre) {
  return !!d.prepare(
    `SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?`,
  ).get(nombre);
}

function predCholula(columnas) {
  const partes = columnas.map((col) => `instr(upper(COALESCE(${col}, '')), 'CHOLULA') > 0`);
  return `(${partes.join(' OR ')})`;
}

/** Misma regla que Afluencia: solo NUEVOS y reconciliación que contiene Fresh (Fresh up). */
function sqlFreshUpNuevos() {
  const comentarios = `REPLACE(REPLACE(REPLACE(REPLACE(UPPER(COALESCE(comentarios, '')), ' ', ''), '-', ''), '_', ''), '.', '')`;
  const reconciliacion = `REPLACE(REPLACE(UPPER(COALESCE(reconciliacion, '')), '_', ' '), '-', ' ')`;
  return `(${comentarios} IN ('NUEVOS', 'NUVOS') AND INSTR(${reconciliacion}, 'FRESH') > 0)`;
}

function puedeFreshUp(d) {
  return columnaExiste(d, 'crm_trafico_piso', 'comentarios')
    && columnaExiste(d, 'crm_trafico_piso', 'reconciliacion');
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

    if (hayTabla(d, 'crm_trafico_piso') && puedeFreshUp(d)) {
      const filas = d.prepare(`
        SELECT TRIM(COALESCE(asesor, '')) AS nombre, COUNT(*) AS visitas
        FROM crm_trafico_piso
        WHERE substr(COALESCE(fecha, ''), 1, 10) >= ?
          AND substr(COALESCE(fecha, ''), 1, 10) <= ?
          AND ${predCholula(['centro_trabajo', 'fuerza'])}
          AND ${sqlFreshUpNuevos()}
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
  const equipo = EQUIPO_CHOLULA.map((nombre) => nombreVisible(nombre)).join(', ');
  return `Solo el equipo de vendedores de Cholula: ${equipo}. Las ventas son sus facturas del canal Cholula. `
    + 'Los leads y los seguimientos salen del CRM con sucursal o fuerza Cholula. '
    + 'Los fresh up son visitas de piso de autos nuevos (NUEVOS) con reconciliación Fresh up, del centro o fuerza Cholula. '
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
  const todos = fusionar([...mapa.values()]);
  const grupos = todos.filter((g) => esVendedorEquipo(g.vendedor));
  aplicarVentasAnteriores(grupos, ventasPrevias.filas);
  const vendedores = grupos.map(conTasas);
  const conNombre = vendedores;
  // Lo que no es del equipo (sin ejecutivo, gerentes, ex vendedores) no entra en los totales,
  // pero se informa para que las cifras cuadren con la pestaña Ventas.
  const sinAsignar = todos.find((f) => f.vendedor === 'Sin asignar') || null;
  const otros = todos.filter((g) => g.vendedor !== 'Sin asignar' && !esVendedorEquipo(g.vendedor));
  const fueraEquipo = {
    personas: otros.length,
    ventas: otros.reduce((n, g) => n + Number(g.ventas || 0), 0),
    leads: otros.reduce((n, g) => n + Number(g.leads || 0), 0),
  };
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
    fueraEquipo,
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
    if (hayTabla(d, 'crm_trafico_piso') && puedeFreshUp(d)) {
      const alias = filtroAlias('asesor', grupo.aliases);
      visitas.push(...d.prepare(`
        SELECT
          substr(fecha, 1, 10) AS fecha,
          cliente,
          auto_interes AS auto,
          medio,
          reconciliacion AS tipo
        FROM crm_trafico_piso
        WHERE substr(COALESCE(fecha, ''), 1, 10) >= ?
          AND substr(COALESCE(fecha, ''), 1, 10) <= ?
          AND ${predCholula(['centro_trabajo', 'fuerza'])}
          AND ${sqlFreshUpNuevos()}
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
/** Ventana para medir el cumplimiento de compromisos y contar los vencidos. */
const DIAS_VENTANA_COMPROMISOS = 30;
const ORDEN_ETIQUETA = { caliente: 0, seguimiento: 1, frio: 2, no_compra: 3, compro: 4 };
const TTL_BASE_MS = 60 * 1000;
const cacheBase = new Map();

function diasEntre(desdeIso, hastaIso) {
  if (!desdeIso || !hastaIso) return null;
  const [y1, m1, d1] = desdeIso.split('-').map(Number);
  const [y2, m2, d2] = hastaIso.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** Fecha de hoy (hora local del servidor de la oficina). */
function hoyIso(ahora = new Date()) {
  const mm = String(ahora.getMonth() + 1).padStart(2, '0');
  const dd = String(ahora.getDate()).padStart(2, '0');
  return `${ahora.getFullYear()}-${mm}-${dd}`;
}

/** Corte de la cartera: el fin del periodo, pero nunca después de hoy. */
function corteCartera(fechaFin, hoy = hoyIso()) {
  const fin = fechaIso(fechaFin);
  return fin > hoy ? hoy : fin;
}

function esSi(v) {
  return String(v || '').trim().toUpperCase() === 'SI';
}

function tieneCotizacion(v) {
  const s = String(v || '').trim().toUpperCase();
  return !!s && !['NO', 'N', '0'].includes(s);
}

const esFecha = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

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

/** Nombre oficial (del equipo) de un vendedor del CRM, o null si no es del equipo. */
function oficialDe(nombre) {
  const oficial = EQUIPO_CHOLULA.find((o) => mismoNombre(o, nombre));
  return oficial ? nombreMostrado(oficial, nombre) : null;
}

/**
 * El mismo nombre que usa el ranking (orden del CRM), para que todas las vistas coincidan.
 * Sin ranking a la mano, el nombre como viene del CRM.
 */
function nombreMostrado(oficial, comoViene) {
  for (const { data } of cache.values()) {
    const g = (data?.vendedores || []).find((v) => mismoNombre(oficial, v.vendedor));
    if (g) return g.vendedor;
  }
  return nombreVisible(comoViene || oficial);
}

const ESTATUS_CARTERA = ['Prospección', 'Ofrecimiento', 'Neg. Caliente', 'Pre-pedido', 'Cartera'];

function columnaExiste(d, tabla, columna) {
  return d.prepare(`PRAGMA table_info(${tabla})`).all().some((col) => col.name === columna);
}

/**
 * Ciclos cuyo último estatus al corte sigue en la cartera del ejecutivo.
 * El dueño es el vendedor de la última actividad; si no hay, el ejecutivo del lead.
 * Solo cuentan actividades con estatus hasta el corte: un periodo pasado no ve el estatus de hoy.
 */
function leerCiclosCartera(d, hasta) {
  if (!hayTabla(d, 'crm_actividades') || !hayTabla(d, 'crm_leads')) return [];
  if (!columnaExiste(d, 'crm_actividades', 'id_ciclo') || !columnaExiste(d, 'crm_actividades', 'estatus')) return [];
  const marcas = ESTATUS_CARTERA.map(() => '?').join(',');
  const ciclos = d.prepare(`
    WITH ciclo AS (
      SELECT
        id_ciclo,
        MAX(CASE WHEN id_contacto IS NOT NULL AND trim(id_contacto) <> ''
          THEN printf('%s|%s', COALESCE(fecha_estatus, ''), trim(id_contacto)) END) AS contacto_key,
        MAX(CASE WHEN estatus IS NOT NULL AND trim(estatus) <> ''
          THEN printf('%s|%s', COALESCE(fecha_estatus, ''), estatus) END) AS estatus_key,
        MAX(CASE WHEN vendedor IS NOT NULL AND trim(vendedor) <> ''
          THEN printf('%s|%s', COALESCE(fecha_estatus, ''), vendedor) END) AS vendedor_key,
        MAX(fecha_estatus) AS fecha_estatus,
        MAX(fecha_prog_actividad) AS fecha_prog_actividad
      FROM crm_actividades
      WHERE id_ciclo IS NOT NULL AND trim(id_ciclo) <> ''
        AND substr(COALESCE(fecha_estatus, ''), 1, 10) <= ?
      GROUP BY id_ciclo
    )
    SELECT
      trim(substr(contacto_key, instr(contacto_key, '|') + 1)) AS idCrm,
      trim(substr(estatus_key, instr(estatus_key, '|') + 1)) AS estatus,
      trim(substr(vendedor_key, instr(vendedor_key, '|') + 1)) AS vendedor,
      substr(COALESCE(fecha_estatus, ''), 1, 10) AS fechaEstatus,
      substr(COALESCE(fecha_prog_actividad, ''), 1, 10) AS accionSiguiente
    FROM ciclo
    WHERE trim(substr(estatus_key, instr(estatus_key, '|') + 1)) IN (${marcas})
      AND trim(substr(contacto_key, instr(contacto_key, '|') + 1)) <> ''
  `).all(hasta, ...ESTATUS_CARTERA);
  const porContacto = new Map();
  for (const ciclo of ciclos) {
    const previo = porContacto.get(ciclo.idCrm);
    if (!previo || String(ciclo.fechaEstatus || '') > String(previo.fechaEstatus || '')) {
      porContacto.set(ciclo.idCrm, ciclo);
    }
  }
  return [...porContacto.values()].map((ciclo) => ({
    ...ciclo,
    gestionVigente: !!(ciclo.accionSiguiente && ciclo.accionSiguiente >= hasta),
  }));
}

function porLotes(ids, fn, tam = 400) {
  const unicos = [...new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))];
  const out = [];
  for (let i = 0; i < unicos.length; i += tam) out.push(...fn(unicos.slice(i, i + tam)));
  return out;
}

/** Solicitudes de crédito por id del CRM, hasta el corte. */
function solicitudesPorIdCrm(d, ids, hasta) {
  const map = new Map();
  if (!hayTabla(d, 'crm_solicitudes')) return map;
  const cols = new Set(d.prepare('PRAGMA table_info(crm_solicitudes)').all().map((c) => c.name));
  const col = (nombre, alias, defecto = "''") => (cols.has(nombre) ? `COALESCE(${nombre}, ${defecto}) AS ${alias}` : `${defecto} AS ${alias}`);
  const rows = porLotes(ids, (lote) => d.prepare(`
    SELECT
      trim(CAST(id_crm AS TEXT)) AS idCrm,
      ${col('no_solicitud', 'folio')},
      substr(COALESCE(fecha_solicitud, ''), 1, 10) AS fecha,
      ${col('estatus', 'estatus')},
      ${col('financiera', 'financiera')},
      ${col('respuesta_financiera', 'respuesta')},
      ${col('unidad_paquete', 'unidad')},
      ${cols.has('fecha_aprobacion') ? "substr(COALESCE(fecha_aprobacion, ''), 1, 10)" : "''"} AS fechaAprobacion,
      ${col('num_contrato', 'contrato')},
      ${cols.has('enganche') ? 'enganche' : 'NULL'} AS enganche
    FROM crm_solicitudes
    WHERE trim(CAST(id_crm AS TEXT)) IN (${lote.map(() => '?').join(',')})
      AND substr(COALESCE(fecha_solicitud, ''), 1, 10) <= ?
    ORDER BY fecha_solicitud DESC
  `).all(...lote, hasta));
  for (const r of rows) {
    const lista = map.get(r.idCrm) || [];
    if (lista.length >= 8) continue;
    lista.push({
      folio: r.folio,
      fecha: r.fecha,
      estatus: r.estatus,
      financiera: r.financiera,
      respuesta: r.respuesta,
      unidad: r.unidad,
      fechaAprobacion: r.fechaAprobacion,
      contrato: r.contrato,
      enganche: r.enganche == null || r.enganche === '' ? null : Number(r.enganche),
      aprobada: String(r.estatus).toUpperCase().includes('APROBADA'),
    });
    map.set(r.idCrm, lista);
  }
  return map;
}

/**
 * Actividad cumplida: tiene fecha de respuesta y esa respuesta es de este compromiso
 * (posterior a cuando se creó; si no hay fecha de creación, en o después de la fecha programada).
 * Una respuesta anterior suele ser de otro ciclo y no cuenta.
 */
function sqlFechaCrea(d) {
  return columnaExiste(d, 'crm_actividades', 'fecha_crea_actividad')
    ? "substr(COALESCE(fecha_crea_actividad, ''), 1, 10)"
    : "''";
}

function estadoCompromiso({ fecha, respuesta, creada }, hoy) {
  const base = esFecha(creada) ? creada : fecha;
  const cumplida = esFecha(respuesta) && respuesta >= base;
  return {
    cumplida,
    aTiempo: cumplida && respuesta <= fecha,
    vencida: !cumplida && fecha < hoy,
  };
}

/**
 * Compromiso del asesor por cliente al corte: el pendiente más antiguo que ya venció
 * (dentro de la ventana) o, si no hay, el próximo por hacer.
 */
function compromisosPorIdCrm(d, ids, hoy) {
  const map = new Map();
  if (!hayTabla(d, 'crm_actividades')) return map;
  const crea = sqlFechaCrea(d);
  const desde = restarDias(hoy, DIAS_VENTANA_COMPROMISOS);
  const rows = porLotes(ids, (lote) => d.prepare(`
    SELECT
      trim(CAST(id_contacto AS TEXT)) AS idCrm,
      substr(fecha_prog_actividad, 1, 10) AS fecha,
      substr(COALESCE(fecha_resp_actividad, ''), 1, 10) AS respuesta,
      ${crea} AS creada,
      trim(COALESCE(tipo_actividad, '')) AS tipo,
      trim(COALESCE(resultado_actividad, '')) AS comentario,
      trim(COALESCE(vendedor, '')) AS vendedor
    FROM crm_actividades
    WHERE trim(CAST(id_contacto AS TEXT)) IN (${lote.map(() => '?').join(',')})
      AND substr(COALESCE(fecha_prog_actividad, ''), 1, 10) >= ?
  `).all(...lote, desde));
  for (const r of rows) {
    if (!esFecha(r.fecha)) continue;
    const e = estadoCompromiso(r, hoy);
    if (e.cumplida) continue;
    const previo = map.get(r.idCrm);
    const candidato = {
      fecha: r.fecha,
      vencido: e.vencida,
      dias: diasEntre(r.fecha, hoy),
      tipo: r.tipo || null,
      comentario: r.comentario || r.tipo || null,
    };
    // Vencido más antiguo primero; si no hay vencidos, el próximo.
    const mejor = !previo
      || (candidato.vencido && !previo.vencido)
      || (candidato.vencido === previo.vencido && (candidato.vencido ? candidato.fecha < previo.fecha : candidato.fecha < previo.fecha));
    if (mejor) map.set(r.idCrm, candidato);
  }
  return map;
}

const COLUMNAS_LEAD = (compra) => `
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
  ${compra} AS compra`;

/** Lectura pesada del CRM para la cartera al corte (se guarda un minuto). */
function leerBaseCartera(hasta) {
  const guardado = cacheBase.get(hasta);
  if (guardado && Date.now() - guardado.at < TTL_BASE_MS) return guardado.base;
  const desdeVida = restarDias(hasta, LEAD_VIDA_DIAS - 1);
  const d = abrirCrm();
  const base = { filas: [], ultimos: new Map(), solicitudes: new Map(), ciclos: new Map(), compromisos: new Map() };
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
      base.filas = d.prepare(`
        SELECT ${COLUMNAS_LEAD(compra)}
        FROM crm_leads
        WHERE ${filtro}
        ORDER BY fecha_entrada DESC
      `).all(desdeVida, hasta);

      for (const ciclo of leerCiclosCartera(d, hasta)) base.ciclos.set(ciclo.idCrm, ciclo);
      const yaEnVentana = new Set(base.filas.map((f) => f.idCrm));
      const faltan = [...base.ciclos.keys()].filter((id) => !yaEnVentana.has(id));
      // Clientes en cartera del ejecutivo cuyo lead es anterior a la ventana (nunca posterior al corte).
      const extra = porLotes(faltan, (lote) => d.prepare(`
        SELECT ${COLUMNAS_LEAD(compra)}
        FROM crm_leads
        WHERE (${noDup})
          AND trim(CAST(id_crm AS TEXT)) IN (${lote.map(() => '?').join(',')})
          AND substr(fecha_entrada, 1, 10) <= ?
          AND ${predCholula(['sucursal', 'fuerza_ventas'])}
        ORDER BY fecha_entrada DESC
      `).all(...lote, hasta));
      for (const fila of extra) {
        fila.fueraDeVida = true;
        base.filas.push(fila);
      }

      // Un cliente por id_crm (el registro más reciente).
      const vistos = new Set();
      base.filas = base.filas.filter((f) => (vistos.has(f.idCrm) ? false : vistos.add(f.idCrm)));
      const ids = base.filas.map((f) => f.idCrm);

      if (hayTabla(d, 'crm_actividades')) {
        const fechaAct = `substr(COALESCE(fecha_resp_actividad, fecha_crea_actividad, fecha_prog_actividad, fecha_estatus), 1, 10)`;
        const acts = porLotes(ids, (lote) => d.prepare(`
          SELECT trim(CAST(id_contacto AS TEXT)) AS idCrm, MAX(${fechaAct}) AS ultima, COUNT(*) AS n
          FROM crm_actividades
          WHERE ${fechaAct} <= ?
            AND trim(CAST(id_contacto AS TEXT)) IN (${lote.map(() => '?').join(',')})
          GROUP BY trim(CAST(id_contacto AS TEXT))
        `).all(hasta, ...lote));
        for (const a of acts) base.ultimos.set(a.idCrm, { ultima: a.ultima || null, n: Number(a.n || 0) });
        base.compromisos = compromisosPorIdCrm(d, ids, hasta);
      }
      base.solicitudes = solicitudesPorIdCrm(d, ids, hasta);
    }
  } finally {
    d.close();
  }
  cacheBase.set(hasta, { at: Date.now(), base });
  return base;
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

function revisionVista(r, ultimoSeguimiento) {
  // Si el asesor registró actividad después de programarse la revisión, ya hay algo que revisar.
  const creadaDia = String(r.creada || '').slice(0, 10);
  return {
    id: r.id,
    fecha: r.fecha,
    que: r.que,
    queLabel: seguimientoStore.etiquetaQue(r.que),
    nota: r.nota,
    autor: r.autor,
    creada: r.creada,
    estado: r.estado,
    cerrada: r.cerrada,
    asesorRegistro: !!(ultimoSeguimiento && creadaDia && ultimoSeguimiento >= creadaDia),
  };
}

/**
 * Leads de Cholula que siguen dentro de su vida (LEAD_VIDA_DIAS) al corte, más la cartera activa
 * del ejecutivo; con su avance, el compromiso del asesor, la revisión del gerente y la etiqueta.
 * El corte es el fin del periodo, sin pasar de hoy.
 */
async function getCarteraCholula({ fechaInicio, fechaFin, hoy } = {}) {
  const hoyDia = hoy || hoyIso();
  const hasta = corteCartera(fechaFin, hoyDia);
  const desdeVida = restarDias(hasta, LEAD_VIDA_DIAS - 1);
  const grupos = await gruposDelPeriodo(fechaInicio ? fechaIso(fechaInicio) : null, fechaIso(fechaFin));
  const base = leerBaseCartera(hasta);

  const guardadas = seguimientoStore.leerEtiquetas(base.filas.map((f) => f.idCrm));
  const revisionesPorCrm = new Map();
  for (const r of seguimientoStore.listarRevisiones({ ids: base.filas.map((f) => f.idCrm) })) {
    if (r.estado !== 'pendiente') continue;
    const lista = revisionesPorCrm.get(r.idCrm) || [];
    lista.push(r);
    revisionesPorCrm.set(r.idCrm, lista);
  }

  const clientes = base.filas.map((f) => {
    const act = base.ultimos.get(f.idCrm) || null;
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
    const solicitudes = base.solicitudes.get(f.idCrm) || [];
    pasos.credito = solicitudes.length > 0;
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
    const ciclo = base.ciclos.get(f.idCrm) || null;
    const ejecutivoNombre = ciclo?.vendedor || f.ejecutivo;
    const grupo = grupoDeEjecutivo(grupos, ejecutivoNombre);
    const vendedor = grupo ? grupo.vendedor : (oficialDe(ejecutivoNombre) || (ejecutivoNombre ? nombreVisible(ejecutivoNombre) : 'Sin asignar'));
    const revisiones = (revisionesPorCrm.get(f.idCrm) || []).map((r) => revisionVista(r, ultimoSeguimiento));
    return {
      idCrm: f.idCrm,
      cliente: nombreVisible(f.cliente) || 'Sin nombre',
      telefono: f.telefono || '',
      vendedor,
      vendedorKey: grupo ? grupo.key : personTokenKey(vendedor),
      campana: f.campana || '',
      auto: f.auto || '',
      fechaEntrada: f.fecha,
      diasVida,
      diasRestantes: f.fueraDeVida ? null : Math.max(0, LEAD_VIDA_DIAS - 1 - diasVida),
      ultimoSeguimiento,
      diasSinSeguimiento,
      seguimientos: act?.n || 0,
      pasos,
      solicitudes,
      compromiso: pasos.compra ? null : (base.compromisos.get(f.idCrm) || null),
      revision: revisiones[0] || null,
      origen: ciclo ? (f.fueraDeVida ? 'cartera' : 'ambos') : 'lead',
      cartera: ciclo ? {
        estatus: ciclo.estatus,
        gestionVigente: !!ciclo.gestionVigente,
        accionSiguiente: ciclo.accionSiguiente || null,
        fechaEstatus: ciclo.fechaEstatus || null,
      } : null,
      etiqueta,
      historial: (guardada?.historial || []).slice(0, 5).map((h) => ({
        ...h,
        motivoLabel: h.motivo ? seguimientoStore.MOTIVOS_NO_COMPRA[h.motivo] || h.motivo : null,
      })),
      alertaSeguimiento: activo && (diasSinSeguimiento == null || diasSinSeguimiento > DIAS_SIN_SEGUIMIENTO),
    };
  }).filter((c) => esVendedorEquipo(c.vendedor));

  const peso = (c) => (c.compromiso?.vencido ? 0 : c.revision ? 1 : c.alertaSeguimiento ? 2 : 3);
  clientes.sort((a, b) => (
    (ORDEN_ETIQUETA[a.etiqueta.clave] >= 3) - (ORDEN_ETIQUETA[b.etiqueta.clave] >= 3)
    || peso(a) - peso(b)
    || (a.compromiso?.vencido && b.compromiso?.vencido ? a.compromiso.fecha.localeCompare(b.compromiso.fecha) : 0)
    || (ORDEN_ETIQUETA[a.etiqueta.clave] - ORDEN_ETIQUETA[b.etiqueta.clave])
    || String(b.fechaEntrada).localeCompare(String(a.fechaEntrada))
  ));

  const resumen = { total: clientes.length, sinEtiqueta: 0, alertas: 0, vencidos: 0, conRevision: 0 };
  for (const clave of Object.keys(seguimientoStore.ETIQUETAS)) resumen[clave] = 0;
  for (const c of clientes) {
    resumen[c.etiqueta.clave] += 1;
    if (c.etiqueta.origen === 'sugerida') resumen.sinEtiqueta += 1;
    if (c.alertaSeguimiento) resumen.alertas += 1;
    if (c.compromiso?.vencido) resumen.vencidos += 1;
    if (c.revision) resumen.conRevision += 1;
  }
  resumen.leads90 = clientes.filter((c) => c.origen !== 'cartera').length;
  resumen.enCartera = clientes.filter((c) => c.cartera).length;

  return {
    sucursal: SUCURSAL.label,
    fechaCorte: hasta,
    hoy: hoyDia,
    desdeVida,
    vidaDias: LEAD_VIDA_DIAS,
    diasSinSeguimiento: DIAS_SIN_SEGUIMIENTO,
    etiquetas: Object.entries(seguimientoStore.ETIQUETAS).map(([clave, e]) => ({
      clave,
      ...e,
      manual: seguimientoStore.ETIQUETAS_MANUALES.includes(clave),
    })),
    motivos: Object.entries(seguimientoStore.MOTIVOS_NO_COMPRA).map(([clave, label]) => ({ clave, label })),
    queRevisar: Object.entries(seguimientoStore.QUE_REVISAR).map(([clave, label]) => ({ clave, label })),
    resumen,
    clientes,
    nota: `Leads de Cholula de los últimos ${LEAD_VIDA_DIAS} días al ${hasta}, más la cartera activa del ejecutivo `
      + '(prospección, ofrecimiento, negociación caliente, pre-pedido o cartera) con su estatus a esa fecha, aunque el lead sea anterior. '
      + 'El corte es el fin del periodo, sin pasar de hoy. '
      + 'El compromiso del asesor es la actividad con fecha que dejó en el CRM: primero la vencida más antigua '
      + `(últimos ${DIAS_VENTANA_COMPROMISOS} días) y, si no hay, la próxima. `
      + 'La revisión es la fecha que el gerente programa para confirmar el estatus con el asesor. '
      + '«Compró» se pone solo cuando el CRM registra la compra. Sin etiqueta del equipo se muestra una sugerida: '
      + 'caliente si asistió a cita o cotizó; en seguimiento si tuvo actividad en los últimos '
      + `${DIAS_ACTIVIDAD_RECIENTE} días; frío en otro caso.`,
  };
}

/**
 * Lead de Cholula del equipo: su ejecutivo es del equipo, o el dueño de su último ciclo lo es
 * (la cartera asigna así al cliente). Regresa nombre del cliente y vendedor oficial.
 */
function validarClienteCholula(idCrm) {
  const key = String(idCrm || '').trim();
  const d = abrirCrm();
  try {
    const leads = hayTabla(d, 'crm_leads')
      ? d.prepare(`
          SELECT nombre AS cliente, TRIM(COALESCE(ejecutivo_asignado, '')) AS ejecutivo
          FROM crm_leads
          WHERE trim(CAST(id_crm AS TEXT)) = ?
            AND ${predCholula(['sucursal', 'fuerza_ventas'])}
          ORDER BY fecha_entrada DESC
        `).all(key)
      : [];
    if (!leads.length) {
      const err = new Error('Ese cliente no es un lead de Cholula.');
      err.status = 404;
      throw err;
    }
    let dueno = null;
    if (hayTabla(d, 'crm_actividades')) {
      const orden = columnaExiste(d, 'crm_actividades', 'fecha_estatus') ? 'fecha_estatus' : 'fecha_prog_actividad';
      dueno = d.prepare(`
        SELECT trim(vendedor) AS vendedor FROM crm_actividades
        WHERE trim(CAST(id_contacto AS TEXT)) = ? AND trim(COALESCE(vendedor, '')) <> ''
        ORDER BY ${orden} DESC LIMIT 1
      `).get(key)?.vendedor || null;
    }
    const candidatos = [dueno, ...leads.map((l) => l.ejecutivo)].filter(Boolean);
    const delEquipo = candidatos.find((n) => esVendedorEquipo(n));
    if (!delEquipo) {
      const err = new Error('Ese cliente no está asignado al equipo de vendedores de Cholula.');
      err.status = 404;
      throw err;
    }
    return { idCrm: key, cliente: nombreVisible(leads[0].cliente) || 'Sin nombre', vendedor: oficialDe(delEquipo) };
  } finally {
    d.close();
  }
}

/** Guarda la etiqueta de un cliente, solo si es un lead de Cholula del equipo. */
function etiquetarClienteCholula(idCrm, { etiqueta, motivo, nota, autor } = {}) {
  const { idCrm: key } = validarClienteCholula(idCrm);
  const guardado = seguimientoStore.etiquetar(key, { etiqueta, motivo, nota, autor });
  return { idCrm: key, etiqueta: guardado };
}

/** Programa la revisión del gerente para un cliente de Cholula del equipo. */
function programarRevisionCholula(idCrm, { fecha, que, nota, autor, hoy } = {}) {
  const cliente = validarClienteCholula(idCrm);
  const revision = seguimientoStore.programarRevision(cliente.idCrm, {
    fecha,
    que,
    nota,
    autor,
    cliente: cliente.cliente,
    vendedor: cliente.vendedor,
    hoy: hoy || hoyIso(),
  });
  return { idCrm: cliente.idCrm, revision: revisionVista(revision, null) };
}

function cerrarRevisionCholula(id, { estado, autor } = {}) {
  return { revision: revisionVista(seguimientoStore.cerrarRevision(id, { estado, autor }), null) };
}

/** Actividades con fecha programada del equipo en un rango, sin duplicados. */
function leerCompromisosEquipo(d, desde, hasta, hoy) {
  if (!hayTabla(d, 'crm_actividades')) return [];
  const crea = sqlFechaCrea(d);
  const filas = d.prepare(`
    SELECT
      substr(fecha_prog_actividad, 1, 10) AS fecha,
      substr(COALESCE(fecha_resp_actividad, ''), 1, 10) AS respuesta,
      ${crea} AS creada,
      trim(COALESCE(id_contacto, '')) AS idCrm,
      trim(COALESCE(nombre_contacto, '')) AS cliente,
      trim(COALESCE(vendedor, '')) AS vendedor,
      trim(COALESCE(tipo_actividad, '')) AS tipo,
      trim(COALESCE(resultado_actividad, '')) AS comentario
    FROM crm_actividades
    WHERE substr(COALESCE(fecha_prog_actividad, ''), 1, 10) >= ?
      AND substr(COALESCE(fecha_prog_actividad, ''), 1, 10) <= ?
      AND trim(COALESCE(vendedor, '')) <> ''
  `).all(desde, hasta);
  const vistos = new Set();
  const out = [];
  for (const fila of filas) {
    const oficial = oficialDe(fila.vendedor);
    if (!oficial) continue;
    const comentario = fila.comentario || fila.tipo;
    if (!comentario || !esFecha(fila.fecha)) continue;
    const clave = [fila.idCrm, fila.fecha, comentario, oficial].join('|');
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    const e = estadoCompromiso(fila, hoy);
    out.push({
      fecha: fila.fecha,
      idCrm: fila.idCrm || null,
      cliente: nombreVisible(fila.cliente) || 'Sin nombre',
      vendedor: oficial,
      tipo: fila.tipo || null,
      comentario,
      respuesta: e.cumplida ? fila.respuesta : null,
      ...e,
    });
  }
  return out;
}

/**
 * Agenda del mes: compromisos que el equipo dejó en el CRM (fecha programada y comentario)
 * y las revisiones que programó el gerente.
 * @param {{ mes?: string, dbPath?: string, hoy?: string }} opts mes en YYYY-MM
 */
function getCalendarioCholula({ mes, dbPath, hoy } = {}) {
  const m = String(mes || '').trim();
  if (!/^\d{4}-\d{2}$/.test(m)) {
    const err = new Error('Indica el mes como YYYY-MM.');
    err.status = 400;
    throw err;
  }
  const [anio, mesNum] = m.split('-').map(Number);
  if (mesNum < 1 || mesNum > 12) {
    const err = new Error('Indica el mes como YYYY-MM.');
    err.status = 400;
    throw err;
  }
  const hoyDia = hoy || hoyIso();
  const desde = `${m}-01`;
  const ultimo = new Date(anio, mesNum, 0).getDate();
  const hasta = `${m}-${String(ultimo).padStart(2, '0')}`;
  const d = abrirCrm(dbPath);
  let eventos = [];
  try {
    eventos = leerCompromisosEquipo(d, desde, hasta, hoyDia);
  } finally {
    d.close();
  }
  eventos.sort((a, b) => a.fecha.localeCompare(b.fecha)
    || a.vendedor.localeCompare(b.vendedor, 'es')
    || a.cliente.localeCompare(b.cliente, 'es'));
  const revisiones = dbPath ? [] : seguimientoStore.listarRevisiones({ desde, hasta })
    .filter((r) => r.estado !== 'cancelada')
    .map((r) => ({ ...revisionVista(r, null), idCrm: r.idCrm, cliente: r.cliente || 'Sin nombre', vendedor: r.vendedor || '' }));
  return {
    mes: m,
    hoy: hoyDia,
    sucursal: SUCURSAL.label,
    total: eventos.length,
    pendientes: eventos.filter((e) => !e.cumplida).length,
    vencidas: eventos.filter((e) => e.vencida).length,
    porHacer: eventos.filter((e) => !e.cumplida && !e.vencida).length,
    eventos,
    revisiones,
  };
}

/**
 * Equipo hoy: por asesor, cumplimiento de compromisos (últimos 30 días), vencidos, para hoy,
 * clientes activos sin seguimiento y revisiones pendientes del gerente.
 */
async function getEquipoCholula({ hoy, fechaInicio } = {}) {
  const hoyDia = hoy || hoyIso();
  const desde = restarDias(hoyDia, DIAS_VENTANA_COMPROMISOS);
  const d = abrirCrm();
  let compromisos = [];
  try {
    compromisos = leerCompromisosEquipo(d, desde, hoyDia, hoyDia);
  } finally {
    d.close();
  }
  const cartera = await getCarteraCholula({
    fechaInicio: fechaInicio || `${hoyDia.slice(0, 7)}-01`,
    fechaFin: hoyDia,
    hoy: hoyDia,
  });
  const pendientesRev = seguimientoStore.listarRevisiones().filter((r) => r.estado === 'pendiente');
  const filas = EQUIPO_CHOLULA.map((oficial) => {
    const nombre = nombreMostrado(oficial);
    const suyos = compromisos.filter((c) => c.vendedor === nombre);
    const pasados = suyos.filter((c) => c.fecha < hoyDia);
    const deHoy = suyos.filter((c) => c.fecha === hoyDia);
    const clientes = cartera.clientes.filter((c) => mismoNombre(oficial, c.vendedor));
    const revs = pendientesRev.filter((r) => r.vendedor && mismoNombre(oficial, r.vendedor));
    return {
      vendedor: nombre,
      key: clientes[0]?.vendedorKey || personTokenKey(nombre),
      compromisos: pasados.length,
      aTiempo: pasados.filter((c) => c.aTiempo).length,
      tarde: pasados.filter((c) => c.cumplida && !c.aTiempo).length,
      vencidas: pasados.filter((c) => c.vencida).length,
      paraHoy: deHoy.length,
      paraHoyCumplidas: deHoy.filter((c) => c.cumplida).length,
      pctATiempo: pasados.length ? Math.round((pasados.filter((c) => c.aTiempo).length / pasados.length) * 1000) / 10 : null,
      activos: clientes.filter((c) => ['caliente', 'seguimiento'].includes(c.etiqueta.clave)).length,
      sinSeguimiento: clientes.filter((c) => c.alertaSeguimiento).length,
      revisiones: revs.length,
      revisionesHoy: revs.filter((r) => r.fecha <= hoyDia).length,
    };
  });
  filas.sort((a, b) => b.vencidas - a.vencidas || (a.pctATiempo ?? 101) - (b.pctATiempo ?? 101) || a.vendedor.localeCompare(b.vendedor, 'es'));
  return {
    hoy: hoyDia,
    desde,
    ventanaDias: DIAS_VENTANA_COMPROMISOS,
    vendedores: filas,
    totales: {
      compromisos: filas.reduce((n, f) => n + f.compromisos, 0),
      aTiempo: filas.reduce((n, f) => n + f.aTiempo, 0),
      vencidas: filas.reduce((n, f) => n + f.vencidas, 0),
      paraHoy: filas.reduce((n, f) => n + f.paraHoy, 0),
      sinSeguimiento: filas.reduce((n, f) => n + f.sinSeguimiento, 0),
      revisiones: filas.reduce((n, f) => n + f.revisiones, 0),
    },
    nota: `Compromisos = actividades con fecha programada que el asesor dejó en el CRM. A tiempo = registró la respuesta en su fecha o antes. `
      + `Vencida = sin respuesta y su fecha ya pasó (últimos ${DIAS_VENTANA_COMPROMISOS} días). `
      + `Sin seguimiento = clientes calientes o en seguimiento con más de ${DIAS_SIN_SEGUIMIENTO} días sin actividad.`,
  };
}

module.exports = {
  getMonitoreoCholula,
  getMonitoreoCholulaDetalle,
  getCalendarioCholula,
  getCarteraCholula,
  getEquipoCholula,
  etiquetarClienteCholula,
  programarRevisionCholula,
  cerrarRevisionCholula,
  estadoCompromiso,
  corteCartera,
  etiquetaSugerida,
  esVendedorEquipo,
  fusionar,
  nombreVisible,
  periodoAnterior,
  conTasas,
  personTokenKey,
  mismoNombre,
  sqlFreshUpNuevos,
};
