/**
 * IEMC F-1 / F-2 vs mix objetivo del PDF (objetivos-web).
 *
 * UOᵢ = unidades objetivo del PDF (facturas por línea).
 * PLᵢ (F-1) = precio lleno guía Planes Chevrolet (promedio MSRP por carline; con IVA).
 *   No se supone bonificación de crédito en el objetivo.
 * CFᵢ (F-2 margen) = costo neto DMS; PL s/IVA para emparejar con CF.
 */

const fs = require('fs');
const path = require('path');
const { query } = require('../db');
const {
  getPlantillaMetas,
  normalizeLinea,
  normalizeLineaTrafico,
} = require('./objetivosResultadosService');

const MIX_FILE = path.join(__dirname, '../../data/mixObjetivo.json');
const PLANES_FILE = path.join(__dirname, '../../data/planes-chevrolet-ago-my26.json');
const IVA = 1.16;
const INVENTORY_SITUATIONS = `('FIS', 'DIS', 'PED', 'PEN', 'SEP', 'DEMO', 'TRAN')`;

/** Mapeo línea plantilla PDF → modelo de la guía de planes. */
const LINEA_TO_GUIA = {
  'Aveo HB': 'AVEO HB',
  'Aveo NB': 'AVEO NB',
  Onix: 'ONIX',
  Tracker: 'TRACKER',
  Trax: 'TRAX',
  Captiva: 'CAPTIVA',
  Groove: 'GROOVE NG',
  Traverse: 'TRAVERSE',
  Tahoe: 'TAHOE',
  Suburban: 'SUBURBAN',
  'Blazer EV': 'BLAZER EV',
  'Spark EUV': 'SPARK EUV',
  'Captiva PHEV SUV': 'CAPTIVA HIBRIDA',
  Colorado: 'COLORADO',
  'Silverado / Cheyenne Crew Cab': 'SILVERADO',
  'S10 MAX Chassis Cab': 'S10 MAX',
  'S10 MAX Crew Cab': 'S10 MAX',
  'S10 MAX Regular Cab': 'S10 MAX',
  Montana: 'MONTANA',
  'Tornado Van': 'TORNADO VAN',
  'Express Max': 'EXPRESS MAX EV',
};
function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function round1(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.round(x * 10) / 10;
}

function periodKeyFromRange(fechaInicio) {
  return String(fechaInicio || '').slice(0, 7);
}

function emptyStore() {
  return { updatedAt: null, updatedBy: null, months: {} };
}

function loadMixStore() {
  try {
    if (!fs.existsSync(MIX_FILE)) return emptyStore();
    const parsed = JSON.parse(fs.readFileSync(MIX_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return emptyStore();
    return {
      updatedAt: parsed.updatedAt || null,
      updatedBy: parsed.updatedBy || null,
      months: parsed.months && typeof parsed.months === 'object' ? parsed.months : {},
    };
  } catch {
    return emptyStore();
  }
}

function sinIva(montoConIva) {
  const n = Number(montoConIva);
  if (!Number.isFinite(n) || n === 0) return 0;
  return roundMoney(n / IVA);
}

function conIva(montoSinIva) {
  const n = Number(montoSinIva);
  if (!Number.isFinite(n) || n === 0) return 0;
  return roundMoney(n * IVA);
}

/**
 * PL lleno por carline desde guía Planes Chevrolet (MSRP promedio versión barata → equipada).
 * @returns {Record<string, { plConIva: number, plSinIva: number, min: number, max: number, n: number }>}
 */
function loadGuiaPlByLinea() {
  const out = {};
  try {
    if (!fs.existsSync(PLANES_FILE)) return out;
    const parsed = JSON.parse(fs.readFileSync(PLANES_FILE, 'utf8'));
    const rows = parsed?.sections?.administracion?.rows || [];
    const byModelo = new Map();
    for (const r of rows) {
      const modelo = String(r.modelo || '').trim().toUpperCase();
      const msrp = Number(r.msrp || 0);
      if (!modelo || !(msrp > 0)) continue;
      const prev = byModelo.get(modelo) || { sum: 0, n: 0, min: msrp, max: msrp };
      prev.sum += msrp;
      prev.n += 1;
      prev.min = Math.min(prev.min, msrp);
      prev.max = Math.max(prev.max, msrp);
      byModelo.set(modelo, prev);
    }
    for (const [linea, modeloGuia] of Object.entries(LINEA_TO_GUIA)) {
      const agg = byModelo.get(String(modeloGuia).toUpperCase());
      if (!agg || !agg.n) continue;
      const plConIva = Math.round(agg.sum / agg.n);
      out[linea] = {
        plConIva,
        plSinIva: sinIva(plConIva),
        min: agg.min,
        max: agg.max,
        n: agg.n,
        modeloGuia,
      };
    }
  } catch {
    /* sin guía: F-1 cae a PL DMS */
  }
  return out;
}

function pdfLineaFromTipoAuto(tipoAuto, familia, catalogSet) {
  const tipo = String(tipoAuto || '').trim();
  const fam = String(familia || '').trim();
  if (!tipo && !fam) return null;
  if (catalogSet && catalogSet.size) {
    return resolveVendidoLinea({ version: tipo, carline: fam }, catalogSet);
  }
  return normalizeLineaTrafico(tipo || fam, tipo);
}

function aggregateByLinea(rows, valueKey, catalogSet) {
  const byLinea = new Map();
  for (const row of rows || []) {
    const linea = pdfLineaFromTipoAuto(row.tipoAuto, row.familia, catalogSet);
    const value = Number(row[valueKey] || 0);
    if (!linea || value <= 0) continue;
    const prev = byLinea.get(linea) || { sum: 0, n: 0 };
    prev.sum += value;
    prev.n += 1;
    byLinea.set(linea, prev);
  }
  const out = {};
  for (const [linea, agg] of byLinea.entries()) {
    out[linea] = agg.n ? roundMoney(agg.sum / agg.n) : null;
  }
  return out;
}

/**
 * PL y CF desde DMS: unidades en piso con catálogo y remisión.
 * PL = UNC_PrecListaPub / UNC_PRECLISTA (÷ 1.16).
 * CF = valor de unidad en remisión − bono planta (s/IVA, como costo neto vendidos).
 */
async function loadDmsMixRefs(catalogSet) {
  const rows = await query(`
    SELECT
      LTRIM(RTRIM(ISNULL(veh.VEH_TIPOAUTO, ''))) AS tipoAuto,
      UPPER(LTRIM(RTRIM(ISNULL(NULLIF(cat.UNC_FAMILIA, ''), '')))) AS familia,
      ISNULL(cat.UNC_PrecListaPub, ISNULL(cat.UNC_PRECLISTA, ISNULL(veh.VEH_VENTA, 0))) AS precioLista,
      MAX(
        CASE
          WHEN UPPER(LTRIM(RTRIM(ISNULL(vd.VHD_DESCRIPCION, '')))) LIKE 'VALOR DE UNIDAD%'
            OR UPPER(LTRIM(RTRIM(ISNULL(vd.VHD_DESCRIPCION, '')))) LIKE 'VALOR DE LA UNIDAD%'
            OR UPPER(LTRIM(RTRIM(ISNULL(vd.VHD_DESCRIPCION, '')))) LIKE 'VALOR UNIDAD%'
          THEN ISNULL(vd.VHD_COSTO, 0)
          ELSE NULL
        END
      ) AS valorUnidad,
      SUM(
        CASE
          WHEN UPPER(LTRIM(RTRIM(ISNULL(vd.VHD_TIPO, '')))) = 'BON'
            OR UPPER(LTRIM(RTRIM(ISNULL(vd.VHD_DESCRIPCION, '')))) LIKE '%BONIFICACION%'
          THEN ISNULL(vd.VHD_COSTO, 0)
          ELSE 0
        END
      ) AS bonificacion
    FROM SER_VEHICULO veh
    INNER JOIN UNI_CATALOGO cat
      ON cat.UNC_MODELO = veh.VEH_ANMODELO
      AND cat.UNC_IDCATALOGO = veh.VEH_CATALOGO
    LEFT JOIN UNI_VEHDETA vd ON vd.VHD_NOSERIE = veh.VEH_NUMSERIE
    WHERE veh.VEH_SITUACION IN ${INVENTORY_SITUATIONS}
      AND veh.VEH_NOINVENTA > 0
    GROUP BY
      veh.VEH_NUMSERIE,
      veh.VEH_TIPOAUTO,
      cat.UNC_FAMILIA,
      cat.UNC_PrecListaPub,
      cat.UNC_PRECLISTA,
      veh.VEH_VENTA
  `);

  const plRows = [];
  const cfRows = [];
  for (const row of rows || []) {
    const precioLista = Number(row.precioLista || 0);
    if (precioLista > 0) {
      plRows.push({
        tipoAuto: row.tipoAuto,
        familia: row.familia,
        pl: sinIva(precioLista),
      });
    }
    const valor = Number(row.valorUnidad || 0);
    if (valor > 0) {
      const bonif = Math.abs(Number(row.bonificacion || 0) || 0);
      cfRows.push({
        tipoAuto: row.tipoAuto,
        familia: row.familia,
        cf: roundMoney(valor - bonif),
      });
    }
  }

  return {
    plByLinea: aggregateByLinea(plRows, 'pl', catalogSet),
    cfByLinea: aggregateByLinea(cfRows, 'cf', catalogSet),
    unidadesPiso: rows?.length || 0,
  };
}

function buildCfFromVendidos(vendidosTable, catalogSet) {
  const rows = [];
  for (const row of vendidosTable || []) {
    const linea = catalogSet.size
      ? resolveVendidoLinea(row, catalogSet)
      : normalizeLinea(row.version || row.carline);
    const costo = Number(row.costo || 0);
    const bonif = Number(row.bonificacion || 0);
    const cf = costo || bonif ? roundMoney(costo - bonif) : 0;
    if (!cf) continue;
    rows.push({
      tipoAuto: row.version || row.carline,
      familia: row.carline,
      cf,
      lineaPdf: linea,
    });
  }
  const byLinea = new Map();
  for (const row of rows) {
    const linea = row.lineaPdf;
    const prev = byLinea.get(linea) || { sum: 0, n: 0 };
    prev.sum += row.cf;
    prev.n += 1;
    byLinea.set(linea, prev);
  }
  const out = {};
  for (const [linea, agg] of byLinea.entries()) {
    out[linea] = agg.n ? roundMoney(agg.sum / agg.n) : null;
  }
  return out;
}

function resolveVendidoLinea(row, catalogSet) {
  const fromVersion = normalizeLinea(row.version);
  if (catalogSet.has(fromVersion)) return fromVersion;
  const fromCarline = normalizeLinea(row.carline);
  if (catalogSet.has(fromCarline)) return fromCarline;
  const hay = `${row.version || ''} ${row.carline || ''}`.toUpperCase();
  for (const linea of catalogSet) {
    const key = String(linea).toUpperCase();
    if (key.length >= 5 && hay.includes(key)) return linea;
  }
  return fromVersion || fromCarline || '(sin modelo)';
}

function pctOrNull(part, total) {
  const p = Number(part);
  const t = Number(total);
  if (!Number.isFinite(p) || !Number.isFinite(t) || t === 0) return null;
  return round1((p / t) * 100);
}

async function computeIemcF2({ fechaInicio, fechaFin, vendidosTable = [] } = {}) {
  const plantilla = getPlantillaMetas({ fechaInicio, fechaFin });
  const periodo = periodKeyFromRange(fechaInicio);
  const store = loadMixStore();
  const monthOverride = store.months?.[periodo] || {};
  const overrideLineas = monthOverride.lineas && typeof monthOverride.lineas === 'object'
    ? monthOverride.lineas
    : {};

  const pdfLineas = Array.isArray(plantilla.lineasProducto) ? plantilla.lineasProducto : [];
  const mixDisponible = Boolean(plantilla.aplicadaAlPeriodo) || Object.keys(overrideLineas).length > 0;

  const catalogLineas = mixDisponible
    ? (plantilla.aplicadaAlPeriodo
      ? pdfLineas.map((l) => l.linea)
      : Object.keys(overrideLineas))
    : pdfLineas.map((l) => l.linea);
  const catalogSet = new Set(catalogLineas);

  const dmsRefs = await loadDmsMixRefs(catalogSet).catch(() => ({
    plByLinea: {},
    cfByLinea: {},
    unidadesPiso: 0,
  }));
  const guiaPl = loadGuiaPlByLinea();
  const cfVendidos = buildCfFromVendidos(vendidosTable, catalogSet);

  const realByLinea = new Map();
  let ventaNetaReal = 0;
  let ubaReal = 0;
  let unidadesConUba = 0;
  let unidadesSinUba = 0;

  for (const row of vendidosTable || []) {
    const linea = catalogSet.size ? resolveVendidoLinea(row, catalogSet) : normalizeLinea(row.version || row.carline);
    const subtotal = Number(row.precio || 0) || 0;
    const utilidad = row.utilidadPromedio == null ? null : Number(row.utilidadPromedio);
    const costo = Number(row.costo || 0) || 0;
    const bonif = Number(row.bonificacion || 0) || 0;
    const costoNeto = costo || bonif ? roundMoney(costo - bonif) : 0;
    const prev = realByLinea.get(linea) || {
      linea,
      unidades: 0,
      ventaNeta: 0,
      costoFactura: 0,
      uba: 0,
      conUba: 0,
      bonificacion: 0,
    };
    prev.unidades += 1;
    prev.bonificacion += Math.abs(bonif) || 0;
    if (utilidad == null || subtotal <= 0) {
      unidadesSinUba += 1;
      realByLinea.set(linea, prev);
      continue;
    }
    prev.ventaNeta += subtotal;
    prev.costoFactura += costoNeto;
    prev.uba += utilidad;
    prev.conUba += 1;
    realByLinea.set(linea, prev);
    ventaNetaReal += subtotal;
    ubaReal += utilidad;
    unidadesConUba += 1;
  }

  const mixRows = [];
  let unidadesObjetivo = 0;
  let unidadesObjetivoTotal = 0;
  let ventaNetaObjetivo = 0; // F-1 MOV a PL lleno (c/IVA guía)
  let ventaNetaObjetivoSinIva = 0; // para margen F-2
  let ventaNetaObjetivoConCf = 0;
  let ventaRealAPl = 0; // F-1 MVR* = Σ(UR × PL lleno)
  let ventaRealAPlSinIva = 0;
  let costoObjetivo = 0;
  let lineasSinPl = 0;
  let lineasSinCf = 0;
  let lineasConMonto = 0;
  let bonificacionReal = 0;

  const lineasFuente = plantilla.aplicadaAlPeriodo
    ? pdfLineas
    : catalogLineas.map((linea) => ({
      linea,
      familia: overrideLineas[linea]?.familia || null,
      facturas: Number(overrideLineas[linea]?.uo || 0) || 0,
    }));

  for (const item of lineasFuente) {
    const linea = item.linea;
    const ov = overrideLineas[linea] || {};
    const uo = ov.uo != null && ov.uo !== '' ? Number(ov.uo) : Number(item.facturas || 0);
    unidadesObjetivoTotal += Number(uo) || 0;

    const guia = guiaPl[linea] || null;
    let plFuente = 'guia_planes';
    let cfFuente = 'dms_inventario';
    // PL lleno (c/IVA) para F-1; s/IVA para emparejar CF en F-2
    let plConIva = guia ? Number(guia.plConIva) : 0;
    let plSinIva = guia ? Number(guia.plSinIva) : 0;
    if (!(plConIva > 0)) {
      const dmsPl = Number(dmsRefs.plByLinea[linea] || 0);
      if (dmsPl > 0) {
        plSinIva = dmsPl;
        plConIva = conIva(dmsPl);
        plFuente = 'dms_catalogo';
      }
    }
    let cf = Number(dmsRefs.cfByLinea[linea] || 0);
    if (!cf && cfVendidos[linea]) {
      cf = Number(cfVendidos[linea]);
      cfFuente = 'dms_vendidos';
    }

    const plOk = Number.isFinite(plConIva) && plConIva > 0;
    const cfOk = Number.isFinite(cf) && cf > 0;
    if (uo > 0 && !plOk) lineasSinPl += 1;
    if (uo > 0 && !cfOk) lineasSinCf += 1;

    const montoVentaF1 = plOk ? roundMoney(uo * plConIva) : 0;
    const montoVentaSinIva = plOk ? roundMoney(uo * plSinIva) : 0;
    const montoCosto = cfOk ? roundMoney(uo * cf) : 0;
    const ubaObj = plOk && cfOk ? roundMoney(montoVentaSinIva - montoCosto) : null;

    // F-1 MOV = Σ(UO × PL lleno guía); no supone bonificación de crédito
    if (uo > 0 && plOk) {
      unidadesObjetivo += Number(uo) || 0;
      ventaNetaObjetivo += montoVentaF1;
      ventaNetaObjetivoSinIva += montoVentaSinIva;
      lineasConMonto += 1;
    }
    // F-2 margen: solo líneas con PL y CF (s/IVA)
    if (uo > 0 && plOk && cfOk) {
      ventaNetaObjetivoConCf += montoVentaSinIva;
      costoObjetivo += montoCosto;
    }

    const real = realByLinea.get(linea) || {
      unidades: 0, ventaNeta: 0, costoFactura: 0, uba: 0, conUba: 0, bonificacion: 0,
    };
    const ur = Number(real.unidades) || 0;
    const ventaAPlLinea = plOk ? roundMoney(ur * plConIva) : 0;
    const ventaAPlSinIvaLinea = plOk ? roundMoney(ur * plSinIva) : 0;
    if (plOk && ur > 0) {
      ventaRealAPl += ventaAPlLinea;
      ventaRealAPlSinIva += ventaAPlSinIvaLinea;
    }
    bonificacionReal += Number(real.bonificacion) || 0;

    mixRows.push({
      linea,
      familia: item.familia || null,
      uo: Number(uo) || 0,
      pl: plOk ? roundMoney(plConIva) : null,
      plSinIva: plOk ? roundMoney(plSinIva) : null,
      cf: cfOk ? roundMoney(cf) : null,
      plFuente: plOk ? plFuente : (uo > 0 ? 'faltante' : plFuente),
      cfFuente: cfOk ? cfFuente : (uo > 0 ? 'faltante' : cfFuente),
      ventaObjetivo: plOk ? montoVentaF1 : null,
      costoObjetivo: cfOk ? montoCosto : null,
      ubaObjetivo: ubaObj,
      unidadesReales: ur,
      ventaNetaReal: roundMoney(real.ventaNeta),
      ventaAPlReal: plOk ? ventaAPlLinea : null,
      ubaReal: roundMoney(real.uba),
      bonificacion: roundMoney(real.bonificacion || 0),
    });
  }

  const ubaObjetivoMix = roundMoney(ventaNetaObjetivoConCf - costoObjetivo);
  const margenBrutoReal = pctOrNull(ubaReal, ventaNetaReal);
  const margenBrutoObjetivo = pctOrNull(ubaObjetivoMix, ventaNetaObjetivoConCf);
  const iemc = margenBrutoReal != null && margenBrutoObjetivo != null && margenBrutoObjetivo !== 0
    ? round1((margenBrutoReal / margenBrutoObjetivo) * 100)
    : null;
  const brecha = mixDisponible && ventaNetaObjetivoConCf > 0
    ? roundMoney(ubaReal - ubaObjetivoMix)
    : null;

  // Efecto precio/bonificación: factura (s/IVA) vs valuación a PL lleno s/IVA
  const efectoBonificacion = ventaRealAPlSinIva > 0
    ? roundMoney(ventaNetaReal - ventaRealAPlSinIva)
    : null;
  const realizacionPrecioPct = pctOrNull(ventaNetaReal, ventaRealAPlSinIva);

  const otras = [];
  for (const [linea, real] of realByLinea.entries()) {
    if (catalogSet.has(linea)) continue;
    if (!real.unidades) continue;
    otras.push({
      linea,
      unidadesReales: real.unidades,
      ventaNetaReal: roundMoney(real.ventaNeta),
      ubaReal: roundMoney(real.uba),
    });
  }
  otras.sort((a, b) => b.unidadesReales - a.unidadesReales || a.linea.localeCompare(b.linea));

  return {
    clave: 'F-2',
    periodo,
    fechaInicio,
    fechaFin,
    plantilla: {
      id: plantilla.plantillaId || null,
      label: plantilla.label || null,
      aplicadaAlPeriodo: Boolean(plantilla.aplicadaAlPeriodo),
      fuente: plantilla.aplicadaAlPeriodo ? 'pdf_objetivos' : (Object.keys(overrideLineas).length ? 'captura' : 'sin_mix'),
    },
    mixDisponible,
    incompleto: Boolean(mixDisponible && (lineasSinPl || lineasSinCf || !ventaNetaObjetivo)),
    dms: {
      unidadesPiso: dmsRefs.unidadesPiso,
      lineasPl: Object.keys(dmsRefs.plByLinea || {}).length,
      lineasCf: Object.keys(dmsRefs.cfByLinea || {}).length,
      lineasGuiaPl: Object.keys(guiaPl).length,
      plPromedio: (() => {
        const pls = Object.values(guiaPl).map((g) => Number(g.plConIva)).filter((n) => n > 0);
        if (!pls.length) {
          const dms = Object.values(dmsRefs.plByLinea || {}).map(Number).filter((n) => Number.isFinite(n) && n > 0);
          if (!dms.length) return null;
          return roundMoney(dms.reduce((a, b) => a + b, 0) / dms.length);
        }
        return roundMoney(pls.reduce((a, b) => a + b, 0) / pls.length);
      })(),
    },
    real: {
      unidades: (vendidosTable || []).length,
      unidadesConUba,
      unidadesSinUba,
      ventaNeta: roundMoney(ventaNetaReal),
      /** Valuación a PL lleno (c/IVA) — numerador F-1 homogéneo con MOV */
      ventaAPl: roundMoney(ventaRealAPl),
      ventaAPlSinIva: roundMoney(ventaRealAPlSinIva),
      bonificacion: roundMoney(bonificacionReal),
      efectoBonificacion,
      realizacionPrecioPct,
      uba: roundMoney(ubaReal),
      margenBrutoPct: margenBrutoReal,
    },
    objetivo: {
      unidades: unidadesObjetivo || unidadesObjetivoTotal,
      unidadesConPl: unidadesObjetivo,
      /** MOV F-1 = Σ(UO × PL lleno guía, c/IVA) */
      ventaNeta: roundMoney(ventaNetaObjetivo),
      ventaNetaSinIva: roundMoney(ventaNetaObjetivoSinIva),
      costoFactura: roundMoney(costoObjetivo),
      uba: ubaObjetivoMix,
      margenBrutoPct: margenBrutoObjetivo,
      lineasSinPl,
      lineasSinCf,
      lineasConMonto,
      ventaNetaConCosto: roundMoney(ventaNetaObjetivoConCf),
    },
    iemcPct: iemc,
    brecha,
    mix: mixRows,
    otrasLineasReales: otras,
    notas: [
      'UOᵢ = facturas objetivo del PDF (mix fijo de planta).',
      'PLᵢ F-1 = precio lleno guía Planes Chevrolet (MSRP promedio por carline, c/IVA). No incluye bonificación de crédito.',
      'F-1 = Σ(UR × PL) ÷ Σ(UO × PL) × 100 — ambos a precio lleno; la factura con bono no entra al numerador.',
      'Efecto bonificación/precio = venta facturada − Σ(UR × PL s/IVA); se reporta en F-2, no en F-1.',
      'CFᵢ = promedio de costo neto remisión (valor unidad − bono planta) por línea PDF.',
      'F-2 margen solo usa líneas con PL y CF. Comisión E.V., gastos extra y plan piso no entran a F-2.',
    ],
  };
}

module.exports = {
  computeIemcF2,
  loadMixStore,
  loadGuiaPlByLinea,
  LINEA_TO_GUIA,
};
