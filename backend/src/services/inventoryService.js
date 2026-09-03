const fs = require('fs');
const path = require('path');
const { query } = require('../db');
const { VENTAS_BASE_CTE } = require('./ventasNuevosFinanciero');

const INVENTORY_SITUATIONS = `('FIS', 'DIS', 'PED', 'PEN', 'SEP', 'DEMO', 'TRAN')`;
const PLAN_PISO_FACTOR = 0.00020778;
const PLAN_PISO_DIAS_GRACIA = 30;
const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const FORECAST_SHEET_PATH = path.join(__dirname, '../../data/forecast-source.csv');
const GM_MEXICO_RE = /GENERAL\s+MOTORS\s+DE\s+MEXICO/i;

const SITUACION_LABELS = {
  FIS: 'Físico',
  DIS: 'Disponible',
  PED: 'Pedido',
  PEN: 'Pendiente',
  SEP: 'Apartada',
  DEMO: 'Demo',
  TRAN: 'Tránsito',
};
const REAL_INVENTORY_SITUATIONS = new Set(['DIS', 'FIS', 'SEP']);
const COSTO_PREVIA = 1669;
const COSTO_PUBLICIDAD = 641.89;
const COSTO_MERCADOTECNIA = COSTO_PUBLICIDAD;
const CARGO_ENTREGA_CHICO = 240;
const CARGO_ENTREGA_GRANDE = 315;
const ENTREGA_MODELOS_CHICOS = ['AVEO', 'ONIX', 'TORNADO', 'GROOVE'];
const GASOLINA_PRECIO_LITRO = 23.39;
const GASOLINA_POR_MODELO = [
  { key: 'CAPTIVA PHEV', litros: 15 },
  { key: 'SILVERADO 2500', litros: 25 },
  { key: 'EXPRESS VAN', litros: 20 },
  { key: 'EXPRESS', litros: 20 },
  { key: 'SUBURBAN', litros: 25 },
  { key: 'SILVERADO', litros: 25 },
  { key: 'CHEYENNE', litros: 25 },
  { key: 'TAHOE', litros: 25 },
  { key: 'TRAVERSE', litros: 20 },
  { key: 'COLORADO', litros: 20 },
  { key: 'BLAZER', litros: 20 },
  { key: 'BLAIZER', litros: 20 },
  { key: 'CAPTIVA', litros: 15 },
  { key: 'TRACKER', litros: 15 },
  { key: 'TRAX', litros: 15 },
  { key: 'CAVALIER', litros: 13 },
  { key: 'MONTANA', litros: 13 },
  { key: 'TORNADO', litros: 13 },
  { key: 'GROOVE', litros: 13 },
  { key: 'AVEO', litros: 13 },
  { key: 'S10', litros: 18 },
  { key: 'S 10', litros: 18 },
  { key: 'ONIX', litros: 10 },
];

function matchCargoEntrega(carline, version) {
  const hay = normalizeMatchKey(`${carline || ''} ${version || ''}`)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/-/g, ' ');
  const esChico = ENTREGA_MODELOS_CHICOS.some((key) => hay.includes(key));
  return esChico ? CARGO_ENTREGA_CHICO : CARGO_ENTREGA_GRANDE;
}

function buildGastosExtras(carline, version, gastosLibro = 0) {
  const gasolina = matchGasolina(carline, version);
  const cargoEntrega = matchCargoEntrega(carline, version);
  const gastos = roundMoney(Math.abs(Number(gastosLibro) || 0)) || 0;
  return {
    previa: COSTO_PREVIA,
    publicidad: COSTO_PUBLICIDAD,
    cargoEntrega,
    gasolina,
    gastos,
    total: roundMoney(COSTO_PREVIA + COSTO_PUBLICIDAD + cargoEntrega + gasolina.importe + gastos) || 0,
  };
}

function matchGasolina(carline, version) {
  const hay = normalizeMatchKey(`${carline || ''} ${version || ''}`)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/-/g, ' ');
  const found = GASOLINA_POR_MODELO
    .slice()
    .sort((a, b) => b.key.length - a.key.length)
    .find((row) => hay.includes(row.key));
  if (!found) {
    return { litros: 0, precioLitro: GASOLINA_PRECIO_LITRO, importe: 0 };
  }
  return {
    litros: found.litros,
    precioLitro: GASOLINA_PRECIO_LITRO,
    importe: roundMoney(found.litros * GASOLINA_PRECIO_LITRO) || 0,
  };
}

function normalizeMatchKey(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function extractPaqueteLetter(tipoAuto) {
  const parts = String(tipoAuto || '').toUpperCase().split(/\s+/).filter(Boolean);
  return parts.find((p) => /^[A-Z]$/.test(p)) || '';
}

function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.round(x * 100) / 100;
}

const CRM_DB_PATH = path.join(__dirname, '../../data/crm-ciclos.db');
const COMISION_EV_LEASING_PCT = 1;

function previousCalendarMonth(fechaInicio) {
  const [y, m] = String(fechaInicio || '').split('-').map(Number);
  if (!y || !m) return null;
  const prevMonth = m === 1 ? 12 : m - 1;
  const prevYear = m === 1 ? y - 1 : y;
  const lastDay = new Date(prevYear, prevMonth, 0).getDate();
  const mm = String(prevMonth).padStart(2, '0');
  return {
    fechaInicio: `${prevYear}-${mm}-01`,
    fechaFin: `${prevYear}-${mm}-${String(lastDay).padStart(2, '0')}`,
    label: `${MONTH_NAMES[prevMonth - 1]} ${prevYear}`,
  };
}

function pctComisionVehiculoEv(unidadesPrev) {
  const n = Math.max(0, Math.floor(Number(unidadesPrev) || 0));
  if (n >= 10) return 16;
  if (n >= 8) return 15;
  if (n <= 0) return 7;
  return 7 + n;
}

function isLeasingFormaPago(formaPago) {
  const t = String(formaPago || '').toUpperCase();
  return /\bLEAS(ING)?\b/.test(t) || t.includes('ARREND');
}

function isLeasingCliente(cliente) {
  const t = String(cliente || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
  return t.includes('GM FINANCIAL DE MEXICO');
}

const TIPO_VENTA_LABELS = {
  CRE: 'GMF',
  ZACCRE: 'GMF',
  CHCRE: 'GMF',
  CASACRE: 'GMF',
  FORCRE: 'Foráneas GMF',
  SUAGMF: 'GMF',
  CASACON: 'Contado',
  PLNCON: 'Contado',
  CHCON: 'Contado',
  FORCON: 'Foráneas contado',
  ZACCON: 'Contado',
  CON: 'Contado',
  FLOT: 'Flotilla',
  FLOTGMF: 'Flotilla GMF',
  PERDIDA: 'Pérdida',
  PISOBBVA: 'BBVA',
  FORBBVA: 'Foráneas BBVA',
  CHBBVA: 'BBVA',
  ZACBBVA: 'BBVA',
  PISOHSBC: 'HSBC',
  FORHSBC: 'Foráneas HSBC',
  CHHSBC: 'HSBC',
  ZACHSBC: 'HSBC',
  PISOSANT: 'Santander',
  FORSANT: 'Foráneas Santander',
  CHSANT: 'Santander',
  ZACSANT: 'Santander',
  PISOBNTE: 'Banorte',
  FORBNTE: 'Foráneas Banorte',
  CHBNTE: 'Banorte',
  ZACBNTE: 'Banorte',
  FORSCOT: 'Foráneas Scotiabank',
  PISOSCOT: 'Scotiabank',
  CHOSCOT: 'Scotiabank',
  ZACSCOT: 'Scotiabank',
  CASASCOT: 'Scotiabank',
  CXCSUAU: 'Suauto',
  CXCSUAUC: 'Suauto',
  SNPSUA: 'Suauto',
  SUA: 'Suauto',
};

function labelTipoVenta(formaPago) {
  const key = String(formaPago || '').trim().toUpperCase();
  return TIPO_VENTA_LABELS[key] || key || '—';
}

function isFlotillaFormaPago(formaPago) {
  const key = String(formaPago || '').trim().toUpperCase();
  return key === 'FLOT' || key === 'FLOTGMF';
}

function detectDemoVendido(row = {}) {
  const hay = [
    row.observacion,
    row.observs,
    row.ubicacion,
    row.tipoAuto,
    row.situaciones,
  ].map((v) => String(v || '').toUpperCase()).join(' ');
  if (!/\bDEMO\b|\bDVIN\b/.test(hay)) {
    return { isDemo: false, demoHint: null };
  }
  const hint = String(row.observacion || row.observs || row.ubicacion || '')
    .trim() || 'Marcada como demo';
  return { isDemo: true, demoHint: hint };
}

function isLeasingCrmText(...parts) {
  const t = parts.map((p) => String(p || '').toUpperCase()).join(' ');
  return /\bLEAS(ING)?\b/.test(t) || t.includes('ARREND');
}

function normalizeVinKey(value) {
  const vin = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  return vin.length >= 5 ? vin : '';
}

async function loadVentasPreviasPorVendedor(fechaInicio, fechaFin) {
  const rows = await query(`
    SELECT
      LTRIM(RTRIM(ISNULL(veh.VEH_VENDEDOR, ''))) AS vendedorId,
      COUNT(*) AS unidades
    FROM ADE_VTAFI v
    INNER JOIN SER_VEHICULO veh
      ON veh.VEH_NUMSERIE = v.VTE_SERIE
      AND veh.VEH_NOINVENTA > 0
    WHERE v.VTE_TIPODOCTO = 'A'
      AND v.VTE_STATUS = 'I'
      AND veh.VEH_SITUACION = 'VEN'
      AND v.VTE_FORMAPAGO NOT IN ('VENTAMRS', 'VTACON', 'FLOT', 'FLOTGMF', 'PERDIDA')
      AND CONVERT(date, v.VTE_FECHDOCTO, 103) BETWEEN CONVERT(date, @fechaInicio, 23) AND CONVERT(date, @fechaFin, 23)
    GROUP BY LTRIM(RTRIM(ISNULL(veh.VEH_VENDEDOR, '')))
  `, { fechaInicio, fechaFin });
  const map = new Map();
  for (const row of rows || []) {
    const id = String(row.vendedorId || '').trim();
    if (!id) continue;
    map.set(id, Number(row.unidades || 0) || 0);
  }
  return map;
}

function loadLeasingVinSet(vins = []) {
  const unique = [...new Set((vins || []).map(normalizeVinKey).filter(Boolean))];
  const set = new Set();
  if (!unique.length || !fs.existsSync(CRM_DB_PATH)) return set;
  let db;
  try {
    const Database = require('better-sqlite3');
    db = new Database(CRM_DB_PATH, { readonly: true, fileMustExist: true });
    const hasTable = db.prepare(
      `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'crm_financiamiento'`
    ).get();
    if (!hasTable) return set;
    const chunkSize = 200;
    for (let i = 0; i < unique.length; i += chunkSize) {
      const chunk = unique.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = db.prepare(`
        SELECT vin, plan_2, especial, plan, tipo_compra
        FROM crm_financiamiento
        WHERE UPPER(REPLACE(vin, ' ', '')) IN (${placeholders})
      `).all(...chunk);
      for (const row of rows || []) {
        if (!isLeasingCrmText(row.plan_2, row.especial, row.plan, row.tipo_compra)) continue;
        const key = normalizeVinKey(row.vin);
        if (key) set.add(key);
      }
    }
  } catch {
    return set;
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
  return set;
}

/**
 * Ingresos F&I por VIN: solo PAGOS GMF (por serie y por contrato del histórico para cruce).
 * Sin pagos en PAGOS GMF → sin ingreso (no se usan montos del histórico de contratos).
 * @returns {Map<string, { monto: number, count: number, fuente: string, byConcepto: Array }>}
 */
function loadIngresosFinanciamientoByVin(vins = []) {
  const map = new Map();
  const unique = [...new Set((vins || []).map(normalizeVinKey).filter(Boolean))];
  if (!unique.length || !fs.existsSync(CRM_DB_PATH)) return map;

  let db;
  try {
    const Database = require('better-sqlite3');
    db = new Database(CRM_DB_PATH, { readonly: true, fileMustExist: true });
    const hasPagos = !!db.prepare(
      `SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='crm_pagos_gmf'`
    ).get();
    const hasFin = !!db.prepare(
      `SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='crm_financiamiento'`
    ).get();

    const chunkSize = 200;
    /** vin → Set de ids de pago ya contados */
    const seenPagoIds = new Map();
    const ensureEntry = (vinKey) => {
      if (!map.has(vinKey)) {
        map.set(vinKey, { monto: 0, count: 0, fuente: 'pagos_gmf', byConcepto: [] });
        seenPagoIds.set(vinKey, new Set());
      }
      return map.get(vinKey);
    };
    const addPagoToVin = (vinKey, pagoId, concepto, monto, n = 1) => {
      if (!vinKey) return;
      const entry = ensureEntry(vinKey);
      const seen = seenPagoIds.get(vinKey);
      if (pagoId != null) {
        if (seen.has(pagoId)) return;
        seen.add(pagoId);
      }
      const m = Number(monto || 0) || 0;
      entry.monto = roundMoney(entry.monto + m) || 0;
      entry.count += Number(n) || 1;
      const label = String(concepto || 'PAGO GMF');
      const prev = entry.byConcepto.find((c) => c.concepto === label);
      if (prev) {
        prev.count += Number(n) || 1;
        prev.monto = roundMoney(prev.monto + m) || 0;
      } else {
        entry.byConcepto.push({
          concepto: label,
          count: Number(n) || 1,
          monto: roundMoney(m) || 0,
        });
      }
    };

    // Contratos del histórico por VIN (solo para cruzar clave con PAGOS GMF; no suma montos).
    const vinByContrato = new Map();
    if (hasFin) {
      for (let i = 0; i < unique.length; i += chunkSize) {
        const chunk = unique.slice(i, i + chunkSize);
        const placeholders = chunk.map(() => '?').join(',');
        const rows = db.prepare(`
          SELECT UPPER(REPLACE(vin, ' ', '')) AS vin, contrato, no_contrato
          FROM crm_financiamiento
          WHERE UPPER(REPLACE(vin, ' ', '')) IN (${placeholders})
        `).all(...chunk);
        for (const row of rows || []) {
          const vinKey = normalizeVinKey(row.vin);
          if (!vinKey) continue;
          for (const raw of [row.contrato, row.no_contrato]) {
            const digits = String(raw || '').replace(/[^\d]/g, '');
            if (!digits) continue;
            if (!vinByContrato.has(digits)) vinByContrato.set(digits, vinKey);
            if (digits.length > 10) {
              const trunc = digits.slice(0, -1);
              if (!vinByContrato.has(trunc)) vinByContrato.set(trunc, vinKey);
            }
          }
        }
      }
    }

    if (!hasPagos) return map;

    for (let i = 0; i < unique.length; i += chunkSize) {
      const chunk = unique.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = db.prepare(`
        SELECT
          id,
          UPPER(REPLACE(vin, ' ', '')) AS vin,
          COALESCE(NULLIF(TRIM(concepto), ''), 'PAGO GMF') AS concepto,
          COALESCE(monto, 0) AS monto
        FROM crm_pagos_gmf
        WHERE vin IS NOT NULL
          AND UPPER(REPLACE(vin, ' ', '')) IN (${placeholders})
      `).all(...chunk);
      for (const row of rows || []) {
        addPagoToVin(normalizeVinKey(row.vin), row.id, row.concepto, row.monto, 1);
      }
    }

    const allContratos = [...vinByContrato.keys()];
    for (let i = 0; i < allContratos.length; i += chunkSize) {
      const chunk = allContratos.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = db.prepare(`
        SELECT
          id,
          UPPER(REPLACE(COALESCE(vin, ''), ' ', '')) AS vin,
          contrato_norm,
          contrato_raw,
          contrato_historico,
          COALESCE(NULLIF(TRIM(concepto), ''), 'PAGO GMF') AS concepto,
          COALESCE(monto, 0) AS monto
        FROM crm_pagos_gmf
        WHERE contrato_norm IN (${placeholders})
           OR contrato_raw IN (${placeholders})
           OR contrato_historico IN (${placeholders})
      `).all(...chunk, ...chunk, ...chunk);
      for (const row of rows || []) {
        const vinFromPago = normalizeVinKey(row.vin);
        const cands = [row.contrato_norm, row.contrato_raw, row.contrato_historico]
          .map((c) => String(c || '').replace(/[^\d]/g, ''))
          .filter(Boolean);
        let vinKey = vinFromPago && unique.includes(vinFromPago) ? vinFromPago : null;
        if (!vinKey) {
          for (const c of cands) {
            if (vinByContrato.has(c)) {
              vinKey = vinByContrato.get(c);
              break;
            }
          }
        }
        if (!vinKey || !unique.includes(vinKey)) continue;
        addPagoToVin(vinKey, row.id, row.concepto, row.monto, 1);
      }
    }

    for (const entry of map.values()) {
      entry.byConcepto.sort((a, b) => b.monto - a.monto);
    }
  } catch {
    return map;
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
  return map;
}

function calcComisionEv({ utilidad, extras, vendedorId, vin, formaPago, cliente, prevByVendedor, leasingVins }) {
  const unidadesPrev = prevByVendedor.get(String(vendedorId || '').trim()) || 0;
  const pctVehiculo = pctComisionVehiculoEv(unidadesPrev);
  const esArrendamiento = Boolean(leasingVins.has(normalizeVinKey(vin)))
    || isLeasingFormaPago(formaPago)
    || isLeasingCliente(cliente);
  const pctLeasing = esArrendamiento ? COMISION_EV_LEASING_PCT : 0;
  const pctTotal = pctVehiculo + pctLeasing;
  const bruta = Number(utilidad);
  const extrasNum = Number(extras) || 0;
  const base = Number.isFinite(bruta) ? roundMoney(bruta - extrasNum) : null;
  const importe = base != null && base > 0
    ? roundMoney(base * (pctTotal / 100))
    : 0;
  return {
    unidadesPrev,
    pctVehiculo,
    pctLeasing,
    pctTotal,
    esArrendamiento,
    base: base,
    importe: importe || 0,
  };
}

function addUtilidadSample(map, key, unidades, promedio, subtotalPromedio) {
  if (!key || !unidades) return;
  const prev = map.get(key) || { unidades: 0, utilidadPonderada: 0, subtotalPonderado: 0 };
  prev.unidades += unidades;
  prev.utilidadPonderada += (Number(promedio) || 0) * unidades;
  prev.subtotalPonderado += (Number(subtotalPromedio) || 0) * unidades;
  map.set(key, prev);
}

function utilidadFromMap(map, key) {
  const row = map.get(key);
  if (!row || !row.unidades) return null;
  const utilidadPromedio = roundMoney(row.utilidadPonderada / row.unidades);
  const subtotalPromedio = row.subtotalPonderado
    ? roundMoney(row.subtotalPonderado / row.unidades)
    : null;
  return {
    utilidadPromedio,
    unidadesVendidas: row.unidades,
    subtotalPromedio,
    utilidadPct: subtotalPromedio
      ? roundMoney((utilidadPromedio / subtotalPromedio) * 100)
      : null,
  };
}

/**
 * Utilidad promedio histórica por carline + versión/paquete.
 * Del libro UNI_TEMLIBROVENTAS: pen_costo1 (mi costo), BONIFICACION, VEH_MISELANEOS (gastos).
 * Costo = Mi costo − BONIFICACION + GASTOS
 * Utilidad = Subtotal − ese costo.
 */
async function loadUtilidadHistoricaPorVersion() {
  try {
    const rows = await query(`
      ${VENTAS_BASE_CTE}
      SELECT
        UPPER(LTRIM(RTRIM(ISNULL(NULLIF(cat.UNC_FAMILIA, ''), 'SIN FAMILIA')))) AS carline,
        LTRIM(RTRIM(v.modelo)) AS version,
        LTRIM(RTRIM(ISNULL(veh.VEH_CATALOGO, ''))) AS catalogo,
        COUNT(*) AS unidadesVendidas,
        AVG(v.ventaSubtotal) AS subtotalPromedio,
        AVG(
          v.ventaSubtotal
          - (
            ISNULL(NULLIF(libro.pen_costo1, 0), v.costoMiCosto)
            - ISNULL(libro.BONIFICACION, 0)
            + ISNULL(libro.VEH_MISELANEOS, 0)
          )
        ) AS utilidadPromedio
      FROM ventas v
      INNER JOIN SER_VEHICULO veh
        ON veh.VEH_NUMSERIE = v.VTE_SERIE
        AND veh.VEH_NOINVENTA > 0
      INNER JOIN UNI_TEMLIBROVENTAS libro
        ON libro.VTE_DOCTO = v.VTE_DOCTO
        AND libro.VTE_ORGSTATUS = 'I'
      LEFT JOIN UNI_CATALOGO cat
        ON cat.UNC_MODELO = veh.VEH_ANMODELO
        AND cat.UNC_IDCATALOGO = veh.VEH_CATALOGO
      WHERE ISNULL(NULLIF(libro.pen_costo1, 0), v.costoMiCosto) > 0
      GROUP BY
        UPPER(LTRIM(RTRIM(ISNULL(NULLIF(cat.UNC_FAMILIA, ''), 'SIN FAMILIA')))),
        LTRIM(RTRIM(v.modelo)),
        LTRIM(RTRIM(ISNULL(veh.VEH_CATALOGO, '')))
    `);
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.warn('[inventory] utilidad historica por version:', err.message);
    return [];
  }
}

function buildUtilidadLookups(rows) {
  const byCatalogo = new Map();
  const byVersion = new Map();
  const byCarline = new Map();
  for (const row of rows) {
    const carline = normalizeMatchKey(row.carline);
    const version = normalizeMatchKey(row.version);
    const catalogo = normalizeMatchKey(row.catalogo);
    const unidades = Number(row.unidadesVendidas || 0);
    const promedio = Number(row.utilidadPromedio || 0);
    const subtotal = Number(row.subtotalPromedio || 0);
    if (!carline || !unidades) continue;
    addUtilidadSample(byCarline, carline, unidades, promedio, subtotal);
    if (catalogo) addUtilidadSample(byCatalogo, `${carline}||${catalogo}`, unidades, promedio, subtotal);
    if (version) addUtilidadSample(byVersion, `${carline}||${version}`, unidades, promedio, subtotal);
  }
  return { byCatalogo, byVersion, byCarline };
}

function matchUtilidadHistorica(lookups, carline, version, catalogo) {
  const cl = normalizeMatchKey(carline);
  const cat = normalizeMatchKey(catalogo);
  const ver = normalizeMatchKey(version);
  return utilidadFromMap(lookups.byCatalogo, `${cl}||${cat}`)
    || utilidadFromMap(lookups.byVersion, `${cl}||${ver}`)
    || null;
}

function unitBaseCost(unit) {
  const miCosto = Number(unit.miCosto || 0) || Number(unit.importeRemision || 0) || 0;
  if (!miCosto) return null;
  return roundMoney(miCosto - (Number(unit.bonificacion || 0) || 0));
}

function buildAgeingSlowTable(units, utilidadRows = []) {
  const lookups = buildUtilidadLookups(utilidadRows);
  const ageingSlowTable = [];

  for (const unit of units) {
    if (!REAL_INVENTORY_SITUATIONS.has(unit.situacion)) continue;
    const carline = unit.familia || 'Sin familia';
    const version = unit.tipoAuto || 'Sin versión';
    const catalogo = unit.catalogo || '';
    const days = unit.daysInStock;
    const hist = matchUtilidadHistorica(lookups, carline, version, catalogo);
    const carlineHist = utilidadFromMap(lookups.byCarline, normalizeMatchKey(carline));
    const planPiso = calcPlanPisoForPeriod(unit.importeRemision, unit.remisionDate, 'all');
    const generaInteres = days != null && days > PLAN_PISO_DIAS_GRACIA;
    const planPisoAcumulado = generaInteres ? (planPiso.intereses || 0) : 0;
    const costo = unitBaseCost(unit);
    const precio = unit.precio || null;
    const extras = buildGastosExtras(carline, version, unit.gastos);
    const costoPrevia = extras.previa;
    const costoMercadotecnia = extras.publicidad;
    const gasolina = extras.gasolina;
    const gastosAdicionales = extras.total;
    const utilidadEsperada = hist?.utilidadPromedio
      ?? (precio && costo ? roundMoney(precio - costo) : null);
    const utilidadNeta = utilidadEsperada == null
      ? null
      : roundMoney(utilidadEsperada - gastosAdicionales - (planPisoAcumulado || 0));

    ageingSlowTable.push({
      carline,
      version,
      paquete: extractPaqueteLetter(version) || null,
      catalogo: catalogo || null,
      vin: unit.serie || null,
      daysInStock: days,
      precio,
      costo,
      utilidadPromedio: utilidadEsperada,
      utilidadPctCarline: carlineHist?.utilidadPct ?? null,
      unidadesVendidas: hist?.unidadesVendidas || 0,
      costoPrevia,
      costoMercadotecnia,
      costoPublicidad: extras.publicidad,
      gasolinaLitros: gasolina.litros,
      gasolinaPrecioLitro: gasolina.precioLitro,
      costoGasolina: gasolina.importe,
      costoEntrega: extras.cargoEntrega,
      gastos: extras.gastos,
      gastosAdicionales,
      utilidadNeta,
      planPisoAcumulado: roundMoney(planPisoAcumulado) || 0,
      daysChargeable: planPiso.daysChargeable || 0,
      generaInteres,
      units: 1,
      inventarioReal: 1,
      avgDays: days || 0,
      maxDays: days || 0,
      critical: days != null && days >= 90,
      warn: days != null && days >= 60 && days < 90,
    });
  }

  ageingSlowTable.sort((a, b) =>
    (Number(b.daysInStock || 0) - Number(a.daysInStock || 0))
    || (Number(b.planPisoAcumulado || 0) - Number(a.planPisoAcumulado || 0))
    || String(a.carline || '').localeCompare(String(b.carline || ''))
  );

  const carlineFilters = [...ageingSlowTable.reduce((map, row) => {
    const label = row.carline || 'Sin familia';
    map.set(label, (map.get(label) || 0) + row.units);
    return map;
  }, new Map()).entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return { ageingSlowTable, carlineFilters };
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const d = startOfDay(date);
  d.setDate(d.getDate() + days);
  return d;
}

function daysInclusive(start, end) {
  const s = startOfDay(start);
  const e = startOfDay(end);
  if (e < s) return 0;
  return Math.round((e - s) / 86400000) + 1;
}

/** Primer día que genera interés: remisión + 31 (días en stock > 30). */
function interestStartDate(remisionDate) {
  return addDays(remisionDate, PLAN_PISO_DIAS_GRACIA + 1);
}

/**
 * Intereses de Plan Piso.
 * period = 'all' → acumulado a hoy.
 * period = 'YYYY-MM' → acumulado al corte del mes (desde día 31 hasta el último día del mes, o hoy si es el mes en curso).
 * Intereses = factor × importe de remisión × días de cargo en el rango.
 */
function calcPlanPisoUntil(importeRemision, remisionDate, cutoffDate) {
  if (!remisionDate || !cutoffDate) {
    return { daysInStock: null, daysChargeable: 0, intereses: 0, cutoffDate: null };
  }

  const remision = startOfDay(remisionDate);
  const cutoff = startOfDay(cutoffDate);
  if (cutoff < remision) {
    return { daysInStock: 0, daysChargeable: 0, intereses: 0, cutoffDate: cutoff };
  }

  const interestStart = interestStartDate(remision);
  const daysInStock = Math.max(0, Math.round((cutoff - remision) / 86400000));
  const daysChargeable = interestStart > cutoff
    ? 0
    : daysInclusive(interestStart, cutoff);
  const monto = Number(importeRemision) || 0;
  const intereses = daysChargeable > 0 ? PLAN_PISO_FACTOR * monto * daysChargeable : 0;

  return {
    daysInStock,
    daysChargeable,
    intereses: Math.round(intereses * 100) / 100,
    cutoffDate: cutoff,
  };
}

function calcPlanPisoForPeriod(importeRemision, remisionDate, period = 'all') {
  if (!remisionDate) {
    return { daysInStock: null, daysChargeable: 0, intereses: 0, cutoffDate: null };
  }

  const today = startOfDay(new Date());
  let cutoffDate = today;

  if (period && period !== 'all') {
    const [year, month] = period.split('-').map(Number);
    if (!year || !month) {
      return { daysInStock: null, daysChargeable: 0, intereses: 0, cutoffDate: null };
    }
    const monthEnd = new Date(year, month, 0);
    cutoffDate = monthEnd < today ? monthEnd : today;
  }

  return calcPlanPisoUntil(importeRemision, remisionDate, cutoffDate);
}

function formatPlanPisoPeriodLabel(period, months) {
  if (period === 'all') return 'Todo (acumulado a hoy)';
  const monthLabel = months.find((m) => m.value === period)?.label
    || (() => {
      const [year, month] = period.split('-').map(Number);
      return month ? `${MONTH_NAMES[month - 1]} ${year}` : period;
    })();
  return `Acumulado al corte · ${monthLabel}`;
}

function buildPlanPisoMonthOptions(units) {
  const keys = new Set();
  const today = startOfDay(new Date());

  for (const unit of units) {
    if (unit.situacion !== 'FIS' || !unit.remisionDate) continue;
    const start = interestStartDate(unit.remisionDate);
    if (start > today) continue;

    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const endMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    while (cursor <= endMonth) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
      keys.add(key);
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  return [...keys]
    .sort((a, b) => (a < b ? 1 : -1))
    .map((value) => {
      const [year, month] = value.split('-').map(Number);
      return { value, label: `${MONTH_NAMES[month - 1]} ${year}` };
    });
}

function buildPlanPisoTable(units, period = 'all') {
  return units
    .filter((u) => u.situacion === 'FIS' && u.remisionDate)
    .map((u) => {
      const calc = calcPlanPisoForPeriod(u.importeRemision, u.remisionDate, period);
      return {
        serie: u.serie,
        tipoAuto: u.tipoAuto,
        anModelo: u.anModelo,
        ubicacion: u.ubicacion,
        fechaRemision: u.fechaRemision,
        daysInStock: calc.daysInStock,
        daysChargeable: calc.daysChargeable,
        daysOver30: Math.max(0, (calc.daysInStock || 0) - PLAN_PISO_DIAS_GRACIA),
        importeRemision: u.importeRemision,
        intereses: calc.intereses,
        factor: PLAN_PISO_FACTOR,
      };
    })
    .filter((u) => u.daysChargeable > 0)
    .sort((a, b) => b.intereses - a.intereses || b.daysChargeable - a.daysChargeable);
}

function parseRemisionDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  const text = String(value).trim();
  const parts = text.split(/[\/\-]/);
  if (parts.length === 3) {
    let day;
    let month;
    let year;
    if (parts[0].length === 4) {
      year = Number(parts[0]);
      month = Number(parts[1]);
      day = Number(parts[2]);
    } else {
      day = Number(parts[0]);
      month = Number(parts[1]);
      year = Number(parts[2]);
    }
    if (day && month && year) {
      const date = new Date(year, month - 1, day, 12, 0, 0);
      if (!Number.isNaN(date.getTime())) return date;
    }
  }

  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function daysSinceRemision(value) {
  const date = parseRemisionDate(value);
  if (!date) return null;
  const today = startOfDay(new Date());
  const remision = startOfDay(date);
  return Math.max(0, Math.round((today - remision) / 86400000));
}

function personName(row) {
  return [
    row.APAR_NOMBRE,
    row.APAR_PATERNO,
    row.APAR_MATERNO,
  ].map((v) => String(v || '').trim()).filter(Boolean).join(' ');
}

function mapRow(row) {
  const situacion = String(row.VEH_SITUACION || '').trim().toUpperCase();
  const remisionDate = parseRemisionDate(row.VEH_FECREMISION);
  const days = daysSinceRemision(row.VEH_FECREMISION);
  const importeRemision = Number(row.IMPORTE_REMISION ?? row.importe_remision ?? 0) || 0;
  const isApartada = situacion === 'SEP';
  const fechaApartado = String(row.VEH_FECHSEP || '').trim();
  const daysApartado = isApartada ? daysSinceRemision(row.VEH_FECHSEP) : null;
  const apartadoPor = isApartada ? (personName(row) || String(row.VEH_CVEUSU || '').trim() || 'Sin dato') : '';
  return {
    tipoAuto: String(row.VEH_TIPOAUTO || '').trim(),
    familia: String(row.UNC_FAMILIA || '').trim(),
    noInventario: row.VEH_NOINVENTA,
    catalogo: String(row.VEH_CATALOGO || '').trim(),
    anModelo: String(row.VEH_ANMODELO || '').trim(),
    serie: String(row.VEH_NUMSERIE || '').trim(),
    motor: String(row.VEH_NOMOTOR || '').trim(),
    colorExterior: String(row.COL_DESCRIPCION || row.VEH_COLOEXTE || '').trim(),
    colorInterior: String(row.COLINTE || row.VEH_COLOINTE || '').trim(),
    observacion: String(row.VEH_OBSERVACION || '').trim(),
    fechaRemision: row.VEH_FECREMISION,
    remisionDate,
    ubicacion: String(row.VEH_UBICACION || '').trim(),
    situacion,
    situacionLabel: SITUACION_LABELS[situacion] || situacion || 'Sin estatus',
    daysInStock: days,
    importeRemision,
    isApartada,
    fechaApartado,
    daysApartado,
    apartadoPor,
    usuarioApartado: String(row.VEH_CVEUSU || '').trim(),
    previas: Number(row.PREVIAS || 0) || 0,
    precio: Number(row.PRECIO_LISTA || row.VEH_VENTA || 0) || 0,
    miCosto: Number(row.VEH_COSTO1 || 0) || 0,
    bonificacion: Number(row.VEH_REBATE || 0) || 0,
    gastos: Number(row.GASTOS_REMISION || row.VEH_MISELANEOS || 0) || 0,
  };
}

function vinSuffix8(value) {
  const s = String(value || '').replace(/\s+/g, '').toUpperCase();
  if (!s) return '';
  return s.length <= 8 ? s : s.slice(-8);
}

/**
 * Cuenta pruebas de manejo por últimos 8 dígitos de VIN (columna M del sheet).
 */
function loadPruebasManejoCountByVin8() {
  const map = new Map();
  try {
    const Database = require('better-sqlite3');
    const dbPath = path.join(__dirname, '../../data/crm-ciclos.db');
    if (!fs.existsSync(dbPath)) return map;
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const hasTable = db.prepare(`
        SELECT 1 AS ok FROM sqlite_master
        WHERE type = 'table' AND name = 'crm_pruebas_manejo'
      `).get();
      if (!hasTable) return map;
      const rows = db.prepare(`
        SELECT vin, COUNT(*) AS n
        FROM crm_pruebas_manejo
        WHERE vin IS NOT NULL AND TRIM(vin) <> ''
        GROUP BY vin
      `).all();
      for (const row of rows) {
        const key = vinSuffix8(row.vin);
        if (!key) continue;
        map.set(key, (map.get(key) || 0) + (Number(row.n) || 0));
      }
    } finally {
      db.close();
    }
  } catch (err) {
    console.warn('[inventory] pruebas de manejo:', err.message);
  }
  return map;
}

function enrichUnitsWithPruebasManejo(units) {
  const counts = loadPruebasManejoCountByVin8();
  return units.map((unit) => {
    const vin8 = vinSuffix8(unit.serie);
    const pruebasManejo = vin8 ? (counts.get(vin8) || 0) : 0;
    const isDemo = unit.situacion === 'DEMO';
    return {
      ...unit,
      vin8: vin8 || null,
      pruebasManejo,
      daysAsDemo: isDemo ? unit.daysInStock : null,
    };
  });
}

async function getInventory({ planPisoPeriod = 'all' } = {}) {
  const rows = await query(`
    SELECT
      SER_VEHICULO.VEH_TIPOAUTO,
      UNI_CATALOGO.UNC_FAMILIA,
      SER_VEHICULO.VEH_NOINVENTA,
      SER_VEHICULO.VEH_CATALOGO,
      SER_VEHICULO.VEH_ANMODELO,
      SER_VEHICULO.VEH_NUMSERIE,
      SER_VEHICULO.VEH_NOMOTOR,
      SER_VEHICULO.VEH_COLOEXTE,
      E.COL_DESCRIPCION,
      SER_VEHICULO.VEH_COLOINTE,
      I.COL_DESCRIPCION AS COLINTE,
      SER_VEHICULO.VEH_OBSERVACION,
      SER_VEHICULO.VEH_FECREMISION,
      SER_VEHICULO.VEH_UBICACION,
      SER_VEHICULO.VEH_SITUACION,
      SER_VEHICULO.VEH_FECHSEP,
      SER_VEHICULO.VEH_PERAPAR,
      SER_VEHICULO.VEH_CVEUSU,
      LTRIM(RTRIM(ISNULL(ap.PER_NOMRAZON, ''))) AS APAR_NOMBRE,
      LTRIM(RTRIM(ISNULL(ap.PER_PATERNO, ''))) AS APAR_PATERNO,
      LTRIM(RTRIM(ISNULL(ap.PER_MATERNO, ''))) AS APAR_MATERNO,
      ISNULL(rem.IMPORTE_REMISION, 0) AS IMPORTE_REMISION,
      ISNULL(rem.GASTOS_REMISION, 0) AS GASTOS_REMISION,
      ISNULL(prev.PREVIAS, 0) AS PREVIAS,
      ISNULL(UNI_CATALOGO.UNC_PrecListaPub, ISNULL(UNI_CATALOGO.UNC_PRECLISTA, 0)) AS PRECIO_LISTA,
      ISNULL(SER_VEHICULO.VEH_VENTA, 0) AS VEH_VENTA,
      ISNULL(SER_VEHICULO.VEH_COSTO1, 0) AS VEH_COSTO1,
      ISNULL(SER_VEHICULO.VEH_REBATE, 0) AS VEH_REBATE,
      ISNULL(SER_VEHICULO.VEH_MISELANEOS, 0) AS VEH_MISELANEOS
    FROM SER_VEHICULO
    LEFT JOIN (
      SELECT
        vd.VHD_NOSERIE,
        SUM(
          CASE WHEN ISNULL(vd.VHD_TRASPLANPISO, '') = 'S' THEN
            ISNULL(vd.VHD_COSTO, 0)
            + CASE WHEN ISNULL(vd.VHD_APLICAIVA, '') = 'S'
              THEN ISNULL(vd.VHD_COSTO, 0) * 0.16 ELSE 0 END
          ELSE 0 END
        ) AS IMPORTE_REMISION,
        SUM(
          CASE
            WHEN UPPER(LTRIM(RTRIM(ISNULL(vd.VHD_DESCRIPCION, '')))) LIKE 'GASTOS%'
            THEN ISNULL(vd.VHD_COSTO, 0)
            ELSE 0
          END
        ) AS GASTOS_REMISION
      FROM UNI_VEHDETA vd
      GROUP BY vd.VHD_NOSERIE
    ) rem ON rem.VHD_NOSERIE = SER_VEHICULO.VEH_NUMSERIE
    LEFT JOIN (
      SELECT
        UPPER(LTRIM(RTRIM(o.ORE_NUMSERIE))) AS SERIE,
        COUNT(*) AS PREVIAS
      FROM SER_ORDEN o
      WHERE LEFT(LTRIM(RTRIM(o.ORE_IDORDEN)), 1) = 'S'
        AND o.ORE_STATUS <> 'C'
        AND o.ORE_NUMSERIE IS NOT NULL
        AND LTRIM(RTRIM(o.ORE_NUMSERIE)) <> ''
      GROUP BY UPPER(LTRIM(RTRIM(o.ORE_NUMSERIE)))
    ) prev ON prev.SERIE = UPPER(LTRIM(RTRIM(SER_VEHICULO.VEH_NUMSERIE)))
    LEFT JOIN PER_PERSONAS ap
      ON NULLIF(LTRIM(RTRIM(SER_VEHICULO.VEH_PERAPAR)), '') IS NOT NULL
      AND ISNUMERIC(LTRIM(RTRIM(SER_VEHICULO.VEH_PERAPAR))) = 1
      AND CAST(LTRIM(RTRIM(SER_VEHICULO.VEH_PERAPAR)) AS INT) = ap.PER_IDPERSONA
    INNER JOIN UNI_CATACOLOR AS E
      ON E.COL_CATALOGO = SER_VEHICULO.VEH_CATALOGO
      AND E.COL_MODELO = SER_VEHICULO.VEH_ANMODELO
      AND E.COL_TIPO = 'EXTERIOR'
      AND SER_VEHICULO.VEH_COLOEXTE = E.COL_CLAVE
      INNER JOIN UNI_CATACOLOR AS I
      ON I.COL_CATALOGO = SER_VEHICULO.VEH_CATALOGO
      AND I.COL_MODELO = SER_VEHICULO.VEH_ANMODELO
      AND I.COL_TIPO = 'INTERIOR'
      AND SER_VEHICULO.VEH_COLOINTE = I.COL_CLAVE
    INNER JOIN UNI_CATALOGO
      ON UNI_CATALOGO.UNC_MODELO = SER_VEHICULO.VEH_ANMODELO
      AND UNI_CATALOGO.UNC_IDCATALOGO = SER_VEHICULO.VEH_CATALOGO
    WHERE SER_VEHICULO.VEH_SITUACION IN ${INVENTORY_SITUATIONS}
    ORDER BY SER_VEHICULO.VEH_TIPOAUTO
  `);

  const units = enrichUnitsWithPruebasManejo(rows.map(mapRow));
  const utilidadHistorica = await loadUtilidadHistoricaPorVersion();
  const availableSituations = new Set(['DIS', 'FIS', 'SEP']);
  const available = units.filter((u) => availableSituations.has(u.situacion));
  const demos = units.filter((u) => u.situacion === 'DEMO');
  const apartadas = units.filter((u) => u.isApartada);
  const daysValues = units.map((u) => u.daysInStock).filter((d) => d !== null);
  const avgDays = daysValues.length
    ? Math.round(daysValues.reduce((s, d) => s + d, 0) / daysValues.length)
    : 0;

  const { ageingSlowTable, carlineFilters } = buildAgeingSlowTable(units, utilidadHistorica);

  // Compat: chart legacy (por modelo) ya no se usa en UI; se mantiene resumen top
  const ageingChart = ageingSlowTable.slice(0, 10).map((r) => ({
    model: `${r.carline} · ${r.version}`,
    units: r.units,
    avgDays: r.avgDays,
    heightPct: 0,
    critical: r.critical,
  }));

  const bySituacionMap = new Map();
  for (const unit of units) {
    const key = unit.situacion || 'OTRO';
    if (!bySituacionMap.has(key)) {
      bySituacionMap.set(key, { situacion: key, label: unit.situacionLabel, units: 0 });
    }
    bySituacionMap.get(key).units += 1;
  }
  const bySituacion = [...bySituacionMap.values()].sort((a, b) => b.units - a.units);

  const byFamiliaMap = new Map();
  for (const unit of units) {
    const key = unit.familia || 'Sin familia';
    byFamiliaMap.set(key, (byFamiliaMap.get(key) || 0) + 1);
  }
  const byFamilia = [...byFamiliaMap.entries()]
    .map(([label, count]) => ({ label, units: count }))
    .sort((a, b) => b.units - a.units)
    .slice(0, 8);

  const ageingAlerts = units
    .filter((u) =>
      u.situacion === 'FIS'
      && u.daysInStock !== null
      && u.daysInStock >= 60
    )
    .map((u) => {
      const planPiso = calcPlanPisoForPeriod(u.importeRemision, u.remisionDate, 'all');
      return {
        serie: u.serie,
        model: u.tipoAuto,
        situacion: u.situacionLabel,
        ubicacion: u.ubicacion,
        days: u.daysInStock,
        critical: u.daysInStock >= 90,
        planPisoAcumulado: planPiso.intereses,
        importeRemision: u.importeRemision,
      };
    })
    .sort((a, b) => b.planPisoAcumulado - a.planPisoAcumulado || b.days - a.days)
    .slice(0, 15);

  const ageingAlertsPlanPisoTotal = ageingAlerts.reduce((s, a) => s + (a.planPisoAcumulado || 0), 0);

  const inventoryTable = units.map((u) => {
    let status = 'Healthy';
    if (u.daysInStock !== null && u.daysInStock >= 90) status = 'Critical';
    else if (u.daysInStock !== null && u.daysInStock >= 60) status = 'Reordering';
    else if (['PED', 'PEN', 'TRAN'].includes(u.situacion)) status = 'Reordering';
    return { ...u, status };
  });

  const period = planPisoPeriod && /^\d{4}-\d{2}$/.test(planPisoPeriod)
    ? planPisoPeriod
    : 'all';
  const planPisoTable = buildPlanPisoTable(units, period);
  const planPisoTotal = planPisoTable.reduce((s, r) => s + r.intereses, 0);
  const planPisoMonths = buildPlanPisoMonthOptions(units);
  const periodLabel = formatPlanPisoPeriodLabel(period, planPisoMonths);
  const sinPrevias = units.filter((u) => Number(u.previas || 0) === 0).length;
  const conPrevias = units.length - sinPrevias;
  const demoDays = demos.map((u) => u.daysAsDemo).filter((d) => d != null);
  const avgDaysDemo = demoDays.length
    ? Math.round(demoDays.reduce((s, d) => s + d, 0) / demoDays.length)
    : 0;
  const demosConPruebas = demos.filter((u) => Number(u.pruebasManejo || 0) > 0).length;
  const demosPruebasTotal = demos.reduce((s, u) => s + (Number(u.pruebasManejo) || 0), 0);

  return {
    summary: {
      totalUnits: units.length,
      available: available.length,
      availableLibres: available.filter((u) => !u.isApartada).length,
      availableApartadas: apartadas.length,
      demos: demos.length,
      avgDaysDemo,
      demosConPruebas,
      demosPruebasTotal,
      avgDaysAvailable: avgDays,
      urgentAlerts: ageingAlerts.filter((a) => a.critical).length,
      ageingAlertsCount: ageingAlerts.length,
      ageingAlertsPlanPisoTotal: Math.round(ageingAlertsPlanPisoTotal * 100) / 100,
      bySituacion,
      sinPrevias,
      conPrevias,
      planPisoTotal: Math.round(planPisoTotal * 100) / 100,
      planPisoUnits: planPisoTable.length,
      planPisoFactor: PLAN_PISO_FACTOR,
      planPisoDiasGracia: PLAN_PISO_DIAS_GRACIA,
      planPisoPeriod: period,
      planPisoPeriodLabel: periodLabel,
    },
    planPisoMonths,
    ageingChart,
    ageingSlowTable,
    ageingCarlineFilters: carlineFilters,
    stockAlerts: ageingAlerts,
    byFamilia,
    inventoryTable,
    planPisoTable,
  };
}

function parseDateInput(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw Object.assign(new Error('Fecha invalida. Use formato YYYY-MM-DD.'), { status: 400 });
  }
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    throw Object.assign(new Error('Fecha invalida.'), { status: 400 });
  }
  return date;
}

function parseFechaDoc(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      iso: value.toISOString().slice(0, 10),
      monthKey: `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`,
    };
  }
  const text = String(value).trim();
  const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return { iso, monthKey: iso.slice(0, 7) };
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const iso = text.slice(0, 10);
    return { iso, monthKey: iso.slice(0, 7) };
  }
  return null;
}

function parseCsvLine(line) {
  const vals = [];
  let cur = '';
  let inq = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inq = !inq;
      continue;
    }
    if (ch === ',' && !inq) {
      vals.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  vals.push(cur);
  return vals;
}

function normalizeHeader(name) {
  return String(name || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toUpperCase();
}

function isGmMexicoConcesionario(value) {
  return GM_MEXICO_RE.test(String(value || '').trim());
}

function looksLikeVin(value) {
  return /^[A-HJ-NPR-Z0-9]{17}$/i.test(String(value || '').trim());
}

function isPlantaIntercambioConcesionario(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (looksLikeVin(text)) return false;
  if (text.length < 4) return false;
  return !isGmMexicoConcesionario(text);
}

function loadForecastSheetRows() {
  if (!fs.existsSync(FORECAST_SHEET_PATH)) {
    throw Object.assign(
      new Error('No se encontró forecast-source.csv (fuente de CONCESIONARIO).'),
      { status: 503 }
    );
  }
  const text = fs.readFileSync(FORECAST_SHEET_PATH, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { rows: [] };

  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  const idx = (name) => headers.indexOf(normalizeHeader(name));
  const col = {
    fechaVenta: idx('FECHA DE VENTA'),
    carline: idx('CARLINE'),
    tipoVenta: idx('TIPO DE VENTA'),
    pedido: idx('NUMERO DE PEDIDO'),
    catalogo: idx('CATALOGO'),
    anio: idx('MODELO'),
    color: idx('COLOR EXTERIOR'),
    serie: idx('NUMERO DE SERIE'),
    factura: idx('NUMERO DE FACTURA'),
    statusFactura: idx('STATUS DE FACTURA'),
    cliente: idx('NOMBRE DEL CLIENTE'),
    vendedor: idx('NOMBRE DEL VENDEDOR'),
    descripcion: idx('DESCRIPCION UNIDAD'),
    fechaEntrada: idx('FECHA ENTRADA'),
    fechaRemision: idx('FECHA REMISION'),
    fechaPlanta: idx('FECHA REPORTE EN PLANTA'),
    concesionario: idx('CONCESIONARIO'),
  };

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const vals = parseCsvLine(lines[i]);
    const get = (key) => {
      const iCol = col[key];
      if (iCol < 0) return '';
      return String(vals[iCol] || '').trim();
    };
    rows.push({
      fechaVenta: get('fechaVenta'),
      carline: get('carline'),
      tipoVenta: get('tipoVenta'),
      pedido: get('pedido'),
      catalogo: get('catalogo'),
      anio: get('anio'),
      color: get('color'),
      serie: get('serie'),
      factura: get('factura'),
      statusFactura: get('statusFactura'),
      cliente: get('cliente'),
      vendedor: get('vendedor'),
      descripcion: get('descripcion'),
      fechaEntrada: get('fechaEntrada'),
      fechaRemision: get('fechaRemision'),
      fechaPlanta: get('fechaPlanta'),
      concesionario: get('concesionario'),
    });
  }
  return { rows };
}

function rankingFromMap(map, limit = 15) {
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/**
 * Intercambios de planta: CONCESIONARIO ≠ GENERAL MOTORS DE MEXICO.
 * Unidades traídas de inventario de planta de otro concesionario (solicitud a facturar).
 */
async function getIntercambiosHistorico({ fechaInicio, fechaFin } = {}) {
  if (!fechaInicio || !fechaFin) {
    throw Object.assign(new Error('Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).'), { status: 400 });
  }
  const inicio = parseDateInput(fechaInicio);
  const fin = parseDateInput(fechaFin);
  if (inicio > fin) {
    throw Object.assign(new Error('La fecha inicial no puede ser mayor que la fecha final.'), { status: 400 });
  }

  const sheet = loadForecastSheetRows();
  const byMesMap = new Map();
  const byModeloMap = new Map();
  const byModeloAnioMap = new Map();
  const byConcesionarioMap = new Map();
  const rows = [];

  for (const raw of sheet.rows) {
    if (!isPlantaIntercambioConcesionario(raw.concesionario)) continue;

    const fecha =
      parseFechaDoc(raw.fechaVenta)
      || parseFechaDoc(raw.fechaEntrada)
      || parseFechaDoc(raw.fechaRemision)
      || parseFechaDoc(raw.fechaPlanta);
    if (!fecha?.iso) continue;
    if (fecha.iso < fechaInicio || fecha.iso > fechaFin) continue;

    const carline = raw.carline || '(Sin carline)';
    const anio = raw.anio || null;
    const modeloKey = anio ? `${carline} ${anio}` : carline;
    const concesionario = raw.concesionario;

    if (fecha.monthKey) {
      byMesMap.set(fecha.monthKey, (byMesMap.get(fecha.monthKey) || 0) + 1);
    }
    byModeloMap.set(carline, (byModeloMap.get(carline) || 0) + 1);
    byModeloAnioMap.set(modeloKey, (byModeloAnioMap.get(modeloKey) || 0) + 1);
    byConcesionarioMap.set(concesionario, (byConcesionarioMap.get(concesionario) || 0) + 1);

    rows.push({
      fecha: fecha.iso,
      fechaEntrada: parseFechaDoc(raw.fechaEntrada)?.iso || null,
      fechaRemision: parseFechaDoc(raw.fechaRemision)?.iso || null,
      fechaPlanta: parseFechaDoc(raw.fechaPlanta)?.iso || null,
      serie: raw.serie || null,
      carline,
      modelo: raw.descripcion || carline,
      anModelo: anio,
      catalogo: raw.catalogo || null,
      color: raw.color || null,
      concesionario,
      tipoVenta: raw.tipoVenta || null,
      pedido: raw.pedido || null,
      factura: raw.factura || null,
      statusFactura: raw.statusFactura || null,
      cliente: raw.cliente || null,
      vendedor: raw.vendedor || null,
      origen: 'planta-otro-concesionario',
    });
  }

  rows.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || ''))
    || String(a.carline || '').localeCompare(String(b.carline || '')));

  const porMes = [...byMesMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, count]) => {
      const [y, m] = key.split('-');
      return {
        key,
        label: `${MONTH_NAMES[Number(m) - 1] || m} ${y}`,
        count,
      };
    });

  const porModelo = rankingFromMap(byModeloMap, 20);
  const porModeloAnio = rankingFromMap(byModeloAnioMap, 20);
  const porConcesionario = rankingFromMap(byConcesionarioMap, 20);
  const topModelo = porModelo[0] || null;
  const topModeloAnio = porModeloAnio[0] || null;
  const topConcesionario = porConcesionario[0] || null;
  const total = rows.length;
  const shareTopModelo = total && topModelo
    ? Number(((topModelo.count / total) * 100).toFixed(1))
    : 0;

  const insights = [];
  if (topModelo) {
    insights.push({
      severity: 'info',
      title: `Auto más solicitado a facturar: ${topModelo.label}`,
      detail: `${topModelo.count} unidad(es) · ${shareTopModelo}% del periodo (CONCESIONARIO ≠ GENERAL MOTORS DE MEXICO).`,
      action: 'Priorizar cupo/pedido de este carline en intercambios de planta',
    });
  }
  if (topModeloAnio && topModelo && topModeloAnio.label !== topModelo.label) {
    insights.push({
      severity: 'info',
      title: `Combinación más pedida: ${topModeloAnio.label}`,
      detail: `${topModeloAnio.count} unidad(es) carline+año.`,
      action: 'Revisar disponibilidad de ese modelo-año en planta',
    });
  }
  if (topConcesionario) {
    insights.push({
      severity: 'info',
      title: `Concesionario origen top: ${topConcesionario.label}`,
      detail: `${topConcesionario.count} unidad(es) traídas de su inventario de planta.`,
      action: 'Monitorear reciprocidad / saldo de intercambios con ese dealer',
    });
  }
  if (!total) {
    insights.push({
      severity: 'ok',
      title: 'Sin intercambios de planta en el periodo',
      detail: 'No hay unidades con CONCESIONARIO distinto de GENERAL MOTORS DE MEXICO.',
      action: 'Amplíe el rango de fechas si espera movimiento',
    });
  }

  return {
    periodo: { fechaInicio, fechaFin },
    fuente: {
      criterio: 'CONCESIONARIO distinto de GENERAL MOTORS DE MEXICO = unidad traída de inventario de planta (otro concesionario)',
      archivo: 'backend/data/forecast-source.csv',
      campo: 'CONCESIONARIO',
    },
    summary: {
      total,
      modelosDistintos: byModeloMap.size,
      concesionariosOrigen: byConcesionarioMap.size,
      topModelo: topModelo?.label || null,
      topModeloUnidades: topModelo?.count || 0,
      topModeloSharePct: shareTopModelo,
      topModeloAnio: topModeloAnio?.label || null,
      topModeloAnioUnidades: topModeloAnio?.count || 0,
      topConcesionario: topConcesionario?.label || null,
      topConcesionarioUnidades: topConcesionario?.count || 0,
      mesesConMovimiento: porMes.filter((m) => m.count > 0).length,
    },
    porMes,
    porModelo,
    porModeloAnio,
    porConcesionario,
    insights,
    rows,
  };
}

function formatIsoDate(value) {
  const date = parseRemisionDate(value);
  if (!date) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Análisis de unidades vendidas: utilidad real, % por carline,
 * extras fijos y plan piso según días que duró en inventario (remisión → venta).
 * Utilidad bruta = Subtotal − costo (valor de unidad) + bonificación − nota crédito s/IVA.
 * Comisión E.V. = % menudeo del mes anterior × (utilidad bruta − gastos extra).
 */
async function getVendidosAnalisis({ fechaInicio, fechaFin } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaInicio || '') || !/^\d{4}-\d{2}-\d{2}$/.test(fechaFin || '')) {
    const err = new Error('Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).');
    err.status = 400;
    throw err;
  }

  const rows = await query(`
    ${VENTAS_BASE_CTE}
    SELECT
      UPPER(LTRIM(RTRIM(ISNULL(NULLIF(cat.UNC_FAMILIA, ''), 'SIN FAMILIA')))) AS carline,
      LTRIM(RTRIM(v.modelo)) AS version,
      LTRIM(RTRIM(ISNULL(veh.VEH_CATALOGO, ''))) AS catalogo,
      v.VTE_SERIE AS vin,
      v.VTE_DOCTO AS factura,
      v.VTE_FECHDOCTO AS fechaVenta,
      v.VTE_FORMAPAGO AS formaPago,
      LTRIM(RTRIM(ISNULL(veh.VEH_VENDEDOR, ''))) AS vendedorId,
      RTRIM(LTRIM(
        ISNULL(ven.PER_NOMRAZON, '') + ' ' + ISNULL(ven.PER_PATERNO, '') + ' ' + ISNULL(ven.PER_MATERNO, '')
      )) AS vendedor,
      v.cliente,
      LTRIM(RTRIM(ISNULL(veh.VEH_OBSERVACION, ''))) AS observacion,
      LTRIM(RTRIM(ISNULL(veh.veh_observs, ''))) AS observs,
      LTRIM(RTRIM(ISNULL(veh.VEH_SITUACIONES, ''))) AS situaciones,
      LTRIM(RTRIM(ISNULL(veh.VEH_UBICACION, ''))) AS ubicacion,
      LTRIM(RTRIM(ISNULL(veh.VEH_TIPOAUTO, ''))) AS tipoAuto,
      veh.VEH_FECREMISION AS fechaRemision,
      COALESCE(
        NULLIF(libro.SUBTOTAL, 0),
        CASE
          WHEN ISNULL(v.ventaSubtotal, 0) > 0
          THEN ISNULL(v.ventaSubtotal, 0) - ISNULL(v.ventaIsan, 0)
          ELSE 0
        END
      ) AS subtotal,
      ISNULL(v.ventaIsan, 0) AS isan,
      ISNULL(NULLIF(libro.pen_costo1, 0), v.costoMiCosto) AS miCosto,
      ISNULL(libro.BONIFICACION, v.bonificacion) AS bonificacion,
      ISNULL(veh.VEH_REBATE, 0) AS rebate,
      COALESCE(
        NULLIF(ABS(ISNULL(rem.GASTOS_REMISION, 0)), 0),
        NULLIF(ABS(ISNULL(libro.pen_costo3, 0)), 0),
        ABS(ISNULL(libro.VEH_MISELANEOS, v.gastos))
      ) AS gastos,
      ISNULL(rem.IMPORTE_REMISION, 0) AS importeRemision,
      ISNULL(rem.VALOR_UNIDAD, 0) AS valorUnidad,
      ISNULL(rem.COSTO_REMISION, 0) AS costoRemision,
      ISNULL(rem.BONIFICACION_REMISION, 0) AS bonificacionRemision,
      ISNULL(libro.IMPNCRBON, 0) AS notaCargoLibro,
      LTRIM(RTRIM(ISNULL(libro.IDNCRBON, ''))) AS notaCargoFolioLibro,
      ISNULL(ncr.IMPORTE, 0) AS notaCargoCxc,
      LTRIM(RTRIM(ISNULL(ncr.FOLIO, ''))) AS notaCargoFolioCxc,
      ISNULL(apn.IMPORTE, 0) AS notaCargoAplicada,
      LTRIM(RTRIM(ISNULL(apn.FOLIO, ''))) AS notaCargoFolioAplicada,
      ISNULL(ncPago.IMPORTE, 0) AS notaCreditoPago,
      LTRIM(RTRIM(ISNULL(ncPago.FOLIO, ''))) AS notaCreditoFolioPago
    FROM ventas v
    INNER JOIN SER_VEHICULO veh
      ON veh.VEH_NUMSERIE = v.VTE_SERIE
      AND veh.VEH_NOINVENTA > 0
    LEFT JOIN PER_PERSONAS ven ON ven.PER_IDPERSONA = veh.VEH_VENDEDOR
    LEFT JOIN UNI_TEMLIBROVENTAS libro
      ON libro.VTE_DOCTO = v.VTE_DOCTO
      AND libro.VTE_ORGSTATUS = 'I'
    LEFT JOIN UNI_CATALOGO cat
      ON cat.UNC_MODELO = veh.VEH_ANMODELO
      AND cat.UNC_IDCATALOGO = veh.VEH_CATALOGO
    LEFT JOIN (
      SELECT
        LTRIM(RTRIM(CCP_REFERNCRBONI)) AS FACTURA,
        SUM(ISNULL(CCP_ABONO, 0)) AS IMPORTE,
        MIN(LTRIM(RTRIM(CCP_IDDOCTO))) AS FOLIO
      FROM VIS_CONCAR01
      WHERE CCP_TIPODOCTO = 'NCRBON'
        AND LTRIM(RTRIM(ISNULL(CCP_REFERNCRBONI, ''))) LIKE 'ANS%'
        AND ISNULL(CCP_ABONO, 0) > 0
      GROUP BY LTRIM(RTRIM(CCP_REFERNCRBONI))
    ) ncr ON ncr.FACTURA = v.VTE_DOCTO
    LEFT JOIN (
      SELECT
        LTRIM(RTRIM(CCP_IDDOCTO)) AS FACTURA,
        SUM(ISNULL(CCP_ABONO, 0)) AS IMPORTE,
        MIN(LTRIM(RTRIM(ISNULL(CCP_VFDOCTO, '')))) AS FOLIO
      FROM VIS_CONCAR01
      WHERE CCP_TIPODOCTO IN ('APNCBON', 'APNCRBONI')
        AND LTRIM(RTRIM(ISNULL(CCP_IDDOCTO, ''))) LIKE 'ANS%'
        AND ISNULL(CCP_ABONO, 0) > 0
      GROUP BY LTRIM(RTRIM(CCP_IDDOCTO))
    ) apn ON apn.FACTURA = v.VTE_DOCTO
    LEFT JOIN (
      SELECT
        LTRIM(RTRIM(p.PAM_DOCAFECTADO)) AS FACTURA,
        SUM(ISNULL(d.PAD_IMPORTE, 0)) AS IMPORTE,
        MIN(LTRIM(RTRIM(ISNULL(d.PAD_REFERENCIA, '')))) AS FOLIO
      FROM CXC_PAGANT p
      INNER JOIN CXC_PAGANTDET d ON d.PAD_CONSPAGO = p.PAM_CONSCARTERA
      WHERE UPPER(LTRIM(RTRIM(ISNULL(d.PAD_TIPOPAGO, '')))) = 'SCOTI'
        AND LTRIM(RTRIM(ISNULL(p.PAM_DOCAFECTADO, ''))) LIKE 'ANS%'
        AND ISNULL(d.PAD_IMPORTE, 0) > 0
      GROUP BY LTRIM(RTRIM(p.PAM_DOCAFECTADO))
    ) ncPago ON ncPago.FACTURA = v.VTE_DOCTO
    LEFT JOIN (
      SELECT
        vd.VHD_NOSERIE,
        SUM(
          CASE WHEN ISNULL(vd.VHD_TRASPLANPISO, '') = 'S' THEN
            ISNULL(vd.VHD_COSTO, 0)
            + CASE WHEN ISNULL(vd.VHD_APLICAIVA, '') = 'S'
              THEN ISNULL(vd.VHD_COSTO, 0) * 0.16 ELSE 0 END
          ELSE 0 END
        ) AS IMPORTE_REMISION,
        SUM(
          CASE WHEN ISNULL(vd.VHD_TRASPLANPISO, '') = 'S'
            THEN ISNULL(vd.VHD_COSTO, 0) ELSE 0 END
        ) AS COSTO_REMISION,
        MAX(
          CASE
            WHEN UPPER(LTRIM(RTRIM(ISNULL(vd.VHD_DESCRIPCION, '')))) LIKE 'VALOR DE UNIDAD%'
              OR UPPER(LTRIM(RTRIM(ISNULL(vd.VHD_DESCRIPCION, '')))) LIKE 'VALOR DE LA UNIDAD%'
              OR UPPER(LTRIM(RTRIM(ISNULL(vd.VHD_DESCRIPCION, '')))) LIKE 'VALOR UNIDAD%'
            THEN ISNULL(vd.VHD_COSTO, 0)
            ELSE NULL
          END
        ) AS VALOR_UNIDAD,
        SUM(
          CASE
            WHEN UPPER(LTRIM(RTRIM(ISNULL(vd.VHD_TIPO, '')))) = 'BON'
              OR UPPER(LTRIM(RTRIM(ISNULL(vd.VHD_DESCRIPCION, '')))) LIKE '%BONIFICACION%'
            THEN ISNULL(vd.VHD_COSTO, 0)
            ELSE 0
          END
        ) AS BONIFICACION_REMISION,
        SUM(
          CASE
            WHEN UPPER(LTRIM(RTRIM(ISNULL(vd.VHD_DESCRIPCION, '')))) LIKE 'GASTOS%'
            THEN ISNULL(vd.VHD_COSTO, 0)
            ELSE 0
          END
        ) AS GASTOS_REMISION
      FROM UNI_VEHDETA vd
      GROUP BY vd.VHD_NOSERIE
    ) rem ON rem.VHD_NOSERIE = v.VTE_SERIE
    WHERE CONVERT(date, v.VTE_FECHDOCTO, 103) BETWEEN CONVERT(date, @fechaInicio, 23) AND CONVERT(date, @fechaFin, 23)
    ORDER BY CONVERT(date, v.VTE_FECHDOCTO, 103) DESC, v.VTE_SERIE
  `, { fechaInicio, fechaFin });

  const seen = new Set();
  const unique = [];
  for (const row of rows || []) {
    const key = `${row.factura || ''}|${row.vin || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }

  const prevMonth = previousCalendarMonth(fechaInicio);
  const vinsList = unique.map((r) => r.vin);
  const [prevByVendedor, leasingVins, ingresosFiByVin] = await Promise.all([
    prevMonth
      ? loadVentasPreviasPorVendedor(prevMonth.fechaInicio, prevMonth.fechaFin)
      : Promise.resolve(new Map()),
    Promise.resolve(loadLeasingVinSet(vinsList)),
    Promise.resolve(loadIngresosFinanciamientoByVin(vinsList)),
  ]);

  const table = [];
  for (const row of unique) {
    const remisionDate = parseRemisionDate(row.fechaRemision);
    const ventaDate = parseRemisionDate(row.fechaVenta);
    const piso = calcPlanPisoUntil(row.importeRemision, remisionDate, ventaDate);
    const days = piso.daysInStock;
    const bonifLibro = Number(row.bonificacion || 0) || 0;
    const bonifRemision = Math.abs(Number(row.bonificacionRemision || 0) || 0);
    const bonifVehiculo = Math.abs(Number(row.rebate || 0) || 0);
    const bonificacion = bonifLibro || bonifRemision || bonifVehiculo;
    const valorUnidad = Number(row.valorUnidad || 0) || 0;
    const costo = valorUnidad > 0 ? roundMoney(valorUnidad) : null;
    const notaCargo = Math.abs(Number(row.notaCreditoPago || 0) || 0)
      || Math.abs(Number(row.notaCargoCxc || 0) || 0)
      || Math.abs(Number(row.notaCargoAplicada || 0) || 0)
      || Math.abs(Number(row.notaCargoLibro || 0) || 0);
    const notaCargoFolio = String(
      row.notaCreditoFolioPago
      || row.notaCargoFolioCxc
      || row.notaCargoFolioAplicada
      || row.notaCargoFolioLibro
      || ''
    ).trim() || null;
    const notaCargoSinIva = notaCargo > 0 ? roundMoney(notaCargo / 1.16) : 0;
    const subtotal = Number(row.subtotal || 0) || 0;
    const utilidad = costo != null && subtotal > 0
      ? roundMoney(subtotal - costo + bonificacion - (notaCargoSinIva || 0))
      : null;
    const extrasDet = buildGastosExtras(row.carline, row.version, row.gastos);
    const extras = extrasDet.total;
    const demo = detectDemoVendido(row);
    const formaPago = String(row.formaPago || '').trim();
    const planPiso = days != null && days > PLAN_PISO_DIAS_GRACIA ? (piso.intereses || 0) : 0;
    const comisionEv = calcComisionEv({
      utilidad,
      extras,
      vendedorId: row.vendedorId,
      vin: row.vin,
      formaPago: formaPago,
      cliente: row.cliente,
      prevByVendedor,
      leasingVins,
    });
    const utilidadNeta = utilidad == null
      ? null
      : roundMoney(utilidad - (comisionEv.importe || 0) - extras - planPiso);
    const fi = ingresosFiByVin.get(normalizeVinKey(row.vin)) || null;

    table.push({
      carline: row.carline || 'Sin familia',
      version: row.version || 'Sin versión',
      paquete: extractPaqueteLetter(row.version) || null,
      catalogo: row.catalogo || null,
      vin: row.vin || null,
      factura: row.factura || null,
      fechaVenta: formatIsoDate(ventaDate),
      fechaRemision: formatIsoDate(remisionDate),
      daysInStock: days,
      precio: subtotal || null,
      isan: Number(row.isan || 0) || 0,
      costo,
      bonificacion,
      notaCargo,
      notaCargoFolio,
      utilidadPromedio: utilidad,
      unidadesVendidas: 1,
      vendedorId: row.vendedorId || null,
      vendedor: String(row.vendedor || '').trim() || null,
      cliente: String(row.cliente || '').replace(/\s+/g, ' ').trim() || null,
      formaPago: formaPago || null,
      tipoVenta: labelTipoVenta(formaPago),
      isFlotilla: isFlotillaFormaPago(formaPago),
      isDemo: demo.isDemo,
      demoHint: demo.demoHint,
      observacion: String(row.observacion || row.observs || '').trim() || null,
      ubicacion: String(row.ubicacion || '').trim() || null,
      comisionEv: comisionEv.importe || 0,
      comisionEvBase: comisionEv.base,
      comisionEvPct: comisionEv.pctTotal,
      comisionEvPctVehiculo: comisionEv.pctVehiculo,
      comisionEvPctLeasing: comisionEv.pctLeasing,
      comisionEvUnidadesPrev: comisionEv.unidadesPrev,
      comisionEvArrendamiento: comisionEv.esArrendamiento,
      comisionEvMesPrev: prevMonth?.label || null,
      costoPrevia: extrasDet.previa,
      costoMercadotecnia: extrasDet.publicidad,
      costoPublicidad: extrasDet.publicidad,
      gasolinaLitros: extrasDet.gasolina.litros,
      gasolinaPrecioLitro: extrasDet.gasolina.precioLitro,
      costoGasolina: extrasDet.gasolina.importe,
      costoEntrega: extrasDet.cargoEntrega,
      gastos: extrasDet.gastos,
      gastosAdicionales: extras,
      planPisoAcumulado: roundMoney(planPiso) || 0,
      generaInteres: days != null && days > PLAN_PISO_DIAS_GRACIA,
      ingresoFinanciamiento: fi ? (fi.monto || 0) : null,
      ingresoFinanciamientoCount: fi ? (fi.count || 0) : 0,
      ingresoFinanciamientoFuente: fi ? fi.fuente : null,
      ingresoFinanciamientoDetalle: fi ? (fi.byConcepto || []) : [],
      utilidadNeta,
      daysChargeable: piso.daysChargeable || 0,
    });
  }

  const byCarline = new Map();
  for (const row of table) {
    if (row.utilidadPromedio == null || !row.precio) continue;
    const key = normalizeMatchKey(row.carline);
    const prev = byCarline.get(key) || { utilidad: 0, subtotal: 0 };
    prev.utilidad += Number(row.utilidadPromedio || 0);
    prev.subtotal += Number(row.precio || 0);
    byCarline.set(key, prev);
  }
  for (const row of table) {
    const agg = byCarline.get(normalizeMatchKey(row.carline));
    row.utilidadPctCarline = agg && agg.subtotal
      ? roundMoney((agg.utilidad / agg.subtotal) * 100)
      : null;
  }

  table.sort((a, b) =>
    (Number(b.daysInStock || 0) - Number(a.daysInStock || 0))
    || (Number(b.planPisoAcumulado || 0) - Number(a.planPisoAcumulado || 0))
    || String(b.fechaVenta || '').localeCompare(String(a.fechaVenta || ''))
  );

  const carlineFilters = [...table.reduce((map, row) => {
    const label = row.carline || 'Sin familia';
    map.set(label, (map.get(label) || 0) + 1);
    return map;
  }, new Map()).entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    fechaInicio,
    fechaFin,
    vendidosTable: table,
    carlineFilters,
    comisionEvMesPrev: prevMonth?.label || null,
    summary: {
      unidades: table.length,
      utilidad: roundMoney(table.reduce((s, r) => s + Number(r.utilidadPromedio || 0), 0)),
      comisionEv: roundMoney(table.reduce((s, r) => s + Number(r.comisionEv || 0), 0)),
      extras: roundMoney(table.reduce((s, r) => s + Number(r.gastosAdicionales || 0), 0)),
      planPiso: roundMoney(table.reduce((s, r) => s + Number(r.planPisoAcumulado || 0), 0)),
      ingresoFinanciamiento: roundMoney(
        table.reduce((s, r) => s + Number(r.ingresoFinanciamiento || 0), 0)
      ),
      conIngresoFinanciamiento: table.filter((r) => Number(r.ingresoFinanciamiento || 0) > 0).length,
      utilidadNeta: roundMoney(table.reduce((s, r) => s + Number(r.utilidadNeta || 0), 0)),
      conPlanPiso: table.filter((r) => Number(r.planPisoAcumulado || 0) > 0).length,
      conNotaCargo: table.filter((r) => Number(r.notaCargo || 0) > 0).length,
      conArrendamiento: table.filter((r) => r.comisionEvArrendamiento).length,
    },
  };
}

module.exports = {
  getInventory,
  getIntercambiosHistorico,
  getVendidosAnalisis,
  vinSuffix8,
  loadPruebasManejoCountByVin8,
};
