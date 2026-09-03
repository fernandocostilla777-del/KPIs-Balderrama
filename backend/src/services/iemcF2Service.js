/**
 * IEMC F-2 / Brecha F-2.1 vs mix objetivo del PDF (objetivos-web).
 *
 * UOᵢ = unidades objetivo del PDF (facturas por línea).
 * PLᵢ / CFᵢ = promedios desde DMS (catálogo + remisión en piso), no del PDF de planes.
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
const IVA = 1.16;
const INVENTORY_SITUATIONS = `('FIS', 'DIS', 'PED', 'PEN', 'SEP', 'DEMO', 'TRAN')`;

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
    };
    prev.unidades += 1;
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
  let ventaNetaObjetivo = 0;
  let costoObjetivo = 0;
  let lineasSinPl = 0;
  let lineasSinCf = 0;

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

    const plFuente = 'dms_catalogo';
    let cfFuente = 'dms_inventario';
    const pl = Number(dmsRefs.plByLinea[linea] || 0);
    let cf = Number(dmsRefs.cfByLinea[linea] || 0);
    if (!cf && cfVendidos[linea]) {
      cf = Number(cfVendidos[linea]);
      cfFuente = 'dms_vendidos';
    }

    const plOk = Number.isFinite(pl) && pl > 0;
    const cfOk = Number.isFinite(cf) && cf > 0;
    if (uo > 0 && !plOk) lineasSinPl += 1;
    if (uo > 0 && !cfOk) lineasSinCf += 1;

    const montoVenta = plOk ? roundMoney(uo * pl) : 0;
    const montoCosto = cfOk ? roundMoney(uo * cf) : 0;
    const ubaObj = plOk && cfOk ? roundMoney(montoVenta - montoCosto) : null;
    if (plOk && cfOk) {
      unidadesObjetivo += Number(uo) || 0;
      ventaNetaObjetivo += montoVenta;
      costoObjetivo += montoCosto;
    }

    const real = realByLinea.get(linea) || { unidades: 0, ventaNeta: 0, costoFactura: 0, uba: 0, conUba: 0 };
    mixRows.push({
      linea,
      familia: item.familia || null,
      uo: Number(uo) || 0,
      pl: plOk ? roundMoney(pl) : null,
      cf: cfOk ? roundMoney(cf) : null,
      plFuente: plOk ? plFuente : (uo > 0 ? 'faltante' : plFuente),
      cfFuente: cfOk ? cfFuente : (uo > 0 ? 'faltante' : cfFuente),
      ventaObjetivo: plOk ? montoVenta : null,
      costoObjetivo: cfOk ? montoCosto : null,
      ubaObjetivo: ubaObj,
      unidadesReales: real.unidades,
      ventaNetaReal: roundMoney(real.ventaNeta),
      ubaReal: roundMoney(real.uba),
    });
  }

  const ubaObjetivoMix = roundMoney(ventaNetaObjetivo - costoObjetivo);
  const margenBrutoReal = pctOrNull(ubaReal, ventaNetaReal);
  const margenBrutoObjetivo = pctOrNull(ubaObjetivoMix, ventaNetaObjetivo);
  const iemc = margenBrutoReal != null && margenBrutoObjetivo != null && margenBrutoObjetivo !== 0
    ? round1((margenBrutoReal / margenBrutoObjetivo) * 100)
    : null;
  const brecha = mixDisponible && ventaNetaObjetivo > 0
    ? roundMoney(ubaReal - ubaObjetivoMix)
    : null;

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
    },
    real: {
      unidades: (vendidosTable || []).length,
      unidadesConUba,
      unidadesSinUba,
      ventaNeta: roundMoney(ventaNetaReal),
      uba: roundMoney(ubaReal),
      margenBrutoPct: margenBrutoReal,
    },
    objetivo: {
      unidades: unidadesObjetivo,
      ventaNeta: roundMoney(ventaNetaObjetivo),
      costoFactura: roundMoney(costoObjetivo),
      uba: ubaObjetivoMix,
      margenBrutoPct: margenBrutoObjetivo,
      lineasSinPl,
      lineasSinCf,
    },
    iemcPct: iemc,
    brecha,
    mix: mixRows,
    otrasLineasReales: otras,
    notas: [
      'UOᵢ = facturas objetivo del PDF (mix fijo de planta).',
      'PLᵢ = promedio s/IVA de precio lista en DMS (UNC_PrecListaPub / PRECLISTA / VEH_VENTA) por línea PDF, sobre unidades en piso.',
      'CFᵢ = promedio de costo neto remisión (valor unidad − bono planta) por línea PDF, sobre unidades en piso; si no hay piso, respaldo con ventas del mes.',
      'El denominador objetivo es venta neta del mix (UO × PL), no las unidades realmente vendidas.',
      'Comisión E.V., gastos extra y plan piso no entran a F-2.',
    ],
  };
}

module.exports = {
  computeIemcF2,
  loadMixStore,
};
