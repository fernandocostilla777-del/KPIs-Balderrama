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

  const units = rows.map(mapRow);
  const availableSituations = new Set(['DIS', 'FIS', 'SEP']);
  const available = units.filter((u) => availableSituations.has(u.situacion));
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

  return {
    summary: {
      totalUnits: units.length,
      available: available.length,
      availableLibres: available.filter((u) => !u.isApartada).length,
      availableApartadas: apartadas.length,
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

const SITUACION_ENTRANTE_OK = new Set(['FIS', 'DIS', 'SEP', 'PED', 'PEN', 'TRAN', 'DEMO', 'VEN']);
const SITUACION_ENTRANTE_EN_PROCESO = new Set(['PED', 'PEN', 'TRAN']);
const SITUACION_ENTRANTE_STOCK = new Set(['FIS', 'DIS', 'SEP', 'DEMO']);

function daysBetweenIso(fromIso, toDate = new Date()) {
  if (!fromIso || !/^\d{4}-\d{2}-\d{2}/.test(fromIso)) return null;
  const a = new Date(`${fromIso.slice(0, 10)}T12:00:00`);
  const b = startOfDay(toDate);
  if (Number.isNaN(a.getTime())) return null;
  return Math.max(0, Math.round((b - startOfDay(a)) / 86400000));
}

function evaluateAdquisicionCanje(row) {
  const dias = row.diasDesdeVenta;
  const hasCanjePor = Boolean(row.canjePor);
  const hasEntrante = Boolean(row.vinEntrante);
  const sit = String(row.sitEntrante || '').toUpperCase();

  if (!hasCanjePor) {
    const critical = dias != null && dias >= 3;
    return {
      severity: critical ? 'critical' : 'warning',
      ruleId: critical ? 'canje-sin-adquisicion' : 'canje-sin-vin',
      title: critical ? 'Adquisición no registrada' : 'Sin VIN de unidad entrante',
      detail: 'El canje tiene CONCCANJE pero VEH_CANJEPOR está vacío. Capture el VIN de la unidad adquirida.',
      action: 'Capturar VIN en CANJEPOR y dar de alta la unidad entrante',
      adquisicionOk: false,
    };
  }

  if (!hasEntrante) {
    const critical = dias != null && dias >= 7;
    return {
      severity: critical ? 'critical' : 'warning',
      ruleId: critical ? 'entrante-fantasma' : 'entrante-sin-match',
      title: critical ? 'VIN entrante inexistente' : 'VIN entrante sin alta',
      detail: `CANJEPOR=${row.canjePor} no aparece en inventario DMS.`,
      action: 'Verificar VIN capturado o completar alta de la unidad entrante',
      adquisicionOk: false,
    };
  }

  if (!SITUACION_ENTRANTE_OK.has(sit) || Number(row.noInvEntrante || 0) <= 0) {
    return {
      severity: 'critical',
      ruleId: 'entrante-bloqueado',
      title: 'Alta entrante inválida',
      detail: `Unidad ${row.vinEntrante} en situación ${sit || '—'} / inventario ${row.noInvEntrante ?? '—'}`,
      action: 'Revisar estatus de la unidad entrante en DMS',
      adquisicionOk: false,
    };
  }

  if (SITUACION_ENTRANTE_EN_PROCESO.has(sit)) {
    const atrasado = dias != null && dias >= 14;
    return {
      severity: atrasado ? 'warning' : 'ok',
      ruleId: atrasado ? 'entrante-pedido-atrasado' : 'entrante-en-proceso',
      title: atrasado ? 'Adquisición en pedido atrasada' : 'Adquisición en proceso',
      detail: `Entrante ${row.vinEntrante} en ${SITUACION_LABELS[sit] || sit}`,
      action: atrasado ? 'Cerrar pedido/tránsito y remisionar' : 'Seguimiento de llegada',
      adquisicionOk: !atrasado,
    };
  }

  if (SITUACION_ENTRANTE_STOCK.has(sit) && !row.fechaRemisionEntrante) {
    return {
      severity: 'warning',
      ruleId: 'entrante-sin-remision',
      title: 'Entrante en stock sin remisión',
      detail: `Unidad ${row.vinEntrante} (${SITUACION_LABELS[sit] || sit}) sin fecha de remisión`,
      action: 'Completar remisión de la unidad adquirida',
      adquisicionOk: false,
    };
  }

  return {
    severity: 'ok',
    ruleId: 'adquisicion-ok',
    title: 'Adquisición correcta',
    detail: `Entrante ${row.vinEntrante} en ${SITUACION_LABELS[sit] || sit}`,
    action: null,
    adquisicionOk: true,
  };
}

/**
 * Monitor de adquisición por intercambio/canje.
 * Valida que cada venta con canje tenga la unidad entrante correctamente registrada.
 */
async function getIntercambiosHistorico({ fechaInicio, fechaFin } = {}) {
  const { getPool, sql } = require('../db');
  if (!fechaInicio || !fechaFin) {
    throw Object.assign(new Error('Parametros requeridos: fechaInicio y fechaFin (YYYY-MM-DD).'), { status: 400 });
  }
  const inicio = parseDateInput(fechaInicio);
  const fin = parseDateInput(fechaFin);
  if (inicio > fin) {
    throw Object.assign(new Error('La fecha inicial no puede ser mayor que la fecha final.'), { status: 400 });
  }

  const pool = await getPool();
  const request = pool.request();
  request.input('fechaInicio', sql.Date, inicio);
  request.input('fechaFin', sql.Date, fin);

  const result = await request.query(`
    SELECT
      ADE_VTAFI.VTE_FECHDOCTO,
      ADE_VTAFI.VTE_DOCTO,
      ADE_VTAFI.VTE_SERIE,
      ADE_VTAFI.VTE_FORMAPAGO,
      S.VEH_TIPOAUTO,
      S.VEH_ANMODELO,
      S.VEH_CATALOGO,
      S.VEH_FECHSALIDA,
      S.VEH_CONCCANJE,
      S.VEH_CANJEPOR,
      UNI_CATACOLOR.COL_DESCRIPCION AS COLOR,
      B.PER_PATERNO + ' ' + B.PER_MATERNO + ' ' + B.PER_NOMRAZON AS VENDEDOR,
      A.PER_NOMRAZON + ' ' + A.PER_PATERNO + ' ' + A.PER_MATERNO AS CLIENTE,
      E.VEH_NUMSERIE AS VIN_ENTRANTE,
      E.VEH_SITUACION AS SIT_ENTRANTE,
      E.VEH_TIPOAUTO AS MODELO_ENTRANTE,
      E.VEH_ANMODELO AS ANIO_ENTRANTE,
      E.VEH_FECREMISION AS REM_ENTRANTE,
      E.VEH_NOINVENTA AS NOINV_ENTRANTE
    FROM ADE_VTAFI
    INNER JOIN PER_PERSONAS AS A ON A.PER_IDPERSONA = ADE_VTAFI.VTE_IDCLIENTE
    INNER JOIN SER_VEHICULO AS S
      ON S.VEH_NUMSERIE = ADE_VTAFI.VTE_SERIE
      AND S.VEH_NOINVENTA > 0
    LEFT JOIN SER_VEHICULO AS E
      ON NULLIF(LTRIM(RTRIM(S.VEH_CANJEPOR)), '') IS NOT NULL
      AND (
        LTRIM(RTRIM(E.VEH_NUMSERIE)) = LTRIM(RTRIM(S.VEH_CANJEPOR))
        OR RIGHT(LTRIM(RTRIM(E.VEH_NUMSERIE)), 17) = RIGHT(LTRIM(RTRIM(S.VEH_CANJEPOR)), 17)
      )
      AND E.VEH_NOINVENTA > 0
    LEFT JOIN UNI_CATACOLOR
      ON UNI_CATACOLOR.COL_CLAVE = S.VEH_COLOEXTE
      AND UNI_CATACOLOR.COL_MODELO = S.VEH_ANMODELO
      AND UNI_CATACOLOR.COL_CATALOGO = S.VEH_CATALOGO
    LEFT JOIN PER_PERSONAS AS B ON B.PER_IDPERSONA = S.VEH_VENDEDOR
    WHERE ADE_VTAFI.VTE_TIPODOCTO = 'A'
      AND ADE_VTAFI.VTE_STATUS = 'I'
      AND S.VEH_SITUACION = 'VEN'
      AND (
        NULLIF(LTRIM(RTRIM(S.VEH_CONCCANJE)), '') IS NOT NULL
        OR UPPER(LTRIM(RTRIM(ADE_VTAFI.VTE_FORMAPAGO))) = 'INT'
      )
      AND CONVERT(DATE, ADE_VTAFI.VTE_FECHDOCTO, 103)
        BETWEEN @fechaInicio AND @fechaFin
    ORDER BY CONVERT(DATE, ADE_VTAFI.VTE_FECHDOCTO, 103) DESC, ADE_VTAFI.VTE_SERIE
  `);

  const byMesMap = new Map();
  const canjePorCount = new Map();
  const rows = (result.recordset || []).map((r) => {
    const fecha = parseFechaDoc(r.VTE_FECHDOCTO);
    const salida = parseFechaDoc(r.VEH_FECHSALIDA);
    const remEntrante = parseFechaDoc(r.REM_ENTRANTE);
    const modelo = String(r.VEH_TIPOAUTO || '').trim() || '(Sin modelo)';
    const concCanje = String(r.VEH_CONCCANJE || '').trim() || null;
    const formaPago = String(r.VTE_FORMAPAGO || '').trim() || null;
    const canjePor = String(r.VEH_CANJEPOR || '').trim() || null;
    const esIntLegacy = String(formaPago || '').toUpperCase() === 'INT';
    const diasDesdeVenta = daysBetweenIso(fecha?.iso);

    if (canjePor) {
      canjePorCount.set(canjePor, (canjePorCount.get(canjePor) || 0) + 1);
    }
    if (fecha?.monthKey) {
      byMesMap.set(fecha.monthKey, (byMesMap.get(fecha.monthKey) || 0) + 1);
    }

    const base = {
      fecha: fecha?.iso || null,
      fechaSalida: salida?.iso || null,
      docto: r.VTE_DOCTO || null,
      serie: r.VTE_SERIE || null,
      modelo,
      anModelo: r.VEH_ANMODELO || null,
      catalogo: r.VEH_CATALOGO || null,
      color: r.COLOR || null,
      vendedor: String(r.VENDEDOR || '').replace(/\s+/g, ' ').trim() || null,
      cliente: String(r.CLIENTE || '').replace(/\s+/g, ' ').trim() || null,
      formaPago,
      concCanje,
      canjePor,
      origen: esIntLegacy ? 'INT' : 'CONCCANJE',
      vinEntrante: String(r.VIN_ENTRANTE || '').trim() || null,
      sitEntrante: String(r.SIT_ENTRANTE || '').trim().toUpperCase() || null,
      sitEntranteLabel: SITUACION_LABELS[String(r.SIT_ENTRANTE || '').trim().toUpperCase()] || (r.SIT_ENTRANTE || null),
      modeloEntrante: String(r.MODELO_ENTRANTE || '').trim() || null,
      anEntrante: r.ANIO_ENTRANTE || null,
      fechaRemisionEntrante: remEntrante?.iso || null,
      noInvEntrante: r.NOINV_ENTRANTE != null ? Number(r.NOINV_ENTRANTE) : null,
      diasDesdeVenta,
    };

    const evalResult = evaluateAdquisicionCanje(base);
    return { ...base, ...evalResult };
  });

  // Doble canje: mismo VIN entrante referenciado por varias salidas
  for (const row of rows) {
    if (row.canjePor && (canjePorCount.get(row.canjePor) || 0) > 1) {
      row.severity = 'critical';
      row.ruleId = 'doble-canje';
      row.title = 'VIN entrante duplicado';
      row.detail = `CANJEPOR ${row.canjePor} aparece en ${canjePorCount.get(row.canjePor)} canjes`;
      row.action = 'Revisar capturas duplicadas del VIN entrante';
      row.adquisicionOk = false;
    }
  }

  const severityRank = { critical: 0, warning: 1, ok: 2 };
  rows.sort((a, b) => {
    const sa = severityRank[a.severity] ?? 9;
    const sb = severityRank[b.severity] ?? 9;
    if (sa !== sb) return sa - sb;
    return String(b.fecha || '').localeCompare(String(a.fecha || ''));
  });

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

  const total = rows.length;
  const conCanjePor = rows.filter((r) => r.canjePor).length;
  const ok = rows.filter((r) => r.severity === 'ok').length;
  const warning = rows.filter((r) => r.severity === 'warning').length;
  const critical = rows.filter((r) => r.severity === 'critical').length;
  const adquisicionOk = rows.filter((r) => r.adquisicionOk).length;
  const coberturaPct = total ? Number(((conCanjePor / total) * 100).toFixed(1)) : 0;
  const calidadPct = total ? Number(((adquisicionOk / total) * 100).toFixed(1)) : 0;

  const alertas = rows
    .filter((r) => r.severity === 'critical' || r.severity === 'warning')
    .slice(0, 40)
    .map((r) => ({
      severity: r.severity,
      ruleId: r.ruleId,
      title: r.title,
      detail: r.detail,
      action: r.action,
      fecha: r.fecha,
      docto: r.docto,
      vinSaliente: r.serie,
      vinEntrante: r.canjePor || r.vinEntrante,
      concCanje: r.concCanje,
      diasDesdeVenta: r.diasDesdeVenta,
      modelo: r.modelo,
    }));

  const porRegla = {};
  for (const r of rows) {
    if (!porRegla[r.ruleId]) {
      porRegla[r.ruleId] = { ruleId: r.ruleId, title: r.title, severity: r.severity, count: 0 };
    }
    porRegla[r.ruleId].count += 1;
  }

  return {
    periodo: { fechaInicio, fechaFin },
    fuente: {
      criterio: 'Venta con CONCCANJE/INT + validación de adquisición (CANJEPOR → SER_VEHICULO)',
      tablas: ['ADE_VTAFI', 'SER_VEHICULO'],
    },
    summary: {
      total,
      conCanjePor,
      sinCanjePor: total - conCanjePor,
      ok,
      warning,
      critical,
      adquisicionOk,
      coberturaPct,
      calidadPct,
      mesesConMovimiento: porMes.filter((m) => m.count > 0).length,
      alertasAbiertas: warning + critical,
    },
    porMes,
    porRegla: Object.values(porRegla).sort((a, b) => b.count - a.count),
    alertas,
    rows,
  };
}

module.exports = { getInventory, getIntercambiosHistorico };
