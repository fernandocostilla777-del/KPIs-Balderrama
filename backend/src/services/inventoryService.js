const fs = require('fs');
const path = require('path');
const { query } = require('../db');

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
function calcPlanPisoForPeriod(importeRemision, remisionDate, period = 'all') {
  if (!remisionDate) {
    return { daysInStock: null, daysChargeable: 0, intereses: 0, cutoffDate: null };
  }

  const today = startOfDay(new Date());
  const remision = startOfDay(remisionDate);
  const interestStart = interestStartDate(remision);

  let cutoffDate = today;

  if (period && period !== 'all') {
    const [year, month] = period.split('-').map(Number);
    if (!year || !month) {
      return { daysInStock: null, daysChargeable: 0, intereses: 0, cutoffDate: null };
    }
    const monthEnd = new Date(year, month, 0);
    cutoffDate = monthEnd < today ? monthEnd : today;
  }

  const daysInStock = Math.max(0, Math.round((cutoffDate - remision) / 86400000));
  const daysChargeable = interestStart > cutoffDate
    ? 0
    : daysInclusive(interestStart, cutoffDate);
  const monto = Number(importeRemision) || 0;
  const intereses = daysChargeable > 0 ? PLAN_PISO_FACTOR * monto * daysChargeable : 0;

  return {
    daysInStock,
    daysChargeable,
    intereses: Math.round(intereses * 100) / 100,
    cutoffDate,
  };
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
      ISNULL(prev.PREVIAS, 0) AS PREVIAS
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
        ) AS IMPORTE_REMISION
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
  const availableSituations = new Set(['DIS', 'FIS', 'SEP']);
  const available = units.filter((u) => availableSituations.has(u.situacion));
  const demos = units.filter((u) => u.situacion === 'DEMO');
  const apartadas = units.filter((u) => u.isApartada);
  const daysValues = units.map((u) => u.daysInStock).filter((d) => d !== null);
  const avgDays = daysValues.length
    ? Math.round(daysValues.reduce((s, d) => s + d, 0) / daysValues.length)
    : 0;

  const ageingSlowMap = new Map();
  for (const unit of units) {
    if (unit.situacion === 'DEMO') continue;
    if (unit.daysInStock === null) continue;
    const carline = unit.familia || 'Sin familia';
    const version = unit.tipoAuto || 'Sin versión';
    const color = unit.colorExterior || 'Sin color';
    const key = `${carline}||${version}||${color}`;
    if (!ageingSlowMap.has(key)) {
      ageingSlowMap.set(key, {
        carline,
        version,
        color,
        days: [],
        units: 0,
      });
    }
    const entry = ageingSlowMap.get(key);
    entry.units += 1;
    entry.days.push(unit.daysInStock);
  }

  const ageingSlowTable = [...ageingSlowMap.values()]
    .map((r) => {
      const avgDays = r.days.length
        ? Math.round(r.days.reduce((s, d) => s + d, 0) / r.days.length)
        : 0;
      const maxDaysUnit = r.days.length ? Math.max(...r.days) : 0;
      return {
        carline: r.carline,
        version: r.version,
        color: r.color,
        units: r.units,
        avgDays,
        maxDays: maxDaysUnit,
        critical: avgDays >= 90,
        warn: avgDays >= 60 && avgDays < 90,
      };
    })
    .sort((a, b) => b.avgDays - a.avgDays || b.units - a.units)
    .slice(0, 30);

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

module.exports = {
  getInventory,
  getIntercambiosHistorico,
  vinSuffix8,
  loadPruebasManejoCountByVin8,
};
