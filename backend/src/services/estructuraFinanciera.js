/**
 * Ratios de estructura financiera y eficiencia de pagos (Contabilidad).
 */

function round1(n) {
  return Math.round(Number(n || 0) * 10) / 10;
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function money(n) {
  const value = Number(n) || 0;
  const abs = Math.abs(value).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return `${value < 0 ? '-$' : '$'}${abs}`;
}

function daysInclusive(fechaInicio, fechaFin) {
  const a = new Date(`${fechaInicio}T12:00:00`);
  const b = new Date(`${fechaFin}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 30;
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

/**
 * Endeudamiento, apalancamiento (Deuda neta / EBITDA UDM) y calidad de la deuda.
 */
function computeEstructuraFinanciera({
  activoTotal = 0,
  pasivoTotal = 0,
  pasivoCorto = 0,
  pasivoLargo = 0,
  capital = 0,
  efectivoYEquivalentes = 0,
  ebitdaUdm = null,
} = {}) {
  const activo = Number(activoTotal) || 0;
  const pasivo = Number(pasivoTotal) || 0;
  const corto = Number(pasivoCorto) || 0;
  const largo = Number(pasivoLargo) || 0;
  const cap = Number(capital) || 0;
  const efectivo = Math.max(0, Number(efectivoYEquivalentes) || 0);
  const ebitda = ebitdaUdm == null ? null : Number(ebitdaUdm);

  // SV-2 ABP: % del activo financiado con deuda. Valor de control: 40%–60%.
  const endeudamientoPct = activo > 0 ? round1((pasivo / activo) * 100) : null;
  // Ratio de autonomía: % del activo financiado con capital propio. Misma meta 40%–60%.
  const autonomiaPct = activo > 0 ? round1((cap / activo) * 100) : null;

  // Deuda neta = Pasivo total − (Caja + Bancos + Equivalentes a efectivo)
  const deudaNeta = round2(pasivo - efectivo);
  // Apalancamiento = Deuda neta ÷ EBITDA UDM
  const apalancamiento = (ebitda != null && Number.isFinite(ebitda) && ebitda > 0)
    ? round2(deudaNeta / ebitda)
    : null;
  const apalancamientoActivo = cap > 0 ? round2(activo / cap) : null;

  let apalancamientoTone = 'slate';
  let apalancamientoLabel = 'Sin dato';
  let apalancamientoDisplay = '—';
  let apalancamientoSummary = 'Se requiere EBITDA UDM positivo y pasivo para calcular el apalancamiento.';
  if (apalancamiento != null) {
    apalancamientoDisplay = `${apalancamiento.toFixed(2)}×`;
    if (apalancamiento <= 3) {
      apalancamientoTone = 'green';
      apalancamientoLabel = 'En rango';
      apalancamientoSummary = `Apalancamiento ${apalancamiento}×: la deuda neta, que en una agencia incluye el plan piso, se cubre con ${apalancamiento} años de EBITDA. Dentro del ≤3.00× que el sector considera manejable.`;
    } else if (apalancamiento <= 4.5) {
      apalancamientoTone = 'amber';
      apalancamientoLabel = 'Atención';
      apalancamientoSummary = `Apalancamiento ${apalancamiento}×: la deuda neta equivale a más de 3 años de EBITDA. Para una agencia con plan piso conviene revisar rotación de unidades y costo financiero.`;
    } else {
      apalancamientoTone = 'rose';
      apalancamientoLabel = 'Fuera de rango';
      apalancamientoSummary = `Apalancamiento ${apalancamiento}×: la deuda neta supera 4.5 años de EBITDA. Nivel alto incluso para una agencia; el flujo de la operación no alcanza a desahogar el plan piso ni la deuda bancaria.`;
    }
  } else if (ebitda != null && Number.isFinite(ebitda) && ebitda <= 0) {
    apalancamientoTone = 'rose';
    apalancamientoLabel = 'EBITDA UDM negativo';
    apalancamientoDisplay = 'n.a.';
    apalancamientoSummary = `El ratio no es medible: el EBITDA UDM es ${money(ebitda)} (negativo), por lo que la operación de los últimos 12 meses no genera flujo para cubrir la deuda neta de ${money(deudaNeta)}, que incluye el plan piso. Se considera fuera de rango hasta que el EBITDA UDM vuelva a ser positivo.`;
  } else if (pasivo || efectivo) {
    apalancamientoLabel = 'Sin EBITDA UDM';
    apalancamientoSummary = `Deuda neta de ${money(deudaNeta)} calculada, pero falta el EBITDA de los últimos 12 meses para obtener el ratio.`;
  }

  function bandPct(pct, {
    min,
    max,
    hardLow = null,
    hardHigh = null,
    inRangeSummary,
    bajoSummary,
    sobreSummary,
  }) {
    if (pct == null) {
      return {
        tone: 'slate',
        label: 'Sin dato',
        summary: 'No hay activo suficiente para evaluar el indicador.',
      };
    }
    if (pct >= min && pct <= max) {
      return { tone: 'green', label: 'En rango', summary: inRangeSummary(pct) };
    }
    if (pct < min) {
      const diff = round1(min - pct);
      return {
        tone: hardLow != null && pct < hardLow ? 'rose' : 'amber',
        label: 'Bajo el mínimo',
        summary: bajoSummary(pct, diff),
      };
    }
    const diff = round1(pct - max);
    return {
      tone: hardHigh != null && pct > hardHigh ? 'rose' : 'amber',
      label: 'Sobre el máximo',
      summary: sobreSummary(pct, diff),
    };
  }

  // Agencia de autos nuevos: el plan piso hace que el activo se financie en su mayor
  // parte con deuda. Referencia del sector: 60%–80% de endeudamiento.
  const endeudamientoBand = bandPct(endeudamientoPct, {
    min: 60,
    max: 80,
    hardLow: 50,
    hardHigh: 88,
    inRangeSummary: (pct) => `${pct}% del activo está financiado con deuda, dentro del rango normal de una agencia de autos nuevos (60–80%), donde el plan piso financia el inventario de unidades.`,
    bajoSummary: (pct, diff) => `${pct}% del activo con deuda: ${diff} pp bajo el mínimo del sector (60%). La agencia está usando capital propio donde el plan piso saldría más barato; hay subuso del apalancamiento.`,
    sobreSummary: (pct, diff) => `${pct}% del activo con deuda: ${diff} pp sobre el máximo del sector (80%). El plan piso y los acreedores financian casi todo el activo; revisar capitalización y costo financiero.`,
  });
  const endeudamientoTone = endeudamientoBand.tone;
  const endeudamientoLabel = endeudamientoBand.label;
  const endeudamientoSummary = endeudamientoPct == null
    ? 'No hay activo suficiente para evaluar el endeudamiento.'
    : endeudamientoBand.summary;

  // Complemento del endeudamiento: en agencias el capital propio sostiene 20%–40% del activo.
  const autonomiaBand = bandPct(autonomiaPct, {
    min: 20,
    max: 40,
    hardLow: 12,
    inRangeSummary: (pct) => `${pct}% del activo está financiado con capital propio, dentro del rango sano para una agencia (20–40%); el resto lo aporta el plan piso y proveedores.`,
    bajoSummary: (pct, diff) => `${pct}% de autonomía: ${diff} pp bajo el mínimo del sector (20%). La agencia opera con muy poco capital propio frente al plan piso; cualquier caída de margen pega directo al patrimonio.`,
    sobreSummary: (pct, diff) => `${pct}% de autonomía: ${diff} pp sobre el máximo de referencia (40%). Hay más capital propio del que el sector requiere; se puede aprovechar mejor el plan piso y liberar recursos.`,
  });
  const autonomiaTone = autonomiaBand.tone;
  const autonomiaLabel = autonomiaBand.label;
  const autonomiaSummary = autonomiaPct == null
    ? 'No hay activo suficiente para evaluar la autonomía.'
    : autonomiaBand.summary;

  const calidadCortoPct = pasivo > 0 ? round1((corto / pasivo) * 100) : null;
  const calidadLargoPct = pasivo > 0 ? round1((largo / pasivo) * 100) : null;

  let calidadTone = 'slate';
  let calidadLabel = 'Sin dato';
  let calidadSummary = 'No hay pasivo suficiente para evaluar la calidad de la deuda.';
  // En una agencia el plan piso es pasivo circulante por naturaleza, así que una
  // concentración alta en corto plazo es normal; la alerta empieza arriba del 93%.
  if (calidadCortoPct != null) {
    if (calidadCortoPct > 93) {
      calidadTone = 'rose';
      calidadLabel = 'Sin deuda estructural';
      calidadSummary = `${calidadCortoPct}% del pasivo vence en el corto plazo. Incluso descontando el plan piso, la agencia casi no tiene deuda a largo plazo: cualquier tropiezo en el flujo se convierte en presión inmediata.`;
    } else if (calidadCortoPct > 85) {
      calidadTone = 'amber';
      calidadLabel = 'Concentrada en corto plazo';
      calidadSummary = `${calidadCortoPct}% corto / ${calidadLargoPct}% largo. Por encima del 85% que se considera manejable en agencias; conviene migrar parte del pasivo que no es plan piso a largo plazo.`;
    } else {
      calidadTone = 'green';
      calidadLabel = 'Mezcla sana para agencia';
      calidadSummary = `${calidadCortoPct}% corto / ${calidadLargoPct}% largo. La proporción es la esperada en una agencia de autos nuevos, donde el plan piso y los proveedores concentran el vencimiento corto pero se liquidan con la venta de unidades.`;
    }
  }

  return {
    disponible: Boolean(activo || pasivo || cap),
    endeudamientoPct,
    endeudamientoTone,
    endeudamientoLabel,
    endeudamientoSummary,
    autonomiaPct,
    autonomiaTone,
    autonomiaLabel,
    autonomiaSummary,
    deudaNeta,
    efectivoYEquivalentes: round2(efectivo),
    ebitdaUdm: ebitda != null && Number.isFinite(ebitda) ? round2(ebitda) : null,
    apalancamiento,
    apalancamientoTone,
    apalancamientoLabel,
    apalancamientoDisplay,
    apalancamientoSummary,
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
      endeudamiento: 'Pasivo total ÷ Activo total × 100 (% del activo financiado con deuda)',
      autonomia: 'Capital contable ÷ Activo total × 100 (% del activo financiado con capital propio)',
      deudaNeta: 'Pasivo total − (Caja + Bancos + Equivalentes a efectivo)',
      apalancamiento: 'Deuda neta ÷ EBITDA UDM',
      calidadDeuda: 'Pasivo corto ÷ Pasivo total × 100',
    },
    valorControl: {
      endeudamientoMinPct: 60,
      endeudamientoMaxPct: 80,
      endeudamiento: 'Entre 60% y 80% del activo (estándar de agencia con plan piso)',
      autonomiaMinPct: 20,
      autonomiaMaxPct: 40,
      autonomia: 'Entre 20% y 40% del activo (capital propio en una agencia)',
      apalancamientoMax: 3,
      apalancamiento: 'Deuda neta ÷ EBITDA UDM ≤ 3.00× en agencia (meta ≤ 2.00×)',
      calidadDeuda: '≤ 85% del pasivo en corto plazo (el plan piso ya es circulante)',
    },
  };
}

const IVA_FACTOR = 1.16;

/**
 * Días de CxC = (CxC sin IVA ÷ Ventas del periodo) × días del periodo
 * CxC sin IVA = CxC / 1.16
 */
function computeDso({
  cuentasPorCobrar = 0,
  ventas = 0,
  fechaInicio,
  fechaFin,
  dias: diasOverride,
} = {}) {
  const cxcConIva = Math.abs(Number(cuentasPorCobrar) || 0);
  const cxcSinIva = round2(cxcConIva / IVA_FACTOR);
  const vtas = Math.abs(Number(ventas) || 0);
  const dias = diasOverride || daysInclusive(fechaInicio, fechaFin);
  const dsoDias = vtas > 0 ? round1((cxcSinIva / vtas) * dias) : null;

  let tone = 'slate';
  let label = 'Sin dato';
  let summary = 'Se requiere ventas y cuentas por cobrar para calcular días de CxC.';
  // Agencia: los contratos de financiadoras se liquidan en días y las aseguradoras
  // y garantías de fábrica en semanas. Referencia del sector: ≤20 días.
  if (dsoDias != null) {
    if (dsoDias > 35) {
      tone = 'rose';
      label = 'Cartera atorada';
      summary = `Se tarda ~${dsoDias} días en cobrar. En una agencia, los contratos en tránsito con financiadoras deben liquidarse en días y las garantías de fábrica y aseguradoras en semanas: arriba de 35 días indica expedientes incompletos o reclamaciones sin seguimiento.`;
    } else if (dsoDias > 20) {
      tone = 'amber';
      label = 'Atención';
      summary = `Días de cobro ${dsoDias}: por encima de los 20 días de referencia para una agencia. Revisar contratos en tránsito, reclamaciones de garantía y cuentas con aseguradoras.`;
    } else {
      tone = 'green';
      label = 'Cobro en plazo';
      summary = `Días de cobro ${dsoDias}: la cartera se convierte en efectivo dentro de los 20 días que se esperan en una agencia de autos nuevos.`;
    }
  }

  return {
    disponible: dsoDias != null,
    dsoDias,
    cuentasPorCobrar: round2(cxcConIva),
    cuentasPorCobrarSinIva: cxcSinIva,
    ivaFactor: IVA_FACTOR,
    ventas: round2(vtas),
    diasPeriodo: dias,
    tone,
    label,
    summary,
    formula: '(CxC sin IVA ÷ Ventas del periodo) × días del periodo · CxC sin IVA = CxC ÷ 1.16',
    valorControl: 'Agencia: ≤ 20 días',
  };
}

/**
 * DRI = (Inventario ÷ Costo de ventas) × días del periodo
 */
function computeDri({
  inventario = 0,
  costoVentas = 0,
  fechaInicio,
  fechaFin,
  dias: diasOverride,
} = {}) {
  const inv = Math.abs(Number(inventario) || 0);
  const costo = Math.abs(Number(costoVentas) || 0);
  const dias = diasOverride || daysInclusive(fechaInicio, fechaFin);
  const driDias = costo > 0 ? round1((inv / costo) * dias) : null;

  let tone = 'slate';
  let label = 'Sin dato';
  let summary = 'Se requiere inventario y costo de ventas para calcular DRI.';
  // Agencia: la referencia de fábrica es 60 días de piso en autos nuevos; arriba de
  // 90 empiezan las unidades añejas con costo de plan piso que se come el margen.
  if (driDias != null) {
    if (driDias > 90) {
      tone = 'rose';
      label = 'Unidades añejas';
      summary = `El inventario tarda ${driDias} días en desplazarse. Arriba de 90 días las unidades se vuelven añejas: el costo de plan piso, la depreciación del modelo y el riesgo de cambio de año se comen el margen. Requiere plan de desplazamiento y apoyo de fábrica.`;
    } else if (driDias > 60) {
      tone = 'amber';
      label = 'Sobre los 60 días de piso';
      summary = `El inventario tarda ${driDias} días en desplazarse, por encima de los 60 días de piso que marca la referencia de fábrica. Revisar mix de versiones y colores, y priorizar las unidades más antiguas.`;
    } else if (driDias < 30) {
      tone = 'blue';
      label = 'Piso corto';
      summary = `El inventario rota en ${driDias} días. Gira muy rápido: cuidar que no falte piso ni se pierdan ventas por falta de disponibilidad de versiones y colores.`;
    } else {
      tone = 'green';
      label = 'Piso en rango';
      summary = `El inventario se desplaza en ${driDias} días, dentro de los 30 a 60 días de piso que se consideran sanos en una agencia de autos nuevos.`;
    }
  }

  return {
    disponible: driDias != null,
    driDias,
    inventario: round2(inv),
    costoVentas: round2(costo),
    diasPeriodo: dias,
    tone,
    label,
    summary,
    formula: '(Inventario ÷ Costo de ventas) × días del periodo',
    valorControl: 'Agencia: 30 – 60 días de piso',
  };
}

/**
 * Ciclo de efectivo = DRI + DRC − DRP
 */
function computeCicloEfectivo({ driDias = null, dsoDias = null, dpoDias = null } = {}) {
  const dri = driDias == null ? null : Number(driDias);
  const dso = dsoDias == null ? null : Number(dsoDias);
  const dpo = dpoDias == null ? null : Number(dpoDias);
  const cicloDias = [dri, dso, dpo].every((n) => Number.isFinite(n))
    ? round1(dri + dso - dpo)
    : null;

  let tone = 'slate';
  let label = 'Sin dato';
  let summary = 'Se requieren DRI, días de CxC y días de CxP para calcular el ciclo de efectivo.';
  // Agencia: piso de 60 días menos el plazo de proveedores y refacciones deja un
  // ciclo de referencia de ~50 días. El plan piso no entra en DRP porque es deuda financiera.
  if (cicloDias != null) {
    if (cicloDias > 70) {
      tone = 'rose';
      label = 'Ciclo largo';
      summary = `El dinero tarda ${cicloDias} días en volver a caja (piso ${dri} días + cobro ${dso} días − proveedores ${dpo} días). Muy por encima de los 50 días de referencia en agencias: la unidad se paga mucho antes de venderse.`;
    } else if (cicloDias > 50) {
      tone = 'amber';
      label = 'Atención';
      summary = `Ciclo de ${cicloDias} días contra los 50 de referencia para una agencia. Presiona la caja: acelerar desplazamiento de piso o negociar plazo con proveedores de refacciones.`;
    } else {
      tone = 'green';
      label = 'Ciclo eficiente';
      summary = `Ciclo de ${cicloDias} días: el capital regresa a caja dentro de los 50 días que se esperan en una agencia de autos nuevos.`;
    }
  }

  return {
    disponible: cicloDias != null,
    cicloDias,
    driDias: dri,
    dsoDias: dso,
    dpoDias: dpo,
    tone,
    label,
    summary,
    formula: 'DRI + DRC − DRP',
    valorControl: 'Agencia: ≤ 50 días',
  };
}

/**
 * Cobertura del capital de trabajo (veces) = Capital de trabajo ÷ necesidad del ciclo.
 * En una agencia la necesidad se mide neta de las fuentes que ya financian el ciclo:
 * Necesidad = Inventario + CxC sin IVA − CxP proveedores − Plan piso (0310/0311).
 */
function computeCoberturaCapitalTrabajo({
  capitalTrabajo = 0,
  inventario = 0,
  cuentasPorCobrarSinIva = 0,
  cxpProveedores = 0,
  planPiso = 0,
  activoCirculante = 0,
  pasivoCirculante = 0,
} = {}) {
  const ct = round2(Number(capitalTrabajo) || 0);
  const inv = round2(Math.max(0, Number(inventario) || 0));
  const cxc = round2(Math.max(0, Number(cuentasPorCobrarSinIva) || 0));
  const cxp = round2(Math.max(0, Number(cxpProveedores) || 0));
  const piso = round2(Math.max(0, Number(planPiso) || 0));
  const necesidadBruta = round2(inv + cxc - cxp);
  const necesidad = round2(necesidadBruta - piso);

  let cobertura = null;
  if (necesidad > 0.01) cobertura = round2(ct / necesidad);

  let tone = 'slate';
  let label = 'Sin dato';
  let display = '—';
  let summary = 'Faltan inventario, cartera o proveedores para estimar la necesidad de capital de trabajo.';

  if (necesidad <= 0.01) {
    tone = ct >= 0 ? 'green' : 'rose';
    label = 'Ciclo financiado por terceros';
    display = 'n.a.';
    summary = `El plan piso y los proveedores financian por completo el inventario y la cartera (${money(Math.abs(necesidad))} de holgura). La agencia no necesita capital propio para sostener el ciclo.`;
  } else if (cobertura != null) {
    display = `${cobertura.toFixed(2)}×`;
    if (cobertura < 1) {
      tone = 'rose';
      label = 'No cubre';
      summary = `El capital de trabajo cubre ${cobertura.toFixed(2)}× de lo que la agencia debería tener. Después de descontar el plan piso, el ciclo exige ${money(necesidad)} y solo hay ${money(ct)}: faltan ${money(necesidad - ct)} que se están cubriendo con pasivo de corto plazo.`;
    } else if (cobertura < 1.2) {
      tone = 'amber';
      label = 'Cubre justo';
      summary = `Cubre ${cobertura.toFixed(2)}× la necesidad del ciclo. Alcanza, pero sin colchón: una temporada baja de piso o un retraso en garantías de fábrica dejaría corto el capital de trabajo (meta ≥ 1.20×).`;
    } else {
      tone = 'green';
      label = 'Cubre holgado';
      summary = `Cubre ${cobertura.toFixed(2)}× lo que el ciclo exige. Con el plan piso financiando las unidades, el capital de trabajo alcanza para inventario de refacciones, cartera de garantías y aseguradoras con margen de maniobra.`;
    }
  }

  return {
    disponible: necesidad > 0.01 || ct !== 0,
    cobertura,
    display,
    tone,
    label,
    summary,
    capitalTrabajo: ct,
    necesidadCiclo: necesidad,
    necesidadBruta,
    inventario: inv,
    cuentasPorCobrarSinIva: cxc,
    cxpProveedores: cxp,
    planPiso: piso,
    activoCirculante: round2(Number(activoCirculante) || 0),
    pasivoCirculante: round2(Number(pasivoCirculante) || 0),
    formula: 'Capital de trabajo ÷ (Inventario + CxC sin IVA − CxP proveedores − Plan piso)',
    valorControl: 'Agencia: ≥ 1.20×',
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
  // Agencia: proveedores de refacciones e insumos de taller operan a 30–45 días.
  // El plan piso no entra aquí porque es deuda financiera, no crédito comercial.
  if (dpoDias != null) {
    if (dpoDias > 60) {
      tone = 'amber';
      label = 'Pago muy diferido';
      summary = `Se tarda ~${dpoDias} días en pagar a proveedores de refacciones e insumos, arriba de los 45 días habituales. Vigilar que no se frene el surtido de partes ni el servicio del taller.`;
    } else if (dpoDias < 20) {
      tone = 'blue';
      label = 'Pago muy rápido';
      summary = `Se paga a proveedores en ${dpoDias} días. Más rápido que los 30 a 45 días del sector: se está financiando al proveedor con caja propia en lugar de aprovechar el plazo.`;
    } else {
      tone = 'green';
      label = 'Plazo de proveedores sano';
      summary = `Se paga a proveedores en ${dpoDias} días, dentro de los 30 a 45 días con los que suele operar el área de refacciones y taller.`;
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
    valorControl: 'Agencia: 30 – 45 días',
  };
}

/**
 * EBIT ≈ utilidad de operación (UAFI).
 * EBITDA / UAFIDA ≈ EBIT + depreciación del periodo.
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

  let ebitdaTone = 'slate';
  let ebitdaLabel = 'Sin dato';
  let ebitdaSummary = 'Se requiere utilidad de operación y depreciación del periodo para calcular el EBITDA (UAFIDA).';
  if (Number.isFinite(ebitda)) {
    if (margenEbitdaPct == null) {
      ebitdaTone = ebitda >= 0 ? 'green' : 'rose';
      ebitdaLabel = ebitda >= 0 ? 'Positivo' : 'Negativo';
      ebitdaSummary = ebitda >= 0
        ? 'EBITDA (UAFIDA) positivo: la operación genera utilidad antes de financiamiento, impuestos, depreciación y amortización.'
        : 'EBITDA (UAFIDA) negativo: la operación no cubre costos/gastos antes de D&A.';
    } else if (margenEbitdaPct >= 5) {
      ebitdaTone = 'green';
      ebitdaLabel = 'Sobre objetivo';
      ebitdaSummary = `Margen EBITDA ${margenEbitdaPct}%: generación operativa sólida (≥ 5% de ventas).`;
    } else if (margenEbitdaPct >= 0) {
      ebitdaTone = 'amber';
      ebitdaLabel = 'Bajo objetivo';
      ebitdaSummary = `Margen EBITDA ${margenEbitdaPct}%: positivo pero bajo el objetivo de 5% sobre ventas.`;
    } else {
      ebitdaTone = 'rose';
      ebitdaLabel = 'Negativo';
      ebitdaSummary = `Margen EBITDA ${margenEbitdaPct}%: la operación no genera UAFIDA sobre ventas.`;
    }
  }

  return {
    ebit,
    ebitda,
    uafida: ebitda,
    depreciacionPeriodo: dep,
    margenEbitPct,
    margenEbitdaPct,
    crecimientoEbitPct,
    ebitdaTone,
    ebitdaLabel,
    ebitdaSummary,
    utilidadOperacionAnterior: utilidadOperacionAnterior != null
      ? round2(utilidadOperacionAnterior)
      : null,
    formula: {
      ebit: 'Utilidad de operación (proxy EBIT / UAFI)',
      ebitda: 'Utilidad de operación + Depreciación del periodo (EBITDA / UAFIDA)',
      uafida: 'Utilidad Antes de Financiamiento, Impuestos, Depreciación y Amortización',
      crecimientoEbit: 'Variación % vs mismo periodo del año anterior',
    },
  };
}

module.exports = {
  computeEstructuraFinanciera,
  computeDso,
  computeDri,
  computeDpo,
  computeCicloEfectivo,
  computeCoberturaCapitalTrabajo,
  computeEbitMetrics,
  daysInclusive,
  round1,
  round2,
};
