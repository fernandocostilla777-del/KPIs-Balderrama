const { query } = require('../db');
const { VENTAS_BASE_CTE, buildVentasDateClause, pct } = require('./ventasNuevosFinanciero');

const CONTADO_FORMS = new Set(['CASACON', 'PLNCON', 'CHCON', 'FORCON', 'ZACCON', 'CON']);
const EXCLUDE_FI_FORMS = new Set(['FLOT', 'FLOTGMF', 'PERDIDA', 'VENTAMRS', 'VTACON']);

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function classifyFinancing(formaPago) {
  const fp = String(formaPago || '').trim().toUpperCase();
  if (EXCLUDE_FI_FORMS.has(fp)) return 'otro';
  if (CONTADO_FORMS.has(fp)) return 'contado';
  return 'credito';
}

function classifyAging(days) {
  if (days === null || days === undefined || !Number.isFinite(days)) return 'sin_dato';
  if (days <= 30) return 'sanos';
  if (days <= 60) return 'riesgo';
  return 'estancados';
}

function classifyQuadrant(units, avgMargin, medVol, medMargin) {
  const highVol = units >= medVol;
  const highMargin = avgMargin >= medMargin;
  if (highVol && highMargin) return { id: 'estrella', label: 'Estrella' };
  if (highVol && !highMargin) return { id: 'regalo', label: 'Alto volumen · bajo margen' };
  if (!highVol && highMargin) return { id: 'calidad', label: 'Bajo volumen · alto margen' };
  return { id: 'desarrollo', label: 'En desarrollo' };
}

function hasValidCost(row) {
  return Number(row.costoNeto || 0) > 0;
}

function effectiveDiscount(row) {
  const costoMiCosto = Number(row.costoMiCosto || 0);
  const costoNeto = Number(row.costoNeto || 0);
  const participacion = Number(row.participacion || 0);
  const fromCost = Math.max(0, costoMiCosto - costoNeto - participacion);
  const fromField = Math.max(0, Math.abs(Number(row.bonificacion || 0)));
  return fromCost > 0 ? fromCost : fromField;
}

function mapRow(row) {
  const ventaSubtotal = Number(row.ventaSubtotal || 0);
  const costoNeto = Number(row.costoNeto || 0);
  const gastos = Number(row.gastos || 0);
  const bonificacion = effectiveDiscount(row);
  const utilidadBruta = ventaSubtotal - costoNeto;
  const utilidad = row.utilidad !== null && row.utilidad !== undefined
    ? Number(row.utilidad)
    : (costoNeto > 0 || row.tieneLibro ? utilidadBruta - gastos : null);

  const diasInventario = row.diasInventario !== null && row.diasInventario !== undefined
    ? Number(row.diasInventario)
    : null;

  return {
    modelo: String(row.modelo || 'Sin modelo').trim() || 'Sin modelo',
    vendedor: String(row.vendedor || 'Sin asesor').trim() || 'Sin asesor',
    ventaSubtotal,
    costoNeto,
    gastos,
    bonificacion,
    utilidadBruta,
    utilidad,
    marginBrutaPct: ventaSubtotal > 0 ? round2((utilidadBruta / ventaSubtotal) * 100) : 0,
    diasInventario,
    agingBucket: classifyAging(diasInventario),
    tipoFinanciamiento: classifyFinancing(row.formaPago),
  };
}

function aggregateByModel(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.modelo)) {
      map.set(row.modelo, {
        model: row.modelo,
        units: 0,
        ventaSubtotal: 0,
        utilidadBruta: 0,
        utilidad: 0,
        bonificacion: 0,
        conUtilidad: 0,
      });
    }
    const entry = map.get(row.modelo);
    entry.units += 1;
    entry.ventaSubtotal += row.ventaSubtotal;
    entry.utilidadBruta += row.utilidadBruta;
    entry.bonificacion += row.bonificacion;
    if (row.utilidad !== null) {
      entry.utilidad += row.utilidad;
      entry.conUtilidad += 1;
    }
  }
  return [...map.values()].map((m) => ({
    ...m,
    marginPct: m.ventaSubtotal > 0 ? round2((m.utilidadBruta / m.ventaSubtotal) * 100) : 0,
    utilidadReportada: m.conUtilidad > 0 ? m.utilidad : m.utilidadBruta,
  }));
}

function computePareto(models, totalUtilidad) {
  const sorted = [...models]
    .filter((m) => m.utilidadReportada > 0)
    .sort((a, b) => b.utilidadReportada - a.utilidadReportada);

  let cumulative = 0;
  const top = [];
  for (const m of sorted) {
    if (top.length >= 3) break;
    cumulative += m.utilidadReportada;
    top.push({
      model: m.model,
      units: m.units,
      utilidad: round2(m.utilidadReportada),
      marginPct: m.marginPct,
      sharePct: totalUtilidad > 0 ? round2((m.utilidadReportada / totalUtilidad) * 100) : 0,
      cumulativePct: totalUtilidad > 0 ? round2((cumulative / totalUtilidad) * 100) : 0,
    });
  }
  return top;
}

function computeBottomMargin(models, minUnits = 2) {
  return [...models]
    .filter((m) => m.units >= minUnits && m.ventaSubtotal > 0)
    .sort((a, b) => a.marginPct - b.marginPct || a.utilidadReportada - b.utilidadReportada)
    .slice(0, 3)
    .map((m) => ({
      model: m.model,
      units: m.units,
      marginPct: m.marginPct,
      utilidad: round2(m.utilidadReportada),
      bonificacion: round2(m.bonificacion),
    }));
}

function computeAging(rows) {
  const buckets = {
    sanos: { key: 'sanos', label: '0-30 días (Sanos)', units: 0, utilidadBruta: 0, ventaSubtotal: 0, bonificacion: 0 },
    riesgo: { key: 'riesgo', label: '31-60 días (En riesgo)', units: 0, utilidadBruta: 0, ventaSubtotal: 0, bonificacion: 0 },
    estancados: { key: 'estancados', label: '+60 días (Estancados)', units: 0, utilidadBruta: 0, ventaSubtotal: 0, bonificacion: 0 },
    sin_dato: { key: 'sin_dato', label: 'Sin dato de remisión', units: 0, utilidadBruta: 0, ventaSubtotal: 0, bonificacion: 0 },
  };

  for (const row of rows) {
    const bucket = buckets[row.agingBucket] || buckets.sin_dato;
    bucket.units += 1;
    bucket.utilidadBruta += row.utilidadBruta;
    bucket.ventaSubtotal += row.ventaSubtotal;
    bucket.bonificacion += row.bonificacion;
  }

  const result = ['sanos', 'riesgo', 'estancados'].map((key) => {
    const b = buckets[key];
    return {
      ...b,
      avgMarginPct: b.ventaSubtotal > 0 ? round2((b.utilidadBruta / b.ventaSubtotal) * 100) : 0,
      avgBonificacion: b.units > 0 ? round2(b.bonificacion / b.units) : 0,
    };
  });

  const sanosBon = buckets.sanos.units > 0 ? buckets.sanos.bonificacion / buckets.sanos.units : 0;
  const estBon = buckets.estancados.units > 0 ? buckets.estancados.bonificacion / buckets.estancados.units : 0;

  return {
    buckets: result,
    sinDatoUnits: buckets.sin_dato.units,
    estancadosMayorDescuento: estBon > sanosBon && buckets.estancados.units > 0,
  };
}

function computeFi(rows) {
  const fiRows = rows.filter((r) => r.tipoFinanciamiento === 'credito' || r.tipoFinanciamiento === 'contado');
  const credito = fiRows.filter((r) => r.tipoFinanciamiento === 'credito');
  const contado = fiRows.filter((r) => r.tipoFinanciamiento === 'contado');
  const totalFi = fiRows.length;

  function summarize(group) {
    const ventaSubtotal = group.reduce((s, r) => s + r.ventaSubtotal, 0);
    const utilidadBruta = group.reduce((s, r) => s + r.utilidadBruta, 0);
    return {
      units: group.length,
      avgMarginPct: ventaSubtotal > 0 ? round2((utilidadBruta / ventaSubtotal) * 100) : 0,
      avgUtilidadUnit: group.length > 0 ? round2(utilidadBruta / group.length) : 0,
    };
  }

  const creditoSum = summarize(credito);
  const contadoSum = summarize(contado);

  let masRentable = 'empate';
  if (creditoSum.avgMarginPct > contadoSum.avgMarginPct + 0.5) masRentable = 'credito';
  else if (contadoSum.avgMarginPct > creditoSum.avgMarginPct + 0.5) masRentable = 'contado';

  return {
    creditoUnits: creditoSum.units,
    contadoUnits: contadoSum.units,
    creditoPct: pct(creditoSum.units, totalFi),
    contadoPct: pct(contadoSum.units, totalFi),
    creditoAvgMarginPct: creditoSum.avgMarginPct,
    contadoAvgMarginPct: contadoSum.avgMarginPct,
    creditoAvgUtilidadUnit: creditoSum.avgUtilidadUnit,
    contadoAvgUtilidadUnit: contadoSum.avgUtilidadUnit,
    masRentable,
    excluidasFlotilla: rows.length - totalFi,
  };
}

function computeFuerzaVentas(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.vendedor)) {
      map.set(row.vendedor, { vendedor: row.vendedor, units: 0, utilidadBruta: 0, ventaSubtotal: 0 });
    }
    const entry = map.get(row.vendedor);
    entry.units += 1;
    entry.utilidadBruta += row.utilidadBruta;
    entry.ventaSubtotal += row.ventaSubtotal;
  }

  const advisors = [...map.values()].map((a) => ({
    vendedor: a.vendedor,
    units: a.units,
    avgMarginPct: a.ventaSubtotal > 0 ? round2((a.utilidadBruta / a.ventaSubtotal) * 100) : 0,
    avgUtilidadUnit: a.units > 0 ? round2(a.utilidadBruta / a.units) : 0,
    utilidadTotal: round2(a.utilidadBruta),
  }));

  if (!advisors.length) {
    return { ranking: [], medians: { volume: 0, quality: 0 } };
  }

  const volumes = advisors.map((a) => a.units).sort((a, b) => a - b);
  const qualities = advisors.map((a) => a.avgUtilidadUnit).sort((a, b) => a - b);
  const medVol = volumes[Math.floor(volumes.length / 2)];
  const medMargin = qualities[Math.floor(qualities.length / 2)];

  const ranking = advisors
    .map((a) => {
      const quadrant = classifyQuadrant(a.units, a.avgUtilidadUnit, medVol, medMargin);
      return { ...a, quadrant: quadrant.id, quadrantLabel: quadrant.label };
    })
    .sort((a, b) => b.units - a.units || b.avgUtilidadUnit - a.avgUtilidadUnit);

  return { ranking, medians: { volume: medVol, quality: medMargin } };
}

function buildRecomendaciones(analytics) {
  const recs = [];
  const { rentabilidad, aging, fi, fuerzaVentas } = analytics;

  if (rentabilidad.paretoTop.length) {
    const top = rentabilidad.paretoTop[0];
    recs.push(
      `Impulsar pedido a planta de ${top.model}: concentra ${top.sharePct}% de la utilidad del periodo con margen del ${top.marginPct}%.`
    );
  }

  if (rentabilidad.paretoBottom.length) {
    const low = rentabilidad.paretoBottom[0];
    recs.push(
      `Frenar volumen de ${low.model}: margen bruto de solo ${low.marginPct}% (${low.units} uds.) — revisar descuentos y bonificaciones.`
    );
  } else if (aging.estancadosMayorDescuento) {
    recs.push(
      'Unidades con +60 días en inventario salieron con mayores bonificaciones; priorice remate y ajuste el mix de pedidos.'
    );
  }

  if (fi.masRentable === 'credito') {
    recs.push(
      `Crédito (${fi.creditoPct}% penetración) retiene mejor margen (${fi.creditoAvgMarginPct}% vs ${fi.contadoAvgMarginPct}% contado). Refuerce F&I.`
    );
  } else if (fi.masRentable === 'contado') {
    recs.push(
      `Contado retiene mayor margen (${fi.contadoAvgMarginPct}% vs ${fi.creditoAvgMarginPct}% crédito). Revise descuentos ligados a financiamiento.`
    );
  }

  const regalo = fuerzaVentas.ranking.find((r) => r.quadrant === 'regalo');
  if (regalo && recs.length < 3) {
    recs.push(
      `${regalo.vendedor}: alto volumen (${regalo.units} uds.) con utilidad bruta unitaria baja — capacitar en manejo de objeciones y margen.`
    );
  }

  if (recs.length < 3 && rentabilidad.bonificacionesPctGanancia > 10) {
    recs.push(
      `Bonificaciones = ${rentabilidad.bonificacionesPctGanancia}% de la utilidad bruta potencial; ajuste política de descuentos.`
    );
  }

  while (recs.length < 3) {
    recs.push('Revise semanalmente margen por carline y aging de inventario para optimizar pedidos a planta.');
  }

  return [...new Set(recs)].slice(0, 3);
}

function computeExecutiveAnalytics(rows) {
  const mapped = rows.map(mapRow).filter(hasValidCost);
  const withCost = mapped;
  const totalSubtotal = withCost.reduce((s, r) => s + r.ventaSubtotal, 0);
  const totalUtilidadBruta = withCost.reduce((s, r) => s + r.utilidadBruta, 0);
  const totalBonificacion = mapped.reduce((s, r) => s + r.bonificacion, 0);
  const utilidadBrutaPotencial = totalUtilidadBruta + totalBonificacion;
  const unitsWithCost = withCost.length;

  const margenBrutoPct = totalSubtotal > 0 ? round2((totalUtilidadBruta / totalSubtotal) * 100) : 0;
  const margenBrutoUnitario = unitsWithCost > 0 ? round2(totalUtilidadBruta / unitsWithCost) : 0;

  const byModel = aggregateByModel(withCost);
  const totalUtilidad = byModel.reduce((s, m) => s + Math.max(0, m.utilidadReportada), 0);

  const bonificacionesPorModelo = [...byModel]
    .filter((m) => m.bonificacion > 0)
    .sort((a, b) => b.bonificacion - a.bonificacion)
    .slice(0, 8)
    .map((m) => ({
      model: m.model,
      bonificacion: round2(m.bonificacion),
      units: m.units,
      pctGanancia: utilidadBrutaPotencial > 0 ? round2((m.bonificacion / utilidadBrutaPotencial) * 100) : 0,
    }));

  const rentabilidad = {
    margenBrutoPct,
    margenBrutoUnitario,
    utilidadBrutaTotal: round2(totalUtilidadBruta),
    unidadesAnalizadas: unitsWithCost,
    unidadesExcluidasSinCosto: rows.length - mapped.length,
    bonificacionesTotal: round2(totalBonificacion),
    bonificacionesPctGanancia: utilidadBrutaPotencial > 0
      ? round2((totalBonificacion / utilidadBrutaPotencial) * 100)
      : 0,
    paretoTop: computePareto(byModel, totalUtilidad),
    paretoBottom: computeBottomMargin(byModel),
    bonificacionesPorModelo,
  };

  const aging = computeAging(mapped);
  const fi = computeFi(mapped);
  const fuerzaVentas = computeFuerzaVentas(mapped);

  const analytics = { rentabilidad, aging, fi, fuerzaVentas };
  analytics.recomendaciones = buildRecomendaciones(analytics);

  return analytics;
}

async function loadSalesExecutiveAnalytics({ fechaInicio, fechaFin }) {
  const { clause, params } = buildVentasDateClause(fechaInicio, fechaFin);

  const rows = await query(`
    ${VENTAS_BASE_CTE}
    SELECT
      v.modelo,
      v.ventaSubtotal,
      v.costoNeto,
      v.costoMiCosto,
      v.participacion,
      v.gastos,
      v.bonificacion,
      v.utilidad,
      v.tieneLibro,
      v.VTE_FORMAPAGO AS formaPago,
      ISNULL(NULLIF(LTRIM(RTRIM(
        ven.PER_PATERNO + ' ' + ven.PER_MATERNO + ' ' + ven.PER_NOMRAZON
      )), ''), 'Sin asesor') AS vendedor,
      CASE
        WHEN veh.VEH_FECREMISION IS NOT NULL AND LTRIM(RTRIM(veh.VEH_FECREMISION)) <> ''
        THEN DATEDIFF(
          day,
          CONVERT(DATE, veh.VEH_FECREMISION, 103),
          CONVERT(DATE, v.VTE_FECHDOCTO, 103)
        )
        ELSE NULL
      END AS diasInventario
    FROM ventas v
    INNER JOIN SER_VEHICULO veh ON veh.VEH_NUMSERIE = v.VTE_SERIE AND veh.VEH_NOINVENTA > 0
    LEFT JOIN PER_PERSONAS ven ON ven.PER_IDPERSONA = veh.VEH_VENDEDOR
    WHERE 1 = 1 ${clause.replace(/\bv\./g, 'v.')}
  `, params);

  return computeExecutiveAnalytics(rows);
}

module.exports = { loadSalesExecutiveAnalytics, computeExecutiveAnalytics };
