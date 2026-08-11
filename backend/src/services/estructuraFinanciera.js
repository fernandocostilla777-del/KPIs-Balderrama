/**
 * Ratios de estructura financiera y eficiencia de pagos (Contabilidad).
 */

function round1(n) {
  return Math.round(Number(n || 0) * 10) / 10;
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function daysInclusive(fechaInicio, fechaFin) {
  const a = new Date(`${fechaInicio}T12:00:00`);
  const b = new Date(`${fechaFin}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 30;
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

/**
 * Endeudamiento, apalancamiento y calidad de la deuda desde Balance General.
 */
function computeEstructuraFinanciera({
  activoTotal = 0,
  pasivoTotal = 0,
  pasivoCorto = 0,
  pasivoLargo = 0,
  capital = 0,
} = {}) {
  const activo = Number(activoTotal) || 0;
  const pasivo = Number(pasivoTotal) || 0;
  const corto = Number(pasivoCorto) || 0;
  const largo = Number(pasivoLargo) || 0;
  const cap = Number(capital) || 0;

  const endeudamientoPct = activo > 0 ? round1((pasivo / activo) * 100) : null;
  const apalancamiento = cap > 0 ? round2(pasivo / cap) : null;
  const apalancamientoActivo = cap > 0 ? round2(activo / cap) : null;

  const calidadCortoPct = pasivo > 0 ? round1((corto / pasivo) * 100) : null;
  const calidadLargoPct = pasivo > 0 ? round1((largo / pasivo) * 100) : null;

  let calidadTone = 'slate';
  let calidadLabel = 'Sin dato';
  let calidadSummary = 'No hay pasivo suficiente para evaluar la calidad de la deuda.';
  if (calidadCortoPct != null) {
    if (calidadCortoPct >= 80) {
      calidadTone = 'rose';
      calidadLabel = 'Alta presión de corto plazo';
      calidadSummary = `${calidadCortoPct}% del pasivo vence en el corto plazo: mayor riesgo de liquidez.`;
    } else if (calidadCortoPct >= 60) {
      calidadTone = 'amber';
      calidadLabel = 'Deuda concentrada en corto plazo';
      calidadSummary = `${calidadCortoPct}% del pasivo es circulante: conviene vigilar refinanciamiento y flujo.`;
    } else {
      calidadTone = 'green';
      calidadLabel = 'Mezcla de plazos más equilibrada';
      calidadSummary = `${calidadCortoPct}% corto / ${calidadLargoPct}% largo: menor presión inmediata relativa.`;
    }
  }

  return {
    disponible: Boolean(activo || pasivo || cap),
    endeudamientoPct,
    apalancamiento,
    apalancamientoActivo,
    pasivoCorto: round2(corto),
    pasivoLargo: round2(largo),
    pasivoTotal: round2(pasivo),
    capital: round2(cap),
    activoTotal: round2(activo),
    calidadDeuda: {
      cortoPct: calidadCortoPct,
      largoPct: calidadLargoPct,
      tone: calidadTone,
      label: calidadLabel,
      summary: calidadSummary,
    },
    formula: {
      endeudamiento: 'Pasivo total ÷ Activo total × 100',
      apalancamiento: 'Pasivo total ÷ Capital contable',
      calidadDeuda: 'Pasivo corto ÷ Pasivo total × 100',
    },
  };
}

/**
 * DPO = (CxP proveedores ÷ Costo de ventas) × días del periodo
 * CxP comercial = acreedores comerciales (0300). Plan piso se excluye (financiamiento).
 */
function computeDpo({
  cxpProveedores = 0,
  costoVentas = 0,
  fechaInicio,
  fechaFin,
  dias: diasOverride,
} = {}) {
  const cxp = Math.abs(Number(cxpProveedores) || 0);
  const costo = Math.abs(Number(costoVentas) || 0);
  const dias = diasOverride || daysInclusive(fechaInicio, fechaFin);
  const dpoDias = costo > 0 ? round1((cxp / costo) * dias) : null;

  let tone = 'slate';
  let label = 'Sin dato';
  let summary = 'Se requiere costo de ventas y CxP de proveedores para calcular DPO.';
  if (dpoDias != null) {
    if (dpoDias > 60) {
      tone = 'amber';
      label = 'Ciclo de pago largo';
      summary = `Se tarda ~${dpoDias} días en pagar a proveedores (periodo ${dias} d).`;
    } else if (dpoDias < 15) {
      tone = 'blue';
      label = 'Pago muy rápido';
      summary = `DPO ${dpoDias} días: se liquida pronto a proveedores (puede tensar caja).`;
    } else {
      tone = 'green';
      label = 'Gestión de pagos razonable';
      summary = `DPO ${dpoDias} días sobre un periodo de ${dias} días.`;
    }
  }

  return {
    disponible: dpoDias != null,
    dpoDias,
    cxpProveedores: round2(cxp),
    costoVentas: round2(costo),
    diasPeriodo: dias,
    tone,
    label,
    summary,
    formula: 'CxP proveedores (0300) ÷ Costo de ventas × días del periodo',
  };
}

/**
 * EBIT ≈ utilidad de operación; EBITDA ≈ EBIT + depreciación del periodo.
 */
function computeEbitMetrics({
  ventas = 0,
  utilidadOperacion = 0,
  depreciacionPeriodo = 0,
  utilidadOperacionAnterior = null,
} = {}) {
  const ebit = round2(Number(utilidadOperacion) || 0);
  const dep = Math.max(0, round2(Number(depreciacionPeriodo) || 0));
  const ebitda = round2(ebit + dep);
  const ventasN = Number(ventas) || 0;
  const margenEbitPct = ventasN ? round1((ebit / ventasN) * 100) : null;
  const margenEbitdaPct = ventasN ? round1((ebitda / ventasN) * 100) : null;

  let crecimientoEbitPct = null;
  if (utilidadOperacionAnterior != null && Number.isFinite(Number(utilidadOperacionAnterior))) {
    const prev = Number(utilidadOperacionAnterior);
    if (Math.abs(prev) > 0.01) {
      crecimientoEbitPct = round1(((ebit - prev) / Math.abs(prev)) * 100);
    } else if (ebit !== 0) {
      crecimientoEbitPct = ebit > 0 ? 100 : -100;
    } else {
      crecimientoEbitPct = 0;
    }
  }

  return {
    ebit,
    ebitda,
    depreciacionPeriodo: dep,
    margenEbitPct,
    margenEbitdaPct,
    crecimientoEbitPct,
    utilidadOperacionAnterior: utilidadOperacionAnterior != null
      ? round2(utilidadOperacionAnterior)
      : null,
    formula: {
      ebit: 'Utilidad de operación (proxy EBIT)',
      ebitda: 'EBIT + Δ depreciación acumulada del periodo',
      crecimientoEbit: 'Variación % vs mismo periodo del año anterior',
    },
  };
}

module.exports = {
  computeEstructuraFinanciera,
  computeDpo,
  computeEbitMetrics,
  daysInclusive,
  round1,
  round2,
};
