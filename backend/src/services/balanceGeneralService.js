const { query } = require('../db');
const { BALANCE_GENERAL_SECTIONS } = require('../config/balanceGeneralAccounts');
const { computeLiquidezAnalysis } = require('./liquidezAnalysis');
const { computeEstructuraFinanciera } = require('./estructuraFinanciera');

const DEP_ACUM_CUENTAS = [
  '0351-0000-0000-0000',
  '0352-0000-0000-0000',
  '0353-0000-0000-0000',
  '0354-0000-0000-0000',
  '0355-0000-0000-0000',
  '0357-0000-0000-0000',
];

const MES_NOMBRE = [
  '', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function parseDate(value) {
  const d = new Date(`${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) throw new Error(`Fecha inválida: ${value}`);
  return d;
}

function ctasTable(year) {
  return `CON_CTAS01${year}`;
}

async function tableExists(name) {
  const rows = await query(`
    SELECT 1 AS ok
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = @name
  `, { name });
  return Boolean(rows[0]?.ok);
}

/**
 * El Balance General siempre es un corte al cierre del mes de fechaFin
 * (último día de ese mes), tanto para el mes actual como para meses anteriores.
 */
function resolveMesCierre(fechaFin) {
  const end = parseDate(fechaFin);
  const year = end.getFullYear();
  const month = end.getMonth() + 1;
  const lastDay = new Date(year, month, 0).getDate();
  const asOfCierre = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return {
    year,
    month,
    asOfCierre,
    labelCierre: `${lastDay} de ${MES_NOMBRE[month]} ${year}`,
    includePeriod13: month === 12,
  };
}

/** Último día del mes anterior al cierre de fechaFin. */
function previousMonthEndIso(fechaFin) {
  const { year, month } = resolveMesCierre(fechaFin);
  let y = year;
  let m = month - 1;
  if (m < 1) {
    m = 12;
    y -= 1;
  }
  const lastDay = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

function pctChange(curr, prev) {
  const c = Number(curr);
  const p = Number(prev);
  if (!Number.isFinite(c)) return null;
  if (!Number.isFinite(p) || Math.abs(p) < 0.01) {
    if (Math.abs(c) < 0.01) return 0;
    return c > 0 ? 100 : -100;
  }
  return Math.round(((c - p) / Math.abs(p)) * 1000) / 10;
}

function shortMonthLabel(year, month) {
  if (!year || !month) return 'mes ant.';
  return `${MES_NOMBRE[month].slice(0, 3)} ${year}`;
}

function sectionVal(bg, key) {
  return (bg?.sections || []).find((s) => s.key === key)?.value ?? null;
}

function buildComparativoMetric(actual, anterior, labelVs) {
  const variacionPct = pctChange(actual, anterior);
  if (variacionPct == null) {
    return {
      actual: actual ?? null,
      anterior: anterior ?? null,
      variacionPct: null,
      labelVs,
      display: null,
      tone: 'slate',
    };
  }
  const sign = variacionPct > 0 ? '+' : '';
  return {
    actual: actual ?? null,
    anterior: anterior ?? null,
    variacionPct,
    labelVs,
    display: `${sign}${variacionPct}% vs ${labelVs}`,
    tone: variacionPct > 0 ? 'up' : variacionPct < 0 ? 'down' : 'flat',
  };
}

function buildBalanceComparativo(current, prior) {
  if (!prior?.available) return null;
  const labelVs = shortMonthLabel(prior.year, prior.month);
  return {
    labelVs,
    asOfCierre: prior.asOfCierre,
    labelCierre: prior.labelCierre,
    totals: {
      activoTotal: buildComparativoMetric(current.totals?.activoTotal, prior.totals?.activoTotal, labelVs),
      pasivoTotal: buildComparativoMetric(current.totals?.pasivoTotal, prior.totals?.pasivoTotal, labelVs),
      capital: buildComparativoMetric(current.totals?.capital, prior.totals?.capital, labelVs),
      capitalTrabajo: buildComparativoMetric(
        current.liquidez?.capitalTrabajo,
        prior.liquidez?.capitalTrabajo,
        labelVs,
      ),
    },
    sections: {
      activoCirculante: buildComparativoMetric(
        sectionVal(current, 'activoCirculante'),
        sectionVal(prior, 'activoCirculante'),
        labelVs,
      ),
      activoFijo: buildComparativoMetric(
        sectionVal(current, 'activoFijo'),
        sectionVal(prior, 'activoFijo'),
        labelVs,
      ),
      activoDiferido: buildComparativoMetric(
        sectionVal(current, 'activoDiferido'),
        sectionVal(prior, 'activoDiferido'),
        labelVs,
      ),
      pasivoCortoPlazo: buildComparativoMetric(
        sectionVal(current, 'pasivoCortoPlazo'),
        sectionVal(prior, 'pasivoCortoPlazo'),
        labelVs,
      ),
      pasivoLargoPlazo: buildComparativoMetric(
        sectionVal(current, 'pasivoLargoPlazo'),
        sectionVal(prior, 'pasivoLargoPlazo'),
        labelVs,
      ),
      pasivoTotal: buildComparativoMetric(current.totals?.pasivoTotal, prior.totals?.pasivoTotal, labelVs),
      capital: buildComparativoMetric(current.totals?.capital, prior.totals?.capital, labelVs),
    },
  };
}

/**
 * Movimiento algebraico Contpaq (columna única):
 * SDOINICIAL + Σ(CARGO − ABONO) ene…M (+ p13 en diciembre).
 */
function buildBalanceExpr(endMonth, { includePeriod13 = false } = {}) {
  const parts = ['ISNULL(CTA_SDOINICIAL, 0)'];
  const last = Math.min(Math.max(Number(endMonth) || 1, 1), 12);
  for (let m = 1; m <= last; m += 1) {
    parts.push(`ISNULL(CTA_CARGO${m}, 0) - ISNULL(CTA_ABONO${m}, 0)`);
  }
  if (includePeriod13) {
    parts.push('ISNULL(CTA_CARGO13, 0) - ISNULL(CTA_ABONO13, 0)');
  }
  return parts.join(' + ');
}

/**
 * Saldo Contpaq según naturaleza (balanza acumulativa):
 * - DEUDORA: Inicial + Cargos − Abonos
 * - ACREEDORA: Inicial + Abonos − Cargos
 * Coincide con el “saldo final” de la columna deudora/acreedora en Contpaq.
 */
function buildNatureBalanceExpr(endMonth, { includePeriod13 = false } = {}) {
  const last = Math.min(Math.max(Number(endMonth) || 1, 1), 12);
  const deudParts = ['ISNULL(CTA_SDOINICIAL, 0)'];
  const acreParts = ['ISNULL(CTA_SDOINICIAL, 0)'];
  for (let m = 1; m <= last; m += 1) {
    deudParts.push(`ISNULL(CTA_CARGO${m}, 0) - ISNULL(CTA_ABONO${m}, 0)`);
    acreParts.push(`ISNULL(CTA_ABONO${m}, 0) - ISNULL(CTA_CARGO${m}, 0)`);
  }
  if (includePeriod13) {
    deudParts.push('ISNULL(CTA_CARGO13, 0) - ISNULL(CTA_ABONO13, 0)');
    acreParts.push('ISNULL(CTA_ABONO13, 0) - ISNULL(CTA_CARGO13, 0)');
  }
  return `CASE WHEN CTA_NATURALEZA = 'ACRE' THEN (${acreParts.join(' + ')}) ELSE (${deudParts.join(' + ')}) END`;
}

/**
 * Saldo firmado para ecuación contable:
 * activo/deudora positivo, pasivo-capital/acreedora negativo.
 */
function buildSignedNatureExpr(endMonth, opts = {}) {
  const nat = buildNatureBalanceExpr(endMonth, opts);
  return `CASE WHEN CTA_NATURALEZA = 'ACRE' THEN -(${nat}) ELSE (${nat}) END`;
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

/**
 * Saldos finales al cierre del mes (fechaFin).
 * Usa la fórmula Contpaq por naturaleza (acumulativa deudora/acreedora) sobre la mayor ACUM.
 */
async function loadAccountBalances(fechaFin) {
  const cierre = resolveMesCierre(fechaFin);
  const table = ctasTable(cierre.year);

  if (!(await tableExists(table))) {
    return {
      available: false,
      ...cierre,
      table: null,
      byCuenta: new Map(),
      byCuentaNature: new Map(),
    };
  }

  const opts = { includePeriod13: cierre.includePeriod13 };
  const natureExpr = buildNatureBalanceExpr(cierre.month, opts);
  const signedExpr = buildSignedNatureExpr(cierre.month, opts);
  const accounts = BALANCE_GENERAL_SECTIONS.flatMap((s) => s.accounts);
  const byCuenta = new Map();
  const byCuentaNature = new Map();
  const acumPresent = new Set();

  const inList = accounts.map((_, i) => `@c${i}`).join(', ');
  const params = {};
  accounts.forEach((a, i) => { params[`c${i}`] = a.cuenta; });

  const acumRows = await query(`
    SELECT RTRIM(CTA_NUMCTA) AS cuenta,
      SUM(${signedExpr}) AS saldoFinal,
      SUM(${natureExpr}) AS saldoNaturaleza
    FROM [${table}]
    WHERE CTA_ACUMDET = 'ACUM'
      AND RTRIM(CTA_NUMCTA) IN (${inList})
    GROUP BY RTRIM(CTA_NUMCTA)
  `, params);

  for (const row of acumRows) {
    const cuenta = String(row.cuenta || '').trim();
    if (!cuenta) continue;
    acumPresent.add(cuenta);
    byCuenta.set(cuenta, round2(row.saldoFinal));
    byCuentaNature.set(cuenta, round2(row.saldoNaturaleza));
  }

  // Sin fila ACUM: sumar DETA con la misma fórmula Contpaq
  for (const acc of accounts) {
    if (acumPresent.has(acc.cuenta)) continue;
    const pref = String(acc.cuenta).slice(0, 4);
    const detaRows = await query(`
      SELECT SUM(${signedExpr}) AS saldoFinal, SUM(${natureExpr}) AS saldoNaturaleza
      FROM [${table}]
      WHERE CTA_ACUMDET = 'DETA'
        AND CTA_NUMCTA LIKE @p
    `, { p: `${pref}-%` });
    byCuenta.set(acc.cuenta, round2(detaRows[0]?.saldoFinal));
    byCuentaNature.set(acc.cuenta, round2(detaRows[0]?.saldoNaturaleza));
  }

  for (const acc of accounts) {
    if (!byCuenta.has(acc.cuenta)) byCuenta.set(acc.cuenta, 0);
    if (!byCuentaNature.has(acc.cuenta)) byCuentaNature.set(acc.cuenta, 0);
  }

  return {
    available: true,
    ...cierre,
    table,
    byCuenta,
    byCuentaNature,
  };
}

/**
 * Valor a mostrar en Balance General:
 * - PASIVO: magnitud positiva de la obligación (|saldo Contpaq|).
 * - CAPITAL: saldo Contpaq por naturaleza CON signo (0385/0386 negativos restan).
 * - ACTIVO: saldo firmado (depreciaciones restan).
 */
function presentAccountValue(pertenece, signedValue, natureValue) {
  if (pertenece === 'PASIVO') return round2(Math.abs(Number(natureValue ?? signedValue) || 0));
  if (pertenece === 'CAPITAL') return round2(Number(natureValue ?? 0));
  return round2(signedValue);
}

/**
 * Resultado del ejercicio (utilidad/pérdida acumulada ene…mes de cierre):
 * Σ saldo firmado de cuentas mayor ACUM de PyG (04, 06, 07, 08, 09).
 * Nov 2025 ≈ $17,724,867.37 (validado vs balanza Contpaq).
 */
async function loadResultadoEjercicio(cierre) {
  const table = ctasTable(cierre.year);
  if (!(await tableExists(table))) {
    return { value: 0, available: false };
  }
  const signedExpr = buildSignedNatureExpr(cierre.month, {
    includePeriod13: cierre.includePeriod13,
  });
  const rows = await query(`
    SELECT SUM(${signedExpr}) AS resultadoFirmado
    FROM [${table}]
    WHERE CTA_ACUMDET = 'ACUM'
      AND LEFT(RTRIM(CTA_NUMCTA), 2) IN ('04', '06', '07', '08', '09')
      AND RTRIM(CTA_NUMCTA) LIKE '%-0000-0000-0000'
  `);
  // Utilidad Contpaq = −Σ saldos firmados de PyG (ingresos ACRE restan en el firmado).
  const firmado = Number(rows[0]?.resultadoFirmado || 0);
  return {
    value: round2(-firmado),
    available: true,
  };
}

async function getBalanceGeneral({ fechaFin, includeComparativo = true } = {}) {
  const loaded = await loadAccountBalances(fechaFin);
  const resultadoEjercicio = loaded.available
    ? await loadResultadoEjercicio(loaded)
    : { value: 0, available: false };
  const accountsBySection = {};
  const sections = [];
  const lines = [];
  const majorAccounts = [];

  for (const def of BALANCE_GENERAL_SECTIONS) {
    const sectionAccounts = def.accounts.map((acc) => {
      const signed = loaded.byCuenta.get(acc.cuenta) || 0;
      const nature = loaded.byCuentaNature?.get(acc.cuenta);
      const value = presentAccountValue(def.pertenece, signed, nature);
      return {
        cuenta: acc.cuenta,
        label: acc.label,
        sectionKey: def.key,
        pertenece: def.pertenece,
        value,
        saldoFinal: value,
        signedValue: round2(signed),
        saldoNaturaleza: round2(nature),
      };
    });

    // Capital: sumar Resultado del ejercicio (utilidad/pérdida YTD Contpaq)
    if (def.key === 'capital' && resultadoEjercicio.available) {
      sectionAccounts.push({
        cuenta: 'RESULTADO-EJERCICIO',
        label: 'Resultado del ejercicio',
        sectionKey: def.key,
        pertenece: def.pertenece,
        value: resultadoEjercicio.value,
        saldoFinal: resultadoEjercicio.value,
        signedValue: round2(-resultadoEjercicio.value),
        saldoNaturaleza: resultadoEjercicio.value,
        synthetic: true,
      });
    }

    accountsBySection[def.key] = sectionAccounts;

    // Activo: suma firmada (depreciaciones restan).
    // Pasivo: suma de magnitudes (obligaciones positivas).
    // Capital: suma con signo Contpaq (reembolsos/contras restan) + resultado del ejercicio.
    const value = (def.pertenece === 'PASIVO' || def.pertenece === 'CAPITAL')
      ? round2(sectionAccounts.reduce((a, x) => a + Number(x.value || 0), 0))
      : round2(sectionAccounts.reduce((a, x) => a + Number(x.signedValue || 0), 0));
    sections.push({
      key: def.key,
      label: def.label,
      pertenece: def.pertenece,
      value,
      accountCount: sectionAccounts.length,
    });
    lines.push({
      key: def.key,
      label: def.label,
      value,
      group: def.pertenece,
      highlight: def.key === 'capital',
    });

    for (const acc of sectionAccounts) {
      if (Math.abs(acc.value) > 0.01) majorAccounts.push(acc);
    }
  }

  const activoTotal = round2(
    sections.filter((s) => s.pertenece === 'ACTIVO').reduce((a, s) => a + s.value, 0),
  );
  const pasivoTotal = round2(
    sections.filter((s) => s.pertenece === 'PASIVO').reduce((a, s) => a + s.value, 0),
  );
  const capital = sections.find((s) => s.key === 'capital')?.value || 0;
  const pasivoMasCapital = round2(pasivoTotal + capital);

  const activoCirculante = sections.find((s) => s.key === 'activoCirculante')?.value || 0;
  const pasivoCirculante = sections.find((s) => s.key === 'pasivoCortoPlazo')?.value || 0;
  const pasivoLargo = sections.find((s) => s.key === 'pasivoLargoPlazo')?.value || 0;
  const liquidez = computeLiquidezAnalysis({
    activoCirculante,
    pasivoCirculante,
    accounts: accountsBySection.activoCirculante || [],
  });

  const cxpProveedores = round2(
    (accountsBySection.pasivoCortoPlazo || [])
      .filter((a) => String(a.cuenta || '').startsWith('0300-'))
      .reduce((sum, a) => sum + Math.abs(Number(a.value || 0)), 0),
  );

  // Plan piso: documentos por pagar de unidades nuevas (0310) y seminuevas (0311).
  const planPisoPasivo = round2(
    (accountsBySection.pasivoCortoPlazo || [])
      .filter((a) => /^03(10|11)-/.test(String(a.cuenta || '')))
      .reduce((sum, a) => sum + Math.abs(Number(a.value || 0)), 0),
  );

  const estructura = computeEstructuraFinanciera({
    activoTotal,
    pasivoTotal,
    pasivoCorto: pasivoCirculante,
    pasivoLargo,
    capital,
    efectivoYEquivalentes: liquidez?.efectivoYEquivalentes || 0,
  });

  const mesesIncluidos = loaded.month
    ? `ene–${MES_NOMBRE[loaded.month].slice(0, 3)}`
    : '';

  const payload = {
    available: loaded.available,
    source: 'CON_CTAS · Balance General (cuentas mayor)',
    asOf: loaded.asOfCierre || fechaFin,
    asOfCierre: loaded.asOfCierre || null,
    labelCierre: loaded.labelCierre || null,
    year: loaded.year,
    month: loaded.month,
    sections,
    accountsBySection,
    majorAccounts,
    lines,
    resultadoEjercicio: resultadoEjercicio.available ? resultadoEjercicio.value : null,
    totals: {
      activoTotal,
      pasivoTotal,
      capital,
      pasivoMasCapital,
      ecuacionDiferencia: loaded.available ? round2(activoTotal - pasivoMasCapital) : null,
    },
    liquidez,
    estructura,
    cxpProveedores,
    planPisoPasivo,
    comparativo: null,
    methodology: {
      activo: 'Circulante + fijo (neto de depreciaciones) + diferido',
      pasivo: 'Circulante + largo plazo',
      capital: '0360 + 0370 + 0385 + 0386 + Resultado del ejercicio (PyG YTD 04/06/07/08/09)',
      saldos: `Saldo Contpaq al cierre de ${loaded.labelCierre || 'periodo'} (${mesesIncluidos}${loaded.includePeriod13 ? ' + p13' : ''}) · DEUD: Ini+Cargos−Abonos · ACRE: Ini+Abonos−Cargos · mayor ACUM`,
      fuente: 'SQL',
      regla: 'Corte al cierre del mes de la fecha fin. Capital incluye Resultado del ejercicio = Σ saldos firmados de cuentas mayor de resultados (04–09) ene…mes.',
      endeudamiento: 'Pasivo total ÷ Activo total',
      apalancamiento: 'Deuda neta ÷ EBITDA UDM · Deuda neta = Pasivo total − (Caja + Bancos + Equivalentes)',
      calidadDeuda: 'Participación del pasivo corto plazo sobre el pasivo total',
      dso: '(CxC sin IVA ÷ Ventas del periodo) × días · CxC sin IVA = CxC ÷ 1.16',
      dri: '(Inventario ÷ Costo de ventas) × días del periodo',
      dpo: '(CxP proveedores 0300 ÷ Costo de ventas) × días del periodo',
      cicloEfectivo: 'DRI + DRC − DRP',
      comparativo: 'Variación % vs cierre del mes anterior',
    },
  };

  if (includeComparativo && payload.available) {
    try {
      const priorFin = previousMonthEndIso(fechaFin);
      const prior = await getBalanceGeneral({ fechaFin: priorFin, includeComparativo: false });
      payload.comparativo = buildBalanceComparativo(payload, prior);
    } catch (err) {
      console.error('[balanceGeneral] comparativo:', err.message);
      payload.comparativo = null;
    }
  }

  return payload;
}

/**
 * Depreciación del periodo ≈ incremento de depreciación acumulada (035x)
 * entre el día previo a fechaInicio y el cierre de fechaFin.
 */
async function getDepreciacionPeriodo(fechaInicio, fechaFin) {
  function shiftDay(iso, delta) {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() + delta);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  const beforeStart = shiftDay(fechaInicio, -1);
  const [endBal, startBal] = await Promise.all([
    loadAccountBalances(fechaFin),
    loadAccountBalances(beforeStart),
  ]);

  if (!endBal.available) {
    return { available: false, depreciacionPeriodo: 0, detalle: [] };
  }

  const detalle = [];
  let total = 0;
  for (const cuenta of DEP_ACUM_CUENTAS) {
    const endV = Math.abs(Number(endBal.byCuentaNature.get(cuenta) || 0));
    const startV = startBal.available
      ? Math.abs(Number(startBal.byCuentaNature.get(cuenta) || 0))
      : 0;
    const delta = round2(Math.max(0, endV - startV));
    if (delta > 0.005) {
      detalle.push({ cuenta, inicio: startV, fin: endV, delta });
      total += delta;
    }
  }

  return {
    available: true,
    depreciacionPeriodo: round2(total),
    desde: beforeStart,
    hasta: endBal.asOfCierre || fechaFin,
    detalle,
  };
}

module.exports = {
  getBalanceGeneral,
  getDepreciacionPeriodo,
  loadAccountBalances,
  loadResultadoEjercicio,
  resolveMesCierre,
  buildBalanceExpr,
  buildNatureBalanceExpr,
  buildSignedNatureExpr,
};
