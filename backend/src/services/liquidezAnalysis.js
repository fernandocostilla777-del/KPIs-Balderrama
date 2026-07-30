/**
 * Análisis de liquidez (corto plazo) a partir del activo/pasivo circulante.
 * Teoría operativa Balderrama:
 * - Capital de trabajo = AC − PC
 * - Razón circulante = AC ÷ PC
 * - Prueba ácida = (AC − inventarios/WIP − pagos anticipados) ÷ PC
 */

function normalizeLabel(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @returns {'inventariosYProceso'|'pagosAnticipados'|'excluir'|'rapido'}
 */
function classifyActivoCirculanteAccount(label) {
  const L = normalizeLabel(label);
  if (!L) return 'rapido';

  if (/PAGADO.?S? POR ANTICIPADO|PAGOS ANTICIPADOS|SEGUROS PAGADOS POR ANTICIPADO/.test(L)) {
    return 'pagosAnticipados';
  }

  if (
    /INVENTARIO/.test(L)
    || /CONTRATOS EN TRANSITO/.test(L)
    || /MANO DE OBRA/.test(L)
    || /TRABAJOS EN PROCESO/.test(L)
  ) {
    return 'inventariosYProceso';
  }

  // Cuentas de activo fijo / diferido que a veces aparecen mal en nomenclatura
  if (
    /MAQUINARIA|MUEBLES Y ENSERES|VEHICULOS USO|EQUIPO DE COMPUTO|EQUIPO DE PARTES|MEJORAS EN INMUEBLE|DEPREC\.|INVERSIONES Y ACTIVOS DIVERSOS|EDIFICIOS/.test(L)
  ) {
    return 'excluir';
  }

  return 'rapido';
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function round4(n) {
  return Math.round(Number(n || 0) * 10000) / 10000;
}

function interpretRazonCirculante(ratio) {
  if (ratio == null || !Number.isFinite(ratio)) {
    return {
      band: 'sin_dato',
      label: 'Sin dato',
      tone: 'slate',
      summary: 'No hay suficiente información de activo/pasivo circulante para evaluar liquidez.',
    };
  }
  if (ratio < 1) {
    return {
      band: 'insuficiente',
      label: 'Insuficiencia de activos circulantes',
      tone: 'rose',
      summary: 'Los activos circulantes no alcanzan a cubrir el pasivo de corto plazo (razón < 1.00).',
    };
  }
  if (ratio < 1.2) {
    return {
      band: 'ajustada',
      label: 'Liquidez muy ajustada',
      tone: 'amber',
      summary: 'Puede cubrir contablemente las obligaciones de corto plazo, pero el margen de seguridad es muy bajo (1.00–1.20).',
    };
  }
  if (ratio < 1.5) {
    return {
      band: 'moderada',
      label: 'Liquidez moderada',
      tone: 'blue',
      summary: 'Hay un margen razonable para cubrir el pasivo circulante (1.20–1.50).',
    };
  }
  return {
    band: 'holgada',
    label: 'Mayor margen de seguridad',
    tone: 'green',
    summary: 'La razón circulante supera 1.50: hay holgura relativa frente a obligaciones de corto plazo.',
  };
}

/**
 * @param {{ activoCirculante: number, pasivoCirculante: number, accounts?: Array<{cuenta?:string,label:string,value:number}> }} input
 */
function computeLiquidezAnalysis(input = {}) {
  const activoCirculante = Number(input.activoCirculante || 0);
  const pasivoCirculante = Number(input.pasivoCirculante || 0);
  const accounts = Array.isArray(input.accounts) ? input.accounts : [];

  const inventarios = [];
  const anticipados = [];
  const rapidos = [];
  const excluidos = [];

  for (const acc of accounts) {
    const value = Number(acc.value || 0);
    const item = {
      cuenta: acc.cuenta || '',
      label: acc.label || '',
      value: round2(value),
    };
    const kind = classifyActivoCirculanteAccount(acc.label);
    if (kind === 'inventariosYProceso') inventarios.push(item);
    else if (kind === 'pagosAnticipados') anticipados.push(item);
    else if (kind === 'excluir') excluidos.push(item);
    else rapidos.push(item);
  }

  const inventariosTotal = round2(inventarios.reduce((a, x) => a + x.value, 0));
  const anticipadosTotal = round2(anticipados.reduce((a, x) => a + x.value, 0));
  const activosRapidos = round2(activoCirculante - inventariosTotal - anticipadosTotal);

  const capitalTrabajo = round2(activoCirculante - pasivoCirculante);
  const razonCirculante = pasivoCirculante
    ? round4(activoCirculante / pasivoCirculante)
    : null;
  const pruebaAcida = pasivoCirculante
    ? round4(activosRapidos / pasivoCirculante)
    : null;
  const deficitAcido = round2(activosRapidos - pasivoCirculante);
  const margenSobreAcPct = activoCirculante
    ? round2((capitalTrabajo / activoCirculante) * 100)
    : null;

  const interpretacion = interpretRazonCirculante(razonCirculante);
  const acidTone = pruebaAcida == null
    ? 'slate'
    : pruebaAcida < 1
      ? 'rose'
      : pruebaAcida < 1.1
        ? 'amber'
        : 'green';

  return {
    disponible: Boolean(pasivoCirculante || activoCirculante),
    activoCirculante: round2(activoCirculante),
    pasivoCirculante: round2(pasivoCirculante),
    capitalTrabajo,
    razonCirculante: razonCirculante != null ? round2(razonCirculante) : null,
    pruebaAcida: pruebaAcida != null ? round2(pruebaAcida) : null,
    activosRapidos,
    inventariosYProceso: inventariosTotal,
    pagosAnticipados: anticipadosTotal,
    deficitAcido,
    margenSobreAcPct,
    interpretacion,
    acidTone,
    desglose: {
      inventarios,
      pagosAnticipados: anticipados,
      rapidos,
      excluidos,
    },
    formula: {
      capitalTrabajo: 'Activo circulante − Pasivo circulante',
      razonCirculante: 'Activo circulante ÷ Pasivo circulante',
      pruebaAcida: '(Activo circulante − inventarios/WIP − pagos anticipados) ÷ Pasivo circulante',
    },
    lectura: {
      razon: interpretacion.summary,
      acida: pruebaAcida == null
        ? 'Sin dato de prueba ácida.'
        : pruebaAcida < 1
          ? `Sin inventarios ni anticipados, hay un faltante de liquidez inmediata de ${Math.abs(deficitAcido).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`
          : 'La prueba ácida cubre el pasivo circulante sin depender de inventarios ni anticipados.',
    },
  };
}

module.exports = {
  classifyActivoCirculanteAccount,
  computeLiquidezAnalysis,
  interpretRazonCirculante,
  normalizeLabel,
};
