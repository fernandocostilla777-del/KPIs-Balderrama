/**
 * Análisis de liquidez (corto plazo) a partir del activo/pasivo circulante.
 * Teoría operativa Balderrama:
 * - Capital de trabajo = AC − PC
 * - Razón circulante = AC ÷ PC
 * - Prueba ácida = (Caja + Bancos + Equivalentes a efectivo + CxC) ÷ Pasivo a corto plazo
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
 * @returns {'efectivo'|'cxc'|'inventariosYProceso'|'pagosAnticipados'|'excluir'|'otro'}
 */
function classifyActivoCirculanteAccount(label) {
  const L = normalizeLabel(label);
  if (!L) return 'otro';

  // CxC primero (evita falsos positivos con “caja” u otras etiquetas)
  if (
    /CUENTAS POR COBRAR|DOCUMENTOS Y CTAS\.? POR COBRAR|ADEUDOS DE COMPANIAS FINANCIERAS|RECLAMACION DE GARANTIAS/.test(L)
  ) {
    return 'cxc';
  }

  // Caja + Bancos + Equivalentes a efectivo
  if (
    /^CAJA$/.test(L)
    || /FONDO DE CAJA|CAJA CHICA/.test(L)
    || /\bBANCOS?\b/.test(L)
    || /EQUIVALENTES? A EFECTIVO|INVERSIONES EN VALORES|INVERSIONES TEMPORALES/.test(L)
  ) {
    return 'efectivo';
  }

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

  if (
    /MAQUINARIA|MUEBLES Y ENSERES|VEHICULOS USO|EQUIPO DE COMPUTO|EQUIPO DE PARTES|MEJORAS EN INMUEBLE|DEPREC\.|INVERSIONES Y ACTIVOS DIVERSOS|EDIFICIOS/.test(L)
  ) {
    return 'excluir';
  }

  return 'otro';
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
  // Referencia de agencia: el pasivo circulante carga el plan piso, así que el
  // estándar del sector es 1.10–1.30, más bajo que el de una empresa comercial.
  if (ratio < 1.1) {
    return {
      band: 'insuficiente',
      label: 'Liquidez insuficiente',
      tone: 'rose',
      summary: 'El activo circulante no alcanza el mínimo de 1.10 que se espera en una agencia. Aun contando el inventario de unidades, no hay con qué cubrir el plan piso y los proveedores del corto plazo.',
    };
  }
  if (ratio < 1.3) {
    return {
      band: 'ajustada',
      label: 'Liquidez ajustada',
      tone: 'amber',
      summary: 'Entre 1.10 y 1.30: la agencia cubre el plan piso y los proveedores, pero sin colchón. Depende de que las unidades se desplacen en tiempo.',
    };
  }
  if (ratio < 1.6) {
    return {
      band: 'moderada',
      label: 'Liquidez sana',
      tone: 'green',
      summary: 'Entre 1.30 y 1.60: rango sano para una agencia de autos nuevos. El activo circulante cubre el plan piso con margen razonable.',
    };
  }
  return {
    band: 'holgada',
    label: 'Liquidez holgada',
    tone: 'green',
    summary: 'Arriba de 1.60. Hay bastante holgura frente al plan piso y los proveedores; conviene revisar que no sea inventario detenido o cartera sin cobrar.',
  };
}

/**
 * @param {{ activoCirculante: number, pasivoCirculante: number, accounts?: Array<{cuenta?:string,label:string,value:number}> }} input
 */
function computeLiquidezAnalysis(input = {}) {
  const activoCirculante = Number(input.activoCirculante || 0);
  const pasivoCirculante = Number(input.pasivoCirculante || 0);
  const accounts = Array.isArray(input.accounts) ? input.accounts : [];

  const efectivo = [];
  const cxc = [];
  const inventarios = [];
  const anticipados = [];
  const otros = [];
  const excluidos = [];

  for (const acc of accounts) {
    const value = Number(acc.value || 0);
    const item = {
      cuenta: acc.cuenta || '',
      label: acc.label || '',
      value: round2(value),
    };
    const kind = classifyActivoCirculanteAccount(acc.label);
    if (kind === 'efectivo') efectivo.push(item);
    else if (kind === 'cxc') cxc.push(item);
    else if (kind === 'inventariosYProceso') inventarios.push(item);
    else if (kind === 'pagosAnticipados') anticipados.push(item);
    else if (kind === 'excluir') excluidos.push(item);
    else otros.push(item);
  }

  const efectivoTotal = round2(efectivo.reduce((a, x) => a + x.value, 0));
  const cxcTotal = round2(cxc.reduce((a, x) => a + x.value, 0));
  const inventariosTotal = round2(inventarios.reduce((a, x) => a + x.value, 0));
  const anticipadosTotal = round2(anticipados.reduce((a, x) => a + x.value, 0));

  // Numerador estricto de prueba ácida Balderrama
  const activosRapidos = round2(efectivoTotal + cxcTotal);

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
  // Agencia: el grueso del activo circulante es inventario de unidades financiado con
  // plan piso, por lo que la prueba ácida del sector se mueve entre 0.50 y 0.70.
  const acidTone = pruebaAcida == null
    ? 'slate'
    : pruebaAcida < 0.5
      ? 'rose'
      : pruebaAcida < 0.7
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
    efectivoYEquivalentes: efectivoTotal,
    cuentasPorCobrar: cxcTotal,
    inventariosYProceso: inventariosTotal,
    pagosAnticipados: anticipadosTotal,
    deficitAcido,
    margenSobreAcPct,
    interpretacion,
    acidTone,
    desglose: {
      efectivo,
      cxc,
      inventarios,
      pagosAnticipados: anticipados,
      otros,
      excluidos,
      // compat: UI previa agrupaba “rápidos”
      rapidos: [...efectivo, ...cxc],
    },
    formula: {
      capitalTrabajo: 'Activo circulante − Pasivo circulante',
      razonCirculante: 'Activo circulante ÷ Pasivo circulante',
      pruebaAcida: '(Caja + Bancos + Equivalentes a efectivo + CxC) ÷ Pasivo a corto plazo',
    },
    lectura: {
      razon: interpretacion.summary,
      acida: pruebaAcida == null
        ? 'Sin dato de prueba ácida.'
        : pruebaAcida < 0.5
          ? `Sin contar el inventario de unidades, faltan ${Math.abs(deficitAcido).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 })} para cubrir el pasivo de corto plazo. Por debajo del 0.50 que se considera mínimo en una agencia: la operación depende por completo de que se desplace el piso.`
        : pruebaAcida < 0.7
          ? `Con caja, bancos y cartera se cubre ${pruebaAcida.toFixed(2)} del pasivo de corto plazo. Está en la banda ajustada del sector (0.50–0.70); el resto depende del desplazamiento de unidades.`
          : `Con caja, bancos y cartera se cubre ${pruebaAcida.toFixed(2)} del pasivo de corto plazo, arriba del 0.70 que se considera sano en una agencia sin recurrir al inventario de piso.`,
    },
  };
}

module.exports = {
  classifyActivoCirculanteAccount,
  computeLiquidezAnalysis,
  interpretRazonCirculante,
  normalizeLabel,
};
