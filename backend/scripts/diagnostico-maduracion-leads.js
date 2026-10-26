'use strict';
/**
 * ¿Alcanzan los datos de Leads para Kaplan–Meier, Cox o un modelo de curación?
 *
 * Corre en la oficina, contra la base CRM real (backend/data/crm-ciclos.db), con las
 * mismas reglas que el bloque «3 · Tiempo a compra»: leads sin duplicado de los últimos
 * 12 meses hasta el corte, compra = VIN en la hoja o primera actividad con VIN del mismo
 * ID CRM en o después de la entrada, tope de 180 días.
 *
 * Uso:
 *   node scripts/diagnostico-maduracion-leads.js [--fechaFin AAAA-MM-DD] [--horizonte 180]
 *
 * Escribe backend/data/private/diagnostico-maduracion-leads.json (fuera de git).
 * No imprime ni guarda nombres, teléfonos, correos ni VIN: solo conteos.
 */
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/crm-ciclos.db');
const OUT = path.join(__dirname, '../data/private/diagnostico-maduracion-leads.json');

const MIN_COMPRAS_CURVA = 15;      // igual que el servicio: menos de esto no se dibuja la curva
const MIN_COMPRAS_FACTORES = 40;   // igual que el servicio: menos de esto no se estiman factores
const COMPRAS_POR_PARAMETRO = 10;  // regla práctica para Cox / logística
const MIN_COMPRAS_NIVEL = 10;      // para leer un nivel de un factor con algo de precisión
const TRAMO_TEMPRANO = 30;         // días: riesgos proporcionales = misma razón antes y después

/* ───────────────────────── funciones puras (con prueba) ───────────────────────── */

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

function diasEntre(desde, hasta) {
  const a = Date.parse(`${String(desde).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(hasta).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

/** F(t) de una curva de Kaplan–Meier ({dia, f}). */
function fEn(curve, dia) {
  let f = 0;
  for (const p of curve) {
    if (p.dia > dia) break;
    f = p.f;
  }
  return f;
}

/**
 * ¿La curva ya se aplanó? Si en el último tramo (horizonte − 30 → horizonte) todavía sube
 * más de 10 % de lo acumulado, el seguimiento es corto o no hay una fracción que «nunca
 * compra» clara: un modelo de curación no se sostiene.
 */
function meseta(curve, horizonte = 180) {
  const fH = fEn(curve, horizonte);
  const fAntes = fEn(curve, Math.max(0, horizonte - 30));
  const subida = fH - fAntes;
  return {
    fHorizonte: Math.round(fH * 1000) / 10,
    subidaUltimos30: Math.round(subida * 1000) / 10,
    seAplana: fH > 0 && subida <= fH * 0.1,
    nuncaCompraPct: Math.round((1 - fH) * 1000) / 10,
  };
}

/**
 * Razón de tasas por tramo (compras / días en riesgo) de cada nivel contra la base.
 * Cox supone que esa razón es la misma en todo el tiempo. Si la razón temprana y la
 * tardía difieren más de 2× o cambian de lado (una >1 y otra <1), el supuesto no se cumple.
 */
function riesgosProporcionales(obs, campo, { corte = TRAMO_TEMPRANO, horizonte = 180, minEventos = 5 } = {}) {
  const niveles = new Map();
  for (const o of obs) {
    const k = o[campo] || 'Sin dato';
    if (!niveles.has(k)) niveles.set(k, { nivel: k, leads: 0, e1: 0, t1: 0, e2: 0, t2: 0 });
    const n = niveles.get(k);
    n.leads += 1;
    const t = Math.min(o.t, horizonte);
    n.t1 += Math.min(t, corte);
    n.t2 += Math.max(0, t - corte);
    if (o.event) {
      if (t <= corte) n.e1 += 1;
      else n.e2 += 1;
    }
  }
  const lista = [...niveles.values()].filter((n) => n.nivel !== 'Sin dato');
  const base = lista.slice().sort((a, b) => b.leads - a.leads)[0];
  if (!base || base.e1 < minEventos || base.e2 < minEventos) return { base: base?.nivel || null, niveles: [], violaciones: 0, evaluables: 0 };
  const tasa = (e, t) => (t > 0 ? e / t : null);
  const r1b = tasa(base.e1, base.t1);
  const r2b = tasa(base.e2, base.t2);
  const filas = lista.filter((n) => n !== base && n.e1 >= minEventos && n.e2 >= minEventos).map((n) => {
    const rr1 = tasa(n.e1, n.t1) / r1b;
    const rr2 = tasa(n.e2, n.t2) / r2b;
    const cociente = rr1 / rr2;
    const cambiaLado = (rr1 - 1) * (rr2 - 1) < 0 && Math.abs(Math.log(rr1)) > 0.2 && Math.abs(Math.log(rr2)) > 0.2;
    return {
      nivel: n.nivel,
      leads: n.leads,
      comprasTempranas: n.e1,
      comprasTardias: n.e2,
      razonTemprana: Math.round(rr1 * 100) / 100,
      razonTardia: Math.round(rr2 * 100) / 100,
      violaRiesgosProporcionales: cambiaLado || cociente > 2 || cociente < 0.5,
    };
  });
  return {
    base: base.nivel,
    niveles: filas,
    evaluables: filas.length,
    violaciones: filas.filter((f) => f.violaRiesgosProporcionales).length,
  };
}

/** Compras por nivel de un factor y cuántos niveles se pueden leer. */
function volumenFactor(obs, campo) {
  const m = new Map();
  for (const o of obs) {
    const k = o[campo] || 'Sin dato';
    if (!m.has(k)) m.set(k, { nivel: k, leads: 0, compras: 0 });
    const n = m.get(k);
    n.leads += 1;
    if (o.event) n.compras += 1;
  }
  const niveles = [...m.values()].sort((a, b) => b.compras - a.compras);
  return {
    niveles: niveles.length,
    nivelesLegibles: niveles.filter((n) => n.nivel !== 'Sin dato' && n.compras >= MIN_COMPRAS_NIVEL).length,
    sinDatoPct: pct(m.get('Sin dato')?.leads || 0, obs.length),
    top: niveles.slice(0, 8),
  };
}

/** Porcentaje de compras que caen en un día con otra compra del mismo tiempo (empates). */
function empates(obs) {
  const porDia = new Map();
  for (const o of obs) if (o.event) porDia.set(o.t, (porDia.get(o.t) || 0) + 1);
  const total = [...porDia.values()].reduce((a, b) => a + b, 0);
  const enEmpate = [...porDia.values()].filter((n) => n > 1).reduce((a, b) => a + b, 0);
  return { comprasEnModelo: total, enEmpatePct: pct(enEmpate, total), mismoDiaEntrada: porDia.get(0) || 0 };
}

/** Veredicto por modelo a partir de las mediciones. */
function veredicto(m) {
  const res = [];
  const fechadas = m.evento.compras - m.evento.vinSinFecha;
  const kmOk = fechadas >= MIN_COMPRAS_CURVA && m.evento.coberturaFechaPct >= 90;
  res.push({
    modelo: 'Kaplan–Meier (curva de maduración)',
    estado: kmOk ? 'si' : (fechadas >= MIN_COMPRAS_CURVA ? 'con_reservas' : 'no'),
    porque: kmOk
      ? `${fechadas} compras con fecha y ${m.evento.coberturaFechaPct} % de las compras fechadas.`
      : (fechadas < MIN_COMPRAS_CURVA
        ? `Solo ${fechadas} compras con fecha (mínimo ${MIN_COMPRAS_CURVA}).`
        : `Solo ${m.evento.coberturaFechaPct} % de las compras tienen fecha: la curva sale corta.`),
  });
  const parametros = Math.floor(fechadas / COMPRAS_POR_PARAMETRO);
  const ph = m.riesgosProporcionales;
  const violaciones = Object.values(ph).reduce((a, r) => a + r.violaciones, 0);
  const evaluables = Object.values(ph).reduce((a, r) => a + r.evaluables, 0);
  const curaFuerte = m.curva.nuncaCompraPct >= 50;
  res.push({
    modelo: 'Cox de riesgos proporcionales',
    estado: parametros < 2 ? 'no' : (violaciones > 0 || curaFuerte ? 'no_recomendado' : 'si'),
    porque: [
      `Caben unos ${parametros} parámetros (${COMPRAS_POR_PARAMETRO} compras por parámetro).`,
      curaFuerte ? `${m.curva.nuncaCompraPct} % no compra en ${m.horizonte} días: la razón de riesgos mezcla «compra más» con «compra más rápido».` : null,
      evaluables ? `${violaciones} de ${evaluables} niveles cambian su razón entre los primeros ${TRAMO_TEMPRANO} días y después.` : 'No hay niveles con compras suficientes para probar riesgos proporcionales.',
    ].filter(Boolean).join(' '),
  });
  res.push({
    modelo: 'Curación por mezcla (logística ¿compra? + tiempo entre los que compran)',
    estado: fechadas >= MIN_COMPRAS_FACTORES && m.curva.seAplana ? 'si' : (fechadas >= MIN_COMPRAS_FACTORES ? 'con_reservas' : 'no'),
    porque: fechadas < MIN_COMPRAS_FACTORES
      ? `Se necesitan ${MIN_COMPRAS_FACTORES} compras con fecha; hay ${fechadas}.`
      : (m.curva.seAplana
        ? `La curva se aplana al día ${m.horizonte} (sube ${m.curva.subidaUltimos30} puntos en los últimos 30 días).`
        : `La curva todavía sube ${m.curva.subidaUltimos30} puntos en los últimos 30 días: falta seguimiento para separar a los que nunca compran.`),
  });
  const conFechaPerdida = m.perdida.conFechaPct;
  res.push({
    modelo: 'Riesgos competitivos (compra contra pérdida, Aalen–Johansen)',
    estado: conFechaPerdida >= 70 ? 'si' : (conFechaPerdida >= 30 ? 'con_reservas' : 'no'),
    porque: `${conFechaPerdida} % de los leads perdidos tiene una fecha de pérdida en el ciclo CRM; la hoja de leads no trae esa fecha.`,
  });
  const citasFecha = m.hitos.citasConFechaPct;
  res.push({
    modelo: 'Variables que cambian en el tiempo (cita, prueba, solicitud)',
    estado: citasFecha >= 80 && (m.hitos.pruebas.cruzanPct >= 50 || m.hitos.solicitudes.cruzanPct >= 50) ? 'si' : (citasFecha >= 80 ? 'con_reservas' : 'no'),
    porque: [
      `${citasFecha} % de las citas asistidas tiene fecha.`,
      m.hitos.pruebas.disponible ? `Pruebas de manejo: ${m.hitos.pruebas.cruzanPct} % cruzan con un lead.` : 'Sin tabla de pruebas de manejo.',
      m.hitos.solicitudes.disponible ? `Solicitudes de crédito: ${m.hitos.solicitudes.cruzanPct} % cruzan con un lead.` : 'Sin tabla de solicitudes.',
    ].join(' '),
  });
  return res;
}

/* ───────────────────────── lectura de la base ───────────────────────── */

function leer({ fechaFin, horizonte }) {
  const Database = require('better-sqlite3');
  const crm = require('../src/services/crmCiclosService');
  const sup = require('../src/services/leadsSupervivenciaService');
  const hasta = sup.corteEfectivo(fechaFin);
  const desde = sup.sumarMeses(hasta, -12);
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const hay = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
    const tablas = Object.fromEntries(['crm_leads', 'crm_actividades', 'crm_pruebas_manejo', 'crm_solicitudes'].map((t) => [t, hay(t)]));
    if (!tablas.crm_leads) throw new Error('La base CRM no tiene la tabla crm_leads (correr etl-crm-leads.js).');

    const totalHoja = db.prepare("SELECT COUNT(*) AS n FROM crm_leads WHERE substr(fecha_entrada, 1, 10) BETWEEN ? AND ?").get(desde, hasta).n;
    const notDup = crm.getLeadNotDuplicateSql();
    const fAct = `substr(COALESCE(NULLIF(trim(a.fecha_factura), ''), NULLIF(trim(a.fecha_entrega), ''), NULLIF(trim(a.fecha_estatus), ''), NULLIF(trim(a.fecha_inicio_ciclo), '')), 1, 10)`;
    const rows = db.prepare(`
      SELECT
        trim(COALESCE(id_crm, '')) AS idCrm,
        substr(fecha_entrada, 1, 10) AS entrada,
        tipo, canal, campana, forma_compra AS forma, cuando_estrena AS estrena,
        auto_interes AS auto, fuerza_ventas AS fuerza, ejecutivo_asignado AS ejecutivo,
        upper(trim(COALESCE(resultado, ''))) AS resultado,
        upper(trim(COALESCE(cita_asistida, ''))) AS cita,
        substr(fecha_cita, 1, 10) AS fechaCita,
        CASE WHEN vin_comprado IS NOT NULL AND trim(vin_comprado) <> '' THEN 1 ELSE 0 END AS vinHoja,
        NULLIF(substr(trim(COALESCE(fecha_factura, '')), 1, 10), '') AS facturaHoja,
        NULLIF(upper(trim(COALESCE(vin_comprado, ''))), '') AS vin,
        regexp_tel(telefono) AS tel,
        (${crm.compraLeadSql()}) AS conCompra,
        (${crm.fechaCompraLeadSql()}) AS fechaCompra
        ${tablas.crm_actividades ? `,
        (SELECT COUNT(*) FROM crm_actividades a WHERE a.id_contacto = crm_leads.id_crm
           AND a.vin IS NOT NULL AND trim(a.vin) <> '' AND ${fAct} < substr(crm_leads.fecha_entrada, 1, 10)) AS comprasPrevias,
        (SELECT ${fAct} FROM crm_actividades a WHERE a.id_contacto = crm_leads.id_crm
           AND a.estatus IN ('Venta Perdida', 'Lead Caducado', 'Descartado', 'Neg. Diferida')
           AND ${fAct} >= substr(crm_leads.fecha_entrada, 1, 10)
           ORDER BY ${fAct} ASC LIMIT 1) AS fechaPerdidaCiclo` : ', 0 AS comprasPrevias, NULL AS fechaPerdidaCiclo'}
      FROM crm_leads
      WHERE ${notDup}
        AND fecha_entrada IS NOT NULL AND trim(fecha_entrada) <> ''
        AND substr(fecha_entrada, 1, 10) BETWEEN ? AND ?
    `.replace('regexp_tel(telefono)', "replace(replace(replace(replace(trim(COALESCE(telefono, '')), ' ', ''), '-', ''), '(', ''), ')', '')")).all(desde, hasta);

    const contarHito = (tabla, campoFecha) => {
      if (!tablas[tabla]) return { disponible: false, registros: 0, cruzanPct: 0 };
      const ids = new Set(rows.map((r) => r.idCrm).filter(Boolean));
      const regs = db.prepare(`SELECT trim(COALESCE(id_crm, '')) AS id FROM ${tabla} WHERE substr(${campoFecha}, 1, 10) BETWEEN ? AND ?`).all(desde, hasta);
      return { disponible: true, registros: regs.length, cruzanPct: pct(regs.filter((r) => ids.has(r.id)).length, regs.length) };
    };
    const hitos = {
      pruebas: contarHito('crm_pruebas_manejo', 'fecha'),
      solicitudes: contarHito('crm_solicitudes', 'fecha_solicitud'),
    };
    return { desde, hasta, tablas, totalHoja, rows, hitos, sup };
  } finally {
    db.close();
  }
}

function medir({ desde, hasta, tablas, totalHoja, rows, hitos, sup }, horizonte) {
  const llenado = {};
  for (const [campo, etiqueta] of [['tipo', 'fuente (tipo)'], ['canal', 'canal'], ['campana', 'campaña'], ['forma', 'forma de compra'], ['estrena', 'cuándo estrena'], ['auto', 'auto de interés'], ['fuerza', 'fuerza de ventas'], ['ejecutivo', 'ejecutivo'], ['fechaCita', 'fecha de cita']]) {
    llenado[etiqueta] = pct(rows.filter((r) => String(r[campo] || '').trim()).length, rows.length);
  }

  // Evento
  const compras = rows.filter((r) => r.conCompra);
  const vinSinFecha = compras.filter((r) => !r.fechaCompra).length;
  const soloCiclo = compras.filter((r) => !r.vinHoja).length;
  const fechaSinVin = rows.filter((r) => r.facturaHoja && !r.vinHoja).length;
  const antesDeEntrada = rows.filter((r) => r.vinHoja && r.facturaHoja && r.facturaHoja < r.entrada).length;
  const conCompraPrevia = rows.filter((r) => Number(r.comprasPrevias) > 0).length;

  // Observaciones con la misma regla del modelo
  const filas = rows.map((r) => ({
    entrada: r.entrada,
    tipo: r.tipo,
    forma: r.forma,
    estrena: r.estrena,
    compraDia: r.conCompra && r.fechaCompra ? diasEntre(r.entrada, r.fechaCompra) : null,
  }));
  const { obs: base, excluidos } = sup.armarObservaciones(filas, { corte: hasta, horizonte });
  // armarObservaciones conserva el orden de las filas válidas: se completan los demás factores.
  const validas = rows.filter((r) => {
    const dc = diasEntre(r.entrada, hasta);
    const c = r.conCompra && r.fechaCompra ? diasEntre(r.entrada, r.fechaCompra) : null;
    return dc != null && dc >= 0 && !(c != null && c < 0);
  });
  const nivel = (v) => String(v || '').replace(/\s+/g, ' ').replace(/[\s.,;:]+$/, '').trim() || 'Sin dato';
  const obs = base.map((o, i) => ({
    ...o,
    canal: nivel(validas[i]?.canal).toUpperCase(),
    fuerza: nivel(validas[i]?.fuerza).toUpperCase(),
    auto: nivel(validas[i]?.auto).toUpperCase(),
    ejecutivo: nivel(validas[i]?.ejecutivo),
  }));
  const mas365 = filas.filter((f) => f.compraDia != null && f.compraDia > 365).length;
  const curve = sup.kaplanMeier(obs);
  const seguimientoCompleto = obs.filter((o) => o.event || o.t >= horizonte).length;

  // Personas con varios leads y compras compartidas (sin guardar teléfonos ni VIN)
  const repetidos = (clave) => {
    const m = new Map();
    for (const r of rows) {
      const k = r[clave];
      if (!k || (clave === 'tel' && k.length < 8)) continue;
      m.set(k, (m.get(k) || 0) + 1);
    }
    const varios = [...m.values()].filter((n) => n > 1);
    return { personas: varios.length, leads: varios.reduce((a, b) => a + b, 0) };
  };
  const vinRepetido = repetidos('vin');

  // Pérdida
  const perdidoRe = /PERDID|DESIST|NO INTERES|CANCEL|DESCART|CADUC/;
  const perdidos = rows.filter((r) => !r.conCompra && perdidoRe.test(r.resultado));
  const conFechaPerdida = perdidos.filter((r) => r.fechaPerdidaCiclo).length;

  const asistidas = rows.filter((r) => r.cita === 'SI');
  const factores = {
    fuente: volumenFactor(obs, 'fuente'),
    formaCompra: volumenFactor(obs, 'forma'),
    cuandoEstrena: volumenFactor(obs, 'estrena'),
    canal: volumenFactor(obs, 'canal'),
    fuerzaVentas: volumenFactor(obs, 'fuerza'),
    autoInteres: volumenFactor(obs, 'auto'),
    ejecutivo: volumenFactor(obs, 'ejecutivo'),
  };
  const riesgos = {};
  for (const [k, campo] of [['fuente', 'fuente'], ['formaCompra', 'forma'], ['cuandoEstrena', 'estrena'], ['canal', 'canal'], ['fuerzaVentas', 'fuerza']]) {
    riesgos[k] = riesgosProporcionales(obs, campo, { horizonte });
  }

  const m = {
    ventana: { desde, hasta },
    horizonte,
    tablas,
    leads: { hojaEnVentana: totalHoja, sinDuplicado: rows.length, enModelo: obs.length, excluidos },
    llenadoPct: llenado,
    evento: {
      compras: compras.length,
      desdeHoja: compras.length - soloCiclo,
      soloEnCicloCrm: soloCiclo,
      vinSinFecha,
      coberturaFechaPct: pct(compras.length - vinSinFecha, compras.length),
      fechaSinVin,
      compraAntesDeEntrada: antesDeEntrada,
      leadsDeClienteQueYaHabiaComprado: conCompraPrevia,
      compraDespuesDe365: mas365,
      ...empates(obs),
    },
    seguimiento: {
      conSeguimientoCompletoPct: pct(seguimientoCompleto, obs.length),
      nota: `Leads que ya compraron o que llevan al menos ${horizonte} días observados.`,
    },
    curva: {
      f30: Math.round(fEn(curve, 30) * 1000) / 10,
      f90: Math.round(fEn(curve, 90) * 1000) / 10,
      ...meseta(curve, horizonte),
      diaMitadCompras: sup.diaCuantilKm(curve, 0.5, horizonte),
      diaOchoDeDiez: sup.diaCuantilKm(curve, 0.8, horizonte),
    },
    repetidos: {
      mismoIdCrm: repetidos('idCrm'),
      mismoTelefono: repetidos('tel'),
      mismoVinEnVariosLeads: vinRepetido,
    },
    perdida: {
      perdidosEnHoja: perdidos.length,
      conFechaEnCiclo: conFechaPerdida,
      conFechaPct: pct(conFechaPerdida, perdidos.length),
    },
    hitos: {
      citasAsistidas: asistidas.length,
      citasConFechaPct: pct(asistidas.filter((r) => r.fechaCita && r.fechaCita >= r.entrada).length, asistidas.length),
      ...hitos,
    },
    factores,
    riesgosProporcionales: riesgos,
  };
  m.veredicto = veredicto(m);
  return m;
}

/* ───────────────────────── salida ───────────────────────── */

function imprimir(m) {
  const sello = { si: '✔', con_reservas: '⚠', no_recomendado: '✘', no: '✘' };
  const l = (s = '') => console.log(s);
  l(`Diagnóstico de maduración de leads · ${m.ventana.desde} a ${m.ventana.hasta} · tope ${m.horizonte} días`);
  l(`Leads: ${m.leads.sinDuplicado} sin duplicado (${m.leads.hojaEnVentana} en la hoja) · ${m.leads.enModelo} entran al modelo · ${m.leads.excluidos} fuera por fechas inconsistentes`);
  l(`Tablas: ${Object.entries(m.tablas).map(([t, v]) => `${t} ${v ? 'sí' : 'no'}`).join(' · ')}`);
  l();
  l('Compra (evento)');
  l(`  ${m.evento.compras} compras · ${m.evento.desdeHoja} con VIN en la hoja · ${m.evento.soloEnCicloCrm} solo en el ciclo CRM`);
  l(`  ${m.evento.coberturaFechaPct} % con fecha · VIN sin fecha ${m.evento.vinSinFecha} · fecha sin VIN ${m.evento.fechaSinVin}`);
  l(`  Compra antes de la entrada ${m.evento.compraAntesDeEntrada} · leads de clientes que ya habían comprado ${m.evento.leadsDeClienteQueYaHabiaComprado} · compra después del día 365 ${m.evento.compraDespuesDe365}`);
  l(`  ${m.evento.comprasEnModelo} entran al modelo (≤${m.horizonte} días) · ${m.evento.enEmpatePct} % comparten día con otra compra (fecha sin hora: Cox necesitaría Efron) · ${m.evento.mismoDiaEntrada} el mismo día de la entrada`);
  l();
  l('Curva (Kaplan–Meier)');
  l(`  Compran: ${m.curva.f30} % al día 30 · ${m.curva.f90} % al 90 · ${m.curva.fHorizonte} % al ${m.horizonte} · nunca compra ${m.curva.nuncaCompraPct} %`);
  l(`  Mitad de las compras al día ${m.curva.diaMitadCompras ?? '—'} · 8 de cada 10 al día ${m.curva.diaOchoDeDiez ?? '—'}`);
  l(`  Últimos 30 días suben ${m.curva.subidaUltimos30} puntos (${m.curva.seAplana ? 'se aplana' : 'todavía sube'}) · seguimiento completo ${m.seguimiento.conSeguimientoCompletoPct} %`);
  l();
  l('Repetidos y pérdida');
  l(`  Mismo ID CRM en varios leads: ${m.repetidos.mismoIdCrm.personas} personas (${m.repetidos.mismoIdCrm.leads} leads) · mismo teléfono: ${m.repetidos.mismoTelefono.personas} (${m.repetidos.mismoTelefono.leads}) · mismo VIN: ${m.repetidos.mismoVinEnVariosLeads.personas}`);
  l(`  Perdidos en la hoja: ${m.perdida.perdidosEnHoja} · con fecha de pérdida en el ciclo CRM: ${m.perdida.conFechaPct} %`);
  l(`  Citas asistidas con fecha: ${m.hitos.citasConFechaPct} % · pruebas que cruzan: ${m.hitos.pruebas.disponible ? `${m.hitos.pruebas.cruzanPct} %` : 'sin tabla'} · solicitudes que cruzan: ${m.hitos.solicitudes.disponible ? `${m.hitos.solicitudes.cruzanPct} %` : 'sin tabla'}`);
  l();
  l(`Llenado de columnas: ${Object.entries(m.llenadoPct).map(([k, v]) => `${k} ${v} %`).join(' · ')}`);
  l('Factores (niveles con ≥10 compras / niveles):');
  for (const [k, f] of Object.entries(m.factores)) l(`  ${k}: ${f.nivelesLegibles}/${f.niveles}${f.sinDatoPct ? ` · sin dato ${f.sinDatoPct} %` : ''}`);
  l('Riesgos proporcionales (razón antes/después del día 30):');
  for (const [k, r] of Object.entries(m.riesgosProporcionales)) {
    l(`  ${k}: ${r.evaluables ? `${r.violaciones} de ${r.evaluables} niveles no cumplen (base ${r.base})` : 'sin compras suficientes para probar'}`);
  }
  l();
  l('Veredicto');
  for (const v of m.veredicto) l(`  ${sello[v.estado] || '·'} ${v.modelo}: ${v.porque}`);
  l();
  l(`Detalle completo: ${path.relative(process.cwd(), OUT)}`);
}

function argumento(nombre, porOmision) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : porOmision;
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error('No está la base CRM (backend/data/crm-ciclos.db). Correr en el servidor de la oficina.');
    process.exit(1);
  }
  const horizonte = Math.max(30, Math.min(365, Number(argumento('horizonte', 180)) || 180));
  const datos = leer({ fechaFin: argumento('fechaFin', undefined), horizonte });
  const m = medir(datos, horizonte);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ generado: new Date().toISOString(), ...m }, null, 2));
  imprimir(m);
}

if (require.main === module) main();

module.exports = { meseta, riesgosProporcionales, volumenFactor, empates, veredicto, fEn };
