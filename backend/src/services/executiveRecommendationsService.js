/**
 * Recomendaciones nivel directivo: ritmo vs meta, embudo histórico (leads/solicitudes),
 * mix de producto y cuellos de botella para saber cuándo meter presión.
 */

const { getVentas } = require('./ventas');
const { getGoals } = require('./salesGoals');
const crmCiclos = require('./crmCiclosService');

const HIGH_END = ['SUBURBAN', 'SUBUR', 'TAHOE', 'CHEYENNE', 'TRAVERSE'];

function round1(n) {
  return Math.round(Number(n || 0) * 10) / 10;
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYmd(s) {
  if (!s) return null;
  const d = new Date(`${String(s).slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysInclusive(fechaInicio, fechaFin) {
  const a = parseYmd(fechaInicio);
  const b = parseYmd(fechaFin);
  if (!a || !b || b < a) return null;
  return Math.floor((b - a) / 86400000) + 1;
}

function expectedPacePct(fechaInicio, fechaFin) {
  const total = daysInclusive(fechaInicio, fechaFin);
  if (!total || total <= 0) return null;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const start = parseYmd(fechaInicio);
  const end = parseYmd(fechaFin);
  if (!start || !end) return null;
  if (today < start) return 0;
  if (today > end) return 100;
  const elapsed = Math.floor((today - start) / 86400000) + 1;
  return round1(Math.min(100, (elapsed / total) * 100));
}

function daysRemaining(fechaFin) {
  const end = parseYmd(fechaFin);
  if (!end) return null;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  if (today > end) return 0;
  return Math.floor((end - today) / 86400000) + 1;
}

function priorComparableRange(fechaInicio, fechaFin) {
  const start = parseYmd(fechaInicio);
  const end = parseYmd(fechaFin);
  const n = daysInclusive(fechaInicio, fechaFin);
  if (!start || !end || !n) return null;
  const priorEnd = new Date(start);
  priorEnd.setDate(priorEnd.getDate() - 1);
  const priorStart = new Date(priorEnd);
  priorStart.setDate(priorStart.getDate() - (n - 1));
  return { fechaInicio: ymd(priorStart), fechaFin: ymd(priorEnd), dias: n };
}

function pct(num, den) {
  const d = Number(den || 0);
  if (!d) return null;
  return round1((Number(num || 0) / d) * 100);
}

function ratePerDay(total, dias) {
  if (!dias || dias <= 0) return null;
  return round2(Number(total || 0) / dias);
}

function deltaPct(actual, base) {
  const b = Number(base);
  if (!Number.isFinite(b) || b === 0) return null;
  return round1(((Number(actual) - b) / Math.abs(b)) * 100);
}

function isHighEndLabel(label) {
  const u = String(label || '').toUpperCase();
  return HIGH_END.some((k) => u.includes(k));
}

function safeFunnel(desde, hasta) {
  try {
    if (!crmCiclos.isAvailable?.()) {
      return { available: false, reason: 'CRM no disponible' };
    }
    const s = crmCiclos.getSeguimiento360Summary({ desde, hasta });
    const leads = s.leads || {};
    const solicitudes = s.solicitudes || {};
    const pruebas = s.pruebasManejo || s.pruebas || {};
    return {
      available: true,
      periodo: s.filtros || { desde, hasta },
      leads: {
        total: Number(leads.total || 0),
        citas: Number(leads.citas || 0),
        contactados: Number(leads.contactados || 0),
        conCompra: Number(leads.conCompra || 0),
      },
      solicitudes: {
        total: Number(solicitudes.total || 0),
        aprobadas: Number(solicitudes.aprobadas || 0),
        conCompra: Number(solicitudes.conCompra || 0),
      },
      pruebas: {
        total: Number(pruebas.total || 0),
        conCompra: Number(pruebas.conCompra || 0),
      },
      conversiones: s.conversiones || {
        leadACitaPct: pct(leads.citas, leads.total),
        leadACompraPct: pct(leads.conCompra, leads.total),
        solicitudACompraPct: pct(solicitudes.conCompra, solicitudes.total),
      },
    };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}

function analyzeRitmo({ fechaInicio, fechaFin, retail, goalRetail, sofia, goalSofia }) {
  const pace = expectedPacePct(fechaInicio, fechaFin);
  const diasTotales = daysInclusive(fechaInicio, fechaFin);
  const restantes = daysRemaining(fechaFin);
  const retailPct = goalRetail > 0 ? pct(retail, goalRetail) : null;
  const sofiaPct = goalSofia > 0 ? pct(sofia, goalSofia) : null;
  const gapRetail = retailPct != null && pace != null ? round1(pace - retailPct) : null;
  const gapSofia = sofiaPct != null && pace != null ? round1(pace - sofiaPct) : null;
  const faltanRetail = Math.max(0, Number(goalRetail || 0) - Number(retail || 0));
  const runRateNecesario = restantes > 0 ? round2(faltanRetail / restantes) : null;
  const elapsedDays = pace != null && diasTotales
    ? Math.max(1, Math.round((diasTotales * pace) / 100))
    : diasTotales;
  const runRateActual = ratePerDay(retail, elapsedDays);

  let senalPresion = 'sostener';
  let motivoPresion = 'El ritmo va alineado con el calendario.';
  if (gapRetail != null && gapRetail >= 15) {
    senalPresion = 'presionar_ahora';
    motivoPresion = `Retail va ${gapRetail} pp detrás del ritmo del periodo; hay que acelerar cierres ya.`;
  } else if (gapRetail != null && gapRetail >= 8) {
    senalPresion = 'alerta_temprana';
    motivoPresion = `Retail va ${gapRetail} pp detrás; intervenir esta semana antes de que el gap se haga irrecuperable.`;
  } else if (runRateNecesario != null && runRateActual != null && runRateNecesario > runRateActual * 1.35) {
    senalPresion = 'presionar_ahora';
    motivoPresion = `Se necesitan ~${runRateNecesario} uds/día y el ritmo actual es ~${runRateActual}; no alcanza sin presión.`;
  }

  return {
    paceEsperadoPct: pace,
    retail,
    goalRetail,
    retailAvancePct: retailPct,
    gapVsPacePp: gapRetail,
    sofia,
    goalSofia,
    sofiaAvancePct: sofiaPct,
    gapSofiaVsPacePp: gapSofia,
    faltanRetail,
    diasRestantes: restantes,
    runRateActualUdsDia: runRateActual,
    runRateNecesarioUdsDia: runRateNecesario,
    senalPresion,
    motivoPresion,
  };
}

function analyzeFunnelHistorico(actual, previo, diasActual, diasPrevio) {
  if (!actual?.available) {
    return { available: false, reason: actual?.reason || 'Sin funnel CRM' };
  }

  const solAct = ratePerDay(actual.solicitudes.total, diasActual);
  const solPrev = previo?.available ? ratePerDay(previo.solicitudes.total, diasPrevio) : null;
  const leadAct = ratePerDay(actual.leads.total, diasActual);
  const leadPrev = previo?.available ? ratePerDay(previo.leads.total, diasPrevio) : null;
  const citaAct = ratePerDay(actual.leads.citas, diasActual);
  const citaPrev = previo?.available ? ratePerDay(previo.leads.citas, diasPrevio) : null;

  const cuellos = [];
  const leadACita = actual.conversiones?.leadACitaPct ?? pct(actual.leads.citas, actual.leads.total);
  const solACompra = actual.conversiones?.solicitudACompraPct
    ?? pct(actual.solicitudes.conCompra, actual.solicitudes.total);
  const prevLeadACita = previo?.available
    ? (previo.conversiones?.leadACitaPct ?? pct(previo.leads.citas, previo.leads.total))
    : null;
  const prevSolACompra = previo?.available
    ? (previo.conversiones?.solicitudACompraPct ?? pct(previo.solicitudes.conCompra, previo.solicitudes.total))
    : null;

  if (solPrev != null && solAct != null && deltaPct(solAct, solPrev) <= -20) {
    cuellos.push({
      etapa: 'solicitudes_fi',
      severidad: 'critical',
      hallazgo: `Ritmo de solicitudes F&I cae ${Math.abs(deltaPct(solAct, solPrev))}% vs periodo comparable (${solAct}/día vs ${solPrev}/día).`,
      accion: 'Meter presión en pipeline comercial → F&I: citas con solicitud el mismo día y seguimiento de buró/docs.',
    });
  } else if (solPrev != null && solAct != null && deltaPct(solAct, solPrev) <= -10) {
    cuellos.push({
      etapa: 'solicitudes_fi',
      severidad: 'warning',
      hallazgo: `Solicitudes/día abajo ${Math.abs(deltaPct(solAct, solPrev))}% vs histórico reciente.`,
      accion: 'Revisar agenda de asesores y conversión cita→solicitud esta semana.',
    });
  }

  if (leadPrev != null && leadAct != null && deltaPct(leadAct, leadPrev) <= -20) {
    cuellos.push({
      etapa: 'leads',
      severidad: 'warning',
      hallazgo: `Entrada de leads/día baja ${Math.abs(deltaPct(leadAct, leadPrev))}% vs comparable.`,
      accion: 'Activar campañas / piso / digital; no esperar al cierre del mes.',
    });
  }

  if (leadACita != null && leadACita < 25 && Number(actual.leads.total) >= 20) {
    cuellos.push({
      etapa: 'cita',
      severidad: leadACita < 15 ? 'critical' : 'warning',
      hallazgo: `Solo ${leadACita}% de leads llega a cita (cuello de contacto/agendado).`,
      accion: 'Auditar tiempos de primer contacto y slots de demostración por vendedor.',
    });
  } else if (prevLeadACita != null && leadACita != null && leadACita < prevLeadACita - 8) {
    cuellos.push({
      etapa: 'cita',
      severidad: 'warning',
      hallazgo: `Conversión lead→cita bajó de ${prevLeadACita}% a ${leadACita}%.`,
      accion: 'Reforzar disciplina de seguimiento en las primeras 24–48 h.',
    });
  }

  if (solACompra != null && Number(actual.solicitudes.total) >= 8 && solACompra < 35) {
    cuellos.push({
      etapa: 'aprobacion_cierre',
      severidad: 'warning',
      hallazgo: `Solo ${solACompra}% de solicitudes terminan en compra.`,
      accion: 'Mesa de crédito: rechazos, gaps y alternativas de enganche/plazo.',
    });
  } else if (prevSolACompra != null && solACompra != null && solACompra < prevSolACompra - 10) {
    cuellos.push({
      etapa: 'aprobacion_cierre',
      severidad: 'warning',
      hallazgo: `Conversión solicitud→compra bajó de ${prevSolACompra}% a ${solACompra}%.`,
      accion: 'Priorizar solicitudes aprobadas sin factura y liberar bloqueos F&I.',
    });
  }

  if (citaPrev != null && citaAct != null && deltaPct(citaAct, citaPrev) <= -20 && Number(actual.leads.total) >= 15) {
    cuellos.push({
      etapa: 'volumen_citas',
      severidad: 'warning',
      hallazgo: `Citas/día caen ${Math.abs(deltaPct(citaAct, citaPrev))}% vs histórico.`,
      accion: 'Forzar agenda mínima diaria por vendedor hasta recuperar ritmo.',
    });
  }

  return {
    available: true,
    actual,
    previo: previo?.available ? previo : null,
    ritmos: {
      leadsPorDia: { actual: leadAct, previo: leadPrev, deltaPct: deltaPct(leadAct, leadPrev) },
      citasPorDia: { actual: citaAct, previo: citaPrev, deltaPct: deltaPct(citaAct, citaPrev) },
      solicitudesPorDia: { actual: solAct, previo: solPrev, deltaPct: deltaPct(solAct, solPrev) },
    },
    conversiones: {
      leadACitaPct: leadACita,
      leadACitaPrevPct: prevLeadACita,
      solicitudACompraPct: solACompra,
      solicitudACompraPrevPct: prevSolACompra,
    },
    cuellos,
  };
}

function analyzeMix({ retail, flotillas, total, porModelo, utilidadCarline, goalRetail, faltanRetail }) {
  const flotillaPct = total > 0 ? pct(flotillas, total) : null;
  const modelos = Array.isArray(porModelo) ? porModelo.slice(0, 12) : [];
  const highEndUnits = modelos
    .filter((m) => isHighEndLabel(m.label || m.modelo || m.key))
    .reduce((s, m) => s + Number(m.count || m.unidades || 0), 0);
  const highEndPct = retail > 0 ? pct(highEndUnits, retail) : null;

  const carlines = utilidadCarline?.porCarline || [];
  const liderUtil = carlines[0]?.mejorVersion
    ? {
      carline: carlines[0].carline,
      version: carlines[0].mejorVersion.version,
      utilidadPromedio: carlines[0].mejorVersion.utilidadPromedio,
      margenBrutoPct: carlines[0].mejorVersion.margenBrutoPct,
    }
    : null;

  const topVolumen = modelos.slice(0, 5).map((m) => ({
    modelo: m.label || m.modelo || m.key,
    unidades: Number(m.count || m.unidades || 0),
  }));

  const hallazgos = [];
  if (flotillaPct != null && flotillaPct >= 40) {
    hallazgos.push({
      severidad: 'warning',
      hallazgo: `Flotilla representa ${flotillaPct}% del volumen; puede inflar total sin empujar retail/meta SOFIA.`,
      accion: 'Separar tablero de presión: meta retail y HIGH END con dueños distintos a flotilla.',
    });
  }

  if (goalRetail > 0 && faltanRetail > 0 && highEndPct != null && highEndPct < 15 && faltanRetail >= 5) {
    hallazgos.push({
      severidad: 'info',
      hallazgo: `HIGH END aporta solo ${highEndPct}% del retail y faltan ${faltanRetail} uds a meta.`,
      accion: liderUtil
        ? `Empujar stock/cierres de ${liderUtil.carline} (${liderUtil.version}) — mejor utilidad/ud del periodo.`
        : 'Balancear mix: no cubrir el faltante solo con volumen de entrada si hay stock HIGH END.',
    });
  }

  if (liderUtil && Number(liderUtil.margenBrutoPct) >= 12) {
    hallazgos.push({
      severidad: 'info',
      hallazgo: `Mejor utilidad unitaria: ${liderUtil.carline} · ${liderUtil.version} (MB ${liderUtil.margenBrutoPct}%).`,
      accion: 'Validar si el mix de citas/demo está sesgado a líneas de menor margen.',
    });
  }

  const mixAlineadoMeta = !(flotillaPct >= 45)
    && !(faltanRetail >= 8 && highEndPct != null && highEndPct < 10);

  return {
    flotillaPct,
    highEndUnits,
    highEndPctRetail: highEndPct,
    topVolumen,
    liderUtilidad: liderUtil,
    mixAlineadoMeta,
    hallazgos,
  };
}

function buildRecommendations({ ritmo, funnel, mix }) {
  const recs = [];
  const pushRec = (prioridad, area, titulo, porQue, accion, impacto) => {
    recs.push({ prioridad, area, titulo, porQue, accion, impactoEstimado: impacto || null });
  };

  if (ritmo.senalPresion === 'presionar_ahora') {
    pushRec(
      1,
      'ritmo',
      'Meter presión comercial ahora',
      ritmo.motivoPresion,
      `Meta diaria mínima: ${ritmo.runRateNecesarioUdsDia ?? '—'} uds retail · faltan ${ritmo.faltanRetail} con ${ritmo.diasRestantes} día(s).`,
      `Cerrar gap de ${ritmo.gapVsPacePp ?? '—'} pp vs ritmo calendario`,
    );
  } else if (ritmo.senalPresion === 'alerta_temprana') {
    pushRec(
      2,
      'ritmo',
      'Alerta temprana de ritmo',
      ritmo.motivoPresion,
      'Junta flash con gerentes: pipeline 7 días, citas confirmadas y bloqueos F&I.',
      'Evitar que el rezago se vuelva irrecuperable',
    );
  }

  for (const c of funnel.cuellos || []) {
    pushRec(
      c.severidad === 'critical' ? 1 : 2,
      `embudo:${c.etapa}`,
      `Cuello: ${c.etapa.replace(/_/g, ' ')}`,
      c.hallazgo,
      c.accion,
      'Recuperar conversión vs histórico',
    );
  }

  for (const h of mix.hallazgos || []) {
    pushRec(
      h.severidad === 'warning' ? 2 : 3,
      'mix',
      'Ajuste de mezcla / producto',
      h.hallazgo,
      h.accion,
      'Mejor probabilidad de llegar a meta con margen',
    );
  }

  if (!recs.length) {
    pushRec(
      3,
      'sostener',
      'Ritmo y embudo en zona saludable',
      'No hay desviación fuerte vs calendario ni vs histórico reciente.',
      'Mantener ritual semanal de ritmo (uds/día, solicitudes/día, mix HIGH END).',
      null,
    );
  }

  return recs
    .sort((a, b) => a.prioridad - b.prioridad)
    .slice(0, 8);
}

function buildDiagnostico({ ritmo, funnel, mix, recomendaciones }) {
  const parts = [];
  if (ritmo.retailAvancePct != null && ritmo.paceEsperadoPct != null) {
    parts.push(
      `Retail ${ritmo.retail}/${ritmo.goalRetail || '—'} (${ritmo.retailAvancePct}% vs ritmo ${ritmo.paceEsperadoPct}%).`,
    );
  }
  if (ritmo.senalPresion === 'presionar_ahora') {
    parts.push('Señal: PRESIONAR AHORA.');
  } else if (ritmo.senalPresion === 'alerta_temprana') {
    parts.push('Señal: alerta temprana de ritmo.');
  }
  const topCuello = (funnel.cuellos || [])[0];
  if (topCuello) parts.push(`Cuello principal: ${topCuello.hallazgo}`);
  if (mix.mixAlineadoMeta === false) {
    parts.push('El mix actual no parece óptimo para cerrar la meta con buen margen.');
  }
  if (recomendaciones[0]) {
    parts.push(`Prioridad #1: ${recomendaciones[0].titulo}.`);
  }
  return parts.join(' ');
}

function analyzeExecutiveSnapshot({
  fechaInicio,
  fechaFin,
  resumen = {},
  goals = {},
  utilidadCarline = null,
  porModelo = null,
} = {}) {
  if (!fechaInicio || !fechaFin) {
    return { available: false, reason: 'Se requieren fechaInicio y fechaFin' };
  }

  const retail = Number(resumen.totalRetail ?? resumen.retail ?? 0);
  const flotillas = Number(resumen.totalFlotillas ?? resumen.flotillas ?? 0);
  const total = Number(resumen.totalVentas ?? retail + flotillas);
  const sofia = Number(resumen.totalNotificacionesEntrega ?? resumen.sofia ?? 0);
  const goalRetail = Number(goals.retail || 0);
  const goalSofia = Number(goals.sofia || 0);
  const modelos = porModelo || resumen.porModelo || [];

  const dias = daysInclusive(fechaInicio, fechaFin);
  const prior = priorComparableRange(fechaInicio, fechaFin);
  const funnelActual = safeFunnel(fechaInicio, fechaFin);
  const funnelPrevio = prior
    ? safeFunnel(prior.fechaInicio, prior.fechaFin)
    : { available: false };

  const ritmo = analyzeRitmo({
    fechaInicio,
    fechaFin,
    retail,
    goalRetail,
    sofia,
    goalSofia,
  });
  const funnel = analyzeFunnelHistorico(funnelActual, funnelPrevio, dias, prior?.dias || dias);
  const mix = analyzeMix({
    retail,
    flotillas,
    total,
    porModelo: modelos,
    utilidadCarline,
    goalRetail,
    faltanRetail: ritmo.faltanRetail,
  });

  const solDelta = funnel.ritmos?.solicitudesPorDia?.deltaPct;
  if (
    ritmo.senalPresion === 'alerta_temprana'
    && solDelta != null
    && solDelta <= -15
  ) {
    ritmo.senalPresion = 'presionar_ahora';
    ritmo.motivoPresion += ` Además, solicitudes/día caen ${Math.abs(solDelta)}% vs histórico.`;
  }

  const recomendaciones = buildRecommendations({ ritmo, funnel, mix });
  const diagnosticoEjecutivo = buildDiagnostico({ ritmo, funnel, mix, recomendaciones });

  return {
    available: true,
    periodo: {
      fechaInicio,
      fechaFin,
      dias,
      comparableAnterior: prior,
    },
    diagnosticoEjecutivo,
    ritmo,
    funnel,
    mix,
    recomendaciones,
    instruccionesAlAsistente:
      'Eres asesor de dirección comercial. Usa SOLO estas cifras. '
      + 'Explica: 1) si hay que meter presión ya y por qué, 2) cuellos del embudo vs histórico, '
      + '3) si el mix ayuda a la meta, 4) 3 acciones priorizadas para gerencia. '
      + 'No inventes unidades ni porcentajes fuera de este JSON.',
  };
}

async function getExecutiveRecommendations({
  periodo = 'mes_actual',
  fechaInicio = null,
  fechaFin = null,
} = {}) {
  let fi = fechaInicio;
  let ff = fechaFin;

  if (!fi || !ff) {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const key = String(periodo || 'mes_actual').toLowerCase();
    if (key === 'mes_pasado') {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      fi = ymd(start);
      ff = ymd(end);
    } else if (key === 'semana_actual') {
      const start = new Date(today);
      start.setDate(start.getDate() - 6);
      fi = ymd(start);
      ff = ymd(today);
    } else {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      fi = ymd(start);
      ff = ymd(today);
    }
  }

  const [ventas, goals] = await Promise.all([
    getVentas({ fechaInicio: fi, fechaFin: ff }).catch((err) => ({ error: err.message })),
    Promise.resolve().then(() => {
      try {
        return getGoals({ fechaInicio: fi, fechaFin: ff });
      } catch (err) {
        return { retail: 0, sofia: 0, error: err.message };
      }
    }),
  ]);

  if (ventas?.error) {
    return { available: false, reason: ventas.error, periodo: { fechaInicio: fi, fechaFin: ff } };
  }

  const resumen = ventas.resumen || {};
  const analysis = analyzeExecutiveSnapshot({
    fechaInicio: fi,
    fechaFin: ff,
    resumen,
    goals: {
      retail: goals.retail ?? goals.objetivoRetail ?? 0,
      sofia: goals.sofia ?? goals.objetivoSofia ?? 0,
    },
    utilidadCarline: ventas.utilidadCarline || null,
    porModelo: resumen.porModelo || [],
  });

  return {
    ...analysis,
    fuentes: {
      ventas: true,
      objetivos: !goals.error,
      crmFunnel: analysis.funnel?.available === true,
    },
  };
}

function buildDirectivoInsights(payload = {}) {
  const fi = payload.fechaInicio || null;
  const ff = payload.fechaFin || null;
  if (!fi || !ff) return [];

  const snap = analyzeExecutiveSnapshot({
    fechaInicio: fi,
    fechaFin: ff,
    resumen: payload.resumen || {},
    goals: payload.goals || {},
    utilidadCarline: payload.utilidadCarline || null,
    porModelo: payload.resumen?.porModelo || payload.porModelo || null,
  });
  if (!snap.available) return [];

  const insights = [];
  const { ritmo, funnel, mix, recomendaciones, diagnosticoEjecutivo } = snap;

  const chatLines = [
    `Diagnóstico: ${diagnosticoEjecutivo}`,
    `Retail: ${ritmo.retail}/${ritmo.goalRetail} (${ritmo.retailAvancePct}% · ritmo ${ritmo.paceEsperadoPct}%)`,
    `Señal presión: ${ritmo.senalPresion} — ${ritmo.motivoPresion}`,
    `Run-rate necesario: ${ritmo.runRateNecesarioUdsDia} uds/día · restantes ${ritmo.diasRestantes}`,
    funnel.ritmos?.solicitudesPorDia
      ? `Solicitudes/día: ${funnel.ritmos.solicitudesPorDia.actual} (prev ${funnel.ritmos.solicitudesPorDia.previo}, Δ ${funnel.ritmos.solicitudesPorDia.deltaPct}%)`
      : null,
    funnel.ritmos?.leadsPorDia
      ? `Leads/día: ${funnel.ritmos.leadsPorDia.actual} (prev ${funnel.ritmos.leadsPorDia.previo}, Δ ${funnel.ritmos.leadsPorDia.deltaPct}%)`
      : null,
    `Mix flotilla: ${mix.flotillaPct}% · HIGH END retail: ${mix.highEndPctRetail}%`,
    ...recomendaciones.slice(0, 5).map((r, i) => `${i + 1}. [${r.area}] ${r.titulo}: ${r.accion}`),
    `Periodo: ${fi} — ${ff}`,
  ].filter(Boolean);

  if (ritmo.senalPresion === 'presionar_ahora' || ritmo.senalPresion === 'alerta_temprana') {
    insights.push({
      id: 'ventas-presion-directiva',
      kpiId: 'kpiCardRetail',
      module: 'ventas',
      severity: ritmo.senalPresion === 'presionar_ahora' ? 'critical' : 'warning',
      title: ritmo.senalPresion === 'presionar_ahora'
        ? 'Presión comercial: ritmo insuficiente'
        : 'Alerta temprana de ritmo vs meta',
      summary: ritmo.motivoPresion,
      analysis: diagnosticoEjecutivo,
      recommendations: recomendaciones
        .filter((r) => r.area === 'ritmo' || String(r.area).startsWith('embudo'))
        .slice(0, 4)
        .map((r) => r.accion),
      metrics: { ritmo, senal: ritmo.senalPresion },
      chatPrompt: [
        'Eres el analista de BALDERRAMA para dirección comercial.',
        'Hallazgo: ritmo / presión sobre la meta.',
        'Datos reales:',
        ...chatLines.map((l) => `- ${l}`),
        'Indica cuándo meter presión, en qué etapa del embudo y 3 acciones de gerencia. Solo usa estos datos.',
      ].join('\n'),
    });
  }

  if ((funnel.cuellos || []).length) {
    const top = funnel.cuellos[0];
    insights.push({
      id: 'ventas-cuello-embudo',
      kpiId: 'kpiCardRetail',
      module: 'ventas',
      severity: top.severidad === 'critical' ? 'critical' : 'warning',
      title: 'Cuello de botella en embudo vs histórico',
      summary: top.hallazgo,
      analysis:
        `Comparando el periodo con el tramo comparable anterior, el embudo muestra fricción en ${top.etapa}. `
        + (funnel.cuellos.slice(1).map((c) => c.hallazgo).join(' ') || ''),
      recommendations: funnel.cuellos.slice(0, 4).map((c) => c.accion),
      metrics: { cuellos: funnel.cuellos, ritmos: funnel.ritmos, conversiones: funnel.conversiones },
      chatPrompt: [
        'Eres el analista de BALDERRAMA. Profundiza el cuello de botella del embudo comercial.',
        'Datos reales:',
        ...chatLines.map((l) => `- ${l}`),
        'Explica la causa más probable y un plan de 7 días para dirección.',
      ].join('\n'),
    });
  }

  if (mix.hallazgos?.length && mix.mixAlineadoMeta === false) {
    insights.push({
      id: 'ventas-mix-objetivo',
      kpiId: 'kpiCardFlotillas',
      module: 'ventas',
      severity: 'warning',
      title: 'Mezcla de producto vs objetivo',
      summary: mix.hallazgos[0].hallazgo,
      analysis: mix.hallazgos.map((h) => h.hallazgo).join(' '),
      recommendations: mix.hallazgos.map((h) => h.accion),
      metrics: {
        flotillaPct: mix.flotillaPct,
        highEndPctRetail: mix.highEndPctRetail,
        liderUtilidad: mix.liderUtilidad,
        topVolumen: mix.topVolumen,
      },
      chatPrompt: [
        'Eres el analista de BALDERRAMA. Evalúa si el mix actual puede llevar a la meta.',
        'Datos reales:',
        ...chatLines.map((l) => `- ${l}`),
        'Recomienda mix ideal (volumen vs HIGH END / utilidad) sin inventar cifras.',
      ].join('\n'),
    });
  }

  return insights;
}

module.exports = {
  getExecutiveRecommendations,
  analyzeExecutiveSnapshot,
  buildDirectivoInsights,
  expectedPacePct,
  HIGH_END,
};
