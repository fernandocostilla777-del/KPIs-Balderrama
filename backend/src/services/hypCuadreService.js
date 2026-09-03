/**
 * Servicio del Cuadre de Órdenes HyP (cuadreOrdenesHyp).
 * Consulta cuadre: Contpaq MOVDET ↔ DMS (sub sin IVA).
 * Cuentas 0470 MO, 0476 TOT, 0477 RE, 0479 pintura/materiales.
 * Punto de entrada canónico: require('./cuadreOrdenesHyp')
 */

const { query } = require('../db');
const { cuadreFromMovdet, emptyPorCuenta } = require('../../scripts/lib/hypMovdetMatch');
const { contpaqPorCuenta, CUENTA_LABEL, fmt } = require('../../scripts/lib/hypCuadraLogic');
const { generarConsultas } = require('../../scripts/lib/hypCuadreQueries');

const CUENTAS = ['0470', '0476', '0477', '0479'];

function parseRango(fechaInicio, fechaFin) {
  const fi = fechaInicio || new Date().toISOString().slice(0, 8) + '01';
  const ff = fechaFin || fi;
  const d1 = new Date(`${fi}T12:00:00`);
  const d2 = new Date(`${ff}T12:00:00`);
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) {
    const err = new Error('fechas inválidas; use YYYY-MM-DD');
    err.status = 400;
    throw err;
  }
  if (d2 < d1) {
    const err = new Error('fechaFin debe ser >= fechaInicio');
    err.status = 400;
    throw err;
  }
  return { fechaInicio: fi, fechaFin: ff };
}

function buildResumenCuentas(contTargets, totDms, stats) {
  return CUENTAS.map((cuenta) => ({
    cuenta,
    label: CUENTA_LABEL[cuenta],
    contpaq: Number(contTargets[cuenta] || 0),
    dms: Number(totDms[cuenta] || 0),
    diferencia: Number(contTargets[cuenta] || 0) - Number(totDms[cuenta] || 0),
    lineas: stats[cuenta] || 0,
  }));
}

function buildFacturas(byFac) {
  return byFac
    .filter((f) => Math.abs(f.neto) > 0.01)
    .map((f) => ({
      orden: f.orden,
      docto: f.docto,
      st: f.st,
      letra: f.letra,
      vin: f.vin || null,
      cierre: f.cierre || null,
      facFecha: f.facFecha || null,
      porCuenta: { ...f.porCuenta },
      neto: f.neto,
    }));
}

function buildTextoReporte(payload) {
  const { periodo, resumen, vinsUnicos, facturas, sinMatch } = payload;
  const out = [];
  out.push(`CUADRE HyP MOVDET↔DMS · ${periodo.fechaInicio} a ${periodo.fechaFin}`);
  out.push(`Facturas: ${facturas.length} | Doctos CP: ${resumen.doctosCp} | Órdenes: ${resumen.ordenes}`);
  out.push(`VINs únicos: ${vinsUnicos.length}`);
  out.push('');
  out.push('### VINs ÚNICOS');
  for (const v of vinsUnicos) out.push(v);
  out.push('');

  for (const c of resumen.cuentas) {
    out.push(`### ${c.cuenta} — ${c.label}`);
    out.push(`Contpaq $${fmt(c.contpaq)} | DMS $${fmt(c.dms)} | Dif $${fmt(c.diferencia)}`);
    const list = facturas
      .filter((f) => Math.abs(f.porCuenta[c.cuenta]) > 0.01)
      .sort((a, b) => b.porCuenta[c.cuenta] - a.porCuenta[c.cuenta]);
    out.push(`Registros (${list.length}):`);
    for (const f of list) {
      out.push(`${f.orden}|${f.docto}|${f.letra}|${f.vin}|${f.cierre}|${f.st}|$${fmt(f.porCuenta[c.cuenta])}|neto $${fmt(f.neto)}`);
    }
    out.push('');
  }

  if (sinMatch.length) {
    out.push('### SIN MATCH DMS');
    for (const u of sinMatch.slice(0, 100)) {
      out.push(`${u.cuenta}|${u.orden}|${u.docto}|${u.tipo}|$${fmt(u.net)}|${u.comp}`);
    }
    out.push('');
  }

  out.push('### MATRIZ ORDEN+FACTURA');
  out.push('orden|factura|st|0470|0476|0477|0479|neto');
  for (const f of facturas) {
    out.push(`${f.orden}|${f.docto}|${f.st}|$${fmt(f.porCuenta['0470'])}|$${fmt(f.porCuenta['0476'])}|$${fmt(f.porCuenta['0477'])}|$${fmt(f.porCuenta['0479'])}|$${fmt(f.neto)}`);
  }
  return out.join('\n');
}

/**
 * Ejecuta el cuadre HyP completo.
 * @param {{ fechaInicio: string, fechaFin: string, incluirSql?: boolean }} opts
 */
async function consultarCuadreHyp(opts = {}) {
  const { fechaInicio, fechaFin } = parseRango(opts.fechaInicio, opts.fechaFin);

  const [cuadre, cpq] = await Promise.all([
    cuadreFromMovdet(query, fechaInicio, fechaFin),
    contpaqPorCuenta(query, fechaInicio, fechaFin),
  ]);

  const contTargets = { ...emptyPorCuenta(), ...cpq.byPrefix };
  for (const c of CUENTAS) {
    if (Math.abs(cuadre.totCp[c]) > 0.01) contTargets[c] = cuadre.totCp[c];
  }

  const facturas = buildFacturas(cuadre.byFac);
  const ordenes = new Set(facturas.map((f) => f.orden));
  const vinsUnicos = cuadre.vinsCp?.length
    ? cuadre.vinsCp
    : [...new Set(facturas.map((f) => f.vin).filter(Boolean))].sort();

  const cuentas = buildResumenCuentas(contTargets, cuadre.totDms, cuadre.stats);
  const totalContpaq = cuentas.reduce((a, c) => a + c.contpaq, 0);
  const totalDms = cuentas.reduce((a, c) => a + c.dms, 0);

  const doctos = [...new Set(facturas.map((f) => f.docto))];
  const payload = {
    periodo: { fechaInicio, fechaFin },
    resumen: {
      totalContpaq,
      totalDms,
      diferencia: totalContpaq - totalDms,
      facturas: facturas.length,
      doctosCp: cuadre.doctosCp || doctos.length,
      ordenes: ordenes.size,
      vinsUnicos: vinsUnicos.length,
      cuentas,
      lineasSinMatch: cuadre.unmatched.length,
    },
    vinsUnicos,
    facturas,
    sinMatch: cuadre.unmatched.map((u) => ({
      cuenta: u.cuenta,
      orden: u.orden,
      docto: u.docto,
      tipo: u.tipo,
      net: u.net,
      comp: u.comp,
    })),
  };

  if (opts.incluirSql) {
    payload.sql = generarConsultas(fechaInicio, doctos);
  }

  payload.texto = buildTextoReporte(payload);
  return payload;
}

module.exports = {
  CUENTAS,
  consultarCuadreHyp,
  buildTextoReporte,
  generarConsultas,
};
