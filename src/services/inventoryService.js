const { query } = require('../db');

const INVENTORY_SITUATIONS = `('FIS', 'DIS', 'PED', 'PEN', 'SEP', 'DEMO', 'TRAN')`;
const PLAN_PISO_FACTOR = 0.00020778;
const PLAN_PISO_DIAS_GRACIA = 30;
const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const SITUACION_LABELS = {
  FIS: 'Físico',
  DIS: 'Disponible',
  PED: 'Pedido',
  PEN: 'Pendiente',
  SEP: 'Separado',
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

function mapRow(row) {
  const situacion = String(row.VEH_SITUACION || '').trim().toUpperCase();
  const remisionDate = parseRemisionDate(row.VEH_FECREMISION);
  const days = daysSinceRemision(row.VEH_FECREMISION);
  const importeRemision = Number(row.IMPORTE_REMISION ?? row.importe_remision ?? 0) || 0;
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
  };
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
      ISNULL(rem.IMPORTE_REMISION, 0) AS IMPORTE_REMISION
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

  const units = rows.map(mapRow);
  const availableSituations = new Set(['DIS', 'FIS']);
  const available = units.filter((u) => availableSituations.has(u.situacion));
  const daysValues = units.map((u) => u.daysInStock).filter((d) => d !== null);
  const avgDays = daysValues.length
    ? Math.round(daysValues.reduce((s, d) => s + d, 0) / daysValues.length)
    : 0;

  const ageingMap = new Map();
  for (const unit of units) {
    if (unit.situacion === 'DEMO') continue;
    const model = unit.tipoAuto || 'Sin modelo';
    if (!ageingMap.has(model)) ageingMap.set(model, { model, days: [], units: 0 });
    const entry = ageingMap.get(model);
    entry.units += 1;
    if (unit.daysInStock !== null) entry.days.push(unit.daysInStock);
  }

  const ageingByModel = [...ageingMap.values()]
    .map((r) => ({
      model: r.model,
      units: r.units,
      avgDays: r.days.length ? Math.round(r.days.reduce((s, d) => s + d, 0) / r.days.length) : 0,
    }))
    .sort((a, b) => b.avgDays - a.avgDays)
    .slice(0, 10);

  const maxDays = Math.max(...ageingByModel.map((r) => r.avgDays), 1);
  const ageingChart = ageingByModel.map((r) => ({
    ...r,
    heightPct: Math.round((r.avgDays / maxDays) * 100),
    critical: r.avgDays > 90,
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

  return {
    summary: {
      totalUnits: units.length,
      available: available.length,
      avgDaysAvailable: avgDays,
      urgentAlerts: ageingAlerts.filter((a) => a.critical).length,
      ageingAlertsCount: ageingAlerts.length,
      ageingAlertsPlanPisoTotal: Math.round(ageingAlertsPlanPisoTotal * 100) / 100,
      bySituacion,
      planPisoTotal: Math.round(planPisoTotal * 100) / 100,
      planPisoUnits: planPisoTable.length,
      planPisoFactor: PLAN_PISO_FACTOR,
      planPisoDiasGracia: PLAN_PISO_DIAS_GRACIA,
      planPisoPeriod: period,
      planPisoPeriodLabel: periodLabel,
    },
    planPisoMonths,
    ageingChart,
    stockAlerts: ageingAlerts,
    byFamilia,
    inventoryTable,
    planPisoTable,
  };
}

module.exports = { getInventory };
