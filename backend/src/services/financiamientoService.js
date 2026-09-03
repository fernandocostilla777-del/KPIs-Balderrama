/**
 * Dashboard de Financiamiento (F&I) para Ventas.
 * Fuente principal: crm_financiamiento / crm_solicitudes (SQLite CRM).
 * Complemento DMS: mix crédito/contado vía /api/ventas (porTipoVentaRetail en el cliente).
 */
const crm = require('./crmCiclosService');

const PVA_DEFS = [
  { key: 'gap', label: 'GAP', col: 'gap_monto' },
  { key: 'garantia', label: 'Garantía extendida', col: 'garantia_extendida_monto' },
  { key: 'accesorios', label: 'Accesorios', col: 'accesorios_monto' },
  { key: 'onstar', label: 'OnStar', col: 'onstar_monto' },
  { key: 'mantenimiento', label: 'Mantenimientos', col: 'mantenimiento_integrado_monto' },
];

const CONTADO_TIPOS = new Set(['CONTADO']);
const EXCLUDE_TIPOS = new Set(['FLOTILLA', 'PERDIDA']);

function avg(nums) {
  const list = (nums || []).filter((n) => Number.isFinite(n));
  if (!list.length) return null;
  return list.reduce((a, b) => a + b, 0) / list.length;
}

function roundMoney(n) {
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function pct(num, den) {
  if (!den) return null;
  return Math.round((Number(num || 0) / Number(den)) * 1000) / 10;
}

function inPeriod(fecha, fi, ff) {
  if (!fecha) return !fi && !ff;
  const f = toIsoDate(fecha);
  if (!f) return false;
  if (fi && f < String(fi).slice(0, 10)) return false;
  if (ff && f > String(ff).slice(0, 10)) return false;
  return true;
}

function toIsoDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const mo = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const dmy = text.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (dmy) {
    let y = dmy[3];
    if (y.length === 2) y = `20${y}`;
    return `${y}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  const n = Number(value);
  if (Number.isFinite(n) && n > 20000 && n < 60000) {
    return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
  }
  return null;
}

function rowDate(row) {
  return row.fecha_compra || row.fecha || row.fecha_timbrado || null;
}

function mapContract(row) {
  const pvas = PVA_DEFS
    .filter((def) => Number(row[def.col] || 0) > 0)
    .map((def) => ({
      key: def.key,
      label: def.label,
      monto: roundMoney(Number(row[def.col] || 0)),
    }));

  const plan2 = row.plan_2 || null;
  const especial = row.especial || null;
  const modalidad = classifyModalidad({ plan_2: plan2, especial });
  const onstarMonto = roundMoney(Number(row.onstar_monto));
  const plazoOnstar = row.plazo_onstar || null;
  const hasOnstarContrato = (Number(row.onstar_monto) || 0) > 0
    || Boolean(String(plazoOnstar || '').trim());

  return {
    id: row.id ?? null,
    fecha: rowDate(row),
    cliente: row.cliente || null,
    asesor: row.asesor || null,
    unidad: row.unidad || null,
    vin: row.vin || null,
    contrato: row.no_contrato || row.contrato || null,
    factura: row.factura || null,
    plan: row.plan || row.plan_2 || null,
    plan2,
    especial,
    modalidad,
    modalidadLabel: modalidad === 'leasing' ? 'Arrendamiento / Leasing' : 'Crédito',
    tipoCompra: row.tipo_compra || null,
    plazoMeses: Number(row.plazo_meses) || null,
    enganchePct: Number.isFinite(Number(row.enganche_pct)) ? Number(row.enganche_pct) : null,
    engancheMonto: roundMoney(Number(row.enganche_monto)),
    montoFinanciar: roundMoney(Number(row.monto_financiar)),
    comision: roundMoney(Number(row.comision)),
    mafComision: roundMoney(Number(row.maf_comision)),
    fi: row.fi || null,
    afi: row.afi || null,
    onstarMonto,
    plazoOnstar,
    hasOnstarContrato,
    pvas,
    cantidadPvas: pvas.length,
    montoPvas: roundMoney(pvas.reduce((s, p) => s + Number(p.monto || 0), 0)),
    seguroGratis: row.seguro_gratis || null,
    roboParcial: row.robo_parcial || null,
  };
}

/** LEASING / arrendamiento vs crédito tradicional (plan_2 / especial en CRM). */
function isLeasingText(...parts) {
  const t = parts.map((p) => String(p || '').toUpperCase()).join(' ');
  return /\bLEAS(ING)?\b/.test(t) || t.includes('ARREND');
}

function classifyModalidad(row = {}) {
  return isLeasingText(row.plan_2, row.plan2, row.especial, row.plan) ? 'leasing' : 'credito';
}

/** Modelos con tecnología OnStar (denominador de penetración). */
const ONSTAR_TECH_MODELS = [
  'SUBURBAN', 'TAHOE', 'SILVERADO', 'BLAZER', 'CHEYENNE',
  'COLORADO', 'MONTANA', 'TRACKER', 'TRAVERSE', 'TRAX', 'EQUINOX',
];

function isOnstarTechUnidad(unidad) {
  const u = String(unidad || '').toUpperCase().replace(/\s+/g, ' ');
  if (/\bONIX\b/.test(u)) {
    // ONIX con tecnología OnStar: excluir paquetes A y B (tolera PAQ / PAQUETE / comillas / puntos)
    if (/\b(?:MOD|PAQ(?:UETE)?)\b[\s."]*[AB]\b/.test(u)) return false;
    return true;
  }
  return ONSTAR_TECH_MODELS.some((m) => new RegExp(`\\b${m}\\b`).test(u));
}

function currentMonthBounds(refDate = new Date()) {
  const y = refDate.getFullYear();
  const m = String(refDate.getMonth() + 1).padStart(2, '0');
  const last = new Date(y, refDate.getMonth() + 1, 0).getDate();
  return {
    fechaInicio: `${y}-${m}-01`,
    fechaFin: `${y}-${m}-${String(last).padStart(2, '0')}`,
    label: `${m}/${y}`,
  };
}

const MESES_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/** Trimestre calendario (T1–T4) para una fecha de referencia. */
function currentQuarterBounds(refDate = new Date()) {
  const y = refDate.getFullYear();
  const qIndex = Math.floor(refDate.getMonth() / 3); // 0..3
  return quarterBounds(y, qIndex + 1);
}

/** Trimestre por año + número (1–4). */
function quarterBounds(anio, trimestre) {
  const y = Number(anio);
  const q = Number(trimestre);
  if (!Number.isFinite(y) || !Number.isFinite(q) || q < 1 || q > 4) {
    return currentQuarterBounds();
  }
  const qIndex = q - 1;
  const startMonth = qIndex * 3; // 0-based
  const endMonth = startMonth + 2;
  const lastDay = new Date(y, endMonth + 1, 0).getDate();
  const months = [0, 1, 2].map((i) => {
    const m = startMonth + i;
    const last = new Date(y, m + 1, 0).getDate();
    return {
      index: m,
      label: MESES_ES[m],
      key: `${y}-${String(m + 1).padStart(2, '0')}`,
      fechaInicio: `${y}-${String(m + 1).padStart(2, '0')}-01`,
      fechaFin: `${y}-${String(m + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`,
    };
  });
  return {
    trimestre: q,
    anio: y,
    key: `${y}-T${q}`,
    label: `T${q} ${y}`,
    fechaInicio: months[0].fechaInicio,
    fechaFin: `${y}-${String(endMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    months,
  };
}

/** Opciones de trimestre (más reciente primero). */
function listPvaTrimestreOpciones(refDate = new Date(), count = 8) {
  const opts = [];
  let y = refDate.getFullYear();
  let q = Math.floor(refDate.getMonth() / 3) + 1;
  for (let i = 0; i < count; i += 1) {
    opts.push({
      anio: y,
      trimestre: q,
      key: `${y}-T${q}`,
      label: `T${q} ${y}`,
    });
    q -= 1;
    if (q < 1) {
      q = 4;
      y -= 1;
    }
  }
  return opts;
}

function monthKeyFromFecha(fecha) {
  const f = String(fecha || '').slice(0, 10);
  if (!/^\d{4}-\d{2}/.test(f)) return null;
  return f.slice(0, 7);
}

/**
 * Serie mensual + acumulado (YTD del trimestre) por producto PVA.
 * @param {Array} contracts
 * @param {Date|{anio:number,trimestre:number}} refOrQuarter
 */
function buildPvaTrimestreYtd(contracts = [], refOrQuarter = new Date()) {
  const bounds = (refOrQuarter && typeof refOrQuarter === 'object' && !(refOrQuarter instanceof Date)
    && refOrQuarter.anio != null && refOrQuarter.trimestre != null)
    ? quarterBounds(refOrQuarter.anio, refOrQuarter.trimestre)
    : currentQuarterBounds(refOrQuarter instanceof Date ? refOrQuarter : new Date());
  const monthKeys = bounds.months.map((m) => m.key);

  const byMonth = Object.fromEntries(monthKeys.map((k) => [k, {
    contratos: 0,
    conPva: 0,
    gap: 0,
    garantia: 0,
    accesorios: 0,
    onstar: 0,
    mantenimiento: 0,
  }]));

  for (const c of contracts || []) {
    const mk = monthKeyFromFecha(c.fecha);
    if (!mk || !byMonth[mk]) continue;
    byMonth[mk].contratos += 1;
    if (Number(c.cantidadPvas || 0) > 0) byMonth[mk].conPva += 1;
    for (const def of PVA_DEFS) {
      if ((c.pvas || []).some((p) => p.key === def.key)) {
        byMonth[mk][def.key] += 1;
      }
    }
  }

  const seriesKeys = ['conPva', ...PVA_DEFS.map((d) => d.key)];
  const series = {};
  for (const key of seriesKeys) {
    const mensual = monthKeys.map((mk) => byMonth[mk][key] || 0);
    const acumulado = [];
    let run = 0;
    for (const n of mensual) {
      run += n;
      acumulado.push(run);
    }
    const contratosMes = monthKeys.map((mk) => byMonth[mk].contratos || 0);
    series[key] = {
      mensual,
      acumulado,
      penetracionMesPct: mensual.map((n, i) => pct(n, contratosMes[i])),
    };
  }

  return {
    ...bounds,
    labels: bounds.months.map((m) => m.label),
    series,
  };
}

/**
 * Penetración OnStar del mes en curso:
 * numerador = entregas SOFIA elegibles con contrato OnStar en Sheets (monto W / plazo X)
 * denominador = entregas SOFIA del mes con tecnología OnStar
 *   (SUBURBAN|TAHOE|ONIX sin paq A/B|SILVERADO|BLAZER|CHEYENNE|COLORADO|MONTANA|TRACKER|TRAVERSE|TRAX|EQUINOX)
 */
function dmyToIso(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function indexCrmByVin(contracts = []) {
  const map = new Map();
  for (const c of contracts || []) {
    const vin = String(c.vin || '').toUpperCase().replace(/\s+/g, '');
    if (!vin) continue;
    const prev = map.get(vin);
    if (!prev || (c.hasOnstarContrato && !prev.hasOnstarContrato)) {
      map.set(vin, c);
    }
  }
  return map;
}

function buildOnstarTechPenetracion(sofiaRows = [], crmContracts = [], boundsOrRef = new Date()) {
  const bounds = boundsOrRef && boundsOrRef.fechaInicio && boundsOrRef.fechaFin
    ? boundsOrRef
    : currentMonthBounds(boundsOrRef instanceof Date ? boundsOrRef : new Date());
  const crmByVin = indexCrmByVin(crmContracts);
  const elegibles = [];

  for (const e of sofiaRows || []) {
    const fechaIso = dmyToIso(e.FECHA_PERIODO || e.SOF_FechFact || e.VTE_FECHDOCTO || e.fecha);
    if (fechaIso && !inPeriod(fechaIso, bounds.fechaInicio, bounds.fechaFin)) continue;

    const vin = String(e.SOF_VIN || e.VTE_SERIE || e.vin || '').toUpperCase().replace(/\s+/g, '');
    if (!vin) continue;

    const crm = crmByVin.get(vin) || null;
    const unidad = e.VEH_TIPOAUTO || e.unidad || crm?.unidad || null;
    if (!isOnstarTechUnidad(unidad)) continue;

    elegibles.push({
      _kind: 'onstarTech',
      onstarElegible: true,
      fecha: fechaIso || crm?.fecha || null,
      cliente: e.CLIENTE || crm?.cliente || null,
      asesor: e.VENDEDOR || e.SOF_CveUSu || crm?.asesor || null,
      unidad,
      vin,
      factura: e.SOF_Factura || e.VTE_DOCTO || crm?.factura || null,
      contrato: crm?.contrato || null,
      plan: crm?.plan || null,
      tipoCompra: crm?.tipoCompra || e.TIPOVENTA || null,
      fi: crm?.fi || null,
      afi: crm?.afi || null,
      gerenteFi: e.GERENTE_FI || crm?.fi || 'Sin gerente F&I',
      hasOnstarContrato: Boolean(crm?.hasOnstarContrato),
      plazoOnstar: crm?.plazoOnstar || null,
      onstarMonto: crm?.onstarMonto ?? null,
      montoFinanciar: crm?.montoFinanciar ?? null,
      engancheMonto: crm?.engancheMonto ?? null,
      plazoMeses: crm?.plazoMeses ?? null,
      pvas: crm?.pvas || [],
      cantidadPvas: crm?.cantidadPvas || 0,
      SOF_VIN: e.SOF_VIN || vin,
      SOF_Factura: e.SOF_Factura || null,
      VEH_TIPOAUTO: unidad,
      FECHA_PERIODO: e.FECHA_PERIODO || null,
      fuente: 'sofia',
    });
  }

  elegibles.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
  const conContrato = elegibles.filter((c) => c.hasOnstarContrato);
  const sinContrato = elegibles.filter((c) => !c.hasOnstarContrato);

  return {
    periodo: bounds,
    fuente: 'sofia',
    totalSofiaMes: (sofiaRows || []).length,
    elegibles: elegibles.length,
    conContrato: conContrato.length,
    sinContrato: sinContrato.length,
    penetracionPct: pct(conContrato.length, elegibles.length),
    muestra: elegibles,
  };
}

function buildOnstarFromPeriodContracts(contracts = [], fechaInicio, fechaFin) {
  const label = fechaInicio && fechaFin
    ? `${String(fechaInicio).slice(5, 7)}/${String(fechaInicio).slice(0, 4)}`
    : currentMonthBounds().label;
  const elegibles = [];
  for (const c of contracts || []) {
    if (!isOnstarTechUnidad(c.unidad)) continue;
    elegibles.push({
      _kind: 'onstarTech',
      onstarElegible: true,
      fecha: c.fecha || null,
      cliente: c.cliente || null,
      asesor: c.asesor || null,
      unidad: c.unidad || null,
      vin: c.vin || null,
      factura: c.factura || null,
      contrato: c.contrato || null,
      plan: c.plan || null,
      tipoCompra: c.tipoCompra || null,
      fi: c.fi || null,
      afi: c.afi || null,
      gerenteFi: c.fi || 'Sin gerente F&I',
      hasOnstarContrato: Boolean(c.hasOnstarContrato),
      plazoOnstar: c.plazoOnstar || null,
      onstarMonto: c.onstarMonto ?? null,
      montoFinanciar: c.montoFinanciar ?? null,
      engancheMonto: c.engancheMonto ?? null,
      plazoMeses: c.plazoMeses ?? null,
      pvas: c.pvas || [],
      cantidadPvas: c.cantidadPvas || 0,
    });
  }
  const conContrato = elegibles.filter((c) => c.hasOnstarContrato);
  return {
    periodo: { fechaInicio, fechaFin, label },
    fuente: 'crm_financiamiento',
    totalSofiaMes: null,
    elegibles: elegibles.length,
    conContrato: conContrato.length,
    sinContrato: elegibles.length - conContrato.length,
    penetracionPct: pct(conContrato.length, elegibles.length),
    muestra: elegibles,
  };
}

/**
 * Essentials (PDF): OnStar del Histórico de contratos.
 * Anual = plazo 12 meses · Multianual = plazo > 12 meses.
 */
function parsePlazoOnstarMeses(plazo) {
  if (plazo == null || plazo === '') return null;
  if (Number.isFinite(Number(plazo))) return Number(plazo);
  const m = String(plazo).match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

function buildEssentialsFromContracts(contracts = []) {
  const onstar = (contracts || []).filter((c) => c.hasOnstarContrato);
  let anual = 0;
  let multianual = 0;
  let sinPlazo = 0;
  const porPlazo = new Map();

  for (const c of onstar) {
    const meses = parsePlazoOnstarMeses(c.plazoOnstar);
    const label = meses != null ? `${meses} MESES` : '(sin plazo)';
    porPlazo.set(label, (porPlazo.get(label) || 0) + 1);
    if (meses == null) {
      sinPlazo += 1;
    } else if (meses === 12) {
      anual += 1;
    } else if (meses > 12) {
      multianual += 1;
    } else {
      // plazos < 12 no entran en Anual ni Multianual del PDF
      sinPlazo += 1;
    }
  }

  const base = anual + multianual;
  return {
    fuente: 'crm_financiamiento.plazo_onstar',
    totalOnstar: onstar.length,
    anual,
    multianual,
    sinPlazoOMenor12: sinPlazo,
    baseClasificada: base,
    anualPct: pct(anual, base),
    multianualPct: pct(multianual, base),
    porPlazo: [...porPlazo.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  };
}

async function loadOnstarTechMesActual(refDate = new Date()) {
  return loadOnstarTechForPeriod(currentMonthBounds(refDate));
}

async function loadOnstarTechForPeriod(bounds) {
  const periodo = bounds?.fechaInicio && bounds?.fechaFin
    ? {
      fechaInicio: bounds.fechaInicio,
      fechaFin: bounds.fechaFin,
      label: bounds.label || `${String(bounds.fechaInicio).slice(5, 7)}/${String(bounds.fechaInicio).slice(0, 4)}`,
    }
    : currentMonthBounds();
  // Ruta rápida para el dashboard: solo CRM del periodo (evita reconsultar SOFIA ~1 min).
  if (bounds?.fast !== false) {
    const crmPeriod = loadCrmContracts(periodo.fechaInicio, periodo.fechaFin);
    return buildOnstarFromPeriodContracts(crmPeriod.contracts || [], periodo.fechaInicio, periodo.fechaFin);
  }
  const crmAll = loadCrmContracts(null, null);
  let sofiaRows = [];
  try {
    const { getNotificacionesEntrega } = require('./sofia-entregas');
    const sofia = await getNotificacionesEntrega({
      fechaInicio: periodo.fechaInicio,
      fechaFin: periodo.fechaFin,
    });
    sofiaRows = sofia.registrosEntrega || [];
  } catch (err) {
    console.warn('[OnStar] No se pudieron cargar entregas SOFIA del periodo:', err.message);
    return {
      ...buildOnstarTechPenetracion([], crmAll.contracts || [], periodo),
      error: err.message,
    };
  }
  return buildOnstarTechPenetracion(sofiaRows, crmAll.contracts || [], periodo);
}

function countMap(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const label = String(keyFn(item) || '(sin dato)').trim() || '(sin dato)';
    map.set(label, (map.get(label) || 0) + 1);
  }
  return [...map.entries()]
    .map(([label, count]) => ({ label, count, pct: pct(count, items.length) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function buildRetailMix(porTipoVentaRetail = []) {
  const entries = (porTipoVentaRetail || [])
    .map((e) => ({
      label: String(e.label || e.key || '').trim().toUpperCase() || '(SIN DATO)',
      count: Number(e.count || e.value || 0),
    }))
    .filter((e) => e.count > 0 && !EXCLUDE_TIPOS.has(e.label));

  const total = entries.reduce((s, e) => s + e.count, 0);
  const contado = entries.filter((e) => CONTADO_TIPOS.has(e.label)).reduce((s, e) => s + e.count, 0);
  const credito = total - contado;
  const porFinanciera = entries
    .filter((e) => !CONTADO_TIPOS.has(e.label))
    .map((e) => ({ label: e.label, count: e.count, pct: pct(e.count, total) }))
    .sort((a, b) => b.count - a.count);

  return {
    totalRetail: total,
    credito,
    contado,
    penetracionCreditoPct: pct(credito, total),
    penetracionContadoPct: pct(contado, total),
    porFinanciera,
    porTipo: entries.map((e) => ({ label: e.label, count: e.count, pct: pct(e.count, total) })),
  };
}

function loadCrmContracts(fechaInicio, fechaFin) {
  if (!crm.isAvailable()) {
    return { available: false, contracts: [], reason: 'Base CRM no encontrada' };
  }

  // Acceso interno: reutilizar getSeguimiento360Summary no trae detalle de filas.
  // Abrimos vía búsqueda liviana exportando con getCrmStats + query directa a través de enrich.
  const Database = require('better-sqlite3');
  const fs = require('fs');
  const path = require('path');
  const DB_PATH = path.join(__dirname, '../../data/crm-ciclos.db');
  if (!fs.existsSync(DB_PATH)) {
    return { available: false, contracts: [], reason: 'Base CRM no encontrada' };
  }

  const d = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const hasFin = !!d.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='crm_financiamiento'`).get();
    if (!hasFin) {
      return { available: false, contracts: [], reason: 'Tabla crm_financiamiento no disponible' };
    }

    const rows = d.prepare(`
      SELECT *
      FROM crm_financiamiento
      WHERE vin IS NOT NULL AND trim(vin) <> ''
    `).all();

    const contracts = rows
      .filter((row) => inPeriod(rowDate(row), fechaInicio, fechaFin))
      .map(mapContract)
      .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));

    return { available: true, contracts, reason: null };
  } finally {
    try { d.close(); } catch { /* ignore */ }
  }
}

/**
 * Carline desde columna M del sheet (UNIDAD Y PAQUETE), p.ej. "AVEO E 2026" → AVEO NB.
 * Aveo HB = A/B/C/G · Aveo NB = D/E/F
 * S10 Chassis = A · Crew = B · Regular = C/F
 */
function carlineFromUnidadPaquete(unidadPaquete) {
  const raw = String(unidadPaquete || '').replace(/\s+/g, ' ').trim().toUpperCase();
  if (!raw) return '(sin carline)';
  const parts = raw.split(' ').filter(Boolean);
  let token = parts[0];
  if (!token || /^\d+$/.test(token)) return '(sin carline)';

  // Tipografías frecuentes en la hoja CRM
  if (token === 'CHEYENNE') token = 'SILVERADO';
  if (token === 'CAPTICA' || token === 'CCAPTIVA') token = 'CAPTIVA';
  if (token === 'BLAZERE') token = 'BLAZER';
  if (token === 'ONX' || token === 'OIX' || token === 'ONIXD') token = 'ONIX';
  if (token === 'GOOVE') token = 'GROOVE';
  if (token === 'AVEI') token = 'AVEO';

  const paquete = parts.find((p) => /^[A-Z]$/.test(p)) || null;
  const isCaptivaPhev = /PHEV|PHEB|HIBRIDA|HÍBRIDA/.test(raw);

  if (token === 'AVEO') {
    if (paquete && /[ABCG]/.test(paquete)) return 'AVEO HB';
    if (paquete && /[DEF]/.test(paquete)) return 'AVEO NB';
    return 'AVEO';
  }

  if (token === 'CAPTIVA') {
    return isCaptivaPhev ? 'CAPTIVA PHEV' : 'CAPTIVA';
  }

  if (token === 'S10') {
    if (paquete === 'A') return 'S10 MAX Chassis Cab';
    if (paquete === 'B') return 'S10 MAX Crew Cab';
    if (paquete && /[CF]/.test(paquete)) return 'S10 MAX Regular Cab';
    return 'S10';
  }

  return token;
}

function loadSolicitudes(fechaInicio, fechaFin) {
  const empty = {
    total: 0,
    aprobadas: 0,
    conCompra: 0,
    tasaAprobacionPct: null,
    porEstatus: [],
    porFinanciera: [],
    porCarline: [],
  };
  if (!crm.isAvailable()) return empty;

  const Database = require('better-sqlite3');
  const fs = require('fs');
  const path = require('path');
  const DB_PATH = path.join(__dirname, '../../data/crm-ciclos.db');
  if (!fs.existsSync(DB_PATH)) return empty;

  const d = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const hasSol = !!d.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='crm_solicitudes'`).get();
    if (!hasSol) return empty;

    const rows = d.prepare(`
      SELECT id_crm, no_solicitud, estatus, financiera, fecha_solicitud, fecha_compra,
             nombre_cliente, num_contrato, enganche, fi, afi, asesor, unidad_paquete,
             respuesta_financiera, biometrico
      FROM crm_solicitudes
    `).all().filter((r) => inPeriod(r.fecha_solicitud, fechaInicio, fechaFin));

    const aprobadas = rows.filter((r) => String(r.estatus || '').toUpperCase().includes('APROBADA')).length;
    const conCompra = rows.filter((r) =>
      r.fecha_compra || String(r.estatus || '').toUpperCase().includes('FACT')
    ).length;

    const byCarline = new Map();
    for (const r of rows) {
      const carline = carlineFromUnidadPaquete(r.unidad_paquete);
      if (!byCarline.has(carline)) {
        byCarline.set(carline, {
          carline,
          total: 0,
          aprobadas: 0,
          conCompra: 0,
          muestraUnidad: null,
        });
      }
      const bucket = byCarline.get(carline);
      bucket.total += 1;
      if (String(r.estatus || '').toUpperCase().includes('APROBADA')) bucket.aprobadas += 1;
      if (r.fecha_compra || String(r.estatus || '').toUpperCase().includes('FACT')) bucket.conCompra += 1;
      if (!bucket.muestraUnidad && r.unidad_paquete) {
        bucket.muestraUnidad = String(r.unidad_paquete).trim();
      }
    }

    const porCarline = [...byCarline.values()]
      .map((b) => ({
        ...b,
        pct: pct(b.total, rows.length),
      }))
      .sort((a, b) => b.total - a.total || a.carline.localeCompare(b.carline));

    const sorted = rows
      .slice()
      .sort((a, b) => String(b.fecha_solicitud || '').localeCompare(String(a.fecha_solicitud || '')));

    return {
      total: rows.length,
      aprobadas,
      conCompra,
      tasaAprobacionPct: pct(aprobadas, rows.length),
      porEstatus: countMap(rows, (r) => r.estatus || '(sin estatus)'),
      porFinanciera: countMap(rows, (r) => r.financiera || '(sin financiera)').slice(0, 10),
      porCarline,
      muestra: sorted.map((r) => ({
        fecha: toIsoDate(r.fecha_solicitud) || r.fecha_solicitud || null,
        cliente: r.nombre_cliente || null,
        vin: null,
        idCrm: r.id_crm != null ? String(r.id_crm) : null,
        noSolicitud: r.no_solicitud || null,
        estatus: r.estatus || null,
        financiera: r.financiera || null,
        respuestaFinanciera: r.respuesta_financiera || null,
        biometrico: r.biometrico != null ? String(r.biometrico).trim() : null,
        contrato: r.num_contrato || null,
        enganche: Number(r.enganche) || null,
        fi: r.fi || null,
        afi: r.afi || null,
        asesor: r.asesor || null,
        unidad: r.unidad_paquete || null,
        carline: carlineFromUnidadPaquete(r.unidad_paquete),
      })),
    };
  } finally {
    try { d.close(); } catch { /* ignore */ }
  }
}

/** Flotilla en col. AO (especial). Se resta de Nuevos porque suelen venir como NUEVO en AN. */
function isFlotillaContract(c) {
  return String(c?.especial || '').toUpperCase().includes('FLOTILLA');
}

/** Seminuevo en col. AN (tipo_compra). */
function isSeminuevoContract(c) {
  return String(c?.tipoCompra || '').trim().toUpperCase() === 'SEMINUEVO';
}

/** Nuevo en col. AN (tipo_compra), excluyendo flotillas de AO. */
function isNuevoContract(c) {
  return String(c?.tipoCompra || '').trim().toUpperCase() === 'NUEVO' && !isFlotillaContract(c);
}

function buildSummary(contracts, solicitudes) {
  const montos = contracts.map((c) => Number(c.montoFinanciar)).filter((n) => Number.isFinite(n) && n > 0);
  const enganches = contracts.map((c) => Number(c.engancheMonto)).filter((n) => Number.isFinite(n) && n > 0);
  const plazos = contracts.map((c) => Number(c.plazoMeses)).filter((n) => Number.isFinite(n) && n > 0);
  const vins = new Set(contracts.map((c) => String(c.vin || '').toUpperCase()).filter(Boolean));

  const contratosNuevos = contracts.filter(isNuevoContract);
  const contratosSeminuevos = contracts.filter(isSeminuevoContract);
  const contratosFlotilla = contracts.filter(isFlotillaContract);
  const contratosDemo = contracts.filter((c) => String(c?.tipoCompra || '').trim().toUpperCase() === 'DEMO');

  const conPva = contracts.filter((c) => c.cantidadPvas > 0);
  const montoTotalPvas = contracts.reduce((s, c) => s + Number(c.montoPvas || 0), 0);
  const totalCantidadPvas = contracts.reduce((s, c) => s + Number(c.cantidadPvas || 0), 0);

  const porTipoPva = PVA_DEFS.map((def) => {
    const con = contracts.filter((c) => c.pvas.some((p) => p.key === def.key));
    const monto = con.reduce((s, c) => {
      const hit = c.pvas.find((p) => p.key === def.key);
      return s + Number(hit?.monto || 0);
    }, 0);
    return {
      key: def.key,
      label: def.label,
      contratos: con.length,
      penetracionPct: pct(con.length, contracts.length),
      montoTotal: roundMoney(monto),
    };
  });

  return {
    contratos: contracts.length,
    unidades: vins.size,
    unidadesNuevos: contratosNuevos.length,
    unidadesSeminuevos: contratosSeminuevos.length,
    unidadesFlotilla: contratosFlotilla.length,
    unidadesDemo: contratosDemo.length,
    montoFinanciarTotal: roundMoney(montos.reduce((s, n) => s + n, 0)) || 0,
    montoFinanciarPromedio: roundMoney(avg(montos)),
    enganchePromedio: roundMoney(avg(enganches)),
    plazoPromedio: plazos.length ? Math.round(avg(plazos) * 10) / 10 : null,
    contratosConPva: conPva.length,
    penetracionPvaPct: pct(conPva.length, contracts.length),
    montoTotalPvas: roundMoney(montoTotalPvas) || 0,
    promedioCantidadPvas: contracts.length
      ? Math.round((totalCantidadPvas / contracts.length) * 10) / 10
      : null,
    porTipoPva,
    plazos: countMap(contracts.filter((c) => c.plazoMeses), (c) => `${c.plazoMeses} meses`),
    planes: countMap(contracts, (c) => c.plan || '(sin plan)').slice(0, 10),
    tiposCompra: countMap(contracts, (c) => c.tipoCompra || '(sin tipo)'),
    asesores: countMap(contracts, (c) => c.asesor || '(sin asesor)').slice(0, 12),
    porModalidad: {
      credito: contracts.filter((c) => c.modalidad === 'credito').length,
      leasing: contracts.filter((c) => c.modalidad === 'leasing').length,
    },
    solicitudes: {
      total: solicitudes.total,
      aprobadas: solicitudes.aprobadas,
      conCompra: solicitudes.conCompra,
      tasaAprobacionPct: solicitudes.tasaAprobacionPct,
    },
  };
}

function rankingAsesores(contracts, limit = 10) {
  return countMap(contracts, (c) => c.asesor || '(sin asesor)')
    .slice(0, limit)
    .map((r, i) => ({
      rank: i + 1,
      asesor: r.label,
      contratos: r.count,
      pct: r.pct,
    }));
}

function slicePeriodContracts(allContracts, fechaInicio, fechaFin) {
  return (allContracts || []).filter((c) => inPeriod(c.fecha, fechaInicio, fechaFin));
}

function periodPreview(allContracts, periodoKey, modalidad, limit = 3) {
  const rango = crm.resolveCrmPeriod({ periodo: periodoKey });
  const fi = rango.desde;
  const ff = rango.hasta;
  if (!fi || !ff) return null;
  let rows = slicePeriodContracts(allContracts, fi, ff);
  if (modalidad === 'leasing' || modalidad === 'credito') {
    rows = rows.filter((c) => c.modalidad === modalidad);
  }
  const ranking = rankingAsesores(rows, limit);
  return {
    periodo: periodoKey,
    label: {
      trimestre_actual: 'Trimestre actual',
      semestre_actual: 'Semestre actual',
      acumulado_anio: 'Año acumulado (YTD)',
      anio_actual: 'Año completo',
      mes_pasado: 'Mes pasado',
    }[periodoKey] || periodoKey,
    fechaInicio: fi,
    fechaFin: ff,
    contratos: rows.length,
    topAsesor: ranking[0] || null,
    ranking,
  };
}

/**
 * Consulta F&I orientada al asistente IA.
 * Default: mes en curso. Distingue crédito vs leasing (plan_2/especial).
 */
function getFinanciamientoAiAnalysis({
  periodo = null,
  fechaInicio = null,
  fechaFin = null,
  modalidad = 'todos',
  limit = 10,
} = {}) {
  const hasExplicitDates = Boolean(fechaInicio || fechaFin);
  const periodoKey = hasExplicitDates
    ? (periodo || 'personalizado')
    : (periodo || 'mes_actual');

  let rango = crm.resolveCrmPeriod({
    periodo: hasExplicitDates ? null : periodoKey,
    desde: fechaInicio || null,
    hasta: fechaFin || null,
  });

  // Para F&I ranking: nunca "todo" sin fechas → forzar mes actual
  if (!rango.desde || !rango.hasta) {
    rango = crm.resolveCrmPeriod({ periodo: 'mes_actual' });
  }

  const fi = rango.desde;
  const ff = rango.hasta;
  const loaded = loadCrmContracts(null, null);
  if (!loaded.available) {
    return {
      available: false,
      reason: loaded.reason,
      periodo: { key: periodoKey, fechaInicio: fi, fechaFin: ff },
    };
  }

  const all = loaded.contracts || [];
  let filtered = slicePeriodContracts(all, fi, ff);
  const modalidadNorm = String(modalidad || 'todos').toLowerCase();
  if (modalidadNorm === 'leasing' || modalidadNorm === 'arrendamiento') {
    filtered = filtered.filter((c) => c.modalidad === 'leasing');
  } else if (modalidadNorm === 'credito' || modalidadNorm === 'crédito') {
    filtered = filtered.filter((c) => c.modalidad === 'credito');
  }

  const ranking = rankingAsesores(filtered, Math.min(Number(limit) || 10, 25));
  const creditoN = slicePeriodContracts(all, fi, ff).filter((c) => c.modalidad === 'credito').length;
  const leasingN = slicePeriodContracts(all, fi, ff).filter((c) => c.modalidad === 'leasing').length;

  const periodosSugeridos = ['trimestre_actual', 'semestre_actual', 'acumulado_anio']
    .map((key) => periodPreview(all, key, modalidadNorm === 'arrendamiento' ? 'leasing' : modalidadNorm, 3))
    .filter(Boolean);

  return {
    available: true,
    fuente: 'crm_financiamiento (plan_2 / especial)',
    periodo: {
      key: rango.periodo || periodoKey,
      fechaInicio: fi,
      fechaFin: ff,
      defaultAplicado: !hasExplicitDates && !periodo,
    },
    modalidad: {
      solicitada: modalidadNorm,
      aplicada: modalidadNorm === 'arrendamiento' ? 'leasing'
        : (modalidadNorm === 'crédito' ? 'credito' : modalidadNorm),
      definicion: {
        leasing: 'plan_2 o especial contiene LEASING / arrendamiento (incluye FLOTILLA - LEASING)',
        credito: 'resto de contratos F&I (TRADICIONAL, SUBSIDIADO, DIAMANTE, SEMINUEVO, etc.)',
      },
    },
    resumen: {
      contratos: filtered.length,
      creditoEnPeriodo: creditoN,
      leasingEnPeriodo: leasingN,
      montoFinanciarTotal: roundMoney(
        filtered.reduce((s, c) => s + Number(c.montoFinanciar || 0), 0),
      ) || 0,
    },
    rankingAsesores: ranking,
    lider: ranking[0] || null,
    periodosSugeridos,
    instruccionesRespuesta: [
      'Responde con el periodo consultado (por defecto mes en curso).',
      'Si la pregunta es de leasing/arrendamiento, NO mezcles contratos de crédito.',
      'Si es de crédito, NO mezcles leasing.',
      'El “vendedor” en F&I CRM es el campo asesor del contrato (no el oficial FI/AFI).',
      'Cierra ofreciendo ampliar a trimestre, semestre o año acumulado (usa periodosSugeridos).',
    ],
    muestra: filtered.slice(0, 15).map((c) => ({
      fecha: c.fecha,
      asesor: c.asesor,
      cliente: c.cliente,
      modalidad: c.modalidad,
      plan2: c.plan2,
      especial: c.especial,
      montoFinanciar: c.montoFinanciar,
      vin: c.vin,
    })),
  };
}

/**
 * PVA YTD de un trimestre concreto (para selector del drawer).
 * @param {{ anio?: number|string, trimestre?: number|string }} opts
 */
function getPvaTrimestreYtd({ anio, trimestre } = {}) {
  const opts = listPvaTrimestreOpciones();
  let y = Number(anio);
  let q = Number(trimestre);
  if (!Number.isFinite(y) || !Number.isFinite(q) || q < 1 || q > 4) {
    const cur = currentQuarterBounds();
    y = cur.anio;
    q = cur.trimestre;
  }
  const bounds = quarterBounds(y, q);
  const crmTrimestre = loadCrmContracts(bounds.fechaInicio, bounds.fechaFin);
  return {
    pvaTrimestreYtd: buildPvaTrimestreYtd(crmTrimestre.contracts || [], { anio: y, trimestre: q }),
    pvaTrimestresOpciones: opts,
  };
}

function normKey(v) {
  return String(v || '').trim().toUpperCase();
}

function tipoOfRow(row) {
  return String(row?.TIPOVENTA || '').trim().toUpperCase() || '(SIN DATO)';
}

function enrichSofiaEntregasForMix(entregas, registrosVentas) {
  const byVin = new Map();
  const byFactura = new Map();
  for (const r of registrosVentas || []) {
    const vin = normKey(r.VTE_SERIE);
    const doc = normKey(r.VTE_DOCTO);
    if (vin) byVin.set(vin, r);
    if (doc) byFactura.set(doc, r);
  }

  return (entregas || []).map((e) => {
    const vin = normKey(e.SOF_VIN);
    const fact = normKey(e.SOF_Factura);
    const venta = (vin && byVin.get(vin)) || (fact && byFactura.get(fact)) || null;
    const tipo = venta ? tipoOfRow(venta) : '(SIN DATO)';
    const vendedor = venta?.VENDEDOR || e.SOF_CveUSu || null;
    return {
      ...e,
      TIPOVENTA: tipo,
      FORMAPAGO_ORIGINAL: venta?.FORMAPAGO_ORIGINAL || e.FORMAPAGO_ORIGINAL || null,
      VENDEDOR: vendedor,
      GERENTE_FI: 'Sin gerente F&I',
      VEH_TIPOAUTO: venta?.VEH_TIPOAUTO || e.VEH_TIPOAUTO || null,
      CANAL_LABEL: venta?.CANAL_LABEL || null,
      VTE_DOCTO: venta?.VTE_DOCTO || e.SOF_Factura || null,
      VTE_SERIE: venta?.VTE_SERIE || e.SOF_VIN || null,
      VTE_FECHDOCTO: e.FECHA_PERIODO || e.SOF_FechFact || e.SOF_FechAct || null,
      CLIENTE: e.CLIENTE || venta?.CLIENTE || null,
      isGmf: tipo === 'GMF',
      _match: venta ? (vin && byVin.has(vin) ? 'vin' : 'factura') : null,
    };
  });
}

function buildFacturasGmfForMix(registrosVentas, sofiaRows = []) {
  const sofiaByFactura = new Set();
  for (const e of sofiaRows || []) {
    const fact = normKey(e.SOF_Factura || e.VTE_DOCTO);
    if (fact) sofiaByFactura.add(fact);
  }

  return (registrosVentas || [])
    .filter((r) => tipoOfRow(r) === 'GMF')
    .map((r) => {
      const docto = normKey(r.VTE_DOCTO);
      return {
        ...r,
        SOF_Factura: r.VTE_DOCTO || null,
        SOF_VIN: r.VTE_SERIE || null,
        VTE_FECHDOCTO: r.VTE_FECHDOCTO || null,
        GERENTE_FI: 'Sin gerente F&I',
        isGmf: true,
        enSofia: docto ? sofiaByFactura.has(docto) : false,
        _match: 'factura',
        _kind: 'facturaGmf',
      };
    });
}

function buildSofiaGmfMixPayload(sofiaRows = [], facturasGmf = []) {
  const rows = sofiaRows || [];
  const total = rows.length;
  const gmf = rows.filter((r) => tipoOfRow(r) === 'GMF' || r?.isGmf === true).length;
  const noGmf = total - gmf;
  const sinMatch = rows.filter((r) => !r._match).length;
  const facturasGmfCount = (facturasGmf || []).length;

  const tipoMap = new Map();
  for (const r of rows) {
    const label = tipoOfRow(r);
    tipoMap.set(label, (tipoMap.get(label) || 0) + 1);
  }
  const porTipo = [...tipoMap.entries()]
    .map(([label, count]) => ({
      label,
      count,
      pct: total ? Math.round((count / total) * 1000) / 10 : null,
    }))
    .sort((a, b) => b.count - a.count);

  const penetracionGmfPct = total ? Math.round((gmf / total) * 1000) / 10 : null;

  return {
    totalSofia: total,
    facturasGmf: facturasGmfCount,
    gmfDisponiblesTimbrar: 0,
    gmf,
    noGmf,
    sinMatch,
    penetracionGmfPct,
    porTipo,
    porFinanciera: porTipo.filter((e) => e.label === 'GMF' || (!CONTADO_TIPOS.has(e.label) && !EXCLUDE_TIPOS.has(e.label))),
    totalRetail: total,
    credito: gmf,
    contado: noGmf,
    penetracionCreditoPct: penetracionGmfPct,
    penetracionContadoPct: total ? Math.round((noGmf / total) * 1000) / 10 : null,
  };
}

async function loadSofiaGmfBundle(fechaInicio, fechaFin) {
  try {
    const { getVentasSofiaCore } = require('./ventas');
    const core = await getVentasSofiaCore({ fechaInicio, fechaFin, incluirPorMes: false });
    const sofiaRegistros = enrichSofiaEntregasForMix(core.entregasSofia, core.registros);
    const facturasGmfRegistros = buildFacturasGmfForMix(core.registros, sofiaRegistros);
    const sofiaGmfMix = buildSofiaGmfMixPayload(sofiaRegistros, facturasGmfRegistros);
    return {
      mixReady: true,
      sofiaGmfMix,
      sofiaRegistros,
      facturasGmfRegistros,
    };
  } catch (err) {
    console.warn('[FI] sofia/gmf bundle:', err.message);
    return {
      mixReady: false,
      mixError: err.message,
      sofiaGmfMix: null,
      sofiaRegistros: [],
      facturasGmfRegistros: [],
    };
  }
}

/**
 * @param {{ fechaInicio: string, fechaFin: string, porTipoVentaRetail?: Array, pvaAnio?: number|string, pvaTrimestre?: number|string }} opts
 */
async function getFinanciamientoDashboard({ fechaInicio, fechaFin, porTipoVentaRetail, pvaAnio, pvaTrimestre } = {}) {
  if (!fechaInicio || !fechaFin) {
    throw Object.assign(new Error('Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).'), { status: 400 });
  }

  // Facturas/SOFIA en paralelo con CRM (SQLite es inmediato; el cuello es DMS).
  const mixBundlePromise = loadSofiaGmfBundle(fechaInicio, fechaFin);

  const crmData = loadCrmContracts(fechaInicio, fechaFin);
  const solicitudes = loadSolicitudes(fechaInicio, fechaFin);
  const contracts = crmData.contracts || [];
  const summary = buildSummary(contracts, solicitudes);
  const retailMix = buildRetailMix(porTipoVentaRetail);

  // OnStar rápido desde contratos CRM del periodo (sin reconsultar SOFIA).
  const onstarTech = buildOnstarFromPeriodContracts(contracts, fechaInicio, fechaFin);
  const essentials = buildEssentialsFromContracts(contracts);

  // PVA: serie del trimestre (por defecto el en curso; independiente del periodo del dashboard)
  const pva = getPvaTrimestreYtd({ anio: pvaAnio, trimestre: pvaTrimestre });
  const mixBundle = await mixBundlePromise;

  return {
    periodo: { fechaInicio, fechaFin },
    fuente: {
      crm: crmData.available,
      reason: crmData.reason,
      tabla: 'crm_financiamiento',
    },
    summary,
    retailMix: mixBundle.sofiaGmfMix || retailMix,
    onstarTech,
    essentials,
    pvaTrimestreYtd: pva.pvaTrimestreYtd,
    pvaTrimestresOpciones: pva.pvaTrimestresOpciones,
    contratos: contracts,
    solicitudes,
    mixReady: mixBundle.mixReady,
    mixError: mixBundle.mixError || null,
    sofiaGmfMix: mixBundle.sofiaGmfMix,
    sofiaRegistros: mixBundle.sofiaRegistros,
    facturasGmfRegistros: mixBundle.facturasGmfRegistros,
  };
}

module.exports = {
  getFinanciamientoDashboard,
  getPvaTrimestreYtd,
  getFinanciamientoAiAnalysis,
  buildRetailMix,
  buildSofiaGmfMixPayload,
  buildOnstarTechPenetracion,
  buildEssentialsFromContracts,
  parsePlazoOnstarMeses,
  buildPvaTrimestreYtd,
  listPvaTrimestreOpciones,
  quarterBounds,
  loadOnstarTechMesActual,
  loadOnstarTechForPeriod,
  loadSolicitudes,
  isOnstarTechUnidad,
  isFlotillaContract,
  isSeminuevoContract,
  isNuevoContract,
  classifyModalidad,
  PVA_DEFS,
};
