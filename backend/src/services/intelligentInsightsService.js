/**
 * Alertas inteligentes basadas en datos reales de cada módulo.
 * Objetivo: detectar posibles fallas operativas / comerciales / financieras
 * y abrir análisis profundo con el asistente IA.
 */

function round1(n) {
  return Math.round(Number(n || 0) * 10) / 10;
}

function daysInclusive(fechaInicio, fechaFin) {
  if (!fechaInicio || !fechaFin) return null;
  const a = new Date(`${fechaInicio}T12:00:00`);
  const b = new Date(`${fechaFin}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return null;
  return Math.floor((b - a) / 86400000) + 1;
}

function expectedPacePct(fechaInicio, fechaFin) {
  const total = daysInclusive(fechaInicio, fechaFin);
  if (!total || total <= 0) return null;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const start = new Date(`${fechaInicio}T12:00:00`);
  const end = new Date(`${fechaFin}T12:00:00`);
  if (today < start) return 0;
  if (today > end) return 100;
  const elapsed = Math.floor((today - start) / 86400000) + 1;
  return round1(Math.min(100, (elapsed / total) * 100));
}

function chatPrompt(module, title, contextLines, ask) {
  return [
    `Eres el analista de BALDERRAMA. Profundiza esta alerta del módulo ${module}.`,
    `Hallazgo (posible falla operativa/comercial): ${title}`,
    'Datos reales del sistema / base de datos:',
    ...contextLines.map((l) => `- ${l}`),
    ask
      || 'Identifica causas raíz probables (fallas de proceso, omisiones, cuellos de botella), impacto en la agencia y 3–5 acciones concretas priorizadas. Usa solo los datos dados; no inventes cifras. Responde en español.',
  ].join('\n');
}

function push(list, insight) {
  if (insight?.kpiId) list.push(insight);
}

/* ───────────────── Ventas ───────────────── */

function buildVentasInsights(payload = {}) {
  const insights = [];
  const r = payload.resumen || {};
  const goals = payload.goals || {};
  const ytd = payload.ytd || {};
  const fi = payload.fechaInicio || null;
  const ff = payload.fechaFin || null;
  const pace = expectedPacePct(fi, ff);

  const retail = Number(r.totalRetail ?? r.retail ?? 0);
  const flotillas = Number(r.totalFlotillas ?? r.flotillas ?? 0);
  const total = Number(r.totalVentas ?? retail + flotillas);
  const sofia = Number(r.totalNotificacionesEntrega ?? r.sofia ?? 0);
  const sinTimbrar = Number(r.totalUnidadesFacturadasNoTimbradas ?? r.sinTimbrar ?? 0);
  const numerador = Number(r.numeradorCobertura ?? (sofia + sinTimbrar));
  const goalRetail = Number(goals.retail || 0);
  const goalSofia = Number(goals.sofia || 0);

  if (goalRetail > 0 && pace != null) {
    const pct = round1((retail / goalRetail) * 100);
    const gap = round1(pace - pct);
    if (gap >= 12) {
      push(insights, {
        id: 'ventas-ritmo-retail',
        kpiId: 'kpiCardRetail',
        module: 'ventas',
        severity: 'warning',
        title: 'Retail por debajo del ritmo del periodo',
        summary: `Llevas ${pct}% del objetivo retail y el calendario exige ~${pace}%.`,
        analysis:
          `Con ${retail} unidades retail frente a un objetivo de ${goalRetail}, el avance va `
          + `${gap} pp atrás del ritmo del periodo ${fi || '—'} a ${ff || '—'}. `
          + 'Posible falla: pipeline de cierres insuficiente, desvío a flotilla o stock/proceso que frena entregas.',
        recommendations: [
          'Priorizar citas y cierres de prospectos calientes en 5–7 días.',
          'Revisar mix retail vs flotilla e incentivos.',
          'Definir meta diaria = pendiente ÷ días restantes.',
          'Usar Seguimiento 360 en leads con prueba sin solicitud/cierre.',
        ],
        metrics: { retail, goalRetail, pct, paceExpected: pace, gap },
        chatPrompt: chatPrompt('Ventas', 'Retail debajo del ritmo', [
          `Retail: ${retail}`, `Objetivo: ${goalRetail}`, `Avance: ${pct}%`, `Ritmo esperado: ${pace}%`, `Periodo: ${fi} — ${ff}`,
        ]),
      });
    }
  }

  if (goalSofia > 0 && pace != null) {
    const pct = round1((sofia / goalSofia) * 100);
    const gap = round1(pace - pct);
    if (gap >= 12) {
      push(insights, {
        id: 'ventas-ritmo-sofia',
        kpiId: 'kpiCardEntregasSofia',
        module: 'ventas',
        severity: 'warning',
        title: 'Entregas SOFIA rezagadas vs objetivo',
        summary: `SOFIA al ${pct}% del objetivo; el ritmo pide ~${pace}%.`,
        analysis:
          `Hay ${sofia} notificaciones frente a objetivo ${goalSofia}. `
          + 'Falla típica: cuellos en facturación, previas, F&I o logística de entrega.',
        recommendations: [
          'Cruzar facturas pendientes de entrega y liberar bloqueos F&I.',
          'No programar entrega sin previas.',
          'Acelerar unidades facturadas sin timbrar.',
        ],
        metrics: { sofia, goalSofia, pct, paceExpected: pace, gap },
        chatPrompt: chatPrompt('Ventas', 'SOFIA debajo del ritmo', [
          `SOFIA: ${sofia}`, `Objetivo: ${goalSofia}`, `Avance: ${pct}%`, `Ritmo: ${pace}%`,
        ]),
      });
    }
  }

  if (goalSofia > 0) {
    const pctCob = round1((numerador / goalSofia) * 100);
    if (pctCob < 85) {
      push(insights, {
        id: 'ventas-cobertura',
        kpiId: 'kpiCardCobertura',
        module: 'ventas',
        severity: pctCob < 70 ? 'critical' : 'warning',
        title: 'Cobertura bajo el umbral sano',
        summary: `Cobertura ${pctCob}% (numerador ${numerador} / objetivo ${goalSofia}).`,
        analysis:
          'La cobertura (SOFIA + sin timbrar) vs objetivo no sostiene el plan. Indica embudo de entrega roto o meta desalineada.',
        recommendations: [
          'Depurar backlog de facturas no timbradas.',
          'Alinear agenda de entregas con unidades ya facturadas.',
          'Validar que el objetivo SOFIA coincida con el plan retail.',
        ],
        metrics: { numerador, goalSofia, pctCobertura: pctCob },
        chatPrompt: chatPrompt('Ventas', 'Cobertura baja', [
          `Numerador: ${numerador}`, `Objetivo SOFIA: ${goalSofia}`, `Cobertura: ${pctCob}%`,
        ]),
      });
    }
  }

  const apartadas = Number(r.unidadesApartadas ?? 0);
  if (goalSofia > 0 && apartadas > 0) {
    const numeradorSim = numerador + apartadas;
    const pctSim = round1((numeradorSim / goalSofia) * 100);
    const pctActual = round1((numerador / goalSofia) * 100);
    if (pctSim >= 100 && pctActual < 100) {
      push(insights, {
        id: 'ventas-carry-over',
        kpiId: 'kpiCardCarryOver',
        module: 'ventas',
        severity: 'info',
        title: 'Carry over alcanzaría la cobertura',
        summary: `${apartadas} apartadas: cobertura ${pctActual}% → ${pctSim}% si se facturan.`,
        analysis:
          'Hay unidades SEP (apartadas) que, al facturarse, llevarían el numerador de cobertura (SOFIA + sin timbrar) al objetivo o por encima.',
        recommendations: [
          'Priorizar facturación/timbrado de unidades apartadas del mes.',
          'Validar que las apartadas tengan documentación y previas listas.',
        ],
        metrics: { apartadas, pctActual, pctSim, numerador, goalSofia },
        chatPrompt: chatPrompt('Ventas', 'Carry over vs cobertura', [
          `Apartadas: ${apartadas}`,
          `Cobertura actual: ${pctActual}%`,
          `Cobertura si se factura: ${pctSim}%`,
          `Objetivo SOFIA: ${goalSofia}`,
        ]),
      });
    }
  }

  if (sinTimbrar >= 5) {
    push(insights, {
      id: 'ventas-sin-timbrar',
      kpiId: 'kpiCardEntregasSofia',
      module: 'ventas',
      severity: 'warning',
      title: 'Backlog de unidades sin timbrar',
      summary: `${sinTimbrar} unidades facturadas pendientes de timbrado.`,
      analysis: 'Falla fiscal/operativa: el timbrado pendiente atrasa formalización y puede retrasar SOFIA y cobertura.',
      recommendations: [
        'Liberar cola de timbrado con contabilidad/sistemas.',
        'Separar casos bloqueados por datos fiscales incompletos.',
      ],
      metrics: { sinTimbrar },
      chatPrompt: chatPrompt('Ventas', 'Sin timbrar', [`Unidades sin timbrar: ${sinTimbrar}`]),
    });
  }

  const ytdVar = Number(ytd.variacion);
  if (Number.isFinite(ytdVar)) {
    const severity = ytdVar <= -15 ? 'critical' : ytdVar <= -5 ? 'warning' : 'info';
    const title = ytdVar < 0
      ? 'Acumulado anual por debajo del año anterior'
      : 'Acumulado anual en seguimiento';
    const direction = ytdVar < 0 ? 'debajo' : 'por encima';
    const absVar = Math.abs(ytdVar);
    const recommendations = ytdVar < 0
      ? [
          'Comparar gap por canal y modelo.',
          'Revisar generación de leads vs mismo periodo año previo.',
          'Ajustar forecast y objetivos restantes con gerencia.',
        ]
      : [
          'Sostener el ritmo en los modelos y canales que explican la mejora.',
          'Evitar descuentos que erosionen utilidad solo por perseguir volumen.',
          'Comparar qué parte de la mejora viene de retail, flotilla y mix.',
        ];
    push(insights, {
      id: 'ventas-ytd',
      kpiId: 'ytdVariacion',
      module: 'ventas',
      severity,
      title,
      summary: `Variación YTD ${ytdVar}% vs año previo.`,
      analysis:
        `YTD (${ytd.totalActual ?? '—'}) está ${absVar}% ${direction} del año anterior (${ytd.totalAnterior ?? '—'}). `
        + (ytdVar < 0
          ? 'Señal estructural, no solo un mal mes.'
          : 'Conviene validar si la mejora es sostenible y rentable.'),
      recommendations,
      metrics: { variacion: ytdVar, totalActual: ytd.totalActual, totalAnterior: ytd.totalAnterior },
      chatPrompt: chatPrompt('Ventas', ytdVar < 0 ? 'YTD negativo' : 'YTD en seguimiento', [
        `Variación: ${ytdVar}%`, `YTD actual: ${ytd.totalActual}`, `YTD anterior: ${ytd.totalAnterior}`,
      ]),
    });
  }

  if (total > 0 && flotillas / total >= 0.45) {
    const pct = round1((flotillas / total) * 100);
    push(insights, {
      id: 'ventas-mix-flotilla',
      kpiId: 'kpiCardFlotillas',
      module: 'ventas',
      severity: 'info',
      title: 'Mix alto de flotilla',
      summary: `Flotilla representa ${pct}% de las ${total} ventas del periodo.`,
      analysis: 'Mix elevado de flotilla puede sostener volumen pero comprimir margen y distorsionar objetivos retail.',
      recommendations: [
        'Separar P&L retail vs flotilla.',
        'Cuidar que flotilla no canibalice stock crítico de retail.',
      ],
      metrics: { flotillas, total, pct },
      chatPrompt: chatPrompt('Ventas', 'Mix flotilla alto', [
        `Flotilla: ${flotillas}`, `Total: ${total}`, `Mix: ${pct}%`,
      ]),
    });
  }

  const tomas = payload.tomas || {};
  const tomasTotal = Number(tomas.total ?? r.totalTomasACuenta ?? 0);
  const tomasVendidos = Number(tomas.vendidosMismoMes ?? r.totalTomasVendidasMismoMes ?? 0);
  const tomasPct = Number(
    tomas.pctVendidos
    ?? r.pctTomasVendidasMismoMes
    ?? (tomasTotal > 0 ? round1((tomasVendidos / tomasTotal) * 100) : 0)
  );
  const pendientes = Number(tomas.pendientes ?? Math.max(0, tomasTotal - tomasVendidos));
  const modelosDificiles = Array.isArray(tomas.modelosDificiles) ? tomas.modelosDificiles : [];
  const unidadesDificiles = Array.isArray(tomas.unidadesDificiles) ? tomas.unidadesDificiles : [];

  if (tomasTotal > 0) {
    const topModelos = modelosDificiles
      .slice(0, 5)
      .map((m) => {
        const nombre = String(m.modelo || m.label || 'Sin modelo').trim();
        const t = Number(m.tomas || 0);
        const v = Number(m.vendidos || 0);
        const p = Number(m.pendientes ?? Math.max(0, t - v));
        const pctM = t > 0 ? round1((v / t) * 100) : 0;
        return `${nombre}: ${p} pendientes de ${t} tomas (${pctM}% revendidas)`;
      });
    const topUnidades = unidadesDificiles
      .slice(0, 5)
      .map((u) => {
        const vin = String(u.vin || u.vinToma || '—').trim();
        const modelo = String(u.modelo || u.modeloToma || '').trim();
        const fecha = String(u.fechaToma || '').trim();
        return [vin, modelo, fecha ? `toma ${fecha}` : null].filter(Boolean).join(' · ');
      });

    let severity = 'info';
    if (pendientes >= 10 || (tomasTotal >= 8 && tomasPct < 30)) severity = 'critical';
    else if (pendientes >= 3 || tomasPct < 50) severity = 'warning';

    const title = severity === 'info'
      ? 'Tomas a cuenta en seguimiento'
      : 'Tomas difíciles de revender';
    const summary = severity === 'info'
      ? `${tomasVendidos} de ${tomasTotal} tomas del periodo ya se revendieron el mismo mes (${tomasPct}%); ${pendientes} siguen pendientes.`
      : `${pendientes} de ${tomasTotal} tomas del periodo siguen sin venta el mismo mes (${tomasPct}% revendidas).`;
    const analysisBase = severity === 'info'
      ? 'La toma a cuenta está activa en el periodo y conviene monitorear velocidad de reventa para que no se convierta en inventario usado lento. '
      : 'Las unidades tomadas que no se revenden en el mismo mes elevan inventario usado, capital inmovilizado y riesgo de envejecimiento. ';
    const recommendations = severity === 'info'
      ? [
          'Mantener seguimiento semanal a las tomas pendientes por VIN y días desde adquisición.',
          'Ajustar precio de salida temprano en modelos con menor velocidad de reventa.',
          'Usar el botón Detalle de Tomas a cuenta para revisar responsables y antigüedad.',
        ]
      : [
          'Revisar precio/valuación de las tomas pendientes y alinear con mercado.',
          'Priorizar exposición comercial (piso, digital, paquetes) en modelos con peor % de reventa.',
          'Asignar seguimiento a seminuevos con más días desde la toma.',
          'Usar el botón Detalle de Tomas a cuenta para bajar a VIN y responsable.',
        ];

    push(insights, {
      id: 'ventas-tomas-dificiles',
      kpiId: 'tomasInsightAnchor',
      module: 'ventas',
      severity,
      title,
      summary,
      analysis:
        analysisBase
        + (topModelos.length
          ? `Modelos con más fricción: ${topModelos.join('; ')}.`
          : 'Prioriza valuación, precio de lista y rotación de seminuevos.')
        + (topUnidades.length ? ` Unidades a vigilar: ${topUnidades.join(' | ')}.` : ''),
      recommendations,
      metrics: {
        tomasTotal,
        tomasVendidos,
        pendientes,
        tomasPct,
        modelosDificiles: modelosDificiles.slice(0, 5),
        unidadesDificiles: unidadesDificiles.slice(0, 5),
      },
      chatPrompt: chatPrompt('Ventas', 'Tomas difíciles de revender', [
        `Tomas periodo: ${tomasTotal}`,
        `Vendidas mismo mes: ${tomasVendidos}`,
        `Pendientes: ${pendientes}`,
        `% revendidas: ${tomasPct}%`,
        ...topModelos.map((l) => `Modelo difícil: ${l}`),
        ...topUnidades.map((l) => `Unidad: ${l}`),
        `Periodo: ${fi || '—'} — ${ff || '—'}`,
      ], 'Propón un plan de rotación para las tomas más difíciles (precio, canal, responsable) sin inventar VINs ni montos fuera de la lista.'),
    });
  }

  const carlinePayload = payload.utilidadCarline || {};
  const carlineRows = Array.isArray(carlinePayload.porCarline) ? carlinePayload.porCarline : [];
  if (carlinePayload.available !== false && carlineRows.length >= 2) {
    const parsed = carlineRows.map((c) => {
      const m = c.mejorVersion || {};
      const util = m.utilidadPromedio != null
        ? Number(m.utilidadPromedio)
        : (m.unidades > 0 && m.utilidadTotal != null
          ? Number(m.utilidadTotal) / Number(m.unidades)
          : null);
      return {
        carline: String(c.carline || '—').trim(),
        version: String(m.version || '—').trim(),
        util: Number.isFinite(util) ? util : null,
        mb: m.margenBrutoPct != null ? Number(m.margenBrutoPct) : null,
        unidades: Number(m.unidades ?? c.unidadesCarline ?? 0),
      };
    }).filter((c) => c.util != null);

    if (parsed.length >= 2) {
      const sorted = parsed.slice().sort((a, b) => b.util - a.util);
      const best = sorted[0];
      const worst = sorted[sorted.length - 1];
      const gap = round1(best.util - worst.util);
      const lowMb = parsed
        .filter((c) => c.mb != null && c.mb < 8)
        .sort((a, b) => a.mb - b.mb)
        .slice(0, 4);
      const negative = parsed.filter((c) => c.util < 0).slice(0, 4);

      let severity = 'info';
      let title = 'Oportunidad de utilidad por carline';
      let summary = `${best.carline} (${best.version}) lidera con ${round1(best.util)} util./ud.`;
      let analysis =
        `La mejor versión por utilidad unitaria es ${best.carline} · ${best.version} `
        + `(${round1(best.util)} por unidad`
        + (best.mb != null ? `, MB ${round1(best.mb)}%` : '')
        + `, ${best.unidades} uds). `;
      const recommendations = [
        `Priorizar stock y cierres en ${best.carline} (${best.version}).`,
        'Comparar descuentos/bonificaciones de carlines rezagados vs el líder.',
      ];

      if (negative.length) {
        severity = 'critical';
        title = 'Carlines con utilidad unitaria negativa';
        summary = `${negative.length} carline(s) con utilidad/ud negativa; el peor es ${worst.carline}.`;
        analysis +=
          `Hay versiones con utilidad por unidad en rojo: `
          + `${negative.map((c) => `${c.carline} ${round1(c.util)}`).join(', ')}. `
          + 'Señal de precio, mix o costo fuera de control en esas líneas.';
        recommendations.unshift(
          'Congelar descuentos agresivos en carlines con utilidad negativa.',
          'Revisar costo/bonificación de las versiones en rojo antes de seguir empujando volumen.',
        );
      } else if (lowMb.length >= 2 || (worst.mb != null && worst.mb < 8)) {
        severity = 'warning';
        title = 'Margen débil en carlines rezagados';
        summary = `${lowMb.length || 1} carline(s) con MB bajo 8%; gap líder vs peor: ${gap} util./ud.`;
        analysis +=
          `Carlines con margen bruto débil: `
          + `${(lowMb.length ? lowMb : [worst]).map((c) => `${c.carline} MB ${round1(c.mb)}%`).join(', ')}. `
          + `El spread vs el líder es ${gap} de utilidad por unidad.`;
        recommendations.push(
          'Empujar mix hacia versiones de mayor utilidad unitaria del líder.',
          'Auditar negociaciones en carlines con MB < 8%.',
        );
      } else if (gap >= 30000) {
        severity = 'warning';
        title = 'Gran brecha de utilidad entre carlines';
        summary = `Líder ${best.carline} vs peor ${worst.carline}: gap ${gap} util./ud.`;
        analysis +=
          `Hay una brecha amplia (${gap}) entre la mejor y la peor utilidad unitaria `
          + `(${worst.carline} · ${worst.version}: ${round1(worst.util)}). `
          + 'Conviene rebalancear inventario y foco comercial hacia el líder.';
        recommendations.push(
          `Reducir énfasis comercial en ${worst.carline} si el margen no mejora.`,
        );
      } else {
        analysis +=
          `El resto del catálogo está relativamente alineado (gap ${gap} util./ud). `
          + 'Usa el líder como referencia de precio y mix.';
        recommendations.push('Mantener seguimiento semanal del ranking de utilidad/ud.');
      }

      push(insights, {
        id: 'ventas-carline-utilidad',
        kpiId: 'carlineInsightAnchor',
        module: 'ventas',
        severity,
        title,
        summary,
        analysis,
        recommendations,
        metrics: {
          lider: best,
          peor: worst,
          gap,
          lowMb,
          negative,
          carlines: parsed.length,
        },
        chatPrompt: chatPrompt('Ventas', title, [
          `Líder: ${best.carline} · ${best.version} · util/ud ${round1(best.util)} · MB ${best.mb != null ? round1(best.mb) : '—'}% · ${best.unidades} uds`,
          `Peor: ${worst.carline} · ${worst.version} · util/ud ${round1(worst.util)} · MB ${worst.mb != null ? round1(worst.mb) : '—'}%`,
          `Gap util/ud: ${gap}`,
          ...lowMb.map((c) => `MB bajo: ${c.carline} ${round1(c.mb)}%`),
          ...negative.map((c) => `Util negativa: ${c.carline} ${round1(c.util)}`),
          `Periodo: ${fi || '—'} — ${ff || '—'}`,
        ], 'Propón acciones de mix, precio e inventario por carline usando solo estos datos.'),
      });
    }
  }

  try {
    const { buildDirectivoInsights } = require('./executiveRecommendationsService');
    const directivo = buildDirectivoInsights({
      fechaInicio: fi,
      fechaFin: ff,
      resumen: r,
      goals: { retail: goalRetail, sofia: goalSofia },
      utilidadCarline: payload.utilidadCarline || null,
      porModelo: r.porModelo || payload.porModelo || null,
    });
    for (const insight of directivo) push(insights, insight);
  } catch (err) {
    console.warn('[insights-ventas] directivo:', err.message);
  }

  return insights;
}

/* ───────────────── Contabilidad ───────────────── */

function buildContabilidadInsights(payload = {}) {
  const s = payload.summary || payload || {};
  const ventas = Number(s.ventasTotales ?? s.ventas ?? 0);
  const utilidadBruta = Number(s.utilidadBruta ?? 0);
  const utilidadOperacion = Number(s.utilidadOperacion ?? 0);
  const gastos = Number(s.gastosOperacion ?? 0);
  const costo = Number(s.costoVentas ?? 0);
  const margenBruto = Number(s.margenBrutoPct ?? (ventas ? (utilidadBruta / ventas) * 100 : 0));
  const margenOp = Number(s.margenOperacionPct ?? (ventas ? (utilidadOperacion / ventas) * 100 : 0));
  const pe = s.puntoEquilibrio != null ? Number(s.puntoEquilibrio) : null;
  const gastoPct = ventas > 0 ? round1((gastos / ventas) * 100) : null;
  const list = [];

  if (utilidadOperacion < 0) {
    push(list, {
      id: 'conta-utilidad-op',
      kpiId: 'kpiCardUtilidadOperacion',
      module: 'contabilidad',
      severity: 'critical',
      title: 'Pérdida de operación',
      summary: `Utilidad de operación negativa (${round1(utilidadOperacion)}).`,
      analysis:
        'Falla de rentabilidad operativa: utilidad bruta − gastos 0700 no cubre la estructura. Margen insuficiente o gastos sobredimensionados.',
      recommendations: [
        'Desglosar 0700 (nómina, comisiones, plan piso, rentas) y atacar las 3 mayores partidas.',
        'Revisar margen bruto por área antes de recortar a ciegas.',
        'Calcular unidades/ticket adicionales para volver a PE.',
      ],
      metrics: { utilidadOperacion, margenOp, ventas, gastos },
      chatPrompt: chatPrompt('Contabilidad', 'Pérdida de operación', [
        `Ventas: ${ventas}`, `UB: ${utilidadBruta} (${round1(margenBruto)}%)`,
        `Gastos: ${gastos}`, `UO: ${utilidadOperacion} (${round1(margenOp)}%)`,
      ], 'Aplica PE y apalancamiento operativo. Plan de 30 días.'),
    });
  } else if (margenOp < 5 && ventas > 0) {
    push(list, {
      id: 'conta-margen-op-bajo',
      kpiId: 'kpiCardUtilidadOperacion',
      module: 'contabilidad',
      severity: 'warning',
      title: 'Margen de operación estrecho',
      summary: `Margen de operación ${round1(margenOp)}% — poco colchón.`,
      analysis: 'Margen de operación bajo deja vulnerable a plan piso, comisiones o caídas de volumen.',
      recommendations: [
        'Monitorear gastos variables semanalmente.',
        'Empujar PVAs y postventa para mejorar contribución.',
      ],
      metrics: { margenOp, utilidadOperacion, ventas },
      chatPrompt: chatPrompt('Contabilidad', 'Margen de operación bajo', [
        `Margen op: ${round1(margenOp)}%`, `UO: ${utilidadOperacion}`, `Ventas: ${ventas}`,
      ]),
    });
  }

  if (margenBruto < 8 && ventas > 0) {
    push(list, {
      id: 'conta-margen-bruto',
      kpiId: 'kpiCardUtilidadBruta',
      module: 'contabilidad',
      severity: margenBruto < 0 ? 'critical' : 'warning',
      title: margenBruto < 0 ? 'Margen bruto negativo' : 'Margen bruto débil',
      summary: `Margen bruto ${round1(margenBruto)}% (UB ${round1(utilidadBruta)}).`,
      analysis:
        'Falla en precio/descuentos/mix/costo: sin margen bruto sano no se recupera con control de gastos 0700.',
      recommendations: [
        'Auditar bonificaciones vs utilidad por unidad.',
        'Revisar mix retail/flotilla y modelos de bajo margen.',
        'Contrastar costo 0600 vs remisión/plan piso mal clasificado.',
      ],
      metrics: { margenBruto, utilidadBruta, costo, ventas },
      chatPrompt: chatPrompt('Contabilidad', 'Margen bruto débil', [
        `Ventas: ${ventas}`, `Costo: ${costo}`, `UB: ${utilidadBruta}`, `MB: ${round1(margenBruto)}%`,
      ]),
    });
  }

  if (gastoPct != null && gastoPct >= 28) {
    push(list, {
      id: 'conta-gastos-altos',
      kpiId: 'kpiCardGastosOperacion',
      module: 'contabilidad',
      severity: gastoPct >= 40 ? 'critical' : 'warning',
      title: 'Gastos de operación elevados vs ventas',
      summary: `Gastos 0700 = ${gastoPct}% de las ventas.`,
      analysis: 'Estructura de gastos absorbe demasiada venta: falla típica al no ajustar gastos cuando cae el volumen.',
      recommendations: [
        'Separar gastos fijos vs variables y ajustar variables al ritmo de ventas.',
        'Revisar plan piso e intereses en 0700.',
      ],
      metrics: { gastos, ventas, gastoPct },
      chatPrompt: chatPrompt('Contabilidad', 'Gastos altos sobre ventas', [
        `Gastos: ${gastos}`, `Ventas: ${ventas}`, `Gastos/Ventas: ${gastoPct}%`,
      ]),
    });
  }

  if (pe != null && pe > 0 && ventas > 0 && ventas < pe) {
    push(list, {
      id: 'conta-bajo-pe',
      kpiId: 'kpiCardPuntoEquilibrio',
      module: 'contabilidad',
      severity: 'critical',
      title: 'Ventas por debajo del punto de equilibrio',
      summary: `Ventas ${round1(ventas)} < PE ${round1(pe)}.`,
      analysis: 'Con el margen actual no se cubren gastos 0700. Gap operativo real según saldos CON_CTAS.',
      recommendations: [
        `Cuantificar gap: ~${round1(pe - ventas)} de ventas (o equivalente en margen).`,
        'Subir margen (precio/mix) o bajar gastos fijos.',
      ],
      metrics: { ventas, puntoEquilibrio: pe, gap: pe - ventas, margenBruto },
      chatPrompt: chatPrompt('Contabilidad', 'Debajo del PE', [
        `Ventas: ${ventas}`, `PE: ${pe}`, `Gap: ${round1(pe - ventas)}`, `MB: ${round1(margenBruto)}%`,
      ]),
    });
  } else if (margenBruto <= 0 && pe == null) {
    push(list, {
      id: 'conta-pe-no-calculable',
      kpiId: 'kpiCardPuntoEquilibrio',
      module: 'contabilidad',
      severity: 'warning',
      title: 'Punto de equilibrio no calculable',
      summary: 'Margen bruto ≤ 0: no hay PE válido.',
      analysis: 'Sin margen bruto positivo el PE clásico no aplica: primero recuperar contribución.',
      recommendations: [
        'Atacar margen bruto antes que el control fino de fijos.',
        'Revisar clasificación 0600 vs 0700.',
      ],
      metrics: { margenBruto, gastos },
      chatPrompt: chatPrompt('Contabilidad', 'PE no calculable', [
        `MB: ${round1(margenBruto)}%`, `Gastos: ${gastos}`,
      ]),
    });
  }

  // Preferir la alerta del Detalle agencia (más rica) cuando viene en el payload
  const peBlock = payload.puntoEquilibrio || {};
  const peInsight = peBlock.insight;
  if (peInsight?.title) {
    push(list, {
      ...peInsight,
      id: peInsight.id || 'conta-pe-detalle-agencia',
      kpiId: 'kpiCardPuntoEquilibrio',
      module: 'contabilidad',
    });
  }

  pushAll(list, buildLiquidezInsights(payload));

  return list;
}

function moneyMx(n) {
  return Number(n || 0).toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function pushAll(list, items) {
  for (const item of items || []) push(list, item);
}

/**
 * Alertas de liquidez desde Balance General:
 * Capital de trabajo, razón circulante y prueba ácida.
 */
function buildLiquidezInsights(payload = {}) {
  const L = payload.liquidez || payload.summary?.liquidez || null;
  if (!L?.disponible) return [];

  const list = [];
  const fi = payload.fechaInicio || null;
  const ff = payload.fechaFin || null;
  const ac = Number(L.activoCirculante || 0);
  const pc = Number(L.pasivoCirculante || 0);
  const ct = Number(L.capitalTrabajo || 0);
  const razon = L.razonCirculante != null ? Number(L.razonCirculante) : null;
  const acida = L.pruebaAcida != null ? Number(L.pruebaAcida) : null;
  const efectivo = Number(L.efectivoYEquivalentes || 0);
  const cxc = Number(L.cuentasPorCobrar || 0);
  const rapidos = Number(L.activosRapidos || 0);
  const deficit = Number(L.deficitAcido || 0);
  const margenPct = L.margenSobreAcPct != null ? Number(L.margenSobreAcPct) : null;
  const band = L.interpretacion?.band || null;
  const periodo = `${fi || '—'} → ${ff || '—'}`;

  // Capital de trabajo
  if (ct < 0) {
    push(list, {
      id: 'bg-capital-trabajo-negativo',
      kpiId: 'kpiBgCapitalTrabajo',
      module: 'contabilidad',
      severity: 'critical',
      title: 'Capital de trabajo negativo',
      summary: `CT ${moneyMx(ct)}: el pasivo circulante supera al activo circulante.`,
      analysis:
        `Activo circulante ${moneyMx(ac)} − pasivo circulante ${moneyMx(pc)} = ${moneyMx(ct)}. `
        + 'No hay colchón de corto plazo: riesgo de presión de caja, proveedores o plan piso.',
      recommendations: [
        'Priorizar cobranza de CxC y liberar inventarios lentos.',
        'Revisar vencimientos de pasivo circulante (proveedores, IVA, créditos CP).',
        'Evitar nuevos compromisos de corto plazo sin fondeo asegurado.',
      ],
      metrics: { capitalTrabajo: ct, activoCirculante: ac, pasivoCirculante: pc },
      chatPrompt: chatPrompt('Contabilidad · Liquidez', 'Capital de trabajo negativo', [
        `Periodo / corte: ${periodo}`,
        `Activo circulante: ${moneyMx(ac)}`,
        `Pasivo circulante: ${moneyMx(pc)}`,
        `Capital de trabajo: ${moneyMx(ct)}`,
        `Razón circulante: ${razon ?? '—'}`,
        `Prueba ácida: ${acida ?? '—'}`,
      ]),
    });
  } else if (margenPct != null && margenPct < 10 && pc > 0) {
    push(list, {
      id: 'bg-capital-trabajo-ajustado',
      kpiId: 'kpiBgCapitalTrabajo',
      module: 'contabilidad',
      severity: 'warning',
      title: 'Capital de trabajo muy ajustado',
      summary: `CT ${moneyMx(ct)} (${round1(margenPct)}% del activo circulante).`,
      analysis:
        'Hay capital de trabajo positivo, pero el margen sobre el activo circulante es bajo (<10%). '
        + 'Cualquier retraso de cobranza o alza de pasivo CP puede volverlo negativo.',
      recommendations: [
        'Monitorear semanalmente AC vs PC.',
        'Acelerar rotación de inventarios y contratos en tránsito.',
        'Negociar plazos con proveedores críticos.',
      ],
      metrics: { capitalTrabajo: ct, margenSobreAcPct: margenPct, activoCirculante: ac, pasivoCirculante: pc },
      chatPrompt: chatPrompt('Contabilidad · Liquidez', 'Capital de trabajo ajustado', [
        `Periodo / corte: ${periodo}`,
        `CT: ${moneyMx(ct)}`,
        `Margen CT/AC: ${round1(margenPct)}%`,
        `AC: ${moneyMx(ac)}`,
        `PC: ${moneyMx(pc)}`,
      ]),
    });
  }

  // Razón circulante
  if (razon != null && razon < 1) {
    push(list, {
      id: 'bg-razon-insuficiente',
      kpiId: 'kpiBgRazonCirculante',
      module: 'contabilidad',
      severity: 'critical',
      title: 'Razón circulante insuficiente',
      summary: `Razón ${razon.toFixed(2)} (< 1.00): AC no cubre PC.`,
      analysis:
        (L.interpretacion?.summary || 'Los activos circulantes no alcanzan a cubrir el pasivo de corto plazo.')
        + ` AC ${moneyMx(ac)} / PC ${moneyMx(pc)}.`,
      recommendations: [
        'Elaborar plan de caja a 30/60/90 días.',
        'Reducir pasivo CP no esencial y priorizar cobros.',
        'Validar si hay partidas de inventario o CxC de difícil realización.',
      ],
      metrics: { razonCirculante: razon, band, activoCirculante: ac, pasivoCirculante: pc },
      chatPrompt: chatPrompt('Contabilidad · Liquidez', 'Razón circulante < 1', [
        `Periodo / corte: ${periodo}`,
        `Razón: ${razon.toFixed(2)}`,
        `AC: ${moneyMx(ac)}`,
        `PC: ${moneyMx(pc)}`,
        `Banda: ${band || '—'}`,
      ]),
    });
  } else if (razon != null && razon < 1.2) {
    push(list, {
      id: 'bg-razon-ajustada',
      kpiId: 'kpiBgRazonCirculante',
      module: 'contabilidad',
      severity: 'warning',
      title: 'Liquidez circulante muy ajustada',
      summary: `Razón ${razon.toFixed(2)} (banda 1.00–1.20).`,
      analysis:
        (L.interpretacion?.summary || 'Margen de seguridad bajo frente al pasivo circulante.')
        + ' Contablemente cubre, pero sin holgura operativa.',
      recommendations: [
        'No comprometer más pasivo CP hasta subir la razón > 1.20.',
        'Revisar mix de activo circulante (rápido vs inventarios).',
      ],
      metrics: { razonCirculante: razon, band, activoCirculante: ac, pasivoCirculante: pc },
      chatPrompt: chatPrompt('Contabilidad · Liquidez', 'Razón circulante ajustada', [
        `Periodo / corte: ${periodo}`,
        `Razón: ${razon.toFixed(2)}`,
        `AC: ${moneyMx(ac)}`,
        `PC: ${moneyMx(pc)}`,
      ]),
    });
  }

  // Prueba ácida
  if (acida != null && acida < 1) {
    push(list, {
      id: 'bg-prueba-acida-deficit',
      kpiId: 'kpiBgPruebaAcida',
      module: 'contabilidad',
      severity: 'critical',
      title: 'Prueba ácida en déficit',
      summary: `Ácida ${acida.toFixed(2)}: faltan ${moneyMx(Math.abs(deficit))} con caja/bancos/equiv. + CxC.`,
      analysis:
        `Numerador ${moneyMx(rapidos)} (caja/bancos/equiv. ${moneyMx(efectivo)} + CxC ${moneyMx(cxc)}) `
        + `no cubre el pasivo a corto plazo ${moneyMx(pc)}. `
        + 'Inventarios y anticipados no se cuentan como liquidez inmediata en esta prueba.',
      recommendations: [
        'Acelerar cobranza de CxC y vigilar cartera vencida.',
        'Revisar posición de caja/bancos y equivalentes antes de compromisos de corto plazo.',
        'Preparar fondeo o renegociación si el déficit ácido persiste.',
      ],
      metrics: {
        pruebaAcida: acida,
        deficitAcido: deficit,
        activosRapidos: rapidos,
        efectivoYEquivalentes: efectivo,
        cuentasPorCobrar: cxc,
        pasivoCirculante: pc,
      },
      chatPrompt: chatPrompt('Contabilidad · Liquidez', 'Prueba ácida < 1', [
        `Periodo / corte: ${periodo}`,
        `Prueba ácida: ${acida.toFixed(2)}`,
        `Caja+Bancos+Equiv.: ${moneyMx(efectivo)}`,
        `CxC: ${moneyMx(cxc)}`,
        `Numerador: ${moneyMx(rapidos)}`,
        `Pasivo a corto plazo: ${moneyMx(pc)}`,
        `Déficit ácido: ${moneyMx(deficit)}`,
        `Razón circulante: ${razon ?? '—'}`,
      ]),
    });
  } else if (acida != null && acida < 1.1) {
    push(list, {
      id: 'bg-prueba-acida-ajustada',
      kpiId: 'kpiBgPruebaAcida',
      module: 'contabilidad',
      severity: 'warning',
      title: 'Prueba ácida apenas suficiente',
      summary: `Ácida ${acida.toFixed(2)}: cubre PC con poco margen (caja/bancos/equiv. + CxC).`,
      analysis:
        'Con solo efectivo y CxC la cobertura es mínima. Un atraso de cobranza puede abrir déficit inmediato.',
      recommendations: [
        'Vigilar CxC vencidas y calidad de cartera.',
        'No depender de liquidar inventario para pagar pasivo a corto plazo.',
      ],
      metrics: {
        pruebaAcida: acida,
        activosRapidos: rapidos,
        efectivoYEquivalentes: efectivo,
        cuentasPorCobrar: cxc,
        pasivoCirculante: pc,
      },
      chatPrompt: chatPrompt('Contabilidad · Liquidez', 'Prueba ácida ajustada', [
        `Periodo / corte: ${periodo}`,
        `Prueba ácida: ${acida.toFixed(2)}`,
        `Numerador (efectivo+CxC): ${moneyMx(rapidos)}`,
        `PC: ${moneyMx(pc)}`,
      ]),
    });
  }

  return list;
}

/* ───────────────── Overview / Tablero ───────────────── */

function buildOverviewInsights(payload = {}) {
  const list = [];
  const fi = payload.fechaInicio;
  const ff = payload.fechaFin;
  const f = payload.financial || {};
  const ops = payload.operaciones || {};
  const sales = f.sales || {};
  const service = f.service || {};
  const inventory = f.inventory || {};
  const analytics = payload.analytics || payload.salesAnalytics || {};
  const r = analytics.rentabilidad || {};
  const fv = analytics.fuerzaVentas || {};
  const aging = analytics.aging || {};

  const unidades = Number(ops.unidadesVendidas ?? sales.units ?? 0);
  const sofia = Number(ops.entregasSofia ?? 0);
  const sinPreviasEnt = Number(ops.entregasSinPrevias ?? 0);
  const sinTimbrar = Number(ops.sinTimbrar ?? 0);
  const sinPreviasStock = Number(inventory.sinPrevias ?? 0);
  const available = Number(inventory.availableUnits ?? 0);
  const ageing = Number(inventory.ageingAlertsCount ?? 0);
  const planPiso = Number(inventory.planPisoTotal ?? 0);
  const avgDays = Number(inventory.avgDaysInventory ?? 0);
  const pctFact = Number(service.pctFacturado ?? 0);
  const ingresadas = Number(service.ingresadas ?? 0);
  const marginPct = Number(sales.marginPct ?? r.margenBrutoPct ?? 0);
  const bonifPct = Number(r.bonificacionesPctGanancia ?? 0);
  const regalos = Array.isArray(fv.ranking)
    ? fv.ranking.filter((v) => v.quadrant === 'regalo').length
    : Number(fv.regalos ?? 0);

  if (sofia > 0 && sinPreviasEnt / sofia >= 0.08) {
    const pct = round1((sinPreviasEnt / sofia) * 100);
    push(list, {
      id: 'ov-sin-previas-entrega',
      kpiId: 'ovOrdenesTaller',
      module: 'overview',
      severity: 'warning',
      title: 'Entregas SOFIA sin previa detectadas',
      summary: `${sinPreviasEnt} de ${sofia} entregas (${pct}%) sin previas.`,
      analysis: 'Falla de proceso de entrega: se entregan unidades sin órdenes de previa de taller. Revisar en Postventa / Inventario.',
      recommendations: [
        'Auditar el flujo previas → SOFIA en Ventas e Inventario.',
        'Bloquear entregas sin checklist de calidad.',
      ],
      metrics: { sinPreviasEnt, sofia, pct },
      chatPrompt: chatPrompt('Tablero ejecutivo', 'Entregas sin previa', [
        `Sin previa: ${sinPreviasEnt}`, `SOFIA: ${sofia}`, `Periodo: ${fi} — ${ff}`,
      ]),
    });
  }

  if (sinTimbrar >= 5) {
    push(list, {
      id: 'ov-sin-timbrar',
      kpiId: 'ovFacturacionTaller',
      module: 'overview',
      severity: 'warning',
      title: 'Facturas sin timbrar acumuladas',
      summary: `${sinTimbrar} unidades facturadas sin timbrar en el periodo.`,
      analysis: 'Falla fiscal/operativa: el backlog de timbrado retrasa cobertura y entregas.',
      recommendations: ['Priorizar cola de timbrado con sistemas/contabilidad.'],
      metrics: { sinTimbrar },
      chatPrompt: chatPrompt('Tablero ejecutivo', 'Sin timbrar', [`Sin timbrar: ${sinTimbrar}`, `Periodo: ${fi} — ${ff}`]),
    });
  }

  if (available > 0 && sinPreviasStock / available >= 0.25) {
    const pct = round1((sinPreviasStock / available) * 100);
    push(list, {
      id: 'ov-stock-sin-previas',
      kpiId: 'ovStockSinPrevias',
      module: 'overview',
      severity: 'warning',
      title: 'Inventario sin previas elevado',
      summary: `${sinPreviasStock} de ${available} disponibles (${pct}%) sin previas.`,
      analysis: 'Stock listo para venta/entrega sin preparación de taller: riesgo de entregas defectuosas y demoras.',
      recommendations: [
        'Programar previas masivas sobre unidades FIS/DIS sin órdenes S.',
        'Cruzar con módulo Inventario → Sin previas.',
      ],
      metrics: { sinPreviasStock, available, pct },
      chatPrompt: chatPrompt('Tablero ejecutivo', 'Stock sin previas', [
        `Sin previas: ${sinPreviasStock}`, `Disponibles: ${available}`, `Periodo: ${fi} — ${ff}`,
      ]),
    });
  }

  if (ageing >= 8 || (available > 0 && ageing / available >= 0.15)) {
    push(list, {
      id: 'ov-aging',
      kpiId: 'ovAging',
      module: 'overview',
      severity: ageing >= 15 ? 'critical' : 'warning',
      title: 'Antigüedad alta (60+ días)',
      summary: `${ageing} unidades con alerta de antigüedad; plan piso ${round1(planPiso)}.`,
      analysis:
        'Falla de rotación: unidades físicas +60 días generan interés de plan piso y presionan a vender con descuento.',
      recommendations: [
        'Activar plan de liquidación por antigüedad (precio/bono/transferencia).',
        'Revisar pedido a planta vs sell-through real.',
      ],
      metrics: { ageing, planPiso, avgDays, available },
      chatPrompt: chatPrompt('Tablero ejecutivo', 'Antigüedad 60+', [
        `Envejecidas: ${ageing}`, `Plan piso: ${planPiso}`, `Días prom.: ${avgDays}`, `Disponibles: ${available}`,
      ]),
    });
  }

  if (ingresadas >= 10 && pctFact < 55) {
    push(list, {
      id: 'ov-taller-fact',
      kpiId: 'ovFacturacionTaller',
      module: 'overview',
      severity: 'warning',
      title: 'Baja facturación de taller',
      summary: `Solo ${pctFact}% de ${ingresadas} órdenes facturadas.`,
      analysis: 'Posible falla de cierre de órdenes: trabajo hecho sin facturar o backlog de taller que no convierte a ingreso.',
      recommendations: [
        'Revisar órdenes abiertas antiguas en Postventa.',
        'Auditar promesas vencidas y críticas +60.',
      ],
      metrics: { pctFact, ingresadas },
      chatPrompt: chatPrompt('Tablero ejecutivo', 'Baja facturación taller', [
        `% facturado: ${pctFact}`, `Ingresadas: ${ingresadas}`, `Periodo: ${fi} — ${ff}`,
      ]),
    });
  }

  if (unidades >= 5 && marginPct > 0 && marginPct < 8) {
    push(list, {
      id: 'ov-margen',
      kpiId: 'ovUtilidadBruta',
      module: 'overview',
      severity: 'warning',
      title: 'Margen bruto de ventas débil',
      summary: `Margen ${round1(marginPct)}% sobre ${unidades} unidades.`,
      analysis: 'La utilidad del tablero sugiere presión de descuentos, mix o costo. Falla comercial de precio/negociación.',
      recommendations: [
        'Revisar impacto de bonificaciones en analytics del tablero.',
        'Comparar asesores alto volumen / bajo margen.',
      ],
      metrics: { marginPct, unidades, bonifPct },
      chatPrompt: chatPrompt('Tablero ejecutivo', 'Margen débil', [
        `Margen: ${round1(marginPct)}%`, `Unidades: ${unidades}`, `Bonif % utilidad: ${bonifPct}`,
      ]),
    });
  }

  if (bonifPct >= 25) {
    push(list, {
      id: 'ov-bonif',
      kpiId: 'ovUtilidadBruta',
      module: 'overview',
      severity: bonifPct >= 40 ? 'critical' : 'warning',
      title: 'Descuentos/bonificaciones erosionan utilidad',
      summary: `Bonificaciones = ${bonifPct}% de la utilidad bruta.`,
      analysis: 'Falla de disciplina comercial: el descuento se come la ganancia. Suele correlacionar con antigüedad alta o metas de volumen.',
      recommendations: [
        'Tope de descuento por modelo/asesor.',
        'Cruzar antigüedad al facturar vs bonificación promedio.',
      ],
      metrics: { bonifPct },
      chatPrompt: chatPrompt('Tablero ejecutivo', 'Bonificaciones altas', [
        `% bonif/utilidad: ${bonifPct}`, `Periodo: ${fi} — ${ff}`,
      ]),
    });
  }

  if (regalos >= 2) {
    push(list, {
      id: 'ov-asesores-regalo',
      kpiId: 'ovUnidades',
      module: 'overview',
      severity: 'warning',
      title: 'Asesores alto volumen · bajo margen',
      summary: `${regalos} asesor(es) en cuadrante “regalo”.`,
      analysis: 'Falla de fuerza de ventas: se vende por precio, no por valor. Distorsiona utilidad de la agencia.',
      recommendations: [
        'Coaching a asesores “regalo” con meta de margen mínimo.',
        'Revisar autorización de descuentos.',
      ],
      metrics: { regalos },
      chatPrompt: chatPrompt('Tablero ejecutivo', 'Asesores regalo', [
        `Asesores cuadrante regalo: ${regalos}`, `Periodo: ${fi} — ${ff}`,
      ]),
    });
  }

  if (aging.estancadosMayorDescuento) {
    push(list, {
      id: 'ov-aging-descuento',
      kpiId: 'ovAging',
      module: 'overview',
      severity: 'info',
      title: 'Estancados salen con más descuento',
      summary: 'Unidades +60 días al facturar muestran bonificaciones mayores.',
      analysis: 'Confirmado en analytics: el inventario parado se liquida regalando margen. Costo oculto de la antigüedad.',
      recommendations: [
        'Prevenir antigüedad alta (rotación) en lugar de “quemar” precio al final.',
        'Definir política de descuento máximo por días de stock.',
      ],
      metrics: { estancadosMayorDescuento: true },
      chatPrompt: chatPrompt('Tablero ejecutivo', 'Antigüedad + descuento', [
        'Estancados con mayor descuento: sí', `Periodo: ${fi} — ${ff}`,
      ]),
    });
  }

  const peInsight = payload.puntoEquilibrio?.insight;
  if (peInsight?.title) {
    push(list, {
      ...peInsight,
      id: peInsight.id || 'ov-pe-detalle-agencia',
      kpiId: 'kpiCardPuntoEquilibrio',
      module: 'overview',
    });
  }

  return list;
}

/* ───────────────── Inventario ───────────────── */

function buildInventoryInsights(payload = {}) {
  const list = [];
  const s = payload.summary || {};
  const total = Number(s.totalUnits ?? 0);
  const available = Number(s.available ?? s.availableUnits ?? 0);
  const sinPrevias = Number(s.sinPrevias ?? 0);
  const avgDays = Number(s.avgDaysAvailable ?? 0);
  const ageing = Number(s.ageingAlertsCount ?? s.urgentAlerts ?? 0);
  const planPiso = Number(s.planPisoTotal ?? 0);
  const planPisoUnits = Number(s.planPisoUnits ?? 0);
  const pv = payload.postventa || {};

  if (available > 0 && sinPrevias / available >= 0.2) {
    const pct = round1((sinPrevias / available) * 100);
    push(list, {
      id: 'inv-sin-previas',
      kpiId: 'kpiSinPrevias',
      module: 'inventory',
      severity: pct >= 40 ? 'critical' : 'warning',
      title: 'Muchas unidades disponibles sin previas',
      summary: `${sinPrevias} de ${available} disponibles (${pct}%) sin órdenes S.`,
      analysis:
        'Falla de preparación de inventario: VIN físicos/disponibles sin previa de taller no deberían entrar a flujo de entrega.',
      recommendations: [
        'Generar órdenes de previa masivas por prioridad de antigüedad.',
        'No apartar/entregar sin previas completadas.',
      ],
      responsable: 'Gerente Comercial Ventas',
      audiencia: ['Gerencia Comercial', 'Gerencia Ventas', 'CRM'],
      metrics: { sinPrevias, available, pct },
      chatPrompt: chatPrompt('Inventario', 'Sin previas en stock', [
        `Sin previas: ${sinPrevias}`, `Disponibles: ${available}`, `Total: ${total}`,
      ]),
    });
  }

  const entregasSinPrevias = Number(s.entregasSinPreviasSofia ?? payload.entregasSinPreviasSofia ?? 0);
  const entregasSofia = Number(s.entregasSofiaMes ?? payload.entregasSofiaMes ?? 0);
  if (entregasSofia > 0 && entregasSinPrevias / entregasSofia >= 0.08) {
    const pct = round1((entregasSinPrevias / entregasSofia) * 100);
    push(list, {
      id: 'inv-entregas-sin-previas',
      kpiId: 'kpiEntregasSinPrevias',
      module: 'inventory',
      severity: 'warning',
      title: 'Entregas SOFIA sin previa en el mes',
      summary: `${entregasSinPrevias} de ${entregasSofia} entregas (${pct}%) sin órdenes previas.`,
      analysis:
        'Se están entregando unidades reportadas en SOFIA sin previas de taller. Riesgo de calidad y reclamaciones.',
      recommendations: [
        'Revisar el listado de entregas sin previa del mes.',
        'No programar entrega sin checklist de previas.',
      ],
      responsable: 'Gerente Comercial Ventas',
      audiencia: ['Gerencia Comercial', 'Gerencia Ventas', 'CRM'],
      metrics: { entregasSinPrevias, entregasSofia, pct },
      chatPrompt: chatPrompt('Inventario', 'Entregas SOFIA sin previa', [
        `Sin previa: ${entregasSinPrevias}`, `SOFIA mes: ${entregasSofia}`, `Proporción: ${pct}%`,
      ]),
    });
  }

  if (ageing >= 5) {
    push(list, {
      id: 'inv-aging',
      kpiId: 'kpiAgeingAlerts',
      module: 'inventory',
      severity: ageing >= 12 ? 'critical' : 'warning',
      title: 'Antigüedad 60+',
      summary: `${ageing} unidades físicas con 60+ días; intereses asociados al plan piso.`,
      analysis: 'Falla de rotación de stock: cada día adicional eleva costo financiero (plan piso) y presión de descuento.',
      recommendations: [
        'Plan de salida por VIN (transferencia, promo, demo).',
        'Revisar pedido a planta vs días promedio de stock.',
      ],
      metrics: { ageing, planPiso, avgDays },
      chatPrompt: chatPrompt('Inventario', 'Antigüedad 60+', [
        `Envejecidas: ${ageing}`, `Plan piso: ${planPiso}`, `Días prom.: ${avgDays}`,
      ]),
    });
  }

  if (avgDays >= 45) {
    push(list, {
      id: 'inv-dias',
      kpiId: 'kpiDaysStock',
      module: 'inventory',
      severity: avgDays >= 70 ? 'critical' : 'warning',
      title: 'Días promedio de stock elevados',
      summary: `${avgDays} días promedio desde remisión.`,
      analysis: 'La rotación está lenta según fechas de remisión en SQL. Indica sobre-stock o demanda mal estimada.',
      recommendations: [
        'Ajustar forecast y pedido a planta.',
        'Priorizar modelos con más días en piso.',
      ],
      metrics: { avgDays },
      chatPrompt: chatPrompt('Inventario', 'Días promedio altos', [`Días prom.: ${avgDays}`, `Disponibles: ${available}`]),
    });
  }

  if (planPisoUnits >= 3 && planPiso > 0) {
    push(list, {
      id: 'inv-plan-piso',
      kpiId: 'kpiPlanPisoCard',
      module: 'inventory',
      severity: 'info',
      title: 'Carga de plan piso activa',
      summary: `${planPisoUnits} VIN con intereses acumulados ${round1(planPiso)}.`,
      analysis: 'Intereses de plan piso (dato Físico) son costo real por no rotar. Revisar si el periodo y VINs coinciden con la antigüedad.',
      recommendations: [
        'Atacar primero VINs con mayor interés acumulado.',
        'Validar que no haya unidades “olvidadas” en FIS.',
      ],
      metrics: { planPiso, planPisoUnits },
      chatPrompt: chatPrompt('Inventario', 'Plan piso', [
        `Intereses: ${planPiso}`, `VIN: ${planPisoUnits}`, `Periodo: ${s.planPisoPeriodLabel || payload.planPisoPeriod || '—'}`,
      ]),
    });
  }

  const pvTotal = Number(pv.totalCosto ?? 0);
  if (pvTotal > 0 && Number(pv.servicio?.lineas ?? 0) === 0 && Number(pv.refacciones?.lineas ?? 0) > 0) {
    push(list, {
      id: 'inv-pv-desbalance',
      kpiId: 'pvKpiTotal',
      module: 'inventory',
      severity: 'info',
      title: 'Postventa: stock sin proceso de servicio',
      summary: 'Hay costo en refacciones/HYP pero sin líneas de proceso servicio reportadas.',
      analysis: 'Posible desbalance o carga incompleta de inventario de postventa en la base.',
      recommendations: ['Validar sincronización de áreas servicio / refacciones / HYP.'],
      metrics: { pvTotal },
      chatPrompt: chatPrompt('Inventario postventa', 'Desbalance áreas', [`Costo total: ${pvTotal}`]),
    });
  }

  const pvRef = pv.refacciones || {};
  const pvTras = pv.traspasos || {};
  const pvTrasPiezas = Number(pvTras.piezas ?? 0);
  const pvTrasPartes = Number(pvTras.partes ?? 0);
  if (pvTrasPiezas > 0) {
    push(list, {
      id: 'inv-pv-traspasos',
      kpiId: 'pvKpiTraspasosPiezas',
      module: 'inventory',
      severity: pvTrasPiezas >= 5000 ? 'warning' : 'info',
      title: 'Refacciones: traspasos entre almacenes',
      summary: `${pvTrasPiezas.toLocaleString('es-MX')} pzas movidas · ${pvTrasPartes} partes · ${Number(pvTras.documentos || 0)} docs`,
      analysis:
        'Hay flujo interno DE almacén A almacén (Body 31, Zacatelco, Cholula, GEN). '
        + 'Si crece sin ventas asociadas, puede indicar reposición reactiva o stock duplicado.',
      recommendations: [
        'Revisar rutas top de traspaso en Inventario → Postventa → Refacciones.',
        'Cruzar partes más traspasadas vs stock trabado y ventas del periodo.',
      ],
      metrics: { piezas: pvTrasPiezas, partes: pvTrasPartes, documentos: Number(pvTras.documentos || 0), costo: Number(pvTras.costo || 0) },
      chatPrompt: chatPrompt('Inventario refacciones', 'Traspasos entre almacenes', [
        `Piezas: ${pvTrasPiezas}`, `Partes: ${pvTrasPartes}`, `Costo: ${pvTras.costo || 0}`,
      ]),
    });
  }

  const pvRefCosto = Number(pvRef.costo ?? 0);
  const pvRefLineas = Number(pvRef.lineas ?? 0);
  if (pvRefCosto >= 1_000_000) {
    push(list, {
      id: 'inv-pv-refacciones-valor',
      kpiId: 'pvKpiRefacciones',
      module: 'inventory',
      severity: 'info',
      title: 'Inventario de refacciones con valuación alta',
      summary: `${pvRefLineas.toLocaleString('es-MX')} líneas · $${pvRefCosto.toLocaleString('es-MX')}`,
      analysis: 'El capital en refacciones es material; conviene vigilar rotación, min/max y traspasos.',
      recommendations: [
        'Priorizar alertas de stock trabado y bajo mínimo.',
        'Usar traspasos para equilibrar GEN vs sucursales antes de recomprar.',
      ],
      metrics: { lineas: pvRefLineas, costo: pvRefCosto, existencia: Number(pvRef.existencia || 0) },
      chatPrompt: chatPrompt('Inventario refacciones', 'Valuación stock', [
        `Líneas: ${pvRefLineas}`, `Costo: ${pvRefCosto}`,
      ]),
    });
  }

  // Unidades vendidas (análisis DMS del mes en Gestión de Inventario).
  const vend = payload.vendidos || {};
  const vendUnidades = Number(vend.unidades ?? 0);
  const vendNeta = Number(vend.utilidadNetaTotal ?? 0);
  const vendNetaProm = vend.utilidadNetaPromedio != null ? Number(vend.utilidadNetaPromedio) : null;
  const vendBruta = Number(vend.utilidadBrutaTotal ?? 0);
  const vendFi = Number(vend.ingresoFiTotal ?? 0);
  const vendSinFi = Number(vend.sinIngresoFi ?? 0);
  const vendNetaNeg = Number(vend.conNetaNegativa ?? 0);
  const vendMenudeo = Number(vend.menudeo ?? 0);
  const vendFlotilla = Number(vend.flotilla ?? 0);
  const vendPeriodo = vend.periodoLabel || `${vend.fechaInicio || '—'} — ${vend.fechaFin || '—'}`;
  const peores = Array.isArray(vend.peoresNeta) ? vend.peoresNeta.slice(0, 5) : [];
  const nowDay = new Date().getDate();

  if (vend.available !== false && vendUnidades === 0 && nowDay >= 5) {
    push(list, {
      id: 'inv-vendidos-cero',
      kpiId: 'autosVendidosInsightsCard',
      module: 'inventory',
      severity: nowDay >= 12 ? 'critical' : 'warning',
      title: 'Sin unidades vendidas en el mes',
      summary: `0 ventas registradas en ${vendPeriodo}.`,
      analysis:
        'El análisis de autos vendidos del DMS no muestra facturas en el periodo. '
        + 'Revisa ritmo comercial, facturación pendiente o el mes seleccionado.',
      recommendations: [
        'Confirmar el mes en Análisis de autos vendidos.',
        'Cruzar con Ventas (retail/flotilla) y entregas SOFIA.',
        'Revisar pipeline de cierres y unidades apartadas (SEP).',
      ],
      metrics: { unidades: 0, periodo: vendPeriodo },
      chatPrompt: chatPrompt('Inventario', 'Sin unidades vendidas', [
        `Periodo: ${vendPeriodo}`,
        `Día del mes: ${nowDay}`,
      ]),
    });
  } else if (vendUnidades > 0) {
    const pctSinFi = round1((vendSinFi / vendUnidades) * 100);
    const pctNetaNeg = round1((vendNetaNeg / vendUnidades) * 100);
    let severity = 'info';
    let title = 'Unidades vendidas del periodo';
    if (vendNetaNeg >= 3 || pctNetaNeg >= 25) {
      severity = vendNetaNeg >= 5 || pctNetaNeg >= 40 ? 'critical' : 'warning';
      title = 'Ventas con utilidad neta en riesgo';
    } else if (pctSinFi >= 50 && vendUnidades >= 3) {
      severity = 'warning';
      title = 'Muchas ventas sin ingreso F&I';
    }

    push(list, {
      id: 'inv-vendidos-resumen',
      kpiId: 'autosVendidosInsightsCard',
      module: 'inventory',
      severity,
      title,
      summary:
        `${vendUnidades} unidad(es) · utilidad neta ${round1(vendNeta)}`
        + (vendFi > 0 ? ` · F&I ${round1(vendFi)}` : ' · sin F&I en PAGOS GMF')
        + '.',
      analysis:
        `En ${vendPeriodo}: menudeo ${vendMenudeo}, flotilla ${vendFlotilla}. `
        + `Utilidad bruta ${round1(vendBruta)}`
        + (vendNetaProm != null ? `; neta promedio ${round1(vendNetaProm)}/ud` : '')
        + '. '
        + (vendNetaNeg > 0
          ? `${vendNetaNeg} unidad(es) (${pctNetaNeg}%) con utilidad neta negativa`
            + (peores.length
              ? ` — revisar: ${peores.map((p) => `${p.vin || '—'} (${round1(p.utilidadNeta)})`).join('; ')}.`
              : '.')
          : 'Ninguna unidad con neta negativa. ')
        + (vendSinFi > 0
          ? ` ${vendSinFi} (${pctSinFi}%) sin pagos GMF asociados al VIN/contrato.`
          : ' Todas con ingreso F&I en PAGOS GMF.'),
      recommendations: [
        'Abrir Análisis de autos vendidos y filtrar carlines con peor retención.',
        vendNetaNeg > 0
          ? 'Revisar extras, plan piso y comisión E.V. en VINs con neta negativa.'
          : 'Mantener control de gastos extra y plan piso en el mes.',
        vendSinFi > 0
          ? 'Cruzar VINs sin F&I con PAGOS GMF y contratos del histórico.'
          : 'Cuadrar ingreso F&I con comisiones del periodo.',
      ],
      metrics: {
        unidades: vendUnidades,
        utilidadNetaTotal: vendNeta,
        utilidadNetaPromedio: vendNetaProm,
        utilidadBrutaTotal: vendBruta,
        ingresoFiTotal: vendFi,
        sinIngresoFi: vendSinFi,
        conNetaNegativa: vendNetaNeg,
        menudeo: vendMenudeo,
        flotilla: vendFlotilla,
        peores,
      },
      chatPrompt: chatPrompt('Inventario', 'Unidades vendidas', [
        `Periodo: ${vendPeriodo}`,
        `Unidades: ${vendUnidades}`,
        `Menudeo: ${vendMenudeo}`,
        `Flotilla: ${vendFlotilla}`,
        `Utilidad bruta: ${vendBruta}`,
        `Utilidad neta: ${vendNeta}`,
        `Neta promedio: ${vendNetaProm ?? '—'}`,
        `Ingreso F&I: ${vendFi}`,
        `Sin F&I: ${vendSinFi} (${pctSinFi}%)`,
        `Neta negativa: ${vendNetaNeg} (${pctNetaNeg}%)`,
        ...peores.map((p) => `VIN ${p.vin}: neta ${p.utilidadNeta} · ${p.carline || ''}`),
      ]),
    });
  }

  return list;
}

/* ───────────────── Forecast ───────────────── */

function buildForecastInsights(payload = {}) {
  const list = [];
  const k = payload.kpis || {};
  const mape = k.mape != null ? Number(k.mape) : null;
  const varPct = k.variationPct != null ? Number(k.variationPct) : null;
  const last = Number(k.lastMonthUnits ?? 0);
  const next = Number(k.nextMonthUnits ?? 0);

  if (mape != null && mape >= 25) {
    push(list, {
      id: 'fc-mape',
      kpiId: 'kpiMape',
      module: 'forecast',
      severity: mape >= 40 ? 'critical' : 'warning',
      title: 'Error de pronóstico elevado (MAPE)',
      summary: `MAPE ${mape}% — el modelo se desvía mucho de lo real.`,
      analysis:
        'Falla de predicción: con MAPE alto, planificar pedido/metas con este forecast puede sobre o sub-stockear. Revisar estacionalidad, flotilla o meses incompletos.',
      recommendations: [
        'No usar el horizonte largo para pedido a planta sin ajuste gerencial.',
        'Revisar si hay meses atípicos (flotilla, cierres) en el histórico SQL.',
      ],
      metrics: { mape, last, next },
      chatPrompt: chatPrompt('Forecast', 'MAPE alto', [
        `MAPE: ${mape}%`, `Último mes: ${last}`, `Próximo: ${next}`, `Fuente: ${payload.dataSource || 'SQL'}`,
      ]),
    });
  }

  if (varPct != null && varPct <= -15) {
    push(list, {
      id: 'fc-caida',
      kpiId: 'kpiLast',
      module: 'forecast',
      severity: 'warning',
      title: 'Último mes real muy por debajo del promedio',
      summary: `Variación ${varPct}% vs promedio 12 meses.`,
      analysis: 'Señal de deterioro comercial reciente en ventas facturadas (SQL). Puede sesgar el forecast a la baja o indicar falla estructural.',
      recommendations: [
        'Contrastar con Ventas YTD y leads del CRM.',
        'Separar retail vs flotilla en el análisis del mes.',
      ],
      metrics: { varPct, last },
      chatPrompt: chatPrompt('Forecast', 'Caída vs promedio 12m', [
        `Variación: ${varPct}%`, `Último mes: ${last}`,
      ]),
    });
  }

  if (last > 0 && next > 0 && next < last * 0.75) {
    const drop = round1((1 - next / last) * 100);
    push(list, {
      id: 'fc-prox-caida',
      kpiId: 'kpiNext',
      module: 'forecast',
      severity: 'info',
      title: 'Pronóstico del próximo mes a la baja',
      summary: `Proyecta ${next} vs ${last} del último real (−${drop}%).`,
      analysis: 'El modelo anticipa caída. Si no hay plan comercial compensatorio, se materializa menor rotación e inventario parado.',
      recommendations: [
        'Definir acciones comerciales del mes entrante antes de aceptar la baja.',
        'Ajustar pedido a planta al escenario conservador.',
      ],
      metrics: { last, next, drop },
      chatPrompt: chatPrompt('Forecast', 'Próximo mes a la baja', [
        `Último: ${last}`, `Próximo: ${next}`, `Caída: ${drop}%`,
      ]),
    });
  }

  return list;
}

/* ───────────────── Postventa ───────────────── */

function buildPostSalesInsights(payload = {}) {
  const list = [];
  const s = payload.summary || {};
  const a = payload.aging || {};
  const r = payload.risk || {};
  const fi = payload.fechaInicio;
  const ff = payload.fechaFin;

  const total = Number(s.totalOrdenes ?? 0);
  const facturadas = Number(s.facturadas ?? 0);
  const abiertas = Number(s.abiertas ?? 0);
  const pctFact = Number(s.pctFacturado ?? 0);
  const pctImp = Number(s.pctImporteFacturado ?? 0);
  const riesgo120 = Number(s.riesgo120 ?? 0);
  const crecimiento = Number(s.crecimientoFacturado ?? 0);
  const criticas = Number(r.criticas60 ?? 0);
  const conRefacciones = Number(r.conRefacciones ?? 0);
  const promesas = Number(r.promesasVencidas ?? 0);
  const sinPromesa = Number(r.abiertasSinPromesa ?? 0);
  const b120 = Number(a.b120p ?? 0);
  const b91 = Number(a.b91_120 ?? 0);
  const sinImporte = Number(r.sinImporte ?? 0);
  const sinFecha = Number(r.sinFechaIngreso ?? 0);

  if (total >= 15 && pctFact < 50) {
    push(list, {
      id: 'ps-tasa-fact',
      kpiId: 'psImporteFacturado',
      module: 'post-sales',
      severity: pctFact < 35 ? 'critical' : 'warning',
      title: 'Tasa de facturación de órdenes baja',
      summary: `${pctFact}% de órdenes facturadas (${facturadas}/${total}).`,
      analysis:
        'Falla de cierre de taller: muchas órdenes ingresan y no se facturan. Puede ser trabajo incompleto, falta de refacciones o mala disciplina de cierre.',
      recommendations: [
        'Filtrar abiertas +60 y promesas vencidas.',
        'Reunión diaria de piso: órdenes listas sin factura.',
      ],
      metrics: { pctFact, facturadas, total },
      chatPrompt: chatPrompt('Postventa', 'Tasa facturación baja', [
        `% órdenes facturadas: ${pctFact}`, `Facturadas: ${facturadas}`, `Total: ${total}`, `Periodo: ${fi} — ${ff}`,
      ]),
    });
  }

  if (pctImp > 0 && pctImp < 45 && Number(s.importeIngresado || 0) > 0) {
    push(list, {
      id: 'ps-imp-fact',
      kpiId: 'psTasaFacturacion',
      module: 'post-sales',
      severity: 'warning',
      title: 'Poco importe convertido a factura',
      summary: `Solo ${pctImp}% del importe ingresado está facturado.`,
      analysis: 'El dinero potencial del taller no se está formalizando. Falla de facturación o de avance de órdenes de alto ticket.',
      recommendations: [
        'Priorizar órdenes abiertas de mayor importe.',
        'Revisar aseguradoras con mayor backlog.',
      ],
      metrics: { pctImp, importeFacturado: s.importeFacturado, importeIngresado: s.importeIngresado },
      chatPrompt: chatPrompt('Postventa', 'Importe facturado bajo', [
        `% importe facturado: ${pctImp}`, `Facturado: ${s.importeFacturado}`, `Ingresado: ${s.importeIngresado}`,
      ]),
    });
  }

  // Órdenes abiertas +120: alerta desde la primera (tarjeta de conteo y de riesgo $)
  if (b120 >= 1 || riesgo120 > 0) {
    const count = Math.max(b120, riesgo120 > 0 && b120 === 0 ? 1 : b120);
    const severity = count >= 5 || riesgo120 >= 100000 ? 'critical' : 'warning';
    const title = count >= 5 || riesgo120 >= 100000
      ? 'Órdenes abiertas críticas +120 días'
      : 'Órdenes abiertas con +120 días';
    const summary = b120 > 0
      ? `${b120} orden(es) abierta(s) con +120 días · importe en riesgo ${round1(riesgo120)}.`
      : `Importe en riesgo +120 días: ${round1(riesgo120)} (revisar backlog de abiertas).`;
    const analysis =
      'Hay órdenes abiertas envejecidas más de 120 días en el snapshot de taller. '
      + 'Es una falla de seguimiento: cliente, refacciones, autorización de seguro o cierre/factura pendiente. '
      + 'Cada día adicional eleva el riesgo de no cobro y mala experiencia.';
    const recommendations = [
      'Abrir el listado de órdenes críticas / filtrar antigüedad +120.',
      'Asignar dueño por orden y fecha compromiso de cierre o factura.',
      'Cerrar, cancelar con causa documentada o facturar en máximo 7 días.',
    ];
    const metrics = { riesgo120, b120, count };
    const prompt = chatPrompt('Postventa', title, [
      `Órdenes +120: ${b120}`,
      `Importe riesgo: ${riesgo120}`,
      `Abiertas totales: ${abiertas}`,
      `Periodo consulta: ${fi || '—'} — ${ff || '—'}`,
    ]);

    push(list, {
      id: 'ps-aging120',
      kpiId: 'psAging120',
      module: 'post-sales',
      severity,
      title,
      summary,
      analysis,
      recommendations,
      metrics,
      chatPrompt: prompt,
    });
    push(list, {
      id: 'ps-riesgo120',
      kpiId: 'psRiesgo120',
      module: 'post-sales',
      severity,
      title: riesgo120 > 0 ? 'Riesgo económico en órdenes +120 días' : title,
      summary,
      analysis,
      recommendations,
      metrics,
      chatPrompt: prompt,
    });
  }

  if (b91 >= 5 && b120 === 0) {
    push(list, {
      id: 'ps-aging91',
      kpiId: 'psAging91',
      module: 'post-sales',
      severity: 'info',
      title: 'Órdenes acercándose a +120 días',
      summary: `${b91} órdenes en bucket 91–120 días (aún no +120).`,
      analysis:
        'Si no se cierran pronto, pasarán a +120 y al riesgo crítico. Es la ventana para prevenir el envejecimiento.',
      recommendations: [
        'Priorizar el bucket 91–120 antes de que cruce a +120.',
        'Revisar promesas y refacciones pendientes de esas órdenes.',
      ],
      metrics: { b91 },
      chatPrompt: chatPrompt('Postventa', 'Bucket 91–120', [
        `Órdenes 91–120: ${b91}`, `Periodo: ${fi} — ${ff}`,
      ]),
    });
  }

  if (conRefacciones >= 10) {
    push(list, {
      id: 'ps-con-refacciones',
      kpiId: 'psConRefacciones',
      module: 'post-sales',
      severity: conRefacciones >= 40 ? 'warning' : 'info',
      title: 'Órdenes abiertas con refacciones cargadas',
      summary: `${conRefacciones} abiertas ya tienen líneas de refacciones (RE).`,
      analysis:
        'Hay trabajo con partes cargadas en taller. Priorizar surtido, autorización y avance para evitar que se queden abiertas con inventario comprometido.',
      recommendations: [
        'Revisar surtido pendiente por asesor.',
        'Cerrar o facturar órdenes con refacciones completas.',
      ],
      metrics: { conRefacciones, criticas },
      chatPrompt: chatPrompt('Postventa', 'Con refacciones', [
        `Con refacciones: ${conRefacciones}`,
        `Abiertas: ${abiertas}`,
        `Críticas +60: ${criticas}`,
      ]),
    });
  }

  if (promesas >= 5) {
    push(list, {
      id: 'ps-promesas',
      kpiId: 'psPromesasVencidas',
      module: 'post-sales',
      severity: 'warning',
      title: 'Promesas de entrega vencidas',
      summary: `${promesas} promesas vencidas sin cumplir.`,
      analysis: 'Falla de compromiso con el cliente: fechas de promesa no se cumplen ni se reprograman en el sistema.',
      recommendations: [
        'Actualizar promesas o contactar cliente hoy.',
        'Medir asesores por % promesas cumplidas.',
      ],
      metrics: { promesas },
      chatPrompt: chatPrompt('Postventa', 'Promesas vencidas', [`Promesas vencidas: ${promesas}`]),
    });
  }

  if (abiertas >= 10 && sinPromesa / abiertas >= 0.35) {
    const pct = round1((sinPromesa / abiertas) * 100);
    push(list, {
      id: 'ps-sin-promesa',
      kpiId: 'psSinPromesa',
      module: 'post-sales',
      severity: 'warning',
      title: 'Abiertas sin fecha promesa',
      summary: `${sinPromesa} de ${abiertas} abiertas (${pct}%) sin promesa.`,
      analysis: 'Falla de captura/disciplina: sin promesa no hay control de SLA ni visibilidad para el cliente.',
      recommendations: ['Obligar captura de promesa al abrir/actualizar la orden.'],
      metrics: { sinPromesa, abiertas, pct },
      chatPrompt: chatPrompt('Postventa', 'Sin promesa', [
        `Sin promesa: ${sinPromesa}`, `Abiertas: ${abiertas}`,
      ]),
    });
  }

  if (s.tieneMesAnterior && crecimiento <= -10) {
    push(list, {
      id: 'ps-crecimiento',
      kpiId: 'psCrecimiento',
      module: 'post-sales',
      severity: 'warning',
      title: 'Caída de facturación vs mes anterior',
      summary: `Crecimiento ${crecimiento}%.`,
      analysis: 'La facturación de taller retrocede vs el mes previo en los datos del periodo. Revisar capacidad, mix o cierre de órdenes.',
      recommendations: [
        'Comparar volumen ingresado vs facturado mes a mes.',
        'Revisar si subió el backlog abierto.',
      ],
      metrics: { crecimiento },
      chatPrompt: chatPrompt('Postventa', 'Caída facturado MoM', [
        `Crecimiento: ${crecimiento}%`, `Facturado: ${s.importeFacturado}`,
      ]),
    });
  }

  if (sinImporte >= 8 || sinFecha >= 5) {
    push(list, {
      id: 'ps-calidad-datos',
      kpiId: 'psSinImporte',
      module: 'post-sales',
      severity: 'info',
      title: 'Calidad de datos de órdenes deficiente',
      summary: `${sinImporte} sin importe · ${sinFecha} sin fecha ingreso.`,
      analysis: 'Falla de captura en DMS/SQL: métricas y antigüedad se distorsionan si faltan importe o fecha.',
      recommendations: [
        'Corregir órdenes sin fecha/importe en el taller.',
        'Capacitar captura obligatoria al ingreso.',
      ],
      metrics: { sinImporte, sinFecha },
      chatPrompt: chatPrompt('Postventa', 'Datos incompletos', [
        `Sin importe: ${sinImporte}`, `Sin fecha: ${sinFecha}`,
      ]),
    });
  }

  return list;
}

/* ───────────────── Seguimiento 360 ───────────────── */

function buildSeguimientoInsights(payload = {}) {
  const list = [];
  const vista = String(payload.vista || '').toLowerCase();

  if (vista === 'vendedor') {
    const tot = payload.totales || {};
    const com = payload.comercial || {};
    const fin = com.financiamiento || {};
    const pvas = fin.pvas || {};
    const retorno = com.retornoTaller || {};
    const libro = Number(com.libroVentas?.unidades ?? com.libroVentas?.sql?.unidades ?? 0);
    const leads = Number(tot.leads ?? 0);
    const solicitudes = Number(tot.solicitudes ?? 0);
    const pruebas = Number(tot.pruebas ?? 0);
    const contratos = Number(fin.contratos ?? 0);
    const retornoPct = retorno.tasaRetornoPct != null ? Number(retorno.tasaRetornoPct) : null;
    const pvaProm = pvas.promedioCantidadPvas != null ? Number(pvas.promedioCantidadPvas) : null;
    const penetPva = pvas.penetracionPct != null ? Number(pvas.penetracionPct) : null;

    if (leads >= 10 && libro === 0) {
      push(list, {
        id: 'seg-vend-sin-cierre',
        kpiId: 'kVendLibro',
        module: 'seguimiento',
        severity: 'warning',
        title: 'Leads sin unidades vendidas (libro)',
        summary: `${leads} leads y 0 unidades en ADE_VTAFI en el periodo.`,
        analysis: 'Falla de conversión del vendedor: hay actividad de entrada sin cierre facturado en el DMS.',
        recommendations: [
          'Revisar ciclos abiertos y pruebas sin solicitud.',
          'Priorizar prospectos calientes del listado del vendedor.',
        ],
        metrics: { leads, libro, solicitudes, pruebas },
        chatPrompt: chatPrompt('Seguimiento 360 · vendedor', 'Leads sin cierre', [
          `Vendedor: ${payload.vendedor || '—'}`, `Leads: ${leads}`, `Libro: ${libro}`,
          `Solicitudes: ${solicitudes}`, `Pruebas: ${pruebas}`,
        ]),
      });
    }

    if (pruebas >= 5 && solicitudes === 0) {
      push(list, {
        id: 'seg-vend-prueba-sin-fi',
        kpiId: 'kVendPruebas',
        module: 'seguimiento',
        severity: 'warning',
        title: 'Pruebas de manejo sin solicitudes F&I',
        summary: `${pruebas} pruebas y 0 solicitudes F&I.`,
        analysis: 'Falla de embudo: la prueba no se conecta con financiamiento; se pierde oportunidad de cierre y PVAs.',
        recommendations: [
          'Protocolo post-prueba: agendar F&I el mismo día.',
          'Medir conversión prueba → solicitud por asesor.',
        ],
        metrics: { pruebas, solicitudes },
        chatPrompt: chatPrompt('Seguimiento 360 · vendedor', 'Prueba sin F&I', [
          `Pruebas: ${pruebas}`, `Solicitudes: ${solicitudes}`, `Vendedor: ${payload.vendedor || '—'}`,
        ]),
      });
    }

    if (libro >= 3 && contratos === 0) {
      push(list, {
        id: 'seg-vend-sin-fi',
        kpiId: 'kVendContratos',
        module: 'seguimiento',
        severity: 'info',
        title: 'Ventas sin contratos F&I vinculados',
        summary: `${libro} unidades vendidas y 0 contratos F&I match.`,
        analysis: 'Posible falla de colocación F&I o de match asesor/VIN en la base. Se deja margen de financiamiento sobre la mesa.',
        recommendations: [
          'Validar match de asesor F&I vs cartera.',
          'Revisar penetración crédito vs contado.',
        ],
        metrics: { libro, contratos },
        chatPrompt: chatPrompt('Seguimiento 360 · vendedor', 'Sin contratos F&I', [
          `Libro: ${libro}`, `Contratos: ${contratos}`,
        ]),
      });
    }

    if (contratos >= 3 && ((pvaProm != null && pvaProm < 0.5) || (penetPva != null && penetPva < 30))) {
      push(list, {
        id: 'seg-vend-pvas',
        kpiId: 'kVendPvas',
        module: 'seguimiento',
        severity: 'warning',
        title: 'Baja colocación de PVAs',
        summary: `Promedio PVAs ${pvaProm ?? '—'} · penetración ${penetPva ?? '—'}%.`,
        analysis: 'Falla de upselling F&I: los contratos no cargan productos de valor agregado (PVAs).',
        recommendations: [
          'Checklist de oferta de PVAs en cada contrato.',
          'Comparar vs promedio de la agencia.',
        ],
        metrics: { pvaProm, penetPva, contratos },
        chatPrompt: chatPrompt('Seguimiento 360 · vendedor', 'PVAs bajos', [
          `Promedio PVAs: ${pvaProm}`, `Penetración: ${penetPva}%`, `Contratos: ${contratos}`,
        ]),
      });
    }

    if (retornoPct != null && Number(retorno.clientesConCompra || retorno.vinsCartera || 0) >= 5 && retornoPct < 25) {
      push(list, {
        id: 'seg-vend-retorno',
        kpiId: 'kVendRetorno',
        module: 'seguimiento',
        severity: 'warning',
        title: 'Bajo retorno a taller post-venta',
        summary: `Tasa de retorno ${retornoPct}%.`,
        analysis:
          'Clientes con compra no regresan al taller: falla de retención/postventa (cita de servicio, garantía, CRM).',
        recommendations: [
          'Activar campaña de servicio a cartera del vendedor.',
          'Verificar citas de 1ª revisión al entregar.',
        ],
        metrics: { retornoPct, ...retorno },
        chatPrompt: chatPrompt('Seguimiento 360 · vendedor', 'Retorno taller bajo', [
          `Retorno: ${retornoPct}%`,
          `Base: ${retorno.base || '—'}`,
          `Con taller: ${retorno.clientesConTaller ?? retorno.vinsConTaller}`,
          `Cartera: ${retorno.clientesConCompra ?? retorno.vinsCartera}`,
        ]),
      });
    }
  }

  if (vista === 'cierres') {
    const tot = payload.totales || {};
    const ordenes = Number(tot.ordenesCerradas ?? 0);
    const clientes = Number(tot.clientes ?? 0);
    const conCrm = Number(tot.clientesConIdCrm ?? 0);
    if (clientes >= 5 && conCrm / clientes < 0.5) {
      const pct = round1((conCrm / clientes) * 100);
      push(list, {
        id: 'seg-cierres-crm',
        kpiId: 'kCierreCrm',
        module: 'seguimiento',
        severity: 'warning',
        title: 'Cierres de taller sin ID CRM',
        summary: `Solo ${pct}% de clientes de cierre tienen ID CRM (${conCrm}/${clientes}).`,
        analysis:
          'Falla de integración CRM↔taller: no se puede hacer 360 ni medir retorno real si el cierre no trae ID CRM.',
        recommendations: [
          'Obligar captura de ID CRM al cerrar orden.',
          'Depurar clientes “Sin ID CRM” del periodo.',
        ],
        metrics: { ordenes, clientes, conCrm, pct },
        chatPrompt: chatPrompt('Seguimiento 360 · cierres', 'Sin ID CRM', [
          `Órdenes: ${ordenes}`, `Clientes: ${clientes}`, `Con CRM: ${conCrm}`, `Periodo: ${payload.fechaInicio} — ${payload.fechaFin}`,
        ]),
      });
    }
  }

  if (vista === 'cliente') {
    const res = payload.resumen || {};
    const leads = Number(res.totalLeads ?? 0);
    const ciclos = Number(res.totalCiclos ?? 0);
    const compras = Number(res.totalCompras ?? 0);
    const pruebas = Number(res.totalPruebasManejo ?? 0);
    const solicitudes = Number(res.totalSolicitudes ?? 0);
    const ordenes = Number(payload.ordenesCount ?? 0);
    const abierto = Number(res.importeAbiertoTaller ?? 0);

    if (pruebas > 0 && compras === 0 && solicitudes === 0) {
      push(list, {
        id: 'seg-cli-prueba-fria',
        kpiId: 'kPruebasManejo',
        module: 'seguimiento',
        severity: 'info',
        title: 'Prueba de manejo sin avance F&I/compra',
        summary: `${pruebas} prueba(s) sin solicitud ni compra registrada.`,
        analysis: 'Falla de seguimiento individual: el prospecto hizo prueba y el embudo se detuvo.',
        recommendations: [
          'Recontactar con oferta y cita F&I.',
          'Registrar motivo de pérdida en el ciclo.',
        ],
        metrics: { pruebas, compras, solicitudes, leads, ciclos },
        chatPrompt: chatPrompt('Seguimiento 360 · cliente', 'Prueba sin avance', [
          `Cliente: ${payload.nombre || payload.idContacto || '—'}`,
          `Pruebas: ${pruebas}`, `Solicitudes: ${solicitudes}`, `Compras: ${compras}`,
        ]),
      });
    }

    if (compras > 0 && ordenes === 0) {
      push(list, {
        id: 'seg-cli-sin-taller',
        kpiId: 'kOrdenes',
        module: 'seguimiento',
        severity: 'info',
        title: 'Compró y no tiene órdenes de servicio',
        summary: `${compras} compra(s) sin órdenes de taller vinculadas.`,
        analysis: 'Oportunidad/falla de retención: el cliente no ha sido traído a postventa.',
        recommendations: [
          'Agendar 1ª revisión / servicio.',
          'Verificar que el VIN esté bien vinculado en CRM y SQL.',
        ],
        metrics: { compras, ordenes },
        chatPrompt: chatPrompt('Seguimiento 360 · cliente', 'Sin taller post-compra', [
          `Compras: ${compras}`, `Órdenes: ${ordenes}`, `Cliente: ${payload.nombre || '—'}`,
        ]),
      });
    }

    if (abierto > 0 && ordenes > 0) {
      push(list, {
        id: 'seg-cli-abierto',
        kpiId: 'kImporteTaller',
        module: 'seguimiento',
        severity: 'info',
        title: 'Importe de taller abierto',
        summary: `Hay ${round1(abierto)} abierto en órdenes del cliente.`,
        analysis: 'Órdenes sin cerrar/facturar en la ficha 360: revisar si hay falla de seguimiento de taller para este cliente.',
        recommendations: ['Revisar órdenes abiertas en la sección de servicio del 360.'],
        metrics: { abierto, ordenes },
        chatPrompt: chatPrompt('Seguimiento 360 · cliente', 'Importe abierto', [
          `Abierto: ${abierto}`, `Órdenes: ${ordenes}`, `Facturado: ${res.importeFacturadoTaller ?? 0}`,
        ]),
      });
    }

    const csi = payload.quejasCsi || {};
    const totalQuejas = Number(csi.total ?? res.totalQuejas ?? payload.ficha360?.quejasIncidencias ?? 0);
    if (totalQuejas > 0) {
      const area = csi.areaPrincipal || res.quejasAreaPrincipal || payload.ficha360?.quejasAreaPrincipal || 'General';
      const porArea = csi.porArea || {};
      const areaLines = Object.entries(porArea)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}: ${v}`)
        .slice(0, 5);
      const sample = [...(csi.posventa || []), ...(csi.ventas || [])]
        .slice(0, 2)
        .map((q) => `${q.incidencia || 'Incidencia'} → ${q.area || area}`)
        .join(' | ');
      push(list, {
        id: 'seg-cli-quejas-area',
        kpiId: 'kQuejas',
        module: 'seguimiento',
        severity: /factur|financ|garant|hyp|queja/i.test(area) ? 'warning' : 'info',
        title: `Queja/incidencia orientada a ${area}`,
        summary: `${totalQuejas} incidencia(s) CSI (${Number(csi.totalPosventa || 0)} posventa · ${Number(csi.totalVentas || 0)} ventas). Área principal: ${area}.`,
        analysis: [
          'La alerta interpreta el departamento/área a partir del tipo CSI, la incidencia y el comentario.',
          areaLines.length ? `Distribución: ${areaLines.join('; ')}.` : '',
          sample ? `Ejemplos: ${sample}.` : '',
          'CSI Posventa se vincula por número de orden; CSI Ventas por serie/VIN al ID CRM del perfil.',
        ].filter(Boolean).join(' '),
        recommendations: [
          `Escalar a ${area} con el comentario CSI completo.`,
          Number(csi.totalPosventa || 0) > 0 ? 'Revisar la orden de taller vinculada y el asesor/técnico.' : null,
          Number(csi.totalVentas || 0) > 0 ? 'Revisar con el ejecutivo de ventas la experiencia de compra.' : null,
          'Registrar seguimiento y cierre de la incidencia en CRM.',
        ].filter(Boolean),
        metrics: {
          totalQuejas,
          posventa: Number(csi.totalPosventa || 0),
          ventas: Number(csi.totalVentas || 0),
          areaPrincipal: area,
        },
        chatPrompt: chatPrompt('Seguimiento 360 · cliente', 'Quejas CSI por área', [
          `Cliente: ${payload.nombre || payload.idContacto || '—'}`,
          `Total: ${totalQuejas}`,
          `Posventa: ${csi.totalPosventa || 0}`,
          `Ventas: ${csi.totalVentas || 0}`,
          `Área principal: ${area}`,
          ...areaLines,
        ]),
      });
    }
  }

  return list;
}

/* ───────────────── Marketing / MTK (Afluencia) ───────────────── */

function buildMarketingInsights(payload = {}) {
  const insights = [];
  const fi = payload.fechaInicio || null;
  const ff = payload.fechaFin || null;
  const periodo = `${fi || '—'} → ${ff || '—'}`;
  const trafico = payload.trafico || {};
  const leads = payload.leads || {};
  const tSum = trafico.summary || {};
  const lSum = leads.summary || {};
  const porSub = Array.isArray(trafico.porSubmedio) ? trafico.porSubmedio : [];
  const porCampana = Array.isArray(leads.porCampana) ? leads.porCampana : [];
  const campanasDoc = Array.isArray(payload.campanasConversion) ? payload.campanasConversion : [];

  const afluencia = Number(tSum.afluenciaTotal || 0);
  const afluenciaMkt = Number(tSum.afluenciaMarketing || 0);
  const afluenciaOrg = Number(tSum.afluenciaOrganico || 0);
  const pctMkt = Number(tSum.pctMarketing || 0);
  const comprasCanal = Number(tSum.compras || 0);
  const convCanal = Number(tSum.conversionCompraPct || 0);
  const campanasActivas = Number(lSum.campanasActivas || 0);
  const campanasFunc = Number(lSum.campanasFuncionando || 0);
  const leadsTot = Number(lSum.leads || 0);
  const citasLeads = Number(lSum.citas || 0);
  const comprasLeads = Number(lSum.compras || 0);

  if (afluencia >= 80 && convCanal < 6) {
    push(insights, {
      id: 'mtk-conv-canal-baja',
      kpiId: 'kpiMktComprasCanal',
      module: 'marketing',
      severity: convCanal < 3 ? 'critical' : 'warning',
      badge: 'Diagnóstico MTK',
      title: 'Conversión de canal débil vs afluencia',
      summary: `${comprasCanal} compras atribuidas a canal con ${afluencia} de afluencia (${convCanal}% conv.).`,
      analysis:
        `En ${periodo}, el piso genera volumen pero pocas compras quedan atribuidas al medio/submedio. `
        + 'Posibles fallas: mala captura de origen en CRM, fuga post-visita, o tráfico de baja calidad (paseo / no calificado).',
      recommendations: [
        'Auditar medio/submedio en hostess y asesores (estándar de captura).',
        'Priorizar seguimiento 48h a Fresh up de submedios marketing (redes/internet/anuncio).',
        'Cruzar top submedios de afluencia vs compras y atacar los de alto volumen sin venta.',
      ],
      metrics: { afluencia, comprasCanal, convCanal, periodo },
      chatPrompt: chatPrompt('Marketing (MTK)', 'Conversión canal débil', [
        `Periodo: ${periodo}`,
        `Afluencia: ${afluencia}`,
        `Compras por canal: ${comprasCanal}`,
        `Conversión: ${convCanal}%`,
        `Marketing: ${afluenciaMkt} (${pctMkt}%) · Orgánico: ${afluenciaOrg}`,
      ]),
    });
  }

  if (afluencia >= 100 && pctMkt < 25) {
    push(insights, {
      id: 'mtk-mix-bajo-marketing',
      kpiId: 'kpiMktTraficoMarketing',
      module: 'marketing',
      severity: 'warning',
      badge: 'Mejora MTK',
      title: 'Baja participación de tráfico marketing',
      summary: `Solo ${pctMkt}% de la afluencia viene de canales marketing (${afluenciaMkt} de ${afluencia}).`,
      analysis:
        'La agencia depende más de orgánico/cartera/recomendación. Si las campañas digitales están activas, '
        + 'puede haber fuga de atribución (submedio mal etiquetado) o inversión poco efectiva en atracción a piso.',
      recommendations: [
        'Revisar creatividades y landing de campañas activas vs citas a piso.',
        'Capacitar captura: redes/internet/anuncio vs “iba pasando”.',
        'Medir costo por visita de piso en campañas FB/GM vs referidos.',
      ],
      metrics: { pctMkt, afluenciaMkt, afluencia, afluenciaOrg },
      chatPrompt: chatPrompt('Marketing (MTK)', 'Mix marketing bajo', [
        `Periodo: ${periodo}`,
        `% marketing: ${pctMkt}`,
        `Afluencia mkt: ${afluenciaMkt}`,
        `Afluencia orgánica: ${afluenciaOrg}`,
      ]),
    });
  }

  if (afluencia >= 100 && pctMkt >= 55) {
    push(insights, {
      id: 'mtk-mix-alto-marketing',
      kpiId: 'kpiMktTraficoOrganico',
      module: 'marketing',
      severity: 'info',
      badge: 'Diagnóstico MTK',
      title: 'Tráfico muy concentrado en marketing',
      summary: `${pctMkt}% de afluencia es marketing; orgánico aportó ${afluenciaOrg}.`,
      analysis:
        'Buena atracción digital/publicitaria, pero conviene cuidar cartera y referidos para no depender solo de pauta. '
        + 'Validar que la calidad (citas/compras) acompañe el volumen.',
      recommendations: [
        'Comparar % cita y compras de submedios marketing vs orgánicos.',
        'Mantener activaciones de cartera propia y referidos.',
        'Si la conversión marketing es baja, recortar pauta de bajo ROI.',
      ],
      metrics: { pctMkt, afluenciaMkt, afluenciaOrg },
      chatPrompt: chatPrompt('Marketing (MTK)', 'Mix marketing alto', [
        `Periodo: ${periodo}`,
        `% marketing: ${pctMkt}`,
        `Afluencia mkt: ${afluenciaMkt}`,
        `Orgánico: ${afluenciaOrg}`,
        `Conv. canal: ${convCanal}%`,
      ]),
    });
  }

  if (campanasActivas >= 5) {
    const pctFunc = campanasActivas ? round1((campanasFunc / campanasActivas) * 100) : 0;
    if (pctFunc < 40) {
      push(insights, {
        id: 'mtk-campanas-poco-funcionando',
        kpiId: 'kpiMktCampanasFuncionando',
        module: 'marketing',
        severity: pctFunc < 20 ? 'critical' : 'warning',
        badge: 'Diagnóstico MTK',
        title: 'Pocas campañas digitales funcionando',
        summary: `${campanasFunc} de ${campanasActivas} campañas activas cumplen criterio de funcionamiento (${pctFunc}%).`,
        analysis:
          `Hay ${leadsTot} leads, ${citasLeads} citas y ${comprasLeads} compras en campañas del periodo. `
          + 'Varias campañas generan volumen sin cita/compra: posible mala calidad de lead, BDC lento o mensaje no alineado al inventario.',
        recommendations: [
          'Pausar o reescribir campañas en “Baja respuesta” / alto volumen sin citas.',
          'Asegurar SLA de contacto < 30 min en leads FB/GM.',
          'Alinear creativo al stock real (modelos disponibles).',
        ],
        metrics: { campanasActivas, campanasFunc, pctFunc, leadsTot, citasLeads, comprasLeads },
        chatPrompt: chatPrompt('Marketing (MTK)', 'Campañas poco funcionando', [
          `Periodo: ${periodo}`,
          `Activas: ${campanasActivas}`,
          `Funcionando: ${campanasFunc} (${pctFunc}%)`,
          `Leads: ${leadsTot} · Citas: ${citasLeads} · Compras: ${comprasLeads}`,
        ]),
      });
    }
  }

  const malasCampanas = porCampana
    .filter((c) => Number(c.leads || 0) >= 40 && Number(c.conversionCitaPct || 0) < 2 && Number(c.compras || 0) === 0)
    .slice(0, 3);
  if (malasCampanas.length) {
    const names = malasCampanas.map((c) => c.campana).join(', ');
    push(insights, {
      id: 'mtk-campanas-volumen-sin-cita',
      kpiId: 'kpiMktCampanasActivas',
      module: 'marketing',
      severity: 'warning',
      badge: 'Mejora MTK',
      title: 'Campañas con volumen y casi sin citas',
      summary: `${malasCampanas.length} campaña(s) ≥40 leads con <2% cita y 0 compras: ${names}.`,
      analysis:
        'El gasto/atracción no se traduce en agenda. Falla típica: lead no calificado, formulario abierto, o contacto tardío del BDC/asesor.',
      recommendations: [
        `Priorizar auditoría de: ${malasCampanas[0].campana}.`,
        'Revisar tiempo a primer contacto y tasa de no contesta.',
        'Ajustar audiencia/exclusion y CTA hacia cita o prueba de manejo.',
      ],
      metrics: {
        campañas: malasCampanas.map((c) => ({
          campana: c.campana,
          canal: c.canal,
          leads: c.leads,
          citas: c.citas,
          conversionCitaPct: c.conversionCitaPct,
        })),
      },
      chatPrompt: chatPrompt('Marketing (MTK)', 'Volumen sin citas', [
        `Periodo: ${periodo}`,
        ...malasCampanas.map((c) => `${c.campana} (${c.canal}): ${c.leads} leads · ${c.citas} citas · ${c.compras} compras`),
      ]),
    });
  }

  const topSinCompra = porSub
    .filter((r) => Number(r.afluencia || 0) >= 40 && Number(r.compras || 0) === 0 && Number(r.marketing || 0) > 0)
    .slice(0, 3);
  if (topSinCompra.length) {
    push(insights, {
      id: 'mtk-submedio-sin-compra',
      kpiId: 'kpiMktTraficoMarketing',
      module: 'marketing',
      severity: 'warning',
      badge: 'Diagnóstico MTK',
      title: 'Submedios marketing sin compras atribuidas',
      summary: topSinCompra.map((r) => `${r.grupo} (${r.afluencia} afl.)`).join(' · '),
      analysis:
        'Estos orígenes traen gente a piso pero el ciclo CRM no refleja compras con el mismo submedio. '
        + 'Puede ser atribución rota o verdadera nula conversión.',
      recommendations: [
        'Verificar etiquetado de medio/submedio al facturar / ciclo.',
        'Dar seguimiento SNV a ese submedio en los últimos 15 días.',
        'Si tras auditoría sigue en cero, reducir inversión en ese origen.',
      ],
      metrics: { topSinCompra },
      chatPrompt: chatPrompt('Marketing (MTK)', 'Submedios sin compra', [
        `Periodo: ${periodo}`,
        ...topSinCompra.map((r) => `${r.grupo}: afluencia ${r.afluencia} · fresh ${r.freshUp} · citas ${r.citas} · compras ${r.compras}`),
      ]),
    });
  }

  const buenas = porCampana.filter((c) => c.funcionando && Number(c.compras || 0) >= 2).slice(0, 3);
  if (buenas.length) {
    push(insights, {
      id: 'mtk-campanas-exito',
      kpiId: 'kpiMktCampanasFuncionando',
      module: 'marketing',
      severity: 'info',
      badge: 'Oportunidad MTK',
      title: 'Campañas que sí convierten: escalar',
      summary: buenas.map((c) => `${c.campana} (${c.compras} ventas)`).join(' · '),
      analysis:
        'Estas campañas cumplen criterio de funcionamiento y ya generan compras. '
        + 'Conviene reforzar presupuesto/creativo similar y replicar el mensaje en otros canales.',
      recommendations: [
        `Escalar presupuesto en: ${buenas[0].campana}.`,
        'Documentar copy/audiencia ganadora para replicar.',
        'Cuidar capacidad de BDC para no degradar el SLA al subir volumen.',
      ],
      metrics: { buenas },
      chatPrompt: chatPrompt('Marketing (MTK)', 'Campañas a escalar', [
        `Periodo: ${periodo}`,
        ...buenas.map((c) => `${c.campana}: ${c.leads} leads · ${c.citas} citas · ${c.compras} compras · conv ${c.conversionCompraPct}%`),
      ]),
    });
  }

  // Campañas documentadas (90 días) si el frontend las envía
  const docDebiles = campanasDoc
    .filter((c) => Number(c.total || 0) >= 30 && Number(c.conversionPct || 0) < 1.5)
    .slice(0, 4);
  const fueraVida = campanasDoc.reduce((s, c) => s + Number(c.vendidosFueraVida || 0), 0);
  if (docDebiles.length) {
    push(insights, {
      id: 'mtk-campanas-doc-baja-conv',
      kpiId: 'kpiMktCampanasActivas',
      module: 'marketing',
      severity: 'warning',
      badge: 'Campañas documentadas',
      title: 'Campañas reactivas con baja conversión ≤90 días',
      summary: docDebiles.map((c) => `${c.campana} (${c.conversionPct}%)`).join(' · '),
      analysis:
        'En el catálogo monitoreado, estas campañas tienen volumen pero poca venta dentro de la vida útil del lead (90 días). '
        + (fueraVida ? `Además hay ${fueraVida} ventas fuera de 90d que no cuentan para conversión.` : ''),
      recommendations: [
        'Acelerar contacto y cita en la primera semana de vida del lead.',
        'Revisar nurtures para no dejar oportunidades morir al día 60–90.',
        'Comparar creativo vs tasa de contacto real del BDC.',
      ],
      metrics: { docDebiles, fueraVida },
      chatPrompt: chatPrompt('Marketing (MTK)', 'Campañas documentadas débiles', [
        `Periodo: ${periodo}`,
        `Ventas fuera de 90d (no cuentan): ${fueraVida}`,
        ...docDebiles.map((c) => `${c.campana}: total ${c.total} · contactados ${c.contactados} · vendidos≤90d ${c.vendidos} · conv ${c.conversionPct}%`),
      ]),
    });
  }

  if (fueraVida >= 5) {
    push(insights, {
      id: 'mtk-fuga-post-90d',
      kpiId: 'kpiMktComprasCanal',
      module: 'marketing',
      severity: 'info',
      badge: 'Regla 90 días',
      title: 'Ventas fuera de la vida del lead',
      summary: `${fueraVida} ventas de campañas documentadas ocurrieron después de 90 días y no suman a conversión.`,
      analysis:
        'Hay cierre comercial tardío: el lead “murió” para marketing aunque la agencia sí vendió. '
        + 'Oportunidad de acortar ciclo o de reportar un KPI aparte de “venta recuperada post-90d”.',
      recommendations: [
        'Medir días promedio entrada→factura en campañas top.',
        'Activar remarketing/CRM antes del día 60.',
        'No pausar campañas solo por conv. baja si hay muchas ventas post-90d: mejorar velocidad de cierre.',
      ],
      metrics: { fueraVida },
      chatPrompt: chatPrompt('Marketing (MTK)', 'Fuga post 90 días', [
        `Periodo: ${periodo}`,
        `Vendidos fuera de vida: ${fueraVida}`,
      ]),
    });
  }

  if (!insights.length && afluencia > 0) {
    push(insights, {
      id: 'mtk-ok',
      kpiId: 'kpiMktTraficoMarketing',
      module: 'marketing',
      severity: 'info',
      badge: 'MTK estable',
      title: 'Sin alertas críticas de marketing',
      summary: `Afluencia ${afluencia} · mkt ${pctMkt}% · conv. canal ${convCanal}% · ${campanasFunc}/${campanasActivas} campañas funcionando.`,
      analysis: 'Los indicadores del periodo no cruzan umbrales de falla. Conviene monitorear semanalmente mix, citas y compras por campaña.',
      recommendations: [
        'Mantener revisión semanal de campañas “Alto volumen”.',
        'Seguir estandarizando captura de submedio en piso.',
      ],
      metrics: { afluencia, pctMkt, convCanal, campanasFunc, campanasActivas },
      chatPrompt: chatPrompt('Marketing (MTK)', 'Sin alertas críticas', [
        `Periodo: ${periodo}`,
        `Afluencia: ${afluencia}`,
        `% mkt: ${pctMkt}`,
        `Conv. canal: ${convCanal}%`,
        `Campañas funcionando: ${campanasFunc}/${campanasActivas}`,
      ]),
    });
  }

  return insights;
}

/* ───────────────── Router ───────────────── */

function buildInsights({ module, roleId, ...rest } = {}) {
  const mod = String(module || '').toLowerCase();
  let insights = [];
  if (mod === 'ventas' || mod === 'sales') insights = buildVentasInsights(rest);
  else if (mod === 'contabilidad' || mod === 'eeff' || mod === 'accounting') {
    insights = buildContabilidadInsights(rest);
  } else if (mod === 'overview' || mod === 'tablero' || mod === 'index') {
    insights = buildOverviewInsights(rest);
  } else if (mod === 'inventory' || mod === 'inventario') insights = buildInventoryInsights(rest);
  else if (mod === 'forecast' || mod === 'pronostico') insights = buildForecastInsights(rest);
  else if (mod === 'post-sales' || mod === 'postventa' || mod === 'postsales') {
    insights = buildPostSalesInsights(rest);
  } else if (mod === 'seguimiento' || mod === 'crm' || mod === 'crm360') {
    insights = buildSeguimientoInsights(rest);
  } else if (mod === 'marketing' || mod === 'mtk' || mod === 'afluencia') {
    insights = buildMarketingInsights(rest);
  }

  try {
    const { enrichInsights } = require('./kpiCatalogSemaforo');
    return enrichInsights(insights, { roleId });
  } catch (err) {
    console.warn('[insights] semáforo ABP no disponible:', err.message);
    return insights;
  }
}

module.exports = {
  buildInsights,
  buildVentasInsights,
  buildContabilidadInsights,
  buildLiquidezInsights,
  buildOverviewInsights,
  buildInventoryInsights,
  buildForecastInsights,
  buildPostSalesInsights,
  buildSeguimientoInsights,
  buildMarketingInsights,
  expectedPacePct,
};
